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
  assert.equal(stageThinkingOverride("register-digest"), undefined);
  assert.equal(thinkingFor("register-digest"), STAGES["register-digest"].thinking);
  assert.equal(thinkingFor("synthesis"), STAGES["synthesis"].thinking);
});

test("an override pins one stage and leaves every other stage alone", () => {
  process.env.CLEAROTRON_STAGE_THINKING = "register-digest=high";
  assert.equal(thinkingFor("register-digest"), "high");
  assert.equal(thinkingFor("synthesis"), STAGES["synthesis"].thinking, "an arm must move ONE variable");
  // the chain's primary entry carries it too — otherwise the arm would run at the declared tier
  assert.equal(chainEntries("register-digest")[0].thinking, "high");
});

test("multiple stages, whitespace tolerated, read per call so an arm can flip mid-process", () => {
  process.env.CLEAROTRON_STAGE_THINKING = " register-digest=low , synthesis = high ";
  assert.equal(thinkingFor("register-digest"), "low");
  assert.equal(thinkingFor("synthesis"), "high");
  process.env.CLEAROTRON_STAGE_THINKING = "register-digest=max";
  assert.equal(thinkingFor("register-digest"), "max", "never memoised on first read");
});

test("a bad spec throws rather than quietly running a tier nobody chose", () => {
  process.env.CLEAROTRON_STAGE_THINKING = "register-digest=hgih";
  assert.throws(() => thinkingFor("register-digest"), /unknown thinking tier "hgih"/);
  process.env.CLEAROTRON_STAGE_THINKING = "regsiter-digest=low";
  assert.throws(() => thinkingFor("register-digest"), /unknown stage "regsiter-digest"/);
  process.env.CLEAROTRON_STAGE_THINKING = "register-digest";
  assert.throws(() => thinkingFor("register-digest"), /is not <stage>=<tier>/);
  // …and a typo in an entry for ANOTHER stage still throws: a half-valid spec means the arm is not the
  // arm the operator asked for, whichever stage is being resolved at the moment it is noticed.
  process.env.CLEAROTRON_STAGE_THINKING = "register-digest=low,synthesis=hihg";
  assert.throws(() => thinkingFor("register-digest"), /unknown thinking tier "hihg"/);
});

test("the shipped default for register-digest is low, and the tiers that stay high stay high", () => {
  // Pinned deliberately: this literal IS the change under measurement (probe 3.49x wall/output against a
  // 1.03x fixed-effort control, no detectable effect on which records are tiered or how).
  assert.equal(STAGES["register-digest"].thinking, "low");
  // Out of scope and staying that way: synthesis sets client-facing risk bands (1.42-1.69x against a 1.19x
  // control — barely above its own noise), and prelim-variants decides what is searched at all (its low arm
  // produced 39 variants against production's 56 — a narrower search, not a cheaper one).
  assert.equal(STAGES["synthesis"].thinking, "high");
  assert.equal(STAGES["prelim-variants"].thinking, "high");
});
