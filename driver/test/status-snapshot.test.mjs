// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// status-snapshot.test.mjs — the live ops snapshot (slots / queue / in-flight / recent) assembled from a temp
// tree with all paths + run enumeration injected. Counts only LIVE-pid locks; reads the markName sidecar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { statusSnapshot } from "../status-snapshot.mjs";

const DEAD_PID = 2147483646; // process.kill(this,0) → ESRCH on any sane box

function tree() {
  const root = mkdtempSync(join(tmpdir(), "snap-"));
  const runLock = join(root, "locks"); mkdirSync(runLock);
  const turnLock = join(runLock, "turns"); mkdirSync(turnLock);
  // one LIVE run slot (our own pid, tag=clawdi) + one DEAD slot (must not count)
  writeFileSync(join(runLock, "slot-0.lock"), `${process.pid}:abc:clawdi`);
  writeFileSync(join(runLock, "slot-1.lock"), `${DEAD_PID}:def:agent-b`);
  writeFileSync(join(turnLock, "turn-0.lock"), `${process.pid}:ghi`);
  // queue: one waiting .json (+ markName sidecar) and one claimed .processing
  const qdir = join(root, "workspace-clawdi", "studio", "prelim-search", "queue"); mkdirSync(qdir, { recursive: true });
  writeFileSync(join(qdir, "job1.json"), JSON.stringify({ classes: [9, 42], profileKey: "zephyr", forwarder: "requesting-lawyer" }));
  writeFileSync(join(qdir, "job1.markName.md"), "AURORA GLOW\n");
  writeFileSync(join(qdir, "job2.processing"), "{}");
  return { root, runLock, turnLock, qdir };
}

const RUNS = [
  { state: "running", runId: "r1", slug: "aura", codename: "x", agent: "clawdi", markName: "AURA", stepN: 5, stepTotal: 9, stepLabel: "Synthesis", startedAt: "2026-06-16T10:00:00Z", updatedAt: "2026-06-16T10:12:00Z" },
  { state: "delivered", runId: "r2", slug: "myr", codename: "y", verdict: "clearance", url: "https://x/r2/report.html", deliveredAt: "2026-06-15T09:00:00Z", updatedAt: "2026-06-15T09:00:00Z" },
  { state: "failed", runId: "r3", slug: "fire", codename: "z", failedStage: "synthesis", reason: "timeout", updatedAt: "2026-06-14T08:00:00Z" },
  { state: "postponed", runId: "r4", slug: "nova-pulse", codename: "quartz-vault", agent: "clawdi", markName: "PROJECT NOVA PULSE", stepN: 2, stepTotal: 9, stepLabel: "Register sweeps", resetsAt: "2026-06-16T11:30:00Z", updatedAt: "2026-06-16T10:30:00Z" },
  // auto-recovery park (2026-07-29 hardening): paused-but-alive, backing off — same bucket as postponed
  { state: "recovering", runId: "r6", slug: "ember-arc", codename: "v", agent: "clawdi", markName: "EMBER ARC", stepN: 4, stepTotal: 9, stepLabel: "Register sweeps", resetsAt: "2026-06-16T10:32:00Z", updatedAt: "2026-06-16T10:30:00Z" },
  // presentation-retired (2026-07-06): hidden from EVERY surface bucket, reversibly (status.retired flag)
  { state: "failed", runId: "r5", slug: "old-test", codename: "w", failedStage: "fan-in", reason: "e2e noise", updatedAt: "2026-06-13T08:00:00Z", status: { retired: true } },
];

