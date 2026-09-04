// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives a real run through the runner to the point of stopping it
// STOPPING A RUN, end to end.
//
// The failure this file exists to catch is not "stop does nothing" — it is "stop appears to work and
// then quietly undoes itself". A run has three ways back to life (the queue's due-postponed claim, the
// run-dir self-resume watcher, and crash reclaim of a dead claimer), and a cancel that is honoured once
// but not remembered gets resurrected by whichever of them fires next. THAT IS WHY EVERY TEST HERE RUNS
// A SECOND ADMISSION PASS. A single pass proves nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isStopReason } from "../../shared/stop-reason.mjs";   //
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling
import { refuseOnPreRunFailure } from "./precondition-refusal.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";

const queueFor = (root) => join(root, "workspace-clawdi", "studio", "prelim-search", "queue");
const studioFor = (root) => join(root, "workspace-clawdi", "studio", "prelim-search");

const jobJson = (id) => JSON.stringify({
  id, msgId: `<${id}@x>`, forwarder: "jordan", forwarderDomain: "example.com",
  ref: `TMP-${id.toUpperCase()}`, markName: `STOP PROBE ${id.toUpperCase()}`,
  classes: [9], provider: "corsearch", enqueuedAt: "2026-07-28T10:00:00.000Z",
});

const envFor = (root, extra = {}) => ({
  CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE,
  CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
  CLEAROTRON_RUN_LOCK_DIR: join(root, "run-locks"),
  CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
  CLEAROTRON_MAX_CONCURRENT_RUNS: "1", CLEAROTRON_QUEUE_SCAN_MS: "100", CLEAROTRON_RUN_LOCK_POLL_MS: "50",
  ...extra,
});

const until = async (pred, { timeoutMs = 25000, stepMs = 25 } = {}) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = pred();
    if (v) return v;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return null;
};

// The live run dir for a slug, once the pipeline has created it.
function findRunDir(root) {
  const studio = studioFor(root);
  let slugs = [];
  try { slugs = readdirSync(studio); } catch { return null; }
  for (const slug of slugs) {
    if (slug === "queue" || slug === "archive" || slug.startsWith("_") || slug.startsWith(".")) continue;
    let runs = [];
    try { runs = readdirSync(join(studio, slug)); } catch { continue; }
    for (const r of runs) {
      const d = join(studio, slug, r);
      try { if (statSync(d).isDirectory() && existsSync(join(d, "status.json"))) return d; } catch { /* not it */ }
    }
  }
  return null;
}
const statusOf = (runDir) => { try { return JSON.parse(readFileSync(join(runDir, "status.json"), "utf8")); } catch { return null; } };
const queueMarkers = (q) => readdirSync(q).filter((f) => !f.includes(".result") && !f.endsWith(".md") && !f.endsWith(".txt")).sort();

