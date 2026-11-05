// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A KNOCKOUT FILING CARRIES THE GOODS THE RUN HOLDS.
//
// The listing logs every record body it fetches, and the neutral record the assessment reads carried no goods, so a read
// of a filing could only call its wording missing. The record now carries a short view of them, says what they rest on in
// the full engine's own states, and points at the whole held record. Every mark, owner and id is invented.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { withFilingGoods, shortGoodsView, filingRecordName, FILING_RECORDS_DIR, GOODS_VIEW_CHARS } from "../filing-goods.mjs";
import { listRegisterRecords } from "../register-records.mjs";

const TEMP = [];
const tempRun = () => { const d = mkdtempSync(join(tmpdir(), "filing-goods-")); TEMP.push(d); mkdirSync(driverDir(d), { recursive: true }); return d; };
after(() => { for (const d of TEMP) rmSync(d, { recursive: true, force: true }); });

const ID = "/mark/us/invented1";
const statement = (description, classes = [9]) => ({ classes, language: "en", description, translation: null, translation_language: null });
const body = (goods, extra = {}) => ({ uri: ID, markVerbalElementText: "LANTERNWICK", status: "Registered", goodsServices: goods, ...extra });
const logBodies = (run, rows) => writeFileSync(driverDir(run, "register-record-bodies.jsonl"),
  rows.map(([target, b]) => JSON.stringify({ ts: "2026-11-05T00:00:00.000Z", provider: "clarivate", target, body: b })).join("\n") + "\n");
const docOf = (...records) => ({ schema: 1, marks: [{ name: "LANTERNWICK", records: records.map((r) => ({ recordId: ID, mark: "LANTERNWICK", goods: null, ...r })) }] });
const one = (run, rec = {}, opts = {}) => withFilingGoods(docOf(rec), run, opts).marks[0].records[0];
const readFull = (run, rec) => JSON.parse(readFileSync(join(run, rec.fullRecord), "utf8"));

test("the goods in the body the run holds reach the record, whole, with what they rest on and the record beside them", () => {
  const run = tempRun();
  logBodies(run, [[ID, body([statement("computer software for mapping"), statement("retail of maps", [35])])]]);
  const rec = one(run);
  assert.deepEqual(rec.goods, ["9: computer software for mapping", "35: retail of maps"]);
  assert.equal(rec.goodsState, "complete");
  assert.equal(rec.goodsFrom, "official record");
  assert.equal(rec.goodsShortened, false);
  assert.equal(rec.fullRecord, `${FILING_RECORDS_DIR}/us-invented1.json`);
  assert.equal(readFull(run, rec).goodsServices.length, 2, "the whole record is not on file");
});

test("a long statement is cut in the view and says so, and the whole of it is one read away", () => {
  const run = tempRun();
  const long = `${"mapping software and related goods, ".repeat(60)}the words at the end`;
  assert.ok(long.length > GOODS_VIEW_CHARS, "premise");
  logBodies(run, [[ID, body([statement(long), statement("retail of maps", [35])])]]);
  const rec = one(run);
  assert.equal(rec.goodsShortened, true);
  const [cut, whole] = rec.goods;
  assert.equal([...cut].length, "9: ".length + GOODS_VIEW_CHARS + 1, "the view is not the stated length");
  assert.ok(cut.endsWith("…") && !cut.includes("the words at the end"), cut.slice(-40));
  assert.equal(whole, "35: retail of maps", "a statement within the length was changed");
  assert.equal(rec.goodsState, "complete", "the run holds the text whole: the cut is the view's, not the register's");
  assert.equal(readFull(run, rec).goodsServices[0].description, long, "the whole text is not on file");
});

test("the raw goods list a normalised list carries is left out of the file, as the full engine serves a record", () => {
  const run = tempRun();
  const raw = { goodsServices: { intClassDescriptions: [{ intClassNumber: "9", intGoodsLanguageCode: "en", intGoodsServicesDescription: "computer software for mapping" }] } };
  logBodies(run, [[ID, body([{ classes: [9], language: "en", description: "computer software for mapping" }], { _raw: raw })]]);
  const file = readFull(run, one(run));
  assert.equal(file._raw?.goodsServices, undefined, "the goods are on file twice");
  assert.equal(file.goodsServices[0].description, "computer software for mapping");
  // Where the raw list says something of its own, it stays.
  const other = tempRun();
  const own = { goodsServices: { intClassDescriptions: [{ intClassNumber: "9", intGoodsServicesDescription: "words only the raw list holds" }] } };
  logBodies(other, [[ID, body([{ classes: [9], language: "en", description: "computer software" }], { _raw: own })]]);
  assert.equal(readFull(other, one(other))._raw.goodsServices.intClassDescriptions[0].intGoodsServicesDescription, "words only the raw list holds");
});

