#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// http-server.mjs — the REMOTE, authenticated HTTP face of the trademark-artifacts MCP.
// This is the STAFF surface; the client-facing twin is http-server-client.mjs (a separate process).
//
// Distinct from the local stdio server.mjs (which keeps the full tool set incl. gated what-if). This surface:
//   • NEVER shells: what_if_plan / what_if_run are omitted remotely. A CF-authed staff identity resolves to
//     `internal` and gets the read tools only; an ops TOKEN also gets the write verbs (start_run, stop_run,
//     feed_context, mark_sent, ack_event), and start_run spends — hence its own lower rate bucket below.
//     STILL TRUE, AND NOW LOAD-BEARING ELSEWHERE: the owner opened what-if to
//     client accounts on the CLIENT twin, and it holds this same property by ENQUEUEING — the account
//     path returns an experimentId and a worker spawns the engine, so no remote face shells. Nothing
//     about THIS surface changes; what-if remains omitted here for every principal.
//   • Binds LOOPBACK only; the sole ingress is a Cloudflare Tunnel → Cloudflare Access (Entra IdP).
//   • Re-validates the Cloudflare Access JWT on EVERY request and gates by email domain (defence in depth).
//   • Audit-logs who called what; rate-limits per identity; bounds the session table (TTL sweep + cap).
// Fail-closed: auth is ON unless TRADEMARK_MCP_AUTH_DISABLED=1 AND TRADEMARK_MCP_DEV=1 (loopback only); when ON,
// missing CF_ACCESS_* or TRADEMARK_MCP_ALLOWED_HOSTS ⇒ refuse to start.
// THIRD DOOR: TRADEMARK_MCP_AUTH_MODE=token requires a valid scoped ACCESS KEY on every request and
// runs no auth proxy — loopback only, and mutually exclusive with the bypass above. Unset changes nothing.
//
// The handler logic lives in lib/http-handler.mjs (undici-free, testable); this file wires config, the SDK
// transport (lazy-imported), and the listener.

import "../shared/env-local.mjs";   // side effect: apply <repo>/.env when THIS file is the CLI entry (never on library import)
import { envFrom } from "../shared/env-aliases.mjs";   // — a refusal names the name in force
import { accessAudience, audienceLabel } from "../shared/access-audience.mjs";   // — F54; jose-free on purpose
import { doorPostureVerdict } from "./door-posture.mjs";   // — say when this door's mode came from another door's variables
import { demoPostureLine } from "../driver/demo-posture.mjs";   // — the two mis-aimed warnings answer from one place
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { makeServer, NS } from "./server.mjs";
import { makeAccessVerifier } from "./lib/cf-access.mjs";
import { RateLimiter } from "./lib/ratelimit.mjs";
import { makeHttpHandler } from "./lib/http-handler.mjs";
import { listenOrDie, resolvePort } from "../shared/listen.mjs";   // — a taken port is a sentence, not a stack
import { loadGrants } from "../shared/scope.mjs";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";   // — one entry-point test, all spellings

const log = (...a) => process.stderr.write(`[${NS}-http] ${a.join(" ")}\n`);

/**
 * Every account key any tenant is granted, for the boot-time roster cross-check below.
 *
 * The UNION of the tenants' account lists, which is the right side of the comparison: an account
 * somebody has been granted access to is an account they will sooner or later press Start for. A
 * tenant granted `"*"` contributes nothing — it names no keys, so it can neither add to nor
 * contradict the roster, and treating it as "all" would make the check compare a list against itself.
 *
 * Returns [] on any trouble. This feeds a WARNING, and a warning that throws is worse than no warning.
 */
export function grantedAccounts(grantsPath) {
  try {
    if (!grantsPath) return [];
    const g = loadGrants({ grantsPath });
    const set = new Set();
    for (const t of Object.values(g?.tenants ?? {})) {
      if (t?.accounts === "*" || !Array.isArray(t?.accounts)) continue;
      for (const a of t.accounts) if (typeof a === "string" && a.trim()) set.add(a.trim());
    }
    return [...set].sort();
  } catch { return []; }
}

