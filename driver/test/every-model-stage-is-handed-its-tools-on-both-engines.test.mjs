// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// EVERY MODEL STAGE IS HANDED ITS TOOLS, ITS INSTRUCTIONS AND THE SCHEMAS ITS SERVERS SERVE, ON BOTH ENGINES.
//
// What a stage may call is decided in gather-config.mjs (`toolGroupsForStage`, `allowedToolsFor`,
// `buildGatherMcpConfig`) and handed to the engine by the gateway (`runStage`). Each engine then turns it
// into its own form: Claude into `--allowedTools` and `--mcp-config` on the program's command line, Codex
// into a per-turn `config.toml` whose server blocks carry `enabled_tools`. The sibling guards hold pieces of
// this: the Claude grant for every recording stage (engine.gather, recording-agreement), that each Codex
// server block HAS an `enabled_tools` line (engine.codex-config), the tool names each server serves when
// started with no stage of its own (every-tool-declares-what-it-does), the command and web-search removals
// on every label (no-stage-is-offered-a-command-tool, no-stage-is-offered-the-engines-own-web-search).
//
// What nothing held, and this file does, for every label a model stage is dispatched under:
//   · through the real gateway and each engine's real adapter, against the stand-in programs the engine
//     tests use, the program is handed exactly the resolved grant (Claude) and exactly the granted tools
//     per server (Codex), the stage's record tool among them, and a prompt carrying every instruction file
//     the stage declares as that file's absolute path;
//   · each server the stage mounts, started the way the stage starts it, serves every tool the stage may
//     call with an object schema, so a permitted name always has a schema behind it;
//   · on Claude, the names a stage is shown and may not call are exactly the known ones: the other stages'
//     record tools on the shared recording server, and `register_enumerate` on the search unit's
//     supplemental lane. Codex shows none. A new one turns this red; narrowing the list shows as a change here;
//   · a follow-up is handed the same tools as the stage's first dispatch.
//
// Invented values only: a temporary run folder, the stand-ins, and messages composed from invented contexts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";   // a fixture pins EVERY spelling

const HERE = dirname(fileURLToPath(import.meta.url));
process.env.CLEAROTRON_RUN_LOCK_DIR = mkdtempSync(join(tmpdir(), "stage-tools-locks-"));
const { runStage } = await import("../gateway.mjs");
const { STAGES, composeFollowup, REGISTER_ENUMERATE_TOOL } = await import("../stages.mjs");
const { KO_STAGES } = await import("../stages-knockout.mjs");
const { toolGroupsForStage, allowedToolsFor, RECORDING_TOOLS } = await import("../engine/mcp/gather-config.mjs");
const { WRITE_DISCIPLINE } = await import("../engine/common.mjs");
const { CODEX_DEVELOPER_INSTRUCTIONS } = await import("../engine/openai-agent.mjs");   // the output rule, then the temp-folder rule
const { DRIVER, everyModelStageDispatch, everyDispatchedLabel, baseOf } = await import("./model-stage-dispatches.mjs");

function withEnv(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; pinEnv(process.env, k, env[k]); }
  return (async () => { try { return await fn(); } finally { for (const k of Object.keys(env)) { if (saved[k] === undefined) delete process.env[k]; else pinEnv(process.env, k, saved[k]); } } })();
}

