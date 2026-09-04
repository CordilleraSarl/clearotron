#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// OAuth-aware MCP stdio bridge — adapter between a stdio MCP client and remote
// MCP servers that require OAuth 2.1 authentication.
//
// Drop it when your client lands native remote-MCP OAuth: this whole directory
// exists only because the clients in front of it speak stdio and cannot hold a
// token themselves. Nothing here is specific to one client.
//
// Usage:
//   node bridge.mjs --server <name> [--creds-dir <path>]
//
// Pre-requisite: tokens must already exist at <creds-dir>/<server>.json,
// seeded one-time via `mcporter auth <server>` followed by `bootstrap.mjs`.
// See README.md.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
// — the audit line is written SYNCHRONOUSLY inside the call handler: an await here would put the
// log on a different tick from the call it describes, and a process that exits mid-call would lose it.
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { RefreshLock } from "./refresh-lock.mjs";
import { exitOnStdinClose } from "./stdin-guard.mjs";

// Creds dir: env-overridable (OAUTH_BRIDGE_CREDS_DIR). An existing deployment migrating from the
// origin monorepo keeps its credentials by pointing this at the old ~/.config/clawdi/oauth-mcp.
const DEFAULT_CREDS_DIR = process.env.OAUTH_BRIDGE_CREDS_DIR || path.join(homedir(), ".config", "trademark-oauth-mcp");

// Per-server tool allowlist. Upstream MCP servers may add or rename tools
// without notice — we explicitly opt in. To add a tool: verify it's read-only
// (or otherwise intended for clawdi use) against the upstream API docs, then
// add the unprefixed upstream name below and restart the bridge.
const ALLOWED_TOOLS = {
  courtlistener: new Set([
    "analyze_citations",
    "call_endpoint",
    "create_search_alert",
    "delete_search_alert",
    "extract_citations",
    "get_choices",
    "get_counts",
    "get_endpoint_item",
    "get_endpoint_schema",
    "get_more_results",
    "resume_citation_analysis",
    "search",
    "subscribe_to_docket_alert",
    "unsubscribe_from_docket_alert",
  ]),
  legaldatahunter: new Set([
    "discover_countries",
    "discover_sources",
    "get_document",
    "get_filters",
    "report_source_issue",
    "resolve_reference",
    "search",
  ]),
};

function parseArgs(argv) {
  const out = { server: null, credsDir: DEFAULT_CREDS_DIR };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--server") out.server = argv[++i];
    else if (argv[i] === "--creds-dir") out.credsDir = argv[++i];
    else if (argv[i] === "--help" || argv[i] === "-h") {
      console.error("Usage: bridge.mjs --server <name> [--creds-dir <path>]");
      process.exit(0);
    }
  }
  return out;
}

const { server: serverName, credsDir } = parseArgs(process.argv.slice(2));
if (!serverName) {
  console.error("Error: --server <name> is required.");
  console.error("Usage: bridge.mjs --server <name> [--creds-dir <path>]");
  process.exit(2);
}

const credsPath = path.join(credsDir, `${serverName}.json`);

const allowedTools = ALLOWED_TOOLS[serverName];
if (!allowedTools) {
  console.error(
    `Error: server "${serverName}" has no ALLOWED_TOOLS entry. Add a tool list to bridge.mjs ALLOWED_TOOLS and restart.`,
  );
  process.exit(2);
}

async function loadCreds() {
  let raw;
  try {
    raw = await readFile(credsPath, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") {
      throw new Error(
        `No credentials at ${credsPath}. Run providers/oauth-mcp-bridge/bootstrap.mjs --server ${serverName} after completing OAuth via mcporter.`,
      );
    }
    throw e;
  }
  const parsed = JSON.parse(raw);
  if (!parsed.serverUrl) {
    throw new Error(`Credentials at ${credsPath} missing required field: serverUrl`);
  }
  return parsed;
}

