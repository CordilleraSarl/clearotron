// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — three MCP tool calls were refused in one turn and the driver recorded
// `toolCalls: null`, which reads as "made none". This file is about that RECORDING gap, and it holds
// whatever turns out to have caused the refusals.
//
// ✕ DO NOT READ A CAUSE OUT OF THIS FILE. "Codex cannot call any MCP tool" was WITHDRAWN on 1968 by the
// lane that filed it, the same day: real codex completed 1,292 MCP tool calls across three pre-rebuild
// runs, and none since the 2026-08-24 rebuild. What differentiates those two states is OPEN — the
// candidates are the missing bypass, the replay path and something else the rebuild changed — and the
// trace belongs to.
//
// What IS settled is the shape of the record, and it is the only thing this file asserts: a refusal
// exists solely inside the child's rollout, in a temp dir the adapter deletes, while the turn exits 0
// with engineStatus `ok` and engineSummary `success`. A stage that ran without its tools and a stage
// that never reached for them wrote the same row. That is what the gauge below ends.
//
// THE FIXTURES BELOW ARE REAL CODEX OUTPUT, not lines composed to match the parser. Captured
// 2026-08-27 on the test box from codex-cli 0.150.1 against a one-tool MCP probe server whose reply
// carries a sentinel (`pong-9f3a`) that only it can produce — so a "completed" reading cannot be the
// model having invented an answer. Composing a fixture from the parser's own expectations is how a
// parser comes to pass on a shape the tool never emits.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCodexEvent, mcpToolGauge, noteMcpToolCall } from "../engine/openai-agent.mjs";

/** codex-cli 0.150.1, today's `buildCodexArgs`: `--sandbox workspace-write`, no approval policy. */
const REFUSED = [
  `{"type":"item.started","item":{"id":"item_1","type":"mcp_tool_call","server":"probe","tool":"ping","arguments":{},"result":null,"error":null,"status":"in_progress"}}`,
  `{"type":"item.completed","item":{"id":"item_1","type":"mcp_tool_call","server":"probe","tool":"ping","arguments":{},"result":null,"error":{"message":"MCP tool call requires approval, but approval policy is never"},"status":"failed"}}`,
];

/** The same probe under `codex exec --approve-for-me` — the call goes through and returns the sentinel. */
const COMPLETED = [
  `{"type":"item.started","item":{"id":"item_1","type":"mcp_tool_call","server":"probe","tool":"ping","arguments":{},"result":null,"error":null,"status":"in_progress"}}`,
  `{"type":"item.completed","item":{"id":"item_1","type":"mcp_tool_call","server":"probe","tool":"ping","arguments":{},"result":{"content":[{"type":"text","text":"pong-9f3a"}],"structured_content":null},"error":null,"status":"completed"}}`,
];

const fold = (lines) => {
  const ev = { mcpCalls: new Map() };
  for (const l of lines) parseCodexEvent(l, ev);
  return mcpToolGauge(ev);
};

test("1968 a refused call and a turn that called nothing are different records", () => {
  const refused = fold(REFUSED);
  const nothing = fold([`{"type":"turn.completed"}`]);

  // THE WHOLE ISSUE, IN ONE COMPARISON. Before this, both of these produced the same row.
  assert.notDeepEqual(refused, nothing,
    "a turn whose every tool call was refused now records identically to a turn that called none — "
    + "which is the state this issue was filed about, and it is invisible at every level a reader checks");

  assert.equal(refused.mcpToolCalls, 0, "nothing completed");
  assert.equal(refused.mcpToolCallsRefused, 1, "…and one call was refused, which is the fact that was lost");
  assert.equal(nothing.mcpToolCallsRefused, 0);
});

test("1968 the refusal carries WHY, taken from the stream and never pattern-matched", () => {
  const { mcpToolCallRefusals } = fold(REFUSED);
  assert.deepEqual(mcpToolCallRefusals, [{
    server: "probe", tool: "ping",
    message: "MCP tool call requires approval, but approval policy is never",
  }], "the row must name the server, the tool and the reason codex gave");

  // A policy refusal and a denial by an automatic reviewer are BOTH `failed`, with different text.
  // A predicate over the approval wording would collapse them and answer only for the one that existed
  // the day it was written — so the message is recorded verbatim rather than classified here.
  const denied = fold([REFUSED[0],
    `{"type":"item.completed","item":{"id":"item_1","type":"mcp_tool_call","server":"band","tool":"band_shape","result":null,"error":{"message":"denied by automatic review: high risk, weak authorization"},"status":"failed"}}`]);
  assert.equal(denied.mcpToolCallsRefused, 1, "a reviewer denial is a refusal too");
  assert.match(denied.mcpToolCallRefusals[0].message, /automatic review/,
    "…and its own reason survives, rather than being reported as the approval-policy one");
});

