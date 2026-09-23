// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// NATIVE WINDOWS: A STOPPED TURN TAKES EVERYTHING IT STARTED WITH IT, AND "IS IT STILL THAT PROCESS" HAS
// AN ANSWER.
//
// On Linux and macOS a turn leads its own process group and a stop signals the group. Windows has neither,
// so `process.kill(-pid)` there ends nothing, and the MCP servers a turn started would survive it. The
// Windows stop reads one process list and ends the turn's tree by number with taskkill. And Windows had no
// start-time reader at all, so the portal said nothing was draining the queue while the worker ran, and
// the immediate stop could never confirm which process a recorded number now names.
//
// Every arm drives the Windows branch on Linux by passing the platform, with PowerShell and taskkill
// injected: the rows are exactly what the shipped script prints, and the last arm runs a real child through
// the turn runner with the platform set to win32, to prove the watchdog reaches the tree stop.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execPath } from "node:process";
import { processTable, parseWindowsRows, windowsTicksToMs } from "../../shared/process-table.mjs";
import { procStarttime } from "../claim-liveness.mjs";
import { drainingState } from "../worker-heartbeat.mjs";
import { windowsTree, endWindowsTree, killWindowsTreeNow } from "../engine/engine-spawn.mjs";
import { endEngineChild, procPgid } from "../engine/child-record.mjs";
import { runStreamingChild } from "../engine/common.mjs";
import { stopChild, windowCloseSignals } from "../../bin/start.mjs";

// 2026-09-23T12:00:00Z as Windows prints it (100 ns ticks since 1601), and a second a minute later.
const T0 = "134346384000000000";
const T1 = "134346384600000000";
const row = (pid, ppid, ticks, session, cmd) => `${pid}|${ppid}|${ticks}|${session}|${cmd}`;

test("the Windows process list is read as numbers, and a reader that could not look says so", () => {
  const out = [row(4, 0, "", 0, ""), row(700, 4, T0, 1, "node C:\\clearotron\\driver\\runner.mjs --watch"), row(900, 1, T0, 2, "other user")].join("\r\n");
  const table = processTable({ platform: "win32", selfPid: 700, runPowerShell: () => ({ status: 0, stdout: out }) });
  assert.deepEqual(table.map((p) => p.pid), [700], "the listing was not narrowed to this user's session");
  assert.equal(table[0].startedAt, Date.parse("2026-09-23T12:00:00Z"), "the start time was not read as the moment it is");
  assert.equal(table[0].ppid, 4);
  assert.equal(processTable({ platform: "win32", runPowerShell: () => ({ status: 1, stdout: "" }) }), null,
    "PowerShell failing read as a machine with nothing running");
  assert.equal(processTable({ platform: "win32", runPowerShell: () => ({ status: 0, stdout: "garbage\n" }) }), null);
  assert.ok(Number.isNaN(windowsTicksToMs("12/09/2026 14:00:00")), "a date in a locale's own spelling was read as a number");
  assert.equal(parseWindowsRows(row(1, 0, T0, 1, "a|b")).at(0).cmd, "a|b", "a command line holding \"|\" was cut");
});

test("a Windows process's birth stamp is read, and a missing one is null, never a guess", () => {
  const ps = (stdout, status = 0) => () => ({ status, stdout });
  assert.equal(procStarttime(700, undefined, { platform: "win32", runPowerShell: ps(row(700, 4, T0, 1, "node")) }),
    String(Date.parse("2026-09-23T12:00:00Z")));
  assert.equal(procStarttime(700, undefined, { platform: "win32", runPowerShell: ps("") }), null, "a gone process got a stamp");
  assert.equal(procStarttime(700, undefined, { platform: "win32", runPowerShell: ps(row(701, 4, T0, 1, "x")) }), null,
    "another process's stamp was taken for this one");
  assert.equal(procStarttime(700, undefined, { platform: "win32", runPowerShell: ps(row(700, 4, T0, 1, "x"), 1) }), null);
  assert.equal(procPgid(700, undefined, { platform: "win32", readPsPgid: () => { throw new Error("ps was run on Windows"); } }), null);
});

test("on Windows the portal's worker check is kept for fifteen seconds; elsewhere it is asked every time", () => {
  const env = { PORTAL_LOCAL_WORKER: "1", CLEAROTRON_RUN_LOCK_DIR: "C:\\lock" };
  let asked = 0;
  const alive = () => { asked++; return true; };
  const memo = new Map();
  for (const now of [0, 5_000, 10_000]) assert.equal(drainingState(env, { alive, platform: "win32", now, memo }), true);
  assert.equal(asked, 1, "PowerShell would start on every five-second refresh of the portal");
  drainingState(env, { alive, platform: "win32", now: 15_001, memo });
  assert.equal(asked, 2, "the kept answer outlived its fifteen seconds");
  asked = 0;
  for (const now of [0, 1, 2]) drainingState(env, { alive, platform: "linux", now, memo: new Map() });
  assert.equal(asked, 3, "Linux started keeping the answer");
});

