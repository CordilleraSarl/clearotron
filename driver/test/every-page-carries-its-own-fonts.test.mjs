// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// @tier full — publishes the four demo reports and the pool indexes through the demo's own publisher
//
// EVERY PAGE CARRIES ITS OWN FONTS. A report used to link its typefaces from two font services, so opening
// one, from the portal, from disk or from an email, told those services the reader's address and that a
// report had been opened. Now every page this product writes carries its fonts inside itself.
//
// Pinned here on what the pages CONTAIN: every resource a page would fetch is data or a path of its own,
// and no font service is named anywhere. What a browser actually requests, and that the embedded faces
// are the ones it draws with, is scripts/report-offline-render-check.mjs, in a real browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FONT_FILES, TEXT_FACE, CODE_FACE, TEXT_FONT_STYLE, REPORT_FONT_STYLE } from "../../shared/brand-fonts.mjs";
import { spaCsp, reportCsp } from "../portal-static.mjs";
import { loginPage, denialPage } from "../portal-service.mjs";
import { writeProfilesPage } from "../publish/profiles-page.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FONT_HOSTS = /fontshare|googleapis|gstatic/i;

/** Every URL a page would FETCH to draw itself: stylesheets, scripts, images, frames, CSS url() and @import. Links a reader follows are not fetches. */
export function fetchedUrls(html) {
  const out = [];
  for (const m of html.matchAll(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) out.push(m[1]);
  for (const m of html.matchAll(/<(?:script|img|iframe|source|video|audio)\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) out.push(m[1]);
  for (const m of html.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) out.push(m[1]);
  for (const m of html.matchAll(/@import\s+(?:url\()?["']?([^"');\s]+)/gi)) out.push(m[1]);
  return out;
}
const offMachine = (u) => /^(?:https?:)?\/\//i.test(u.trim());

function publishDemo() {
  const pool = mkdtempSync(join(tmpdir(), "own-fonts-pool-"));
  const r = spawnSync(process.execPath, [join(ROOT, "bin", "example.mjs"), "--once", "--pool", pool], { encoding: "utf8", timeout: 240_000 });
  assert.equal(r.status, 0, `the demo publisher failed:\n${r.stderr || r.stdout}`);
  const pages = nonEmpty(readdirSync(pool, { recursive: true }).filter((n) => String(n).endsWith(".html")).map((n) => join(pool, String(n))),
    "the pages the demo published");
  return { pool, pages };
}

test("the fonts ship in the package, each file a woff2 with its licence text beside it", () => {
  for (const { family, file, licence } of FONT_FILES) {
    const bytes = readFileSync(join(ROOT, "shared", "fonts", file));
    assert.equal(bytes.subarray(0, 4).toString("latin1"), "wOF2", `${file} is not a woff2 file`);
    const text = readFileSync(join(ROOT, "shared", "fonts", licence), "utf8");
    assert.match(text, /SIL OPEN FONT LICENSE Version 1\.1/, `${licence} is not the OFL`);
    assert.match(readFileSync(join(ROOT, "shared", "fonts", "README.md"), "utf8"), new RegExp(file.replace(".", "\\.")), `the provenance note does not name ${file}`);
    assert.ok(family === TEXT_FACE || family === CODE_FACE);
  }
});

test("each embedded face is data, and carries its whole licence text right before it", () => {
  const faces = [...REPORT_FONT_STYLE.matchAll(/@font-face\{font-family:'([^']+)'[^}]*\}/g)];
  assert.deepEqual(faces.map((m) => m[1]), [TEXT_FACE, CODE_FACE], "a report does not carry exactly the two faces");
  for (const [rule] of faces) assert.match(rule, /src:url\(data:font\/woff2;base64,[A-Za-z0-9+/=]{1000,}\) format\('woff2'\)/);
  for (const { family, licence } of FONT_FILES) {
    const text = readFileSync(join(ROOT, "shared", "fonts", licence), "utf8").trim();
    const at = REPORT_FONT_STYLE.indexOf(text);
    assert.ok(at >= 0, `${family}'s licence text is not carried in full`);
    assert.ok(REPORT_FONT_STYLE.indexOf(`font-family:'${family}'`, at) > at, `${family}'s licence does not come before its face`);
  }
  assert.equal([...TEXT_FONT_STYLE.matchAll(/@font-face/g)].length, 1, "a page that sets no code carries the code face too");
  assert.match(TEXT_FONT_STYLE, new RegExp(`font-family:'${TEXT_FACE}'`));
});

test("every published report and pool index fetches nothing from another machine, and names no font service", () => {
  const { pool, pages } = publishDemo();
  try {
    const reports = pages.filter((p) => p.endsWith("report.html"));
    // THE POPULATION FIRST: four products, and both renderers among them (the knockout has its own).
    assert.equal(reports.length, 4, `the demo published ${reports.length} reports, not the four products`);
    assert.ok(pages.length > reports.length, "the demo published no index page, so the index arm measures nothing");
    for (const page of pages) {
      const html = readFileSync(page, "utf8");
      const name = page.slice(pool.length + 1);
      const away = fetchedUrls(html).filter(offMachine);
      assert.deepEqual(away, [], `${name} fetches from another machine`);
      assert.doesNotMatch(html, FONT_HOSTS, `${name} still names a font service`);
      if (page.endsWith("report.html")) assert.ok(html.includes(REPORT_FONT_STYLE), `${name} does not carry both faces`);
      else assert.ok(html.includes(TEXT_FONT_STYLE), `${name} does not carry the text face`);
    }
  } finally { rmSync(pool, { recursive: true, force: true }); }
});

test("the portal's own pages and the profile page carry the text face and fetch nothing elsewhere", () => {
  const pool = mkdtempSync(join(tmpdir(), "own-fonts-profiles-"));
  try {
    const pages = {
      "sign-in page": loginPage({ email: "one@example.com" }),
      "refusal page": denialPage(401, "not signed in"),
      "profile page": readFileSync(writeProfilesPage({ poolDir: pool }), "utf8"),
    };
    for (const [name, html] of Object.entries(pages)) {
      assert.ok(html.includes(TEXT_FONT_STYLE), `the ${name} does not carry the text face`);
      assert.deepEqual(fetchedUrls(html).filter(offMachine), [], `the ${name} fetches from another machine`);
      assert.doesNotMatch(html, FONT_HOSTS, `the ${name} still names a font service`);
    }
  } finally { rmSync(pool, { recursive: true, force: true }); }
});

test("the portal document and its stylesheets name no font service; the face comes from the package's file", () => {
  const doc = readFileSync(join(ROOT, "portal-ui", "index.html"), "utf8");
  assert.deepEqual(fetchedUrls(doc).filter(offMachine), [], "the portal document fetches from another machine");
  assert.doesNotMatch(doc, FONT_HOSTS);
  const fonts = readFileSync(join(ROOT, "portal-ui", "src", "fonts.css"), "utf8");
  assert.match(fonts, new RegExp(`font-family: '${TEXT_FACE}'`));
  assert.match(fonts, /url\('\.\.\/\.\.\/shared\/fonts\/plus-jakarta-sans\.woff2'\)/, "the portal does not take the package's own font file");
  assert.match(readFileSync(join(ROOT, "portal-ui", "src", "main.tsx"), "utf8"), /import '\.\/fonts\.css'/, "the font stylesheet is never loaded");
});

test("neither content policy lets a page reach a font service, and a report's fonts are allowed only as data", () => {
  for (const [name, policy] of [["portal", spaCsp()], ["report", reportCsp()]]) {
    assert.doesNotMatch(policy, /https?:/, `the ${name} policy still names a host`);
  }
  assert.match(reportCsp(), /(^|; )font-src data:(;|$)/, "a report's embedded fonts are not allowed, or something else is");
  assert.match(spaCsp(), /(^|; )font-src 'self' data:(;|$)/);
});
