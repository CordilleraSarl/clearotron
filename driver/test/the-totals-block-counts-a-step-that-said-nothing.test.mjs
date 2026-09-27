// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// THE TOTALS BLOCK COUNTS THE RECORDS A STEP PASSED OVER, BESIDE THE ONES NOTHING SPOKE ABOUT.
//
// `record-carry.mjs`'s own header states the requirement: a reader who opens the file and sees
// `unreasoned: 0` must be able to tell that from "nothing was dropped anywhere in this run". On R18 of
// 2026-09-27 the totals block read `unreasoned: 0` beside 5,760 records the picking step had passed over.
// The count existed — in `by_reason_source` — one level below the block a reader opens first, so the
// loudest fact about that run was not in the answer.
//
// `unreasoned` IS NOT REDEFINED, and that is the point of the third arm. A shipped Machine QC check passes
// only on `unreasoned === 0` and its row reaches a client's workbook. Folding a passed-over record into
// that total would turn a green into a red on every run with a silent exit — a decision about what a client
// is told, not a correction to a record. So the new count sits beside it, exactly as `upstream_absent`
// already does for its own class.
import { test } from "node:test";
import assert from "node:assert/strict";
import { seamRows, foldDiscardLedger } from "../record-discard.mjs";
import { traceRecordCarry } from "../record-carry.mjs";

// Invented record addresses. Three records the step saw: one carried forward, one passed over with no
// ground, and one the ledger never mentions at all.
const CARRIED = "/mark/us/7001";
const PASSED_OVER = "/mark/us/7002";
const UNSPOKEN = "/mark/us/7003";
const band = [CARRIED, PASSED_OVER, UNSPOKEN].map((record_id) => ({ record_id }));

// BUILT BY THE PRODUCER. `seamRows` is what stamps `step-silent` when the step completed, saw a record,
// did not carry it and `reasonFor` gave no ground — so the fixture cannot drift from the literal the
// driver actually writes. `UNSPOKEN` is left out of `saw` so no ledger row exists for it.
const ledger = foldDiscardLedger(seamRows({
  seam: "placement", stage: "placement-inquiry", completed: true,
  saw: [{ uri: CARRIED }, { uri: PASSED_OVER }],
  carried: [{ uri: CARRIED }],
}).map((r) => JSON.stringify(r)).join("\n"));

const totals = () => traceRecordCarry({ bandRecords: band, ledger }).totals;

test("a record the step passed over is counted in the totals block", () => {
  assert.equal(totals().step_silent, 1,
    "the totals block does not carry the passed-over count, so a reader opening it sees unreasoned and "
    + "nothing about the records a step reached and said nothing about");
});

test("the two classes partition the drops: unreasoned is the absent rows and nothing else", () => {
  // ASSERTED AGAINST THE PRODUCER'S OWN TALLY rather than against numbers typed here. `by_reason_source`
  // is what the trace counted per source, so this holds the RELATIONSHIP — each total equals its own
  // class — and cannot pass because a fixture happened to produce the figure a previous draft guessed.
  //
  // My first draft asserted `unreasoned: 1` on a fixture where the carried record also lands `absent`,
  // because a ledger row saying "carried" is not a finding: the trace needs placements or findings to see
  // a record go forward. The fixture was wrong, not the count.
  const t = traceRecordCarry({ bandRecords: band, ledger });
  assert.equal(t.totals.unreasoned, t.by_reason_source.absent ?? 0,
    "unreasoned no longer equals the rows whose source is `absent`");
  assert.equal(t.totals.step_silent, t.by_reason_source["step-silent"] ?? 0,
    "the passed-over count no longer equals the rows the step passed over");
  assert.equal(t.totals.retrieved, 3, "premise: all three records reached the trace");
  assert.equal(t.totals.dropped, (t.by_reason_source.absent ?? 0) + (t.by_reason_source["step-silent"] ?? 0),
    "the two classes do not account for every drop in this fixture, so the partition claim is untested");
});

test("the passed-over count is NOT folded into unreasoned", () => {
  // THE ARM THAT PROTECTS A CLIENT-FACING CHECK. `record-carry-unreasoned` passes only on zero and its row
  // is Machine QC in the workbook. If these two ever become one number, every run with a silent exit fails
  // that check — which may be right, and is not this change's to decide.
  const t = traceRecordCarry({ bandRecords: band, ledger });
  assert.ok(t.totals.step_silent > 0, "premise: this fixture holds a passed-over record at all");
  assert.equal(t.totals.unreasoned, t.by_reason_source.absent ?? 0,
    "the passed-over rows have been folded into unreasoned, which fails a shipped client-facing check on "
    + "every run that has one");
});

test("a run with nothing passed over reports zero, not a missing field", () => {
  // An absent key would read as "this run was not asked", which is the shape this module exists to refuse.
  const clean = foldDiscardLedger(seamRows({
    seam: "placement", stage: "placement-inquiry", completed: true,
    saw: [{ uri: CARRIED }], carried: [{ uri: CARRIED }],
  }).map((r) => JSON.stringify(r)).join("\n"));
  const t = traceRecordCarry({ bandRecords: [{ record_id: CARRIED }], ledger: clean }).totals;
  assert.equal(t.step_silent, 0, "a clean run omits the field instead of stating a zero");
});
