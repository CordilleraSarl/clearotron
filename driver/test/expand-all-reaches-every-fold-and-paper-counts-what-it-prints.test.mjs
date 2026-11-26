// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Three small report faults, seen on the public demos replayed through the publisher on 2026-11-25:
//   1. "Expand all" named five kinds of fold on a clearance and one on a Knockout, and left the rest alone: six kinds on
//      the clearance demo (the register records' term lists and translation notes among them), 20 of the Knockout
//      demo's 21 folds. It now reads every fold, so a kind added later cannot fall behind it.
//   2. The rights-holders key's common-law row ran "Unregistered use" under its count at 1,180 px. Its header may now
//      take a second line, so the label keeps its words and the count stays clear.
//   3. On paper, the folded list's header counted every card in it while the export printed only the ticked ones. The
//      export now writes the printed count into the header, in the catalogue's own words, and puts the screen's back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseReport } from "../publish/parse.mjs";
import { renderHtml } from "../publish/render.mjs";
import { parseFrameworkManifest } from "../framework.mjs";
import { REPORT_PAGE as R } from "../publish/strings.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUN = join(HERE, "..", "..", "demo", "global-preliminary-search", "run");
const FRAMEWORK = parseFrameworkManifest(JSON.parse(readFileSync(join(RUN, "_driver", "framework.json"), "utf8")));
const REPORT = (() => {
  const dir = mkdtempSync(join(tmpdir(), "expand-all-"));
  try {
    writeFileSync(join(dir, "r.report.md"), ["---", "type: clearance-clearance", "matter: expand-all", "title: OSTREVIN",
      "overall_label: MEDIUM", "overall_badge: l3", "classes: 9", "jurisdiction: European Union", "run: 2026-11-26", "---", ""].join("\n"));
    return parseReport(join(dir, "r.report.md"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
})();
const conflict = (ordinal, band, extra = {}) => ({ ordinal, mark: `SKARVEL ${ordinal}`, band, disposition: "adversarial", composite: 3,
  net: "A sentence.", owner: { name: `Owner ${ordinal}`, registrations: [] }, ...extra });
const render = (findings) => renderHtml(REPORT, findings, [], { runId: "expand-all", framework: FRAMEWORK });

/** The page's own openAll, run against a document that records what it was asked for and answers with every fold. */
function openAllAsks(html) {
  const src = html.match(/function openAll\(v\)\{.*?\}\);\}/)?.[0];
  assert.ok(src, "the page defines no openAll, so Expand all does nothing");
  const asked = [];
  const folds = [{ open: false }, { open: true }];
  const document = { querySelectorAll: (sel) => { asked.push(sel); return folds; } };
  new Function("document", `${src}; openAll(true);`)(document);
  return { asked, opened: folds.every((d) => d.open === true) };
}

test("a clearance's Expand all reads every fold on the page, not a list of kinds", () => {
  const { asked, opened } = openAllAsks(render([conflict(1, "Moderate"), conflict(2, "Manageable")]));
  assert.deepEqual(asked, ["details"], "Expand all names kinds of fold, so a kind it does not name stays folded");
  assert.ok(opened);
});

test("a Knockout's Expand all reads every fold on the page", () => {
  const src = readFileSync(join(HERE, "..", "publish", "render-knockout.mjs"), "utf8");
  const fn = src.match(/function openAll\(v\)\{.*?\}\);\}/)?.[0];
  assert.ok(fn, "the Knockout page defines no openAll");
  const asked = [];
  const document = { querySelectorAll: (sel) => { asked.push(sel); return []; } };
  new Function("document", `${fn}; openAll(true);`)(document);
  assert.deepEqual(asked, ["details"], "the Knockout's Expand all names kinds of fold");
});

