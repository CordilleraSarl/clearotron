// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the mock pipeline end to end with the code-side saturation probe
// PR A (2026-07-14) — pipeline-level integration for the CODE-SIDE saturation-probe member. Own file =
// own process + own workspace root (the repo convention for mock-pipeline scenarios — shared module
// state across in-process env swaps hangs; see pipeline.mock.registergap.test.mjs).
// SAFETY GUARD (2026-07-14, learned the hard way): driver.config freezes workspaceRoot at FIRST import
// with a PRODUCTION default. Pin it to a throwaway root BEFORE any driver module loads —
// a static driver import above this line would hoist past it, so driver modules are imported DYNAMICALLY.
import { mkdtempSync as __mkdtemp } from "node:fs";
import { envFrom, pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling; the default is taken only when NO spelling holds one
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || __mkdtemp(__join(__tmpdir(), "prelim-testroot-")));
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
// pin the ENGINE BINARY too — the engine path is frozen at first import, and its default is the REAL
// CLI on PATH; with the mock pinned here, an early driver import
// can never reach production even by accident.
process.env.CLEAROTRON_AI ||= "anthropic-agent";
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
process.env.CLEAROTRON_RECALL_TRIPWIRE ||= "0";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";   // inert on this branch; on the COMBINED main the truth gate must not judge hermetic mock runs against the production ledger

// the mock executor behaves like the real tool: writes the band itself, qid-stamped, from the plan file
const mockExecutor = (calls) => async ({ planPath, axis, outputPath }, { sessionKey }) => {
  calls.push({ planPath, axis, outputPath, sessionKey });
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  const blocks = plan.entries.filter((e) => e.axis === axis).map((e) => ({
    state: "incomplete", qid: e.qid, query: `${e.term} (count probe)`, total_hits: 4321, fetched: 0, sample: [],
    reason: "count-only crowd descriptor (plan-dictated)",
  }));
  writeFileSync(outputPath, JSON.stringify(blocks, null, 2) + "\n");
  return { ok: true, executed: blocks.length, states: {} };
};

// ── pipeline level: the gather member bypasses the agent when the executor lane exists ──────────────

const JOB = {
  id: "test-job-sp", msgId: "<sp@x>", forwarder: "jordan", forwarderDomain: "example.com",
  ref: "TMP8901", markName: "PROJECT NOVA PULSE", classes: [9, 41], provider: "corsearch",
};

