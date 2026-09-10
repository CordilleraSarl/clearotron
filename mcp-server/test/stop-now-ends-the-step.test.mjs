// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — spawns real process trees shaped like an engine turn and stops them through stop_run
//
// "Stop now" ends the step in flight, and says so only once it has seen the step end.
//
// The stop used to send SIGTERM to the recorded pid and answer from the signal having been accepted. On
// the owner's WSL install a stop answered that way ran on to the next step boundary. Now it watches the
// turn after the signal, sends SIGKILL to whatever is left when the grace runs out, and fills `ended`
// from what it saw.
//
// The trees here are shaped like the real one: a leader spawned `detached: true`, as both engines spawn
// the turn, with a child in its process group standing in for an MCP server. Measured 2026-09-10 on the
// coding CLI the engine spawns: its MCP servers share its group; a SIGTERM to its pid ends it and them;
// a SIGKILL to its pid alone leaves a server running under pid 1, and a SIGKILL to the group does not.
//
// Harness matches stop-run-names-who-stopped-it.test.mjs: CLEAROTRON_WORK_DIR is set BEFORE importing,
// since driver.config reads it at module load.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";
import { recordEngineChild, endEngineChild, procPgid } from "../../driver/engine/child-record.mjs";
import { procStarttime } from "../../driver/claim-liveness.mjs";

