// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A DEFERRED ROW SAYS WHY IT IS OPEN: NEVER SEARCHED, OR ASKED AND NEVER ANSWERED.
//
// Every deferral on the plan-execution receipt gets a row on the coverage form the write-up reads, and every one said
// the active provider cannot express its query, so it was never searched. A question that timed out at the gateway, or
// failed with a provider error the repair ladder could not mend, was asked: it was asked and never answered, and the
// envelope close's one further ask did not answer either. Each kind now says so, read off what the run holds about the
// slice (the executor's timeout mark, the ladder's own prefix), never off the reason's prose. Every mark is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { coverageFormRows, DEFERRED_OPEN_BECAUSE } from "../coverage-form.mjs";
import { PROVIDER_HARD_ERROR_PREFIX, PROVIDER_PERMANENT_ERROR_PREFIX } from "../register-plan.mjs";

const AXIS = "transliteration-numeric";
const Q = { gap: `${AXIS}:exact:qzorvak-er`, slow: `${AXIS}:exact:qzorvak-cn`, stall: `${AXIS}:exact:qzorvak-jp`, hard: `${AXIS}:exact:qzorvak-kr`, permanent: `${AXIS}:exact:qzorvak-ru` };
const block = (qid, extra = {}) => ({ qid, state: "incomplete", total_hits: 0, fetched: 0, sample: [], error: true, ...extra });
const rows = () => coverageFormRows({
  skeleton: [{ axis: AXIS, state: "deferred", deferred: Object.values(Q), missing: [] }],
  plan: { entries: Object.values(Q).map((qid) => ({ qid, axis: AXIS, predicate: "exact", term: "QZORVAK" })) },
  bandBlocksByAxis: { [AXIS]: [
    block(Q.gap, { deferred: true, reason: "capability-gap: office outside the register's vocabulary" }),
    block(Q.slow, { deferred: true, gateway_timeout: true, reason: "provider error (after one in-tool retry): HTTP 504: Error 504: Gateway time-out" }),
    block(Q.stall, { deferred: true, gateway_timeout: true, reason: "provider error (not asked again): provider error — mechanical-fail:timeout: after a gateway timeout the question was asked again on each half of its regions" }),
    block(Q.hard, { reason: "provider error (after one in-tool retry): HTTP 500: Internal Server Error" }),
    block(Q.permanent, { reason: "provider error (after one in-tool retry): HTTP 400: the register refused the query" }),
  ] },
  deferredReasons: {
    [Q.gap]: "capability-gap: office outside the register's vocabulary",
    [Q.slow]: "provider error (after one in-tool retry): HTTP 504: Error 504: Gateway time-out",
    [Q.stall]: "provider error (not asked again): provider error — mechanical-fail:timeout: after a gateway timeout",
    [Q.hard]: `${PROVIDER_HARD_ERROR_PREFIX}provider error (after one in-tool retry): HTTP 500: Internal Server Error`,
    [Q.permanent]: `${PROVIDER_PERMANENT_ERROR_PREFIX}provider error (after one in-tool retry): HTTP 400: the register refused the query`,
  },
  activeAxes: [AXIS],
}).rows.filter((r) => r.kind === "deferred");
const because = (qid) => rows().find((r) => r.qid === qid)?.open_because;

test("a slice that timed out, whether alone or in region halves, says it was asked and never answered", () => {
  assert.equal(rows().length, 5, "guard: every deferral has its row");
  for (const qid of [Q.slow, Q.stall]) assert.equal(because(qid), DEFERRED_OPEN_BECAUSE.timeout, `${qid} reads as a slice the provider cannot express`);
  assert.equal(DEFERRED_OPEN_BECAUSE.timeout, "the register's gateway timed out on this query, and the envelope close's one further ask did not answer — it was asked but never answered, and it is not asked again in this run");
});

test("a provider error the repair ladder could not mend says it was asked and never answered", () => {
  for (const qid of [Q.hard, Q.permanent]) assert.equal(because(qid), DEFERRED_OPEN_BECAUSE.hardError, `${qid} reads as a slice the provider cannot express`);
  assert.equal(DEFERRED_OPEN_BECAUSE.hardError, "the register returned an error on this query, and the envelope close's one further ask did not answer — it was asked but never answered, and it is not asked again in this run");
});

test("a slice the provider cannot express keeps the words it had", () => {
  assert.equal(because(Q.gap), "the active register provider cannot express this query — it was never searched and no re-run can reach it");
});
