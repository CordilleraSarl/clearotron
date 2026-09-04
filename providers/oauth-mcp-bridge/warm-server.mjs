#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Warm, long-lived streamable-HTTP MCP proxy for an OAuth-protected upstream.
//
// Why this exists (vs the per-session stdio bridge.mjs)
// -----------------------------------------------------
// A stdio client spawns bridge.mjs ONCE PER agent session. CourtListener issues a
// ~1h access token, so the whole per-session bridge fleet refreshes constantly,
// and CourtListener (Django OAuth Toolkit) ROTATES the refresh token on every
// refresh and REVOKES the whole family if an already-consumed refresh token is
// re-presented (reuse detection). Two failure modes then brick the credentials
// (invalid_grant on every spawn afterwards):
//   1. two per-session processes refreshing at the same instant, and
//   2. a refresh where the server rotates the token but the process never
//      persists the new one — killed by the gateway's connect timeout mid-
//      refresh, crashed, or the response lost — stranding a CONSUMED refresh
//      token on disk for the next spawn to re-present.
// bridge.mjs's cross-process file lock only addresses (1), and only across
// separate processes. This warm server removes the whole class: ONE long-lived
// process, so there is no per-session spawn storm and no per-session kill window;
// it SERIALIZES all upstream access (so a refresh can never race another) and
// refreshes PROACTIVELY on a schedule (off the request critical path). The token
// lifecycle lives in one in-memory owner, persisted atomically to the same cache
// file bridge.mjs uses.
//
// A client connects to it by URL (mcp.servers.courtlistener = {url, transport:
// streamable-http}) — the same shape as the warm ghostfolio/openbb services
// (scripts/mcp-http) and the remote agentskills server. Drop this when the client
// lands native remote-MCP OAuth.
//
// Usage:
//   node warm-server.mjs --server <name> --port <n> [--host 127.0.0.1] [--creds-dir <path>]
//
// NOTE: the OAuth provider + creds I/O + allowlist are intentionally re-stated
// here rather than shared with bridge.mjs, to keep bridge.mjs byte-identical so
// the still-per-session legaldatahunter bridge is provably unaffected by this
// change. A later refactor can extract a common module once the warm model is
// proven for courtlistener.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  isInitializeRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import http from "node:http";
import path from "node:path";
import { listenOrDie } from "../../shared/listen.mjs";   // — a taken port is a sentence, not a stack

const DEFAULT_CREDS_DIR = path.join(homedir(), ".config", "clawdi", "oauth-mcp");

// Per-server tool allowlist — upstream servers may add/rename tools without
// notice, so we explicitly opt in. Kept in sync with bridge.mjs ALLOWED_TOOLS.
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

// Refresh proactively this many ms after a token's expires_in, via the SDK's
// proven on-401 refresh path (a scheduled keep-warm request), so idle periods
// never leave the cached access token expired for long and the refresh happens
// off any user request's critical path.
const KEEPWARM_AFTER_EXPIRY_MS = 30_000;
const KEEPWARM_FALLBACK_MS = 50 * 60_000; // if expires_in is unknown

function parseArgs(argv) {
  const out = {
    server: null,
    port: null,
    host: "127.0.0.1",
    credsDir: DEFAULT_CREDS_DIR,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--server") out.server = argv[++i];
    else if (argv[i] === "--port") out.port = Number(argv[++i]);
    else if (argv[i] === "--host") out.host = argv[++i];
    else if (argv[i] === "--creds-dir") out.credsDir = argv[++i];
    else if (argv[i] === "--help" || argv[i] === "-h") {
      console.error(
        "Usage: warm-server.mjs --server <name> --port <n> [--host 127.0.0.1] [--creds-dir <path>]",
      );
      process.exit(0);
    }
  }
  return out;
}

const { server: serverName, port, host, credsDir } = parseArgs(
  process.argv.slice(2),
);
if (!serverName || !port) {
  console.error("Error: --server <name> and --port <n> are required.");
  process.exit(2);
}
const credsPath = path.join(credsDir, `${serverName}.json`);
const allowedTools = ALLOWED_TOOLS[serverName];
if (!allowedTools) {
  console.error(
    `Error: server "${serverName}" has no ALLOWED_TOOLS entry. Add a tool list and restart.`,
  );
  process.exit(2);
}

const log = (msg) =>
  process.stderr.write(`[clawdi-warm-mcp:${serverName}] ${msg}\n`);

