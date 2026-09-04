// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — a provider hard-error on a dictated slice becomes a DISCLOSED DEFERRAL, after the ladder.
//
// THE INCIDENT. R5 `8098215`, a worldwide Global preliminary, died terminal at fan-in after 140 minutes:
// two `incumbent-class` slices took an "HTTP 500: INTERNAL_SERVER_ERROR - Count Failed - IL - Near/Adj"
// through the in-tool retry, the direct dispatch, the followup and FOUR recovery parks. The provider
// ACCEPTED both slices and then failed on one jurisdiction's index, and the engine had no exit for that:
// `deferred` is for slices the provider cannot EXPRESS (known before the wire), `missing` is everything
// else and its end of the ladder is a StageFailure. So one index having a bad day killed the run class
// with the most slices, and nothing shipped.
//
// THE CONTRACT THIS MUST NOT WEAKEN (,). A clean can never ship over a slice the plan dictated
// and nothing ran. Two conditions keep that exactly as strong:
//
//   1. the provider must have ANSWERED — a band block stamped `error:true` carrying its own reason. A
//      qid with no block at all recorded nothing, and still throws.
//   2. the ladder must be SPENT — only a qid the run already recorded as missing converts. The first
//      fan-in throws exactly as today, so recovery keeps every chance to close a transient.
//
// Run:  node --test driver/test/provider-hard-error-deferral.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { joinPlanToBands, deriveCoverageSkeleton, deferExhaustedProviderErrors, ladderExhaustedQids,
  findUnexecutedCleanClaims, findUnaccountedDeferredSlices, isProviderHardErrorReason,
  PROVIDER_HARD_ERROR_PREFIX, PROVIDER_PERMANENT_ERROR_PREFIX } from "../register-plan.mjs";
import { isCapabilityGapReason } from "../coverage-ledger.mjs";
import { partitionReceiptDeferrals } from "../envelope-settle.mjs";
import { TRANSIENT_RE } from "../repairs.mjs";   // the fan-in's own classifier, not a stand-in

const HARD_500 = "provider error on the count probe (after one in-tool retry): HTTP 500: INTERNAL_SERVER_ERROR - Count Failed - IL - Near/Adj queries are not served by this index";

const PLAN = {
  plan_version: 3,
  entries: [
    { qid: "incumbent-class:default:thistle+owner-esri", axis: "incumbent-class", predicate: "default", term: "THISTLE", nice_classes: ["9"] },
    { qid: "incumbent-class:owner:esri+watch", axis: "incumbent-class", predicate: "owner", term: "ESRI", nice_classes: ["9"] },
    { qid: "primary-sweep:exact:thistle", axis: "primary-sweep", predicate: "exact", term: "THISTLE", nice_classes: ["9"] },
  ],
};

// The provider ANSWERED on both incumbent-class slices, with an error. primary-sweep enumerated cleanly.
const BANDS_HARD_ERROR = {
  "incumbent-class": [
    { qid: "incumbent-class:default:thistle+owner-esri", error: true, reason: HARD_500 },
    { qid: "incumbent-class:owner:esri+watch", error: true, reason: HARD_500 },
  ],
  "primary-sweep": [{ qid: "primary-sweep:exact:thistle", state: "enumerated", records: [{}] }],
};

// Nothing answered at all on one slice — no block, no reason, no evidence of any kind.
const BANDS_SILENT = {
  "incumbent-class": [{ qid: "incumbent-class:owner:esri+watch", error: true, reason: HARD_500 }],
  "primary-sweep": [{ qid: "primary-sweep:exact:thistle", state: "enumerated", records: [{}] }],
};

const spent = (qids) => new Set(qids);

test("#577 the FIRST fan-in still throws — a hard-errored slice is missing until the ladder is spent", () => {
  const join = joinPlanToBands(PLAN, BANDS_HARD_ERROR);
  assert.equal(join.missing.length, 2, "both hard-errored slices join as missing, exactly as before");
  // No prior receipt ⇒ nothing is exhausted ⇒ nothing converts.
  const { join: after, converted } = deferExhaustedProviderErrors(join, BANDS_HARD_ERROR, ladderExhaustedQids(null));
  assert.deepEqual(converted, [], "the recovery ladder must keep its chance at a provider having a bad minute");
  assert.equal(after, join, "an unconverted join is returned by identity — a run with no hard error is byte-identical to today");
});

