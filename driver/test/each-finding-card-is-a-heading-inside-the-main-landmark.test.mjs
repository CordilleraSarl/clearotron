// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// EACH FINDING CARD IS A HEADING, INSIDE THE MAIN LANDMARK, AND THE PAGE MOVES ONLY FOR A READER WHO ALLOWS IT.
//
// A report's finding titles were spans, so heading navigation reached its seven or eight sections and none of up to
// 274 findings, and a PDF outline built from headings listed the sections alone. The page had no <main>, and smooth
// scrolling ignored a reader's reduced-motion setting. Each title is now an h3 under its section's h2, on both
// renderers; the page's content sits in one <main> with the footer after it; and smooth scrolling, in the stylesheet
// and in the card links' script, applies only when the reader has not asked for reduced motion. None of it changes
// what the page looks like: measured on the four demos, every full-page frame at both widths and themes matched.
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
const count = (html, re) => [...html.matchAll(re)].length;
const headingLevels = (html) => [...html.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));

// One <main>, holding the content and ending before the footer, which stays the page's own contentinfo.
const oneMainBeforeTheFooter = (html, name) => {
  assert.equal(count(html, /<main>/g), 1, `${name}: one <main>`);
  assert.equal(count(html, /<\/main>/g), 1, `${name}: one </main>`);
  const open = html.indexOf("<main>"), close = html.indexOf("</main>"), footer = html.indexOf("<footer>");
  assert.ok(html.indexOf('<div class="wrap">') < open && open < close && close < footer, `${name}: <main> sits in .wrap, before the footer`);
};
// No card title sits straight under the page's h1: an h2 opens every section a card is in.
const everyH3UnderAnH2 = (html, name) => {
  let seenH1 = false, sinceH1 = null;
  for (const l of headingLevels(html)) {
    if (l === 1) { seenH1 = true; sinceH1 = 1; } else if (l === 2) sinceH1 = 2;
    else if (l === 3 && seenH1) assert.notEqual(sinceH1, 1, `${name}: an h3 sits directly under the h1`);
  }
};

test("a clearance page: one h3 per finding card, under its section's h2, inside one <main>", () => {
  const run = join(HERE, "..", "..", "demo", "multi-country-focus-search", "run");
  const v = parseFindingsJson(readFileSync(join(run, "findings.json"), "utf8"));
  const html = renderHtml(parseReport(join(run, "report.md")), v.findings, v.coverage,
    { runId: "demo", contextNotes: v.contextNotes || [], markAssessment: v.markAssessment });
  const cards = count(html, /<div class="card[ "]/g);
  assert.ok(cards >= 2, "the demo draws finding cards, ruled-out ones included");
  assert.equal(count(html, /<h3 class="who mark-first">/g), cards, "every card's title is its h3");
  assert.equal(count(html, /<span class="who/g), 0, "no title is left a span");
  oneMainBeforeTheFooter(html, "clearance");
  everyH3UnderAnH2(html, "clearance");
});

// An invented framework, finding and filing: the Knockout demo's one name has no findings, so it cannot show these.
const MANIFEST = parseFrameworkManifest({
  schema_version: 1, framework_key: "heading-test", title: "Invented test framework", source_deck: "none",
  entity_label: "the company",
  bands: [{ label: "Severe", tone: "severe" }, { label: "Serious", tone: "high" }, { label: "Notable", tone: "medium" }, { label: "Slight", tone: "low" }],
  structure: { kind: "matrix", axes: ["Claim Grade", "Conflict Kind"] },
});

test("a Knockout page: the finding card and the register card both title with an h3, inside one <main>", () => {
  const recordId = "R-BRISQUETTE";
  const html = renderKnockoutHtml({
    batch: { overall: "Serious", executiveSummary: "summary" },
    marks: [{
      name: "TARNELLO", rating: "Serious", classesSearched: [9], classesDriving: [9], basis: "The name is close to a known property.",
      factors: ["A first observation."], counterFactors: ["What holds it at this band."], mitigation: "", bullets: ["One bullet."], purpleNotes: [],
      findings: [{ ordinal: 1, name: "TARNELLO LABS", owner: "Tarnello Srl", band: "Serious", type: "Active Business",
        net: "Tarnello Srl's unregistered use is likely to block the applicant.", evidence: ["https://example.invalid/shop/tarnello"],
        basis: "Continuous retail listings under the applicant's exact goods." }],
      registerReads: [{ recordId, read: "The owner's filings sit in optical goods.", band: "Notable" }],
    }],
  }, MANIFEST, { runId: "r1", overall: "Serious", registerRecords: { marks: [{ name: "TARNELLO", classes: [9],
    records: [{ recordId, mark: "BRISQUETTE", owner: "Brisquette SA", territory: "EU", classes: [9], status: "registered", url: "https://example.test/R-BRISQUETTE" }] }] } });
  assert.ok(html.includes('<h3 class="who">TARNELLO LABS</h3>'), "the finding card's title is its h3");
  assert.ok(html.includes('<h3 class="who">BRISQUETTE</h3>'), "the register card's title is its h3");
  assert.equal(count(html, /<span class="who/g), 0, "no title is left a span");
  oneMainBeforeTheFooter(html, "knockout");
  everyH3UnderAnH2(html, "knockout");
});

test("smooth scrolling waits for the reader's leave, and a heading title keeps the span's look", () => {
  const css = readFileSync(join(HERE, "..", "publish", "templates", "report.css"), "utf8");
  const smooth = [...css.matchAll(/scroll-behavior:\s*smooth/g)];
  assert.equal(smooth.length, 1, "one smooth-scroll rule");
  assert.match(css, /@media \(prefers-reduced-motion:\s*no-preference\)\{html\{scroll-behavior:smooth\}\}/,
    "and it applies only when the reader has not asked for reduced motion");
  // :where() has no specificity, so every .who rule keeps winning and only the browser's heading defaults go.
  assert.match(css, /:where\(h3\.who\)\{margin:0;font:inherit;display:inline\}/);
  // The card links scroll with script, which the stylesheet does not govern; it asks the same question.
  const run = join(HERE, "..", "..", "demo", "multi-country-focus-search", "run");
  const v = parseFindingsJson(readFileSync(join(run, "findings.json"), "utf8"));
  const html = renderHtml(parseReport(join(run, "report.md")), v.findings, v.coverage, { runId: "demo" });
  const scrolls = [...html.matchAll(/scrollIntoView\(\{behavior:([^,]+),/g)].map((m) => m[1]);
  assert.ok(scrolls.length > 0, "the page's script scrolls to a card");
  for (const b of scrolls) assert.match(b, /prefers-reduced-motion: reduce\)'\)\.matches\)\?'auto':'smooth'/, "every smooth scroll asks first");
});
