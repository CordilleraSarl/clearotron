// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE RUN RECORDS WHAT EACH RECORD'S GOODS REST ON.
//
// The stages that judge a record's goods read them through the band tools, which serve the goods words a
// record holds and, on request, the official record itself. What those tools cannot say is what the goods
// they show rest on: an official record the run fetched or hydrated, statements a search answer carried, or
// nothing at all; and whether that text is whole, cut by the register, or absent from the register's own
// record. Those are different facts and none of them means the goods are unrelated (ruled 2026-10-18:
// complete, cut, absent and unavailable kept distinct; length alone never establishes a cut; what cannot be
// established is said as unknown). The run now writes them down per record, beside the shape and never in
// anything a band tool serves, with where each body came from. A record whose fetch failed is unavailable,
// not missing. Every mark, owner, record id and goods line is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { recordGoodsEvidence, heldRecordProvenance, recordFetchOutcomes, goodsEvidenceTotals, deriveGoodsEvidence, GOODS_STATES }
  from "../goods-evidence.mjs";

const rec = (id, office = "eu") => ({ record_id: `/mark/${office}/${id}`, mark_text: "QZORVAK", owner_name: "Alpha Ltd", classes: ["9"] });
const statement = (text, extra = {}) => ({ classes: ["9"], text, ...extra });
// A goods reader of the shape the band shape is handed: `of` gives the goods a record's evidence holds, `held`
// says whether that is a body the run holds. A reader with no `held` holds bodies only, as at this head.
const reader = (byId, heldIds = null) => ({
  of: (r) => byId[r.record_id.split("/").pop()] ?? null,
  ...(heldIds ? { held: (r) => heldIds.includes(r.record_id.split("/").pop()) } : {}),
});

test("a body the run holds, with goods, is complete on the full record it is; with none, the register's record is without goods", () => {
  const held = new Map([["/mark/eu/g1", { via: ["register-record-bodies"], provider: "signa", session: "clearance-x-y-register-unit-primary", ts: "2026-10-18T00:00:00Z" }],
    ["/mark/eu/g2", { via: ["register-record-bodies"], provider: "signa", session: "clearance-x-y-screen-gate-refetch", ts: "2026-10-18T00:01:00Z" }]]);
  const goods = reader({ g1: [statement("joysticks")] });
  const g1 = recordGoodsEvidence(rec("g1"), { goods, held });
  assert.deepEqual([g1.state, g1.source, g1.basis], ["complete", "record-body", "full-record"]);
  assert.equal(g1.held.session, "clearance-x-y-register-unit-primary", "where the body came from is kept with it");
  const g2 = recordGoodsEvidence(rec("g2"), { goods, held });
  assert.deepEqual([g2.state, g2.source, g2.basis], ["absent", "record-body", "full-record-without-goods"],
    "a held record whose register entry carries no goods is absent at the register, never unrelated and never unknown");
});

test("statements a search answer carried are cut where the register says so, and whole otherwise; length is never the test", () => {
  // The shared goods reader marks a statement the register cut; nothing here reads a search row itself.
  const twoEighty = "x".repeat(280);
  const goods = reader({ r1: [statement("joysticks for games", { cut: true })], r2: [statement(twoEighty)], r3: [statement("joysticks")] }, []);
  const at = (id) => recordGoodsEvidence(rec(id), { goods, held: new Map() });
  assert.deepEqual([at("r1").state, at("r1").source, at("r1").basis], ["cut", "search-row", "register-flag"]);
  assert.deepEqual([at("r2").state, at("r2").basis], ["complete", "register-flag"],
    "a statement of exactly the default cut length that the register did not flag is not called cut on its length");
  assert.equal(at("r3").state, "complete");
});

test("no goods held: unavailable where a fetch for the record failed, otherwise not held; neither is absent", () => {
  const fetches = recordFetchOutcomes([
    { ts: "2026-10-18T00:00:00Z", sessionKey: "clearance-x-y-screen-gate-refetch", tool: "record_fetch", target: "tm_77", ok: false, http_status: 503, cache_hit: false },
    { ts: "2026-10-18T00:00:01Z", sessionKey: "clearance-x-y-screen-gate-refetch", tool: "record_fetch", target: "tm_77", ok: false, http_status: 503, cache_hit: false },
    { ts: "2026-10-18T00:00:02Z", sessionKey: "clearance-other-run-x-register-unit", tool: "record_fetch", target: "tm_88", ok: false, http_status: 404, cache_hit: false },
  ], { runPrefix: "clearance-x-y-" });
  const goods = reader({});
  const u = recordGoodsEvidence(rec("tm_77"), { goods, held: new Map(), fetches });
  assert.deepEqual([u.state, u.source, u.basis], ["unavailable", null, "record-fetch-failed"]);
  assert.deepEqual([u.fetch.sent, u.fetch.failed, u.fetch.last_status], [2, 2, 503], "requests sent are counted as requests, apart from anything else");
  const n = recordGoodsEvidence(rec("tm_88"), { goods, held: new Map(), fetches });
  assert.deepEqual([n.state, n.basis, n.fetch], ["not-held", "no-goods-held", null], "another run's failed fetch says nothing about this run's record");
});

