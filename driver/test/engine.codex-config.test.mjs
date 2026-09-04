// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Unit tests for engine/mcp/codex-config.mjs — the claude-mcpConfig-JSON → codex-config.toml renderer.
// Pure, $0. Proves the gather wiring survives the translation (so gather-config.mjs stays untouched) and
// that secrets are NEVER written into the toml (forwarded by name), and developer_instructions carries.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  renderCodexConfigToml, parseClaudeMcpServers, enabledToolsByServer, tomlString, CRED_ENV_FORWARD,
} from "../engine/mcp/codex-config.mjs";

// Neutral register namespace (the real gather-config emits server key `register` + `register_*` tools —
// the vendor name never leaves engine/mcp/<provider>-server.mjs; see provider-neutral-prose.test.mjs).
const CLAUDE_JSON = JSON.stringify({
  mcpServers: {
    register: { command: "/usr/bin/node", args: ["/srv/register-server.mjs"], env: { CLEAROTRON_GATHER_SESSION_KEY: "sess-1", CLEAROTRON_GATHER_AGENT: "clawdi" } },
    courtlistener: { command: "/usr/bin/node", args: ["/srv/bridge.mjs", "--server", "courtlistener"], connectionTimeoutMs: 60000 },
  },
});
const ALLOWED = "mcp__register__register_search mcp__register__register_record_fetch WebFetch";

test("parseClaudeMcpServers: extracts command/args/env and maps connectionTimeoutMs→startup_timeout_sec", () => {
  const s = parseClaudeMcpServers(CLAUDE_JSON);
  assert.deepEqual(s.register.args, ["/srv/register-server.mjs"]);
  assert.equal(s.register.env.CLEAROTRON_GATHER_SESSION_KEY, "sess-1");
  assert.equal(s.courtlistener.startupTimeoutSec, 60);   // 60000ms → 60s
  assert.equal(parseClaudeMcpServers("").register, undefined);
  assert.deepEqual(parseClaudeMcpServers("not json"), {});
});

test("enabledToolsByServer: namespaced mcp__srv__tool → per-server bare tools; built-ins (WebFetch) dropped", () => {
  assert.deepEqual(enabledToolsByServer(ALLOWED), { register: ["register_search", "register_record_fetch"] });
  assert.deepEqual(enabledToolsByServer(""), {});
});

test("renderCodexConfigToml: emits [mcp_servers.*] with command/args/env + per-server enabled_tools", () => {
  const toml = renderCodexConfigToml({ mcpConfig: CLAUDE_JSON, allowedTools: ALLOWED, developerInstructions: "WRITE THE FILE." });
  assert.match(toml, /^developer_instructions = "WRITE THE FILE\."/m);
  assert.match(toml, /\[mcp_servers\.register\]/);
  assert.match(toml, /command = "\/usr\/bin\/node"/);
  assert.match(toml, /args = \["\/srv\/register-server\.mjs"\]/);
  assert.match(toml, /env = \{ CLEAROTRON_GATHER_SESSION_KEY = "sess-1", CLEAROTRON_GATHER_AGENT = "clawdi" \}/);
  assert.match(toml, /enabled_tools = \["register_search", "register_record_fetch"\]/);
  assert.match(toml, /\[mcp_servers\.courtlistener\]/);
  assert.match(toml, /startup_timeout_sec = 60/);
});

