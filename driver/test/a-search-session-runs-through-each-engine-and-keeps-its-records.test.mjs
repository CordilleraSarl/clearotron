// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A SEARCH SESSION RUNS THROUGH EACH ENGINE, AND THE STREAM IT KEEPS STILL HOLDS EACH SEARCH'S RECORD.
//
// The own web search's research-only sessions (engine/mcp/own-search.mjs) go through the real adapters, here against the
// stand-in programs, each emitting its program's own web-search events. What matters is the stream each adapter keeps:
// if either adapter's stream writer dropped or reshaped a search's record, every search would read as never sent, and
// only a test through the adapter would see it. So each search is read back from the kept stream, and each outcome is
// asserted. The session's arguments are read from the stand-in's own call log: the program's search is its only
// built-in tool (Claude) or is live (Codex), and an Urgent order asks for the faster setting where the session's model
// has one: Luna on Codex does, Haiku on Claude does not. Every name and host is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const { makeOwnSearchSessions, searchOutcomes } = await import("../engine/mcp/own-search.mjs");
const { makeJxTurnRunner } = await import("../engine/jx-turn.mjs");
const { anthropicAgentEngine } = await import("../engine/anthropic-agent.mjs");
const { openaiAgentEngine } = await import("../engine/openai-agent.mjs");
const { recordRunChoices } = await import("../engine/run-choices.mjs");
const { urgentDecision } = await import("../engine/speed.mjs");

const ENGINES = {
  "anthropic-agent": (dir) => ({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: join(HERE, "mock-claude.mjs"),
    MOCK_CLAUDE_CALL_LOG: join(dir, "calls.jsonl"), MOCK_COUNT_FILE: join(dir, "count"), MOCK_OUT_FILE: join(dir, "out.md") }),
  "openai-agent": (dir) => ({ CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: join(HERE, "mock-codex.mjs"),
    CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-invented", MOCK_CODEX_FILE: "a stub\n", MOCK_CODEX_CALL_LOG: join(dir, "calls.jsonl"),
    MOCK_COUNT_FILE: join(dir, "count"), MOCK_OUT_FILE: join(dir, "out.md") }),
};
function withEnv(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; pinEnv(process.env, k, env[k]); }
  return (async () => { try { return await fn(); } finally { for (const k of Object.keys(env)) { if (saved[k] === undefined) delete process.env[k]; else pinEnv(process.env, k, saved[k]); } } })();
}
const calls = (dir) => readFileSync(join(dir, "calls.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const FAST = urgentDecision({ ordered: true, engine: "anthropic-agent", auth: { mode: "subscription" } });

const ITEMS = [
  { query: "qzorvak candles", site: "shop.example.com" },
  { query: "qzorvak wax", site: "shop.example.com" },
  { query: "qzorvak lantern", site: null },
  { query: "qzorvak wick", site: null },
];
// What each program's search returns, in its own shapes.
const CLAUDE = [
  { query: "qzorvak candles", allowed_domains: ["shop.example.com"], urls: ["https://shop.example.com/1", "https://elsewhere.example.org/2"] },
  { query: "qzorvak wax", allowed_domains: ["shop.example.com"], urls: [], searchCount: 1 },
  { query: "qzorvak lantern", urls: [], searchCount: 0, text: "Web search was not performed" },
  // "qzorvak wick" is never sent
];
const CODEX = [
  { queries: ["qzorvak candles site:shop.example.com"], results: [{ title: "t", url: "https://shop.example.com/1" }] },
  { queries: ["qzorvak wax site:shop.example.com"] },
  { queries: ["qzorvak lantern", "qzorvak wick"], results: [{ title: "t", url: "https://pages.example.com/p" }] },
];
const EXPECTED = {
  "anthropic-agent": ["found", "empty", "capped", "not-sent"],
  "openai-agent": ["found", "no-results-reported", "pooled", "pooled"],
};

async function oneSession(engine, { urgent = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), `own-search-${engine}-`));
  mkdirSync(driverDir(dir), { recursive: true });
  recordRunChoices(dir, { engine, register: null, ...(urgent ? { urgent } : {}) });
  const adapter = engine === "anthropic-agent" ? anthropicAgentEngine : openaiAgentEngine;
  const env = { ...ENGINES[engine](dir), MOCK_CLAUDE_WEB_SEARCH: JSON.stringify(CLAUDE), MOCK_CODEX_WEB_SEARCH: JSON.stringify(CODEX) };
  return await withEnv(env, async () => {
    const sessions = await makeOwnSearchSessions({ runDir: dir, sessionDir: driverDir(dir, "own-search-sessions"),
      makeRunner: (o) => makeJxTurnRunner({ ...o, engine: adapter }) });
    assert.equal(sessions.error, undefined, sessions.error);
    const r = await sessions.session(ITEMS);
    return { dir, sessions, r, call: calls(dir).at(-1) };
  });
}

for (const engine of Object.keys(ENGINES)) {
  test(`${engine}: each search is read back from the stream the adapter kept, with its own outcome`, async () => {
    const { dir, sessions, r } = await oneSession(engine);
    try {
      assert.equal(sessions.search, engine === "anthropic-agent" ? "claude" : "codex");
      assert.ok(r.events.length > 0, "the adapter kept the session's stream");
      assert.equal(r.answered, true);
      const outcomes = searchOutcomes(sessions.search, ITEMS, r.events, { answered: r.answered });
      assert.deepEqual(outcomes.map((o) => o.outcome), EXPECTED[engine]);
      if (engine === "anthropic-agent") assert.deepEqual(outcomes[0].results.map((x) => x.offSite), [false, true], "an off-site result kept and marked");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test(`${engine}: the session has the program's own search and nothing else`, async () => {
    const { dir, call } = await oneSession(engine);
    try {
      if (engine === "anthropic-agent") {
        const argv = call.argv;
        assert.equal(argv[argv.indexOf("--tools") + 1], "WebSearch");
        const removed = String(argv[argv.indexOf("--disallowedTools") + 1]).split(/\s+/);
        assert.ok(!removed.includes("WebSearch") && removed.includes("Bash"), "the search kept, the command tools removed");
        assert.ok(!argv.includes("--mcp-config"), "no tool server");
      } else {
        assert.match(call.configToml, /^web_search = "live"$/m);
        assert.doesNotMatch(call.configToml, /\[mcp_servers\./, "no tool server");
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test(`${engine}: an Urgent order's session asks for the faster setting where its model has one, and says why where not`, async () => {
    const { dir, r, call } = await oneSession(engine, { urgent: FAST });
    try {
      if (engine === "openai-agent") {
        assert.ok(call.argv.includes('service_tier="fast"'), "Luna has the faster setting: asked for it");
        assert.deepEqual([r.speed?.requested, r.speed?.standardBecause], ["fast", null]);
      } else {
        const settings = JSON.parse(call.argv[call.argv.indexOf("--settings") + 1]);
        assert.equal(settings.fastMode, undefined, "Haiku has no faster setting: not asked for it");
        assert.deepEqual([r.speed?.requested, r.speed?.standardBecause], ["standard", "model-not-fast"]);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
