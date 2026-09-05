// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Serving the portal bundle.
//
// Two things here are load-bearing and neither is obvious from the code alone.
//
// 1. THIS RUNS ABOVE THE RATE LIMITER. portal-service limits 120 requests/minute per email, shared
//    between everything. A loaded page is one document plus a handful of chunks, and the app polls run
//    status on top of that — so assets and polling compete for the same budget. A 429 on a JS chunk does
//    not produce an error page: it produces a half-mounted React app with no error path, because the
//    browser has no way to tell the app that a module failed to load. Assets are cheap, static and
//    identical for every user; they are not what a limiter is for.
//
// 2. A MISSING BUNDLE IS A LOUD 503, NEVER A BLANK PAGE. This used to say portal-ui/dist is committed
//    to git "precisely so it cannot go silently missing". It is not tracked at all, and never has been
//    on the public tree — so the bundle CAN go missing, by the most ordinary route there is: a source
//    checkout nobody has built yet. That makes the 503 more load-bearing than the old reasoning
//    claimed, not less. The API keeps answering 200 the whole time, so a curl of /portal/health during
//    a deploy tells you nothing about whether the UI is there. `ui` on /portal/health does.

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join, normalize, extname, sep } from "node:path";
import { PRE_PAINT_SCRIPT } from "../shared/portal-tokens.mjs";
import { SERVER_ROUTE_HEADS } from "./portal-service.mjs";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".map": "application/json",
};

/**
 * The SPA's Content-Security-Policy.
 *
 * The single inline script — the pre-paint theme setter, which MUST be inline because a deferred script
 * paints the wrong theme first — is admitted by hash, computed from the exact constant index.html is
 * checked against. So `'unsafe-inline'` never appears for scripts, and the XSS class the old POC page
 * carried (innerHTML string concatenation from mark names and recipe labels) cannot be reintroduced by a
 * future inline handler: it would simply not run.
 *
 * `style-src` does allow inline. React writes `style=` attributes for anything computed, and there is no
 * hashing story for attributes. That is a real but much smaller surface: a style attribute cannot execute.
 *
 * fontshare is allowed for stylesheets and font files ONLY — not script, not connect. Self-hosting Satoshi
 * would remove even that; see the note in index.html.
 */
