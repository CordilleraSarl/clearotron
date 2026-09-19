// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// portal-mcp-client.mjs — the portal's MINIMAL MCP Streamable-HTTP client for the ops face's /mcp
// endpoint (Phase 3b). One job: initialize a session with the accounts-scoped ops token, fire ONE
// tools/call, return the tool's JSON result. No SDK dependency — the wire shape is three fetches and
// is pinned by a test against the face's own makeHttpHandler (mcp-server/lib/http-handler.mjs), so a
// transport change there fails CI here instead of 404ing live (review 2026-07-18: the previous
// bare-REST /tools/start_run target existed on no HTTP face — the spend path was dead as wired).
//
// Response parsing handles BOTH content types the Streamable-HTTP transport may answer with
// (application/json or text/event-stream); a tool isError result throws with the tool's text so the
// portal can audit + surface it honestly.

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const JSONRPC = "2.0";
const PROTOCOL_VERSION = "2025-03-26";

// node:http, deliberately NOT fetch: undici's WASM OOMs/hangs under constrained dev ulimits (the
// dev-portal test convention), and the SSE answer needs early-close handling a streamed fetch text()
// can wedge on. Collects the body until the server ends the response OR the wanted JSON-RPC id has
// arrived on an SSE frame (whichever first — the transport may hold streams open).
// ── AN ADDRESS IS EITHER A NETWORK ORIGIN OR A LOCAL SOCKET ─────────────────────────────────────────
//
// `unix:/run/clearotron/engine.sock` names the engine's local key door. The engine can serve a key door
// on a socket and an identity door on a port from ONE process, which is the whole point — a deployment
// that needed both used to run the process twice, and the last attempt to collapse that by switching
// modes instead of adding a transport cost an outage.
//
// THE SOCKET PATH AND THE REQUEST PATH ARE DIFFERENT THINGS, which is the trap this shape exists to
// avoid. For a network origin the request path is what `/mcp` is appended to; for a socket the whole
// value IS a filesystem path and the request path is `/mcp` alone. Composing one string for both gives
// `unix:/run/x.sock/mcp`, which is a file that does not exist — and the failure arrives as a connect
// error naming a path nobody configured.
//
// THE HOST HEADER IS EXPLICIT, AND THE REASON IS NARROWER THAN THE FIRST DRAFT CLAIMED. That draft said
// Node sends no Host over a socket. It does: measured on this runtime, a request with `socketPath` and
// no `host` option arrives carrying `Host: localhost` already. So the header is NOT what makes the
// request work today, and an arm asserting the server saw a Host would pass with this line deleted.
//
// It stays because the value is then OURS rather than a runtime default — HTTP/1.1 requires a Host, a
// socket has no hostname to derive one from, and a default that is currently convenient is not a
// contract. It names no machine and resolves nothing either way.
export function dialTarget(urlStr, requestPath) {
  const raw = String(urlStr ?? "").trim();
  // ── ONE SPELLING, AND THE OTHERS NORMALISE RATHER THAN ALMOST-WORK ───────────────────────────────
  //
  // `unix:/run/x.sock` is the documented form. `unix://` and `unix:///` are what somebody types who has
  // seen a URL before, and taking everything after the colon verbatim made those produce `//run/x.sock`
  // and `///run/x.sock`. Both CONNECT, because POSIX collapses leading slashes — so the wrong spelling
  // works on this platform, is recorded in a settings file, and is a defect waiting for a reader who
  // compares the configured path to the one the engine prints and finds they differ.
  //
  // Collapsed to a single leading slash rather than refused: refusing a spelling that demonstrably
  // connects would be a new failure for deployments that already use it, and the value is unambiguous
  // either way — a socket address is always absolute.
  const m = /^unix:(.+)$/i.exec(raw);
  if (m) return { socketPath: m[1].replace(/^\/+/, "/"), path: requestPath, headers: { host: "localhost" }, https: false };
  const u = new URL(`${raw.replace(/\/$/, "")}${requestPath}`);
  return { socketPath: null, host: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80),
    path: u.pathname + u.search, headers: {}, https: u.protocol === "https:" };
}

function post(urlStr, { headers = {}, body = "", wantId = null, timeoutMs = 30000, target = null } = {}) {
  return new Promise((resolve, reject) => {
    const t = target ?? dialTarget(urlStr, "");
    const req = (t.https ? httpsRequest : httpRequest)({
      ...(t.socketPath ? { socketPath: t.socketPath } : { host: t.host, port: t.port }),
      path: t.path,
      method: "POST", headers: { ...t.headers, ...headers, "content-length": Buffer.byteLength(body) },
    }, (res) => {
      let data = "";
      const done = () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text: data });
      res.on("data", (c) => {
        data += c;
        // SSE early-exit: once the frame with our id is complete, we have the answer — stop reading
        if (wantId != null && String(res.headers["content-type"] ?? "").includes("text/event-stream")
            && new RegExp(`"id"\\s*:\\s*${wantId}`).test(data) && /\n\n/.test(data)) { res.destroy(); done(); }
      });
      res.on("end", done);
      res.on("close", done);
    });
    // — a timeout got no status and therefore no answer; it is marked at the throw rather than
    // recognised later by its message, so nothing has to keep a regex in step with a sentence.
    req.setTimeout(timeoutMs, () => { req.destroy(transportError(`MCP request timed out after ${timeoutMs}ms`, null)); });
    req.on("error", (e) => reject(isSocketFailure(e) ? transportError(e.message, null) : e));
    req.end(body);
  });
}