test("the common-law row of the key lets its label wrap, and the count stays at the right", () => {
  const cl = conflict(2, "Moderate", { source: { source_type: "common-law" } });
  const html = render([conflict(1, "Moderate"), cl]);
  const row = html.match(/<details class="rrow rcl"[^>]*><summary>([\s\S]*?)<\/summary>/)?.[1];
  assert.ok(row, "the key draws no common-law row, so nothing below was checked");
  assert.match(row, new RegExp(`<span class="rsub">${R.key.unregisteredUse}</span><span class="rcount">`), "the label is not the row's second label, or it may not wrap");
  assert.doesNotMatch(row, /white-space:nowrap/, "the label still may not wrap");
  const css = readFileSync(join(HERE, "..", "publish", "templates", "report.css"), "utf8");
  assert.match(css, /\.rrow\.rcl>summary\{flex-wrap:wrap/, "the common-law row's header cannot take a second line");
});

test("on paper the folded list's header counts the cards printed, in the catalogue's words, and the screen keeps its own", () => {
  const html = render([conflict(1, "Moderate"), conflict(2, "Manageable"), conflict(3, "Manageable"), conflict(4, "Manageable")]);
  const g = html.match(/<details class="rgroup lowerband"><summary><span class="gname" data-print-one="([^"]*)" data-print-many="([^"]*)">([^<]*)<\/span>/);
  assert.ok(g, "the folded list's header carries no words for paper");
  assert.equal(g[3], R.lowerBand(3, ["Manageable"]), "the screen's header changed");
  assert.equal(g[1], R.lowerBand(1, ["Manageable"]));
  assert.equal(`2${g[2]}`, R.lowerBand(2, ["Manageable"]), "the words after the number are not the catalogue's");
  const exportPdf = html.match(/function exportPDF\(\)\{[^\n]*\}/)?.[0] ?? "";
  assert.match(exportPdf, /querySelectorAll\('\.card:not\(\.print-hidden\)'\)\.length/, "the export does not count the cards it prints");
  assert.match(exportPdf, /g\.dataset\.screen=g\.textContent/, "the export does not keep the screen's words to put back");
  assert.ok(exportPdf.indexOf("dataset.screen") < exportPdf.indexOf("window.print()"), "the header is rewritten after printing starts");
  assert.match(html, /addEventListener\('afterprint',function\(\)\{[^\n]*\.gname\[data-screen\][^\n]*g\.textContent=g\.dataset\.screen/, "the screen's words do not come back after printing");
});

// The export's own code, run against a small stand-in for the page: two of three cards ticked print "2 more conflicts".
test("with two of three cards ticked the export prints two in the header, and puts three back afterwards", () => {
  const html = render([conflict(1, "Moderate"), conflict(2, "Manageable"), conflict(3, "Manageable"), conflict(4, "Manageable")]);
  const js = html.match(/var _hidden=\[\];\nfunction exportPDF\(\)\{[^\n]*\}/)?.[0];
  const after = html.match(/window\.addEventListener\('afterprint',(function\(\)\{[^\n]*\})\);/)?.[1];
  assert.ok(js && after, "the page's export or after-print code was not found");
  const el = (cls, extra = {}) => ({ classList: { set: new Set(cls), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); } }, dataset: {}, ...extra });
  const cards = [true, true, false].map((ticked) => el(["card"], { box: { checked: ticked } }));
  cards.forEach((c) => { c.querySelector = (s) => (s === "input.pickbox" ? c.box : null); });
  const gname = el(["gname"], { textContent: "3 more conflicts rated Manageable" });
  const g = html.match(/<span class="gname" data-print-one="([^"]*)" data-print-many="([^"]*)">/);
  gname.dataset = { printOne: g[1], printMany: g[2] };
  const list = el(["lowerband"], { open: false });
  const printed = () => cards.filter((c) => !c.classList.contains("print-hidden"));
  list.querySelector = (s) => (s === ".card:not(.print-hidden)" ? printed()[0] ?? null : null);
  list.querySelectorAll = (s) => (s === ".card:not(.print-hidden)" ? printed() : []);
  gname.closest = () => list;
  const document = { querySelectorAll: (s) => {
    if (s === ".card") return cards;
    if (s === "details.lowerband") return [list];
    if (s === "details.lowerband:not(.print-hidden)>summary>.gname") return list.classList.contains("print-hidden") ? [] : [gname];
    if (s === ".gname[data-screen]") return gname.dataset.screen !== undefined ? [gname] : [];
    if (s === "details") return [list];
    return [];
  } };
  let onPaper = null;
  const window = { print: () => { onPaper = gname.textContent; } };
  const run = new Function("document", "window", `${js}; exportPDF(); (${after})();`);
  run(document, window);
  assert.equal(onPaper, "2 more conflicts rated Manageable", "the paper's header does not count the two printed cards");
  assert.equal(gname.textContent, "3 more conflicts rated Manageable", "the screen's header did not come back after printing");
});
