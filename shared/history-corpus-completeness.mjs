// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — CAN THIS CLONE PROVE IT HOLDS THE WHOLE HISTORY?
//
// `git rev-list --objects --all` does not fail on a clone that holds only part of the history. It
// answers about what is there, exits 0, and a reader with no other instrument cannot tell a complete
// answer from a partial one. Measured on this repository, same commit, one clone flag apart:
//
//     depth-1 clone   is-shallow-repository=true    rev-list --objects --all  →  1,876 objects
//     full clone      is-shallow-repository=false   rev-list --objects --all  →  7,295 objects
//
// 74% of the corpus absent, nothing said. For a de-identification sweep that is not a smaller scan, it
// is a clean bill of health over history nobody looked at — and the action it gates, flipping a
// repository public, cannot be undone.
//
// WHY A MODULE AND NOT A LINE IN THE CALLER. Two callers need this — the publication scan before the
// public cut, and merge-preflight before a merge-base verdict — and
// the pre-push hook already records what two copies of one rule cost here: "the path existed twice,
// in two languages, so the two callers armed identically only while somebody kept them in step by
// hand."
//
// WHAT THIS DOES NOT DO, stated because the obvious stronger version is not buildable. It does not
// verify the object count against a reference: a script standing inside a clone has no reference it
// did not derive from that same clone, so counting proves nothing about what is missing. What it can
// do is assert the PRECONDITIONS under which the enumeration is known complete, and let the caller
// state its completeness as conditional on them rather than as an unconditional property.
//
// SHORT HISTORY IS NOT SHALLOW HISTORY, and on this repository that distinction is load-bearing: the
// whole history is ~150 commits to a single root dated 2026-08-24, the ceremony cut. Anyone judging
// depth by eye would call a complete clone truncated. The flags decide, in both directions — never a
// count, never a look.

import { execFileSync } from "node:child_process";

/**
 * @param {string} repo  a git checkout
 * @returns {{complete: boolean, reasons: string[]}}
 *
 * `complete` is true only when every axis was READ and every axis said no. An axis that could not be
 * read leaves it false with the reason recorded: a question that could not be asked is not a no.
 */
export function historyCorpusCompleteness(repo) {
  const reasons = [];
  const git = (args) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

  // `git config --get-regexp` exits 1 when NOTHING MATCHES, which is the healthy case — so an empty
  // result and a broken call arrive as the same throw. Separated here, because reading "no partial
  // clone filter" out of a git that failed to run is the whole defect one level down.
  const configMatching = (pattern) => {
    try {
      return git(["config", "--get-regexp", pattern]).split("\n").filter(Boolean);
    } catch (e) {
      if (e.status === 1) return [];            // documented: no key matched
      throw e;
    }
  };

  try {
    if (git(["rev-parse", "--is-shallow-repository"]) === "true") {
      reasons.push("the clone is SHALLOW (.git/shallow present) — `rev-list --all` reaches only the "
        + "commits inside the shallow window. Remedy: git fetch --unshallow");
    }
  } catch (e) {
    reasons.push(`could not read --is-shallow-repository: ${e.message}`);
  }

  // A partial clone is NOT shallow and passes the check above (Beth's addendum on).
  // It holds every commit and omits blobs, fetching them from a promisor remote on demand — so the
  // enumeration is complete while the reads through it can fail or reach the network, neither of which
  // a sweep should be doing silently.
  try {
    for (const row of configMatching("^remote\\..*\\.partialclonefilter$")) {
      reasons.push(`a partial-clone filter is configured (${row}) — blobs are fetched on demand rather `
        + "than held, so a read can fail or go to the network mid-scan");
    }
    for (const row of configMatching("^remote\\..*\\.promisor$")) {
      if (/\btrue$/.test(row)) reasons.push(`a promisor remote is configured (${row}) — same exposure`);
    }
    for (const row of configMatching("^extensions\\.partialclone$")) {
      reasons.push(`the partialclone repository extension is set (${row})`);
    }
  } catch (e) {
    reasons.push(`could not read the partial-clone configuration: ${e.message}`);
  }

  return { complete: reasons.length === 0, reasons };
}

/**
 * The refusal text. Written for the operator running the pre-flip ceremony, who is most likely
 * standing in a checkout they did not make and will otherwise read this as a problem with the
 * repository rather than with their copy of it.
 */
export function completenessRefusal(caller, repo, reasons) {
  return `${caller}: COULD NOT LOOK — this clone cannot be shown to hold the whole history, so a scan `
    + `of it proves nothing about what is in the repository.\n`
    + reasons.map((r) => `    ✕ ${r}\n`).join("")
    + `    repository: ${repo}\n`
    + "    This is not a finding about the history. It is a refusal to report on a corpus that cannot "
    + "be shown to be complete.\n";
}
