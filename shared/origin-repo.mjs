// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// origin-repo.mjs — which GitHub repository is this checkout? Derived, never named.
//
// ── WHY THIS EXISTS, AND WHY THE ANSWER IS NEVER A CONSTANT ──────────────────────────────────────
//
// Three scripts each carried the same hardcoded default — `feedback-mint`, `head-arrived-gated` and
// `merge-presence-check` — and the string they carried was this project's own private repository. Two
// costs, and the second is the one that took a doc review to find:
//
//   1. In a FORK it is simply wrong. A published clone asking about its own head would have been told
//      about somebody else's repository, and the wrongness is silent: the API call succeeds, against
//      the wrong tree, and the verdict it returns is about a commit the caller never made.
//   2. It is a private name in a shipping file. A path that is harmless while a tree is private becomes
//      a leak the moment its audience changes, and this one sat in `const` declarations no strip may
//      ever touch — a transform that edits string literals is a transform that edits what code compares
//      against.
//
// ── AN ABSENCE IS A FINDING, WHICH IS WHY THIS RETURNS null RATHER THAN A GUESS ──────────────────
//
// The old fallback existed for a real reason: a checkout with no remote should report something rather
// than crash the deploy that called it. That reason survives; the value does not. `null` means COULD NOT
// TELL, and each caller says what that means for it — an `unknown` verdict, or a refusal naming the flag
// that fixes it. What none of them may do is proceed against a repository nobody chose, because a
// question answered about the wrong tree reads exactly like a question answered.
//
// DERIVED, NOT CONFIGURED — no environment variable. A new knob owes a documented row, and this one
// would document a fact the checkout already knows.

import { execFileSync } from "node:child_process";

function gitOrigin() {
  return execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }).trim();
}

/**
 * `owner/name` for this checkout's `origin`, or `null` when it cannot be determined.
 *
 * `run` is injected so the arms can drive every shape — ssh, https, a `.git` suffix, no remote, a throw —
 * without a repository per case.
 *
 * @param {() => string} run returns the origin URL
 * @returns {string|null} `owner/name`, or null for COULD NOT TELL
 */
export function originRepo(run = gitOrigin) {
  try {
    const m = /[:/]([^/:]+)\/([^/]+?)(?:\.git)?\s*$/.exec(String(run() ?? ""));
    if (m) return `${m[1]}/${m[2]}`;
  } catch { /* no remote, or not a git checkout — a null answer, not an exception */ }
  return null;
}

/**
 * The same answer, but for a caller that cannot continue without one. Refuses BY NAME, and names the
 * flag that fixes it — a refusal a reader cannot act on is a crash with better manners.
 */
export function originRepoOrRefuse(run = gitOrigin, flag = "--repo") {
  const repo = originRepo(run);
  if (repo) return repo;
  throw new Error(
    "cannot tell which repository this checkout belongs to: `git remote get-url origin` gave nothing. "
    + `Pass ${flag} <owner/name> explicitly. Guessing would ask the question against a repository `
    + "nobody chose, and an answer about the wrong tree reads exactly like an answer.");
}
