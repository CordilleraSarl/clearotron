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
// AND THE TERMINAL IS GONE WHEN THE HANGUP ARRIVES. Measured on Linux, 2026-11-10: the teardown's first
// line failed to reach the closed terminal, the failure became an uncaught exception, and its handler
// wrote to the same terminal and failed again, without end. The services stopped, but the supervisor held
// a full core, ignored SIGTERM, and left the demo's folder and its running record behind. The arms that
// hang up a real start therefore close its output first, as a closing window does; a closed pipe fails a
// write the way a hung-up terminal does (EPIPE where the terminal gives EIO).
//
// Every pid an arm signals afterwards is one it recorded from that start's own children or its running
// record, never one found by name.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { terminalWriters, windowCloseSignals } from "../../bin/start.mjs";
import { withFreePorts, saidPortWasTaken } from "./helpers/free-port.mjs";
import { pidAlive } from "./platform-caps.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const NO_HANGUP = process.platform === "win32" && "a hangup cannot be sent to a process on Windows";

test("a hangup is one of the signals that stop a foreground start", () => {
  assert.ok(windowCloseSignals().includes("SIGHUP"),
    "closing the terminal would end the supervisor with no teardown, and leave everything it started running");
});

// ── the writers, on their own ────────────────────────────────────────────────────────────────────────

/** A stream whose writes fail the way a closed terminal's do: the error arrives later, on the stream. */
function deadTerminal(code) {
  const s = new EventEmitter();
  s.writes = 0;
  s.write = () => { s.writes++; process.nextTick(() => s.emit("error", Object.assign(new Error(`write ${code}`), { code }))); return false; };
  return s;
}
function screen() {
  const s = new EventEmitter();
  s.lines = [];
  s.write = (t) => { s.lines.push(t); return true; };
  return s;
}
const tick = () => new Promise((r) => setImmediate(r));

test("a write to a closed terminal is dropped, not thrown, and that stream is written to no more", async () => {
  const uncaught = [];
  const onUncaught = (e) => uncaught.push(e);
  process.on("uncaughtException", onUncaught);
  try {
    for (const code of ["EIO", "EPIPE"]) {
      const stdout = deadTerminal(code), stderr = deadTerminal(code);
      const { say, err, toErr, gone } = terminalWriters({ stdout, stderr });
      say("stopping portal and runner…");
      await tick();
      assert.equal(gone(stdout), true, `${code}: the failed write did not mark stdout gone`);
      err("start: the exception the failed write used to raise");
      await tick();
      assert.equal(gone(stderr), true, `${code}: the failed write did not mark stderr gone`);
      for (let i = 0; i < 50; i++) { say("again"); err("and again"); toErr("a child's chunk"); }
      await tick();
      assert.deepEqual([stdout.writes, stderr.writes], [1, 1], `${code}: writes went on after the terminal was gone`);
    }
    assert.deepEqual(uncaught, [], "a failed terminal write reached the process as an uncaught exception");
  } finally { process.off("uncaughtException", onUncaught); }
});

test("a live terminal is written to as before, and a closed stdout leaves stderr its reader", async () => {
  const live = screen();
  const w = terminalWriters({ stdout: live, stderr: live });
  w.say("one"); w.err("two"); w.say(); w.toErr("raw");
  assert.deepEqual(live.lines, ["one\n", "two\n", "\n", "raw"]);
  assert.equal(w.gone(), false);

  const piped = deadTerminal("EPIPE"), shown = screen();
  const half = terminalWriters({ stdout: piped, stderr: shown });
  half.say("a line `| head` has stopped reading");
  await tick();
  half.err("a refusal");
  assert.deepEqual(shown.lines, ["a refusal\n"], "stderr went quiet because stdout closed");
  assert.equal(half.gone(shown), false);
});

// ── a real start, hung up ────────────────────────────────────────────────────────────────────────────

/** The pids whose parent is `pid`, from `ps`, which Linux and macOS both have. Null when ps could not look. */
function childrenOf(pid) {
  const r = spawnSync("ps", ["-Ao", "pid=,ppid="], { encoding: "utf8" });
  if (r.status !== 0) return null;
  return r.stdout.split("\n").map((l) => l.trim().split(/\s+/).map(Number))
    .filter(([p, pp]) => Number.isInteger(p) && pp === pid).map(([p]) => p);
}

/** Run `args` with node in `home` on free ports until the output matches `up`. The output is piped, and kept. */
async function bringUp(home, args, up, { detached = false, env = {} } = {}) {
  const stop = async ({ child, closed }) => {
    try { if (detached) process.kill(-child.pid, "SIGKILL"); else child.kill("SIGINT"); } catch { /* gone */ }
    await Promise.race([closed, new Promise((r) => setTimeout(r, 20000))]);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  };
  const launch = async (ports) => {
    const child = spawn(process.execPath, args, {
      cwd: REPO, detached, stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: process.env.PATH, HOME: home, ...env, PORTAL_SERVICE_PORT: String(ports.portal),
        TRADEMARK_MCP_HTTP_PORT: String(ports.mcp), CLIENT_MCP_HTTP_PORT: String(ports.client) },
    });
    let said = "";
    for (const s of [child.stdout, child.stderr]) { s.setEncoding("utf8"); s.on("data", (c) => { said += c; }); }
    const closed = new Promise((resolve) => child.on("close", resolve));
    const deadline = Date.now() + 150000;
    while (!up.test(said) && child.exitCode === null && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
    if (child.exitCode !== null) await closed;
    return { child, closed, said: () => said, stop: () => stop({ child, closed }) };
  };
  return await withFreePorts(["portal", "mcp", "client"], launch, {
    busy: (r) => !up.test(r.said()) && saidPortWasTaken(r),
    discard: async (r) => { await r.stop(); rmSync(home, { recursive: true, force: true }); mkdirSync(home); },
  });
}

