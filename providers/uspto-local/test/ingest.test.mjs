// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ingest.test.mjs — USPTO bulk XML into rows, against the shapes the DTD actually produces.
//
// The fixtures below are written to the element names in "Trademark Applications DTD V 2.0". Two of
// these tests exist for defects that cannot announce themselves: an all-zero date read as a real
// date, and a record split across two read chunks disappearing without error. Both end as a search
// that returns fewer marks than exist, which is a clean negative nobody can see.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  parseCaseFile, decodeXml, usptoDate, markFeatureOf, drainCaseFiles, ingestStream,
} from "../src/ingest.js";
import { openIndex, createSchema, putRecords, rebuildFts, search, getRecord }
  from "../src/index-store.js";

const CASE_FILE = `
<case-file>
  <serial-number>86264144</serial-number>
  <registration-number>4712345</registration-number>
  <case-file-header>
    <filing-date>20140425</filing-date>
    <registration-date>20150331</registration-date>
    <status-code>800</status-code>
    <status-date>20250101</status-date>
    <mark-identification>ARBORA &amp; SONS</mark-identification>
    <mark-drawing-code>4000</mark-drawing-code>
    <renewal-date>20250331</renewal-date>
  </case-file-header>
  <case-file-statements>
    <case-file-statement><type-code>DM0000</type-code><text>The mark consists of stylised text.</text></case-file-statement>
    <case-file-statement><type-code>GS0091</type-code><text>Computer software for database management.</text></case-file-statement>
    <case-file-statement><type-code>GS0421</type-code><text>Consultancy services.</text></case-file-statement>
  </case-file-statements>
  <classifications>
    <classification>
      <international-code>009</international-code>
      <us-code>021</us-code>
      <status-code>6</status-code>
      <primary-code>009</primary-code>
    </classification>
    <classification>
      <international-code>042</international-code>
      <status-code>6</status-code>
    </classification>
  </classifications>
  <case-file-owners>
    <case-file-owner>
      <entry-number>1</entry-number>
      <party-type>30</party-type>
      <nationality><country>CH</country></nationality>
      <party-name>Arbora Holdings SA</party-name>
    </case-file-owner>
    <case-file-owner>
      <entry-number>2</entry-number>
      <party-name>Previous Owner Ltd</party-name>
    </case-file-owner>
  </case-file-owners>
</case-file>`;

test("a case file parses to the row the index stores", () => {
  const r = parseCaseFile(CASE_FILE);
  assert.equal(r.serial, "86264144");
  assert.equal(r.regno, "4712345");
  assert.equal(r.text, "ARBORA & SONS", "XML entities are decoded, not stored raw");
  assert.equal(r.status, "800");
  assert.equal(r.status_class, "live", "800 is REGISTERED AND RENEWED");
  assert.equal(r.filed, "2014-04-25");
  assert.equal(r.regd, "2015-03-31");
  assert.equal(r.expiry, "2025-03-31");
  assert.equal(r.mark_feature, "word", "drawing code 4 = standard character mark");
  assert.deepEqual(r.classes, ["009", "042"]);
  assert.equal(r.owner, "Arbora Holdings SA", "the first owner is the current one");
  assert.equal(r.owner_country, "CH");
});

test("only goods-and-services statements become the G&S text", () => {
  // A disclaimer or a description of the mark is different data. Concatenated in, it would read as
  // part of the scope of protection and widen every class comparison built on it.
  const r = parseCaseFile(CASE_FILE);
  assert.match(r.gs, /Computer software for database management/);
  assert.match(r.gs, /Consultancy services/);
  assert.ok(!/stylised text/.test(r.gs), "a DM description statement is not goods and services");
});

test("the case-level status code is not confused with a classification's", () => {
  // <status-code> appears in case-file-header AND in every classification, meaning different
  // things. Reading the wrong one classifies a live registration by a one-digit class status.
  const r = parseCaseFile(CASE_FILE);
  assert.equal(r.status, "800", "not the classification's single-digit 6");
  assert.equal(r.status_class, "live");
});

test("an all-zero date is absent, not the year zero", () => {
  // The documentation is explicit: elements without the required date contain zeros. Stored as a
  // string it sorts before every real date and reads as the oldest filing in the register.
  assert.equal(usptoDate("00000000"), null);
  assert.equal(usptoDate("20140425"), "2014-04-25");
  assert.equal(usptoDate(""), null);
  assert.equal(usptoDate("2014"), null);
  assert.equal(usptoDate("20140000"), null, "a zeroed month/day is not a date either");

  const r = parseCaseFile(CASE_FILE.replace("<registration-date>20150331</registration-date>",
    "<registration-date>00000000</registration-date>"));
  assert.equal(r.regd, null);
});

