// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// portal-static.mjs — serving the committed UI bundle.
//
// The three properties worth testing are the three that fail silently in production if they regress:
// a missing bundle must be LOUD, the handler must not swallow API paths, and the two CSPs must stay two.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { makeStaticHandler, spaCsp, reportCsp } from "../portal-static.mjs";
import { SERVER_ROUTE_HEADS } from "../portal-service.mjs";

const at = (p) => fileURLToPath(new URL(p, import.meta.url));
import { PRE_PAINT_SCRIPT } from "../../shared/portal-tokens.mjs";

// A minimal stand-in for a ServerResponse that records what was written.
const fakeRes = () => {
  const r = { status: null, headers: null, body: null, ended: false };
  r.writeHead = (s, h) => { r.status = s; r.headers = h; };
  r.end = (b) => { r.body = b; r.ended = true; };
  return r;
};
const GET = { method: "GET" };

const withDist = (fn, { build = true } = {}) => {
  const root = mkdtempSync(join(tmpdir(), "portal-static-"));
  const dist = join(root, "dist");
  if (build) {
    mkdirSync(join(dist, "assets"), { recursive: true });
    // The document NAMES its hashed asset, as a real vite build's does — that reference is the thing
    // that goes stale when a deploy replaces the bundle underneath a running process.
    writeFileSync(join(dist, "index.html"),
      `<!doctype html><script>${PRE_PAINT_SCRIPT}</script>`
      + `<script type="module" src="/portal/assets/index-abc123.js"></script><div id="root"></div>`);
    writeFileSync(join(dist, "assets", "index-abc123.js"), "console.log('app')");
    writeFileSync(join(dist, "assets", "index-abc123.css"), ":root{}");
  }
  try {
    fn(makeStaticHandler({ distDir: dist }), dist);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

// ──: the deny-list cannot fall behind the router ───────────────────────────────────────────────
//
// A route registered on the authenticated service but missing from SERVER_ROUTE_HEADS is served as the
// SPA shell instead — and its authorization check never runs. No failure, no log line, no test; the page
// simply renders. `admin` was missed exactly that way.
//
// The list now lives beside the router (portal-service.mjs) and the static handler imports it, so there
// is one declaration rather than two that can disagree. This closes the remaining gap: the declaration
// itself is pinned to the router's OWN SOURCE, in both directions.
//
// Source-text rather than importing a route table, because there is no route table: routes are
// registered imperatively as an if-chain on `parts[1]` inside a closure. That is the repo's established
// idiom for exactly this shape — no-client-identifiers.test.mjs reads driver/phase0.mjs the same way —
// and it means the assertion needs no booted portal.
test("#306: SERVER_ROUTE_HEADS is a BIJECTION with the routes the service actually registers", () => {
  const src = readFileSync(at("../portal-service.mjs"), "utf8");

  // Every `parts[1] === "<head>"` in the router, which is how every route under /portal is dispatched.
  const registered = new Set([...src.matchAll(/parts\[1\] === "([a-z][a-z0-9-]*)"/g)].map((m) => m[1]));
  assert.ok(registered.size >= 3, `the route extraction looks broken: found ${[...registered].join(", ") || "nothing"}`);

  // `health`, and since `login`/`logout`, are answered in makeHttpHandler BEFORE identity and
  // never reach route() — so deriving from the if-chain alone would report them as stale entries.
  // Unioned in from their own source, so this stays a derivation rather than an exception someone typed.
  //
  // — ALL of them, not just the first. This was `.exec`, which returns one match: the moment a
  // second pre-identity route was added, the guard silently stopped checking it and kept passing. A
  // single-match read of a list is the absence-as-pass shape this whole test exists to close, one level
  // up from where it was closing it.
  const preIdentity = [...src.matchAll(/url\.pathname === "\/portal\/([a-z][a-z0-9-]*)"/g)].map((m) => m[1]);
  assert.ok(preIdentity.length, "no pre-identity route in makeHttpHandler could be found — this guard needs updating with them");
  assert.ok(preIdentity.includes("health"), "the liveness route is the one that has always been here; if it has moved, so has this derivation");
  for (const p of preIdentity) registered.add(p);

  assert.deepEqual(
    [...registered].filter((h) => !SERVER_ROUTE_HEADS.includes(h)).sort(),
    [],
    "a route is registered that the static handler will swallow — the caller gets the app shell and its authorization check never runs",
  );
  assert.deepEqual(
    SERVER_ROUTE_HEADS.filter((h) => !registered.has(h)).sort(),
    [],
    "an entry names a route the service no longer registers — the list has rotted into a list of prefixes that were true once",
  );
});

test("#306: an UNKNOWN path still gets the SPA — this closes the registered set, not the internet", () => {
  // The issue is explicit that client deep links must survive: the fix is "every registered server route
  // is covered", never "unknown paths are refused". A closed-by-default over arbitrary paths would break
  // every client-routed URL the SPA owns.
  withDist((handle) => {
    for (const path of ["/portal/clearances", "/portal/result/tmp1-x", "/portal/brand/searches", "/portal/not-a-real-screen"]) {
      const res = fakeRes();
      assert.equal(handle(GET, res, path), true, `${path} must still be answered by the SPA`);
      assert.equal(res.status, 200);
    }
  });
});

test("serves the SPA document for /portal and for any client-routed path below it", () => {
  withDist((handle) => {
    // The two-segment result path is 's route — ONE name out of a knockout, opened in the shell.
    // A deep link to it has to be answered by the SPA or the route works only when you are already
    // inside the app: pasted, bookmarked or mailed, it would 404 while client-side navigation to the
    // same URL worked, which is the hardest kind of broken to reproduce.
    for (const path of ["/portal", "/portal/", "/portal/clearances", "/portal/brand/projects",
      "/portal/result/xyz", "/portal/result/tmp4-aurora-batch/ironwhisk"]) {
      const res = fakeRes();
      assert.equal(handle(GET, res, path), true, `${path} should be served by the SPA handler`);
      assert.equal(res.status, 200);
      assert.match(String(res.body), /id="root"/, `${path} got the app shell`);
      assert.equal(res.headers["cache-control"], "no-store", "the document names hashed asset URLs — never cache it");
    }
  });
});

test("declines the paths the authenticated router owns", () => {
  withDist((handle) => {
    // If the static handler answered these, an API call would receive the app shell and fail as a JSON
    // parse error somewhere far away from the actual routing mistake.
    //
    // — DERIVED, NOT LISTED. This was a hardcoded list of paths: a THIRD hand-maintained copy of
    // the router's prefixes, one level up from the one the fix removed. A new route added to the router
    // and to SERVER_ROUTE_HEADS but not to this list would leave the very behaviour this test exists to
    // check unchecked — which is the same bug in a new place, and the reason `admin` was missed the
    // first time (its own comment, below, records that).
    for (const path of SERVER_ROUTE_HEADS.flatMap((head) => [`/portal/${head}`, `/portal/${head}/something`])) {
      const res = fakeRes();
      assert.equal(handle(GET, res, path), false, `${path} must fall through to the router`);
      assert.equal(res.ended, false, "declining must not write a response");
    }
    // and anything outside /portal entirely
    assert.equal(handle(GET, fakeRes(), "/other"), false);
  });
});

test("assets are content-hashed, so they are served immutable", () => {
  withDist((handle) => {
    const res = fakeRes();
    assert.equal(handle(GET, res, "/portal/assets/index-abc123.js"), true);
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /text\/javascript/);
    assert.match(res.headers["cache-control"], /immutable/);
  });
});

test("a missing asset is 404, and traversal cannot escape the bundle", () => {
  withDist((handle) => {
    for (const path of [
      "/portal/assets/nope.js",
      "/portal/assets/../../../../etc/passwd",
      "/portal/assets/..%2f..%2fetc%2fpasswd",
      // The one a bare prefix check lets through: normalize() collapses this to "assets.bak/x.js",
      // which never leaves distDir and so survives normalize, but IS outside the assets directory —
      // and "…/dist/assets.bak/x" does start with "…/dist/assets". The separator is what stops it.
      "/portal/assets/../assets.bak/secret.js",
    ]) {
      const res = fakeRes();
      assert.equal(handle(GET, res, path), true);
      assert.equal(res.status, 404, `${path} must not resolve`);
    }
  });
});

test("a replaced bundle is picked up without a restart — a memoized document names dead assets", () => {
  withDist((handle, dist) => {
    const first = fakeRes();
    handle(GET, first, "/portal");
    assert.match(String(first.body), /index-abc123/, "the document names the current hashed asset");

    // A deploy replaces dist/. If the document were memoized forever, the process would keep serving an
    // HTML file naming index-abc123.js — which no longer exists — so the page 200s and then fails to
    // boot: a 404 on every chunk and nothing anywhere that says why. That turns a missed restart from
    // "serves the previous version" into "serves nothing that works".
    writeFileSync(join(dist, "index.html"), '<!doctype html><script src="/portal/assets/index-def456.js"></script><div id="root"></div>');
    const t = Date.now() / 1000 + 5;   // make the mtime change unambiguous rather than racing the clock
    utimesSync(join(dist, "index.html"), t, t);

    const second = fakeRes();
    handle(GET, second, "/portal");
    assert.match(String(second.body), /index-def456/, "the replaced document is served");
    assert.doesNotMatch(String(second.body), /index-abc123/);
  });
});

test("a bundle that disappears stops being served from memory", () => {
  withDist((handle, dist) => {
    handle(GET, fakeRes(), "/portal");          // prime the cache
    rmSync(join(dist, "index.html"));
    const res = fakeRes();
    handle(GET, res, "/portal");
    assert.equal(res.status, 503, "a ghost of a deleted document is worse than an honest 503");
    assert.equal(handle.present(), false);
  });
});

test("a missing bundle is a loud 503 that names the cause — never a blank page", () => {
  withDist((handle) => {
    assert.equal(handle.present(), false);
    const res = fakeRes();
    assert.equal(handle(GET, res, "/portal"), true);
    assert.equal(res.status, 503);
    // THE DIAGNOSIS DEPENDS ON WHO IS READING, which is what this arm used to get wrong. It asserted the
    // body says the bundle is "committed to git" and therefore that a missing one CANNOT be a missing
    // build step. True of a deployment cut from a tree that commits it; exactly backwards for someone who
    // has just cloned a source repository, where building is the normal first step — and since the owner
    // ruled portal-ui/dist withheld from the public cut on 2026-09-03, that reader now exists. So the
    // message must name BOTH cases and let the reader tell which they are.
    assert.match(String(res.body), /fresh clone/i,
      "the body does not name the case where the bundle was simply never built — the first reader of the "
      + "public repository hits exactly that and would be sent hunting a broken checkout");
    assert.match(String(res.body), /incomplete checkout|did not carry the build/i,
      "…nor the deployment case, which is the one that was there before and is still real");
    // Repo-relative, never the absolute server path — this body reaches a client's browser.
    assert.doesNotMatch(String(res.body), /\/home\/|\/srv\//, "no absolute server path in a client-visible body");
    // Repo-relative, never the absolute server path: this body reaches a client's browser.
    assert.doesNotMatch(String(res.body), /\/home\/|\/srv\//, 'no absolute server path in a client-visible body');
    assert.match(String(res.body), /npm run build -w portal-ui/);
    assert.match(String(res.body), /API is unaffected/);
  }, { build: false });
});

test("the pre-paint script is admitted by hash, so 'unsafe-inline' never appears for scripts", () => {
  const sha = createHash("sha256").update(PRE_PAINT_SCRIPT).digest("base64");
  const csp = spaCsp();
  assert.match(csp, new RegExp(`script-src [^;]*'sha256-${sha.replace(/[+/=]/g, "\\$&")}'`));
  const scriptSrc = csp.split("; ").find((d) => d.startsWith("script-src"));
  assert.doesNotMatch(scriptSrc, /unsafe-inline/, "the SPA must not open inline script — the one inline script is hashed");
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /connect-src 'self'/, "the app talks only to its own origin");
});

test("the two policies differ in the one way that matters: framing", () => {
  // A single policy cannot serve both. frame-ancestors 'none' on a report would make the browser refuse
  // to frame it, which kills the entire legacy-report path — every run delivered to date.
  assert.match(spaCsp(), /frame-ancestors 'none'/, "nothing may frame the portal");
  assert.match(reportCsp(), /frame-ancestors 'self'/, "the Result screen frames the report");
  assert.match(spaCsp(), /frame-src 'self'/, "…and the portal must be allowed to");
  // The frozen renderer emits a self-contained file with inline script and style; that is what the
  // null-origin sandbox contains, not the policy.
  assert.match(reportCsp(), /script-src [^;]*'unsafe-inline'/);
});

test("both policies forbid the ambient capabilities neither surface uses", () => {
  for (const [name, csp] of [["spa", spaCsp()], ["report", reportCsp()]]) {
    assert.match(csp, /base-uri 'none'/, `${name}: a <base> tag could re-point every relative URL`);
    assert.match(csp, /form-action 'none'/, `${name}: neither surface posts a form anywhere`);
    assert.match(csp, /object-src|default-src 'none'/, `${name}: plugins are covered by default-src`);
  }
});

test("admin paths: a browser navigation gets the app shell, an API client keeps the JSON route", () => {
  // Both are true of /portal/admin/access: it is a staff SPA screen AND a staff JSON route. Deciding
  // by Accept (the rule portal-service's AuthError branch already uses) serves each caller what it
  // asked for. Before this, refreshing People & access painted a raw JSON dump of the access view.
  withDist((handle) => {
    const BROWSER = { method: "GET", headers: { accept: "text/html,application/xhtml+xml,*/*;q=0.8" } };
    const SPA_FETCH = { method: "GET", headers: { accept: "application/json" } };
    for (const path of ["/portal/admin", "/portal/admin/access", "/portal/admin/config"]) {
      const res = fakeRes();
      assert.equal(handle(BROWSER, res, path), true, `${path} refreshed in a browser must render the app`);
      assert.match(String(res.body), /id="root"/, `${path} got the app shell, not JSON`);
      // …while the SPA's own fetch still reaches the authenticated route, where staffOnly is enforced.
      const api = fakeRes();
      assert.equal(handle(SPA_FETCH, api, path), false, `${path} as JSON must fall through to the router`);
      assert.equal(api.ended, false, "declining must not write a response");
    }
    // The other server-owned prefixes are NOT dual-purpose: they stay server-only whatever Accept says,
    // or a browser hitting /portal/api/me would be handed the shell instead of an authorization check.
    for (const path of ["/portal/api/me", "/portal/report/run-x/", "/portal/health"]) {
      const res = fakeRes();
      assert.equal(handle(BROWSER, res, path), false, `${path} must never be answered by the static handler`);
    }
  });
});