test("snapshot: counts only live-pid slots, reads queue + markName sidecar, partitions runs", () => {
  const t = tree();
  const snap = statusSnapshot({
    now: "2026-06-16T10:12:30Z",
    queueDirs: [t.qdir], runLockDir: t.runLock,
    runCap: 3, enumerate: () => RUNS,
  });
  assert.equal(snap.slots.run.inUse, 1, "dead slot must not count");
  assert.deepEqual(snap.slots.run.agents, ["clawdi"]);
  assert.equal(snap.slots.run.cap, 3);
  // — `slots.turn` is GONE, not zeroed. Nothing acquires a turn slot since the gateway comms
  // one-shots became packets, so the pair would have read `{inUse: 0, cap: 3}` on every box forever: a
  // limit and a usage count, both true, describing a mechanism that no longer exists.
  assert.equal(snap.slots.turn, undefined, "a cap nothing can reach must not be reported as a cap");
  // queue
  assert.equal(snap.queuedTotal, 1);
  assert.equal(snap.queues[0].agent, "clawdi");
  assert.equal(snap.queues[0].processing, 1);
  assert.equal(snap.queues[0].jobs[0].markName, "AURORA GLOW", "markName from the sidecar, not the manifest");
  assert.deepEqual(snap.queues[0].jobs[0].classes, [9, 42]);
  assert.equal(snap.queues[0].jobs[0].profileKey, "zephyr");
  // runs partition
  assert.equal(snap.inFlight.length, 1);
  assert.equal(snap.inFlight[0].stepLabel, "Synthesis");
  assert.equal(snap.recent.length, 2, "delivered + failed, NOT the running or postponed one");
  assert.ok(!snap.recent.some((r) => r.runId === "r5"), "a retired row is hidden from recent (reversible presentation flag)");
  // rate-limit POSTPONE + auto-recovery park: one paused-but-alive bucket, carries the resume time,
  // excluded from both inFlight + recent. A recovering run matching NO bucket was the 2026-07-29
  // invisibility defect: it vanished from status.html for as long as it backed off.
  assert.equal(snap.postponed.length, 2, "postponed + recovering share the paused-but-alive partition");
  assert.equal(snap.postponed[0].markName, "PROJECT NOVA PULSE");
  assert.equal(snap.postponed[0].resetsAt, "2026-06-16T11:30:00Z", "resume time surfaced for the UI");
  const recovering = snap.postponed.find((r) => r.state === "recovering");
  assert.ok(recovering, "a recovering run is VISIBLE (it used to match no bucket at all)");
  assert.equal(recovering.markName, "EMBER ARC");
  assert.equal(recovering.resetsAt, "2026-06-16T10:32:00Z", "its backoff clock rides the same field");
  for (const st of ["postponed", "recovering"])
    assert.ok(!snap.recent.some((r) => r.state === st) && !snap.inFlight.some((r) => r.state === st), `${st} never leaks into recent/inFlight`);
  assert.equal(snap.generatedAt, "2026-06-16T10:12:30Z");
});

test("activity feed uses its OWN report window (activityLimit), not the 8-row recent cap", () => {
  const many = [];
  for (let i = 0; i < 20; i++) {
    many.push({ state: "delivered", runId: `r${i}`, slug: `s${i}`, verdict: "clearance",
      deliveredAt: `2026-06-${String(28 - i).padStart(2, "0")}T09:00:00Z`, updatedAt: `2026-06-${String(28 - i).padStart(2, "0")}T09:00:00Z` });
  }
  const snap = statusSnapshot({
    now: "2026-06-29T00:00:00Z", queueDirs: [], runLockDir: "/no/locks",
    runCap: 3, enumerate: () => many,
    ledgerPath: "/no/ledger", skektechStatePath: "/no/skek",
    activityLimit: 15,
  });
  assert.equal(snap.recent.length, 8, "the slim legacy bucket keeps its own cap");
  assert.equal(snap.recentActivity.length, 15, "reports beyond the recent cap stay eligible for the feed");
});

