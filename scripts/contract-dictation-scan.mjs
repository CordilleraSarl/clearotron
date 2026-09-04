#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// contract-dictation-scan.mjs — E12's impure edge: build the served corpus, run the contracts over it.
//
// The checker (driver/contract-dictation.mjs) is pure and takes a corpus. This file is the only part
// that touches disk, and it exists so the planted-divergence test can hand the checker an invented
// file instead of writing one into the tree.
//
// THE CORPUS IS DISCOVERED, NEVER ENUMERATED, and that is 's hardest requirement rather than a
// preference: "plant a divergence in a NEW authoring layer — the check must find it structurally, not
// because the layer was enumerated." So the corpus is every tracked `.mjs` and `.md` under `driver/`,
// full stop. A new dispatch module, a new skill file, a seventh authoring surface nobody has thought
// of yet — all of them are already in scope on the commit that adds them.
//
// `git ls-files`, via shared/tracked-files.mjs, because a directory walk lists a different set (build
// output, an editor backup, a contributor's scratch file) and because a guard that cannot see its
// corpus must SAY SO rather than report a clean zero. 's lesson, and CLAUDE.md's hard rule: an
// absence is a finding.
//
//   node scripts/contract-dictation-scan.mjs           report; exit 1 on any divergence
//   node scripts/contract-dictation-scan.mjs --json     the same, as JSON

import "../shared/env-local.mjs";   // — FIRST: the CLEAROTRON_* translation must land before any
                                     // module-top capture below it evaluates. A call in this file's BODY
                                     // would run too late — that was the repair that left this open.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

import { trackedFiles } from "../shared/tracked-files.mjs";
import { dictationViolations, byContract, scopeOf } from "../driver/contract-dictation.mjs";
import { contracts, TOOL_ORDER_BACKLOG } from "../driver/contract-dictation-registry.mjs";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";   // — one entry-point test, all spellings

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const GUARD = "contract-dictation (E12)";

/**
 * The served corpus, or null when there is no checkout to read it from.
 * @returns {Array<{file:string, text:string}>|null}
 */
export function servedCorpus(root = ROOT) {
  const files = trackedFiles(GUARD, { root, pathspec: ["driver"] });
  if (files == null) return null;
  const out = [];
  for (const f of files) {
    if (!f.endsWith(".mjs") && !f.endsWith(".md")) continue;
    if (!scopeOf(f).in) continue;
    try { out.push({ file: f, text: readFileSync(join(root, f), "utf8") }); } catch { /* unreadable: reported by the corpus count */ }
  }
  return out;
}

/** @returns {{skipped:boolean, files:number, violations:Array<object>}} */
export function scan(root = ROOT) {
  const corpus = servedCorpus(root);
  if (corpus == null) return { skipped: true, files: 0, violations: [] };
  return { skipped: false, files: corpus.length, violations: dictationViolations(corpus, contracts()) };
}

function main() {
  const asJson = process.argv.includes("--json");
  const { skipped, files, violations } = scan();
  if (asJson) {
    console.log(JSON.stringify({ skipped, files, backlog: TOOL_ORDER_BACKLOG, violations }, null, 2));
    process.exit(violations.length ? 1 : 0);
  }
  if (skipped) {
    console.log("E12 did not run — no tracked corpus. This is a SKIP, not a pass.");
    process.exit(0);
  }
  console.log(`E12 · contract dictation — ${files} served file(s), ${violations.length} divergence(s)`);
  for (const [id, rows] of byContract(violations)) {
    console.log(`\n── ${id} · ${rows.length}`);
    for (const v of rows) console.log(`  ${v.file}:${v.line}\n    ${v.text.slice(0, 160)}\n    → ${v.why}`);
  }
  if (TOOL_ORDER_BACKLOG.length) {
    console.log(`\n── tool-order backlog · ${TOOL_ORDER_BACKLOG.length} known, excused, each with its closer`);
    for (const b of TOOL_ORDER_BACKLOG) console.log(`  ${b.stage} → ${b.tool}  (${b.site})\n    ${b.closes}`);
  }
  process.exit(violations.length ? 1 : 0);
}

if (isEntrypoint(import.meta.url)) main();
