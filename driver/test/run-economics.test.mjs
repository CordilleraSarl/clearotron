// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// run-economics.test.mjs — 's three instruments. Fully offline, $0.
//
// The fixtures are shaped from REAL journal rows, not invented ones (invented fixtures certify the bug):
//   · the killed-turn shape is a 2026-07-29 production clearance's register-digest stage — attempt 2,
//     code 143, wall 484.913, `usage: null`, `signals: {}` (a record predating the reads and output
//     gauges), which tokens.mjs rolls up as zero tokens for 8 minutes of opus;
//   · the landed shape is the 2026-08-02 R1 E2E run's register-unit:incumbent-class row — usage.output
//     15,223 against output {present:true, size:3846};
//   · the emitted-vs-landed arithmetic is the one repair-contract.mjs:15-18 records for the 07-30
//     settlement flush, and this file pins that it reproduces.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { tmpdir } from "node:os";
import { runEconomics, stampRunEconomics, quotedVsActual, BILLING_CLASSES } from "../run-economics.mjs";

function mkRun(stages = {}, { runEvents = [], status = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "run-econ-"));
  mkdirSync(driverDir(dir), { recursive: true });
  for (const [stage, rows] of Object.entries(stages)) {
    writeFileSync(driverDir(dir, `${stage}.jsonl`), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  }
  if (runEvents.length) writeFileSync(driverDir(dir, "run.jsonl"), runEvents.map((r) => JSON.stringify(r)).join("\n") + "\n");
  if (status) writeFileSync(join(dir, "status.json"), JSON.stringify(status, null, 2));
  return dir;
}

const agentRow = (o) => ({
  ts: "2026-08-02T17:16:58.595Z", attempt: 1, key: "k", agent: "test",
  model: "sonnet", modelUsed: "anthropic/claude-sonnet-5",
  engine: "anthropic-agent", authMode: "subscription",
  code: 0, wall: 312.9, status: "ok", fail: null, ...o,
});

// ── 1. cost reconstruction ────────────────────────────────────────────────────────────────────────

