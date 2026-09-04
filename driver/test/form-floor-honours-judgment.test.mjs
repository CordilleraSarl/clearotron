// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The form floor honours judgment's scope decisions, and stops dispatching queries that are the same query.
//
// Fixtures are the REAL 2026-07-17 failures:
//   Drivers Haven — five diacritic forms of PARADISE dispatched as distinct terms, each returning the same
//                     424 hits, all five left `unenumerated` on budget; the coverage gate then blocked
//                     delivery six times. Its scope ledger had ALREADY dropped phonetic/visual/numeric.
//   AquaPlus       — the prose parse swallowed a sentence into the dominant element, and the resulting
//                     pseudo-element `hydrathestemafamilyofmarksshares` drew 1,736 junk exact queries.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formNeighbourhood, dedupeOnFold, isStemOfNamedElement, renderFormNeighbourhoodJson, foldDiacritics,
} from "../form-neighbourhood.mjs";
import { droppedVariantFamilies, parseScopeLedgerJson } from "../scope-ledger.mjs";

// ── the ledger selector ────────────────────────────────────────────────────────────────────────────────
// Verbatim rows from Drivers Haven's own scope-ledger.json.
const RACERS_LEDGER = parseScopeLedgerJson(JSON.stringify([
  { layer: "variant", item: "exact-phrase", status: "applied", reason: "the compound-phrase hit is the primary risk vector" },
  { layer: "variant", item: "formative-family", status: "applied", reason: "4 sweeps" },
  { layer: "variant", item: "foreign-transliteration", status: "applied", reason: "9 rows across ZH / JP / KR / AR / CY / Devanagari" },
  { layer: "variant", item: "phonetic", status: "dropped", reason: "a sound-alike of a saturated common-word compound is itself made of common words with no distinctive owner to confuse (collision-plausibility, NOT noise) — form floor still machine-generated" },
  { layer: "variant", item: "visual-substitution", status: "dropped", reason: "a typographic look-alike of two common words is more common words" },
  { layer: "variant", item: "numeric-substitution", status: "dropped", reason: "saturated common-word mark, no squatter/leet incentive" },
  { layer: "jurisdiction", item: "US", status: "applied", reason: "instructed" },
  { layer: "field", item: "gaming/computing (cl. 9/28/41/42)", status: "applied", reason: "the product's own goods" },
  { layer: "field", item: "AI / ML-infra (cl. 9/42)", status: "dropped", reason: "off-field" },
]));

test("droppedVariantFamilies reads the variant layer judgment already writes", () => {
  // phonetic + visual map to axes; foreign-transliteration was APPLIED so the transliteration axis stands.
  assert.deepEqual(droppedVariantFamilies(RACERS_LEDGER), ["phonetic-family", "visual-confusable"]);
});

test("numeric-substitution maps to NO axis — it has no 1:1 floor axis, so it never prunes (fail-open)", () => {
  assert.ok(!droppedVariantFamilies(RACERS_LEDGER).includes("edit-1"));
  assert.ok(!droppedVariantFamilies(RACERS_LEDGER).includes("transliteration"));
});

test("an applied family beats a dropped one — the widening row wins", () => {
  const rows = parseScopeLedgerJson(JSON.stringify([
    { layer: "variant", item: "phonetic", status: "dropped", reason: "x" },
    { layer: "variant", item: "phonetic sound-alike set", status: "applied", reason: "y" },
  ]));
  assert.deepEqual(droppedVariantFamilies(rows), []);
});

test("unrecognised variant items never narrow anything", () => {
  const rows = parseScopeLedgerJson(JSON.stringify([
    { layer: "variant", item: "slogan family-pattern wildcards", status: "dropped", reason: "not a slogan" },
    { layer: "variant", item: "acronym expansion-form", status: "dropped", reason: "not an acronym" },
    { layer: "variant", item: "image / device search", status: "dropped", reason: "wordmark only" },
  ]));
  assert.deepEqual(droppedVariantFamilies(rows), []);
});

