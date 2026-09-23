// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A STATE CHANGE MUST COME FROM THIS PORTAL'S OWN PAGES. The portal checked nothing about where a POST
// came from, so a page on another site, or another app on this machine on another port, could make a
// signed-in browser change state here, and could sign a browser in. Two checks close it: the request's
// Origin (or, without one, Sec-Fetch-Site) must be this portal, and an API body must declare JSON.
//
// The rule is pinned as a pure function first, then driven over a real socket in both identity modes,
// because a check that is right and never called reads exactly like one that is wired. Every refusal arm
// has its control: the same request from the portal's own page goes through.
//
// node:http rather than fetch, as the other portal socket tests do: undici's WASM OOMs under the
// constrained ulimits this suite has to pass under.
//
// SAFETY GUARD: env pinned before dynamic driver imports (driver.config freezes roots at import).
import { mkdtempSync as __mkdtemp } from "node:fs";
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || __mkdtemp(__join(__tmpdir(), "portal-origin-ws-")));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", envFrom(process.env, "CLEAROTRON_REPORTS_DIR") || __mkdtemp(__join(__tmpdir(), "portal-origin-pool-")));
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, request as httpRequest } from "node:http";

const { crossSiteReason, bodyNotJson } = await import("../portal-request-origin.mjs");
const { makeHttpHandler } = await import("../portal-service.mjs");
const { establishCredential, readLocalCredential, makeAttemptLimiter } = await import("../portal-local-auth.mjs");

const post = (headers) => ({ method: "POST", headers });

// ── the rule ───────────────────────────────────────────────────────────────────────────────────────

test("an Origin naming this portal passes; any other site, port or scheme-less value is refused", () => {
  assert.equal(crossSiteReason(post({ host: "127.0.0.1:18802", origin: "http://127.0.0.1:18802" })), null, "the portal's own page");
  assert.equal(crossSiteReason(post({ host: "localhost:18802", origin: "HTTP://LOCALHOST:18802" })), null, "case is not a different site");
  assert.ok(crossSiteReason(post({ host: "127.0.0.1:18802", origin: "https://evil.example" })), "another site");
  assert.ok(crossSiteReason(post({ host: "127.0.0.1:18802", origin: "http://127.0.0.1:18860" })),
    "another app on this machine, on another port: a browser calls that the same site, so the port has to be compared");
  assert.ok(crossSiteReason(post({ host: "127.0.0.1:18802", origin: "null" })), "an opaque origin (a sandboxed frame, a data: page)");
  assert.ok(crossSiteReason(post({ host: "127.0.0.1:18802", origin: "not a url" })), "an Origin that is not an address");
});

test("behind a proxy that rewrites Host, the forwarded host is this portal's name", () => {
  // Caddy in front of the portal: the browser addressed portal.example, the portal sees the loopback it
  // was proxied to in Host and the original in X-Forwarded-Host.
  assert.equal(crossSiteReason(post({ host: "127.0.0.1:18802", "x-forwarded-host": "portal.example", origin: "https://portal.example" })), null);
  assert.equal(crossSiteReason(post({ host: "portal.example", origin: "https://portal.example" })), null, "and a proxy that keeps Host");
  assert.ok(crossSiteReason(post({ host: "127.0.0.1:18802", "x-forwarded-host": "portal.example", origin: "https://evil.example" })),
    "the forwarded host is a match on this portal's name, not a pass for every origin");
});

test("with no Origin, Sec-Fetch-Site decides; with neither, the caller is not a browser", () => {
  assert.equal(crossSiteReason(post({ host: "h", "sec-fetch-site": "same-origin" })), null);
  assert.equal(crossSiteReason(post({ host: "h", "sec-fetch-site": "none" })), null, "typed or bookmarked by the person");
  assert.ok(crossSiteReason(post({ host: "h", "sec-fetch-site": "cross-site" })));
  assert.ok(crossSiteReason(post({ host: "h", "sec-fetch-site": "same-site" })), "another port or subdomain of this host");
  assert.equal(crossSiteReason(post({ host: "h" })), null,
    "a script or curl sends neither header and cannot be made to carry someone else's session");
});