test("stopping a RUNNING run ends it as cancelled — and a second admission pass does not bring it back", async () => {
  const root = mkdtempSync(join(tmpdir(), "prelim-stop-"));
  const barrier = join(root, "release-barrier");
  for (const [k, v] of Object.entries(envFor(root, { MOCK_BARRIER_FILE: barrier }))) pinEnv(process.env, k, v);

  const Q = queueFor(root);
  mkdirSync(Q, { recursive: true });
  writeFileSync(join(Q, "stop-a.json"), jobJson("stop-a"));

  try {
    const { main } = await import(`../runner.mjs?bust=${Math.random()}`);
    const drain = main({ once: true });

    // Wait until the run is genuinely under way, then stop it mid-flight — the realistic case.
    const runDir = await until(() => findRunDir(root));
    // — an empty wait here is the first sign the run never started; the check at
    // the await point below is too late to protect the assertions in between.
    if (!runDir) refuseOnPreRunFailure(join(root, "prelim-outbox"), "runner.cancel.test.mjs");
    assert.ok(runDir, "the run created its run dir");
    const { requestCancel } = await import("../cancel.mjs");
    requestCancel(runDir, { via: "test" });
    writeFileSync(barrier, "go");   // let the in-flight turn finish; the NEXT one must not be dispatched
    await drain;
    // — BEFORE the assertions below. A run that never started leaves its
    // reason in the packets beside the queue; without this the counts below report it as a
    // product defect.
    refuseOnPreRunFailure(join(root, "prelim-outbox"), "runner.cancel.test.mjs");

    const s = statusOf(runDir);
    assert.equal(s?.state, "cancelled", "the run ended in the cancelled state");
    // — WAS `assert.equal(s.reason, null)`, on the ground that "nothing went wrong". The half that
    // is true stays true and is asserted below: `state` is `cancelled`, not `failed`, and that is where
    // "was there a fault" lives. What `reason` owes is why the run ENDED, and a reader holding
    // status.json alone — the portal, every metrics reader — could not previously tell this from a crash.
    assert.ok(isStopReason(s?.reason),
      `a stopped run's status.json must say it was stopped; got reason=${JSON.stringify(s?.reason)}`);
    assert.notEqual(s?.state, "failed", "a deliberate stop must never be recorded as a failure");
    assert.ok(existsSync(join(runDir, ".cancelled")), "a .cancelled terminal sentinel was written");
    assert.ok(!existsSync(join(runDir, ".failed")), "and NOT a .failed one");
    assert.ok(!existsSync(join(runDir, ".delivered")), "and nothing was delivered");

    // ── THE PART THAT MATTERS ───────────────────────────────────────────────────────────────────
    // A cancel routed as an ordinary failure classifies as "unknown", which buys one recovery park —
    // the run writes .postponed and the runner resumes it minutes later, still billing. Prove it did
    // not park, and prove a whole second activation leaves it alone.
    assert.ok(!existsSync(join(runDir, ".postponed")), "it did NOT park for recovery");
    const markers = queueMarkers(Q);
    assert.ok(markers.includes("stop-a.cancelled"), `queue marker is .cancelled (got ${markers.join(", ")})`);
    assert.ok(!markers.includes("stop-a.failed"), "the per-agent queue record does not say it failed");

    const { main: main2 } = await import(`../runner.mjs?bust=${Math.random()}`);
    await main2({ once: true });
    assert.equal(statusOf(runDir)?.state, "cancelled", "a second admission pass left it cancelled");
    assert.deepEqual(queueMarkers(Q), markers, "and claimed nothing — the queue is untouched");
  } finally {
    delete process.env.MOCK_BARRIER_FILE;
    rmSync(root, { recursive: true, force: true });
  }
});

test("a stopped run tells nobody it failed — no outbox run-failed packet", async () => {
  // buildFailurePacket's copy is "❌ Prelim search for X FAILED at Y", pushed to the customer. Someone
  // who pressed Stop must never receive that.
  const root = mkdtempSync(join(tmpdir(), "prelim-stop-quiet-"));
  const barrier = join(root, "release-barrier");
  for (const [k, v] of Object.entries(envFor(root, { MOCK_BARRIER_FILE: barrier }))) pinEnv(process.env, k, v);

  const Q = queueFor(root);
  mkdirSync(Q, { recursive: true });
  writeFileSync(join(Q, "stop-b.json"), jobJson("stop-b"));

  try {
    const { main } = await import(`../runner.mjs?bust=${Math.random()}`);
    const drain = main({ once: true });
    const runDir = await until(() => findRunDir(root));
    // — an empty wait here is the first sign the run never started; the check at
    // the await point below is too late to protect the assertions in between.
    if (!runDir) refuseOnPreRunFailure(join(root, "prelim-outbox"), "runner.cancel.test.mjs");
    const { requestCancel } = await import("../cancel.mjs");
    requestCancel(runDir, { via: "test" });
    writeFileSync(barrier, "go");
    await drain;
    // — BEFORE the assertions below. A run that never started leaves its
    // reason in the packets beside the queue; without this the counts below report it as a
    // product defect.
    refuseOnPreRunFailure(join(root, "prelim-outbox"), "runner.cancel.test.mjs");

    const outbox = join(root, "prelim-outbox");
    let events = [];
    try { events = readdirSync(outbox); } catch { /* no outbox at all is also fine */ }
    const bodies = events.map((f) => { try { return readFileSync(join(outbox, f), "utf8"); } catch { return ""; } });
    assert.ok(!bodies.some((b) => /run-failed/.test(b)), `no run-failed event was queued (got ${events.join(", ") || "none"})`);
    assert.ok(!bodies.some((b) => /FAILED/.test(b)), "and nothing tells the customer their search FAILED");
  } finally {
    delete process.env.MOCK_BARRIER_FILE;
    rmSync(root, { recursive: true, force: true });
  }
});

