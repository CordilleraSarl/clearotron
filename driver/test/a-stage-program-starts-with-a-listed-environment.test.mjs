// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A STAGE'S PROGRAM STARTS WITH A LIST, NOT WITH THE INSTALL'S SETTINGS FILE.
//
// Both adapters used to start `claude` and `codex` with a copy of the driver's environment minus a key or
// two. The driver's environment is the settings file, so the program, and every tool server it started,
// held the key that signs access tokens. engine-env.mjs replaced the copy with a list. These arms hold it:
//
//   1. the list itself is pinned here, name by name, so a setting added to it is a reviewed diff to this
//      file as well, and never a quiet widening;
//   2. under every engine and billing mode, fed every setting the product reads plus the secrets, the
//      program's environment carries nothing the pinned list does not admit;
//   3. every name the tool servers read is either handed to them, written into their own entry by
//      gather-config, or named below as not needed with the reason; a server that starts reading a new
//      setting fails this until someone decides which;
//   4. a real start through each adapter, against the mocks, carries the list and not the secrets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, rmSync, readdirSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  engineEnv, toolServerNames, RUNTIME_NAMES, RUNTIME_PREFIXES, NETWORK_NAMES, CLAUDE_PREFIXES, CLAUDE_NAMES,
  CLOUD_NAMES, CLOUD_PREFIXES, CODEX_NAMES, TOOL_SERVER_SETTINGS, TEST_PREFIXES,
} from "../engine/engine-env.mjs";
import { CLOUD_SETTINGS } from "../engine/auth.mjs";
import { CRED_ENV_FORWARD } from "../engine/mcp/codex-config.mjs";
import { PROVIDERS, RESEARCH_PROVIDERS, SERP_PROVIDERS, ENGINE_BINARIES } from "../driver.config.mjs";
import { buildGatherMcpConfig, toolGroupsForStage } from "../engine/mcp/gather-config.mjs";
import { auditEnv, namesRead, envNameBindings, mergeEnvNameBindings } from "../../scripts/env-audit.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");

// ── 1. THE LIST, PINNED ─────────────────────────────────────────────────────────────────────────────
test("the program's environment list is exactly this, group by group", () => {
  assert.deepEqual([...RUNTIME_NAMES], [
    "PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LANGUAGE", "TZ", "TMPDIR", "TMP", "TEMP", "TERM",
    "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_RUNTIME_DIR",
    "WSL_DISTRO_NAME", "WSL_INTEROP",
    "SYSTEMROOT", "WINDIR", "SYSTEMDRIVE", "COMSPEC", "PATHEXT", "USERPROFILE", "HOMEDRIVE", "HOMEPATH",
    "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "PROGRAMFILES",
  ]);
  assert.deepEqual([...RUNTIME_PREFIXES], ["LC_"]);
  assert.deepEqual([...NETWORK_NAMES], [
    "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "no_proxy", "all_proxy",
    "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR",
  ]);
  assert.deepEqual([...CLAUDE_PREFIXES], ["CLAUDE_", "ANTHROPIC_"]);
  assert.deepEqual([...CLAUDE_NAMES], [
    "DISABLE_TELEMETRY", "DISABLE_ERROR_REPORTING", "DISABLE_AUTOUPDATER", "DO_NOT_TRACK",
    "DISABLE_PROMPT_CACHING", "ENABLE_PROMPT_CACHING_1H", "ENABLE_TOOL_SEARCH",
    "API_TIMEOUT_MS", "API_FORCE_IDLE_TIMEOUT", "MCP_TIMEOUT", "MCP_TOOL_TIMEOUT", "MAX_MCP_OUTPUT_TOKENS",
    "MAX_THINKING_TOKENS", "NODE_TLS_REJECT_UNAUTHORIZED",
  ]);
  assert.deepEqual([...CLOUD_NAMES], [...CLOUD_SETTINGS, "GOOGLE_CLOUD_PROJECT", "GCLOUD_PROJECT", "CLOUD_ML_REGION"]);
  assert.deepEqual([...CLOUD_PREFIXES], ["AWS_", "VERTEX_REGION_", "CLOUDSDK_", "AZURE_"]);
  assert.deepEqual([...CODEX_NAMES], ["CODEX_CA_CERTIFICATE", "CODEX_SQLITE_HOME", "RUST_LOG"]);
  assert.deepEqual([...TOOL_SERVER_SETTINGS], [
    "CLARIVATE_API_BASE", "SIGNA_BASE_URL", "EUIPO_ENVIRONMENT", "SIGNA_FIXTURES_DIR", "CLAWDI_SIGNA_FIXTURES_DIR",
    "CLEAROTRON_HTTP_TIMEOUT_MS", "CLEAROTRON_BAND_RESPONSE_CHARS", "CLEAROTRON_ENUMERATE_NAMES_CHUNK",
    "OAUTH_BRIDGE_CREDS_DIR", "OAUTH_BRIDGE_CLIENT_NAME",
  ]);
  assert.deepEqual([...TEST_PREFIXES], ["MOCK_"]);
});

