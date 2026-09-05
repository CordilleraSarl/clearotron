// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Item 10 — DECLARE A BAND THE FRAMEWORK DOES NOT DECIDE.
//
// The discipline gave placement's promotion question, one level up. What it is NOT, and these tests
// exist as much to hold that line as to check the parse: it is not a band criterion. A rule of ours that
// decided Very High from High would overwrite the customer's own rating doctrine with ours — the
// rules-engine failure in its most damaging form, because it would look like consistency.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseFindingsJson, bandBorderlineDeclarations } from "../findings-model.mjs";
import { BAND_BORDERLINE_NOTE, STAGES, paths } from "../stages.mjs";

// FIXTURE FROM A REAL ARTIFACT (house rule): lifted from the delivered findings.json of the archived R2
// test run, with the long prose truncated and the owner name replaced by a synthetic one. An
// invented fixture here would certify whatever shape I happened to imagine — the reason the test
// proved nothing. The framework manifest is that run's own house-default ladder.
const MANIFEST = {
  schema_version: 1, framework_key: "house-default", title: "House default", entity_label: "the company",
  bands: [{ label: "Severe" }, { label: "Serious" }, { label: "Moderate" }, { label: "Low" }],
};

const REAL = {
  ordinal: 1, mark: "VENZAL",
  owner: { name: "Muster Handels GmbH & Co. KG", country: "DE", registrations: [
    { uri: "/mark/em/62b18466-be74-44b7-890a-6c50c5ff61af", classes: ["5"], status: "Registered", filed: "1999-12-21", expiry: "2029-12-21", jurisdiction: "EM" },
    { uri: "/mark/gb/dfa7e9c2-f82c-413c-b3e3-b9c8bd6b9304", classes: ["5"], status: "Registered", filed: "1999-12-21", expiry: "2029-12-21", jurisdiction: "GB" },
  ] },
  band: "Moderate", disposition: "adversarial",
  legal_position: "The marks share VENZ, the whole distinctive root of a coined word.",
  practical_position: "The proprietor sits in the same corporate group as an active enforcer.",
  meters: {
    mark_similarity: { token: "medium", basis: "verified-from-record", source: "/mark/em/62b18466-be74-44b7-890a-6c50c5ff61af" },
    goods_proximity: { token: "high", basis: "verified-from-record", source: "/mark/em/62b18466-be74-44b7-890a-6c50c5ff61af" },
    use: { token: "not-confirmed", basis: "inferred-from-signal", source: "" },
    enforcer: { token: "medium", basis: "inferred-from-signal", source: "" },
  },
  quadrant: { x: 0.95, y: 0.62 },
  source: { source_type: "register-vendor", resolved_link: "https://tm.corsearch.com/mark/em/62b18466-be74-44b7-890a-6c50c5ff61af" },
};

const finding = (over = {}) => ({ ...REAL, ...over });
const doc = (findings) => JSON.stringify({ schema_version: 5, rated_under_framework: "house-default", findings, coverage: [], actions: [] });
const parse = (findings) => parseFindingsJson(doc(findings), { manifest: MANIFEST });

test("item 10 — a declaration names two of the framework's bands and normalises to the deck's casing", () => {
  const out = parse([finding({ borderline_between: ["moderate", "SERIOUS"] })]);
  assert.deepEqual(out.findings[0].borderline_between, ["Moderate", "Serious"],
    "normalised in place like band itself, so every downstream reader sees the deck's own word");
  assert.equal(out.findings[0].band, "Moderate", "the band is still the answer — the declaration does not replace it");
});

test("item 10 — absent is the ordinary case and costs nothing", () => {
  const out = parse([finding()]);
  assert.equal(out.findings[0].borderline_between, undefined, "no field, no ceremony");
  assert.deepEqual(bandBorderlineDeclarations(out.findings), [], "and nothing to report");
});

test("item 10 — the declared band must be ONE of the two it sits between", () => {
  assert.throws(() => parse([finding({ band: "Low", borderline_between: ["Severe", "Serious"] })]),
    /finding_borderline_between_mismatch/,
    "a declaration about two bands the finding did not choose describes some other judgment than the one made");
});

