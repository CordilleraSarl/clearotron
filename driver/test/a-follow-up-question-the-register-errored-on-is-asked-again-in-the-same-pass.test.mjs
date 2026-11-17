// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A FOLLOW-UP QUESTION THE REGISTER ERRORED ON IS ASKED AGAIN, BY CODE, IN THE SAME PASS.
//
// An escalation, an envelope close or a frame reopen can propose register questions, and the tool asks them at once. On
// a test run of 2026-11-12 the register answered six of them, three on each of two axes, with an error the run reads as
// passing. The receipt keeps such a question `missing` until the run has asked it again, and nothing asked it again
// before the reading step, so both axes read `unexecuted`, every clean row on them was refused, and the run parked for
// its resumes to ask what one code call could ask in the pass. Now each such question is sent once more through the
// executor, the attempt and what came back are logged, and only then is the receipt written: an answered question is
// executed, one still erroring is deferred with its own error as the reason, one the executor could not send stays
// `missing`. Here the executor is a stand-in that counts what it is sent. Every mark is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { reaskFollowUpErrors, writePlanExecutionReceipt } from "../pipeline.mjs";
import { joinPlanToBands, findUnexecutedCleanClaims, PROVIDER_HARD_ERROR_PREFIX } from "../register-plan.mjs";
import { paths } from "../stages.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";

const OUTAGE = "provider error (after one in-tool retry): provider error on the count probe before enumeration: HTTP 503: service unavailable";
const REFUSED = "provider error (after one in-tool retry): HTTP 500: Near/Adj queries with sub queries that can return a huge amount of results are not allowed";
const AXES = ["primary-sweep", "incumbent-class"];
const entry = (axis, term, extra = {}) => ({ qid: `${axis}:exact:${term.toLowerCase()}`, axis, predicate: "exact", term, nice_classes: ["9"], regions: [], expected_kind: "enumerate", ...extra });
const supp = (axis, term) => entry(axis, term, { qid: `supp:${axis}:exact:${term.toLowerCase()}:0000f1a1`, origin: "supplemental" });
const answered = (qid) => ({ state: "enumerated", qid, query: qid, total_hits: 0, records: [] });
const errored = (qid, reason = OUTAGE) => ({ state: "incomplete", qid, query: qid, total_hits: 0, fetched: 0, sample: [], error: true, reason });

// The follow-up's three questions on each axis, as the tool that took them left them.
const FOLLOW_UPS = Object.fromEntries(AXES.map((a) => [a, ["QZORVAKO", "QZORVAKA", "KVORZAQ"].map((t) => supp(a, `${t}${a.length}`))]));

/**
 * A run whose fan-in wrote a clean receipt (both axes answered) and whose follow-up turn then proposed three questions
 * per axis, each answered with an error carrying `reasonOf(qid)`, or answered cleanly where that is null. The executor stand-in answers each question it is sent with
 * `answerOf(qid)`: a band block to write, or null for "the dispatch sent nothing".
 */
