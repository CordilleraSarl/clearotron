// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// lib/http-handler.mjs — the (req,res) handler for the remote HTTP face: health, AUTH-BEFORE-DATA, rate limit,
// audit, and the hand-off of ONE request, with its scope, to the MCP server that answers it.
//
// NO SESSIONS (2026-11-27). The protocol's 2026-07-28 revision removed the opening handshake and protocol sessions, and
// requires authorization on every request. So every request is authenticated, scoped, rate-limited and audited on its
// own, for both revisions, and the answer comes from a server built for that request (lib/mcp-serve.mjs). The SDK is
// INJECTED as `serve`, so this module and its tests never import it, which keeps the auth path light and importable
// anywhere (including under a restrictive `ulimit -v`).

import { AuthError } from "./cf-access.mjs";
import { appendAudit } from "./audit.mjs";
import { resolveScope, isFirmDomain, verifyToken, addressesInGrants } from "./scope.mjs";
import { BOOT_PROBE_HEADER } from "../../shared/trigger-lane.mjs";   // the portal's boot probe names itself with it

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

/**
 * makeHttpHandler({ verify, limiter, serve, ... }) → async (req,res) handler.
 *  - verify: async (token) => {email,...} or throws AuthError. null is ONLY legal with devMode:true
 *    (fail-closed at construction — the bootstrap's triple gate used to be the only fence, and any
 *    direct embedder could have built an open handler by omission).
 *  - authHeader: the request header carrying the auth-proxy JWT (default CF Access's).
 *  - firmDomains / clientSurface: feed the firm-staff positive check and the client-surface scope
 *    resolution (see the scope comment below).
 *  - serve: async (req, res, { body, scope, email }) — answers ONE request with a server built for `scope`
 *    (lib/mcp-serve.mjs). Called only after authentication, scope, the guest list and the rate limits pass.
 *  - allowedHosts: the exact `Host` values a request may name (DNS-rebinding protection); empty arms none.
 * Auth runs BEFORE any body read, tool, or data, and the scope is resolved from THIS request's own key: there
 * is no session for another identity to present, so a second key on one connection gets its own scope.
 */
/** What a person taken off the guest list is told, on either revision of the protocol. */
export const ACCESS_WITHDRAWN = "Your access to this installation has been withdrawn. Ask the administrator to restore it, then try again.";

