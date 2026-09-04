// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// portal-local-login.test.mjs —: the local sign-in door, driven over a real socket.
//
// portal-local-auth.test.mjs proves the credential and the token. This proves the HTTP half that
// cannot be reached from a pure function: the form, the cookie and its attributes, and — the part that
// matters most — that adding a third way to prove WHO changed nothing about WHAT ANYONE SEES.
//
// The two assertions this file exists for:
//
//   1. A logged-out request to a scoped route is refused exactly as it is today, with the same status
//      and the same body the Cloudflare path produces for a missing JWT.
//   2. A logged-IN request that probes another account still reads as 404, not 403. Existence must not
//      leak, and a new identity source is precisely the change that could have made it.
//
// node:http rather than fetch, following dev-portal.test.mjs: undici's WASM OOMs under constrained
// ulimits, and this suite has to pass there.
//
// SAFETY GUARD: env pinned before dynamic driver imports (driver.config freezes roots at import).
import { mkdtempSync as __mkdtemp } from "node:fs";
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";   // — the default is taken only when NO spelling holds a value
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || __mkdtemp(__join(__tmpdir(), "portal-login-ws-")));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", envFrom(process.env, "CLEAROTRON_REPORTS_DIR") || __mkdtemp(__join(__tmpdir(), "portal-login-pool-")));
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, request as httpRequest } from "node:http";

const { makeHttpHandler, makePortalService } = await import("../portal-service.mjs");
const { establishCredential, readLocalCredential, mintSession, makeAttemptLimiter } =
  await import("../portal-local-auth.mjs");

const SECRET = "local-login-test-secret";
const USER = "one@laptop.example";
const GRANTS = { tenants: { celta: { accounts: ["aurora", "zephyr"], users: { [USER]: ["aurora"] } } } };

/**
 * A portal in local mode: the real service, the real handler, the real credential file, one user who
 * is granted `aurora` and NOT `zephyr`.
 */
async function withLocalPortal(fn, { attempts = makeAttemptLimiter({ max: 10, windowMs: 5 * 60 * 1000 }) } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "portal-login-"));
  const credentialPath = join(dir, "credential.json");
  const { passphrase } = establishCredential({ path: credentialPath, email: USER });

  // — the rows the portal journals, captured rather than dropped. This sink was ` => {}` because
  // nothing here asked what got written; the refusals THIS DOOR decides are now written to it, and the
  // 401 test below reads them back.
  const audits = [];
  const service = makePortalService({
    poolRoot: mkdtempSync(join(tmpdir(), "portal-login-pool-")),
    workspaceRoot: mkdtempSync(join(tmpdir(), "portal-login-ws-")),
    secret: SECRET, staffDomains: [], grants: GRANTS, audit: (r) => audits.push(r),
  });
  const localAuth = {
    email: USER, secret: SECRET, ttlSec: 60 * 60 * 12,
    credential: () => readLocalCredential(credentialPath), attempts,
  };
  // No static handler: the SPA bundle is not what is under test, and wiring it would make every
  // assertion below depend on whether portal-ui had been built.
  const srv = createServer(makeHttpHandler({ verify: null, limiter: null, service, localAuth, log: () => {} }));
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;
  try {
    await fn({ port, passphrase, credentialPath, audits });
  } finally {
    await new Promise((r) => srv.close(r));
  }
}

function req(port, path, { method = "GET", headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const r = httpRequest({ host: "127.0.0.1", port, path, method, headers }, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => resolve({
        status: res.statusCode,
        headers: res.headers,
        // node lowercases header names and collects set-cookie into an array.
        cookies: res.headers["set-cookie"] ?? [],
        body: data,
      }));
    });
    r.on("error", reject);
    if (body != null) r.write(body);
    r.end();
  });
}

const form = (obj) => new URLSearchParams(obj).toString();
const postForm = (port, path, fields, headers = {}) => req(port, path, {
  method: "POST", body: form(fields),
  headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
});
/** The session cookie out of a Set-Cookie line, as a Cookie request header. */
const cookieHeader = (setCookie) => setCookie[0].split(";")[0];

// ── the form ───────────────────────────────────────────────────────────────────────────────────────