// ---- config (env) ------------------------------------------------------------------------------
// — THE DEFAULT IS A NAMED CONSTANT BECAUSE TWO FILES HOLD IT. `bin/start.mjs`'s `resolvePorts`
// carries the same number for the same variable, and until now nothing compared them: the spawner and
// the thing it spawns could have drifted apart silently, and the face would simply have listened
// somewhere the portal was not calling. Exported so driver/test/start-command.test.mjs can assert the
// two agree, which is the only thing that makes this a single default rather than two equal literals.
export const DEFAULT_HTTP_PORT = 18790;
// — resolved through the shared helper so the SOURCE travels with the number.
const PORT_CHOICE = resolvePort({ value: process.env.TRADEMARK_MCP_HTTP_PORT, name: "TRADEMARK_MCP_HTTP_PORT", fallback: DEFAULT_HTTP_PORT });
const PORT = PORT_CHOICE.port;
const HOST = process.env.TRADEMARK_MCP_HTTP_HOST || "127.0.0.1"; // loopback; CF Tunnel is the only ingress
const AUTH_DISABLED = process.env.TRADEMARK_MCP_AUTH_DISABLED === "1";
const DEV = process.env.TRADEMARK_MCP_DEV === "1";
// ──: A THIRD DOOR THAT PROVES SOMETHING, CHOSEN BY NAME ────────────────────────────────────────
//
// `token` wires the ACCESS-KEY door lib/http-handler.mjs already implements (`tokenOnly:true`): no auth
// proxy in front, and a valid HMAC-signed scoped key REQUIRED on every request, checked before the rate
// limiter, the body, the session and anything else, with no synthetic identity to fall back on. It is
// the opposite of `TRADEMARK_MCP_AUTH_DISABLED` — which authenticates nobody and hands every caller
// `local-test@disabled` — and the handler refuses outright to build the two together.
//
// It exists because 's one-command local install needs the trigger lane, the trigger lane is this
// face, and a startup command that has to switch authentication off to reach it is the defect that
// issue is about. The portal holds a verb-scoped, account-capped ops token; this door demands it.
//
// NAMED, NEVER INFERRED — the same rule wrote for PORTAL_AUTH_MODE, for the same reason. Unset
// means exactly what it meant before this line existed, including the dev bypass still working, so a
// deployment that loses CLEAROTRON_OIDC_AUDIENCE still refuses to start rather than quietly becoming a key door.
const AUTH_MODE = (process.env.TRADEMARK_MCP_AUTH_MODE || "").trim().toLowerCase();
const TOKEN_ONLY = AUTH_MODE === "token";
const TEAM = process.env.CF_ACCESS_TEAM || "";
// — F54. A deployment runs one Access application per audience; jose has
// always accepted a list. `accessAudience` keeps a STRING for 0 or 1 so the `!AUD` guard below
// stays fail-closed — an empty array would be truthy and open it.
const AUD = accessAudience(envFrom(process.env, "CLEAROTRON_OIDC_AUDIENCE"));
// Tenant-parameterized auth: a different JWT-fronting proxy is config, not code — issuer +
// JWKS + identity-claim + header name. Unset ⇒ the CF Access shapes derived from CF_ACCESS_TEAM.
const OIDC_ISSUER = process.env.TRADEMARK_MCP_OIDC_ISSUER || "";
const JWKS_URL = process.env.TRADEMARK_MCP_JWKS_URL || "";
const EMAIL_CLAIM = process.env.TRADEMARK_MCP_EMAIL_CLAIM || "email";
const AUTH_HEADER = (process.env.TRADEMARK_MCP_AUTH_HEADER || "cf-access-jwt-assertion").toLowerCase();
// Identity gates. NO default domain: auth ON with neither a domain list nor an email allowlist refuses
// to start (fail-closed — the old "example.com" default LOOKED like a gate while matching nobody real,
// and silently disabled per-tenant thought about who may connect).
const ALLOWED_DOMAINS = (process.env.MCP_ALLOWED_EMAIL_DOMAINS || "").split(",").map((s) => s.trim()).filter(Boolean);
const ALLOWED_EMAILS = (process.env.MCP_ALLOWED_EMAILS || "").split(",").map((s) => s.trim()).filter(Boolean);
const ALLOWED_HOSTS = (process.env.TRADEMARK_MCP_ALLOWED_HOSTS || "").split(",").map((s) => s.trim()).filter(Boolean);
const SESSION_TTL_MS = Number(process.env.TRADEMARK_MCP_SESSION_TTL_MS || 30 * 60 * 1000);
const SESSION_MAX = Number(process.env.TRADEMARK_MCP_SESSION_MAX || 500);
const RATE_PER_MIN = Number(process.env.TRADEMARK_MCP_RATE_PER_MIN || 120);
// Literal loopback addresses only — "localhost" can resolve elsewhere on a hostile resolver.
const LOOPBACK = new Set(["127.0.0.1", "::1"]);

