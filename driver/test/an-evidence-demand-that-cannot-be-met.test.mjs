// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — the `evidence_owed` agreement guard: one contract, two ends, and only one of them could say the
// work was impossible.
//
// 's class is "a demand computed against one unit or snapshot, satisfaction enforced against another,
// with no guard asserting the two agree". This is that, at the seam named:
//
//   SET        `evidence_owed` = `quote_required`, copied forward from form-build
//   ENFORCED   `segmentBinding` against the candidate's snippet AS IT IS NOW
//
// Candidates regenerate between the two. When they come back with no quotable passage the flag survives
// and its justification does not.
//
// THE CALL PATH ALREADY KNEW, WHICH IS WHAT MAKES THIS A DISAGREEMENT RATHER THAN A GAP. Send such a row
// and it is refused with `no_segments` — "a driver fault, not yours; do not re-send this row" — or
// `segment_dead_end` — "this row cannot be evidenced at all". The OUTSTANDING path reported
// `evidence_owed` unconditionally, so the answer kept printing "needs `segment_index` and `fragment`" for
// a row on which neither can ever bind. The seat cannot reason its way out of that, and 's comment
// records a run that died owing one row after 116 further calls.

import { test } from "node:test";
import assert from "node:assert/strict";
import { callAnswer, evidenceSatisfiable } from "../disposition-call.mjs";
import { outstandingWithAnchors } from "../disposition-tool.mjs";
import { livePassages } from "../connotation-search.mjs";

/** A passage long enough to quote from, by the same measure the binder uses. */
const LIVE = "The applicant's mark is used on retail services for clothing and footwear in Switzerland.";
const DEAD = "...";

test("#1100 the fixture is real — LIVE quotes and DEAD does not, by the binder's own measure", () => {
  // Without this the arms below could all pass over a fixture the binder would reject anyway, which is the
  // vacuous shape every one of them exists to catch elsewhere.
  assert.ok(livePassages(LIVE).length >= 1, "the LIVE fixture carries no quotable passage");
  assert.equal(livePassages(DEAD).length, 0, "the DEAD fixture is quotable — the arms below prove nothing");
});

test("#1100 a demand whose candidates carry nothing quotable is UNSATISFIABLE", () => {
  const row = { row_id: "r1", quote_required: true, candidates: [{ receipt_id: "rc1", snippet: DEAD }] };
  assert.equal(evidenceSatisfiable(row, {}), false);
  assert.equal(evidenceSatisfiable({ ...row, candidates: [{ receipt_id: "rc1", snippet: LIVE }] }, {}), true);
});

test("#1100 BEFORE a ruling, ANY candidate with a live passage makes the demand satisfiable", () => {
  // A demand is only impossible when no choice the seat could make would work. Testing the first candidate
  // alone would refuse rows the seat can still discharge by picking a different receipt.
  const row = { row_id: "r1", quote_required: true,
    candidates: [{ receipt_id: "rc1", snippet: DEAD }, { receipt_id: "rc2", snippet: LIVE }] };
  assert.equal(evidenceSatisfiable(row, {}), true);
});

test("#1100 AFTER a ruling only the CHOSEN receipt counts — a live sibling does not rescue it", () => {
  // Once the seat has ruled, `segmentBinding` reads that receipt's snippet and no other. Pooling the
  // siblings here would call a row satisfiable that the enforcement end will refuse — the two ends
  // disagreeing again, in the direction that keeps the live-lock.
  const row = { row_id: "r1", quote_required: true,
    candidates: [{ receipt_id: "rc1", snippet: DEAD }, { receipt_id: "rc2", snippet: LIVE }] };
  assert.equal(evidenceSatisfiable(row, { receipt_id: "rc1" }), false);
  assert.equal(evidenceSatisfiable(row, { receipt_id: "rc2" }), true);
});

test("#1100 the outstanding row CARRIES the answer, so the two ends cannot drift apart again", () => {
  const canonical = [{ row_id: "r1", quote_required: true, candidates: [{ receipt_id: "rc1", snippet: DEAD }] }];
  const [row] = outstandingWithAnchors(canonical, []);
  assert.equal(row.evidence_owed, true);
  assert.equal(row.evidence_unsatisfiable, true,
    "the outstanding path still reports a demand the call path would refuse as impossible");
});

test("#1100 a SATISFIABLE demand says so explicitly — absent is not false", () => {
  // Written whenever evidence is owed, including `false`. An omitted key cannot be told from a row emitted
  // before this existed, and the answer branches on it.
  const canonical = [{ row_id: "r1", quote_required: true, candidates: [{ receipt_id: "rc1", snippet: LIVE }] }];
  const [row] = outstandingWithAnchors(canonical, []);
  assert.ok("evidence_unsatisfiable" in row, "the key is absent on a satisfiable row");
  assert.equal(row.evidence_unsatisfiable, false);
});

test("#1100 a row owing NO evidence carries no verdict about evidence it does not owe", () => {
  const canonical = [{ row_id: "r1", quote_required: false, candidates: [{ receipt_id: "rc1", snippet: DEAD }] }];
  const [row] = outstandingWithAnchors(canonical, []);
  assert.equal(row.evidence_owed, false);
  assert.equal("evidence_unsatisfiable" in row, false,
    "a row that owes no evidence was given an opinion about whether it could supply it");
});

test("#1100 the ANSWER stops demanding the impossible, and names the remedy the refusal path already gives", () => {
  // The live-lock, closed. Before this the seat was told to supply a fragment on a row where no fragment
  // can bind — the one instruction it cannot follow — and nothing in the answer said so.
  const impossible = callAnswer({ accepted: [], refused: [], overflow: [] },
    [{ row_index: 3, evidence_owed: true, evidence_unsatisfiable: true, ruled: true }]);
  assert.match(impossible, /CANNOT be evidenced/);
  assert.match(impossible, /Do not keep re-sending it/);
  assert.match(impossible, /obstacle/, "and it must name the act that DOES discharge the row");
  assert.doesNotMatch(impossible, /needs `segment_index`/,
    "the answer still asked for a segment_index on a row where none can ever bind");

  // The ordinary demand is untouched — a guard that silenced every demand would close the live-lock by
  // deleting the obligation, which is the expensive direction to be wrong in.
  const ordinary = callAnswer({ accepted: [], refused: [], overflow: [] },
    [{ row_index: 3, evidence_owed: true, evidence_unsatisfiable: false, ruled: true }]);
  assert.match(ordinary, /needs `segment_index`/);
  assert.doesNotMatch(ordinary, /CANNOT be evidenced/);
});

test("#1100 a row with no verdict at all keeps the ordinary demand — this never fails toward silence", () => {
  // Archived forms and pure-core callers emit rows without the field. Reading a missing verdict as
  // "unsatisfiable" would tell a seat to give up on rows it could have evidenced.
  const legacy = callAnswer({ accepted: [], refused: [], overflow: [] },
    [{ row_index: 1, evidence_owed: true, ruled: false }]);
  assert.match(legacy, /needs `segment_index`/);
  assert.doesNotMatch(legacy, /CANNOT be evidenced/);
});
