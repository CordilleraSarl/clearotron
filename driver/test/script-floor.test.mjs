// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Item 21 — THE PER-SCRIPT FLOOR. What landed in was a per-CATEGORY floor; this is the per-SCRIPT
// one, and the difference is the point: `transliteration` present is not the same claim as "there is a
// Han rendering here". A manifest can carry three Cyrillic transliterations, satisfy a category floor,
// and state nothing at all for a Chinese-language market in scope — so the conflicting Chinese rendering
// of the same mark sits on the CN register under characters the funnel never asked for, and the report
// reads clean because nothing looked.
//
// Two constraints from the ruling, both tested here:
//   VALIDATES, NEVER GENERATES — the gate refuses and the stage regenerates. Code must never mint a
//     search term; a fabricated transliteration is a search whose provenance no one can defend.
//   ONE RENDERING PER SCRIPT, NOT A COUNT — and only scripts a mark could plausibly be REGISTERED in.
//     Japan is Latin plus katakana, not its four writing systems.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { variantCompletenessGaps } from "../variant-manifest-model.mjs";
import { REGISTRABLE_SCRIPTS, requiredScriptsFor, isInScript } from "../registration-scripts.mjs";

const LATIN_ONLY = {
  mark: "NOVAPULSE", dominant_element: "NOVAPULSE",
  elements: [{ value: "NOVAPULSE", kind: "distinctive" }],
  variants: [
    { value: "novapulse", category: "core" },
    { value: "novapulze", category: "phonetic" },
    { value: "novapu1se", category: "visual" },
  ],
};
const withVariant = (v) => ({ ...LATIN_ONLY, variants: [...LATIN_ONLY.variants, v] });

test("item 21 — a Latin-only family is complete for Latin-only territories", () => {
  assert.deepEqual(variantCompletenessGaps(LATIN_ONLY, { jurisdictions: ["US", "EU", "GB", "AU"] }), [],
    "the floor must be silent on the ordinary matter shape, or it is noise");
  assert.deepEqual(variantCompletenessGaps(LATIN_ONLY), [], "and silent with no scope at all — archived runs keep their verdicts");
});

test("item 21 — a Latin-only family is INCOMPLETE for a territory that registers in another script", () => {
  assert.deepEqual(variantCompletenessGaps(LATIN_ONLY, { jurisdictions: ["US", "CN"] }), ["script-coverage:han:CN"]);
  assert.deepEqual(variantCompletenessGaps(LATIN_ONLY, { jurisdictions: ["KR"] }), ["script-coverage:hangul:KR"]);
  assert.deepEqual(variantCompletenessGaps(LATIN_ONLY, { jurisdictions: ["RU", "IL"] }).sort(),
    ["script-coverage:cyrillic:RU", "script-coverage:hebrew:IL"]);
  // the gap NAMES the territories that require the script — a refusal a model cannot act on is a wall
  assert.match(variantCompletenessGaps(LATIN_ONLY, { jurisdictions: ["CN", "TW"] })[0], /han:CN\+TW/);
});

test("item 21 — ONE rendering satisfies a script; the floor never asks how many", () => {
  const one = withVariant({ value: "诺瓦", category: "transliteration", romanization: "NUO WA" });
  assert.deepEqual(variantCompletenessGaps(one, { jurisdictions: ["CN"] }), [],
    "one Han rendering closes the Han requirement — which of them bite is judgment's, downstream");
  // and a rendering stated anywhere the plan compiles from counts: mark, dominant element, elements, or
  // a variant's romanization field
  const onMark = { ...LATIN_ONLY, elements: [...LATIN_ONLY.elements, { value: "诺瓦", kind: "distinctive" }] };
  const gaps = variantCompletenessGaps(onMark, { jurisdictions: ["CN"] });
  assert.ok(!gaps.some((g) => g.startsWith("script-coverage:han")), "a Han element closes the Han requirement");
  // …and the PRE-EXISTING non-Latin arm still fires on it, which is a different gap about a different
  // thing: a non-Latin term among the compiled terms with no transliteration-category variant compiles
  // the transliteration-numeric axis EMPTY. The two arms are independent and both are wanted.
  assert.deepEqual(gaps, ["script:诺瓦"]);
});

