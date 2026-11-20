// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// ON A PHONE, THE KNOCKOUT'S RISK SCALE NAMES ONLY ITS ENDS (design, 2026-11-19).
//
// Each word of the scale sits at its band's point on the bar, and at 390 px five words needed more than the bar's width
// and printed on top of one another. Below 560 px only the framework's first and last words stay; the pill over the
// needle already names the mark's own band in full. The page still carries every word, so the wider layout and the
// printed page are unchanged. A one-word scale would keep its word, since that word is the first child; a framework
// carries two to eight bands, so the smallest scale tested here is two words. The framework here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderKnockoutHtml } from "../publish/render-knockout.mjs";
import { parseFrameworkManifest } from "../framework.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const manifest = (labels) => parseFrameworkManifest({ schema_version: 1, framework_key: "scale-test", title: "Invented test framework",
  source_deck: "none", entity_label: "the company", bands: labels.map((label, i) => ({ label, tone: ["severe", "high", "medium", "low", "low"][i] })),
  structure: { kind: "matrix", axes: ["Claim Grade", "Conflict Kind"] } });
const ticks = (labels, rating) => {
  const html = renderKnockoutHtml({ batch: { overall: rating, executiveSummary: "summary" }, marks: [{ name: "SKARVELLE", rating,
    classesSearched: [9], classesDriving: [9], basis: "A basis.", factors: ["An observation."], counterFactors: [], mitigation: "", bullets: [], purpleNotes: [], findings: [] }] },
  manifest(labels), { runId: "r1", overall: rating });
  return [...(html.match(/<div class="kticks">([\s\S]*?)<\/div><\/div>/)?.[1] ?? "").matchAll(/<span[^>]*>([^<]+)<\/span>/g)].map((m) => m[1]);
};

test("a phone screen hides every word between the scale's ends, and only a screen does", () => {
  const css = readFileSync(join(HERE, "..", "publish", "templates", "knockout.css"), "utf8");
  assert.match(css, /@media screen and \(max-width:560px\)\{\.kticks span:not\(:first-child\):not\(:last-child\)\{display:none\}\}/,
    "the phone rule is missing, or reaches print");
});

test("the page still carries every word, in the framework's order, down to a two-word scale", () => {
  assert.deepEqual(ticks(["Very High", "High", "Medium", "Manageable", "Low"], "Medium"), ["Low", "Manageable", "Medium", "High", "Very High"]);
  assert.deepEqual(ticks(["Serious", "Slight"], "Serious"), ["Slight", "Serious"], "a two-word scale lost a word; both are its ends");
});
