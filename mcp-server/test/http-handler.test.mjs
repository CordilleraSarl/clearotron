// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Handler-level tests for the remote HTTP face: drive makeHttpHandler with mock req/res (no network/fetch, no
// SDK transport — the transport is injected via createSession), so it runs under a restrictive `ulimit -v`. Asserts
// the critical AUTH-BEFORE-DATA + routing invariants — the one thing http-smoke (auth disabled) can't cover.

import { test, before } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { makeHttpHandler } from "../lib/http-handler.mjs";
import { DEFAULT_AUDIT_PATH, appendAudit, UNNAMED_DOOR } from "../lib/audit.mjs";
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

// THE DOUBLE EMITS `finish`, BECAUSE THE HANDLER LISTENS FOR IT. The audit line carrying a call's
// OUTCOME is written on `finish`, which is the first moment `statusCode` is the answer the caller got.
// This double was a plain object with no `once`, so composing that hook threw and no call reached the
// transport at all — loudly, which is the good case. The repair that suggests itself is to guard the
// hook with `typeof res.once === "function"`; that would have made production audit and every test
// silently not, and nothing would have said so. A double that cannot do what the real object does is
// the thing to fix.
function mockRes() {
  return {
    statusCode: null, body: null, headersSent: false, _finish: [],
    once(ev, fn) { if (ev === "finish") this._finish.push(fn); return this; },
    writeHead(s) { this.statusCode = s; this.headersSent = true; },
    end(b) { this.body = b; for (const fn of this._finish.splice(0)) fn(); },
  };
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

test("a malformed Host is refused BY NAME — never a 500, and never before auth", async () => {
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

test("the door does not read the authority at all, so it must not be built from one", () => {
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
  const verify = makeAccessVerifier({ team: TEAM, aud: AUD, allowedDomains: ["example.com", "demo-brand-owner.example"], jwks }); // edge mis-scoped to admit a customer
  await mk({ verify, firmDomains: ["example.com"], sessions, createSession: noSession })(mockReqInit({ "cf-access-jwt-assertion": await mint("alice@demo-brand-owner.example") }), res);
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


// ── WHAT THE ACCESS LOG SAYS ABOUT A CALL ─────────────────────────────────────────────────────────
//
// Read from the path the writer resolved at ITS import, never recomputed here: recomputing that branch
// in the reader is the defect this log already carries a long comment about, one file over.
const auditLines = () => {
  let text = "";
  try { text = readFileSync(DEFAULT_AUDIT_PATH, "utf8"); } catch { return []; }
  return text.split("\n").filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
};

test("a call that got through is recorded WITH ITS OUTCOME, and names the door it came in by", async () => {
  const before = auditLines().length;
  // A transport that actually ENDS the response, because `finish` is what carries the outcome. The
  // doubles above return without ending, which is why they record nothing — that is the honest result
  // for a call that never produced an answer, not a gap this arm should paper over.
  const transport = { handleRequest: async (_req, res) => { res.writeHead(200); res.end("{}"); } };
  const sessions = new Map([["sid", { transport, email: "a@example.com", sub: null, kind: "internal", lastSeen: Date.now() }]]);
  const h = mk({ verify: mkVerify(), sessions, clientSurface: true });
  const req = { method: "POST", url: "/mcp", headers: { "cf-access-jwt-assertion": await mint("a@example.com"), "mcp-session-id": "sid" },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_runs" } })); } };
  await h(req, mockRes());

  const added = auditLines().slice(before);
  assert.equal(added.length, 1, `one line for one call, got ${added.length}`);
  const [rec] = added;
  assert.equal(rec.status, 200, `the outcome is on the line, not null: ${JSON.stringify(rec)}`);
  assert.equal(rec.tool, "list_runs", "the tool is named");
  assert.equal(rec.door, "client", "the door is named");
  assert.equal(rec.email, "a@example.com", "the caller is named");
});

test("a call that was TURNED AWAY is recorded too, which is the gap an absent line used to hide", async () => {
  const before = auditLines().length;
  const h = mk({ verify: mkVerify(), sessions: new Map(), clientSurface: true });
  // A POST carrying a session id nothing knows: refused at 404, and it must not vanish.
  const req = { method: "POST", url: "/mcp", headers: { "cf-access-jwt-assertion": await mint("a@example.com"), "mcp-session-id": "gone" },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_runs" } })); } };
  const res = mockRes();
  await h(req, res);
  assert.equal(res.statusCode, 404, "the caller still gets the refusal it got before");

  const added = auditLines().slice(before);
  assert.ok(added.length >= 1, "a refused call left no record at all — the defect this arm is for");
  const rec = added[added.length - 1];
  assert.equal(rec.status, "refused", `a turned-away call reads as refused: ${JSON.stringify(rec)}`);
  assert.equal(rec.door, "client", "and still names its door");
});

// ── EVERY DOOR NAMES ITSELF, AND AN UNNAMED ONE IS LOUD RATHER THAN MISSING ────────────────────────
//
// The door field existed and one writer never reached it. `clientSurface` was doing double duty — a scope
// question standing in for the door's name — so the key door, which sets neither it nor a name, wrote
// every line with the field absent. Absence then read as the staff surface, because that was the only
// other thing it could have been, and a client's calls were attributed to staff by elimination. Found on
// a live instance: six lines written, five naming a door, one with the field simply not there.
const refusedRecord = async (opts) => {
  const before = auditLines().length;
  const h = mk({ verify: mkVerify(), sessions: new Map(), ...opts });
  // A session id nothing knows: refused at 404, above scope resolution, so it reaches the audit write
  // whatever surface the handler is.
  const req = { method: "POST", url: "/mcp",
    headers: { "cf-access-jwt-assertion": await mint("a@example.com"), "mcp-session-id": "gone" },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_runs" } })); } };
  const res = mockRes();
  await h(req, res);
  const added = auditLines().slice(before);
  assert.ok(added.length >= 1, "the refusal wrote no record, so this arm is measuring nothing");
  return added[added.length - 1];
};

test("the key door names itself rather than being read as the staff surface by elimination", async () => {
  const rec = await refusedRecord({ door: "key" });
  assert.equal(rec.door, "key",
    "the key door is a third surface: not the staff portal and not the network client door. Before it was "
    + "given a name its lines carried no door at all, and a reader could only conclude 'not client'.");
});

test("a handler that names no door still writes one, so absence is never the encoding", async () => {
  const rec = await refusedRecord({});
  assert.ok("door" in rec, "the field must be present on every line — an absent key is not a value");
  assert.equal(rec.door, "portal", "the staff surface is named outright rather than inferred from a gap");
});

test("appendAudit cannot write a line with no door at all", () => {
  const before = auditLines().length;
  // Deliberately the shape that used to produce a door-less line: a caller that passes no door.
  appendAudit({ email: null, sub: null, body: { method: "initialize" }, status: "connected" });
  const added = auditLines().slice(before);
  assert.equal(added.length, 1, "the write did not land, so this arm proves nothing");
  assert.ok("door" in added[0], "a line with the door field missing is the state this arm exists to prevent");
  assert.equal(added[0].door, UNNAMED_DOOR,
    "an unnamed door is written as a value a reader can search for, rather than left out where it reads "
    + "as whichever surface happens to be the only other one");
});

test("a refusal BEFORE any identity is established names nobody, rather than inventing one", async () => {
  const before = auditLines().length;
  // tokenOnly with no key presented: refused at 401, before verification. The handler starts with a
  // placeholder identity in scope, and writing THAT would name a caller who does not exist.
  const h = mk({ verify: null, tokenOnly: true, sessions: new Map(), clientSurface: true });
  const res = mockRes();
  await h(mockReq("POST", "/mcp", {}), res);
  assert.equal(res.statusCode, 401, "still refused");

  const added = auditLines().slice(before);
  assert.ok(added.length >= 1, "an unauthenticated refusal left no record");
  const rec = added[added.length - 1];
  assert.equal(rec.status, "refused", "it is a refusal");
  assert.equal(rec.email, null, `it must name NOBODY, not the handler's placeholder: ${JSON.stringify(rec)}`);
  assert.equal(rec.sub, null, "and no principal either");
});

// ── AN OPS TOKEN THAT NAMES NO TOOLS CAN BE FOUND IN THE LOG, ON EVERY CALL IT MAKES ───────────────
//
// Ops tokens that name no tools are being retired: re-issued with the tools they call, then refused once
// the log shows none in use. So the line says the principal's kind and, for an ops token, whether it
// names its tools, and says it on a reused session as well as on the call that opened it, because a
// long-lived connector makes most of its calls on a session it opened days earlier.
const { mintToken } = await import("../../shared/scope.mjs");

async function opsSessionLines(verbs) {
  const saved = process.env.TRADEMARK_MCP_TOKEN_SECRET;
  process.env.TRADEMARK_MCP_TOKEN_SECRET = "audit-kind-test-secret";
  try {
    const sessions = new Map();
    const createSession = async (map, _scope, email) => {
      const transport = {
        sessionId: null,
        async handleRequest(_req, res) {
          if (!this.sessionId) { this.sessionId = "audit-kind-sid"; map.set(this.sessionId, { transport, email, lastSeen: Date.now() }); }
          res.writeHead(200); res.end("{}");
        },
      };
      return transport;
    };
    const h = makeHttpHandler({ limiter: new RateLimiter({ perMinute: 100 }), sessions, createSession, verify: mkVerify() });
    const token = mintToken({ scope: "ops", sub: "audit-kind-arm", ...(verbs ? { verbs } : {}), ttlSec: 600 });
    const jwt = await mint("a@example.com");
    const call = (headers, body) => ({ method: "POST", url: "/mcp", headers: { "cf-access-jwt-assertion": jwt, ...headers },
      async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); } });
    const before = auditLines().length;
    await h(call({ "x-trademark-token": token }, initBody), mockRes());
    assert.ok(sessions.has("audit-kind-sid"), "the session was never opened, so the second call below would measure nothing");
    await h(call({ "mcp-session-id": "audit-kind-sid" }, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_runs" } }), mockRes());
    return auditLines().slice(before);
  } finally {
    if (saved === undefined) delete process.env.TRADEMARK_MCP_TOKEN_SECRET; else process.env.TRADEMARK_MCP_TOKEN_SECRET = saved;
  }
}

test("an ops token that names no tools is marked on every line, the reused session's included", async () => {
  const lines = await opsSessionLines(null);
  assert.equal(lines.length, 2, `one line per call, got ${lines.length}`);
  for (const rec of lines) {
    assert.equal(rec.kind, "ops", `the principal's kind is missing: ${JSON.stringify(rec)}`);
    assert.equal(rec.namesVerbs, false, `a verb-less ops token is not findable from this line: ${JSON.stringify(rec)}`);
  }
  assert.equal(lines[1].tool, "list_runs", "the second line is the reused session's call");
});

test("an ops token that names its tools says so, and the line never lists which", async () => {
  const lines = await opsSessionLines(["start_run", "stop_run"]);
  assert.equal(lines.length, 2);
  for (const rec of lines) {
    assert.equal(rec.namesVerbs, true, `a scoped ops token read as verb-less: ${JSON.stringify(rec)}`);
    assert.doesNotMatch(JSON.stringify(rec), /start_run|stop_run/, "the line carries the token's tool list");
  }
});

test("a line for a principal that is not ops carries no names-verbs claim", () => {
  const before = auditLines().length;
  appendAudit({ email: "a@example.com", sub: null, kind: "internal", body: null, status: 200, door: "staff" });
  appendAudit({ email: "a@example.com", sub: null, body: null, status: 200, door: "staff" });
  const [withKind, without] = auditLines().slice(before);
  assert.equal(withKind.kind, "internal");
  assert.ok(!("namesVerbs" in withKind), "a staff line claimed something about ops tools");
  assert.ok(!("kind" in without) && !("namesVerbs" in without), "a caller that knew nothing wrote a claim anyway");
});
