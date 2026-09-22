// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sarl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A PLAN_RUN THAT WAS NOT ANSWERED COMPARED NOTHING, SO IT IS NOT A DRIFT.
//
// Measured on the test box, 2026-09-22: three runs of the deployment check inside two minutes exhausted
// the ops door's rate limit, and the third exited 1 with "knockout-search: plan_run errored — MCP
// initialize refused (429)". A run a minute later exited 0. Nothing had drifted; the question was never
// answered. Each case below is driven through the verdict and then through the exit code, the way the
// check records it: a marked skip counts toward 3, a fail toward 1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planRunAgreementVerdict } from "../plan-run-agreement-verdict.mjs";
import { exitFor } from "../surface-exit-verdict.mjs";

const doorSays = new Map([["knockout-search", true], ["global-preliminary-search", true]]);
const keys = [...doorSays.keys()];
const agrees = async () => ({ blockers: [] });

/** The exit code the check gives for this one arm, bucketed as live-surface-check.mjs buckets it. */
const exitOf = (v) => exitFor({ failed: v.state === "fail" ? 1 : 0, couldNotLook: v.state === "skip" && v.blocked === true ? 1 : 0 });

for (const [what, error] of [
  ["a 429 from the door's rate limit", 'MCP initialize refused (429): {"error":"ops principal rate limit exceeded — retry shortly"}'],
  ["a timeout", "plan_run timed out after 20000ms"],
  ["a refused connection", "connect ECONNREFUSED 127.0.0.1:18790"],
]) {
  test(`${what} is a could-not-look, exit 3, not a drift`, async () => {
    const v = await planRunAgreementVerdict({ keys, doorSays, probeProfileKey: "acct", ask: async (key) => {
      if (key === "knockout-search") throw new Error(error);
      return { blockers: [] };
    } });
    assert.equal(v.state, "skip", v.message);
    assert.equal(v.blocked, true, "unmarked, the skip would exit 0 and read as a healthy box");
    assert.equal(exitOf(v), 3);
    assert.match(v.message, /knockout-search/, "the report names the product that was not compared");
  });
}

test("a real disagreement between the two doors is still a drift, exit 1", async () => {
  const v = await planRunAgreementVerdict({ keys, doorSays, probeProfileKey: "acct", ask: async (key) =>
    (key === "knockout-search" ? { blockers: ["knockout-search is unavailable on this installation"] } : { blockers: [] }) });
  assert.equal(v.state, "fail", v.message);
  assert.equal(exitOf(v), 1);
  assert.match(v.message, /knockout-search: describe_options=available plan_run=unavailable/);
});

test("a disagreement outranks an unanswered ask, and the unanswered one stays on the line", async () => {
  const v = await planRunAgreementVerdict({ keys, doorSays, probeProfileKey: "acct", ask: async (key) => {
    if (key === "knockout-search") throw new Error("MCP initialize refused (429)");
    return { blockers: ["not part of the current release"] };
  } });
  assert.equal(v.state, "fail");
  assert.equal(exitOf(v), 1);
  assert.match(v.message, /global-preliminary-search: describe_options=available plan_run=unavailable/);
  assert.match(v.message, /no answer for 1: knockout-search/, "a reader must not take the unanswered product as compared");
});

test("every product answered and agreed is a pass, exit 0", async () => {
  const v = await planRunAgreementVerdict({ keys, doorSays, probeProfileKey: "acct", ask: agrees });
  assert.equal(v.state, "pass");
  assert.equal(exitOf(v), 0);
});

test("no customer to plan against stays an ordinary skip, which moves no exit code", async () => {
  let asked = 0;
  const v = await planRunAgreementVerdict({ keys, doorSays, probeProfileKey: null, ask: async () => { asked++; return {}; } });
  assert.equal(v.state, "skip");
  assert.notEqual(v.blocked, true, "the roster check reports that; marking it here would count one gap twice");
  assert.equal(asked, 0, "nothing is asked without a customer");
});