async function saveCreds(creds) {
  await mkdir(path.dirname(credsPath), { recursive: true, mode: 0o700 });
  // Atomic write: a sibling bridge process may read this file at any moment
  // (see tokens() read-through). Write a pid-scoped temp then rename — rename is
  // atomic on the same filesystem, so readers never see a half-written file.
  const tmp = `${credsPath}.tmp.${process.pid}`;
  await writeFile(tmp, JSON.stringify(creds, null, 2), { mode: 0o600 });
  await rename(tmp, credsPath);
}

// Cross-process refresh serialization. A stdio client spawns one bridge process PER
// agent session, so many processes share this single on-disk credential file.
// CourtListener (Django OAuth Toolkit) and LDH ROTATE the refresh token on every
// refresh and revoke the whole token family if an already-consumed refresh token
// is re-presented (reuse detection). Without coordination, two processes
// refreshing the same token at once trip that and permanently brick the
// credentials (invalid_grant on every spawn). The lock serializes refreshes and
// we re-read the freshest token under it (see prepareTokenRequest), so each
// process always refreshes a CURRENT token, never a consumed one.
const refreshLock = new RefreshLock(`${credsPath}.lock`);

// Last-resort release if the process exits while holding the lock.
process.on("exit", () => refreshLock.releaseSync());

// Orphan self-termination: when the MCP client that spawned us dies, our stdin closes — exit instead
// of holding the upstream HTTP transport (and any in-flight upstream call) open forever (see
// stdin-guard.mjs for the 3.5-day PPID-1 orphan this closes). The 'exit' hook above releases the
// refresh lock on the way out.
exitOnStdinClose({ name: `clawdi-oauth-bridge:${serverName}` });

class CachedOAuthProvider {
  constructor(initialCreds) {
    this._creds = initialCreds;
  }
  // Non-interactive: never redirect for authorization.
  get redirectUrl() {
    return undefined;
  }
  get clientMetadata() {
    return (
      this._creds.clientInfo?.metadata ?? {
        client_name: process.env.OAUTH_BRIDGE_CLIENT_NAME || "trademark-oauth-mcp-bridge",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        redirect_uris: [],
        scope: this._creds.scope ?? "",
        token_endpoint_auth_method:
          this._creds.clientInfo?.token_endpoint_auth_method ?? "client_secret_post",
      }
    );
  }
  async clientInformation() {
    return this._creds.clientInfo;
  }
  async saveClientInformation(info) {
    this._creds.clientInfo = info;
    await saveCreds(this._creds);
  }
  // Best-effort: re-read the on-disk creds so this process always sees a
  // sibling's most recent refresh. Keeps in-memory creds on any read error.
  async _reloadFromDisk() {
    try {
      const parsed = JSON.parse(await readFile(credsPath, "utf8"));
      if (parsed?.tokens) this._creds = parsed;
    } catch {
      /* file mid-rename or unreadable — keep what we have */
    }
  }
  // Read-through: the transport calls this before every request to attach the
  // bearer. Serving the freshest on-disk access token means once ANY sibling
  // refreshes, the others stop 401ing and never start their own racing refresh.
  async tokens() {
    await this._reloadFromDisk();
    return this._creds.tokens;
  }
  // Non-interactive grant: when the access token has expired the SDK's auth flow
  // (auth.js fetchToken) calls this to build the token request. We hand back a
  // refresh_token grant; executeTokenRequest applies client_secret_post auth from
  // clientInformation() automatically. Returning undefined (no refresh token cached)
  // falls through to the SDK's clear "authorizationCode is required" error, which
  // signals the creds must be re-bootstrapped.
  async prepareTokenRequest(scope) {
    // Serialize the refresh across the bridge fleet, then re-read the freshest
    // refresh token under the lock so we never re-present a consumed one (which
    // would trigger upstream reuse-detection and brick the whole token family).
    // The lock is released by saveTokens() on success, or by main()'s catch /
    // the exit handler on failure.
    await refreshLock.acquire();
    await this._reloadFromDisk();
    const refresh = this._creds.tokens?.refresh_token;
    if (!refresh) {
      await refreshLock.release();
      return undefined; // → SDK "authorizationCode is required" → re-bootstrap
    }
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refresh,
    });
    if (scope) params.set("scope", scope);
    return params;
  }
  async saveTokens(tokens) {
    // Merge, don't replace: a refresh response often omits refresh_token, and the
    // fetchToken path (unlike refreshAuthorization) does not auto-preserve it — so a
    // blind replace would leave the next refresh with no refresh_token.
    this._creds.tokens = { ...this._creds.tokens, ...tokens };
    await saveCreds(this._creds);
    await refreshLock.release();
    process.stderr.write(
      `[oauth-bridge:${serverName}] tokens refreshed (expires_in=${tokens.expires_in ?? "?"})\n`,
    );
  }
  async redirectToAuthorization() {
    throw new Error(
      `Interactive OAuth not supported in bridge. Re-run mcporter auth ${serverName} on a workstation with browser, then re-bootstrap creds.`,
    );
  }
  async saveCodeVerifier() {
    // Not used in non-interactive flow but SDK may call during refresh setup.
  }
  async codeVerifier() {
    throw new Error("Code verifier not available — bridge is non-interactive.");
  }
}

