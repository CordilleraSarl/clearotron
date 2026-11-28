// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A CONFLICT NUMBER OPENS ITS CARD BESIDE THE CLAIM (owner, 2026-11-25). The numbers after a reason in the verdict jumped
// down the page to the card, and the reader had to find their way back. Where the window leaves room, activating one
// opens the card in a panel beside the text; where it does not at the column's full width, the column narrows to the
// report's own narrow layout beside the panel; below that the number jumps as before. The pressed number keeps its
// height on screen through either reflow, and in the portal's frame the portal scrolls for it.
//
// Checked in headless Chrome on the public Global preliminary demo at 2,400, 1,820, 1,440 and 1,180 px (the panel opens,
// the number moves 0 px on opening and on shutting, no sideways scroll, no overlap) and at 1,100, 1,000 and 900 px (it
// does not open), standalone and inside a frame whose stand-in parent honours scrollBy. These arms hold the pieces.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { withColumnQueries, INSET } from "../publish/column-queries.mjs";
import { REPORT_BASE } from "../publish/page-shell.mjs";
import { parseReport } from "../publish/parse.mjs";
import { renderHtml } from "../publish/render.mjs";
import { parseFrameworkManifest } from "../framework.mjs";
import { prepareReportForEmbed } from "../portal-report.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(HERE, "..", "publish", "templates", "report.css"), "utf8");

test("each width rule gains a column twin that matches nothing until a column opts in", () => {
  const out = withColumnQueries("a{x:1}@media(max-width:700px){.p .q,.r{y:2}}@media screen and (max-width:640px){.s{z:3}}@media (min-width:760px){.t{w:4}}@media print{.u{v:5}}");
  assert.match(out, /@media\(max-width:700px\)\{\.p \.q,\.r\{y:2\}\}@container repcol \(max-width:648px\)\{:where\(html\.rep-narrow,\.cpanel\) \.p \.q,:where\(html\.rep-narrow,\.cpanel\) \.r\{y:2\}\}/,
    "a max-width rule lost its window form, or its twin is not scoped and offset by the column's padding");
  assert.match(out, /@media screen\{@container repcol \(max-width:588px\)\{:where\(html\.rep-narrow,\.cpanel\) \.s\{z:3\}\}\}/, "a screen-only rule's twin reaches paper");
  assert.match(out, /@media \(min-width:760px\)\{:where\(html:not\(\.rep-narrow\)\) \.t\{w:4\}\}@container repcol \(min-width:708px\)/,
    "a min-width rule still applies to a narrowed column, or has no twin");
  assert.match(out, /@media print\{\.u\{v:5\}\}/, "a print rule was changed");
  assert.equal(INSET, 52, "the column's padding changed; the twins' offset must follow it");
  assert.throws(() => withColumnQueries("@media(max-width:700px){@supports(x:y){.a{b:c}}}"), /nested at-rule/);
});

