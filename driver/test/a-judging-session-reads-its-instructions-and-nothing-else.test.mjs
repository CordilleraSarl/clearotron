// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The judging step's session is confined: its instructions are the stage's and nothing else, its tools are
// the ones its stage is granted plus the program's own helper tool, and it answers in a form the driver
// writes to the stage's output. A failed attempt runs again on a fresh session with the same message.
// Driven through both engines' own builders and readers, on invented streams in the programs' shapes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { anthropicAgentEngine, buildClaudeArgs, newConfinedAnswer, noteConfinedAnswer, confinedAnswerFields } from "../engine/anthropic-agent.mjs";
import { buildConfinedCodexArgs, codexConfinedAnswer } from "../engine/openai-agent.mjs";
import { renderConfinedCodexConfigToml, CONFINED_FEATURES_OFF } from "../engine/mcp/codex-config.mjs";
import { runStage, writeConfinedAnswer } from "../gateway.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPLAY = join(HERE, "mock-claude-replay.mjs");

const CONFINED = Object.freeze({
  instructions: "You answer an invented question. Use the tools.",
  answerForm: { type: "object", additionalProperties: false, required: ["verdict"], properties: { verdict: { type: "string" } } },
});
const GRANT = "Read Write Edit mcp__owners__owner_table mcp__owners__register_open";
const MCP = JSON.stringify({ mcpServers: { owners: { command: "/usr/bin/node", args: ["/invented/owner-server.mjs"], env: { CLEAROTRON_BAND_RUN_DIR: "/invented/run" } } } });

const flag = (args, name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };

// ── invented stream events, in the program's shapes ─────────────────────────────────────────────────
const init = () => ({ type: "system", subtype: "init", model: "claude-opus-5-5", session_id: "s-1" });
const said = (id) => ({ type: "assistant", message: { id, model: "claude-opus-5-5", content: [{ type: "text", text: "invented" }] } });
const result = (index, { isError = false, answer = undefined, stopReason = "end_turn" } = {}) => ({
  type: "result", subtype: "success", is_error: isError, stop_reason: stopReason, result_index: index, result: "invented", session_id: "s-1",
  ...(answer !== undefined ? { structured_output: answer } : {}),
  usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
});
const REFUSED_THEN_ANSWERED = [init(), said("m1"), result(0, { isError: true, stopReason: "refusal" }), init(), result(1, { answer: { verdict: "first" } }), init(), said("m2"), result(2, { answer: { verdict: "settled" } })];
const ENDED_ON_AN_ERROR = [init(), said("m1"), result(0, { isError: true, stopReason: "refusal" })];
const NO_ANSWER = [init(), said("m1"), result(0)];

function scratch() { return mkdtempSync(join(tmpdir(), "confined-")); }
const writeStream = (path, events) => { writeFileSync(path, events.map((e) => JSON.stringify(e)).join("\n") + "\n"); return path; };