test("#577 the SECOND fan-in defers them, with the provider's own error as the stated reason", () => {
  const join = joinPlanToBands(PLAN, BANDS_HARD_ERROR);
  const prior = { plan_version: 3, missing: join.missing, deferred: [] };   // what the first fan-in wrote
  const { join: after, converted } = deferExhaustedProviderErrors(join, BANDS_HARD_ERROR, ladderExhaustedQids(prior));
  assert.equal(converted.length, 2);
  assert.deepEqual(after.missing, [], "nothing is left to throw over");
  assert.equal(after.deferred.length, 2);
  for (const d of after.deferred) {
    assert.ok(d.reason.startsWith(PROVIDER_HARD_ERROR_PREFIX), "the row states WHY it is deferred");
    assert.match(d.reason, /HTTP 500/, "and carries the provider's verbatim error, not a paraphrase");
    assert.match(d.reason, /never searched and cannot be read as clean/,
      "the disclosure is in the reason itself — every surface that prints a deferral reason prints it");
  }
});

test("#577 a slice NOTHING answered on still kills the run — #440's condition is untouched", () => {
  const join = joinPlanToBands(PLAN, BANDS_SILENT);
  const silent = "incumbent-class:default:thistle+owner-esri";
  assert.ok(join.missing.includes(silent), "no block at all ⇒ missing");
  // Maximally generous: pretend BOTH have been through the ladder.
  const prior = { plan_version: 3, missing: join.missing, deferred: [] };
  const { join: after, converted } = deferExhaustedProviderErrors(join, BANDS_SILENT, ladderExhaustedQids(prior));
  assert.deepEqual(after.missing, [silent],
    "an absence is a finding: a slice with no provider answer is unrun AND undisclosed, and the gate must still fire");
  assert.deepEqual(converted.map((c) => c.qid), ["incumbent-class:owner:esri+watch"],
    "only the slice the provider actually answered on converts");
});

test("#577 a deferred slice must be NAMED in the deliverable — the disclosure gate holds the line", () => {
  // Deferring is not a way to make a slice go quiet. 's gate demands that every deferred qid appear
  // verbatim in a non-clean row on its own axis; the run does not ship until it does. That is what makes
  // "disclosed deferral" a contract rather than a label — and it applies to these rows exactly as it
  // applies to a capability gap, because they arrive in the same bucket.
  const join = joinPlanToBands(PLAN, BANDS_HARD_ERROR);
  const prior = { plan_version: 3, missing: join.missing, deferred: [] };
  const { join: after } = deferExhaustedProviderErrors(join, BANDS_HARD_ERROR, ladderExhaustedQids(prior));
  const skeleton = deriveCoverageSkeleton(PLAN, after);
  const ic = skeleton.find((s) => s.axis === "incumbent-class");
  assert.equal(ic.state, "deferred", "the axis states what happened to it, and it is not `executed`");

  const silent = findUnaccountedDeferredSlices(
    [{ axis: "incumbent-class", status: "confirmed-clean" }, { axis: "primary-sweep", status: "confirmed-clean" }],
    skeleton);
  assert.equal(silent.length, 1, "a run that says nothing about the deferred slices is refused");
  assert.equal(silent[0].token, "coverage_deferred_unaccounted:incumbent-class");
  assert.deepEqual(silent[0].missing.sort(), after.deferred.map((d) => d.qid).sort(),
    "and it names which slices went unaccounted, not merely that some did");

  const disclosed = findUnaccountedDeferredSlices(
    [{ axis: "incumbent-class", status: "deferred",
       reason: `not searched: ${after.deferred.map((d) => d.qid).join(" and ")} — the provider hard-errored` },
     { axis: "primary-sweep", status: "confirmed-clean" }],
    skeleton);
  assert.deepEqual(disclosed, [], "naming them on a non-clean row on their own axis discharges the gate");
});

test("#577 the clean-claim gate for a NEVER-ANSWERED slice is unchanged — the axis is `unexecuted`, not `deferred`", () => {
  const join = joinPlanToBands(PLAN, BANDS_SILENT);
  const prior = { plan_version: 3, missing: join.missing, deferred: [] };
  const { join: after } = deferExhaustedProviderErrors(join, BANDS_SILENT, ladderExhaustedQids(prior));
  const skeleton = deriveCoverageSkeleton(PLAN, after);
  assert.equal(skeleton.find((s) => s.axis === "incumbent-class").state, "unexecuted",
    "one silent slice keeps the whole axis unexecuted — the strictest state wins, as it did before");
  const violations = findUnexecutedCleanClaims([{ axis: "incumbent-class", status: "confirmed-clean" }], skeleton);
  assert.equal(violations.length, 1, "F3 still fires");
  assert.equal(violations[0].token, "coverage_clean_unexecuted:incumbent-class");
});