async function loadCreds() {
  let raw;
  try {
    raw = await readFile(credsPath, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") {
      throw new Error(
        `No credentials at ${credsPath}. Re-bootstrap via the manual DCR+PKCE recipe in providers/oauth-mcp-bridge/README.md.`,
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
  // Atomic write (temp + rename) so a concurrent reader never sees a half file.
  const tmp = `${credsPath}.tmp.${process.pid}`;
  await writeFile(tmp, JSON.stringify(creds, null, 2), { mode: 0o600 });
  await rename(tmp, credsPath);
}

// ---- single-flight upstream mutex -----------------------------------------
// Serialize ALL upstream operations. The SDK refreshes inside an upstream call
// (on 401) and does NOT guard concurrent refreshes; serializing upstream access
// guarantees at most one refresh is ever in flight, so a rotated-but-not-yet-
// persisted refresh token can never be re-presented by a sibling. CourtListener
// is low-QPS legal research, so serialization costs nothing meaningful.
let _lock = Promise.resolve();
function withUpstream(fn) {
  const prev = _lock;
  let release;
  _lock = new Promise((r) => (release = r));
  return prev.then(fn).finally(release);
}

let revokedAlerted = false;
function noteUpstreamError(err) {
  const text = `${err?.name ?? ""} ${err?.message ?? ""} ${err?.stack ?? ""}`;
  if (/invalid_grant|InvalidGrantError/i.test(text) && !revokedAlerted) {
    revokedAlerted = true;
    log(
      `REFRESH TOKEN REVOKED — re-bootstrap required. Cached refresh token at ${credsPath} is ` +
        `invalid_grant; run the manual DCR+PKCE recipe in providers/oauth-mcp-bridge/README.md, then restart this service.`,
    );
  }
}

// Non-interactive OAuth provider. Single owner of the token in memory; persists
// rotations atomically. No cross-process lock needed — withUpstream() serializes.
class WarmOAuthProvider {
  constructor(creds) {
    this._creds = creds;
  }
  get redirectUrl() {
    return undefined; // non-interactive → SDK uses the refresh_token grant
  }
  get clientMetadata() {
    return (
      this._creds.clientInfo?.metadata ?? {
        client_name: "clawdi-oauth-mcp-bridge",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        redirect_uris: [],
        scope: this._creds.scope ?? "",
        token_endpoint_auth_method:
          this._creds.clientInfo?.token_endpoint_auth_method ??
          "client_secret_post",
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
  async tokens() {
    return this._creds.tokens;
  }
  async prepareTokenRequest(scope) {
    const refresh = this._creds.tokens?.refresh_token;
    if (!refresh) return undefined; // → SDK "authorizationCode required" → re-bootstrap
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refresh,
    });
    if (scope) params.set("scope", scope);
    return params;
  }
  async saveTokens(tokens) {
    // Merge, don't replace: a refresh response often omits refresh_token.
    this._creds.tokens = { ...this._creds.tokens, ...tokens };
    await saveCreds(this._creds); // persist BEFORE the refresh is considered done
    log(`tokens refreshed (expires_in=${tokens.expires_in ?? "?"})`);
    scheduleKeepWarm(this._creds.tokens?.expires_in);
  }
  get expiresInSec() {
    return this._creds.tokens?.expires_in;
  }
  async redirectToAuthorization() {
    throw new Error(
      `Interactive OAuth not supported. Re-bootstrap ${serverName} creds (README.md).`,
    );
  }
  async saveCodeVerifier() {}
  async codeVerifier() {
    throw new Error("Code verifier not available — non-interactive.");
  }
}

let upstream; // shared warm upstream client
let keepWarmTimer = null;

// Schedule the next proactive refresh a little after the current token expires,
// via a keep-warm listTools that runs the SDK's normal on-401 refresh path.
function scheduleKeepWarm(expiresInSec) {
  if (keepWarmTimer) clearTimeout(keepWarmTimer);
  const delay =
    (Number.isFinite(expiresInSec) && expiresInSec > 0
      ? expiresInSec * 1000 + KEEPWARM_AFTER_EXPIRY_MS
      : KEEPWARM_FALLBACK_MS);
  keepWarmTimer = setTimeout(async () => {
    try {
      await withUpstream(() => upstream.listTools());
    } catch (err) {
      noteUpstreamError(err);
      log(`keep-warm refresh failed: ${err?.message ?? err}`);
      // Reschedule a soon retry so a transient failure self-heals.
      scheduleKeepWarm(60);
    }
  }, delay);
  keepWarmTimer.unref?.();
}

// A downstream MCP server (one per client session) that proxies to the shared
// warm upstream through the serialization mutex, applying the allowlist.
function makeProxyServer() {
  const server = new Server(
    { name: `clawdi-warm-${serverName}`, version: "0.1.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const resp = await withUpstream(() => upstream.listTools()).catch((err) => {
      noteUpstreamError(err);
      throw err;
    });
    const upstreamTools = resp?.tools ?? [];
    const tools = upstreamTools.filter((t) => allowedTools.has(t.name));
    const dropped = upstreamTools
      .filter((t) => !allowedTools.has(t.name))
      .map((t) => t.name);
    if (dropped.length) {
      log(`filtered ${dropped.length} unlisted upstream tool(s): ${dropped.join(", ")}`);
    }
    return { ...resp, tools };
  });
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    if (!allowedTools.has(name)) {
      throw new Error(
        `Tool "${name}" is not in the allowlist for ${serverName}. Add it to ALLOWED_TOOLS and restart.`,
      );
    }
    return await withUpstream(() =>
      upstream.callTool({ name, arguments: req.params.arguments }),
    ).catch((err) => {
      noteUpstreamError(err);
      throw err;
    });
  });
  return server;
}

