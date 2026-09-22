// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A PROVIDER HARD ERROR IS NOT A CAPABILITY GAP, AND IT GETS ITS ONE SETTLE ATTEMPT ONCE PER RUN.
//
// The settle step accepted every deferral on an axis the coverage skeleton marks `deferred`, and the
// skeleton marks an axis `deferred` for any single deferral. So a provider hard error, whose designed path
// is one bounded executor attempt, was logged "ACCEPTED as provider capability gaps … never retried" and
// got no attempt, and the envelope, which reads the reason, then re-opened it. The partition now asks the
// plan whether the axis is deferred end to end.
//
// That restores the attempt, and the attempt is bounded: the repair ledger's budget is keyed on the plan
// version, which every supplemental fold bumps, so the settle step records each qid it has sent and never
// sends one twice in a run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { settleReceipt, partitionReceiptDeferrals } from "../envelope-settle.mjs";
import { joinPlanToBands, deriveCoverageSkeleton, PROVIDER_HARD_ERROR_PREFIX } from "../register-plan.mjs";

const HARD = PROVIDER_HARD_ERROR_PREFIX + "provider error on the count probe (after one in-tool retry): HTTP 500: INTERNAL_SERVER_ERROR";
const GAP = "capability-gap: the active register provider cannot express this slice";
const SLICE = "primary-sweep:exact:thistle";
const plan = (v, { unsupported = false } = {}) => ({ plan_version: v, entries: [
  { qid: "primary-sweep:exact:veltrin", axis: "primary-sweep", predicate: "exact", term: "VELTRIN" },
  { qid: SLICE, axis: "primary-sweep", predicate: "exact", term: "THISTLE", ...(unsupported ? { unsupported: true } : {}) },
] });
// The receipt a run writes: joined and skeletoned by the shipped functions, one slice deferred with `reason`.
function receipt(v, reason, opts) {
  const p = plan(v, opts);
  const join = joinPlanToBands(p, { "primary-sweep": [
    { qid: "primary-sweep:exact:veltrin", state: "enumerated", records: [{}] },
    { qid: SLICE, error: true, deferred: true, reason },
  ] });
  return { plan_version: v, deferred: join.deferred, missing: join.missing, skeleton: deriveCoverageSkeleton(p, join) };
}
function runDir() {
  const dir = mkdtempSync(join(tmpdir(), "settle-once-"));
  mkdirSync(driverDir(dir), { recursive: true });
  return { dir, P: { runDir: dir, envelopeDecision: driverDir(dir, "envelope-decision.json") } };
}

test("THE CONTROL: the skeleton marks the axis deferred, which is the state the old partition accepted on", () => {
  const r = receipt(5, HARD);
  assert.equal(r.skeleton.find((s) => s.axis === "primary-sweep").state, "deferred",
    "the skeleton no longer marks an axis deferred for a single deferral, so this arm shows nothing");
  assert.equal(r.skeleton.find((s) => s.axis === "primary-sweep").executed, 1, "the axis ran its other slice");
});

test("a hard error on an axis that ran is suspect, not accepted", () => {
  const { accepted, suspect } = partitionReceiptDeferrals(plan(5), receipt(5, HARD));
  assert.deepEqual(accepted, [], "a provider hard error was filed as a capability gap because of its axis's state");
  assert.deepEqual(suspect.map((s) => s.qid), [SLICE]);
});

test("what IS decided stays decided: a reason-matched gap, and an axis the plan defers end to end", () => {
  assert.deepEqual(partitionReceiptDeferrals(plan(5), receipt(5, GAP)).accepted.map((a) => a.qid), [SLICE]);
  // Every entry on the axis unsupported: nothing on it can be dispatched, so the reason does not matter.
  const allOut = { plan_version: 5, entries: [{ qid: SLICE, axis: "primary-sweep", predicate: "exact", term: "THISTLE", unsupported: true }] };
  const r = { plan_version: 5, deferred: [{ qid: SLICE, reason: HARD }], missing: [], skeleton: [] };
  assert.deepEqual(partitionReceiptDeferrals(allOut, r).accepted.map((a) => a.qid), [SLICE]);
});

test("the one attempt is spent once per run, not once per plan version", async () => {
  const { dir, P } = runDir();
  try {
    const sent = [];
    const lane = (r) => ({ dispatch: async (axis, qids) => { sent.push(...qids); }, rejoin: async () => r });
    const r5 = receipt(5, HARD);
    const d5 = await settleReceipt({ P, plan: plan(5), receipt: r5, ...lane(r5) });
    assert.deepEqual(sent, [SLICE], "the hard error did not get its attempt");
    assert.deepEqual(d5.close_failed.map((c) => c.qid), [SLICE]);
    assert.deepEqual(d5.settle_tried.map((t) => t.qid), [SLICE]);
    // A supplemental fold bumps the plan version; the slice is still deferred and the settle runs again.
    const r6 = receipt(6, HARD);
    const d6 = await settleReceipt({ P, plan: plan(6), receipt: r6, ...lane(r6) });
    assert.deepEqual(sent, [SLICE], `a new plan version bought the same slice another attempt (sent ${sent.length} times)`);
    assert.match(d6.close_failed.find((c) => c.qid === SLICE)?.outcome ?? "", /^already tried once this run/);
    assert.deepEqual(d6.settle_tried.map((t) => t.qid), [SLICE], "the record of the attempt was lost across the version");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a seam with no executor records the slice as not tried, so a later seam that has one still tries it", async () => {
  const { dir, P } = runDir();
  try {
    const d = await settleReceipt({ P, plan: plan(5), receipt: receipt(5, HARD) });
    assert.equal(d.close_failed[0]?.outcome, "no executor lane at this seam");
    assert.deepEqual(d.settle_tried, [], "a slice nobody sent was recorded as tried");
    const sent = [];
    const r = receipt(5, HARD);
    await settleReceipt({ P, plan: plan(5), receipt: r, dispatch: async (axis, qids) => { sent.push(...qids); }, rejoin: async () => r });
    assert.deepEqual(sent, [SLICE]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
