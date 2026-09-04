// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The register-digest typed coverage transport — the seat sends VALUES, the driver writes the file.
//
// coverage-call.mjs is judged here the way disposition-call's tests judge B: every refusal names the
// row and the field, rows that validate are kept beside refused neighbours, and the predicates are the
// SAME ones the gate judges with (rowIsSettled / seatBannedTokens / REGISTER_AXES — an accepted row
// that the gate would refuse, or a refused row it would accept, is the two-answers defect names).
// coverage-tool.mjs is judged over a REAL run dir: capture-first journalling, accumulator-only writes
// (the seat-facing mirror is dead), retraction, and survival through the gateway's regenerate union.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { tmpdir } from "node:os";
import { validateCoverageCall, coverageCallAnswer, MAX_ROWS_PER_CALL, CALL_REFUSALS } from "../coverage-call.mjs";
import { recordCoverage, coverageCallRecordPaths, readCoverageCallVerdicts } from "../coverage-tool.mjs";
import { PARK_AFTER_REFUSALS } from "../refusal-bound.mjs";   //
import { outstandingCoverageRows, parkedCoverageRows } from "../coverage-union.mjs";   //
import { unionCoverageForm } from "../coverage-union.mjs";
import { rowIsSettled, findCoverageFormViolations } from "../coverage-form.mjs";
import { armCoverageForm, readCoverageForm, coverageFormPaths } from "../coverage-form-io.mjs";
// — the crowd-count parser and the grammar it refuses against, read from the constants that own
// them. A test that retyped either would pass while the served contract said something else.
import { CROWD_RULING_TOKEN, CROWD_RULING_UNIT_GRAMMAR, crowdRulingCount } from "../coverage-ledger.mjs";
import { parseCrowdRulings } from "../recall-reconciliation.mjs";

// The same fixture family coverage-union.test.mjs uses: one open block, one deferred qid, two axes.
const PLAN = { entries: [
  { qid: "ps:stack:lumen+form", axis: "primary-sweep", predicate: "exact", terms: ["LUMEN", "LUMENN"],
    nice_classes: ["9"], expected_kind: "enumerate" },
  { qid: "tn:translit:lumen+cyr", axis: "transliteration-numeric", predicate: "default", term: "ЛЮМЕН",
    nice_classes: ["9"], expected_kind: "enumerate" },
] };
const INPUT = {
  skeleton: [
    { axis: "primary-sweep", state: "incomplete", missing: [] },
    { axis: "transliteration-numeric", state: "deferred", deferred: ["tn:translit:lumen+cyr"], missing: [] },
  ],
  plan: PLAN,
  bandBlocksByAxis: { "primary-sweep": [{ state: "incomplete", qid: "ps:stack:lumen+form", total_hits: 6862,
    term_counts: { LUMEN: { disposition: "crowd" }, LUMENN: { disposition: "unenumerated" } } }] },
  deferredReasons: { "tn:translit:lumen+cyr": "the provider indexes non-latin filings by their transliteration" },
  activeAxes: ["primary-sweep", "transliteration-numeric"],
};

const canonical = () => unionCoverageForm(null, null, INPUT).form.rows;
const axisRow = () => canonical().find((r) => r.kind === "axis");
const openRow = () => canonical().find((r) => r.open === true);

test("a valid driver-row ruling is accepted with the driver's row_id, and the gate agrees", () => {
  const rows = canonical();
  const r = axisRow();
  const { accepted, refused } = validateCoverageCall(
    [{ row_id: r.row_id, status: "confirmed-clean", reason: "the sweep enumerated and judgment cleared it" }], rows);
  assert.equal(refused.length, 0);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].row_id, r.row_id);
  // the accepted fields, folded onto the canonical row, satisfy the SAME predicate the gate uses
  assert.ok(rowIsSettled({ ...r, ...accepted[0] }, r));
});