export function spaCsp() {
  const sha = createHash("sha256").update(PRE_PAINT_SCRIPT).digest("base64");
  return [
    "default-src 'none'",
    `script-src 'self' 'sha256-${sha}'`,
    "style-src 'self' 'unsafe-inline' https://api.fontshare.com",
    // TWO hosts, and the difference is not cosmetic: Fontshare serves the @font-face STYLESHEET from
    // api.fontshare.com but the woff2/woff files themselves from cdn.fontshare.com. Naming only the
    // api host blocks every weight, and the failure is silent — the page renders in the fallback face
    // and nothing errors anywhere a test would see. Verified against the live CSS.
    "font-src https://cdn.fontshare.com https://api.fontshare.com data:",
    "img-src 'self' data:",
    "connect-src 'self'",
    // the Result screen embeds a delivered report from this same origin
    "frame-src 'self'",
    // nothing may frame the portal itself
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

/**
 * The CSP for a delivered report served at /portal/report/<runId>/.
 *
 * It cannot be the same policy, and the reason is structural rather than a matter of taste:
 * `frame-ancestors 'none'` would make the browser refuse to frame the report, which would break the
 * entire legacy path — every run delivered before the native renderer exists.
 *
 * The frozen renderer genuinely needs inline script and style: it ships a self-contained HTML file with
 * its export handler, its disclosure toggles and its whole stylesheet inline, by design, because that file
 * is also emailed and opened from disk. Rewriting it to satisfy a CSP would mean unfreezing it.
 *
 * What contains that is not the policy, it is the sandbox: the iframe is `sandbox="allow-scripts …"`
 * WITHOUT `allow-same-origin`, so the document has a null origin and cannot read the portal's
 * localStorage, DOM, cookies or API however much inline script it runs.
 */
/**
 * The policy for a plain document this server renders itself — the by-hand setup page.
 *
 * NOT `reportCsp()`, and the difference is the point. That one permits inline script and three font
 * hosts because a delivered report is a frozen self-contained artefact that genuinely needs them.
 * This page is escaped text in a `<pre>`: it runs nothing, fetches nothing, and frames nothing, so it
 * gets a policy that says exactly that. Borrowing the looser one because it was already there would
 * hand a new surface permissions nobody weighed for it.
 */
export function docCsp() {
  return ["default-src 'none'", "style-src 'unsafe-inline'", "frame-ancestors 'none'", "base-uri 'none'"].join("; ");
}

export function reportCsp() {
  return [
    "default-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    // The reports themselves are frozen artefacts, and they load TWO font families from THREE hosts:
    // Satoshi from Fontshare (stylesheet on api.*, files on cdn.*) and Fira Code from Google Fonts
    // (stylesheet on fonts.googleapis.com, files on fonts.gstatic.com). Verified against real delivered
    // reports. A policy naming fewer hosts than the document uses does not fail loudly — the report
    // simply renders in a fallback face inside the frame while looking correct opened standalone,
    // which is the kind of difference nobody attributes to a CSP.
    "style-src 'self' 'unsafe-inline' https://api.fontshare.com https://fonts.googleapis.com",
    "font-src https://cdn.fontshare.com https://api.fontshare.com https://fonts.gstatic.com data:",
    "img-src 'self' data:",
    "connect-src 'none'",
    // framed by the portal, and by nothing else
    "frame-ancestors 'self'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

/**
 * A static handler for the committed bundle.
 *
 * Returns `true` if it answered the request, `false` to let the authenticated service handle it. It
 * claims only what it owns: the SPA document and /portal/assets/*. /portal/api/* and /portal/report/*
 * always fall through — a static handler that swallowed those would serve the app shell in place of an
 * API response, which fails as a confusing parse error rather than as a routing error.
 */
export function makeStaticHandler({ distDir, buildCommand = "npm run build -w portal-ui" }) {
  const indexPath = join(distDir, "index.html");

  // Cached, but keyed on mtime rather than held forever.
  //
  // "It cannot change under a running process" is exactly the assumption that breaks: deploy is a git
  // pull followed by a restart, and if the restart is missed, delayed, or the process outlives the pull
  // for even a moment, a permanently-memoized document keeps naming the OLD content-hashed asset URLs.
  // Those files are gone, so the page loads and then fails to boot — 200 on the document, 404 on every
  // chunk, and no error path that says so. Caching the document forever converts a missed restart from
  // "serves the previous version" into "serves nothing that works".
  //
  // A stat per page load is not a cost worth reasoning about; the ASSETS are the hot path and they are
  // immutable-cached in the browser.
  let cached = null;
  let cachedMtime = 0;
  const index = () => {
    let mtime;
    try {
      mtime = statSync(indexPath).mtimeMs;
    } catch {
      cached = null;
      return null;   // the bundle went away — fall through to the 503, do not serve a ghost
    }
    if (cached && mtime === cachedMtime) return cached;
    cached = readFileSync(indexPath, "utf8");
    cachedMtime = mtime;
    return cached;
  };

  const missing503 = (res) => {
    const msg =
      // Repo-relative, never `distDir`. That is an absolute server filesystem path, and this body is
      // returned to any authenticated browser — including a client's. The path tells the reader
      // nothing they can act on that "portal-ui/dist" does not.
      `The portal UI bundle is not present at portal-ui/dist.\n\n`
      + `Build it:\n    ${buildCommand}\n\n`
      // THE ADVICE USED TO ASSERT THE BUNDLE IS COMMITTED, and said this could not be a missing build
      // step. That is true of a deployment cut from a tree that commits it, and exactly BACKWARDS for
      // someone who cloned a source repository where it is not committed — the first reader to hit
      // this would have been told to go looking for a broken checkout instead of running one command.
      // So it now names both, and the reader knows which they are.
      + `On a fresh clone of the source repository the bundle is not committed, and building it is the\n`
      + `normal first step. On a deployment that was previously serving, it means an incomplete checkout\n`
      + `or a deploy that did not carry the build — check the working tree.\n\n`
      + `The API is unaffected and still answering; only the UI is missing.\n`;
    res.writeHead(503, {
      "content-type": "text/plain; charset=utf-8",
      "content-length": Buffer.byteLength(msg),
      "cache-control": "no-store",
    });
    res.end(msg);
  };

  const handle = (req, res, pathname) => {
    if (req.method !== "GET" && req.method !== "HEAD") return false;
    if (!pathname.startsWith("/portal")) return false;

    const rest = pathname.slice("/portal".length).replace(/^\/+/, "");
    // Owned by the authenticated service, always. A DENY-list over a catch-all, which is the wrong shape
    // but the necessary one — the SPA legitimately owns arbitrary client-routed paths, so it cannot be
    // an allow-list.
    //
    // — IT IS NO LONGER RESTATED HERE. This was a second hand-maintained copy of the router's own
    // prefixes, and the two could disagree silently: a route missing from it got the app shell where it
    // expected JSON, and its authorization check never ran at all. No error, no log line, no test.
    // `admin` was missed exactly that way. The declaration now lives beside the router, which is the
    // half that cannot lie about what it serves, and portal-static.test.mjs pins it to the router's own
    // source in both directions.
    const head = rest.split("/")[0] ?? "";
    // `admin` is owned by BOTH: /portal/admin/access and /portal/admin/config are real JSON routes AND
    // real SPA screens at the same address. Decide by what the caller asked for, the same rule the
    // AuthError branch in portal-service already uses: the SPA's own fetches send
    // `accept: application/json` and keep the JSON; a browser navigation (refresh, bookmark, shared
    // link) sends `text/html` and gets the app shell, which then renders the screen client-side.
    // Without this, staff refreshing People & access were shown a raw JSON dump of the access view.
    if (head === "admin" && String(req.headers?.accept ?? "").includes("text/html")) {
      // fall through to the SPA document below
    } else if (SERVER_ROUTE_HEADS.includes(head)) return false;

    if (rest.startsWith("assets/")) {
      // normalize() collapses ".." before the join, but it does NOT contain the path on its own:
      // normalize("assets/../assets.bak/x") is "assets.bak/x", which stays inside distDir and escapes
      // the assets directory. The containment check is therefore load-bearing, not belt-and-braces —
      // and it needs the trailing separator, or a sibling directory named "assets.bak" or "assetsX"
      // satisfies a bare prefix match.
      const file = join(distDir, normalize(rest));
      if (!file.startsWith(join(distDir, "assets") + sep)) {
        res.writeHead(404, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "not_found" })), true;
      }
      let body;
      try {
        if (!statSync(file).isFile()) throw new Error("not a file");
        body = readFileSync(file);
      } catch {
        res.writeHead(404, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "not_found" })), true;
      }
      res.writeHead(200, {
        "content-type": TYPES[extname(file)] ?? "application/octet-stream",
        "content-length": body.length,
        // Asset filenames carry a content hash, so a changed file is a changed URL. Immutable is safe
        // and it is what keeps a page load off the rate limiter on every subsequent visit.
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
      });
      return res.end(req.method === "HEAD" ? undefined : body), true;
    }

    // Everything else under /portal is the SPA document — client-side routing owns the path.
    const html = index();
    if (html == null) return missing503(res), true;
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-length": Buffer.byteLength(html),
      // The document is never cached: it names the hashed asset URLs, and a stale document points at
      // assets that no longer exist.
      "cache-control": "no-store",
      "content-security-policy": spaCsp(),
      "x-content-type-options": "nosniff",
      "referrer-policy": "same-origin",
    });
    return res.end(req.method === "HEAD" ? undefined : html), true;
  };

  handle.present = () => index() != null;
  return handle;
}