// ── — THE AUDIT LINE. What was asked, and the SHAPE of what came back. ──────────────────────────
//
// The case-law lane could prove a call happened (`_driver/tool-calls.jsonl` writes server/tool/ok) and
// could not show what it was for. `stages.mjs`'s own contract declaration has recorded that for months:
// `citations[].url` and `citations[].proceeding` are `mechanical:tool-written`, "blocked by the call-log
// absence", on the surface the same file calls "the highest-stakes hallucination surface in the
// workflow". This is that log — the same file, shape and best-effort rule as the driver's band server,
// which has done this for the band tools since the reading layer was built.
//
// THIS IS NOT DISTRUST OF THE SEAT. It makes its account CHECKABLE, which is what lets a later round
// trust it cheaply instead of re-deriving it.
//
// THE RUN DIR IS OPTIONAL BY DESIGN. A bridge started outside a run (the warm server, a bootstrap, a
// developer's shell) has none and simply does not log. No run dir, no line, never a throw.
const AUDIT_RUN_DIR = process.env.CLEAROTRON_BAND_RUN_DIR || "";
const AUDIT_SESSION = process.env.CLEAROTRON_GATHER_SESSION_KEY || "";
const AUDIT_AGENT = process.env.CLEAROTRON_GATHER_AGENT || "";

// REDACTED BY KEY NAME, because this bridge is GENERIC. Today it proxies two case-law servers whose
// arguments are search parameters; tomorrow it proxies something whose arguments are not. A bridge that
// writes whatever it is handed into a run directory is one upstream tool away from logging a
// credential, and the run dir is read by people and shipped in tarballs.
const SECRET_KEY_RE = /token|secret|password|credential|api[_-]?key|authorization|bearer/i;
function redact(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return args ?? null;
  const out = {};
  for (const [k, v] of Object.entries(args)) out[k] = SECRET_KEY_RE.test(k) ? "[redacted]" : v;
  return out;
}

/** The size of the answer, never the answer. */
function resultBytes(res) {
  try { return JSON.stringify(res ?? null).length; } catch { return null; }
}

function logCall(server, tool, args, result) {
  if (!AUDIT_RUN_DIR) return;
  try {
    const p = driverDir(AUDIT_RUN_DIR, "reading-log.jsonl");
    mkdirSync(path.dirname(p), { recursive: true });
    appendFileSync(p, JSON.stringify({
      ts: new Date().toISOString(), tool: `${server}__${tool}`, args: redact(args), ...result,
      ...(AUDIT_SESSION ? { session: AUDIT_SESSION } : {}), ...(AUDIT_AGENT ? { agent: AUDIT_AGENT } : {}),
    }) + "\n");
  } catch { /* best-effort — a log failure must never break a lookup */ }
}