test("every refusal names the row and the defect, and neighbours in the same call are kept", () => {
  const rows = canonical();
  const ok = axisRow(), open = openRow();
  const { accepted, refused } = validateCoverageCall([
    { row_id: ok.row_id, status: "confirmed-clean", reason: "clear" },
    { row_id: open.row_id, status: "confirmed-clean", reason: "looks fine" },          // open_clean
    { row_id: "CX-NOPE", status: "deferred", reason: "x" },                            // unknown_row
    { row_id: ok.row_id, status: "confirmed-clean", reason: "again" },                 // duplicate_row
    { row_id: open.row_id, status: "banana", reason: "x" },                            // duplicate (already seen? no — refused rows are not seen) → status_invalid
  ], rows);
  assert.equal(accepted.length, 1, "the valid neighbour is KEPT");
  const reasons = refused.map((r) => r.reason);
  assert.ok(reasons.includes("open_clean"));
  assert.ok(reasons.includes("unknown_row"));
  assert.ok(reasons.includes("duplicate_row"));
  assert.ok(reasons.includes("status_invalid"));
  for (const r of refused) assert.ok(CALL_REFUSALS.includes(r.reason), `closed vocabulary: ${r.reason}`);
  // the open_clean refusal carries the DRIVER's own open_because, not a generic sentence
  const oc = refused.find((r) => r.reason === "open_clean");
  assert.match(oc.detail, /never searched|unaccounted|cannot be confirmed-clean/i);
});

test("status/reason floors: off-enum status, empty reason, engine vocabulary in the reason", () => {
  const rows = canonical();
  const r = axisRow();
  const bad = (row) => validateCoverageCall([row], rows).refused[0]?.reason;
  assert.equal(bad({ row_id: r.row_id, status: "clean", reason: "x" }), "status_invalid");
  assert.equal(bad({ row_id: r.row_id, status: "confirmed-clean", reason: "  " }), "reason_absent");
  assert.equal(bad({ row_id: r.row_id, status: "confirmed-clean", reason: "the primary-sweep came back clean" }),
    "engine_vocabulary");
});

test("a seat row is accepted through the union's own ingest (driver-minted id, repaired axis)", () => {
  const rows = canonical();
  const { accepted, refused } = validateCoverageCall([{
    kind: "seat", axis: "primary-sweep", unit: "primary-sweep / CH reconciliation",
    status: "confirmed-clean", reason: "every CH filing in the band was reconciled against the instructed scope",
  }], rows);
  assert.equal(refused.length, 0);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].kind, "seat");
  assert.match(accepted[0].row_id, /^CS-/, "the driver mints the id — the seat never typed one");
});

test("a seat row with an off-vocabulary axis is refused at call time; a driver-named unit stays a distinct seat row", () => {
  const rows = canonical();
  const badAxis = validateCoverageCall([{
    kind: "seat", axis: "switzerland", unit: "switzerland / reconciliation", status: "confirmed-clean", reason: "ok",
  }], rows);
  assert.equal(badAxis.refused[0].reason, "axis_invalid");
  // a seat row can never occupy a driver row's identity — formRowKey prefixes `seat:` — so a unit that
  // echoes a driver unit is accepted as the seat's OWN row, and the union drops nothing silently.
  const echo = validateCoverageCall([{
    kind: "seat", axis: "primary-sweep", unit: "primary-sweep", status: "confirmed-clean", reason: "ok",
  }], rows);
  assert.equal(echo.refused.length, 0);
  assert.notEqual(echo.accepted[0].row_id, axisRow().row_id);
});

