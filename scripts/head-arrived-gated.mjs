#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// head-arrived-gated.mjs — did THIS commit arrive on main as a gated merge, or was it just pushed?
//
//   node scripts/head-arrived-gated.mjs <sha>     → prints gated | ungated | unknown
//                                                   exit 0 | 1 | 2
//
// ── WHY ──────────────────────────────────────────────────────────────────────────────────
//
// The test box deploys hourly from origin/main with `git merge-base --is-ancestor HEAD origin/main`
// and `git pull --ff-only`. Both ask the same question — has MY CLONE diverged — and neither asks how
// origin/main's tip got there.
//
// On 2026-08-18 a feature branch was pushed AS main: 10 non-markdown engine and provider files,
// ungated, including an enqueue schema and two provider capability contracts. `git merge-base
// --is-ancestor 4e644b7f 82ec0239` returned TRUE, because an accidental branch push CONTAINS main's
// line. It is a clean fast-forward. Both guards would have waved it straight onto the box, where
// every subsequent round's coverage claims would have been measured against an ungated contract. A
// manual timer stop is the only reason they did not.
//
// ── GREEN CI IS NOT THE EVIDENCE, AND THAT IS THE WHOLE DESIGN ───────────────────────────────────
//
// The issue offers "or at minimum carry green CI status for the exact SHA" as a weaker alternative.
// On THIS repo that alternative cannot detect the incident at all. `.github/workflows/ci.yml` is
//
//     on:
//       push:
//         branches: [main]
//       pull_request:
//
// so a bare push to main RUNS CI. The accidental head would have gone green on its own push and
// satisfied a CI-status check. A guard that passes the exact event it was written for is decoration,
// so CI status is reported as context and never as the verdict.
//
// The evidence that DOES separate them is the pull request: a squash merge records the resulting
// commit as that pull request's `merge_commit_sha`, and a bare push creates no such record. That is
// the question this asks, and the only one.
//
// ── AN UNANSWERABLE QUESTION IS NOT A PASS ───────────────────────────────────────────────────────
//
// `unknown` is its own verdict with its own exit code, because the two ways of not knowing — the API
// was unreachable, versus the API answered and said no pull request — must never collapse into one
// word. The caller decides what a deploy does with `unknown`; this script decides nothing. Same rule
// as the rest of the harness: it records, it does not judge.
//
// ── THE BOOTSTRAP TICK ───────────────────────────────────────────────────────────────────────────
//
// This file arrives WITH the commit that adds it, so on any older checkout it is simply absent. The
// deploy that calls it must treat "not in this checkout yet" the way it already treats
// queue-inflight.mjs and sync-e2e-store.mjs: say so plainly for that one tick and carry on. Absence
// of the script is not evidence about the head.

import { execFileSync } from "node:child_process";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";   //

export const VERDICT_EXIT = Object.freeze({ gated: 0, ungated: 1, unknown: 2 });

/**
 * The verdict for one commit, from the pull requests GitHub associates with it.
 *
 * PURE, and separated from the fetch on purpose: every branch below is reachable in a test with no
 * network, including the ones that matter most — a pull request that is merged but whose merge
 * commit is a DIFFERENT sha (the commit rode along in someone else's merge; it did not arrive as
 * one), and a pull request that is merely open.
 *
 * @param {string} sha            the commit being asked about
 * @param {Array|null} pulls      GitHub's `commits/{sha}/pulls` payload, or null if it could not be read
 * @returns {{verdict: "gated"|"ungated"|"unknown", detail: string, pr: number|null}}
 */
export const isShaLike = (sha) => /^[0-9a-f]{7,40}$/i.test(String(sha ?? "").trim());

export function headArrivedGated(sha, pulls) {
  const id = String(sha ?? "").trim();
  if (!isShaLike(id)) return { verdict: "unknown", detail: `not a commit sha: ${JSON.stringify(sha)}`, pr: null };
  if (pulls === null || pulls === undefined) return { verdict: "unknown", detail: "the pull requests for this commit could not be read", pr: null };
  if (!Array.isArray(pulls)) return { verdict: "unknown", detail: `unexpected payload shape: ${typeof pulls}`, pr: null };

  // MERGED, AND THIS SHA IS THE MERGE ITSELF. Both halves are load-bearing. A commit can be
  // associated with a merged pull request while being one of the commits it CARRIED — true of every
  // commit on every merged branch — and that says nothing about how the tip arrived.
  const merge = pulls.find((p) => p?.merged_at && sameSha(p?.merge_commit_sha, id));
  if (merge) return { verdict: "gated", detail: `arrived as the merge commit of PR #${merge.number}`, pr: merge.number ?? null };

  const merged = pulls.filter((p) => p?.merged_at);
  if (merged.length) {
    return { verdict: "ungated",
      detail: `this sha is associated with merged PR(s) ${merged.map((p) => `#${p.number}`).join(", ")} but is not the merge commit of any of them — `
        + "it rode in as branch content rather than arriving as a gated merge",
      pr: merged[0]?.number ?? null };
  }
  if (pulls.length) {
    return { verdict: "ungated",
      detail: `this sha has open/closed PR(s) ${pulls.map((p) => `#${p.number}`).join(", ")} and none of them merged it`,
      pr: pulls[0]?.number ?? null };
  }
  return { verdict: "ungated", detail: "no pull request produced this commit — it was pushed straight to the branch", pr: null };
}

