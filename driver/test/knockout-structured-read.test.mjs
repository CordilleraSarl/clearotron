// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — the per-mark read, typed at source and rendered as structure.
//
// The defect was not a renderer that failed to break a paragraph up. It was a paragraph: rating,
// classes, crowding, two adjacencies, mitigation and a register caveat fused into ~180 words, in
// sentence flow, where only a careful read recovers the skeleton every one of these summaries walks.
// No renderer can lay out what it was given as prose, so the fix is at the source and the enforcement
// is at the contract — the same rule settled.
//
// Two properties are load-bearing and neither is cosmetic:
//   1. A chunk without the fields is invalid_file, not a render-time repair. A renderer that patches a
//      broken contract is a renderer that hides it being broken.
//   2. The register sentence is the RENDERER'S. The assessing turn cannot see the count lane — it is
//      deliberately never shown the figures — so anything it says about register coverage is invention,
//      and on 2026-08-11 the invention shipped directly above the counts the same run had taken.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //

import { validators, validateMergedFindings, REGISTER_CLAIM_RE, READ_FIELDS } from "../verify-knockout.mjs";
import { renderKnockoutHtml } from "../publish/render-knockout.mjs";

const FW = {
  framework_key: "house-triage",
  bands: [{ label: "Blocking", tone: "severe" }, { label: "Medium", tone: "medium" },
    { label: "Manageable", tone: "low" }, { label: "Low", tone: "minimal" }],
};

function runDirWith({ research = {}, scope = null } = {}) {
  const d = mkdtempSync(join(tmpdir(), "ko-read-"));
  mkdirSync(driverDir(d), { recursive: true });
  mkdirSync(join(d, "research"), { recursive: true });
  writeFileSync(driverDir(d, "framework.json"), JSON.stringify(FW));
  if (scope) writeFileSync(driverDir(d, "instructed-scope.json"), JSON.stringify(scope));
  for (const [name, body] of Object.entries(research))
    writeFileSync(join(d, "research", `${name.toLowerCase()}.md`), body);
  return d;
}

const markRow = (over = {}) => ({
  name: "IRONWHISK", classesSearched: [8], classesDriving: [8], contextFraming: "compound",
  rating: "Manageable", ratingQualifier: null,
  bullets: ["Scattered informal uses; no dominant owner."],
  basis: "A compound of two ordinary kitchen words, used informally by several small sellers.",
  factors: ["Two marketplace storefronts trade under the name in the same goods.",
    "No owner has consolidated the name across the field."],
  counterFactors: ["No registered right and no dominant trader was found on the material searched."],
  mitigation: "Narrowing to the tool classes would put daylight between this and the storefront use.",
  purpleNotes: [], registerEstimate: "moderate filings expected", findings: [], negatives: [], degraded: null,
  ...over,
});
const chunk = (marks, extra = {}) => JSON.stringify({
  chunkSummary: "The chunk's marks are covered here in a measured sentence or two.",
  batch: { productContext: "kitchenware" }, ...extra, marks,
});

// ── the contract ────────────────────────────────────────────────────────────────────────────────────

test("the typed read is MANDATORY on a fresh chunk — a missing field is invalid_file, never a render-time patch", () => {
  const d = runDirWith({ research: { IRONWHISK: "payload" } });
  const f = driverDir(d, "knockout-assess-0.json");
  assert.equal(validators.knockoutAssessChunk(f, chunk([markRow()])).ok, true, "the complete row passes");

  for (const field of READ_FIELDS) {
    const without = markRow();
    delete without[field];
    const r = validators.knockoutAssessChunk(f, chunk([without]));
    assert.equal(r.ok, false, `${field}: a row missing it must not validate`);
    assert.match(r.reason, /knockout_read_incomplete/, `${field}: the failure is tokenised for the corrective ladder`);
    assert.ok(r.reason.includes(field), `${field}: the message names the field the turn must add`);
  }
});