// ── — THE LATE BLOCK, MOVED TO THE CALL ──────────────────────────────────────────────────────
//
// The crowd ruling is the one seat row under a delivery-blocking gate, and its member count was read
// for the first time at DELIVERY. An uncounted cell passed this call, passed the coverage gate, and
// blocked the run three gates later, after a paid dispatch, over a ruling the seat had made. The two
// tests below judge the two halves of the fix: the refusal happens HERE, and the number the call reads
// is the number delivery reads.
test("a crowd ruling whose unit counts nothing is refused AT CALL TIME, not at delivery", () => {
  const rows = canonical();
  const bad = { kind: "seat", axis: "saturation-probe", unit: `saturation-probe / ${CROWD_RULING_TOKEN}`,
    status: "coverage-limited", reason: "crowd membership is the reasoned ending for the residual" };
  const { accepted, refused } = validateCoverageCall([bad], rows);
  assert.equal(accepted.length, 0);
  assert.equal(refused[0].reason, "crowd_count_unparsed");
  assert.ok(CALL_REFUSALS.includes(refused[0].reason), "the refusal vocabulary stays closed");
  // the remedy, not just the cause: the unit IS the row's identity (formRowKey keys `seat:<axis>:<unit>`),
  // so the cell cannot be edited in place and the refusal has to say retract-then-re-add or it sends the
  // seat to do something the transport will not let it do.
  assert.match(refused[0].detail, /retract/i);
  assert.ok(refused[0].detail.includes(CROWD_RULING_UNIT_GRAMMAR),
    "and it quotes the grammar constant rather than a retyped copy of it");
  // a count in the REASON is the same defect wearing a disguise — the cell still counts nothing
  const inReason = validateCoverageCall([{ ...bad, reason: "ruled crowd covering 12 members of the residual" }], rows);
  assert.equal(inReason.refused[0].reason, "crowd_count_unparsed");
  // a COUNTED crowd row is accepted, and every non-crowd seat row is untouched by this arm
  const good = { ...bad, unit: `saturation-probe / ${CROWD_RULING_TOKEN} (12 members): residual pile` };
  assert.equal(validateCoverageCall([good], rows).refused.length, 0);
  assert.equal(validateCoverageCall([{ kind: "seat", axis: "primary-sweep", unit: "primary-sweep / CH reconciliation",
    status: "confirmed-clean", reason: "reconciled against the instructed scope" }], rows).refused.length, 0);
});

test("ONE PARSER, TWO READERS: the count the call reads is the count delivery credits", () => {
  // The property the fix exists for, and it is structural rather than behavioural — so it is pinned by
  // VALUE across all three cell shapes instead of being left to "both call the same function today".
  const rows = canonical();
  const cells = [
    `saturation-probe / ${CROWD_RULING_TOKEN} (12 members): residual pile`,   // counted
    `saturation-probe / ${CROWD_RULING_TOKEN}`,                               // ruled, counting nothing
    "primary-sweep / CH reconciliation",                                      // not a crowd row at all
  ];
  for (const unit of cells) {
    const seen = parseCrowdRulings([{ unit, status: "coverage-limited", reason: "r" }]);
    assert.equal(crowdRulingCount(unit), seen.length ? seen[0].declared : null,
      `call time and delivery time must read "${unit}" identically`);
  }
  // and the accepted row itself, through the real delivery parser — not a hand-built imitation of one
  const ok = validateCoverageCall([{ kind: "seat", axis: "saturation-probe", unit: cells[0],
    status: "coverage-limited", reason: "crowd membership is the reasoned ending for the residual" }], rows);
  assert.equal(ok.refused.length, 0);
  assert.equal(parseCrowdRulings([ok.accepted[0]])[0].declared, 12);
});

test("#1018 a countless crowd row already in the accumulator: a re-send is refused, the retract works", () => {
  // The ergonomic path the refusal detail's remedy is written for, and the reason it says RETRACT rather
  // than "fix the unit". A row recorded before this arm existed is never re-validated on its own — the
  // run keeps its delivery block until somebody acts. But a seat re-sending a status BY EXISTING ROW_ID
  // inherits that row's unit (the re-send branch reads `existing.unit`), so the re-send lands on the
  // arm and is refused over a cell it did not type this turn. That refusal is only actionable because
  // the detail names the two-step: the unit IS the row's identity, so editing it mints a different row.
  const stale = [{ row_id: "CS-OLD1", axis: "saturation-probe", kind: "seat",
    unit: `saturation-probe / ${CROWD_RULING_TOKEN}`, qid: null, open: false,
    status: "coverage-limited", reason: "crowd membership ends the residual" }];
  const withSeat = unionCoverageForm(null, { rows: stale }, INPUT).form.rows;
  const seat = withSeat.find((r) => r.kind === "seat");
  const resend = validateCoverageCall([{ row_id: seat.row_id, status: "coverage-limited", reason: "still the reasoned ending" }], withSeat);
  assert.equal(resend.accepted.length, 0);
  assert.equal(resend.refused[0].reason, "crowd_count_unparsed");
  // and the remedy it names actually resolves: the retract is accepted, so the seat is not cornered
  const retract = validateCoverageCall([{ retract: seat.row_id }], withSeat);
  assert.deepEqual(retract.retractions, [seat.row_id]);
  assert.equal(retract.refused.length, 0);
});