test("only a state change is asked where it came from", () => {
  for (const method of ["GET", "HEAD", "OPTIONS"])
    assert.equal(crossSiteReason({ method, headers: { host: "h", origin: "https://evil.example" } }), null, method);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"])
    assert.ok(crossSiteReason({ method, headers: { host: "h", origin: "https://evil.example" } }), method);
});

test("a body is refused unless it says it is JSON; no body is asked nothing", () => {
  const withBody = (type, extra = {}) => post({ "content-length": "7", ...(type ? { "content-type": type } : {}), ...extra });
  assert.equal(bodyNotJson(withBody("application/json")), false);
  assert.equal(bodyNotJson(withBody("Application/JSON; charset=utf-8")), false);
  assert.equal(bodyNotJson(withBody("text/plain;charset=UTF-8")), true, "what fetch sends for a string body with no type");
  assert.equal(bodyNotJson(withBody("application/x-www-form-urlencoded")), true, "a form post");
  assert.equal(bodyNotJson(withBody(null)), true, "a body with no type");
  assert.equal(bodyNotJson(post({ "transfer-encoding": "chunked" })), true, "a chunked body with no length is still a body");
  assert.equal(bodyNotJson(post({ "content-length": "0" })), false, "the portal's own POSTs with nothing to send carry no type");
  assert.equal(bodyNotJson(post({})), false);
  assert.equal(bodyNotJson({ method: "GET", headers: { "content-length": "7", "content-type": "text/plain" } }), false);
});

// ── the handler, over a real socket ────────────────────────────────────────────────────────────────

function send(port, path, { method = "POST", headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const r = httpRequest({ host: "127.0.0.1", port, path, method, headers }, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, cookies: res.headers["set-cookie"] ?? [], body: data }));
    });
    r.on("error", reject);
    if (body != null) r.write(body);
    r.end();
  });
}

async function serve(handler, fn) {
  const srv = createServer(handler);
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;
  try { return await fn(port); } finally { await new Promise((r) => srv.close(r)); }
}

/**
 * A portal whose service records what reached it. AUTH-PROXY is the mode a fronted deployment runs: an
 * edge in front signs the person in and the portal verifies the assertion it forwards (Cloudflare Access,
 * or an OIDC proxy). The verifier here admits one assertion and nothing else, so a request that got
 * through was verified, not waved in.
 */
function recordingPortal({ mode = "auth-proxy" } = {}) {
  const routed = [];
  const audits = [];
  const logs = [];
  const service = {
    audit: (row) => audits.push(row),
    route: async (method, path, _identity, body) => { routed.push({ method, path, body }); return { status: 200, json: { ok: true } }; },
  };
  const identity = mode === "auth-proxy"
    ? { verify: async (assertion) => { if (assertion !== "edge-signed") throw Object.assign(new Error("no"), { name: "AuthError", status: 401 }); return { email: "staff@example.com" }; } }
    : { devIdentity: { email: "staff@example.com" } };
  const handler = makeHttpHandler({ service, ...identity, limiter: null, log: (s) => logs.push(s) });
  return { handler, routed, audits, logs };
}

const JSON_BODY = JSON.stringify({ name: "x" });
const jsonHeaders = (port, extra = {}) => ({ host: `127.0.0.1:${port}`, "cf-access-jwt-assertion": "edge-signed",
  "content-type": "application/json", "content-length": Buffer.byteLength(JSON_BODY), ...extra });

test("auth-proxy mode: the edge's own assertion is still required, so these arms measure a verified request", async () => {
  const p = recordingPortal();
  await serve(p.handler, async (port) => {
    const unsigned = await send(port, "/portal/api/profiles", { headers: { ...jsonHeaders(port), "cf-access-jwt-assertion": "forged" }, body: JSON_BODY });
    assert.equal(unsigned.status, 401, unsigned.body);
    assert.equal(p.routed.length, 0);
  });
});

