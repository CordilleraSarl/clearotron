// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The CLIENT MCP twin (http-server-client.mjs) versus the hardening added to the staff door — fix-list C8.
//
// C8 says the "mandatory-grants / loopback hardening" on http-server.mjs was never carried across to the
// other auth-disabled service. It is two separate guards, and they land differently here:
//
//   MANDATORY GRANTS — DOES NOT APPLY. The staff hole is: auth off ⇒ no verified email ⇒ token-less caller
//     treated as firm staff ⇒ `internal` scope ⇒ visibility = accountsForEmail(email, loadGrants()) ⇒ and
//     that returns "*" with no grants file ⇒ read-all across every customer. On the client surface the chain
//     breaks at step two and step three, upstream of grants: http-handler.mjs pins `firmStaff = clientSurface
//     ? false : …` (the auth-disabled `: true` is on a branch this process never takes), and resolveScope()
//     refuses a token-less clientSurface caller as its FIRST statement. `internal` is unreachable here, so a
//     CLEAROTRON_ACCESS_FILE guard would be inert. The tests below PIN that — they are an invariant lock, not a
//     fix, and they pass against the unchanged code by design. If someone later drops clientSurface, or
//     reorders resolveScope so the firmStaff branch runs first, these go red and the reason is written down.
//
//   LITERAL LOOPBACK — DOES APPLY, and is the actual C8 fix. The staff door's set is {127.0.0.1, ::1} with
//     the comment `"localhost" can resolve elsewhere on a hostile resolver`. This twin's set also carried
//     "localhost", so its auth-disabled guard accepted CLIENT_MCP_HTTP_HOST=localhost and then passed the
//     NAME to listen(), which resolves it. Weaker consequence than the staff door (a run-bound user token is
//     still required) but real: it puts the client MCP face on the network with CF Access skipped entirely,
//     so a leaked report link becomes exercisable from anywhere instead of only from this box.

import { test } from "node:test";
import { pinEnvAll } from "../../shared/env-aliases.mjs";   // — a child env writes every spelling; — the pin follows the emitter
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { makeHttpHandler } from "../lib/http-handler.mjs";
import { RateLimiter } from "../lib/ratelimit.mjs";
import { resolveScope, mintToken } from "../lib/scope.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const CLIENT = join(dirname(fileURLToPath(import.meta.url)), "..", "http-server-client.mjs");

/**
 * Boot the client twin with an env; report what it said before it stopped.
 * A door that FATALs exits on its own; a door that listens never does, so we cut it short the moment
 * "listening on" appears. That early cut is what keeps this suite from spending a full timeout per
 * healthy-boot assertion — and, more importantly, "did it reach listen()" is the exact question every
 * assertion below is asking, so it is the right thing to wait on rather than an exit code.
 */
function boot(env, timeoutMs = 6000) {
  return new Promise((resolve) => {
    let out = "";
    let done = false;
    const finish = () => { if (done) return; done = true; try { child.kill("SIGKILL"); } catch { /* gone */ } resolve({ stderr: out }); };
    const child = execFile(process.execPath, [CLIENT], { env: pinEnvAll({ ...process.env }, env)   // — every spelling, or a pin of the other one upstream wins
     , timeout: timeoutMs },
      () => finish());
    child.stderr.on("data", (d) => { out += String(d); if (/listening on|FATAL/.test(out)) finish(); });
  });
}

const DEVBASE = { CLIENT_MCP_AUTH_DISABLED: "1", CLIENT_MCP_DEV: "1", CLIENT_MCP_HTTP_PORT: "0" };

// ── the fix: literal loopback only ────────────────────────────────────────────────────────────────

test("THE FIX: auth-disabled with HOST=localhost refuses to start (a NAME is not a literal loopback address)", async () => {
  const r = await boot({ ...DEVBASE, CLIENT_MCP_HTTP_HOST: "localhost" });
  assert.ok(!/listening on/.test(r.stderr), "it must never reach listen() — a resolver decides where 'localhost' points");
  assert.match(r.stderr, /FATAL/);
  assert.match(r.stderr, /not loopback/);
});

test("the literal loopback addresses still start, and a reachable address is still refused", async () => {
  // Over-tightening here would break remote/client-mcp.service and every local dev run, so pin both ends.
  const ok = await boot({ ...DEVBASE, CLIENT_MCP_HTTP_HOST: "127.0.0.1" });
  assert.match(ok.stderr, /listening on/, "127.0.0.1 is still a valid auth-disabled dev host");
  assert.match(ok.stderr, /AUTH OFF \(dev\)/);

  const bad = await boot({ ...DEVBASE, CLIENT_MCP_HTTP_HOST: "0.0.0.0" });
  assert.ok(!/listening on/.test(bad.stderr));
  assert.match(bad.stderr, /not loopback/);
});