test("item 10 — malformed declarations are refused, each with its own token", () => {
  assert.throws(() => parse([finding({ borderline_between: ["Moderate"] })]), /finding_borderline_between_invalid/, "exactly two");
  assert.throws(() => parse([finding({ borderline_between: ["Moderate", "Moderate"] })]), /finding_borderline_between_invalid/, "a band is not borderline with itself");
  assert.throws(() => parse([finding({ borderline_between: ["Moderate", "Catastrophic"] })]), /finding_borderline_between_invalid/, "a word this framework does not rate in");
  assert.throws(() => parse([finding({ borderline_between: "Moderate/Serious" })]), /finding_borderline_between_invalid/, "not a string");
  assert.throws(() => parse([finding({ band: undefined, disposition: "off-field", borderline_between: ["Moderate", "Serious"] })]),
    /finding_borderline_between_(unrated|invalid)/, "an unrated awareness item has no band and no declaration");
});

test("item 10 — bandBorderlineDeclarations reports count and marks for the round's revert criterion", () => {
  const out = parse([
    finding({ ordinal: 1, mark: "VENZAL", borderline_between: ["Moderate", "Serious"] }),
    finding({ ordinal: 2, mark: "VENZETT" }),
    finding({ ordinal: 3, mark: "VENZAP", band: "Low", borderline_between: ["Moderate", "Low"] }),
  ]);
  const declared = bandBorderlineDeclarations(out.findings);
  assert.deepEqual(declared.map((f) => f.mark), ["VENZAL", "VENZAP"]);
  assert.deepEqual(declared.map((f) => f.borderline_between.join("|")), ["Moderate|Serious", "Moderate|Low"]);
});

// ── the line this must not cross ────────────────────────────────────────────────────────────────────
test("item 10 — the doctrine is a DECLARATION, never a criterion, at both prompt levels", () => {
  const level2 = readFileSync(new URL("../skills/prelim-search/synthesis-rules.md", import.meta.url), "utf8");
  for (const [where, text] of [["BAND_BORDERLINE_NOTE", BAND_BORDERLINE_NOTE], ["synthesis-rules.md", level2]]) {
    assert.match(text, /still give[\s\S]{0,40}band|still.{0,20}give.{0,20}`band`/i, `${where}: band stays mandatory`);
    assert.match(text, /correct professional outcome/i, `${where}: declaring is not a failure`);
    assert.match(text, /never becomes hedge language|never travels into the client's report as hedge language/i,
      `${where}: internal only — the report states the position reached, not the pipeline's confidence`);
  }
  // No threshold, count or numeric rule may appear in the note — the moment one does, we have written
  // the customer's doctrine for them.
  assert.doesNotMatch(BAND_BORDERLINE_NOTE, /\b(threshold|score|points?|at least \d|more than \d|>=|<=)\b/i,
    "a numeric rule here would be our doctrine wearing the customer's vocabulary");
  assert.match(level2, /declaration, not a criterion/i, "the level-2 file says so in as many words");
});

test("item 10 — the synthesis dictation names the optional key (two-level rule: change one level, change both)", () => {
  const P = paths("/r");
  const msg = STAGES.synthesis.message({
    paths: P, job: {}, profile: null,
    framework: { title: "T", framework_key: "house-default", entity_label: "the company", bands: MANIFEST.bands },
  });
  assert.ok(msg.includes("borderline_between"), "the level-1 prompt names the field");
  assert.ok(msg.includes("DECLARE A BAND YOUR FRAMEWORK DOES NOT DECIDE"), "…via the shared note, not a re-typed sentence");
});

// The check the ruling asked for, kept as a test so it cannot rot: a new findings field must not be able
// to reach the client cut. driver/publish/ projects through a strict named whitelist with no object
// spread — this asserts both halves.
test("item 10 — the declaration cannot reach the client cut", () => {
  const src = readFileSync(new URL("../publish/report-data.mjs", import.meta.url), "utf8");
  assert.ok(!src.includes("borderline_between"), "report-data.mjs never names it");
  assert.doesNotMatch(src, /\.\.\.f\b|\.\.\.finding\b/, "…and no object spread could carry it there by accident");
});
