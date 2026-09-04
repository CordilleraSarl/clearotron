// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the real runner's continuous-admission drain end to end
// Continuous-admission regression guard (2026-06-18). Before the fix, drainQueue took a SINGLE readdir
// snapshot of the queue and Promise.all-ed that whole batch; behind the oneshot systemd service (which can't
// start a second instance while one is draining), a job arriving MID-FLIGHT waited for the entire in-flight
// batch — then the next 90s timer tick — before it could start. This proves the runner now re-scans the queue
// and CLAIMS a freshly-dropped job WHILE an earlier run is still in flight (held at a barrier here).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling
import { refuseOnPreRunFailure } from "./precondition-refusal.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
// code-side saturation-probe (2026-07-14): OFF in this legacy harness — its scenarios script the AGENT
// member; the dedicated satprobe-codeside tests exercise the code-side path with an injected executor.
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";
// band-truth gate (2026-07-14): OFF in hermetic harnesses — mock runs never dial the provider, so the
// production call ledger can never evidence their bands; the dedicated band-truth-gate tests turn it ON.
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";

const queueFor = (root, agentId) => join(root, `workspace-${agentId}`, "studio", "prelim-search", "queue");
const jobJson = (ref) => JSON.stringify({
  id: `adm-${ref}`, msgId: `<adm-${ref}@x>`, forwarder: "jordan", forwarderDomain: "example.com",
  ref, markName: "ADMISSION PROBE", classes: [9], provider: "corsearch",
});
const until = async (pred, { timeoutMs = 8000, stepMs = 50 } = {}) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return false;
};

test("continuous admission: a job dropped mid-flight is claimed while an earlier run is still in flight", async () => {
  const root = mkdtempSync(join(tmpdir(), "prelim-admission-"));
  const barrier = join(root, "release-barrier");
  for (const [k, v] of Object.entries({
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    MOCK_BARRIER_FILE: barrier, CLEAROTRON_MAX_CONCURRENT_RUNS: "2", CLEAROTRON_QUEUE_SCAN_MS: "100",
  })) pinEnv(process.env, k, v);

  const Q = queueFor(root, "clawdi");
  mkdirSync(Q, { recursive: true });
  writeFileSync(join(Q, "job-a.json"), jobJson("TMP-ADM-A"));  // only A is queued when the drain starts

  try {
    const { main } = await import(`../runner.mjs?bust=${Math.random()}`);
    const done = main({ once: true });   // do NOT await — A blocks at the matter-frame barrier

    // — the wait, THEN the refusal, THEN the assertion. This is the first thing that
    // depends on the run having started, so it is where an absent precondition surfaces; the check at the
    // await point below is too late to protect it. `refuseOnPreRunFailure` only fires when the packets
    // exist, so on a healthy run this is a no-op.
    const aClaimed = await until(() => existsSync(join(Q, "job-a.processing")));
    if (!aClaimed) refuseOnPreRunFailure(join(root, "prelim-outbox"), "runner.admission.test.mjs");
    assert.ok(aClaimed, "A claimed + in flight (at the barrier)");
    // drop B AFTER the drain has started and A is mid-flight
    writeFileSync(join(Q, "job-b.json"), jobJson("TMP-ADM-B"));
    // KEY ASSERTION: B is claimed (.processing) while A is STILL in flight (barrier not yet released).
    // — EVERY run-dependent wait needs this, not just the first. Measured: with the
    // provider absent, A still reaches `.processing` before the run refuses, so the first wait passes
    // and this one is where the absent precondition actually surfaces.
    const bClaimed = await until(() => existsSync(join(Q, "job-b.processing")));
    if (!bClaimed) refuseOnPreRunFailure(join(root, "prelim-outbox"), "runner.admission.test.mjs");
    assert.ok(bClaimed, "B (mid-flight arrival) was claimed by the re-scanning drain loop");
    assert.ok(!existsSync(join(Q, "job-a.done")), "A was still in flight when B got claimed (proves it wasn't claimed only after A finished)");

    writeFileSync(barrier, "go");   // release both runs
    await done;
    // — BEFORE the assertions below. A run that never started leaves its
    // reason in the packets beside the queue; without this the counts below report it as a
    // product defect.
    refuseOnPreRunFailure(join(root, "prelim-outbox"), "runner.admission.test.mjs");

    assert.ok(existsSync(join(Q, "job-a.done")), "A delivered");
    assert.ok(existsSync(join(Q, "job-b.done")), "B delivered in the SAME drain (no waiting for the next timer tick)");
  } finally {
    delete process.env.MOCK_BARRIER_FILE;
    try { rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});
