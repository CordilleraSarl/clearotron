// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// NO CLAUDE STAGE IS OFFERED A TOOL THAT RUNS A COMMAND.
//
// `--allowedTools` lists the tools that run without asking; it removes nothing. The program offered every
// stage its shell anyway and ran commands it classes as read-only without asking, so a stage could `cat`
// any file the account can read. `buildClaudeArgs` now removes the command tools by name on every call.
//
// This walks every stage the driver defines, the knockout stages and the per-axis and per-chunk names
// included, THROUGH the gateway's own resolution (tool groups → tool config → argv), fresh and resumed, and
// fails on any argv that lacks the removal. The flag's presence is not the proof that stages run no
// commands; the test round's count of command-tool calls is. This is what keeps the flag from being lost.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { buildGatherMcpConfig, allowedToolsFor, toolGroupsForStage, PER_AXIS_STAGES, PER_CHUNK_STAGES } from "../engine/mcp/gather-config.mjs";
import { buildClaudeArgs, COMMAND_TOOLS } from "../engine/anthropic-agent.mjs";
import { probeToolConfig } from "../engine/probe.mjs";
import { STAGES } from "../stages.mjs";
import { KO_STAGES } from "../stages-knockout.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

test("the command tools are the vendor's three, by the names its tools reference uses", () => {
  assert.deepEqual([...COMMAND_TOOLS].sort(), ["Bash", "Monitor", "PowerShell"]);
});

/** The removal on one argv: one `--disallowedTools`, naming every command tool and nothing else. */
function removed(args) {
  const at = args.indexOf("--disallowedTools");
  if (at < 0 || args.indexOf("--disallowedTools", at + 1) >= 0) return null;
  return String(args[at + 1] ?? "").split(/[\s,]+/).filter(Boolean).sort();
}

/** The gateway's resolution for one stage name, as the per-stage argv baseline reproduces it. */
function argvFor(stage, { resumeRef = null } = {}) {
  const groups = toolGroupsForStage(stage);
  let mcpConfig, allowedTools;
  if (groups.length) {
    const cfg = buildGatherMcpConfig(groups, { sessionKey: "k", agent: "a", runDir: "/RUN" });
    mcpConfig = cfg ? JSON.stringify(cfg) : undefined;
    allowedTools = allowedToolsFor(groups);
  }
  return buildClaudeArgs({ message: "x", model: "opus", thinking: "low", cwd: "/tmp", runDir: "/RUN", mcpConfig, allowedTools, resumeRef }).args;
}

test("every stage's argv removes every command tool, fresh and resumed", () => {
  const saved = process.env.CLEAROTRON_DATABASE;
  process.env.CLEAROTRON_DATABASE = "euipo";   // a register stage resolves its server through the active provider
  try {
    const names = [...new Set([
      ...Object.keys(STAGES), ...Object.keys(KO_STAGES),
      ...[...PER_AXIS_STAGES].map((s) => `${s}:primary-sweep`), ...[...PER_CHUNK_STAGES].map((s) => `${s}#1`),
    ])];
    // A floor, so a stage table that moved or emptied cannot pass this by leaving nothing to check.
    assert.ok(names.length >= 19, `only ${names.length} stage names to check`);
    const lacking = [];
    for (const stage of names) {
      for (const resumeRef of [null, "sess-1"]) {
        const got = removed(argvFor(stage, { resumeRef }));
        if (JSON.stringify(got) !== JSON.stringify([...COMMAND_TOOLS].sort())) lacking.push(`${stage}${resumeRef ? " (resumed)" : ""}: ${JSON.stringify(got)}`);
      }
    }
    assert.deepEqual(lacking, [], "stages whose argv does not remove the command tools");
  } finally {
    if (saved === undefined) delete process.env.CLEAROTRON_DATABASE; else process.env.CLEAROTRON_DATABASE = saved;
  }
});

test("the engine probe's turn removes them too, so the check runs with the settings a search runs with", () => {
  const { args } = buildClaudeArgs({ message: "x", model: "haiku", thinking: "low", ...probeToolConfig("probe-word") });
  assert.deepEqual(removed(args), [...COMMAND_TOOLS].sort());
});

test("the removal sits beside the grant and does not change it", () => {
  const allowedTools = allowedToolsFor(toolGroupsForStage("common-law"));
  const { args } = buildClaudeArgs({ message: "x", model: "haiku", thinking: "low", allowedTools, runDir: "/RUN" });
  assert.equal(args[args.indexOf("--allowedTools") + 1], allowedTools, "the grant is passed as it was");
  for (const t of COMMAND_TOOLS) assert.ok(!allowedTools.split(/\s+/).includes(t), `${t} is granted to a stage`);
});

// ── THE COUNT THAT PROVES IT ────────────────────────────────────────────────────────────────────────
// The flag says what was asked of the program; the attempt row says what the model did. A test round
// reads zero command-tool calls and zero refused calls per stage off these two fields.
async function turnWith(engine, env) {
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; pinEnv(process.env, k, env[k]); }
  try { return await engine.runTurn({ message: "reply ok", model: "haiku", thinking: "low", timeoutSec: 60 }); }
  finally { for (const k of Object.keys(env)) { if (saved[k] === undefined) delete process.env[k]; else pinEnv(process.env, k, saved[k]); } }
}

test("a Claude turn reports how many command-tool calls it made and how many calls were refused", async () => {
  const { anthropicAgentEngine } = await import("../engine/anthropic-agent.mjs");
  const mock = { CLEAROTRON_CLAUDE_PATH: join(HERE, "mock-claude.mjs"), CLEAROTRON_AI_BILLING: "subscription" };
  const clean = await turnWith(anthropicAgentEngine, mock);
  assert.equal(clean.code, 0, clean.stderr);
  assert.equal(clean.commandToolCalls, 0, "a turn that ran no command reports zero, not nothing");
  assert.equal(clean.toolCallsRefused, 0, "a turn the program refused nothing reports zero, not nothing");
  const busy = await turnWith(anthropicAgentEngine, { ...mock, MOCK_CLAUDE_DENIALS: "2",
    MOCK_CLAUDE_TOOL_WAIT: JSON.stringify([{ name: "Bash", ms: 0 }, { name: ["Read", "PowerShell"], ms: 0 }, { name: "Read", ms: 0 }]) });
  assert.equal(busy.code, 0, busy.stderr);
  assert.equal(busy.toolCalls, 4);
  assert.equal(busy.commandToolCalls, 2, "Bash and PowerShell are command tools; Read is not");
  assert.equal(busy.toolCallsRefused, 2);
});

test("a Codex turn reports its refused calls under the same name, and no command-tool count", async () => {
  const { openaiAgentEngine } = await import("../engine/openai-agent.mjs");
  const t = await turnWith(openaiAgentEngine, { CLEAROTRON_CODEX_PATH: join(HERE, "mock-codex.mjs"),
    CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-codex-test", MOCK_CODEX_MCP_REFUSED: "2" });
  assert.equal(t.code, 0, t.stderr);
  assert.equal(t.toolCallsRefused, 2);
  assert.equal(t.toolCallsRefused, t.mcpToolCallsRefused);
  assert.equal(t.commandToolCalls, null, "codex keeps its shell and does not count it: null, never zero");
});
