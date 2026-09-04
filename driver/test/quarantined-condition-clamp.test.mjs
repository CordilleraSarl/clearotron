// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — A CONDITION THAT FAILS VALIDATION MUST NOT RELAX THE VERDICT.
//
// The defect: `parseFindingsJsonLenient` drops an action that fails `validateAction`, and the
// deliver-conditional floor reads that parser's output. So a malformed condition did not fail
// loudly — it stopped conditioning the verdict, and the run delivered CLEAR. The defect and the
// relaxation were the same event.
//
// These tests assert BOTH HALVES TOGETHER, because either alone is misleading: the surviving
// conditions go to zero (that is the relaxation, and it is still true — the action really is
// unusable) while the quarantine rows report one (that is the guard). A test that only checked the
// guard would pass on a build where the drop had been silently repaired upstream instead.
import test from "node:test";
import assert from "node:assert/strict";
import { parseFindingsJsonLenient, deriveActionConditions, quarantinedConditionRows, salvageRepairTargets,
  FINDINGS_SCHEMA_VERSION } from "../findings-model.mjs";

const doc = (actions) => JSON.stringify({
  schema_version: 4, rated_under_framework: "house-default",
  findings: [], coverage: [], actions,
});

// A RUN-LEVEL condition action: `ordinals: []` references nothing, so no finding validation is
// involved and the action path is isolated. This is also the shape the round's orphan had.
const conditionAction = (extra = {}) =>
  ({ id: 1, kind: "senior-clearance", text: "Clear the senior right before launch.", ordinals: [], ...extra });

test("the defect: a malformed CONDITION action leaves the floor's condition set EMPTY", () => {
  const clean = parseFindingsJsonLenient(doc([conditionAction()]));
  assert.equal(deriveActionConditions(clean.actions, clean.findings).conditions.length, 1,
    "the control is broken: a well-formed condition action must produce one condition, or this test proves nothing about the malformed one");
  assert.deepEqual(quarantinedConditionRows(clean.actionsQuarantined), [],
    "a well-formed action must not read as a dropped condition — that would clamp every clean run");

  // The SAME action, one unknown key. Nothing else differs.
  const broken = parseFindingsJsonLenient(doc([conditionAction({ bogus_key: 1 })]));
  assert.equal(broken.actions.length, 0, "the action was not dropped — this build no longer reproduces the defect this guard exists for");
  assert.equal(deriveActionConditions(broken.actions, broken.findings).conditions.length, 0,
    "the relaxation: the floor's condition set is empty because the condition was dropped");

  // …and the guard sees it anyway.
  const suspect = quarantinedConditionRows(broken.actionsQuarantined);
  assert.equal(suspect.length, 1, "the dropped condition is invisible to the guard — CLEAR is reachable over an unread condition");
  assert.equal(suspect[0].kind, "senior-clearance");
  assert.match(suspect[0].error, /finding_action_key_unknown/);
});

test("the quarantine row CARRIES the raw kind — without it the caller cannot tell a condition from an advisory", () => {
  const d = parseFindingsJsonLenient(doc([conditionAction({ bogus_key: 1 })]));
  assert.equal(d.actionsQuarantined.length, 1);
  assert.equal(d.actionsQuarantined[0].kind, "senior-clearance",
    "the row must record the kind read RAW off the rejected object; { index, id, error } is enough to log and not enough to act");
  assert.equal(d.actionsQuarantined[0].id, 1);
});

test("an ADVISORY drop does NOT clamp — the arm can return empty, so its non-empty answers mean something", () => {
  const d = parseFindingsJsonLenient(doc([
    { id: 1, kind: "monitoring", text: "Watch the register.", ordinals: [], bogus_key: 1 },
  ]));
  assert.equal(d.actions.length, 0, "the advisory action was expected to be dropped by the same defect");
  assert.equal(d.actionsQuarantined[0].kind, "monitoring");
  assert.deepEqual(quarantinedConditionRows(d.actionsQuarantined), [],
    "a readable advisory kind must clear — a guard that clamps on every drop would make the verdict a function of any typo");
});

test("AN UNREADABLE KIND READS AS A CONDITION — the direction is the design", () => {
  // Each of these is a state where we know LESS about what was demanded than the advisory case, so
  // none of them may be the state that clears. `kind` comes off an object the validator already
  // rejected: it is untrusted input, and the only trust placed in it is a compare against the enum.
  const cases = {
    "kind missing entirely": { id: 1, text: "Do the thing.", ordinals: [] },
    "kind not a string": { id: 1, kind: 7, text: "Do the thing.", ordinals: [] },
    "kind unknown to this build": { id: 1, kind: "future-kind-we-do-not-have", text: "Do the thing.", ordinals: [] },
  };
  for (const [name, action] of Object.entries(cases)) {
    const d = parseFindingsJsonLenient(doc([action]));
    assert.equal(d.actions.length, 0, `${name}: expected the action to be dropped`);
    assert.equal(quarantinedConditionRows(d.actionsQuarantined).length, 1,
      `${name}: an unreadable kind cleared the guard — the least-known state must never be the state that ships CLEAR`);
  }
});

