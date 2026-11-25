// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// ONE INLINE-MARKDOWN DIALECT ON BOTH REPORT PAGES.
//
// The model writes links, bold, italic and code into the fields a report prints. The clearance renderer read links but
// not code, the Knockout read code but not links, and five clearance fields were escaped and nothing else, so a
// model-written `[label](https://…)` reached a delivered page as those characters. The assessment's two opening
// paragraphs were escaped and nothing else after that, and one printed a link raw on a delivered page. Both renderers now read the forms
// through shared/inline-markdown.mjs. Each site below is given its own tokens, so a pass names the site that rendered
// them, and the demo runs supply everything else a page needs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseReport } from "../publish/parse.mjs";
import { renderHtml } from "../publish/render.mjs";
import { renderKnockoutHtml, inlineMd } from "../publish/render-knockout.mjs";
import { parseFindingsJson } from "../findings-model.mjs";
import { inlineMarkdown } from "../../shared/inline-markdown.mjs";

const DEMO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "demo");
const md = (site) => `See [${site}-link](https://example.com/${site}), **${site}-bold** and \`${site}-code\`.`;
const rendered = (html, site) => {
  assert.ok(html.includes(`<a href="https://example.com/${site}" target="_blank" rel="noopener noreferrer">${site}-link</a>`), `${site}: the link printed as markup`);
  assert.ok(html.includes(`<b>${site}-bold</b>`), `${site}: the bold printed as asterisks`);
  assert.ok(html.includes(`<span class="mono">${site}-code</span>`), `${site}: the code printed as backticks`);
  assert.ok(!html.includes(`[${site}-link]`), `${site}: the link's markup is still on the page`);
};

test("every clearance field the model writes prints its links, bold and code as such", () => {
  const run = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "demo-2026-09-18", "multi-country-focus-search", "run");   // the previous capture, which has a ruled-out finding
  const v = parseFindingsJson(readFileSync(join(run, "findings.json"), "utf8"));
  const ruled = v.findings.find((f) => f.disposition === "off-field" && (f.legal_position || f.practical_position));
  assert.ok(ruled, "the demo has a ruled-out finding with its positions; without one the fold is not drawn");
  Object.assign(ruled, { legal_position: md("legal"), practical_position: md("practical") });
  // The grid draws the rows left open; a row searched clean is summarised elsewhere.
  const open = v.coverage.find((c) => (c.status ?? c.state) === "not-searched");
  assert.ok(open, "the demo has a coverage row left open");
  open.note = md("coverage");
  const ma = v.markAssessment;
  assert.ok(ma?.distinctiveness, "the demo has a mark assessment");
  Object.assign(ma.distinctiveness, {
    per_class: [{ class: 9, note: md("perclass") }],
    per_market: [{ market: "EU", note: md("permarket") }],
    counter_registrations: [{ mark: "ZENTROVA", owner: "Zentrova LLC", note: md("counter") }],
  });
  // The assessment's two opening paragraphs, measured on a delivered page on 2026-11-25: a link of their own printed raw.
  ma.distinctiveness.read = md("opening");
  if (ma.connotation && typeof ma.connotation === "object") ma.connotation.read = md("connotation");
  else ma.connotation = { read: md("connotation") };
  const html = renderHtml(parseReport(join(run, "report.md")), v.findings, v.coverage,
    { runId: "demo", contextNotes: v.contextNotes || [], markAssessment: ma, fourAnswers: v.fourAnswers || null });
  for (const site of ["legal", "practical", "coverage", "perclass", "permarket", "counter", "opening", "connotation"]) rendered(html, site);
  // The older form, two plain strings, prints its paragraphs the same way.
  const plain = renderHtml(parseReport(join(run, "report.md")), v.findings, v.coverage,
    { runId: "demo", contextNotes: v.contextNotes || [], markAssessment: { distinctiveness: md("plainopening"), connotation: md("plainconnotation") }, fourAnswers: v.fourAnswers || null });
  for (const site of ["plainopening", "plainconnotation"]) rendered(plain, site);
});

test("the Knockout's assessment fold prints links, bold and code as the clearance does", () => {
  const run = join(DEMO, "knockout-search", "run");
  const findings = JSON.parse(readFileSync(join(run, "knockout-findings.json"), "utf8"));
  const framework = JSON.parse(readFileSync(join(run, "_driver", "framework.json"), "utf8"));
  findings.marks[0].assessment = `## Overall read\n\n${md("assessment")}`;
  rendered(renderKnockoutHtml(findings, framework, { runId: "demo" }), "assessment");
});

test("both renderers keep the link-target guard: only http(s), mailto and an in-page anchor become links", () => {
  for (const [render, name] of [[inlineMd, "knockout"], [(s) => inlineMarkdown(s), "shared"]]) {
    const out = render("a [x](javascript:alert) b [y](data:text/html,1) c [m](mailto:a@example.com) d [h](#c3)");
    assert.doesNotMatch(out, /href="(javascript|data):/i, `${name}: an executing scheme became an href`);
    assert.match(out, /a x b y c /, `${name}: an unsafe link keeps its label as text`);
    assert.match(out, /<a href="mailto:a@example.com">m<\/a>/, `${name}: mailto is a link`);
    assert.match(out, /<a href="#c3">h<\/a>/, `${name}: an in-page anchor is a same-tab link`);
  }
  // A quote in the target cannot leave the attribute, whichever escaping the caller ran first.
  assert.doesNotMatch(inlineMarkdown('[x](https://e.example/" onmouseover="alert(1))'), /" onmouseover/);
});

test("an unmatched marker stays visible, so prose is never silently edited", () => {
  assert.equal(inlineMarkdown("2 * 3 = 6"), "2 * 3 = 6");
  assert.equal(inlineMarkdown("a ` b"), "a ` b");
  assert.equal(inlineMarkdown("[no target] (here)"), "[no target] (here)");
});