test("#769 GET /portal/login renders a form that shows the address and asks only for a passphrase", async () => {
  await withLocalPortal(async ({ port }) => {
    const r = await req(port, "/portal/login", { headers: { accept: "text/html" } });
    assert.equal(r.status, 200);
    assert.match(r.headers["content-type"], /text\/html/);
    assert.equal(r.headers["cache-control"], "no-store", "a login form must never be cached");
    assert.ok(r.body.includes(USER), "the address is DISPLAYED — the person is told who they are signing in as");
    assert.match(r.body, /type="password"/, "one passphrase field");
    assert.ok(!/name="email"/.test(r.body), "and no email field — asking would make the form an oracle for which address works");
    assert.match(r.body, /action="\/portal\/login"/);
  });
});

test("#769 THE LOGIN PAGE NAMES NO INTERNAL VARIABLE — the same rule CI greps the built bundle for", async () => {
  // CI fails the build if `(CLEAROTRON|PORTAL|CF_ACCESS|MCP)_[A-Z_]+` appears in portal-ui/dist. That gate
  // reads the bundle and cannot see this page, which is server-rendered — so the rule is asserted here
  // instead, on the exact same pattern. It is also WHY this page is server-rendered: a login screen
  // inside the SPA would want to explain which value to set, and the first honest sentence it wrote
  // would red the build.
  await withLocalPortal(async ({ port }) => {
    for (const r of [
      await req(port, "/portal/login", { headers: { accept: "text/html" } }),
      await postForm(port, "/portal/login", { passphrase: "wrong" }),
    ]) {
      const hit = /(CLEAROTRON|PORTAL|CF_ACCESS|MCP)_[A-Z_]+/.exec(r.body);
      assert.equal(hit, null, `the page names ${hit?.[0]} — client-facing copy must never name a switch`);
    }
  });
});

// ── signing in ─────────────────────────────────────────────────────────────────────────────────────