test("the report's stylesheet carries a twin for every width rule, and the narrowed column and the panel are screen-only containers", () => {
  const widthRules = (CSS.match(/@media\s*(?:screen\s+and\s+)?\(\s*(?:max|min)-width\s*:\s*\d+px\s*\)\s*\{/g) ?? []).length;
  assert.ok(widthRules >= 10, "the stylesheet has fewer width rules than expected, so the count below says little");
  assert.equal((REPORT_BASE.match(/@container repcol/g) ?? []).length, widthRules, "a width rule has no column twin");
  assert.match(CSS, /@media screen\{html\.rep-narrow \.wrap\{container:repcol\/inline-size;/, "the narrowed column can reach paper, or is no container");
  assert.match(CSS, /\.cpanel\{position:absolute;[^}]*container:repcol\/inline-size;/, "the panel is not a container, so its card keeps the window's layout");
  assert.match(CSS, /@media print\{\.cpanel\{display:none!important\}\}/, "the panel prints");
});

const RUN = join(HERE, "..", "..", "demo", "global-preliminary-search", "run");
const FRAMEWORK = parseFrameworkManifest(JSON.parse(readFileSync(join(RUN, "_driver", "framework.json"), "utf8")));
const REPORT = (() => {
  const dir = mkdtempSync(join(tmpdir(), "conflict-panel-"));
  try {
    writeFileSync(join(dir, "r.report.md"), ["---", "type: clearance-clearance", "matter: conflict-panel", "title: OSTREVIN",
      "overall_label: MEDIUM", "overall_badge: l3", "classes: 9", "jurisdiction: European Union", "run: 2026-11-26", "---", ""].join("\n"));
    return parseReport(join(dir, "r.report.md"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
})();
const html = renderHtml(REPORT, [{ ordinal: 1, mark: "SKARVEL", band: "Moderate", disposition: "adversarial", net: "A sentence.", owner: { name: "Owner", registrations: [] } }],
  [], { runId: "conflict-panel", framework: FRAMEWORK });

test("the page carries the panel's words from the catalogue, and its script opens only from the verdict's numbers", () => {
  assert.match(html, /<template id="cpanel-words" data-name="Conflict \{n\}" data-close="Close"><button type="button" class="copy-fi no-print"/,
    "the panel's two names or the Copy link a compact card gains are not on the page");
  const js = html.match(/\(function\(\)\{var wrap=document\.querySelector\('\.wrap'\),words=[^\n]*(?:\n[^\n]*){0,40}?\}\)\(\);/)?.[0] ?? "";
  assert.ok(js, "the conflict panel's script is missing");
  assert.match(js, /closest\('\.fa-ords a\[href\^="#c"\]'\)[\s\S]*?\},true\);/, "the panel opens from links other than the verdict's numbers, or not before the jump");
  assert.match(js, /e\.preventDefault\(\);e\.stopImmediatePropagation\(\);/, "the jump to the card still runs when the panel opens");
  assert.match(js, /e\.key==='Escape'&&panel&&!e\.defaultPrevented\)shut\(\)/, "Escape shuts the panel on the press that hid a chart dot's label");
  assert.match(js, /c\.removeAttribute\('id'\);c\.setAttribute\('data-card-of','c'\+n\)/, "the panel's card duplicates the card's id");
  assert.match(js, /new CustomEvent\('rep-shift',\{detail:\{dy:dy\},cancelable:true\}\)/, "the reflow does not ask to keep the number's place");
  assert.match(js, /a\.focus\(\{preventScroll:true\}\)/, "focus does not return to the number that opened the panel");
  // It opens beside the number the reader activated and in view (design, 2026-11-28), not at the top of the block that
  // holds the number: on a long verdict that put the whole card above the visible page.
  assert.doesNotMatch(js, /closest\('\.panel'\)/, "the panel is still placed by the block that holds the number");
  assert.match(js, /panel\.style\.top=Math\.round\(at\(opener\)\+panel\._off\)\+'px'/, "the panel's top is not kept relative to the activated number");
  assert.match(js, /if\(top\+h>vb\)top=vb-h;if\(top<vt\)top=vt;/, "the panel is not kept inside the visible band, heading first");
  assert.match(js, /addEventListener\('rep-view',/, "the page does not hear the portal's visible band");
  assert.match(js, /querySelector\('\.rep-stickyhead'\)/, "standalone, the report's own pinned header is not taken off the visible band");
  // An Ask AI press on the panel's copy is handed to the card's own button, which every portal's bridge reads by its id,
  // the bridge of a portal rolled back to an earlier version included.
  assert.match(js, /panel\.addEventListener\('click',function\(e\)\{var b=e\.target\.closest&&e\.target\.closest\('\.ask-fi'\),of=b&&b\.closest\('\[data-card-of\]'\),o=of&&document\.getElementById\(of\.getAttribute\('data-card-of'\)\),ob=o&&o\.querySelector\('\.ask-fi'\);if\(!ob\)return;e\.stopPropagation\(\);ob\.click\(\);\},true\);/,
    "an Ask AI press on the panel's card is not handed to the card's own button");
});

test("in the portal the bridge scrolls the portal for the page, re-posts its height, and reads a panel card's original id", () => {
  const served = prepareReportForEmbed(html);
  const page = typeof served === "string" ? served : served.html;
  assert.match(page, /addEventListener\('rep-shift',function\(e\)\{\s*if\(!framed\)return;\s*e\.preventDefault\(\);\s*try\{parent\.postMessage\(\{source:TAG,type:'scrollBy',dy:/,
    "the page's shift is not handed to the portal");
  assert.match(page, /addEventListener\('rep-reflow',function\(\)\{schedule\(\);\}\)/, "a reflow does not re-post the height and the section tops");
  assert.match(page, /var cid=card\?\(card\.id\|\|card\.getAttribute\('data-card-of'\)\|\|''\):'';/, "Ask AI on the panel's card loses its finding");
  assert.match(page, /if\(d\.command==='view'\)\{[\s\S]*?vb>vt\)\s*document\.dispatchEvent\(new CustomEvent\('rep-view',\{detail:\{top:vt,bottom:vb\}\}\)\);/,
    "the portal's visible band is not handed to the page, or is handed on unchecked");
});

// AT THE BOARD'S WIDTH THE COLUMN DOES NOT MOVE (design, 2026-11-26). Where the window holds the full column and the panel,
// a clearance page keeps that room on the right from the start, so opening the panel moves nothing sideways. Measured in
// headless Chrome on the Global preliminary demo at 1,820 and 1,700 px: the column's left edge and width (16 px, 1,120 px)
// and the citation's screen position are the same before opening, while open and after shutting.
test("where the window holds the column and the panel, a clearance page reserves the panel's room before it opens", () => {
  assert.match(CSS, /@media screen and \(min-width:1682px\)\{body:has\(> #cpanel-words\) > \.wrap\{margin-left:16px;margin-right:auto\}\}/,
    "the wide layout does not reserve the panel's room, so opening it would move the column");
  assert.equal(16 + 1120 + 30 + 500 + 16, 1682, "the threshold no longer matches the column, the gap, the panel and the edges");
});
