// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// release-await-cut.mjs — wait, briefly, for a cut to land on main; then answer the same question the
// cron asks.
//
// ── WHY A WAIT EXISTS AT ALL ────────────────────────────────────────────────────────────────────────
//
// The standing version pull request merges itself once its checks pass, and GitHub performs that merge
// with the built-in `GITHUB_TOKEN`. A push made with that token starts NO workflow run — measured here
// 2026-09-05 on `65e634a6`, with five Dependabot runs arriving on the same commit within seconds as the
// control, so the suppression is on the token and not on the repository. The merge that cuts a version
// therefore fires nothing: no CI, no release, no error.
//
// The `*/5` cron is the standing net for that, and its own comment in the workflow calls it "a floor,
// not a clock" — on a public repository GitHub runs it when it feels like it. Measured 2026-09-06: a
// version sat cut and unpublished for 74 minutes. Every stable release so far published on an unrelated
// human merge instead.
//
// ── WHAT THIS ADDS, AND THE ATTEMPT IT REPLACES ────────────────────────────────────────────────────
//
// FIRST ATTEMPT, DELETED: hang the wait off `workflow_run` on the version branch's CI, on the reasoning
// that the completion auto-merge is waiting on fires regardless of who pushed. IT DOES NOT. Measured
// 2026-09-06 with the trigger live on main — version pull request 58 self-merged at 16:12:48Z as
// "Release 0.1.8", both CI completions on `changeset-release/main` fired nothing, and across the last
// sixty runs of every workflow on this repository there was not one `workflow_run` event. The
// suppression that swallows the merge push swallows the event its CI would raise, because that CI was
// itself started by `GITHUB_TOKEN` activity. The trigger is gone rather than kept beside this: a line
// that has never fired reads like a net and is not one.
//
// WHAT RUNS THIS NOW is the release run a PERSON started — the human push to main that opened or
// updated the version pull request. That pull request merges itself minutes later and fires nothing, so
// instead of waiting for an event that will not come, that run stays alive and watches main for the
// merge it just set in motion.
//
//   BOUNDED, because an unbounded wait hangs a runner on every version branch that is not going to
//   merge at all.
//
//   QUIETLY, because not-merged-yet is the ORDINARY outcome here, not a fault. A checks-failed version
//   branch, a merge somebody dismissed, a re-cut mid-flight: none of those is a release that went
//   missing, and reporting them as failures would train every reader to ignore this step. The cron floor
//   is still underneath, so nothing is lost by giving up.
//
// ── THE ANSWER IS THE SAME FUNCTION THE OTHER PATHS ASK ─────────────────────────────────────────────
//
// `cutDecision` decides, from the version the COMMIT carries and the tags in this checkout — never from
// the working tree, for the reason `release-cut-decision.mjs`'s header gives at length. Two answers to
// one question is how a pipeline comes to publish something nobody merged.
import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";
import { cutDecision, versionAtHead, tagsHere } from "./release-cut-decision.mjs";

/**
 * Default bound: fifteen minutes at thirty-second steps. Both are arguments so an arm can drive the loop.
 *
 * TWENTY-FIVE, RAISED FROM FIFTEEN (tracker issue 247), because this waits for the version pull
 * request's OWN CI and that is what it must clear. Measured over the first three cuts, the wait held
 * 552 s, 622 s and 686 s against a 900 s budget — rising every time, and the thing it waits on is the
 * offline suite, which grows on purpose every time anybody adds an arm. The margin was one slow queue.
 *
 * AND THE FAILURE IS SILENT, which is why the margin has to be generous rather than adequate. Running
 * out is a quiet exit 0 by design — an ordinary "nothing merged" must not read as a fault — so the
 * first time this budget is exceeded, the release is simply stranded behind a green tick. There is no
 * red to notice. The cron floor underneath would eventually publish it, which makes the silence worse
 * rather than better: the version ships late, from a different run, with nobody told why.
 *
 * THE JOB'S `timeout-minutes` MUST EXCEED THIS, with room for the checkout and install above it. A
 * budget smaller than its own longest step cancels the job at the moment it was about to publish, and a
 * cancelled run reads as neither a success nor a failure to anybody scanning the list. The comment here
 * used to say the job was capped at 30 while the job actually said 25 — harmless at a 15 minute wait,
 * and exactly the sort of thing that stops being harmless when somebody raises one number and believes
 * a sentence about the other. `MIN_JOB_MARGIN_MS` is what an arm holds the pair to now.
 */
export const WAIT_MS = 25 * 60 * 1000;

