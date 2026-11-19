// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE REPORT MARKS ITS OWN CHROME.
//
// The portal frames a report and removes the report's own chrome, the sticky header and the Knockout's theme button,
// and it found that chrome by class names: a re-skin that renamed one would leave the chrome on a client's screen with
// no error. Both renderers now mark each chrome root with one attribute, data-report-chrome, which no stylesheet
// selects on. This test holds the renderers' half: removing the marked elements removes exactly what the portal's
// class rules remove from a current report, so the portal can strip by the attribute instead.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseReport } from "../publish/parse.mjs";
import { renderHtml } from "../publish/render.mjs";
import { renderKnockoutHtml } from "../publish/render-knockout.mjs";
import { parseFindingsJson } from "../findings-model.mjs";
import { prepareReportForEmbed } from "../portal-report.mjs";

const DEMO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "demo");
const clearance = () => {
  const run = join(DEMO, "multi-country-focus-search", "run");
  const v = parseFindingsJson(readFileSync(join(run, "findings.json"), "utf8"));
  return renderHtml(parseReport(join(run, "report.md")), v.findings, v.coverage, { runId: "demo", homeHref: "/portal/" });
};
const knockout = () => {
  const run = join(DEMO, "knockout-search", "run");
  return renderKnockoutHtml(JSON.parse(readFileSync(join(run, "knockout-findings.json"), "utf8")),
    JSON.parse(readFileSync(join(run, "_driver", "framework.json"), "utf8")), { runId: "demo" });
};

// Remove each element whose opening tag carries the attribute, with everything inside it, by counting its own tag.
function stripMarked(html) {
  let out = html;
  for (let m; (m = /<([a-z]+)\b[^>]*\sdata-report-chrome\b[^>]*>/i.exec(out));) {
    const tag = m[1].toLowerCase();
    let depth = 0, i = m.index, end = -1;
    const re = new RegExp(`<${tag}\\b|</${tag}>`, "gi");
    re.lastIndex = i;
    for (let t; (t = re.exec(out));) { depth += t[0][1] === "/" ? -1 : 1; if (depth === 0) { end = t.index + t[0].length; break; } }
    assert.ok(end > 0, `a marked <${tag}> never closes`);
    out = out.slice(0, m.index) + out.slice(end);
  }
  return out;
}
const classOpenings = (h) => { const c = new Map(); for (const x of h.matchAll(/<([a-z]+)\b[^>]*?class="([^"]*)"/g)) { const k = `${x[1]}.${x[2]}`; c.set(k, (c.get(k) ?? 0) + 1); } return c; };
const removed = (before, after) => { const a = classOpenings(before), b = classOpenings(after); return [...a].filter(([k, n]) => (b.get(k) ?? 0) < n).map(([k, n]) => `${k}×${n - (b.get(k) ?? 0)}`).sort(); };

for (const [name, render, roots] of [["clearance", clearance, 1], ["knockout", knockout, 2]]) {
  test(`${name}: the marked chrome is exactly what the portal removes from a current report`, () => {
    const html = render();
    assert.equal((html.match(/\sdata-report-chrome\b/g) ?? []).length, roots, `${name} marks ${roots} chrome root(s)`);
    const prepared = prepareReportForEmbed(html, { staff: false });
    const byPortal = removed(html, typeof prepared === "string" ? prepared : prepared.html);
    assert.ok(byPortal.length > 5, "the portal removed little; the comparison would prove little");
    assert.deepEqual(removed(html, stripMarked(html)), byPortal);
  });
}

test("no stylesheet selects on the attribute, so it changes nothing a reader sees", () => {
  for (const html of [clearance(), knockout()]) {
    for (const [, css] of html.matchAll(/<style>([\s\S]*?)<\/style>/g)) assert.doesNotMatch(css, /data-report-chrome/);
  }
});
