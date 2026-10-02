// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A model session the vendor's classifier cut off, or refused and a restart recovered, ended in an
// ordinary successful result and was recorded as a clean session: the engine kept only the last result.
// These arms drive invented streams through the engine's own reader, in the event shapes the program
// writes (read off a saved bench stream, 2026-09-30, with every word of content left out):
//   · a cut the session carried on from,
//   · a refusal that ended the session,
//   · a refusal a helper's restart recovered, ending in a successful last result,
// and check each is on the turn, on the attempt row and in the run's raw stream file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { anthropicAgentEngine } from "../engine/anthropic-agent.mjs";
import { parseCodexEvent, codexToolCallsByName, openaiAgentEngine } from "../engine/openai-agent.mjs";
import { newSessionRecord, noteClaudeEvent, noteCodexEvent, sessionSummary, streamSink, CLASSIFIER_CUT_RE } from "../engine/session-record.mjs";
import * as sessionRecord from "../engine/session-record.mjs";   // the ending helpers, read by name so an arm reds alone when one is missing
import { runStage, attemptOk } from "../gateway.mjs";
import { lastAttempt } from "../degraded-parts.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPLAY = join(HERE, "mock-claude-replay.mjs");

// ── invented stream events, in the program's shapes ─────────────────────────────────────────────────
const init = () => ({ type: "system", subtype: "init", model: "claude-opus-5-5", session_id: "s-1" });
const toolAsk = (id, ...names) => ({ type: "assistant", message: { id, model: "claude-opus-5-5", content: names.map((name, i) => ({ type: "tool_use", id: `${id}-${i}`, name, input: {} })) } });
const toolResult = (id, n) => ({ type: "user", message: { role: "user", content: Array.from({ length: n }, (_, i) => ({ type: "tool_result", tool_use_id: `${id}-${i}`, content: "invented answer" })) } });
const cut = () => ({ type: "user", isSynthetic: true, message: { role: "user", content: [{ type: "text", text: "Your response above was stopped by a safety classifier — this is not a tool or API error. The rest of it was withheld." }] } });
const refusalNotice = () => ({ type: "system", subtype: "model_refusal_no_fallback", original_model: "claude-opus-5-5", api_refusal_category: "reasoning_extraction", api_refusal_explanation: "invented explanation", content: "" });
const refusalStop = () => ({ type: "assistant", error: "invalid_request", is_api_error_message: true, message: { id: "m-refused", model: "claude-opus-5-5", stop_reason: "refusal", content: [{ type: "text", text: "invented" }] } });
const answer = (id) => ({ type: "assistant", message: { id, model: "claude-opus-5-5", content: [{ type: "text", text: "an invented answer" }] } });
const result = (index, { isError = false, stopReason = "end_turn", terminal = "completed", origin = null } = {}) => ({
  type: "result", subtype: "success", is_error: isError, stop_reason: stopReason, terminal_reason: terminal, result_index: index,
  ...(origin ? { origin: { kind: origin } } : {}), result: "an invented answer", session_id: "s-1",
  usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
});
const helperDone = () => ({ type: "system", subtype: "task_notification", task_id: "t-1", status: "completed" });

const CUT_AND_CARRIED_ON = [init(), toolAsk("m1", "mcp__band__band_lookup", "Read"), toolResult("m1", 2), cut(), answer("m2"), result(0)];
const REFUSED = [init(), toolAsk("m1", "Read"), toolResult("m1", 1), refusalNotice(), refusalStop(), result(0, { isError: true, stopReason: "refusal", terminal: "api_error" })];
const REFUSED_THEN_RECOVERED = [
  init(), toolAsk("m1", "Agent", "Read"), toolResult("m1", 2), cut(), refusalNotice(), refusalStop(),
  helperDone(), init(), result(0, { isError: true, stopReason: "refusal", terminal: "api_error" }),
  result(1, { origin: "task-notification" }), init(), toolAsk("m3", "Read"), toolResult("m3", 1), answer("m4"), result(2, { origin: "task-notification" }),
];

function scratch() { return mkdtempSync(join(tmpdir(), "session-record-")); }
function streamFile(dir, events) { const p = join(dir, "replay.jsonl"); writeFileSync(p, events.map((e) => JSON.stringify(e)).join("\n") + "\n"); return p; }

