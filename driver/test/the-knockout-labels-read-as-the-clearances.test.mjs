// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE KNOCKOUT'S LABELS READ AS THE CLEARANCE'S (owner, 2026-11-18, batch two items 1139 to 1141).
//
// "Evidence:" means an evidence status on the clearance, and the Knockout used it for a list of links: the list is
// "Sources:". The fold that argues a band is "Risk assessment", the clearance's word, where it read "Why this band". The
// rating line is "Overall risk" and the framework's name, as on the clearance's gauge, where it read "Rated on the …".
// Every name and filing here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderKnockoutHtml } from "../publish/render-knockout.mjs";
import { parseFrameworkManifest } from "../framework.mjs";

const MANIFEST = parseFrameworkManifest({
  schema_version: 1, framework_key: "label-test", title: "Invented test framework", source_deck: "none", entity_label: "the company",
  bands: [{ label: "Severe", tone: "severe" }, { label: "Serious", tone: "high" }, { label: "Notable", tone: "medium" }, { label: "Slight", tone: "low" }],
  structure: { kind: "matrix", axes: ["Claim Grade", "Conflict Kind"] },
});
const FINDING = { ordinal: 1, name: "TARNELLO LABS", owner: "Tarnello Srl", band: "Serious", type: "Active Business",
  net: "Tarnello Srl's use is likely to block the applicant.", evidence: ["https://example.invalid/shop/tarnello"], basis: "Retail listings since 2019." };
const page = (mark) => renderKnockoutHtml({ batch: { overall: "Notable", executiveSummary: "summary" }, marks: [mark] }, MANIFEST, { runId: "r1", overall: "Notable" });

test("a card's link list is \"Sources:\", and its band's argument folds under \"Risk assessment\"", () => {
  const html = page({ name: "TARNELLO", rating: "Notable", classesSearched: [9], findings: [FINDING], bullets: ["A bullet."] });
  assert.match(html, /<p class="ko-findev">Sources: <a href="https:\/\/example\.invalid\/shop\/tarnello"/);
  assert.doesNotMatch(html, /Evidence: /, "the link list still reads as an evidence status");
  assert.match(html, /<details class="ko-full ko-why"><summary>Risk assessment<\/summary>/);
  assert.doesNotMatch(html, /Why this band/);
});

test("the rating reads \"Overall risk\" and the framework's name, with a card and without one, never \"Rated on the\"", () => {
  const head = '<div class="label">Overall risk</div><div class="gauge-fw">Invented test framework</div>';
  const card = page({ name: "TARNELLO", rating: "Notable", classesSearched: [9], basis: "Close to a known property.", factors: ["An observation."],
    counterFactors: ["What holds it."], mitigation: "", bullets: [], findings: [] });
  assert.ok(card.includes(`<div class="gauge-head">${head}</div>`), "the rating card's head is not the clearance's");
  const bare = page({ name: "TARNELLO", rating: "Notable", classesSearched: [9], bullets: ["A bullet."], findings: [] });
  assert.ok(bare.includes(`<div class="ko-fwline">${head}</div>`), "a name with no rating card does not name its ladder");
  for (const html of [card, bare]) {
    assert.doesNotMatch(html, /Rated on the/);
    assert.equal(html.split('class="gauge-fw"').length - 1, 1, "the framework is named once per name");
  }
});
