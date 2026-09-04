// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// lib/http-handler.mjs — the (req,res) handler for the remote HTTP face: health, AUTH-BEFORE-DATA, rate limit,
// audit, and routing to a per-session MCP transport.
//
// The SDK Streamable-HTTP transport (which pulls @hono/node-server/undici) is INJECTED via createSession(), so
// this module — and its tests — never import it. That keeps the auth/routing path light and importable
// anywhere (including under a restrictive `ulimit -v`, which OOMs on undici's WASM).

import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { AuthError } from "./cf-access.mjs";
import { appendAudit } from "./audit.mjs";
import { resolveScope, isFirmDomain, verifyToken } from "./scope.mjs";

const hdr = (v) => (Array.isArray(v) ? v[0] : v);

// Where an inner token may ride. The first two are the long-standing forms (the report link's `?token=`
// and the explicit header). `Authorization` is accepted ONLY on the token-only door: connectors with a
// fixed "API key" box put the key there and give no say over the header name, but on the CF-fronted doors
// that header belongs to whatever the proxy/agent is doing and must not be re-read as a trademark token.
// Both `Bearer <tok>` and a bare value are accepted — which of the two a connector sends is not ours to
// choose, and guessing wrong looks identical to a bad key from the outside.
export function readInnerToken(url, headers, { allowAuthorization = false } = {}) {
  const q = url.searchParams.get("token") || hdr(headers["x-trademark-token"]) || null;
  if (q) return q;
  if (!allowAuthorization) return null;
  const auth = hdr(headers.authorization);
  if (!auth) return null;
  const m = /^\s*bearer\s+(.+)$/i.exec(auth);
  return (m ? m[1] : auth).trim() || null;
}

function send(res, status, obj) {
  if (res.headersSent) return;
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}

async function readJsonBody(req, maxBody) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > maxBody) throw new Error("request body too large");
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : undefined;
}

// Evict the least-recently-used session (used when at the hard cap, so a new client still connects).
export function evictOldest(sessions) {
  let oldest = null, t = Infinity;
  for (const [id, e] of sessions) if (e.lastSeen < t) { t = e.lastSeen; oldest = id; }
  if (oldest) { try { sessions.get(oldest).transport.close(); } catch { /* ignore */ } sessions.delete(oldest); }
}

/**
 * makeHttpHandler({ verify, limiter, sessions, createSession, ... }) → async (req,res) handler.
 *  - verify: async (token) => {email,...} or throws AuthError. null is ONLY legal with devMode:true
 *    (fail-closed at construction — the bootstrap's triple gate used to be the only fence, and any
 *    direct embedder could have built an open handler by omission).
 *  - authHeader: the request header carrying the auth-proxy JWT (default CF Access's).
 *  - firmDomains / clientSurface: feed the firm-staff positive check and the client-surface scope
 *    resolution (see the scope comment below).
 *  - createSession: async (sessions, scope, owner) => transport — encapsulates SDK transport creation +
 *    onsessioninitialized/onclose; `owner` (the authed email) is stored on the session entry.
 * Auth runs BEFORE any body read, session, tool, or data. Sessions are OWNER-BOUND: a request that
 * presents another identity's mcp-session-id is refused (403) — a leaked/guessed session id must never
 * let one CF-authed person attach to another's session (which may carry an ops-scoped inner token).
 */
