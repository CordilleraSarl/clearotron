#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// http-server-client.mjs — the CLIENT-facing MCP surface (spec 61 §E). A SECOND instance of the read-only
// HTTP face, distinct from the staff http-server.mjs, so "a client can never reach `internal` read-all" is a
// CONFIGURATION FACT (a separate process wired clientSurface:true), not a branch that could be mis-flagged.
//
// Differences from the staff surface (http-server.mjs):
//   • Verifies the CLIENT Cloudflare Access application AUD (CLEAROTRON_CLIENT_OIDC_AUDIENCE) — a staff-AUD JWT fails the
//     audience check here (confused-deputy guard), so staff credentials cannot drive this surface.
//   • allowAnyDomain:true — authorization is by per-app AUD + a run-bound `user` token, NOT by email domain
//     (clients span many domains: client-a.example, client-b.example, …). The empty-domain opt-out is DELIBERATE and stated.
//   • clientSurface:true — resolveScope() will yield ONLY a run-bound `user` scope here. No token ⇒ 403; an
//     ops/internal resolution is structurally impossible. This is the leak-#6 fix made load-bearing.
//   • Startup assertion: CLEAROTRON_CLIENT_OIDC_AUDIENCE must DIFFER from the staff CLEAROTRON_OIDC_AUDIENCE — a copy-paste of the
//     staff AUD would collapse the two surfaces; refuse to start.
//
//   • Any JWT-fronting proxy, not one vendor: CLIENT_MCP_OIDC_ISSUER / _JWKS_URL / _EMAIL_CLAIM /
//     _AUTH_HEADER, defaulting to the staff face's TRADEMARK_MCP_* so both doors share one provider.
//
// Binds loopback only; the sole ingress is the CLIENT Cloudflare Tunnel → the CLIENT CF Access app. Fail-closed
// exactly like the staff surface: auth is ON unless CLIENT_MCP_AUTH_DISABLED=1 AND CLIENT_MCP_DEV=1 (loopback).
//
// THE GRANTS GUARD — WHY IT EXISTS NOW, AND WHY IT DID NOT BEFORE.
//
// This comment used to argue, correctly and at length, that a mandatory-grants guard here would be "inert
// config theatre": no path a client request could reach ever called accountsForEmail, because
// resolveScope(clientSurface:true) refused every token-less caller as its FIRST statement. That was true
// for as long as a run-bound `user` token was the only admissible principal.
//
// It is no longer true. CLIENT_MCP_ACCOUNT_ACCESS=1 opens a second principal — a CF-verified client
// identity with NO token, resolved to its granted accounts (kind "account"). That path calls
// accountsForEmail(email, loadGrants()) with a CLIENT identity, which is exactly the chain the staff
// surface's guard exists to protect: `if (!grants) return "*"` means a missing guest list would read as
// "every customer". resolveScope refuses that wildcard explicitly, so the hole is closed there too — but
// defence in depth is the point of a startup guard, and a deployment that turns the feature on while
// forgetting the grants file should not boot at all rather than serve 403s nobody can explain.
//
// So: the flag is OFF by default (deploying this code changes nothing), and ON without CLEAROTRON_ACCESS_FILE
// is a FATAL start. `internal` remains structurally unreachable on this process — that half of the old
// argument still holds, and both halves stay pinned by test/client-surface-hardening.test.mjs.
//
// The OTHER half of that hardening — the literal-loopback check — DID apply, and is fixed at LOOPBACK below.

import { createServer } from "node:http";
import { envFrom } from "../shared/env-aliases.mjs";   // — a refusal names the name in force
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { warnRetiredEnv } from "../shared/env-aliases.mjs";   // — names only; reads no file
import { makeServer, NS } from "./server.mjs";
import { makeAccessVerifier } from "./lib/cf-access.mjs";
import { accessAudience, audienceIncludes } from "../shared/access-audience.mjs";   // — F54
import { RateLimiter } from "./lib/ratelimit.mjs";
import { makeHttpHandler } from "./lib/http-handler.mjs";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";   // — one entry-point test, all spellings
import { listenOrDie, resolvePort } from "../shared/listen.mjs";   // — a taken port is a sentence, not a stack

