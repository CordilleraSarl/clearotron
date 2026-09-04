// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// reconcile-runs.test.mjs —.
//
// This is a writer of TERMINAL states, and progress.mjs's monotonic guard makes what it writes
// permanent: a run it terminalises cannot be reopened except through a deliberate resume. So the tests
// that matter are the ones about NOT firing. A missed corpse is a stale row in a list; a terminalised
// live run is a clearance somebody paid for, marked failed, unrecoverably.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyRun, planReconcile, terminalPatch,
  DEFAULT_QUIET_MS, ENDED_STATES, LIVE_CLAIMING_STATES, RECONCILE_VERDICTS,
} from "../reconcile-runs.mjs";
import { reconcileRunDir, findRunDirs } from "../../scripts/reconcile-runs.mjs";

const NOW = Date.parse("2026-08-17T20:00:00.000Z");
const ago = (ms) => new Date(NOW - ms).toISOString();
const HOUR = 60 * 60 * 1000;

const alive = () => true;
const dead = () => false;

// ── the exact test: a recorded pid ──────────────────────────────────────────────────────────────────

test("#1090 a running run whose pid is ALIVE is left alone", () => {
  const r = classifyRun({ state: "running", pid: 4242, pidStarttime: "99", updatedAt: ago(99 * HOUR) },
    { now: NOW, isAlive: alive });
  assert.equal(r.verdict, "live");
  // Note the updatedAt: 99 hours quiet, and it STILL does not fire. A recorded pid outranks silence,
  // because silence is the weaker test and a live process is a fact.
  assert.match(r.why, /pid 4242 is alive/);
});

test("#1090 a running run whose pid is GONE is reconciled, and the reason says which test fired", () => {
  const r = classifyRun({ state: "running", pid: 4242, pidStarttime: "99", updatedAt: ago(1000) },
    { now: NOW, isAlive: dead });
  assert.equal(r.verdict, "dead");
  assert.match(r.why, /pid 4242 is gone/);
  assert.match(r.why, /recycled/, "and it must name pid reuse as the other thing a starttime mismatch means");
});

test("#1090 the liveness check is the QUEUE's, not a second copy — same rec shape, same polarity", () => {
  // The record handed to isAlive has to be exactly what claim-liveness.mjs's claimerIsAlive takes, or
  // this file has quietly grown its own liveness opinion. That is the defect class.
  let seen = null;
  classifyRun({ state: "running", pid: 77, pidStarttime: "12345" }, { now: NOW, isAlive: (rec) => { seen = rec; return true; } });
  assert.deepEqual(seen, { pid: 77, starttime: "12345" });
  // A run stamped before /proc was readable carries a null starttime, and claimerIsAlive treats that as
  // a legacy bare pid rather than as a mismatch. It must reach it in that shape, not as undefined.
  classifyRun({ state: "running", pid: 77 }, { now: NOW, isAlive: (rec) => { seen = rec; return true; } });
  assert.deepEqual(seen, { pid: 77, starttime: null });
});

// ── the weaker test: no pid, which is every run that predates this change ───────────────────────────

test("#1090 a pid-less run that is quiet PAST the window is reconciled — the stuck run this was filed for", () => {
  const r = classifyRun({ state: "running", updatedAt: ago(9 * HOUR) }, { now: NOW });
  assert.equal(r.verdict, "quiet");
  assert.match(r.why, /no pid recorded/, "the reason must say the weaker test was the one used");
  assert.match(r.why, /9h/);
});

test("#1090 a pid-less run INSIDE the window is UNKNOWN — never reconciled, and never called live either", () => {
  const r = classifyRun({ state: "running", updatedAt: ago(2 * HOUR) }, { now: NOW });
  assert.equal(r.verdict, "unknown");
  assert.match(r.why, /cannot say/,
    "the third answer exists so 'we protected a live run' and 'we could not look' stay distinguishable");
});

test("#1090 the quiet window is a parameter, and the boundary does not fire", () => {
  const at = { state: "running", updatedAt: ago(DEFAULT_QUIET_MS) };
  assert.equal(classifyRun(at, { now: NOW }).verdict, "unknown", "exactly at the window is INSIDE it");
  assert.equal(classifyRun({ state: "running", updatedAt: ago(DEFAULT_QUIET_MS + 1) }, { now: NOW }).verdict, "quiet");
  // A shorter window is the operator's call and the CLI prints it with every verdict.
  assert.equal(classifyRun({ state: "running", updatedAt: ago(2 * HOUR) }, { now: NOW, quietMs: HOUR }).verdict, "quiet");
});

// ── the refusals ────────────────────────────────────────────────────────────────────────────────────

