// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// What-if tests: whatIfPlan is pure (no spend); whatIfRun is exercised with INJECTED fakes for the shelling
// runExperiment + compareCmd, so no gateway is touched and exceljs/native addons are never loaded.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { buildFixture, RUN_ID } from "./_fixture.mjs";

let runs, whatif;

before(async () => {
  buildFixture();
  runs = await import("../lib/runs.mjs");
  whatif = await import("../lib/whatif.mjs");
});

test("whatIfPlan on a LATE stage is 'complete' and tokens-only", () => {
  const run = runs.resolveRun(RUN_ID);
  const plan = whatif.whatIfPlan({ run, stage: "report-overview", instructions: "tighten the read" });
  assert.equal(plan.runnable, true);
  assert.equal(plan.completeness, "complete");
  assert.equal(plan.affectsFinalReport, true);
  assert.ok(!plan.downstreamNotRecomputed.includes("notify"));
  assert.match(plan.externalCalls, /tokens only/i);
  assert.ok(plan.confirmationToken);
  const decoded = JSON.parse(Buffer.from(plan.confirmationToken, "base64url").toString());
  assert.equal(decoded.runId, RUN_ID);
});

test("whatIfPlan on an EARLY stage is 'partial' and flags billed calls + downstream", () => {
  const run = runs.resolveRun(RUN_ID);
  const plan = whatif.whatIfPlan({ run, stage: "common-law" });
  assert.equal(plan.completeness, "partial");
  assert.equal(plan.affectsFinalReport, false);
  assert.match(plan.externalCalls, /billed/i);
  assert.ok(plan.downstreamNotRecomputed.includes("synthesis"));
  assert.ok(plan.downstreamNotRecomputed.includes("report-overview"));
});

test("whatIfPlan refuses a delivered/archived run", () => {
  const fake = { runId: "x-y-z", slug: "x", codename: "z", location: "archive", state: "delivered", P: {}, runDir: "/x" };
  const plan = whatif.whatIfPlan({ run: fake, stage: "report-overview" });
  assert.equal(plan.runnable, false);
  assert.match(plan.reason, /delivered|archived/i);
});

test("whatIfRun executes via injected fakes (no gateway, original untouched)", async () => {
  const run = runs.resolveRun(RUN_ID);
  const token = whatif.whatIfPlan({ run, stage: "report-overview", instructions: "tighten" }).confirmationToken;

  let gotJob = null, gotOpts = null;
  const fakeRunExperiment = async (job, opts) => {
    gotJob = job; gotOpts = opts;
    return { ok: true, shadowDir: `${run.runDir}/_experiments/2026-06-08-report-overview-whatif`, output: `${run.runDir}/_experiments/2026-06-08-report-overview-whatif/report.md` };
  };
  const fakeCompare = ({ a, b, stage }) => ({ diff: "- old line\n+ new line", table: `model A→B for ${stage}`, aRef: a, bRef: b });

  const res = await whatif.whatIfRun(
    { confirmationToken: token },
    { resolveRun: () => run, runExperiment: fakeRunExperiment, compareCmd: fakeCompare },
  );
  assert.equal(res.ok, true);
  assert.equal(res.completeness, "complete");
  assert.match(res.diff, /new line/);
  assert.ok(res.telemetryDelta.includes("report-overview"));
  // the reconstructed job rebuilt the SAME slug (the deriveSlug guard passed)
  assert.equal(gotJob.ref, "TMPTEST1");
  assert.equal(gotOpts.experiment, "report-overview");
  assert.equal(gotOpts.codename, "copper-anvil");
});

test("whatIfRun refuses without a confirmation", async () => {
  await assert.rejects(() => whatif.whatIfRun({}), /confirmationToken/);
});