test("the two pre-existing fail-closed guards are unaffected by the tightened set", async () => {
  const noDev = await boot({ ...DEVBASE, CLIENT_MCP_DEV: "", CLIENT_MCP_HTTP_HOST: "127.0.0.1" });
  assert.ok(!/listening on/.test(noDev.stderr));
  assert.match(noDev.stderr, /CLIENT_MCP_DEV/);

  // Auth ON with a client AUD copy-pasted from the staff AUD — the surface-collapse guard.
  const collapsed = await boot({
    CLIENT_MCP_AUTH_DISABLED: "", CLIENT_MCP_DEV: "", CLIENT_MCP_HTTP_PORT: "0",
    CF_ACCESS_TEAM: "t", CLEAROTRON_OIDC_AUDIENCE: "same-aud", CLEAROTRON_OIDC_AUDIENCE: "same-aud", CLEAROTRON_CLIENT_OIDC_AUDIENCE: "same-aud", CLEAROTRON_CLIENT_OIDC_AUDIENCE: "same-aud",
  });
  assert.ok(!/listening on/.test(collapsed.stderr));
  assert.match(collapsed.stderr, /distinct CF Access application AUD/);
});

// ── the grants boundary on this surface ───────────────────────────────────────────────────────────
// These are LOCKS. Each one names the line it protects.
//
// HISTORY, because the framing changed and a stale comment here would be worse than none. These began as
// C8's "non-fix": proof that the staff surface's grants hole could not reach this process, because
// resolveScope refused EVERY token-less caller before grants were ever consulted, so a guard here would
// have been theatre. That argument was sound and is now only half true. CLIENT_MCP_ACCOUNT_ACCESS=1 opens
// a token-less principal that DOES consult grants (kind "account"), so this surface acquired both a real
// grants dependency and a startup guard for it.
//
// What these locks pin now: with the feature OFF — which is the default, and what every deployment that
// has not opted in is running — the original refusal is unchanged and unconditional. The new path's own
// fail-closed behaviour is locked directly below, and its authorization surface in account-principal.test.mjs.

test("LOCK: account access ON without a grants file refuses to START (the guard C8 did not need)", async () => {
  const r = await boot({ ...DEVBASE, CLIENT_MCP_HTTP_HOST: "127.0.0.1", CLIENT_MCP_ACCOUNT_ACCESS: "1", CLEAROTRON_ACCESS_FILE: "" });
  assert.ok(!/listening on/.test(r.stderr), "the client surface started with account access on and no guest list");
  assert.match(r.stderr, new RegExp(`CLIENT_MCP_ACCOUNT_ACCESS=1 requires CLEAROTRON_ACCESS_FILE`));
});

test("LOCK: the feature is OFF by default — shipping this code opens nothing", async () => {
  const r = await boot({ ...DEVBASE, CLIENT_MCP_HTTP_HOST: "127.0.0.1", CLEAROTRON_ACCESS_FILE: "" });
  assert.match(r.stderr, /listening on/, "the default configuration must still boot");
  assert.match(r.stderr, /client ACCOUNT access OFF/);
});

test("LOCK: resolveScope refuses a token-less client-surface caller BEFORE grants are ever consulted", () => {
  const savedGrants = process.env.CLEAROTRON_ACCESS_FILE;
  const savedSecret = process.env.TRADEMARK_MCP_TOKEN_SECRET;
  process.env.TRADEMARK_MCP_TOKEN_SECRET ||= "test-secret-client-surface";
  pinEnv(process.env, "CLEAROTRON_ACCESS_FILE", undefined);   // the EXACT condition that hands the staff door read-all
  try {
    // No token, and every input that would manufacture staff-ness on the staff surface set to true.
    assert.throws(
      () => resolveScope({ clientSurface: true, innerToken: null, email: "anyone@anywhere.example", firmStaff: true }),
      /forbidden: the client surface requires a run-scoped token/,
      "firmStaff:true must be ignored on the client surface — otherwise no-grants-file is read-all here too",
    );
    // An OPS token — the other way `internal`-grade authority could arrive — is refused too.
    assert.throws(
      () => resolveScope({ clientSurface: true, innerToken: mintToken({ scope: "ops", sub: "leaked" }) }),
      /forbidden: the client surface accepts only a run-scoped user token/,
    );
    // And the one admissible principal still resolves, with accounts moot (it is bound to one run).
    const s = resolveScope({ clientSurface: true, innerToken: mintToken({ scope: "user", runId: "tmpc-x-2026-07-20-jade-q" }) });
    assert.equal(s.kind, "user");
    assert.equal(s.runId, "tmpc-x-2026-07-20-jade-q");
    assert.equal(s.accounts, null, "a run-bound token never carries an accounts grant to widen");
  } finally {
    pinEnv(process.env, "CLEAROTRON_ACCESS_FILE", savedGrants);
    if (savedSecret === undefined) delete process.env.TRADEMARK_MCP_TOKEN_SECRET; else process.env.TRADEMARK_MCP_TOKEN_SECRET = savedSecret;
  }
});