test("#1090 A PARKED RUN IS NEVER TOUCHED — the worst thing this file could do", () => {
  // postponed (rate-limit, auto-resuming) and recovering (defect backoff) are parked WITH A CLOCK and no
  // process is meant to be alive while they wait. Reconciling one terminalises a run that is working
  // exactly as designed, and the monotonic guard makes that permanent.
  for (const state of ["postponed", "recovering", "parked-for-human", "queued"]) {
    const r = classifyRun({ state, updatedAt: ago(72 * HOUR) }, { now: NOW });
    assert.equal(r.verdict, "unknown", `${state} was classified ${r.verdict} after three days quiet`);
    assert.match(r.why, /does not claim to be running/);
  }
  assert.deepEqual(LIVE_CLAIMING_STATES, ["running"],
    "if a state is added here, re-read the paragraph above before adding it");
});

test("#1090 an already-terminal run is reported as terminal, not re-terminalised", () => {
  for (const state of ENDED_STATES) {
    const r = classifyRun({ state, updatedAt: ago(72 * HOUR) }, { now: NOW }, { now: NOW });
    assert.equal(r.verdict, "ended");
  }
  assert.deepEqual([...ENDED_STATES], ["delivered", "failed", "cancelled"],
    "these mirror progress.mjs's TERMINAL_STATES — if that set moves, this one has to move with it");
});

test("#1090 a run with neither a pid nor a readable updatedAt is UNKNOWN, and says so", () => {
  for (const s of [{ state: "running" }, { state: "running", updatedAt: "not a date" }, { state: "running", updatedAt: null }]) {
    const r = classifyRun(s, { now: NOW });
    assert.equal(r.verdict, "unknown");
    assert.match(r.why, /nothing here can say/);
  }
  // And an absent state is not a running state.
  assert.equal(classifyRun({}, { now: NOW }).verdict, "unknown");
  assert.equal(classifyRun(null, { now: NOW }).verdict, "unknown");
});

test("#1090 every verdict is one of the five, and every one carries a why a reader can act on", () => {
  const samples = [
    { state: "running", pid: 1, pidStarttime: "1" }, { state: "running", updatedAt: ago(99 * HOUR) },
    { state: "running", updatedAt: ago(1) }, { state: "delivered" }, { state: "postponed" }, {},
  ];
  for (const s of samples) {
    const r = classifyRun(s, { now: NOW, isAlive: dead });
    assert.ok(RECONCILE_VERDICTS.includes(r.verdict), `${r.verdict} is not one of the five`);
    assert.ok(r.why && r.why.length > 20, `a verdict with no usable reason: ${JSON.stringify(r)}`);
  }
});

// ── the patch ───────────────────────────────────────────────────────────────────────────────────────

test("#1090 the terminal is `failed` + terminalKind — NOT a fourth state word", () => {
  const p = terminalPatch({ verdict: "dead", why: "pid 5 is gone", now: NOW });
  assert.equal(p.state, "failed",
    "every consumer in the tree switches on delivered/failed/cancelled — portal-service, status-snapshot, "
    + "ops.mjs, the MCP face. A fourth name lands in each of them as an unhandled case reading 'unknown' "
    + "rather than 'ended', which is this issue one level over.");
  assert.equal(p.terminalKind, "process-gone", "WHY it ended goes in the field that already exists for it");
  assert.equal(terminalPatch({ verdict: "quiet", why: "x", now: NOW }).terminalKind, "no-heartbeat",
    "and the two tests must stay distinguishable in the record — one is a fact, one is an inference");
  assert.equal(p.endedAt, "2026-08-17T20:00:00.000Z");
  assert.equal(p.reconciledFrom, "running");
  assert.match(p.reason, /reconciled, not completed/,
    "progress.mjs renders reason straight into the rollup line, so it is written for a person");
});

test("#1090 planReconcile plans the actionable ones and skips the rest, keeping both", () => {
  const runs = [
    { runId: "a", state: "running", pid: 1, pidStarttime: "1" },
    { runId: "b", state: "running", updatedAt: ago(9 * HOUR) },
    { runId: "c", state: "postponed", updatedAt: ago(9 * HOUR) },
    { runId: "d", state: "delivered" },
  ];
  const { plan, skipped } = planReconcile(runs, { now: NOW, isAlive: dead });
  assert.deepEqual(plan.map((p) => p.run.runId), ["a", "b"]);
  assert.deepEqual(plan.map((p) => p.verdict), ["dead", "quiet"]);
  assert.deepEqual(skipped.map((s) => `${s.run.runId}:${s.verdict}`), ["c:unknown", "d:ended"],
    "the skipped list is not a discard — the CLI reports it, or '0 reconciled' cannot be told from "
    + "'nothing was looked at'");
});

// ── on disk ─────────────────────────────────────────────────────────────────────────────────────────