test("a record whose statements the engine cannot read keeps its completeness and says it cannot be read", () => {
  const goods = reader({ g1: [statement("Spielkonsolen", { en: false })] });
  const held = new Map([["/mark/de/g1", { via: ["_records"], provider: "clarivate", session: null, ts: null }]]);
  const e = recordGoodsEvidence(rec("g1", "de"), { goods, held });
  assert.deepEqual([e.state, e.readable], ["complete", false]);
});

test("the totals count records by state, source and basis, and every record lands in exactly one state", () => {
  const rows = [
    { state: "complete", source: "record-body", basis: "full-record", readable: true },
    { state: "absent", source: "record-body", basis: "full-record-without-goods", readable: true },
    { state: "not-held", source: null, basis: "no-goods-held", readable: null },
    { state: "unavailable", source: null, basis: "record-fetch-failed", readable: null },
    { state: "cut", source: "search-row", basis: "register-flag", readable: false },
  ];
  const t = goodsEvidenceTotals(rows);
  assert.equal(t.records, 5);
  assert.deepEqual(t.by_state, Object.fromEntries(GOODS_STATES.map((s) => [s, rows.filter((r) => r.state === s).length])));
  assert.equal(Object.values(t.by_state).reduce((a, b) => a + b, 0), t.records, "the states sum to the records");
  assert.deepEqual(t.by_source, { "record-body": 2, "search-row": 1, none: 2 });
  assert.equal(t.unreadable, 1);
});

test("the run's own files say which bodies it holds and where from, the later copy winning", (t) => {
  const runDir = mkdtempSync(join(tmpdir(), "goods-evidence-held-"));
  t.after(() => rmSync(runDir, { recursive: true, force: true }));
  mkdirSync(driverDir(runDir), { recursive: true });
  mkdirSync(join(runDir, "_records"), { recursive: true });
  writeFileSync(driverDir(runDir, "register-record-bodies.jsonl"), [
    { ts: "2026-10-18T00:00:00Z", provider: "signa", sessionKey: "clearance-x-y-register-unit-primary", target: "/mark/eu/g1", body: { _raw: {} } },
    "not json",
    { ts: "2026-10-18T00:02:00Z", provider: "signa", sessionKey: "clearance-x-y-record-closure", target: "/mark/EU/g2", body: {} },
  ].map((r) => (typeof r === "string" ? r : JSON.stringify(r))).join("\n") + "\n");
  writeFileSync(join(runDir, "_records", "eu-g3.json"), JSON.stringify({ _uri: "/mark/eu/g3", goodsServices: [] }));
  const held = heldRecordProvenance(runDir);
  assert.deepEqual([...held.keys()].sort(), ["/mark/eu/g1", "/mark/eu/g2", "/mark/eu/g3"]);
  assert.equal(held.get("/mark/eu/g2").session, "clearance-x-y-record-closure", "the register's case is folded, as every reader of the ledger folds it");
  assert.deepEqual(held.get("/mark/eu/g3").via, ["_records"]);
});

test("derived over a band, every record has one row and the band's order is kept", () => {
  const band = [rec("g1"), rec("g2"), rec("g3")];
  const held = new Map([["/mark/eu/g1", { via: ["register-record-bodies"], provider: "signa", session: null, ts: null }]]);
  const doc = deriveGoodsEvidence({ records: band, goods: reader({ g1: [statement("joysticks")] }), held });
  assert.deepEqual(doc.records.map((r) => [r.uri, r.state]), [["/mark/eu/g1", "complete"], ["/mark/eu/g2", "not-held"], ["/mark/eu/g3", "not-held"]]);
  assert.equal(doc.totals.records, 3);
  assert.equal(doc.ts, undefined, "the record is derived from the run's files and carries no clock, so a replay derives it byte for byte");
});
