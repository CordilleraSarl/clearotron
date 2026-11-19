// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A REPORT NAMES ITS PLACES AND LABELS ITS CONTROLS (owner, 2026-11-18).
//
// A worldwide report's About row listed every focus territory; it now gives their count, and the list moves, in its
// own words, to What was searched. The places that came back clean were a chip each, codes past twelve; they are one
// paragraph of names. ZZ, the register's "unspecified", leaves every list, and XS reads "US state registers". Each
// card's export checkbox has a name a screen reader says, and the chart has a title. The demo run is public; the
// territories added here are invented inputs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseReport } from "../publish/parse.mjs";
import { renderHtml } from "../publish/render.mjs";
import { parseFindingsJson } from "../findings-model.mjs";

const RUN = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "demo", "multi-country-focus-search", "run");
const V = parseFindingsJson(readFileSync(join(RUN, "findings.json"), "utf8"));
const page = (opts) => renderHtml(parseReport(join(RUN, "report.md")), V.findings, V.coverage, { runId: "demo", ...opts });
const row = (html, panel, k) => {
  const i = html.indexOf(`class="${panel}`);
  return i < 0 ? null : (html.slice(i).match(new RegExp(`<span class="k">${k}</span><span class="v">([\\s\\S]*?)</span></div>`)) || [])[1] ?? null;
};
const COUNTS = { recordsByCountry: { JP: 60, KR: 46, XS: 13, ZZ: 4, WO: 6 }, courtDecisions: "not-in-scope" };

test("a worldwide report counts its focus territories in About, and lists them under What was searched", () => {
  const html = page({ scopeBasis: "worldwide", searchedJurisdictions: ["JP", "KR", "XS", "ZZ"], searchDepth: { counts: COUNTS } });
  const about = row(html, "panel about", "Where searched");
  const n = Number(about?.match(/^Worldwide · (\d+) focus territor(?:y|ies)$/)?.[1]);
  assert.ok(n > 0, `the About row: ${about}`);
  const list = row(html, "searched", "Where searched");
  assert.match(list ?? "", /^Worldwide, focus on /, "the list did not move under What was searched");
  const names = list.replace(/^Worldwide, focus on /, "").split(", ");
  assert.equal(names.filter((x) => x !== "WIPO (Madrid)").length, n, "the count is not the list's length");
  assert.ok(names.includes("US state registers"), `XS is not read as named: ${list}`);
  assert.doesNotMatch(list, /\bZZ\b|Unknown/, "ZZ is still listed");
});

test("a report of named places keeps its list in About and adds no row", () => {
  const html = page({ searchedJurisdictions: ["JP", "KR"], searchDepth: { counts: COUNTS } });
  assert.doesNotMatch(row(html, "panel about", "Where searched") ?? "", /focus territor/);
  assert.equal(row(html, "searched", "Where searched"), null);
});

test("ZZ draws no register chip and its records stay in the totals", () => {
  const html = page({ searchDepth: { counts: COUNTS } });
  assert.match(row(html, "searched", "Register") ?? "", /^123 records read across 4 countries, plus 6 international registrations/);
  const chips = html.match(/<div class="wchips">([\s\S]*?)<\/div>/)?.[1] ?? "";
  assert.deepEqual([...chips.matchAll(/<span class="wchip" title="([^"]*)">([A-Z]{2}) <b>/g)].map((m) => `${m[2]} ${m[1]}`),
    ["JP Japan", "KR South Korea", "XS US state registers"], "the chips are not the three named places");
});

test("the places that came back clean are one paragraph of names, in the names' order, with no ZZ", () => {
  const html = page({ searchDepth: { counts: COUNTS }, planTerritories: { searched: ["FR", "AE", "ZZ", "XS", "BS"], open: [] } });
  const para = html.match(/<div class="wclean"><span class="wk">Nothing found<\/span><p class="wnames">([^<]*)<\/p><\/div>/)?.[1];
  assert.ok(para, "no paragraph of clean places");
  assert.equal(para, "Bahamas, France, United Arab Emirates, US state registers");
  assert.doesNotMatch(html, /class="wchip" title="[^"]*">[A-Z]{2}<\/span>/, "a clean place is still a chip");
});

test("each card's export checkbox is named for its conflict, and the chart titles itself with its count", () => {
  const html = page({ searchDepth: { counts: COUNTS } });
  const cards = [...html.matchAll(/<div class="card[^"]*" id="c(\d+)">[\s\S]*?<input type="checkbox" class="pickbox" checked([^>]*)>/g)];
  assert.ok(cards.length >= 2, "the demo draws cards with export boxes");
  for (const [, n, attrs] of cards) {
    const label = attrs.match(/^ aria-label="Include conflict (\d+) in the PDF"$/);
    assert.ok(label, `card ${n}: the export box is not named for a conflict`);
    assert.equal(label[1], n, `card ${n}: the export box names another conflict`);
  }
  const svg = html.match(/<svg viewBox="0 0 560 430"[^>]*>\s*<title>([^<]*)<\/title>([\s\S]*?)<\/svg>/);
  assert.ok(svg, "the chart has no <title> first");
  const points = [...svg[2].matchAll(/<a href="#c\d+">/g)].length;
  assert.equal(svg[1], `Chart of ${points} conflict${points === 1 ? "" : "s"}, placed by how similar each mark is and how close its goods are; each number links to its card below.`);
});
