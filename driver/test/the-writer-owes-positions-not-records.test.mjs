// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE WRITER OWES POSITIONS, NOT RECORDS.
//
// The writer owed a finding or a declination for every record the write-up carried: on a test run of a crowded matter,
// 1,154 rows, 521 of them declined one by one. It now owes every position the write-up carried, by position: one
// placement entry with its records, whether a headline entry, a sheet-2 entry the write-up adopted or kept, or one it
// promoted, with the marked pages as before. An entry the write-up dropped owes nothing. A finding naming any record of
// an entry ends it, or one declination of its row, which the coverage tab lists once; a ground closed to any one of its
// records is closed to the entry, and the run's trace reads each record by its position's ending. The reader is still
// told the records an entry left unaccounted holds. Every mark and owner here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareDeclinationSpec, writeRegisterDigestFacts, recordSynthesisSeam } from "../pipeline.mjs";
import { recordRegisterDigest } from "../register-digest-record.mjs";
import { acceptDeclinationCall } from "../declination-call.mjs";
import { recordDeclinations } from "../declination-tool.mjs";
import { reconcileDeclinationDuty, declinationDutyRefusal } from "../declination-duty.mjs";
import { foldDiscardLedger, ledgerEnding, DISCARD_LEDGER_NAME } from "../record-discard.mjs";
import { traceRecordCarry } from "../record-carry.mjs";
import { paths, STAGES } from "../stages.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";
import { synthesisFindings } from "./mock-stage-fixtures.mjs";

const rec = (id, mark, owner, status = "Registered", classes = ["9"]) => ({ record_id: `/mark/eu/${id}`, mark_text: mark, owner_name: owner, classes, status });
const BAND = [
  // The entry's first live record sits in a class the matter does not name, and a later one in its class 9.
  rec("h1dead", "QZORVAK", "Alpha Ltd", "Expired"), rec("h1live", "QZORVAK", "Alpha Ltd", "Registered", ["42"]), rec("h1nine", "QZORVAK", "Alpha Ltd"),
  rec("h2", "QZORVEK", "Beta GmbH"), rec("s1", "QZORVIN", "Gamma SA"), rec("s2", "QZORVAX", "Delta AG"),
  rec("s3", "QZORVO", "Epsilon BV"), rec("u1", "QZORVU", "Zeta Oy"),
];
const entry = (mark, owner, tier, ids) => ({ mark, owner, jurisdiction: "EU", tier, records: ids.map((i) => `/mark/eu/${i}`), reason: `placement's reason for ${mark}` });
const PLACEMENTS = [
  entry("QZORVAK", "Alpha Ltd", "headline-candidate", ["h1dead", "h1live", "h1nine"]),
  entry("QZORVEK", "Beta GmbH", "headline-candidate", ["h2"]),   // the write-up demotes it to Sheet 2
  entry("QZORVIN", "Gamma SA", "sheet-2", ["s1"]),               // the write-up promotes it to Sheet 1
  entry("QZORVAX", "Delta AG", "sheet-2", ["s2"]),               // left on Sheet 2: adopted as placed
  entry("QZORVO", "Epsilon BV", "sheet-2", ["s3"]),              // the write-up drops it
];
const why = "a near form whose goods reach the client's own";
const WRITE_UP = {
  findings_rows: [{ uri: "/mark/eu/h1live", flag_reason: why, verify: "yes" }, { uri: "/mark/eu/s1", flag_reason: why, verify: "yes" },
    { uri: "/mark/eu/u1", flag_reason: "a record no placement holds", verify: "yes" }],
  incumbent_rows: [{ uri: "/mark/eu/h2", flag_reason: "completes the record without changing the advice", verify: "yes" }],
  negative_rows: [{ uri: "/mark/eu/s3", drop_reason: "industrial lathes, nowhere near the client's software", ground: "off-field" }],
};
const SCOPE = { marks: ["QZORVA"], classes: ["9"] };
const GROUNDS = "the owner sells industrial printers, a trade the client's software never reaches";