// Read + JSON-parse an HTTP request body.
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 8 * 1024 * 1024) reject(new Error("body too large"));
    });
    req.on("end", () => {
      if (!data) return resolve(undefined);
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function writeJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

async function main() {
  const creds = await loadCreds();
  const authProvider = new WarmOAuthProvider(creds);

  upstream = new Client(
    { name: "clawdi-warm-mcp-client", version: "0.1.0" },
    { capabilities: {} },
  );
  const clientTransport = new StreamableHTTPClientTransport(
    new URL(creds.serverUrl),
    { authProvider },
  );
  await withUpstream(() => upstream.connect(clientTransport));
  log(`connected upstream to ${creds.serverUrl}`);
  scheduleKeepWarm(authProvider.expiresInSec);

  // Downstream: streamable-HTTP MCP server, one transport per client session.
  const sessions = new Map(); // sessionId -> transport

  const httpServer = http.createServer(async (req, res) => {
    try {
      // A CONSTANT BASE, for the reason measured at the MCP face: only `pathname` is
      // read below, so the caller's `Host` contributes nothing and a value that is not a valid authority
      // makes `new URL` throw — answering a crash where a named refusal is owed, before any auth.
      const url = new URL(req.url, "http://localhost");
      if (url.pathname !== "/mcp") {
        res.writeHead(404).end();
        return;
      }
      const sid = req.headers["mcp-session-id"];

      if (req.method === "POST") {
        const body = await readJsonBody(req);
        let transport;
        if (sid && sessions.has(sid)) {
          transport = sessions.get(sid);
        } else if (!sid && isInitializeRequest(body)) {
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id) => sessions.set(id, transport),
          });
          transport.onclose = () => {
            if (transport.sessionId) sessions.delete(transport.sessionId);
          };
          await makeProxyServer().connect(transport);
        } else {
          writeJson(res, 400, {
            jsonrpc: "2.0",
            error: { code: -32000, message: "Bad Request: no valid session" },
            id: null,
          });
          return;
        }
        await transport.handleRequest(req, res, body);
      } else if (req.method === "GET" || req.method === "DELETE") {
        if (!sid || !sessions.has(sid)) {
          res.writeHead(400).end("Missing or unknown session");
          return;
        }
        await sessions.get(sid).handleRequest(req, res);
      } else {
        res.writeHead(405).end();
      }
    } catch (err) {
      log(`request error: ${err?.stack ?? err}`);
      if (!res.headersSent) res.writeHead(500).end();
    }
  });

  // — a taken port is a sentence, not a stack. The await is kept: `main` has work after this and
  // the bind must be settled first, so `onReady` is the resolver. listenOrDie owns the error event, so
  // the promise simply never resolves on a failed bind — the process has already explained and exited.
  //
  // This bridge takes its port as `--port` and reads no environment variable for it, so the remedy line
  // names the flag rather than inventing a variable that does not exist.
  // — the readiness line now names the port the socket is ON. It named the one
  // it was GIVEN, so it printed the same sentence whether or not that bind was the one that happened,
  // and a caller that read the port off this line to talk to the bridge could be sent nowhere. Named in
  // the 1933 arm as the reason that test obtains its port by speaking MCP rather than by matching this
  // line; the arm keeps doing so, because a readiness line is still not a handshake.
  const { port: bound } = await new Promise((resolve) => listenOrDie(httpServer, {
    port, host, what: `the ${serverName} MCP bridge`, portVar: null, portFlag: "--port", log, onReady: resolve,
  }));
  log(`serving streamable-http MCP on http://${host}:${bound}/mcp`);
}

// Keep the service resilient: a request-level error must never take the process
// down (systemd Restart=always is only for genuine crashes / upstream loss).
process.on("unhandledRejection", (err) => {
  noteUpstreamError(err);
  log(`unhandledRejection: ${err?.stack ?? err}`);
});

main().catch((err) => {
  noteUpstreamError(err);
  log(`fatal on startup: ${err?.stack ?? err}`);
  // Exit non-zero so systemd restarts us; a revoked token loops visibly (see
  // the REVOKED line above) until re-bootstrap, which is the intended signal.
  process.exit(1);
});