test("#577 the reason is NOT a capability gap, so the envelope spends one bounded attempt on it", () => {
  // The distinction has teeth: a capability gap is `accepted` (never retried, it cannot succeed), while
  // a provider outage is `suspect` and earns ONE code-executor attempt. If the index has recovered by
  // then the slice closes and no gap is disclosed at all — which is the outcome worth paying for.
  const reason = PROVIDER_HARD_ERROR_PREFIX + HARD_500;
  assert.equal(isCapabilityGapReason(reason), false,
    "a provider that answered with a 500 has the capability — it had a bad day");
  const { accepted, suspect } = partitionReceiptDeferrals(PLAN, {
    skeleton: [{ axis: "incumbent-class", state: "deferred" }, { axis: "primary-sweep", state: "executed" }],
    deferred: [{ qid: "primary-sweep:exact:thistle", reason }],
  });
  assert.deepEqual(accepted, [], "not filed as permanent");
  assert.deepEqual(suspect.map((s) => s.qid), ["primary-sweep:exact:thistle"], "filed as worth one attempt");
});

test("#577 ladderExhaustedQids carries a prior deferral forward — the conversion cannot be undone by a re-join", () => {
  // The trap this closes: the envelope's own re-join (and refreshSupplementalExecution) run a PLAIN
  // joinPlanToBands, which puts a still-erroring slice straight back into `missing`. Without the prior
  // receipt's deferrals in the exhausted set, settleReceipt would then see it absent from `deferred` and
  // record it "closed: ok" — a slice disclosed as an unsearched gap on one line and claimed closed on the
  // next.
  const first = { plan_version: 3, missing: [], deferred: [{ qid: "incumbent-class:owner:esri+watch", reason: PROVIDER_HARD_ERROR_PREFIX + HARD_500 }] };
  assert.deepEqual([...ladderExhaustedQids(first)], ["incumbent-class:owner:esri+watch"]);
  const rejoin = joinPlanToBands(PLAN, BANDS_HARD_ERROR);
  const { converted } = deferExhaustedProviderErrors(rejoin, BANDS_HARD_ERROR, ladderExhaustedQids(first));
  assert.deepEqual(converted.map((c) => c.qid), ["incumbent-class:owner:esri+watch"],
    "the re-join re-defers it rather than losing it");
  // A capability-gap deferral is NOT carried forward by this path — it never rode the ladder, and
  // joinPlanToBands re-derives it from the block on every join anyway.
  const capGap = { deferred: [{ qid: "x", reason: "capability-gap: the office is outside the provider's coverage" }] };
  assert.deepEqual([...ladderExhaustedQids(capGap)], []);
});

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ROUND 2 — the regression E2E found on 2026-08-12, and why condition 2 needed an exception.
//
// R1 PROJECT SABLE died at fan-in on BOTH engines over one slice, 26 and ~46 minutes in:
//   incumbent-class:owner:sky-limited+watch ← HTTP 400: APPLICANT_NAME - The system did not recognize…
// A 400 is not transient ⇒ the fan-in stamps `deterministic` ⇒ deterministic does not ride the ladder ⇒
// there is never a second fan-in ⇒ "already recorded as missing" is never true ⇒ the round-1 conversion
// could not fire, and the run died over the error class that most deserved the exit.
//
// These tests use the REAL TRANSIENT_RE the fan-in uses, not a hand-rolled stand-in, so that widening
// that regex to cover 4xx would turn "converts immediately" back into "waits for a ladder that never
// comes" and go red here rather than in a round.

const HARD_400 = "provider error on the count probe (after one in-tool retry): HTTP 400: APPLICANT_NAME - The system did not recognize the syntax of the request";
const retryCannotHelp = (reason) => !TRANSIENT_RE.test(String(reason ?? ""));

