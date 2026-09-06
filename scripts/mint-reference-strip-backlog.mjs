#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// Mints `driver/test/fixtures/reference-strip-backlog.json` — the per-file floor under the repair of
// the sentences the reference strip broke (tracker issue 185).
//
// Run it AFTER repairing lines, never to make a red arm green: the arm it feeds refuses any count that
// went UP, so re-minting is how a repair is recorded, not how a regression is absorbed.
//
//     node scripts/mint-reference-strip-backlog.mjs [--check]
//
// `--check` re-derives and exits non-zero if the committed table disagrees with the tree, which is what
// CI runs. Without it, the table is rewritten.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SIGNATURES, censusOf } from "../driver/reference-strip-signatures.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TABLE = join(ROOT, "driver/test/fixtures/reference-strip-backlog.json");

const tracked = execFileSync("git", ["-C", ROOT, "ls-files"], { encoding: "utf8", maxBuffer: 1 << 28 })
  .split("\n").filter(Boolean);
const minted = censusOf(ROOT, tracked, (f) => readFileSync(join(ROOT, f), "utf8"));

if (process.argv.includes("--check")) {
  const have = JSON.parse(readFileSync(TABLE, "utf8"));
  const a = JSON.stringify(have.files), b = JSON.stringify(minted.files);
  if (a !== b || have.total !== minted.total) {
    console.error("reference-strip backlog is STALE against the tree.");
    console.error(`  committed total ${have.total}, tree has ${minted.total}`);
    console.error("  re-mint with: node scripts/mint-reference-strip-backlog.mjs");
    process.exit(1);
  }
  console.log(`reference-strip backlog: current — ${minted.total} line(s) still to repair`);
} else {
  writeFileSync(TABLE, JSON.stringify({ signatures: SIGNATURES.map((s) => s.name), ...minted }, null, 2) + "\n");
  console.log(`minted ${TABLE}: ${minted.total} line(s) across ${Object.keys(minted.files).length} file(s)`);
}
