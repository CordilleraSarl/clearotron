// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// engine/mcp/codex-config.mjs — render a codex `config.toml` from the SAME gather inputs the anthropic
// engine already builds, so gather-config.mjs stays byte-untouched (merge-safety) and codex reuses the
// exact server/tool wiring. Two inputs, both produced today by the gateway gather block:
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tomlString } from "../../../shared/toml-string.mjs";

//   • mcpConfig     — the claude-shaped JSON string `{mcpServers:{name:{command,args,env,connectionTimeoutMs?}}}`
//                     (buildGatherMcpConfig → JSON.stringify)
//   • allowedTools  — the space-separated claude allowlist `mcp__<server>__<tool> …` (allowedToolsFor)
// We translate those into codex's `[mcp_servers.<name>]` tables (command/args/env/env_vars/
// startup_timeout_sec/enabled_tools) + top-level `developer_instructions` (the WRITE_DISCIPLINE append
// point — codex's equivalent of claude's --append-system-prompt). Pure + dependency-free (hand-rolled
// TOML, like the repo's other MCP glue); every value is escaped.
//
// Live-unverified (grounded in the codex docs/flag corpus, 2026-07): the exact
// `env_vars` forward semantics and MCP-server network under codex's sandbox. The mapping is
// designed to mirror the claude path — creds reach the servers by ENV INHERITANCE (never written into the
// config); only the non-secret per-run values (session key, ledger paths) ride `env`.

// Credential env-var NAMES the gather servers read from the inherited engine env. NOT written as values —
// forwarded by name via codex's `env_vars` so a server subprocess still sees them (parity with the claude
// path, where the server simply inherits the engine process env). Superset across providers; only the ones
// actually present in the engine env forward.
export const CRED_ENV_FORWARD = [
  "CORSEARCH_SESSION_KEY", "CORSEARCH_API_KEY",
  "PERPLEXITY_API_KEY",
  "CLARIVATE_API_KEY", "CLARIVATE_CLIENT_ID", "CLARIVATE_CLIENT_SECRET",
  "SIGNA_API_KEY",
  "EUIPO_CLIENT_ID", "EUIPO_CLIENT_SECRET", "EUIPO_AUTH_URL", "EUIPO_API_BASE",
  // Not a credential — the path to the local US index. It forwards by the same mechanism for the same
  // reason: the server subprocess must see it or it refuses every call, and under codex a name absent
  // from this list simply is not inherited. A path is not a secret, but it is just as load-bearing.
  "USPTO_LOCAL_DB",
];

// ── TOML value escaping (basic strings) ──────────────────────────────────────────────────────────────
// One encoder for every TOML block the product writes; re-exported so this module's callers keep their import.
export { tomlString };
function tomlStringArray(arr) {
  return "[" + (arr || []).map(tomlString).join(", ") + "]";
}

// ── claude mcpConfig JSON → { name: {command,args,env,startupTimeoutSec} } ────────────────────────────
export function parseClaudeMcpServers(mcpConfigJson) {
  if (!mcpConfigJson) return {};
  let obj;
  try { obj = typeof mcpConfigJson === "string" ? JSON.parse(mcpConfigJson) : mcpConfigJson; }
  catch { return {}; }
  const servers = obj?.mcpServers && typeof obj.mcpServers === "object" ? obj.mcpServers : {};
  const out = {};
  for (const [name, s] of Object.entries(servers)) {
    if (!s?.command) continue;
    out[name] = {
      command: s.command,
      args: Array.isArray(s.args) ? s.args : [],
      env: s.env && typeof s.env === "object" ? s.env : {},
      // claude uses connectionTimeoutMs (ms); codex uses startup_timeout_sec. Carry it across when present.
      startupTimeoutSec: Number(s.connectionTimeoutMs) > 0 ? Math.ceil(Number(s.connectionTimeoutMs) / 1000) : undefined,
    };
  }
  return out;
}

// ── claude allowlist string → { server: [tool, …] } (codex per-server enabled_tools) ─────────────────
// claude tools are namespaced `mcp__<server>__<tool>`; codex filters per server with `enabled_tools`
// naming the BARE tool. A bare (non-`mcp__`) entry like `WebFetch` is a claude built-in with no codex
// server equivalent — it is dropped here and handled separately (the engine-local fetch server below).
// A whole-server grant, `mcp__<server>__*`, comes through as the tool `*`; the renderer writes no list
// for it (see `emitServer`).
export function enabledToolsByServer(allowedTools) {
  const out = {};
  if (!allowedTools) return out;
  const toks = Array.isArray(allowedTools) ? allowedTools : String(allowedTools).split(/\s+/);
  for (const t of toks) {
    const m = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(t.trim());
    if (!m) continue;   // built-in (WebFetch) or malformed → not a codex server tool
    const [, server, tool] = m;
    (out[server] ||= []).push(tool);
  }
  return out;
}

