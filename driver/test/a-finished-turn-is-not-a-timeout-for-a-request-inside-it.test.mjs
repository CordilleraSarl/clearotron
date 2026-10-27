// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A FINISHED TURN IS NOT A TIMEOUT FOR A REQUEST THAT TIMED OUT INSIDE IT.
//
// An attempt is a timeout on one of three signals: the process was killed, its stderr names a timed-out request, or it
// exited non-zero past its limit. The second fired on a turn that had finished: on one test run a writer ran 14.7
// minutes of its 43, exited 0 with its engine's status ok and its output written, and was recorded as a timeout because
// a web lookup inside the turn had timed out. The stage ran a second attempt, 20.3 minutes more. A turn that completed
// is now judged on what it wrote; a kill and a run past the limit stay timeouts, and the row says which signal fired.
// Every name here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";

process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
const ROOT = mkdtempSync(join(tmpdir(), "finished-turn-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool"));
process.env.CLEAROTRON_RETRY_BACKOFF_MS = "0";
const GW = await import("../gateway.mjs");

const withEnv = async (vars, fn) => {
  const prev = {};
  for (const [k, v] of Object.entries(vars)) { prev[k] = process.env[k]; if (v == null) delete process.env[k]; else pinEnv(process.env, k, String(v)); }
  try { return await fn(); } finally { for (const [k, v] of Object.entries(prev)) pinEnv(process.env, k, v); }
};
const STDERR = "web_fetch: request timed out after 30000ms\n";

test("which signal fired is named: killed, stderr or wall", () => {
  const base = { killed: false, code: 0, wall: 10, stderr: "", timeoutSec: 60 };
  assert.equal(GW.timeoutCause(base), null);
  assert.equal(GW.timeoutCause({ ...base, killed: true }), "killed");
  assert.equal(GW.timeoutCause({ ...base, stderr: STDERR }), "stderr");
  assert.equal(GW.timeoutCause({ ...base, code: 1, wall: 61 }), "wall");
  assert.equal(GW.isTimeout({ ...base, stderr: STDERR }), true, "the classifier's three signals are unchanged");
});

test("a completed turn is not a timeout for a request inside it; a kill, a wall or an unfinished turn still is", () => {
  const ok = { status: "ok" };
  assert.equal(GW.attemptTimedOut({ cause: "stderr", code: 0, json: ok }), false);
  assert.equal(GW.attemptTimedOut({ cause: "stderr", code: 1, json: ok }), true, "a non-zero exit did not complete");
  assert.equal(GW.attemptTimedOut({ cause: "stderr", code: 0, json: { status: "error" } }), true, "the engine did not report the turn complete");
  assert.equal(GW.attemptTimedOut({ cause: "stderr", code: 0, json: null }), true, "nothing says the turn completed");
  assert.equal(GW.attemptTimedOut({ cause: "killed", code: 0, json: ok }), true);
  assert.equal(GW.attemptTimedOut({ cause: "wall", code: 1, json: ok }), true);
  assert.equal(GW.attemptTimedOut({ cause: null, code: 0, json: ok }), false);
});

async function stage(tag, turn, { writes = true } = {}) {
  const runDir = mkdtempSync(join(ROOT, `${tag}-`));
  mkdirSync(driverDir(runDir), { recursive: true });
  const out = join(runDir, "narrative.md");
  let turns = 0;
  GW.registerEngine({ name: "openai-agent", async runTurn() {
    turns++;
    if (writes) writeFileSync(out, "# Narrative\n\nAn invented narrative the turn wrote.\n");
    return turn;
  } });
  const r = await withEnv({ CLEAROTRON_AI: "openai-agent", CLEAROTRON_MAX_RETRIES: "1", CLEAROTRON_RECOVERY_MAX: "0" }, () =>
    GW.runStage("synthesis", { agent: "mailagent", message: "go", model: "haiku", sessionKey: `clearance-${tag}`, timeoutSec: 2582,
      runDir, expectFile: [out] }));
  const rows = (() => { try { return readFileSync(driverDir(runDir, "synthesis.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } })();
  return { r, turns, rows };
}
const FINISHED = { code: 0, killed: false, wall: 882, stdout: "", stderr: STDERR, laneWaitMs: 0,
  json: { status: "ok", runId: "run-1" }, usage: { input_tokens: 100, output_tokens: 50 }, sessionRef: "thr" };

test("a writer pass that completed and wrote its output is taken on its first attempt", async () => {
  const { r, turns, rows } = await stage("finished", FINISHED);
  assert.equal(turns, 1, "the finished pass was run again");
  assert.equal(r?.ok, true, `the stage failed: ${r?.fail ?? "(no fail recorded)"}`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].fail ?? null, null);
  assert.equal(rows[0].timeoutCause, "stderr", "the row does not say the stderr named a timed-out request");
});

test("a completed turn that wrote nothing fails on its output, not as a timeout", async () => {
  const { rows } = await stage("no-output", FINISHED, { writes: false });
  assert.ok(rows.length >= 1);
  assert.notEqual(rows[0].fail, "timeout", "a turn that completed was recorded as a timeout");
  assert.ok(rows[0].fail, "a turn that wrote nothing passed");
  assert.equal(rows[0].timeoutCause, "stderr");
});

test("a killed turn is still a timeout, whatever it wrote, and says it was killed", async () => {
  // Killed at its hard wall a moment after writing: the wall rescue refuses an artifact that was not quiet, so the
  // attempt stays a timeout.
  const { rows } = await stage("killed", { ...FINISHED, killed: true, json: { status: "timeout" }, signals: { hardWall: true } });
  assert.equal(rows[0].fail, "timeout");
  assert.equal(rows[0].timeoutCause, "killed");
});
