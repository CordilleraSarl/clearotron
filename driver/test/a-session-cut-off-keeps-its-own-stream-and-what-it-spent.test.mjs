// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A SESSION CUT OFF KEEPS ITS OWN STREAM AND WHAT IT SPENT.
//
// On a test run of a crowded matter the writer ran seven sessions under two stream names: a recovery park
// re-entered the stage at attempt 1, and each follow-up pass dispatched its own attempt 1. Each later session
// opened the name for writing and truncated it, so the three cut off at the wall, 28 to 41 MB of stream, kept
// none, and their rows named files holding other sessions' bytes. The same three were codex turns, which state
// their tokens only on `turn.completed`, so each was journalled `usage: null` and counted as spending nothing.
//
// A later session under a taken name now writes `<stem>.session<N>.jsonl` and its row names that file, and a
// codex turn that never completed takes what it spent from codex's own session log, as the Claude engine takes
// it from its stream. Every task is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { streamSink } from "../engine/session-record.mjs";
import * as codex from "../engine/openai-agent.mjs";
import { classifyWedge } from "../gateway.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const readRolloutUsage = (...a) => (typeof codex.readRolloutUsage === "function" ? codex.readRolloutUsage(...a) : undefined);
const aDir = (t) => { const d = mkdtempSync(join(tmpdir(), "cut-session-")); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };

test("a second session under a taken stream name keeps the first session's bytes, and names its own file", (t) => {
  const file = join(aDir(t), "streams", "synthesis.attempt1.jsonl");
  const first = streamSink(file);
  first.write("{\"type\":\"thread.started\",\"thread_id\":\"first\"}\n");
  const one = first.close();
  const second = streamSink(file);
  second.write("{\"type\":\"thread.started\",\"thread_id\":\"second\"}\n");
  const two = second.close();
  const third = streamSink(file);
  third.write("x\n");
  const three = third.close();
  assert.match(readFileSync(file, "utf8"), /"first"/, "the first session's stream was written over by the next");
  assert.equal(one.file, file);
  assert.notEqual(two.file, file, "the second session's row names the first session's file");
  assert.equal(basename(two.file), "synthesis.attempt1.session2.jsonl");
  assert.match(readFileSync(two.file, "utf8"), /"second"/);
  assert.equal(basename(three.file), "synthesis.attempt1.session3.jsonl");
  assert.deepEqual([one.present, two.present, three.present], [true, true, true]);
  assert.equal(readdirSync(dirname(file)).length, 3);
});

