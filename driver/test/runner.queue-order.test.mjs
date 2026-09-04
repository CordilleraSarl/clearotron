// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives several runs through the real runner and asserts completion order
// Queue ORDER, end to end. Before this, the queue had none: drainQueue scanned with a bare readdirSync
// (ext4 hash order), claimed EVERY `.json` in one pass, and each launched pipeline then blocked inside
// acquireRunSlot — a spin-and-race on `wx` create, not a queue. So whatever order jobs were claimed in had
// no bearing on the order they RAN in.
//
// THAT IS WHY THESE TESTS ASSERT COMPLETION ORDER, NOT SCAN ORDER. A test that checks "the scan came back
// sorted" passes against the original defect, because the defect was entirely downstream of the scan.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling
import { refuseOnPreRunFailure } from "./precondition-refusal.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";

const queueFor = (root, agentId) => join(root, `workspace-${agentId}`, "studio", "prelim-search", "queue");

// enqueuedAt ASCENDS with the letter, and the filenames sort alphabetically the same way — so a-b-c-d is
// what BOTH fallbacks produce. Any test below that expects a different completion order can only be
// satisfied by the order file actually being honoured.
const jobJson = (letter, minute) => JSON.stringify({
  id: `ord-${letter}`, msgId: `<ord-${letter}@x>`, forwarder: "jordan", forwarderDomain: "example.com",
  ref: `TMP-ORD-${letter.toUpperCase()}`, markName: `ORDER PROBE ${letter.toUpperCase()}`,
  classes: [9], provider: "corsearch",
  enqueuedAt: `2026-07-28T10:${String(minute).padStart(2, "0")}:00.000Z`,
});

const until = async (pred, { timeoutMs = 30000, stepMs = 25 } = {}) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = pred();
    if (v) return v;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return false;
};

// Watch a queue dir and record the order `.done` markers appear in. Polling beats mtime: two runs that
// finish inside the same second have indistinguishable mtimes, and that is precisely the case that matters.
//
// `stop()` sweeps ONCE MORE before clearing the timer. Without that final sweep the LAST completion is
// always missed — its rename lands, the drain loop exits, main() resolves and the assertion runs, all
// inside one poll interval.
function watchCompletions(qdir, sink) {
  const seen = new Set();
  const sweep = () => {
    let files = [];
    try { files = readdirSync(qdir); } catch { return; }
    for (const f of files.filter((n) => n.endsWith(".done")).sort()) {
      const base = f.replace(/\.done$/, "");
      if (!seen.has(base)) { seen.add(base); sink.push(base); }
    }
  };
  const timer = setInterval(sweep, 10);
  return { stop: () => { sweep(); clearInterval(timer); } };
}

const envFor = (root, extra = {}) => ({
  CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE,
  CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
  CLEAROTRON_RUN_LOCK_DIR: join(root, "run-locks"),
  CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
  // cap 1 is the whole point: with two slots a four-job queue proves nothing about order.
  CLEAROTRON_MAX_CONCURRENT_RUNS: "1", CLEAROTRON_QUEUE_SCAN_MS: "100", CLEAROTRON_RUN_LOCK_POLL_MS: "50",
  ...extra,
});