test("#769 the right passphrase sets a session cookie and sends the browser to the portal", async () => {
  await withLocalPortal(async ({ port, passphrase }) => {
    const r = await postForm(port, "/portal/login", { passphrase });
    assert.equal(r.status, 302);
    assert.equal(r.headers.location, "/portal", "a fixed destination — never one taken from the request");
    assert.equal(r.cookies.length, 1);
    const c = r.cookies[0];
    assert.match(c, /^portal_session=ps1\./, "the cookie carries a session token of the declared family");
    assert.match(c, /HttpOnly/, "no script needs it");
    assert.match(c, /SameSite=Strict/, "there is no cross-site flow to preserve");
    assert.match(c, /Path=\//, "a report under /portal/report/… must carry it too");
    assert.match(c, /Max-Age=43200/, "12 hours, matching the token's own TTL");
  });
});

test("#769 a wrong passphrase is a 401 and one generic sentence, with no cookie and no hint", async () => {
  await withLocalPortal(async ({ port }) => {
    const r = await postForm(port, "/portal/login", { passphrase: "not the passphrase" });
    assert.equal(r.status, 401);
    assert.deepEqual(r.cookies, [], "a failed sign-in must not hand out a session");
    assert.ok(r.body.includes("That passphrase is not correct."));
    // Nothing about WHICH half was wrong. The address is not asked for, so there is nothing to confirm
    // about it either.
    assert.ok(!/address|email|user|not configured|no credential/i.test(r.body.replace(USER, "")),
      "the refusal must not describe the credential it checked against");
  });
  // An empty submission and a missing field take the same path — a form that answered differently for
  // "no passphrase" than for "wrong passphrase" would be telling an unauthenticated caller something.
  await withLocalPortal(async ({ port }) => {
    for (const fields of [{ passphrase: "" }, {}, { something: "else" }]) {
      const r = await postForm(port, "/portal/login", fields);
      assert.equal(r.status, 401, `${JSON.stringify(fields)} must answer exactly as a wrong passphrase does`);
      assert.ok(r.body.includes("That passphrase is not correct."));
    }
  });
});

test("#769 Secure is set ONLY when the request arrived over TLS", async () => {
  // The failure this exists for is total and silent: a laptop user on http://127.0.0.1 handed a Secure
  // cookie gets a browser that stores it and never sends it back — every sign-in "succeeds" and every
  // page is anonymous, with no error anywhere.
  await withLocalPortal(async ({ port, passphrase }) => {
    const plain = await postForm(port, "/portal/login", { passphrase });
    assert.ok(!/;\s*Secure/i.test(plain.cookies[0]), "plain http must NOT get a Secure cookie");

    const fronted = await postForm(port, "/portal/login", { passphrase }, { "x-forwarded-proto": "https" });
    assert.match(fronted.cookies[0], /;\s*Secure/, "behind a TLS-terminating proxy it must");
    // A comma-joined chain is what a second proxy produces; the first hop is the client's.
    const chained = await postForm(port, "/portal/login", { passphrase }, { "x-forwarded-proto": "https, http" });
    assert.match(chained.cookies[0], /;\s*Secure/);
  });
});

// ── what a session does and does not buy ───────────────────────────────────────────────────────────

test("#769 signed in, the scoped route answers; the SAME request signed out is refused exactly as today", async () => {
  await withLocalPortal(async ({ port, passphrase }) => {
    const login = await postForm(port, "/portal/login", { passphrase });
    const cookie = cookieHeader(login.cookies);

    const inn = await req(port, "/portal/api/runs?account=aurora", { headers: { cookie, accept: "application/json" } });
    assert.equal(inn.status, 200, `the granted account is readable when signed in: ${inn.body}`);

    // THE REFUSAL, unchanged. 401 with a JSON body is what the Cloudflare path produces for a missing
    // JWT (cf-access.mjs AuthError(401)), and it is what an API client and the SPA's own fetches get
    // here — one refusal shape whichever identity source the instance runs.
    const out = await req(port, "/portal/api/runs?account=aurora", { headers: { accept: "application/json" } });
    assert.equal(out.status, 401);
    assert.match(out.headers["content-type"], /application\/json/);
    assert.deepEqual(JSON.parse(out.body), { error: "not signed in" });

    // No Accept at all — a curl, a script, a health probe — gets the JSON too, never an HTML page.
    const bare = await req(port, "/portal/api/runs?account=aurora");
    assert.equal(bare.status, 401);
    assert.deepEqual(JSON.parse(bare.body), { error: "not signed in" });
  });
});

test("#769 a signed-out BROWSER is sent to the form rather than to a page about the form", async () => {
  await withLocalPortal(async ({ port }) => {
    for (const path of ["/portal", "/portal/clearances", "/portal/report/tmp1-something/"]) {
      const r = await req(port, path, { headers: { accept: "text/html,application/xhtml+xml" } });
      assert.equal(r.status, 302, `${path} should offer the door`);
      assert.equal(r.headers.location, "/portal/login");
      assert.deepEqual(r.cookies, [], "no cookie is issued to somebody who has not signed in");
    }
  });
});

test("#769 A CROSS-ACCOUNT PROBE STILL READS AS 404, NOT 403 — existence must not leak", async () => {
  // The property the whole issue is judged against: a third identity source must not have weakened the
  // authorization boundary. `zephyr` exists, this user is not granted it, and the answer must be
  // indistinguishable from an account that does not exist at all — the assertPrincipal rule
  // (portal-access.mjs), reached here through a local session instead of a Cloudflare JWT.
  await withLocalPortal(async ({ port, passphrase }) => {
    const cookie = cookieHeader((await postForm(port, "/portal/login", { passphrase })).cookies);
    for (const account of ["zephyr", "generic", "no-such-account"]) {
      const r = await req(port, `/portal/api/runs?account=${account}`, { headers: { cookie, accept: "application/json" } });
      assert.equal(r.status, 404, `?account=${account} must be a 404, never a 403 — a 403 says the account exists`);
      assert.deepEqual(JSON.parse(r.body), { error: "not_found" });
    }
    // The control: the granted account is not 404, so the assertions above are about the grant and not
    // about a route that refuses everything.
    assert.equal((await req(port, "/portal/api/runs?account=aurora", { headers: { cookie, accept: "application/json" } })).status, 200);
  });
});

test("#769 a session for another address, a tampered cookie and an expired one all fail closed", async () => {
  await withLocalPortal(async ({ port }) => {
    const ask = (cookie) => req(port, "/portal/api/runs?account=aurora", { headers: { cookie, accept: "application/json" } });

    // Correctly signed with THIS instance's secret, but naming somebody else. The handler checks the
    // session's address against the configured one, so a valid signature is not enough — otherwise the
    // token's own `sub` would decide who to resolve through the roster.
    const other = mintSession({ email: "someone@else.example", secret: SECRET });
    assert.equal((await ask(`portal_session=${other}`)).status, 401, "a session must name the one configured user");

    const mine = mintSession({ email: USER, secret: SECRET });
    assert.equal((await ask(`portal_session=${mine}`)).status, 200, "…and one that does, works");
    assert.equal((await ask(`portal_session=${mine.slice(0, -1)}x`)).status, 401, "a tampered signature fails");
    assert.equal((await ask(`portal_session=${mintSession({ email: USER, secret: "another-instance" })}`)).status, 401,
      "another instance's secret does not open this one");

    const stale = mintSession({ email: USER, secret: SECRET, ttlSec: 1, now: Date.now() - 60_000 });
    assert.equal((await ask(`portal_session=${stale}`)).status, 401, "an expired session is not a session");
  });
});

test("#769 a malformed cookie header is a refusal, never a 500", async () => {
  // The cookie header is attacker-controlled on every request, and `decodeURIComponent` throws on a
  // malformed escape. A 500 here would be a way to drive the portal's error rate from an
  // unauthenticated socket.
  await withLocalPortal(async ({ port, passphrase }) => {
    const good = cookieHeader((await postForm(port, "/portal/login", { passphrase })).cookies);
    for (const cookie of ["portal_session=%zz", "=;;;", "portal_session", "portal_session=", "a=b; portal_session=%E0%A4%A",
      `portal_session=${"x".repeat(5000)}`]) {
      const r = await req(port, "/portal/api/runs?account=aurora", { headers: { cookie, accept: "application/json" } });
      assert.equal(r.status, 401, `cookie ${JSON.stringify(cookie.slice(0, 40))} must refuse, not crash`);
    }
    // FIRST WINS on a duplicate name, which is what a browser sends for the most specific path — and
    // the shape cookie-shadowing attacks are written against if it were last-wins.
    assert.equal((await req(port, "/portal/api/runs?account=aurora",
      { headers: { cookie: `${good}; portal_session=forged`, accept: "application/json" } })).status, 200);
  });
});

// ── signing out ────────────────────────────────────────────────────────────────────────────────────

test("#769 POST /portal/logout clears the cookie and returns to the form", async () => {
  await withLocalPortal(async ({ port, passphrase }) => {
    const cookie = cookieHeader((await postForm(port, "/portal/login", { passphrase })).cookies);
    const out = await req(port, "/portal/logout", { method: "POST", headers: { cookie } });
    assert.equal(out.status, 302);
    assert.equal(out.headers.location, "/portal/login");
    assert.match(out.cookies[0], /^portal_session=;/, "cleared, not rotated");
    assert.match(out.cookies[0], /Max-Age=0/);
    assert.match(out.cookies[0], /HttpOnly/);
  });
});

test("#769 the form offers a way OUT when the caller is already signed in", async () => {
  // Otherwise POST /portal/logout is reachable only from a shell — the SPA has no sign-out control and
  // does not touch portal-ui.
  await withLocalPortal(async ({ port, passphrase }) => {
    const cookie = cookieHeader((await postForm(port, "/portal/login", { passphrase })).cookies);
    const r = await req(port, "/portal/login", { headers: { cookie, accept: "text/html" } });
    assert.equal(r.status, 200);
    assert.match(r.body, /action="\/portal\/logout"/, "a sign-out control the browser can actually press");
    assert.ok(!/type="password"/.test(r.body), "and no passphrase field for someone who is already in");
  });
});

// ── rate limiting ──────────────────────────────────────────────────────────────────────────────────

test("#769 login attempts are rate-limited on their own counter, not on the API budget", async () => {
  // The injected `limiter` is a 120/minute token bucket sized for status polling; 120 passphrase
  // guesses a minute is not a rate limit on a passphrase. This portal is built with limiter:null, so a
  // 429 here can only have come from the login route's own fixed window.
  await withLocalPortal(async ({ port, passphrase }) => {
    for (let i = 0; i < 3; i++)
      assert.equal((await postForm(port, "/portal/login", { passphrase: `guess-${i}` })).status, 401, `guess ${i} is answered`);
    const blocked = await postForm(port, "/portal/login", { passphrase });
    assert.equal(blocked.status, 429, "the window closes on the CORRECT passphrase too — counting only failures lets a caller reset it");
    assert.deepEqual(blocked.cookies, [], "and a blocked attempt issues nothing");
    assert.ok(blocked.body.includes("Too many attempts."));
    // Reading the form is not an attempt: locking somebody out of the page that explains the lockout
    // would be the wrong wall.
    assert.equal((await req(port, "/portal/login", { headers: { accept: "text/html" } })).status, 200);
  }, { attempts: makeAttemptLimiter({ max: 3, windowMs: 60_000 }) });
});

// ── the door on the other methods ──────────────────────────────────────────────────────────────────

test("#769 the sign-in paths answer only the methods they own", async () => {
  await withLocalPortal(async ({ port }) => {
    // GET /portal/logout and POST-less variants are not the SPA's to render: `login` and `logout` are
    // in SERVER_ROUTE_HEADS, so the static handler declines them and they stay server-owned.
    for (const [method, path] of [["GET", "/portal/logout"], ["DELETE", "/portal/login"], ["PUT", "/portal/logout"]]) {
      const r = await req(port, path, { method, headers: { accept: "text/html" } });
      assert.equal(r.status, 404, `${method} ${path}`);
    }
  });
});

// ── the constructor ────────────────────────────────────────────────────────────────────────────────

test("#769 makeHttpHandler REFUSES TO BUILD without an identity source", async () => {
  // It used to fall back to { email: "dev@local" } and admit every caller under one synthetic address.
  // A construction mistake must fail at construction, not at the first request that reads a customer's
  // runs.
  const service = makePortalService({
    poolRoot: mkdtempSync(join(tmpdir(), "portal-login-pool-")),
    workspaceRoot: mkdtempSync(join(tmpdir(), "portal-login-ws-")),
    secret: SECRET, staffDomains: [], grants: GRANTS, audit: () => {},
  });
  assert.throws(() => makeHttpHandler({ verify: null, limiter: null, service }),
    /identity source is required.*fail-closed/s,
    "no verify, no localAuth, no devIdentity ⇒ no handler");

  // The three that ARE identity sources each build one. `devIdentity` survives for in-process tests —
  // it must be PASSED, never obtainable by omission.
  for (const src of [{ verify: async () => ({ email: USER }) }, { devIdentity: { email: USER } },
    { localAuth: { email: USER, secret: SECRET, ttlSec: 60, credential: () => null, attempts: makeAttemptLimiter() } }])
    assert.equal(typeof makeHttpHandler({ limiter: null, service, ...src }), "function");
});

test("#769 an injected devIdentity still reaches the roster — the in-process seam the issue asks for", async () => {
  const service = makePortalService({
    poolRoot: mkdtempSync(join(tmpdir(), "portal-login-pool-")),
    workspaceRoot: mkdtempSync(join(tmpdir(), "portal-login-ws-")),
    secret: SECRET, staffDomains: [], grants: GRANTS, audit: () => {},
  });
  const srv = createServer(makeHttpHandler({ verify: null, limiter: null, service, devIdentity: { email: USER }, log: () => {} }));
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const port = srv.address().port;
    assert.equal((await req(port, "/portal/api/runs?account=aurora", { headers: { accept: "application/json" } })).status, 200);
    // …and it buys no more than a signed-in local user does: the boundary is the roster, not the door.
    assert.equal((await req(port, "/portal/api/runs?account=zephyr", { headers: { accept: "application/json" } })).status, 404);
    // With no localAuth there is no sign-in door either — an injected identity does not mount one.
    assert.equal((await req(port, "/portal/login", { headers: { accept: "text/html" } })).status, 404);
  } finally { await new Promise((r) => srv.close(r)); }
});