test("retract: names a recorded seat row's id; a driver row or an unknown id is refused", () => {
  const base = canonical();
  const seat = validateCoverageCall([{
    kind: "seat", axis: "primary-sweep", unit: "primary-sweep / merch sweep", status: "confirmed-clean", reason: "clear",
  }], base).accepted;
  // fold the seat row in, as the tool does, then retract it against the NEW canonical set
  const withSeat = unionCoverageForm(null, { rows: seat }, INPUT).form.rows;
  const seatId = withSeat.find((r) => r.kind === "seat").row_id;
  const r1 = validateCoverageCall([{ retract: seatId }], withSeat);
  assert.deepEqual(r1.retractions, [seatId]);
  assert.equal(r1.refused.length, 0);
  const r2 = validateCoverageCall([{ retract: axisRow().row_id }], withSeat);
  assert.equal(r2.refused[0].reason, "retract_invalid");
  const r3 = validateCoverageCall([{ retract: "CS-UNKNOWN" }], withSeat);
  assert.equal(r3.refused[0].reason, "retract_invalid");
});

test("overflow beyond the ceremony budget is returned, never silently dropped", () => {
  const rows = canonical();
  const r = axisRow();
  const many = Array.from({ length: MAX_ROWS_PER_CALL + 3 }, () =>
    ({ row_id: r.row_id, status: "confirmed-clean", reason: "x" }));
  const v = validateCoverageCall(many, rows);
  assert.equal(v.overflow.length, 3);
});

test("the answer lists outstanding rows with the driver's own open_because", () => {
  const text = coverageCallAnswer({ accepted: [], retractions: [], refused: [], overflow: [] },
    [{ row_id: "CD-XXXXXXXX", unit: "transliteration-numeric / ЛЮМЕН", open: true, open_because: "never searched on this run" }]);
  assert.match(text, /1 obligation still outstanding/);
  assert.match(text, /CD-XXXXXXXX/);
  assert.match(text, /never searched/);
  assert.match(text, /never be confirmed-clean/);
  const done = coverageCallAnswer({ accepted: [{}], retractions: [], refused: [], overflow: [] }, []);
  assert.match(done, /Nothing is outstanding/);
});

// ── the disk half, over a real run dir ──────────────────────────────────────────────────────────────

function runDir() {
  const dir = mkdtempSync(join(tmpdir(), "coverage-tool-"));
  mkdirSync(driverDir(dir), { recursive: true });
  mkdirSync(join(dir, "register-units"), { recursive: true });
  writeFileSync(driverDir(dir, "plan-execution.json"), JSON.stringify({
    skeleton: INPUT.skeleton, deferred: [{ qid: "tn:translit:lumen+cyr", reason: INPUT.deferredReasons["tn:translit:lumen+cyr"] }],
  }));
  writeFileSync(driverDir(dir, "register-plan.json"), JSON.stringify(PLAN));
  writeFileSync(join(dir, "register-units", "primary-sweep-band.json"), JSON.stringify(INPUT.bandBlocksByAxis["primary-sweep"]));
  writeFileSync(join(dir, "register-units", "primary-sweep.md"), "# audit note\n");
  writeFileSync(join(dir, "register-units", "transliteration-numeric.md"), "# audit note\n");
  armCoverageForm(dir);
  return dir;
}

test("recordCoverage: capture-first journal, accumulator-only write, and the gate reads what it wrote", () => {
  const dir = runDir();
  const rows = unionCoverageForm(null, null, INPUT).form.rows;
  const settle = rows.map((r) => ({ row_id: r.row_id, status: r.open ? "deferred" : "coverage-limited",
    reason: "what was searched and what was not, in plain words" }));
  const r = recordCoverage(dir, { rows: settle });
  assert.equal(r.ok, true);
  assert.equal(r.refused, 0);
  assert.equal(r.outstanding, 0);
  assert.match(r.text, /Nothing is outstanding/);
  // the accumulator holds it; the SEAT-FACING MIRROR IS DEAD and was not written
  const { seat, sidecar } = coverageFormPaths(dir);
  assert.ok(existsSync(sidecar), "the _driver/ accumulator is the one copy");
  assert.ok(!existsSync(seat), "no seat-facing coverage file is written by anything any more");
  const cf = readCoverageForm(dir);
  assert.equal(findCoverageFormViolations(cf.rows, cf.error).length, 0, "the gate accepts the tool's record");
  // capture-first: the payload journal and its receiver-written index both exist
  const { payload, index } = coverageCallRecordPaths(dir, 1);
  assert.ok(existsSync(payload));
  assert.equal(readFileSync(index, "utf8").trim().split("\n").length, 1);
  const cap = JSON.parse(readFileSync(payload, "utf8"));
  assert.equal(cap.rowCount, settle.length, "the payload is captured AS RECEIVED, before validation");
});

