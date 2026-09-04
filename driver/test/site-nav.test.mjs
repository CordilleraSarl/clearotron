// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// site-nav.test.mjs — the shared floating cross-page nav: active highlighting, existence-gating of main links
// (no dead links), and client-view links via explicit keys (index) or a customer/ scan (the status page).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { siteNav, siteFab, NAV_CSS } from "../../shared/site-nav.mjs";

function pool(files = []) {
  const p = mkdtempSync(join(tmpdir(), "nav-"));
  for (const f of files) { const fp = join(p, f); mkdirSync(join(fp, ".."), { recursive: true }); writeFileSync(fp, "x"); }
  return p;
}

test("NAV_CSS exports the sticky bar + the toggle + floating fab-stack styling", () => {
  assert.match(NAV_CSS, /\.sitenav\{[^}]*position:sticky/);
  assert.match(NAV_CSS, /\.theme-toggle\{/, "THEME_BTN_CSS rides NAV_CSS so every nav surface can style the toggle");
  assert.match(NAV_CSS, /\.fab-stack\{[^}]*position:fixed/, "CHROME_CSS rides NAV_CSS so the bottom-right settings stack is styled everywhere");
});

test("siteNav appends a bottom-right fab-stack (not in the bar); theme always rides it, anon:false drops the privacy toggle", () => {
  const nav = siteNav(pool(["index.html"]), "index");
  assert.match(nav, /<\/nav><div class="fab-stack">/, "the settings stack rides AFTER </nav>, not inside the bar");
  assert.ok(nav.indexOf('fab-stack') > nav.indexOf('navmenu'), "settings sit outside/after the menu");
  assert.match(nav, /class="theme-toggle"/, "theme toggle present");
  const noAnon = siteNav(pool(["index.html"]), "report", null, "../", { anon: false });
  assert.match(noAnon, /class="theme-toggle"/, "theme toggle renders even when the privacy toggle is omitted");
  assert.doesNotMatch(noAnon, /class="anon-toggle/, "anon:false drops the privacy toggle (reports ship no overlay JS)");
});

test("siteFab: a standalone stack for surfaces with no staff nav (client index, client report export)", () => {
  assert.match(siteFab(), /^<div class="fab-stack">/);
  assert.match(siteFab(), /class="theme-toggle"/, "theme toggle always present");
  assert.doesNotMatch(siteFab({ anon: false }), /class="anon-toggle/, "anon:false ⇒ theme-only fab");
});

test("labels Map: the Clients dropdown speaks display names, keyed anon attrs keep the raw key", () => {
  const nav = siteNav(pool(["index.html"]), "index", ["aurora"], "", { labels: new Map([["aurora", "Aurora Interactive"]]) });
  assert.match(nav, /href="customer\/aurora\/"><span data-anon="client"[^>]*>Aurora Interactive<\/span><\/a>/);
  // no labels passed (the status page caller) ⇒ raw keys, unchanged
  const bare = siteNav(pool(["index.html"]), "index", ["aurora"]);
  assert.match(bare, />aurora<\/span><\/a>/);
});

test("active page is highlighted; the others link only when their file exists", () => {
  const p = pool(["index.html", "status.html"]); // no profiles.html
  const nav = siteNav(p, "status");
  assert.match(nav, /<a href="status.html" class="active">Run status<\/a>/);
  assert.match(nav, /<a href="index.html">Clearance reports<\/a>/);
  assert.doesNotMatch(nav, /href="profiles.html"/, "missing page = no dead link");
});

test("the active page links even if its own file is absent (always shown + highlighted)", () => {
  const nav = siteNav(pool([]), "profiles");
  assert.match(nav, /<a href="profiles.html" class="active">Profiles<\/a>/);
});

// retired the quality subsystem, so the Quality hub and its Feedback console are gone. Both directions
// are asserted: the entry cannot come back, AND a hub page left on disk by a pre- deploy cannot resurrect a link to
// it. Same rule the triage.html stub was already held to.
test("Quality and Feedback are NOT nav entries (quality subsystem retired, #265)", () => {
  const p = pool(["index.html", "status.html", "quality.html", "feedback.html"]);   // stale pages present on disk
  const nav = siteNav(p, "status");
  assert.doesNotMatch(nav, /quality\.html/, "a stale hub page must not resurrect a nav entry");
  assert.doesNotMatch(nav, /triage\.html/, "the stub must not resurrect a nav entry");
  assert.doesNotMatch(nav, />Quality</);
  assert.doesNotMatch(nav, />Feedback</);
});

test("client views: explicit keys (index path) render sorted .cli links", () => {
  const nav = siteNav(pool(["index.html"]), "index", ["generic", "aurora"]);
  const gi = nav.indexOf('href="customer/generic/"'), ai = nav.indexOf('href="customer/aurora/"');
  assert.ok(gi > 0 && ai > 0 && ai < gi, "sorted: aurora before generic");
  assert.match(nav, /<details class="climenu"><summary>Clients/);   // client list collapses into a dropdown
  assert.match(nav, /<a class="cli"[^>]*href="customer\/aurora\/"><span[^>]*data-anon="client"[^>]*>aurora<\/span><\/a>/);   // demo-anon: aliased text + neutralisable link
});

test("client views: scanned from customer/<key>/index.html when no keys passed", () => {
  const p = pool(["index.html", "customer/acme/index.html", "customer/zephyr/index.html"]);
  const nav = siteNav(p, "status");
  assert.match(nav, /href="customer\/acme\/"/);
  assert.match(nav, /href="customer\/zephyr\/"/);
});

test("linkPrefix rebases hrefs for a one-level-down surface (the report's ../); existence-gating stays poolDir-absolute", () => {
  const p = pool(["index.html", "status.html", "profiles.html", "customer/zephyr/index.html"]);
  const nav = siteNav(p, "report", null, "../");   // a report at <pool>/<runId>/report.html
  assert.match(nav, /<a href="\.\.\/index.html">Clearance reports<\/a>/);
  assert.match(nav, /<a href="\.\.\/status.html">Run status<\/a>/);
  assert.match(nav, /<a href="\.\.\/profiles.html">Profiles<\/a>/);
  assert.match(nav, /<a class="cli"[^>]*href="\.\.\/customer\/zephyr\/"><span[^>]*>zephyr<\/span><\/a>/);   // demo-anon wraps the client text
  assert.doesNotMatch(nav, /class="active"/);       // 'report' matches no main page ⇒ none highlighted
});