// What the pinned lists admit, computed here from the lists above and not from engineEnv, so that a
// second path inside engineEnv that let a name through would disagree with this and fail.
function admits(engine, mode) {
  const names = new Set([...RUNTIME_NAMES, ...NETWORK_NAMES]);
  const prefixes = [...RUNTIME_PREFIXES, ...TEST_PREFIXES];
  if (engine === "anthropic-agent") {
    for (const n of [...CLAUDE_NAMES, ...toolServerNames()]) names.add(n);
    prefixes.push(...CLAUDE_PREFIXES);
    if (mode === "cloud") { for (const n of CLOUD_NAMES) names.add(n); prefixes.push(...CLOUD_PREFIXES); }
  }
  if (engine === "openai-agent") {
    for (const n of [...CODEX_NAMES, ...toolServerNames()]) names.add(n);
    if (mode === "api-key") names.add("CODEX_API_KEY");
  }
  return (k) => names.has(k) || prefixes.some((p) => k.startsWith(p));
}

/** Every setting the product reads (the env audit's product rows), by name. */
const productNames = () => (auditEnv(ROOT)?.rows ?? []).filter((r) => r.product === true).map((r) => r.name);

/** Every name the product reads, set, plus the secrets and a setting nobody has written yet. */
function wholeInstall() {
  const env = {};
  for (const n of productNames()) env[n] = "set";
  Object.assign(env, {
    TRADEMARK_MCP_TOKEN_SECRET: "the-signing-key", TRADEMARK_MCP_TOKEN_SECRET_PREVIOUS: "the-old-signing-key",
    PORTAL_SECRET: "portal", PORTAL_OPS_TOKEN: "ops", A_SETTING_ADDED_NEXT_YEAR: "x", SOMETHING_SECRET: "x",
    ANTHROPIC_API_KEY: "sk-ant", CODEX_API_KEY: "sk-codex", OPENAI_API_KEY: "sk-openai", CLAUDE_CODE_OAUTH_TOKEN: "oauth",
    AWS_ACCESS_KEY_ID: "aws", GOOGLE_APPLICATION_CREDENTIALS: "/k.json", AZURE_CLIENT_SECRET: "az",
    PATH: "/usr/bin", HOME: "/home/x", LC_ALL: "C.UTF-8", HTTPS_PROXY: "http://proxy:3128",
  });
  return env;
}

// ── 2. NOTHING OUTSIDE THE LIST, UNDER ANY ENGINE OR BILLING MODE ─────────────────────────────────────
test("under every engine and billing mode the program gets the list and nothing else, and never the signing key", () => {
  const base = wholeInstall();
  assert.ok(Object.keys(base).length > 150, `the product reads too few names for this to mean anything: ${Object.keys(base).length}`);
  for (const engine of ["anthropic-agent", "openai-agent"]) {
    for (const mode of ["subscription", "api-key", "cloud"]) {
      const env = engineEnv({ ...base, CLEAROTRON_AI_BILLING: mode }, { engine });
      const ok = admits(engine, mode);
      const extra = Object.keys(env).filter((k) => !ok(k));
      assert.deepEqual(extra, [], `${engine}/${mode} let through names the list does not admit`);
      for (const secret of ["TRADEMARK_MCP_TOKEN_SECRET", "TRADEMARK_MCP_TOKEN_SECRET_PREVIOUS", "PORTAL_SECRET", "PORTAL_OPS_TOKEN", "A_SETTING_ADDED_NEXT_YEAR", "SOMETHING_SECRET", "OPENAI_API_KEY"])
        assert.equal(env[secret], undefined, `${engine}/${mode} carried ${secret}`);
      for (const needed of ["PATH", "HOME", "LC_ALL", "HTTPS_PROXY"])
        assert.equal(env[needed], base[needed], `${engine}/${mode} dropped ${needed}`);
    }
  }
});