test("recordCoverage: statuses survive the gateway's regenerate union, and a refused row costs nothing", () => {
  const dir = runDir();
  const rows = unionCoverageForm(null, null, INPUT).form.rows;
  const open = rows.find((x) => x.open === true), ok = rows.find((x) => x.kind === "axis");
  const r1 = recordCoverage(dir, { rows: [
    { row_id: ok.row_id, status: "confirmed-clean", reason: "enumerated to completion and cleared" },
    { row_id: open.row_id, status: "confirmed-clean", reason: "seems fine" },   // refused: open_clean
  ] });
  assert.equal(r1.accepted, 1);
  assert.equal(r1.refused, 1);
  assert.ok(r1.outstanding > 0);
  assert.match(r1.text, /open_clean|cannot be confirmed-clean|never searched/i);
  // the gateway's pre-judgement regenerate (submitted: null) keeps the accepted status
  const again = unionCoverageForm({ rows: readCoverageForm(dir).rows }, { rows: null },
    { ...INPUT });
  const kept = again.form.rows.find((x) => x.row_id === ok.row_id);
  assert.equal(kept.status, "confirmed-clean", "a row settled through the tool stays settled");
});

test("recordCoverage: seat rows accumulate across calls and retract removes exactly one", () => {
  const dir = runDir();
  const r1 = recordCoverage(dir, { rows: [
    { kind: "seat", axis: "primary-sweep", unit: "primary-sweep / CH reconciliation",
      status: "confirmed-clean", reason: "reconciled" },
  ] });
  assert.equal(r1.accepted, 1);
  const r2 = recordCoverage(dir, { rows: [
    { kind: "seat", axis: "saturation-probe", unit: "saturation-probe / dominant-element crowd (12 members): descriptive pile",
      status: "coverage-limited", reason: "ruled as a counted crowd on the residual class" },
  ] });
  assert.equal(r2.accepted, 1);
  const afterTwo = readCoverageForm(dir).rows.filter((x) => x.kind === "seat");
  assert.equal(afterTwo.length, 2, "a call that omits a recorded seat row does NOT retract it — silence removes nothing");
  const chId = afterTwo.find((x) => /CH reconciliation/.test(x.unit)).row_id;
  const r3 = recordCoverage(dir, { rows: [{ retract: chId }] });
  assert.equal(r3.retracted, 1);
  const left = readCoverageForm(dir).rows.filter((x) => x.kind === "seat");
  assert.equal(left.length, 1);
  assert.match(left[0].unit, /dominant-element crowd/);
  // three calls journalled, in order, by the receiver
  const { dir: calls } = coverageCallRecordPaths(dir, 0);
  assert.equal(readdirSync(calls).filter((f) => f.startsWith("call-")).length, 3);
});

test("recordCoverage: an unstamped run and a stamped-but-inputless run answer plainly, recording nothing", () => {
  const bare = mkdtempSync(join(tmpdir(), "coverage-tool-bare-"));
  const r = recordCoverage(bare, { rows: [] });
  assert.equal(r.ok, false);
  assert.match(r.text, /no coverage form/i);
  const stampedOnly = mkdtempSync(join(tmpdir(), "coverage-tool-stamp-"));
  mkdirSync(driverDir(stampedOnly), { recursive: true });
  armCoverageForm(stampedOnly);
  const r2 = recordCoverage(stampedOnly, { rows: [] });
  assert.equal(r2.ok, false);
  assert.match(r2.text, /driver fault|absence declaration/i);
});

