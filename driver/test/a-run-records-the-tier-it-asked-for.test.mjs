// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A RUN RECORDS THE TIER IT ASKED FOR, AND THE MODEL THAT ANSWERED IS RECORDED SEPARATELY.
//
// A stage names a tier. The tier goes to the program as the vendor's own alias, and the vendor answers
// with its newest model of that tier. The catalog used to turn that tier into a VERSION on its way into
// the record — so a run served throughout by one model recorded, on every attempt row, a request for a
// different one, and its per-model total accounted under the name of a model that had not run. Measured
// on a delivered run, 2026-09-22: served by the generation after Opus 5, recorded as asking for Opus 5.
//
// Ruled 2026-09-23: record the tier. Nobody asked for a version, so no version is written down as the
// request; what served the turn is a separate field that already carries it, and the report names the
// model that ran.
//
// THE COST WAS RULED ON, NOT DISCOVERED: per-model totals are keyed on what was ASKED for, and the
// direct-API lanes must name a version because they call the API rather than the program. One model
// reached both ways therefore lands in two buckets. Pinned below so it reads as a decision.
import test from "node:test";
import assert from "node:assert/strict";
import { MODELS, resolveModel, modelFamily } from "../driver.config.mjs";
import { claudeModel, buildClaudeArgs } from "../engine/anthropic-agent.mjs";
import { openaiModel } from "../engine/openai-agent.mjs";
import { PORTAL_READ_MODEL_DEFAULT } from "../portal-service.mjs";

test("the catalog records a tier, and names no version for a request nobody made", () => {
  for (const tier of ["opus", "sonnet", "haiku"]) {
    const recorded = MODELS[tier];
    assert.equal(recorded, `anthropic/claude-${tier}`, `${tier} is recorded as ${recorded}`);
    // A VERSION HERE IS THE DEFECT ITSELF, so it is refused by shape rather than by a list of known ids:
    // any digit in the recorded id is a version, whichever model it happens to name this year.
    assert.doesNotMatch(recorded, /\d/, `${tier} records a version, which is a request nobody made`);
    assert.equal(resolveModel(tier), recorded);
    // AND IT STILL PLACES, which is what the gateway compares a served model against. A tier that no
    // longer placed would make every comparison unknown and the substitution guard inert.
    assert.equal(modelFamily(tier), tier);
    assert.equal(modelFamily(recorded), tier);
  }
});

test("what reaches the program is still the vendor's alias, so the tier follows the vendor", () => {
  // The record changed; what a run ASKS FOR did not. This is the arm that would catch a catalog id
  // leaking into the program's `--model`, which would pin every stage to whatever the catalog said.
  for (const tier of ["opus", "sonnet", "haiku"]) {
    assert.equal(claudeModel(tier), tier);
    assert.equal(claudeModel(MODELS[tier]), tier, `the catalog id for ${tier} reaches the program as something other than the alias`);
  }
});

test("the portal's brief reader asks for a tier too, so it reaches a model on either engine", () => {
  // Its turn goes through the engine's program like a stage's. An exact id as the default pinned it on
  // claude, bypassed a cloud's deployment mapping, and was refused outright by codex, which maps tiers only.
  assert.equal(PORTAL_READ_MODEL_DEFAULT, "sonnet");
  assert.equal(claudeModel(PORTAL_READ_MODEL_DEFAULT), "sonnet");
  const { args } = buildClaudeArgs({ message: "m", model: PORTAL_READ_MODEL_DEFAULT, thinking: "off" });
  assert.equal(args[args.indexOf("--model") + 1], "sonnet");
  assert.doesNotThrow(() => openaiModel(PORTAL_READ_MODEL_DEFAULT));
  assert.throws(() => openaiModel("claude-sonnet-5"), /no GPT tier mapped/);
});

test("an exact model named by a caller is still recorded and run as that model", () => {
  // Recording the tier is about what a run asks for BY TIER. A caller who names a model has asked for
  // that model, and both the record and the program must still say so — otherwise this ruling would
  // have quietly taken pinning away with it.
  for (const id of ["claude-opus-5-5", "claude-sonnet-5", "claude-haiku-4-5-20251001"]) {
    assert.equal(resolveModel(id), `anthropic/${id.replace(/-\d{8}$/, "")}`);
    assert.equal(claudeModel(id), id);
  }
});

test("THE COST, PINNED: a tier and a lane's version key apart, by decision", () => {
  // The lanes that call the API directly must name a model id, because the API takes no tier word. So
  // the same model reached by a stage and by one of those lanes is two different requests and keys in
  // two places. If these two ever become equal again, the accepted split has silently closed and the
  // note in driver.config.mjs that explains it to a reader of a total is no longer true.
  assert.notEqual(resolveModel("haiku"), resolveModel("claude-haiku-4-5"));
  assert.equal(resolveModel("claude-haiku-4-5"), "anthropic/claude-haiku-4-5");
  assert.equal(resolveModel("haiku"), "anthropic/claude-haiku");
  // Both still place in the same family, so nothing the gateway refuses changes.
  assert.equal(modelFamily("haiku"), modelFamily("claude-haiku-4-5"));
});