test("other layers are never read here — field drops must not reach the form floor", () => {
  const rows = parseScopeLedgerJson(JSON.stringify([
    { layer: "field", item: "phonetic transcription services", status: "dropped", reason: "off-field goods" },
  ]));
  assert.deepEqual(droppedVariantFamilies(rows), []);
});

// ── the diacritic fold: the actual Racers defect ────────────────────────────────────────────────────────
test("the five PARADISE diacritic forms collapse to nothing — they fold onto the element itself", () => {
  const dupes = ["paradisè", "paradisé", "paradisê", "paradisë", "paradiše"];
  for (const d of dupes) assert.equal(foldDiacritics(d).toLowerCase(), "paradise", `${d} folds to the element`);
  assert.deepEqual(dedupeOnFold(dupes, "paradise"), []);
});

test("the form band no longer dispatches a diacritic duplicate of its own element", () => {
  const band = formNeighbourhood("paradise");
  const folded = band.exactQueries.map((q) => foldDiacritics(q).toLowerCase());
  assert.ok(!folded.includes("paradise"), "no query may fold onto the element");
  assert.equal(new Set(folded).size, folded.length, "no two queries may be the same query after folding");
});

test("genuinely distinct respellings survive the fold — this narrows duplicates, never coverage", () => {
  // ß→ss is a real German respelling, not a diacritic duplicate; homoglyph scripts are different strings.
  assert.deepEqual(dedupeOnFold(["paradisse"], "paradise"), ["paradisse"]);
  assert.deepEqual(dedupeOnFold(["раradise"], "paradise"), ["раradise"]);   // Cyrillic р,а
});

test("dedupeOnFold is deterministic and order-stable", () => {
  const a = dedupeOnFold(["zeta", "alpha", "álpha", "beta"], "x");
  assert.deepEqual(a, ["alpha", "beta", "zeta"]);
  assert.deepEqual(a, dedupeOnFold(["beta", "álpha", "alpha", "zeta"], "x"));
});

// ── dropped axes reach the band ────────────────────────────────────────────────────────────────────────
test("dropping phonetic-family removes the wildcards AND the phonetic keys", () => {
  const kept = formNeighbourhood("paradise");
  const dropped = formNeighbourhood("paradise", { droppedAxes: ["phonetic-family"] });
  assert.ok(kept.wildcardPatterns.length > 0);
  assert.deepEqual(dropped.wildcardPatterns, []);
  assert.deepEqual(dropped.phoneticKeys, []);
  assert.match(dropped.ledger.axes.find((a) => a.axis === "phonetic-family").mechanism, /DROPPED/);
});

test("edit-1 is doctrine — it survives every dropped axis", () => {
  const b = formNeighbourhood("paradise", { droppedAxes: ["phonetic-family", "visual-confusable", "transliteration"] });
  assert.equal(b.ledger.axes.find((a) => a.axis === "edit-1").count > 400, true);
  assert.ok(b.exactQueries.length > 400, "the exhaustive edit-1 floor still dispatches");
});

test("the dropped axes are DISCLOSED in the band's ledger, never silent", () => {
  const b = formNeighbourhood("paradise", { droppedAxes: ["visual-confusable"] });
  assert.deepEqual(b.ledger.dropped_axes, ["visual-confusable"]);
});

// ── the prose-parse defect ─────────────────────────────────────────────────────────────────────────────
const HYDRA_PROSE = `## Variant manifest
**Dominant element:** HYDRA — the stem a family of marks shares
**Formative root:** HYDR
`;
const HYDRA_MODEL = {
  schema_version: 1, mark: "AquaPlus", dominant_element: "HYDRA",
  elements: [{ value: "HYDRA", kind: "distinctive" }, { value: "PLUS", kind: "saturated-common" }],
  variants: [{ value: "AquaPlus", category: "core", rationale: "" }], incumbent_classes: [],
};

