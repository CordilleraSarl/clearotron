// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE REPORT'S HEADINGS READ IN THE RULED WORDS (owner, 2026-11-18).
//
// Three labels changed and nothing under them did. The fold under the answer reads "What this depends on", where it
// read "Show the chart and rights-holders". The section of conflicts that can sit beside the client's mark reads
// "Marks that can coexist", where it read "Notable but manageable". The jump strip names each section in its
// heading's own words, in the page's order, and its "Conflicts" entry opens the Conflicts heading rather than the
// landscape above it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseReport } from "../publish/parse.mjs";
import { renderHtml } from "../publish/render.mjs";
import { parseFindingsJson } from "../findings-model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const demo = (name) => {
  const run = join(HERE, "..", "..", "demo", name, "run");
  const v = parseFindingsJson(readFileSync(join(run, "findings.json"), "utf8"));
  return renderHtml(parseReport(join(run, "report.md")), v.findings, v.coverage,
    { runId: "demo", contextNotes: v.contextNotes || [], markAssessment: v.markAssessment, fourAnswers: v.fourAnswers });
};
const strip = (html) => [...(html.match(/<nav class="strip[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? "")
  .matchAll(/href="#([^"]+)"[^>]*>(?:<i><\/i>)?([^<]+)</g)].map((m) => [m[1], m[2]]);

test("the jump strip names each section in its heading's words, in the page's order, and Conflicts opens Conflicts", () => {
  const html = demo("multi-country-focus-search");
  const entries = strip(html);
  const want = [["summary", "Summary"], ["next", "What happens next"], ["conflicts", "Conflicts"], ["also-considered", "Also considered"], ["searched", "What was searched"]];
  assert.deepEqual(entries, want.filter(([id]) => html.includes(`id="${id}"`)), "the strip's entries, words or order");
  assert.ok(entries.some(([id]) => id === "conflicts"), "the demo draws conflicts, so the strip must name them");
  assert.match(html, /<div class="sec" id="conflicts"><span class="num"><\/span><h2>Conflicts<\/h2><\/div>/, "the entry does not open the Conflicts heading");
  for (const [, word] of entries.slice(1)) assert.notEqual(word, "Findings");
  assert.doesNotMatch(html, />Next steps</, "the strip still says Next steps");
});

test("the fold under the answer reads What this depends on, and the coexistence section reads Marks that can coexist", () => {
  const render = readFileSync(join(HERE, "..", "publish", "render.mjs"), "utf8");
  // The fold's words live in the sentence catalogue, so the page it draws is where they are read.
  const page = demo("multi-country-focus-search");
  assert.ok(page.includes("<summary>What this depends on</summary>"), "the fold under the answer keeps its old label");
  assert.ok(!page.includes("Show the chart and rights-holders") && !render.includes("Show the chart and rights-holders"), "the old fold label is still drawn");
  assert.equal((render.match(/<h2>Marks that can coexist<\/h2>/g) ?? []).length, 2, "both layouts of the section carry the ruled heading");
  assert.ok(!/<h2>Notable but manageable<\/h2>/.test(render), "a layout still prints the old heading");
});
