// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// repo-writes.mjs — what changed under the checkout while a test run was in flight.
//
// ── why this exists ─────────────────────────────────────────────────────────────────────────────────
//
// Tracker issue 198. `health-tells-the-truth-about-the-bundle` planted a future mtime on a REAL file in
// `portal-ui/src` to prove the staleness check fires, restored it afterwards, and went green. But
// `node --test` runs test FILES concurrently against one shared working tree, so for the seconds that
// plant was live, any other arm reading that path saw a tree from the future. The suite cannot
// attribute the red that produces: it surfaces in a file whose diff is empty, on another branch, in
// another agent's session, and it is intermittent — the three properties that make a defect expensive.
//
// `doctor-refuses-what-cannot-run.test.mjs:70` already states the rule in prose: moving the real
// `portal-ui/dist` aside "would have been shorter and is wrong". Prose is not an instrument. This is.
//
// THE RULE IS ABSOLUTE, AND IT IS NOT A QUESTION ABOUT `git`. Tracked, untracked and ignored are the
// same checkout to a concurrent reader. `product-identity.test.mjs:70` records what the IGNORED case
// costs: a developer who had packed the tree watched a correct arm fail for a file absent from their
// diff, and the tempting repair was to weaken the assertion to match the polluted checkout.
//
// It lives beside `test-run.mjs` rather than inside it because `test-run.mjs` spawns a child at import
// — there is no way to `import` it in an arm without running a test suite — and a guard nobody can
// drive is the shape this repository keeps finding.
import { readdirSync, lstatSync } from "node:fs";
import { join, resolve, sep } from "node:path";

/**
 * Directory names never walked, at any depth.
 *
 *   node_modules   an install is not a test write, and it is the bulk of the file count
 *   .git           a read-only `git` command still touches the index, and `git` is how several arms
 *                  build their fixtures; the subject here is the SOURCE tree, and nothing a test did
 *                  to `.git` could hide from it anyway
 */
export const NEVER_WALK = Object.freeze(new Set(["node_modules", ".git"]));

/**
 * Build outputs a run may move, relative to the checkout root.
 *
 * EMPTY BY MEASUREMENT, not by omission. A full green suite — 7,917 tests, 2026-09-06 — moved exactly
 * two paths under the root: `portal-audit.log` (the portal service defaulting its audit log to the
 * checkout) and `build-info.json` (`npm pack`, including `--dry-run`, running this repository's
 * `prepack`). Both were defects and both were fixed rather than exempted, which is why nothing is
 * listed here. An entry added to this array needs a measurement saying why, never a convenience.
 */
export const ALLOWED_TO_MOVE = Object.freeze([]);

/**
 * Every path under `root`, with the identity that changes when something writes to it.
 *
 * @returns {Map<string, string>} absolute path → a stamp that differs when the path has been written
 */
export function snapshotRepo(root, { allowed = ALLOWED_TO_MOVE, neverWalk = NEVER_WALK } = {}) {
  const base = resolve(root);
  const exempt = allowed.map((a) => resolve(base, a));
  const out = new Map();
  const walk = (dir) => {
    let entries;
    // A DIRECTORY THAT CANNOT BE READ IS RECORDED, NEVER SKIPPED. Skipping it would make a run that
    // removed read permission from a directory look identical to one that did nothing at all.
    try { entries = readdirSync(dir, { withFileTypes: true }); }
    catch { out.set(dir, "UNREADABLE"); return; }
    for (const e of entries) {
      if (neverWalk.has(e.name)) continue;
      const p = join(dir, e.name);
      if (exempt.some((a) => p === a || p.startsWith(a + sep))) continue;
      if (e.isDirectory()) { out.set(p, "dir"); walk(p); continue; }
      // `lstat`, never `stat`: a symlink's own identity is part of what is being watched, and following
      // one can leave the checkout entirely — the farm `test-run.mjs` builds is made of them.
      try {
        const s = lstatSync(p);
        out.set(p, `${e.isSymbolicLink() ? "link" : "file"}:${s.mtimeMs}:${s.size}`);
      } catch { out.set(p, "UNREADABLE"); }
    }
  };
  walk(base);
  return out;
}

/**
 * The paths that moved between two snapshots, each named relative to the checkout.
 *
 * Sorted, so a run's report is stable and two runs can be compared by eye.
 */
export function repoWrites(before, after, root) {
  const base = resolve(root);
  const rel = (p) => (p.startsWith(base + sep) ? p.slice(base.length + 1) : p);
  const rows = [];
  for (const [p, v] of after) {
    if (!before.has(p)) rows.push(`  + ${rel(p)}  — created by the run`);
    else if (before.get(p) !== v) rows.push(`  ~ ${rel(p)}  — changed by the run`);
  }
  for (const p of before.keys()) if (!after.has(p)) rows.push(`  - ${rel(p)}  — removed by the run`);
  return rows.sort();
}

/** What a reader is told when a run wrote inside the checkout. */
export function explainRepoWrites(rows) {
  return [
    "",
    "[test-run] THIS RUN WROTE INSIDE THE CHECKOUT, which no test may do:",
    ...rows,
    "",
    "  Tests write to a temp dir — TMPDIR is set to this run's own root, and it is deleted when the run",
    "  ends. A path written here outlives the run and is READ BY OTHER TEST FILES, which node --test",
    "  runs concurrently against this one shared working tree. The red that produces lands somewhere",
    "  else: another arm, another branch, another agent's session, in a diff that never touched the",
    "  file. Point the code under test at a temp directory rather than at the checkout.",
    "",
    "  (Editing a file in this checkout while the run was in flight prints this too. Re-run without",
    "  touching the tree to tell the two apart.)",
  ];
}