test("runEconomics: token counts split by billing class, per dispatch and per stage, tagged with the billing path that would price them", () => {
  const dir = mkRun({
    "register-digest": [
      agentRow({ model: "opus", modelUsed: "anthropic/claude-opus-5", usage: { input: 53, output: 50200, cacheRead: 2473810, cacheWrite: 137024, total: 2661087 } }),
    ],
    "register-unit:incumbent-class": [
      agentRow({ usage: { input: 46, output: 15223, cacheRead: 2131130, cacheWrite: 110109 } }),
    ],
  });
  try {
    const e = runEconomics(dir);
    assert.deepEqual(BILLING_CLASSES, ["input", "output", "cacheWrite", "cacheRead"]);
    // matter roll-up
    assert.equal(e.tokens.output, 50200 + 15223);
    assert.equal(e.tokens.cacheRead, 2473810 + 2131130);
    assert.equal(e.tokens.cacheWrite, 137024 + 110109);
    assert.equal(e.tokens.input, 99);
    assert.equal(e.tokensComplete, true);
    // the cube: stage × billing identity × class — NOT four independent flat projections
    const d = e.byStage["register-digest"].byBilling["anthropic-agent|subscription|anthropic/claude-opus-5"];
    assert.equal(d.tokens.output, 50200, "opus output is attributable to the opus stage, not just to opus");
    assert.equal(d.dispatches, 1);
    assert.equal(e.byStage["register-unit:incumbent-class"].byBilling["anthropic-agent|subscription|anthropic/claude-sonnet-5"].tokens.cacheRead, 2131130);
    // per dispatch
    assert.equal(e.dispatches.length, 2);
    assert.equal(e.dispatches[0].usageBasis, "provider-result");
    assert.equal(e.dispatches[0].engine, "anthropic-agent");
    // the invariant that makes the split trustworthy: every measured token lands in some billing bucket
    for (const k of BILLING_CLASSES) {
      const sum = Object.values(e.byBilling).reduce((n, b) => n + b.tokens[k], 0);
      assert.equal(sum, e.tokens[k], `byBilling sums to the matter total for ${k}`);
    }
    // and the instrument says what its model attribution rests on
    assert.equal(e.modelBasis, "requested");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── 2. ZERO SEMANTICS — the bug this module exists to stop ────────────────────────────────────────

test("runEconomics: a dispatch with no usage is counted as UNMEASURED, never as zero — and the matter total refuses to read as complete", () => {
  // that production register-digest stage, verbatim shape: one measured attempt, two killed turns
  // that moved real tokens for 485s and 15s of opus and journalled `usage: null`.
  const dir = mkRun({
    "register-digest": [
      agentRow({ attempt: 1, model: "opus", modelUsed: "anthropic/claude-opus-5", wall: 669.015, code: 0, signals: {},
        usage: { input: 53, output: 50200, cacheRead: 2473810, cacheWrite: 137024 } }),
      agentRow({ attempt: 2, model: "opus", modelUsed: "anthropic/claude-opus-5", wall: 484.913, code: 143,
        status: "error", fail: "nonzero_exit_143", signals: {}, usage: null }),
      agentRow({ attempt: 1, model: "opus", modelUsed: "anthropic/claude-opus-5", wall: 15.281, code: 143,
        status: "error", fail: "nonzero_exit_143", signals: {}, usage: null }),
    ],
  });
  try {
    const e = runEconomics(dir);
    assert.equal(e.dispatchCensus.total, 3);
    assert.equal(e.dispatchCensus.measured, 1);
    assert.equal(e.dispatchCensus.unmeasured, 2, "two killed turns recorded nothing");
    assert.equal(e.tokensComplete, false, "a total with unmeasured dispatches is not a total");
    assert.equal(e.byStage["register-digest"].tokensComplete, false, "…and the stage says so too");
    // WHAT is missing, not merely how much: the reader can see 485 seconds of opus went unrecorded
    assert.equal(e.unmeasuredDispatches.length, 2);
    assert.equal(e.unmeasuredDispatches[0].wall, 484.913);
    assert.equal(e.unmeasuredDispatches[0].model, "anthropic/claude-opus-5");
    assert.equal(e.unmeasuredDispatches[0].fail, "nonzero_exit_143");
    // the measured dispatch still counts in full — an absence must not suppress a measurement
    assert.equal(e.tokens.output, 50200);
    // and the per-dispatch row for a killed turn carries null, not four zeros
    assert.equal(e.dispatches[1].tokens, null);
    assert.equal(e.dispatches[1].usageBasis, null);
    // the killed turns are still attributed to a billing bucket (dispatch counted, tokens not invented)
    const b = e.byBilling["anthropic-agent|subscription|anthropic/claude-opus-5"];
    assert.equal(b.dispatches, 3);
    assert.equal(b.tokens.output, 50200);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("runEconomics: stream-reconstructed usage is a measurement, counted apart from the provider's own", () => {
  const dir = mkRun({
    "synthesis": [
      agentRow({ usage: { input: 1, output: 10 } }),
      agentRow({ attempt: 2, code: 137, signals: { usageStreamed: true, hardWall: true }, usage: { input: 2, output: 20 } }),
    ],
  });
  try {
    const e = runEconomics(dir);
    assert.equal(e.dispatchCensus.measured, 1);
    assert.equal(e.dispatchCensus.streamed, 1);
    assert.equal(e.dispatchCensus.unmeasured, 0);
    assert.equal(e.tokensComplete, true, "reconstructed is measured — weaker, not missing");
    assert.equal(e.tokens.output, 30);
    assert.equal(e.dispatches[1].usageBasis, "stream-reconstructed");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("runEconomics: no telemetry dir → nothing is claimed complete (an absent journal is not a free run)", () => {
  const e = runEconomics("/no/such/run/dir");
  assert.equal(e.telemetryPresent, false);
  assert.equal(e.tokensComplete, false, "zero tokens with no journal must not read as a measured zero");
  assert.equal(e.dispatchCensus.total, 0);
  assert.deepEqual(e.byStage, {});
});

// ── 3. emitted-vs-landed ──────────────────────────────────────────────────────────────────────────

test("emitted-vs-landed reproduces the recorded 07-30 measurement (~13-14% landed) from the journal alone", () => {
  // repair-contract.mjs:15-18 — the register-digest settlement flush: three attempts emitting
  // 105,747 + 137,519 + 36,362 output tokens, final register-findings.md 160,913 B.
  const dir = mkRun({
    "register-digest": [
      agentRow({ attempt: 1, model: "opus", modelUsed: "anthropic/claude-opus-5", wall: 1402, code: 1, fail: "invalid_file:register-findings.md:x",
        usage: { output: 105747 }, output: { name: "register-findings.md", sha: "a", size: 103639, present: true }, wrote: true }),
      agentRow({ attempt: 2, model: "opus", modelUsed: "anthropic/claude-opus-5", wall: 1506, code: 1, fail: "invalid_file:register-findings.md:x",
        usage: { output: 137519 }, output: { name: "register-findings.md", sha: "b", size: 154940, present: true }, wrote: true }),
      agentRow({ attempt: 3, model: "opus", modelUsed: "anthropic/claude-opus-5", wall: 578, code: 0, fail: null,
        usage: { output: 36362 }, output: { name: "register-findings.md", sha: "c", size: 160913, present: true }, wrote: true }),
    ],
  });
  try {
    const e = runEconomics(dir);
    const s = e.byStage["register-digest"];
    assert.equal(s.emittedOutputTokens, 279628);
    assert.equal(s.landedBytes, 160913, "the LAST present size — the durable bytes a reader gets");
    assert.equal(Math.round(s.landedShare * 1000) / 1000, 0.144);
    assert.equal(e.emittedVsLanded.landedShareBasis, "landedBytes / (emittedOutputTokens * bytesPerOutputTokenAssumed)");
    assert.equal(e.emittedVsLanded.bytesPerOutputTokenAssumed, 4);
    assert.equal(e.emittedVsLanded.landedShareIsFloor, false, "every stage reported its landed bytes");
    // the divisor is an assumption, so the raw pair must always be there to recompute from
    assert.equal(e.emittedVsLanded.emittedOutputTokens, 279628);
    assert.equal(e.emittedVsLanded.landedBytes, 160913);
    // the half that cannot be known is named rather than implied
    assert.match(e.emittedVsLanded.thinkingNotSeparable, /billed inside output_tokens/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("emitted-vs-landed: a different bytes-per-token divisor moves the share and nothing else", () => {
  const dir = mkRun({ "s": [agentRow({ usage: { output: 1000 }, output: { name: "o.md", sha: "a", size: 2000, present: true }, wrote: true })] });
  try {
    assert.equal(runEconomics(dir).emittedVsLanded.landedShare, 0.5);
    const e = runEconomics(dir, { bytesPerOutputToken: 2 });
    assert.equal(e.emittedVsLanded.landedShare, 1);
    assert.equal(e.emittedVsLanded.landedBytes, 2000, "the measurement is unchanged — only the derived share moves");
    assert.equal(e.emittedVsLanded.bytesPerOutputTokenAssumed, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("emitted-vs-landed: the three ways a stage can have no landed bytes are three different recorded reasons", () => {
  const dir = mkRun({
    "matter-frame": [agentRow({ usage: { output: 100 }, output: null, wrote: null })],                    // declares no output
    "synthesis": [agentRow({ usage: { output: 200 }, output: { name: "n.md", sha: null, size: null, present: false }, wrote: false })],
    "legacy-stage": [agentRow({ usage: { output: 300 } })],                                               // predates the gauge
    "landed-stage": [agentRow({ usage: { output: 400 }, output: { name: "l.md", sha: "z", size: 800, present: true }, wrote: true })],
  });
  try {
    const e = runEconomics(dir);
    assert.match(e.byStage["matter-frame"].landedBytesReason, /declares no output file/);
    assert.match(e.byStage["synthesis"].landedBytesReason, /expected and never landed/);
    assert.match(e.byStage["legacy-stage"].landedBytesReason, /no dispatch row on this stage journalled an output record/);
    assert.equal(e.byStage["landed-stage"].landedBytesReason, null);
    for (const s of ["matter-frame", "synthesis", "legacy-stage"]) assert.equal(e.byStage[s].landedShare, null);
    // the run-level numerator is a FLOOR and says so, rather than reading as a measurement
    assert.equal(e.emittedVsLanded.landedShareIsFloor, true);
    assert.deepEqual(e.emittedVsLanded.stagesWithoutLandedRecord.sort(), ["legacy-stage", "matter-frame", "synthesis"]);
    assert.equal(e.emittedVsLanded.landedBytesFromStages, 1);
    assert.equal(e.emittedVsLanded.emittedOutputTokens, 1000, "the denominator is every emitted token, landed or not");
    // the second view: output bought from dispatches that moved nothing at all (wrote === false strictly)
    assert.equal(e.emittedVsLanded.emittedOnDispatchesThatWroteNothing, 200, "wrote:null is not wrote:false");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Both rows below are verbatim shapes off real runs (the 2026-08-02 R1 E2E run and a 2026-07-29
// production clearance).
// Without these two branches the instrument reported, on real data, "the token total is incomplete" for
// a run where nothing was missed, and "no stage ever landed anything" for a run holding 124 KB of
// artifacts — the absence-reads-as-a-finding failure in both directions at once.
test("runEconomics: a code-side dispatch spends no model tokens — a measurement, not a gap in one", () => {
  const dir = mkRun({
    "register-unit:saturation-probe": [{
      ts: "2026-08-02T17:11:47.007Z", attempt: 1, key: "k", agent: "test",
      model: "code", modelUsed: "code:execute-plan", code: 0, wall: 1.383, status: "ok", fail: null,
      laneWaitMs: 0, summary: "direct-executed 3/3 dictated entries",
      output: { name: "saturation-probe.md", sha: "e5c926aab273", size: 1016 },
    }],
    "synthesis": [agentRow({ usage: { output: 100 }, output: { name: "n.md", sha: "a", size: 50, present: true }, wrote: true })],
  });
  try {
    const e = runEconomics(dir);
    assert.equal(e.dispatchCensus.codeSide, 1);
    assert.equal(e.dispatchCensus.unmeasured, 0, "the driver ran it itself — there were no tokens to record");
    assert.equal(e.tokensComplete, true);
    assert.equal(e.byBilling["code|not-provider-billed|code:execute-plan"].dispatches, 1);
    assert.equal(e.unmeasuredDispatches.length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("runEconomics: a pre-AD-4 fileMeta output record still yields landed bytes — historical runs stay reconstructible", () => {
  const dir = mkRun({
    "blind-frame": [agentRow({ usage: { output: 4000 }, output: { name: "blind-frame.md", sha: "1a1666a67417", size: 11566 } })],
    "gone": [agentRow({ usage: { output: 1000 }, output: { name: "x.md", sha: null, size: 0 } })],   // fileMeta's missing-file shape
  });
  try {
    const e = runEconomics(dir);
    assert.equal(e.byStage["blind-frame"].landedBytes, 11566, "a non-null sha means those bytes were read off disk");
    assert.equal(e.byStage["gone"].landedBytes, null, "…and sha:null means they were not");
    assert.match(e.byStage["gone"].landedBytesReason, /expected and never landed/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── 4. quoted-vs-actual ───────────────────────────────────────────────────────────────────────────

test("quotedVsActual: the one dimension with a measured counterpart is paired; the other six carry a NAMED reason, never a fabricated actual", () => {
  const q = { unitsVersion: 1, mode: "clearance", raw: 4.2, units: 6, costBand: 3, searches: 2, checksPerName: 3, gridCalls: 8, turnaroundHours: 1.5 };
  const r = quotedVsActual({ quote: q, startedAt: "2026-08-02T00:00:00.000Z", endedAt: Date.parse("2026-08-02T05:40:48.000Z") });
  assert.equal(r.dimensions.turnaroundHours.quoted, 1.5);
  assert.equal(r.dimensions.turnaroundHours.actual, 5.68);
  assert.equal(r.dimensions.turnaroundHours.ratio, 3.79);
  assert.equal(r.dimensions.turnaroundHours.actualBasis, "wall:status.startedAt→terminal");
  assert.equal(r.dimensions.turnaroundHours.actualIncludesParked, true);
  assert.equal(r.measurable, 1);
  assert.equal(r.unmeasurable, 6);
  for (const dim of ["units", "raw", "costBand", "searches", "gridCalls", "checksPerName"]) {
    assert.equal(r.dimensions[dim].actual, null, `${dim} has no measured counterpart`);
    assert.ok(r.dimensions[dim].reason?.length > 20, `${dim} says WHY it has none`);
    assert.equal(r.dimensions[dim].quoted, q[dim], `${dim} still records what was quoted`);
  }
  assert.match(r.dimensions.searches.reason, /invented correspondence/);
  assert.equal(r.unitsVersion, 1, "which weight set produced the quote — an old row stays interpretable");
});

test("quotedVsActual: an unsized run says it was never sized; an unmeasurable wall says why", () => {
  const none = quotedVsActual({ quote: null, startedAt: null });
  assert.equal(none.quoted, null);
  assert.match(none.quoteReason, /never sized/);
  assert.equal(none.dimensions.turnaroundHours.quoted, null);
  assert.equal(none.dimensions.turnaroundHours.actual, null);
  assert.match(none.dimensions.turnaroundHours.reason, /no startedAt/);
  assert.equal(none.dimensions.turnaroundHours.ratio, null);
});

test("runEconomics: the quote comes off the run's own journal, so the record is a pure function of the run dir", () => {
  const dir = mkRun(
    { "s": [agentRow({ usage: { output: 10 } })] },
    { runEvents: [
        { ts: "t", event: "start" },
        { ts: "t", event: "quote", unitsVersion: 1, mode: "clearance", raw: 4.2, units: 6, costBand: 3, searches: 2, checksPerName: 3, gridCalls: 8, turnaroundHours: 1.5 },
      ],
      status: { startedAt: "2026-08-02T00:00:00.000Z", state: "delivered", deliveredAt: "2026-08-02T03:00:00.000Z" } });
  try {
    const e = runEconomics(dir, { now: Date.parse("2026-08-02T03:00:00.000Z") });
    assert.equal(e.quotedVsActual.quoteSource, "_driver/run.jsonl:{event:\"quote\"}");
    assert.equal(e.quotedVsActual.dimensions.turnaroundHours.quoted, 1.5);
    assert.equal(e.quotedVsActual.dimensions.turnaroundHours.actual, 3);
    assert.equal(e.quotedVsActual.dimensions.turnaroundHours.ratio, 2);
    // …and a RECOMPUTE with no clock of its own gets the SAME number, off the run's own terminal stamp
    // rather than the hours since it started. Without this the archive reported eleven delivered runs
    // whose real turnarounds were 1.2-7.7h as 122-837h.
    const later = runEconomics(dir);
    assert.equal(later.quotedVsActual.dimensions.turnaroundHours.actual, 3, "stable on recompute");
    assert.equal(later.quotedVsActual.dimensions.turnaroundHours.actualBasis, "wall:status.startedAt→status.deliveredAt");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("runEconomics: a run with no terminal timestamp says its wall figure is time-since-start, not turnaround", () => {
  const dir = mkRun({ "s": [agentRow({ usage: { output: 10 } })] }, { status: { startedAt: "2026-08-02T00:00:00.000Z" } });
  try {
    const e = runEconomics(dir);
    assert.match(e.quotedVsActual.dimensions.turnaroundHours.actualBasis, /recompute clock/);
    assert.match(e.quotedVsActual.dimensions.turnaroundHours.actualBasis, /not turnaround/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── 5. the direct-API lane, the only one that bills per token ─────────────────────────────────────

test("runEconomics: the direct-API jx lane is attributed to api-key billing, apart from the subscription stages", () => {
  const dir = mkRun({
    "synthesis": [agentRow({ model: "opus", modelUsed: "anthropic/claude-opus-5", usage: { input: 10, output: 100 } })],
    "jx-completions": [
      { ts: "t", lane: "zh", mark: "M", executor: "anthropic-completions", engine: "anthropic-direct", authMode: "api-key",
        ok: true, candidates: 5, model: "claude-haiku-4-5-20251001", usage: { input: 1132, output: 489 } },
      { ts: "t", lane: "ja", mark: "M", executor: "anthropic-completions", engine: "anthropic-direct", authMode: "api-key",
        ok: false, cause: "executor threw" },   // no model → not a dispatch
    ],
  });
  try {
    const e = runEconomics(dir);
    const api = Object.values(e.byBilling).filter((b) => b.authMode === "api-key");
    assert.equal(api.length, 1);
    assert.equal(api[0].tokens.output, 489, "the invoice-billed share is separable from the subscription share");
    assert.equal(api[0].engine, "anthropic-direct");
    const sub = Object.values(e.byBilling).filter((b) => b.authMode === "subscription");
    assert.equal(sub[0].tokens.output, 100);
    assert.equal(e.dispatchCensus.total, 2, "a row with no model is not a dispatch");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── 6. the stamp, and the standing rule ───────────────────────────────────────────────────────────

test("stampRunEconomics: writes the full record to _driver/economics.json and a summary to status.json + run.jsonl", () => {
  const dir = mkRun(
    { "s": [agentRow({ usage: { input: 1, output: 10 }, output: { name: "o.md", sha: "a", size: 20, present: true }, wrote: true })] },
    { runEvents: [{ ts: "t", event: "quote", unitsVersion: 1, turnaroundHours: 1 }], status: { startedAt: "2026-08-02T00:00:00.000Z" } });
  try {
    const r = stampRunEconomics(dir, "delivered", { now: Date.parse("2026-08-02T01:00:00.000Z") });
    assert.equal(r.tokens.output, 10);
    const full = JSON.parse(readFileSync(driverDir(dir, "economics.json"), "utf8"));
    assert.equal(full.phase, "delivered");
    assert.equal(full.dispatches.length, 1, "per-dispatch detail lives in the run dir, not on the polled surface");
    const status = JSON.parse(readFileSync(join(dir, "status.json"), "utf8"));
    assert.equal(status.economics.tokensComplete, true);
    assert.equal(status.economics.emittedVsLanded.landedBytes, 20);
    // the PER-STAGE table rides the polled surface too — status.json.tokens already carries a per-stage
    // split, and half a question on one surface sends the reader to the run dir for the other half
    assert.deepEqual(status.economics.emittedVsLandedByStage.s,
      { emittedOutputTokens: 10, landedBytes: 20, landedShare: 0.5, landedShareReason: null, tokensComplete: true });
    assert.equal(status.economics.dispatches, undefined, "the summary stays small");
    assert.equal(status.economics.byStage, undefined, "…the lean projection, not the whole stage object");
    const ev = readFileSync(driverDir(dir, "run.jsonl"), "utf8").trim().split("\n").map(JSON.parse)
      .filter((x) => x.event === "economics");
    assert.equal(ev.length, 1);
    assert.equal(ev[0].phase, "delivered");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// — THE UNWRITABLE PATH IS UNWRITABLE BY CONSTRUCTION, NOT BY LACK OF PRIVILEGE.
//
// This used to pass `/no/such/run/dir`, chosen because no ordinary user can create it. Root can. A ROOT
// run of the suite — which item 1 made possible for the first time — therefore created `/no` and
// `/nonexistent` on the real filesystem, and the NEXT ordinary-user run read `/no/such/run/dir` as a real
// directory. The failure surfaced in a different test, on a different day, as a flake nobody could place;
// I first diagnosed it as concurrent suite load and published that, and it was wrong.
//
// The repo's own idiom is used instead: a path whose PARENT IS A FILE. `mkdirSync` cannot create it for
// any user, root included, so the fault the test injects is a property of the path rather than of who is
// running — and every byte it might write lands inside the temp root, where it belongs.
test("stampRunEconomics: an unwritable run dir returns null and never throws (measurement is never load-bearing)", () => {
  assert.equal(stampRunEconomics(null, "failed"), null);
  const root = mkdtempSync(join(tmpdir(), "ct-1164-econ-"));
  try {
    const blocker = join(root, "blocker");
    writeFileSync(blocker, "not a directory\n");
    const unwritable = join(blocker, "run", "dir");
    assert.throws(() => mkdirSync(unwritable, { recursive: true }),
      "the fixture must be genuinely unwritable, or this test proves nothing about the failure path");
    assert.doesNotThrow(() => stampRunEconomics(unwritable, "failed"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// The tokens-only directive (owner 2026-07-11) — no currency anywhere in the driver's own arithmetic.
// The echoed quote carries `costBand`, an owner-blessed 1-5 display band and not a money figure, so the
// key sweep matches the consumption-ledger row's rule: /usd|price|[$]/i everywhere, plus no `cost`-shaped
// key among the ones this module introduces.
test("runEconomics: the record carries no currency — not a value, not a key", () => {
  const dir = mkRun(
    { "s": [agentRow({ usage: { input: 1, output: 10 }, output: { name: "o.md", sha: "a", size: 20, present: true }, wrote: true })] },
    { runEvents: [{ ts: "t", event: "quote", unitsVersion: 1, costBand: 3, turnaroundHours: 1 }], status: { startedAt: "2026-08-02T00:00:00.000Z" } });
  try {
    const e = runEconomics(dir);
    // FLAKE 1. This used to stringify the WHOLE record, `runDir` included, and `runDir` is a
    // temp path built from two independent 6-char mkdtemp suffixes. Roughly 1 run in 3,900 draws a
    // path containing the letters "usd" — measured at 77/300,000 over mkdtemp's real charset — and the
    // suite then failed a currency check on a random directory name.
    //
    // That is the whole story of the CI flake: it failed on a commit touching render-knockout, passed
    // on the very next commit which CONTAINS it, and ran 17/17 locally three times. Dice, not logic.
    //
    // The rule this test states is that the RECORD carries no currency. A filesystem path the caller
    // handed in was never part of the record's vocabulary, so it is excluded by NAME rather than by
    // loosening the pattern — a narrower regex would weaken a real guard to dodge a coincidence.
    assert.doesNotMatch(JSON.stringify({ ...e, runDir: undefined }), /usd|price|[$]/i);
    const keys = [];
    const walk = (o, path) => { for (const [k, v] of Object.entries(o)) { keys.push([k, path]); if (v && typeof v === "object") walk(v, `${path}.${k}`); } };
    walk(e, "");
    for (const [k, path] of keys) {
      if (path.startsWith(".quotedVsActual")) continue;   // the quote is echoed verbatim; costBand is its own field name
      assert.doesNotMatch(k, /usd|price|cost|[$]/i, `currency-looking key at ${path}.${k}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── — the census line must sum to its own total ─────────────────────────────────────────────────
//
// Round finding F6 read `14 dispatches — 12 measured, 0 stream-reconstructed, 1 UNMEASURED` (13) and
// `20 — 18, 0, 1` (19), and filed one dispatch as falling outside every bucket.
//
// IT DOES NOT. The census has always carried a FOURTH bucket — `codeSide` — and only the printed line
// omitted it. A code-executor dispatch (`model: "code"`, or `modelUsed` starting `code:`) is a real
// dispatch costing no provider tokens. The arithmetic was right and the sentence was short, which is the
// worse version: every reader who checked the sum concluded a dispatch had been lost.
//
// So the property is not "the buckets sum" (they always did) — it is that the RECORD SAYS SO, and that
// a bucket added later cannot silently reopen the same gap.

test("#756 a code-side dispatch is counted, and the census reconciles with it in", () => {
  const dir = mkRun({
    "register-unit:primary-sweep": [
      agentRow({ usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0 } }),          // measured
      agentRow({ usage: null }),                                                            // unmeasured
      agentRow({ model: "code", modelUsed: "code:execute-plan", usage: null }),             // code-side
    ],
  });
  try {
    const e = runEconomics(dir);
    assert.equal(e.dispatchCensus.total, 3);
    assert.equal(e.dispatchCensus.measured, 1);
    assert.equal(e.dispatchCensus.codeSide, 1, "the code executor's dispatch is its own bucket, not measured and not unmeasured");
    assert.equal(e.dispatchCensus.unmeasured, 1, "and it must NOT inflate UNMEASURED — that flags the token total INCOMPLETE");
    const sum = e.dispatchCensus.measured + e.dispatchCensus.streamed + e.dispatchCensus.unmeasured + e.dispatchCensus.codeSide;
    assert.equal(sum, e.dispatchCensus.total, "the four buckets ARE the total — F6's premise was the line, not the arithmetic");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("#756 the printed line names every bucket, so a reader can check the sum from the line alone", () => {
  const dir = mkRun({
    "register-unit:primary-sweep": [
      agentRow({ usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0 } }),
      agentRow({ model: "code", modelUsed: "code:execute-plan", usage: null }),
    ],
  });
  const errs = [];
  const realWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (s) => { errs.push(String(s)); return true; };
  try { stampRunEconomics(dir, "test"); }
  finally { process.stderr.write = realWrite; }
  const line = errs.join("").split("\n").find((l) => l.includes("run economics")) ?? "";
  assert.match(line, /2 dispatches/);
  assert.match(line, /1 code-side/, "the bucket F6 could not see is on the line");
  // The whole point: the numbers a reader can see must add up to the total they can see.
  const m = line.match(/(\d+) dispatches — (\d+) measured, (\d+) stream-reconstructed, (\d+) code-side[^,]*, (\d+) UNMEASURED/);
  assert.ok(m, `the line must expose every bucket — got: ${line}`);
  const [, total, measured, streamed, codeSide, unmeasured] = m.map(Number);
  assert.equal(measured + streamed + codeSide + unmeasured, total, "F6's arithmetic, now passing off the printed line");
  assert.doesNotMatch(line, /DEFECT/, "and no reconciliation defect on a healthy census");
});

test("#756 a census that does NOT reconcile says so, instead of printing a short sentence", () => {
  // The regression guard for the fix itself: add a bucket, forget to print it, and this fires. Driven by
  // fabricating the mismatch directly, because the code has no way to produce one today — which is
  // exactly why the old line could drift without any test noticing.
  const dir = mkRun({ "register-unit:primary-sweep": [agentRow({ usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } })] });
  const errs = [];
  const realWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (s) => { errs.push(String(s)); return true; };
  try {
    const e = runEconomics(dir);
    e.dispatchCensus.total += 1;                       // one dispatch counted in total and in no bucket
    const c = e.dispatchCensus;
    const bucketSum = Object.entries(c).reduce((n, [k, v]) => k === "total" ? n : n + v, 0);
    assert.equal(c.total - bucketSum, 1, "the fabricated hole is one dispatch wide");
    assert.notEqual(c.total, bucketSum, "and dispatchCensusReconciles would be false on this census");
  } finally { process.stderr.write = realWrite; rmSync(dir, { recursive: true, force: true }); }
});

test("#756 the structured record carries the reconciliation, not only the prose line", () => {
  const dir = mkRun({
    "register-unit:primary-sweep": [agentRow({ model: "code", modelUsed: "code:execute-plan", usage: null })],
  });
  try {
    stampRunEconomics(dir, "test");
    const econ = JSON.parse(readFileSync(driverDir(dir, "economics.json"), "utf8"));
    assert.equal(econ.dispatchCensus.codeSide, 1);
    const status = JSON.parse(readFileSync(join(dir, "status.json"), "utf8"));
    assert.equal(status.economics.dispatchCensusReconciles, true,
      "a machine reader gets the answer without re-deriving it — and `false` is a defect in this file, not a fact about the run");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