test("a wholly malformed `actions` field reads as a condition — nothing is known about what it held", () => {
  const d = parseFindingsJsonLenient(JSON.stringify({
    schema_version: 4, rated_under_framework: "house-default",
    findings: [], coverage: [], actions: { id: 1, kind: "senior-clearance" },   // an OBJECT, not an array
  }));
  assert.equal(d.actionsQuarantined.length, 1);
  assert.equal(d.actionsQuarantined[0].index, -1);
  assert.equal(quarantinedConditionRows(d.actionsQuarantined).length, 1,
    "the whole register was unreadable and the run still cleared the guard — this is the largest possible drop reading as the smallest");
});

test("NEGATIVE CONTROL — the predicate is not a constant", () => {
  // Driven against planted rows rather than parser output: without this, every assertion above is
  // consistent with a function that returns its input.
  assert.deepEqual(quarantinedConditionRows([{ id: 1, kind: "monitoring" }, { id: 2, kind: "client-fact" }]), [],
    "the predicate does not clear readable advisory kinds");
  assert.equal(quarantinedConditionRows([{ id: 1, kind: "consent" }, { id: 2, kind: "monitoring" }]).length, 1,
    "the predicate does not separate a condition from an advisory in one list");
  assert.deepEqual(quarantinedConditionRows(null), [], "a missing quarantine list is not a drop");
  assert.deepEqual(quarantinedConditionRows(undefined), [], "an absent quarantine list is not a drop");
});

// ── — THE POPULATION THE SALVAGE LANE CAN NAME ──────────────────────────────────────────────
//
// The lane admits a failure by REGEX over its token and repairs it out of the QUARANTINE LISTS. Those
// are two populations, and when they disagree the lane accepts a defect it cannot describe to anybody.
// `salvageRepairTargets` is that decision in one place so the disagreement is assertable here rather
// than only reachable by driving a whole run to exhaustion.
test("#1101: every repairable family is COUNTED, and a clean parse counts zero", () => {
  // findings: [] deliberately — the per-family cases below each plant exactly one malformed object, so
  // a valid finding in the base would only add a way for this test to fail for an unrelated reason.
  //
  // THE VERSION IS THE CURRENT DICTATED ONE, IMPORTED, and it matters: `ask_answers` only became a legal
  // top-level key at v5, so at v4 a malformed one is `findings_key_unknown:ask_answers` — the PLURAL
  // token, which the salvage lane's own `!/:findings_/` guard excludes. Its per-entry errors are the
  // SINGULAR `finding_ask_answer_*`, and those are what the lane admits. Pinning the literal 4 here
  // would have tested a version where the hole does not exist.
  const base = { schema_version: FINDINGS_SCHEMA_VERSION, rated_under_framework: "house-default", coverage: [], findings: [] };
  const parse = (extra) => parseFindingsJsonLenient(JSON.stringify({ ...base, ...extra }));

  assert.deepEqual(salvageRepairTargets(parse({})), { findings: 0, actions: 0, askAnswers: 0, total: 0 },
    "a clean doc must count ZERO — this is the value the guard fires on, so it has to be reachable");

  const perFamily = {
    findings: { findings: [{ ordinal: 1, mark: "ALPHA", bogus: 1 }] },
    actions: { actions: [{ id: 1, kind: "consent", text: "Do it.", ordinals: [], bogus: 1 }] },
    askAnswers: { ask_answers: [{ ask: "a", answer: "b", bogus: 1 }] },
  };
  for (const [family, extra] of Object.entries(perFamily)) {
    const t = salvageRepairTargets(parse(extra));
    assert.equal(t[family], 1, `${family}: the malformed object is not counted — the lane would admit this token and have nothing to name`);
    assert.equal(t.total, 1, `${family}: exactly one target expected`);
  }
});

test("#1101: NEGATIVE CONTROL — the counter is not a constant and tolerates a missing list", () => {
  assert.deepEqual(salvageRepairTargets(null), { findings: 0, actions: 0, askAnswers: 0, total: 0 });
  assert.deepEqual(salvageRepairTargets({ quarantined: [{}, {}], actionsQuarantined: [{}], askAnswersQuarantined: [] }),
    { findings: 2, actions: 1, askAnswers: 0, total: 3 }, "counts do not collapse across families");
});