// ── — THE REFUSAL DECIDED BEFORE route IS EVER CALLED ───────────────────────────────────────
//
// This is the bug report's own measurement, turned into a test: an unauthenticated POST to
// /portal/admin/retired was answered 401 and the journal gained ZERO lines — 300 before, 300 after.
//
// It is the half a naive fix misses. Identity is resolved in makeHttpHandler and the refusal is thrown
// there, BEFORE service.route() runs, so wrapping route() closes every in-route 400/403/404 and leaves
// this one silent. It passes only if makePortalService also hands its sink out with its router.

test("#723 an UNAUTHENTICATED admin write is journalled — the 401 the issue measured", async () => {
  await withLocalPortal(async ({ port, audits }) => {
    assert.equal(audits.length, 0, "the journal starts empty, so the count below is this request's");

    const r = await req(port, "/portal/admin/retired", {
      method: "POST", headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ action: "retire", runIds: ["anything"] }),
    });
    assert.equal(r.status, 401, "the refusal itself is unchanged — this issue adds a record, not a door");

    assert.equal(audits.length, 1, "…and the journal gained a line, which is the whole issue (it gained none)");
    const row = audits[0];
    assert.equal(row.event, "request-refused");
    assert.equal(row.path, "/portal/admin/retired", "the write that was refused");
    assert.equal(row.method, "POST");
    assert.equal(row.status, 401, "with the status it answered");
    // A CODE-OWNED REASON, not the thrown message. `verify()` is a third-party JWT check on the
    // Cloudflare deployments and nothing stops it putting a claim, a subject or a token fragment in
    // its message — which /portal/admin/observed would then republish to every member of staff. The
    // status maps to a fixed sentence (DENIAL_REASON); the message never reaches the log.
    assert.equal(row.reason, "not authenticated", "the reason, from the closed set — never e.message");
    assert.ok(!("by" in row), "no address — nobody resolved, and a row naming 'null' would be a person");
  });
});