async function main() {
  const creds = await loadCreds();
  const authProvider = new CachedOAuthProvider(creds);

  // Upstream: remote OAuth-protected MCP server.
  const transport = new StreamableHTTPClientTransport(new URL(creds.serverUrl), {
    authProvider,
  });
  const upstream = new Client(
    { name: "trademark-oauth-bridge-client", version: "0.1.0" },
    { capabilities: {} },
  );
  await upstream.connect(transport);
  process.stderr.write(
    `[oauth-bridge:${serverName}] connected to ${creds.serverUrl}\n`,
  );

  // Downstream: local stdio MCP server, exposed to the client that spawned us.
  const downstream = new Server(
    { name: `trademark-bridge-${serverName}`, version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  downstream.setRequestHandler(ListToolsRequestSchema, async () => {
    const upstreamResp = await upstream.listTools();
    const upstreamTools = upstreamResp?.tools ?? [];
    const tools = upstreamTools.filter((t) => allowedTools.has(t.name));
    const dropped = upstreamTools
      .filter((t) => !allowedTools.has(t.name))
      .map((t) => t.name);
    if (dropped.length) {
      process.stderr.write(
        `[oauth-bridge:${serverName}] filtered ${dropped.length} unlisted upstream tool(s) from ListTools: ${dropped.join(", ")}\n`,
      );
    }
    return { ...upstreamResp, tools };
  });

  downstream.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    if (!allowedTools.has(name)) {
      process.stderr.write(
        `[oauth-bridge:${serverName}] rejected CallTool for unlisted upstream tool: ${name}\n`,
      );
      logCall(serverName, name, req.params.arguments, { ok: false, error: "not in bridge allowlist" });
      throw new Error(
        `Tool "${name}" is not in the bridge allowlist for ${serverName}. To enable it, add the unprefixed upstream name to ALLOWED_TOOLS in bridge.mjs and restart.`,
      );
    }
    try {
      const res = await upstream.callTool({ name, arguments: req.params.arguments });
      logCall(serverName, name, req.params.arguments, { ok: true, bytes: resultBytes(res) });
      return res;
    } catch (err) {
      // A FAILED CALL IS LOGGED TOO, and it is the half that matters: without it, "the search ran and
      // found nothing" and "the search errored" leave the same trace — the ambiguity is about.
      logCall(serverName, name, req.params.arguments, { ok: false, error: String(err?.message ?? err).slice(0, 200) });
      throw err;
    }
  });

  const stdio = new StdioServerTransport();
  await downstream.connect(stdio);
  process.stderr.write(`[oauth-bridge:${serverName}] stdio ready\n`);
}

main().catch(async (err) => {
  // Release the refresh lock so a dying process never blocks the rest of the
  // fleet for a full lease.
  await refreshLock.release().catch(() => {});
  const text = `${err?.name ?? ""} ${err?.message ?? ""} ${err?.stack ?? ""}`;
  if (/invalid_grant|InvalidGrantError/i.test(text)) {
    // Distinct, greppable signal: the cached refresh token is dead and only a
    // re-bootstrap recovers it. Surfaced here so the next occurrence is obvious
    // instead of buried as a generic MCP -32000 in agent logs.
    process.stderr.write(
      `[oauth-bridge:${serverName}] REFRESH TOKEN REVOKED — re-bootstrap required. ` +
        `Cached refresh token at ${credsPath} is invalid_grant; run the manual DCR+PKCE recipe in ` +
        `providers/oauth-mcp-bridge/README.md, then redeploy.\n`,
    );
  } else {
    process.stderr.write(
      `[oauth-bridge:${serverName}] fatal: ${err?.stack ?? err}\n`,
    );
  }
  process.exit(1);
});