function runAfterFollowUp(t, { reasonOf = () => OUTAGE, answerOf = (q) => errored(q), extraPlan = [], extraBlocks = {} } = {}) {
  const runDir = mkdtempSync(join(tmpdir(), "follow-up-reask-"));
  t.after(() => rmSync(runDir, { recursive: true, force: true }));
  mkdirSync(driverDir(runDir), { recursive: true });
  const P = paths(runDir);
  mkdirSync(dirname(P.registerBand("primary-sweep")), { recursive: true });
  const plan = { schema: "register-plan/1", plan_version: 1, derived_from: { job_key: "k", variants_fingerprint: "f" }, contract: { supplemental_lane: 1 },
    entries: [...AXES.map((a) => entry(a, "QZORVAK")), ...extraPlan] };
  writeFileSync(P.registerPlan, JSON.stringify(plan));
  const ctx = { registerPlan: plan, axes: AXES, paths: P, run: { slug: "qz", codename: "reask" } };
  const bands = Object.fromEntries(AXES.map((a) => [a, [answered(`${a}:exact:qzorvak`), ...(extraBlocks[a] ?? [])]]));
  for (const a of AXES) writeFileSync(P.registerBand(a), JSON.stringify(bands[a]));
  writePlanExecutionReceipt(ctx, joinPlanToBands(plan, bands));   // the fan-in's receipt
  // the follow-up turn: its proposals on file, and the tool's own first answers in the band (an error where reasonOf gives one)
  for (const a of AXES) {
    writeFileSync(join(runDir, "register-units", `${a}-supplemental-plan.json`), JSON.stringify({ schema: "register-plan/1", plan_version: 1,
      derived_from: { job_key: `supplemental:${a}`, variants_fingerprint: "supplemental" }, regions: [], rejected: [], entries: FOLLOW_UPS[a] }));
    writeFileSync(P.registerBand(a), JSON.stringify([...bands[a], ...FOLLOW_UPS[a].map((e) => (reasonOf(e.qid) ? errored(e.qid, reasonOf(e.qid)) : answered(e.qid)))]));
  }
  const sentTo = [];
  const dispatch = async (axis, qids, repairId, max) => {
    sentTo.push({ axis, qids: [...(qids ?? [])], repairId, max });
    const blocks = (qids ?? []).map((q) => answerOf(q)).filter(Boolean);
    if (!blocks.length) return null;
    const have = JSON.parse(readFileSync(P.registerBand(axis), "utf8")).filter((b) => !blocks.some((n) => n.qid === b.qid));
    writeFileSync(P.registerBand(axis), JSON.stringify([...have, ...blocks]));
    return "ok";
  };
  const receipt = () => JSON.parse(readFileSync(P.planExecution, "utf8"));
  const events = () => readFileSync(driverDir(runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const clean = () => findUnexecutedCleanClaims(AXES.map((axis) => ({ axis, status: "confirmed-clean" })), receipt().skeleton);
  return { ctx, P, dispatch, sentTo, receipt, events, clean };
}
const allFollowUps = () => AXES.flatMap((a) => FOLLOW_UPS[a].map((e) => e.qid));

test("a follow-up question still erroring is asked again once, by its qid, then deferred with its own error, and the axis is no longer unexecuted", async (t) => {
  const r = runAfterFollowUp(t);
  const out = await reaskFollowUpErrors(r.ctx, r.dispatch, "escalation");
  assert.deepEqual(r.sentTo.map((s) => [s.axis, s.qids, s.repairId, s.max]),
    AXES.map((a) => [a, FOLLOW_UPS[a].map((e) => e.qid), "follow-up-reask:escalation", 1]),
    "each axis's errored questions go to the executor once, named, never the whole axis");
  assert.deepEqual(out.sent.sort(), allFollowUps().sort());
  const receipt = r.receipt();
  assert.deepEqual(receipt.missing, [], "a question asked again and still erroring is not left missing");
  assert.deepEqual(receipt.deferred.map((d) => d.qid).sort(), allFollowUps().sort());
  for (const d of receipt.deferred) {
    assert.ok(d.reason.startsWith(PROVIDER_HARD_ERROR_PREFIX), `the deferral does not state its rule: ${d.reason}`);
    assert.match(d.reason, /HTTP 503/, "the deferral does not carry the register's own error");
  }
  assert.deepEqual(receipt.skeleton.map((s) => [s.axis, s.state]), AXES.map((a) => [a, "deferred"]));
  assert.deepEqual(r.clean(), [], "a clean row on an axis whose questions were asked again is still refused as unexecuted");
  // the attempt and what came back are on the run log before the receipt is written
  const ev = r.events();
  const asked = ev.findIndex((e) => e.event === "follow-up-reask");
  const written = ev.findIndex((e) => e.event === "plan-execution-refresh" && e.reasked === 6);
  assert.ok(asked >= 0 && written > asked, "the receipt was written before the attempt was recorded");
  assert.deepEqual(ev[asked].rows.map((x) => [x.axis, x.sent, x.answered, x.still_erroring]), AXES.map((a) => [a, 3, 0, 3]));
  assert.ok(ev[asked].rows.every((x) => x.dispatch === "ok" && x.causes.some((c) => /HTTP 503/.test(c))), JSON.stringify(ev[asked].rows));
});

test("before the re-ask the same receipt left both axes unexecuted: the failure this closes", async (t) => {
  const r = runAfterFollowUp(t);
  const { refreshSupplementalExecution } = await import("../pipeline.mjs");
  refreshSupplementalExecution(r.ctx);   // what the seam did before: fold and write, asking nothing
  assert.deepEqual(r.receipt().missing.sort(), allFollowUps().sort());
  assert.deepEqual(r.clean().map((c) => c.token).sort(), AXES.map((a) => `coverage_clean_unexecuted:${a}`).sort());
  assert.deepEqual(r.sentTo, []);
});

test("a question the register now answers is executed, and its axis reads as executed", async (t) => {
  const r = runAfterFollowUp(t, { answerOf: (q) => answered(q) });
  await reaskFollowUpErrors(r.ctx, r.dispatch, "envelope");
  const receipt = r.receipt();
  assert.deepEqual(receipt.missing, []);
  assert.deepEqual(receipt.deferred ?? [], []);
  for (const q of allFollowUps()) assert.ok(receipt.executed.some((e) => e.qid === q), `${q} answered and not executed`);
  assert.deepEqual(receipt.skeleton.map((s) => s.state), ["executed", "executed"]);
  assert.deepEqual(r.events().find((e) => e.event === "follow-up-reask").rows.map((x) => [x.answered, x.still_erroring]), [[3, 0], [3, 0]]);
});

test("a dispatch that sent nothing defers nothing: the question stays missing, though the refresh already listed it there", async (t) => {
  const r = runAfterFollowUp(t, { answerOf: () => null });
  const out = await reaskFollowUpErrors(r.ctx, r.dispatch, "escalation");
  assert.equal(r.sentTo.length, 2, "guard: the stand-in was asked");
  assert.deepEqual(out.sent, []);
  const receipt = r.receipt();
  assert.deepEqual(receipt.missing.sort(), allFollowUps().sort(), "a question nobody asked again was deferred as if it had been");
  assert.ok(!r.events().some((e) => e.event === "plan-execution-refresh" && e.reasked), "the receipt was written again after a dispatch that sent nothing");
  assert.ok(r.events().find((e) => e.event === "follow-up-reask").rows.every((x) => x.sent === 0 && /not sent/.test(x.dispatch)));
});

test("with no executor at the seam, nothing is sent and the receipt is the refresh's, as before", async (t) => {
  const r = runAfterFollowUp(t);
  await reaskFollowUpErrors(r.ctx, null, "envelope");
  assert.deepEqual(r.receipt().missing.sort(), allFollowUps().sort());
});

test("one axis's re-ask leaves the other axis's answered evidence as it was", async (t) => {
  // only primary-sweep's follow-ups errored; incumbent-class's were answered by the tool
  const r = runAfterFollowUp(t, { reasonOf: (q) => (q.includes("incumbent-class") ? null : OUTAGE) });
  const ic = r.P.registerBand("incumbent-class");
  const before = readFileSync(ic, "utf8");
  await reaskFollowUpErrors(r.ctx, r.dispatch, "escalation");
  assert.deepEqual(r.sentTo.map((s) => s.axis), ["primary-sweep"], "an axis with nothing errored was sent questions");
  assert.equal(readFileSync(ic, "utf8"), before, "the other axis's band moved");
  const sk = Object.fromEntries(r.receipt().skeleton.map((s) => [s.axis, s.state]));
  assert.deepEqual(sk, { "primary-sweep": "deferred", "incumbent-class": "executed" });
});

test("a run on which no follow-up question errored sends nothing more", async (t) => {
  const r = runAfterFollowUp(t, { reasonOf: () => null });
  assert.equal(await reaskFollowUpErrors(r.ctx, r.dispatch, "escalation"), null);
  assert.deepEqual(r.sentTo, []);
  assert.ok(!r.events().some((e) => e.event === "follow-up-reask"));
  assert.deepEqual(r.receipt().missing, []);
});

test("a refusal retrying cannot help, a sticky gap, a question already deferred and one with no answer at all are not asked again", async (t) => {
  const refused = supp("primary-sweep", "REFUSEDQZ");
  const silent = supp("primary-sweep", "SILENTQZ");
  const deferredBefore = supp("incumbent-class", "SPENTQZ");
  const r = runAfterFollowUp(t, { answerOf: (q) => errored(q),
    extraPlan: [refused, silent, deferredBefore],
    extraBlocks: { "primary-sweep": [errored(refused.qid, REFUSED)], "incumbent-class": [errored(deferredBefore.qid)] } });
  // the fan-in's ladder already spent `deferredBefore`: the receipt defers it
  const rc = r.receipt();
  writeFileSync(r.P.planExecution, JSON.stringify({ ...rc, deferred: [{ qid: deferredBefore.qid, reason: PROVIDER_HARD_ERROR_PREFIX + OUTAGE }] }));
  r.ctx.planExecution = null;
  // and the run accepted one follow-up as a capability gap
  const sticky = FOLLOW_UPS["incumbent-class"][0].qid;
  writeFileSync(r.P.envelopeDecision, JSON.stringify({ sticky_gaps: [{ qid: sticky, axis: "incumbent-class", reason: "capability-gap: office outside the register's vocabulary" }] }));
  await reaskFollowUpErrors(r.ctx, r.dispatch, "escalation");
  const sent = r.sentTo.flatMap((s) => s.qids);
  for (const q of [refused.qid, silent.qid, deferredBefore.qid, sticky]) assert.ok(!sent.includes(q), `${q} was asked again`);
  assert.deepEqual(sent.sort(), allFollowUps().filter((q) => q !== sticky).sort());
  const receipt = r.receipt();
  assert.ok(receipt.missing.includes(silent.qid), "a question with no answer of any kind stopped being missing");
  assert.ok(receipt.deferred.some((d) => d.qid === refused.qid), "the refusal is not deferred at once");
});

test("a question the caller already asked again in this pass is counted, not asked a third time", async (t) => {
  const r = runAfterFollowUp(t);
  const reattempted = FOLLOW_UPS["primary-sweep"].map((e) => e.qid);
  await reaskFollowUpErrors(r.ctx, r.dispatch, "frame-reopen", { reasked: reattempted });
  assert.deepEqual(r.sentTo.map((s) => [s.axis, s.repairId]), [["incumbent-class", "follow-up-reask:frame-reopen"]]);
  const receipt = r.receipt();
  assert.deepEqual(receipt.missing, []);
  for (const q of reattempted) assert.ok(receipt.deferred.some((d) => d.qid === q), `${q} was asked again by its caller and not counted`);
  const row = r.events().find((e) => e.event === "follow-up-reask").rows.find((x) => x.axis === "primary-sweep");
  assert.equal(row.sent, 3);
  assert.match(row.dispatch, /asked again by the caller/);
});

test("a question asked again and deferred is not asked again at the next seam", async (t) => {
  const r = runAfterFollowUp(t);
  await reaskFollowUpErrors(r.ctx, r.dispatch, "escalation");
  r.sentTo.length = 0;
  assert.equal(await reaskFollowUpErrors(r.ctx, r.dispatch, "envelope"), null);
  assert.deepEqual(r.sentTo, []);
  assert.equal(r.receipt().deferred.length, 6);
  assert.ok(existsSync(r.P.planExecution));
});