test("complete, absent, failed and not held are four different facts, and none of the last three carries goods", () => {
  const absent = tempRun();
  logBodies(absent, [[ID, body([])]]);
  const a = one(absent);
  assert.deepEqual([a.goods, a.goodsState, a.goodsFrom], [[], "absent", "official record, no goods listed"]);
  assert.ok(a.fullRecord && existsSync(join(absent, a.fullRecord)), "the record that lists none is not on file");

  const failed = tempRun();
  const callLog = join(failed, "calls.jsonl");
  writeFileSync(callLog, `${JSON.stringify({ tool: "record_fetch", target: ID, ok: false, sessionKey: "clearance-acme-garnet-records" })}\n`);
  const f = one(failed, {}, { runPrefix: "clearance-acme-garnet", callLog });
  assert.deepEqual([f.goods, f.goodsState, f.goodsFrom, f.fullRecord], [[], "unavailable", "fetch failed", null]);

  const none = tempRun();
  const n = one(none, {}, { runPrefix: "clearance-acme-garnet", callLog: join(none, "no-such-log.jsonl") });
  assert.deepEqual([n.goods, n.goodsState, n.goodsFrom, n.fullRecord], [[], "not-held", "nothing held", null]);
});

test("goods the search row carries are read from the row, and its cuts stay cuts; a held body wins over them", async () => {
  const row = (id, c) => ({ record_id: id, mark_text: "LANTERNWICK", raw: { classifications: [{ nice_class: 9, goods_services_language: "en", ...c }] } });
  const LONG = "x".repeat(300);
  const lister = async () => ({ ok: true, total: 3, records: [
    row("rec_whole", { goods_services_text: "software", goods_services_text_truncated: false }),
    row("rec_cut", { goods_services_text: "softw", goods_services_text_truncated: true }),
    row("rec_long", { goods_services_text: LONG }),
  ] });
  const listed = await listRegisterRecords({ marks: [{ name: "LANTERNWICK" }], classes: [9], provider: "signa", capabilities: { id: "signa", offices: {} }, lister, variantCap: 0 });
  assert.equal(listed.marks[0].records[0].goods[0].text, "software", "the neutral record dropped the row's goods");
  const run = tempRun();
  const [whole, cut, long] = withFilingGoods(listed, run).marks[0].records;
  assert.deepEqual([whole.goods, whole.goodsState, whole.goodsFrom, whole.fullRecord], [["9: software"], "complete", "search answer", null]);
  assert.deepEqual([cut.goods, cut.goodsState, cut.goodsFrom], [["9: softw"], "cut", "search answer, cut by the register"]);
  assert.deepEqual([long.goodsState, long.goodsFrom], ["unknown", "search answer, completeness not established"]);

  const heldRun = tempRun();
  logBodies(heldRun, [[ID, body([statement("the whole held statement")])]]);
  const rec = one(heldRun, { goods: [{ classes: ["9"], text: "the whole he", cut: true }] });
  assert.deepEqual([rec.goods, rec.goodsState], [["9: the whole held statement"], "complete"]);
});

test("a statement cut in the view with no body behind it keeps its whole text on file, under a safe name", () => {
  const run = tempRun();
  const long = "y".repeat(GOODS_VIEW_CHARS + 50);
  const rec = withFilingGoods(docOf({ recordId: "../../odd id", goods: [{ classes: ["9"], text: long }] }), run).marks[0].records[0];
  assert.equal(rec.goodsShortened, true);
  assert.match(rec.fullRecord, new RegExp(`^${FILING_RECORDS_DIR}/[a-z0-9-]+\\.json$`, "i"), rec.fullRecord);
  assert.equal(readFull(run, rec).goods[0].text, long);
  assert.equal(filingRecordName("../../odd id").includes("/"), false);
  assert.notEqual(filingRecordName("a b"), filingRecordName("a-b"), "two ids share a file");
});

test("nothing here can cost the run its filings: no marks, an unreadable folder and a torn ledger line all pass", () => {
  assert.deepEqual(withFilingGoods({ unavailable: "not listed" }, tempRun()), { unavailable: "not listed" });
  const blocked = join(tempRun(), "a-file");
  writeFileSync(blocked, "not a folder");
  const rec = one(blocked);
  assert.deepEqual([rec.goods, rec.goodsState, rec.fullRecord], [[], "not-held", null]);
  const torn = tempRun();
  writeFileSync(driverDir(torn, "register-record-bodies.jsonl"), `{"target":"${ID}","body":{"goodsServ\n${JSON.stringify({ target: ID, body: body([statement("kept")]) })}\n`);
  assert.deepEqual(one(torn).goods, ["9: kept"]);
});

test("the short view is one line per statement, its classes first, and a statement with no class is its text", () => {
  const { goods, shortened } = shortGoodsView([{ classes: ["9", "35"], text: "words", alt: "mots", en: false }, { classes: [], text: "no class named" }]);
  assert.deepEqual(goods, ["9, 35: words", "no class named"]);
  assert.equal(shortened, false);
  assert.deepEqual(shortGoodsView(null), { goods: [], shortened: false });
});