async function waitWhile(cond, ms) {
  const until = Date.now() + ms;
  while (cond() && Date.now() < until) await new Promise((r) => setTimeout(r, 200));
}

const START_ENV = { CLEAROTRON_NO_ENV_FILE: "1", PORTAL_LOCAL_USER: "op@localhost" };

for (const closedOutput of [false, true]) {
  const name = closedOutput
    ? "hanging up a real start whose terminal is already gone ends it, and the portal and the door it started"
    : "hanging up a real start ends the portal and the door it started";
  test(name, { timeout: 150000, skip: NO_HANGUP }, async () => {
    const home = mkdtempSync(join(tmpdir(), "hangup-start-"));
    let recorded = [];
    const run = await bringUp(home, [join(REPO, "bin", "start.mjs"), "--no-worker"], /Sign in as/, { env: START_ENV });
    try {
      assert.match(run.said(), /Sign in as/, "start never came up, so there was nothing to hang up");
      recorded = childrenOf(run.child.pid);
      assert.ok(recorded, "ps could not list processes, so what start left behind could not be looked at");
      assert.ok(recorded.length >= 2, `start had ${recorded.length} children when it came up; the portal and the door were expected`);

      if (closedOutput) { run.child.stdout.destroy(); run.child.stderr.destroy(); }
      run.child.kill("SIGHUP");
      await Promise.race([run.closed, new Promise((r) => setTimeout(r, 20000))]);
      assert.notEqual(run.child.exitCode ?? run.child.signalCode, null, "start was still running 20 seconds after the hangup");

      let left = recorded.filter((pid) => pidAlive(pid) !== false);
      await waitWhile(() => (left = recorded.filter((pid) => pidAlive(pid) !== false)).length > 0, 10000);
      assert.deepEqual(left, [], "closing the terminal left these programs of that start running, with nothing supervising them");
    } finally {
      // Only the pids this start was seen to own, and their groups, which they lead.
      for (const pid of recorded) { try { process.kill(-pid, "SIGKILL"); } catch { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } } }
      if (run.child.exitCode === null && run.child.signalCode === null) await run.stop();
      rmSync(home, { recursive: true, force: true });
    }
  });
}

// THE DEMO needs the built portal: in a clone the plain demo refuses without one. Skipped by name.
const BUNDLE = join(REPO, "portal-ui", "dist", "index.html");

test("closing the demo's window ends its supervisor, and takes its folder and running record with it", {
  timeout: 240000,
  skip: NO_HANGUP || (!existsSync(BUNDLE) && "needs the built portal bundle (npm run build:ui): in a clone the demo refuses without one"),
}, async () => {
  const home = mkdtempSync(join(tmpdir(), "hangup-demo-"));
  const running = join(home, ".config", "clearotron", "running");
  let supervisor = null;
  // Through the shim, as a reader runs it, and in a group of its own, so the hangup reaches the whole session.
  const run = await bringUp(home, [join(REPO, "bin", "clearotron.mjs"), "demo", "--no-open"], /The demo has no background form/,
    { detached: true, env: { USERPROFILE: home, TMPDIR: home } });
  try {
    assert.match(run.said(), /The demo has no background form/, "the demo never came up");
    const records = existsSync(running) ? readdirSync(running).filter((f) => f.endsWith(".json")) : [];
    assert.equal(records.length, 1, "the demo wrote no running record to read its supervisor from");
    const record = join(running, records[0]);
    supervisor = Number(records[0].replace(/\.json$/, ""));
    const { base } = JSON.parse(readFileSync(record, "utf8"));
    assert.ok(pidAlive(supervisor) !== false && existsSync(base), "no live supervisor, or no demo folder, before the window closed");

    run.child.stdout.destroy();
    run.child.stderr.destroy();
    process.kill(-run.child.pid, "SIGHUP");

    await waitWhile(() => pidAlive(supervisor) !== false || existsSync(base) || existsSync(record), 20000);
    assert.equal(pidAlive(supervisor), false, "the demo's supervisor was still running 20 seconds after the window closed");
    assert.equal(existsSync(base), false, "the demo's folder outlived the window");
    assert.equal(existsSync(record), false, "the demo's running record outlived the window");
  } finally {
    if (supervisor && pidAlive(supervisor) !== false) { try { process.kill(supervisor, "SIGKILL"); } catch { /* gone */ } }
    await run.stop();
    rmSync(home, { recursive: true, force: true });
  }
});
