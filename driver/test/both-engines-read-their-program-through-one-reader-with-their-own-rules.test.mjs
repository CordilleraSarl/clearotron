// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// BOTH ENGINES READ THEIR PROGRAM THROUGH ONE READER, EACH WITH ITS OWN RULES.
//
// readGovernedStreams (engine/common.mjs) decodes a program's stdout and stderr, splits stdout into lines and holds
// both under the buffer cap, for the Codex engine (through runStreamingChild) and the Claude engine alike. Where the
// two engines read differently, the difference is an option, and this file holds each option to what it does, then
// holds each engine to the rule it had before the reader was shared:
//   - on Claude, stderr is neither speech nor liveness, so a program that speaks and then writes only stderr is ended
//     as a stall; on Codex it is liveness;
//   - on Claude only the line buffer is held to the cap, so a long output in short lines is no overflow; Codex keeps
//     the whole output for its caller and holds that to the cap as well.
// Invented values only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readGovernedStreams } from "../engine/common.mjs";
import { anthropicAgentEngine } from "../engine/anthropic-agent.mjs";
import { openaiAgentEngine } from "../engine/openai-agent.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** A child whose two streams the test writes to, and a reader over it with `opts`, recording what the reader says. */
function readerOver(opts = {}) {
  const child = { stdout: new EventEmitter(), stderr: new EventEmitter() };
  const seen = { lines: [], spoken: 0, moves: 0, chunks: [], overflows: 0, closed: false };
  const reader = readGovernedStreams({ child, maxBuffer: 1024, closed: () => seen.closed,
    onLine: (l) => seen.lines.push(l), onSpoken: () => { seen.spoken += 1; }, onMove: () => { seen.moves += 1; },
    onOverflow: () => { seen.overflows += 1; }, ...opts });
  return { child, seen, reader, out: (s) => child.stdout.emit("data", Buffer.from(s)), err: (s) => child.stderr.emit("data", Buffer.from(s)) };
}

test("lines arrive trimmed and never empty, a character split across chunks arrives whole, and the last line at flush", () => {
  const r = readerOver();
  const snow = Buffer.from("{\"t\":\"❄\"}\n");
  r.child.stdout.emit("data", snow.subarray(0, 8));
  r.child.stdout.emit("data", snow.subarray(8));
  r.out("  \n  one  \n\ntwo");
  assert.deepEqual(r.seen.lines, ["{\"t\":\"❄\"}", "one"]);
  r.reader.flush();
  assert.deepEqual(r.seen.lines, ["{\"t\":\"❄\"}", "one", "two"], "the final unterminated line was not handed over at flush");
  assert.equal(r.reader.stdout(), "{\"t\":\"❄\"}\n  \n  one  \n\ntwo");
});

test("each raw chunk is handed over before it is decoded, as it came", () => {
  const got = [];
  const r = readerOver({ onChunk: (d) => got.push(Buffer.from(d)) });
  const snow = Buffer.from("❄\n");
  r.child.stdout.emit("data", snow.subarray(0, 1));
  r.child.stdout.emit("data", snow.subarray(1));
  assert.deepEqual(got.map((b) => b.length), [1, snow.length - 1]);
  assert.deepEqual(r.seen.lines, ["❄"]);
});

test("stderr speaks and moves the stall clock only where the engine says so", () => {
  for (const [stderrSpeaks, stderrIsLiveness] of [[true, true], [true, false], [false, false]]) {
    const r = readerOver({ stderrSpeaks, stderrIsLiveness });
    r.err("a notice\n");
    assert.deepEqual([r.seen.spoken, r.seen.moves], [stderrSpeaks ? 1 : 0, stderrIsLiveness ? 1 : 0], `stderrSpeaks=${stderrSpeaks} stderrIsLiveness=${stderrIsLiveness}`);
    r.out("x\n");
    assert.deepEqual([r.seen.spoken, r.seen.moves], [stderrSpeaks ? 2 : 1, stderrIsLiveness ? 2 : 1], "a stdout byte always speaks and moves");
    r.reader.flush();
    assert.equal(r.reader.stderr(), "a notice\n");
  }
});

