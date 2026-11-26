// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A DOT ON THE CONFLICT LANDSCAPE SAYS WHICH CONFLICT IT IS (owner, 2026-11-25). A dot's only label was its number, so
// to learn whose mark it was the reader followed the link or matched the number against the list beside the chart.
// Hovering a dot, or focusing it from the keyboard, now shows the fields the rights-holders list prints for that
// conflict, and the link's name carries the same fields for a screen reader. The panel's placement, the pointer resting
// on it and Escape were checked in headless Chrome on the public demo; these arms hold the markup and the fields.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseReport } from "../publish/parse.mjs";
import { renderHtml } from "../publish/render.mjs";
import { parseFrameworkManifest } from "../framework.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUN = join(HERE, "..", "..", "demo", "global-preliminary-search", "run");
const FRAMEWORK = parseFrameworkManifest(JSON.parse(readFileSync(join(RUN, "_driver", "framework.json"), "utf8")));
const REPORT = (() => {
  const dir = mkdtempSync(join(tmpdir(), "chart-dot-"));
  try {
    writeFileSync(join(dir, "r.report.md"), ["---", "type: clearance-clearance", "matter: chart-dot", "title: OSTREVIN",
      "overall_label: MEDIUM", "overall_badge: l3", "classes: 9", "jurisdiction: European Union", "run: 2026-11-26", "---", ""].join("\n"));
    return parseReport(join(dir, "r.report.md"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
})();
const FINDINGS = [
  { ordinal: 1, mark: "SKARVEL", band: "Moderate", disposition: "adversarial", net: "A sentence.", quadrant: { x: 0.9, y: 0.9 },
    owner: { name: "Brannock Tools Ltd", registrations: [{ uri: "/mark/gb/1", jurisdiction: "GB" }] }, source: { source_type: "register-vendor" } },
  { ordinal: 2, mark: "SKARVELL", band: "Manageable", disposition: "adversarial", net: "A sentence.", quadrant: { x: 0.4, y: 0.6 },
    owner: { name: "SKARVELL", registrations: [] }, source: { source_type: "common-law-marketplace" } },
];
const html = renderHtml(REPORT, FINDINGS, [], { runId: "chart-dot", framework: FRAMEWORK });
const dotLink = (n) => html.match(new RegExp(`<a href="#c${n}"([^>]*)>`))?.[1] ?? null;
const attr = (attrs, name) => attrs.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? null;

test("a dot's link carries the rights-holders list's fields, and its name is those fields", () => {
  const one = dotLink(1);
  assert.ok(one, "the chart draws no link for conflict 1");
  assert.equal(attr(one, "data-tip-mark"), "SKARVEL");
  assert.equal(attr(one, "data-tip-band"), "Moderate");
  assert.equal(attr(one, "data-tip-sub"), "Brannock Tools Ltd · United Kingdom", "the second line is not the holder and the country");
  assert.equal(attr(one, "aria-label"), "1 · SKARVEL · Moderate · Brannock Tools Ltd · United Kingdom");
  // The key row prints the same holder and band for the same conflict.
  const row = html.match(/<a class="keyrow" href="#c1">([\s\S]*?)<\/a>/)?.[1] ?? "";
  assert.match(row, /Brannock Tools Ltd/);
  assert.match(row, /<span class="kc [a-z]+">Moderate<\/span>/);
});

test("a conflict whose holder is its own mark shows what the list shows: no holder, and its group", () => {
  const two = dotLink(2);
  assert.ok(two, "the chart draws no link for conflict 2");
  assert.equal(attr(two, "data-tip-sub"), "Common-law / marketplace", "a holder that is the mark itself was repeated, or the group is missing");
});

test("one panel sits in the chart's card, hidden, out of print and away from assistive technology; each dot has its ring", () => {
  const panel = html.match(/<div class="qtip no-print" aria-hidden="true" hidden style="([^"]*)">/);
  assert.ok(panel, "the chart's card carries no hidden panel for the dots");
  assert.match(panel[1], /--qt-med-bg:#[0-9A-Fa-f]{6}/, "the panel's light colours are not handed in");
  assert.equal((html.match(/class="qtip/g) ?? []).length, 1, "more than one panel");
  assert.match(html, /<a href="#c1"[^>]*><title>#1<\/title><circle class="qring"/, "the dot keeps no number tooltip for a page with scripts off, or has no ring");
});

test("the page script shows the panel on the pointer and on keyboard focus, keeps it while the pointer rests on it, and Escape hides it", () => {
  const js = html.match(/\(function\(\)\{var land=document\.querySelector\('\.panel\.land'\)[^\n]*(?:\n[^\n]*){0,40}?window\.addEventListener\('beforeprint',hide\);\}\)\(\);/)?.[0] ?? "";
  assert.ok(js, "the dot panel's script is missing");
  assert.match(js, /pointerenter',function\(e\)\{if\(e\.pointerType==='mouse'\)show\(a\);/, "a touch would open the panel instead of following the link");
  assert.match(js, /addEventListener\('focus',function\(\)\{if\(keyFocus\(a\)\)show\(a\);/);
  assert.match(js, /tip\.addEventListener\('pointerenter',function\(\)\{clearTimeout\(timer\);\}\)/, "the panel closes as the pointer crosses onto it");
  assert.match(js, /e\.key==='Escape'&&!tip\.hidden\)hide\(\)/, "Escape does not hide the panel");
  assert.doesNotMatch(js, /\.focus\(\)|\.blur\(\)/, "the script moves focus, so Escape would not leave it on the dot");
});
