// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// What a browser may do with a signed-in JSON response is stated by the server, not left to the browser.
//
// WHAT THIS ARM IS FOR. `send()` in portal-service.mjs used to write `content-type` and `content-length`
// and nothing else: no `Cache-Control`, no `Vary`, no validator, on every signed-in data route including
// the ones carrying another company's material — the access view, people, the roster, run lists, config.
//
// THE DEFECT IS THE SILENCE, NOT A DEMONSTRATED LEAK. With no `Last-Modified` to work from, a heuristic
// cache may well store nothing, and this file does not claim otherwise: what a given browser does is a
// browser-by-browser question and no assertion here answers it. What is wrong is that the answer was the
// browser's to make. For a response behind a session, `no-store` is the statement and it costs one line.
//
// AND THE ARGUMENT WAS ALREADY MADE IN THAT FILE, FOR ONE ROUTE. `/portal/api/connect-key` has always
// sent `no-store` because "a credential sitting in a proxy or a disk cache is the 'outlives the moment'
// failure ... arriving by a route the page cannot see". It was applied to the one response holding a
// token and not to the class. An access list is not a credential and has exactly that property.
//
// `Vary: Accept` IS THE OTHER HALF AND IT IS NOT ABOUT PRIVACY. `/portal/admin/*` is one address served
// two ways — the app fetches JSON there, a browser navigation gets the app document, and
// portal-static.mjs decides on `Accept` above this router. Nothing told a cache those were different
// responses, so a stored JSON body could answer a later navigation and render raw data in a window with
// this server never asked. That is the mechanism proposed for the report of a reader landing on a data
// address and seeing JSON.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { makeHttpHandler } from "../portal-service.mjs";

/** Drive one request against a real handler on a real socket, and read the headers a client would get. */
async function drive({ route, path = "/portal/api/anything", accept = "application/json" }) {
  const srv = createServer(makeHttpHandler({
    verify: null, limiter: null, log: () => {},
    devIdentity: { email: "dev@local" },
    service: { route },
  }));
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const res = await fetch(`http://127.0.0.1:${srv.address().port}${path}`, { headers: { accept }, redirect: "manual" });
    return {
      status: res.status,
      cache: res.headers.get("cache-control"),
      vary: res.headers.get("vary"),
      pragma: res.headers.get("pragma"),
      type: res.headers.get("content-type"),
    };
  } finally { srv.close(); }
}

test("EVERY JSON response says it may not be stored, and that it varies on what was asked for", async () => {
  // Driven across the status classes rather than on one happy path: an error body carries data too — a
  // refusal names the setting that refused, and a 404 on a run route confirms the run exists to ask
  // about. A rule applied only to 200s would leave those unstated.
  const shapes = [
    { name: "an ordinary read", route: async () => ({ status: 200, json: { people: [{ email: "someone@example.test" }] } }) },
    { name: "a refusal", route: async () => ({ status: 403, json: { error: "forbidden" } }) },
    { name: "a not-found", route: async () => ({ status: 404, json: { error: "not_found" } }) },
    { name: "a server fault", route: async () => ({ status: 500, json: { error: "internal" } }) },
  ];
  assert.ok(shapes.length >= 4, "the population this arm speaks for is too small to mean anything");

  for (const { name, route } of shapes) {
    const r = await drive({ route });
    assert.match(r.type ?? "", /application\/json/, `${name}: not a JSON response, so this arm measured the wrong thing`);
    assert.equal(r.cache, "no-store", `${name}: what a browser does with this is still the browser's decision`);
    assert.equal(r.vary, "accept", `${name}: a cache cannot tell this from the app document served at the same address`);
  }
});

test("A ROUTE'S OWN HEADERS STILL WIN — the default must not relax a stricter route", async () => {
  // THE FAILURE THIS CATCHES IS THIS CHANGE MAKING THINGS WORSE WHILE READING AS AN IMPROVEMENT.
  // `/portal/api/connect-key` sends a credential and sets `no-cache, must-revalidate, private` and the
  // HTTP/1.0 `pragma` beside `no-store`. Spread the default AFTER a route's own headers and every one of
  // those is flattened to a weaker single word, on the one response in the portal that carries a token.
  //
  // Driven with the real header set rather than a stand-in, so the arm fails for the actual value.
  const STRICT = { "cache-control": "no-store, no-cache, must-revalidate, private", "pragma": "no-cache" };
  const r = await drive({ route: async () => ({ status: 200, json: { address: "https://x/mcp", key: "…" }, headers: STRICT }) });
  assert.equal(r.cache, STRICT["cache-control"], "the credential route's stricter policy was overwritten by the default");
  assert.equal(r.pragma, "no-cache", "the HTTP/1.0 half went with it");
  assert.equal(r.vary, "accept", "a route setting cache-control should still get the Vary it did not set");
});

test("the credential route still declares its own stricter policy", async () => {
  // The arm above proves a route's headers SURVIVE the writer. This proves the route still SENDS them:
  // together they close the gap, because either one alone goes green when the other half is deleted.
  // Read from the source rather than driven, because reaching that route needs a whole service.
  const src = readFileSync(fileURLToPath(new URL("../portal-service.mjs", import.meta.url)), "utf8");
  const i = src.indexOf("/portal/api/connect-key");
  assert.ok(i > 0, "the credential route is gone from this file — this arm is now measuring nothing");
  const region = src.slice(i, i + 6000);
  assert.match(region, /"cache-control":\s*"no-store, no-cache, must-revalidate, private"/,
    "the credential route stopped setting its own policy and now takes the writer's weaker default");
  assert.match(region, /"pragma":\s*"no-cache"/, "…and its HTTP/1.0 half");
});

test("THE RULE LIVES AT THE WRITER, so a route added tomorrow cannot miss it", async () => {
  // A per-route rule is one a new route forgets, silently, and nothing reports a header that was never
  // written. Asserted on the source because the property is about WHERE the rule is, which no single
  // driven response can distinguish from four routes that each happen to set it.
  const src = readFileSync(fileURLToPath(new URL("../portal-service.mjs", import.meta.url)), "utf8");
  const writer = /const send = \(res, status, obj, extra = \{\}\) => \{[\s\S]*?\n  \};/.exec(src)?.[0] ?? "";
  assert.ok(writer, "the JSON writer is not where this arm expects it — re-point it before trusting a green");
  assert.match(writer, /"cache-control": "no-store"/, "the writer does not state a caching policy");
  assert.match(writer, /"vary": "accept"/, "the writer does not state what the response varies on");
  // The spread has to come LAST or the arm above is the one that fails, but say it here too: this is the
  // line whose ORDER carries the property, and order is invisible to a test that only reads values.
  assert.match(writer, /"vary": "accept",\s*\n\s*\.\.\.extra,/,
    "a route's own headers no longer come after the defaults, so the stricter routes are being flattened");
});
