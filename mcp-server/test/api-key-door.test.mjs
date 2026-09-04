// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// api-key-door.test.mjs — the ACCOUNT KEY (mint-token.mjs --scope account) and the token-only door it
// arrives at. This is a credential handed to a named person for an agent that cannot do the Cloudflare
// browser sign-in, presented at a hostname with no auth proxy in front of it. So the properties that
// matter here are the ones that would otherwise be load-bearing on Cloudflare:
//
//   1. NO KEY ⇒ NOTHING. The door must never fall back to the synthetic identity the dev knob hands out.
//   2. The key proves WHO; the GRANTS FILE decides WHAT — on every request, never from the token.
//   3. A key cannot reach the staff/ops principals, and cannot be widened by anything its holder controls.
//   4. Misconfiguration refuses to build rather than serving something weaker than it claims.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeHttpHandler, readInnerToken } from "../lib/http-handler.mjs";
import { RateLimiter } from "../lib/ratelimit.mjs";
import { mintToken, resolveScope } from "../lib/scope.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const SECRET = "api-key-door-test-secret-aaaaaaaaaaaa";
const GRANTS = {
  tenants: {
    acme: { accounts: ["acme", "acme-eu"], users: { "lawyer@acme.example": "*" } },
    solo: { accounts: ["solo"], users: { "one@solo.example": "*" } },
  },
};
const dir = mkdtempSync(join(tmpdir(), "apikey-grants-"));
const grantsPath = join(dir, "grants.json");
writeFileSync(grantsPath, JSON.stringify(GRANTS));

const withEnv = (env, fn) => {
  const saved = {};
  // — PIN EVERY SPELLING, and SAVE every spelling too. `pinEnv` writes the
  // whole alias set, so a restore that remembered only the key it was handed would delete the sibling
  // spelling an outer harness had set rather than putting it back.
  for (const [k, v] of Object.entries(env)) {
    saved[k] = Object.fromEntries([k].map((s) => [s, process.env[s]]));
    pinEnv(process.env, k, v ?? undefined);
  }
  try { return fn(); } finally { for (const prior of Object.values(saved)) for (const [s, v] of Object.entries(prior)) { if (v === undefined) delete process.env[s]; else process.env[s] = v; } }
};
// The handler awaits the request body before resolving scope, so an env swap around it has to AWAIT too —
// the sync form restores the env mid-flight and the door then reads a world with no grants file in it.
const withEnvAsync = async (env, fn) => {
  const saved = {};
  // — PIN EVERY SPELLING, and SAVE every spelling too. `pinEnv` writes the
  // whole alias set, so a restore that remembered only the key it was handed would delete the sibling
  // spelling an outer harness had set rather than putting it back.
  for (const [k, v] of Object.entries(env)) {
    saved[k] = Object.fromEntries([k].map((s) => [s, process.env[s]]));
    pinEnv(process.env, k, v ?? undefined);
  }
  try { return await fn(); } finally { for (const prior of Object.values(saved)) for (const [s, v] of Object.entries(prior)) { if (v === undefined) delete process.env[s]; else process.env[s] = v; } }
};
// The door's real env: signing secret + guest list + the account principal switched on.
const DOOR = { TRADEMARK_MCP_TOKEN_SECRET: SECRET, CLEAROTRON_ACCESS_FILE: grantsPath, CLIENT_MCP_ACCOUNT_ACCESS: "1" };
const key = (sub = "lawyer@acme.example", accounts = null) =>
  withEnv({ TRADEMARK_MCP_TOKEN_SECRET: SECRET }, () => mintToken({ scope: "account", sub, accounts }));
const atDoor = (innerToken, env = {}) =>
  withEnv({ ...DOOR, ...env }, () => resolveScope({ local: false, clientSurface: true, innerToken, email: null }));

// ---- 1. minting ---------------------------------------------------------------------------------

