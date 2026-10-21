// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A GAP A GUARD FINDS CLOSED WHEN IT IS JUDGED AGAIN GIVES BACK ONLY THE RESULT IT MOVED.
//
// The floor, the writer's duty and the recall gate are judged again after the delivery check repeats placement or re-runs
// the writer. A gap whose account was read, could be computed and finds nothing open takes its own clause with it, and
// the result is recomputed from the accepted assessment and the conditions still standing. Three cases, as ruled on
// 2026-10-19: a closed gap that was the only condition gives CLEAR back; a closed gap beside a condition that still
// stands leaves CONDITIONAL; an account that is absent, unreadable or not computable closes nothing, and the clause
// stays. The third is driven here, at the decision, for every guard: no mock setting makes an account unavailable at
// the second judgment without breaking the run some other way.
import { test } from "node:test";
import assert from "node:assert/strict";
import { gapPositivelyClosed, verdictWithoutTheClosedGap } from "../terminal-clamp.mjs";
import { floorDutyClosed, floorDutyBlock } from "../floor-duty.mjs";

const FLOOR = "floor_duty_undischarged", DUTY = "synthesis_unaccounted_delivered", RECALL = "recall_reconciliation_unended";
const floorAccount = (undischarged) => ({ computable: true, undischarged_by_seat: undischarged, totals: { floors: 3 }, rows: [] });

test("a floor account closes the gap only when the floor is armed, its account was computed and nothing is undischarged", () => {
  assert.equal(floorDutyClosed(floorAccount(0), { armed: true }), true, "an armed, computed floor with nothing open did not close");
  for (const [why, account, armed] of [
    ["one floor still open", floorAccount(1), true],
    ["the floor is not armed", floorAccount(0), false],
    ["the account could not be computed", { computable: false, reason: "no band-shape.json" }, true],
    ["the account is absent or unreadable", null, true],
  ]) {
    assert.equal(floorDutyClosed(account, { armed }), false, `${why}, and the gap read as closed`);
  }
  // the two judgments of one account never both hold: a gap is open, closed, or unknown
  for (const [account, armed] of [[floorAccount(0), true], [floorAccount(2), true], [null, true], [floorAccount(0), false]])
    assert.ok(!(floorDutyClosed(account, { armed }) && floorDutyBlock(account, { armed })), "one account read as both open and closed");
  assert.equal(gapPositivelyClosed(FLOOR, { floorClosed: true }), true);
  assert.equal(gapPositivelyClosed(FLOOR, {}), false, "a floor nobody judged read as closed");
});

test("the writer's duty closes its gap only on a computed duty with no record unaccounted", () => {
  assert.equal(gapPositivelyClosed(DUTY, { duty: { computable: true, unaccounted: [], totals: { owed: 4 } } }), true);
  for (const [why, duty] of [
    ["a record is still unaccounted", { computable: true, unaccounted: [{ uri: "/mark/xx/1" }], totals: { owed: 4 } }],
    ["the duty could not be computed", { computable: false, reason: "no declination spec" }],
    ["the duty is absent", null],
    ["the duty carries no list of unaccounted records", { computable: true }],
  ]) {
    assert.equal(gapPositivelyClosed(DUTY, { duty }), false, `${why}, and the gap read as closed`);
  }
});

test("the recall gate closes its gap only on a computed reconciliation with nothing unended and no record left out", () => {
  const rec = (unended) => ({ computable: true, totals: { candidates: 9, unended }, unended: [] });
  assert.equal(gapPositivelyClosed(RECALL, { recall: rec(0) }), true);
  for (const [why, recall, leftOut] of [
    ["a record still ends nowhere", rec(1), []],
    ["a refused merge left a record out", rec(0), ["/mark/xx/7"]],
    ["the reconciliation could not be computed", { computable: false, reason: "no merged register band" }, []],
    ["the reconciliation is absent", null, []],
  ]) {
    assert.equal(gapPositivelyClosed(RECALL, { recall, leftOut }), false, `${why}, and the gap read as closed`);
  }
  assert.equal(gapPositivelyClosed("some_other_guard", { recall: rec(0), floorClosed: true }), false, "a guard with no rule here closed a gap");
});

test("a closed gap that was the only condition gives back CLEAR, the result the review reached", () => {
  assert.equal(verdictWithoutTheClosedGap({ verdict: "CONDITIONAL", assessed: "CLEAR", reasons: [] }), "CLEAR");
});

test("a closed gap beside a condition that still stands leaves the result CONDITIONAL", () => {
  assert.equal(verdictWithoutTheClosedGap({ verdict: "CONDITIONAL", assessed: "CLEAR",
    reasons: ["the lawyer judged a material slice not fully cleared: the class 9 slice"] }), "CONDITIONAL");
});

test("a result the review itself made CONDITIONAL or BLOCKING is never lifted, and nothing else moves", () => {
  assert.equal(verdictWithoutTheClosedGap({ verdict: "CONDITIONAL", assessed: "CONDITIONAL", reasons: [] }), "CONDITIONAL",
    "a review that said CONDITIONAL, or hardened to it late, was lifted by a closed gap");
  assert.equal(verdictWithoutTheClosedGap({ verdict: "BLOCKING", assessed: "BLOCKING", reasons: [] }), "BLOCKING");
  assert.equal(verdictWithoutTheClosedGap({ verdict: "BLOCKING", assessed: "CLEAR", reasons: [] }), "BLOCKING",
    "a BLOCKING result was relaxed");
  assert.equal(verdictWithoutTheClosedGap({ verdict: "CLEAR", assessed: "CLEAR", reasons: [] }), "CLEAR");
  assert.equal(verdictWithoutTheClosedGap({ verdict: "CONDITIONAL", reasons: [] }), "CONDITIONAL", "an unknown assessment gave CLEAR back");
});
