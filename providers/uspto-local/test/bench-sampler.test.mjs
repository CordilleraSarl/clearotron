// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — THE BENCHMARK'S SAMPLER, WHICH COST THE FIRST REAL MEASUREMENT WINDOW.
//
// `sampleMarks` draws the terms every probe is built from. The obvious spelling is
//
//     SELECT text, owner FROM mark LIMIT 1 OFFSET ?
//
// and it is what shipped first. SQLite cannot jump to a row by ordinal, so `OFFSET n` VISITS n rows
// and discards them. Eight hundred samples spread across a 12M-row register is roughly five billion
// row visits — the sampler alone runs longer than the benchmark it exists to set up. That is not a
// projection: the first `--db` run against the real index sat for seventeen minutes having printed
// nothing at all, and was killed before it produced a single timing.
//
// It fails as a HANG, which is the reason it is worth a test. A wrong number is argued with; a
// benchmark that never finishes is read as "the index must be slow" — and the index was not the
// subject of that run.
//
// `WHERE rowid >= ?` is an index seek: same rows, same determinism, milliseconds. `>=` and not `=`
// because rowids have gaps — a serial replaced by a later ingest, a backfile part that parsed to zero
// records — and `=` on a missing rowid returns nothing, silently shrinking the sample until the wide
// OR-stacks are SKIPPED for want of terms.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { sampleMarks } from "../bench/bench.mjs";
import { openIndex, createSchema, putRecords, rebuildFts } from "../src/index-store.js";

const withIndex = (rows, fn) => {
  const dir = mkdtempSync(join(tmpdir(), "bench-sampler-"));
  try {
    const db = openIndex(join(dir, "i.sqlite"), { create: true });
    createSchema(db);
    db.exec("BEGIN"); putRecords(db, rows); db.exec("COMMIT");
    rebuildFts(db);
    try { return fn(db); } finally { db.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
};

const row = (i) => ({
  serial: `7${String(i).padStart(7, "0")}`, text: `MARKTEXT${i}`, owner: `OWNER COMPANY ${i}`,
  status: "700", classes: ["9"], regno: null, owner_country: "US", filed: null, regd: null,
  expiry: null, gs: null,
});

test("it samples across the WHOLE table, not just the head", () => {
  // A sampler that returns the first N rows measures one ingest batch. The backfile loads oldest
  // first, so that would be 1884 marks only — and an 1884 mark is not shaped like a 2025 one.
  withIndex(Array.from({ length: 1000 }, (_, i) => row(i)), (db) => {
    const { total, marks } = sampleMarks(db, 20);
    assert.equal(total, 1000);
    assert.equal(marks.length, 20);
    const nums = marks.map((m) => Number(m.replace("MARKTEXT", "")));
    assert.ok(Math.max(...nums) > 700, `the sample must reach the far end, got max ${Math.max(...nums)}`);
    assert.ok(Math.min(...nums) < 300, `and the near end, got min ${Math.min(...nums)}`);
  });
});

test("GAPS IN THE ROWIDS do not shrink the sample", () => {
  // The case `rowid = ?` gets wrong. A real index has gaps: `INSERT OR REPLACE` on a serial the
  // backfile and a daily both carry, and parts that ingest zero records. A shrinking sample is not an
  // error — it surfaces as wide OR-widths being SKIPPED for want of distinct terms, which reads as a
  // harness limitation rather than a bug.
  withIndex(Array.from({ length: 200 }, (_, i) => row(i)), (db) => {
    db.exec("DELETE FROM mark WHERE rowid % 3 != 0");     // two rows in three gone; rowids now sparse
    rebuildFts(db);
    const { total, marks } = sampleMarks(db, 20);
    assert.ok(total < 100, "the premise: most rows are gone and the rowids are sparse");
    assert.equal(marks.length, 20, "every request still lands on a row — `>=`, not `=`");
  });
});

test("it is deterministic — two runs on the same index give the same terms", () => {
  // The property the numbers this harness replaces did not have. Any clock- or random-seeded sampling
  // makes two runs incomparable, which is most of what made the old tables unreproducible.
  withIndex(Array.from({ length: 500 }, (_, i) => row(i)), (db) => {
    assert.deepEqual(sampleMarks(db, 30).marks, sampleMarks(db, 30).marks);
  });
});

test("an empty index reports zero rather than inventing terms", () => {
  withIndex([], (db) => {
    const { total, marks } = sampleMarks(db, 20);
    assert.equal(total, 0);
    assert.deepEqual(marks, []);
  });
});

test("the sampler does not page by OFFSET — the property is PERFORMANCE, which no assertion can time", () => {
  // Asserted on the source, because the failure is a hang at a scale no test may build: reproducing it
  // needs a 12M-row table, and a test that takes seventeen minutes to fail is a test that gets deleted.
  // The tests above pin what the sampler RETURNS and would pass under the slow spelling; this one pins
  // the spelling itself, which is the whole defect.
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "bench", "bench.mjs"), "utf8");
  const whole = src.slice(src.indexOf("export function sampleMarks"), src.indexOf("export function distinctStems"));
  assert.ok(whole.length > 0, "sampleMarks not found — this census is measuring nothing");
  // COMMENTS STRIPPED. The first cut of this test failed on the function's own doc block, which quotes
  // the bad spelling in order to explain why it is gone — a census that fires on the documentation for
  // the fix is a census the next reader deletes. Only code that RUNS an OFFSET is a finding.
  const fn = whole.replace(/\/\*[\s\S]*?\*\//g, " ").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  assert.doesNotMatch(fn, /OFFSET/,
    "OFFSET n visits n rows in SQLite. At register scale the sampler outruns the benchmark and the run "
    + "never prints a number — which reads as a slow index rather than a slow harness.");
  assert.match(fn, /rowid >= \?/, "the seek is what replaces it");
});
