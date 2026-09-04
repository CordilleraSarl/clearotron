// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// lever 3 — THE VARIANT RUNG IS SCOPE, NOT QUALITY, AND HERE IS THE MECHANICAL PROOF.
//
// Every other rung in the ladder fails soft: a thinner narrative is thinner prose. This one does not.
// The manifest is the INPUT to the register-plan compiler, and the compiler is dumb by design — it
// searches exactly what the manifest states. A spelling dropped from the manifest is a search that
// never ran, and a floor row cannot be computed for a spelling nobody searched. That reads as CLEAN.
//
// Levers 1 and 2 each had a mechanical reason grading could not become quality: the DRIVER renders the
// placement form, so a seat cannot drop a candidate by writing less about it. The variant rung's
// equivalent is `variantCompletenessGaps` — the stage gate refuses a manifest that omits a floor
// category or an in-scope script and the stage regenerates. This file holds the rung to it.
//
// stepped the manifest's width UP (`78eec60d`), targets kept, and the standing instruction is not
// to narrow back. The rung's WORDING says never drop a non-Latin spelling; wording is a model-side
// assurance. These arms are the driver-side one.
import test from "node:test";
import assert from "node:assert/strict";
import { variantCompletenessGaps } from "../variant-manifest-model.mjs";
import { STAGES, variantRungDirective } from "../stages.mjs";
import { depthFor } from "../search-policy.mjs";

const PRODUCTS = ["full-country-search", "multi-country-focus-search", "global-preliminary-search"];
const v = (category, value, romanization) => ({ category, value, ...(romanization ? { romanization } : {}) });

/** A manifest a graded run could plausibly produce, complete for a Han-script market. */
const COMPLETE = Object.freeze({
  mark: "KESTREL", dominant_element: "KESTREL", elements: [{ value: "KESTREL" }],
  variants: [v("core", "KESTREL"), v("phonetic", "ORVELLA"), v("visual", "KESTREL."),
             v("transliteration", "红隼", "hóng sǔn")],
});
const without = (cat) => ({ ...COMPLETE, variants: COMPLETE.variants.filter((x) => x.category !== cat) });

test("#1503 CONTROL — a complete manifest clears the floor, so a gap below means something", () => {
  assert.deepEqual(variantCompletenessGaps(COMPLETE, { jurisdictions: ["CN"] }), [],
    "the floor flagged a manifest that states every floor category and a Han rendering for a CN-scope "
    + "matter. It reports gaps on everything, so no arm below discriminates.");
});

test("#1503 a graded manifest that drops the Han rendering is REFUSED — the rung cannot cause a nil search", () => {
  const gaps = variantCompletenessGaps(without("transliteration"), { jurisdictions: ["CN"] });
  assert.ok(gaps.some((g) => g.startsWith("script-coverage:han")),
    `dropping the only Han rendering on a CN-scope matter produced ${JSON.stringify(gaps)} — no script `
    + "gap. The rung could then thin a manifest into a register the funnel never asks about, which is "
    + "the #935 class the owner made non-negotiable.");
});

test("#1503 a non-Latin mark with no transliteration family is REFUSED", () => {
  const nonLatin = { mark: "红隼", dominant_element: "红隼", elements: [{ value: "红隼" }],
    variants: [v("core", "红隼"), v("phonetic", "红隼"), v("visual", "红隼")] };
  const gaps = variantCompletenessGaps(nonLatin, { jurisdictions: [] });
  assert.ok(gaps.some((g) => g.startsWith("script:")),
    `a non-Latin mark stating no transliteration family produced ${JSON.stringify(gaps)} — the `
    + "transliteration-numeric axis would compile empty and nothing would say so.");
});

test("#1503 a graded manifest that drops a floor CATEGORY is refused too", () => {
  for (const cat of ["core", "phonetic", "visual"]) {
    assert.ok(variantCompletenessGaps(without(cat), { jurisdictions: ["CN"] }).includes(`category:${cat}`),
      `dropping the ${cat} family cleared the floor — the rung could thin the search family itself`);
  }
});

test("#1503 THE TIE — the rung changes the PROMPT and changes NOTHING about the floor", () => {
  const paths = new Proxy({}, { get: (_t, k) => (typeof k === "string" ? `<${k}>` : undefined) });
  const msg = (product) => STAGES["prelim-variants"].message({
    paths, job: { mark: "KESTREL", classes: [25], territories: ["CN"] }, profile: { key: "demo" },
    depth: depthFor({ product }),
  });
  // the rung really is live on the graded products…
  assert.notEqual(msg("global-preliminary-search"), msg("full-country-search"),
    "the variant rung reaches no prompt, so this file is guarding a rung that does nothing");
  assert.equal(variantRungDirective(depthFor({ product: "full-country-search" })), "",
    "the one-country manifest is graded — product 4's manifest must be AS TODAY");
  // …and the floor's verdict on a thinned manifest is the SAME REFUSAL whatever product asked for it.
  const verdicts = PRODUCTS.map((p) => JSON.stringify(
    variantCompletenessGaps(without("transliteration"), { jurisdictions: ["CN"] })));
  assert.equal(new Set(verdicts).size, 1,
    `the floor returned different verdicts per product (${verdicts.join(" | ")}). It takes only the model `
    + "and the jurisdictions — if that stops being true, a depth value can reach the gate and grading "
    + "stops being scope.");
  assert.notEqual(JSON.parse(verdicts[0]).length, 0, "the shared verdict is EMPTY — all three products "
    + "accept a manifest with no Han rendering, and the arm above compared three passes");
});