async function runMockPipeline(env, opts = {}) {
  const root = mkdtempSync(join(tmpdir(), "prelim-spcode-"));
  for (const k of ["MOCK_VERDICT", "MOCK_PERMISSION_PROSE", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE", "MOCK_STAGE_TRACE"]) delete process.env[k];
  for (const [k, v] of Object.entries({
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root,
    CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0",
    CLEAROTRON_AGENT: "clawdi", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", ...env,
  })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB }, opts);
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { res, events };
}

test("pipeline: with an executor lane, saturation-probe is code-executed — no agent turn, run still delivers", async () => {
  const calls = [];
  const { res, events } = await runMockPipeline({}, { planExecutor: mockExecutor(calls) });
  assert.equal(res.ok, true, JSON.stringify({ ok: res.ok, fail: res.fail, stage: res.failedStage }));
  const ev = events.find((e) => e.event === "stage" && e.stage === "register-unit:saturation-probe");
  assert.ok(ev, "saturation-probe stage event present");
  assert.equal(ev.model, "code:execute-plan", "member ran code-side");
  assert.ok(calls.some((c) => c.axis === "saturation-probe"), "executor lane actually executed the axis");
  const md = readFileSync(join(res.runDir, "register-units", "saturation-probe.md"), "utf8");
  assert.match(md, /deterministic code execution/i, "audit note is the driver template, not agent prose");
  const band = JSON.parse(readFileSync(join(res.runDir, "register-units", "saturation-probe-band.json"), "utf8"));
  assert.ok(Array.isArray(band), "band present");
  // the other three axes still ran as agent stages (judgment additions stay a model concern)
  for (const ax of ["primary-sweep", "transliteration-numeric", "incumbent-class"]) {
    const u = events.find((e) => e.event === "stage" && e.stage === `register-unit:${ax}`);
    assert.ok(u && u.model !== "code:execute-plan", `${ax} stays on the agent path`);
  }
});

test("pipeline: without an executor lane (dispatch off, no injection), the agent stage remains the verbatim fallback", async () => {
  const { res, events } = await runMockPipeline({});
  assert.equal(res.ok, true, JSON.stringify({ ok: res.ok, fail: res.fail, stage: res.failedStage }));
  const ev = events.find((e) => e.event === "stage" && e.stage === "register-unit:saturation-probe");
  assert.ok(ev, "saturation-probe ran");
  assert.notEqual(ev.model, "code:execute-plan", "fallback path is the agent stage (mock engine)");
});

test("A6: a skeptic ESCALATE on the code-side axis gets a deterministic RECHECK — one executor re-dispatch, an ending either way", async () => {
  const calls = [];
  const { res, events } = await runMockPipeline(
    { MOCK_SKEPTIC: "- saturation-probe counts look thin\n\n## Escalation decisions\nESCALATE: saturation-probe — re-verify the crowd counts" },
    { planExecutor: mockExecutor(calls) });
  assert.equal(res.ok, true, JSON.stringify({ ok: res.ok, fail: res.fail, stage: res.failedStage }));
  // the skip is still recorded (there is no session to warm-resume) …
  const skipped = events.find((e) => e.event === "escalation-skipped" && e.axis === "saturation-probe");
  assert.ok(skipped, "escalation-skipped event still fires (no session is a fact)");
  // … but it no longer ENDS there: the deterministic recheck re-dispatched the axis's frozen qids
  const recheck = events.find((e) => e.event === "escalation-recheck" && e.axis === "saturation-probe");
  assert.ok(recheck, "escalation-recheck event present — the flag has an ending");
  assert.equal(recheck.dispatched, true, "the executor lane actually re-ran the dictated entries");
  assert.equal(recheck.outcome, "ok");
  const spCalls = calls.filter((c) => c.axis === "saturation-probe");
  assert.ok(spCalls.length >= 2, `initial code-side execution + the recheck dispatch (got ${spCalls.length})`);
  // and the repair is on the ledger like every other deterministic repair
  const repairs = JSON.parse(readFileSync(driverDir(res.runDir, "repairs.json"), "utf8"));
  assert.ok(Object.keys(repairs).some((k) => k.startsWith("escalation-recheck:")), "budgeted through the persistent repair ledger");
});

test("A6: a recheck whose fresh counts CHANGE the band mints digest work — the settlement flush reconciles it in-pass, no delivery-stale park", async () => {
  // The recheck exists FOR the changed-band case. The change must reach the digest THIS pass via the
  // settlement flush (the same lane the warm escalation rides) — if nothing is minted, the
  // pre-synthesis flush no-ops, synthesis is built from the pre-recheck digest, and the delivery
  // freshness gate (register-digest is on the stale path) blocks the run into a park + full back-half
  // recompute for what one flush section reconciles. Executor variant: every dispatch returns
  // DIFFERENT totals, so the recheck's re-dispatch rewrites the band file.
  const calls = [];
  const changingExecutor = async ({ planPath, axis, outputPath }, { sessionKey }) => {
    calls.push({ planPath, axis, outputPath, sessionKey });
    const plan = JSON.parse(readFileSync(planPath, "utf8"));
    const blocks = plan.entries.filter((e) => e.axis === axis).map((e) => ({
      state: "incomplete", qid: e.qid, query: `${e.term} (count probe)`, total_hits: 1000 + 1111 * calls.length, fetched: 0, sample: [],
      reason: "count-only crowd descriptor (plan-dictated)",
    }));
    writeFileSync(outputPath, JSON.stringify(blocks, null, 2) + "\n");
    return { ok: true, executed: blocks.length, states: {} };
  };
  const { res, events } = await runMockPipeline(
    { MOCK_SKEPTIC: "- saturation-probe counts look thin\n\n## Escalation decisions\nESCALATE: saturation-probe — re-verify the crowd counts" },
    { planExecutor: changingExecutor });
  assert.equal(res.ok, true, JSON.stringify({ ok: res.ok, fail: res.fail, stage: res.failedStage }));
  const recheck = events.find((e) => e.event === "escalation-recheck" && e.axis === "saturation-probe");
  assert.ok(recheck, "escalation-recheck event present");
  assert.equal(recheck.bandChanged, true, "the fresh dispatch changed the band");
  // the change was MINTED into the digest funnel …
  const queued = events.find((e) => e.event === "digest-queued" && e.trigger === "escalation-recheck");
  assert.ok(queued, "bandChanged mints digest work (never left to the delivery-freshness gate)");
  // … and a settlement flush actually carried it (one warm re-digest, in-pass)
  const flush = events.find((e) => e.event === "digest-flush" && (e.items ?? []).some((k) => String(k).startsWith("escalation-recheck:")));
  assert.ok(flush, `the settlement flush reconciled the recheck item (flushes: ${JSON.stringify(events.filter((e) => e.event === "digest-flush"))})`);
  // and the run ended DELIVERED in one pass — no staleness throw, no recovery park (CLEAROTRON_RECOVERY_MAX=0
  // in this harness, so a delivery-stale block would have failed the run outright)
  assert.ok(!events.some((e) => e.event === "auto-recovery-parked"), "no park bought for the band change");
  assert.ok(!events.some((e) => e.event === "failed"), "no terminal failure");
});

test("A6: on the agent-fallback path (no executor lane) the unit HAS a session — the warm escalation handles it and no recheck fires", async () => {
  // The recheck exists for the code-side skip only (unitKey null). When the axis ran as an agent stage,
  // the skeptic flag rides the existing warm resume exactly as before — the recheck must not double-run.
  const { res, events } = await runMockPipeline(
    { MOCK_SKEPTIC: "- saturation-probe counts look thin\n\n## Escalation decisions\nESCALATE: saturation-probe — re-verify the crowd counts" });
  assert.equal(res.ok, true, JSON.stringify({ ok: res.ok, fail: res.fail, stage: res.failedStage }));
  assert.ok(!events.some((e) => e.event === "escalation-skipped" && e.axis === "saturation-probe"), "not skipped — the unit has a session to defend on");
  assert.ok(!events.some((e) => e.event === "escalation-recheck"), "no deterministic recheck on the warm path");
  const esc = events.find((e) => e.event === "stage" && e.stage === "register-unit:saturation-probe" && e.trigger === "escalation");
  assert.ok(esc, "the escalation ran as the warm agent follow-up, exactly as before");
});