test("1968 a tool that RAN and errored is not a refusal", () => {
  // ✕ THE DISTINCTION THE WHOLE ISSUE IS ABOUT, and the first cut of this gauge could not draw it.
  // Measured against our own band server: a call refused by the approval policy carries
  // `error.message`; a call that reached the server and whose tool errored carries `error: null` and
  // the tool's own text in `result`. Counting every non-completed call as refused would report a band
  // tool complaining about its own missing run dir as an approval problem, and send the next reader to
  // the engine instead of to the fixture.
  const toolErrored = fold([`{"type":"item.completed","item":{"id":"item_1","type":"mcp_tool_call","server":"band","tool":"band_shape","error":null,"result":{"content":[{"type":"text","text":"ERROR: CLEAROTRON_BAND_RUN_DIR not set — band tools are wired per run by the driver."}]},"status":"failed"}}`]);
  assert.equal(toolErrored.mcpToolCallsRefused, 0,
    "the call reached the server and the tool answered — that is not the approval gate, and reporting "
    + "it as one would blame the engine for a fixture fault");
  assert.equal(toolErrored.mcpToolCalls, 0, "…and it did not complete either — it is neither");

  // The control: the same status, WITH an error message, is a refusal.
  assert.equal(fold(REFUSED).mcpToolCallsRefused, 1);
});

test("1968 a completed call is counted once, not twice", () => {
  // Items arrive TWICE with the same id — `in_progress` on item.started, then a terminal status on
  // item.completed. Counting lines instead of keying by id doubles every call, and the inflated number
  // would have looked like the fix working harder.
  const g = fold(COMPLETED);
  assert.equal(g.mcpToolCalls, 1, `two stream lines, one call — got ${g.mcpToolCalls}`);
  assert.equal(g.mcpToolCallsRefused, 0);
  assert.deepEqual(g.mcpToolCallRefusals, []);
});

test("1968 an in-flight call is neither completed nor refused", () => {
  // The turn was killed mid-call. `in_progress` is not a refusal: reporting it as one would invent
  // failures on every hard-wall kill, and this gauge is what a reader would use to blame the engine.
  const g = fold([REFUSED[0]]);
  assert.equal(g.mcpToolCalls, 0);
  assert.equal(g.mcpToolCallsRefused, 0, "an unfinished call is unknown, not refused");
});

test("1968 the refusal list is bounded, and the count still says how many there were", () => {
  const many = [];
  for (let i = 1; i <= 9; i++) {
    many.push(`{"type":"item.completed","item":{"id":"item_${i}","type":"mcp_tool_call","server":"band","tool":"band_shape","result":null,"error":{"message":"MCP tool call requires approval, but approval policy is never"},"status":"failed"}}`);
  }
  const g = fold(many);
  assert.equal(g.mcpToolCallsRefused, 9, "the COUNT is complete — a row that truncates its own total is a lie");
  assert.equal(g.mcpToolCallRefusals.length, 5, "the list is capped: a row is not a log");
});

test("1968 the gauge is unconditional, so an absence cannot be told from a record that predates it", () => {
  // The house rule for every gauge on this row. An engine that made no MCP calls writes zeros; it does
  // not omit the fields, because an omitted field and an old record are the same bytes.
  const g = fold([`{"type":"turn.completed"}`]);
  for (const k of ["mcpToolCalls", "mcpToolCallsRefused", "mcpToolCallRefusals"]) {
    assert.ok(k in g, `${k} must be written even when there is nothing to report`);
  }
  // And a non-mcp item must not land in it — noteMcpToolCall keys on the item type, not on presence.
  const ev = { mcpCalls: new Map() };
  noteMcpToolCall({ id: "x", type: "agent_message", text: "hello" }, ev);
  assert.equal(ev.mcpCalls.size, 0, "an agent_message is not a tool call");
});
