// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-warm-turn-that-never-landed-costs-no-rung.test.mjs — criterion 1.
//
// "A warm-patch attempt either reaches the model or does not consume a ladder rung." Measured before
// this change, under `openai-agent` with the death shape on the warm turn — exit 1, sub-second,
// zero tokens:
//
//     attempt 1  usage: yes   fail: missing_file:…
//     attempt 2  usage: NONE  warm: true   fail: nonzero_exit_1
//     attempt 3  usage: none               fail: nonzero_exit_1
//
// Attempt 2 never reached the model and the ladder advanced past it anyway, so a three-attempt stage
// spent one of its three on a turn that did nothing.
//
// THE BOUND IS THE DESIGN, not the refund. Refunding unconditionally lets a warm turn that never lands
// loop until the wall. One free rung per ladder (routed 2026-08-22, provisional and one line to change)
// is the smallest concession that closes the defect.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
const ROOT = mkdtempSync(join(tmpdir(), "warm-rung-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool"));
process.env.CLEAROTRON_AGENT = "clawdi";
process.env.CLEAROTRON_RETRY_BACKOFF_MS = "0";
const GW = await import("../gateway.mjs");
const GATEWAY_SRC = readFileSync(new URL("../gateway.mjs", import.meta.url), "utf8");

const withEnv = async (vars, fn) => {
  const prev = {};
  for (const [k, v] of Object.entries(vars)) { prev[k] = process.env[k]; if (v == null) delete process.env[k]; else pinEnv(process.env, k, String(v)); }
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(prev)) { pinEnv(process.env, k, v); }
  }
};

// The startup death: no usage and no runId, which together mean the seat never answered.
const NEVER_LANDED = { code: 1, killed: false, wall: 0.3, stdout: "",
  stderr: "no rollout found for thread id (code -32600)", laneWaitMs: 0, json: null, usage: null, sessionRef: null };
// A turn that DID reach the model and merely failed — the control the refund must not touch.
const REACHED_AND_FAILED = { code: 1, killed: false, wall: 3, stdout: "", stderr: "boom", laneWaitMs: 0,
  json: { runId: "run-xyz" }, usage: { input_tokens: 40, output_tokens: 5 }, sessionRef: "thr" };
// Attempt 1: succeeds at the turn level, fails the validator — warm-eligible, so attempt 2 is the warm one.
const OK_BUT_NO_FILE = { code: 0, killed: false, wall: 2, stdout: "", stderr: "", laneWaitMs: 0,
  json: { status: "ok", runId: "run-1" }, usage: { input_tokens: 10, output_tokens: 10 }, sessionRef: "thr" };