test("a POST from another site never reaches the service, and the refusal is logged and journaled", async () => {
  const p = recordingPortal();
  await serve(p.handler, async (port) => {
    const r = await send(port, "/portal/api/profiles", { headers: jsonHeaders(port, { origin: "https://evil.example" }), body: JSON_BODY });
    assert.equal(r.status, 403);
    assert.deepEqual(JSON.parse(r.body), { error: "cross_site" });
    assert.equal(p.routed.length, 0, "the service ran a request from another site");
    assert.ok(p.logs.some((l) => /refused a POST to \/portal\/api\/profiles from another site/.test(l)), "the operator is told nothing");
    assert.ok(p.audits.some((row) => row.status === 403 && row.reason === "cross-site request"), "an admin write refused here left no row");

    // The control: the same request from the portal's own page.
    const own = await send(port, "/portal/api/profiles", { headers: jsonHeaders(port, { origin: `http://127.0.0.1:${port}` }), body: JSON_BODY });
    assert.equal(own.status, 200, own.body);
    assert.equal(p.routed.length, 1);
    assert.deepEqual(p.routed[0].body, { name: "x" });
  });
});

test("a browser that sends only Sec-Fetch-Site is judged by it", async () => {
  const p = recordingPortal();
  await serve(p.handler, async (port) => {
    const cross = await send(port, "/portal/api/profiles", { headers: jsonHeaders(port, { "sec-fetch-site": "cross-site" }), body: JSON_BODY });
    assert.equal(cross.status, 403);
    const same = await send(port, "/portal/api/profiles", { headers: jsonHeaders(port, { "sec-fetch-site": "same-origin" }), body: JSON_BODY });
    assert.equal(same.status, 200);
    assert.equal(p.routed.length, 1);
  });
});

test("a script with neither header still gets through, on its own credential", async () => {
  const p = recordingPortal();
  await serve(p.handler, async (port) => {
    const r = await send(port, "/portal/api/profiles", { headers: jsonHeaders(port), body: JSON_BODY });
    assert.equal(r.status, 200, r.body);
    assert.equal(p.routed.length, 1);
  });
});

