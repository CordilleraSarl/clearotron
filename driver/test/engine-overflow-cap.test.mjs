// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A3 — engine (anthropic-agent) stdout/stderr maxBuffer overflow under a SIGTERM-immune spewer (the model
// that emits ONE endless newline-free line). Pre-fix the engine did `buf += d` / `stderr += d` with NO cap,
// and every streamed byte reset the stall clock — so an unbounded newline-free line grew `buf` to V8's
// ~512MB string cap → uncaught RangeError → runner crash mid-drain, and the stall/hard-wall watchdog never
// tripped (bytes kept arriving). This mirrors exec-overflow-cap.test.mjs for the engine: (1) `buf`/`stderr`
// are TRUNCATED at exactly maxBuffer (gateway capAppend parity); (2) the tree-kill is pulled FORWARD to
// overflow and the promise SETTLES nonzero seconds after the cap, not at the (here: 11-minute) hard wall;
// (3) the SIGTERM-immune tree is reaped by the group SIGKILL escalation — no crash, no hang, no orphan.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { anthropicAgentEngine } from "../engine/anthropic-agent.mjs";
import { reapPidfile } from "./reap-fixture.mjs";   // — the owner reaps it, on every exit path
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const HERE = dirname(fileURLToPath(import.meta.url));
const SPEW = join(HERE, "mock-claude-spew-immune.mjs");
chmodSync(SPEW, 0o755);

// kill(pid,0): ESRCH = dead; EPERM = alive-but-foreign (counts ALIVE — pid-reuse safety).
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
const waitDead = async (pid, ms = 4000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (!alive(pid)) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return !alive(pid);
};

test("engine overflow: endless newline-free stdout truncated at maxBuffer, tree-kill pulled forward, settles nonzero, immune tree reaped, no crash", async () => {
  const dir = mkdtempSync(join(tmpdir(), "engovf-"));
  // — REGISTERED BEFORE THE FIXTURE CAN START. The `finally` below opens AFTER the awaited turn
  // and AFTER the pidfile read, so a rejected turn or an unwritten pidfile skipped it entirely and left
  // a SIGTERM-immune process orphaned to init. This test verifies a SIGKILL escalation; delegating its
  // own cleanup to the escalation it is testing armed the leak for exactly the run that catches a
  // regression.
  const pidfile = reapPidfile(join(dir, "spew.pid"));
  const CAP = 256 * 1024;
  const env = {
    CLEAROTRON_CLAUDE_PATH: SPEW,
    CLEAROTRON_ENGINE_MAX_BUFFER: String(CAP),   // prod default 64MB — shrunk so the mock overflows instantly
    CLEAROTRON_KILL_ESCALATE_MS: "400",          // prod default 5s — shortened; only the SIGKILL reaps the immune tree
    CLEAROTRON_STALL_MS: "600000",               // long — prove OVERFLOW settles the turn, not the stall watchdog
    MOCK_CLAUDE_SPEW_PIDFILE: pidfile,
  };
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; pinEnv(process.env, k, env[k]); }
  const t0 = Date.now();
  try {
    // timeoutSec=600 → the hard wall is 660s: a sub-10s settlement can ONLY come from the overflow path.
    const r = await anthropicAgentEngine.runTurn({ message: "x", model: "sonnet", thinking: "low", timeoutSec: 600 });
    const settledMs = Date.now() - t0;
    const pid = Number(readFileSync(pidfile, "utf8"));
    try {
      assert.ok(settledMs < 10000, `settled at overflow (${settledMs}ms), not at the ~11-minute hard wall`);
      assert.notEqual(r.code, 0, "overflow is a nonzero-code failure");
      assert.equal(r.killed, false, "overflow is a plain hard failure (nonzero_exit), NOT a timeout/stall kill");
      assert.equal(r.json.status, "error", "no valid result parsed from the truncated tail → error envelope");
      assert.equal(r.usage, null, "no result event → no usage");
      assert.match(r.stderr, /output overflow/, "carries a clear overflow signature");
      assert.equal(r.signals?.stalled, undefined, "not misclassified as a stall");
      assert.equal(r.signals?.hardWall, undefined, "not misclassified as a hard-wall timeout");
      assert.ok(await waitDead(pid), "the SIGTERM-immune spewer is dead after the group SIGKILL escalation");
    } finally {
      try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
    }
  } finally {
    for (const k of Object.keys(env)) { if (saved[k] === undefined) delete process.env[k]; else pinEnv(process.env, k, saved[k]); }
  }
});