test("each billing mode keeps its own credential and no other", () => {
  const base = wholeInstall();
  const claude = (mode) => engineEnv({ ...base, CLEAROTRON_AI_BILLING: mode }, { engine: "anthropic-agent" });
  const codex = (mode) => engineEnv({ ...base, CLEAROTRON_AI_BILLING: mode }, { engine: "openai-agent" });
  assert.equal(claude("api-key").ANTHROPIC_API_KEY, "sk-ant");
  for (const mode of ["subscription", "cloud", "not-a-mode"]) assert.equal(claude(mode).ANTHROPIC_API_KEY, undefined, mode);
  // The headless sign-in token, under the name the engine table gives it, travels in every mode.
  for (const mode of ["subscription", "api-key", "cloud"])
    assert.equal(claude(mode)[ENGINE_BINARIES["anthropic-agent"].headless.tokenEnv], "oauth", mode);
  // A cloud's own credentials only when this install bills through a cloud.
  for (const k of ["AWS_ACCESS_KEY_ID", "GOOGLE_APPLICATION_CREDENTIALS", "AZURE_CLIENT_SECRET"]) {
    assert.equal(claude("cloud")[k], base[k], k);
    assert.equal(claude("subscription")[k], undefined, k);
    assert.equal(claude("api-key")[k], undefined, k);
  }
  assert.equal(codex("api-key").CODEX_API_KEY, "sk-codex");
  assert.equal(codex("subscription").CODEX_API_KEY, undefined);
  for (const mode of ["subscription", "api-key"]) {
    assert.equal(codex(mode).ANTHROPIC_API_KEY, undefined, mode);
    assert.equal(codex(mode).CLAUDE_CODE_OAUTH_TOKEN, undefined, mode);
  }
});

test("every credential a provider table names reaches both programs, because their tool servers read it", () => {
  const names = [PROVIDERS, RESEARCH_PROVIDERS, SERP_PROVIDERS].flatMap((t) => Object.values(t))
    .flatMap((p) => [p.credEnv, ...(p.credEnvAlso ?? [])]).filter(Boolean);
  assert.ok(names.length >= 6, `the provider tables name too few credentials: ${names}`);
  const base = Object.fromEntries([...names, ...CRED_ENV_FORWARD].map((n) => [n, `value-of-${n}`]));
  for (const engine of ["anthropic-agent", "openai-agent"]) {
    const env = engineEnv(base, { engine });
    for (const n of [...names, ...CRED_ENV_FORWARD]) assert.equal(env[n], base[n], `${engine} dropped ${n}`);
  }
});

test("the test mocks' prefix admits no setting the product reads", () => {
  const product = productNames();
  assert.ok(product.length > 150, `too few product names to judge: ${product.length}`);
  const clash = product.filter((n) => TEST_PREFIXES.some((p) => n.startsWith(p)));
  assert.deepEqual(clash, [], "a product setting under a test prefix would reach every stage's program");
});

// ── 3. WHAT THE TOOL SERVERS READ ────────────────────────────────────────────────────────────────────
//
// On the Claude engine the servers inherit the program's environment, so a name a server reads and the
// list leaves out reaches that server as unset. Codex hands its servers only their own entries and the
// forward list, and production searches on Codex, so a name Codex has never forwarded is known not to be
// needed by a tool. Those are listed here with that reason; anything else a server reads must be passed.

