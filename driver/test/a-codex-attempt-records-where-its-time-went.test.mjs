// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A Codex attempt recorded no start-up, tool-wait or active time, so a Codex turn could not be split into the engine
// starting, the model working and its tools running. Its stream says when each tool item opens and closes; read with
// each line's arrival time, it now gives the fields the Anthropic engine gives, with the same meanings. These arms feed
// recorded-shape stream lines at chosen times, so no program runs and no model is called.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCodexEvent, codexTiming } from "../engine/openai-agent.mjs";

const line = (type, item) => JSON.stringify({ type, item });
const cmd = (id, status) => ({ id, type: "command_execution", command: "/bin/bash -lc 'cat x'", status });
const mcp = (id, status) => ({ id, type: "mcp_tool_call", server: "register", tool: "search", status });

/** Feed `[atMs, line]` pairs into a timed accumulator and settle it at `wallMs`. */
function settle(lines, wallMs) {
  const ev = { timed: true };
  for (const [at, l] of lines) parseCodexEvent(l, ev, at);
  const { lastToolAsk, ...timing } = codexTiming(ev, wallMs);   // the last asks have an arm of their own, below
  return timing;
}

test("tool wait is the time some tool item was open, and active time is the rest of the wall", () => {
  const t = settle([
    [400, JSON.stringify({ type: "thread.started", thread_id: "t" })],
    [1_000, line("item.started", cmd("i1", "in_progress"))],
    [3_500, line("item.completed", cmd("i1", "completed"))],
    [5_000, line("item.started", mcp("i2", "in_progress"))],
    [9_000, line("item.completed", mcp("i2", "completed"))],
    [9_500, line("item.completed", { id: "m", type: "agent_message", text: "done" })],
  ], 10_000);
  assert.deepEqual(t, { firstByteMs: 400, toolWaitMs: 6_500, activeMs: 3_500,
    toolWaitByTool: { command_execution: 2_500, mcp__register__search: 4_000 } });
});

test("two items open at once count their overlap once in the total, and in full under each name", () => {
  const t = settle([
    [100, line("item.started", cmd("a", "in_progress"))],
    [200, line("item.started", mcp("b", "in_progress"))],
    [1_100, line("item.completed", cmd("a", "completed"))],
    [1_200, line("item.completed", mcp("b", "completed"))],
  ], 2_000);
  assert.equal(t.toolWaitMs, 1_100, "the overlap was counted twice");
  assert.deepEqual(t.toolWaitByTool, { command_execution: 1_000, mcp__register__search: 1_000 });
  assert.equal(t.toolWaitMs + t.activeMs, 2_000, "tool wait and active time do not tile the wall");
});

test("an item still open when the turn ended counts up to the end, and is charged to no name", () => {
  const t = settle([
    [50, line("item.started", cmd("a", "in_progress"))],
    [550, line("item.completed", cmd("a", "completed"))],
    [3_000, line("item.started", mcp("b", "in_progress"))],
  ], 8_000);
  assert.equal(t.toolWaitMs, 500 + 5_000);
  assert.equal(t.activeMs, 2_500);
  assert.deepEqual(t.toolWaitByTool, { command_execution: 500 });
});

test("a timed turn that called no tool reads 0 and {}; an untimed one reads null, which is not zero", () => {
  assert.deepEqual(settle([[700, line("item.completed", { id: "m", type: "agent_message", text: "x" })]], 4_000),
    { firstByteMs: 700, toolWaitMs: 0, activeMs: 4_000, toolWaitByTool: {} });
  assert.deepEqual(settle([], 4_000), { firstByteMs: null, toolWaitMs: 0, activeMs: 4_000, toolWaitByTool: {} },
    "a child that never spoke has no first byte, and its wall is still measured");
  const untimed = {};
  parseCodexEvent(line("item.started", cmd("a", "in_progress")), untimed);
  parseCodexEvent(line("item.completed", cmd("a", "completed")), untimed);
  assert.deepEqual(codexTiming(untimed, 4_000), { firstByteMs: null, toolWaitMs: null, activeMs: null, toolWaitByTool: null, lastToolAsk: null });
});

test("a line that is not JSON is still the child speaking, and an item seen only complete is a call with no wait", () => {
  const t = settle([
    [90, "codex: starting"],
    [500, line("item.completed", cmd("x", "completed"))],
  ], 1_000);
  assert.equal(t.firstByteMs, 90);
  assert.equal(t.toolWaitMs, 0);
  assert.deepEqual(t.toolWaitByTool, { command_execution: 0 });
});

test("the last tool asked for and the last record write are kept apart, so a kill can be read as working or finishing", () => {
  const ev = { timed: true };
  const rec = (id, status) => ({ id, type: "mcp_tool_call", server: "recording-synthesis", tool: "record_synthesis", status });
  for (const [at, l] of [
    [1_000, line("item.started", cmd("a", "in_progress"))],
    [2_000, line("item.completed", cmd("a", "completed"))],
    [9_000, line("item.started", rec("r", "in_progress"))],
  ]) parseCodexEvent(l, ev, at);
  assert.deepEqual(codexTiming(ev, 10_000).lastToolAsk, { workMs: 1_000, recordMs: 9_000 });
  assert.deepEqual(codexTiming({ timed: true }, 10_000).lastToolAsk, { workMs: null, recordMs: null }, "a turn that asked for no tool");
});
