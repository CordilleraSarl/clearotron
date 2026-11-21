// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A STAGE CUT OFF MID-STREAM ENDS ITS CHILD, ITS STREAM AND ITS RECORD, THE SAME WAY ON BOTH ENGINES.
//
// Both engines start their program and watch it through the same two pieces in engine/common.mjs
// (startGovernedChild, governWatchdog). This holds what a kill leaves behind, through the real gateway and each
// engine's real adapter against its stand-in program: a turn that has streamed and then gone silent is ended by the
// watchdog, and afterwards
//   - the program and what it started are gone: a grandchild in its process group that ignores SIGTERM included, so
//     the escalation to SIGKILL is what ends it on a POSIX system;
//   - the run's record of its engine child named that program while the turn ran, and is cleared once it ended;
//   - the session's stream is closed and kept gzipped, holding every line the program streamed and nothing else,
//     with the attempt row naming it and its size;
//   - the attempt row and the run's attempt event record the kill as a stall, with what the turn had spent.
// A turn still streaming when it reaches a short hard wall is ended the same way, and recorded as a hard wall, never as
// a stall: the retry policy treats the two differently.
// The values pinned are the ones the adapters recorded before they shared those pieces. Invented values only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";
import { readEngineChild } from "../engine/child-record.mjs";
import { reapPidfile, reapNow } from "./reap-fixture.mjs";   // the owner reaps the tree, on every exit path

const HERE = dirname(fileURLToPath(import.meta.url));
const { runStage } = await import("../gateway.mjs");

const ENGINES = {
  "anthropic-agent": {
    env: { CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: join(HERE, "mock-claude.mjs"), MOCK_CLAUDE_USAGE_THEN_STALL: "1" },
    slow: { CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: join(HERE, "mock-claude.mjs"), MOCK_CLAUDE_SLOW_STREAM: "40", MOCK_CLAUDE_SLOW_COUNT: "1000" },
    streamed: ["system", "assistant"],
    fail: "timeout",
    signals: { stalled: true, usageStreamed: true, thought: false },
    usage: { input: 7, output: 3, cacheRead: 2950000, cacheWrite: 0, total: 2950010 },
  },
  "openai-agent": {
    env: { CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: join(HERE, "mock-codex.mjs"), CLEAROTRON_AI_BILLING: "api-key",
      CODEX_API_KEY: "sk-invented", MOCK_CODEX_STALL: "mid" },
    slow: { CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: join(HERE, "mock-codex.mjs"), CLEAROTRON_AI_BILLING: "api-key",
      CODEX_API_KEY: "sk-invented", MOCK_CODEX_SLOW_STREAM: "40", MOCK_CODEX_SLOW_COUNT: "1000" },
    streamed: ["thread.started", "turn.started", "item.completed"],
    // codex states its tokens only when a turn completes, so a turn cut off with no session log spent nothing it can name
    fail: "lane_wedge",
    signals: { stalled: true, thought: null },
    usage: null,
  },
};

function withEnv(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; pinEnv(process.env, k, env[k]); }
  return (async () => { try { return await fn(); } finally { for (const k of Object.keys(env)) { if (saved[k] === undefined) delete process.env[k]; else pinEnv(process.env, k, saved[k]); } } })();
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
async function gone(pid, ms = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (!alive(pid)) return true; await new Promise((r) => setTimeout(r, 25)); }
  return !alive(pid);
}
const rows = (f) => readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l));

/** One dispatch of an invented stage on `engine`, cut off by the watchdog: what it returned, recorded and left behind. */
async function cutOff(t, engine, env) {
  const dir = mkdtempSync(join(tmpdir(), "cut-mid-stream-"));
  // reaped before the folder holding its pidfile goes, or a tree the kill missed would be left running
  t.after(() => { reapNow(); rmSync(dir, { recursive: true, force: true }); });
  mkdirSync(driverDir(dir), { recursive: true });
  const pidfile = reapPidfile(join(dir, "tree.json"));
  const out = join(dir, "invented-out.md");
  let recordedWhileRunning = null;
  const res = await withEnv({ ...env, MOCK_STALL_TREE_PIDFILE: pidfile, CLEAROTRON_KILL_ESCALATE_MS: "300", CLEAROTRON_RETRY_BACKOFF_MS: "0",
    CLEAROTRON_RUN_LOCK_DIR: join(dir, "locks") }, async () => {
    const turn = runStage("invented-stage", { message: `TASK\nOUTPUT_FILE: ${out}`, model: "haiku", sessionKey: `cut-mid-${engine}`,
      runDir: dir, expectFile: out, maxRetries: 0, timeoutSec: 30 });
    // the run's record of its engine child, read while the program is still running
    let settled = false;
    turn.finally(() => { settled = true; });
    while (!settled && recordedWhileRunning === null) {
      recordedWhileRunning = readEngineChild(dir);
      await new Promise((r) => setTimeout(r, 10));
    }
    return turn;
  });
  const [row] = rows(driverDir(dir, "invented-stage.jsonl"));
  const streams = readdirSync(driverDir(dir, "streams"));
  const stream = streams.length === 1 && streams[0].endsWith(".gz") ? gunzipSync(readFileSync(driverDir(dir, "streams", streams[0]))).toString("utf8") : null;
  const events = rows(driverDir(dir, "run.jsonl")).filter((e) => e.event === "attempt" && e.stage === "invented-stage");
  return { res, row, streams, stream, events, recordedWhileRunning, recordAfter: readEngineChild(dir),
    tree: existsSync(pidfile) ? JSON.parse(readFileSync(pidfile, "utf8")) : null };
}

