// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A PER-NAME KNOCKOUT PAGE SAYS ITS ASSESSMENT ONCE.
//
// On a multi-name batch, each name's page opens with that name's whole assessment, and the "Read the full assessment"
// fold printed it again: 10 to 26% of each such page repeated. Where the page opens with the assessment, the fold is
// not drawn; a single-name page opens with the batch paragraph and keeps it (owner, 2026-11-18). Everything is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderKnockoutHtml } from "../publish/render-knockout.mjs";
import { parseFrameworkManifest } from "../framework.mjs";

const MANIFEST = parseFrameworkManifest({
  schema_version: 1, framework_key: "fold-test", title: "Invented test framework", source_deck: "none", entity_label: "the company",
  bands: [{ label: "Severe", tone: "severe" }, { label: "Serious", tone: "high" }, { label: "Notable", tone: "medium" }, { label: "Slight", tone: "low" }],
  structure: { kind: "matrix", axes: ["Claim Grade", "Conflict Kind"] },
});
const ASSESSMENT = "## Overall read\n\nTARNELLO is a coined name with no close mark on the invented record.\n\n## Risk\n\nSlight on every class searched.";
const page = (opening) => renderKnockoutHtml({
  batch: { overall: "Slight", executiveSummary: opening },
  marks: [{ name: "TARNELLO", rating: "Slight", classesSearched: [9], classesDriving: [9], basis: "A coined name.",
    factors: ["No close mark on the record."], counterFactors: ["Nothing holds it higher."], mitigation: "", bullets: ["One bullet."],
    purpleNotes: [], findings: [], assessment: ASSESSMENT }],
}, MANIFEST, { runId: "r1", overall: "Slight" });

test("a page that opens with the name's assessment draws no fold repeating it", () => {
  const html = page(ASSESSMENT);
  assert.doesNotMatch(html, /Read the full assessment/);
  assert.equal(html.split("TARNELLO is a coined name with no close mark on the invented record.").length - 1, 1, "the assessment is printed more than once");
});

test("a page that opens with the batch paragraph keeps the fold", () => {
  const html = page("One invented batch paragraph about the names screened.");
  assert.match(html, /<summary>Read the full assessment<\/summary>/);
  assert.match(html, /TARNELLO is a coined name with no close mark on the invented record\./);
});
