// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A REFUSED TOOL CALL SAYS WHAT REFUSED IT, AND THE STAGE THAT MADE IT AGAIN SAYS SO.
//
// A settled row with `ok: false` named its reason only on the schema path, and only by the shape of that
// reason could a reader tell a call refused before its tool ran from one the tool rejected. A thrown tool
// and a tool that answered with an error wrote `ok: false` and nothing else. And a stage whose call was
// refused and made again read ok on one attempt, as though nothing had happened.
//
// Now every refused row carries `failure` (schema, threw or server) and a reason that is never the
// message: the missing fields, the error's class, or the complaint's own code. Each engine counts, by tool
// name, the tool-server calls that came back as an error, and the attempt row carries the count.
//
// The first arms drive the real serving wrapper every tool server uses, in a child process, against a run
// directory. Every name here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { anthropicAgentEngine } from "../engine/anthropic-agent.mjs";
import { parseCodexEvent, codexToolServerErrors } from "../engine/openai-agent.mjs";
import { runStage } from "../gateway.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const WRAPPER = pathToFileURL(join(HERE, "..", "engine", "mcp", "stdio-server.mjs")).href;
const REPLAY = join(HERE, "mock-claude-replay.mjs");
const MARK = "LANTERNWICK";

// ── the wrapper, through a server of invented tools ────────────────────────────────────────────────────

const SERVER = `
import { serve } from ${JSON.stringify(WRAPPER)};
serve({ name: "invented", tools: [
  { name: "needs_field", description: "x", inputSchema: { type: "object", required: ["x"], properties: { x: { type: "string" } } }, handler: async () => "ok" },
  { name: "throws", description: "x", inputSchema: { type: "object", properties: {} }, handler: async () => { throw new TypeError("could not read ${MARK}"); } },
  { name: "rejects", description: "x", inputSchema: { type: "object", properties: {} }, handler: async () => ({ isError: true, text: "invented_complaint_code: ${MARK} is not allowed" }) },
  { name: "rejects_in_prose", description: "x", inputSchema: { type: "object", properties: {} }, handler: async () => ({ isError: true, text: "This was refused for ${MARK}" }) },
  { name: "fine", description: "x", inputSchema: { type: "object", properties: {} }, handler: async () => "ok" },
] });
`;

/** Send each call in order to one server process against `runDir`, and resolve once all have answered. */
function callAll(runDir, calls) {
  const file = join(runDir, "invented-server.mjs");
  writeFileSync(file, SERVER);
  return new Promise((resolve, reject) => {
    const p = spawn("node", [file], { stdio: ["pipe", "pipe", "ignore"], env: { ...process.env, CLEAROTRON_BAND_RUN_DIR: runDir } });
    let buf = "";
    const answered = new Set();
    const timer = setTimeout(() => { p.kill(); reject(new Error("the server did not answer every call — could not look")); }, 20000);
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
    p.stdout.on("data", (d) => {
      buf += d;
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (Number(m?.id) >= 10) answered.add(m.id);
      }
      if (answered.size === calls.length) { clearTimeout(timer); p.kill(); resolve(); }
    });
    const send = (o) => p.stdin.write(JSON.stringify(o) + "\n");
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "arm", version: "0" } } });
    calls.forEach(([name, args], i) => send({ jsonrpc: "2.0", id: 10 + i, method: "tools/call", params: { name, arguments: args } }));
  });
}

const settledRows = (runDir) => {
  const p = driverDir(runDir, "tool-calls.jsonl");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.event === "settled");
};

