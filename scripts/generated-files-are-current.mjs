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
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

/** Every minter in `scripts/`, by filename, ordered. */
export function minters(dir = HERE) {
  return readdirSync(dir).filter((f) => f.startsWith("mint-") && f.endsWith(".mjs")).sort();
}

/**
 * Run every minter's `--check` and sort the answers.
 *
 * `dir` and `root` are parameters so the arms can drive all three outcomes over throwaway minters.
 * The alternative — dirtying a real generated file and restoring it — is a shared-file mutation, and
 * the test runner runs files in parallel, so it would be a race that reddens somebody else's arm.
 */
export function checkAll({ dir = HERE, root = ROOT, log = console.log } = {}) {
  const found = minters(dir);
  if (!found.length) return { found, stale: [], unreadable: [], empty: true };

  const stale = [];
  const unreadable = [];
  for (const m of found) {
    const r = spawnSync(process.execPath, [join(dir, m), "--check"], { cwd: root, encoding: "utf8" });
    const out = ((r.stdout || "") + (r.stderr || "")).trim();
    // 0 is current, 1 is stale, anything else is a minter that could not look — reported separately,
    // because "I could not read the tree" and "the file is out of date" need different things done.
    if (r.status === 0) { log(`  current  ${m}`); continue; }
    if (r.status === 1) { stale.push({ m, out }); log(`  STALE    ${m}`); continue; }
    unreadable.push({ m, out, code: r.status });
    log(`  ?        ${m} (exit ${r.status})`);
  }
  return { found, stale, unreadable, empty: false };
}

function main() {
  const { found, stale, unreadable, empty } = checkAll();
  if (empty) {
    console.error("generated-files-are-current: no scripts/mint-*.mjs found. Either they moved or the "
      + "naming changed — and a pass over nothing is not a pass.");
    process.exit(2);
  }
  console.log(`\ngenerated-files-are-current: checked ${found.length} minter(s)`);

  for (const { m, out } of [...stale, ...unreadable]) {
    console.error(`\n──── ${m} ────\n${out}`);
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
