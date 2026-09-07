// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — THE SEAT DECLARES THE PARK IT COULD ONLY EARN BY BEING REFUSED THIRTY TIMES.
//
// The bound (park-unrulable-row.test.mjs) stops one row killing a run. It is still a COUNTER reacting to
// thirty failures — the run pays every one of them before anything stops. This is the other half: a seat
// that already knows it cannot finish a row says so on the first call it knows, and the row parks then.
//
// WHAT THE EXIT IS FOR, SCOPED OFF THE FORENSICS RATHER THAN OFF THE BRIEF. Every one of the 217 refusals
// that killed the run was an EVIDENCE-duty refusal — fragment_unbound 106, fragment_absent 84,
// fragment_too_short 18, segment_* 4, and ZERO ruling_invalid or note_absent. The seat held its ruling the
// whole time; what it could not do was copy a fragment that binds. So the missing exit was never from the
// judgment, and the judgment already has one: prelim-common-law/SKILL.md dictates that a row that cannot
// responsibly be called benign or loaded is ruled `loaded` with the note saying what could not be
// established. A second way to decline a ruling would compete with that, and the same doctrine names an
// easier road past a hard row as the one outcome no gate detects.
//
// `obstacle` therefore waives the PROOF and nothing else. The ruling and note are still owed, still
// validated, and still carried onto the parked row — a lawyer reading "the seat read it as loaded and
// could not prove it read the passage" has something to act on; a bare gap has nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { connotationObligations, obligationRows, parseDispositionForm, MEANING_SEAT_FIELDS } from "../connotation-search.mjs";
import { unionDispositionForm } from "../disposition-union.mjs";
import { validateDispositionCall, CALL_REFUSALS, CALL_ROW_FIELDS } from "../disposition-call.mjs";

// Built inline rather than off a captured fixture, because the shipped meaning fixtures carry NO
// quote_required row — the evidence duty this file is about would never fire against them and every
// assertion below would pass while measuring nothing. The first test asserts that duty is live before it
// measures anything else.
const SNIPPET = "The 1871 Meridian race riot was a violent episode recorded in contemporary newspapers.";
const RECORDED = [
  { query: "a meaning query", results: [
    { id: "R-AAAA1111", title: "first", url: "https://e.test/1", snippet: SNIPPET },
    { id: "R-BBBB2222", title: "second", url: "https://e.test/2", snippet: "y".repeat(240) }] },
];
const OB = connotationObligations(RECORDED);
const owing = obligationRows(OB)[0];
// — its ADDRESS: the position of that row in the driver's list, which is what the seat sends now.
// It is the FIRST row the driver mints, so its address is 1. Read off the same call `owing` came from,
// because obligationRows returns fresh objects each time and an indexOf against a second call finds none.
const owingAt = 1;
const union = (prior, submitted, opts = {}) => unionDispositionForm(prior, submitted, OB, { half: "b", ...opts });
const call = (row) => validateDispositionCall([row], RECORDED);
// `receipt_index` is the POSITION, not an id — a multi-candidate row owes it before the evidence duty is
// even reached, and leaving it out makes this file measure `position_absent` instead of what it is about.
// — the address is the row's POSITION in the driver's obligation list, not an id the seat types.
const base = (over = {}) => ({ row_index: owingAt, ruling: "loaded", note: "contested sources; a human should look", receipt_index: 1, ...over });

test("#1233 THE PRODUCTION SHAPE: a ruling with no provable fragment is PARKED, not refused again", () => {
  // This is the row that died. It had a ruling and a note and could not produce a binding fragment, and
  // the driver told it to try again 217 times.
  const withoutObstacle = call(base());
  assert.equal(withoutObstacle.accepted.length, 0, "the fixture does not reproduce the evidence duty — this file is measuring nothing");
  assert.match(String(withoutObstacle.refused[0]?.reason ?? ""), /^(segment|fragment)_/,
    "the un-obstacled row must still be refused on the evidence duty, or the comparison below is empty");

  const r = call(base({ obstacle: "every passage in this snippet is an elision marker; there is nothing to copy" }));
  assert.equal(r.refused.length, 0, "the seat declared it cannot evidence the row and was refused anyway — the live-lock is intact");
  assert.equal(r.accepted.length, 1);
  assert.equal(r.accepted[0].parked_kind, "declared");
});

