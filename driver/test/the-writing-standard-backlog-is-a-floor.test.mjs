// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// WHAT THE CUSTOMER SURFACES ALREADY CARRY, AND THE PROMISE THAT IT ONLY FALLS.
//
// `scripts/writing-standard-check.mjs` refuses these classes in a diff, so nothing new arrives. That
// alone does not hold the total: a diff guard reads only what a change ADDS, so a repaired sentence that
// comes back in a later edit is invisible to it, and so is a file moved from a tree the guard does not
// read into one it does. The backlog beside this file is the other half — a per-file, per-class count
// that may go down and may not go up.
//
// 13 HITS ACROSS 4 FILES WHEN THIS WAS MINTED, and the number is small enough to say what each one is:
// nine are the knockout's scope block and the clearance renderer's coverage paragraph, which are the
// sentences `docs/writing-standard.md` quotes as what not to write and which are still on the page; two
// are a reviewer-only marker that reaches the delivered HTML; one is a screen whose only heading is the
// mark its run was ordered for; one is an environment name passed as a function argument, which the
// check reads as printed text because a string literal is the only site it can see.
//
// WHY PER CLASS AND NOT ONE TOTAL. Under one total a file could lose a caveat and gain a marker and the
// floor would report it unchanged — the repair paying for the regression, silently. Per class that trade
// is two entries and both are visible.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CLASSES, censusOf } from "../../shared/writing-standard-classes.mjs";
import { publishedOf } from "../../shared/reference-guard-classes.mjs";
import { trackedFiles, skipReason } from "../../shared/tracked-files.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TABLE = JSON.parse(readFileSync(join(ROOT, "driver/test/fixtures/writing-standard-backlog.json"), "utf8"));
const GUARD = "writing-standard-backlog";

/** The live census over the PUBLISHED tree, or null when there is no checkout to read. */
function live() {
  const tracked = trackedFiles(GUARD, { root: ROOT });
  if (tracked === null) return null;
  const p = publishedOf(tracked, ROOT);
  if (p.error) return { error: p.error };
  return censusOf(p.files, (f) => readFileSync(join(ROOT, f), "utf8"));
}

test("the fixture describes the classes this tree actually has", () => {
  assert.deepEqual(TABLE.classes, CLASSES.map((c) => c.id),
    "the class list moved and the fixture was not re-minted — every column below means something else now");
  assert.equal(TABLE.total, Object.values(TABLE.files).flat().reduce((a, b) => a + b, 0),
    "the recorded total does not match the recorded rows");
});

test("THE BACKLOG IS A FLOOR — no file may carry more of any class than it did", () => {
  const now = live();
  // A COULD-NOT-LOOK IS NOT A PASS. Outside a checkout there is no corpus, and an empty census here
  // reads exactly like a repaired tree: every count zero, the floor satisfied.
  if (now === null) { assert.fail(`cannot read the corpus: ${skipReason(GUARD)}`); return; }
  if (now.error) { assert.fail(now.error); return; }

  // THE POPULATION FLOOR, FIRST. Everything below compares against `now`, and a census that read
  // nothing would satisfy every comparison.
  assert.ok(Object.keys(TABLE.files).length >= 3,
    "the committed backlog names fewer than three files — it is not this tree");
  assert.ok(now.total > 0,
    "the live census found nothing at all, which is the scanner failing rather than the tree being clean");

  const grew = [];
  for (const [path, counts] of Object.entries(now.files)) {
    const floor = TABLE.files[path];
    for (let i = 0; i < counts.length; i++) {
      const was = floor ? floor[i] : 0;
      if (counts[i] > was) grew.push(`${path}: ${CLASSES[i].id} ${was} → ${counts[i]}`);
    }
  }
  assert.deepEqual(grew, [],
    "a customer surface gained one of these — repair it, or re-mint with "
    + "`node scripts/mint-writing-standard-backlog.mjs --apply` if the number went DOWN");
});

test("A REPAIR IS RECORDED, not absorbed — the fixture must be re-minted when the count falls", (ctx) => {
  const now = live();
  // A BARE `return` HERE WOULD REPORT THIS ARM CLEAN HAVING MEASURED NOTHING — node:test counts it as a
  // pass. Where the bail means "I could not look", it has to say so.
  if (now === null) { ctx.skip(skipReason(GUARD)); return; }
  if (now.error) { ctx.skip(now.error); return; }
  const fell = [];
  for (const [path, floor] of Object.entries(TABLE.files)) {
    const counts = now.files[path] ?? CLASSES.map(() => 0);
    for (let i = 0; i < floor.length; i++) {
      if (counts[i] < floor[i]) fell.push(`${path}: ${CLASSES[i].id} ${floor[i]} → ${counts[i]}`);
    }
  }
  // NOT A FAILURE, A REPORT. A falling number is the point of the exercise; what would be wrong is
  // leaving the fixture stale, so this says exactly what to re-mint and why.
  assert.deepEqual(fell, [],
    "these were repaired and the backlog still records the old number — re-mint it with "
    + "`node scripts/mint-writing-standard-backlog.mjs --apply` so the floor drops with the tree");
});