test("the tree is the root and what it started, and a stranger holding a dead parent's number is not in it", () => {
  const table = parseWindowsRows([
    row(500, 1, T0, 1, "node runner.mjs"),
    row(510, 500, T0, 1, "claude.exe"),
    row(520, 510, T1, 1, "node perplexity-server.mjs"),
    row(530, 510, "134346383000000000", 1, "a stranger started before 510 was, holding a stale parent number"),
    row(600, 1, T0, 1, "unrelated"),
  ].join("\n"));
  assert.deepEqual(windowsTree(table, 510, String(Date.parse("2026-09-23T12:00:00Z"))).map((p) => p.pid), [510, 520],
    "the tree left out the turn's server, or took in a process that merely inherited a dead parent's number");
  assert.equal(windowsTree(table, 510, "1"), null, "a root whose start time does not match the record was stopped anyway");
  assert.equal(windowsTree(table, 999), null);
});

test("a Windows stop ends the tree, and says it ended only when a later listing no longer holds it", async () => {
  const stamp = String(Date.parse("2026-09-23T12:00:00Z"));
  const before = parseWindowsRows([row(510, 500, T0, 1, "claude.exe"), row(520, 510, T1, 1, "server")].join("\n"));
  const killed = [];
  let listings = 0;
  const gone = await endWindowsTree(510, { rootStart: stamp, list: () => (listings++ === 0 ? before : []),
    taskkill: (pids) => killed.push(...pids), sleep: async () => {} });
  assert.deepEqual(killed, [510, 520], "taskkill was not handed the whole tree by number");
  assert.equal(gone.ended, true);
  assert.equal(gone.signalled, "SIGKILL");

  let t = 0;
  const stuck = await endWindowsTree(510, { rootStart: stamp, list: () => before, taskkill: () => {},
    settleMs: 1000, sleep: async (ms) => { t += ms; }, now: () => t });
  assert.equal(stuck.ended, false, "a tree still in the listing was reported ended, from the kill having been asked");

  const refused = [];
  const wrong = await endWindowsTree(510, { rootStart: "1", list: () => before, taskkill: (p) => refused.push(...p) });
  assert.deepEqual(refused, [], "a number now worn by another process was stopped");
  assert.equal(wrong.signalled, null);
  const blind = await endWindowsTree(510, { rootStart: stamp, list: () => null, taskkill: (p) => refused.push(...p) });
  assert.equal(blind.ended, false);
  assert.deepEqual(refused, [], "a stop went ahead without a listing to check the number against");
});

test("the immediate stop takes the Windows route, and will not stop a record with no start time", async () => {
  const calls = [];
  const endTree = async (pid, opts) => { calls.push({ pid, rootStart: opts.rootStart }); return { signalled: "SIGKILL", ended: true, group: true, escalated: null }; };
  const r = await endEngineChild({ pid: 510, starttime: "1790164800000" }, { platform: "win32", endTree,
    kill: () => { throw new Error("a POSIX signal was sent on Windows"); } });
  assert.deepEqual(calls, [{ pid: 510, rootStart: "1790164800000" }]);
  assert.equal(r.ended, true);
  const bare = await endEngineChild({ pid: 510, starttime: null }, { platform: "win32", endTree });
  assert.equal(bare.signalled, null);
  assert.equal(calls.length, 1, "a bare number was stopped on Windows, where numbers are reused soon");
});

test("the watchdog's stop and the start window's stop take the tree on Windows", async () => {
  const ended = [];
  const r = await runStreamingChild({
    bin: execPath, args: ["-e", "process.stdout.write('{}\\n'); setInterval(() => {}, 1000)"], input: "",
    stallSec: 0.3, platform: "win32",
    // The real tree stop needs Windows; this one ends the real child so the arm cleans up after itself.
    endTree: (pid) => { ended.push(pid); try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } },
  });
  assert.equal(r.stallKill, true);
  assert.equal(ended.length >= 1, true, "the stalled turn was not handed to the tree stop");

  const trees = [];
  stopChild({ pid: 42, exitCode: null, signalCode: null }, "SIGTERM", { platform: "win32", endTree: (pid) => trees.push(pid),
    kill: () => { throw new Error("a process group was signalled on Windows"); } });
  assert.deepEqual(trees, [42]);
  stopChild({ pid: 43, exitCode: 0, signalCode: null }, "SIGKILL", { platform: "win32", endTree: (pid) => trees.push(pid) });
  assert.deepEqual(trees, [42], "a child that had already exited was stopped again, by a number it no longer holds");
  const signalled = [];
  stopChild({ pid: 44, kill: (s) => signalled.push(["child", s]) }, "SIGTERM", { platform: "linux",
    kill: (pid, s) => { signalled.push([pid, s]); throw Object.assign(new Error("gone"), { code: "ESRCH" }); } });
  assert.deepEqual(signalled, [[-44, "SIGTERM"], ["child", "SIGTERM"]], "Linux no longer signals the group first");
  assert.deepEqual(windowCloseSignals("win32"), ["SIGHUP"], "closing the window on Windows reaches no teardown");
  assert.deepEqual(windowCloseSignals("linux"), []);
});

test("with no listing, the stop from a timer still ends the tree of a child it holds", () => {
  const whole = [];
  assert.equal(killWindowsTreeNow(77, { list: () => null, taskkill: () => {}, taskkillTree: (pid) => whole.push(pid) }), true);
  assert.deepEqual(whole, [77]);
  const none = [];
  assert.equal(killWindowsTreeNow(77, { list: () => [], taskkill: (p) => none.push(p), taskkillTree: (p) => none.push(p) }), false,
    "a child already gone from the listing was stopped by number");
  assert.deepEqual(none, []);
});