/**
 * How far the job's budget must exceed the wait's: enough for the checkout, the install and the pack
 * that surround it. Five minutes, which is generous against the ~90 s those actually take, because the
 * cost of being wrong in this direction is a cancelled publish and the cost of being wrong in the other
 * is a runner held slightly longer.
 */
export const MIN_JOB_MARGIN_MS = 5 * 60 * 1000;

/**
 * The bound, overridable for one caller only: the dry-run rehearsal.
 *
 * A rehearsal must exercise this path — a step nobody rehearses is a step that first runs for real on
 * the day it matters — but it has nothing to wait FOR, and fifteen minutes of polling to establish that
 * is fifteen minutes of a runner held for no answer. `awaitCut` asks before its first sleep, so a bound
 * of 0 does exactly one read and returns, which is the whole of what a rehearsal needs to prove.
 *
 * REFUSES A VALUE IT CANNOT READ rather than falling back to the default. A typo here would silently
 * restore the full wait on the rehearsal, or — worse in the other direction — a real run would take a
 * malformed value as 0 and give up without waiting at all, which is this whole file not running.
 */
export function waitBudget(env = process.env) {
  const raw = String(env.CLEAROTRON_RELEASE_WAIT_MS ?? "").trim();
  if (!raw) return WAIT_MS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`release-await-cut: CLEAROTRON_RELEASE_WAIT_MS="${raw}" is not a whole number of `
      + "milliseconds. Publishing would either wait when it should not, or not wait when it must.");
  }
  return n;
}
export const STEP_MS = 30 * 1000;

/**
 * Poll `main` until it carries a version with no tag, or the budget runs out.
 *
 * PURE OF I/O BY INJECTION: `refresh` re-reads the remote, `read` answers the question, `sleep` waits.
 * The loop is what this file is for, and a loop that can only be exercised by waiting ten real minutes
 * is a loop nobody checks.
 *
 * Returns `{ cut, version, waitedMs, gaveUp }`. `gaveUp` is not a failure — see the header.
 */
export async function awaitCut({ refresh, read, sleep, waitMs = WAIT_MS, stepMs = STEP_MS, now = () => 0 } = {}) {
  const started = now();
  let waitedMs = 0;
  for (;;) {
    await refresh();
    const d = read();
    // ASKED BEFORE THE FIRST SLEEP, so a merge that landed while CI was finishing costs no wait at all —
    // which is the common case, not the exception.
    if (d.cut) return { ...d, waitedMs, gaveUp: false };
    waitedMs = now() - started;
    if (waitedMs + stepMs > waitMs) return { ...d, waitedMs, gaveUp: true };
    await sleep(stepMs);
    waitedMs = now() - started;
  }
}

const git = (args) => execFileSync("git", args, { encoding: "utf8" });

/**
 * One read of `main`: the version it carries, whether that version is tagged, and WHICH COMMIT said so.
 *
 * THE COMMIT IS READ IN THE SAME PASS AS THE VERSION, and that is the whole point of this function
 * existing rather than being three calls at the call site (tracker issue 238). The job below used to
 * check out `main` by name after this loop returned, so a commit landing in between — one that moves no
 * version, an instrument fix with no note — was packed and published under a number whose changelog
 * never described it. Nothing downstream could see it: the tip check compares VERSIONS, and the version
 * had not moved. Naming the commit here is what makes the two ends of the pipeline talk about the same
 * tree.
 *
 * No fetch happens between the two reads, so they cannot straddle one.
 *
 * EVERY READER IS AN ARGUMENT, and that is not decoration. An arm that injected only `run` still asked
 * real git for the version and the tags, so it answered differently on a box where `main` is tagged than
 * on a runner where the checkout has neither `origin/main` nor tags — green here, red there, for reasons
 * that have nothing to do with what it was checking. This file's own suite header warns about exactly
 * that shape, and one of these arms was written into it anyway.
 */
export function versionBumpCommit({ version, ref = "origin/main", run = git, versionAt = versionAtHead, maxWalk = 100 }) {
  const shas = run(["rev-list", "--first-parent", `-n${maxWalk}`, ref]).trim().split("\n").filter(Boolean);
  let answer = null;
  let sawTheChange = false;
  for (const sha of shas) {
    if (versionAt({ ref: sha }) !== version) { sawTheChange = true; break; }
    // KEEP WALKING PAST THE FIRST MATCH. Every commit landing after the bump and before this read also
    // carries the version — that is precisely the class of commit this exists to leave out — so the
    // answer is the OLDEST consecutive one, not the newest.
    answer = sha;
  }
  // A WALK THAT NEVER SAW THE VERSION CHANGE HAS NOT FOUND THE BUMP; it has run out of road. The oldest
  // commit it happened to reach carries the version by coincidence of the window, and publishing that
  // would ship a tree from before the release. An absence is a finding.
  return sawTheChange ? answer : null;
}

