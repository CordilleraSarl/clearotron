// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// M6 — the coverage artifact is always written, and an absence declares its cause.
//
// The tests are about the two ways this change could have made things worse, not about the happy path:
//
//   1. AN EMPTY FORM ACQUIRING AN ALIBI. `verify.mjs` refuses a zero-row form by name, and M6 adds one
//      exception. If that exception could be satisfied by any `absence` key at all, a driver that
//      simply failed to write rows would pass by accident — which is the bug the refusal exists for.
//   2. AN ABSENCE READING AS A PASS. A declared absence carries no rows, and `deriveCoverageStatus([])`
//      answers `{complete: true}`. The declaration reads correctly to a lawyer and says nothing to the
//      machine unless the gap is minted explicitly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //

import {
  COVERAGE_ABSENCE_CAUSES, buildCoverageAbsenceForm, coverageFormAbsence, coverageAbsenceGaps,
  renderCoverageAbsenceSection, parseCoverageForm,
} from "../coverage-form.mjs";
import { coverageFormInput, readCoverageFormInput } from "../coverage-form-io.mjs";
import { deriveCoverageStatus } from "../coverage-ledger.mjs";

const runDir = () => { const d = mkdtempSync(join(tmpdir(), "m6-")); mkdirSync(driverDir(d), { recursive: true }); return d; };
const cleanup = (d) => rmSync(d, { recursive: true, force: true });

// ── the cause is derived, and it names WHICH half was out of reach ──────────────────────────────────

test("the cause distinguishes the two conditions, because they are different facts about the run", () => {
  const d = runDir();
  try {
    assert.deepEqual(coverageFormInput(d), { input: null, absent: "no_plan_execution_receipt" });
    writeFileSync(driverDir(d, "plan-execution.json"), JSON.stringify({ skeleton: [], deferred: [] }));
    assert.equal(coverageFormInput(d).absent, "no_frozen_plan",
      "a receipt with no frozen plan is not the same run as one with no receipt at all");
    writeFileSync(driverDir(d, "register-plan.json"), JSON.stringify({ entries: [] }));
    assert.equal(coverageFormInput(d).absent, null);
    assert.ok(coverageFormInput(d).input, "and the input rides out on the same call");
  } finally { cleanup(d); }
});

test("ONE DERIVATION, TWO VIEWS — the pre-M6 shape still answers exactly as it did", () => {
  // Not decoration. Four defects in one day came from two functions asking the same question of the
  // same files, so the M6 view and the pre-M6 view are the same call read two ways.
  const d = runDir();
  try {
    assert.equal(readCoverageFormInput(d), null);
    writeFileSync(driverDir(d, "plan-execution.json"), JSON.stringify({ skeleton: [] }));
    writeFileSync(driverDir(d, "register-plan.json"), JSON.stringify({ entries: [] }));
    assert.ok(readCoverageFormInput(d), "and non-null in exactly the same case the new view calls present");
  } finally { cleanup(d); }
});

// ── the declaration is CHECKED, not trusted ─────────────────────────────────────────────────────────

test("an empty form cannot acquire an alibi by writing a word into itself", () => {
  // The whole safety of M6's exception. Anything that is not a cause the vocabulary carries reads as NO
  // declaration, so it falls to `coverage_form_empty` — the driver bug it is.
  for (const bad of [undefined, null, {}, { cause: "" }, { cause: "reasons" }, { cause: "no_plan" }, "no_frozen_plan", 7])
    assert.equal(coverageFormAbsence({ absence: bad }), null, `refused: ${JSON.stringify(bad)}`);
  assert.equal(coverageFormAbsence({}), null, "a form with no absence key at all");
  assert.equal(coverageFormAbsence(null), null);

  for (const cause of COVERAGE_ABSENCE_CAUSES)
    assert.deepEqual(coverageFormAbsence({ absence: { cause } }), { cause, detail: "" });
});

test("the declaration round-trips through the parser the seat's copy goes through", () => {
  const form = buildCoverageAbsenceForm({ cause: "no_frozen_plan", detail: "the plan freeze never ran" });
  const { rows, error, parsed } = parseCoverageForm(JSON.stringify(form));
  assert.equal(error, null);
  assert.deepEqual(rows, [], "zero rows, and zero rows is not a parse failure");
  assert.deepEqual(coverageFormAbsence(parsed), { cause: "no_frozen_plan", detail: "the plan freeze never ran" },
    "the absence survives the parse — verify.mjs reads it off exactly this object");
});

// ── an absence must not read as a pass ──────────────────────────────────────────────────────────────

test("A DECLARED ABSENCE IS A MATERIAL GAP — the zero would otherwise read as complete coverage", () => {
  // The trap, stated as the test. `deriveCoverageStatus` over no rows answers `complete: true`, so the
  // declaration would have been a sentence for the lawyer and silence for every machine reader.
  assert.deepEqual(deriveCoverageStatus([]), { complete: true, materialGaps: [] }, "the premise");

  const gaps = coverageAbsenceGaps(buildCoverageAbsenceForm({ cause: "no_frozen_plan" }));
  assert.equal(gaps.length, 1);
  assert.match(gaps[0].reason, /no_frozen_plan/, "and the gap names the cause, not just its existence");
  assert.match(gaps[0].reason, /none should be inferred/);
  assert.equal(gaps[0].status, "frame-gap");

  assert.deepEqual(coverageAbsenceGaps({ rows: [] }), [], "no declaration, no minted gap");
  assert.deepEqual(coverageAbsenceGaps({ absence: { cause: "made_up" } }), [],
    "…and an off-enum cause mints nothing either — it is already failing closed one gate up");
});

test("the rendered section states the cause and refuses the silence a reader would fill in", () => {
  // 's lesson one lane over: a heading with nothing under it asserts an absence it cannot explain.
  for (const cause of COVERAGE_ABSENCE_CAUSES) {
    const md = renderCoverageAbsenceSection({ cause });
    assert.match(md, /^## Coverage ledger/, "it occupies the section a reader looks for");
    assert.match(md, /No coverage ledger is available for this run/);
    assert.match(md, /No coverage claim — clean, limited or deferred — is made anywhere in this report/);
    assert.ok(md.length > 240, `the ${cause} rendering explains itself rather than announcing a blank`);
  }
  assert.match(renderCoverageAbsenceSection({ cause: "no_frozen_plan" }), /no set of slices to account for/);
  assert.match(renderCoverageAbsenceSection({ cause: "no_plan_execution_receipt" }), /which slices were dispatched/);
});