function seed(t) {
  const runDir = mkdtempSync(join(tmpdir(), "writer-positions-"));
  t.after(() => rmSync(runDir, { recursive: true, force: true }));
  const P = paths(runDir);
  mkdirSync(driverDir(runDir), { recursive: true });
  writeFileSync(P.registerNamedBand, JSON.stringify({ enumerated: BAND }) + "\n");
  writeFileSync(P.placementModel, JSON.stringify({ schema_version: 1, placements: PLACEMENTS }) + "\n");
  writeFileSync(P.instructedScope, JSON.stringify(SCOPE) + "\n");
  const ctx = { paths: P, job: { markName: "QZORVA", classes: ["9"] }, run: { slug: "s", codename: "c" } };
  writeRegisterDigestFacts(ctx, "test");
  const r = recordRegisterDigest(runDir, WRITE_UP);
  assert.equal(r.refused, null, `guard: the write-up's call was refused: ${r.refused}`);
  prepareDeclinationSpec(ctx, P);
  return { runDir, ctx, rows: ctx.findingsSurface ?? [] };
}

test("the writer owes every position the write-up carried, one row each on a live record, and none it dropped", (t) => {
  const { rows } = seed(t);
  assert.deepEqual(rows.map((r) => r.uri), ["/mark/eu/h1live", "/mark/eu/h2", "/mark/eu/s1", "/mark/eu/s2"],
    "an entry dropped or a record no placement holds is owed, or a carried entry is missing, or owed once per record");
  assert.deepEqual(rows[0].uris, ["/mark/eu/h1dead", "/mark/eu/h1live", "/mark/eu/h1nine"], "the entry's records do not ride with its row");
  assert.deepEqual(rows[0].members.map((m) => [m.status, m.classes]), [["Expired", ["9"]], ["Registered", ["42"]], ["Registered", ["9"]]]);
});

test("the writer is told it owes positions, ended by a finding naming any of their records or one declination each", (t) => {
  const { ctx, rows } = seed(t);
  const text = String(STAGES.synthesis.message({ ...ctx, customerUnknown: false, profile: null, intakeAsks: [], enforcerSignals: null, framework: null,
    jxAim: null, registerOnly: false, crowdContext: null, dispatchBlocks: {}, findingsSurface: rows }));
  assert.match(text, /A position or page on your findings surface leaves this stage as a finding in \S+ naming any of its records, or as one declination with its ground, and there is no third way out\./);
  assert.match(text, /the register digest carried 4 position\(s\) onto your findings surface/);
  assert.match(text, /or you decline it BY NAME with a reason and one ground for the position\. A position you simply do not mention/);
});

test("a ground closed to any record of an entry is closed to the entry", (t) => {
  const { rows } = seed(t);
  const spec = { rows, scope: SCOPE };
  const roomOnly = { declinations: [{ row_index: 0, reason: "not-worth-the-line", grounds: GROUNDS }] };
  const alone = acceptDeclinationCall({ rows: [{ ...rows[0], members: [] }], scope: SCOPE }, roomOnly);
  assert.equal(alone.accepted.length, 1, "guard: the position's own record, live in a class the matter does not name, may be declined for want of room");
  const narrow = acceptDeclinationCall(spec, roomOnly);
  assert.equal(narrow.accepted.length, 0, "an entry holding a live registration in an instructed class was declined for want of room");
  const ok = acceptDeclinationCall(spec, { declinations: [{ row_index: 0, reason: "unrelated-goods", grounds: GROUNDS }] });
  assert.deepEqual(ok.accepted.map((a) => a.uri), ["/mark/eu/h1live"], "a substantive ground on the entry was refused");
});

