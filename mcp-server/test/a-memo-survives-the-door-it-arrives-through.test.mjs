// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A memo plan reaches the client with the fields that make it a memo (tracker issue 132).
//
// WHY THIS EXISTS. The memo capability was composed and unreachable twice over, one layer apart, and the
// second one is the reason this file is not just an engine test.
//
// The first door was `whatIfPlan`: it refused on the stage check before it could mint a memo token, so
// nothing could plan one. That is fixed and `a-what-if-keeps-the-runs-rating-authority` covers it.
//
// The second door is THIS one, and it fails in the direction that does not look like a failure.
// `accountWhatIfPlan` is a default-deny allowlist: a field nobody added to PLAN_FIELDS is not refused,
// it is silently absent. A memo plan carries three fields a stage plan does not, and none of them were
// on the list — so a correctly composed memo arrived at the client:
//
//   • with no `kind`, so it could not be told from a stage plan;
//   • with no `assumption`, so it did not say what it was about — the reader's own words, dropped;
//   • with no `parentUntouched`, so it did not say the report and its archive are not modified.
//
// That last one is the whole safety case for offering this on a DELIVERED report. A plan that spends
// nothing and moves nothing, which cannot say so, is asking for a yes to a question the reader cannot
// price. Found by DRIVING a memo plan through the projection rather than by reading the list.
import { test } from "node:test";
import assert from "node:assert/strict";

import { whatIfPlan } from "../lib/whatif.mjs";
import { accountWhatIfPlan } from "../lib/audit-view.mjs";

// A delivered run as the resolver hands one over — archived, finished, nothing live about it.
const delivered = (over = {}) => ({
  runId: "r-venqori", location: "archive", state: "delivered",
  runDir: "/nonexistent/archive/r-venqori", P: {}, status: {}, ...over,
});

const ASSUMPTION = "treat the Korean application as expired";
const memo = (over = {}) => whatIfPlan({ run: delivered(), kind: "memo", instructions: ASSUMPTION, ...over });

test("the client sees a memo AS a memo — nothing the engine composed is dropped on the way out", () => {
  const plan = memo();
  assert.equal(plan.runnable, true, "the memo did not plan at all — this arm has lost its subject");

  const seen = accountWhatIfPlan(plan);
  const dropped = Object.keys(plan).filter((k) => !(k in seen));
  assert.deepEqual(dropped, [],
    `the projection dropped ${dropped.join(", ")}. PLAN_FIELDS is default-deny, so a memo field nobody `
    + "added arrives absent rather than refused — which is the defect this arm exists for");
});

test("the three fields a memo has and a stage plan does not each survive, and each is named", () => {
  // Named individually rather than asserted as a set: if one of them is dropped later, the failure
  // should say WHICH and what its absence costs a reader, not "the shapes differ".
  const seen = accountWhatIfPlan(memo());
  assert.equal(seen.kind, "memo", "without `kind` a client cannot tell a memo from a stage re-run");
  assert.equal(seen.assumption, ASSUMPTION,
    "the assumption is the reader's OWN words coming back; a plan that cannot restate the question is "
    + "asking them to approve something it will not name");
  assert.match(String(seen.parentUntouched ?? ""), /not modified/i,
    "the plan no longer tells the reader the report and its archive are untouched — that sentence is the "
    + "entire reason this is offered on a delivered report at all");
});

test("and it still says it spends nothing, because that is what is being approved", () => {
  const seen = accountWhatIfPlan(memo());
  assert.equal(seen.affectsFinalReport, false);
  assert.match(String(seen.externalCalls ?? ""), /no searching/i);
  assert.ok(seen.confirmationToken, "no token survived, so the plan cannot be acted on");
});

// ── the refusals, which must also survive the projection ────────────────────────────────────────────
test("a memo with no assumption refuses, and the REASON reaches the client", () => {
  // A refusal whose reason is projected away is worse than the refusal: the client is told no, with no
  // way to find out what would make it yes.
  const seen = accountWhatIfPlan(whatIfPlan({ run: delivered(), kind: "memo", instructions: "   " }));
  assert.equal(seen.runnable, false);
  assert.match(String(seen.reason ?? ""), /assumption/i,
    "the client was refused without being told an assumption is what is missing");
});

test("a stage plan is unchanged by the memo fields being added to the list", () => {
  // THE ADDITIVE GUARANTEE. Widening a default-deny allowlist is the kind of change that can quietly
  // start serving something on the OTHER kind, so the stage path is asserted rather than assumed.
  // A stage plan carries no `kind`, `assumption` or `parentUntouched`, so the widening reaches nothing:
  // `pick` copies a field only when the source has it.
  const stagePlan = { runnable: true, runId: "r1", stage: "register-unit", axis: "owner",
    change: "x", completeness: "partial", affectsFinalReport: true,
    downstreamNotRecomputed: ["a"], externalCalls: "billed", honestyNote: "h",
    confirmationToken: "t", next: "n", model: "opus-secret", telemetryDelta: { tokens: 99 } };
  const seen = accountWhatIfPlan(stagePlan);
  assert.equal(seen.stage, "register-unit");
  assert.deepEqual(seen.downstreamNotRecomputed, ["a"]);
  for (const gone of ["kind", "assumption", "parentUntouched"]) {
    assert.ok(!(gone in seen), `${gone} appeared on a STAGE plan that never carried it`);
  }
  // And the two the list has always withheld are still withheld — the widening must not have reached
  // the model tier or the token table, which is our bill and not the client's business.
  assert.ok(!("model" in seen), "the model tier reached a client");
  assert.ok(!("telemetryDelta" in seen), "the token table reached a client");
});