test("an API body that does not say it is JSON is refused before it is read", async () => {
  const p = recordingPortal();
  await serve(p.handler, async (port) => {
    const own = { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`, "cf-access-jwt-assertion": "edge-signed" };
    const plain = await send(port, "/portal/api/profiles", { headers: { ...own, "content-type": "text/plain", "content-length": Buffer.byteLength(JSON_BODY) }, body: JSON_BODY });
    assert.equal(plain.status, 415);
    assert.deepEqual(JSON.parse(plain.body), { error: "unsupported_media_type" });
    assert.equal(p.routed.length, 0, "a text/plain body was parsed as JSON and routed");
    assert.ok(p.audits.some((row) => row.status === 415), "the refusal of an admin write left no row");

    // Controls: the same body declared as JSON, and a POST that carries nothing and so declares nothing.
    const json = await send(port, "/portal/api/profiles", { headers: { ...own, "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(JSON_BODY) }, body: JSON_BODY });
    assert.equal(json.status, 200, json.body);
    const empty = await send(port, "/portal/api/profiles", { headers: { ...own, "content-length": "0" } });
    assert.equal(empty.status, 200, empty.body);
    assert.equal(p.routed.length, 2);
  });
});

test("the same rule holds with an identity injected in-process, the mode the other portal tests use", async () => {
  const p = recordingPortal({ mode: "injected" });
  await serve(p.handler, async (port) => {
    const cross = await send(port, "/portal/api/profiles", { headers: jsonHeaders(port, { origin: "https://evil.example" }), body: JSON_BODY });
    assert.equal(cross.status, 403);
    const own = await send(port, "/portal/api/profiles", { headers: jsonHeaders(port, { origin: `http://127.0.0.1:${port}` }), body: JSON_BODY });
    assert.equal(own.status, 200, own.body);
    assert.equal(p.routed.length, 1);
  });
});

// ── the sign-in form, in local mode ────────────────────────────────────────────────────────────────

async function withLocalPortal(fn) {
  const dir = mkdtempSync(join(tmpdir(), "portal-origin-login-"));
  const credentialPath = join(dir, "credential.json");
  const email = "one@laptop.example";
  const { passphrase } = establishCredential({ path: credentialPath, email });
  const routed = [];
  const service = { audit: () => {}, route: async (method, path) => { routed.push({ method, path }); return { status: 200, json: { ok: true } }; } };
  const localAuth = { email, secret: "origin-test-secret", ttlSec: 3600, credential: () => readLocalCredential(credentialPath),
    attempts: makeAttemptLimiter({ max: 50, windowMs: 60_000 }) };
  return serve(makeHttpHandler({ verify: null, limiter: null, service, localAuth, log: () => {} }), (port) => fn({ port, passphrase, routed }));
}

test("local mode: a signed-in browser's API POST from another site is refused; from the portal it goes through", async () => {
  await withLocalPortal(async ({ port, passphrase, routed }) => {
    const own = `http://127.0.0.1:${port}`;
    const form = new URLSearchParams({ passphrase }).toString();
    const signIn = await send(port, "/portal/login", { headers: { host: `127.0.0.1:${port}`, origin: own,
      "content-type": "application/x-www-form-urlencoded", "content-length": Buffer.byteLength(form) }, body: form });
    assert.equal(signIn.status, 302, signIn.body);
    const cookie = signIn.cookies[0].split(";")[0];
    const headers = (origin) => ({ host: `127.0.0.1:${port}`, cookie, origin, "content-type": "application/json", "content-length": Buffer.byteLength(JSON_BODY) });
    const cross = await send(port, "/portal/api/profiles", { headers: headers("https://evil.example"), body: JSON_BODY });
    assert.equal(cross.status, 403, "a signed-in browser's session was used from another site");
    assert.equal(routed.length, 0);
    const mine = await send(port, "/portal/api/profiles", { headers: headers(own), body: JSON_BODY });
    assert.equal(mine.status, 200, mine.body);
    assert.equal(routed.length, 1, "the portal's own signed-in request did not reach the service");
  });
});

test("a sign-in posted from another site is refused and sets no session", async () => {
  await withLocalPortal(async ({ port, passphrase }) => {
    const body = new URLSearchParams({ passphrase }).toString();
    const headers = (origin) => ({ host: `127.0.0.1:${port}`, origin, "content-type": "application/x-www-form-urlencoded", "content-length": Buffer.byteLength(body) });
    const cross = await send(port, "/portal/login", { headers: headers("https://evil.example"), body });
    assert.equal(cross.status, 403);
    assert.equal(cross.cookies.length, 0, "a sign-in from another site set a session cookie");

    // The control: the right passphrase from the portal's own form signs in.
    const own = await send(port, "/portal/login", { headers: headers(`http://127.0.0.1:${port}`), body });
    assert.equal(own.status, 302, own.body);
    assert.ok(own.cookies.some((c) => c.length > 0), "the portal's own sign-in set no session, so the refusal above proves nothing");
  });
});

test("a sign-out posted from another site is refused; the portal's own form signs out", async () => {
  await withLocalPortal(async ({ port }) => {
    const cross = await send(port, "/portal/logout", { headers: { host: `127.0.0.1:${port}`, origin: "https://evil.example", "content-length": "0" } });
    assert.equal(cross.status, 403);
    const own = await send(port, "/portal/logout", { headers: { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`, "content-length": "0" } });
    assert.equal(own.status, 302);
  });
});