/** Read by modules the servers import for their tables and defaults; no tool needs it. */
const NOT_A_TOOL_SETTING = "read at module top by a module the servers import for its tables; Codex has never forwarded it to a server, and searches run there";
const NOT_PASSED = Object.freeze(Object.fromEntries([
  "CLEAROTRON_AI", "CLEAROTRON_AI_BILLING", "CLEAROTRON_CLAUDE_PATH", "CLEAROTRON_CODEX_PATH", "CLEAROTRON_ENGINES_DIR",
  "CLEAROTRON_DATABASE", "CLEAROTRON_DEFAULT_AGENT", "CLEAROTRON_INSTRUCTIONS_DIR", "CLEAROTRON_INVOKED_AS",
  "CLEAROTRON_MAX_CLAIM_AGE_MS", "CLEAROTRON_MAX_CONCURRENT_RUNS", "CLEAROTRON_MAX_RETRIES", "CLEAROTRON_ORDER_PROBE_SEED",
  "CLEAROTRON_OUTBOX_DIR", "CLEAROTRON_QUEUE_DIR", "CLEAROTRON_RATE_LIMIT_DEFAULT_BACKOFF_MS",
  "CLEAROTRON_RATE_LIMIT_PROBE_CEILING_MS", "CLEAROTRON_RATE_LIMIT_PROBE_MS", "CLEAROTRON_RECIPES_DIR",
  "CLEAROTRON_REPORTS_DIR", "CLEAROTRON_REPORTS_URL", "CLEAROTRON_RUN_LOCK_DIR", "CLEAROTRON_WORK_DIR",
  "CLEAROTRON_WORKSPACE_PREFIX", "CLEAROTRON_CARD_CONCURRENCY", "CLEAROTRON_GATHER_CONCURRENCY",
  "CLEAROTRON_MIN_FREE_DISK_MB", "CLEAROTRON_ACCESS_DOMAIN", "CLEAROTRON_UNREACHABLE_SENIOR", "CODEX_API_KEY",
  "INVOCATION_ID",
].map((n) => [n, NOT_A_TOOL_SETTING]).concat([
  ["CLEAROTRON_SUITE_TELEMETRY_DIR", "the driver resolves the ledgers under it and hands each server the resolved path by name"],
])));

/** The import closure of `entries`: static imports and literal dynamic ones, relative paths only. */
function closure(entries) {
  const seen = new Set();
  const stack = [...entries];
  const re = /(?:import\s[^'"]*?from\s*|import\s*\(\s*|export\s[^'"]*?from\s*|import\s*)["']([^"']+)["']/g;
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f) || !existsSync(f)) continue;
    seen.add(f);
    for (const m of readFileSync(f, "utf8").matchAll(re)) {
      if (!m[1].startsWith(".")) continue;
      let p = resolve(dirname(f), m[1]);
      if (!existsSync(p) && existsSync(`${p}.mjs`)) p = `${p}.mjs`;
      stack.push(p);
    }
  }
  return [...seen];
}

test("every setting a tool server reads is passed to it, written into its entry, or named as not needed", () => {
  const mcp = join(ROOT, "driver", "engine", "mcp");
  const servers = readdirSync(mcp).filter((f) => f.endsWith("-server.mjs")).map((f) => join(mcp, f));
  const entries = [...servers, join(ROOT, "providers", "oauth-mcp-bridge", "bridge.mjs")];
  assert.ok(servers.length >= 15, `found only ${servers.length} tool servers — the directory moved?`);
  const files = closure(entries);
  assert.ok(files.length >= 100, `the servers' import closure is only ${files.length} files — the walk is broken`);
  const texts = files.map((f) => readFileSync(f, "utf8"));
  const bindings = mergeEnvNameBindings(texts.map((t) => envNameBindings(t)));
  const read = new Map();
  files.forEach((f, i) => { for (const n of namesRead(texts[i], bindings)) read.set(n, relative(ROOT, f)); });
  assert.ok(read.size >= 40, `the servers read only ${read.size} names — the extractor is broken`);

  // What gather-config writes into each server's own entry, for every tool group it knows. Two of those
  // names it copies only when the driver has them, so they are set here for the look.
  const perServer = new Set();
  const lookEnv = { CLEAROTRON_DATABASE: "euipo", CLEAROTRON_GATHER_SESSION_ID: "id", EUIPO_ENVIRONMENT: "sandbox" };
  const saved = Object.fromEntries(Object.keys(lookEnv).map((k) => [k, process.env[k]]));
  Object.assign(process.env, lookEnv);
  try {
    for (const stage of ["register-unit:primary-sweep", "common-law", "case-law", "synthesis", "report-card", "register-digest", "narrative-refutation"]) {
      const cfg = buildGatherMcpConfig(toolGroupsForStage(stage), { sessionKey: "s", agent: "a", runDir: "/run", recordAxis: "x" });
      for (const s of Object.values(cfg?.mcpServers ?? {})) for (const k of Object.keys(s.env ?? {})) perServer.add(k);
    }
  } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
  assert.ok(perServer.has("CLEAROTRON_BAND_RUN_DIR") && perServer.has("CLEAROTRON_GATHER_SESSION_KEY"),
    `gather-config wrote no per-run names: ${[...perServer]}`);

  const passed = admits("anthropic-agent", "subscription");
  const unaccounted = [...read.keys()].filter((n) => !passed(n) && !perServer.has(n) && !(n in NOT_PASSED)).sort();
  assert.deepEqual(unaccounted, [], `tool servers read names nobody decided about: ${unaccounted.map((n) => `${n} (${read.get(n)})`).join(", ")}`);
  // Both directions: an entry below that no server reads any more, or that the list now passes, is stale.
  const stale = Object.keys(NOT_PASSED).filter((n) => !read.has(n) || passed(n)).sort();
  assert.deepEqual(stale, [], "entries in NOT_PASSED that no server reads, or that the list passes anyway");
});

