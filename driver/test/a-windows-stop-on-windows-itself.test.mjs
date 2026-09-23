// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// NATIVE WINDOWS, ON WINDOWS: A STOPPED TURN LEAVES NOTHING RUNNING, AS THE PROCESS LIST ITSELF SAYS.
//
// a-windows-stop-ends-the-whole-turn drives every Windows branch on Linux with PowerShell and taskkill
// injected. That proves the logic and not the machine: that PowerShell prints what the parser expects,
// that taskkill ends what it is handed, and that a grandchild is in the listing under the parent this code
// believes. These arms run only on Windows, with nothing injected, and ask the real process list afterwards.
//
// Each tree is node, a child node, and a grandchild node that would run for ever. Only the pids those
// programs report about themselves are looked for, never a program found by name.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processTable } from "../../shared/process-table.mjs";
import { procStarttime } from "../claim-liveness.mjs";
import { endWindowsTree } from "../engine/engine-spawn.mjs";
import { runStreamingChild } from "../engine/common.mjs";

const ON_WINDOWS = process.platform === "win32" ? false : "these arms read the process list of Windows itself";

// The grandchild writes its own pid to `file`, then runs until something ends it.
const TREE = (file) => `
  const { spawn } = require("node:child_process");
  const grand = ${JSON.stringify(`require("node:fs").writeFileSync(${JSON.stringify(file)}, String(process.pid)); setInterval(() => {}, 1000);`)};
  const mid = "require('node:child_process').spawn(process.execPath, ['-e', " + JSON.stringify(grand) + "], { stdio: 'ignore' }); setInterval(() => {}, 1000);";
  spawn(process.execPath, ["-e", mid], { stdio: "ignore" });
  process.stdout.write("{}\\n");
  setInterval(() => {}, 1000);
`;

async function grandchildPid(file, ms = 20000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (existsSync(file)) { const pid = Number(readFileSync(file, "utf8")); if (pid > 0) return pid; }
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

/** The pids of `pids` still in the real process list, after up to `ms` for them to go. */
async function stillRunning(pids, ms = 10000) {
  const until = Date.now() + ms;
  for (;;) {
    const table = processTable({ platform: "win32", everyUser: true });
    assert.ok(table, "the process list could not be read, so what was left could not be looked at");
    const left = pids.filter((pid) => table.some((p) => p.pid === pid));
    if (!left.length || Date.now() >= until) return left;
    await new Promise((r) => setTimeout(r, 250));
  }
}

test("the process list holds this program, with a start time a moment ago", { skip: ON_WINDOWS }, () => {
  const t0 = Date.now();
  const stamp = Number(procStarttime(process.pid));
  assert.ok(Number.isFinite(stamp) && stamp > 0, `no start time was read for this program: ${stamp}`);
  assert.ok(t0 - stamp < 10 * 60 * 1000 && stamp <= t0 + 2000, `the start time ${new Date(stamp).toISOString()} is not a moment before ${new Date(t0).toISOString()}`);
  const table = processTable({ platform: "win32", everyUser: true });
  assert.ok(table?.some((p) => p.pid === process.pid && p.ppid === process.ppid), "this program is not in the list under its own parent");
});

test("the immediate stop ends a turn and what it started, and a later listing holds none of them", { skip: ON_WINDOWS, timeout: 60000 }, async () => {
  const file = join(mkdtempSync(join(tmpdir(), "win-tree-")), "grandchild.pid");
  const root = spawn(process.execPath, ["-e", TREE(file)], { stdio: "ignore" });
  const grand = await grandchildPid(file);
  assert.ok(grand, "the grandchild never started, so there was no tree to stop");
  const table = processTable({ platform: "win32", everyUser: true });
  const mid = table.find((p) => p.ppid === root.pid)?.pid;
  assert.ok(mid, "the child is not in the list under the turn that started it");
  const rootStart = procStarttime(root.pid);
  assert.ok(rootStart, "no start time for the turn, so the stop could not be sure which program the number names");

  const r = await endWindowsTree(root.pid, { rootStart });
  assert.equal(r.ended, true, `the stop did not report the tree ended: ${JSON.stringify(r)}`);
  assert.deepEqual(await stillRunning([root.pid, mid, grand], 2000), [], "the stop left these programs of the turn running");
});

test("a turn that goes quiet is stopped by the watchdog, and takes its grandchild with it", { skip: ON_WINDOWS, timeout: 60000 }, async () => {
  const file = join(mkdtempSync(join(tmpdir(), "win-stall-")), "grandchild.pid");
  const grandSeen = grandchildPid(file, 30000);
  const r = await runStreamingChild({ bin: process.execPath, args: ["-e", TREE(file)], input: "", stallSec: 3 });
  assert.equal(r.stallKill, true, "the watchdog did not stop the quiet turn");
  const grand = await grandSeen;
  assert.ok(grand, "the grandchild never started, so the stop had nothing to prove");
  assert.deepEqual(await stillRunning([grand]), [], "the watchdog ended the turn and left the program it started running");
});