const log = (...a) => process.stderr.write(`[${NS}-client] ${a.join(" ")}\n`);

// ---- config (env) ------------------------------------------------------------------------------
// 18811 is the deployed port (remote/client-mcp.service, the CF tunnel's clients-mcp target). The old
// default of 18795 collided with ghostfolio's warm-MCP block — only the unit's explicit setting kept them
// apart, so a run without that env would have bound someone else's port.
// — resolved through the shared helper so the SOURCE travels with the number. "18811" and
// "18811 because nobody said otherwise" are different addresses to an operator, and only the
// second one is a guess at which instance this is.
const PORT_CHOICE = resolvePort({ value: process.env.CLIENT_MCP_HTTP_PORT, name: "CLIENT_MCP_HTTP_PORT", fallback: 18811 });
const PORT = PORT_CHOICE.port;
const HOST = process.env.CLIENT_MCP_HTTP_HOST || "127.0.0.1"; // loopback; the client CF Tunnel is the only ingress
const AUTH_DISABLED = process.env.CLIENT_MCP_AUTH_DISABLED === "1";
const DEV = process.env.CLIENT_MCP_DEV === "1";
const TEAM = process.env.CF_ACCESS_TEAM || "";                     // same Cloudflare team; the AUD is what differs
const CLIENT_AUD = envFrom(process.env, "CLEAROTRON_CLIENT_OIDC_AUDIENCE") || "";
// — F54 made the STAFF audience a LIST, and that breaks equality as a way to
// express this boundary. With staff "portal,ops" and a client audience of "ops", `!==` is TRUE and
// this door would start sharing an audience the staff surface accepts — the client/staff collapse
// the assertion below exists to refuse. Membership is the question, not equality.
const STAFF_AUD = accessAudience(envFrom(process.env, "CLEAROTRON_OIDC_AUDIENCE"));   // only to assert the client AUD is not one of them
// ── — BRING YOUR OWN LOGIN PROVIDER, on the client door too. The four values the staff face reads
// as TRADEMARK_MCP_* under this surface's own prefix. Unset ⇒ the Cloudflare Access shapes derived from
// CF_ACCESS_TEAM, so nothing configured today changes.
//
// THE ISSUER IS SHARED WITH THE STAFF DOOR AND THE AUDIENCE IS NOT, and that asymmetry is the whole
// point of this surface: both doors sit behind the same identity provider, and the confused-deputy
// guard below is what keeps a staff token from driving a client session. Renaming the issuer per
// surface would let an operator point the two at DIFFERENT providers by typo, which the AUD check
// cannot catch — so this defaults to the staff spelling and is overridable only deliberately.
const OIDC_ISSUER = process.env.CLIENT_MCP_OIDC_ISSUER || process.env.TRADEMARK_MCP_OIDC_ISSUER || "";
const JWKS_URL = process.env.CLIENT_MCP_JWKS_URL || process.env.TRADEMARK_MCP_JWKS_URL || "";
const EMAIL_CLAIM = process.env.CLIENT_MCP_EMAIL_CLAIM || process.env.TRADEMARK_MCP_EMAIL_CLAIM || "email";
// Lowercased when read — Node lowercases incoming header names, so a verbatim `Cf-Access-Jwt-Assertion`
// here would match nothing and refuse every correctly authenticated caller.
const AUTH_HEADER = (process.env.CLIENT_MCP_AUTH_HEADER || process.env.TRADEMARK_MCP_AUTH_HEADER || "cf-access-jwt-assertion").toLowerCase();
const ALLOWED_HOSTS = (process.env.CLIENT_MCP_ALLOWED_HOSTS || "").split(",").map((s) => s.trim()).filter(Boolean);
const SESSION_TTL_MS = Number(process.env.CLIENT_MCP_SESSION_TTL_MS || 30 * 60 * 1000);
const SESSION_MAX = Number(process.env.CLIENT_MCP_SESSION_MAX || 500);
const RATE_PER_MIN = Number(process.env.CLIENT_MCP_RATE_PER_MIN || 120);
const ACCOUNT_ACCESS = process.env.CLIENT_MCP_ACCOUNT_ACCESS === "1";
// THE API-KEY DOOR. Cloudflare Access authenticates a HUMAN in a browser; a connector whose settings offer
// one fixed "API key" box cannot do that, and Access cannot be gated on a custom header value — so an
// agent holding a credential has no way through the CF-fronted door. This mode is that way through: no auth
// proxy in front, and in its place a MANDATORY account key (mint-token.mjs --scope account), which resolves
// to exactly the same `account` principal the browser sign-in yields. Every downstream gate — the
// accountSafe tool set, authorize(), the client scrub, runCaps — is untouched and unaware.
//
// It is a different security posture, so it is a DIFFERENT PROCESS: its own unit, port and hostname, the
// same way the client surface itself is a separate process rather than a flag on the staff one. The
// CF-fronted client door is not modified, and nothing here can widen it.
const TOKEN_ONLY = process.env.CLIENT_MCP_TOKEN_ONLY === "1";
// Literal loopback addresses ONLY — "localhost" is deliberately absent, matching the staff surface
// (http-server.mjs: `// Literal loopback addresses only — "localhost" can resolve elsewhere on a
// hostile resolver.`). This twin had it in the set, so the auth-disabled guard below accepted
// CLIENT_MCP_HTTP_HOST=localhost and then handed the name to net.listen, which RESOLVES it: an
// /etc/hosts line, an nsswitch change, or a DNS-search-domain trick binds this door to a reachable
// address while the guard reports it as loopback. The consequence is smaller here than on the staff
// surface (clientSurface:true still demands a run-bound user token, so this is not read-all) but it is
// not nothing: it would put the client MCP face on the network with CF Access bypassed entirely, so a
// leaked report token would be exercisable from anywhere instead of only from this box.
// Nothing in the tree sets this host to "localhost" (only remote/client-mcp.service, which pins
// 127.0.0.1), so tightening the set breaks no existing caller.
const LOOPBACK = new Set(["127.0.0.1", "::1"]);