test("every refused call names what refused it, and none carries the tool's message", async () => {
  const runDir = mkdtempSync(join(tmpdir(), "refused-call-"));
  try {
    await callAll(runDir, [["needs_field", {}], ["throws", {}], ["rejects", {}], ["rejects_in_prose", {}]]);
    const byTool = Object.fromEntries(settledRows(runDir).map((r) => [r.tool, r]));
    assert.deepEqual(Object.keys(byTool).sort(), ["needs_field", "rejects", "rejects_in_prose", "throws"], "precondition: every call settled");
    for (const r of Object.values(byTool)) assert.equal(r.ok, false);
    assert.deepEqual([byTool.needs_field.failure, byTool.needs_field.reason], ["schema", "missing_required:x"],
      "a call refused before its tool ran says so");
    assert.deepEqual([byTool.throws.failure, byTool.throws.reason], ["threw", "threw:TypeError"]);
    assert.deepEqual([byTool.rejects.failure, byTool.rejects.reason], ["server", "invented_complaint_code"],
      "a call the tool rejected says so, with the complaint's own code");
    assert.equal(byTool.rejects_in_prose.failure, "server");
    assert.equal("reason" in byTool.rejects_in_prose, false, "a complaint that opens in prose leaves no reason rather than copying the prose");
    assert.ok(!JSON.stringify(settledRows(runDir)).includes(MARK), "a tool's message, and the mark it quoted, reached the row");
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

test("THE CONTROL: an accepted call settles ok, with no failure and no reason", async () => {
  const runDir = mkdtempSync(join(tmpdir(), "accepted-call-"));
  try {
    await callAll(runDir, [["fine", {}], ["needs_field", { x: "y" }]]);
    const rows = settledRows(runDir);
    assert.equal(rows.length, 2);
    for (const r of rows) {
      assert.equal(r.ok, true);
      assert.equal("failure" in r, false, "an accepted call carries a failure field, so it says something about every call");
      assert.equal("reason" in r, false);
    }
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

// ── the stage that made the call again, on both engines ────────────────────────────────────────────────

const init = () => ({ type: "system", subtype: "init", model: "claude-opus-5-5", session_id: "s-1" });
const ask = (id, name) => ({ type: "assistant", message: { id, model: "claude-opus-5-5", content: [{ type: "tool_use", id: `${id}-0`, name, input: {} }] } });
const answerOf = (id, isError) => ({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: `${id}-0`, is_error: isError, content: isError ? "invented_complaint_code: refused" : "accepted" }] } });
const result = () => ({ type: "result", subtype: "success", is_error: false, stop_reason: "end_turn", terminal_reason: "completed", result_index: 0,
  result: "an invented answer", session_id: "s-1", usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
const FRAME = "mcp__recording__record_invented_frame";
// The call refused once and made again, beside a built-in tool that also came back as an error: only the
// tool server's refusal is counted.
const REFUSED_AND_REMADE = [init(), ask("m1", FRAME), answerOf("m1", true), ask("m2", "Read"), answerOf("m2", true),
  ask("m3", FRAME), answerOf("m3", false), result()];
const ACCEPTED_FIRST_TIME = [init(), ask("m1", FRAME), answerOf("m1", false), result()];

function replayFile(dir, events) { const p = join(dir, "replay.jsonl"); writeFileSync(p, events.map((e) => JSON.stringify(e)).join("\n") + "\n"); return p; }

async function stageRow(events) {
  const dir = mkdtempSync(join(tmpdir(), "remade-call-"));
  const out = join(dir, "out.md");
  const saved = { ai: process.env.CLEAROTRON_AI, path: process.env.CLEAROTRON_CLAUDE_PATH, replay: process.env.MOCK_CLAUDE_REPLAY, write: process.env.MOCK_CLAUDE_REPLAY_WRITE };
  process.env.CLEAROTRON_AI = "anthropic-agent";
  pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", REPLAY);
  process.env.MOCK_CLAUDE_REPLAY = replayFile(dir, events);
  process.env.MOCK_CLAUDE_REPLAY_WRITE = out;
  try {
    const r = await runStage("teststage", {
      agent: "mailagent", sessionKey: "clearotron-test-abc-remadecall", runDir: dir,
      message: `Do the invented task. Write to the ABSOLUTE path for the stage output: ${out}`,
      model: "opus", thinking: "high", timeoutSec: 60, expectFile: out, validate: () => ({ ok: true }),
    });
    const rows = readFileSync(join(dir, "_driver", "teststage.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    return { r, row: rows.at(-1) };
  } finally {
    for (const [k, v] of [["CLEAROTRON_AI", saved.ai], ["MOCK_CLAUDE_REPLAY", saved.replay], ["MOCK_CLAUDE_REPLAY_WRITE", saved.write]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", saved.path);
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a stage whose tool-server call was refused and made again says so on its attempt row", async () => {
  const { r, row } = await stageRow(REFUSED_AND_REMADE);
  assert.equal(r.ok, true, "premise: the stage delivered on its one attempt");
  assert.equal(row.attempt, 1);
  assert.deepEqual(row.toolCallsErroredByName, { [FRAME]: 1 },
    "the row read ok on one attempt and said nothing of the refused call");
  assert.deepEqual(row.toolCallsByName, { [FRAME]: 2, Read: 1 }, "both calls were made");
});

test("THE CONTROL: a stage whose call was accepted the first time counts none", async () => {
  const { row } = await stageRow(ACCEPTED_FIRST_TIME);
  assert.deepEqual(row.toolCallsErroredByName, {}, "a measurement of none, never a missing field");
});

test("the Claude turn reports the same count, and a call the program refused itself is not counted again", async () => {
  const dir = mkdtempSync(join(tmpdir(), "remade-turn-"));
  const saved = { path: process.env.CLEAROTRON_CLAUDE_PATH, replay: process.env.MOCK_CLAUDE_REPLAY };
  pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", REPLAY);
  const denied = [...REFUSED_AND_REMADE.slice(0, -1), { ...result(), permission_denials: [{ tool_name: FRAME, tool_use_id: "m1-0", tool_input: {} }] }];
  process.env.MOCK_CLAUDE_REPLAY = replayFile(dir, denied);
  try {
    const t = await anthropicAgentEngine.runTurn({ message: "invented task", model: "opus", thinking: "high", timeoutSec: 60 });
    assert.equal(t.toolCallsRefused, 1);
    assert.deepEqual(t.toolCallsErroredByName, {}, "the program's own refusal was counted twice");
  } finally {
    pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", saved.path);
    if (saved.replay === undefined) delete process.env.MOCK_CLAUDE_REPLAY; else process.env.MOCK_CLAUDE_REPLAY = saved.replay;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Codex counts a call that reached its server and failed there, and not one it refused itself", () => {
  const ev = { mcpCalls: new Map() };
  const lines = [
    { type: "item.completed", item: { id: "i1", type: "mcp_tool_call", server: "recording", tool: "record_invented_frame", status: "failed", error: null } },
    { type: "item.completed", item: { id: "i2", type: "mcp_tool_call", server: "recording", tool: "record_invented_frame", status: "completed" } },
    { type: "item.completed", item: { id: "i3", type: "mcp_tool_call", server: "owners", tool: "owner_table", status: "failed", error: { message: "MCP tool call requires approval" } } },
  ];
  for (const e of lines) parseCodexEvent(JSON.stringify(e), ev);
  assert.deepEqual(codexToolServerErrors(ev), { [FRAME]: 1 }, "the refused-and-remade call is counted once, the program's own refusal not at all");
  assert.deepEqual(codexToolServerErrors({ mcpCalls: new Map() }), {}, "THE CONTROL: none failed, a measurement of none");
});
