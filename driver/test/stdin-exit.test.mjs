// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// C2 defense-in-depth — stdin-EOF self-exit for the MCP sidecars. A stdio MCP server lives exactly as
// long as the client that spawned it: when the client that spawned it dies (or the group kill misses a
// setpgid'd child), stdin closes and the sidecar must exit ITSELF — abandoning in-flight work —
// instead of orphaning (the 3.5-day PPID-1 bridge) and continuing billable calls / racing late
// *-band.json writes. Covers the driver's stdio-server scaffolding and the bridge's stdin-guard
// (bridge.mjs itself needs its SDK installed, so the guard module is what's testable hermetically).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

// Spawn a fixture with piped stdio, feed it `lines`, end stdin after `endAfterMs`, and resolve
// {code, stdout, stderr, exitedInMs} — rejecting nothing (a hang fails via the exitedInMs assert).
function runToEof(script, lines, { endAfterMs = 150, killAfterMs = 6000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(HERE, script)], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const t0 = Date.now();
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    for (const l of lines) child.stdin.write(JSON.stringify(l) + "\n");
    setTimeout(() => child.stdin.end(), endAfterMs);
    const killer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } }, killAfterMs);
    child.on("close", (code, signal) => {
      clearTimeout(killer);
      resolve({ code, signal, stdout, stderr, exitedInMs: Date.now() - t0 });
    });
  });
}

const INIT = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } };

test("stdio-server: exits 0 within seconds of stdin EOF (idle server)", async () => {
  const r = await runToEof("mock-gather-stdin-server.mjs", [INIT]);
  assert.equal(r.code, 0, `clean self-exit on EOF (signal=${r.signal ?? "none"}, stderr=${r.stderr.slice(0, 200)})`);
  assert.ok(r.exitedInMs < 5000, `exited in ${r.exitedInMs}ms — not SIGKILLed by the test harness`);
  assert.match(r.stdout, /"id":1/, "the handshake answered before the EOF (server was really up)");
});

test("stdio-server: stdin EOF ABANDONS an in-flight 60s handler — exit is immediate, not after the call", async () => {
  const call = { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "sleepy", arguments: {} } };
  const r = await runToEof("mock-gather-stdin-server.mjs", [INIT, call], { endAfterMs: 250 });
  assert.equal(r.code, 0, "self-exit, not the test harness's SIGKILL");
  assert.ok(r.exitedInMs < 5000, `exited in ${r.exitedInMs}ms with the 60s handler still pending — in-flight work is abandoned by design`);
  assert.ok(!/"id":2/.test(r.stdout), "the in-flight call never answered (it was abandoned, not awaited)");
});

test("stdin-guard (bridge wiring): exits 0 on stdin EOF while an in-flight-call stand-in holds the loop", async () => {
  const r = await runToEof("mock-stdin-guard-child.mjs", [], { endAfterMs: 150 });
  assert.equal(r.code, 0, "the guard exits 0 — the interval stand-in would otherwise hold the process forever");
  assert.ok(r.exitedInMs < 5000, `exited in ${r.exitedInMs}ms`);
  assert.match(r.stderr, /stdin (end|close) — parent gone, exiting/, "the greppable orphan-exit signal is on stderr");
});