test("#1233 THE RULING IS CARRIED, NOT DISCARDED — the lawyer keeps the read", () => {
  const a = call(base({ obstacle: "nothing quotable in the snippet" })).accepted[0];
  assert.equal(a.ruling, "loaded", "the seat's judgment was thrown away to take the exit — a gap replaced a usable read");
  assert.equal(a.note, "contested sources; a human should look");
  assert.equal(a.obstacle, "nothing quotable in the snippet");
});

test("#1233 an obstacle DOES NOT excuse a judgment fault", () => {
  // The failure mode this scoping exists to prevent: `obstacle` becoming the easy road past a hard row.
  const noRuling = call({ row_index: owingAt, receipt_index: 1, note: "n", obstacle: "cannot quote" });
  assert.equal(noRuling.accepted.length, 0, "a row with no ruling took the exit — obstacle is not a substitute for judging");
  assert.equal(noRuling.refused[0].reason, "ruling_invalid");

  const noNote = call({ row_index: owingAt, receipt_index: 1, ruling: "benign", obstacle: "cannot quote" });
  assert.equal(noNote.accepted.length, 0, "a row with no note took the exit");
  assert.equal(noNote.refused[0].reason, "note_absent");

  const badRow = call({ row_index: 99, ruling: "benign", note: "n", obstacle: "cannot quote" });
  assert.equal(badRow.refused[0].reason, "row_position_invalid", "an obstacle laundered an address that names no obligation");
});

test("#1233 an EMPTY obstacle is refused by name, never treated as absent", () => {
  for (const empty of ["", "   "]) {
    const r = call(base({ obstacle: empty }));
    assert.equal(r.refused[0]?.reason, "obstacle_absent", `obstacle=${JSON.stringify(empty)} was silently ignored`);
  }
  assert.ok(CALL_REFUSALS.includes("obstacle_absent"), "the token is emitted but not declared — a reader of the ledger cannot resolve it");
});

test("#1233 THE TWO KINDS STAY APART, and the declared one never inherits the exhausted sentence", () => {
  const OBSTACLE = "the passage is an elision marker";
  const declared = union({ rows: [] }, { rows: [{ row_id: owing.row_id, ruling: "loaded", note: "n", obstacle: OBSTACLE, parked_kind: "declared" }] });
  const dRow = declared.form.rows.find((r) => r.row_id === owing.row_id);
  assert.equal(dRow.parked, true);
  assert.equal(dRow.parked_kind, "declared");
  assert.equal(dRow.parked_reason, OBSTACLE, "a declared park is describing itself with the seat's own sentence, or it is not");
  assert.doesNotMatch(dRow.parked_reason, /per-row bound/,
    "the declared park inherited the EXHAUSTED sentence — it would tell the lawyer this row was refused past a bound it never reached");

  const exhausted = union({ rows: [] }, { rows: [] }, { parkedIds: [owing.row_id] });
  const eRow = exhausted.form.rows.find((r) => r.row_id === owing.row_id);
  assert.equal(eRow.parked_kind, "exhausted");
  // The exhausted sentence is NOT this module's to write, and that is the fix rather than an omission.
  // It used to invent a generic one here, which made disposition-tool.mjs's informative writer — guarded
  // on emptiness — unreachable on every real park: live parks read "refused the per-row bound" while the
  // tool stood ready to say "refused 30 times without binding (bound 30)". The count and the bound are
  // exactly what a reader of an undecided row needs. Left empty here so the writer that HAS them can.
  assert.equal(String(eRow.parked_reason ?? "").trim(), "",
    "the union filled the exhausted sentence again — the tool's writer is guarded on emptiness and is unreachable");
  // …and the declared kind, which IS this module's to write, still gets the seat's own words. That pair
  // is the whole property: one writer per kind, neither borrowing the other's sentence.
  assert.equal(dRow.parked_reason, OBSTACLE);
});

test("#1233 the PRIOR kind wins — a later declaration cannot rewrite what the run actually spent", () => {
  const prior = { rows: [{ row_id: owing.row_id, parked: true, parked_kind: "exhausted", parked_reason: "refused the per-row bound without binding", parked_refusals: 30 }] };
  const u = union(prior, { rows: [{ row_id: owing.row_id, ruling: "loaded", note: "n", obstacle: "late declaration", parked_kind: "declared" }] });
  const row = u.form.rows.find((r) => r.row_id === owing.row_id);
  assert.equal(row.parked_kind, "exhausted", "thirty refusals were relabelled as a tidy declaration — the cost the ratio exists to count was erased");
  assert.equal(row.parked_refusals, 30);
});

