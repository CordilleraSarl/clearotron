// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-conditional-with-nothing-stated-prints-no-conditional-line.test.mjs — a CONDITIONAL verdict whose every
// condition was ruled to the run record carries the band word alone, and the delivery check accepts it.
//
// The shape (2026-09-18): the screen-gate condition's client sentence is stored as null, so where it is
// the only condition the client's list is empty, and the verdict line fell back to "conditional on: the
// open conditions carried in the report" — a conditional with no condition behind it. The owner ruled the
// line off (2026-09-19). The pre-delivery check had required "conditional on:" on every conditional-stance
// statement, so it has to stop requiring it where nothing is stated, and only there.
import { test } from "node:test";
import assert from "node:assert/strict";
import { riskStatement, verdictStance } from "../findings-model.mjs";
import { statementCoherenceChecks } from "../predelivery-lint.mjs";

const RULED = "2 in-scope mark(s) dropped on goods could not be verified: A, B";
const sidecar = (over = {}) => {
  const doc = { verdict: "CONDITIONAL", tier: "High", reasons: [RULED], clauses: [null], stance: verdictStance("CONDITIONAL"), ...over };
  return { ...doc, statement: over.statement ?? riskStatement(doc) };
};
const failing = (doc) => statementCoherenceChecks({ verdictDoc: doc }).filter((c) => !c.pass).map((c) => c.id ?? c.name ?? c.check);

test("the only condition ruled to the run record: the statement is the band word, with no conditional line", () => {
  const doc = sidecar();
  assert.equal(doc.statement, "High");
  assert.doesNotMatch(doc.statement, /conditional on|open conditions carried/);
  assert.equal(doc.stance, "conditional", "the structured stance still says conditional to every consumer that keys on it");
});

test("the delivery check accepts that statement, and still refuses the form missing where something IS stated", () => {
  assert.deepEqual(failing(sidecar()), [], "a conditional with nothing stated was refused for lacking 'conditional on:'");
  // THE CONTROL: a stated condition and a statement that drops it is still the defect the check exists for.
  const stated = sidecar({ clauses: ["the examiner's objection is unanswered"], reasons: ["Respond to the objection."], statement: "High" });
  assert.equal(failing(stated).length, 1, "a conditional statement that omits a stated condition passed");
  assert.deepEqual(failing(sidecar({ clauses: ["the examiner's objection is unanswered"], reasons: ["Respond to the objection."] })), [],
    "the ordinary conditional form stopped passing");
});
