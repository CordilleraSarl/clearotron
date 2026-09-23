// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// engine-spawn.mjs — HOW AN ENGINE TURN IS STARTED AND ENDED, decided once for every platform.
//
// A turn is the engine's program plus the MCP servers it starts, and a stop has to end all of them: a
// server left behind is a process nobody watches (one bridge ran three and a half days, still billing).
// On Linux and macOS the turn is spawned detached, so it leads its own process group, and a signal to the
// group reaches every member. Windows has no process groups and no signals to send one, so there the turn
// is ended as a TREE, by process number, with taskkill.
//
// `platform` is a parameter throughout so the Windows branch runs on a Linux CI, and every call out to the
// system is injected for the same reason.

import { spawnSync } from "node:child_process";
import { processTable } from "../../shared/process-table.mjs";

/**
 * What a spawn runs to start the engine program `program` with `args`: `{command, args}`.
 *
 * ONE ANSWER FOR EVERY SPAWN of an engine program, so no spawn site decides for itself how a program is
 * started. On Linux and macOS the program starts as itself, as it always did: a `#!` script runs through
 * its own interpreter. Windows has no `#!`, and Codex's npm program is `bin/codex.js`, a small Node
 * launcher that finds the vendor's `codex.exe` and starts it. There a JavaScript program runs through the
 * Node running now, so nothing is started through a shell and nothing depends on which Node is on PATH.
 */
export function engineSpawn(program, args = [], { platform = process.platform, execPath = process.execPath } = {}) {
  return platform === "win32" && /\.[cm]?js$/i.test(String(program ?? ""))
    ? { command: execPath, args: [program, ...args] }
    : { command: program, args };
}

/**
 * Whether a turn is spawned detached.
 *
 * YES WHERE IT BUYS A PROCESS GROUP, which is the whole of the Linux and macOS stop. NOT ON WINDOWS,
 * where detaching buys no group and costs two things. A detached child there starts with no console, so
 * closing the window the reader started Clearotron in does not reach it. And it is left out of the job
 * object libuv puts every other child in, which Windows ends when the parent exits (libuv
 * src/win/process.c: "assign to the global job object so windows will kill it when the parent process
 * dies"). Attached, the child shares the window's console and ends with its parent, however the parent
 * ends. The job reaches direct children only, so a stop ends the rest by tree (endWindowsTree).
 *
 * AND NO `windowsHide`, for the console half of that reason. With every stream piped, Node starts a
 * hidden child with no console at all, so the window's closing does not reach it. Hiding is for the short
 * helpers this file and the process list start (taskkill, PowerShell).
 */
export const spawnsDetached = (platform = process.platform) => platform !== "win32";

/**
 * `root` and everything it started, from one process listing: `[root, ...descendants]` as pids, or null
 * when the listing does not hold the root as the process `rootStart` names. PURE.
 *
 * A PARENT NUMBER IS BELIEVED ONLY FOR A CHILD THAT STARTED AFTER ITS PARENT. Windows keeps a process's
 * parent number after the parent has exited, and soon gives that number to a new process, so a listing
 * can show a stranger's program as a child of ours. `taskkill /T` walks those numbers as it finds them,
 * which is why this walks them itself and hands taskkill a list.
 *
 * `rootStart` null trusts the root without a stamp. Only a caller that holds the root's process handle
 * may pass it: Windows does not reuse a number while a handle to the process is open.
 */
export function windowsTree(table, rootPid, rootStart = null) {
  if (!Array.isArray(table) || !Number.isInteger(rootPid) || rootPid <= 0) return null;
  const root = table.find((p) => p.pid === rootPid);
  if (!root) return null;
  if (rootStart != null && String(root.startedAt) !== String(rootStart)) return null;
  const children = new Map();
  for (const p of table) {
    if (!Number.isInteger(p.ppid) || p.pid === p.ppid) continue;
    if (!children.has(p.ppid)) children.set(p.ppid, []);
    children.get(p.ppid).push(p);
  }
  const out = [root];
  for (let i = 0; i < out.length; i++) {
    const parent = out[i];
    for (const c of children.get(parent.pid) ?? []) {
      if (!Number.isFinite(c.startedAt) || !Number.isFinite(parent.startedAt) || c.startedAt < parent.startedAt) continue;
      if (!out.includes(c)) out.push(c);
    }
  }
  return out.map((p) => ({ pid: p.pid, startedAt: p.startedAt }));
}