export function makeHttpHandler({ verify, limiter, opsLimiter = null, serve, allowedHosts = [], ns = "trademark-artifacts", maxBody = 4 * 1024 * 1024, authHeader = "cf-access-jwt-assertion", firmDomains = [], clientSurface = false, door: doorName = null, devMode = false, tokenOnly = false, keyDoorPath = null,
  // Is this identity still on the guest list? ASKED PER REQUEST for an ACCOUNT principal, cached on the
  // grants file's mtime, so it costs a stat between edits. Injected so an arm can move the answer
  // without a file; the default is the real read.
  stillEnrolled = (email) => addressesInGrants().includes(String(email ?? "").trim().toLowerCase()),
  log = () => {} }) {
  if (!verify && !devMode && !tokenOnly) throw new Error("makeHttpHandler: verify is required unless devMode:true or tokenOnly:true (fail-closed; refusing to build an unauthenticated handler)");
  // The two verify-less modes mean OPPOSITE things and must never be combined: devMode trusts the local
  // operator and hands out a synthetic identity, tokenOnly trusts NOBODY without a valid key. Together,
  // the synthetic identity would be the thing that answers — an open door wearing a locked door's label.
  if (tokenOnly && devMode) throw new Error("makeHttpHandler: tokenOnly and devMode are mutually exclusive (devMode's synthetic identity would defeat the mandatory key)");
  if (tokenOnly && verify) throw new Error("makeHttpHandler: tokenOnly is for a door with no auth proxy in front — pass verify:null");
  if (typeof serve !== "function") throw new Error("makeHttpHandler: serve is required — the function that answers one authenticated, scoped request");

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
  // WHICH SURFACE THIS HANDLER IS, named rather than inferred. `clientSurface` answers a scope question
  // and was doing double duty as the door's name, which left the key door — built with neither
  // `clientSurface` nor a name — writing lines with no door at all. A caller that knows it is a third
  // thing passes `door`; the two that do not get the surface they already declare.
  const door = doorName ?? (clientSurface ? "client" : "portal");
  const refuse = (res, status, obj, who = {}) => {
    try { appendAudit({ email: who.email ?? null, sub: who.sub ?? null, body: who.body ?? null, status: "refused", door }); }
    catch { /* best-effort: a write failure must never change what the caller is told */ }
    return send(res, status, obj);
  };

  /**
   * Has this identity been taken off the guest list? Null when it has not, or when the question does not
   * apply — and the body to send back when it has. Asked on EVERY request, as the portal's own side reads
   * the file on every request: the People page tells a manager that removing somebody takes their access
   * away "straight away, here and through their AI", and this is the second half of that sentence. (It was
   * first written when an account's reach was held in a session for up to half an hour; the doors keep no
   * sessions now, and the check stays where every request passes.)
   *
   * ── WHY IT IS THIS NARROW ───────────────────────────────────────────────────────────────────────
   *
   * Four kinds of principal reach this branch and only one of them is answerable from the guest list.
   * A run-bound `user` principal and an `ops` principal carry a token whose subject is a run id or an
   * automation principal, neither of which is an address anybody enrols; `internal` is firm staff,
   * admitted by a domain rule that does not live in this file. Asking the guest list about any of them
   * would refuse a caller for not being something they were never supposed to be — so the gate is the
   * client surface and the `account` kind, which is exactly the population the removal sentence is
   * about. Every other principal behaves as it did.
   *
   * ── AND WHY IT FAILS CLOSED ─────────────────────────────────────────────────────────────────────
   *
   * A guest list that names nobody refuses. `CLEAROTRON_ACCESS_FILE` is mandatory on any door that can
   * serve an account principal (the boot guard exits on its absence), and the file is written by an atomic
   * rename, so a reader sees the old file or the new one and never a torn one. An empty answer is
   * therefore a real state — the file was emptied, or it stopped parsing — and not a transient worth
   * holding a door open for.
   */
  const revokedMidSession = (entry) => {
    // WHO, read off the SCOPE and never off `user.email`. The two are the same address on a
    // CF-fronted door and are NOT on the others: a key door names the token's subject, and dev mode
    // hands out a synthetic identity that was never enrolled anywhere. Asking the guest list about the
    // synthetic one refuses every request on a developer's box, which is how this was found.
    if (!clientSurface || entry?.kind !== "account" || !entry?.sub) return null;
    if (stillEnrolled(entry.sub)) return null;
    log(`access withdrawn: ${entry.sub} is no longer on this installation's guest list`);
    // The owner's approved words (2026-11-28): restoring access is what the holder can ask for, and "a new session" named
    // nothing once the doors stopped keeping sessions.
    return { error: ACCESS_WITHDRAWN };
  };

  return async (req, res) => {
    try {
      // THE BASE IS A CONSTANT, AND THE `Host` HEADER PLAYS NO PART IN PARSING THE URL. Only
      // `pathname` and `searchParams` are read below, so the base exists purely so a bare
      // `req.url` parses as a path. Interpolating the caller's `Host` bought a crash and no behaviour:
      // a value that is not a valid authority makes `new URL` throw, the outer catch answers 500 with a
      // stack in the log, and every bit of that happens ABOVE the `authenticate FIRST` block — so an
      // unauthenticated caller who can reach the port gets it. Measured 2026-08-26: six of nine `Host`
      // values crashed this door and all nine answered 401 at the portal, which has always used this
      // constant. It also skipped the guard written for this exact header: TRADEMARK_MCP_ALLOWED_HOSTS
      // arms the DNS-rebinding check further down (by the exact Host, after authentication) and the server
      // refuses to start without it, but a `Host` malformed enough to throw would never have reached it.
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
        // limiter, the body and anything else, and with NO synthetic identity to fall back
        // on. resolveScope verifies it again when it scopes the request (cheap HMAC); this pass exists so an
        // unkeyed request is refused at the very front and so the limiter and audit log can name the
        // principal rather than an anonymous transport.
        const tok = readInnerToken(url, req.headers, { allowAuthorization: true });
        if (!tok) {
          // THE PORTAL'S BOOT PROBE IS NOT A REJECTION. It asks, without a key, what this door wants, on
          // every start, and this line read as an error each time. Its answer is unchanged and still
          // audited; only a keyless GET that names itself as the probe goes unlogged here, because the
          // portal logs what it learned. Any other keyless request is still logged as a reject.
          if (!(req.method === "GET" && hdr(req.headers[BOOT_PROBE_HEADER])))
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

      if (req.method === "POST" || req.method === "GET" || req.method === "DELETE") {
        let body;
        if (req.method === "POST") {
          try { body = await readJsonBody(req, maxBody); }
          catch (e) { return refuse(res, 400, { error: `bad request body: ${e.message}` }, { email: user.email }); }
        }
        // THE SCOPE OF THIS REQUEST, from ITS OWN key. INNER authz token (the /mcp?token= query, the X-Trademark-Token
        // header, or Authorization on a token-only door) → ops (full), run-bound user (read-only one run), account, or —
        // no token but firm staff — internal (read-all, no writes). A bad/expired token is a 401; a fail-closed refusal
        // (`forbidden:` — not firm staff and no token, or a client surface without a token) is a 403. Firm-staff is a
        // POSITIVE check on the verified email domain, NOT on which CF app admitted the caller. Auth-disabled dev
        // (loopback, gated upstream) trusts the local operator as firm staff; on a token-only door there is no local
        // operator, only whoever holds a key. On the client surface firmStaff is irrelevant.
        const innerToken = readInnerToken(url, req.headers, { allowAuthorization: tokenOnly });
        const firmStaff = clientSurface ? false : (verify ? isFirmDomain(user.email, firmDomains) : !tokenOnly);
        let scope;
        try { scope = resolveScope({ local: false, innerToken, email: user.email, firmStaff, clientSurface }); }
        catch (e) {
          const forbidden = /^forbidden:/.test(e.message || "");
          log(`scope reject ${forbidden ? 403 : 401}: ${e.message}`);
          return forbidden
            ? send(res, 403, { error: e.message.replace(/^forbidden:\s*/, "") })
            : send(res, 401, { error: `invalid trademark token: ${e.message}` });
        }
        const who = { sub: scope.sub ?? null, kind: scope.kind ?? null };
        // Whether an ops token names its verbs is audited on every call it makes: one that names none is being retired
        // (re-issued with verbs, then refused), and the audit is how the live ones are found. Never which, never the token.
        const namesVerbs = scope.kind === "ops" ? Array.isArray(scope.verbs) && scope.verbs.length > 0 : null;
        const gone = revokedMidSession(who);
        if (gone) return refuse(res, 403, gone, { email: user.email, sub: who.sub, body });
        // OPS-TOKENS item 6 — automation principals get their own (lower) bucket, keyed by the token's
        // sub, ON TOP of the transport-identity limit above: a runaway connector throttles itself, not
        // the interactive staff sharing the proxy identity.
        if (opsLimiter && who.kind === "ops" && !opsLimiter.take(`ops:${who.sub ?? "unnamed"}`))
          return refuse(res, 429, { error: "ops principal rate limit exceeded — retry shortly" }, { email: user.email, sub: who.sub, body });
        // DNS-REBINDING PROTECTION, by the exact `Host` the door listens as (TRADEMARK_MCP_ALLOWED_HOSTS and its client
        // twin). The SDK's own check compares hostnames without the port; this door has always matched host AND port,
        // and keeps doing so. A door with no list (the key socket, which has no hostname) arms none.
        if (allowedHosts.length && !allowedHosts.includes(String(hdr(req.headers.host) ?? ""))) {
          log(`host reject 403: ${String(hdr(req.headers.host) ?? "(none)").slice(0, 80)} is not an allowed host`);
          return refuse(res, 403, { jsonrpc: "2.0", error: { code: -32000, message: `Invalid Host header: ${String(hdr(req.headers.host) ?? "").slice(0, 80)}` }, id: null }, { email: user.email, sub: who.sub, body });
        }
        // Audit AFTER scope resolution so the line names the PRINCIPAL (token sub), not just the
        // transport identity. Best-effort, never blocks.
        //
        // ── ONE LINE, WRITTEN WHEN THE OUTCOME IS KNOWN ────────────────────────────────────────────
        //
        // This used to be written before dispatch, and therefore with `status: null` — a record that a
        // call was made and no record of what happened to it. `finish` fires once the response is fully
        // sent, which is when `res.statusCode` is the answer the caller got. A crash that loses the line
        // also loses the response, so the caller is not left believing a lost call succeeded. The
        // refusals above are recorded at their own sites.
        if (req.method === "POST") {
          res.once("finish", () => {
            try { appendAudit({ email: user.email, sub: who.sub, kind: who.kind, namesVerbs, body, status: res.statusCode, door }); }
            catch { /* best-effort */ }
          });
        }
        return await serve(req, res, { body, scope, email: user.email });
      }

      return send(res, 405, { error: "method not allowed" });
    } catch (e) {
      log(`request error: ${e?.stack ?? e}`);
      send(res, 500, { error: "internal error" });
    }
  };
}
