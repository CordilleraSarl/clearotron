// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// home-link.test.mjs — the floating "← All reports" pill. Emitted natively by renderHtml (opts.homeHref) AND
// injectable into already-rendered reports; both use the same inline-styled markup so they look identical.
import { test } from "node:test";
import assert from "node:assert/strict";
import { homeButton } from "../publish/render.mjs";

test("homeButton: inline-styled anchor to the given href; '' when no href (back-compat)", () => {
  assert.equal(homeButton(""), "");
  assert.equal(homeButton(null), "");
  const h = homeButton("../index.html");
  assert.match(h, /<a href="\.\.\/index\.html" class="homebtn no-print"/);
  assert.match(h, /position:fixed/);              // self-contained — no dependency on the page CSS
  assert.match(h, /← All reports/);
});

test("homeButton: href is attribute-escaped", () => {
  assert.match(homeButton('../customer/a"b/index.html'), /a&quot;b/);
});

// Mirror pool-admin's injectHome so the retrofit contract is covered without spawning the CLI.
function injectHome(html, href) {
  if (html.includes('class="homebtn')) return null;
  const i = html.indexOf('<body');
  if (i < 0) return null;
  const close = html.indexOf('>', i);
  if (close < 0) return null;
  return html.slice(0, close + 1) + '\n' + homeButton(href) + html.slice(close + 1);
}

test("injectHome: inserts the pill right after <body>, idempotent, skips when no body", () => {
  const page = `<html><head></head><body class="x">\n<div class="topbar">hi</div></body></html>`;
  const out = injectHome(page, "../index.html");
  assert.match(out, /<body class="x">\n<a href="\.\.\/index\.html" class="homebtn/);
  assert.equal(injectHome(out, "../index.html"), null, "second pass is a no-op (already present)");
  assert.equal(injectHome("<html>no body here</html>", "../index.html"), null, "no <body> ⇒ skip");
});
