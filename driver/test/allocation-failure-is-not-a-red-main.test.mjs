// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — a run that could not allocate a runner must not read as a failing main.
//
// THE SPECIMEN: run 32806587793 on the working home, event `schedule`, SHA 31c31c09. Its macOS job
// started 03:49:04Z and completed 03:49:08Z — four seconds, no runner assigned, no steps recorded — and
// the run's conclusion was `failure`. The PUSH run on the SAME SHA thirty minutes earlier was green on
// every job. Nothing executed, so nothing could have regressed; the board said otherwise, and the lane's
// merge rule ("a red main blocks every merge but its own fix") turned that into a stop no fix could
// clear.
//
// THE TWO WAYS TO BE WRONG HERE ARE NOT SYMMETRIC, which is what the arms below pin:
//   · calling a real regression "could not look" waves a broken main through — the expensive mistake;
//   · calling an allocation failure "red" costs a stopped lane and a reader who learns to reason past
//     a red main, which is how the first mistake eventually happens anyway.
// So a run with BOTH a zero-step failure and a real one is RED, and an unreadable step list is RED.
import { test } from "node:test";
import assert from "node:assert/strict";

import { classify, report } from "../../scripts/main-health.mjs";

const step = (conclusion) => ({ conclusion });
const run = (conclusion, jobs) => ({ conclusion, jobs });

test("#1874 a job that failed having executed ZERO steps is could-not-look, and does not block", () => {
  const c = classify(run("failure", [
    { name: "macOS — the offline suite, the provider cores, and the demo", conclusion: "failure", steps: [] },
    { name: "test", conclusion: "skipped", steps: [] },
  ]));
  assert.equal(c.state, "could-not-look");
  const r = report(c, {});
  assert.equal(r.block, false, "an allocation failure blocked a merge — no fix can clear it, so nothing ever merges");
  assert.match(r.text, /ZERO steps/, "the reader is not told WHY this is not a real failure");
  assert.match(r.text, /TOLD YOU NOTHING ABOUT MAIN/,
    "could-not-look was reported as if it were a green — the run proved nothing and must say so");
});

test("#1874 a job that failed having executed steps is RED and blocks", () => {
  const c = classify(run("failure", [{ name: "test", conclusion: "failure", steps: [step("success"), step("failure")] }]));
  assert.equal(c.state, "red");
  assert.equal(report(c, {}).block, true);
});

test("#1874 THE ASYMMETRY: a real failure beside an allocation failure is RED, not could-not-look", () => {
  // The expensive mistake. A run can carry both, and treating the pair as "could not look" because one
  // of them never started would wave a broken main straight through.
  const c = classify(run("failure", [
    { name: "macOS", conclusion: "failure", steps: [] },
    { name: "test", conclusion: "failure", steps: [step("failure")] },
  ]));
  assert.equal(c.state, "red");
  assert.equal(report(c, {}).block, true, "a genuine regression was waved through because another job never started");
});

test("#1874 an UNREADABLE step list is red, never could-not-look", () => {
  // `executedSteps` answers null when there is no list to count, and null is not zero. Rendering it as
  // "never started" would invent an infrastructure diagnosis out of a permissions error or a payload
  // change — the same lie in the other direction, and the safe way to be wrong is to block.
  const c = classify(run("failure", [{ name: "test", conclusion: "failure" }]));
  assert.equal(c.state, "red");
  assert.equal(report(c, {}).block, true);
});

test("#1874 a green run is green, and the classifier does not invent failures", () => {
  const c = classify(run("success", [{ name: "test", conclusion: "success", steps: [step("success")] }]));
  assert.equal(c.state, "green");
  assert.equal(report(c, {}).block, false);
});
