// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// An accepted order keeps one receipt, found by the reference its door returned and only by the account that placed
// it: while it waits, while a worker checks it, once its run starts, and when it is refused before any run exists.
// The submission door (the CLI), the worker (the real runner, against the mock engine) and the lookup are all driven
// here, offline, for two accounts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { pinEnv } from "../../shared/env-aliases.mjs";
import { refuseOnPreRunFailure } from "./precondition-refusal.mjs";
import { orderReceipt, receiptIn, orderInScope, ORDER_REF_RE } from "../order-receipt.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
const CLI = join(HERE, "..", "enqueue.mjs");
chmodSync(CLAUDE, 0o755);

const A = { account: "demo-brand-owner" };
const B = { account: "zephyr" };
const until = async (pred, { timeoutMs = 20000, stepMs = 50 } = {}) => {
  for (const t0 = Date.now(); Date.now() - t0 < timeoutMs; await new Promise((r) => setTimeout(r, stepMs))) if (pred()) return true;
  return false;
};

test("submission, worker and lookup: each order keeps one receipt, seen only by its own account", async () => {
  const root = mkdtempSync(join(tmpdir(), "clearotron-receipt-"));
  const qdir = join(root, "intake-queue");
  const barrier = join(root, "release-barrier");
  const env = {
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE,
    CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_QUEUE_DIR: qdir,
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    CORSEARCH_SESSION_KEY: "test-offline", CLEAROTRON_SATPROBE_CODESIDE: "0", CLEAROTRON_BAND_TRUTH_GATE: "0",
    MOCK_BARRIER_FILE: barrier, CLEAROTRON_MAX_CONCURRENT_RUNS: "2", CLEAROTRON_QUEUE_SCAN_MS: "100",
  };
  const submit = (id, profileKey, extra = {}) => {
    const file = join(root, `${id}.request.json`);
    // Each account orders its own mark: the runner's matter signature does not include the account, so the same mark
    // from the same forwarder would park the second as a duplicate of the first.
    writeFileSync(file, JSON.stringify({ id, profileKey, markName: profileKey === B.account ? "OTHER PROBE" : "RECEIPT PROBE", classes: [9], goods: "downloadable software",
      forwarder: "jordan", forwarderEmail: "jordan.lee@example.com", ...extra }));
    const r = spawnSync(process.execPath, [CLI, "--job", file], { env: { ...process.env, ...env }, encoding: "utf8" });
    let out = null; try { out = JSON.parse(r.stdout); } catch { /* reported below */ }
    return { code: r.status, out, stderr: r.stderr };
  };
  const look = (reference, scope) => orderReceipt({ queueDirs: [qdir], reference, scope });

  try {
    // ── SUBMISSION: three orders, two accounts, no worker running yet ──
    const refused = submit("rcpt-a-refused", A.account);                  // a demo account, without the demo marker
    const runs = submit("rcpt-a-runs", A.account, { demoRun: true });
    const other = submit("rcpt-b-runs", B.account, { demoRun: true });
    for (const s of [refused, runs, other]) assert.equal(s.code, 0, s.stderr);
    assert.deepEqual([refused.out.id, runs.out.id, other.out.id], ["rcpt-a-refused", "rcpt-a-runs", "rcpt-b-runs"],
      "the reference each door returns is the one the lookup takes");

    // Accepted and waiting, before any worker exists: the state a restart before claim also leaves.
    const waiting = look("rcpt-a-runs", A);
    assert.equal(waiting.found, true);
    assert.equal(waiting.receipt.state, "waiting");
    assert.equal(waiting.receipt.terminal, false);
    assert.equal(waiting.receipt.runId, null);
    // Another account learns nothing, the same answer as no order at all.
    assert.deepEqual(look("rcpt-a-runs", B), { found: false, basis: "not-found" });
    assert.deepEqual(look("rcpt-b-runs", A), { found: false, basis: "not-found" });
    assert.deepEqual(look("rcpt-nothing-here", A), { found: false, basis: "not-found" });

    // ── WORKER: the real runner, with the runs held at the mock engine's barrier ──
    for (const [k, v] of Object.entries(env)) pinEnv(process.env, k, v);
    const { main } = await import(`../runner.mjs?bust=${Math.random()}`);
    const done = main({ once: true });
    const started = await until(() => look("rcpt-a-runs", A).receipt?.state === "running" && look("rcpt-b-runs", B).receipt?.state === "running");
    if (!started) refuseOnPreRunFailure(join(root, "clearance-outbox"), "an-accepted-order-keeps-its-receipt.test.mjs");
    assert.ok(started, `both runs reached "running": ${JSON.stringify([look("rcpt-a-runs", A), look("rcpt-b-runs", B)])}`);
    const running = look("rcpt-a-runs", A).receipt;
    assert.match(running.runId ?? "", /-\d{4}-\d{2}-\d{2}-/, "a started order carries its run id");

    // Refused at the claim, before any run existed: the reason the runner recorded, and no run id.
    const gotRefused = await until(() => look("rcpt-a-refused", A).receipt?.state === "refused");
    assert.ok(gotRefused, JSON.stringify(look("rcpt-a-refused", A)));
    const refusal = look("rcpt-a-refused", A).receipt;
    assert.equal(refusal.terminal, true);
    assert.equal(refusal.runId, null);
    assert.ok(refusal.reason && refusal.reason.length > 10, `the recorded reason comes back: ${JSON.stringify(refusal)}`);
    assert.doesNotMatch(refusal.reason, /^notify:/m, "the runner's own bookkeeping line is not part of the reason");
    assert.deepEqual(look("rcpt-a-refused", B), { found: false, basis: "not-found" }, "nor is another account told why");

    writeFileSync(barrier, "go");
    await done;
    refuseOnPreRunFailure(join(root, "clearance-outbox"), "an-accepted-order-keeps-its-receipt.test.mjs");
    const delivered = look("rcpt-a-runs", A).receipt;
    assert.equal(delivered.state, "delivered");
    assert.equal(delivered.runId, running.runId, "the same reference keeps the same run from start to finish");
    assert.equal(look("rcpt-b-runs", B).receipt.state, "delivered");

    // ── RETRY: the same accepted submission, sent again, is that order and not a second one ──
    for (const [id, account, state] of [["rcpt-a-refused", A.account, "refused"], ["rcpt-a-runs", A.account, "delivered"]]) {
      const again = submit(id, account, id === "rcpt-a-runs" ? { demoRun: true } : {});
      assert.equal(again.code, 3, again.stderr);
      assert.equal(again.out?.existing?.state, state, JSON.stringify(again.out));
      assert.ok(!existsSync(join(qdir, `${id}.json`)), "nothing new was queued");
    }
    assert.equal(readdirSync(qdir).filter((n) => /\.json$/.test(n)).length, 0, "no second order anywhere in the queue");
    // A repeated lookup changes nothing either.
    assert.deepEqual(look("rcpt-a-runs", A), look("rcpt-a-runs", A));
  } finally {
    delete process.env.MOCK_BARRIER_FILE;
    pinEnv(process.env, "CLEAROTRON_QUEUE_DIR", undefined);
    delete process.env.CLEAROTRON_QUEUE_DIR;
    try { rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

// ── THE STATES THE WORKER ABOVE DOES NOT PASS THROUGH, read from the markers the runner writes ──
const JOB = (extra = {}) => JSON.stringify({ id: "x", profileKey: "demo-brand-owner", markName: "RECEIPT PROBE", ref: "TMP-9", ...extra });
function queueWith(files) {
  const qdir = mkdtempSync(join(tmpdir(), "receipt-q-"));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(qdir, name), body);
  return qdir;
}
const stateOf = (qdir, ref = "x") => receiptIn(qdir, ref, readdirSync(qdir));

test("claiming is not passing: a claimed order is being checked until its run is dispatched", () => {
  assert.equal(stateOf(queueWith({ "x.processing": JOB() })).state, "checking");
  assert.equal(stateOf(queueWith({ "x.processing.claimed-ab12": JOB(), "x.processing.claimed-ab12.pid": "1\n" })).state, "checking",
    "a worker that stopped mid-claim leaves the same reference, still being checked");
  const dispatched = stateOf(queueWith({ "x.processing": JOB(), "x.processing.meta": JSON.stringify({ codename: "quiet-heron", dateISO: "2026-11-26" }) }));
  assert.equal(dispatched.state, "running");
  assert.equal(dispatched.runId, "tmp9-receipt-probe-2026-11-26-quiet-heron");
});

test("a parked order is resumable, never a failure, whichever record says so", () => {
  const parked = stateOf(queueWith({ "x.postponed": JOB(),
    "x.postponed.meta": JSON.stringify({ codename: "quiet-heron", dateISO: "2026-11-26", runDir: "/runs/tmp9-receipt-probe/2026-11-26-quiet-heron" }) }));
  assert.equal(parked.state, "resumable");
  assert.equal(parked.runId, "tmp9-receipt-probe-2026-11-26-quiet-heron");
  const runDir = mkdtempSync(join(tmpdir(), "receipt-run-"));
  writeFileSync(join(runDir, ".postponed"), "{}");
  const failedButParked = stateOf(queueWith({ "x.failed": JOB(), "x.failed.result": JSON.stringify({ ok: false, failedStage: "grid", runDir }) }));
  assert.equal(failedButParked.state, "resumable", "a run directory holding a park sentinel will come back");
});

test("a refusal after dispatch is still a refusal before start; a run that stopped is a failure with its run", () => {
  const preRun = stateOf(queueWith({ "x.failed": JOB(), "x.failed.result": JSON.stringify({ ok: false, failedStage: "pre-run", reason: "engine sign-in expired", runDir: "/runs/a/2026-11-26-b" }) }));
  assert.deepEqual([preRun.state, preRun.runId, preRun.reason], ["refused", null, "engine sign-in expired"]);
  const stopped = stateOf(queueWith({ "x.failed": JOB(), "x.failed.result": JSON.stringify({ ok: false, failedStage: "grid", runDir: "/runs/slug/2026-11-26-quiet-heron" }) }));
  assert.deepEqual([stopped.state, stopped.runId], ["failed", "slug-2026-11-26-quiet-heron"]);
  const dup = stateOf(queueWith({ "x.duplicate": JOB(), "x.duplicate.reason": "duplicate — not run (a second search for the same matter)\nmatches prior msgId <another-account@x>\nnotify: sent\n" }));
  assert.deepEqual([dup.state, dup.kind, dup.reason], ["refused", "duplicate", "duplicate — not run (a second search for the same matter)"],
    "the earlier order it matched, perhaps another account's, is not named");
});

test("scope: Generic is the organisation's own; an unnamed account is for everyone-seeing callers only", () => {
  assert.equal(orderInScope({ profileKey: "generic", tenant: "org-a" }, { account: "generic", organisation: "org-a" }), true);
  assert.equal(orderInScope({ profileKey: "generic", tenant: "org-a" }, { account: "generic", organisation: "org-b" }), false);
  assert.equal(orderInScope({ msgId: "<m@x>" }, { account: "demo-brand-owner" }), false);
  assert.equal(orderInScope({ msgId: "<m@x>" }, { everything: true }), true);
});

test("an answer is never a guess: bad references, two homes and unreadable queues say so", () => {
  for (const bad of ["../etc", "a/b", "", ".hidden", "x".repeat(200)]) {
    assert.deepEqual(orderReceipt({ queueDirs: [], reference: bad, scope: A }), { found: false, basis: "invalid-reference" }, bad);
  }
  assert.ok(ORDER_REF_RE.test("portal-mabc12-xyz9") && ORDER_REF_RE.test("mcp-l9x-1a2b3c4d") && ORDER_REF_RE.test("cli-k2-9f8e7d6c"));
  const q1 = queueWith({ "x.json": JOB() }), q2 = queueWith({ "x.done": JOB() });
  assert.deepEqual(orderReceipt({ queueDirs: [q1, q2], reference: "x", scope: A }), { found: false, basis: "ambiguous" });
  if (process.getuid?.() !== 0) {
    const locked = mkdtempSync(join(tmpdir(), "receipt-locked-"));
    mkdirSync(join(locked, "q"));
    chmodSync(join(locked, "q"), 0o000);
    try {
      assert.deepEqual(orderReceipt({ queueDirs: [join(locked, "q")], reference: "x", scope: A }), { found: false, basis: "could-not-look", unreadable: 1 });
    } finally { chmodSync(join(locked, "q"), 0o700); }
  }
});
