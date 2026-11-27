// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Handler-level tests for the remote HTTP face: drive makeHttpHandler with mock req/res (no network/fetch, no
// SDK — the server that answers a request is injected as `serve`), so it runs under a restrictive `ulimit -v`. Asserts
// the critical AUTH-BEFORE-DATA + routing invariants — the one thing http-smoke (auth disabled) can't cover.
//
// THERE ARE NO SESSIONS (design, 2026-11-27). Every request is authenticated, scoped from its own key and checked on its
// own, so the arms that held a session to its owner, its handshake and its expiry now hold each request to the scope of
// the credentials it carries: a session id it presents confers nothing, and no handshake is owed before it is served.
// The session table's cap and eviction went with the sessions.

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
const noServe = async () => { throw new Error("serve must NOT run in an auth-fail/routing test"); };
const mk = (opts) => makeHttpHandler({ limiter: new RateLimiter({ perMinute: 100 }), serve: noServe, ...opts });

/** A `serve` that records the scope and identity each request was handed, and answers it 200 so `finish` fires. */
function recordingServe() {
  const seen = [];
  const serve = async (_req, res, { scope, email }) => { seen.push({ scope, email }); res.writeHead(200); res.end("{}"); };
  return { serve, seen };
}

// THE SECRET IS READ WHEN A KEY IS VERIFIED, not when it is minted, so it stays set across the awaited handler calls.
const { mintToken } = await import("../../shared/scope.mjs");
async function withSecret(fn) {
  const saved = process.env.TRADEMARK_MCP_TOKEN_SECRET;
  process.env.TRADEMARK_MCP_TOKEN_SECRET = "http-handler-test-secret";
  try { return await fn(); }
  finally { if (saved === undefined) delete process.env.TRADEMARK_MCP_TOKEN_SECRET; else process.env.TRADEMARK_MCP_TOKEN_SECRET = saved; }
}

