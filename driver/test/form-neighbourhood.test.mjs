// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
import { test } from "node:test";
import assert from "node:assert/strict";
import { termPredicateIssue } from "../../providers/_shared/term-shape.mjs";
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

// ── A VOWEL-LESS ELEMENT MUST NOT COMPILE A WILDCARD ENTRY CARRYING NO WILDCARD ──────────────────────
//
// The observed failure: a production clearance whose dominant element had no vowel died at
// `register-plan` with `failClass: deterministic` and delivered nothing. The vowel-slot loop has no run
// to replace, so it returned the element itself; the fringe pushes every member under a hard-coded
// `wildcard` predicate; the freeze lint reads that pair as unexecutable and the pipeline throws on a
// freshly minted plan. Retrying could not help, and every released version carries it.
//
// BOTH HALVES OF THE CLASS ARE DRIVEN HERE. Asserting only that the initialisms are fixed would pass
// just as well if the function had been made to return nothing at all, which would delete the axis for
// every mark. The keepers are the control: their patterns are pinned to the exact strings the generator
// emits today, so a change that quietly narrows retrieval reds here rather than shipping.
const NO_VOWEL = ["SMS", "BCG", "KFC", "HSBC", "TSB", "NRJ", "XLR8", "X", "H&M", "3M", "MTV", "BBC", "CNN"];
const KEEPS_ITS_PATTERNS = {
  AI: ["?"],
  SKY: ["sk?", "s*k"],
  DKNY: ["dkn?", "d*n"],
  VELTRIN: ["v?ltr?n", "v*n"],
  PARADISE: ["p?r?d?s?", "p*s"],
};

test("no element compiles a wildcard pattern carrying neither * nor ? — the vowel-less class", () => {
  for (const el of NO_VOWEL) {
    const pats = skeletonPatterns(el);
    const unexecutable = pats.filter((pat) => termPredicateIssue(pat, "wildcard"));
    assert.deepEqual(unexecutable, [],
      `${el}: every emitted pattern must survive the freeze lint under the wildcard predicate`);
  }
  // THE FLOOR. Twelve of the thirteen still yield their anchored skeleton, so this table is not passing
  // by returning nothing — only `X`, which normalizes to one character, has no consonant pair to anchor.
  const stillProductive = NO_VOWEL.filter((el) => skeletonPatterns(el).length > 0);
  assert.equal(stillProductive.length, NO_VOWEL.length - 1,
    "the fix must drop the degenerate pattern, not the axis: only the single-character element goes empty");
  assert.deepEqual(skeletonPatterns("X"), []);
  assert.deepEqual(skeletonPatterns("SMS"), ["s*s"]);
});

test("an element WITH vowels keeps the exact patterns it emits today — the control on the fix", () => {
  for (const [el, expected] of Object.entries(KEEPS_ITS_PATTERNS)) {
    assert.deepEqual(skeletonPatterns(el), expected, `${el}: retrieval must be unchanged`);
    assert.deepEqual(skeletonPatterns(el).filter((pat) => termPredicateIssue(pat, "wildcard")), [],
      `${el}: and still executable`);
  }
});

test("an empty phonetic family reads as COMPLETE and is disclosed, never as an unreached family", () => {
  // The half of this that is client-facing. If an element with no retrieval pattern read as a gap, the
  // coverage ledger would report the phonetic family unsearched for a matter where there was nothing to
  // search — a false gap in a client's report.
  const bandX = formNeighbourhood("X");
  assert.deepEqual(bandX.wildcardPatterns, []);
  const gX = coverageGaps(bandX, { dispatched: [...bandX.exactQueries] });
  assert.equal(gX.complete, true, "no pattern to dispatch ⇒ the axis cannot be incomplete");
  assert.deepEqual(formGapDirectives([{ element: "X", band: bandX }], { dispatched: [...bandX.exactQueries] }), []);

  // AND THE INSTRUMENT IS NOT BLIND. An element that DOES emit patterns, with none of them dispatched,
  // still fires the unreached-family directive — so the pass above is a result, not a guard that never
  // speaks. Without this the arm would pass equally if coverage had stopped reading the axis at all.
  const bandZ = formNeighbourhood("ZURENA");
  assert.ok(bandZ.wildcardPatterns.length > 0);
  const gZ = coverageGaps(bandZ, { dispatched: [...bandZ.exactQueries] });
  assert.equal(gZ.complete, false);
  assert.equal(formGapDirectives([{ element: "ZURENA", band: bandZ }], { dispatched: [...bandZ.exactQueries] }).length, 1);

  // NOTHING GOES QUIET: the ledger row says the axis produced no pattern, in the voice it uses for an
  // axis judgment dropped, and says the metaphone keys still verify — rather than reading as ordinary.
  const row = bandX.ledger.axes.find((a) => a.axis === "phonetic-family");
  assert.equal(row.count, 0);
  assert.match(row.mechanism, /NO PATTERN/);
  assert.match(row.mechanism, /Double-Metaphone key\(s\) \[[^\]]+\] still verify/,
    "X's keys are NOT empty, and the row must not call the whole axis dead");

  // ── THE OTHER MEMBER OF THE SAME CLASS, WHICH THE FIRST DRAFT OF THIS ARM DID NOT DRIVE ───────────
  //
  // Pinning X alone made this arm name the disclosure property and test one member of it. A purely
  // numeric element has no pattern AND no metaphone key, and the row shipped
  // "Double-Metaphone key(s) [] still verify what the other axes return" — a client-facing claim of a
  // verification that did not happen, which is a worse failure than the silence it was written to
  // prevent. Both members are driven here now, and they must land DIFFERENTLY: an arm where every
  // member gets the same answer is a claim, not a test.
  const bandNum = formNeighbourhood("99");
  assert.deepEqual(bandNum.wildcardPatterns, []);
  assert.deepEqual(bandNum.phoneticKeys, [], "the premise: this element has no keys either");
  const rowNum = bandNum.ledger.axes.find((a) => a.axis === "phonetic-family");
  assert.match(rowNum.mechanism, /NO PATTERN/, "same third state as X");
  assert.doesNotMatch(rowNum.mechanism, /still verify/,
    "with no keys there is nothing verifying, and the row must not say there is");
  assert.match(rowNum.mechanism, /verifies nothing/, "and it says so rather than falling silent");
  assert.notEqual(rowNum.mechanism, row.mechanism,
    "the two members of the no-pattern class are disclosed differently — otherwise this arm is a claim");
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
