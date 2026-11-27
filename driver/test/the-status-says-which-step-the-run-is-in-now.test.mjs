// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// the-status-says-which-step-the-run-is-in-now.test.mjs — status.json names the step a run is in now, not
// only the furthest step it has reached.
//
// Measured on a live run, 2026-09-18: a corrective pass re-entered synthesis after case law. status.json
// read `stepLabel: "Case law & refutation"` and `lastStage: "synthesis"` at the same instant, and the portal
// showed case law. The step fields are kept at the furthest step reached on purpose; `lastStage` moved
// but is a raw stage key. `currentStep` is the same moment in the stepper's own words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedRunStatus, recordTransition, stepForStage, displayStepsFor, DISPLAY_STEPS, CONCLUSIONS_STEP } from "../progress.mjs";

function run() {
  const studioRoot = mkdtempSync(join(tmpdir(), "prog-current-"));
  const runDir = join(studioRoot, "tmp9-demo-brand-owner", "2026-06-02-copper-spire");
  mkdirSync(runDir, { recursive: true });
  const ctx = { run: { runDir, studioRoot, slug: "tmp9-demo-brand-owner", codename: "copper-spire", date: "2026-06-02" },
    job: { id: "j9", forwarder: "requester", ref: "TMP9001", markName: "AURORA", classes: [9] }, agent: "mailagent" };
  seedRunStatus(ctx);
  return { ctx, read: () => JSON.parse(readFileSync(join(runDir, "status.json"), "utf8")) };
}

test("a corrective pass that steps back: currentStep follows it, the furthest step stays where it was", () => {
  const { ctx, read } = run();
  for (const k of ["matter-frame", "register-unit:primary-sweep", "synthesis", "case-law"]) recordTransition(ctx, k);
  assert.equal(read().currentStep.label, stepForStage("case-law").label);
  recordTransition(ctx, "synthesis");   // the corrective re-entry
  const s = read();
  assert.equal(s.stepLabel, stepForStage("case-law").label, "the furthest step reached is still kept");
  assert.equal(s.lastStage, "synthesis");
  assert.deepEqual(s.currentStep, { index: stepForStage("synthesis").index, label: stepForStage("synthesis").label,
    n: stepForStage("synthesis").n, total: stepForStage("synthesis").total }, "currentStep names the step the run is in now");
});

test("a stage with no display step leaves currentStep on the step it runs inside", () => {
  const { ctx, read } = run();
  recordTransition(ctx, "synthesis");
  recordTransition(ctx, "doubt-closure");
  assert.equal(stepForStage("doubt-closure"), null, "precondition: this stage has no display step");
  assert.equal(read().currentStep.label, stepForStage("synthesis").label);
  assert.equal(read().lastStage, "doubt-closure");
});

test("a seeded run already answers: currentStep is the first step before any transition", () => {
  const { read } = run();
  assert.equal(read().currentStep.label, stepForStage("matter-frame").label);
});

// ── A SEARCH THAT DOES NOT READ CASE LAW NAMES ITS SIXTH STEP FOR WHAT IT DOES (approved 2026-11-25) ─────
//
// Global preliminary and Multi-country focus do not search case law (`caseLaw: false` in products.mjs), and
// their sixth step reviews the conclusions. Named "Case law & refutation", every surface that names the step
// told the reader case law was covered. The run records its own list, and every write names the step from it.
function runOf(product) {
  const studioRoot = mkdtempSync(join(tmpdir(), "prog-steps-"));
  const runDir = join(studioRoot, "tmp9-demo-brand-owner", "2026-06-02-copper-spire");
  mkdirSync(runDir, { recursive: true });
  const ctx = { run: { runDir, studioRoot, slug: "tmp9-demo-brand-owner", codename: "copper-spire", date: "2026-06-02" },
    job: { id: "j9", forwarder: "requester", ref: "TMP9001", markName: "AURORA", classes: [9] }, agent: "mailagent",
    searchPolicy: { schema: 1, level: product, pipeline: "clearance" } };
  seedRunStatus(ctx);
  return { ctx, read: () => JSON.parse(readFileSync(join(runDir, "status.json"), "utf8")) };
}

test("Global preliminary and Multi-country focus name their sixth step \"Checking the conclusions\", everywhere the run records it", () => {
  for (const product of ["global-preliminary-search", "multi-country-focus-search"]) {
    const { ctx, read } = runOf(product);
    assert.deepEqual(read().steps, [...displayStepsFor(product)], `${product}: the seed records the run's own list`);
    assert.equal(read().steps[5], CONCLUSIONS_STEP);
    assert.equal(read().steps.length, DISPLAY_STEPS.length, "the same nine steps; only a name differs");
    for (const k of ["matter-frame", "synthesis", "narrative-refutation"]) recordTransition(ctx, k);
    const s = read();
    assert.equal(s.stepLabel, CONCLUSIONS_STEP, `${product}: the furthest step reached`);
    assert.equal(s.currentStep.label, CONCLUSIONS_STEP, `${product}: the step it is in now`);
    assert.equal(s.stepN, 6);
    assert.ok(!JSON.stringify(s).includes(DISPLAY_STEPS[5]), `${product}: the case-law step's name appears nowhere in its status`);
  }
});

test("a Full country search keeps the nine shipped names, \"Case law & refutation\" included", () => {
  const { ctx, read } = runOf("full-country-search");
  assert.deepEqual(read().steps, [...DISPLAY_STEPS]);
  recordTransition(ctx, "case-law");
  assert.equal(read().stepLabel, DISPLAY_STEPS[5]);
  assert.equal(read().currentStep.label, DISPLAY_STEPS[5]);
});

test("a run whose product this build cannot place keeps the shipped names", () => {
  assert.equal(displayStepsFor(null), DISPLAY_STEPS);
  assert.equal(displayStepsFor("no-such-product"), DISPLAY_STEPS);
});