test("a run STOPPED WHILE PARKED never wakes up — the resume path reads the marker too", async () => {
  // The park is where a stop is most likely: a rate-limit window can be hours long. And it is the case
  // the engine's own check CANNOT catch, because a parked run has no turn in flight — so if the queue's
  // resume path did not read the marker, the run would wake on its own clock and carry on spending.
  const root = mkdtempSync(join(tmpdir(), "prelim-stop-parked-"));
  for (const [k, v] of Object.entries(envFor(root))) pinEnv(process.env, k, v);

  const Q = queueFor(root);
  mkdirSync(Q, { recursive: true });
  const runDir = join(studioFor(root), "tmp-parked", "2026-07-28-jade-parked");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "status.json"), JSON.stringify({
    runId: "tmp-parked-jade-parked", slug: "tmp-parked", codename: "jade-parked", date: "2026-07-28",
    state: "postponed", resetsAt: "2020-01-01T00:00:00Z", markName: "PARKED PROBE",
  }));
  // — AND THE RUN-DIR PARK SENTINEL, which the measured run carried and this fixture did not.
  // Its `resetsAt` is in the FUTURE on purpose: that is the artifact a reader meets on a terminal run,
  // a resume clock for a window that will never be honoured.
  writeFileSync(join(runDir, ".postponed"), JSON.stringify({
    ts: "2026-07-28T00:00:00.000Z", resetsAt: "2099-01-01T00:00:00Z", recoveryResumesAt: null,
  }) + "\n");
  // A job parked with its window ALREADY ELAPSED — claimDuePostponed would resume it on the next pass.
  writeFileSync(join(Q, "stop-c.postponed"), jobJson("stop-c"));
  writeFileSync(join(Q, "stop-c.postponed.meta"), JSON.stringify({
    resetsAt: "2020-01-01T00:00:00Z", codename: "jade-parked", dateISO: "2026-07-28",
    runDir, agentId: "clawdi", postponedAt: "2026-07-28T00:00:00.000Z",
  }));

  try {
    const { requestCancel } = await import("../cancel.mjs");
    requestCancel(runDir, { via: "test/parked" });

    const { main } = await import(`../runner.mjs?bust=${Math.random()}`);
    await main({ once: true });
    // — BEFORE the assertions below. A run that never started leaves its
    // reason in the packets beside the queue; without this the counts below report it as a
    // product defect.
    refuseOnPreRunFailure(join(root, "prelim-outbox"), "runner.cancel.test.mjs");

    const markers = queueMarkers(Q);
    assert.ok(markers.includes("stop-c.cancelled"), `the parked marker was retired to .cancelled (got ${markers.join(", ")})`);
    assert.ok(!markers.includes("stop-c.processing"), "it was NOT claimed and re-dispatched");
    assert.ok(!markers.includes("stop-c.postponed"), "and it is not left parked forever, reading Paused on the portal");
    assert.ok(!existsSync(join(Q, "stop-c.postponed.meta")), "its resume meta was swept");

    // ──: THE RUN DIR, which this test never looked at ──────────────────────────────────────
    //
    // Everything above passed on the measured run too. The queue said cancelled and the run dir said
    // postponed, with a resume clock for 16:50 that nothing would ever honour — so a reader of the run
    // dir alone, and any census filtering on `state`, saw a live run for ever.
    const st = JSON.parse(readFileSync(join(runDir, "status.json"), "utf8"));
    assert.equal(st.state, "cancelled",
      "the run dir still reports a LIVE state for a terminal run — the exact #1379 defect");
    assert.equal(st.resetsAt ?? null, null, "a terminal run kept its rate-limit resume clock");
    assert.equal(st.recoveryResumesAt ?? null, null, "a terminal run kept its recovery resume clock");
    assert.ok(!existsSync(join(runDir, ".postponed")),
      "the live park sentinel outlived the run — with a future resetsAt, it reads as 'come back later'");
    assert.ok(existsSync(join(runDir, ".cancelled")),
      "no terminal sentinel in the run dir; the cancel-from-running path writes one");
    const resPath = join(Q, "stop-c.cancelled.result");
    assert.ok(existsSync(resPath), "no .cancelled.result sidecar — the cancel-from-running path writes one");
    const res = JSON.parse(readFileSync(resPath, "utf8"));
    assert.equal(res.cancelled, true, "the sidecar must say what it is, the way every other .result does");
    assert.equal(res.ok, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the run-dir self-resume watcher also refuses a cancelled run", async () => {
  // The second of the three ways back to life: a run-dir `.postponed` sentinel self-resumes even with no
  // queue sidecars at all (a manually-resumed run). It has to read the marker independently.
  const root = mkdtempSync(join(tmpdir(), "prelim-stop-selfresume-"));
  for (const [k, v] of Object.entries(envFor(root))) pinEnv(process.env, k, v);
  mkdirSync(queueFor(root), { recursive: true });

  const runDir = join(studioFor(root), "tmp-selfres", "2026-07-28-jade-selfres");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "status.json"), JSON.stringify({
    runId: "tmp-selfres-jade-selfres", slug: "tmp-selfres", codename: "jade-selfres", date: "2026-07-28",
    state: "postponed", markName: "SELF RESUME PROBE",
  }));
  writeFileSync(join(runDir, ".postponed"), JSON.stringify({
    resetsAt: "2020-01-01T00:00:00Z", postponedAt: "2026-07-28T00:00:00.000Z",
    fromStage: "register-sweeps", codename: "jade-selfres", job: JSON.parse(jobJson("stop-d")), agent: "clawdi",
  }) + "\n");

  try {
    const { requestCancel } = await import("../cancel.mjs");
    requestCancel(runDir, { via: "test/selfresume" });

    const { main } = await import(`../runner.mjs?bust=${Math.random()}`);
    await main({ once: true });
    // — BEFORE the assertions below. A run that never started leaves its
    // reason in the packets beside the queue; without this the counts below report it as a
    // product defect.
    refuseOnPreRunFailure(join(root, "prelim-outbox"), "runner.cancel.test.mjs");

    assert.ok(!existsSync(join(runDir, ".resuming")), "the watcher did not claim it for a resume");
    assert.ok(!existsSync(join(runDir, ".delivered")), "and it certainly did not deliver");
    assert.equal(statusOf(runDir)?.state, "postponed", "its status is untouched — stop_run owns writing the terminal here");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ──: THE TWO CANCEL PATHS CANNOT DRIFT APART AGAIN ─────────────────────────────────────────────
//
// R2 and R5, same evening and same box: one cancelled from RUNNING, one from POSTPONED. The first wrote
// a full terminal; the second wrote a queue marker and left the run dir claiming it was parked. The two
// paths are in different files and neither knew what the other owed, which is how they diverged — so
// this asserts the SET of run-dir surfaces rather than any one of them, and it is deliberately written
// against the retire function directly so it stays cheap enough to keep.
test("#1379 the park-cancel retire writes the same run-dir surfaces the running-path cancel does", async () => {
  const root = mkdtempSync(join(tmpdir(), "prelim-1379-parity-"));
  try {
    const Q = join(root, "queue");
    const runDir = join(root, "run");
    mkdirSync(Q, { recursive: true });
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "status.json"), JSON.stringify({
      runId: "r", state: "postponed", resetsAt: "2099-01-01T00:00:00Z", recoveryResumesAt: "2099-01-01T00:00:00Z",
    }));
    writeFileSync(join(runDir, ".postponed"), JSON.stringify({ resetsAt: "2099-01-01T00:00:00Z" }) + "\n");

    const { retireCancelledPark } = await import(`../runner.mjs?bust=${Math.random()}`);
    const did = retireCancelledPark(Q, "job-a", { runDir, codename: "jade-parked" });

    // — `matterFreed` joins the reported set, and it is FALSE here on purpose:
    // this fixture's meta carries no msgId, so the retire has no matter to name. The strict deepEqual
    // is kept rather than loosened to the run-dir keys — the contract this arm exists for is that the
    // retire reports exactly what it wrote, and a new surface belongs IN that contract, not exempt
    // from it. An arm that stopped being exact would stop catching the thing it was written for.
    assert.deepEqual(did, { result: true, status: true, sentinel: true, parkCleared: true, matterFreed: false },
      "the retire reported a surface it did not write, or skipped one it owed");
    const st = JSON.parse(readFileSync(join(runDir, "status.json"), "utf8"));
    assert.equal(st.state, "cancelled");
    assert.equal(st.resetsAt, null, "BOTH due-clocks are cleared — a cancelled recovery park must not keep one");
    assert.equal(st.recoveryResumesAt, null);
    assert.ok(!existsSync(join(runDir, ".postponed")));
    assert.ok(existsSync(join(runDir, ".cancelled")));
    assert.equal(JSON.parse(readFileSync(join(Q, "job-a.cancelled.result"), "utf8")).codename, "jade-parked",
      "the sidecar carries the identity, so a reader can join it to the run without the queue meta");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("#1379 a park with no recorded run dir still retires the queue side, and says so", async () => {
  // Fail-open, and the reason it must not throw: this runs inside the drain loop, and an exception here
  // would abandon every other due park in the same pass.
  const root = mkdtempSync(join(tmpdir(), "prelim-1379-norundir-"));
  try {
    const Q = join(root, "queue");
    mkdirSync(Q, { recursive: true });
    const { retireCancelledPark } = await import(`../runner.mjs?bust=${Math.random()}`);
    const did = retireCancelledPark(Q, "job-b", { runDir: null });
    assert.equal(did.result, true, "the queue side is all there is to do, and it still has to happen");
    assert.equal(did.status, false, "it must not claim a run-dir write it could not make");
    assert.equal(did.parkCleared, false);
    assert.ok(existsSync(join(Q, "job-b.cancelled.result")));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