// Per-session transport — identical to the staff surface EXCEPT the scope a client session may hold is only
// ever a run-bound `user` or a granted `account` (enforced upstream by resolveScope(clientSurface:true)).
// The default scope here is intentionally never `internal`.
//
// `local:false` USED TO BE THE REASON what-if was never exposed here, and since the owner's 2026-08-27
// ruling it is not: visibleTools' `local` test governs the OPS branch only, and an account principal
// reaches what_if_plan / what_if_run / what_if_result through `accountSafe`. What keeps this surface from
// shelling is no longer a hidden tool but the tool's own shape — server.mjs's what_if_run ENQUEUES for an
// account and never imports the engine, and driver/whatif-worker.mjs is what runs it. `local:false` still
// stands and still keeps what-if out of an OPS session's listing; it is simply no longer the whole story.
// `owner` is the CF-verified email, recorded so lib/http-handler.mjs's session owner check ("session
// belongs to another identity") actually fires here. It was omitted, so the map entry had no email and the
// check was inert on this surface — tolerable while every session was pinned to one run by its token, and
// not tolerable now that an account session carries a whole account's reach.
async function createSession(sessions, scope, owner = null) {
  const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
  const server = makeServer({ scope, local: false });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableDnsRebindingProtection: ALLOWED_HOSTS.length > 0,
    allowedHosts: ALLOWED_HOSTS.length ? ALLOWED_HOSTS : undefined,
    onsessioninitialized: (id) => sessions.set(id, { server, transport, lastSeen: Date.now(), email: owner, kind: scope?.kind ?? null }),
  });
  transport.onclose = () => { if (transport.sessionId) sessions.delete(transport.sessionId); };
  await server.connect(transport);
  return transport;
}