// ── — THE REFUSAL BOUND AT THIS SEAM ───────────────────────────────────────────────────────────
//
// Coverage is the second member of 's live-lock class: a loop of per-item obligations settled
// through validated tool calls, where before this nothing counted a refusal. `open_clean` is the
// repeatable refusal — a row the machine computed as OPEN can never be called confirmed-clean, so a seat
// that keeps claiming it is refused correctly, forever. That is the killer's shape exactly: the refusals
// were right and the seat never converged.
//
// NOTE ON THE WORD: this park is per-ROW and about refusals. `coverage-form-taint-park.test.mjs`'s park
// is a different mechanism — renaming a kill-touched accumulator on resume. They do not interact.
test("#1239 coverage: a row refused past the bound parks, the loop ends, and no count claims it was ruled", () => {
  const dir = runDir();
  const rows = unionCoverageForm(null, null, INPUT).form.rows;
  const open = rows.find((x) => x.open === true);
  const bad = { rows: [{ row_id: open.row_id, status: "confirmed-clean", reason: "seems fine" }] };

  let last = null;
  for (let i = 0; i < PARK_AFTER_REFUSALS; i += 1) last = recordCoverage(dir, bad);

  assert.deepEqual(last.parked, [open.row_id], "the row must park at the bound");
  assert.equal(last.parked_refusals[open.row_id], PARK_AFTER_REFUSALS, "with its refusal history attached");
  assert.match(last.text, /PARKED/, "and the seat is told — it is the only party that can stop re-sending");

  // THE LOOP ENDS: the parked row is no longer counted as outstanding, so the stage can finish.
  //
  // These two assertions are the whole design, and they must BOTH hold. The row is still unsettled in the
  // form — the park invented no judgement. But the tool stops asking for it, which is what ends the loop.
  // An exact count, because "fewer than before" would pass on a build that dropped every row.
  //
  // UPDATED WHEN THE PARK BECAME PERSISTENT ( stage-side). This used to look for the row IN
  // `outstandingCoverageRows`, because back then the park existed only in the tool's reply and the form
  // still read the row as plainly unsettled. Now the park reaches the accumulator and the row correctly
  // LEAVES that list — so the two halves are asserted where they actually live: unsettled on the row,
  // not-asked-for in the list.
  const cf0 = readCoverageForm(dir);
  const parkedRow0 = cf0.rows.find((r) => r.row_id === open.row_id);
  assert.equal(parkedRow0.parked, true, "given up on, on the record");
  assert.ok(!parkedRow0.status || parkedRow0.status !== "confirmed-clean",
    "and still carrying no judgement — nothing was invented");
  const outIds = outstandingCoverageRows(cf0).map((r) => r.row_id);
  assert.ok(!outIds.includes(open.row_id), "it is no longer asked for, which is what ends the loop");
  assert.equal(last.outstanding, outIds.length,
    "and the tool's count agrees with the form's, with the parked row out of both");

  // THE COUNT STAYS TRUE. 's corpse was a narrative reporting every row recorded over a
  // machine-checked shortfall; a park that banked a status would rebuild it in one line.
  const cf = readCoverageForm(dir);
  const parkedRow = cf.rows.find((r) => r.row_id === open.row_id);
  assert.ok(!parkedRow.status || parkedRow.status !== "confirmed-clean",
    "the park recorded no judgement — the row is unresolved, and the run must report it that way");
  assert.equal(last.accepted, 0);
});

test("#1239 coverage: the bound does not fire one refusal short", () => {
  const dir = runDir();
  const rows = unionCoverageForm(null, null, INPUT).form.rows;
  const open = rows.find((x) => x.open === true);
  const bad = { rows: [{ row_id: open.row_id, status: "confirmed-clean", reason: "seems fine" }] };
  let last = null;
  for (let i = 0; i < PARK_AFTER_REFUSALS - 1; i += 1) last = recordCoverage(dir, bad);
  assert.deepEqual(last.parked, [], "one short is still owed");
});