test("#1233 A DECLARED PARK IS NOT A RULING — it never raises `ruled`", () => {
  const u = union({ rows: [] }, { rows: [{ row_id: owing.row_id, ruling: "loaded", note: "n", obstacle: "cannot quote", parked_kind: "declared" }] });
  assert.equal(u.parked, 1);
  const row = u.form.rows.find((r) => r.row_id === owing.row_id);
  assert.equal(row.parked, true);
  // The corpse of this defect was a narrative claiming "73 processed; 73 recorded" over a machine-checked
  // 72. A parked row that counted as ruled would rebuild that lie with the seat's own cooperation.
  assert.equal(u.ruled + u.parked + u.outstanding, u.total, "the three axes stopped partitioning the rows");
});

test("#1233 `parked_kind` SURVIVES THE ROUND TRIP — the parser rebuilds rows from a fixed key list", () => {
  // parseDispositionForm whitelists fields, so one not named there is dropped on the next read. Losing
  // `parked_kind` fails quietly: the row stays parked and simply forgets which kind it was, which is the
  // one comparison the declared exit is measured by.
  const u = union({ rows: [] }, { rows: [{ row_id: owing.row_id, ruling: "loaded", note: "n", obstacle: "cannot quote", parked_kind: "declared" }] });
  const reread = parseDispositionForm(JSON.stringify(u.form));
  assert.equal(reread.error, null);
  const row = reread.rows.find((r) => r.row_id === owing.row_id);
  assert.equal(row.parked_kind, "declared", "the kind did not survive a read — the declared:exhausted ratio cannot be measured");
});

test("#1233 THE WAIVER'S BOUNDARY IS DERIVED, not retyped — it covers every evidence arm and no judgment one", () => {
  // If a future evidence arm is added and this set is a hand-list, the seat gets told to retry the exact
  // thing it has just said it cannot do — the live-lock, back for one token.
  const evidence = CALL_REFUSALS.filter((r) => r.startsWith("segment_") || r.startsWith("fragment_"));
  // ── — THE FLOOR MOVED 5 → 3, AND THE TRIPWIRE IS WHY IT WAS A DECISION ────────────────────
  //
  // This arm's old message was "the evidence vocabulary shrank — re-check what the obstacle now waives",
  // and that is exactly what it caught. retired `fragment_absent`, `fragment_too_short` and
  // `fragment_unbound`: the pointer binds and a fragment is recorded rather than required, so no live
  // path emits them and `EVIDENCE_REFUSALS` narrows to the three `segment_*` faults.
  //
  // THE WAIVER IS UNCHANGED IN MEANING. An obstacle still excuses every evidence fault a seat can
  // actually meet, and still excuses no judgment fault — the set narrowed because the population of
  // reachable evidence faults narrowed, not because the boundary moved. That is the derivation working:
  // a hand-list would have kept waiving three tokens nothing can emit.
  //
  // The floor stays as a floor rather than an equality, so a NEW evidence arm still joins automatically;
  // it is 3 because that is what remains, and lowering it again should be as deliberate as this was.
  assert.ok(evidence.length >= 3, "the evidence vocabulary shrank — re-check what the obstacle now waives");
  assert.deepEqual(evidence.filter((r) => r.startsWith("fragment_")), [],
    "a fragment_* refusal is back in the LIVE vocabulary — #1172 retired them; if one is reachable again "
    + "the obstacle waiver must cover it, and this arm's floor is wrong");
  for (const judgment of ["ruling_invalid", "note_absent", "row_position_invalid", "duplicate_row", "identifier_supplied", "position_absent", "position_invalid"])
    assert.ok(!evidence.includes(judgment), `${judgment} would be waived by an obstacle — it is not an evidence fault`);
  assert.ok(MEANING_SEAT_FIELDS.includes("obstacle"), "the seat is not told it may send `obstacle`");
  assert.deepEqual([...CALL_ROW_FIELDS], ["row_index", ...MEANING_SEAT_FIELDS], "the two field lists drifted");
});
