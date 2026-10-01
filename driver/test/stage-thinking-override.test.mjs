// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// CLEAROTRON_STAGE_THINKING — the A/B instrument for stage effort. The suite flips arms with it; production
// flips the committed literal. It must fail LOUD on a bad spec: effortFor() silently falls back to
// "medium" for an unknown tier, so a typo would run a stage at a tier nobody chose and every number
// measured against it would be a lie.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { STAGES, stageThinkingOverride, thinkingFor, chainEntries } from "../stages.mjs";

const saved = process.env.CLEAROTRON_STAGE_THINKING;
beforeEach(() => { delete process.env.CLEAROTRON_STAGE_THINKING; });
afterEach(() => { if (saved === undefined) delete process.env.CLEAROTRON_STAGE_THINKING; else process.env.CLEAROTRON_STAGE_THINKING = saved; });

test("unset: every stage keeps its declared tier", () => {
  assert.equal(stageThinkingOverride("owner-judgment"), undefined);
  assert.equal(thinkingFor("owner-judgment"), STAGES["owner-judgment"].thinking);
  assert.equal(thinkingFor("synthesis"), STAGES["synthesis"].thinking);
});

test("an override pins one stage and leaves every other stage alone", () => {
  process.env.CLEAROTRON_STAGE_THINKING = "owner-judgment=medium";
  assert.equal(thinkingFor("owner-judgment"), "medium");
  assert.equal(thinkingFor("synthesis"), STAGES["synthesis"].thinking, "an arm must move ONE variable");
  // the chain's primary entry carries it too — otherwise the arm would run at the declared tier
  assert.equal(chainEntries("owner-judgment")[0].thinking, "medium");
});

test("multiple stages, whitespace tolerated, read per call so an arm can flip mid-process", () => {
  process.env.CLEAROTRON_STAGE_THINKING = " owner-judgment=low , synthesis = high ";
  assert.equal(thinkingFor("owner-judgment"), "low");
  assert.equal(thinkingFor("synthesis"), "high");
  process.env.CLEAROTRON_STAGE_THINKING = "owner-judgment=max";
  assert.equal(thinkingFor("owner-judgment"), "max", "never memoised on first read");
});

test("a bad spec throws rather than quietly running a tier nobody chose", () => {
  process.env.CLEAROTRON_STAGE_THINKING = "owner-judgment=hgih";
  assert.throws(() => thinkingFor("owner-judgment"), /unknown thinking tier "hgih"/);
  process.env.CLEAROTRON_STAGE_THINKING = "owenr-judgment=low";
  assert.throws(() => thinkingFor("owner-judgment"), /unknown stage "owenr-judgment"/);
  process.env.CLEAROTRON_STAGE_THINKING = "owner-judgment";
  assert.throws(() => thinkingFor("owner-judgment"), /is not <stage>=<tier>/);
  // …and a typo in an entry for ANOTHER stage still throws: a half-valid spec means the arm is not the
  // arm the operator asked for, whichever stage is being resolved at the moment it is noticed.
  process.env.CLEAROTRON_STAGE_THINKING = "owner-judgment=low,synthesis=hihg";
  assert.throws(() => thinkingFor("owner-judgment"), /unknown thinking tier "hihg"/);
});

test("the tiers that stay high stay high", () => {
  // synthesis sets client-facing risk bands (1.42-1.69x against a 1.19x control — barely above its own
  // noise), and clearance-variants decides what is searched at all (its low arm produced 39 variants against
  // production's 56 — a narrower search, not a cheaper one). The two judges of step 3 run at the tier the
  // judging stages they replaced ran at.
  assert.equal(STAGES["synthesis"].thinking, "high");
  assert.equal(STAGES["clearance-variants"].thinking, "high");
  assert.equal(STAGES["owner-judgment"].thinking, "high");
});
