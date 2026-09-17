#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// RE-MINT THE WRITING-STANDARD BACKLOG — the per-file, per-class count that may only go down.
//
//   node scripts/mint-writing-standard-backlog.mjs            # report the delta, change nothing
//   node scripts/mint-writing-standard-backlog.mjs --check    # ... and exit 1 if the file is out of date
//   node scripts/mint-writing-standard-backlog.mjs --apply    # write it
//
// THE ONLY REASON TO RUN `--apply` IS THAT THE NUMBER WENT DOWN. Nothing here refuses to write a higher
// one — a table that could not record growth would be unable to describe a tree somebody widened a class
// over — but the floor arm refuses the growth itself, and it reads the committed file rather than this
// script's output. So an author who mints upward has recorded the regression rather than absorbed it.
// The two halves are deliberately not the same program.
//
// WHAT THE STANDING POPULATION ACTUALLY IS, so nobody reads the number as noise: nine of it is the
// knockout's scope block and the clearance renderer's coverage paragraph — the sentences the writing
// standard quotes as what not to write, still on the page. Two are a reviewer-only marker that reaches
// the delivered HTML. One is a screen whose only heading is the mark its run was ordered for. One is an
// environment name passed as an argument, which this check reads as printed text because a string
// literal is the only site it can see; that one is a false positive and is recorded rather than
// special-cased, because a special case for it would be a hole the size of every string argument.
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CLASSES, censusOf } from "../shared/writing-standard-classes.mjs";
import { publishedOf, publishedReader } from "../shared/reference-guard-classes.mjs";
import { trackedFiles, skipReason } from "../shared/tracked-files.mjs";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = join(ROOT, "driver/test/fixtures/writing-standard-backlog.json");
const GUARD = "writing-standard-backlog";

/** The tree's current census, as the fixture records it. */
export function mint() {
  const tracked = trackedFiles(GUARD, { root: ROOT });
  if (tracked === null) return null;
  // THE SAME POPULATION THE FLOOR READS, from the same helper. A mint over the index and a floor over
  // HEAD would disagree under the overlay, and `--check` would report a difference that is only the two
  // instruments asking different questions.
  const p = publishedOf(tracked, ROOT);
  if (p.error) { console.error(`mint-writing-standard-backlog: ${p.error}`); process.exit(2); }
  if (p.laid) console.log(`mint-writing-standard-backlog: ${p.laid} tracked path(s) are not in HEAD — laid over this checkout, not published in it, and not counted`);
  const c = censusOf(p.files, publishedReader(ROOT, (f) => readFileSync(join(ROOT, f), "utf8")));
  return { classes: CLASSES.map((x) => x.id), total: c.total, files: c.files };
}

/** Per-class totals, for a reader who wants to know WHICH number moved. */
export const byClass = (table) =>
  CLASSES.map((c, i) => [c.id, Object.values(table.files).reduce((a, v) => a + v[i], 0)]);

function main() {
  const apply = process.argv.includes("--apply");
  const check = process.argv.includes("--check");

  const now = mint();
  // A COULD-NOT-LOOK EXITS 2, never 0. Outside a checkout there is no corpus, and a mint that wrote an
  // empty table here would replace the whole backlog with nothing and call it a repair.
  if (now === null) { console.error(`mint-writing-standard-backlog: ${skipReason(GUARD)}`); process.exit(2); }

  console.log(`writing-standard residue: ${now.total} hit(s) across ${Object.keys(now.files).length} file(s)`);
  for (const [id, n] of byClass(now)) console.log(`  ${String(n).padStart(5)}  ${id}`);

  let was = null;
  try { was = JSON.parse(readFileSync(FIXTURE, "utf8")); } catch { /* first mint */ }

  const next = JSON.stringify(now, null, 2) + "\n";
  const same = was && JSON.stringify(was, null, 2) + "\n" === next;
  if (same) { console.log("the backlog is current"); return; }

  if (was) {
    const delta = now.total - was.total;
    console.log(`\ntotal ${was.total} → ${now.total} (${delta >= 0 ? "+" : ""}${delta})`);
  }
  if (apply) { writeFileSync(FIXTURE, next); console.log("written"); return; }
  console.log("\nre-run with --apply to write it");
  if (check) process.exit(1);
}

if (isEntrypoint(import.meta.url)) main();