test("item 21 — JAPAN IS TWO SCRIPTS, NOT FOUR: the table is what a mark is REGISTERED in", () => {
  assert.deepEqual(REGISTRABLE_SCRIPTS.JP, ["latin", "katakana"],
    "kanji and hiragana renderings are matter-specific judgment, never a floor every mark must clear");
  assert.deepEqual(Object.keys(requiredScriptsFor(["JP"])), ["katakana"], "latin is excluded — the core floor already requires it");
  // a HIRAGANA rendering must not satisfy the katakana requirement: conflating the two lets a near-miss
  // pass, which is exactly what a floor exists to catch
  const hiragana = withVariant({ value: "のばぱるす", category: "transliteration", romanization: "NOBAPARUSU" });
  assert.deepEqual(variantCompletenessGaps(hiragana, { jurisdictions: ["JP"] }), ["script-coverage:katakana:JP"]);
  const katakana = withVariant({ value: "ノバパルス", category: "transliteration", romanization: "NOBAPARUSU" });
  assert.deepEqual(variantCompletenessGaps(katakana, { jurisdictions: ["JP"] }), []);
});

test("item 21 — the table's default is Latin-only, so an unresearched territory costs no work", () => {
  for (const jx of ["US", "GB", "DE", "FR", "AU", "CA", "BR", "MX", "ZA"])
    assert.deepEqual(requiredScriptsFor([jx]), {}, `${jx} is Latin-only by default — adding a script here would cost every matter in that territory`);
  assert.equal(isInScript("ノバ", "katakana"), true);
  assert.equal(isInScript("ノバ", "hiragana"), false);
  assert.equal(isInScript("anything", "not-a-script"), false, "an unknown script name answers false, never throws");
});

test("item 21 — VALIDATES, NEVER GENERATES: nothing in the floor mints a search term", () => {
  const model = readFileSync(new URL("../variant-manifest-model.mjs", import.meta.url), "utf8");
  const arm = model.slice(model.indexOf("item 21 — THE PER-SCRIPT FLOOR"), model.indexOf("item 21 — THE PER-SCRIPT FLOOR") + 2200);
  assert.match(arm, /VALIDATES, NEVER GENERATES/, "the constraint is stated where the code is");
  // the gap tokens are the whole output surface — a floor that returned terms would be generating
  const gaps = variantCompletenessGaps(LATIN_ONLY, { jurisdictions: ["CN", "JP", "KR"] });
  for (const g of gaps) assert.match(g, /^script-coverage:[a-z]+:[A-Z+]+$/, `${g} names a script and its territories, never a term`);
});

test("item 21 — the stage that CAN satisfy the floor is told about it, at both prompt levels", async () => {
  const { STAGES, paths } = await import("../stages.mjs");
  const P = paths("/r");
  const jx = STAGES["prelim-variants"].message({ paths: P, job: { marks: ["NOVAPULSE"], jurisdictions: ["US", "CN", "JP"] }, profile: null });
  assert.match(jx, /SCRIPT COVERAGE \(MANDATORY/, "the prompt states the requirement the validator enforces");
  assert.match(jx, /han \(CN\)/);
  assert.match(jx, /katakana \(JP\)/);
  assert.match(jx, /rather than inventing one/, "…and says what to do when the mark genuinely has no defensible rendering");
  const latin = STAGES["prelim-variants"].message({ paths: P, job: { marks: ["NOVAPULSE"], jurisdictions: ["US", "GB"] }, profile: null });
  assert.doesNotMatch(latin, /SCRIPT COVERAGE/, "silent on a Latin-only matter — a directive that always fires is not read");
});