const ROOT = mkdtempSync(join(tmpdir(), "stop-now-ws-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
// A short grace, so the trees that need the SIGKILL reach it quickly. The stop reads it at each call.
pinEnv(process.env, "CLEAROTRON_KILL_ESCALATE_MS", "400");

const { stopRun } = await import("../lib/ops.mjs");

let n = 0;
function makeRun() {
  const slug = "tmpx-acme";
  const codename = `2026-06-16-now-${++n}`;
  const runDir = join(ROOT, "workspace-clawdi", "studio", "prelim-search", slug, codename);
  mkdirSync(driverDir(runDir), { recursive: true });
  const runId = `${slug}-${codename}`;
  writeFileSync(join(runDir, "status.json"),
    JSON.stringify({ runId, slug, codename, agent: "clawdi", state: "running", markName: "ACME" }));
  return { runDir, runId };
}

// Only processes this file started are ever signalled in cleanup, and only while each is still the
// process it was: the start time is checked first, as the stop itself checks it.
const started = [];
const still = ({ pid, start }) => start != null && procStarttime(pid) === start;
after(() => { for (const p of started) if (still(p)) try { process.kill(p.pid, "SIGKILL"); } catch { /* gone */ } });

/**
 * A turn: a leader that leads its own process group, and one child in that group. The child says it is
 * ready only after its own SIGTERM handling is in place, and the leader reports the child's pid only
 * after that, so no signal can arrive before a process has decided what to do with it. On SIGTERM the
 * leader writes down whether the run's cancel marker was ALREADY on disk: that file is the ordering,
 * seen from the process being stopped.
 */
async function startTurn(runDir, { leaderIgnoresTerm = false, childIgnoresTerm = false } = {}) {
  const seenPath = join(runDir, "seen-at-sigterm");
  const childSrc = `${childIgnoresTerm ? 'process.on("SIGTERM", () => {});' : ""}`
    + 'process.stdout.write("ready\\n"); setInterval(() => {}, 1e6);';
  const leaderSrc = `
    const { spawn } = require("node:child_process");
    const { existsSync, writeFileSync } = require("node:fs");
    const [cancelPath, seenPath] = process.argv.slice(1);
    process.on("SIGTERM", () => {
      writeFileSync(seenPath, existsSync(cancelPath) ? "cancel-present" : "cancel-absent");
      ${leaderIgnoresTerm ? "" : "process.exit(143);"}
    });
    const c = spawn(process.execPath, ["-e", ${JSON.stringify(childSrc)}], { stdio: ["ignore", "pipe", "ignore"] });
    c.stdout.once("data", () => process.stdout.write(c.pid + "\\n"));
    setInterval(() => {}, 1e6);`;
  const leader = spawn(process.execPath, ["-e", leaderSrc, join(runDir, ".cancel"), seenPath],
    { detached: true, stdio: ["ignore", "pipe", "ignore"] });
  const childPid = await new Promise((res, rej) => {
    leader.stdout.once("data", (b) => res(Number(String(b).trim())));
    leader.once("exit", () => rej(new Error("the leader exited before its child was ready")));
  });
  const turn = {
    leader: { pid: leader.pid, start: procStarttime(leader.pid) },
    child: { pid: childPid, start: procStarttime(childPid) },
    seen: () => (existsSync(seenPath) ? readFileSync(seenPath, "utf8") : null),
  };
  started.push(turn.leader, turn.child);
  // PREMISES, or the arms below prove nothing: the leader leads its own group, the child is in it, and
  // both are live processes this file can name.
  assert.equal(procPgid(turn.leader.pid), turn.leader.pid, "premise: the leader does not lead its own group");
  assert.equal(procPgid(turn.child.pid), turn.leader.pid, "premise: the child is not in the leader's group");
  assert.ok(turn.leader.start && turn.child.start, "premise: a start time could not be read");
  assert.equal(recordEngineChild(runDir, leader.pid), true, "premise: the turn could not be recorded");
  return turn;
}

test("a Stop now on a turn that takes the stop ends the turn and its child, and says it ended", async () => {
  const { runDir, runId } = makeRun();
  const turn = await startTurn(runDir);

  const s = await stopRun({ runId, immediate: true });
  assert.equal(s.immediate.signalled, "SIGTERM");
  assert.equal(s.immediate.group, true, "the stop did not address the turn's process group");
  assert.equal(s.immediate.ended, true, "the turn ended and the answer does not know it");
  assert.equal(s.immediate.escalated, null, "a turn that took the SIGTERM was sent a SIGKILL as well");
  assert.equal(still(turn.leader), false, "the turn is still running");
  assert.equal(still(turn.child), false, "the turn's child outlived it");
  assert.match(s.note, /The step in flight has ended/);
});

test("THE ORDERING: the process being stopped finds the cancel marker already written", async () => {
  // The sentinel is what makes the kill clean: the gateway finds an already-recorded cancel instead of
  // an unexplained dead child, and writes a proper terminal with attribution rather than leaving a run
  // that reads as still running. So the order is read where it matters, in the stopped process, at
  // the moment its SIGTERM arrives.
  const { runDir, runId } = makeRun();
  const turn = await startTurn(runDir);
  await stopRun({ runId, immediate: true });
  assert.equal(turn.seen(), "cancel-present", "the signal arrived before the cancel marker was written");
});

test("a child that ignores SIGTERM is ended by the SIGKILL to the group — the orphan the detached spawn exists to prevent", async () => {
  const { runDir, runId } = makeRun();
  const turn = await startTurn(runDir, { childIgnoresTerm: true });

  const s = await stopRun({ runId, immediate: true });
  assert.equal(s.immediate.escalated, "SIGKILL", "a child that outlived the SIGTERM was never sent SIGKILL");
  assert.equal(s.immediate.ended, true);
  assert.equal(still(turn.leader), false);
  assert.equal(still(turn.child), false, "the child outlived the turn, which is how a server ran on for days under pid 1");
});

test("a turn that ignores SIGTERM is ended by the SIGKILL, and only then reported as ended", async () => {
  const { runDir, runId } = makeRun();
  const turn = await startTurn(runDir, { leaderIgnoresTerm: true });

  const s = await stopRun({ runId, immediate: true });
  assert.equal(turn.seen(), "cancel-present", "premise: the leader received the SIGTERM and ignored it");
  assert.equal(s.immediate.escalated, "SIGKILL");
  assert.equal(s.immediate.ended, true);
  assert.equal(still(turn.leader), false, "the turn that ignored SIGTERM is still running");
  assert.equal(still(turn.child), false);
});

test("a recorded pid that leads no group is signalled alone — the stop never signals a group it did not find", async () => {
  // This process's own children share its group. If the stop sent `-pid` for such a child, the group it
  // named would not be this run's.
  const { runDir, runId } = makeRun();
  const c = spawn(process.execPath, ["-e", "setInterval(() => {}, 1e6)"], { stdio: "ignore" });
  const p = { pid: c.pid, start: null };
  await new Promise((res) => c.once("spawn", res));
  p.start = procStarttime(c.pid);
  started.push(p);
  assert.notEqual(procPgid(c.pid), c.pid, "premise: the child leads its own group");
  recordEngineChild(runDir, c.pid);

  const s = await stopRun({ runId, immediate: true });
  assert.equal(s.immediate.group, false, "a pid that leads no group was signalled as a group");
  assert.equal(s.immediate.ended, true);
  assert.equal(still(p), false);
});

test("a second press of Stop now, after a boundary stop, ends the turn and says it has now ended", async () => {
  const { runDir, runId } = makeRun();
  await stopRun({ runId });
  const turn = await startTurn(runDir);
  const s = await stopRun({ runId, immediate: true });
  assert.equal(s.action, "already-stopping");
  assert.equal(s.immediate.ended, true);
  assert.equal(still(turn.leader), false);
  assert.match(s.note, /the step in flight has now ended/);
});

test("a stop on a run between turns signals nothing and reports the boundary stop", async () => {
  const { runId } = makeRun();
  const calls = [];
  const s = await stopRun({ runId, immediate: true }, { endTurn: async (...a) => { calls.push(a); return {}; } });
  assert.deepEqual(calls, [], "a run with no recorded turn had something signalled");
  assert.equal(s.immediate.attempted, false);
  assert.match(s.note, /next step boundary/);
});

// ── endEngineChild on its own: what it reports is what it SAW ───────────────────────────────────────
//
// Nothing a test can start survives SIGKILL, so "was told to stop and did not end" cannot be produced
// with a real process. These drive the same function with its observations supplied.
const clock = () => { let t = 0; return { now: () => t, sleep: async (ms) => { t += ms; } }; };

test("ended is read from the observation, never from the signal", async () => {
  const calls = [];
  const r = await endEngineChild({ pid: 4242, starttime: "s" }, {
    ...clock(), graceMs: 300, settleMs: 200,
    kill: (target, sig) => { calls.push([target, sig]); },   // every signal accepted…
    isLive: () => true,                                        // …and the turn never goes
    pgidOf: (pid) => pid,
  });
  assert.equal(r.signalled, "SIGTERM");
  assert.equal(r.escalated, "SIGKILL");
  assert.equal(r.ended, false, "every signal was accepted and nothing ended, and the answer says it did");
  const sent = calls.filter(([, sig]) => sig !== 0);
  assert.deepEqual(sent, [[-4242, "SIGTERM"], [-4242, "SIGKILL"]], "the group was not what was signalled");
});

test("a group is signalled only when the record names its leader, and nothing at or below pid 1 is signalled at all", async () => {
  const calls = [];
  const kill = (target, sig) => { calls.push([target, sig]); };
  const r = await endEngineChild({ pid: 4242, starttime: "s" }, {
    ...clock(), kill, isLive: () => false, pgidOf: () => 999,
  });
  assert.equal(r.group, false);
  assert.ok(calls.every(([target]) => target === 4242), `a negative target was signalled: ${JSON.stringify(calls)}`);

  for (const rec of [{ pid: 1, starttime: "s" }, { pid: 0, starttime: "s" }, { pid: -1, starttime: "s" }, null]) {
    calls.length = 0;
    const x = await endEngineChild(rec, { ...clock(), kill, isLive: () => true, pgidOf: (pid) => pid });
    assert.deepEqual(calls, [], `${JSON.stringify(rec)} was signalled`);
    assert.equal(x.signalled, null);
    assert.equal(x.ended, false);
  }
});

test("a signal the OS refuses is not a stop, and says why", async () => {
  const r = await endEngineChild({ pid: 4242, starttime: "s" }, {
    ...clock(), isLive: () => true, pgidOf: (pid) => pid,
    kill: () => { throw Object.assign(new Error("not permitted"), { code: "EPERM" }); },
  });
  assert.equal(r.signalled, null);
  assert.equal(r.ended, false);
  assert.equal(r.error, "EPERM");
});