test("LOCK: the handler never grants firm-staff-ness on a client surface, even auth-disabled", async () => {
  // http-handler.mjs: `const firmStaff = clientSurface ? false : (verify ? isFirmDomain(…) : true)`.
  // This is the auth-disabled configuration the staff door needs its grants guard for; here it 403s.
  const savedGrants = process.env.CLEAROTRON_ACCESS_FILE;
  pinEnv(process.env, "CLEAROTRON_ACCESS_FILE", undefined);
  try {
    const initBody = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } } };
    const raw = Buffer.from(JSON.stringify(initBody));
    const req = { method: "POST", url: "/mcp", headers: {}, async *[Symbol.asyncIterator]() { yield raw; } };
    const res = { statusCode: null, body: null, headersSent: false, writeHead(s) { this.statusCode = s; this.headersSent = true; }, end(b) { this.body = b; } };
    const handler = makeHttpHandler({
      verify: null, devMode: true, clientSurface: true,
      limiter: new RateLimiter({ perMinute: 100 }), sessions: new Map(),
      createSession: async () => { throw new Error("a token-less client-surface caller must never reach session creation"); },
    });
    await handler(req, res);
    assert.equal(res.statusCode, 403, "token-less ⇒ forbidden, never an internal read-all session");
    assert.match(String(res.body), /run-scoped token/);
  } finally {
    pinEnv(process.env, "CLEAROTRON_ACCESS_FILE", savedGrants);
  }
});

// ── the API-key door's boot guards ───────────────────────────────────────────────────────────────
// This door has NO auth proxy in front of it: the key is the authentication. Every guard below is
// therefore about refusing to listen in a configuration where something OTHER than a valid key could
// answer — or where no key could be checked at all.

const KEYBASE = {
  CLIENT_MCP_TOKEN_ONLY: "1", CLIENT_MCP_ACCOUNT_ACCESS: "1",
  TRADEMARK_MCP_TOKEN_SECRET: "hardening-key-door-secret",
  CLEAROTRON_ACCESS_FILE: "/nonexistent/grants.json",   // only its PRESENCE is checked at boot
  CLIENT_MCP_HTTP_HOST: "127.0.0.1", CLIENT_MCP_HTTP_PORT: "0",
  CLIENT_MCP_ALLOWED_HOSTS: "agent-mcp.example.com",
  CLIENT_MCP_AUTH_DISABLED: "", CLIENT_MCP_DEV: "",
};

test("the API-key door starts, and says which door it is", async () => {
  const r = await boot(KEYBASE);
  assert.match(r.stderr, /listening on/);
  assert.match(r.stderr, /API-KEY door/, "the boot log must not read like the CF-fronted door");
});

test("token-only + auth-disabled REFUSES to start — the pair would answer with the dev identity, not a key", async () => {
  const r = await boot({ ...KEYBASE, CLIENT_MCP_AUTH_DISABLED: "1", CLIENT_MCP_DEV: "1" });
  assert.ok(!/listening on/.test(r.stderr), "a door that waives authentication must never claim to demand a key");
  assert.match(r.stderr, /FATAL/);
  assert.match(r.stderr, /mutually exclusive/);
});

test("token-only without the signing secret REFUSES to start — no key could be verified", async () => {
  const r = await boot({ ...KEYBASE, TRADEMARK_MCP_TOKEN_SECRET: "" });
  assert.ok(!/listening on/.test(r.stderr));
  assert.match(r.stderr, /TRADEMARK_MCP_TOKEN_SECRET/);
});

test("token-only without account access, off loopback, or without allowed-hosts REFUSES to start", async () => {
  for (const [label, env, expect] of [
    ["account access off", { CLIENT_MCP_ACCOUNT_ACCESS: "" }, /CLIENT_MCP_ACCOUNT_ACCESS/],
    ["reachable bind", { CLIENT_MCP_HTTP_HOST: "0.0.0.0" }, /not loopback/],
    ["no allowed hosts", { CLIENT_MCP_ALLOWED_HOSTS: "" }, /CLIENT_MCP_ALLOWED_HOSTS/],
  ]) {
    const r = await boot({ ...KEYBASE, ...env });
    assert.ok(!/listening on/.test(r.stderr), `${label}: it reached listen()`);
    assert.match(r.stderr, expect, `${label}: wrong refusal`);
  }
});
