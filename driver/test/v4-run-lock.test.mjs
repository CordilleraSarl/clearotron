// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// V4-7: the global run-slot lock — concurrent pipeline() entries serialize (the 2026-06-12 lane
// starvation: 3 simultaneous runs ate every gateway command lane; heartbeats timed out at 75s and the
// email loop never saw a mid-run reply).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { fileURLToPath } from "node:url";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
// doc-27 Item 2 preflight: dummy credential for the offline mock run (no /mark/ citations ⇒ no record fetch).
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
// code-side saturation-probe (2026-07-14): OFF in this legacy harness — its scenarios script the AGENT
// member; the dedicated satprobe-codeside tests exercise the code-side path with an injected executor.
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";
// band-truth gate (2026-07-14): OFF in hermetic harnesses — mock runs never dial the provider, so the
// production call ledger can never evidence their bands; the dedicated band-truth-gate tests turn it ON.
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";

// driver.config freezes most paths at FIRST module load — set the workspace root before any test's
// dynamic import of pipeline.mjs evaluates the config module.
const ROOT = mkdtempSync(join(tmpdir(), "runlock-e2e-"));
for (const [k, v] of Object.entries({
  CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: ROOT, CLEAROTRON_REPORTS_DIR: join(ROOT, "pool"),
  CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", CLEAROTRON_AGENT: "clawdi", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
  CLEAROTRON_REGISTER_RECORD_LOG: join(ROOT, "records.jsonl"),
})) pinEnv(process.env, k, v);

test("acquireRunSlot: cap honored, stale (dead-PID) slot reclaimed, release frees the slot", async () => {
  const dir = mkdtempSync(join(tmpdir(), "runlock-"));
  process.env.CLEAROTRON_RUN_LOCK_DIR = dir;
  process.env.CLEAROTRON_MAX_CONCURRENT_RUNS = "2";
  process.env.CLEAROTRON_RUN_LOCK_POLL_MS = "30";
  const { acquireRunSlot } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const a = await acquireRunSlot();
  const b = await acquireRunSlot();
  assert.notEqual(a.slot, b.slot, "two slots under cap 2");
  // third must wait — and proceed only when a slot frees
  let acquired = null;
  const third = acquireRunSlot().then((s) => { acquired = s; return s; });
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(acquired, null, "third waits while both slots are held");
  const { rmSync } = await import("node:fs");
  rmSync(a.slot, { force: true });                  // release one
  await third;
  assert.ok(acquired, "third proceeds once a slot frees");
  // stale reclaim: a slot held by a dead PID is taken over (WS-C slot-lock: pid:nonce content)
  rmSync(b.slot, { force: true }); rmSync(acquired.slot, { force: true });
  writeFileSync(join(dir, "slot-0.lock"), "999999999:dead-nonce");   // no such PID
  process.env.CLEAROTRON_MAX_CONCURRENT_RUNS = "1";
  const c = await acquireRunSlot();
  assert.ok(readFileSync(c.slot, "utf8").startsWith(`${process.pid}:`), "stale slot reclaimed by the live caller");
  delete process.env.CLEAROTRON_RUN_LOCK_DIR;
  delete process.env.CLEAROTRON_MAX_CONCURRENT_RUNS;
  delete process.env.CLEAROTRON_RUN_LOCK_POLL_MS;
});

test("WS-C slot-lock: cap-3 admits 3 / blocks the 4th; release is OWNERSHIP-verified; reclaim race admits exactly one", async () => {
  const { acquireSlot, releaseSlot } = await import("../slot-lock.mjs");
  const dir = mkdtempSync(join(tmpdir(), "slotlock-"));
  const opts = { dir, cap: 3, pollMs: 20 };
  const h = [await acquireSlot(opts), await acquireSlot(opts), await acquireSlot(opts)];
  let fourth = null;
  const p4 = acquireSlot(opts).then((s) => { fourth = s; return s; });
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(fourth, null, "cap 3: the 4th waits");
  releaseSlot(h[1]);
  await p4;
  assert.ok(fourth, "4th proceeds on release");
  // ownership-verified release: a STALE handle (the slot was reclaimed/rotated since) must not free
  // the current holder's lock
  const current = readFileSync(fourth.slot, "utf8");
  releaseSlot({ slot: fourth.slot, token: "999:stale-token" });
  assert.equal(readFileSync(fourth.slot, "utf8"), current, "a stale handle never unlinks a live lock");
  for (const x of [h[0], h[2], fourth]) releaseSlot(x);
  // TOCTOU reclaim race: many concurrent acquirers vs ONE dead-PID slot at cap 1 — at no instant may
  // two racers hold it, and a loser must never free the winner's lock (the old read-then-rm reclaim
  // double-freed exactly here)
  const raceDir = mkdtempSync(join(tmpdir(), "slotlock-race-"));
  writeFileSync(join(raceDir, "slot-0.lock"), "999999999:dead");
  const raceOpts = { dir: raceDir, cap: 1, pollMs: 15 };
  let holder = null;
  const racers = Array.from({ length: 6 }, () => acquireSlot(raceOpts).then((s) => {
    assert.equal(holder, null, "two racers believe they hold the single slot simultaneously");
    holder = s;
    return new Promise((r) => setTimeout(() => { releaseSlot(holder); holder = null; r(s); }, 25));
  }));
  await Promise.all(racers);
  assert.deepEqual(readdirSync(raceDir).filter((f) => f.endsWith(".lock")), [], "all slots released cleanly");
});

