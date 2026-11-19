// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A CLEARANCE PRINTS ITS TICKED CARDS WHOLE, AND EVERY OTHER FOLD AS IT READS ON SCREEN (owner, 2026-11-19, option 2).
//
// The export opened every fold on the page, which ran a median clearance to about 26 pages. Now the folds of each card
// the export prints (a ticked card, or a ruled-out card, which has no tick box) print open, record and reasoning
// included, with any fold such a card sits in; a fold the reader left closed prints its summary line and stays shut.
// Measured with a browser on the three clearance demos: 14 pages to 10, 12 to 10, 10 to 7, the pages the owner chose
// from. The Knockout has no tick boxes and still prints every fold. A browser measures the pages; this holds the
// rules, the script and which page carries them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseReport } from "../publish/parse.mjs";
import { renderHtml } from "../publish/render.mjs";
import { renderKnockoutHtml } from "../publish/render-knockout.mjs";
import { parseFindingsJson } from "../findings-model.mjs";
import { parseFrameworkManifest } from "../framework.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUN = join(HERE, "..", "..", "demo", "multi-country-focus-search", "run");
const clearance = () => {
  const v = parseFindingsJson(readFileSync(join(RUN, "findings.json"), "utf8"));
  return renderHtml(parseReport(join(RUN, "report.md")), v.findings, v.coverage, { runId: "demo" });
};
const PRINTING_CARD = ".card:not(:has(input.pickbox:not(:checked)))";

test("the clearance's print sheet keeps closed folds shut and opens every card the export prints", () => {
  const html = clearance();
  const css = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
  for (const rule of [
    "details:not([open])>*:not(summary){display:none!important}",
    `${PRINTING_CARD} details>*:not(summary),details:has(${PRINTING_CARD})>*:not(summary){display:block!important}`,
    "details:not([open])>summary{display:block!important}",
    'details:not([open])>summary::before{content:""!important}',
  ]) assert.ok(css.replace(/\s+/g, "").includes(rule.replace(/\s+/g, "")), `the print rule is missing: ${rule}`);
  assert.ok(css.lastIndexOf("details:not([open])>*:not(summary)") > css.lastIndexOf("details>*:not(summary){display:block!important}"),
    "the clearance's rules must come after the base sheet's open-every-fold rule");
});

test("before printing, the page opens only the folds of the cards the export prints, and their containers", () => {
  const js = clearance().match(/window\.addEventListener\('beforeprint',function\(\)\{[^\n]*\}\);/)?.[0] ?? "";
  assert.match(js, /d\.dataset\.o=d\.open\?'1':'';\}\);/, "the screen's fold state is not kept for after the print");
  assert.match(js, /var b=c\.querySelector\('input\.pickbox'\);if\(b&&!b\.checked\)return;c\.querySelectorAll\('details'\)\.forEach\(function\(d\)\{d\.open=true;\}\);for\(var p=c\.parentElement;p;p=p\.parentElement\)if\(p\.tagName==='DETAILS'\)p\.open=true;/,
    "an unticked card is opened, or a printing card's folds or containers are not");
  assert.doesNotMatch(js, /forEach\(function\(d\)\{d\.dataset\.o=d\.open\?'1':'';d\.open=true;\}\)/, "the page still opens every fold");
});

test("the Knockout carries none of it, and still prints every fold", () => {
  const manifest = parseFrameworkManifest({ schema_version: 1, framework_key: "print-test", title: "Invented test framework", source_deck: "none",
    entity_label: "the company", bands: [{ label: "Serious", tone: "high" }, { label: "Slight", tone: "low" }],
    structure: { kind: "matrix", axes: ["Claim Grade", "Conflict Kind"] } });
  const html = renderKnockoutHtml({ batch: { overall: "Slight", executiveSummary: "summary" }, marks: [{ name: "SKARVELLE", rating: "Slight",
    classesSearched: [9], classesDriving: [9], basis: "A basis.", factors: [], counterFactors: [], mitigation: "", bullets: [], purpleNotes: [], findings: [] }] },
  manifest, { runId: "r1", overall: "Slight" });
  assert.ok(!html.includes(PRINTING_CARD) && !html.includes("details:not([open])>*:not(summary)"), "the Knockout loads the clearance's print sheet");
  assert.match(html, /details>\*:not\(summary\)\{display:block!important\}/, "the Knockout no longer prints every fold");
});
