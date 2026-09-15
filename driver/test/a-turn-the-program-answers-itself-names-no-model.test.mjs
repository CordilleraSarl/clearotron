// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the Claude adapter and a real stage turn against a small stand-in program
// When the Claude program cannot reach a model it writes the turn's answer itself, and labels that message
// `<synthetic>` where a model id would be. Measured in testing on Azure Foundry, 2026-09-14: with
// ANTHROPIC_DEFAULT_OPUS_MODEL naming a deployment that did not exist, a stage turn asking for opus exited 1
// with the program's own error, and its attempt row recorded `modelActual: "<synthetic>"` and
// `modelBasis: "actual"`, a served model for a turn no model served.
//
// What the arms hold:
//   - a stream whose only assistant event carries `<synthetic>` reports no served model, even though its
//     init event named one: init says what the session was configured with, not what served the turn;
//   - the CONTROLS: a normal stream reports the id its assistant event named; a real id earlier in the same
//     turn still stands when the program writes a message of its own after it; and a stream that never
//     reached an assistant event still reports init's answer, as it did before;
//   - the attempt row a real stage turn writes from that stream says no model served it (`modelActual` null,
//     `modelBasis` "unknown"), and the control turn's row records the served id.
//
// SAFETY: driver.config reads env at module load and its pool-root default is the real archive, so the
// env is pinned before any product module is imported.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";
const ROOT = mkdtempSync(join(tmpdir(), "answered-itself-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || join(ROOT, "ws"));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool-default"));
pinEnv(process.env, "CLEAROTRON_DATABASE", "corsearch");
delete process.env.CLEAROTRON_MCP_URL;
import { test } from "node:test";
import assert from "node:assert/strict";
import { driverDir } from "../../shared/driver-dir.mjs";
const { anthropicAgentEngine } = await import("../engine/anthropic-agent.mjs");
const { runStage } = await import("../gateway.mjs");

// A stand-in for the Claude program: it answers --version, reads the prompt, then prints the events it is
// handed in STANDIN_EVENTS as the program's stream and exits with STANDIN_EXIT.
const STANDIN = join(ROOT, "standin-claude.mjs");
writeFileSync(STANDIN, `#!/usr/bin/env node
if (process.argv.includes("--version")) { process.stdout.write("2.1.270 (Claude Code)\\n"); process.exit(0); }
if (!process.stdin.isTTY) { process.stdin.resume(); for await (const _ of process.stdin) { /* the prompt */ } }
for (const ev of JSON.parse(process.env.STANDIN_EVENTS || "[]")) process.stdout.write(JSON.stringify(ev) + "\\n");
process.exit(Number(process.env.STANDIN_EXIT || 0));
`);
chmodSync(STANDIN, 0o755);

const USAGE = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const init = { type: "system", subtype: "init", session_id: "standin", model: "claude-opus-5", apiKeySource: "none", tools: [] };
const said = (model, text) => ({ type: "assistant", session_id: "standin", message: { role: "assistant", model, content: [{ type: "text", text }] } });
const ERROR = "API Error: 404 The deployment for this model does not exist.";
const refused = { type: "result", subtype: "success", is_error: true, result: ERROR, session_id: "standin", usage: USAGE };
const answered = { type: "result", subtype: "success", is_error: false, result: "done", session_id: "standin", usage: USAGE };

/** The streams under test, each as the program would print it. */
const STREAMS = {
  answeredItself: { events: [init, said("<synthetic>", ERROR), refused], exit: 1 },
  served: { events: [init, said("claude-opus-5", "done"), answered], exit: 0 },
  servedThenAnsweredItself: { events: [init, said("claude-opus-5", "reading"), said("<synthetic>", ERROR), refused], exit: 1 },
  initOnly: { events: [init, answered], exit: 0 },
};

/** Run `fn` with the stand-in in place of the program, printing `stream`. */
async function withStandin(stream, fn) {
  const env = { CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_AI_BILLING: "subscription",
    STANDIN_EVENTS: JSON.stringify(stream.events), STANDIN_EXIT: String(stream.exit) };
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  const savedPath = envFrom(process.env, "CLEAROTRON_CLAUDE_PATH");
  Object.assign(process.env, env);
  pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", STANDIN);
  try { return await fn(); }
  finally {
    for (const [k, v] of Object.entries(saved)) { if (v == null) delete process.env[k]; else process.env[k] = v; }
    pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", savedPath);
  }
}

const adapterTurn = (stream) => withStandin(stream, () =>
  anthropicAgentEngine.runTurn({ message: "Do the task.", model: "opus", thinking: "low", timeoutSec: 30 }));

test("a turn only the program answered reports no served model, though its init event named one", async () => {
  const t = await adapterTurn(STREAMS.answeredItself);
  assert.notEqual(t.code, 0, `the stand-in's refusal must reach the adapter as a failed turn: ${t.stderr}`);
  assert.equal(t.modelWire, null, "no model served this turn, so neither the label nor init's configured model is reported");
});

test("the CONTROLS: a served turn reports its id, an earlier served call stands, and init still answers a turn cut short", async () => {
  assert.equal((await adapterTurn(STREAMS.served)).modelWire, "claude-opus-5", "a normal stream reports the id its assistant event named");
  assert.equal((await adapterTurn(STREAMS.servedThenAnsweredItself)).modelWire, "claude-opus-5",
    "a model served part of this turn before the program wrote its own message, so that model is named");
  assert.equal((await adapterTurn(STREAMS.initOnly)).modelWire, "claude-opus-5",
    "a stream with no assistant event keeps init's answer, as before: only a message the program wrote itself stops it");
});

/** One real stage turn against the stand-in; returns its attempt row and the run log's attempt event. */
async function stageRow(tag, stream) {
  const runDir = mkdtempSync(join(ROOT, `run-${tag}-`));
  mkdirSync(driverDir(runDir), { recursive: true });
  const out = join(runDir, "out.md");
  writeFileSync(out, "ok\n");
  const r = await withStandin(stream, () => runStage(`answered-${tag}`, {
    agent: "clawdi", sessionKey: `clearotron-test-answered-${tag}`, message: `Do the task. Write to the ABSOLUTE path: ${out}`,
    model: "opus", thinking: "medium", timeoutSec: 60, expectFile: out, validate: () => ({ ok: true }), runDir, maxRetries: 0,
  }));
  const read = (name) => readFileSync(driverDir(runDir, name), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { r, row: read(`answered-${tag}.jsonl`).at(-1), spine: read("run.jsonl").filter((e) => e.event === "attempt").at(-1) };
}

test("the attempt row of a turn the program answered itself records that no model served it", async () => {
  const { r, row, spine } = await stageRow("itself", STREAMS.answeredItself);
  assert.equal(r.ok, false, "the program's refusal fails the turn");
  assert.equal(row.modelActual, null, "never the label, and never the configured model, as the served id");
  assert.equal(row.modelBasis, "unknown", "the record does not say a model was observed");
  assert.equal(row.modelSnapshot, null);
  assert.equal(row.modelMismatch, null, "an unknown comparison is not a match");
  assert.ok(spine, "the run log carries an attempt event");
  assert.equal(spine.modelActual, null);
  assert.equal(spine.modelBasis, "unknown");
});

test("the CONTROL: a served stage turn's row records the id the program reported", async () => {
  const { r, row } = await stageRow("served", STREAMS.served);
  assert.equal(r.ok, true, `the control turn itself must succeed for its row to mean anything: ${JSON.stringify(r).slice(0, 300)}`);
  assert.equal(row.modelActual, "claude-opus-5");
  assert.equal(row.modelBasis, "actual");
});
