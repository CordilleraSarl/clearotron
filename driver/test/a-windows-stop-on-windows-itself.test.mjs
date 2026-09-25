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
// Each tree is `cmd.exe`, a Node child it starts, and a Node grandchild that would run for ever. THE ROOT
// IS NOT NODE ON PURPOSE. Node on Windows puts every child it starts in a job that Windows ends with it,
// so a Node root taken alone takes its tree with it, and a stop that ignored the tree would pass. The
// negative control showed exactly that, 2026-09-23. The engine programs are not Node (claude.exe, the
// vendor's codex.exe), and cmd.exe makes no such job, so only a stop that ends the tree ends all three.
// Only the pids those programs write about themselves are looked for, never a program found by name.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processTable } from "../../shared/process-table.mjs";
import { procStarttime } from "../claim-liveness.mjs";
import { endWindowsTree } from "../engine/engine-spawn.mjs";
import { runStreamingChild } from "../engine/common.mjs";

const ON_WINDOWS = process.platform === "win32" ? false : "these arms read the process list of Windows itself";

// The child writes its pid to child.pid and starts the grandchild, which writes grand.pid; both then run
// until something ends them. Started by name from the folder they are in, so cmd.exe is handed no path
// that needs quoting.
const CHILD = `
  const { spawn } = require("node:child_process");
  require("node:fs").writeFileSync("child.pid", String(process.pid));
  spawn(process.execPath, ["-e", "require('node:fs').writeFileSync('grand.pid', String(process.pid)); setInterval(() => {}, 1000);"], { stdio: "ignore" });
  process.stdout.write("{}\\n");
  setInterval(() => {}, 1000);
`;

/** A folder holding the child's script, and the arguments that start the tree from it. */
function treeFolder(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(dir, "child.cjs"), CHILD);
  return { dir, bin: "cmd.exe", args: ["/d", "/c", "node", "child.cjs"] };
}

async function pidsIn(dir, ms = 20000) {
  const until = Date.now() + ms;
  const read = (f) => (existsSync(join(dir, f)) ? Number(readFileSync(join(dir, f), "utf8")) || null : null);
  while (Date.now() < until) {
    const [child, grand] = [read("child.pid"), read("grand.pid")];
    if (child && grand) return { child, grand };
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

test("the process list holds this program, with a start time a moment ago", { skip: ON_WINDOWS }, () => {
  const t0 = Date.now();
  const stamp = Number(procStarttime(process.pid));
  assert.ok(Number.isFinite(stamp) && stamp > 0, `no start time was read for this program: ${stamp}`);
  assert.ok(t0 - stamp < 10 * 60 * 1000 && stamp <= t0 + 2000, `the start time ${new Date(stamp).toISOString()} is not a moment before ${new Date(t0).toISOString()}`);
  const table = processTable({ platform: "win32", everyUser: true });
  assert.ok(table?.some((p) => p.pid === process.pid && p.ppid === process.ppid), "this program is not in the list under its own parent");
});

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

/** End what an arm started, by the pids it recorded, whatever the arm found. */
const endRecorded = (pids) => { for (const pid of pids) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } } };

test("the immediate stop ends a turn and what it started, and a later listing holds none of them", { skip: ON_WINDOWS, timeout: 60000 }, async () => {
  const { dir, bin, args } = treeFolder("win-tree-");
  const root = spawn(bin, args, { cwd: dir, stdio: "ignore" });
  const recorded = [root.pid];
  try {
    const pids = await pidsIn(dir);
    assert.ok(pids, "the grandchild never started, so there was no tree to stop");
    recorded.push(pids.child, pids.grand);
    const rootStart = procStarttime(root.pid);
    assert.ok(rootStart, "no start time for the turn, so the stop could not be sure which program the number names");

    const r = await endWindowsTree(root.pid, { rootStart });
    assert.equal(r.ended, true, `the stop did not report the tree ended: ${JSON.stringify(r)}`);
    assert.deepEqual(await stillRunning(recorded, 2000), [], "the stop left these programs of the turn running");
  } finally { endRecorded(recorded); }
});

test("a turn that goes quiet is stopped by the watchdog, and takes its grandchild with it", { skip: ON_WINDOWS, timeout: 60000 }, async () => {
  const { dir, bin, args } = treeFolder("win-stall-");
  const run = runStreamingChild({ bin, args, cwd: dir, input: "", stallSec: 3 });
  const pids = await pidsIn(dir, 30000);
  // A child the stop missed keeps the turn's output open, so the turn never finishes and this arm would
  // hang rather than fail. After 30 seconds the arm ends what it recorded itself, and says so.
  let missed = false;
  const guard = setTimeout(() => { missed = true; if (pids) endRecorded([pids.child, pids.grand]); }, 30000);
  const r = await run;
  clearTimeout(guard);
  try {
    assert.ok(pids, "the grandchild never started, so the stop had nothing to prove");
    assert.equal(missed, false, "30 seconds after the watchdog fired, the turn's programs were still running and holding its output open");
    assert.equal(r.stallKill, true, "the watchdog did not stop the quiet turn");
    assert.deepEqual(await stillRunning([pids.child, pids.grand]), [], "the watchdog ended the turn and left the programs it started running");
  } finally { if (pids) endRecorded([pids.child, pids.grand]); }
});
