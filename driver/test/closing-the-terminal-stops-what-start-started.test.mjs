// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// CLOSING THE TERMINAL STOPS WHAT `clearotron start` STARTED.
//
// The foreground start's banner says Ctrl-C "or closing the window" stops everything it started. Closing
// a terminal sends a hangup, and the start had no handler for it: Node's default ended the supervisor on
// the spot, the teardown never ran, and its children, which lead sessions of their own, never received
// the hangup. Measured on Linux, 2026-09-23: the portal, the door and the worker went on running with
// nothing supervising them.
//
// The second arm runs the real `start` in a throwaway home, hangs it up, and asks the process table
// whether anything it started is still there. Every pid it signals afterwards is one it recorded from that
// start's own children, never one found by name.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { windowCloseSignals } from "../../bin/start.mjs";
import { withFreePorts, saidPortWasTaken } from "./helpers/free-port.mjs";
import { pidAlive } from "./platform-caps.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");

test("a hangup is one of the signals that stop a foreground start", () => {
  assert.ok(windowCloseSignals().includes("SIGHUP"),
    "closing the terminal would end the supervisor with no teardown, and leave everything it started running");
});

/** The pids whose parent is `pid`, from `ps`, which Linux and macOS both have. Null when ps could not look. */
function childrenOf(pid) {
  const r = spawnSync("ps", ["-Ao", "pid=,ppid="], { encoding: "utf8" });
  if (r.status !== 0) return null;
  return r.stdout.split("\n").map((l) => l.trim().split(/\s+/).map(Number))
    .filter(([p, pp]) => Number.isInteger(p) && pp === pid).map(([p]) => p);
}

test("hanging up a real start ends the portal and the door it started", {
  timeout: 150000, skip: process.platform === "win32" && "a hangup cannot be sent to a process on Windows",
}, async () => {
  const home = mkdtempSync(join(tmpdir(), "hangup-start-"));
  let recorded = [];
  const stop = async ({ child, closed }) => {
    child.kill("SIGINT");
    await Promise.race([closed, new Promise((r) => setTimeout(r, 20000))]);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  };
  const start = async (ports) => {
    const child = spawn(process.execPath, [join(REPO, "bin", "start.mjs"), "--no-worker"], {
      env: { PATH: process.env.PATH, HOME: home, CLEAROTRON_NO_ENV_FILE: "1", PORTAL_LOCAL_USER: "op@localhost",
        PORTAL_SERVICE_PORT: String(ports.portal), TRADEMARK_MCP_HTTP_PORT: String(ports.mcp),
        CLIENT_MCP_HTTP_PORT: String(ports.client) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let said = "";
    child.stdout.on("data", (c) => { said += c; });
    child.stderr.on("data", (c) => { said += c; });
    const closed = new Promise((resolve) => child.on("close", resolve));
    const deadline = Date.now() + 90000;
    while (!/Sign in as/.test(said) && child.exitCode === null && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
    if (child.exitCode !== null) await closed;
    return { child, closed, said: () => said };
  };
  const run = await withFreePorts(["portal", "mcp", "client"], start, {
    busy: (r) => !/Sign in as/.test(r.said()) && saidPortWasTaken(r),
    discard: async (r) => { await stop(r); rmSync(home, { recursive: true, force: true }); mkdirSync(home); },
  });
  try {
    assert.match(run.said(), /Sign in as/, "start never came up, so there was nothing to hang up");
    recorded = childrenOf(run.child.pid);
    assert.ok(recorded, "ps could not list processes, so what start left behind could not be looked at");
    assert.ok(recorded.length >= 2, `start had ${recorded.length} children when it came up; the portal and the door were expected`);

    run.child.kill("SIGHUP");
    await Promise.race([run.closed, new Promise((r) => setTimeout(r, 20000))]);
    assert.notEqual(run.child.exitCode ?? run.child.signalCode, null, "start was still running 20 seconds after the hangup");

    const until = Date.now() + 10000;
    let left = recorded.filter((pid) => pidAlive(pid) !== false);
    while (left.length && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 200));
      left = recorded.filter((pid) => pidAlive(pid) !== false);
    }
    assert.deepEqual(left, [], "closing the terminal left these programs of that start running, with nothing supervising them");
  } finally {
    // Only the pids this start was seen to own, and their groups, which they lead.
    for (const pid of recorded) { try { process.kill(-pid, "SIGKILL"); } catch { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } } }
    if (run.child.exitCode === null && run.child.signalCode === null) await stop(run);
    rmSync(home, { recursive: true, force: true });
  }
});