test("alive checks get their own bucket; the feed is reports-only; no quality summary since #265", () => {
  const root = mkdtempSync(join(tmpdir(), "snap-split-"));
  const now = "2026-07-10T10:00:00Z";
  const ledger = join(root, "run-activity.jsonl");
  const lines = [
    { ts: "2026-07-10T09:58:00Z", id: "nova-pulse@1", kind: "quality-check", label: "NOVA PULSE", case: "nova-pulse", state: "running" },
    { ts: "2026-07-10T09:57:00Z", id: "aura@1", kind: "quality-check", label: "AURA", case: "aura", state: "waiting" },
    { ts: "2026-07-10T09:00:00Z", id: "fire@1", kind: "quality-check", label: "FIRE", case: "fire", state: "done", costUsd: 5 },
  ].map((r) => JSON.stringify(r)).join("\n") + "\n";
  writeFileSync(ledger, lines);
  // A stale hub status file left on disk by a pre- deploy must be IGNORED, not read.
  writeFileSync(join(root, "quality-status.json"), JSON.stringify({ regression_health: "RED", generated_at: now,
    by_case: [{ id: "fire", flag: "RED", stale: false, last_checked: "2026-07-10" }] }));
  const snap = statusSnapshot({
    now, queueDirs: [], runLockDir: "/no/locks", runCap: 3,
    enumerate: () => [{ state: "delivered", runId: "r1", slug: "s", verdict: "clearance", deliveredAt: "2026-07-10T08:00:00Z", updatedAt: "2026-07-10T08:00:00Z" }],
    pool: root,
  });
  assert.deepEqual(snap.checksInProgress.map((c) => [c.label, c.state]), [["NOVA PULSE", "running"], ["AURA", "waiting"]]);
  assert.deepEqual(snap.recentActivity.map((a) => a.kind), ["report"], "the feed is reports-only");
  assert.ok(!("qualitySummary" in snap), "#265: the snapshot carries no quality summary — the hub it described is deleted");
  // a bare pool: empty alive bucket, never a throw
  const bare = statusSnapshot({ now, queueDirs: [], runLockDir: "/no", runCap: 1, enumerate: () => [], pool: join(root, "nope") });
  assert.deepEqual(bare.checksInProgress, []);
});

test("snapshot: degrades to empty-but-valid when enumerate throws / dirs absent", () => {
  const snap = statusSnapshot({
    now: "t", queueDirs: ["/no/such/queue"], runLockDir: "/no/such/locks",
    runCap: 3, enumerate: () => { throw new Error("torn workspace"); },
  });
  assert.equal(snap.slots.run.inUse, 0);
  assert.equal(snap.queuedTotal, 0);
  assert.deepEqual(snap.inFlight, []);
  assert.deepEqual(snap.postponed, []);
  assert.deepEqual(snap.recent, []);
});

// ---- spec 64: a delivered row's outcome is THE one risk statement when the run carries it ---------
import { buildRecentActivity } from "../status-snapshot.mjs";
test("spec 64: buildRecentActivity speaks the statement over the bare verdict word; legacy rows degrade", () => {
  const rows = buildRecentActivity({ reports: [
    { state: "delivered", deliveredAt: "2026-07-11T01:15:00Z", markName: "VENZY", runId: "r1", verdict: "CONDITIONAL",
      statement: "High — conditional on: Obtain consent before filing." },
    { state: "delivered", deliveredAt: "2026-07-10T19:28:00Z", markName: "LEGACY", runId: "r2", verdict: "CLEAR" },
  ] });
  assert.equal(rows[0].outcome, "High — conditional on: Obtain consent before filing.");
  assert.equal(rows[1].outcome, "CLEAR", "legacy row (no statement) renders today's word");
});

test("A5: parked-for-human joins the paused bucket (never invisible), with the split clocks + kinds surfaced", () => {
  const runs = [
    { state: "parked-for-human", runId: "p1", slug: "held", codename: "h", agent: "clawdi", markName: "HELD MARK", parkedKind: "grace-exit", updatedAt: "2026-07-28T10:00:00Z" },
    { state: "postponed", runId: "p2", slug: "capped", codename: "c", resetsAt: "2026-07-28T12:00:00Z", updatedAt: "2026-07-28T09:00:00Z" },
    { state: "failed", runId: "p3", slug: "ended", codename: "e", failedStage: "queue-reclaim", reason: "x", terminalKind: "reclaim-exhausted", updatedAt: "2026-07-28T08:00:00Z" },
  ];
  const snap = statusSnapshot({ now: "2026-07-28T10:30:00Z", queueDirs: [], runLockDir: "/no/locks", enumerate: () => runs });
  assert.equal(snap.postponed.length, 2, "a grace-exit park is paused-but-alive, exactly like a rate-limit park");
  const parked = snap.postponed.find((r) => r.runId === "p1");
  assert.equal(parked.parkedKind, "grace-exit");
  assert.ok(!snap.inFlight.some((r) => r.runId === "p1"), "and it never reads as running");
  const failed = snap.recent.find((r) => r.runId === "p3");
  assert.equal(failed.terminalKind, "reclaim-exhausted", "failed-with-artifacts says WHY on the ops surface");
});