export function makeHttpHandler({ verify, limiter, opsLimiter = null, sessions, createSession, ns = "trademark-artifacts", sessionMax = 500, maxBody = 4 * 1024 * 1024, authHeader = "cf-access-jwt-assertion", firmDomains = [], clientSurface = false, devMode = false, tokenOnly = false, log = () => {} }) {
  if (!verify && !devMode && !tokenOnly) throw new Error("makeHttpHandler: verify is required unless devMode:true or tokenOnly:true (fail-closed; refusing to build an unauthenticated handler)");
  // The two verify-less modes mean OPPOSITE things and must never be combined: devMode trusts the local
  // operator and hands out a synthetic identity, tokenOnly trusts NOBODY without a valid key. Together,
  // the synthetic identity would be the thing that answers — an open door wearing a locked door's label.
  if (tokenOnly && devMode) throw new Error("makeHttpHandler: tokenOnly and devMode are mutually exclusive (devMode's synthetic identity would defeat the mandatory key)");
  if (tokenOnly && verify) throw new Error("makeHttpHandler: tokenOnly is for a door with no auth proxy in front — pass verify:null");
  return async (req, res) => {
    try {
      // THE BASE IS A CONSTANT, AND WHAT THE `Host` HEADER IS USED FOR HERE IS: NOTHING (tracker issue
      // 1928). Only `pathname` and `searchParams` are read below, so the base exists purely so a bare
      // `req.url` parses as a path. Interpolating the caller's `Host` bought a crash and no behaviour:
      // a value that is not a valid authority makes `new URL` throw, the outer catch answers 500 with a
      // stack in the log, and every bit of that happens ABOVE the `authenticate FIRST` block — so an
      // unauthenticated caller who can reach the port gets it. Measured 2026-08-26: six of nine `Host`
      // values crashed this door and all nine answered 401 at the portal, which has always used this
      // constant. It also skipped the guard written for this exact header: TRADEMARK_MCP_ALLOWED_HOSTS
      // arms the transport's DNS-rebinding protection and the server refuses to start without it, but a
      // `Host` malformed enough to throw never reaches the transport at all.
      const url = new URL(req.url, "http://localhost");
      if (req.method === "GET" && url.pathname === "/healthz") return send(res, 200, { ok: true, ns });
      if (url.pathname !== "/mcp") return send(res, 404, { error: "not found — the MCP endpoint is /mcp" });

      // ---- authenticate FIRST ----
      let user = { email: "local-test@disabled" };
      if (verify) {
        try {
          user = await verify(hdr(req.headers[authHeader]));
        } catch (e) {
          const status = e instanceof AuthError ? e.status : 401;
          log(`auth reject ${status}: ${e.message}`);
          return send(res, status, { error: e.message });
        }
      } else if (tokenOnly) {
        // No auth proxy in front, so the key IS the authentication — checked here, before the rate
        // limiter, the body, the session and anything else, and with NO synthetic identity to fall back
        // on. resolveScope verifies it again at session creation (cheap HMAC); this pass exists so an
        // unkeyed request is refused at the very front and so the limiter and audit log can name the
        // principal rather than an anonymous transport.
        const tok = readInnerToken(url, req.headers, { allowAuthorization: true });
        if (!tok) {
          log("auth reject 401: no key presented on the token-only door");
          return send(res, 401, { error: "this address needs an access key — put it in your assistant's API-key field, or add ?token=<key> to the URL" });
        }
        let t;
        try { t = verifyToken(tok); }
        catch (e) { log(`auth reject 401: ${e.message}`); return send(res, 401, { error: `invalid access key: ${e.message}` }); }
        user = { email: t.sub || t.runId || t.jti || "unnamed-key" };
      }
      if (!limiter.take(user.email)) return send(res, 429, { error: "rate limit exceeded — retry shortly" });

      if (req.method === "POST") {
        let body;
        try { body = await readJsonBody(req, maxBody); }
        catch (e) { return send(res, 400, { error: `bad request body: ${e.message}` }); }

        const sid = hdr(req.headers["mcp-session-id"]);
        let entry = sid ? sessions.get(sid) : null;
        if (!entry) {
          if (sid) return send(res, 404, { error: "unknown or expired session" });
          if (!isInitializeRequest(body)) return send(res, 400, { error: "no session — the first request must be an MCP initialize" });
          if (sessions.size >= sessionMax) evictOldest(sessions);
          // INNER authz token (rides the /mcp?token= query or the X-Trademark-Token header) → the session's
          // scope: ops (full), run-bound user (read-only one run), or — no token but firm staff — internal
          // (read-all, no writes). Resolved ONCE at session creation; a bad/expired token is a 401, a
          // fail-closed refusal (`forbidden:` — not firm staff and no token, or a client surface without a
          // run token) is a 403. Firm-staff is a POSITIVE check on the verified email domain, NOT on which CF
          // app admitted the caller — so a customer wrongly admitted to the staff app is still refused internal.
          // Auth-disabled dev (loopback, gated upstream) trusts the local operator as firm staff (dev keeps
          // internal read-all). On the client surface firmStaff is irrelevant — resolveScope ignores it there.
          const innerToken = readInnerToken(url, req.headers, { allowAuthorization: tokenOnly });
          // ...and on a token-only door the operator is NOT trusted as firm staff: there is no local
          // operator, only whoever holds a key. (`clientSurface` already forces this to false today; the
          // explicit !tokenOnly keeps it true if this mode is ever wired to another face.)
          const firmStaff = clientSurface ? false : (verify ? isFirmDomain(user.email, firmDomains) : !tokenOnly);
          let scope;
          // email feeds the GRANTS resolution for internal (token-less) sessions — INSTALL.md §8.
          try { scope = resolveScope({ local: false, innerToken, email: user.email, firmStaff, clientSurface }); }
          catch (e) {
            const forbidden = /^forbidden:/.test(e.message || "");
            log(`scope reject ${forbidden ? 403 : 401}: ${e.message}`);
            return forbidden
              ? send(res, 403, { error: e.message.replace(/^forbidden:\s*/, "") })
              : send(res, 401, { error: `invalid trademark token: ${e.message}` });
          }
          const transport = await createSession(sessions, scope, user.email);
          entry = { transport, sub: scope.sub ?? null, kind: scope.kind ?? null };
        } else {
          if (entry.email && entry.email !== user.email) {
            log(`session owner mismatch: ${user.email} presented a session created by another identity`);
            return send(res, 403, { error: "session belongs to another identity" });
          }
          entry.lastSeen = Date.now();
        }
        // OPS-TOKENS item 6 — automation principals get their own (lower) bucket, keyed by the token's
        // sub, ON TOP of the transport-identity limit above: a runaway connector throttles itself, not
        // the interactive staff sharing the proxy identity.
        if (opsLimiter && entry.kind === "ops" && !opsLimiter.take(`ops:${entry.sub ?? "unnamed"}`))
          return send(res, 429, { error: "ops principal rate limit exceeded — retry shortly" });
        // Audit AFTER scope resolution so the line names the PRINCIPAL (token sub), not just the
        // transport identity — still strictly before any tool dispatch. Best-effort, never blocks.
        try { appendAudit({ email: user.email, sub: entry.sub ?? null, body }); } catch { /* best-effort */ }
        return entry.transport.handleRequest(req, res, body);
      }

      if (req.method === "GET" || req.method === "DELETE") {
        const sid = hdr(req.headers["mcp-session-id"]);
        const entry = sid ? sessions.get(sid) : null;
        if (!entry) return send(res, 404, { error: "unknown or expired session" });
        if (entry.email && entry.email !== user.email) {
          log(`session owner mismatch: ${user.email} presented a session created by another identity`);
          return send(res, 403, { error: "session belongs to another identity" });
        }
        entry.lastSeen = Date.now();
        return entry.transport.handleRequest(req, res);
      }

      return send(res, 405, { error: "method not allowed" });
    } catch (e) {
      log(`request error: ${e?.stack ?? e}`);
      send(res, 500, { error: "internal error" });
    }
  };
}