test("an account key must name its identity — an anonymous key could not be scoped or revoked", () => {
  withEnv({ TRADEMARK_MCP_TOKEN_SECRET: SECRET }, () => {
    assert.throws(() => mintToken({ scope: "account" }), /must name its identity/);
    assert.throws(() => mintToken({ scope: "account", sub: "x@y.example", runId: "r1" }), /not run-bound/);
  });
});

// ---- 2. the key proves WHO, the grants file decides WHAT ----------------------------------------

test("an account key resolves to the client principal, scoped by the GRANTS FILE", () => {
  const s = atDoor(key());
  assert.equal(s.kind, "account", "the key did not land on the same principal a browser sign-in yields");
  assert.deepEqual(s.accounts, ["acme", "acme-eu"]);
  assert.equal(s.sub, "lawyer@acme.example", "the audit log would not be able to name the key holder");
  assert.equal(s.runId, null);
});

test("REVOCATION: removing the grants row kills the key without re-minting anything", () => {
  const k = key("lawyer@acme.example");
  const emptied = join(dir, "grants-emptied.json");
  writeFileSync(emptied, JSON.stringify({ tenants: {} }));
  assert.throws(() => atDoor(k, { CLEAROTRON_ACCESS_FILE: emptied }), /not granted any account/,
    "a still-signed, still-unexpired key kept its reach after its grant was withdrawn");
});

test("the accounts CAP narrows the grant and can never widen it", () => {
  assert.deepEqual(atDoor(key("lawyer@acme.example", ["acme"])).accounts, ["acme"]);
  // a cap naming something the identity was never granted yields nothing — and nothing is a refusal,
  // not a quiet fall-back to the full grant
  assert.throws(() => atDoor(key("lawyer@acme.example", ["someone-else"])), /capped to accounts its identity is no longer granted/);
});

test("a key cannot be minted into reach its identity does not have", () => {
  // the cap is applied at RESOLUTION, so minting --accounts for a foreign tenant buys nothing
  assert.throws(() => atDoor(key("one@solo.example", ["acme", "acme-eu"])), /capped to accounts/);
  assert.deepEqual(atDoor(key("one@solo.example")).accounts, ["solo"]);
});

// ---- 3. the key cannot reach anything else -------------------------------------------------------

test("an account key is refused OFF the client surface — it must not land in the run-bound arm", () => {
  // falling through to the `user` arm would produce runId:null: a "run-bound" scope bound to no run,
  // which every run-pinning check downstream then waves past.
  assert.throws(() => withEnv(DOOR, () => resolveScope({ local: false, clientSurface: false, innerToken: key(), email: "x@cordillera.ch" })),
    /only accepted on the client surface/);
});

test("account access OFF ⇒ the key is refused, not silently honoured", () => {
  assert.throws(() => atDoor(key(), { CLIENT_MCP_ACCOUNT_ACCESS: null }), /not enabled on this door/);
});

test("NO grants file ⇒ refused, never the unscoped wildcard", () => {
  assert.throws(() => atDoor(key(), { CLEAROTRON_ACCESS_FILE: null }), /refusing an unscoped wildcard/);
});

test("an ops token is still refused on the client surface — the key did not widen the token rules", () => {
  const tok = withEnv({ TRADEMARK_MCP_TOKEN_SECRET: SECRET }, () => mintToken({ scope: "ops", sub: "automation" }));
  assert.throws(() => atDoor(tok), /accepts only a run-scoped user token or an account key/);
});

test("an expired key is refused", () => {
  const stale = withEnv({ TRADEMARK_MCP_TOKEN_SECRET: SECRET }, () =>
    mintToken({ scope: "account", sub: "lawyer@acme.example", ttlSec: -1 }));
  assert.throws(() => atDoor(stale), /token expired/);
});

// ---- 4. the door ---------------------------------------------------------------------------------

const initBody = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } } };
const mockReq = (headers = {}, path = "/mcp") => ({
  method: "POST", url: path, headers,
  async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(initBody)); },
});
const mockRes = () => ({ statusCode: null, body: null, headersSent: false, writeHead(s) { this.statusCode = s; this.headersSent = true; }, end(b) { this.body = b; } });

