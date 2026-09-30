#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// Mints `driver/test/fixtures/reference-strip-backlog.json` — the per-file floor under the repair of
// the sentences the reference strip broke.
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
import { publishedOf, publishedReader } from "../shared/reference-guard-classes.mjs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SIGNATURES, censusOf } from "../driver/reference-strip-signatures.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TABLE = join(ROOT, "driver/test/fixtures/reference-strip-backlog.json");

// THE PUBLISHED POPULATION, NOT THE INDEX. `git ls-files` reads the index, and an overlay run stages
// the withheld corpus over a clone without committing it — so minting there wrote withheld hits into
// this public table with nothing reporting it. `publishedOf` filters the tracked list down to what
// HEAD carries; one helper, shared with the residue floor, because two spellings of this rule would
// disagree under the overlay and `--check` would report a difference that is only the two
// instruments asking different questions.
const all = execFileSync("git", ["-C", ROOT, "ls-files"], { encoding: "utf8", maxBuffer: 1 << 28 })
  .split("\n").filter(Boolean);
const p = publishedOf(all, ROOT);
if (p.error) { console.error(`mint-reference-strip-backlog: ${p.error}`); process.exit(2); }
if (p.laid) console.log(`mint-reference-strip-backlog: ${p.laid} tracked path(s) are not in HEAD — laid over this checkout, not published in it, and not counted`);
const tracked = p.files;
const minted = censusOf(ROOT, tracked, publishedReader(ROOT, (f) => readFileSync(join(ROOT, f), "utf8")));

// ── EVERY ROW IS EXPLAINED, OR THE TABLE IS A NUMBER NOBODY CAN ACT ON ────────────────────────────
//
// A count on its own tells a reader a file has residue in it. It does not tell them whether the line is
// residue at all — and once the table reached zero, the next row to appear is either a regression to
// repair or a known-good the scanner cannot tell from one. The first `.js` row is the second kind: an
// adapter header names a list separator as `(, ; / etc)`, which matches the third signature and is also
// correct English about punctuation. Without a sentence beside it that row is a number that will never
// fall, and a floor with one of those in it stops being read.
//
// So notes are carried by the minter rather than typed into the artifact: a re-mint keeps the note for a
// file that still has rows, drops it for a file that no longer does (a repair takes its explanation with
// it), and says which rows are still unexplained. It never invents one — an unexplained row is reported,
// and the arm that reads this table refuses it.
const NOTES = {
  "providers/clarivate/src/core.js":
    "NOT residue — the header names a list separator as `(, ; / etc)`. It matches the third signature "
    + "and is correct English about punctuation, so it is recorded rather than repaired.",
};
const notesFor = (files) => Object.fromEntries(
  Object.keys(files).filter((f) => NOTES[f]).map((f) => [f, NOTES[f]]).sort(([a], [b]) => a < b ? -1 : 1));
const unexplained = (files) => Object.keys(files).filter((f) => !NOTES[f]).sort();

if (process.argv.includes("--check")) {
  const have = JSON.parse(readFileSync(TABLE, "utf8"));
  const a = JSON.stringify(have.files), b = JSON.stringify(minted.files);
  if (JSON.stringify(have.notes ?? {}) !== JSON.stringify(notesFor(minted.files))) {
    console.error("reference-strip backlog: the committed notes do not match this tree's rows.");
    console.error("  re-mint with: node scripts/mint-reference-strip-backlog.mjs");
    process.exit(1);
  }
  if (a !== b || have.total !== minted.total) {
    console.error("reference-strip backlog is STALE against the tree.");
    console.error(`  committed total ${have.total}, tree has ${minted.total}`);
    console.error("  re-mint with: node scripts/mint-reference-strip-backlog.mjs");
    process.exit(1);
  }
  const open = unexplained(minted.files);
  const held = Object.keys(minted.files).length - open.length;
  console.log(`reference-strip backlog: current — ${minted.total} matching line(s); `
    + `${open.length} file(s) to repair, ${held} recorded as not residue`);
} else {
  writeFileSync(TABLE, JSON.stringify({ signatures: SIGNATURES.map((s) => s.name), ...minted,
    notes: notesFor(minted.files) }, null, 2) + "\n");
  console.log(`minted ${TABLE}: ${minted.total} line(s) across ${Object.keys(minted.files).length} file(s)`);
  const open = unexplained(minted.files);
  if (open.length) console.log(`mint-reference-strip-backlog: ${open.length} file(s) carry rows with no note — `
    + `each is a line to repair, or a note to add here if it is not residue:\n  ${open.join("\n  ")}`);
}