test("renderCodexConfigToml: creds are forwarded by NAME (env_vars), never written as values", () => {
  const toml = renderCodexConfigToml({ mcpConfig: CLAUDE_JSON, allowedTools: ALLOWED });
  // env_vars forwards the cred NAMES so the server inherits them; no secret VALUE appears in the toml.
  assert.match(toml, /env_vars = \[/);
  for (const name of ["CORSEARCH_SESSION_KEY", "PERPLEXITY_API_KEY"]) assert.ok(toml.includes(`"${name}"`), `${name} forwarded by name`);
  assert.ok(CRED_ENV_FORWARD.length > 0);
});

test("tomlString: escapes quotes, backslashes, newlines (injection-safe)", () => {
  assert.equal(tomlString('a"b\\c'), '"a\\"b\\\\c"');
  assert.equal(tomlString("line1\nline2"), '"line1\\nline2"');
});

test("renderCodexConfigToml: empty inputs → an empty-but-valid config (no servers, no crash)", () => {
  const toml = renderCodexConfigToml({});
  assert.equal(typeof toml, "string");
  assert.ok(!toml.includes("[mcp_servers"));
});

test("renderCodexConfigToml: WebFetch → the engine-local fetch server is injected (fetch_url, no creds)", () => {
  const caselaw = JSON.stringify({ mcpServers: { courtlistener: { command: "/usr/bin/node", args: ["/b.mjs", "--server", "courtlistener"] } } });
  const toml = renderCodexConfigToml({ mcpConfig: caselaw, allowedTools: "courtlistener__search WebFetch" });
  assert.match(toml, /\[mcp_servers\.fetch\]/);
  assert.match(toml, /enabled_tools = \["fetch_url"\]/);
  const fetchBlock = toml.slice(toml.indexOf("[mcp_servers.fetch]"));
  assert.ok(!fetchBlock.includes("env_vars"), "the fetch server needs no creds → no env_vars forwarding");
});

test("renderCodexConfigToml: no WebFetch → no fetch server injected", () => {
  const toml = renderCodexConfigToml({ mcpConfig: CLAUDE_JSON, allowedTools: "mcp__register__register_search" });
  assert.ok(!toml.includes("[mcp_servers.fetch]"));
});

// ── — the turn's budget reaches codex's PER-CALL tool cap ───────────────────────────────────────
// Without this codex applies its own default (measured at 300s on codex-cli 0.147.0) while the stage
// that awaits the call may hold far more. R5 2026-08-12 recorded `"timeoutSec": 1500` on
// `register-unit:incumbent-class` and its tool call dying at 300s with no band written — a 25-minute
// budget that never reached the tool layer. The value is the CALLER'S budget, never a constant here.

test("#793 renderCodexConfigToml: toolTimeoutSec → per-server tool_timeout_sec, on EVERY server", () => {
  const toml = renderCodexConfigToml({ mcpConfig: CLAUDE_JSON, allowedTools: ALLOWED, toolTimeoutSec: 1500 });
  // one per declared server + the injected fetch server (ALLOWED carries WebFetch)
  const hits = toml.match(/^tool_timeout_sec = 1500$/gm) || [];
  assert.equal(hits.length, 3, `expected register + courtlistener + fetch to carry the cap, got ${hits.length}`);
  // it must not be confused with the START-UP timeout, which is a different question and still 60
  assert.match(toml, /^startup_timeout_sec = 60$/m);
});

test("#793 renderCodexConfigToml: absent/zero/negative budget emits nothing — codex's default is left alone", () => {
  for (const v of [undefined, 0, -1, null, ""]) {
    const toml = renderCodexConfigToml({ mcpConfig: CLAUDE_JSON, allowedTools: ALLOWED, toolTimeoutSec: v });
    assert.ok(!toml.includes("tool_timeout_sec"), `toolTimeoutSec=${JSON.stringify(v)} must not emit the key`);
  }
});

test("#793 renderCodexConfigToml: the cap is the caller's number, not a constant in this module", () => {
  // The regression this guards: someone 'fixing' a timeout by hard-coding a larger number here. R5's
  // incumbent-class plan is 26 entries and is the largest in the suite TODAY — any constant chosen to
  // fit it fails on the first scenario that dictates 40.
  for (const budget of [90, 600, 1500, 3600]) {
    const toml = renderCodexConfigToml({ mcpConfig: CLAUDE_JSON, allowedTools: ALLOWED, toolTimeoutSec: budget });
    assert.match(toml, new RegExp(`^tool_timeout_sec = ${budget}$`, "m"));
  }
  const src = readFileSync(new URL("../engine/mcp/codex-config.mjs", import.meta.url), "utf8");
  const assigned = /tool_timeout_sec = \$\{(\w+)\}/.exec(src);
  assert.ok(assigned, "tool_timeout_sec must be interpolated from a variable");
  assert.ok(!/tool_timeout_sec = \d/.test(src), "tool_timeout_sec must never be emitted from a literal");
});

test("#793 renderCodexConfigToml: a fractional budget is floored to a whole second (TOML integer)", () => {
  const toml = renderCodexConfigToml({ mcpConfig: CLAUDE_JSON, allowedTools: ALLOWED, toolTimeoutSec: 1500.7 });
  assert.match(toml, /^tool_timeout_sec = 1500$/m);
  assert.ok(!toml.includes("1500.7"), "a decimal would not be a TOML integer");
});
