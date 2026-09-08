#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// EVERY GENERATED FILE IN THIS TREE IS CURRENT, or this says which one is not.
//
//   node scripts/generated-files-are-current.mjs
//
// ── WHY THIS EXISTS, AND WHY IT DISCOVERS ITS OWN POPULATION ─────────────────────────────────────
//
// Each `scripts/mint-*.mjs` writes a file that is committed and derived, and each takes `--check` to
// say whether the committed copy still matches the tree. Until now CI ran exactly one of them. The
// other three could go stale on `main` and nothing here would say so — the failure surfaced instead
// in a private control that refuses to start on a stale fixture, which is the most expensive place
// to learn it and the furthest from whoever caused it.
//
// So this enumerates `scripts/mint-*.mjs` rather than naming them. A list would have to be extended
// by whoever adds the fifth minter, and the whole reason the fourth went unchecked is that nobody
// extended anything. A discovered population is covered by construction.
//
// AN EMPTY POPULATION IS A FAULT, NOT A PASS. If the glob matches nothing, this file has been moved
// or the naming convention has changed, and reporting "all current" over zero checks is exactly the
// shape of green this guard exists to refuse.
import { readdirSync } from "node:fs";
import { spawnSync, execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

/** Every minter in `scripts/`, by filename, ordered. */
export function minters(dir = HERE) {
  return readdirSync(dir).filter((f) => f.startsWith("mint-") && f.endsWith(".mjs")).sort();
}

/**
 * What the working tree looks like, so a minter that WROTE during `--check` can be caught writing.
 *
 * Returns null when the tree cannot be read — outside a checkout, say — and a null is carried as a
 * stated limit rather than as a pass: the contract simply goes unchecked and the run says so.
 */
export function treeState(root = ROOT) {
  try {
    return execFileSync("git", ["-C", root, "status", "--porcelain"], { encoding: "utf8", maxBuffer: 1 << 28 });
  } catch { return null; }
}

/**
 * Run every minter's `--check` and sort the answers.
 *
 * `dir` and `root` are parameters so the arms can drive all three outcomes over throwaway minters.
 * The alternative — dirtying a real generated file and restoring it — is a shared-file mutation, and
 * the test runner runs files in parallel, so it would be a race that reddens somebody else's arm.
 */
export function checkAll({ dir = HERE, root = ROOT, log = console.log, readTree = () => treeState(root) } = {}) {
  const found = minters(dir);
  if (!found.length) return { found, stale: [], unreadable: [], wrote: [], empty: true };

  const stale = [];
  const unreadable = [];
  const wrote = [];
  for (const m of found) {
    // ── `--check` IS A CONTRACT, AND NOTHING WAS VERIFYING IT ──────────────────────────────────────
    //
    // Every minter here is trusted to treat `--check` as "report, change nothing". A minter that
    // ignores the flag and re-mints repairs the drift and then reports `current` — so the file is
    // quietly fixed on whoever's machine ran it, the commit does not carry the repair, and this guard
    // logs a clean line over a check that never happened. That is this file's own sentence one level
    // in: a pass from a minter that did not look is not a pass either.
    //
    // The probe is the contract stated directly. `--check` must not write, so if the tree moved while
    // one ran, it wrote. THE LIMIT, SAID RATHER THAN LEFT: this catches the harmful inert form, the
    // one that silently repairs. A minter that ignores the flag and does nothing at all still reports
    // `current`, and no probe from out here can tell that from a file that really is current.
    const before = readTree();
    const r = spawnSync(process.execPath, [join(dir, m), "--check"], { cwd: root, encoding: "utf8" });
    const after = readTree();
    const out = ((r.stdout || "") + (r.stderr || "")).trim();
    if (before !== null && after !== null && before !== after) {
      wrote.push({ m, out });
      log(`  WROTE    ${m} (during --check)`);
      continue;
    }
    // 0 is current, 1 is stale, anything else is a minter that could not look — reported separately,
    // because "I could not read the tree" and "the file is out of date" need different things done.
    if (r.status === 0) { log(`  current  ${m}`); continue; }
    if (r.status === 1) { stale.push({ m, out }); log(`  STALE    ${m}`); continue; }
    unreadable.push({ m, out, code: r.status });
    log(`  ?        ${m} (exit ${r.status})`);
  }
  return { found, stale, unreadable, wrote, empty: false, contractChecked: readTree() !== null };
}

function main() {
  const { found, stale, unreadable, wrote, empty, contractChecked } = checkAll();
  if (empty) {
    console.error("generated-files-are-current: no scripts/mint-*.mjs found. Either they moved or the "
      + "naming changed — and a pass over nothing is not a pass.");
    process.exit(2);
  }
  console.log(`\ngenerated-files-are-current: checked ${found.length} minter(s)`
    + (contractChecked ? "" : "; the tree could not be read, so nothing verified that `--check` changed nothing"));

  for (const { m, out } of [...wrote, ...stale, ...unreadable]) {
    console.error(`\n──── ${m} ────\n${out}`);
  }
  if (wrote.length) {
    console.error(`\n${wrote.length} minter(s) CHANGED THE TREE while running \`--check\`. \`--check\` `
      + `reports and changes nothing; one that re-mints repairs the drift on whoever ran it, leaves the `
      + `commit without the repair, and reports current over a check that did not happen. Fix the minter.`);
    process.exit(2);
  }
  if (unreadable.length) {
    console.error(`\n${unreadable.length} minter(s) could not look. That is not a pass; fix the minter first.`);
    process.exit(2);
  }
  if (stale.length) {
    console.error(`\n${stale.length} generated file(s) are out of date. Re-mint each one named above and `
      + `commit the result — a derived file that drifts is a check reporting on a tree that no longer exists.`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