// The engine-local fetch server (fetch_url) that stands in for claude's built-in WebFetch — codex has none.
// Injected whenever the stage's allowedTools carry WebFetch (the caselaw / EUR-Lex leg).
const FETCH_SERVER = join(dirname(fileURLToPath(import.meta.url)), "fetch-server.mjs");
export function webFetchRequested(allowedTools) {
  const toks = Array.isArray(allowedTools) ? allowedTools : String(allowedTools || "").split(/\s+/);
  return toks.includes("WebFetch");
}

// ── render the full config.toml ──────────────────────────────────────────────────────────────────────
// developerInstructions → the top-level `developer_instructions` append (WRITE_DISCIPLINE lives here so
// the shared stage prompts are never mutated — parity with claude's --append-system-prompt).
// toolTimeoutSec → codex's PER-CALL `tool_timeout_sec`, distinct from `startup_timeout_sec` (which is
// how long a server may take to COME UP).: without it codex applies its own default — measured at
// 300s — and a dictated plan that outlives it dies with no band written, while the stage that awaited it
// still had most of its budget left. A 2026-08-12 run recorded `"timeoutSec": 1500` on the stage and the
// tool call timing out at 300s: a 25-minute budget existed and never reached the tool layer.
//
// The caller passes the TURN'S REMAINING BUDGET, not a constant. A bigger constant would only move the
// cliff — the largest dictated plan seen so far, an `incumbent-class` plan, is 26 entries, so any number
// chosen to fit it fails on the first scenario that dictates 40. A tool call cannot usefully outlive the
// turn that is awaiting it, so the turn's own budget is the honest ceiling and the child's hard wall
// stays the backstop. Absent/0/negative ⇒ emit nothing and leave codex's default alone, so this is inert
// for any caller that does not thread a budget.
export function renderCodexConfigToml({ mcpConfig, allowedTools, developerInstructions, nodeBin = process.execPath, credEnvForward = CRED_ENV_FORWARD, toolTimeoutSec, fence = null, withheldFromCommands = [] } = {}) {
  const servers = parseClaudeMcpServers(mcpConfig);
  const enabled = enabledToolsByServer(allowedTools);
  const toolTimeout = Number(toolTimeoutSec) > 0 ? Math.floor(Number(toolTimeoutSec)) : undefined;
  const lines = [];
  if (developerInstructions) lines.push(`developer_instructions = ${tomlString(developerInstructions)}`, "");
  // Top-level, so above the first table: TOML reads a bare key after a table header as that table's.
  if (fence) lines.push(`default_permissions = ${tomlString(FENCE_PROFILE)}`, "");
  lines.push(...commandEnvToml(withheldFromCommands));

  const emitServer = (name, s, { forwardCreds } = {}) => {
    lines.push(`[mcp_servers.${/^[A-Za-z0-9_-]+$/.test(name) ? name : tomlString(name)}]`);
    lines.push(`command = ${tomlString(s.command)}`);
    lines.push(`args = ${tomlStringArray(s.args)}`);
    // Non-secret per-run values ride `env` (session key, ledger paths — exactly what the claude path put
    // in the server env). Secret creds are NOT written; they forward by NAME via env_vars (inheritance).
    const envKeys = Object.keys(s.env || {});
    if (envKeys.length) lines.push(`env = { ${envKeys.map((k) => `${k} = ${tomlString(s.env[k])}`).join(", ")} }`);
    if (forwardCreds && credEnvForward?.length) lines.push(`env_vars = ${tomlStringArray(credEnvForward)}`);
    if (s.startupTimeoutSec) lines.push(`startup_timeout_sec = ${s.startupTimeoutSec}`);
    // Per-call, and deliberately on EVERY server including the engine-local fetch one: the cap belongs to
    // the turn's budget, not to any one server's reputation for being slow.
    if (toolTimeout) lines.push(`tool_timeout_sec = ${toolTimeout}`);
    // A SERVER GRANTED WHOLE GETS NO LIST. On claude `mcp__<server>__*` means every tool that server
    // serves, and the case-law step's two bridges are granted that way (gather-config's `allowedToolsFor`).
    // codex matches `enabled_tools` by exact name, so the `["*"]` this once wrote named no tool, both
    // bridges came up offering nothing, and on this engine the case-law step read EUR-Lex alone. With no
    // list, codex offers every tool the server serves, which is what the grant says.
    if (s.enabledTools?.length && !s.enabledTools.includes("*")) lines.push(`enabled_tools = ${tomlStringArray(s.enabledTools)}`);
    // APPROVED, ON EVERY BLOCK THIS FUNCTION WRITES. `codex exec` runs with the approval policy `never`,
    // and under the default per-server mode (`auto`) a tool that is not read-only needs approval when it
    // is open-world, or when destructive or open-world is left unmarked. The register search tool is
    // marked open-world, so with the sandbox on every call to it was refused ("MCP tool call requires
    // approval, but approval policy is never") and the register was never queried. `approve` is the
    // documented value that lets a server's tools through
    // (https://learn.chatgpt.com/docs/config-file/config-reference, `default_tools_approval_mode`).
    //
    // WHAT IT REACHES: only the servers in this per-turn file, which are the ones the stage is granted
    // plus the fetch server, each narrowed by its enabled_tools list, except a server granted whole, which
    // offers every tool it serves, as it does on claude. WHAT IT DOES NOT: shell commands.
    // Those stay under the stage's permission profile (`fenceToml`, below), and under the policy `never` a
    // command that asks to leave the sandbox is still refused.
    lines.push(`default_tools_approval_mode = "approve"`);
    lines.push("");
  };

  for (const [name, s] of Object.entries(servers)) emitServer(name, { ...s, enabledTools: enabled[name] }, { forwardCreds: true });

  // WebFetch → the engine-local fetch server (codex has no built-in). Needs no creds (no env_vars).
  if (webFetchRequested(allowedTools))
    emitServer("fetch", { command: nodeBin, args: [FETCH_SERVER], env: {}, enabledTools: ["fetch_url"] }, { forwardCreds: false });

  if (fence) lines.push(...fenceToml(fence));
  return lines.join("\n").trimEnd() + "\n";
}

