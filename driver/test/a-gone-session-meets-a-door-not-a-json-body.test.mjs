// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ──, criterion 1 — MEASURED, AND IT ALREADY HOLDS ────────────────────────────
//
// The issue expects `GET /portal` to answer a browser with `{"error":"not signed in"}`, leaving the
// reader on a shell served from cache. Driven against a real socket on both identity sources, it does
// not: a navigation is content-negotiated at the door and the document is served `no-store`, so there is
// no cached shell to render either. The 401 row in 's table was `curl`, which sends no
// `text/html` — the SPA's own fetches get that same JSON, correctly, and the mid-visit half of 2113 is
// what answers those.
//
// SO THIS IS A GUARD WHERE A FIX WAS EXPECTED, and that is the point of writing it down. The behaviour
// is one `String(req.headers.accept).includes("text/html")` on each of two paths, either of which could
// be deleted by someone tidying a duplicate without meeting the reader it protects. An absence is a
// finding; a behaviour nothing measures is the same absence one edit later.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { makeHttpHandler } from "../portal-service.mjs";

const BROWSER = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";

/** Drive one request against a real handler on a real socket, and hand back what a client would see. */
async function drive(handlerOpts, path, accept) {
  const srv = createServer(makeHttpHandler({ service: { route: async () => ({ status: 200, json: { ok: true } }) },
    authHeader: "x-test", ...handlerOpts }));
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const res = await fetch(`http://127.0.0.1:${srv.address().port}${path}`,
      { headers: accept ? { accept } : {}, redirect: "manual" });
    return { status: res.status, type: res.headers.get("content-type"), location: res.headers.get("location"),
      body: await res.text() };
  } finally { srv.close(); }
}

// The local sign-in: no session cookie, which is the reader whose session has gone.
const LOCAL = { localAuth: { email: "clearotron@localhost", secret: "s".repeat(32), ttlSec: 3600,
  attempts: { take: () => true }, credential: () => null } };
// The Cloudflare edge: the verifier refuses, which is the same reader on the other deployment.
class AuthError extends Error { constructor(status, message) { super(message); this.name = "AuthError"; this.status = status; } }
const CLOUDFLARE = { verify: async () => { throw new AuthError(401, "not signed in"); } };

test("2113 a browser with no session gets a door it can use, on either identity source", async () => {
  const local = await drive(LOCAL, "/portal", BROWSER);
  assert.equal(local.status, 302, "the local door answered a browser navigation with something other than a redirect");
  assert.equal(local.location, "/portal/login", "the redirect does not land on the sign-in form");

  const cf = await drive(CLOUDFLARE, "/portal", BROWSER);
  assert.equal(cf.status, 401);
  assert.match(cf.type ?? "", /text\/html/, "the Cloudflare door answered a browser with a body it cannot read");
  assert.match(cf.body, /not signed in/i, "the door page does not say what happened");
  // THE WAY OUT is the whole reason the page exists rather than a JSON dump: a reader signed in on the
  // wrong address is otherwise stuck, because the edge holds the session.
  // — F47. This asserted on `access/logout`, which was Cloudflare's endpoint
  // and an IMPLEMENTATION DETAIL of the way out, not the way out itself. An arm that asserts on
  // access/logout was never really about sign-out: it passed for exactly as long as that detail held,
  // and went red when the product started resolving the route per auth mode — which is the behaviour
  // this arm's own message asks for. The link is what matters; where it resolves to is the portal's.
  assert.match(cf.body, /href="\/portal\/sign-out"/, "the door page offers no way to sign in as someone else");
});

test("2179-F47 the sign-out route the door page offers is DRIVEN, in both modes", async () => {
  // THE ARM ABOVE PROVES THE LINK IS OFFERED AND NOTHING ABOUT WHERE IT GOES. That gap shipped a 500:
  // the fronted branch called a `redirect` helper declared inside the local-auth block, so the route
  // threw ReferenceError and answered {"error":"internal"} — worse than the dead link it replaced,
  // because a dead link looks like a dead link and a 500 looks like the server broke. Reading the page
  // for an href is shape; this drives the route.
  const fronted = await drive(CLOUDFLARE, "/portal/sign-out", BROWSER);
  assert.equal(fronted.status, 302,
    `the fronted sign-out must redirect, not answer ${fronted.status}: ${fronted.body}`);
  assert.equal(fronted.location, "/cdn-cgi/access/logout",
    "with no local provider the session is Cloudflare's, and its endpoint is the only thing that ends it");

  // And local sign-in ends the session that actually exists, rather than being sent to an edge that is
  // not there — which is the whole finding.
  const local = await drive(LOCAL, "/portal/sign-out", BROWSER);
  assert.equal(local.status, 302);
  assert.equal(local.location, "/portal/login",
    "on local sign-in the session is the portal's own and signing out must land on its form");
});

test("2113 a caller that asked for JSON still gets JSON, so the SPA's own fetches are untouched", async () => {
  for (const [name, opts] of [["local", LOCAL], ["cloudflare", CLOUDFLARE]]) {
    const spa = await drive(opts, "/portal/api/me", "application/json");
    assert.equal(spa.status, 401, `${name}: the SPA's fetch stopped getting a 401 it can decode`);
    assert.match(spa.type ?? "", /application\/json/, `${name}: an HTML page reached a fetch() caller`);
    assert.deepEqual(JSON.parse(spa.body), { error: "not signed in" },
      `${name}: the refusal shape the browser contract decodes to signedOut has changed`);
  }
});

test("2113 the top-level route is negotiated too, not only the API under it", async () => {
  // /portal is the address a person TYPES, and it is the one the issue names. A rule applied to the API
  // routes and not to the document route is the state the issue describes.
  const typed = await drive(LOCAL, "/portal", BROWSER);
  const scripted = await drive(LOCAL, "/portal", "application/json");
  assert.notEqual(typed.status, scripted.status,
    "the same address answers a browser and a script identically, so one of them is being told the wrong thing");
  assert.equal(scripted.status, 401);
  assert.equal(typed.status, 302);
});
