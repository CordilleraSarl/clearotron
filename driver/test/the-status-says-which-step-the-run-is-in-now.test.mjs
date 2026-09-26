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
import { seedRunStatus, recordTransition, stepForStage } from "../progress.mjs";

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
