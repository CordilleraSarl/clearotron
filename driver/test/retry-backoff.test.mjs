// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// D3 — runStage inter-attempt backoff + Anthropic 529/overload classification. Pre-fix the ladder
// re-dispatched the SAME SECOND an attempt failed (an immediate retry into a still-booting gateway was
// the direct cause of one outbox-wake failure), and a 529 overload hid inside nonzero_exit_1 so the
// ladder hammered an overloaded API seconds apart on the same model. These pin: (a) retryBackoffMs
// (env knob, default 20s, attempt 1 never waits), (b) the backoff actually elapsing between attempts,
// (c) isOverloaded's anchored matching, (d) the runStage routing — status_overloaded stops the ladder
// after ONE attempt and stays on the existing fallback (chain cascade) + recovery-park machinery.
import { test, beforeEach, after } from "node:test";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MOCK_CLAUDE = join(HERE, "mock-claude.mjs");

// A minimal multi-mode CLAUDE-shaped mock (MOCK_MODE, read per invocation — one binary per test file):
//   flake  — count calls; every call a clean result, the output file written only from call 2 on
//   ok     — clean result, writes nothing (pair with a pre-written file / a failing validator)
//   err529 — the raw transport shape: overloaded_error on stderr, nonzero exit, no JSON
const MOCK_DIR = mkdtempSync(join(tmpdir(), "backoff-mock-"));
const MOCK = join(MOCK_DIR, "mock-claude-mini.mjs");
writeFileSync(MOCK, `#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const ok = () => process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false,
  duration_ms: 5, num_turns: 1, result: "mock ok", stop_reason: "end_turn", session_id: "mock-mini",
  total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }) + "\\n");
switch (process.env.MOCK_MODE) {
  case "flake": {
    const cFile = process.env.MOCK_COUNT_FILE;
    const n = (existsSync(cFile) ? Number(readFileSync(cFile, "utf8")) : 0) + 1;
    writeFileSync(cFile, String(n));
    if (n > 1) writeFileSync(process.env.MOCK_OUT_FILE, "recovered\\n");
    ok(); break;
  }
  case "ok": ok(); break;
  case "err529":
    process.stderr.write('API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\\n');
    process.exit(1);
  default: process.stderr.write("MOCK_MODE not set\\n"); process.exit(1);
}
`);
chmodSync(MOCK, 0o755);
// WS-C: the run slot lock dir must be writable — point it at a tmp. Held in a binding as well as in
// the env so the `after` hook below can remove it: a path only the environment knows is a path
// nothing can clean up.
const LOCK_DIR = mkdtempSync(join(tmpdir(), "backoff-locks-"));
process.env.CLEAROTRON_RUN_LOCK_DIR = LOCK_DIR;
// code-side saturation-probe (2026-07-14): OFF in this legacy harness — its scenarios script the AGENT
// member; the dedicated satprobe-codeside tests exercise the code-side path with an injected executor.
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";
// band-truth gate (2026-07-14): OFF in hermetic harnesses — mock runs never dial the provider, so the
// production call ledger can never evidence their bands; the dedicated band-truth-gate tests turn it ON.
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
const { runStage, retryBackoffMs, isOverloaded } = await import("../gateway.mjs");
const { isFallbackEligible } = await import("../pipeline.mjs");
const { TRANSIENT_RE } = await import("../repairs.mjs");

// EVERY DIRECTORY THIS FILE MAKES IS REMOVED, INCLUDING THE LAST ONE. `beforeEach` cleans the
// PREVIOUS iteration's dir, which leaves the final one behind on every run, and the two module-scope
// dirs above were never removed at all — three per run, accumulating in the temp root since the file
// was written (18 found on the box, six runs' worth)..
let dir;
after(() => {
  for (const d of [MOCK_DIR, LOCK_DIR, dir]) if (d) rmSync(d, { recursive: true, force: true });
});
beforeEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = mkdtempSync(join(tmpdir(), "backoff-"));
  process.env.MOCK_COUNT_FILE = join(dir, "count");
  process.env.MOCK_OUT_FILE = join(dir, "out.md");
  for (const k of ["MOCK_MODE", "CLEAROTRON_RETRY_BACKOFF_MS", "CLEAROTRON_CLAUDE_PATH", "MOCK_CLAUDE_OVERLOADED"]) delete process.env[k];
  // The product ships ONE engine (anthropic-agent); every leg runs it against the mini claude mock
  // unless a test pins the full mock-claude for a richer shape.
  process.env.CLEAROTRON_AI = "anthropic-agent";
  pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", MOCK);
});

const stage = (over = {}) => runStage("test-stage", {
  agent: "clawdi", message: "BASE TASK", sessionKey: "prelim-test-backoff",
  timeoutSec: 30, expectFile: process.env.MOCK_OUT_FILE, maxRetries: 2, ...over,
});