test("#723 the BROWSER form of the same refusal is journalled too, not just the API one", async () => {
  // A browser is bounced to the form with a 302 and never raises the AuthError the JSON client gets.
  // Same refusal, different rendering — and it would otherwise be the shape that still left no line.
  await withLocalPortal(async ({ port, audits }) => {
    const r = await req(port, "/portal/admin/retired", { method: "POST", headers: { accept: "text/html" } });
    assert.equal(r.status, 302);
    assert.equal(audits.length, 1, "a redirect to the login form is still a refused write");
    assert.equal(audits[0].status, 302);
    assert.equal(audits[0].path, "/portal/admin/retired", "and it names what was being asked for");
  });
});

test("#723 the refusal row never carries the session cookie or the passphrase", async () => {
  await withLocalPortal(async ({ port, passphrase, audits }) => {
    // A request carrying a bad session cookie AND a passphrase-shaped body, refused. Neither may appear.
    await req(port, "/portal/admin/retired?token=query-secret", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", cookie: `portal_session=forged-token-value` },
      body: JSON.stringify({ passphrase, secret: "sk-must-not-appear" }),
    });
    assert.equal(audits.length, 1);
    const dumped = JSON.stringify(audits[0]);
    assert.ok(!dumped.includes("forged-token-value"), "the session cookie is not in the row");
    assert.ok(!dumped.includes(passphrase), "nor the passphrase — a row that leaks one is worse than no row");
    assert.ok(!dumped.includes("sk-must-not-appear"), "nor anything else from the body");
    assert.ok(!dumped.includes("query-secret"), "and the query string is not journalled");
  });
});