/** Case-insensitive, and short-sha tolerant in ONE direction: a prefix of the full sha counts. */
function sameSha(full, asked) {
  const a = String(full ?? "").toLowerCase(), b = String(asked ?? "").toLowerCase();
  if (!a || !b) return false;
  return a === b || (b.length >= 7 && a.startsWith(b));
}

/** `repos/{owner}/{repo}/commits/{sha}/pulls`, or null when it cannot be read. Never throws. */
export function fetchPulls(sha, repo, run = ghJson) {
  try { return run(`repos/${repo}/commits/${sha}/pulls`); }
  catch { return null; }
}

/**
 * `owner/repo` for the checkout this runs in, from its own origin remote.
 *
 * DERIVED, NOT CONFIGURED, and deliberately not an environment variable: 's ratchet is right that
 * a new knob owes a documented row, and this one would document a fact the checkout already knows.
 * It also keeps the script honest in a fork — a published clone asks about ITS repository
 * rather than about ours.
 *
 * NO LONGER FALLS BACK TO A NAME. It used to return this project's own repository when there was no
 * remote, which was wrong in a fork — the API call then succeeds against somebody else's tree and the
 * verdict reads exactly like a real one — and was a private name in a shipping file besides. `null`
 * means COULD NOT TELL, and the caller turns that into the `unknown` verdict this script already has.
 */
// IMPORTED as well as re-exported. A bare `export … from` creates NO local binding, so the call below
// threw ReferenceError the moment this file ran as an entrypoint — the exact class this repo's no-undef
// lint exists for, in a directory the lint did not cover until now.
import { originRepo } from "../shared/origin-repo.mjs";
export { originRepo };

function ghJson(path) {
  const out = execFileSync("gh", ["api", "-H", "Accept: application/vnd.github+json", path],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return JSON.parse(out);
}

// ── the CLI ──────────────────────────────────────────────────────────────────────────────────────
// Guarded so the module can be imported by a test without running: a script whose only entry point
// exits on import cannot be tested, and the branches above are exactly the ones that must be.
// — DECIDING BY FILENAME IS THE SEVENTH SPELLING, and it is the one the
// entry-point census could not see: it compares argv[1] to a literal name and never mentions
// `import.meta.url`, which is half of that guard's population test. Measured — this file under any
// other name exited 0 with ZERO BYTES of output, and comparing basenames also answers TRUE for an
// unrelated script that happens to share the name. `isEntrypoint` realpaths both sides.
if (isEntrypoint(import.meta.url)) {
  const sha = process.argv[2];
  // COULD NOT TELL IS A VERDICT, NOT A DEFAULT. This used to fall back to a hardcoded repository, so a
  // checkout with no remote asked GitHub about somebody else's tree and printed a verdict about a commit
  // the caller never made. `unknown` already exists for exactly this and exits 2.
  const repo = originRepo();
  if (!repo) {
    console.log("unknown");
    console.error("[head-arrived-gated] cannot tell which repository this checkout belongs to — "
      + "`git remote get-url origin` gave nothing, and guessing would ask about the wrong tree.");
    process.exit(VERDICT_EXIT.unknown);
  }
  if (!sha) {
    console.error("usage: head-arrived-gated.mjs <sha>   (prints gated|ungated|unknown; exits 0|1|2)");
    process.exit(2);
  }
  // Shape first, so a typo does not spend an API call and bury this script's own answer under gh's
  // 422. The verdict is the same either way; what changes is whether the operator sees one message.
  const { verdict, detail } = headArrivedGated(sha, isShaLike(sha) ? fetchPulls(sha, repo) : undefined);
  console.log(verdict);
  console.error(`[head-arrived-gated] ${sha.slice(0, 8)}: ${detail}`);
  process.exit(VERDICT_EXIT[verdict]);
}