test("a long output in short lines overflows only where the whole output is kept and counted", () => {
  const line = `${"x".repeat(99)}\n`;
  const kept = readerOver({ keepStdout: true });
  const notKept = readerOver({ keepStdout: false });
  for (let i = 0; i < 20; i++) { kept.out(line); notKept.out(line); }
  assert.equal(kept.seen.overflows, 1, "the whole output passed the cap and was not an overflow where it is kept");
  assert.equal(notKept.seen.overflows, 0, "an output in short lines was an overflow where only the line buffer is held");
  assert.equal(notKept.seen.lines.length, 20);
  assert.equal(notKept.reader.stdout(), "", "an output that is not kept was kept");
});

test("past the cap the line is cut, the overflow is said once, nothing more is read, and flush parses no truncated tail", () => {
  const r = readerOver();
  r.out("y".repeat(2000));
  r.out("z".repeat(10));
  r.err("late\n");
  assert.equal(r.seen.overflows, 1);
  r.reader.flush();
  assert.deepEqual(r.seen.lines, [], "a truncated tail was parsed");
  assert.equal(r.reader.stderr(), "", "a stream was read after the overflow");
  const e = readerOver();
  e.err("e".repeat(2000));
  assert.equal(e.seen.overflows, 1, "stderr past the cap was not an overflow");
  assert.equal(e.reader.stderr().length, 1024);
});

test("nothing is read once the turn has settled", () => {
  const r = readerOver();
  r.seen.closed = true;
  r.out("after\n");
  r.err("after\n");
  assert.deepEqual([r.seen.lines, r.seen.spoken, r.seen.moves, r.reader.stderr()], [[], 0, 0, ""]);
});

test("a line handler's exception is contained only where the engine says so", () => {
  const thrower = () => { throw new Error("an invented parse failure"); };
  const guarded = readerOver({ onLine: thrower, guardLines: true });
  assert.doesNotThrow(() => guarded.out("a\n"));
  const bare = readerOver({ onLine: thrower, guardLines: false });
  assert.throws(() => bare.out("a\n"), /an invented parse failure/);
});

function withEnv(t, env) {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) pinEnv(process.env, k, v);
  t.after(() => { for (const k of Object.keys(env)) { if (saved[k] === undefined) delete process.env[k]; else pinEnv(process.env, k, saved[k]); } });
}
const CODEX = { CLEAROTRON_CODEX_PATH: join(HERE, "mock-codex.mjs"), CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-invented" };

test("Claude: a program that speaks and then writes only stderr is ended as a stall, because stderr is not its liveness", async (t) => {
  withEnv(t, { CLEAROTRON_CLAUDE_PATH: join(HERE, "mock-claude.mjs"), MOCK_CLAUDE_STDERR_STREAM: "100", MOCK_CLAUDE_STDERR_COUNT: "40",
    CLEAROTRON_STALL_MS: "1500", CLEAROTRON_KILL_ESCALATE_MS: "300" });
  const r = await anthropicAgentEngine.runTurn({ message: "invented task", model: "haiku", thinking: "low", timeoutSec: 60 });
  assert.equal(r.killed, true, "a program writing only stderr was kept alive by it");
  assert.equal(r.signals?.stalled, true);
  assert.match(r.stderr, /mock-claude: a notice 1\n/, "the stderr the program wrote was not kept");
});

test("Claude: a long output in short lines is no overflow; Codex, which keeps its whole output, holds that to the cap", async (t) => {
  withEnv(t, { CLEAROTRON_CLAUDE_PATH: join(HERE, "mock-claude.mjs"), MOCK_CLAUDE_TOKEN_STREAM: "5", MOCK_CLAUDE_TOKEN_COUNT: "60",
    MOCK_CODEX_SLOW_STREAM: "5", MOCK_CODEX_SLOW_COUNT: "60", ...CODEX, CLEAROTRON_ENGINE_MAX_BUFFER: "1024" });
  const claude = await anthropicAgentEngine.runTurn({ message: "invented task", model: "haiku", thinking: "low", timeoutSec: 60 });
  assert.equal(claude.code, 0, `a Claude turn in short lines was failed: ${claude.stderr.slice(-200)}`);
  assert.doesNotMatch(claude.stderr, /output overflow/);
  const codex = await openaiAgentEngine.runTurn({ message: "invented task", model: "haiku", thinking: "low", timeoutSec: 60 });
  assert.notEqual(codex.code, 0, "a Codex output past the cap was accepted");
  assert.match(codex.stderr, /openai-agent output overflow: stdout\/stderr exceeded 1024 chars/);
});