async function turn(events, { streamTo = null } = {}) {
  const dir = scratch();
  const saved = process.env.CLEAROTRON_CLAUDE_PATH, savedReplay = process.env.MOCK_CLAUDE_REPLAY;
  pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", REPLAY);
  process.env.MOCK_CLAUDE_REPLAY = streamFile(dir, events);
  try { return { dir, r: await anthropicAgentEngine.runTurn({ message: "invented task", model: "opus", thinking: "high", timeoutSec: 60, streamFile: streamTo ? join(dir, streamTo) : null }) }; }
  finally {
    pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", saved);
    if (savedReplay === undefined) delete process.env.MOCK_CLAUDE_REPLAY; else process.env.MOCK_CLAUDE_REPLAY = savedReplay;
  }
}

test("a cut the session carried on from is recorded, though the session ended in a clean result", async () => {
  const { dir, r } = await turn(CUT_AND_CARRIED_ON);
  try {
    assert.equal(r.code, 0, "the last result was a success, so the turn itself did not fail — the retry policy is unchanged");
    assert.equal(r.session.classifierCuts.length, 1);
    assert.equal(r.session.classifierCuts[0].synthetic, true);
    assert.ok(Number.isFinite(r.session.classifierCuts[0].atMs), "each cut says when it arrived");
    assert.equal(r.session.results.length, 1);
    assert.equal(r.session.results[0].isError, false);
    assert.equal(r.session.interrupted, true, "a session that was cut is interrupted, whatever its last result said");
    assert.equal(attemptOk(null, r), true, "a cut with no error result leaves the attempt ok: the session is marked interrupted instead");
    // the per-name count beside the total, summing to it
    assert.deepEqual(r.toolCallsByName, { "mcp__band__band_lookup": 1, Read: 1 });
    assert.equal(Object.values(r.toolCallsByName).reduce((a, b) => a + b, 0), r.toolCalls);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a refusal that ended the session is recorded with its category, and the turn fails as before", async () => {
  const { dir, r } = await turn(REFUSED);
  try {
    assert.notEqual(r.code, 0, "the last result was an error: the turn fails exactly as it always did");
    assert.deepEqual(r.session.refusals.map((x) => [x.category, x.model]), [["reasoning_extraction", "claude-opus-5-5"]]);
    assert.equal(r.session.refusalStops, 1);
    assert.deepEqual(r.session.results.map((x) => [x.isError, x.stopReason, x.terminalReason]), [[true, "refusal", "api_error"]]);
    assert.equal(r.session.interrupted, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a refusal a restart recovered is the silent case: every result is kept, and the attempt is not ok", async () => {
  const { dir, r } = await turn(REFUSED_THEN_RECOVERED, { streamTo: "_driver/stage.attempt1.stream.jsonl" });
  try {
    assert.equal(r.code, 0, "the LAST result was a success — this is the session the old record called clean");
    assert.equal(r.session.starts, 3, "three session starts: the first and two restarts");
    assert.deepEqual(r.session.results.map((x) => [x.index, x.isError, x.origin]), [[0, true, null], [1, false, "task-notification"], [2, false, "task-notification"]]);
    assert.equal(r.session.classifierCuts.length, 1);
    assert.equal(r.session.refusals.length, 1);
    assert.equal(attemptOk(null, r), false, "a session that reached an error result is not an ok attempt, though its last result was a success");
    assert.equal(attemptOk("missing_file:x", r), false);
    // the raw stream, byte for byte
    assert.equal(r.stream.present, true);
    const kept = readFileSync(r.stream.file, "utf8");
    assert.equal(kept, REFUSED_THEN_RECOVERED.map((e) => JSON.stringify(e)).join("\n") + "\n");
    assert.equal(r.stream.bytes, Buffer.byteLength(kept));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("through the gateway: the attempt row says not ok with no failure, carries the record, and the spine agrees", async () => {
  const dir = scratch();
  const out = join(dir, "out.md");
  const saved = { ai: process.env.CLEAROTRON_AI, path: process.env.CLEAROTRON_CLAUDE_PATH, replay: process.env.MOCK_CLAUDE_REPLAY, write: process.env.MOCK_CLAUDE_REPLAY_WRITE };
  process.env.CLEAROTRON_AI = "anthropic-agent";
  pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", REPLAY);
  process.env.MOCK_CLAUDE_REPLAY = streamFile(dir, REFUSED_THEN_RECOVERED);
  process.env.MOCK_CLAUDE_REPLAY_WRITE = out;
  try {
    const r = await runStage("teststage", {
      agent: "mailagent", sessionKey: "clearotron-test-abc-sessionrecord", runDir: dir,
      message: `Do the invented task. Write to the ABSOLUTE path for the stage output: ${out}`,
      model: "opus", thinking: "high", timeoutSec: 60, expectFile: out, validate: () => ({ ok: true }),
    });
    assert.equal(r.ok, true, "the stage delivered: nothing here retries or fails a recovered session");
    const rows = readFileSync(join(dir, "_driver", "teststage.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const row = rows.at(-1);
    assert.equal(row.fail ?? null, null);
    assert.equal(row.ok, false, "ok is false when any result of the session carried is_error");
    assert.equal(row.session.interrupted, true);
    assert.equal(row.session.results.length, 3);
    assert.equal(row.session.results[0].isError, true);
    assert.deepEqual(row.toolCallsByName, { Agent: 1, Read: 2 });
    assert.equal(row.stream.file, "_driver/streams/teststage.attempt1.jsonl");
    assert.equal(row.stream.present, true);
    assert.ok(existsSync(join(dir, row.stream.file)));
    // never beside the journals: every *.jsonl directly under _driver/ is read as a stage's journal (the token
    // rollup sums its usage rows), so the stream sits one folder down
    assert.deepEqual(readdirSync(join(dir, "_driver")).filter((f) => f.endsWith(".jsonl")).sort(), ["run.jsonl", "teststage.jsonl"]);
    // the spine says the same one word, and points at the same file
    const spine = readFileSync(join(dir, "_driver", "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.event === "attempt");
    assert.equal(spine.at(-1).ok, false);
    assert.equal(spine.at(-1).interrupted, true);
    assert.equal(spine.at(-1).stream, row.stream.file);
    // the client's report reads the stage's failure, not `ok`: a recovered session is not a degraded part
    assert.equal(lastAttempt(dir, "teststage").fail ?? null, null);
  } finally {
    for (const [k, v] of [["CLEAROTRON_AI", saved.ai], ["MOCK_CLAUDE_REPLAY", saved.replay], ["MOCK_CLAUDE_REPLAY_WRITE", saved.write]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", saved.path);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the record carries no words: a cut, a refusal and a result are kinds, codes and times", () => {
  const rec = newSessionRecord();
  for (const [i, e] of REFUSED_THEN_RECOVERED.entries()) noteClaudeEvent(rec, e, i);
  const text = JSON.stringify(sessionSummary(rec));
  for (const word of ["safety classifier", "invented explanation", "an invented answer", "invented answer"]) assert.ok(!text.includes(word), `the record must not carry "${word}"`);
  assert.ok(CLASSIFIER_CUT_RE.test("was stopped by a safety classifier"));
  assert.equal(CLASSIFIER_CUT_RE.test("a tool result that merely discusses classifiers"), false);
  // a cut quoted inside a TOOL RESULT is a page the model read, not the program cutting the session
  const quoted = newSessionRecord();
  noteClaudeEvent(quoted, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "x", content: "this page says: stopped by a safety classifier" }] } }, 1);
  assert.equal(quoted.classifierCuts.length, 0);
});

test("the Codex reader keeps every turn ending and counts its calls by name, the shape Claude's uses", () => {
  const ev = { mcpCalls: new Map(), session: newSessionRecord() };
  const lines = [
    { type: "thread.started", thread_id: "th-1" },
    { type: "item.started", item: { id: "i1", type: "mcp_tool_call", server: "owners", tool: "owner_table", status: "in_progress" } },
    { type: "item.completed", item: { id: "i1", type: "mcp_tool_call", server: "owners", tool: "owner_table", status: "completed" } },
    { type: "item.completed", item: { id: "i2", type: "command_execution", command: "x", status: "completed" } },
    { type: "turn.failed", error: { message: "invented" } },
    { type: "turn.completed", usage: {} },
  ];
  for (const [i, e] of lines.entries()) { parseCodexEvent(JSON.stringify(e), ev); noteCodexEvent(ev.session, e, i); }
  assert.deepEqual(codexToolCallsByName(ev), { "mcp__owners__owner_table": 1, command_execution: 1 }, "an item written twice under one id counts once");
  const s = sessionSummary(ev.session);
  assert.deepEqual(s.results.map((r) => [r.subtype, r.isError]), [["turn.failed", true], ["turn.completed", false]]);
  assert.equal(s.interrupted, true);
});

test("the stream is not written below the disk floor, and the record says why rather than leaving half a file", () => {
  const dir = scratch();
  try {
    const sink = streamSink(join(dir, "_driver", "x.stream.jsonl"), { freeBytes: 1024 ** 3 });
    sink.write("{}\n");
    const meta = sink.close();
    assert.equal(meta.present, false);
    assert.match(meta.reason, /under the 5 GiB floor/);
    assert.equal(existsSync(join(dir, "_driver", "x.stream.jsonl")), false);
    const ok = streamSink(join(dir, "_driver", "y.stream.jsonl"), { freeBytes: 6 * 1024 ** 3 });
    ok.write("{}\n"); ok.write(Buffer.from("{}\n"));
    assert.deepEqual(ok.close(), { file: join(dir, "_driver", "y.stream.jsonl"), present: true, bytes: 6 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── HOW A FAILED SESSION ENDED, IN THE PROGRAM'S OWN WORDS ──────────────────────────────────────────────
//
// An expired sign-in, measured live on the Claude program: `subtype: "success"`, `is_error: true`,
// `stop_reason: "stop_sequence"` (the stop of the program's OWN synthetic message, whose model reads
// `<synthetic>`), `terminal_reason: "api_error"`, and the reason in the result text. The row kept the stop
// reason alone, so six retries of one stage read `stop_sequence` six times and said nothing about why. The
// stop reason stays verbatim; the kind of ending, the vendor's status and the program's words go beside it.
const AUTH_WORDS = "Failed to authenticate: OAuth session expired and could not be refreshed";
const AUTH_EXPIRED = [
  init(),
  { type: "assistant", message: { id: "m-auth", model: "<synthetic>", stop_reason: "stop_sequence", content: [{ type: "text", text: AUTH_WORDS }] } },
  { type: "result", subtype: "success", is_error: true, stop_reason: "stop_sequence", terminal_reason: "api_error", api_error_status: null,
    result: AUTH_WORDS, session_id: "s-1", usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
];

async function gatewayRow(events, { writeOutput = true } = {}) {
  const dir = scratch();
  const out = join(dir, "out.md");
  const saved = { ai: process.env.CLEAROTRON_AI, path: process.env.CLEAROTRON_CLAUDE_PATH, replay: process.env.MOCK_CLAUDE_REPLAY, write: process.env.MOCK_CLAUDE_REPLAY_WRITE };
  process.env.CLEAROTRON_AI = "anthropic-agent";
  pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", REPLAY);
  process.env.MOCK_CLAUDE_REPLAY = streamFile(dir, events);
  if (writeOutput) process.env.MOCK_CLAUDE_REPLAY_WRITE = out; else delete process.env.MOCK_CLAUDE_REPLAY_WRITE;
  try {
    const r = await runStage("teststage", {
      agent: "mailagent", sessionKey: "clearotron-test-abc-sessionending", runDir: dir, maxRetries: 0,
      message: `Do the invented task. Write to the ABSOLUTE path for the stage output: ${out}`,
      model: "opus", thinking: "high", timeoutSec: 60, expectFile: out, validate: () => ({ ok: true }),
    });
    const rows = readFileSync(join(dir, "_driver", "teststage.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((x) => x.attempt != null);
    return { r, row: rows.at(-1) };
  } finally {
    for (const [k, v] of [["CLEAROTRON_AI", saved.ai], ["MOCK_CLAUDE_REPLAY", saved.replay], ["MOCK_CLAUDE_REPLAY_WRITE", saved.write]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", saved.path);
    rmSync(dir, { recursive: true, force: true });
  }
}

test("an expired sign-in is recorded as its own kind of ending, in the program's words, on the attempt row", async () => {
  const { r, row } = await gatewayRow(AUTH_EXPIRED, { writeOutput: false });
  assert.equal(r.ok, false, "the stage fails exactly as it always did");
  assert.ok(row.fail, "the attempt is a failure");
  assert.equal(row.stopReason, "stop_sequence", "the stop reason stays verbatim: rewriting it would be inventing");
  assert.equal(row.terminalReason, "api_error", "the kind of ending is not on the row, so it says stop_sequence and nothing else");
  assert.equal(row.apiErrorStatus, null, "the vendor gave no status: null, written, never absent");
  assert.ok(Object.hasOwn(row, "apiErrorStatus"));
  assert.equal(row.errorText, AUTH_WORDS, "the program's own reason is discarded again");
});

test("a session that ended well keeps its words off the row: the answer belongs in the output, not the record", async () => {
  const { r, row } = await gatewayRow(CUT_AND_CARRIED_ON);
  assert.equal(r.ok, true);
  assert.equal(row.errorText, null);
  assert.ok(Object.hasOwn(row, "errorText"), "written as null, so 'no error text' is never read as 'not recorded'");
  assert.equal(row.terminalReason, "completed", "the last result's terminal kind, as the program wrote it");
});

test("the error text is cut to a length a person reads, and kept only when the result declared an error", () => {
  const long = "x".repeat(5000);
  const failed = sessionRecord.claudeEnding?.({ is_error: true, result: long, terminal_reason: "api_error", api_error_status: 529 });
  assert.equal(failed?.errorText?.length, sessionRecord.ERROR_TEXT_CAP);
  assert.equal(failed?.apiErrorStatus, 529);
  assert.deepEqual(sessionRecord.claudeEnding?.({ is_error: false, result: "an invented answer", terminal_reason: "completed" }),
    { terminalReason: "completed", apiErrorStatus: null, errorText: null });
  assert.deepEqual(sessionRecord.claudeEnding?.(null), { terminalReason: null, apiErrorStatus: null, errorText: null },
    "a session that never reached a result reports nothing, as null");
});

// Codex states no terminal kind and no status on its stream, so those read null. Its words are the failed
// turn's own message, or the stream error when the turn never completed; an `error` the program recovered
// from (a reconnect, then a completed turn) is not why anything ended.
test("Codex: a failed turn's own message reaches the record; a reconnect it recovered from does not", () => {
  const fold = (events) => {
    const ev = { mcpCalls: new Map(), session: newSessionRecord() };
    for (const e of events) parseCodexEvent(JSON.stringify(e), ev);
    return sessionRecord.codexEnding?.(ev);
  };
  assert.deepEqual(fold([{ type: "thread.started", thread_id: "th-1" }, { type: "turn.failed", error: { message: "invented failure" } }]),
    { terminalReason: null, apiErrorStatus: null, errorText: "invented failure" });
  assert.deepEqual(fold([{ type: "thread.started", thread_id: "th-1" }, { type: "error", message: "invented disconnect" }]),
    { terminalReason: null, apiErrorStatus: null, errorText: "invented disconnect" }, "the turn never completed, so the stream error is why");
  assert.deepEqual(fold([{ type: "thread.started", thread_id: "th-1" }, { type: "error", message: "invented reconnect" }, { type: "turn.completed", usage: {} }]),
    { terminalReason: null, apiErrorStatus: null, errorText: null }, "a reconnect the turn recovered from is not why it ended");
  assert.deepEqual(fold([{ type: "thread.started", thread_id: "th-1" }, { type: "turn.failed" }]),
    { terminalReason: null, apiErrorStatus: null, errorText: null }, "a failure that carried no words records none: never a word of ours in their place");
});

test("Codex: the failed turn's message is on the envelope the gateway journals, and a healthy turn's is null", async () => {
  // Billing by key, as a-stage-program-starts-with-a-listed-environment.test.mjs does: on the default
  // (subscription) runTurn refuses before the mock starts wherever no Codex sign-in exists, CI included.
  const PINNED = { CLEAROTRON_CODEX_PATH: join(HERE, "mock-codex.mjs"), CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-codex-test" };
  const saved = { ...Object.fromEntries(Object.keys(PINNED).map((k) => [k, process.env[k]])), fail: process.env.MOCK_CODEX_FAIL };
  for (const [k, v] of Object.entries(PINNED)) pinEnv(process.env, k, v);
  try {
    process.env.MOCK_CODEX_FAIL = "1";
    const failed = await openaiAgentEngine.runTurn({ message: "reply ok", model: "haiku", thinking: "low", timeoutSec: 60 });
    assert.notEqual(failed.code, 0);
    assert.equal(failed.json?.errorText, "mock codex turn failure");
    assert.equal(failed.json?.terminalReason, null);
    assert.ok(Object.hasOwn(failed.json ?? {}, "terminalReason"));
    delete process.env.MOCK_CODEX_FAIL;
    const healthy = await openaiAgentEngine.runTurn({ message: "reply ok", model: "haiku", thinking: "low", timeoutSec: 60 });
    assert.equal(healthy.code, 0, healthy.stderr);
    assert.equal(healthy.json?.errorText, null);
    assert.ok(Object.hasOwn(healthy.json ?? {}, "errorText"));
  } finally {
    for (const k of Object.keys(PINNED)) { if (saved[k] === undefined) delete process.env[k]; else pinEnv(process.env, k, saved[k]); }
    if (saved.fail === undefined) delete process.env.MOCK_CODEX_FAIL; else process.env.MOCK_CODEX_FAIL = saved.fail;
  }
});