const ENGINES = {
  "anthropic-agent": (dir, out) => ({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: join(HERE, "mock-claude.mjs"),
    MOCK_CLAUDE_FILE: "a stub\n", MOCK_OUT_FILE: out, MOCK_CLAUDE_CALL_LOG: join(dir, "calls.jsonl"), MOCK_COUNT_FILE: join(dir, "count") }),
  "openai-agent": (dir) => ({ CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: join(HERE, "mock-codex.mjs"),
    CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-invented", MOCK_CODEX_FILE: "a stub\n", MOCK_CODEX_CALL_LOG: join(dir, "calls.jsonl") }),
};

// The opening message each base stage is dispatched with (house default context), so the program is handed
// the real instruction references, not a placeholder.
const RUN_FOR_MESSAGES = "/nonexistent/invented-run";
const MESSAGES = new Map(everyModelStageDispatch(RUN_FOR_MESSAGES)
  .filter((d) => d.label === "house default" || d.label === "knockout").map((d) => [d.name, d]));

/** One dispatch of `label` through the real gateway and the engine's real adapter; the stand-in's first call. */
async function handed(engine, label, { excludeTools, message, followup = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "stage-tools-"));
  try {
    mkdirSync(driverDir(dir), { recursive: true });
    const out = join(dir, "out.md");
    const d = MESSAGES.get(baseOf(label));
    await withEnv({ ...ENGINES[engine](dir, out), CLEAROTRON_RETRY_BACKOFF_MS: "0" },
      () => runStage(label, { message: message ?? d?.message ?? "invented message", model: "opus",
        sessionKey: `stage-tools-${engine}-${label}`, runDir: dir, expectFile: out, maxRetries: 0, timeoutSec: 30,
        followup, ...(excludeTools ? { excludeTools } : {}) }));
    const log = join(dir, "calls.jsonl");
    assert.ok(existsSync(log), `${engine}, ${label}: the stand-in program was never started`);
    return JSON.parse(readFileSync(log, "utf8").trim().split("\n")[0]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const flag = (argv, name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };

/** Each Codex server block in a rendered config.toml: name -> { enabled: string[] | null }. */
function codexServers(toml) {
  const out = {};
  let cur = null;
  for (const line of String(toml).split("\n")) {
    const h = /^\[mcp_servers\.(?:"([^"]+)"|([^\]."]+))\]$/.exec(line);
    if (h) { cur = h[1] ?? h[2]; out[cur] = { enabled: null }; continue; }
    if (/^\[/.test(line)) { cur = null; continue; }
    const e = /^enabled_tools = (\[.*\])$/.exec(line);
    if (e && cur) out[cur].enabled = JSON.parse(e[1]);
  }
  return out;
}

/** The granted MCP tools, grouped by server: { server: [tool…] }, `*` for a whole-server grant. */
function grantedByServer(tokens) {
  const out = {};
  for (const t of tokens) {
    const m = /^mcp__(.+?)__(.+)$/.exec(t);
    if (m) (out[m[1]] ||= []).push(m[2]);
  }
  return out;
}

/** The record tools a recording stage's pinned row names (the MCP tokens of RECORDING_TOOLS). */
const recordToolsOf = (base) => (RECORDING_TOOLS[base] ?? []).filter((t) => t.startsWith("mcp__") && /__record_/.test(t));

const LABELS = everyDispatchedLabel();
const SUPPLEMENTAL = "register-unit:primary-sweep";

// The first dispatch of every label on both engines, gathered once and read by the tests below.
const CALLS = {};
async function calls() {
  if (Object.keys(CALLS).length) return CALLS;
  for (const engine of Object.keys(ENGINES)) {
    CALLS[engine] = {};
    for (const label of LABELS) CALLS[engine][label] = await handed(engine, label);
    CALLS[engine][`${SUPPLEMENTAL} (supplemental lane)`] = await handed(engine, SUPPLEMENTAL, { excludeTools: [REGISTER_ENUMERATE_TOOL] });
  }
  return CALLS;
}

const expectedGrant = (label) => {
  const lane = label.endsWith(" (supplemental lane)");
  const real = lane ? SUPPLEMENTAL : label;
  const groups = toolGroupsForStage(real);
  const grant = groups.length ? allowedToolsFor(groups).split(" ") : [];
  return lane ? grant.filter((t) => t !== REGISTER_ENUMERATE_TOOL) : grant;
};

test("every label a model stage is dispatched under is checked, on both engines", async () => {
  const c = await calls();
  for (const n of [...Object.keys(STAGES), ...Object.keys(KO_STAGES)]) assert.ok(LABELS.includes(n), `${n} is not dispatched here`);
  assert.ok(LABELS.some((l) => l.includes(":")) && LABELS.some((l) => l.includes("#")), "the fanned label forms are missing");
  for (const engine of Object.keys(ENGINES)) assert.equal(Object.keys(c[engine]).length, LABELS.length + 1, `${engine}: a label was not dispatched`);
});

test("claude: every stage's program is handed exactly its resolved grant, its record tool among it, and its tool servers", async () => {
  const c = await calls();
  const wrong = [];
  for (const [label, call] of Object.entries(c["anthropic-agent"])) {
    const want = expectedGrant(label);
    const allowed = flag(call.argv, "--allowedTools");
    const got = allowed ? allowed.split(" ") : [];
    if ([...got].sort().join(" ") !== [...want].sort().join(" ")) wrong.push(`${label}: --allowedTools is not the resolved grant`);
    for (const t of recordToolsOf(baseOf(label))) if (!got.includes(t)) wrong.push(`${label}: its record tool ${t} is not permitted`);
    const cfg = flag(call.argv, "--mcp-config");
    const servers = cfg ? Object.keys(JSON.parse(cfg).mcpServers ?? {}) : [];
    for (const s of Object.keys(grantedByServer(want))) if (!servers.includes(s)) wrong.push(`${label}: the ${s} server it may call is not mounted`);
    for (const s of Object.values(cfg ? JSON.parse(cfg).mcpServers : {}))
      for (const a of s.args ?? []) if (/\.mjs$/.test(a) && !existsSync(a)) wrong.push(`${label}: a mounted server's script ${a} does not exist`);
    if (flag(call.argv, "--append-system-prompt") !== WRITE_DISCIPLINE) wrong.push(`${label}: the system-level instruction is not appended`);
  }
  assert.deepEqual(wrong, []);
});

test("codex: every stage's program is handed, per server, exactly the tools it may call, its record tool among them", async () => {
  const c = await calls();
  const wrong = [];
  for (const [label, call] of Object.entries(c["openai-agent"])) {
    const want = grantedByServer(expectedGrant(label));
    const got = codexServers(call.configToml);
    for (const [server, tools] of Object.entries(want)) {
      if (!got[server]) { wrong.push(`${label}: no [mcp_servers.${server}] block`); continue; }
      if (tools.includes("*")) { if (got[server].enabled !== null) wrong.push(`${label}: a whole-server grant on ${server} is narrowed`); continue; }
      if ([...(got[server].enabled ?? [])].sort().join(" ") !== [...tools].sort().join(" "))
        wrong.push(`${label}: ${server} offers ${JSON.stringify(got[server].enabled)}, not its grant ${JSON.stringify(tools)}`);
    }
    for (const t of recordToolsOf(baseOf(label))) {
      const [, server, tool] = /^mcp__(.+?)__(.+)$/.exec(t);
      if (!got[server]?.enabled?.includes(tool)) wrong.push(`${label}: its record tool ${tool} is not offered`);
    }
    const webFetch = expectedGrant(label).includes("WebFetch");
    if (webFetch !== Boolean(got.fetch)) wrong.push(`${label}: the page fetcher is ${got.fetch ? "mounted without" : "missing despite"} a WebFetch grant`);
    const line = String(call.configToml).split("\n").find((l) => l.startsWith("developer_instructions = "));
    if (!line || JSON.parse(line.slice("developer_instructions = ".length)) !== CODEX_DEVELOPER_INSTRUCTIONS) wrong.push(`${label}: the system-level instruction is not the developer instructions`);
  }
  assert.deepEqual(wrong, []);
});

test("both engines' programs are handed every declared instruction file as the absolute path of a file that exists", async () => {
  const c = await calls();
  const lost = [];
  for (const engine of Object.keys(ENGINES)) {
    for (const [label, call] of Object.entries(c[engine])) {
      const d = MESSAGES.get(baseOf(label));
      for (const f of d?.declared ?? []) {
        const abs = join(DRIVER, f);
        if (!String(call.prompt).includes(abs)) lost.push(`${engine}, ${label}: the prompt does not carry ${abs}`);
        else if (!existsSync(abs)) lost.push(`${engine}, ${label}: ${abs} does not exist`);
      }
    }
  }
  assert.deepEqual(lost, []);
});

/** tools/list from one server, started exactly as the stage's MCP configuration starts it. */
function toolsList(server) {
  return new Promise((resolve, reject) => {
    const p = spawn(server.command, server.args ?? [], { stdio: ["pipe", "pipe", "ignore"], env: { ...process.env, ...(server.env ?? {}) } });
    let buf = "";
    const timer = setTimeout(() => { p.kill(); reject(new Error(`${(server.args ?? []).join(" ")} did not answer tools/list`)); }, 20000);
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
    p.stdout.setEncoding("utf8");
    p.stdout.on("data", (d) => {
      buf += d;
      for (const line of buf.split("\n")) {
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m?.id !== 2) continue;
        clearTimeout(timer); p.kill();
        return resolve(m.result?.tools ?? []);
      }
    });
    const send = (o) => p.stdin.write(JSON.stringify(o) + "\n");
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "stage-tools", version: "0" } } });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  });
}