test("the field bounds are the shape the report renders, not decoration", () => {
  const d = runDirWith({ research: { IRONWHISK: "payload" } });
  const f = driverDir(d, "knockout-assess-0.json");
  const bad = (over) => validators.knockoutAssessChunk(f, chunk([markRow(over)])).reason ?? "";
  assert.match(bad({ basis: "   " }), /basis/, "a blank sentence is not a sentence");
  assert.match(bad({ factors: ["only one"] }), /2–4/, "one observation is a claim, not a read");
  assert.match(bad({ factors: ["a", "b", "c", "d", "e"] }), /2–4/, "five is a wall again");
  assert.match(bad({ factors: ["a", ""] }), /non-empty/);
  assert.match(bad({ counterFactors: [] }), /1–3/);
  assert.match(bad({ mitigation: null }), /mitigation/);
  // …but an EMPTY mitigation is the answer, not the absence of one: some names have nothing that would
  // move them, and demanding a sentence there invents advice.
  assert.equal(validators.knockoutAssessChunk(f, chunk([markRow({ mitigation: "" })])).ok, true);
});

// ── the sentence the model may not write ─────────────────────────────────────────────────────────────

test("a chunk that speaks for the register lane is REFUSED — the live 2026-08-11 sentence, verbatim", () => {
  const d = runDirWith({ research: { IRONWHISK: "payload" } });
  const f = driverDir(d, "knockout-assess-0.json");
  // The exact shape that shipped: model prose asserting the register was not run, on a report whose
  // section above it was a table of register counts the same run had taken.
  const inSummary = validators.knockoutAssessChunk(f, chunk([markRow()],
    { chunkSummary: "Note that the register overlay has not been run for these names." }));
  assert.equal(inSummary.ok, false);
  assert.match(inSummary.reason, /knockout_register_claim/);
  assert.match(inSummary.reason, /cannot see the register lane/);

  // The typed fields are new surface for the same invention, so they are swept too.
  for (const over of [
    { basis: "A coined term; the registers were not searched for this name." },
    { factors: ["No seller trades under it.", "Register searches have not been conducted."] },
    { counterFactors: ["The register check was not performed."] },
    // A FORWARD-LOOKING clause is refused too, and that is the deliberate reading rather than an
    // over-catch: "once the registers are checked" presupposes that they were not, which on every
    // Knockout this build sells is false — the counts ran. It is the same invention in the future tense.
    { mitigation: "Once the registers are checked this may move." },
  ]) {
    const r = validators.knockoutAssessChunk(f, chunk([markRow(over)]));
    assert.equal(r.ok, false, `${JSON.stringify(over).slice(0, 60)}: must be refused`);
    assert.match(r.reason, /knockout_register_claim/);
  }
});

test("the ban does not fire on the standing caveat the merged gate requires", () => {
  assert.doesNotMatch("Ratings reflect our common law assessment. Register analysis may adjust ratings in either direction.",
    REGISTER_CLAIM_RE, "the two rules would otherwise be unsatisfiable together");
  assert.doesNotMatch("Source: EUIPO register, application 018765432.", REGISTER_CLAIM_RE,
    "naming a register as the source of a filing is something the turn does know");
  assert.match("the register overlay has not been run", REGISTER_CLAIM_RE);
  assert.match("register searches were not performed", REGISTER_CLAIM_RE);
});

test("the merged artifact is swept too — a resume can compose from chunks written before this rule", () => {
  const d = runDirWith({ research: { IRONWHISK: "payload" } });
  const merged = {
    schema_version: 1,
    batch: { executiveSummary: "IRONWHISK rates Manageable. The register overlay has not been run.",
      standardCaveats: ["Register analysis may adjust ratings in either direction."] },
    marks: [markRow()],
  };
  const r = validateMergedFindings(d, merged, { marks: [{ name: "IRONWHISK" }] });
  assert.equal(r.ok, false);
  assert.ok(r.failures.some((f) => /knockout_register_claim/.test(f)),
    "the executive summary is where the reader meets it first");
});

// ── what reaches the page ────────────────────────────────────────────────────────────────────────────

const RENDER = (marks, over = {}) => renderKnockoutHtml({ marks, batch: { executiveSummary: "s" } }, FW, {
  runId: "r", overall: "Manageable", identity: { identity: "Knockout search" }, ...over,
});

test("the read renders as STRUCTURE — chip, basis, tight bullets, and the two qualifiers visually apart", () => {
  const html = RENDER([markRow()]);
  assert.match(html, /class="ko-basisline"/, "the basis leads the card");
  assert.match(html, /class="ko-counter"/, "counter-factors are their own block");
  assert.match(html, /What holds it there/);
  assert.match(html, /class="ko-mitig"/, "mitigation is visually distinct");
  assert.match(html, /What would move it/);
  // Every factor is its own <li> — the wall is gone because the emission changed, not because a
  // renderer split a paragraph on full stops.
  for (const f of markRow().factors) assert.ok(html.includes(f), `factor on the page: ${f.slice(0, 30)}`);
  assert.match(html, /class="ko-band"/, "the rating chip is still the head of the card");
  assert.match(html, /Classes 8/, "…with the classes beside it");
});