// Captures the scope the handler resolved, standing in for the SDK transport.
function doorWithCapture(captured, extra = {}) {
  const createSession = async (sessions, scope, owner) => {
    captured.scope = scope; captured.owner = owner;
    return { handleRequest: async (_req, res) => { res.writeHead(200); res.end("{}"); } };
  };
  return makeHttpHandler({ verify: null, tokenOnly: true, clientSurface: true,
    limiter: new RateLimiter({ perMinute: 500 }), sessions: new Map(), createSession, ...extra });
}

test("NO KEY ⇒ 401 with no synthetic identity — the property the whole door rests on", async () => {
  const captured = {};
  const res = mockRes();
  await withEnvAsync(DOOR, () => doorWithCapture(captured)(mockReq(), res));
  assert.equal(res.statusCode, 401);
  assert.equal(captured.scope, undefined, "an unkeyed request reached session creation");
  assert.match(String(res.body), /needs an access key/, "the refusal must tell a client what to do about it");
});

test("a garbage key is refused before any body, session or data", async () => {
  const res = mockRes();
  await withEnvAsync(DOOR, () => doorWithCapture({})(mockReq({ authorization: "Bearer v1.nope.nope" }), res));
  assert.equal(res.statusCode, 401);
  assert.match(String(res.body), /invalid access key/);
});

test("all four ways of presenting the key resolve to the SAME principal", async () => {
  // which form a connector actually sends is not ours to choose: a fixed "API key" box may send
  // `Authorization: Bearer`, a bare `Authorization`, or nothing at all (leaving ?token= in the URL).
  const k = key();
  const forms = [
    ["Authorization: Bearer", { headers: { authorization: `Bearer ${k}` } }],
    ["bare Authorization", { headers: { authorization: k } }],
    ["X-Trademark-Token", { headers: { "x-trademark-token": k } }],
    ["?token= in the URL", { path: `/mcp?token=${encodeURIComponent(k)}` }],
  ];
  for (const [label, { headers = {}, path = "/mcp" }] of forms) {
    const captured = {};
    const res = mockRes();
    await withEnvAsync(DOOR, () => doorWithCapture(captured)(mockReq(headers, path), res));
    assert.equal(captured.scope?.kind, "account", `${label} did not authenticate`);
    assert.deepEqual(captured.scope.accounts, ["acme", "acme-eu"], `${label} resolved a different grant`);
    assert.equal(captured.owner, "lawyer@acme.example", `${label} left the session unattributable`);
  }
});

test("a CF-fronted door does NOT read Authorization as a trademark key", async () => {
  // that header belongs to whatever the proxy/agent is doing there; re-reading it would turn an
  // unrelated bearer token into a 401 on a door that works today.
  const url = new URL("http://h/mcp");
  assert.equal(readInnerToken(url, { authorization: "Bearer something-else" }), null);
  assert.equal(readInnerToken(url, { authorization: "Bearer abc" }, { allowAuthorization: true }), "abc");
  assert.equal(readInnerToken(url, { authorization: "abc" }, { allowAuthorization: true }), "abc");
  // an explicitly-named token still wins over the ambient header
  assert.equal(readInnerToken(url, { "x-trademark-token": "explicit", authorization: "Bearer ambient" }, { allowAuthorization: true }), "explicit");
});

test("a misconfigured door refuses to BUILD rather than serving something weaker", () => {
  const base = { limiter: new RateLimiter({ perMinute: 10 }), sessions: new Map(), createSession: async () => {} };
  assert.throws(() => makeHttpHandler({ ...base, verify: null, tokenOnly: true, devMode: true }),
    /mutually exclusive/, "the dev knob's synthetic identity would have answered instead of the key");
  assert.throws(() => makeHttpHandler({ ...base, verify: async () => ({}), tokenOnly: true }), /pass verify:null/);
  assert.throws(() => makeHttpHandler({ ...base, verify: null }), /fail-closed/);
});
