// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// engine/engine-env.mjs — THE ENVIRONMENT THE AI PROGRAM STARTS WITH, AS A LIST OF WHAT IT MAY HAVE.
//
// Both adapters used to hand the program a copy of the driver's whole environment with one or two keys
// deleted. The driver's environment is the install's settings file: the key that signs every access
// token, the portal's own secrets, the access list, every register credential. The program runs the tools
// the model chooses, and it starts the stage's tool servers, which inherit from it. So a model that could
// read its own environment could read the signing key and mint a key for the install's doors.
//
// So the program gets a list, never a copy minus exceptions. A deny-list of secret names fails open on the
// next secret somebody adds; this fails closed: a setting nobody names here does not reach the program.
// Adding one is a diff to this file, where a reviewer sees it.
//
// WHAT IS ON IT, in five groups:
//   · the runtime: paths, home, user, shell, locale, temp, and the Windows names for the same things;
//   · the network: proxy settings and the certificate authorities they need;
//   · the program's own settings, in the vendor's namespace (`CLAUDE_*` and `ANTHROPIC_*` for Claude,
//     the documented `CODEX_*` names for Codex), plus the vendor-named switches that carry no prefix;
//   · the credential the billing mode keeps: the Anthropic key only under `api-key`, the Codex key only
//     under `api-key`, and a cloud's own credentials (AWS, Google, Azure) only under `cloud`;
//   · what the stage's tool servers read, because on the Claude engine they inherit this environment:
//     every register and research credential the provider tables name, and the few settings the servers
//     read to reach their register.
//
// WHAT IT DOES NOT PROMISE. A model that can READ FILES can still read whatever the account can, the
// settings file included. That is a question about the file tools, not about this list.

import { PROVIDERS, RESEARCH_PROVIDERS, SERP_PROVIDERS } from "../driver.config.mjs";
import { billingMode, CLOUD_SETTINGS } from "./auth.mjs";
import { CRED_ENV_FORWARD } from "./mcp/codex-config.mjs";

/** Paths, home, user, shell, locale and temp: what any program needs to start and find its own files. */
export const RUNTIME_NAMES = Object.freeze([
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LANGUAGE", "TZ", "TMPDIR", "TMP", "TEMP", "TERM",
  "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_RUNTIME_DIR",
  // The machine, not a secret: both programs read these to tell WSL from native Linux.
  "WSL_DISTRO_NAME", "WSL_INTEROP",
  // The same things on Windows. Matched without regard to case there (see `named`), because Windows spells
  // `Path` and `SystemRoot` as it likes and a program started without SYSTEMROOT cannot open a socket.
  "SYSTEMROOT", "WINDIR", "SYSTEMDRIVE", "COMSPEC", "PATHEXT", "USERPROFILE", "HOMEDRIVE", "HOMEPATH",
  "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "PROGRAMFILES",
]);
/** `LC_ALL`, `LC_CTYPE` and the rest of the locale family. */
export const RUNTIME_PREFIXES = Object.freeze(["LC_"]);

/** Proxy settings and the certificate authorities an intercepting proxy needs, in both spellings. */
export const NETWORK_NAMES = Object.freeze([
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "no_proxy", "all_proxy",
  "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR",
]);

/**
 * Claude's own settings. The vendor names its settings `CLAUDE_*` and `ANTHROPIC_*` (its sign-in folder,
 * the headless sign-in token, the model pins, a gateway, the cloud switches), plus a few with no prefix,
 * listed below from its settings and network pages. The Anthropic API key is in the namespace and is
 * handled by billing mode, below.
 */
export const CLAUDE_PREFIXES = Object.freeze(["CLAUDE_", "ANTHROPIC_"]);
export const CLAUDE_NAMES = Object.freeze([
  "DISABLE_TELEMETRY", "DISABLE_ERROR_REPORTING", "DISABLE_AUTOUPDATER", "DO_NOT_TRACK",
  "DISABLE_PROMPT_CACHING", "ENABLE_PROMPT_CACHING_1H", "ENABLE_TOOL_SEARCH",
  "API_TIMEOUT_MS", "API_FORCE_IDLE_TIMEOUT", "MCP_TIMEOUT", "MCP_TOOL_TIMEOUT", "MAX_MCP_OUTPUT_TOKENS",
  "MAX_THINKING_TOKENS", "NODE_TLS_REJECT_UNAUTHORIZED",
]);

/**
 * A cloud's own credentials and settings, passed only when this install bills Claude through a cloud.
 * `CLOUD_SETTINGS` is what setup writes; the prefixes carry the rest of each vendor's documented set
 * (Bedrock's `AWS_*`, Vertex's per-model `VERTEX_REGION_*`, gcloud's `CLOUDSDK_*`, an Azure sign-in's
 * `AZURE_*`). Outside `cloud` the program never reads them, and an operator's AWS keys for something else
 * have no business in a stage.
 */