test("a record with no serial number is refused rather than stored under null", () => {
  assert.equal(parseCaseFile("<case-file><case-file-header></case-file-header></case-file>"), null);
});

test("an unreadable mark-drawing-code is null, never guessed as a word mark", () => {
  assert.equal(markFeatureOf("4000"), "word");
  assert.equal(markFeatureOf("2000"), "design");
  assert.equal(markFeatureOf("3000"), "combined");
  assert.equal(markFeatureOf("0000"), null, "not yet assigned is not a feature");
  assert.equal(markFeatureOf(""), null);
  assert.equal(markFeatureOf("9"), null, "an unknown code must not be filtered as if it were known");
});

test("numeric and named XML entities both decode", () => {
  assert.equal(decodeXml("A &amp; B"), "A & B");
  assert.equal(decodeXml("&lt;tag&gt;"), "<tag>");
  assert.equal(decodeXml("&#39;quoted&#39;"), "'quoted'");
  assert.equal(decodeXml("&#x27;hex&#x27;"), "'hex'");
  assert.equal(decodeXml("plain"), "plain");
});

test("a record split across two read chunks is not lost", () => {
  // THE SILENT ONE. A straddling record dropped without error is a mark missing from the index, and
  // a mark missing from the index is a conflict the search will never report.
  const two = CASE_FILE + CASE_FILE.replace("86264144", "86264145");
  // Cut INSIDE the second record, not between them. Splitting at the midpoint of two equal records
  // lands on the boundary and nothing straddles — the test then passes with the tail discarded,
  // which is exactly the bug it is supposed to catch.
  const cut = two.indexOf("<mark-identification>", two.indexOf("86264145")) + 10;
  assert.ok(cut > two.indexOf("86264145"), "the cut must fall inside the second record");
  const first = drainCaseFiles(two.slice(0, cut));
  assert.equal(first.records.length, 1, "only the first record is complete before the cut");
  assert.ok(first.tail.startsWith("<case-file>"), "the straddling record is held in the tail");
  const second = drainCaseFiles(first.tail + two.slice(cut));
  const serials = [...first.records, ...second.records].map((r) => r.serial);
  assert.deepEqual(serials, ["86264144", "86264145"], "both records survive the chunk boundary");
});

test("ingestStream drains the final record at EOF", () => {
  // The last record ends exactly at end-of-file with no further chunk to trigger a drain.
  const chunks = ["<trademark-applications-daily>", CASE_FILE, "</trademark-applications-daily>"];
  return ingestStream(chunks, { onBatch: (rows) => {
    assert.equal(rows.length, 1);
    assert.equal(rows[0].serial, "86264144");
  } });
});

test("ingestStream batches and counts every record it parsed", async () => {
  const many = Array.from({ length: 50 }, (_, i) => CASE_FILE.replace("86264144", String(90000000 + i)));
  const seen = [];
  const total = await ingestStream(many, { onBatch: (rows) => { seen.push(rows.length); }, batchSize: 20 });
  assert.equal(total, 50);
  assert.deepEqual(seen, [20, 20, 10], "batches flush at the size, and the remainder still flushes");
});

test("parsed rows round-trip into the index and are searchable", async () => {
  const dir = mkdtempSync(join(tmpdir(), "uspto-ingest-"));
  const db = createSchema(openIndex(join(dir, "us.db")));
  try {
    await ingestStream([CASE_FILE], { onBatch: (rows) => { putRecords(db, rows); } });
    rebuildFts(db);
    const hits = search(db, { predicate: "wildcardPrefix", term: "ARBORA" });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].mark_text, "ARBORA & SONS", "an ampersand mark survives ingest and FTS");
    const rec = getRecord(db, "86264144");
    assert.equal(rec.statusClass, "live");
    assert.deepEqual(rec.niceClasses, ["9", "42"], "USPTO 009/042 canonicalise to the bare numbers the plan speaks");
    assert.match(rec.goodsAndServices, /Computer software/);
  } finally { try { db.close(); rmSync(dir, { recursive: true, force: true }); } catch {} }
});