const defaultTaskkill = (pids) => spawnSync("taskkill", ["/F", ...pids.flatMap((pid) => ["/PID", String(pid)])],
  { encoding: "utf8", windowsHide: true, timeout: 30_000 });

/**
 * End a turn on Windows, and say whether it ENDED from a listing taken afterwards, never from taskkill's
 * exit code: `{ signalled, escalated, group, ended, error? }`, the shape `endEngineChild` answers in.
 *
 * NO GRACE. Windows has no request a console program can handle and then exit on, so the stop is the
 * forced one at once, as the issue that built this asked. `signalled` says "SIGKILL" because that is what
 * it was: a stop the process could not refuse.
 */
export async function endWindowsTree(rootPid, {
  rootStart = null, settleMs = 5000, pollMs = 500,
  list = () => processTable({ platform: "win32", everyUser: true }),
  taskkill = defaultTaskkill,
  sleep = (ms) => new Promise((res) => setTimeout(res, ms)),
  now = () => Date.now(),
} = {}) {
  const table = list();
  if (!table) return { signalled: null, escalated: null, group: false, ended: false, error: "the process list could not be read" };
  const tree = windowsTree(table, rootPid, rootStart);
  if (!tree) return { signalled: null, escalated: null, group: false, ended: false, error: "ESRCH" };
  // taskkill's own exit code is not read: it is non-zero when one of the list exited on its own first,
  // which is the stop working. What answers is the listing below.
  try { taskkill(tree.map((p) => p.pid)); } catch (e) { return { signalled: null, escalated: null, group: true, ended: false, error: String(e?.message ?? e) }; }
  const left = () => {
    const after = list();
    if (!after) return null;
    return tree.filter((t) => after.some((p) => p.pid === t.pid && String(p.startedAt) === String(t.startedAt)));
  };
  const until = now() + settleMs;
  for (;;) {
    const remaining = left();
    if (remaining && remaining.length === 0) return { signalled: "SIGKILL", escalated: null, group: true, ended: true };
    if (now() >= until) return { signalled: "SIGKILL", escalated: null, group: true, ended: false };
    await sleep(pollMs);
  }
}

/**
 * The same stop from a place that cannot wait: a watchdog timer, or a supervisor's exit. It lists and ends
 * the tree and does not check afterwards. Falls back to `taskkill /T` on the root only when the listing
 * cannot be read, and only for a root the caller holds a handle to (see windowsTree): leaving the tree
 * running is the worse of the two outcomes there.
 */
export function killWindowsTreeNow(rootPid, opts = {}) {
  return killWindowsTreesNow([rootPid], opts);
}

/**
 * The same for several roots from ONE listing and ONE taskkill: the start window's teardown, which has the
 * seconds Windows allows after the window closes, and a listing takes most of one.
 */
export function killWindowsTreesNow(rootPids, {
  list = () => processTable({ platform: "win32", everyUser: true }),
  taskkill = defaultTaskkill,
  taskkillTree = (pid) => spawnSync("taskkill", ["/F", "/T", "/PID", String(pid)], { encoding: "utf8", windowsHide: true, timeout: 30_000 }),
} = {}) {
  const roots = (rootPids ?? []).filter((pid) => Number.isInteger(pid) && pid > 0);
  if (!roots.length) return false;
  const table = list();
  try {
    if (!table) { for (const pid of roots) taskkillTree(pid); return true; }
    const pids = [...new Set(roots.flatMap((pid) => windowsTree(table, pid)?.map((p) => p.pid) ?? []))];
    if (pids.length) taskkill(pids);
    return pids.length > 0;
  } catch { return false; }
}
