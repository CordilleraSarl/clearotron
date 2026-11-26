// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A KNOCKOUT'S FILING PREVIEW IS SHORT, AND THE WHOLE WORDING IS ONE READ AWAY (design, 2026-11-22 and 2026-11-26). The
// assessment reads the run's register filings whole on every rating group, so its preview of each goods statement is 300
// characters, not 1,200. A decision to carry a filing or set it aside on its goods reads the relevant wording whole: each
// cut statement's row names its own whole record, a filing set aside included, and where no whole record can be kept the
// row is not cut at all. Every mark, owner and id is invented.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { withFilingGoods, KNOCKOUT_PREVIEW_CHARS, GOODS_VIEW_CHARS, FILING_RECORDS_DIR } from "../filing-goods.mjs";
import { withHeldGoods } from "../knockout-register-read.mjs";

const TEMP = [];
const tempRun = () => { const d = mkdtempSync(join(tmpdir(), "ko-preview-")); TEMP.push(d); mkdirSync(driverDir(d), { recursive: true }); return d; };
after(() => { for (const d of TEMP) rmSync(d, { recursive: true, force: true }); });

const CARRIED = "/mark/eu/invented-carried", ASIDE = "/mark/eu/invented-aside";
const statement = (description, classes = [9]) => ({ classes, language: "en", description, translation: null, translation_language: null });
const logBodies = (run, rows) => writeFileSync(driverDir(run, "register-record-bodies.jsonl"),
  rows.map(([target, text]) => JSON.stringify({ ts: "2026-11-26T00:00:00.000Z", provider: "clarivate", target,
    body: { uri: target, markVerbalElementText: "BRAMBLECOVE", status: "Registered", goodsServices: [statement(text)] } })).join("\n") + "\n");
const readFull = (run, rec) => readFileSync(join(run, rec.fullRecord), "utf8");
// The decisive words start past character 300: what a reader of the preview alone would miss.
const decisive = (term) => `${"apparatus and instruments for recording, ".repeat(8).slice(0, KNOCKOUT_PREVIEW_CHARS - 5)} save ${term} for retail trade`;

test("the preview cuts at 300, and the decisive wording past it is in each row's own whole record, carried or set aside", () => {
  const run = tempRun();
  const carriedText = decisive("INVENTEDCARRIEDTERM"), asideText = decisive("INVENTEDASIDETERM");
  assert.ok(carriedText.indexOf("INVENTEDCARRIEDTERM") > KNOCKOUT_PREVIEW_CHARS, "premise: the term starts past the preview");
  logBodies(run, [[CARRIED, carriedText], [ASIDE, asideText]]);
  const doc = withHeldGoods({ schema: 1, marks: [{ name: "BRAMBLECOVE", records: [{ recordId: CARRIED, mark: "BRAMBLECOVE", goods: null }],
    setAsideRecords: [{ recordId: ASIDE, mark: "BRAMBLECOVE", goods: null }] }] }, run, { limit: KNOCKOUT_PREVIEW_CHARS });
  const [carried] = doc.marks[0].records, [aside] = doc.marks[0].setAsideRecords;
  for (const [rec, term, other] of [[carried, "INVENTEDCARRIEDTERM", "INVENTEDASIDETERM"], [aside, "INVENTEDASIDETERM", "INVENTEDCARRIEDTERM"]]) {
    assert.equal(rec.goodsShortened, true, `${rec.recordId}: the cut is not flagged`);
    assert.equal([...rec.goods[0]].length, "9: ".length + KNOCKOUT_PREVIEW_CHARS + 1, `${rec.recordId}: the preview is not 300 characters`);
    assert.ok(!rec.goods[0].includes(term), `${rec.recordId}: the preview carries wording past its length`);
    assert.ok(rec.fullRecord?.startsWith(`${FILING_RECORDS_DIR}/`), `${rec.recordId}: a cut row names no whole record`);
    const whole = readFull(run, rec);
    assert.ok(whole.includes(term), `${rec.recordId}: the decisive wording is not in the row's whole record`);
    assert.ok(!whole.includes(other), `${rec.recordId}: the row's whole record is another filing's`);
    assert.equal(rec.goodsState, "complete", "the run holds the text whole: the cut is the preview's, not the register's");
  }
});

test("a statement exactly 300 characters long is carried whole, and the default view elsewhere stays 1,200", () => {
  const run = tempRun();
  const exact = "x".repeat(KNOCKOUT_PREVIEW_CHARS);
  logBodies(run, [[CARRIED, exact]]);
  const rec = withFilingGoods({ marks: [{ records: [{ recordId: CARRIED }] }] }, run, { limit: KNOCKOUT_PREVIEW_CHARS }).marks[0].records[0];
  assert.equal(rec.goodsShortened, false);
  assert.equal(rec.goods[0], `9: ${exact}`);
  assert.equal(GOODS_VIEW_CHARS, 1200, "the general view's length moved with the Knockout preview");
});

test("where no whole record can be kept beside the preview, the row carries every statement whole and is not cut", () => {
  const run = tempRun();
  const text = decisive("INVENTEDKEPTTERM");
  logBodies(run, [[CARRIED, text]]);
  writeFileSync(join(run, FILING_RECORDS_DIR), "not a folder");   // the whole record cannot be written
  const rec = withFilingGoods({ marks: [{ records: [{ recordId: CARRIED }] }] }, run, { limit: KNOCKOUT_PREVIEW_CHARS }).marks[0].records[0];
  assert.equal(rec.fullRecord, null);
  assert.equal(rec.goodsShortened, false, "a row was cut with nothing to read the rest from");
  assert.equal(rec.goods[0], `9: ${text}`, "the wording the run holds is not all in the row");
});

test("a held record that cannot be read leaves the row the wording its search row carried, says what it rests on, and keeps it whole", () => {
  const run = tempRun();
  const text = decisive("INVENTEDROWTERM");
  // The held body for this filing is a line that does not read: only the search row's wording is left.
  writeFileSync(driverDir(run, "register-record-bodies.jsonl"), `{"target":"${CARRIED}","body":{"goodsServices":[\n`);
  const rec = withFilingGoods({ marks: [{ records: [{ recordId: CARRIED, goods: [{ classes: [9], text }] }] }] }, run,
    { limit: KNOCKOUT_PREVIEW_CHARS }).marks[0].records[0];
  // The uncertainty is the source, in the shipped evidence labels: what the row carries is the search answer's wording,
  // not the official record's.
  assert.equal(rec.goodsFrom, "search answer", "wording from the search row read as the official record");
  assert.equal(rec.goodsShortened, true);
  assert.ok(!rec.goods[0].includes("INVENTEDROWTERM"));
  const whole = JSON.parse(readFull(run, rec));
  assert.equal(whole.recordId, CARRIED, "the kept wording is another filing's");
  assert.ok(JSON.stringify(whole.goods).includes("INVENTEDROWTERM"), "the wording the run had is not kept whole");
});