// Every tool some recording stage may call on the shared recording server, by its bare name. The server part
// holds no underscore, so one class matches it, hyphens and all: a repeated hyphenated group inside it could
// match the same text many ways and backtrack without end on a long name.
const OTHER_STAGES_RECORDING_TOOLS = new Set(Object.values(RECORDING_TOOLS).flat()
  .map((t) => /^mcp__recording-[^_]+__(.+)$/.exec(t)?.[1]).filter(Boolean));

// The local servers only. The case-law step's two bridges are remote services granted whole; what they
// serve is theirs, and the bridge wildcards are pinned by server-tools-granted-or-stated.
const isLocal = (server) => (server.args ?? []).some((a) => a.startsWith(join(DRIVER, "engine", "mcp")));

test("every server a stage mounts, started as the stage starts it, serves each tool the stage may call, with an object schema; on Claude it also lists only the known extras", async () => {
  const c = await calls();
  const problems = [];
  for (const [label, call] of Object.entries(c["anthropic-agent"])) {
    const cfg = flag(call.argv, "--mcp-config");
    if (!cfg) continue;
    const granted = grantedByServer(flag(call.argv, "--allowedTools").split(" "));
    const codexOffered = codexServers(c["openai-agent"][label].configToml);
    for (const [name, server] of Object.entries(JSON.parse(cfg).mcpServers)) {
      if (!isLocal(server)) continue;
      const served = await toolsList(server);
      const byName = new Map(served.map((t) => [t.name, t]));
      for (const tool of granted[name] ?? []) {
        const t = byName.get(tool);
        if (!t) problems.push(`${label}: ${name} does not serve ${tool}, which the stage may call`);
        else if (t.inputSchema?.type !== "object") problems.push(`${label}: ${name}.${tool} is served without an object schema`);
      }
      for (const tool of codexOffered[name]?.enabled ?? []) if (!byName.has(tool)) problems.push(`${label}: codex offers ${name}.${tool}, which the server does not serve`);
      // What Claude shows by name and the stage may not call. On the shared recording server: other
      // stages' tools, each one some other stage's granted tool, and never empty while the server lists
      // every tool to every stage. On the search unit's supplemental lane: register_enumerate. Nothing else.
      const shownNotPermitted = served.map((t) => t.name).filter((n) => !(granted[name] ?? []).includes(n)).sort();
      if (name.startsWith("recording-")) {
        if (!shownNotPermitted.length) problems.push(`${label}: the recording server now lists only the stage's own tools — update this test and the tool audit`);
        for (const n of shownNotPermitted) if (!OTHER_STAGES_RECORDING_TOOLS.has(n)) problems.push(`${label}: Claude is shown ${n}, which no stage may call`);
      } else {
        const known = (label.endsWith(" (supplemental lane)") && name === "register") ? ["register_enumerate"] : [];
        if (JSON.stringify(shownNotPermitted) !== JSON.stringify(known)) problems.push(`${label}: Claude is shown ${name} tools it may not call: ${shownNotPermitted.join(", ") || "none"}, expected ${known.join(", ") || "none"}`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("a follow-up is handed the same tools as its stage's first dispatch, on both engines", async () => {
  const followup = "Invented correction: re-send the one field the check named, and nothing else.";
  const cases = [["report-card:1"], ["synthesis"], [SUPPLEMENTAL, [REGISTER_ENUMERATE_TOOL]]];
  for (const [label, excludeTools] of cases) {
    const message = composeFollowup(baseOf(label), { profile: null, job: {} }, { followup });
    for (const engine of Object.keys(ENGINES)) {
      const first = await handed(engine, label, { excludeTools });
      const again = await handed(engine, label, { excludeTools, message, followup: true });
      if (engine === "anthropic-agent") {
        assert.equal(flag(again.argv, "--allowedTools"), flag(first.argv, "--allowedTools"), `${label}: a follow-up is permitted different tools`);
        assert.deepEqual(Object.keys(JSON.parse(flag(again.argv, "--mcp-config") ?? "{}").mcpServers ?? {}),
          Object.keys(JSON.parse(flag(first.argv, "--mcp-config") ?? "{}").mcpServers ?? {}), `${label}: a follow-up mounts different servers`);
      } else {
        assert.deepEqual(codexServers(again.configToml), codexServers(first.configToml), `${label}: a Codex follow-up is offered different tools`);
      }
    }
  }
});
