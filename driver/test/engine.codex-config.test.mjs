// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Unit tests for engine/mcp/codex-config.mjs — the claude-mcpConfig-JSON → codex-config.toml renderer.
// Pure, $0. Proves the gather wiring survives the translation (so gather-config.mjs stays untouched) and
// that secrets are NEVER written into the toml (forwarded by name), and developer_instructions carries.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  renderCodexConfigToml, parseClaudeMcpServers, enabledToolsByServer, tomlString, CRED_ENV_FORWARD, FENCE_PROFILE,
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

test("renderCodexConfigToml: toolTimeoutSec → per-server tool_timeout_sec, on EVERY server", () => {
  const toml = renderCodexConfigToml({ mcpConfig: CLAUDE_JSON, allowedTools: ALLOWED, toolTimeoutSec: 1500 });
  // one per declared server + the injected fetch server (ALLOWED carries WebFetch)
  const hits = toml.match(/^tool_timeout_sec = 1500$/gm) || [];
  assert.equal(hits.length, 3, `expected register + courtlistener + fetch to carry the cap, got ${hits.length}`);
  // it must not be confused with the START-UP timeout, which is a different question and still 60
  assert.match(toml, /^startup_timeout_sec = 60$/m);
});

test("renderCodexConfigToml: absent/zero/negative budget emits nothing — codex's default is left alone", () => {
  for (const v of [undefined, 0, -1, null, ""]) {
    const toml = renderCodexConfigToml({ mcpConfig: CLAUDE_JSON, allowedTools: ALLOWED, toolTimeoutSec: v });
    assert.ok(!toml.includes("tool_timeout_sec"), `toolTimeoutSec=${JSON.stringify(v)} must not emit the key`);
  }
});