test("#1239 coverage: verdicts live in a sibling ledger, and the index row still carries none", () => {
  const dir = runDir();
  const rows = unionCoverageForm(null, null, INPUT).form.rows;
  const open = rows.find((x) => x.open === true), ok = rows.find((x) => x.kind === "axis");
  recordCoverage(dir, { rows: [
    { row_id: ok.row_id, status: "confirmed-clean", reason: "enumerated to completion and cleared" },
    { row_id: open.row_id, status: "confirmed-clean", reason: "seems fine" },
  ] });
  const v = readCoverageCallVerdicts(dir);
  assert.equal(v.length, 1, "one verdict record per call");
  assert.equal(v[0].accepted.length, 1);
  assert.equal(v[0].refused.length, 1);
  assert.equal(v[0].refused[0].row_id, open.row_id);
  assert.ok(v[0].refused[0].reason, "the refusal keeps its reason token");
  // The index is written BEFORE any decision, so an index line with no verdict means the call died
  // between receipt and decision. That stays a fact only while the index carries no verdict.
  const idx = readFileSync(coverageCallRecordPaths(dir, 0).index, "utf8");
  assert.ok(!/refused|accepted/.test(idx), "the index row carries no verdict");
});

test("#1239/#1233 the park PERSISTS in the accumulator and the counts are three-way", () => {
  // Computed only in the answer, the park evaporated: the next call regenerated the form, the row read
  // as merely unsettled again, and every consumer downstream counted it as work still owed. 's
  // acceptance 2 is that the TRUE counts reach the seams a reader sees — "72 of 73; 1 unresolved" — so
  // the park has to be in the file, not in one reply.
  const dir = runDir();
  const rows = unionCoverageForm(null, null, INPUT).form.rows;
  const open = rows.find((x) => x.open === true);
  const bad = { rows: [{ row_id: open.row_id, status: "confirmed-clean", reason: "seems fine" }] };
  for (let i = 0; i < PARK_AFTER_REFUSALS; i += 1) recordCoverage(dir, bad);

  // 1. it is on the row, in the file, with its evidence
  const cf = readCoverageForm(dir);
  const row = cf.rows.find((r) => r.row_id === open.row_id);
  assert.equal(row.parked, true, "the park reached the accumulator");
  assert.equal(row.parked_refusals, PARK_AFTER_REFUSALS, "with how many refusals bought it");
  assert.match(row.parked_reason, /refused .* times without settling/, "and why");
  assert.ok(!row.status || row.status !== "confirmed-clean", "and NO judgement was invented");

  // 2. it survives the next regeneration — the union re-derives every driver row from the plan
  const again = unionCoverageForm({ rows: cf.rows }, { rows: null }, INPUT);
  const kept = again.form.rows.find((r) => r.row_id === open.row_id);
  assert.equal(kept.parked, true, "a row parked on call 30 is still parked on call 31");
  assert.equal(kept.parked_refusals, PARK_AFTER_REFUSALS, "and keeps its evidence");

  // 3. THREE STATES, THREE COUNTS. This is the assertion 's corpse would have failed: a narrative
  // reporting every row recorded over a machine-checked shortfall.
  assert.equal(again.parked, 1);
  // PINNED INDEPENDENTLY, because the obvious check is a tautology: `outstanding` is DERIVED as
  // total - settled - parked, so `total === settled + parked + outstanding` balances even when a parked
  // row is also counted as settled. Seeded exactly that (`parked += 1; settled += 1;`) and the balance
  // arm stayed green — which is the lie, arriving through the one assertion meant to stop it.
  const reallySettled = again.form.rows.filter((r) => rowIsSettled(r, r)).length;
  assert.equal(again.settled, reallySettled,
    "`settled` counts rows the gate would accept, and a parked row is not one of them");
  assert.equal(again.outstanding, again.total - reallySettled - again.parked);
  assert.equal(again.total, again.settled + again.parked + again.outstanding,
    "and the three still account for every row");
  assert.ok(!outstandingCoverageRows(again.form).some((r) => r.row_id === open.row_id),
    "the parked row is no longer asked for");
  assert.deepEqual(parkedCoverageRows(again.form).map((r) => r.row_id), [open.row_id],
    "and it is nameable, so a reader can be told which row was given up on");
});

test("#1239 a run with nothing parked reports parked: 0 and is otherwise unchanged", () => {
  // THE NEGATIVE CONTROL. `parked` must be a count that can be zero, not a field that only appears when
  // something is wrong — an absent key makes its absence a claim.
  const u = unionCoverageForm(null, null, INPUT);
  assert.equal(u.parked, 0);
  assert.equal(u.total, u.settled + u.parked + u.outstanding);
  assert.deepEqual(parkedCoverageRows(u.form), []);
});
