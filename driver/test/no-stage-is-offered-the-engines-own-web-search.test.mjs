// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// NO STAGE IS OFFERED THE ENGINE PROGRAM'S OWN WEB SEARCH, ON EITHER ENGINE, IN EITHER SAFETY SETTING.
//
// The engine's web search is its own: the common-law sweep, which keeps a record of every result. Both engine
// programs bring a search of their own. Claude's was never granted and was refused at every attempt; Codex's
// was on unless configured off, and fired in some runs and not others. Both are removed: Claude's by name,
// beside the command tools; Codex's by `web_search = "disabled"` in every stage's per-run configuration,
// whether the sandbox is on (the stage's permission profile) or bypassed. This walks every stage the driver
// defines through the gateway's own resolution and fails on any that still offers it. The tool servers are
// untouched: the case-law step keeps its page fetch on both engines.
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildGatherMcpConfig, allowedToolsFor, toolGroupsForStage, PER_AXIS_STAGES, PER_CHUNK_STAGES } from "../engine/mcp/gather-config.mjs";
import { buildClaudeArgs, COMMAND_TOOLS, OWN_SEARCH_TOOLS } from "../engine/anthropic-agent.mjs";
import { buildCodexArgs } from "../engine/openai-agent.mjs";
import { renderCodexConfigToml } from "../engine/mcp/codex-config.mjs";
import { probeToolConfig } from "../engine/probe.mjs";
import { STAGES } from "../stages.mjs";
import { KO_STAGES } from "../stages-knockout.mjs";

const NAMES = [...new Set([
  ...Object.keys(STAGES), ...Object.keys(KO_STAGES),
  ...[...PER_AXIS_STAGES].map((s) => `${s}:primary-sweep`), ...[...PER_CHUNK_STAGES].map((s) => `${s}#1`),
])];

/** The gateway's resolution for one stage: its tool config and grant. */
function toolsFor(stage) {
  const groups = toolGroupsForStage(stage);
  if (!groups.length) return { mcpConfig: undefined, allowedTools: undefined };
  const cfg = buildGatherMcpConfig(groups, { sessionKey: "k", agent: "a", runDir: "/RUN" });
  return { mcpConfig: cfg ? JSON.stringify(cfg) : undefined, allowedTools: allowedToolsFor(groups) };
}

/** The tools one Claude argv removes, or null when it carries the flag other than once. */
function removed(args) {
  const at = args.indexOf("--disallowedTools");
  if (at < 0 || args.indexOf("--disallowedTools", at + 1) >= 0) return null;
  return String(args[at + 1] ?? "").split(/[\s,]+/).filter(Boolean).sort();
}

test("the program's own search is Claude's WebSearch, by the name its tools reference uses", () => {
  assert.deepEqual([...OWN_SEARCH_TOOLS], ["WebSearch"]);
});

test("Claude: every stage's argv removes the program's own web search beside the command tools, fresh and resumed", () => {
  assert.ok(NAMES.length >= 19, `only ${NAMES.length} stage names to check`);
  const want = JSON.stringify([...COMMAND_TOOLS, ...OWN_SEARCH_TOOLS].sort());
  const lacking = [];
  for (const stage of NAMES) {
    for (const resumeRef of [null, "sess-1"]) {
      const { args } = buildClaudeArgs({ message: "x", model: "opus", thinking: "low", cwd: "/tmp", runDir: "/RUN", ...toolsFor(stage), resumeRef });
      if (JSON.stringify(removed(args)) !== want) lacking.push(`${stage}${resumeRef ? " (resumed)" : ""}: ${JSON.stringify(removed(args))}`);
      const granted = String(args[args.indexOf("--allowedTools") + 1] ?? "").split(/\s+/);
      if (args.includes("--allowedTools") && granted.includes("WebSearch")) lacking.push(`${stage}: WebSearch is granted`);
    }
  }
  assert.deepEqual(lacking, [], "stages whose argv still offers the program's own web search");
  const { args } = buildClaudeArgs({ message: "x", model: "haiku", thinking: "low", ...probeToolConfig("probe-word") });
  assert.equal(JSON.stringify(removed(args)), want, "the engine probe's turn removes it too");
});

test("Codex: every stage's configuration turns its own web search off, with the sandbox on and with it bypassed", () => {
  const fences = { on: { runDir: "/RUN", readRoots: ["/SKILLS"] }, bypassed: null };
  const lacking = [];
  for (const stage of NAMES) {
    for (const [setting, fence] of Object.entries(fences)) {
      const toml = renderCodexConfigToml({ ...toolsFor(stage), developerInstructions: "WRITE THE FILE.", fence, toolTimeoutSec: 600 });
      const lines = toml.split("\n");
      const at = lines.indexOf('web_search = "disabled"');
      const firstTable = lines.findIndex((l) => l.startsWith("["));
      // A bare key after a table header belongs to that table, so the line must come before the first one.
      if (at < 0 || (firstTable >= 0 && at > firstTable)) lacking.push(`${stage}, sandbox ${setting}`);
      if (lines.filter((l) => /^web_search\s*=/.test(l)).length !== 1) lacking.push(`${stage}, sandbox ${setting}: not exactly one web_search line`);
    }
  }
  assert.deepEqual(lacking, [], "stage configurations that leave codex's own web search on");
  const before = process.env.CLEAROTRON_CODEX_SANDBOX_BYPASS;
  try {
    for (const v of ["1", "0"]) {
      process.env.CLEAROTRON_CODEX_SANDBOX_BYPASS = v;
      const { args } = buildCodexArgs({ model: "haiku", thinking: "low", runDir: "/RUN" });
      assert.ok(!args.includes("--search") && !args.some((a) => /web_search/.test(a)), `bypass=${v}: the command line turns search back on: ${args.join(" ")}`);
    }
  } finally {
    if (before === undefined) delete process.env.CLEAROTRON_CODEX_SANDBOX_BYPASS; else process.env.CLEAROTRON_CODEX_SANDBOX_BYPASS = before;
  }
});

test("the case-law step keeps its page fetch on both engines", () => {
  const { mcpConfig, allowedTools } = toolsFor("case-law");
  assert.ok(allowedTools.split(/\s+/).includes("WebFetch"), "Claude's page fetch is no longer granted to the case-law step");
  const { args } = buildClaudeArgs({ message: "x", model: "opus", thinking: "low", cwd: "/tmp", runDir: "/RUN", mcpConfig, allowedTools });
  assert.ok(!removed(args).includes("WebFetch"), "the page fetch was removed with the search");
  const toml = renderCodexConfigToml({ mcpConfig, allowedTools, fence: null });
  assert.match(toml, /^\[mcp_servers\.fetch\]$/m, "codex's page fetcher is gone from the case-law step");
  assert.match(toml, /^enabled_tools = \["fetch_url"\]$/m);
});
