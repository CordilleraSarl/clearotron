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
import { resolveScope, isFirmDomain, verifyToken, addressesInGrants } from "./scope.mjs";

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
export function makeHttpHandler({ verify, limiter, opsLimiter = null, sessions, createSession, ns = "trademark-artifacts", sessionMax = 500, maxBody = 4 * 1024 * 1024, authHeader = "cf-access-jwt-assertion", firmDomains = [], clientSurface = false, devMode = false, tokenOnly = false, keyDoorPath = null,
  // Is this identity still on the guest list? ASKED PER REQUEST on an ACCOUNT session, cached on the
  // grants file's mtime, so it costs a stat between edits. Injected so an arm can move the answer
  // without a file; the default is the real read, because a door composed without this seam would
  // silently go back to resolving reach once and holding it for half an hour.
  stillEnrolled = (email) => addressesInGrants().includes(String(email ?? "").trim().toLowerCase()),
  log = () => {} }) {
  if (!verify && !devMode && !tokenOnly) throw new Error("makeHttpHandler: verify is required unless devMode:true or tokenOnly:true (fail-closed; refusing to build an unauthenticated handler)");
  // The two verify-less modes mean OPPOSITE things and must never be combined: devMode trusts the local
  // operator and hands out a synthetic identity, tokenOnly trusts NOBODY without a valid key. Together,
  // the synthetic identity would be the thing that answers — an open door wearing a locked door's label.
  if (tokenOnly && devMode) throw new Error("makeHttpHandler: tokenOnly and devMode are mutually exclusive (devMode's synthetic identity would defeat the mandatory key)");
  if (tokenOnly && verify) throw new Error("makeHttpHandler: tokenOnly is for a door with no auth proxy in front — pass verify:null");

  // ── A TURNED-AWAY CALL IS A RECORD, NOT A GAP ─────────────────────────────────────────────────────
  //
  // Every refusal below used to return without writing anything, so this log held calls that SUCCEEDED
  // and nothing else. An absent line then meant either "never asked" or "asked and was turned away",
  // and nobody reading it back can tell those apart — which is the one question the log exists to
  // answer. Measured on the production access log, 2026-09-16: zero lines in its most recent five
  // thousand carry a refused or error status, which is what never being able to write one looks like.
  //
  // IT INVENTS NO IDENTITY. The key refusals fire BEFORE any identity is established. `user` is in
  // scope there, but only as the placeholder this function starts with, and writing that would name a
  // caller who does not exist. Those lines carry no email and no principal, and say a call was refused
  // at this door at this time — which is true, and is the shape the local route already uses for the
  // same reason: a synthesized identity would match somebody who did nothing.
  const door = clientSurface ? "client" : undefined;
  const refuse = (res, status, obj, who = {}) => {
    try { appendAudit({ email: who.email ?? null, sub: who.sub ?? null, body: who.body ?? null, status: "refused", door }); }
    catch { /* best-effort: a write failure must never change what the caller is told */ }
    return send(res, status, obj);
  };

  /**
   * Has this identity been taken off the guest list since its session was opened? Null when it has not,
   * or when the question does not apply — and the body to send back when it has.
   *
   * ── WHY THIS IS ASKED AGAIN AT ALL ──────────────────────────────────────────────────────────────
   *
   * An ACCOUNT session's reach is resolved ONCE, at `resolveScope`, and lives in the server the
   * transport was built around. After that, this branch compared the caller's email against the
   * session's and nothing else — so somebody removed from an installation kept a whole account's reach
   * through their assistant until the session went idle for `SESSION_TTL_MS`, half an hour by default.
   * The portal's own side has never had that gap: it reads the file on every request. The People page
   * now tells a manager that removing somebody takes their access away "straight away, here and through
   * their AI", and this is what makes the second half of that sentence true rather than nearly true.
   *
   * ── WHY IT IS THIS NARROW ───────────────────────────────────────────────────────────────────────
   *
   * Four kinds of session reach this branch and only one of them is answerable from the guest list.
   * A run-bound `user` session and an `ops` session carry a token whose subject is a run id or an
   * automation principal, neither of which is an address anybody enrols; `internal` is firm staff,
   * admitted by a domain rule that does not live in this file. Asking the guest list about any of them
   * would refuse a caller for not being something they were never supposed to be — so the gate is the
   * client surface and the `account` kind, which is exactly the population the removal sentence is
   * about. Every other session behaves as it did.
   *
   * ── AND WHY IT FAILS CLOSED ─────────────────────────────────────────────────────────────────────
   *
   * A guest list that names nobody refuses. `CLEAROTRON_ACCESS_FILE` is mandatory on any door that can
   * hold an account session (the boot guard exits on its absence), and the file is written by an atomic
   * rename, so a reader sees the old file or the new one and never a torn one. An empty answer is
   * therefore a real state — the file was emptied, or it stopped parsing — and not a transient worth
   * holding a door open for.
   */
  const revokedMidSession = (entry) => {
    // WHO, read off the SCOPE and never off `user.email`. The two are the same address on a
    // CF-fronted door and are NOT on the others: a key door names the token's subject, and dev mode
    // hands out a synthetic identity that was never enrolled anywhere. Asking the guest list about the
    // synthetic one refuses every session on a developer's box, which is how this was found.
    if (!clientSurface || entry?.kind !== "account" || !entry?.sub) return null;
    if (stillEnrolled(entry.sub)) return null;
    log(`session withdrawn mid-session: ${entry.sub} is no longer on this installation's guest list`);
    return { error: "your access to this installation has been withdrawn — ask whoever manages it, then start a new session" };
  };

  return async (req, res) => {
    try {
      // THE BASE IS A CONSTANT, AND WHAT THE `Host` HEADER IS USED FOR HERE IS: NOTHING. Only
      // `pathname` and `searchParams` are read below, so the base exists purely so a bare
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
          // ── A KEY PRESENTED HERE IS NOT A MISSING JWT, AND THE OLD SENTENCE SAID IT WAS ─────────
          //
          // This door takes a proxy identity and has no path that reads an access key — the refusal is
          // structural rather than a check. But the sentence a caller got was "missing auth-proxy JWT",
          // which is a statement about an ABSENT assertion and says nothing about the key that was
          // actually sent. Measured against a real key on all three carriers: an operator reads it as a
          // misconfigured proxy and goes looking there. That is the outage this issue was raised from
          // wearing a different hat — a true sentence that is not the one the reader needs.
          //
          // DETECTED ON THE UNAMBIGUOUS CARRIERS ONLY. `?token=` and `x-trademark-token` carry nothing
          // but a trademark key. `Authorization` is NOT read here even though a key can arrive in it,
          // because on a proxy-fronted door that header belongs to whatever the proxy or agent is doing
          // and reading it as a key would put this sentence in front of callers who never sent one. So
          // a key in `Authorization` still gets the old message: narrower than the finding, and wrong
          // in the direction that costs nothing.
          const keySent = e instanceof AuthError && e.status === 401
            && Boolean(url.searchParams.get("token") || hdr(req.headers["x-trademark-token"]));
          if (keySent) {
            log("auth reject 401: an access key was presented on the proxy door, which has no key path");
            // THE SENTENCE IS ALSO READ BY A MACHINE, and the first draft of it broke that. `doorCredential`
            // in shared/trigger-lane.mjs classifies a door by what its refusal asks for, and the portal's
            // boot probe uses that to report which lane it has. A sentence saying "an access key has no
            // door here" contains the words "access key", so it classified as a KEY door — and the portal
            // would have announced that the network door takes its key, against a door that refuses it.
            // That is this issue's own false-reassurance finding, reintroduced by the fix for its
            // neighbour. Naming the JWT puts it in the proxy branch, which is checked first and is the
            // true answer: this door wants a proxy identity.
            // THE PATH IS NOT IN THE SENTENCE, and the first draft put it there. This door faces the
            // internet and answers before anyone has authenticated, so naming the socket's filesystem
            // path hands an unauthenticated stranger a piece of the deployment's layout. They cannot
            // reach it — the protection is the filesystem — so it is disclosure rather than exposure,
            // and it buys nothing: an operator needs to know a local socket is where to look, and
            // already has the path in the boot line and the unit file. A stranger gets nothing usable.
            return refuse(res, 401, { error: "this listener takes an auth-proxy JWT and never an access key — a key has no door here"
              + (keyDoorPath ? ". A key is taken on this deployment's local socket; the engine's boot line names it" : ". This deployment has no key door configured") });
          }
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
          return refuse(res, 401, { error: "this address needs an access key — put it in your assistant's API-key field, or add ?token=<key> to the URL" });
        }
        let t;
        try { t = verifyToken(tok); }
        catch (e) {
          // AN OPERATOR FAULT IS NOT A BAD KEY, and it must not read like one ( —
          // found in review). `isRevoked` now refuses rather than assuming a token was never revoked when the
          // denylist cannot be read; that is a configuration fault on THIS box, and logged in the same
          // words as a stranger presenting a bad key it would sit unnoticed in auth noise — which is how
          // the original defect survived, silently, on every default install.
          if (e.code === "REVOCATION_UNCHECKABLE") {
            log(`DOOR FAULT — refusing every key: ${e.message} Create it, or point TRADEMARK_MCP_TOKEN_DENYLIST at the list this install actually uses; \`clearotron doctor\` reports the state.`);
            return refuse(res, 401, { error: `this install cannot check whether keys have been revoked, so it is refusing all of them: ${e.message}` });
          }
          log(`auth reject 401: ${e.message}`);
          return refuse(res, 401, { error: `invalid access key: ${e.message}` });
        }
        user = { email: t.sub || t.runId || t.jti || "unnamed-key" };
      }
      if (!limiter.take(user.email)) return refuse(res, 429, { error: "rate limit exceeded — retry shortly" }, { email: user.email });

      if (req.method === "POST") {
        let body;
        try { body = await readJsonBody(req, maxBody); }
        catch (e) { return refuse(res, 400, { error: `bad request body: ${e.message}` }, { email: user.email }); }

        const sid = hdr(req.headers["mcp-session-id"]);
        let entry = sid ? sessions.get(sid) : null;
        let stampScope = null;
        if (!entry) {
          if (sid) return refuse(res, 404, { error: "unknown or expired session" }, { email: user.email, body });
          if (!isInitializeRequest(body)) return refuse(res, 400, { error: "no session — the first request must be an MCP initialize" }, { email: user.email, body });
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
          // STAMP THE SCOPE'S OWN FACTS ONTO THE STORED ENTRY, HERE, AND AFTER THE HANDSHAKE.
          //
          // `createSession` is injected, and every caller carries its own copy of the entry shape — two
          // servers and every arm that builds a door — so `sub` and `kind` are recorded by some of them
          // and omitted by others. A gate reading either would be true about whichever copies happened
          // to set it and silently inert everywhere else, which is the one failure a gate must not have.
          // The local `entry` above is this request's only; the map's is what every later request reads.
          //
          // AFTER, because the session has no id until the transport has answered the initialize: the
          // id is minted inside `handleRequest`, and `onsessioninitialized` is what puts the entry in
          // the map. Stamping before that read `sessions.get(undefined)`, found nothing, wrote nothing,
          // and left the gate reading a field nobody had set — green, and doing nothing.
          stampScope = () => {
            const stored = transport.sessionId ? sessions.get(transport.sessionId) : null;
            if (stored) { stored.sub = scope.sub ?? null; stored.kind = scope.kind ?? null; }
          };
        } else {
          if (entry.email && entry.email !== user.email) {
            log(`session owner mismatch: ${user.email} presented a session created by another identity`);
            return refuse(res, 403, { error: "session belongs to another identity" }, { email: user.email, sub: entry.sub ?? null, body });
          }
          const gone = revokedMidSession(entry);
          if (gone) return refuse(res, 403, gone, { email: user.email, sub: entry.sub ?? null, body });
          entry.lastSeen = Date.now();
        }
        // OPS-TOKENS item 6 — automation principals get their own (lower) bucket, keyed by the token's
        // sub, ON TOP of the transport-identity limit above: a runaway connector throttles itself, not
        // the interactive staff sharing the proxy identity.
        if (opsLimiter && entry.kind === "ops" && !opsLimiter.take(`ops:${entry.sub ?? "unnamed"}`))
          return refuse(res, 429, { error: "ops principal rate limit exceeded — retry shortly" }, { email: user.email, sub: entry.sub ?? null, body });
        // Audit AFTER scope resolution so the line names the PRINCIPAL (token sub), not just the
        // transport identity — still strictly before any tool dispatch. Best-effort, never blocks.
        try { appendAudit({ email: user.email, sub: entry.sub ?? null, body, door }); } catch { /* best-effort */ }
        const answered = entry.transport.handleRequest(req, res, body);
        if (stampScope) { try { await answered; } finally { stampScope(); } }
        return answered;
      }

      if (req.method === "GET" || req.method === "DELETE") {
        const sid = hdr(req.headers["mcp-session-id"]);
        const entry = sid ? sessions.get(sid) : null;
        if (!entry) return send(res, 404, { error: "unknown or expired session" });
        if (entry.email && entry.email !== user.email) {
          log(`session owner mismatch: ${user.email} presented a session created by another identity`);
          return send(res, 403, { error: "session belongs to another identity" });
        }
        const gone = revokedMidSession(entry);
        if (gone) return send(res, 403, gone);
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
