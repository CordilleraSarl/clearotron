// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A SIGNA KNOCKOUT OPENS ITS FILINGS FROM THE SEARCH IT ALREADY HOLDS (design, 2026-11-26: for the page only). Signa's
// search answer carries each trademark's whole record, but a Knockout never makes the separate record fetch, so its page
// opened no filing's record and drew no filing logo. The page now reads the run's saved search row for a listed filing
// that has no saved body, through Signa's own normaliser, marked as a search result. Nothing is written, so what the
// rater reads is unchanged, and no register is asked. Measured on a saved test Knockout of 2026-11-25: 0 of its listed
// filings opened a record before, 63 after, each carrying its own row's mark. Invented values only here.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordFromSearchRow } from "../../providers/signa/src/core.js";
import { filingRecordBodies } from "../publish/knockout.mjs";

const ID = "/mark/eu/tm_fixture000001";
const RAW = { object: "trademark", grain: "mark", id: "tm_fixture000001", mark_text: "QUELLMONT", office_code: "em", jurisdiction_code: "eu",
  application_number: "000000777", registration_number: "000000777", filing_date: "2021-03-02", nice_classes: [9],
  owners: [{ name: "Quellmont Labs", country_code: "DE" }], mark_feature_type: "WORD AND DESIGN", has_media: true };
const run = mkdtempSync(join(tmpdir(), "signa-search-row-"));
after(() => rmSync(run, { recursive: true, force: true }));
mkdirSync(join(run, "_driver")); mkdirSync(join(run, "register-units"));
writeFileSync(join(run, "register-units", "ko-quellmont-band.json"), JSON.stringify([{ qid: "q1", records: [{ record_id: ID, office: "eu", mark_text: "QUELLMONT", raw: RAW }] }]));

test("Signa's search row reads as the record its fetch would give, marked as a search result", () => {
  const rec = recordFromSearchRow({ record_id: ID, office: "eu", raw: RAW });
  assert.equal(rec._source, "search_row");
  assert.equal(rec.markText ?? rec.mark ?? null, "QUELLMONT");
  assert.equal(recordFromSearchRow({ record_id: ID }), null, "a row with no record in it gave one");
});

test("a Signa Knockout's listed filing with no saved body opens from its search row; another register's does not; nothing is written", () => {
  const signa = { provider: "signa", marks: [{ name: "QUELLMONT", records: [{ recordId: ID }] }] };
  const before = readdirSync(join(run, "_driver")).length;
  const bodies = filingRecordBodies(run, signa);
  assert.equal(bodies.size, 1, "the listed filing opened no record");
  assert.equal([...bodies.values()][0]._source, "search_row");
  assert.equal(filingRecordBodies(run, { ...signa, provider: "clarivate" }).size, 0, "another register's search row was read as a record");
  assert.equal(readdirSync(join(run, "_driver")).length, before, "the page wrote into the run, where the rater reads");
});