test("renderCodexConfigToml: the cap is the caller's number, not a constant in this module", () => {
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

// ── Clearotron's own tool servers are approved, and the sandbox stays on for shell commands ───────────
// `codex exec` runs with the approval policy `never`. Under the default per-server mode a tool marked
// open-world and not read-only (the register search) needs approval, so with the sandbox on every call was
// refused and the register was never queried. The config this module writes approves the servers it names;
// the command line keeps the sandbox. Either half alone is a different product: without the first no search
// runs, and without the second the approval would travel with shell commands out of the sandbox.

/** Every `[mcp_servers.*]` block of a rendered config, heading included. */
const serverBlocks = (toml) => toml.split(/^(?=\[)/m).filter((b) => b.startsWith("[mcp_servers."));

test("renderCodexConfigToml: every server block approves its own tools, the fetch server's included", () => {
  const toml = renderCodexConfigToml({ mcpConfig: CLAUDE_JSON, allowedTools: ALLOWED, developerInstructions: "WRITE THE FILE." });
  const blocks = serverBlocks(toml);
  // register + courtlistener + the fetch server WebFetch brings in. A floor, so a renderer that wrote no
  // server at all cannot pass by having nothing to check.
  assert.equal(blocks.length, 3, `expected three server blocks, got ${blocks.length}`);
  for (const b of blocks)
    assert.match(b, /^default_tools_approval_mode = "approve"$/m, `no approval line in:\n${b}`);
  // One per block and nowhere else: not a top-level key, which would reach servers this file does not name.
  assert.equal((toml.match(/default_tools_approval_mode/g) || []).length, blocks.length);
  const top = toml.slice(0, toml.indexOf("[mcp_servers."));
  assert.ok(!top.includes("approval"), "an approval key above the first server block is global");
});

test("renderCodexConfigToml: the approval rides the servers a real stage is granted", async () => {
  // The config a register-unit stage is built from, through the same two builders the gateway calls, so a
  // stage whose servers the fixture above does not model still carries the line.
  const { buildGatherMcpConfig, allowedToolsFor, toolGroupsForStage } = await import("../engine/mcp/gather-config.mjs");
  const groups = toolGroupsForStage("register-unit:identical");
  // The register server resolves through the provider the test harness declares before anything is imported.
  const cfg = buildGatherMcpConfig(groups, { sessionKey: "s", agent: "a", runDir: "/tmp/run-x" });
  const toml = renderCodexConfigToml({ mcpConfig: JSON.stringify(cfg), allowedTools: allowedToolsFor(groups) });
  const blocks = serverBlocks(toml);
  assert.ok(blocks.some((b) => b.startsWith("[mcp_servers.register]")), `no register server in:\n${toml}`);
  for (const b of blocks)
    assert.match(b, /^default_tools_approval_mode = "approve"$/m, `no approval line in:\n${b}`);
});

test("buildCodexArgs: the sandbox stays on unless the bypass is set to 1, and neither --sandbox nor an approval flag rides the command line", async () => {
  const { buildCodexArgs } = await import("../engine/openai-agent.mjs");
  const before = process.env.CLEAROTRON_CODEX_SANDBOX_BYPASS;
  const argvWith = (v) => {
    if (v === undefined) delete process.env.CLEAROTRON_CODEX_SANDBOX_BYPASS; else process.env.CLEAROTRON_CODEX_SANDBOX_BYPASS = v;
    return buildCodexArgs({ model: "haiku", thinking: "low", runDir: "/tmp/run-x" }).args;
  };
  try {
    for (const v of [undefined, "", "0", "true"]) {
      const args = argvWith(v);
      // The sandbox is the stage's permission profile in the config; `--sandbox` here would switch it off.
      assert.ok(!args.includes("--sandbox"), `bypass=${JSON.stringify(v)}: ${args.join(" ")}`);
      assert.ok(!args.includes("--dangerously-bypass-approvals-and-sandbox"), `bypass=${JSON.stringify(v)} dropped the sandbox`);
      // The approval is the config file's, per server. A policy on the command line would reach shell commands.
      assert.ok(!args.some((a) => /approval|full-auto/i.test(a)), `bypass=${JSON.stringify(v)}: ${args.join(" ")}`);
    }
    const bypassed = argvWith("1");
    assert.ok(bypassed.includes("--dangerously-bypass-approvals-and-sandbox"));
    assert.ok(!bypassed.includes("--sandbox"));
  } finally {
    if (before === undefined) delete process.env.CLEAROTRON_CODEX_SANDBOX_BYPASS; else process.env.CLEAROTRON_CODEX_SANDBOX_BYPASS = before;
  }
});

test("renderCodexConfigToml: a fractional budget is floored to a whole second (TOML integer)", () => {
  const toml = renderCodexConfigToml({ mcpConfig: CLAUDE_JSON, allowedTools: ALLOWED, toolTimeoutSec: 1500.7 });
  assert.match(toml, /^tool_timeout_sec = 1500$/m);
  assert.ok(!toml.includes("1500.7"), "a decimal would not be a TOML integer");
});

// ── A SERVER GRANTED WHOLE ───────────────────────────────────────────────────────────────────────────
// On claude `mcp__<server>__*` is every tool that server serves. codex matches `enabled_tools` by exact
// name, so the `["*"]` once written for it offered no tool at all: on the OpenAI engine the case-law step
// started both of its databases and could call neither. These arms hold the translation to what the grant
// means, and hold the grant itself to the two servers it was made for.

/** Every stage name the gateway resolves tools for, as the per-stage argv baseline walks them. */
async function everyStageName() {
  const { STAGES } = await import("../stages.mjs");
  const { KO_STAGES } = await import("../stages-knockout.mjs");
  const { PER_AXIS_STAGES, PER_CHUNK_STAGES } = await import("../engine/mcp/gather-config.mjs");
  return [...new Set([
    ...Object.keys(STAGES), ...Object.keys(KO_STAGES),
    ...[...PER_AXIS_STAGES].map((s) => `${s}:primary-sweep`), ...[...PER_CHUNK_STAGES].map((s) => `${s}#1`),
  ])];
}

/** One stage's codex config, through the same two builders the gateway calls; null for a stage with no tools. */
async function codexConfigFor(stage) {
  const { buildGatherMcpConfig, allowedToolsFor, toolGroupsForStage } = await import("../engine/mcp/gather-config.mjs");
  const groups = toolGroupsForStage(stage);
  if (!groups.length) return null;
  const cfg = buildGatherMcpConfig(groups, { sessionKey: "s", agent: "a", runDir: "/tmp/run-x" });
  const allowedTools = allowedToolsFor(groups);
  return { allowedTools, toml: renderCodexConfigToml({ mcpConfig: cfg ? JSON.stringify(cfg) : undefined, allowedTools }) };
}

const CASE_LAW_DATABASES = ["courtlistener", "legaldatahunter"];

test("renderCodexConfigToml: the case-law step is offered both its databases whole, and the page fetch by its one name", async () => {
  const { allowedTools, toml } = await codexConfigFor("case-law");
  for (const s of CASE_LAW_DATABASES)
    assert.ok(allowedTools.split(/\s+/).includes(`mcp__${s}__*`), `case-law is no longer granted ${s} whole on claude: ${allowedTools}`);
  const blocks = serverBlocks(toml);
  for (const s of CASE_LAW_DATABASES) {
    const b = blocks.find((x) => x.startsWith(`[mcp_servers.${s}]`));
    assert.ok(b, `no ${s} server in:\n${toml}`);
    assert.doesNotMatch(b, /^enabled_tools/m, `${s} carries a list, so codex offers only the tools it names:\n${b}`);
    assert.match(b, /^default_tools_approval_mode = "approve"$/m, `no approval line in:\n${b}`);
  }
  const fetch = blocks.find((x) => x.startsWith("[mcp_servers.fetch]"));
  assert.ok(fetch, `no fetch server in:\n${toml}`);
  assert.match(fetch, /^enabled_tools = \["fetch_url"\]$/m);
});

test("renderCodexConfigToml: in every stage a server goes without a list only when it was granted whole, and only the case-law databases are", async () => {
  const names = await everyStageName();
  assert.ok(names.includes("case-law") && names.length >= 19, `stage names: ${names.join(", ")}`);
  const whole = new Set(), unlisted = [], starred = [];
  let blocksSeen = 0;
  for (const stage of names) {
    const got = await codexConfigFor(stage);
    if (!got) continue;
    const grantedWhole = new Set(got.allowedTools.split(/\s+/).map((t) => /^mcp__(.+)__\*$/.exec(t)?.[1]).filter(Boolean));
    grantedWhole.forEach((s) => whole.add(s));
    if (/^enabled_tools = .*"\*"/m.test(got.toml)) starred.push(stage);
    for (const b of serverBlocks(got.toml)) {
      blocksSeen++;
      const name = /^\[mcp_servers\.([^\]]+)\]/.exec(b)[1];
      if (!/^enabled_tools = \[/m.test(b) && !grantedWhole.has(name)) unlisted.push(`${stage}: ${name}`);
    }
  }
  assert.ok(blocksSeen >= names.length, `only ${blocksSeen} server blocks across ${names.length} stages`);
  assert.deepEqual(starred, [], "stages whose config names a tool `*`, which codex matches as a name");
  assert.deepEqual(unlisted, [], "servers codex would offer whole although the stage was granted only some of their tools");
  // Offering a server whole widens what the engine can search. A register server, which is billed per
  // call, must never arrive here without that being decided.
  assert.deepEqual([...whole].sort(), CASE_LAW_DATABASES);
});

test("renderCodexConfigToml: a server granted whole and by name is offered whole; one granted by name keeps exactly its names", () => {
  const cfg = JSON.stringify({ mcpServers: { a: { command: "/n", args: ["/a.mjs"] }, b: { command: "/n", args: ["/b.mjs"] } } });
  const toml = renderCodexConfigToml({ mcpConfig: cfg, allowedTools: "mcp__a__x mcp__a__* mcp__b__y" });
  const [a, b] = ["a", "b"].map((s) => serverBlocks(toml).find((x) => x.startsWith(`[mcp_servers.${s}]`)));
  assert.doesNotMatch(a, /^enabled_tools/m);
  assert.match(b, /^enabled_tools = \["y"\]$/m);
});

// ── what a stage's shell commands inherit ───────────────────────────────────────────────────────────
// Codex hands a command its whole environment unless its config says otherwise, and the program holds the
// register keys for its tool servers. Each withheld name is one `exclude` filter, and the shell snapshot,
// which replays the unfiltered environment, is off. Read back with a real
// TOML parser, because codex refuses the whole file over one bad line, and a stage whose config does not
// parse runs nothing.

function parseToml(text) {
  const r = spawnSync("python3", ["-c", "import json, sys, tomllib; print(json.dumps(tomllib.loads(sys.stdin.read())))"],
    { input: text, encoding: "utf8" });
  assert.equal(r.error, undefined, "python3 is not on this machine, and the TOML check needs a real parser");
  assert.equal(r.status, 0, `the config does not parse as TOML:\n${text}\n${r.stderr}`);
  return JSON.parse(r.stdout);
}

test("renderCodexConfigToml: each withheld name is one exclude filter, and the servers still forward it by name", () => {
  const withheld = ["SIGNA_API_KEY", "CORSEARCH_SESSION_KEY", "Signa_Api_Key", "CODEX_API_KEY"];
  const toml = renderCodexConfigToml({ mcpConfig: CLAUDE_JSON, allowedTools: ALLOWED, developerInstructions: "WRITE THE FILE.",
    fence: { runDir: "/run" }, withheldFromCommands: withheld });
  const cfg = parseToml(toml);
  // Once per name whatever its case: codex matches filters without regard to case and refuses a file
  // that names one twice.
  assert.deepEqual(cfg.shell_environment_policy,
    { filters: { SIGNA_API_KEY: "exclude", CORSEARCH_SESSION_KEY: "exclude", CODEX_API_KEY: "exclude" } });
  // And the shell snapshot off: codex takes it from a shell that inherits the program's whole environment,
  // and replays it before each command, which put every filtered name back (measured, 0.156.1).
  assert.deepEqual(cfg.features, { shell_snapshot: false });
  // Only the filters. Codex refuses `filters` beside the older `exclude` and `include_only` lists, and an
  // `inherit` here would change what every other name does.
  assert.doesNotMatch(toml, /^(exclude|include_only|inherit|ignore_default_excludes) =/m);
  // The top-level settings are still top-level, above the new table.
  assert.equal(cfg.developer_instructions, "WRITE THE FILE.");
  assert.equal(cfg.default_permissions, FENCE_PROFILE);
  // The servers are untouched: codex reads their keys through env_vars, from the program's environment.
  assert.deepEqual(cfg.mcp_servers.register.env_vars, CRED_ENV_FORWARD);
  assert.equal(cfg.mcp_servers.register.env.CLEAROTRON_GATHER_SESSION_KEY, "sess-1");
});

test("renderCodexConfigToml: nothing withheld writes no policy, and the file is otherwise what it was", () => {
  const before = renderCodexConfigToml({ mcpConfig: CLAUDE_JSON, allowedTools: ALLOWED, developerInstructions: "WRITE THE FILE." });
  assert.ok(!before.includes("shell_environment_policy"));
  for (const none of [[], undefined, null, [""]])
    assert.equal(renderCodexConfigToml({ mcpConfig: CLAUDE_JSON, allowedTools: ALLOWED, developerInstructions: "WRITE THE FILE.", withheldFromCommands: none }), before);
  const withPolicy = renderCodexConfigToml({ mcpConfig: CLAUDE_JSON, allowedTools: ALLOWED, developerInstructions: "WRITE THE FILE.", withheldFromCommands: ["SIGNA_API_KEY"] });
  assert.equal(withPolicy.replace(/^\[features\]\nshell_snapshot = false\n\n\[shell_environment_policy\.filters\]\n"SIGNA_API_KEY" = "exclude"\n\n/m, ""), before);
});