async function ladder(tag, turnsAfterFirst, { maxRetries = "2" } = {}) {
  const runDir = mkdtempSync(join(ROOT, `${tag}-`));
  mkdirSync(driverDir(runDir), { recursive: true });
  let n = 0;
  GW.registerEngine({ name: "openai-agent",
    async runTurn() { n++; return n === 1 ? OK_BUT_NO_FILE : turnsAfterFirst; } });
  await withEnv({ CLEAROTRON_AI: "openai-agent", CLEAROTRON_MAX_RETRIES: maxRetries, CLEAROTRON_RECOVERY_MAX: "0" }, () =>
    GW.runStage("synthesis", { agent: "clawdi", message: "go", model: "haiku",
      sessionKey: `prelim-${tag}`, timeoutSec: 30, runDir, expectFile: [join(runDir, "out.md")] }));
  const readJsonl = (f) => { try { return readFileSync(driverDir(runDir, f), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
  return { turns: n, attempts: readJsonl("synthesis.jsonl"), run: readJsonl("run.jsonl") };
}

test("#789 a warm turn that never reached the model does not cost a rung", async () => {
  const { turns, attempts, run } = await ladder("free", NEVER_LANDED);

  // The premise this rests on: attempt 2 IS the warm one and it recorded no usage.
  const warmRow = attempts.find((r) => r.warm);
  assert.ok(warmRow, "no warm attempt ran — the refund would have nothing to act on");
  assert.equal(warmRow.usage ?? null, null, "premise: the warm turn recorded no usage");
  assert.equal(warmRow.runId ?? null, null, "premise: and no runId — it never reached the model");

  // THE PROPERTY. CLEAROTRON_MAX_RETRIES=2 is three attempts; the refunded rung buys a fourth.
  assert.equal(turns, 4,
    `the ladder ran ${turns} turns — a warm turn that never landed still consumed one of the three rungs`);
  assert.equal(attempts.length, 4);

  // …and it is RECORDED, not merely done. A rung silently refunded is a decision no reader can audit.
  const rung = run.filter((r) => r.event === "warm-rung");
  assert.equal(rung.length, 1, `expected exactly one warm-rung row, got ${rung.length}`);
  assert.equal(rung[0].rung_free, true);
  assert.equal(rung[0].reason, "warm turn never reached the model");
  assert.equal(rung[0].free_rungs_used, 1);
  assert.equal(rung[0].free_rungs_max, 1);
});

test("#789 THE CONTROL — a warm turn that DID reach the model still costs its rung", async () => {
  // The refund must key on "never answered", not on "failed". A turn that burned tokens and produced a
  // wrong answer has spent real money and a real rung, and refunding it would buy retries with no bound
  // at all — the failure mode the concession is bounded to avoid.
  const { turns, attempts, run } = await ladder("charged", REACHED_AND_FAILED);
  const warmRow = attempts.find((r) => r.warm);
  assert.ok(warmRow, "no warm attempt ran");
  assert.ok(warmRow.usage, "premise: this warm turn DID report usage");

  assert.equal(turns, 3, `the ladder ran ${turns} turns — a warm turn that reached the model was refunded a rung`);
  assert.equal(run.filter((r) => r.event === "warm-rung").length, 0,
    "a turn that reached the model must raise no rung decision at all");
});

test("#789 THE CONTROL — a COLD turn with no usage is not refunded either", async () => {
  // Only the WARM rung is at issue. A cold attempt that dies at startup is the ordinary failure the
  // ladder exists to absorb, and refunding it would make every ladder unbounded.
  const { turns, run } = await ladder("cold", NEVER_LANDED, { maxRetries: "0" });
  assert.equal(turns, 1, "with no retries there is no warm attempt and nothing to refund");
  assert.equal(run.filter((r) => r.event === "warm-rung").length, 0);
});

test("#789 the charging branch cannot fire today, and the bound is why it exists", () => {
  // HONEST ABOUT REACH. `warm` requires `!warmUsed`, and `warmUsed` is set the moment one fires, so a
  // ladder gets AT MOST ONE warm turn — there is no second zero-usage warm turn to charge. An arm
  // claiming to exercise that branch would be exercising a fiction.
  //
  // The counter still earns its place: it keeps the bound LOCAL, so if the one-warm-per-ladder
  // invariant is ever relaxed the refund does not silently become unbounded with it. This arm pins the
  // invariant that makes the branch unreachable, so whoever relaxes it is told the branch just went live.
  assert.match(GATEWAY_SRC, /let warmUsed = false;/);
  assert.match(GATEWAY_SRC, /const warm = attempt > 1 && !warmUsed &&/,
    "the one-warm-per-ladder invariant moved — the charging branch may now be reachable, and it needs a real arm");
  assert.match(GATEWAY_SRC, /if \(warm\) warmUsed = true;/);
  // The bound itself stays one line to change, which is the form it was routed in.
  assert.match(GATEWAY_SRC, /const WARM_ZERO_USAGE_FREE_RUNGS = 1;/);
});

process.on("exit", () => { try { rmSync(ROOT, { recursive: true, force: true }); } catch { /* best effort */ } });
