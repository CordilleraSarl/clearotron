// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — ONE STORE, TWO TIERS.
//
// `hardening` scenarios (R100+) are deep clearances costing hours and real money each, gated on the
// owner's per-run yes. `standing` is the suite an operator runs as a round. They live in ONE store.
//
// WHAT PROTECTS THE MONEY, and it is not this field: nothing in the tree runs more than one scenario.
// `run` takes exactly one ID and refuses without it; the three `allScenarios()` readers are the store
// sweep, `list` and `status`, none of which executes a clearance. So a hardening scenario runs only when
// somebody types its ID. The tier field tells a reader which scenarios make up the standing set — it is
// not a filter standing between the store and a set-runner, because there is no set-runner.
//
// WHY AN UNKNOWN TIER REFUSES WHILE AN UNKNOWN `markProvenance` DEGRADES. The two sit side by side and
// behave oppositely, and the next reader will want to "fix" one to match the other. Provenance is a
// CLAIM about what a scenario proves, so "cannot tell" is the honest answer and costs nothing. Tier is a
// SELECTION KEY: a typo that quietly resolves to the default either enrols something expensive or drops
// something somebody meant to run. Which of the two you make consistent decides whether the failure is a
// silent gap or a silent bill.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tierOf, SCENARIO_TIERS, DEFAULT_TIER } from "../e2e-rounds.mjs";
import { lintScenarios } from "../../scripts/e2e.mjs";

const sc = (id, extra = {}) => ({ id, __file: `${id}.json`, cost: { wallMinutes: 12 }, ...extra });

test("#1914 — an absent tier is `standing`, and that is a real default rather than a shrug", () => {
  assert.equal(tierOf({}), "standing");
  assert.equal(tierOf({ tier: undefined }), "standing");
  assert.equal(tierOf({ tier: null }), "standing");
  assert.equal(tierOf({ tier: "  " }), "standing");
  assert.equal(DEFAULT_TIER, "standing");
  // The thirteen scenarios that predate the field need no edit — that is the point of the default.
  assert.equal(tierOf({ id: "R0" }), DEFAULT_TIER);
});

test("#1914 — both tiers read back, and the vocabulary is closed", () => {
  for (const t of SCENARIO_TIERS) assert.equal(tierOf({ tier: t }), t);
  assert.deepEqual([...SCENARIO_TIERS], ["standing", "hardening"]);
});

test("#1914 — an unrecognised tier THROWS and names the value, never picking a tier for you", () => {
  // `standng` is the exact failure this exists for: one keystroke, and a hardening scenario joins the
  // standing set — or a standing one silently leaves it.
  assert.throws(() => tierOf({ tier: "standng" }), /tier "standng" is not one of: standing, hardening/);
  assert.throws(() => tierOf({ tier: "Standing" }), /not one of/, "case is not silently normalised");
  // A non-string refuses on its TYPE, before any coercion: `["hardening"]` used to stringify to a
  // valid value and be accepted, which is a shape typo picking a tier silently.
  assert.throws(() => tierOf({ tier: 1 }), /tier must be a string, not number/);
  assert.throws(() => tierOf({ tier: ["hardening"] }), /tier must be a string, not an array/);
  assert.throws(() => tierOf({ tier: { name: "hardening" } }), /tier must be a string, not object/);
});

test("#1914 — a bad tier becomes ONE labelled store finding, so #659's scoping applies to it unchanged", () => {
  // This is the whole of the scope design and the reason the check sits in the lint rather than at a
  // selection site. `sweepStoreOrDie()` bare (cmdList) refuses on any scenario's finding;
  // `sweepStoreOrDie(id)` (cmdRun) matches findings by the scenario's id LABEL and refuses only on its
  // own. Both fall out of the label below — nothing here re-decides scope, and the scoping itself is
  // held by driver/test/e2e-store-sweep-scope.test.mjs.
  const { wrong } = lintScenarios([sc("R7"), sc("R151", { tier: "standng" }), sc("R150", { tier: "hardening" })]);
  const tierFindings = wrong.filter((w) => /tier /.test(w));
  assert.equal(tierFindings.length, 1, "exactly one scenario is at fault");
  assert.match(tierFindings[0], /^R151: /, "the finding carries the scenario's id, or a scoped run cannot match it");
  // The two well-formed scenarios contribute nothing — a valid `hardening` is not a defect.
  assert.equal(wrong.filter((w) => /^R150: /.test(w)).length, 0);
  assert.equal(wrong.filter((w) => /^R7: /.test(w)).length, 0);
});

test("#1914 — a store where every tier is readable produces no tier finding at all", () => {
  // The control. Without it, an arm that always found one finding would pass this file's other arm and
  // still be measuring nothing.
  const { wrong } = lintScenarios([sc("R0"), sc("R7", { tier: "standing" }), sc("R150", { tier: "hardening" })]);
  assert.deepEqual(wrong.filter((w) => /tier /.test(w)), []);
});