const BANDS_PERMANENT = {
  "incumbent-class": [
    { qid: "incumbent-class:default:thistle+owner-esri", state: "enumerated", records: [{}] },
    { qid: "incumbent-class:owner:esri+watch", error: true, reason: HARD_400 },
  ],
  "primary-sweep": [{ qid: "primary-sweep:exact:thistle", state: "enumerated", records: [{}] }],
};

test("#577r2 the fixture is the real classification — 400 is not transient, 500 is", () => {
  assert.equal(retryCannotHelp(HARD_400), true, "a malformed-query rejection is what the fan-in calls deterministic");
  assert.equal(retryCannotHelp(HARD_500), false, "a 5xx is transient and must keep its ladder");
});

test("#577r2 a permanent provider error defers on the FIRST fan-in — the ladder it would wait for never runs", () => {
  const join = joinPlanToBands(PLAN, BANDS_PERMANENT);
  assert.ok(join.missing.includes("incumbent-class:owner:esri+watch"), "it joins as missing, as before");
  // No prior receipt: this is the first fan-in, exactly where R1 died.
  const { join: after, converted } = deferExhaustedProviderErrors(join, BANDS_PERMANENT, ladderExhaustedQids(null), retryCannotHelp);
  assert.deepEqual(after.missing, [], "nothing is left for the fan-in to throw over — the run continues");
  assert.equal(converted.length, 1);
  assert.equal(converted[0].path, "permanent", "and it says which of the two paths it took");
  assert.ok(converted[0].reason.startsWith(PROVIDER_PERMANENT_ERROR_PREFIX),
    "the row must NOT claim a recovery ladder was spent — no ladder ran");
  assert.match(converted[0].reason, /HTTP 400: APPLICANT_NAME/, "the provider's verbatim rejection is the stated reason");
  assert.match(converted[0].reason, /never searched and cannot be read as clean/,
    "the disclosure rides in the reason, same as the ladder-spent path");
});

test("#577r2 BREAK: a TRANSIENT error must still wait for its ladder even with the predicate wired", () => {
  // The whole value of condition 2 is that a provider having a bad minute gets every retry the ladder
  // buys it. If this goes green with an empty `converted`, that promise is intact.
  const join = joinPlanToBands(PLAN, BANDS_HARD_ERROR);
  const { join: after, converted } = deferExhaustedProviderErrors(join, BANDS_HARD_ERROR, ladderExhaustedQids(null), retryCannotHelp);
  assert.deepEqual(converted, [], "a 5xx on the first fan-in still throws and still rides the ladder");
  assert.equal(after, join, "returned by identity — byte-identical to the pre-change run");
});

test("#577r2 BREAK: condition 1 is still absolute — a silent slice never defers, permanent path or not", () => {
  // The strongest form of the break: the slice that answered carries a PERMANENT error, so the permanent
  // path is live on this very join, and the silent one must still kill the run.
  const bands = {
    "incumbent-class": [{ qid: "incumbent-class:owner:esri+watch", error: true, reason: HARD_400 }],
    "primary-sweep": [{ qid: "primary-sweep:exact:thistle", state: "enumerated", records: [{}] }],
  };
  const join = joinPlanToBands(PLAN, bands);
  const { join: after, converted } = deferExhaustedProviderErrors(join, bands, ladderExhaustedQids(null), retryCannotHelp);
  assert.deepEqual(after.missing, ["incumbent-class:default:thistle+owner-esri"],
    "an absence is a finding: no provider answer ⇒ unrun AND undisclosed ⇒ the gate still fires");
  assert.deepEqual(converted.map((c) => c.qid), ["incumbent-class:owner:esri+watch"]);
  const skeleton = deriveCoverageSkeleton(PLAN, after);
  assert.equal(skeleton.find((s) => s.axis === "incumbent-class").state, "unexecuted",
    "and the silent slice keeps the axis unexecuted, so no clean can be claimed over it");
});

test("#577r2 BREAK: dropping the predicate restores the regression — the default converts nothing", () => {
  // Byte-for-byte proof that the 4th argument is the entire behaviour change: same inputs, no predicate.
  const join = joinPlanToBands(PLAN, BANDS_PERMANENT);
  const { join: after, converted } = deferExhaustedProviderErrors(join, BANDS_PERMANENT, ladderExhaustedQids(null));
  assert.deepEqual(converted, [], "without the predicate this is exactly the code that killed R1");
  assert.equal(after, join);
});

