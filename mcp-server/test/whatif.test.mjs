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

// ── THE MEMO DOOR (tracker issue 132) ────────────────────────────────────────────────────────────
//
// The capability was composed and unreachable: whatIfPlan minted a memo token, decodeOp validated it,
// whatIfEnqueue answered the client `queued: true` — and whatIfRun, which the worker calls to execute
// it, had no memo branch and refused every memo as a stage re-run on a delivered run. These arms hold
// the door open from BOTH sides: a memo gets through, and the live-run rule a memo is exempt from is
// still enforced for everything that is not one.

const deliveredRun = (over = {}) => ({
  runId: "d-e-f", slug: "d", codename: "f", location: "archive", state: "delivered",
  P: {}, runDir: "/d", status: {}, ...over,
});
const memoToken = (assumption, runId = "d-e-f") =>
  Buffer.from(JSON.stringify({ runId, kind: "memo", instructions: assumption })).toString("base64url");

test("a memo on a DELIVERED run reaches the memo composer, carrying the assumption verbatim", async () => {
  const run = deliveredRun();
  const assumption = "treat the Align Networks Korean application as expired/abandoned";
  let seen = null;
  const res = await whatif.whatIfRun(
    { confirmationToken: memoToken(assumption) },
    {
      resolveRun: () => run,
      askArchivedRun: async (a) => { seen = a; return { ok: true, memoId: "m1", parentRunId: a.runId }; },
      // If the memo branch ever falls through to the stage machinery this fires and the arm says so
      // by name, rather than failing three lines later on a shape mismatch.
      runExperiment: async () => { throw new Error("a memo must not reach runExperiment"); },
    },
  );
  assert.equal(res.ok, true);
  assert.equal(res.memoId, "m1");
  assert.equal(seen.runId, "d-e-f");
  // VERBATIM: the reader's own words are what the memo is stamped with, so a door that paraphrased or
  // trimmed them would publish an assumption the reader never stated.
  assert.equal(seen.question, assumption);
});

test("a memo re-runs no stage — runExperiment is never called for one", async () => {
  let ranExperiment = false;
  await whatif.whatIfRun(
    { confirmationToken: memoToken("assume the mark lapsed") },
    {
      resolveRun: () => deliveredRun(),
      askArchivedRun: async () => ({ ok: true, memoId: "m2" }),
      runExperiment: async () => { ranExperiment = true; return { ok: true }; },
    },
  );
  assert.equal(ranExperiment, false);
});

// A DIFFERENT MEMBER OF THE CLASS the branch touches. The fix makes the refusal kind-aware; the risk
// it introduces is that "kind-aware" quietly becomes "unenforced". A STAGE op on the same delivered
// run must still be refused in the same words it always was.
test("the live-run rule still refuses a STAGE re-run on a delivered run", async () => {
  await assert.rejects(
    () => whatif.whatIfRun(
      { confirmationToken: Buffer.from(JSON.stringify({ runId: "d-e-f", stage: "report-overview" })).toString("base64url") },
      { resolveRun: () => deliveredRun() },
    ),
    /delivered or archived/i,
  );
});

// AND A THIRD MEMBER: cancelled. A memo is exempt from "finished", never from "stopped" — a run whose
// owner halted it has evidence that was never completed, and reasoning over a half-gathered record is
// how a memo comes to say more than the run ever knew. whatif-queue.mjs states that rule; this holds
// the memo door to it.
test("a memo over a CANCELLED run is still refused, and says why a memo in particular cannot run", async () => {
  await assert.rejects(
    () => whatif.whatIfRun(
      { confirmationToken: memoToken("assume it lapsed") },
      { resolveRun: () => deliveredRun({ state: "cancelled" }) },
    ),
    /evidence was complete|stopped/i,
  );
});
