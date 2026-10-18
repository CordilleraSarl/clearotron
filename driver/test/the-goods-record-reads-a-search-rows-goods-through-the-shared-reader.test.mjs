// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE GOODS RECORD READS A SEARCH ROW'S GOODS THROUGH THE SHARED READER, AND AGREES WITH ITS COUNT.
//
// The band shape reads the goods a register's search row carries: where the run holds no official record, the
// class statements on the row, each marked where the register cut it (record-goods.mjs `rowGoods`). The run's
// record of what each record's goods rest on reads them through that same reader and never reads a row itself:
// a statement the register cut is cut, one under the default answer's documented cut is complete, an unflagged one
// at that cut is not established, a held record still comes first, and a row with no statements holds nothing. The shape's own count of the same evidence (`goodsEvidence`, on the band-shape
// event) and the run's record must then agree record for record, or two counts of one fact have drifted apart.
// Every mark, owner, record id and goods line is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { envFrom, pinEnv } from "../../shared/env-aliases.mjs";

pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || mkdtempSync(join(tmpdir(), "clearotron-testroot-")));
process.env.CLEAROTRON_REGISTER_CALL_LOG = join(mkdtempSync(join(tmpdir(), "row-goods-calls-")), "register-calls.jsonl");
const { DERIVATION_RUNNERS } = await import("../pipeline.mjs");
const { paths } = await import("../stages.mjs");
const { bandShapeGoods, goodsEvidence } = await import("../record-goods.mjs");
const { deriveGoodsEvidence, heldRecordProvenance } = await import("../goods-evidence.mjs");

const row = (id, statements, extra = {}) => ({ record_id: `/mark/eu/${id}`, mark_text: "QZORVAK", owner_name: "Alpha Ltd", classes: ["9"],
  status: "registered", jurisdictions: ["EU"], ...(statements ? { raw: { classifications: statements } } : {}), ...extra });
const statement = (text, truncated = false) => ({ nice_class: 9, goods_services_text: text, goods_services_language: "en",
  ...(truncated ? { goods_services_text_truncated: true } : {}) });
const BAND = [
  row("r1", [statement("x".repeat(280), true)]),      // the register cut it
  row("r2", [statement("joysticks for consoles")]),   // whole
  row("r3", []),                                        // the row lists no statement
  row("r4", [statement("printers", true)]),            // a held record comes first
  row("r5", null),                                      // nothing on the row
  row("r6", null),                                      // a held record that lists no goods
  row("r7", [statement("y".repeat(280))]),              // unflagged at the default answer's cut: not established
];

function seedRun(t) {
  const runDir = mkdtempSync(join(tmpdir(), "row-goods-run-"));
  t.after(() => rmSync(runDir, { recursive: true, force: true }));
  mkdirSync(driverDir(runDir), { recursive: true });
  writeFileSync(join(runDir, "register-named-band.json"), JSON.stringify({ enumerated: BAND, crowds: [] }));
  const body = (target, classifications) => ({ ts: "2026-10-18T00:00:00Z", provider: "signa", sessionKey: "clearance-qz-test-register-unit-primary-sweep",
    target, body: { _raw: { classifications } } });
  writeFileSync(driverDir(runDir, "register-record-bodies.jsonl"), [
    body("/mark/eu/r4", [{ nice_class: 9, goods_services_text: "printers and printer cartridges", goods_services_language: "en", goods_services_text_truncated: false }]),
    body("/mark/eu/r6", []),
  ].map((r) => JSON.stringify(r)).join("\n") + "\n");
  return runDir;
}

test("a search row's statements are read through the shared reader: cut where the register cut them, whole otherwise, a held record first", (t) => {
  const runDir = seedRun(t);
  const goods = bandShapeGoods(paths(runDir), BAND).goods;
  const doc = deriveGoodsEvidence({ records: BAND, goods, held: heldRecordProvenance(runDir) });
  assert.deepEqual(doc.records.map((r) => [r.uri.split("/").pop(), r.state, r.source, r.basis]), [
    ["r1", "cut", "search-row", "register-flag"],
    ["r2", "complete", "search-row", "default-answer-under-its-cut"],
    ["r3", "not-held", null, "no-goods-held"],
    ["r4", "complete", "record-body", "register-flag"],
    ["r5", "not-held", null, "no-goods-held"],
    ["r6", "absent", "record-body", "full-record-without-goods"],
    ["r7", "unknown", "search-row", "default-answer-at-or-over-its-cut"],
  ]);
});

test("the shape's own count of the evidence and the run's record agree record for record", (t) => {
  // The shape counts a held record with goods, a row's whole or cut statements, or none. The run's record says the
  // same, and also tells apart a held record that lists no goods, which the shape counts as none.
  const runDir = seedRun(t);
  const goods = bandShapeGoods(paths(runDir), BAND).goods;
  const doc = deriveGoodsEvidence({ records: BAND, goods, held: heldRecordProvenance(runDir) });
  const count = (source, ...states) => doc.records.filter((r) => r.source === source && (!states.length || states.includes(r.state))).length;
  assert.deepEqual({ held: count("record-body", "complete", "cut", "unknown"), complete: count("search-row", "complete"), cut: count("search-row", "cut"),
    unknown: count("search-row", "unknown"), none: count(null) + count("record-body", "absent") }, goodsEvidence(BAND, goods));
});

test("the derivation the pipeline runs writes the row's states, and its two events agree", (t) => {
  const runDir = seedRun(t);
  const ctx = { paths: paths(runDir), job: { markName: "Qzorvak", classes: ["9"], jurisdictions: ["EU"] }, profile: {}, run: { slug: "qz", codename: "test", runDir } };
  assert.equal(DERIVATION_RUNNERS["band-shape"](ctx), true);
  const doc = JSON.parse(readFileSync(driverDir(runDir, "goods-evidence.json"), "utf8"));
  assert.deepEqual(doc.records.map((r) => r.state), ["cut", "complete", "not-held", "complete", "not-held", "absent", "unknown"]);
  const events = readFileSync(driverDir(runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const shaped = events.find((e) => e.event === "band-shape-derived")?.goods_evidence;
  const recorded = events.find((e) => e.event === "goods-evidence");
  assert.ok(shaped && recorded, "guard: both events were written");
  assert.equal(shaped.held, recorded.by_source["record-body"] - recorded.by_state.absent);
  assert.equal(shaped.none, recorded.by_source.none + recorded.by_state.absent);
  assert.equal(shaped.complete + shaped.cut + shaped.unknown, recorded.by_source["search-row"]);
  // The shape's lines carry the same state for the record each names, from the same derivation.
  const shape = JSON.parse(readFileSync(driverDir(runDir, "band-shape.json"), "utf8"));
  const stateOf = new Map(doc.records.map((r) => [r.uri, r.state]));
  const lines = ["a", "b", "c", "d", "rest", "no_goods"].flatMap((g) => shape.groups?.[g]?.list ?? []);
  assert.ok(lines.length >= 1, "guard: the shape lists lines");
  for (const l of lines) assert.equal(l.goods_evidence, stateOf.get(l.record_id), `the line naming ${l.record_id} says another state than the run's record`);
});
