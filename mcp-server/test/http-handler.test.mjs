// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Handler-level tests for the remote HTTP face: drive makeHttpHandler with mock req/res (no network/fetch, no
// SDK transport — the transport is injected via createSession), so it runs under a restrictive `ulimit -v`. Asserts
// the critical AUTH-BEFORE-DATA + routing invariants — the one thing http-smoke (auth disabled) can't cover.

import { test, before } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { makeHttpHandler } from "../lib/http-handler.mjs";
import { makeAccessVerifier } from "../lib/cf-access.mjs";
import { RateLimiter } from "../lib/ratelimit.mjs";
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from "jose";

const TEAM = "example-team";
const ISS = `https://${TEAM}.cloudflareaccess.com`;
const AUD = "aud-x";
const KID = "k1";
let priv, jwks;

before(async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  priv = privateKey;
  const pub = await exportJWK(publicKey);
  Object.assign(pub, { kid: KID, alg: "RS256", use: "sig" });
  jwks = createLocalJWKSet({ keys: [pub] });
});

const mint = (email = "a@example.com") =>
  new SignJWT({ email }).setProtectedHeader({ alg: "RS256", kid: KID }).setIssuedAt()
    .setIssuer(ISS).setAudience(AUD).setExpirationTime(Math.floor(Date.now() / 1000) + 300).sign(priv);

const mkVerify = () => makeAccessVerifier({ team: TEAM, aud: AUD, allowedDomains: ["example.com"], jwks });
const noSession = async () => { throw new Error("createSession must NOT run in an auth-fail/routing test"); };
const mk = (opts) => makeHttpHandler({ limiter: new RateLimiter({ perMinute: 100 }), sessions: new Map(), createSession: noSession, ...opts });

// A tiny MCP `initialize` body so the POST reaches session creation (resolveScope) rather than the
// "first request must be initialize" guard. Mirrors the shape isInitializeRequest() accepts.
const initBody = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } } };
function mockReqInit(headers = {}) {
  const raw = Buffer.from(JSON.stringify(initBody));
  return { method: "POST", url: "/mcp", headers, async *[Symbol.asyncIterator]() { yield raw; } };
}

function mockRes() {
  return { statusCode: null, body: null, headersSent: false, writeHead(s) { this.statusCode = s; this.headersSent = true; }, end(b) { this.body = b; } };
}
function mockReq(method, path, headers = {}) {
  return { method, url: path, headers, async *[Symbol.asyncIterator]() { /* empty body */ } };
}

// ── — A MALFORMED Host IS A NAMED REFUSAL, NOT A CRASH ─────────────────────────
//
// The handler built its URL from the caller's own `Host` header. A value that is not a valid authority
// makes `new URL` throw, the outer try answers 500 with a stack in the log, and all of it happens ABOVE
// the `authenticate FIRST` block — so any unauthenticated caller who can reach the port gets it.
//
// It also skips the one check written for this header: TRADEMARK_MCP_ALLOWED_HOSTS arms the transport's
// DNS-rebinding protection, and the server refuses to start without it. A `Host` malformed enough to
// throw never reaches the transport, so the guard built to inspect the header is bypassed by a malformed
// value OF that header.
//
// The nine values are morty's, measured at both doors on the test box: six of these crashed the MCP face
// and every one of them answered 401 at the portal. NOTHING IS PLANTED — today's handler is the
// known-bad side and the portal's constant base is the known-good one.
const MALFORMED_HOSTS = [
  ["127.0.0.1:18821", "well-formed, the control"],
  ["evil.example.com", "well-formed and wrong, still not a crash"],
  ["", "absent"],
  ["127.0.0.1:18821.evil.com", "a rebinding-flavoured suffix"],
  ["127.0.0.1:99999", "a port above 65535"],
  ["127.0.0.1:abc", "a non-numeric port"],
  ["[::1", "an unclosed bracket"],
  ["a b", "a space in the authority"],
  ["127.0.0.1:18821:22", "two ports"],
];