test("retryBackoffMs: default 20s; env knob overrides; explicit 0 disables; garbage/negative never breaks the ladder", () => {
  delete process.env.CLEAROTRON_RETRY_BACKOFF_MS;
  assert.equal(retryBackoffMs(), 20000, "default = 20s (the 15-30s D3 band)");
  process.env.CLEAROTRON_RETRY_BACKOFF_MS = "10";
  assert.equal(retryBackoffMs(), 10, "tests pin a tiny value");
  process.env.CLEAROTRON_RETRY_BACKOFF_MS = "0";
  assert.equal(retryBackoffMs(), 0, "explicit 0 = disabled (the old instant-retry behaviour)");
  process.env.CLEAROTRON_RETRY_BACKOFF_MS = "";
  assert.equal(retryBackoffMs(), 20000, "empty string → default, never NaN");
  process.env.CLEAROTRON_RETRY_BACKOFF_MS = "abc";
  assert.equal(retryBackoffMs(), 20000, "garbage → default");
  process.env.CLEAROTRON_RETRY_BACKOFF_MS = "-5";
  assert.equal(retryBackoffMs(), 0, "negative clamps to 0 (no negative setTimeout)");
});

test("backoff IS observed between attempts (a retry waits the configured window before dispatching)", async () => {
  process.env.MOCK_MODE = "flake";                       // attempt 1 fails missing_file → attempt 2 recovers
  process.env.CLEAROTRON_RETRY_BACKOFF_MS = "300";
  const t0 = Date.now();
  const r = await stage();
  const elapsed = Date.now() - t0;
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 2, "one retry ran");
  assert.ok(elapsed >= 300, `the inter-attempt backoff elapsed (${elapsed}ms >= 300ms)`);
});

test("attempt 1 NEVER waits — a first-try success under the 20s default finishes fast", async () => {
  process.env.MOCK_MODE = "flake";
  writeFileSync(process.env.MOCK_OUT_FILE, "already there\n");   // call 1 passes the file gate
  delete process.env.CLEAROTRON_RETRY_BACKOFF_MS;                    // the real 20s default is in force
  const t0 = Date.now();
  const r = await stage();
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 1);
  assert.ok(Date.now() - t0 < 5000, "no 20s sleep before the first attempt");
});

test("isOverloaded: anchored matching — the real 529/overload shapes fire, a stray '529' never does", () => {
  assert.equal(isOverloaded({ json: { status: "overloaded" } }), true, "the gateway envelope's own status");
  assert.equal(isOverloaded({ stdout: 'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}' }), true, "the claude -p result text");
  assert.equal(isOverloaded({ stderr: 'request failed: HTTP 529' }), true);
  assert.equal(isOverloaded({ stderr: 'upstream returned 529 (overloaded), giving up' }), true, "529 + overload vocabulary on one line");
  assert.equal(isOverloaded({ stdout: "reviewed docket entry 529 for the opposition" }), false, "a bare number never misroutes");
  assert.equal(isOverloaded({ stderr: "ECONNRESET" }), false);
  assert.equal(isOverloaded({}), false);
  assert.equal(isOverloaded(), false);
});

test("anthropic-agent 529 → fail 'status_overloaded' after ONE attempt (no in-ladder re-hammering)", async () => {
  process.env.CLEAROTRON_AI = "anthropic-agent";
  pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", MOCK_CLAUDE);
  process.env.MOCK_CLAUDE_OVERLOADED = "1";
  process.env.CLEAROTRON_RETRY_BACKOFF_MS = "10";
  const r = await stage();
  assert.equal(r.ok, false);
  assert.equal(r.fail, "status_overloaded", "reclassified out of the generic nonzero_exit_1");
  assert.notEqual(r.fail, "rate_limited", "distinct from the 429 postpone path (no resetsAt conflation)");
  assert.equal(r.attempts, 1, "the ladder breaks — the chain cascade / recovery park owns the re-attempt");
  assert.deepEqual(r.attemptFails, ["status_overloaded"], "the taint chain sees the classified token");
});

// (The gateway-bin engine-parity leg is retired with the engine: the {status:"overloaded"} envelope
// SHAPE stays pinned by the isOverloaded unit test above; classification/routing is engine-agnostic.)

test("raw transport 529 (stderr, nonzero exit, no JSON) → reclassified and broken after ONE attempt", async () => {
  process.env.MOCK_MODE = "err529";
  process.env.CLEAROTRON_RETRY_BACKOFF_MS = "10";
  const r = await stage();
  assert.equal(r.ok, false);
  assert.equal(r.fail, "status_overloaded");
  assert.equal(r.attempts, 1);
});

test("status_overloaded routes to the EXISTING machinery: fallback-eligible (chain cascade) + transient (recovery park)", () => {
  assert.equal(isFallbackEligible("status_overloaded"), true, "the chain cascades models on it");
  assert.equal(TRANSIENT_RE.test("status_overloaded"), true, "an exhausted chain parks .postponed with escalating backoff");
});

test("a CONTENT failure mentioning overload vocabulary is never laundered into status_overloaded", async () => {
  process.env.MOCK_MODE = "ok";
  writeFileSync(process.env.MOCK_OUT_FILE, "draft\n");
  process.env.CLEAROTRON_RETRY_BACKOFF_MS = "10";
  const r = await stage({ validate: () => ({ ok: false, reason: "cites docket 529 as overloaded evidence" }), maxRetries: 1 });
  assert.equal(r.ok, false);
  assert.match(r.fail, /^invalid_file:/, "content failures keep their token — only transport shapes reclassify");
  assert.equal(r.attempts, 2, "and they keep their normal corrective retry");
});