test("the order file decides which queued job runs next — asserted on COMPLETION order, against one slot", async () => {
  const root = mkdtempSync(join(tmpdir(), "prelim-qorder-"));
  for (const [k, v] of Object.entries(envFor(root))) pinEnv(process.env, k, v);

  const Q = queueFor(root, "clawdi");
  mkdirSync(Q, { recursive: true });
  // Queued a, b, c, d — ascending by filename AND by enqueuedAt.
  writeFileSync(join(Q, "ord-a.json"), jobJson("a", 1));
  writeFileSync(join(Q, "ord-b.json"), jobJson("b", 2));
  writeFileSync(join(Q, "ord-c.json"), jobJson("c", 3));
  writeFileSync(join(Q, "ord-d.json"), jobJson("d", 4));
  // …and asserted in the exact REVERSE. Neither fallback can produce this by accident.
  writeFileSync(join(dirname(Q), ".queue-order.json"),
    JSON.stringify({ order: ["ord-d", "ord-c", "ord-b", "ord-a"] }) + "\n");

  const done = [];
  const watcher = watchCompletions(Q, done);
  try {
    const { main } = await import(`../runner.mjs?bust=${Math.random()}`);
    await main({ once: true });
    // — BEFORE the assertions below. A run that never started leaves its
    // reason in the packets beside the queue; without this the counts below report it as a
    // product defect.
    refuseOnPreRunFailure(join(root, "prelim-outbox"), "runner.queue-order.test.mjs");
    watcher.stop();   // final sweep BEFORE asserting — the finally runs after a failed assert, too late to catch the last completion
    assert.deepEqual(done, ["ord-d", "ord-c", "ord-b", "ord-a"],
      "every job ran, and they COMPLETED in the order the file asserted");
  } finally {
    watcher.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test("with no order file, the queue runs oldest-first by enqueuedAt — the field nothing used to read", async () => {
  const root = mkdtempSync(join(tmpdir(), "prelim-qorder-fallback-"));
  for (const [k, v] of Object.entries(envFor(root))) pinEnv(process.env, k, v);

  const Q = queueFor(root, "clawdi");
  mkdirSync(Q, { recursive: true });
  // enqueuedAt is DELIBERATELY the reverse of the filename order, so alphabetical-by-accident fails.
  writeFileSync(join(Q, "ord-a.json"), jobJson("a", 40));
  writeFileSync(join(Q, "ord-b.json"), jobJson("b", 30));
  writeFileSync(join(Q, "ord-c.json"), jobJson("c", 20));

  const done = [];
  const watcher = watchCompletions(Q, done);
  try {
    const { main } = await import(`../runner.mjs?bust=${Math.random()}`);
    await main({ once: true });
    // — BEFORE the assertions below. A run that never started leaves its
    // reason in the packets beside the queue; without this the counts below report it as a
    // product defect.
    refuseOnPreRunFailure(join(root, "prelim-outbox"), "runner.queue-order.test.mjs");
    watcher.stop();   // final sweep BEFORE asserting — the finally runs after a failed assert, too late to catch the last completion
    assert.deepEqual(done, ["ord-c", "ord-b", "ord-a"], "oldest enqueuedAt ran first, not the first filename");
  } finally {
    watcher.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a job the order file no longer knows about still runs — the file is advisory, never a gate", async () => {
  // `stop_run` removes a queued job with a bare rmSync and leaves the order entry behind, and the email
  // door enqueues jobs the portal never listed. Both must be harmless, or the queue would strand work.
  const root = mkdtempSync(join(tmpdir(), "prelim-qorder-advisory-"));
  for (const [k, v] of Object.entries(envFor(root))) pinEnv(process.env, k, v);

  const Q = queueFor(root, "clawdi");
  mkdirSync(Q, { recursive: true });
  writeFileSync(join(Q, "ord-b.json"), jobJson("b", 2));
  writeFileSync(join(Q, "ord-c.json"), jobJson("c", 3));   // present but UNLISTED
  writeFileSync(join(dirname(Q), ".queue-order.json"),
    // "ord-a" was cancelled and is gone; "ord-b" is real; "ord-c" was never listed.
    JSON.stringify({ order: ["ord-a", "ord-b"] }) + "\n");

  const done = [];
  const watcher = watchCompletions(Q, done);
  try {
    const { main } = await import(`../runner.mjs?bust=${Math.random()}`);
    await main({ once: true });
    // — BEFORE the assertions below. A run that never started leaves its
    // reason in the packets beside the queue; without this the counts below report it as a
    // product defect.
    refuseOnPreRunFailure(join(root, "prelim-outbox"), "runner.queue-order.test.mjs");
    watcher.stop();   // final sweep BEFORE asserting — the finally runs after a failed assert, too late to catch the last completion
    assert.deepEqual(done, ["ord-b", "ord-c"],
      "the dead entry was skipped, the listed job led, and the unlisted job followed rather than being stranded");
  } finally {
    watcher.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test("no run slot free: the drain HOLDS the job queued and admits it when a slot frees — it must not return", async () => {
  // The break condition used to be `running.size === 0`, which was safe only because the scan always
  // claimed everything it saw. Now a pass that gets no slot launches nothing, so that test alone would
  // return with the job still queued and leave it to the next .path/timer activation — a silent stall
  // under exactly the load this change is for.
  const root = mkdtempSync(join(tmpdir(), "prelim-qorder-starved-"));
  for (const [k, v] of Object.entries(envFor(root))) pinEnv(process.env, k, v);

  const Q = queueFor(root, "clawdi");
  mkdirSync(Q, { recursive: true });
  const lockDir = join(root, "run-locks");
  mkdirSync(lockDir, { recursive: true });
  // Hold the only slot from OUTSIDE the runner, with this test's own (demonstrably live) pid — the same
  // shape acquireSlot writes, so its census counts it as a live holder.
  const held = join(lockDir, "slot-0.lock");
  writeFileSync(held, `${process.pid}:held-by-test`);
  writeFileSync(join(Q, "ord-a.json"), jobJson("a", 1));

  const done = [];
  const watcher = watchCompletions(Q, done);
  let settled = false;
  try {
    const { main } = await import(`../runner.mjs?bust=${Math.random()}`);
    const drain = main({ once: true }).then(() => { settled = true; });

    // Give the drain several scan cycles against a full lock dir.
    await new Promise((r) => setTimeout(r, 600));
    // — a drain that refused before starting settles at once, which reads here as
    // "it returned while a job was queued". Ask the packets before believing that.
    if (settled) refuseOnPreRunFailure(join(root, "prelim-outbox"), "runner.queue-order.test.mjs");
    assert.equal(settled, false, "the drain did NOT return while a claimable job was still queued");
    assert.ok(existsSync(join(Q, "ord-a.json")), "and it left the job as `.json` — queued and visible, not claimed into invisibility");
    assert.ok(!existsSync(join(Q, "ord-a.processing")), "specifically: NOT claimed while there was no slot to run it in");

    rmSync(held, { force: true });   // a slot frees
    await drain;
    // — BEFORE the assertions below. A run that never started leaves its
    // reason in the packets beside the queue; without this the counts below report it as a
    // product defect.
    refuseOnPreRunFailure(join(root, "prelim-outbox"), "runner.queue-order.test.mjs");
    watcher.stop();
    assert.deepEqual(done, ["ord-a"], "the held job was admitted and completed in the SAME drain");
  } finally {
    watcher.stop();
    rmSync(root, { recursive: true, force: true });
  }
});
