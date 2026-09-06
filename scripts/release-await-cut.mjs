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
 * FIFTEEN, and the job's `timeout-minutes` is 30 to contain it — a budget smaller than its own longest
 * step cancels the job at the moment it was about to publish, and a cancelled run reads as neither a
 * success nor a failure to anybody scanning the list.
 */
export const WAIT_MS = 15 * 60 * 1000;

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

function main() {
  const out = process.env.GITHUB_OUTPUT;
  const started = Date.now();
  return awaitCut({
    waitMs: waitBudget(),
    // FETCH THE TAGS TOO. `cutDecision` answers "is there a tag for this version", and a checkout whose
    // tags never arrived answers "no tag" about every version there has ever been. That is the one wrong
    // answer this pipeline cannot afford, so it is refreshed on every pass rather than once at checkout.
    refresh: async () => { git(["fetch", "--no-tags", "--prune", "origin", "+refs/heads/main:refs/remotes/origin/main"]); git(["fetch", "--tags", "--force", "origin"]); },
    read: () => cutDecision({ version: versionAtHead({ ref: "origin/main" }), tags: tagsHere() }),
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
    if (out) appendFileSync(out, "cut=false\nversion=\nlooked=false\n");
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
    if (out) appendFileSync(out, `cut=${r.cut ? "true" : "false"}\nversion=${r.version}\nlooked=true\n`);
  });
}

if (isEntrypoint(import.meta.url)) await main();