// A codex session log as codex 0.162.0 writes one: a running total after each model response, its share beside it.
function rollout(home, rows) {
  const dir = join(home, "sessions", "2026", "10", "26");
  mkdirSync(dir, { recursive: true });
  let total = { input_tokens: 0, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 0 };
  const lines = [{ timestamp: rows[0]?.at, type: "session_meta", payload: { session_id: "s", cli_version: "0.162.0" } }];
  for (const { at, last, repeat } of rows) {
    if (!repeat) total = Object.fromEntries(Object.keys(total).map((k) => [k, total[k] + (last[k] || 0)]));
    lines.push({ timestamp: at, type: "event_msg", payload: { type: "token_count", info: { total_token_usage: total, last_token_usage: repeat ? lines.at(-1).payload.info.last_token_usage : last } } });
  }
  writeFileSync(join(dir, "rollout-2026-10-26T10-00-00-s.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}
const T0 = Date.parse("2026-10-26T10:00:00.000Z");
const at = (sec) => new Date(T0 + sec * 1000).toISOString();

test("what a turn spent is read off the session log: this turn's responses only, each once", (t) => {
  const home = aDir(t);
  rollout(home, [
    { at: at(-60), last: { input_tokens: 900, cached_input_tokens: 800, output_tokens: 90 } },   // an earlier turn on a resumed thread
    { at: at(5), last: { input_tokens: 1000, cached_input_tokens: 600, output_tokens: 40 } },
    { at: at(6), repeat: true },                                                                  // the same response stated again
    { at: at(30), last: { input_tokens: 1500, cached_input_tokens: 1200, output_tokens: 60 } },
  ]);
  const usage = readRolloutUsage(home, T0);
  assert.notEqual(usage, undefined, "the engine has no reader for what a cut-off turn spent");
  assert.deepEqual(usage, { input_tokens: 2500, cached_input_tokens: 1800, cache_write_input_tokens: 0, output_tokens: 100 });
  assert.deepEqual(codex.mapUsage(usage), { input: 700, output: 100, cacheRead: 1800, cacheWrite: 0, total: 2600 });
});

test("a session log with no response in this turn, or no log at all, says nothing was recorded", (t) => {
  const home = aDir(t);
  rollout(home, [{ at: at(-60), last: { input_tokens: 900, output_tokens: 90 } }]);
  assert.equal(readRolloutUsage(home, T0), null, "an earlier turn's tokens were charged to this one");
  assert.equal(readRolloutUsage(aDir(t), T0), null);
  assert.equal(readRolloutUsage(null, T0), null);
});

test("a codex turn cut off by the watchdog keeps what it spent, counted as rebuilt, and is not taken for a silent lane", async (t) => {
  const PINNED = { CLEAROTRON_CODEX_PATH: join(HERE, "mock-codex.mjs"), CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-codex-test",
    MOCK_CODEX_STALL: "1", MOCK_CODEX_ROLLOUT_TOKENS: JSON.stringify([{ input_tokens: 4000, cached_input_tokens: 3000, output_tokens: 250 }, { input_tokens: 5000, cached_input_tokens: 4200, output_tokens: 300 }]) };
  const saved = Object.fromEntries(Object.keys(PINNED).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(PINNED)) pinEnv(process.env, k, v);
  t.after(() => { for (const k of Object.keys(PINNED)) { if (saved[k] === undefined) delete process.env[k]; else pinEnv(process.env, k, saved[k]); } });
  const streamFile = join(aDir(t), "streams", "synthesis.attempt1.jsonl");
  const r = await codex.openaiAgentEngine.runTurn({ message: "invented task", model: "haiku", thinking: "low", timeoutSec: 60, stallSec: 0.5, streamFile });
  assert.equal(r.killed, true, `premise: the turn was not cut off: ${r.stderr}`);
  assert.deepEqual(r.usage, { input: 1800, output: 550, cacheRead: 7200, cacheWrite: 0, total: 9550 }, "the cut-off turn was journalled as spending nothing");
  assert.equal(r.signals?.usageStreamed, true, "the usage is not marked as rebuilt, so it counts as a measured turn");
  assert.equal(classifyWedge("timeout", r.usage, r.signals), "timeout", "a turn that spent tokens was taken for a silent lane");
  assert.equal(r.stream?.file, streamFile);
});

test("a codex turn that completed keeps the stream's own count, and is not marked as rebuilt", async (t) => {
  const PINNED = { CLEAROTRON_CODEX_PATH: join(HERE, "mock-codex.mjs"), CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-codex-test",
    MOCK_CODEX_ROLLOUT_TOKENS: JSON.stringify([{ input_tokens: 4000, output_tokens: 250 }]) };
  const saved = Object.fromEntries(Object.keys(PINNED).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(PINNED)) pinEnv(process.env, k, v);
  t.after(() => { for (const k of Object.keys(PINNED)) { if (saved[k] === undefined) delete process.env[k]; else pinEnv(process.env, k, saved[k]); } });
  const r = await codex.openaiAgentEngine.runTurn({ message: "reply ok", model: "haiku", thinking: "low", timeoutSec: 60 });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.usage, { input: 80, output: 46, cacheRead: 40, cacheWrite: 0, total: 166 }, "the stream's count was replaced");
  assert.equal(r.signals?.usageStreamed, undefined);
});