test("NOTHING IS DISCARDED — prose bullets survive under the full narrative", () => {
  const html = RENDER([markRow()]);
  assert.match(html, /<details class="ko-full"><summary>Full narrative<\/summary>/);
  assert.ok(html.includes("Scattered informal uses"), "the sentence the stage wrote is still on the page");
});

test("an ARCHIVED run has none of these fields and re-renders exactly as it was delivered", () => {
  const legacy = markRow();
  for (const f of READ_FIELDS) delete legacy[f];
  const html = RENDER([legacy]);
  assert.doesNotMatch(html, /class="ko-basisline"/, "no section it never had");
  assert.doesNotMatch(html, /class="ko-mitig"/);
  assert.doesNotMatch(html, /Full narrative/, "and no empty disclosure wrapper around the only prose it has");
  assert.ok(html.includes("Scattered informal uses"), "its bullets render as they always did");
});

// ── the register sentence, owned by the renderer ─────────────────────────────────────────────────────

test("the register line comes from the SIDECAR, and says a different thing in each of the four states", () => {
  const counts = (over) => ({
    schema: 1, provider: "corsearch", providerLabel: "Corsearch", basis: "b",
    marks: [{ name: "IRONWHISK", classes: [8], classScope: "mark", counts: over }],
  });
  // 1 — counted. The code-owned line, scope first, identical to the glance line's wording.
  const counted = RENDER([markRow()], { registerCounts: counts({ identical: { total: 3 }, containing: { total: 41 }, close: { total: 5 } }), probeRan: true });
  assert.match(counted, /class="ko-reg"/);
  // COVERAGE, not a third printing of the figures: they are already in the glance line and in the counts
  // table above this section, and a card that repeats them is a card a reader skips.
  assert.match(counted, /hit-counts were taken for this name in class 8 — the figures are in the counts table above/);
  const cards = counted.slice(counted.indexOf("On-field conflicts"));
  assert.equal((cards.match(/3 identical, 41 containing/g) ?? []).length, 0,
    "the numbers are stated once, where they belong");

  // 2 — the probe ran and every figure failed. A gap in this run, named as one.
  const failed = RENDER([markRow()], { registerCounts: counts({ identical: { total: null, unavailable: "HTTP 502" } }), probeRan: true });
  assert.match(failed, /no count could be taken for this name/);

  // 3 — the product includes counts and the lane produced no sidecar at all.
  const none = RENDER([markRow()], { registerCounts: null, probeRan: true });
  assert.match(none, /hit-counts are part of this search and none could be taken/);

  // 4 — a replay of a product that never bought the probe.
  const tier = RENDER([markRow()], { registerCounts: null, probeRan: false });
  assert.match(tier, /not included in this product tier/);

  // …and in NO state does the model's own prose decide it: the fields above carry no register sentence,
  // and the validator refuses one that does.
  assert.ok(!markRow().basis.match(REGISTER_CLAIM_RE));
});

test("zero change to rating logic — the band, the qualifier and the classes are read, never re-derived", () => {
  // The scope guard, as a test. This issue is presentation and contract; nothing here may touch the
  // judgment inside the summary, so the rendered band is exactly the one the row carries.
  const html = RENDER([markRow({ rating: "Blocking", ratingQualifier: "low", classesDriving: [8, 21] })]);
  assert.match(html, />Blocking</);
  // — the VALUE is still read, never re-derived; what changed is that the page now says what it
  // means. The bare token this used to pin (`>low<`) was one word of a private vocabulary under a chip,
  // and no reader could decode whether it described the risk, the confidence or the search.
  assert.match(html, /class="ko-qual">at the low end of this band</,
    "the qualifier is written in words beside the band it caps");
  assert.doesNotMatch(html, /class="ko-qual">low</, "and never as the bare unlabelled token");
  // and a row whose typed read is complete still renders the band it was given, not one inferred from
  // how many factors it happens to carry
  const many = RENDER([markRow({ rating: "Low", factors: ["a", "b", "c", "d"] })]);
  assert.match(many, />Low</);
});
