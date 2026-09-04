// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// tracked-files.mjs — the tracked corpus, and what the guards that read it do when there is no
// checkout to read it from.
//
// ⛔ DERIVING A TEST SET THAT COVERS THIS CONVENTION. `test-tiers.test.mjs` refuses any test that spawns
// `git ls-files` instead of calling the helper below — and it is UNREACHABLE by the usual derivation,
// because it greps for the offending CALL SHAPE rather than calling `trackedFiles()` itself. A set
// derived with `grep -rln "trackedFiles(" driver/test` therefore does not contain the guard that
// polices `trackedFiles(`. Measured 2026-08-28: a 164-file derived set missed it and CI caught it.
//
//   grep -rln "trackedFiles(\|ls-files\|testFiles(" --include='*.test.mjs' driver/test
//
// Derive on the convention's RAW TOKENS as well as its helper, or the guard that enforces a rule stays
// outside every set derived from callers of that rule.
//
// Several checks in this repo assert over EVERY FILE THAT SHIPS: no client identifier anywhere in the
// tree, no operator identity and no citation of a withheld path, every environment variable read by
// code written down somewhere. They enumerate that corpus with `git ls-files`, which is the
// only listing that means "what is tracked" rather than "what happens to be sitting on disk".
//
// Outside a git checkout — a source zip, an extracted tarball, `npm pack` output — that call exits
// 128 and the guards used to fail 15 assertions reading `git ls-files failed: fatal: not a git
// repository`. Anyone who downloaded the sources rather than cloning them saw a suite that appeared
// badly broken, and the one thing those failures did not say is the one thing that was true: the
// guards could not see their corpus.
//
// ── WHY THIS SKIPS RATHER THAN WALKING THE DIRECTORY ─────────────────────────────────────────────
//
// A directory walk lists a different set: build output, a contributor's scratch file, an editor
// backup, anything .gitignore keeps out of the tree. These guards are believed precisely because
// they read what ships; one that quietly starts reading something else is worth less than one that
// says it could not run.
//
// ── WHY THIS SKIP IS NOT THE SILENT KIND ─────────────────────────────────────────────────────────
//
// Two things hold it, and both are needed:
//
//   1. Every skip prints `[repo-guard] SKIPPED <guard> — <reason>` and every successful enumeration
//      prints `[repo-guard] ok — <guard>: N tracked file(s)`. .github/workflows/ci.yml asserts BOTH
//      against the full-tier log: the SKIPPED line absent AND the ok line present. Asserting only the
//      absence would pass on an empty log, which is the same failure in a different coat — so a guard
//      that opts out, and a guard that stops running at all, are both red.
//
//   2. Nothing that CERTIFIES anything runs outside a checkout. Since  the artifact being
//      published IS a git repository — the public repo and its private twin share ancestry, and
//      scripts/publication-scan.mjs reads its history rather than a directory. A source zip is a
//      reader's copy; the checkout is the thing that gets signed off.
//
// The strings below are exported because ci.yml greps for them and driver/test/test-tiers.test.mjs
// asserts that the grep and these constants still say the same thing. A marker whose text drifts out
// of the workflow is an assertion that can never fire again.

import { spawnSync } from "node:child_process";

export const GUARD_OK_MARKER = "[repo-guard] ok";
export const GUARD_SKIPPED_MARKER = "[repo-guard] SKIPPED";

/** What a skipped guard tells the reader. Named once so every guard says the same thing. */
export const NO_CORPUS_REMEDY =
  "these checks read the tracked corpus with `git ls-files`; run them from a git checkout " +
  "(a downloaded source zip is not one)";

// STDERR, not stdout, and once per distinct line. `node --test` folds a test file's stderr into the
// TAP stream as a diagnostic, so CI still greps these out of the run log — while `node
// scripts/env-audit.mjs --json | jq` keeps a stdout with nothing in it but JSON.
const announced = new Set();
const say = (line) => { if (!announced.has(line)) { announced.add(line); console.error(line); } };

function reasonFrom(r) {
  if (r.error) return `git could not be run: ${r.error.message}`;
  const first = String(r.stderr || "").split("\n").find((l) => l.trim());
  return first ? first.trim() : `git exited ${r.status}`;
}

function run(root, args) {
  return spawnSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 1 << 26 });
}

/**
 * The tracked corpus, or null when this tree has no checkout to read it from.
 *
 * @param {string} guard  the guard's name, as it should read in the log and in a skip message
 * @param {{root: string, pathspec?: string[]}} opts
 * @returns {string[]|null} repo-relative paths, forward slashes — null means SKIP, loudly
 */
export function trackedFiles(guard, { root, pathspec = [] }) {
  const r = run(root, ["ls-files", ...pathspec]);
  if (r.status !== 0) {
    say(`${GUARD_SKIPPED_MARKER} ${guard} — ${reasonFrom(r)}; ${NO_CORPUS_REMEDY}`);
    return null;
  }
  const files = r.stdout.split("\n").filter(Boolean);
  say(`${GUARD_OK_MARKER} — ${guard}: ${files.length} tracked file(s)`);
  return files;
}

/**
 * `git grep -l` over tracked files, or null when there is no checkout.
 *
 * NO MATCHES IS NOT AN ERROR HERE and is not a skip either: git grep exits 1 having searched
 * everything, and an empty result is a finding the caller must be free to assert on.
 *
 * @returns {string[]|null} matching repo-relative paths — null means SKIP, loudly
 */
export function grepTrackedFiles(guard, { root, args }) {
  const r = run(root, ["grep", ...args]);
  if (r.status !== 0 && r.status !== 1) {
    say(`${GUARD_SKIPPED_MARKER} ${guard} — ${reasonFrom(r)}; ${NO_CORPUS_REMEDY}`);
    return null;
  }
  const files = r.stdout.split("\n").filter(Boolean);
  say(`${GUARD_OK_MARKER} — ${guard}: ${files.length} matching tracked file(s)`);
  return files;
}

/** The one-line reason a guard hands to `t.skip()`, so the TAP line says it too. */
export const skipReason = (guard) => `${guard}: not a git checkout — ${NO_CORPUS_REMEDY}`;
