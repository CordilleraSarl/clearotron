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
    // FETCH THE TAGS TOO. `cutDecision` answers "is there a tag for this version", and a checkout whose
    // tags never arrived answers "no tag" about every version there has ever been. That is the one wrong
    // answer this pipeline cannot afford, so it is refreshed on every pass rather than once at checkout.
    refresh: async () => { git(["fetch", "--no-tags", "--prune", "origin", "+refs/heads/main:refs/remotes/origin/main"]); git(["fetch", "--tags", "--force", "origin"]); },
    read: () => cutDecision({ version: versionAtHead({ ref: "origin/main" }), tags: tagsHere() }),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now() - started,
  }).then((r) => {
    const secs = Math.round(r.waitedMs / 1000);
    if (r.cut) console.log(`release-await-cut: main carries ${r.version} with no tag, after ${secs}s. Publishing.`);
    else console.log(`release-await-cut: nothing to publish after ${secs}s — main carries ${r.version} and it is `
      + "already tagged, or the version branch did not merge. This is the ordinary outcome and not a fault; "
      + "the scheduled check is still underneath it.");
    if (out) appendFileSync(out, `cut=${r.cut ? "true" : "false"}\nversion=${r.version}\n`);
  });
}

if (isEntrypoint(import.meta.url)) await main();
