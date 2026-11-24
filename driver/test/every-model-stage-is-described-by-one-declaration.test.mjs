// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// EVERY MODEL STAGE IS DESCRIBED BY ONE DECLARATION, AND THE PLACES THAT USED TO DESCRIBE IT AGREE WITH IT.
//
// stage-declarations.mjs holds, per stage, the tool groups it is granted, its own record tool or none, and the name of its
// validator. The grant and the validator are read from it (toolGroupsForStage in gather-config.mjs, and each stage file's
// `validate`). The record tool is also named, independently, by the recording registry, by the literal pin of each
// recording stage's grant (RECORDING_TOOLS) and by the table of artifacts a tool writes (form-sync.mjs). Those stay
// independent on purpose, since a pin derived from what it checks compares a value with itself, so this file holds
// them to the declaration instead: a stage that changes in one place and not the others fails here by name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { STAGE_DECLARATIONS, declaredStageOf, declaredValidator } from "../stage-declarations.mjs";
import { STAGES } from "../stages.mjs";
import { KO_STAGES } from "../stages-knockout.mjs";
import { RECORDING_STAGES, RECORDING_TOOLS, toolGroupsForStage } from "../engine/mcp/gather-config.mjs";
import { TOOL_WRITTEN_ARTIFACTS, TOOL_WRITTEN_DIRS, TOOL_WRITTEN_PATTERNS } from "../ladder/form-sync.mjs";

const ALL = { ...STAGES, ...KO_STAGES };

test("every model stage has one declaration, and every declaration is a model stage", () => {
  assert.deepEqual(Object.keys(STAGE_DECLARATIONS).sort(), Object.keys(ALL).sort());
  for (const [stage, d] of Object.entries(STAGE_DECLARATIONS)) {
    assert.ok(Array.isArray(d.grant) && d.grant.every((g) => typeof g === "string" && g), `${stage}: the grant is not a list of group names`);
    assert.ok(d.recording === null || /^record_[a-z_]+$/.test(d.recording), `${stage}: the record tool is neither a record tool's name nor null`);
    assert.ok(typeof d.validator === "string" && d.validator, `${stage}: no validator is named`);
  }
});

test("each stage's grant is its declared grant, and each stage file checks it with its declared validator", () => {
  for (const [stage, d] of Object.entries(STAGE_DECLARATIONS)) {
    assert.deepEqual(toolGroupsForStage(stage), d.grant, `${stage}: the grant resolved is not the declared one`);
    assert.equal(declaredStageOf(stage), stage);
  }
  // a stage declared by prefix covers its labels, and nothing else is matched by prefix
  assert.equal(declaredStageOf("register-unit:primary-sweep"), "register-unit");
  assert.equal(declaredStageOf("synthesis(corrective)"), "synthesis");
  assert.equal(declaredStageOf("report-card:2"), null, "a fanned recording label is resolved by its recording row, not by a prefix");
  assert.equal(declaredStageOf("constructor"), null);
});

test("each stage's validator is the one its declaration names", async () => {
  const { validators } = await import("../verify.mjs");
  const { validators: koValidators } = await import("../verify-knockout.mjs");
  const { validateKnockoutRegisterFile } = await import("../knockout-register-record.mjs");
  const { validateKnockoutReviewFile } = await import("../knockout-review-record.mjs");
  const { validateKnockoutCorrectionFile } = await import("../knockout-correction-record.mjs");
  for (const stage of Object.keys(STAGES)) assert.equal(ALL[stage].validate, declaredValidator(stage, validators), `${stage}: another validator`);
  const ko = { ...koValidators, validateKnockoutRegisterFile, validateKnockoutReviewFile, validateKnockoutCorrectionFile };
  for (const stage of Object.keys(KO_STAGES)) assert.equal(ALL[stage].validate, declaredValidator(stage, ko), `${stage}: another validator`);
  assert.throws(() => declaredValidator("matter-frame", {}), /declares the validator "matterContext", which its stage file does not hold/);
});

test("a stage with a record tool is a recording stage everywhere that says so, and one without is one nowhere", () => {
  const written = new Set([...TOOL_WRITTEN_ARTIFACTS.values(), ...TOOL_WRITTEN_DIRS.values(), ...TOOL_WRITTEN_PATTERNS].map((r) => r.tool));
  for (const [stage, d] of Object.entries(STAGE_DECLARATIONS)) {
    const key = `recording-${stage}`;
    if (d.recording) {
      assert.ok(RECORDING_STAGES[stage], `${stage}: no recording registry row`);
      assert.ok(d.grant.includes(key), `${stage}: its record key is not in its grant`);
      assert.ok((RECORDING_TOOLS[stage] ?? []).includes(`mcp__${key}__${d.recording}`), `${stage}: the pinned grant does not hold ${d.recording}`);
      assert.ok(written.has(d.recording), `${stage}: no artifact is written by ${d.recording}`);
    } else {
      assert.equal(RECORDING_STAGES[stage], undefined, `${stage}: a registry row for a stage with no record tool`);
      assert.ok(!d.grant.includes(key), `${stage}: a record key for a stage with no record tool`);
    }
  }
});