const workspace = () => {
  const root = mkdtempSync(join(tmpdir(), "reconcile-runs-test-"));
  const mk = (agent, slug, leaf, status) => {
    const dir = join(root, `workspace-${agent}`, "studio", "prelim-search", slug, leaf);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "status.json"), JSON.stringify(status, null, 2) + "\n");
    return dir;
  };
  return { root, mk };
};

test("#1090 DRY RUN IS THE DEFAULT — it reports the same decision it would apply, and writes nothing", () => {
  const { root, mk } = workspace();
  try {
    const dir = mk("clawdi", "novapulse", "r1", { runId: "novapulse-r1", state: "running", updatedAt: ago(9 * HOUR) });
    const before = readFileSync(join(dir, "status.json"), "utf8");

    const dry = reconcileRunDir(dir, { now: NOW });
    assert.equal(dry.verdict, "quiet");
    assert.equal(dry.applied, false);
    assert.equal(readFileSync(join(dir, "status.json"), "utf8"), before, "a dry run wrote to status.json");

    const wet = reconcileRunDir(dir, { apply: true, now: NOW });
    assert.equal(wet.verdict, dry.verdict, "apply reached a different verdict than the dry run reported");
    const after = JSON.parse(readFileSync(join(dir, "status.json"), "utf8"));
    assert.equal(after.state, "failed");
    assert.equal(after.terminalKind, "no-heartbeat");
    assert.equal(after.endedAt, "2026-08-17T20:00:00.000Z");
    // Everything the run said about itself survives — this adds a terminal, it does not rewrite history.
    assert.equal(after.runId, "novapulse-r1");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("#1090 a live run on disk is not written to, even with --apply", () => {
  const { root, mk } = workspace();
  try {
    // A REAL pid: this process. No injection — the live path has to work against the actual check.
    const dir = mk("clawdi", "novapulse", "r2", {
      runId: "novapulse-r2", state: "running", pid: process.pid, pidStarttime: null, updatedAt: ago(50 * HOUR),
    });
    const before = readFileSync(join(dir, "status.json"), "utf8");
    const r = reconcileRunDir(dir, { apply: true, now: NOW });
    assert.equal(r.verdict, "live", `a live pid was classified ${r.verdict} — ${r.why}`);
    assert.equal(readFileSync(join(dir, "status.json"), "utf8"), before,
      "APPLY rewrote a run whose process is this very test");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("#1090 a torn or missing status.json is reported, never thrown and never written", () => {
  const { root, mk } = workspace();
  try {
    const dir = mk("clawdi", "novapulse", "r3", { state: "running", updatedAt: ago(9 * HOUR) });
    writeFileSync(join(dir, "status.json"), "{ this is torn");
    assert.equal(reconcileRunDir(dir, { apply: true, now: NOW }).verdict, "unreadable-status");
    assert.equal(readFileSync(join(dir, "status.json"), "utf8"), "{ this is torn");
    assert.equal(reconcileRunDir(join(root, "nowhere"), { apply: true, now: NOW }).verdict, "no-status");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("#1090 the walk finds live and archived runs and skips the queue and the driver sidecar", () => {
  const { root, mk } = workspace();
  try {
    mk("clawdi", "novapulse", "r1", { state: "running" });
    mk("clawdi", join("archive", "2026-07"), join("oldmark", "r9"), { state: "delivered" });
    const studio = join(root, "workspace-clawdi", "studio", "prelim-search");
    // A status.json under queue/ or _driver/ is not a run — the walk must not descend into either.
    for (const skip of ["queue", "_driver", "register-units"]) {
      mkdirSync(join(studio, "novapulse", "r1", skip), { recursive: true });
      writeFileSync(join(studio, "novapulse", "r1", skip, "status.json"), "{}");
    }
    const found = findRunDirs(studio).map((d) => d.slice(studio.length + 1)).sort();
    assert.deepEqual(found, ["archive/2026-07/oldmark/r9", "novapulse/r1"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("#1090 the seed records the pid, so a run started from today is judged by the exact test", async () => {
  // The other half. A reconciler with a perfect classifier and no pid on disk falls back to the weaker
  // test forever — this is what makes the exact one reachable, and it is a claim about progress.mjs.
  const src = readFileSync(new URL("../progress.mjs", import.meta.url), "utf8")
    .split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  assert.match(src, /pid:\s*process\.pid/, "seedRunStatus no longer stamps the pid — the exact test is unreachable");
  assert.match(src, /pidStarttime:\s*procStarttime\(process\.pid\)/,
    "the starttime is what stops a recycled pid impersonating the run; without it claimerIsAlive treats "
    + "any live pid with that number as this run");
  assert.match(src, /from "\.\/claim-liveness\.mjs"/,
    "procStarttime must come from claim-liveness.mjs — runner.mjs only re-exports it, and importing it "
    + "from there would make the status writer depend on the runner");
});
