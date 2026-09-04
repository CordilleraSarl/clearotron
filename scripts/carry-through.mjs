#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Carry-through for one preserved run, on its own.
//
//   node scripts/carry-through.mjs --run <runDir> [--json]
//
//. This exists as its own entry point rather than only inside `score.mjs` because that script
// dies when there is no gold set, and R0, R5 and R6 have none — they are precisely the runs where
// nothing else measures anything. The measure is built from the run's own corpus and needs no
// reference, so there is no reason for it to be unreachable there.

import { existsSync } from "node:fs";
import { renderCarryThrough, carryThrough, coverageConflicts } from "../driver/carry-through.mjs";

let runDir = null, asJson = false;
for (let i = 0, a = process.argv.slice(2); i < a.length; i++) {
  if (a[i] === "--run") runDir = a[++i];
  else if (a[i] === "--json") asJson = true;
  else { console.error(`unknown argument: ${a[i]}`); process.exit(2); }
}
if (!runDir) { console.error("usage: node scripts/carry-through.mjs --run <runDir> [--json]"); process.exit(2); }
if (!existsSync(runDir)) { console.error(`no such run directory: ${runDir}`); process.exit(2); }

if (asJson) {
  const r = carryThrough(runDir);
  console.log(JSON.stringify({ ...r, coverage: coverageConflicts(runDir, r.lost) }, null, 2));
} else {
  const { lines } = renderCarryThrough(runDir, { indent: "  " });
  console.log(`\n  run: ${runDir}\n`);
  console.log(lines.join("\n"));
  console.log();
}
// This tool RECORDS; it does not judge. Exit 0 means it ran, never that the run is clean.