test("#1928 a malformed Host is refused BY NAME — never a 500, and never before auth", async () => {
  for (const [host, why] of MALFORMED_HOSTS) {
    const res = mockRes();
    await mk({ verify: mkVerify() })(mockReq("POST", "/mcp", { host }), res);
    assert.notEqual(res.statusCode, 500,
      `Host ${JSON.stringify(host)} (${why}) crashed the door. That is a 500 to an UNAUTHENTICATED `
      + "caller with a stack in the log, where a named refusal is owed — and the DNS-rebinding guard "
      + "written to read this very header never sees a value malformed enough to throw.");
    assert.ok(res.statusCode >= 400 && res.statusCode < 500,
      `Host ${JSON.stringify(host)} (${why}) answered ${res.statusCode}; a client-supplied header can `
      + "only ever earn a 4xx here");
  }
});

test("#1928 the door does not read the authority at all, so it must not be built from one", () => {
  // Criterion 3: say at the call site what the Host is used for. It is used for NOTHING — only
  // `pathname` and `searchParams` are read — so the base exists purely to make `req.url` parse.
  const src = readFileSync(new URL("../lib/http-handler.mjs", import.meta.url), "utf8");
  assert.match(src, /new URL\(req\.url, "http:\/\/localhost"\)/,
    "the base must be the constant the portal already uses — same words at every door");
  assert.doesNotMatch(src, /new URL\(req\.url, `http:\/\/\$\{/,
    "no interpolated base: the authority is never read, so taking it from the caller buys a crash and "
    + "nothing else");
});

test("healthz needs no auth", async () => {
  const res = mockRes();
  await mk({ verify: async () => { throw new Error("verify must not run for healthz"); } })(mockReq("GET", "/healthz"), res);
  assert.equal(res.statusCode, 200);
});

test("unknown path → 404", async () => {
  const res = mockRes();
  await mk({ verify: null, devMode: true })(mockReq("GET", "/nope"), res);
  assert.equal(res.statusCode, 404);
});

test("construction fails closed: verify:null without devMode:true throws (no open handler by omission)", () => {
  assert.throws(() => mk({ verify: null }), /fail-closed|devMode/i);
});

test("authHeader option: the JWT is read from the configured header, not CF's", async () => {
  const sessions = new Map();
  const res = mockRes();
  const h = mk({ verify: mkVerify(), sessions, authHeader: "x-goog-iap-jwt-assertion" });
  // token in the CF header only → treated as missing (401)
  await h(mockReq("GET", "/mcp", { "cf-access-jwt-assertion": await mint("a@example.com"), "mcp-session-id": "s1" }), res);
  assert.equal(res.statusCode, 401);
  // token in the configured header → auth passes (then the unknown session 404s)
  const res2 = mockRes();
  await h(mockReq("GET", "/mcp", { "x-goog-iap-jwt-assertion": await mint("a@example.com"), "mcp-session-id": "s1" }), res2);
  assert.equal(res2.statusCode, 404);
});

test("sessions are OWNER-BOUND: another identity presenting a leaked session id → 403; the owner passes", async () => {
  let handled = 0;
  const sessions = new Map([["sid-1", { transport: { handleRequest: async () => { handled++; } }, email: "a@example.com", lastSeen: Date.now() }]]);
  const h = mk({ verify: mkVerify(), sessions });
  // a different CF-authed person with the stolen session id must NOT attach (the session may carry an
  // ops-scoped inner token)
  const res = mockRes();
  await h(mockReq("GET", "/mcp", { "cf-access-jwt-assertion": await mint("b@example.com"), "mcp-session-id": "sid-1" }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(handled, 0, "the transport must never see the intruder's request");
  // the creating identity still works
  const res2 = mockRes();
  await h(mockReq("GET", "/mcp", { "cf-access-jwt-assertion": await mint("a@example.com"), "mcp-session-id": "sid-1" }), res2);
  assert.equal(handled, 1, "owner reaches the transport");
});

test("POST /mcp with NO token → 401 BEFORE any session/data is created", async () => {
  const sessions = new Map();
  const res = mockRes();
  await mk({ verify: mkVerify(), sessions })(mockReq("POST", "/mcp", {}), res);
  assert.equal(res.statusCode, 401);
  assert.equal(sessions.size, 0, "no session created for an unauthenticated request");
});

test("POST /mcp with a wrong-domain token → 403, no session", async () => {
  const sessions = new Map();
  const res = mockRes();
  await mk({ verify: mkVerify(), sessions })(mockReq("POST", "/mcp", { "cf-access-jwt-assertion": await mint("x@evil.com") }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(sessions.size, 0);
});

test("GET /mcp with a VALID token but unknown session → 404 (auth passes, then session check)", async () => {
  const res = mockRes();
  await mk({ verify: mkVerify() })(mockReq("GET", "/mcp", { "cf-access-jwt-assertion": await mint("a@example.com"), "mcp-session-id": "nope" }), res);
  assert.equal(res.statusCode, 404);
});

test("OPS-TOKENS item 6: ops sessions ride a separate LOWER bucket keyed by sub; staff sessions don't", async () => {
  const jsonReq = (headers) => ({ method: "POST", url: "/mcp", headers,
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })); } });
  let handled = 0;
  const transport = { handleRequest: async () => { handled++; } };
  const sessions = new Map([
    ["sid-ops", { transport, email: "a@example.com", sub: "connector-intake", kind: "ops", lastSeen: Date.now() }],
    ["sid-staff", { transport, email: "a@example.com", sub: null, kind: "internal", lastSeen: Date.now() }],
  ]);
  const h = mk({ verify: mkVerify(), sessions, opsLimiter: new RateLimiter({ perMinute: 2 }) });
  const jwt = await mint("a@example.com");

  // capacity 2: two ops calls pass, the third 429s — while the shared transport limiter still has room
  for (const expect of [null, null, 429]) {
    const res = mockRes();
    await h(jsonReq({ "cf-access-jwt-assertion": jwt, "mcp-session-id": "sid-ops" }), res);
    if (expect === 429) assert.equal(res.statusCode, 429, "ops bucket empty → 429");
  }
  assert.equal(handled, 2, "exactly the two in-budget ops calls reached the transport");

  // the interactive staff session is untouched by the ops bucket
  const res = mockRes();
  await h(jsonReq({ "cf-access-jwt-assertion": jwt, "mcp-session-id": "sid-staff" }), res);
  assert.equal(handled, 3, "staff session unaffected by the drained ops bucket");
});

// ---- §E: positive/fail-closed scope resolution at the handler ----

test("§E staff surface: FIRM-domain CF identity + no token → internal session IS created", async () => {
  let seen = null;
  const createSession = async (sessions, scope) => { seen = scope; return { handleRequest: async (req, res) => res.writeHead(200) }; };
  const res = mockRes();
  await mk({ verify: mkVerify(), firmDomains: ["example.com"], createSession })(mockReqInit({ "cf-access-jwt-assertion": await mint("a@example.com") }), res);
  // Assert the load-bearing scope bits, not the whole object — the internal scope also carries the
  // GRANTS fields (sub/verbs/accounts, INSTALL.md §8), which default to accounts:"*" without a grants file.
  assert.equal(seen?.kind, "internal", "firm staff with no token resolves to internal");
  assert.equal(seen?.runId, null, "internal scope is not run-bound");
});

test("§E 'edge is wrong': a NON-firm CF identity + no token → 403, NO session (never internal)", async () => {
  // A customer email admitted to the staff CF app (allowedDomains widened, or a policy slip) still carries a
  // non-firm domain → firmStaff false → resolveScope refuses. This is the load-bearing hardening.
  const sessions = new Map();
  const res = mockRes();
  const verify = makeAccessVerifier({ team: TEAM, aud: AUD, allowedDomains: ["example.com", "aurora-interactive.example"], jwks }); // edge mis-scoped to admit a customer
  await mk({ verify, firmDomains: ["example.com"], sessions, createSession: noSession })(mockReqInit({ "cf-access-jwt-assertion": await mint("alice@aurora-interactive.example") }), res);
  assert.equal(res.statusCode, 403, "non-firm identity with no token must be refused, not given internal");
  assert.equal(sessions.size, 0);
});

test("§E client surface: firm CF identity + no token → 403 (never internal on the client surface)", async () => {
  const sessions = new Map();
  const res = mockRes();
  await mk({ verify: mkVerify(), clientSurface: true, sessions, createSession: noSession })(mockReqInit({ "cf-access-jwt-assertion": await mint("a@example.com") }), res);
  assert.equal(res.statusCode, 403, "client surface admits ONLY a run-bound token; no token ⇒ refused");
  assert.equal(sessions.size, 0);
});