test("WS-C per-agent admission: a second SAME-tag acquire queues despite free slots; other tags admit", async () => {
  const { acquireSlot, releaseSlot } = await import("../slot-lock.mjs");
  const dir = mkdtempSync(join(tmpdir(), "slottag-"));
  const a = await acquireSlot({ dir, cap: 3, pollMs: 15, tag: "clawdi" });
  const b = await acquireSlot({ dir, cap: 3, pollMs: 15, tag: "clawdi-alex" });   // different agent — admits
  let dup = null;
  const p = acquireSlot({ dir, cap: 3, pollMs: 15, tag: "clawdi" }).then((s) => { dup = s; return s; });
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(dup, null, "a same-agent run queues like under the old cap 1 (the M2 within-agent risk stays fenced)");
  releaseSlot(a);
  await p;
  assert.ok(dup, "the queued same-agent run proceeds once its predecessor releases");
  releaseSlot(b); releaseSlot(dup);
});

test("V4-7 e2e: two concurrent pipeline() launches across DIFFERENT queues run strictly serially", async () => {
  const root = ROOT;
  for (const k of ["MOCK_CL_GAPS", "MOCK_NARRATIVE_RECO", "MOCK_CL_SHORT", "MOCK_REPORT_URI", "MOCK_NO_GRID_LEDGER"]) delete process.env[k];
  for (const [k, v] of Object.entries({
    CLEAROTRON_RUN_LOCK_DIR: join(root, "locks"), CLEAROTRON_MAX_CONCURRENT_RUNS: "1", CLEAROTRON_RUN_LOCK_POLL_MS: "50",
  })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const JOB = (id, ref) => ({
    id, msgId: `<${id}@x>`, forwarder: "jordan", forwarderDomain: "example.com",
    ref, markName: "NOVAPULSE", classes: [9, 41], provider: "corsearch",
  });
  const [r1, r2] = await Promise.all([
    pipeline(JOB("lock-job-1", "TMP8445")),
    pipeline(JOB("lock-job-2", "TMP8446")),
  ]);
  assert.equal(r1.ok, true, JSON.stringify(r1));
  assert.equal(r2.ok, true, JSON.stringify(r2));
  // strict serialization: the two runs' event windows must not overlap
  const span = (res) => {
    const ts = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n")
      .map((l) => Date.parse(JSON.parse(l).ts)).filter(Boolean);
    return [Math.min(...ts), Math.max(...ts)];
  };
  const [a0, a1] = span(r1), [b0, b1] = span(r2);
  assert.ok(a1 <= b0 || b1 <= a0, `run windows overlap: [${a0},${a1}] vs [${b0},${b1}]`);
  // no slot files left behind
  assert.deepEqual(readdirSync(join(root, "locks")).filter((f) => f.endsWith(".lock")), []);
  for (const k of ["CLEAROTRON_RUN_LOCK_DIR", "CLEAROTRON_MAX_CONCURRENT_RUNS", "CLEAROTRON_RUN_LOCK_POLL_MS"]) delete process.env[k];
});

// WS-C Goal 1 e2e: cap 3 admits CONCURRENT pipelines, and each run's frozen profile sidecar stays
// its own (the WS-B spine under WS-C concurrency — the validators of each run read only their own
// run dir's floor/platform values).
test("WS-C: two concurrent pipelines run under cap 3; per-run profile sidecars stay isolated", async () => {
  for (const k of ["MOCK_CL_GAPS", "MOCK_NARRATIVE_RECO", "MOCK_CL_SHORT", "MOCK_REPORT_URI", "MOCK_NO_GRID_LEDGER", "MOCK_NO_COVERAGE_LEDGER", "MOCK_BAD_COVERAGE_LEDGER"]) delete process.env[k];
  for (const [k, v] of Object.entries({
    CLEAROTRON_RUN_LOCK_DIR: join(ROOT, "locks-wsc"), CLEAROTRON_MAX_CONCURRENT_RUNS: "3", CLEAROTRON_RUN_LOCK_POLL_MS: "50",
  })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const JOB = (id, ref, dom) => ({
    id, msgId: `<${id}@x>`, forwarder: "jordan", forwarderDomain: dom,
    ref, markName: "NOVAPULSE", classes: [9, 41], provider: "corsearch",
  });
  // DISTINCT agents — Goal 1 is cross-agent parallelism; the per-agent admission rule correctly
  // serializes same-agent runs, so a same-agent pair here would (rightly) never overlap.
  const [r1, r2] = await Promise.all([
    pipeline(JOB("wsc-job-1", "TMP8447", "aurora-interactive.example"), { agent: "clawdi" }),
    pipeline(JOB("wsc-job-2", "TMP8448", "example.com"), { agent: "clawdi-alex" }),
  ]);
  assert.equal(r1.ok, true, JSON.stringify(r1));
  assert.equal(r2.ok, true, JSON.stringify(r2));
  const sidecar = (res) => JSON.parse(readFileSync(driverDir(res.runDir, "profile.json"), "utf8"));
  assert.equal(sidecar(r1).profileKey, "aurora", "run 1 froze ITS profile");
  assert.equal(sidecar(r2).profileKey, "generic", "run 2 froze ITS profile — no cross-contamination");
  // CONCURRENCY actually happened — without this, a silent regression back to serial stays green
  const span = (res) => {
    const ts = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n")
      .map((l) => Date.parse(JSON.parse(l).ts)).filter(Boolean);
    return [Math.min(...ts), Math.max(...ts)];
  };
  const [a0, a1] = span(r1), [b0, b1] = span(r2);
  assert.ok(a0 < b1 && b0 < a1, `the two cross-agent runs never overlapped: [${a0},${a1}] vs [${b0},${b1}]`);
  // no slot files left behind (run slots at the root; turn slots under turns/). The anthropic-agent compute
  // engine acquires NO turn slots — nothing does since — so on this pure-compute
  // run the turns/ dir may never be created — guard for its absence rather than assert it exists empty.
  assert.deepEqual(readdirSync(join(ROOT, "locks-wsc")).filter((f) => f.endsWith(".lock")), []);
  const turnsDir = join(ROOT, "locks-wsc", "turns");
  assert.deepEqual(existsSync(turnsDir) ? readdirSync(turnsDir).filter((f) => f.endsWith(".lock")) : [], []);
  for (const k of ["CLEAROTRON_RUN_LOCK_DIR", "CLEAROTRON_MAX_CONCURRENT_RUNS", "CLEAROTRON_RUN_LOCK_POLL_MS"]) delete process.env[k];
});

// Phase-4 run-cap relaxation: the per-agent admission tag is LIFTED, so two SAME-AGENT runs now run
// CONCURRENTLY (pre-Phase-4 the slot tag serialized them — the gateway-era heartbeat safety, moot now that
// compute is off-gateway). DIFFERENT matters (distinct refs) so the runner's matter-dedup is not in play.
test("Phase-4: two concurrent SAME-AGENT pipelines overlap (per-agent slot admission lifted)", async () => {
  for (const k of ["MOCK_CL_GAPS", "MOCK_NARRATIVE_RECO", "MOCK_CL_SHORT", "MOCK_REPORT_URI", "MOCK_NO_GRID_LEDGER", "MOCK_NO_COVERAGE_LEDGER", "MOCK_BAD_COVERAGE_LEDGER"]) delete process.env[k];
  for (const [k, v] of Object.entries({
    CLEAROTRON_RUN_LOCK_DIR: join(ROOT, "locks-sameagent"), CLEAROTRON_MAX_CONCURRENT_RUNS: "2", CLEAROTRON_RUN_LOCK_POLL_MS: "50",
  })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const JOB = (id, ref) => ({
    id, msgId: `<${id}@x>`, forwarder: "jordan", forwarderDomain: "example.com",
    ref, markName: "NOVAPULSE", classes: [9, 41], provider: "corsearch",
  });
  const [r1, r2] = await Promise.all([
    pipeline(JOB("sameagent-1", "TMP8001"), { agent: "clawdi" }),
    pipeline(JOB("sameagent-2", "TMP8002"), { agent: "clawdi" }),
  ]);
  assert.equal(r1.ok, true, JSON.stringify(r1));
  assert.equal(r2.ok, true, JSON.stringify(r2));
  const span = (res) => {
    const ts = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n")
      .map((l) => Date.parse(JSON.parse(l).ts)).filter(Boolean);
    return [Math.min(...ts), Math.max(...ts)];
  };
  const [a0, a1] = span(r1), [b0, b1] = span(r2);
  assert.ok(a0 < b1 && b0 < a1, `same-agent runs did not overlap: [${a0},${a1}] vs [${b0},${b1}]`);
  assert.deepEqual(readdirSync(join(ROOT, "locks-sameagent")).filter((f) => f.endsWith(".lock")), []);
  for (const k of ["CLEAROTRON_RUN_LOCK_DIR", "CLEAROTRON_MAX_CONCURRENT_RUNS", "CLEAROTRON_RUN_LOCK_POLL_MS"]) delete process.env[k];
});