// The AquaPlus defect: the prose parse captures to the first `.`/`;`/`(`/newline, so
// "**Dominant element:** HYDRA — the stem a family of marks shares" yielded the whole clause and
// normalizeElement compacted it to `hydrathestemafamilyofmarksshares` — a pseudo-element that took a
// full exhaustive edit-1 neighbourhood and put 1,736 junk exact queries on the wire (2026-07-17).
// Preferring the validated json sibling fixed it wherever a sibling exists; closes the arm that
// remained, by refusing any PROSE-derived seed past MAX_SEED_LENGTH. The refusal is recorded, and the
// legitimate formative root still seeds — the fix drops garbage, not coverage.
test("the swallowed prose clause is REFUSED as a seed (the AquaPlus defect, now closed on the prose arm)", () => {
  const out = JSON.parse(renderFormNeighbourhoodJson(HYDRA_PROSE));
  assert.ok(!out.elements.some((e) => e.element === "hydrathestemafamilyofmarksshares"),
    "the swallowed clause never draws a neighbourhood again");
  assert.deepEqual(out.elements.map((e) => e.element), ["hydr"], "the real formative root still seeds");
  assert.ok(out.elements[0].band.exactQueries.length < 400, "and its neighbourhood is element-sized, not 1,736 junk queries");
  assert.match(out.variant_floor.rejected_seeds[0].reason, /exceeds the 24-character seed bound/,
    "the refusal is a recorded finding, never a silent drop");
});

test("the validated model is authoritative — the junk element disappears", () => {
  const out = JSON.parse(renderFormNeighbourhoodJson(HYDRA_PROSE, { model: HYDRA_MODEL }));
  assert.equal(out.elements[0].element, "hydra");
  assert.match(out.seeded_from, /validated/);
  assert.ok(out.elements[0].band.exactQueries.length < 400);
});

test("the legitimate formative root is KEPT — the fix drops garbage, not coverage", () => {
  const out = JSON.parse(renderFormNeighbourhoodJson(HYDRA_PROSE, { model: HYDRA_MODEL }));
  assert.deepEqual(out.elements.map((e) => e.element), ["hydra", "hydr"]);
});

test("a swallowed-sentence formative root is rejected as a non-stem", () => {
  const prose = `**Dominant element:** HYDRA\n**Formative root:** HYDR the shortest stem a HYDRA family shares\n`;
  const out = JSON.parse(renderFormNeighbourhoodJson(prose, { model: HYDRA_MODEL }));
  assert.deepEqual(out.elements.map((e) => e.element), ["hydra"], "only the validated dominant element seeds");
});

test("isStemOfNamedElement accepts real stems and rejects prose artifacts", () => {
  assert.equal(isStemOfNamedElement("HYDR", "HYDRA", HYDRA_MODEL), true);
  assert.equal(isStemOfNamedElement("VENZ", "VENZY", null), true);
  // a real root may differ in its LEADING character — ZURENA→SUREN reaches the ARBORA family. That widening
  // is the whole point of the root, so containment must never be the test.
  assert.equal(isStemOfNamedElement("SUREN", "ZURENA", null), true);
  assert.equal(isStemOfNamedElement("VELTRI", "VELTRIN", null), true);
  assert.equal(isStemOfNamedElement("hydrtheshorteststemahydrafamilyshares", "HYDRA", HYDRA_MODEL), false);
  assert.equal(isStemOfNamedElement("", "HYDRA", HYDRA_MODEL), false);
});

test("no model ⇒ prose fallback still works (never-kill, never worse than before)", () => {
  const out = JSON.parse(renderFormNeighbourhoodJson(`**Dominant element:** VENZY\n`));
  assert.equal(out.elements[0].element, "venzy");
  assert.match(out.seeded_from, /prose fallback/);
});

// ── the two fixes together, on the run that failed ──────────────────────────────────────────────────────
test("Drivers Haven: judgment's drops + the fold materially shrink the dispatched floor", () => {
  const before = formNeighbourhood("paradise");
  const after = formNeighbourhood("paradise", { droppedAxes: droppedVariantFamilies(RACERS_LEDGER) });
  assert.ok(after.exactQueries.length < before.exactQueries.length);
  assert.deepEqual(after.wildcardPatterns, [], "the p*s / p?r?d?s? wildcards are judgment's call, and it said no");
  const folded = after.exactQueries.map((q) => foldDiacritics(q).toLowerCase());
  assert.equal(new Set(folded).size, folded.length);
  assert.ok(!folded.includes("paradise"));
});