// ── 4. A REAL START, THROUGH EACH ADAPTER ────────────────────────────────────────────────────────────
async function withEnv(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; pinEnv(process.env, k, env[k]); }
  try { return await fn(); }
  finally { for (const k of Object.keys(env)) { if (saved[k] === undefined) delete process.env[k]; else pinEnv(process.env, k, saved[k]); } }
}
const SECRETS = { TRADEMARK_MCP_TOKEN_SECRET: "the-signing-key", PORTAL_SECRET: "portal", A_SETTING_ADDED_NEXT_YEAR: "x" };
// WHAT A CHILD MUST START WITH, in its platform's own names. Windows spells PATH `Path` and ignores the
// case of every name, and its home directory is USERPROFILE, not HOME.
const onWindows = process.platform === "win32";
const HOME_NAME = onWindows ? "USERPROFILE" : "HOME";
const startedWith = (names, k) => (onWindows ? names.some((n) => n.toUpperCase() === k) : names.includes(k));

test("claude is started with the list: no signing key, and no command tool offered", async () => {
  const { anthropicAgentEngine } = await import("../engine/anthropic-agent.mjs");
  const dir = mkdtempSync(join(tmpdir(), "listed-env-claude-"));
  const log = join(dir, "calls.jsonl");
  try {
    const t = await withEnv({ ...SECRETS, CLEAROTRON_CLAUDE_PATH: join(HERE, "mock-claude.mjs"), MOCK_CLAUDE_CALL_LOG: log, CLEAROTRON_AI_BILLING: "subscription" },
      () => anthropicAgentEngine.runTurn({ message: "reply ok", model: "haiku", thinking: "low", timeoutSec: 60 }));
    assert.equal(t.code, 0, t.stderr);
    const call = JSON.parse(readFileSync(log, "utf8").trim().split("\n").pop());
    for (const k of Object.keys(SECRETS)) assert.ok(!call.envNames.includes(k), `claude was started with ${k}`);
    for (const k of ["PATH", HOME_NAME, "MOCK_CLAUDE_CALL_LOG"]) assert.ok(startedWith(call.envNames, k), `claude was started without ${k}`);
    const at = call.argv.indexOf("--disallowedTools");
    assert.ok(at > 0, `no --disallowedTools on: ${call.argv.join(" ")}`);
    assert.deepEqual(call.argv[at + 1].split(/[\s,]+/).sort(), ["Bash", "Monitor", "PowerShell"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("codex is started with the list: no signing key, and its key only because it bills by key", async () => {
  const { openaiAgentEngine } = await import("../engine/openai-agent.mjs");
  const dir = mkdtempSync(join(tmpdir(), "listed-env-codex-"));
  const log = join(dir, "calls.jsonl");
  try {
    const t = await withEnv({ ...SECRETS, CLEAROTRON_CODEX_PATH: join(HERE, "mock-codex.mjs"), MOCK_CODEX_CALL_LOG: log,
      CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-codex-test", OPENAI_API_KEY: "sk-openai-test" },
    () => openaiAgentEngine.runTurn({ message: "reply ok", model: "haiku", thinking: "low", timeoutSec: 60 }));
    assert.equal(t.code, 0, t.stderr);
    const call = JSON.parse(readFileSync(log, "utf8").trim().split("\n").pop());
    for (const k of [...Object.keys(SECRETS), "OPENAI_API_KEY"]) assert.ok(!call.envNames.includes(k), `codex was started with ${k}`);
    for (const k of ["PATH", HOME_NAME, "CODEX_HOME", "CODEX_API_KEY"]) assert.ok(startedWith(call.envNames, k), `codex was started without ${k}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
