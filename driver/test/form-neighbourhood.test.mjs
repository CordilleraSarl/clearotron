// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeElement, foldDiacritics, radiusFor, editNeighbourhood, consonantSkeleton,
  skeletonPatterns, visualConfusables, confusableSkeleton, transliterations,
  formNeighbourhood, coverageGaps, SUPPORTED_SCRIPTS,
  renderFormNeighbourhoodJson, parseFormNeighbourhoodJson, dispatchedQueriesFromBand, formGapDirectives,
} from "../form-neighbourhood.mjs";

test("normalizeElement folds diacritics + special letters, strips non-alnum, lowercases", () => {
  assert.equal(normalizeElement("Süßen!"), "sussen");
  assert.equal(normalizeElement("Café-Noir"), "cafenoir");
  assert.equal(normalizeElement("  ZURENA  "), "zurena");
});

test("foldDiacritics handles accents and non-decomposable special letters", () => {
  assert.equal(foldDiacritics("café"), "cafe");
  assert.equal(foldDiacritics("Zürich"), "Zurich");
  assert.equal(foldDiacritics("naïve"), "naive");
  assert.equal(foldDiacritics("Straße"), "Strasse");
  assert.equal(foldDiacritics("Mølyø"), "Molyo");
});

test("editNeighbourhood: the whole ZURENA miss-class is mechanically present (edit-1)", () => {
  const n = new Set(editNeighbourhood("ZURENA"));
  // the lawyer's edit-1 conflicts the run never generated:
  assert.ok(n.has("kurena"), "KURENA (z→m substitution) must be present");
  assert.ok(n.has("zirena"), "ZIRENA (u→i substitution)");
  assert.ok(n.has("zuena"),  "ZUENA (delete r)");
  assert.ok(n.has("zureka"), "ZUREKA (n→k substitution)");
  assert.ok(n.has("turena"), "TURENA (the one the model DID think of) is also present");
  // the original is never in its own neighbourhood
  assert.ok(!n.has("zurena"));
  // TURENA-yes / KURENA-no asymmetry is impossible: both are single substitutions ⇒ both present or neither.
  assert.equal(n.has("turena"), n.has("kurena"));
});

test("editNeighbourhood is deterministic, sorted, deduped", () => {
  const a = editNeighbourhood("fenriq");
  const b = editNeighbourhood("FENRIQ");
  assert.deepEqual(a, b, "model-free: same element ⇒ identical set (the acid test)");
  assert.deepEqual(a, [...a].sort(), "sorted");
  assert.equal(a.length, new Set(a).size, "deduped");
});

test("radiusFor is length-normalized and discloses crowd-risk (never silently cuts)", () => {
  assert.equal(radiusFor("zumo").crowdRisk, "high");       // 4 letters → dense edit-1
  assert.equal(radiusFor("zurena").crowdRisk, "moderate"); // 6
  assert.equal(radiusFor("bioveltrin").crowdRisk, "low");  // 10 → sparse
  assert.equal(radiusFor("anything").editRadius, 1);
  assert.match(radiusFor("zumo").note, /edit-2 NOT brute-enumerated/);
});

test("consonantSkeleton + skeletonPatterns retrieve the phonetic vowel family", () => {
  assert.equal(consonantSkeleton("ZURENA"), "zrn");
  assert.equal(consonantSkeleton("anna"), "n");      // doublings collapse
  const pats = skeletonPatterns("zurena");
  assert.ok(pats.includes("z?r?n?"), "vowel-slot wildcard for ZYRONA/ZIRINA-class");
});

test("visualConfusables + confusableSkeleton fold look-alikes", () => {
  assert.equal(confusableSkeleton("M0DERN"), "modem"); // 0→o, rn→m
  assert.equal(confusableSkeleton("c1ar0"), "daro");   // 1→l, cl→d, 0→o
  const v = visualConfusables("solo");
  assert.ok(v.includes("s0lo") || v.includes("sol0"), "digit homoglyph swap present");
  assert.ok(!v.includes("solo"), "original excluded");
});

test("transliterations are scoped + disclosed, exclude the original", () => {
  const t = transliterations("zurena");
  assert.ok(Array.isArray(t) && t.length > 0);
  assert.ok(!t.includes("zurena"));
  assert.deepEqual(SUPPORTED_SCRIPTS, ["latin-diacritic", "german", "nordic", "cyrillic-homoglyph", "greek-homoglyph"]);
});