test("#577r2 a permanent deferral is carried forward — a re-join cannot quietly close it", () => {
  // Break 3 from round 1, re-run against the new prefix. ladderExhaustedQids must recognise BOTH stems or
  // the envelope's re-join puts the slice back in `missing` and settleReceipt records it "closed: ok".
  const first = { plan_version: 3, missing: [], deferred: [{ qid: "incumbent-class:owner:esri+watch", reason: PROVIDER_PERMANENT_ERROR_PREFIX + HARD_400 }] };
  assert.deepEqual([...ladderExhaustedQids(first)], ["incumbent-class:owner:esri+watch"],
    "the permanent prefix is recognised by carry-forward, not only the ladder-spent one");
  assert.equal(isProviderHardErrorReason(PROVIDER_PERMANENT_ERROR_PREFIX + HARD_400), true);
  assert.equal(isProviderHardErrorReason(PROVIDER_HARD_ERROR_PREFIX + HARD_500), true);
  assert.equal(isProviderHardErrorReason("capability-gap: the office is outside the provider's coverage"), false,
    "and it does not swallow a capability gap, which has its own note and its own meaning");
  // Re-joined with the block still erroring: it re-defers rather than reverting to missing.
  const rejoin = joinPlanToBands(PLAN, BANDS_PERMANENT);
  const { converted } = deferExhaustedProviderErrors(rejoin, BANDS_PERMANENT, ladderExhaustedQids(first), retryCannotHelp);
  assert.deepEqual(converted.map((c) => c.qid), ["incumbent-class:owner:esri+watch"]);
  assert.equal(converted[0].path, "ladder-spent",
    "carried forward it reads as spent, because by then it has been through a fan-in — the wording stays true");
});

test("#577r2 the permanent reason is still not a capability gap — one bounded attempt, then disclosed", () => {
  // `retryCannotHelp` is a NEGATIVE classification ("not recognised as transient"), not positive
  // knowledge that the far end will never serve it. So the envelope's single code-executor attempt is
  // kept as the cheapest hedge against having classified it wrong, and `close_failed` records the try.
  const reason = PROVIDER_PERMANENT_ERROR_PREFIX + HARD_400;
  assert.equal(isCapabilityGapReason(reason), false,
    "the provider HAS the capability — it rejected this query's syntax, which is not the same thing");
  const { accepted, suspect } = partitionReceiptDeferrals(PLAN, {
    skeleton: [{ axis: "incumbent-class", state: "deferred" }, { axis: "primary-sweep", state: "executed" }],
    deferred: [{ qid: "primary-sweep:exact:thistle", reason }],
  });
  assert.deepEqual(accepted, [], "not filed as permanent-and-never-retried");
  assert.deepEqual(suspect.map((s) => s.qid), ["primary-sweep:exact:thistle"], "filed as worth exactly one attempt");
});

test("#577r2 the deliverable must still NAME a permanently-deferred slice — #476's gate is unchanged", () => {
  const join = joinPlanToBands(PLAN, BANDS_PERMANENT);
  const { join: after } = deferExhaustedProviderErrors(join, BANDS_PERMANENT, ladderExhaustedQids(null), retryCannotHelp);
  const skeleton = deriveCoverageSkeleton(PLAN, after);
  assert.equal(skeleton.find((s) => s.axis === "incumbent-class").state, "deferred");
  const silent = findUnaccountedDeferredSlices(
    [{ axis: "incumbent-class", status: "confirmed-clean" }, { axis: "primary-sweep", status: "confirmed-clean" }],
    skeleton);
  assert.equal(silent.length, 1, "deferring is not a way to make a slice go quiet");
  assert.equal(silent[0].token, "coverage_deferred_unaccounted:incumbent-class");
});

test("#577r2 the receipt rows carry no reporting fields — `cause` and `path` never reach the file", () => {
  // `converted` grew two fields for the log line. The rows written into the receipt must not: the
  // plan-execution receipt is read by every downstream gate and its shape is a contract.
  const join = joinPlanToBands(PLAN, BANDS_PERMANENT);
  const { join: after } = deferExhaustedProviderErrors(join, BANDS_PERMANENT, ladderExhaustedQids(null), retryCannotHelp);
  for (const d of after.deferred) {
    assert.deepEqual(Object.keys(d).sort(), ["qid", "reason"],
      "a deferral row is {qid, reason} and nothing else");
  }
});