// Create a per-session MCP transport (read-only server), registered into `sessions`. The Streamable-HTTP
// transport is imported lazily here (it pulls @hono/node-server/undici) so nothing else has to.
// `owner` = the authed email that created the session; stored on the entry so the handler can refuse a
// different identity attaching to it (session owner-binding).
async function createSession(sessions, scope = { kind: "internal", runId: null }, owner = null) {
  const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
  // HTTP is never the trusted-local surface: local:false (so what-if is never exposed remotely, even to ops).
  const server = makeServer({ scope, local: false });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableDnsRebindingProtection: ALLOWED_HOSTS.length > 0,
    allowedHosts: ALLOWED_HOSTS.length ? ALLOWED_HOSTS : undefined,
    onsessioninitialized: (id) => sessions.set(id, { server, transport, lastSeen: Date.now(), email: owner, sub: scope?.sub ?? null, kind: scope?.kind ?? null }),
  });
  transport.onclose = () => { if (transport.sessionId) sessions.delete(transport.sessionId); };
  await server.connect(transport);
  return transport;
}

// ---- bootstrap (only when executed directly) ---------------------------------------------------
const isMain = isEntrypoint(import.meta.url);
if (isMain) {
  let verify = null;
  if (TOKEN_ONLY) {
    // The two mean OPPOSITE things — a mandatory key and no key at all — so an operator who set both
    // has a broken picture of which door is open. Refuse rather than pick one and log about it.
    if (AUTH_DISABLED) { log("FATAL: TRADEMARK_MCP_AUTH_MODE=token and TRADEMARK_MCP_AUTH_DISABLED=1 are contradictory — one demands a valid access key on every request, the other authenticates nobody. Unset the bypass. Refusing to start."); process.exit(1); }
    // LOOPBACK ONLY, and fatal. On this door the key rides a header or the query string, so off
    // loopback without TLS it is on the wire in clear — and it is an OPS key, which can start runs that
    // spend. Put a TLS-terminating proxy in front if it must be reachable; that is a deployment, and a
    // deployment has the Cloudflare Access door above.
    if (!LOOPBACK.has(HOST)) { log(`FATAL: TRADEMARK_MCP_AUTH_MODE=token with TRADEMARK_MCP_HTTP_HOST=${HOST} would carry an ops access key over plaintext to another machine — refusing to listen on a reachable address.`); process.exit(1); }
    // Same refusal the auth-ON branch makes, for the same reason: `enableDnsRebindingProtection` is
    // keyed off this list being non-empty, so unset silently turns the protection OFF.
    if (!ALLOWED_HOSTS.length) { log("FATAL: TRADEMARK_MCP_AUTH_MODE=token but TRADEMARK_MCP_ALLOWED_HOSTS is unset — refusing to start (DNS-rebinding protection would be off). Set it to the host:port this door is reached on, e.g. 127.0.0.1:18790."); process.exit(1); }
    // NOT load-bearing today, and here anyway. On this door every session's reach comes from its key
    // (shared/scope.mjs resolveScope: an ops key carries its own `accounts`, a user key is run-bound, an
    // account key is refused outright) and a token-less caller is refused before the grants file is
    // consulted — `firmStaff` is forced false for tokenOnly at http-handler.mjs. So the read-all the
    // auth-disabled branch's identical guard prevents is not reachable from here. It is mirrored
    // because that "not reachable" is one boolean wide: flip `firmStaff` back on for this mode and a
    // missing grants file becomes silent read-all across every customer, which is the failure this
    // repo keeps paying for. One file read at boot is a cheap fence around a one-line regression.
    if (!envFrom(process.env, "CLEAROTRON_ACCESS_FILE")) {
      log(`FATAL: TRADEMARK_MCP_AUTH_MODE=token but CLEAROTRON_ACCESS_FILE is unset` + " — refusing to start. Point it at a grants file, even one containing only {\"tenants\":{}}.");
      process.exit(1);
    }
    log(`auth ON — access key required on every request (no auth proxy in front), loopback only, allowedHosts=[${ALLOWED_HOSTS.join(", ")}]`);
  } else if (AUTH_MODE && AUTH_MODE !== "cf-access") {
    // An unrecognised mode is FATAL, never a silent fall-through to the default: a typo must not be
    // able to select an identity source nobody chose.
    log(`FATAL: TRADEMARK_MCP_AUTH_MODE="${AUTH_MODE}" is not a mode this face has. Use "token" (a mandatory access key, loopback) or "cf-access" (the Cloudflare Access edge; also the default when unset). Refusing to start.`);
    process.exit(1);
  } else if (AUTH_DISABLED) {
    if (!DEV) { log("FATAL: TRADEMARK_MCP_AUTH_DISABLED=1 also requires TRADEMARK_MCP_DEV=1 (dev only) — refusing to start (fail-closed)."); process.exit(1); }
    if (!LOOPBACK.has(HOST)) { log(`FATAL: auth disabled but HOST=${HOST} is not loopback — refusing to listen on a reachable address.`); process.exit(1); }
    // A grants file is MANDATORY here, and this guard exists because the alternative is silent and bad.
    //
    // With auth disabled there is no verified email, so every token-less caller is treated as firm staff
    // and resolves to `internal` scope (http-handler.mjs: firmStaff = verify ? isFirmDomain(…) : true).
    // Its visibility then comes from accountsForEmail(email, loadGrants()) — and in shared/scope.mjs the
    // first line of that function reads `if (!grants) return "*"`. No grants file therefore means EVERY
    // LOCAL PROCESS CAN READ EVERY CUSTOMER, unauthenticated, with one HTTP call. With any grants file
    // present, an unrecognised identity resolves to [] and reads nothing.
    //
    // Found by probing a freshly-started loopback door on this box and getting a session without a token.
    // Fail closed rather than trusting whoever writes the next unit to remember.
    if (!envFrom(process.env, "CLEAROTRON_ACCESS_FILE")) {
      log(`FATAL: auth disabled but CLEAROTRON_ACCESS_FILE is unset` + " — refusing to start. Without it every token-less local caller resolves to internal read-all across ALL customers (shared/scope.mjs: accountsForEmail returns \"*\" when there are no grants). Point it at a grants file, even one with an empty `tenants` object.");
      process.exit(1);
    }
    log("WARNING: auth DISABLED (dev mode, loopback only) — LOCAL TESTING ONLY. Never expose this process.");
  } else if ((!TEAM && !OIDC_ISSUER) || !AUD) {
    log(`FATAL: auth enabled but CLEAROTRON_OIDC_AUDIENCE plus CF_ACCESS_TEAM or TRADEMARK_MCP_OIDC_ISSUER are missing — refusing to start (fail-closed).`); process.exit(1);
  } else if (ALLOWED_DOMAINS.length === 0 && ALLOWED_EMAILS.length === 0) {
    log("FATAL: auth enabled but neither MCP_ALLOWED_EMAIL_DOMAINS nor MCP_ALLOWED_EMAILS is set — refusing to start (the identity gate would admit every account the IdP knows)."); process.exit(1);
  } else if (ALLOWED_HOSTS.length === 0) {
    log("FATAL: auth enabled but TRADEMARK_MCP_ALLOWED_HOSTS is unset — refusing to start (DNS-rebinding protection would be off)."); process.exit(1);
  } else {
    verify = makeAccessVerifier({ team: TEAM, aud: AUD, allowedDomains: ALLOWED_DOMAINS, allowedEmails: ALLOWED_EMAILS,
      issuer: OIDC_ISSUER || undefined, jwksUrl: JWKS_URL || undefined, emailClaim: EMAIL_CLAIM });
    log(`auth ON — issuer=${OIDC_ISSUER || `CF Access team=${TEAM}`} aud=${audienceLabel(AUD)} claim=${EMAIL_CLAIM} header=${AUTH_HEADER} domains=[${ALLOWED_DOMAINS.join(", ")}] emails=${ALLOWED_EMAILS.length} allowedHosts=[${ALLOWED_HOSTS.join(", ")}]`);
    // ── — AND SAY IF NOBODY CHOSE THIS DOOR ────────────────────────────────
    //
    // The line above states the posture; it never stated whether anyone MEANT it. This face reached the
    // auth-proxy branch by DEFAULT and satisfied itself from the portal's CF_ACCESS_* values in the
    // shared environment file, so a reader of that line could not tell a deliberate fronted door from a
    // door that inherited one. WARNING, not FATAL: a tunnel terminating at this loopback port is a
    // correct and shipped deployment, and no process can see from the inside whether one is there.
    // `scripts/live-surface-check.mjs` records the same verdict where a deploy will read it.
    {
      const posture = doorPostureVerdict({ declaredMode: process.env.TRADEMARK_MCP_AUTH_MODE,
        effectiveMode: "cf-access", allowedHosts: ALLOWED_HOSTS });
      if (posture.bootNote) log(`WARNING: ${posture.bootNote}`);
    }
  }

  // ── THE ROSTER THIS PROCESS CAN ACTUALLY SEE ──────────────────────────────────────────────────────
  //
  // WHAT THIS EXISTS FOR. `start_run` validates `profileKey` against `loadProfiles()`, which reads
  // CLEAROTRON_CUSTOMERS_DIR **resolved at module load** and — when that variable is unset — silently falls
  // back to the demo roster bundled at driver/profiles. It does not warn. It does not fail. It simply
  // knows four fictional customers instead of the real ones, and refuses every genuine job with
  // "names no known customer", a sentence that points at the customer rather than at this process.
  //
  // That is not hypothetical. On 2026-07-22 this door had neither CLEAROTRON_CUSTOMERS_DIR nor the shared
  // EnvironmentFile — the ONLY service in the fleet without either — so the very first clearance ever
  // started from the portal was refused, and the portal reported it as an upstream error with no clue
  // that a path was the cause. driver/profiles.mjs already carries a header about the SAME roster
  // split biting in 2026-07-19; a comment was evidently not enough, so this is a check.
  //
  // WHY IT CROSS-CHECKS THE GRANTS. Enrolling a customer touches several places, and the failure mode
  // that keeps recurring is one of them being missed — the enrolment is correct and a second thing
  // that had to move with it did not. Comparing the granted accounts against the roster this process
  // can see turns the NEXT such miss into a boot line naming the account, instead of a refusal
  // someone has to reverse-engineer. Deliberately mirrors the identical check portal-service.mjs runs
  // against the ops token's account cap.
  //
  // A warning only. A roster this door cannot read must never stop it starting: the read-only tools
  // are useful without it, and failing closed here would turn a config slip into an outage.
  try {
    const { loadProfiles } = await import("../driver/profiles.mjs");
    const roster = [...loadProfiles({ force: true }).keys()].sort();
    const where = envFrom(process.env, "CLEAROTRON_CUSTOMERS_DIR") || "(unset — BUNDLED demo roster at driver/profiles)";
    log(`roster: ${roster.length} customer(s) from ${where} — [${roster.join(", ")}]`);
    if (!envFrom(process.env, "CLEAROTRON_CUSTOMERS_DIR")) {
      // — SAME FACT, DIFFERENT READER. "Every real customer will be refused" is
      // true and useless to a demo visitor, who has none and wants none; what a first-time reader needs
      // is what the demo IS. Composed once, in driver/demo-posture.mjs, because the other mis-aimed
      // warning of this pair lives in the portal process and the two must not answer differently.
      //
      // OUTSIDE A DEMO IT IS UNCHANGED AND STILL A WARNING — an operator whose roster is the bundled one
      // has a real deployment that will refuse every real customer.
      const posture = demoPostureLine(process.env);
      if (posture) log(posture);
      else log(`WARNING: CLEAROTRON_CUSTOMERS_DIR is unset, so start_run is validating against the BUNDLED demo roster.`
        + " Every real customer will be refused with \"names no known customer\". Set it to the config store's profiles directory.");
    }
    const granted = grantedAccounts(envFrom(process.env, "CLEAROTRON_ACCESS_FILE"));
    const missing = granted.filter((a) => !roster.includes(a));
    if (missing.length) {
      log(`WARNING: account(s) granted portal access but ABSENT from this roster: ${missing.join(", ")}. start_run will refuse them with "names no known customer" — which names the customer, not the cause. Either add their profile to the config store, or point CLEAROTRON_CUSTOMERS_DIR at the store that has it.`);
    }
  } catch (e) {
    log(`roster: could not be read (${e?.message ?? e}) — start_run's customer validation is unverified at boot`);
  }

  const limiter = new RateLimiter({ perMinute: RATE_PER_MIN });
  // A separate, lower per-principal bucket for ops-token sessions (keyed by sub) — the write verbs.
  const opsLimiter = new RateLimiter({ perMinute: Number(process.env.TRADEMARK_MCP_OPS_RATE_PER_MIN || 30) });
  const sessions = new Map();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [id, e] of sessions) if (now - e.lastSeen > SESSION_TTL_MS) { try { e.transport.close(); } catch { /* ignore */ } sessions.delete(id); }
  }, 60_000);
  sweep.unref();

  // firmDomains = the SAME domain list the identity gate enforces. It is the POSITIVE proof of firm staff:
  // a tokenless caller reaches `internal` (read-all) only when their verified email domain is on this list —
  // not merely because the auth proxy let them in. Keeps staff read-all working while denying it to any
  // non-firm identity a mis-scoped edge might admit. Tenants gated purely by MCP_ALLOWED_EMAILS leave this
  // list empty, so tokenless internal read-all stays off for them (fail-closed) unless they set the domain list.
  const handler = makeHttpHandler({ verify, limiter, opsLimiter, sessions, createSession, ns: NS, sessionMax: SESSION_MAX,
    authHeader: AUTH_HEADER, devMode: !TOKEN_ONLY && AUTH_DISABLED && DEV, tokenOnly: TOKEN_ONLY, firmDomains: ALLOWED_DOMAINS, log });
  // Three states now, and the line must name the one it is in. "AUTH OFF (dev)" was printed by anything
  // with a null `verify`, which from here on includes the key door — a line claiming the opposite of
  // what the process is doing is worse than no line.
  const door = verify ? "auth ON" : TOKEN_ONLY ? "auth ON (access key)" : "AUTH OFF (dev)";
  // — a taken port is a sentence, not a stack. routed the four driver services through this
  // helper and stopped at the workspace boundary; three listeners were left throwing an unhandled
  // EADDRINUSE. This is the face a client's AI connects through, so the person who meets the crash is
  // often not the person who can read a stack trace.
  //
  // Statically imported, unlike the driver services' `await import` — that boot block sits inside an
  // async main and this one is a bare top-level `if`, where a dynamic import would make the whole module
  // async for everything that imports `grantedAccounts` from it.
  listenOrDie(createServer(handler), {
    port: PORT, host: HOST, what: "the MCP staff surface", portVar: "TRADEMARK_MCP_HTTP_PORT", portSource: PORT_CHOICE.source, log,
    onReady: ({ port: bound }) => log(`listening on http://${HOST}:${bound}/mcp — READ-ONLY staff surface, firmDomains=[${ALLOWED_DOMAINS.join(", ")}], ${door}`),
  });
}