function parseRpcText({ headers, text }, wantId) {
  const ctype = String(headers["content-type"] ?? "");
  if (ctype.includes("text/event-stream")) {
    // take the LAST data: frame carrying a JSON-RPC message with our id
    let hit = null;
    for (const line of text.split("\n")) {
      const m = line.match(/^data:\s*(.+)$/);
      if (!m) continue;
      try {
        const msg = JSON.parse(m[1]);
        if (msg?.id === wantId) hit = msg;
      } catch { /* keep scanning */ }
    }
    if (!hit) throw new Error(`MCP SSE response carried no message for id ${wantId}`);
    return hit;
  }
  try { return JSON.parse(text); } catch { throw new Error(`MCP response unparseable (${ctype}): ${text.slice(0, 200)}`); }
}

// ── A REFUSED TRANSPORT CARRIES ITS STATUS CODE, NOT JUST A SENTENCE ────────────────────────────────
//
//. Both refusals below used to throw a bare Error whose only evidence was formatted English. A
// caller that needed to tell "the server is rate-limiting us" from "this job is out of product scope"
// had no choice but to regex the message — and this repo already owns a cautionary example of that in
// TRANSIENT_RE, which does not match the very 429 string this function produces.
//
// The status code is right here at the throw. Attaching it costs one property and makes the
// distinction a fact rather than a parse. `transport: true` marks the class: the request never
// reached the tool, so whatever the tool would have decided is UNKNOWN — not "no".
function transportError(message, status) {
  return Object.assign(new Error(message), { status, transport: true });
}

/**
 * — socket-level failures. The request never reached the service, so there is no answer to
 * interpret and the door holds no opinion about the case.
 *
 * Until this existed, `transport: true` was attached ONLY where an HTTP STATUS came back — a 4xx or
 * 5xx from initialize or tools/call. A dead port never produces a status: `connect ECONNREFUSED` is a
 * plain Error with a `.code`, so the harness read it as `transport: false, status: null` and
 * `doorAnswerClass` classed it ANSWERED. A door with nothing listening behind it was recorded as
 * having REFUSED ON THE MERITS. Measured on a verification round: all four criteria failed, and the
 * report was LINE-FOR-LINE IDENTICAL to a round where the door was merely not configured.
 *
 * DELIBERATELY NARROW, the same line drew. These are the codes for a connection that was never
 * established, plus a timeout that never got a byte back. `ECONNRESET` and `EPIPE` are NOT here: a
 * reset can arrive after a service has formed and begun sending an opinion, and a rule that excuses
 * every failure it cannot classify is worth nothing. An error carrying a STATUS is always an answer.
 */
export const SOCKET_FAILURE_CODES = Object.freeze([
  "ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH", "ENETUNREACH", "EAI_AGAIN", "ETIMEDOUT",
]);

export const isSocketFailure = (e) => SOCKET_FAILURE_CODES.includes(e?.code);

export async function mcpToolCall({ url, token, tool, args, timeoutMs = 30000 }) {
  // Resolved ONCE, so all three requests of the handshake dial the same place. Composed per call, the
  // socket form would have to be re-parsed three times and a divergence would show up as a session that
  // initializes and then cannot be found.
  const endpoint = dialTarget(url, "/mcp");
  const headers = (extra = {}) => ({
    "content-type": "application/json",
    "accept": "application/json, text/event-stream",
    "x-trademark-token": token,
    ...extra,
  });

  // 1 — initialize (the transport refuses everything else without a session)
  const initRes = await post(null, { target: endpoint, headers: headers(), wantId: 1, timeoutMs,
    body: JSON.stringify({ jsonrpc: JSONRPC, id: 1, method: "initialize", params: {
      protocolVersion: PROTOCOL_VERSION, capabilities: {},
      clientInfo: { name: "trademark-portal", version: "poc" } } }) });
  if (initRes.status >= 400) throw transportError(`MCP initialize refused (${initRes.status}): ${initRes.text.slice(0, 200)}`, initRes.status);
  const sessionId = initRes.headers["mcp-session-id"];
  if (!sessionId) throw new Error("MCP initialize returned no mcp-session-id — transport contract changed");
  parseRpcText(initRes, 1);   // surfaces JSON-RPC-level init errors

  // 2 — initialized notification (the spec's handshake close; some transports require it)
  await post(null, { target: endpoint, headers: headers({ "mcp-session-id": sessionId }), timeoutMs,
    body: JSON.stringify({ jsonrpc: JSONRPC, method: "notifications/initialized" }) }).catch(() => { /* best-effort */ });

  // 3 — the one tool call
  const callRes = await post(null, { target: endpoint, headers: headers({ "mcp-session-id": sessionId }), wantId: 2, timeoutMs,
    body: JSON.stringify({ jsonrpc: JSONRPC, id: 2, method: "tools/call", params: { name: tool, arguments: args } }) });
  if (callRes.status >= 400) throw transportError(`MCP tools/call refused (${callRes.status}): ${callRes.text.slice(0, 200)}`, callRes.status);
  const msg = parseRpcText(callRes, 2);
  if (msg.error) throw new Error(`MCP error: ${msg.error.message ?? JSON.stringify(msg.error).slice(0, 200)}`);
  const content = msg.result?.content?.[0]?.text ?? "";
  if (msg.result?.isError) throw new Error(`${tool} refused upstream: ${String(content).slice(0, 300)}`);
  try { return JSON.parse(content); } catch { return { raw: content }; }
}