for (const [engine, want] of Object.entries(ENGINES)) {
  test(`${engine}: a stage cut off mid-stream ends its program and what it started, closes its stream whole, and records the kill`, async (t) => {
    const { res, row, streams, stream, events, recordedWhileRunning, recordAfter, tree } = await cutOff(t, engine,
      // a window wide enough that a loaded box cannot deschedule the stand-in past it between its first two lines
      { ...want.env, CLEAROTRON_STALL_MS: "1500" });

    // the kill, classified as it was
    assert.equal(res.ok, false, "a turn the watchdog cut off was accepted");
    assert.equal(res.attempts, 1);
    assert.equal(res.fail, want.fail);

    // the child and what it started
    assert.ok(tree, "the stand-in program never named its process tree");
    assert.ok(await gone(tree.pid), "the program outlived its kill");
    assert.ok(await gone(tree.grandPid), "what the program started outlived the kill (a SIGTERM-ignoring grandchild in its group)");
    if (process.platform !== "win32") assert.throws(() => process.kill(-tree.pid, 0), { code: "ESRCH" }, "the program's process group outlived the kill");
    assert.equal(recordedWhileRunning?.pid, tree.pid, "while the turn ran, the run's engine-child record did not name its program");
    assert.equal(recordAfter, null, "the engine-child record outlived the turn");

    // the stream: closed, gzipped, every streamed line and nothing else
    assert.deepEqual(streams, ["invented-stage.attempt1.jsonl.gz"], "the stream was not closed and kept as one gzipped file");
    assert.ok(stream.endsWith("\n"), "the stream ends part-way through a line");
    assert.deepEqual(stream.trim().split("\n").map((l) => JSON.parse(l).type), want.streamed, "the stream does not hold exactly what the program streamed");
    assert.deepEqual(row.stream, { file: "_driver/streams/invented-stage.attempt1.jsonl.gz", present: true, bytes: Buffer.byteLength(stream) });

    // the record: the attempt row and the run's attempt event
    assert.equal(row.ok, false);
    assert.equal(row.fail, want.fail);
    assert.equal(row.killed, true);
    assert.equal(row.timeoutCause, "killed");
    assert.equal(row.killedWhile, null);
    assert.deepEqual(row.signals, want.signals);
    assert.deepEqual(row.usage, want.usage, "the kill lost or invented what the turn spent");
    assert.equal(events.length, 1);
    assert.deepEqual([events[0].ok, events[0].fail, events[0].killed, events[0].interrupted, events[0].timeoutCause, events[0].stream],
      [false, want.fail, true, false, "killed", "_driver/streams/invented-stage.attempt1.jsonl.gz"]);
    assert.equal(events[0].outputTokens, want.usage?.output ?? null);
  });

  test(`${engine}: a stage still streaming at a short hard wall is ended and recorded as a hard wall, not a stall`, async (t) => {
    const { res, row, streams, stream, events, recordedWhileRunning, recordAfter } = await cutOff(t, engine,
      { ...want.slow, CLEAROTRON_STALL_MS: "4000", CLEAROTRON_HARD_MS: "1500" });
    assert.equal(res.ok, false, "a turn the hard wall cut off was accepted");
    assert.equal(res.fail, "timeout");
    assert.ok(Number.isInteger(recordedWhileRunning?.pid), "while the turn ran, the run's engine-child record named no program");
    assert.ok(await gone(recordedWhileRunning.pid), "the program outlived the hard wall");
    assert.equal(recordAfter, null, "the engine-child record outlived the turn");
    assert.deepEqual(streams, ["invented-stage.attempt1.jsonl.gz"], "the stream was not closed and kept as one gzipped file");
    assert.deepEqual(row.stream, { file: "_driver/streams/invented-stage.attempt1.jsonl.gz", present: true, bytes: Buffer.byteLength(stream) });
    assert.equal(row.killed, true);
    assert.equal(row.timeoutCause, "killed");
    assert.deepEqual(row.signals, { hardWall: true, thought: want.signals.thought }, "a hard-wall kill was recorded as something else");
    assert.notEqual(row.signals.stalled, true, "a turn that kept streaming was recorded as a stall");
    assert.equal(events.length, 1);
    assert.deepEqual([events[0].fail, events[0].killed, events[0].timeoutCause], ["timeout", true, "killed"]);
  });
}
