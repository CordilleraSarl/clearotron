// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
import { test } from "node:test";
import assert from "node:assert/strict";
import { termPredicateIssue } from "../../providers/_shared/term-shape.mjs";
import {
  normalizeElement, foldDiacritics, radiusFor, editNeighbourhood, consonantSkeleton,
  skeletonPatterns, visualConfusables, confusableSkeleton, transliterations,
  formNeighbourhood, SUPPORTED_SCRIPTS,
  renderFormNeighbourhoodJson, parseFormNeighbourhoodJson,
} from "../form-neighbourhood.mjs";

test("normalizeElement folds diacritics + special letters, strips non-alnum, lowercases", () => {
  assert.equal(normalizeElement("Süßen!"), "sussen");
  assert.equal(normalizeElement("Café-Noir"), "cafenoir");
  assert.equal(normalizeElement("  ZOLEMA  "), "zolema");
});

test("foldDiacritics handles accents and non-decomposable special letters", () => {
  assert.equal(foldDiacritics("café"), "cafe");
  assert.equal(foldDiacritics("Zürich"), "Zurich");
  assert.equal(foldDiacritics("naïve"), "naive");
  assert.equal(foldDiacritics("Straße"), "Strasse");
  assert.equal(foldDiacritics("Mølyø"), "Molyo");
});

test("editNeighbourhood: the whole ZOLEMA miss-class is mechanically present (edit-1)", () => {
  const n = new Set(editNeighbourhood("ZOLEMA"));
  // the lawyer's edit-1 conflicts the run never generated:
  assert.ok(n.has("kolema"), "KOLEMA (z→k substitution) must be present");
  assert.ok(n.has("zilema"), "ZILEMA (o→i substitution)");
  assert.ok(n.has("zoema"),  "ZOEMA (delete l)");
  assert.ok(n.has("zoleka"), "ZOLEKA (m→k substitution)");
  assert.ok(n.has("tolema"), "TOLEMA (the one the model DID think of) is also present");
  // the original is never in its own neighbourhood
  assert.ok(!n.has("zolema"));
  // TOLEMA-yes / KOLEMA-no asymmetry is impossible: both are single substitutions ⇒ both present or neither.
  assert.equal(n.has("tolema"), n.has("kolema"));
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
  assert.equal(radiusFor("zolema").crowdRisk, "moderate"); // 6
  assert.equal(radiusFor("bioveltrin").crowdRisk, "low");  // 10 → sparse
  assert.equal(radiusFor("anything").editRadius, 1);
  assert.match(radiusFor("zumo").note, /edit-2 NOT brute-enumerated/);
});

