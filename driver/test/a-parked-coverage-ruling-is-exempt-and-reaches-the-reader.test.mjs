// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A COVERAGE RULING THE TOOL PARKED IS NOT A MISSING STATUS, AND IT IS NOT SILENT.
//
// The coverage tool gives up on a row past its refusal bound and tells the step the run "will report them as
// unresolved". The register gate used to refuse that row as `no_status`, so the park never let the step finish, and
// every render dropped a row with no status, so no reader learned of it either. Here:
//   · the gate exempts a row the driver parked, and still refuses an otherwise identical row that was not parked;
//   · a step's call cannot park a row by sending the flag;
//   · the workbook's coverage judgment carries the parked unit as open, in the shipped words for a check left open,
//     and never the tool's own parking reason.
// Invented values only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findCoverageFormViolations } from "../coverage-form.mjs";
import { unionCoverageForm } from "../coverage-union.mjs";
import { coverageJudgmentRows, PARKED_JUDGMENT_NOTE } from "../coverage-rows-run.mjs";

const UNIT = "primary-sweep / exact: QUILVANTE [cl 9]";
const row = (extra = {}) => ({ row_id: "CD-invented-1", axis: "primary-sweep", kind: "block", unit: UNIT, status: null, reason: null, ...extra });
const PARKED = { parked: true, parked_refusals: 30, parked_reason: "refused 30 times without settling (bound 30) — parked unresolvable so the stage can complete" };

test("the gate exempts a row the driver parked, and still refuses the identical row that was not parked", () => {
  assert.deepEqual(findCoverageFormViolations([row(PARKED)]), [], "a parked ruling is refused as a missing status");
  const plain = findCoverageFormViolations([row()]);
  assert.equal(plain.length, 1, "an ordinary omission passed");
  assert.equal(plain[0].reason, "no_status");
  assert.deepEqual(findCoverageFormViolations([row(PARKED), row({ row_id: "CD-invented-2" })]).map((v) => v.row), ["CD-invented-2"],
    "a parked row excused its unparked neighbour");
});

test("a step's call cannot park a row by sending the flag", () => {
  const input = { skeleton: [{ axis: "primary-sweep", state: "ok", missing: [] }], plan: { entries: [{ axis: "primary-sweep", qid: "q1" }] },
    bandBlocksByAxis: {}, activeAxes: ["primary-sweep"] };
  const first = unionCoverageForm(null, null, input).form;
  const id = first.rows[0].row_id;
  const after = unionCoverageForm(first, { rows: [{ row_id: id, parked: true }] }, input);
  assert.notEqual(after.form.rows.find((r) => r.row_id === id)?.parked, true, "the call's flag parked the row");
  assert.ok(findCoverageFormViolations(after.form.rows).some((v) => v.row === id), "the row the call tried to park is still owed");
  const parkedByDriver = unionCoverageForm(first, null, input, { parkedIds: [id] });
  assert.equal(parkedByDriver.form.rows.find((r) => r.row_id === id)?.parked, true, "premise: the driver's own park is carried");
});

test("the workbook's coverage judgment carries the parked unit as open, without the tool's reason", () => {
  const rows = coverageJudgmentRows([], { missing: [], skeleton: [] }, null, [row(PARKED)]);
  assert.equal(rows.length, 1, "the parked ruling reached no row");
  assert.equal(rows[0].note, PARKED_JUDGMENT_NOTE);
  assert.equal(PARKED_JUDGMENT_NOTE, "not completed this run — it could not be completed this run, so it is left open here rather than reported as clean");
  assert.doesNotMatch(JSON.stringify(rows), /refused|parked|bound/i, "the tool's own reason reached the reader");
  assert.deepEqual(coverageJudgmentRows([], { missing: [], skeleton: [] }, null, [row()]), [], "an unparked row with no status is not published as open here");
});
