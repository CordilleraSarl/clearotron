// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE KNOCKOUT NAMES EVERY TERRITORY THE ORDER NAMED, HOWEVER THE ORDER WROTE IT.
//
// An order may carry a territory as a code ("EU", "UK") or as a country's name ("Norway"). The page's two
// territory rows look names up by code, so a territory written as a name came back empty and fell off the
// page: a knockout ordered for four territories said it searched two. "Registers counted" lost the same
// two and fell back to a bare count of registers, although every one of them was counted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderKnockoutHtml } from "../publish/render-knockout.mjs";

const FW = {
  framework_key: "house-triage", title: "House triage framework",
  bands: [{ label: "Blocking", tone: "severe" }, { label: "Medium", tone: "medium" },
    { label: "Manageable", tone: "low" }, { label: "Low", tone: "minimal" }],
};
const MARK = {
  name: "IRONWHISK", classesSearched: [8], classesDriving: [8], rating: "Low", ratingQualifier: null,
  basis: "The name is a compound of two ordinary kitchen words.", factors: [], counterFactors: [],
  mitigation: "", bullets: [], assessment: "## What the name is\n\nA compound of two ordinary words.",
  purpleNotes: [], findings: [], negatives: [], degraded: false,
};
const COUNTS = (scope) => ({
  schema: 1, provider: "clarivate", providerLabel: "Clarivate Compumark", basis: "b", scope,
  marks: [{ name: "IRONWHISK", classes: [8], classScope: "mark",
    counts: { identical: { total: 0 }, containing: { total: 3 }, close: { total: 0, forms: [], generated: 0, counted: 0 } } }],
});
const render = (jurisdictions, scopeOver = {}) => renderKnockoutHtml(
  { marks: [MARK], batch: { executiveSummary: "One name screened.", standardCaveats: [] } }, FW,
  { runId: "r", overall: "Low", identity: { identity: "Knockout search" },
    instructedScope: { marks: ["IRONWHISK"], classes: [8], jurisdictions, goods: "hand tools" },
    registerCounts: COUNTS({ jurisdictions, regions: ["EM", "GB", "NO", "CH", "WO"], classes: [8], ...scopeOver }) },
);
const row = (html, label) => (html.match(new RegExp(`<span class="k">${label}</span><span class="v">([\\s\\S]*?)</span></div>`)) || [])[1];

test("an order written in codes and names is named in full on both rows", () => {
  const html = render(["EU", "UK", "Norway", "Switzerland"]);
  assert.equal(row(html, "Where searched"), "the European Union, the United Kingdom, Norway and Switzerland",
    "a territory written as a name fell off the page");
  assert.equal(row(html, "Registers counted"), "European Union, United Kingdom, Norway and Switzerland, on Clarivate Compumark.",
    "the counted row fell back to a count although every territory was counted");
});

test("the same order written all in codes reads the same", () => {
  const html = render(["EU", "GB", "NO", "CH"]);
  assert.equal(row(html, "Where searched"), "the European Union, the United Kingdom, Norway and Switzerland");
  assert.equal(row(html, "Registers counted"), "European Union, United Kingdom, Norway and Switzerland, on Clarivate Compumark.");
});

test("a territory written as a name and deferred is still left off the counted row", () => {
  const html = render(["EU", "Norway"], { regions: ["EM", "WO"], deferredJurisdictions: ["NO"] });
  assert.equal(row(html, "Registers counted"), "European Union, on Clarivate Compumark.", "a deferred territory was listed as counted");
});