export const CLOUD_NAMES = Object.freeze([
  ...CLOUD_SETTINGS, "GOOGLE_CLOUD_PROJECT", "GCLOUD_PROJECT", "CLOUD_ML_REGION",
]);
export const CLOUD_PREFIXES = Object.freeze(["AWS_", "VERTEX_REGION_", "CLOUDSDK_", "AZURE_"]);

/** Codex's own documented settings. CODEX_HOME is the adapter's, set per turn; CODEX_API_KEY is billing's. */
export const CODEX_NAMES = Object.freeze(["CODEX_CA_CERTIFICATE", "CODEX_SQLITE_HOME", "RUST_LOG"]);

/**
 * What the stage's tool servers read that the driver does not already hand each of them by name. Every
 * credential the provider tables name (so a register added to a table is covered by construction), the
 * names Codex forwards to them, and the settings they read to reach a register. Per-run values (the run
 * folder, the session, the ledgers) are not here: gather-config writes those into each server's own entry.
 */
export const TOOL_SERVER_SETTINGS = Object.freeze([
  "CLARIVATE_API_BASE", "SIGNA_BASE_URL", "EUIPO_ENVIRONMENT", "SIGNA_FIXTURES_DIR", "CLAWDI_SIGNA_FIXTURES_DIR",
  "CLEAROTRON_HTTP_TIMEOUT_MS", "CLEAROTRON_BAND_RESPONSE_CHARS", "CLEAROTRON_ENUMERATE_NAMES_CHUNK",
  // The case-law bridges: where their sign-in lives, and the name they register under.
  "OAUTH_BRIDGE_CREDS_DIR", "OAUTH_BRIDGE_CLIENT_NAME",
]);
export function toolServerNames() {
  const tables = [PROVIDERS, RESEARCH_PROVIDERS, SERP_PROVIDERS]
    .flatMap((t) => Object.values(t ?? {}))
    .flatMap((p) => [p?.credEnv, ...(Array.isArray(p?.credEnvAlso) ? p.credEnvAlso : [])]);
  return [...new Set([...tables, ...CRED_ENV_FORWARD, ...TOOL_SERVER_SETTINGS].filter(Boolean))].sort();
}

/**
 * The test mocks read their controls from `MOCK_*`. No product setting uses the prefix, and a test holds
 * that true, so the rule admits test controls and nothing an install configures.
 */
export const TEST_PREFIXES = Object.freeze(["MOCK_"]);

const onWindows = process.platform === "win32";
/** A lookup that ignores case on Windows, where the environment does too. */
const named = (list) => {
  const set = new Set(onWindows ? list.map((n) => n.toUpperCase()) : list);
  return (k) => set.has(onWindows ? k.toUpperCase() : k);
};
const prefixed = (list) => (k) => list.some((p) => (onWindows ? k.toUpperCase() : k).startsWith(p));

/**
 * The environment for one start of an engine program. PURE: `base` in, a new object out, nothing read
 * from or written to `process.env`. `engine` is `anthropic-agent` or `openai-agent`; any other name gets
 * the runtime and network groups alone.
 *
 * The billing word is read the one way it is read everywhere (auth.mjs `billingMode`), and never
 * validated here: the doors that validate it (the top of a stage, the probe, the jx runner) have already
 * run, and a function that builds a child's environment must not throw.
 */
export function engineEnv(base = process.env, { engine } = {}) {
  const mode = billingMode(base);
  const checks = [named(RUNTIME_NAMES), prefixed(RUNTIME_PREFIXES), named(NETWORK_NAMES), prefixed(TEST_PREFIXES)];
  if (engine === "anthropic-agent") {
    checks.push(prefixed(CLAUDE_PREFIXES), named(CLAUDE_NAMES), named(toolServerNames()));
    if (mode === "cloud") checks.push(named(CLOUD_NAMES), prefixed(CLOUD_PREFIXES));
  } else if (engine === "openai-agent") {
    checks.push(named(CODEX_NAMES), named(toolServerNames()));
  }
  const env = {};
  for (const [k, v] of Object.entries(base ?? {})) {
    if (v === undefined) continue;
    if (checks.some((ok) => ok(k))) env[k] = v;
  }
  // The billing credential, by mode. The Anthropic key rides only under `api-key`: a present key overrides
  // the subscription and bills per token, and under `cloud` a leftover key must never be what bills.
  // Codex's key rides only under `api-key` too; under the subscription the adapter seeds the sign-in file.
  if (engine === "anthropic-agent" && mode !== "api-key") delete env.ANTHROPIC_API_KEY;
  if (engine === "openai-agent" && mode === "api-key" && base?.CODEX_API_KEY !== undefined) env.CODEX_API_KEY = base.CODEX_API_KEY;
  return env;
}