test("formNeighbourhood: machine-defined band, model-free, with a disclosed ledger", () => {
  const band = formNeighbourhood("ZURENA", { markets: ["CH", "EU", "US", "UK"] });
  assert.equal(band.element, "zurena");
  assert.ok(band.exactQueries.includes("kurena"), "the band DEFINES KURENA — not the model");
  assert.ok(band.wildcardPatterns.includes("z?r?n?"));
  assert.equal(band.ledger.axes.length, 4, "edit-1 / phonetic-family / visual-confusable / transliteration");
  assert.ok(band.ledger.total_exact > 200, "complete edit-1+ band");
  assert.ok(typeof band.ledger.disclosed === "string" && band.ledger.disclosed.length > 0);
  // ablation: regenerating gives the identical band (no model in the loop)
  assert.deepEqual(formNeighbourhood("zurena", { markets: [] }).exactQueries, band.exactQueries);
});

test("coverageGaps: completeness (NOT sufficiency) — a generated near-form never dispatched is a gap", () => {
  const band = formNeighbourhood("ZURENA");
  // dispatch everything EXCEPT kurena → kurena is an open completeness gap
  const dispatched = band.exactQueries.filter((q) => q !== "kurena").concat(band.wildcardPatterns);
  const g = coverageGaps(band, { dispatched });
  assert.ok(g.missingExact.includes("kurena"));
  assert.equal(g.complete, false);
  // dispatch all + the family ⇒ clean
  const full = coverageGaps(band, { dispatched: band.exactQueries.concat(band.wildcardPatterns) });
  assert.equal(full.complete, true);
  // an EXPLAINED absence (reopen-triggered) is not a gap
  const excused = coverageGaps(band, { dispatched: dispatched, explained: [{ form: "kurena", reopen: "provider rejected the OR-batch" }] });
  assert.equal(excused.complete, true);
});

const SAMPLE_MANIFEST = `
## Matter
### Distinctiveness & registrability
- **Dominant element:** ZURENA (the distinctive anchor)
- **Formative root:** SUREN
### Variants
| Category | Value | Rationale | Verify? |
|---|---|---|---|
| exact-element | ZURENA | anchor | |
`;

test("renderFormNeighbourhoodJson: model picks the element, MACHINE generates its neighbourhood", () => {
  const json = renderFormNeighbourhoodJson(SAMPLE_MANIFEST, { markets: ["CH", "EU", "US", "UK"] });
  const o = JSON.parse(json);
  assert.equal(o.schema_version, 2);
  const dom = o.elements.find((e) => e.role === "dominant");
  assert.equal(dom.element, "zurena");
  assert.ok(dom.band.exactQueries.includes("kurena"), "the MACHINE band defines KURENA");
  assert.ok(o.elements.some((e) => e.role === "formative-root" && e.element === "suren"), "formative root widens the net");
  assert.ok(typeof o.disclosed_radius === "string" && o.disclosed_radius.length > 0, "radius is disclosed");
});

test("renderFormNeighbourhoodJson throws when no distinctive element is named (caller never-kills)", () => {
  assert.throws(() => renderFormNeighbourhoodJson("## no dominant element here\n"), /form_neighbourhood_no_element/);
});

test("parseFormNeighbourhoodJson round-trips and is tolerant of garbage", () => {
  const els = parseFormNeighbourhoodJson(renderFormNeighbourhoodJson(SAMPLE_MANIFEST));
  assert.ok(els.length >= 1 && els[0].band.exactQueries.length > 0);
  assert.deepEqual(parseFormNeighbourhoodJson("{not json"), []);
});

test("dispatchedQueriesFromBand extracts searched names + phonetic variants + wildcards", () => {
  const band = JSON.stringify([
    { state: "enumerated", query: "=name:`KURENA` nice-class:`9`", total_hits: 3, records: [] },
    { state: "enumerated", query: "*name:`ZURENA`(sirena,syrona) nice-class:`9`", total_hits: 5, records: [] },
    { state: "incomplete", query: "name:`s?r?n?` nice-class:`9`", total_hits: 9000 },
  ]);
  const d = dispatchedQueriesFromBand(band).map((s) => s.toLowerCase());
  assert.ok(d.includes("kurena") && d.includes("zurena") && d.includes("sirena") && d.includes("syrona"));
  assert.ok(d.includes("s?r?n?"), "wildcard pattern retained");
  assert.deepEqual(dispatchedQueriesFromBand("{bad"), []);
});