function withReplay(env, fn) {
  const keys = ["CLEAROTRON_AI", "CLEAROTRON_RETRY_BACKOFF_MS", "MOCK_CLAUDE_REPLAY", "MOCK_CLAUDE_REPLAY_LOG", "MOCK_CLAUDE_REPLAY_WRITE"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const savedPath = process.env.CLEAROTRON_CLAUDE_PATH;
  pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", REPLAY);
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  return Promise.resolve(fn()).finally(() => {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", savedPath);
  });
}

test("claude: the session's instructions are the stage's whole instructions, and only the helper tool is the program's", () => {
  const { args, input, grantNote } = buildClaudeArgs({ message: "the invented message", model: "opus", thinking: "high", mcpConfig: "/invented/mcp.json",
    allowedTools: GRANT, runDir: "/invented/run", skillsDir: "/invented/skills", resumeRef: "s-old", confined: CONFINED });
  assert.equal(input, "the invented message", "the message goes as it was composed, nothing rewritten into it");
  assert.equal(flag(args, "--system-prompt"), CONFINED.instructions);
  assert.ok(!args.includes("--append-system-prompt"), "nothing is added to the instructions, the write discipline included");
  assert.equal(flag(args, "--tools"), "Agent", "of the program's own tools, only the one that starts a helper");
  assert.equal(flag(args, "--setting-sources"), "", "none of the machine's own settings, hooks or memory files");
  assert.ok(args.includes("--disable-slash-commands"));
  assert.deepEqual(JSON.parse(flag(args, "--json-schema")), CONFINED.answerForm);
  assert.deepEqual(flag(args, "--allowedTools").split(","), ["mcp__owners__owner_table", "mcp__owners__register_open", "Agent"], "no file tool is listed, the helper is");
  assert.equal(flag(args, "--permission-mode"), "dontAsk");
  assert.match(flag(args, "--disallowedTools"), /\bBash\b/, "the command tools stay removed");
  assert.ok(!args.includes("--add-dir"), "no folder is granted: there is no file tool to use one");
  assert.ok(!args.includes("--resume"), "a confined session is never resumed");
  assert.deepEqual(JSON.parse(flag(args, "--settings")), { permissions: { blockReadsOutsideWorkingDirectories: true } }, "the read fence rides every turn");
  assert.equal(grantNote, null);
  assert.throws(() => buildClaudeArgs({ message: "m", confined: { answerForm: {} } }), /instructions/);
  assert.throws(() => buildClaudeArgs({ message: "m", confined: { instructions: "x" } }), /answer form/);
});

test("claude: the answer is the last result without an error that carried one, and which result that was", async () => {
  const dir = scratch();
  try {
    const log = join(dir, "calls.jsonl");
    const r = await withReplay({ MOCK_CLAUDE_REPLAY: writeStream(join(dir, "s.jsonl"), REFUSED_THEN_ANSWERED), MOCK_CLAUDE_REPLAY_LOG: log }, () =>
      anthropicAgentEngine.runTurn({ message: "the invented message", model: "opus", thinking: "high", timeoutSec: 60, resumeRef: "s-old", allowedTools: GRANT, confined: CONFINED }));
    assert.deepEqual(r.structuredOutput, { verdict: "settled" });
    assert.equal(r.structuredOutputIndex, 2);
    assert.equal(r.structuredOutputWhy, null);
    const call = JSON.parse(readFileSync(log, "utf8").trim());
    assert.equal(call.stdin, "the invented message");
    assert.ok(!call.argv.includes("--resume"), "the resume handle a caller passes is dropped");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("claude: no answer is said, with why — and an ordinary turn carries no answer fields at all", async () => {
  const dir = scratch();
  try {
    const run = (events, confined) => withReplay({ MOCK_CLAUDE_REPLAY: writeStream(join(dir, "s.jsonl"), events) }, () =>
      anthropicAgentEngine.runTurn({ message: "m", model: "opus", thinking: "high", timeoutSec: 60, ...(confined ? { confined } : {}) }));
    const refused = await run(ENDED_ON_AN_ERROR, CONFINED);
    assert.equal(refused.structuredOutput, null);
    assert.match(refused.structuredOutputWhy, /^the session ended on an error \(success, refusal\)$/);
    const silent = await run(NO_ANSWER, CONFINED);
    assert.equal(silent.structuredOutputWhy, "the session finished without an answer in its form");
    const ordinary = await run(REFUSED_THEN_ANSWERED, null);
    for (const k of ["structuredOutput", "structuredOutputIndex", "structuredOutputWhy"]) assert.ok(!(k in ordinary), `an ordinary turn carries no ${k}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  // the fold on its own: an array or an error result never stands as the answer
  const a = newConfinedAnswer();
  noteConfinedAnswer(a, { type: "result", is_error: false, structured_output: [1] });
  noteConfinedAnswer(a, { type: "result", is_error: true, structured_output: { verdict: "x" } });
  assert.equal(confinedAnswerFields(a, null).structuredOutputWhy, "the session finished without an answer in its form");
  assert.equal(confinedAnswerFields(newConfinedAnswer(), null).structuredOutputWhy, "the session ended without a result");
});

test("codex: the instructions replace the program's own, the helper is the one feature left on, and the answer is the last message", () => {
  const toml = renderConfinedCodexConfigToml({ instructionsFile: "/invented/home/instructions.md", mcpConfig: MCP, allowedTools: GRANT, toolTimeoutSec: 1800 });
  assert.match(toml, /^model_instructions_file = "\/invented\/home\/instructions\.md"$/m);
  assert.match(toml, /^web_search = "disabled"$/m);
  assert.match(toml, /^project_doc_max_bytes = 0$/m);
  assert.match(toml, /^tool_output_token_limit = 60000$/m);
  for (const f of CONFINED_FEATURES_OFF) assert.match(toml, new RegExp(`^${f} = false$`, "m"));
  assert.match(toml, /^multi_agent = true$/m);
  assert.ok(!/developer_instructions|default_permissions|shell_environment_policy/.test(toml), "no added instructions, no permission profile, no command filters");
  assert.equal((toml.match(/^\[features\]$/gm) ?? []).length, 1, "one features table, or codex refuses the file");
  assert.match(toml, /^enabled_tools = \["owner_table", "register_open"\]$/m);
  assert.ok(toml.indexOf("model_instructions_file") < toml.indexOf("["), "the top-level keys come before the first table");

  const { args } = buildConfinedCodexArgs({ model: "opus", thinking: "high", schemaFile: "/invented/home/answer-form.json", lastMessageFile: "/invented/home/answer.json" });
  assert.deepEqual(args.slice(0, 6), ["exec", "--json", "--skip-git-repo-check", "--ignore-rules", "--sandbox", "read-only"]);
  assert.equal(flag(args, "--output-schema"), "/invented/home/answer-form.json");
  assert.equal(flag(args, "-o"), "/invented/home/answer.json");
  assert.ok(!args.includes("resume") && !args.includes("--add-dir") && !args.includes("--dangerously-bypass-approvals-and-sandbox"));
  assert.equal(args.at(-1), "-", "the message on stdin");

  const dir = scratch();
  try {
    const file = join(dir, "answer.json");
    const ev = (results) => ({ session: { results } });
    assert.equal(codexConfinedAnswer(file, ev([])).structuredOutputWhy, "the session ended without a result");
    assert.equal(codexConfinedAnswer(file, ev([{ isError: true, subtype: "turn.failed" }])).structuredOutputWhy, "the session ended on an error (turn.failed)");
    writeFileSync(file, "not an answer");
    assert.equal(codexConfinedAnswer(file, ev([{ isError: false }])).structuredOutputWhy, "the session's last message was not an answer in its form");
    writeFileSync(file, JSON.stringify({ verdict: "settled" }));
    assert.deepEqual(codexConfinedAnswer(file, ev([{ isError: false }])), { structuredOutput: { verdict: "settled" }, structuredOutputIndex: 0, structuredOutputWhy: null });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("through the gateway: a failed attempt runs again fresh on the same message, and the answer lands where the stage reads it", async () => {
  const dir = scratch();
  const out = join(dir, "_driver", "judgment-1.json");
  const log = join(dir, "calls.jsonl");
  writeStream(join(dir, "s1.jsonl"), ENDED_ON_AN_ERROR);
  writeStream(join(dir, "s2.jsonl"), REFUSED_THEN_ANSWERED);
  try {
    const seen = [];
    const r = await withReplay({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_RETRY_BACKOFF_MS: "0", MOCK_CLAUDE_REPLAY: join(dir, "s{n}.jsonl"), MOCK_CLAUDE_REPLAY_LOG: log }, () => runStage("teststage", {
      agent: "mailagent", sessionKey: "clearotron-test-abc-confined", runDir: dir,
      message: "The invented message, exactly as composed.",
      model: "opus", thinking: "high", timeoutSec: 60, expectFile: out, confined: CONFINED,
      validate: (file) => { seen.push(existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null); return { ok: true }; },
    }));
    assert.equal(r.ok, true);
    const calls = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(calls.length, 2, "the first session answered nothing, so a second ran");
    assert.equal(calls[1].stdin, calls[0].stdin, "the same message: no corrective text, no warm patch");
    assert.equal(calls[0].stdin, "The invented message, exactly as composed.");
    assert.ok(!calls[1].argv.includes("--resume"), "a fresh session, never the failed one resumed");
    assert.deepEqual(JSON.parse(readFileSync(out, "utf8")), { verdict: "settled" }, "the driver wrote the session's answer to the stage's output");
    assert.deepEqual(seen.at(-1), { verdict: "settled" }, "the validator read the written answer");
    const rows = readFileSync(join(dir, "_driver", "teststage.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(rows[0].answer.written, false);
    assert.match(rows[0].answer.why, /ended on an error/);
    assert.deepEqual(rows.at(-1).answer, { written: true, resultIndex: 2 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an earlier attempt's answer never stands in for a later attempt that returned none", () => {
  const dir = scratch();
  try {
    const file = join(dir, "_driver", "answer.json");
    assert.deepEqual(writeConfinedAnswer(file, { structuredOutput: { verdict: "x" }, structuredOutputIndex: 0 }), { written: true, resultIndex: 0 });
    assert.deepEqual(writeConfinedAnswer(file, { structuredOutput: null, structuredOutputWhy: "the session ended without a result" }), { written: false, why: "the session ended without a result" });
    assert.deepEqual(writeConfinedAnswer(file, { structuredOutput: [1, 2] }), { written: false, why: "the session returned no answer in its form" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