// The opening message of the protocol's older revision. It is no longer owed before anything else (there is no
// handshake to complete), and is used here as one ordinary request among others.
const initBody = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } } };
function mockReqInit(headers = {}) {
  const raw = Buffer.from(JSON.stringify(initBody));
  return { method: "POST", url: "/mcp", headers, async *[Symbol.asyncIterator]() { yield raw; } };
}
/** A POST carrying `body`, which need not be an opening message. */
function jsonReq(headers, body = { jsonrpc: "2.0", id: 1, method: "tools/list" }) {
  const raw = Buffer.from(JSON.stringify(body));
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
// It also skipped the one check written for this header: TRADEMARK_MCP_ALLOWED_HOSTS arms the door's
// DNS-rebinding check, and the server refuses to start without it. A `Host` malformed enough to throw
// never reached that check, so the guard built to inspect the header was bypassed by a malformed value OF
// that header. The check now lives in the handler; its own arm below drives these values through it.
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

test("the door's URL is not built from the authority, so a malformed one cannot crash it", () => {
  // Criterion 3: say at the call site what the Host is used for. The URL reads only `pathname` and
  // `searchParams`, so the base exists purely to make `req.url` parse. The one other read of the header is
  // the exact-match comparison against the allowed hosts, a string compare that cannot throw.
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
  assert.throws(() => mk({ verify: mkVerify(), serve: undefined }), /serve is required/,
    "a handler with nothing to answer a request must not build, rather than fail on the first caller");
});

test("authHeader option: the JWT is read from the configured header, not CF's", async () => {
  const { serve, seen } = recordingServe();
  const res = mockRes();
  const h = mk({ verify: mkVerify(), serve, firmDomains: ["example.com"], authHeader: "x-goog-iap-jwt-assertion" });
  // token in the CF header only → treated as missing (401)
  await h(mockReq("GET", "/mcp", { "cf-access-jwt-assertion": await mint("a@example.com") }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(seen.length, 0, "a request with no JWT in the configured header was served");
  // token in the configured header → auth passes, and the request is served as that identity
  const res2 = mockRes();
  await h(mockReq("GET", "/mcp", { "x-goog-iap-jwt-assertion": await mint("a@example.com") }), res2);
  assert.equal(res2.statusCode, 200);
  assert.equal(seen.length, 1, "the JWT in the configured header did not authenticate");
  assert.equal(seen[0].email, "a@example.com");
});

test("a request is answered in the scope of ITS OWN credentials: another's session id or earlier key confers nothing", async () => {
  // This arm used to hold a session to its owner: a leaked session id presented by another identity was refused,
  // because the session might carry an ops-scoped key. There is no session now, so the property is that the reach a
  // request gets comes from what IT carries — never from an id or a key another request presented before it.
  await withSecret(async () => {
    const { serve, seen } = recordingServe();
    const h = mk({ verify: mkVerify(), firmDomains: ["example.com"], serve });
    const opsKey = mintToken({ scope: "ops", sub: "connector-a", ttlSec: 600 });
    // A, with an ops key, served as ops
    await h(jsonReq({ "cf-access-jwt-assertion": await mint("a@example.com"), "x-trademark-token": opsKey, "mcp-session-id": "sid-1" }), mockRes());
    assert.equal(seen[0]?.scope?.kind, "ops", "the ops key was not served as ops, so the arms below measure nothing");
    assert.equal(seen[0].scope.sub, "connector-a");
    // B, firm staff with NO key, presenting A's session id: B's own reach, which is internal and never A's ops
    const res = mockRes();
    await h(jsonReq({ "cf-access-jwt-assertion": await mint("b@example.com"), "mcp-session-id": "sid-1" }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(seen[1]?.scope?.kind, "internal", `another identity presenting A's session id was handed ${JSON.stringify(seen[1]?.scope)}`);
    assert.notEqual(seen[1].scope.sub, "connector-a", "A's ops principal rode B's request");
    assert.equal(seen[1].email, "b@example.com");
    // B again, now with a run-bound key: that key's reach, on the same identity and the same presented id
    const runKey = mintToken({ scope: "user", runId: "tmpx-velloquin-2026-11-27-slate-heron", ttlSec: 600 });
    await h(jsonReq({ "cf-access-jwt-assertion": await mint("b@example.com"), "x-trademark-token": runKey, "mcp-session-id": "sid-1" }), mockRes());
    assert.equal(seen[2]?.scope?.kind, "user");
    assert.equal(seen[2].scope.runId, "tmpx-velloquin-2026-11-27-slate-heron");
    // C, a non-firm identity a mis-scoped edge admitted, presenting A's session id with no key: no reach at all, so
    // refused before anything answers it
    const widened = makeAccessVerifier({ team: TEAM, aud: AUD, allowedDomains: ["example.com", "demo-brand-owner.example"], jwks });
    const hc = mk({ verify: widened, firmDomains: ["example.com"], serve });
    const resC = mockRes();
    await hc(jsonReq({ "cf-access-jwt-assertion": await mint("alice@demo-brand-owner.example"), "mcp-session-id": "sid-1" }), resC);
    assert.equal(resC.statusCode, 403, "a caller with no reach of its own was not refused");
    assert.equal(seen.length, 3, "the server must never see the request of a caller with no reach");
  });
});

test("POST, GET and DELETE /mcp with NO token → 401 BEFORE anything is served", async () => {
  for (const method of ["POST", "GET", "DELETE"]) {
    const { serve, seen } = recordingServe();
    const res = mockRes();
    await mk({ verify: mkVerify(), serve, firmDomains: ["example.com"] })(mockReq(method, "/mcp", {}), res);
    assert.equal(res.statusCode, 401, `${method} without a JWT`);
    assert.equal(seen.length, 0, `an unauthenticated ${method} was served`);
  }
});

test("POST /mcp with a wrong-domain token → 403, nothing served", async () => {
  const { serve, seen } = recordingServe();
  const res = mockRes();
  await mk({ verify: mkVerify(), serve, firmDomains: ["example.com"] })(mockReq("POST", "/mcp", { "cf-access-jwt-assertion": await mint("x@evil.com") }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(seen.length, 0);
});

test("no handshake is owed and a stale session id is ignored: each request is served from its own credentials", async () => {
  // These used to be refusals: a first request that was not `initialize` (400), and a session id the door did not
  // know (404). The newer revision has no handshake, and the older one is served without sessions, so both are now
  // ordinary requests, answered in the scope their own credentials resolve to. A stale id must change nothing.
  const { serve, seen } = recordingServe();
  const h = mk({ verify: mkVerify(), firmDomains: ["example.com"], serve });
  const jwt = await mint("a@example.com");
  const resA = mockRes();
  await h(jsonReq({ "cf-access-jwt-assertion": jwt, "mcp-session-id": "nope" }), resA);   // tools/list, no initialize before it
  assert.equal(resA.statusCode, 200, "a request that is not an opening message, carrying a stale session id, was refused");
  const resB = mockRes();
  await h(jsonReq({ "cf-access-jwt-assertion": jwt }), resB);
  assert.equal(resB.statusCode, 200);
  assert.equal(seen.length, 2);
  assert.deepEqual(seen[0], seen[1], "a stale session id changed the scope or identity a request was served with");
  assert.equal(seen[0].scope.kind, "internal");
  // GET and DELETE are scoped the same way and handed on; what the server answers them is its own (the SDK's 405).
  for (const method of ["GET", "DELETE"]) {
    const res = mockRes();
    await h(mockReq(method, "/mcp", { "cf-access-jwt-assertion": jwt, "mcp-session-id": "nope" }), res);
    assert.equal(res.statusCode, 200, `an authenticated ${method} with a stale session id was not handed to the server`);
  }
  assert.equal(seen.length, 4);
  assert.deepEqual(seen[3], seen[0], "a GET or DELETE was served in a different scope from the POST beside it");
});

test("OPS-TOKENS item 6: ops keys ride a separate LOWER bucket keyed by sub; staff calls don't", async () => {
  await withSecret(async () => {
    const { serve, seen } = recordingServe();
    const h = mk({ verify: mkVerify(), firmDomains: ["example.com"], serve, opsLimiter: new RateLimiter({ perMinute: 2 }) });
    const jwt = await mint("a@example.com");
    const opsKey = mintToken({ scope: "ops", sub: "connector-intake", ttlSec: 600 });

    // capacity 2: two ops calls pass, the third 429s — while the shared transport limiter still has room
    for (const expect of [200, 200, 429]) {
      const res = mockRes();
      await h(jsonReq({ "cf-access-jwt-assertion": jwt, "x-trademark-token": opsKey }), res);
      assert.equal(res.statusCode, expect, expect === 429 ? "ops bucket empty → 429" : "an in-budget ops call was refused");
    }
    assert.equal(seen.length, 2, "exactly the two in-budget ops calls reached the server");
    assert.ok(seen.every((s) => s.scope.kind === "ops"));

    // the same identity's interactive staff call, with no key, is untouched by the ops bucket
    const res = mockRes();
    await h(jsonReq({ "cf-access-jwt-assertion": jwt }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(seen.length, 3, "staff call unaffected by the drained ops bucket");
    assert.equal(seen[2].scope.kind, "internal");
  });
});

// ---- §E: positive/fail-closed scope resolution at the handler ----

test("§E staff surface: FIRM-domain CF identity + no token → served in the internal scope", async () => {
  let seen = null;
  const serve = async (_req, res, { scope }) => { seen = scope; res.writeHead(200); res.end("{}"); };
  const res = mockRes();
  await mk({ verify: mkVerify(), firmDomains: ["example.com"], serve })(mockReqInit({ "cf-access-jwt-assertion": await mint("a@example.com") }), res);
  // Assert the load-bearing scope bits, not the whole object — the internal scope also carries the
  // GRANTS fields (sub/verbs/accounts, INSTALL.md §8), which default to accounts:"*" without a grants file.
  assert.equal(seen?.kind, "internal", "firm staff with no token resolves to internal");
  assert.equal(seen?.runId, null, "internal scope is not run-bound");
});

test("§E 'edge is wrong': a NON-firm CF identity + no token → 403, nothing served (never internal)", async () => {
  // A customer email admitted to the staff CF app (allowedDomains widened, or a policy slip) still carries a
  // non-firm domain → firmStaff false → resolveScope refuses. This is the load-bearing hardening.
  const { serve, seen } = recordingServe();
  const res = mockRes();
  const verify = makeAccessVerifier({ team: TEAM, aud: AUD, allowedDomains: ["example.com", "demo-brand-owner.example"], jwks }); // edge mis-scoped to admit a customer
  await mk({ verify, firmDomains: ["example.com"], serve })(mockReqInit({ "cf-access-jwt-assertion": await mint("alice@demo-brand-owner.example") }), res);
  assert.equal(res.statusCode, 403, "non-firm identity with no token must be refused, not given internal");
  assert.equal(seen.length, 0);
});

test("§E client surface: firm CF identity + no token → 403 (never internal on the client surface)", async () => {
  const { serve, seen } = recordingServe();
  const res = mockRes();
  await mk({ verify: mkVerify(), clientSurface: true, serve })(mockReqInit({ "cf-access-jwt-assertion": await mint("a@example.com") }), res);
  assert.equal(res.statusCode, 403, "client surface admits ONLY a run-bound token; no token ⇒ refused");
  assert.equal(seen.length, 0);
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

const listRuns = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_runs" } };
const RUN_KEY_RUN = "tmpx-velloquin-2026-11-27-slate-heron";

test("a call that got through is recorded WITH ITS OUTCOME, and names the door it came in by", async () => {
  await withSecret(async () => {
    const before = auditLines().length;
    // A server that actually ENDS the response, because `finish` is what carries the outcome. A double that
    // returned without ending would record nothing — the honest result for a call that never produced an
    // answer, not a gap this arm should paper over. On the client surface the caller is a run-bound key.
    const { serve } = recordingServe();
    const h = mk({ verify: mkVerify(), serve, clientSurface: true });
    const key = mintToken({ scope: "user", runId: RUN_KEY_RUN, ttlSec: 600 });
    await h(jsonReq({ "cf-access-jwt-assertion": await mint("a@example.com"), "x-trademark-token": key }, listRuns), mockRes());

    const added = auditLines().slice(before);
    assert.equal(added.length, 1, `one line for one call, got ${added.length}`);
    const [rec] = added;
    assert.equal(rec.status, 200, `the outcome is on the line, not null: ${JSON.stringify(rec)}`);
    assert.equal(rec.tool, "list_runs", "the tool is named");
    assert.equal(rec.door, "client", "the door is named");
    assert.equal(rec.email, "a@example.com", "the caller is named");
    assert.equal(rec.kind, "user", "the principal's kind is named");
  });
});

test("a call that was TURNED AWAY is recorded too, which is the gap an absent line used to hide", async () => {
  await withSecret(async () => {
    const before = auditLines().length;
    const { serve, seen } = recordingServe();
    const h = mk({ verify: mkVerify(), serve, clientSurface: true, allowedHosts: ["127.0.0.1:18821"] });
    const key = mintToken({ scope: "user", runId: RUN_KEY_RUN, ttlSec: 600 });
    // A POST naming a Host this door does not listen as: refused at 403 by the DNS-rebinding check, and it must not vanish.
    const req = jsonReq({ host: "evil.example.com", "cf-access-jwt-assertion": await mint("a@example.com"), "x-trademark-token": key }, listRuns);
    const res = mockRes();
    await h(req, res);
    assert.equal(res.statusCode, 403, "a Host outside the allowed list was not refused");
    assert.equal(seen.length, 0, "a refused call was served anyway");

    const added = auditLines().slice(before);
    assert.ok(added.length >= 1, "a refused call left no record at all — the defect this arm is for");
    const rec = added[added.length - 1];
    assert.equal(rec.status, "refused", `a turned-away call reads as refused: ${JSON.stringify(rec)}`);
    assert.equal(rec.door, "client", "and still names its door");
    assert.equal(rec.email, "a@example.com", "and the identity that was turned away");
  });
});

// ── THE DNS-REBINDING CHECK IS THE DOOR'S OWN ─────────────────────────────────────────────────────
//
// It used to be the SDK transport's; the door now holds it, matching host AND port exactly (design, 2026-11-27). So it
// is driven here with the malformed values above as well as the plain wrong one: none may reach the server, and each
// is refused by name rather than crashing.
test("a Host outside the allowed list is refused by name before anything is served; an allowed one is served; no list checks none", async () => {
  const { serve, seen } = recordingServe();
  const allowed = "127.0.0.1:18821";
  const h = mk({ verify: mkVerify(), firmDomains: ["example.com"], serve, allowedHosts: [allowed] });
  const jwt = await mint("a@example.com");
  for (const [host, why] of MALFORMED_HOSTS.filter(([h2]) => h2 !== allowed)) {
    const res = mockRes();
    await h(jsonReq({ host, "cf-access-jwt-assertion": jwt }), res);
    assert.equal(res.statusCode, 403, `Host ${JSON.stringify(host)} (${why}) answered ${res.statusCode}`);
    assert.equal(JSON.parse(res.body).error?.message, `Invalid Host header: ${host}`, `Host ${JSON.stringify(host)} was not refused by name`);
  }
  assert.equal(seen.length, 0, "a request naming a Host outside the list reached the server");
  const ok = mockRes();
  await h(jsonReq({ host: allowed, "cf-access-jwt-assertion": jwt }), ok);
  assert.equal(ok.statusCode, 200, "the door refused the Host it listens as");
  assert.equal(seen.length, 1);
  // A door with no list (the key socket, which has no hostname) arms none.
  const open = mockRes();
  await mk({ verify: mkVerify(), firmDomains: ["example.com"], serve })(jsonReq({ host: "evil.example.com", "cf-access-jwt-assertion": jwt }), open);
  assert.equal(open.statusCode, 200, "a door given no allowed hosts checked one anyway");
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
  const h = mk({ verify: mkVerify(), ...opts });
  // A body that is not JSON: refused at 400, above scope resolution, so it reaches the audit write
  // whatever surface the handler is.
  const req = { method: "POST", url: "/mcp",
    headers: { "cf-access-jwt-assertion": await mint("a@example.com") },
    async *[Symbol.asyncIterator]() { yield Buffer.from("{ not json"); } };
  const res = mockRes();
  await h(req, res);
  assert.equal(res.statusCode, 400, "the malformed body was not refused, so the line below is not a refusal's");
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
  const h = mk({ verify: null, tokenOnly: true, clientSurface: true });
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
// names its tools, on every call it makes and not only the first. A long-lived connector used to make
// most of its calls on a session it opened days earlier; there are no sessions now (design, 2026-11-27),
// so every call carries its key and every line is written from that call's own scope.
async function opsCallLines(verbs) {
  return withSecret(async () => {
    const { serve, seen } = recordingServe();
    const h = makeHttpHandler({ limiter: new RateLimiter({ perMinute: 100 }), serve, verify: mkVerify() });
    const token = mintToken({ scope: "ops", sub: "audit-kind-arm", ...(verbs ? { verbs } : {}), ttlSec: 600 });
    const jwt = await mint("a@example.com");
    const call = (body) => jsonReq({ "cf-access-jwt-assertion": jwt, "x-trademark-token": token }, body);
    const before = auditLines().length;
    await h(call(initBody), mockRes());
    await h(call({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_runs" } }), mockRes());
    assert.equal(seen.length, 2, "the two calls were not both served, so the lines below would measure nothing");
    return auditLines().slice(before);
  });
}

test("an ops token that names no tools is marked on every line, a later call's included", async () => {
  const lines = await opsCallLines(null);
  assert.equal(lines.length, 2, `one line per call, got ${lines.length}`);
  for (const rec of lines) {
    assert.equal(rec.kind, "ops", `the principal's kind is missing: ${JSON.stringify(rec)}`);
    assert.equal(rec.namesVerbs, false, `a verb-less ops token is not findable from this line: ${JSON.stringify(rec)}`);
  }
  assert.equal(lines[1].tool, "list_runs", "the second line is the later call's");
});

test("an ops token that names its tools says so, and the line never lists which", async () => {
  const lines = await opsCallLines(["start_run", "stop_run"]);
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