// ---- bootstrap (only when executed directly) ---------------------------------------------------
const isMain = isEntrypoint(import.meta.url);
if (isMain) {
  // — translate the CLEAROTRON_* rename before any config read. Translation ONLY: it reads no
  // file, so this gains the rename without gaining a second, unnamed source of values.
  warnRetiredEnv();
  let verify = null;
  if (TOKEN_ONLY) {
    // Fail-closed in five ways. The first two are the ones that would actually hurt: combined with the dev
    // knob the handler would hand out a synthetic identity instead of demanding a key, and without the
    // signing secret no key can be verified at all.
    if (AUTH_DISABLED) { log("FATAL: CLIENT_MCP_TOKEN_ONLY=1 and CLIENT_MCP_AUTH_DISABLED=1 are mutually exclusive — one demands a key, the other waives authentication entirely (refusing to start)."); process.exit(1); }
    if (!process.env.TRADEMARK_MCP_TOKEN_SECRET) { log("FATAL: CLIENT_MCP_TOKEN_ONLY=1 requires TRADEMARK_MCP_TOKEN_SECRET — there is nothing to verify keys against (refusing to start)."); process.exit(1); }
    if (!ACCOUNT_ACCESS) { log("FATAL: CLIENT_MCP_TOKEN_ONLY=1 requires CLIENT_MCP_ACCOUNT_ACCESS=1 — an account key resolves through the client account principal, which is off (refusing to start)."); process.exit(1); }
    if (!LOOPBACK.has(HOST)) { log(`FATAL: token-only door but HOST=${HOST} is not loopback — the tunnel is the only ingress; refusing to listen on a reachable address.`); process.exit(1); }
    if (ALLOWED_HOSTS.length === 0) { log("FATAL: CLIENT_MCP_TOKEN_ONLY=1 but CLIENT_MCP_ALLOWED_HOSTS is unset — refusing to start (DNS-rebinding protection would be off)."); process.exit(1); }
    log(`API-KEY door — no auth proxy in front; a valid account key is MANDATORY on every request (allowedHosts=[${ALLOWED_HOSTS.join(", ")}]).`);
  } else if (AUTH_DISABLED) {
    if (!DEV) { log("FATAL: CLIENT_MCP_AUTH_DISABLED=1 also requires CLIENT_MCP_DEV=1 (dev only) — refusing to start (fail-closed)."); process.exit(1); }
    if (!LOOPBACK.has(HOST)) { log(`FATAL: auth disabled but HOST=${HOST} is not loopback — refusing to listen on a reachable address.`); process.exit(1); }
    log("WARNING: auth DISABLED (dev mode, loopback only) — LOCAL TESTING ONLY. Never expose this process.");
  } else if ((!TEAM && !OIDC_ISSUER) || !CLIENT_AUD) {
    // AN AUDIENCE PLUS EITHER A TEAM OR AN ISSUER. A deployment fronted by its own provider
    // holds no vendor team, and demanding one refused to start on a correct configuration. Missing both
    // is still fatal — the client AUD alone never builds a verifier.
    log(`FATAL: auth enabled but CLEAROTRON_CLIENT_OIDC_AUDIENCE plus CF_ACCESS_TEAM or CLIENT_MCP_OIDC_ISSUER (or the staff TRADEMARK_MCP_OIDC_ISSUER it falls back to) are missing — refusing to start (fail-closed).`); process.exit(1);
  } else if (audienceIncludes(STAFF_AUD, CLIENT_AUD)) {
    log(`FATAL: CLEAROTRON_CLIENT_OIDC_AUDIENCE is one of the audiences CLEAROTRON_OIDC_AUDIENCE accepts `
      + `(staff accepts ${Array.isArray(STAFF_AUD) ? STAFF_AUD.length : 1}). The client surface MUST use a `
      + `distinct CF Access application AUD: sharing one means a staff token opens the client door and a client `
      + `token opens the staff surface (refusing; this would collapse the client/staff boundary).`); process.exit(1);
  } else if (ALLOWED_HOSTS.length === 0) {
    log("FATAL: auth enabled but CLIENT_MCP_ALLOWED_HOSTS is unset — refusing to start (DNS-rebinding protection would be off)."); process.exit(1);
  } else {
    // allowAnyDomain:true is DELIBERATE — the client surface gates by AUD + run token, not email domain.
    verify = makeAccessVerifier({ team: TEAM, aud: CLIENT_AUD, allowedDomains: [], allowAnyDomain: true,
      issuer: OIDC_ISSUER || undefined, jwksUrl: JWKS_URL || undefined, emailClaim: EMAIL_CLAIM });
    log(`auth ON — CLIENT issuer=${OIDC_ISSUER || `CF Access team=${TEAM}`} aud=${CLIENT_AUD.slice(0, 8)}… claim=${EMAIL_CLAIM} header=${AUTH_HEADER} (domain gate OFF by design) allowedHosts=[${ALLOWED_HOSTS.join(", ")}]`);
  }

  // Account access is opt-in AND requires the guest list — see the grants-guard note in the header.
  if (ACCOUNT_ACCESS && !envFrom(process.env, "CLEAROTRON_ACCESS_FILE")) {
    log(`FATAL: CLIENT_MCP_ACCOUNT_ACCESS=1 requires CLEAROTRON_ACCESS_FILE`
      + " — without a guest list there is nothing to scope a client identity to (refusing to start)."); process.exit(1);
  }
  log(ACCOUNT_ACCESS
    ? `client ACCOUNT access ON — ${TOKEN_ONLY ? "an account KEY" : "a CF-verified client identity"} resolves to its granted accounts (run-token sessions unaffected).`
    : "client ACCOUNT access OFF — run-bound report tokens only (set CLIENT_MCP_ACCOUNT_ACCESS=1 to enable).");

  const limiter = new RateLimiter({ perMinute: RATE_PER_MIN });
  const sessions = new Map();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [id, e] of sessions) if (now - e.lastSeen > SESSION_TTL_MS) { try { e.transport.close(); } catch { /* ignore */ } sessions.delete(id); }
  }, 60_000);
  sweep.unref();

  // clientSurface:true — the load-bearing flag: resolveScope() admits ONLY a run-bound user token here.
  // devMode mirrors the staff surface: makeHttpHandler fail-closes on verify:null unless the dev knobs
  // (CLIENT_MCP_AUTH_DISABLED=1 + CLIENT_MCP_DEV=1, enforced above) explicitly opted this process in.
  // authHeader was NOT passed before, so this door read `cf-access-jwt-assertion` whatever the
  // operator configured — the seam above would have been advertised and inert, which is worse than
  // absent. The staff face has always passed it; this is the same line, one file over.
  const handler = makeHttpHandler({ verify, limiter, sessions, createSession, ns: NS, sessionMax: SESSION_MAX, clientSurface: true, authHeader: AUTH_HEADER, devMode: !verify && !TOKEN_ONLY, tokenOnly: TOKEN_ONLY, log });
  const mode = verify ? "auth ON" : TOKEN_ONLY ? "API-KEY door (key mandatory)" : "AUTH OFF (dev)";
  // — this is the door a client's own AI connects through, so the person who meets a taken port is
  // very often not the person who can read a Node stack trace.
  listenOrDie(createServer(handler), {
    port: PORT, host: HOST, what: "the client MCP surface", portVar: "CLIENT_MCP_HTTP_PORT", portSource: PORT_CHOICE.source, log,
    onReady: ({ port: bound }) => log(`listening on http://${HOST}:${bound}/mcp — CLIENT surface (never internal), ${mode}`),
  });

  // ── STOPPING THIS DOOR REVOKES NOTHING, AND THE STOP SAYS SO ──────────────
  //
  // An account key is valid until it expires or its id is denylisted; the person most likely to believe
  // "I turned it off" is the one who just stopped this service, so the one line lands exactly where
  // their `systemctl stop` puts its last words — the journal — and names the verb that actually revokes.
  for (const sig of ["SIGTERM", "SIGINT"]) {
    process.on(sig, () => {
      log(`stopping — issued keys SURVIVE this stop and stay valid until they expire; \`clearotron disconnect\` is what revokes them.`);
      process.exit(0);
    });
  }
}