test("#723 a SIGNED-IN caller's refusal is journalled WITH the address", async () => {
  // The counterpart to the anonymous case: past the door, refused inside route(), and the row names who.
  await withLocalPortal(async ({ port, passphrase, audits }) => {
    const login = await postForm(port, "/portal/login", { passphrase });
    const cookie = cookieHeader(login.cookies);
    audits.length = 0;

    // This user is granted `aurora` and is not staff, so a staff-only surface is 404 for them.
    const r = await req(port, "/portal/admin/retired", {
      method: "POST", headers: { accept: "application/json", "content-type": "application/json", cookie },
      body: JSON.stringify({ action: "retire", runIds: ["anything"] }),
    });
    assert.equal(r.status, 404);
    const row = audits.find((a) => a.event === "request-refused");
    assert.ok(row, "the refused write is journalled");
    assert.equal(row.by, USER, "and this time there IS an address, because identity resolved");
    assert.equal(row.status, 404);
  });
});

// 's Out of scope, at the DOOR. The same door, the same missing credential, the same status — and
// no row, because the path is not an admin write. The first cut of this change journalled here
// unconditionally, so every unauthenticated poll and every bounce to the login form filed a line: an
// access log for the whole portal, arriving through the entrance rather than the router.
test("#723 an unauthenticated NON-write is refused and journalled nowhere", async () => {
  await withLocalPortal(async ({ port, audits }) => {
    const r = await req(port, "/portal/api/runs", { method: "GET", headers: { accept: "application/json" } });
    assert.equal(r.status, 401, "the refusal is unchanged");
    assert.deepEqual(audits, [], "and it leaves no row — every unauthenticated poll would otherwise file one");
  });
});

test("#723 a browser bounced to the login form on a READ files no row either", async () => {
  await withLocalPortal(async ({ port, audits }) => {
    const r = await req(port, "/portal/api/runs", { method: "GET", headers: { accept: "text/html" } });
    assert.equal(r.status, 302, "still bounced to the form");
    assert.deepEqual(audits, [], "a redirect to a sign-in page is not an audit event");
  });
});