export function readMain({ run = git, versionAt = versionAtHead, tags = tagsHere, decide = cutDecision } = {}) {
  const sha = run(["rev-parse", "origin/main"]).trim();
  // CHECKED BEFORE THE VERSION IS READ, so a checkout with no `origin/main` refuses here rather than
  // going on to answer confidently about a tree it could not name. `git rev-parse` prints the name back
  // when it cannot resolve it, so the failure looks like a value rather than like an error.
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(`release-await-cut: \`git rev-parse origin/main\` answered "${sha.slice(0, 80)}", which is `
      + "not a commit. The publish below checks out what this reports, so a name it cannot resolve must "
      + "refuse here rather than resolve to something else there.");
  }
  const d = decide({ version: versionAt({ ref: "origin/main" }), tags: tags() });
  // NOT THE TIP. `origin/main` is where the branch points in this pass, and a commit that landed after
  // the version bump carries the same version — so the tip check downstream, which compares versions,
  // passes on exactly the commit that made the tarball disagree with its changelog. The answer is the
  // commit that MOVED the version, which is the version pull request's merge.
  //
  // Only asked when there is something to publish. On the ordinary "nothing merged" answer the tip is
  // what a reader wants recorded, and there is no version whose bump could be looked for.
  if (!d.cut) return { ...d, sha, tip: sha };
  const bump = versionBumpCommit({ version: d.version, run, versionAt });
  if (!bump) {
    throw new Error(`release-await-cut: main carries ${d.version} but no commit in the last 100 could be `
      + "found that moved it there. The publish below checks out what this reports, and reporting the "
      + "branch tip instead would publish whatever else has landed since.");
  }
  return { ...d, sha: bump, tip: sha };
}

function main() {
  const out = process.env.GITHUB_OUTPUT;
  const started = Date.now();
  return awaitCut({
    waitMs: waitBudget(),
    // FETCH THE TAGS TOO. `cutDecision` answers "is there a tag for this version", and a checkout whose
    // tags never arrived answers "no tag" about every version there has ever been. That is the one wrong
    // answer this pipeline cannot afford, so it is refreshed on every pass rather than once at checkout.
    refresh: async () => { git(["fetch", "--no-tags", "--prune", "origin", "+refs/heads/main:refs/remotes/origin/main"]); git(["fetch", "--tags", "--force", "origin"]); },
    read: () => readMain(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now() - started,
  }).catch((e) => {
    // ── A FAILURE TO LOOK IS NOT "NOT MERGED YET" (tracker issue 208) ───────────────────────────────
    //
    // Giving up quietly is the ordinary outcome of this loop and stays exit 0: checks that went red, a
    // pull request somebody dismissed, a re-cut mid-flight. None of those is a release gone missing.
    //
    // A fetch that failed, a checkout with no tags, a git that is not there — those are a different
    // thing entirely, and reporting them as "nothing to publish" would hand the job below a verdict
    // this never reached. Exit 2 is the house meaning for could-not-look, and it is louder than the
    // quiet give-up on purpose: a wait that never looked must not read as a wait that found nothing.
    console.error(`::error::release-await-cut: could not read main to see whether the version merged `
      + `(${String(e?.message ?? e).slice(0, 200)}). This is a failure to LOOK, not a finding that `
      + "nothing was cut — nothing downstream may treat it as one.");
    process.exitCode = 2;
    if (out) appendFileSync(out, "cut=false\nversion=\nsha=\nlooked=false\n");
  }).then((r) => {
    if (!r) return;
    const secs = Math.round(r.waitedMs / 1000);
    if (r.cut) console.log(`release-await-cut: main carries ${r.version} with no tag, after ${secs}s. Publishing.`);
    else console.log(`release-await-cut: nothing to publish after ${secs}s — main carries ${r.version} and it is `
      + "already tagged, or the version branch did not merge. This is the ordinary outcome and not a fault; "
      + "the scheduled check is still underneath it.");
    // `looked` SEPARATES the two negatives above: a loop that ran and found nothing merged, from one
    // that could not read main at all. The publish job below requires `cut=true`, so neither publishes —
    // but a reader deciding whether a release went missing needs to know which of the two happened.
    // `sha` IS WRITTEN ON BOTH ANSWERS, not only on a cut. It records which commit this loop's verdict is
    // about, so a run that published nothing can still be read back against the tree it looked at.
    if (out) appendFileSync(out, `cut=${r.cut ? "true" : "false"}\nversion=${r.version}\nsha=${r.sha ?? ""}\nlooked=true\n`);
  });
}

if (isEntrypoint(import.meta.url)) await main();