test("formGapDirectives: a generated near-form never dispatched becomes a variant directive (the regrounding)", () => {
  const els = parseFormNeighbourhoodJson(renderFormNeighbourhoodJson(SAMPLE_MANIFEST));
  // dispatched everything except KURENA + the family → a targeted variant directive for KURENA
  const all = els[0].band.exactQueries;
  const dispatched = all.filter((q) => q !== "kurena").concat(els[0].band.wildcardPatterns);
  const dirs = formGapDirectives(els, { dispatched });
  assert.ok(dirs.some((d) => d.layer === "variant" && d.item === "kurena" && d.severity === "material"));
  // dispatch nothing → a SYSTEMIC directive per element, not hundreds
  const systemic = formGapDirectives(els, { dispatched: [] });
  assert.ok(systemic.length < 12, "systemic non-dispatch collapses to a summary, never floods");
  assert.ok(systemic.some((d) => /form-neighbourhood|phonetic family/.test(d.item)));
  // full dispatch across ALL elements (dominant + formative-root) → no directives
  const allEls = els.flatMap((e) => e.band.exactQueries.concat(e.band.wildcardPatterns));
  assert.deepEqual(formGapDirectives(els, { dispatched: allEls }), []);
});

test("REGRESSION: oracle reads the MERGED {enumerated,crowds} band shape; a complete run fires NO phantom gap", () => {
  const els = parseFormNeighbourhoodJson(renderFormNeighbourhoodJson(SAMPLE_MANIFEST));
  const allExact = els.flatMap((e) => e.band.exactQueries);
  const allWild = els.flatMap((e) => e.band.wildcardPatterns);
  // the funnel OR-stacked the full exact band into one enumerated `_query` and ran each skeleton wildcard as a crowd
  const orStacked = allExact.map((n) => `name:\`${n}\``).join(" ") + " nice-class:`9`";
  const merged = JSON.stringify({
    enumerated: [{ record_id: "/x/1", mark_text: "KURENA", _query: orStacked }],
    crowds: allWild.map((w) => ({ query: `name:\`${w}\` nice-class:\`9\``, total_hits: 9000, fetched: 1, sample: [], reason: "crowd" })),
  });
  const dispatched = dispatchedQueriesFromBand(merged);
  assert.ok(dispatched.map((s) => s.toLowerCase()).includes("kurena"), "merged-shape `_query` name clauses extracted");
  assert.ok(dispatched.some((d) => /[?*]/.test(d)), "the s?r?n? family was extracted from crowds[] (this is the bug that fired phantom gaps)");
  assert.deepEqual(formGapDirectives(els, { dispatched }), [], "a COMPLETE run produces zero directives — no phantom CONDITIONAL clamp");
  // a returned mark_text counts as dispatched even when it is not echoed in any query text
  const viaMarkText = dispatchedQueriesFromBand(JSON.stringify({ enumerated: [{ mark_text: "ZURENA", _query: "name:`x`" }], crowds: [] }));
  assert.ok(viaMarkText.map((s) => s.toLowerCase()).includes("zurena"), "a returned mark_text proves its name was in the searched band");
});

test("held-out generality (NOT ZURENA): the mechanism surfaces differently-shaped neighbours, no word-list", () => {
  // (1) coined mark whose risk is a single-consonant swap onto a REAL word — caught by edit-1, nobody named it
  assert.ok(new Set(formNeighbourhood("KLARITY").exactQueries).has("clarity"), "K→C swap surfaces 'clarity' mechanically");
  // (2) a near-form that carries a subcultural connotation is FED to the connotation axis as a candidate
  const b2 = formNeighbourhood("SURENO");
  assert.ok(new Set(b2.exactQueries).has("sureno".replace("o", "a")) || b2.exactQueries.length > 150, "the form band is complete (the connotation screen searches its real-word near-forms)");
  // (3) longer mark: complete, deterministic, model-free (the acid test on a different mark)
  const b3 = formNeighbourhood("LUMENGARDE");
  assert.deepEqual(formNeighbourhood("lumengarde").exactQueries, b3.exactQueries, "ablation: identical band, no model in the loop");
  assert.ok(new Set(b3.exactQueries).has("lumengard"), "edit-1 (final-letter deletion) present");
  // (4) radius is disclosed for EVERY mark (no silent cutoff)
  for (const m of ["klarity", "sureno", "lumengarde", "zumo"]) assert.ok(radiusFor(m).note.length > 0);
});