test("consonantSkeleton + skeletonPatterns retrieve the phonetic vowel family", () => {
  assert.equal(consonantSkeleton("ZOLEMA"), "zlm");
  assert.equal(consonantSkeleton("anna"), "n");      // doublings collapse
  const pats = skeletonPatterns("zolema");
  assert.ok(pats.includes("z?l?m?"), "vowel-slot wildcard for ZYLOMA/ZILIMA-class");
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
//
// COINED STRINGS, NOT REAL MARKS. The reported class is initialisms, and the obvious table is famous
// ones — but this repository is public and permanently indexed, and a trademark clearance product
// listing live third-party marks in its own fixtures is the wrong artefact to leave behind. The
// property under test is purely structural (does the element contain a vowel), so invented strings
// exercise it exactly as well. Each member below is shaped like the real case it stands in for:
// three-consonant, four-consonant, consonant-plus-digit, single character, and ampersand/digit forms
// that normalize down to two consonants.
const NO_VOWEL = ["ZMS", "BCG", "KFQ", "HSBQ", "TSV", "NRJ", "XLR8", "Z", "H&Q", "3Q", "MTV", "BQC", "CNN"];
const KEEPS_ITS_PATTERNS = {
  AI: ["?"],
  ZKY: ["zk?", "z*k"],
  DQNY: ["dqn?", "d*n"],
  VELTRIN: ["v?ltr?n", "v*n"],
  HAVENSIDE: ["h?v?ns?d?", "h*d"],
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
  assert.deepEqual(skeletonPatterns("Z"), []);
  assert.deepEqual(skeletonPatterns("ZMS"), ["z*s"]);
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
  // The control: an element that DOES emit patterns emits them, so the empty list above is a result.
  assert.ok(formNeighbourhood("ZOLEMA").wildcardPatterns.length > 0);

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
  const t = transliterations("zolema");
  assert.ok(Array.isArray(t) && t.length > 0);
  assert.ok(!t.includes("zolema"));
  assert.deepEqual(SUPPORTED_SCRIPTS, ["latin-diacritic", "german", "nordic", "cyrillic-homoglyph", "greek-homoglyph"]);
});

test("formNeighbourhood: machine-defined band, model-free, with a disclosed ledger", () => {
  const band = formNeighbourhood("ZOLEMA", { markets: ["CH", "EU", "US", "UK"] });
  assert.equal(band.element, "zolema");
  assert.ok(band.exactQueries.includes("kolema"), "the band DEFINES KOLEMA — not the model");
  assert.ok(band.wildcardPatterns.includes("z?l?m?"));
  assert.equal(band.ledger.axes.length, 4, "edit-1 / phonetic-family / visual-confusable / transliteration");
  assert.ok(band.ledger.total_exact > 200, "complete edit-1+ band");
  assert.ok(typeof band.ledger.disclosed === "string" && band.ledger.disclosed.length > 0);
  // ablation: regenerating gives the identical band (no model in the loop)
  assert.deepEqual(formNeighbourhood("zolema", { markets: [] }).exactQueries, band.exactQueries);
});

const SAMPLE_MANIFEST = `
## Matter
### Distinctiveness & registrability
- **Dominant element:** ZOLEMA (the distinctive anchor)
- **Formative root:** VOLEM
### Variants
| Category | Value | Rationale | Verify? |
|---|---|---|---|
| exact-element | ZOLEMA | anchor | |
`;

test("renderFormNeighbourhoodJson: model picks the element, MACHINE generates its neighbourhood", () => {
  const json = renderFormNeighbourhoodJson(SAMPLE_MANIFEST, { markets: ["CH", "EU", "US", "UK"] });
  const o = JSON.parse(json);
  assert.equal(o.schema_version, 2);
  const dom = o.elements.find((e) => e.role === "dominant");
  assert.equal(dom.element, "zolema");
  assert.ok(dom.band.exactQueries.includes("kolema"), "the MACHINE band defines KOLEMA");
  assert.ok(o.elements.some((e) => e.role === "formative-root" && e.element === "volem"), "formative root widens the net");
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

test("held-out generality (NOT ZOLEMA): the mechanism surfaces differently-shaped neighbours, no word-list", () => {
  // (1) coined mark whose risk is a single-consonant swap onto a REAL word — caught by edit-1, nobody named it
  assert.ok(new Set(formNeighbourhood("KLARITY").exactQueries).has("clarity"), "K→C swap surfaces 'clarity' mechanically");
  // (2) a near-form that carries a subcultural connotation is FED to the connotation axis as a candidate
  const b2 = formNeighbourhood("VELANO");
  assert.ok(new Set(b2.exactQueries).has("velano".replace("a", "e")) || b2.exactQueries.length > 150, "the form band is complete (the connotation screen searches its real-word near-forms)");
  // (3) longer mark: complete, deterministic, model-free (the acid test on a different mark)
  const b3 = formNeighbourhood("LUMENGARDE");
  assert.deepEqual(formNeighbourhood("lumengarde").exactQueries, b3.exactQueries, "ablation: identical band, no model in the loop");
  assert.ok(new Set(b3.exactQueries).has("lumengard"), "edit-1 (final-letter deletion) present");
  // (4) radius is disclosed for EVERY mark (no silent cutoff)
  for (const m of ["klarity", "velano", "lumengarde", "zumo"]) assert.ok(radiusFor(m).note.length > 0);
});