// ── what the stage's shell commands inherit ─────────────────────────────────────────────────────────
// Codex hands a command its own whole environment by default: `inherit` is `all`, and it keeps names
// containing KEY, SECRET or TOKEN unless told otherwise (the vendor's Advanced Configuration page). The
// program holds the register and research keys because its tool servers read them, so without this every
// command a stage ran could print them, with or without the sandbox. Each name the caller withholds is
// written as an `exclude` filter, which removes it from commands and from nothing else: codex builds a
// server's environment from its own short default list plus that server's `env_vars`, read from the
// program's environment, never from what its commands get (codex-rs `create_env_for_mcp_server`, the same
// in 0.154.0 and 0.156.1).
//
// Filter names are matched without regard to case, and codex refuses the whole file if two of them are
// the same name in different case, so each name is written once whatever its case.
export function commandEnvToml(withheld = []) {
  const seen = new Set();
  const names = (withheld ?? []).filter((n) => n && !seen.has(n.toUpperCase()) && seen.add(n.toUpperCase()));
  if (!names.length) return [];
  return ["[shell_environment_policy.filters]", ...names.map((n) => `${tomlString(n)} = "exclude"`), ""];
}

// ── the stage's permission profile: what its shell commands may read and write ──────────────────────
// codex's `workspace-write` sandbox confines where a command WRITES and lets it read the whole disk, the
// install's settings files and the program's own sign-in included. A permission profile confines reading
// too (the vendor's Permissions guide, a beta feature since 0.138.0; the floor is 0.154.0): a stage's
// commands read the platform's own paths, the instruction trees and the temp folders, and write the run
// folder, their working folder and the temp folders. Nothing else is readable, so a page a stage fetched
// cannot get a command to print the account's files. The temp folders stay writable because
// `workspace-write` let commands use them and stages write their output through the shell.
//
// ONLY WITH THE SANDBOX ON. Under the bypass codex builds no sandbox, so a profile would enforce nothing;
// the caller passes no `fence` then, and the file stays what it was. With the sandbox on the command line
// must carry no `--sandbox`, or codex "uses those older sandbox settings instead of default_permissions"
// (Permissions guide) and the fence is off without a word; `buildCodexArgs` holds that.
//
// CLEAROTRON'S OWN CODEX FOLDERS ARE NOT IN THE TEMP FOLDER, so nothing here grants them. Each turn's
// CODEX_HOME holds its sign-in (a link to the saved one, or a copy where Windows refuses links) and its
// session record; they live in the account's own cache folder (openai-agent.mjs, `codexHomesRoot`), which
// this profile never names. Not a refusal of their names inside the temp folder: codex scans a folder
// before it applies a wildcard refusal there, and in a shared temp folder one entry the account cannot
// read fails the whole turn (measured, 0.156.1).
export const FENCE_PROFILE = "clearotron-stage";
export function fenceToml({ runDir = null, readRoots = [] } = {}) {
  const key = (p) => tomlString(p);
  const out = [`[permissions.${FENCE_PROFILE}.filesystem]`,
    `":minimal" = "read"`, `":tmpdir" = "write"`, `":slash_tmp" = "write"`];
  for (const r of [...new Set(readRoots.filter(Boolean))]) out.push(`${key(r)} = "read"`);
  if (runDir) out.push(`${key(runDir)} = "write"`);
  out.push("", `[permissions.${FENCE_PROFILE}.filesystem.":workspace_roots"]`, `"." = "write"`, "");
  return out;
}