test("a finding naming any record of an entry ends it, its row's declination ends it, and the reader is told the records left open", (t) => {
  const { rows } = seed(t);
  const duty = reconcileDeclinationDuty({ owed: rows, deliveredUris: ["/mark/eu/h1dead"], declinedUris: ["/mark/eu/s1"] });
  assert.deepEqual(duty.unaccounted.map((u) => u.uri), ["/mark/eu/h2", "/mark/eu/s2"], "an entry ended by its other record, or by its row's declination, is still owed");
  assert.deepEqual([duty.totals.owed, duty.totals.unaccounted], [4, 2]);
  assert.deepEqual(duty.records, { owed: 6, unaccounted: 2 }, "the reader is not told the records the owed entries hold");
  assert.match(declinationDutyRefusal(duty), /^synthesis_unaccounted_records:2 of 4 — these positions reached your findings surface .* either deliver a finding that names any of its records, or call `record_declination` with a reason and grounds\. DECLINING IS A COMPLETE ANSWER — what cannot happen is a position leaving with neither/);
});

test("each position the writer sets aside is listed once in the coverage tab, under the label it has today", async (t) => {
  const { runDir, rows } = seed(t);
  recordDeclinations({ runDir, rows, scope: SCOPE }, { declinations: rows.map((_, i) => ({ row_index: i, reason: "unrelated-goods", grounds: GROUNDS })) });
  const { setAsideRows } = await import("../publish/index.mjs");
  assert.deepEqual(setAsideRows(runDir).map((r) => [r.area, r.note]), [
    ["Set aside: QZORVAK — Alpha Ltd", GROUNDS], ["Set aside: QZORVEK — Beta GmbH", GROUNDS],
    ["Set aside: QZORVIN — Gamma SA", GROUNDS], ["Set aside: QZORVAX — Delta AG", GROUNDS],
  ], "a position is set aside once per record, or not at all");
});

test("the run's trace reads every record of a position by the position's ending", (t) => {
  const ending = (runDir, uri) => ledgerEnding(foldDiscardLedger(readFileSync(driverDir(runDir, DISCARD_LEDGER_NAME), "utf8")), uri);
  const declined = seed(t);
  recordDeclinations({ runDir: declined.runDir, rows: declined.rows, scope: SCOPE }, { declinations: [{ row_index: 0, reason: "unrelated-goods", grounds: GROUNDS }] });
  recordSynthesisSeam(declined.ctx, { ok: true });
  for (const u of ["/mark/eu/h1dead", "/mark/eu/h1live", "/mark/eu/h1nine"]) {
    assert.equal(ending(declined.runDir, u)?.reason, "synthesis:declined:unrelated-goods", `${u} is not read as its position's declination`);
  }
  assert.equal(ending(declined.runDir, "/mark/eu/s1")?.reason, "synthesis:not-delivered", "guard: a position with neither ending is still named");
  const delivered = seed(t);
  writeFileSync(delivered.ctx.paths.findings, synthesisFindings(delivered.runDir).replaceAll("/mark/us/90000001", "/mark/eu/h1dead"));
  recordSynthesisSeam(delivered.ctx, { ok: true });
  assert.equal(ending(delivered.runDir, "/mark/eu/h1dead"), null, "the record the finding names is not carried");
  for (const u of ["/mark/eu/h1live", "/mark/eu/h1nine"]) {
    const other = ending(delivered.runDir, u);
    assert.deepEqual([other?.reason, other?.reason_source], ["synthesis:delivered-with-its-position", "step-stated"],
      `${u} does not end with the finding that delivered its position`);
  }
  // The trace holds a carried record to a finding that names it, so the other record must not read as carried.
  const P = delivered.ctx.paths;
  const trace = traceRecordCarry({ bandRecords: BAND, placements: PLACEMENTS, registerFindingsText: readFileSync(P.registerFindings, "utf8"),
    findings: JSON.parse(readFileSync(P.findings, "utf8")).findings, ledger: foldDiscardLedger(readFileSync(driverDir(delivered.runDir, DISCARD_LEDGER_NAME), "utf8")) });
  assert.ok(!trace.unreasoned.some((u) => u.uri === "/mark/eu/h1live" || u.uri === "/mark/eu/h1nine"), "the trace reads a delivered position's other record as dropped without a ground");
});
