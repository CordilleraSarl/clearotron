// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Regression tests for the review fixes: confirm-bypass removal, axis validation / traversal, token integrity.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { buildFixture, RUN_ID } from "./_fixture.mjs";

let runs, whatif;
const tokenFor = (op) => Buffer.from(JSON.stringify(op)).toString("base64url");

before(async () => {
  buildFixture();
  runs = await import("../lib/runs.mjs");
  whatif = await import("../lib/whatif.mjs");
});

test("whatIfPlan rejects an invalid / path-traversal axis for register-unit", () => {
  const run = runs.resolveRun(RUN_ID);
  assert.throws(() => whatif.whatIfPlan({ run, stage: "register-unit", axis: "../../../etc/passwd" }), /valid axis/i);
  assert.throws(() => whatif.whatIfPlan({ run, stage: "register-unit" }), /valid axis/i);
  assert.equal(whatif.whatIfPlan({ run, stage: "register-unit", axis: "primary-sweep" }).runnable, true);
});

test("whatIfPlan ignores an axis on a non-register-unit stage", () => {
  const run = runs.resolveRun(RUN_ID);
  assert.equal(whatif.whatIfPlan({ run, stage: "report-overview", axis: "primary-sweep" }).axis, null);
});

test("whatIfRun rejects a tampered token with a traversal axis (before any resolve/spend)", async () => {
  const token = tokenFor({ runId: RUN_ID, stage: "register-unit", axis: "../../../etc/passwd" });
  // deps that would FAIL the test if reached — proves validation happens before resolveRun/runExperiment
  const boom = () => { throw new Error("should not be reached"); };
  await assert.rejects(
    () => whatif.whatIfRun({ confirmationToken: token }, { resolveRun: boom, runExperiment: boom, compareCmd: boom }),
    /valid axis/i,
  );
});

test("whatIfRun rejects a token missing required fields", async () => {
  await assert.rejects(() => whatif.whatIfRun({ confirmationToken: tokenFor({ instructions: "x" }) }), /missing runId\/stage/i);
});

test("whatIfRun has no token-free bypass (empty/garbage token rejected)", async () => {
  await assert.rejects(() => whatif.whatIfRun({}), /confirmationToken/i);
  await assert.rejects(() => whatif.whatIfRun({ confirmationToken: "" }), /confirmationToken/i);
  await assert.rejects(() => whatif.whatIfRun({ confirmationToken: "not-base64-json!!" }), /confirmationToken|runId/i);
});

test("a wrong-axis stage is rejected, but a valid one round-trips", async () => {
  const run = runs.resolveRun(RUN_ID);
  // tamper a token to an unknown stage → rejected
  await assert.rejects(() => whatif.whatIfRun({ confirmationToken: tokenFor({ runId: RUN_ID, stage: "no-such-stage" }) }), /unknown stage/i);
  // a legit late-stage token validates and reaches the (injected) runner
  let reached = false;
  const token = whatif.whatIfPlan({ run, stage: "report-overview", instructions: "x" }).confirmationToken;
  await whatif.whatIfRun({ confirmationToken: token }, {
    resolveRun: () => run,
    runExperiment: async () => { reached = true; return { ok: true, shadowDir: `${run.runDir}/_experiments/e`, output: `${run.runDir}/_experiments/e/report.md` }; },
    compareCmd: () => ({ diff: "d", table: "t" }),
  });
  assert.equal(reached, true);
});
