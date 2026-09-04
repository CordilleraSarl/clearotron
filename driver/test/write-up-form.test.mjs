// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// §8/§9 — which write-up form a finding earns, and the three things that must never move.
import test from "node:test";
import assert from "node:assert/strict";
import { writeUpForm, gradedWriteUpRung } from "../write-up-form.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { PRODUCT_POLICIES, depthFor } from "../search-policy.mjs";

const DISPOSITIONS = ["adversarial", "coexistence-partner", "distinguished", "off-field"];
const rowFor = (product) => depthFor({ product });

test("#1503 ONE COUNTRY IS FULL FOR EVERY FINDING — the byte-identical argument, structurally", () => {
  const one = rowFor("full-country-search");
  for (const disposition of DISPOSITIONS) {
    assert.equal(writeUpForm(one, { disposition }), "full",
      `a ${disposition} finding renders as "${writeUpForm(one, { disposition })}" on one country. Product 4's `
      + "card set may not move — this is the predicate reducing to today's, which is the no-op argument.");
  }
});

test("#1503 an UNGRADED or unrecognised depth is FULL — every other branch can only remove a card", () => {
  for (const [what, depth] of [
    ["no depth at all", null],
    ["an empty row", {}],
    ["a null rung", { narrativeProse: null }],
    ["a rung this build does not know", { narrativeProse: "some-future-rung" }],
    ["a product with no row", rowFor("a-product-no-build-has-ever-shipped")],
    ["the knockout's ungraded row", rowFor("knockout-search")],
  ]) {
    assert.equal(writeUpForm(depth, { disposition: "off-field" }), "full",
      `${what} produced a graded form. An unrecognised ladder must render as it does today: every branch `
      + "past this point takes a card away, and a typo would take it away silently.");
  }
});

test("#1503 A TIER-IDENTICAL FLOOR IS FULL IN EVERY PRODUCT — the owner's standing non-negotiable", () => {
  for (const product of Object.keys(PRODUCT_POLICIES)) {
    for (const disposition of DISPOSITIONS) {
      assert.equal(writeUpForm(rowFor(product), { disposition }, { floorTier: "identical" }), "full",
        `${product} reduces a tier-identical floor row with disposition ${disposition} below a full card. `
        + "That is the #935/#383 class — script-exact, alias-exact and normalized-equal all ride inside "
        + "`identical` — and it is full-carded in every product by owner ruling.");
    }
  }
});

test("#1503 the floor rule is tested BEFORE the judgment, so no future disposition can route around it", () => {
  // A disposition vocabulary this build has never seen must still not cost a floor its card.
  assert.equal(writeUpForm(rowFor("global-preliminary-search"),
    { disposition: "some-disposition-invented-later" }, { floorTier: "identical" }), "full");
});

test("#1503 `adversarial` is full in every graded product — it never renders below a short entry", () => {
  for (const product of ["multi-country-focus-search", "global-preliminary-search"]) {
    assert.equal(writeUpForm(rowFor(product), { disposition: "adversarial" }), "full",
      `${product} demoted an adversarial finding — a conflict genuinely in the way`);
  }
});

test("#1503 the graded products DO grade — a predicate that never removes a card is decoration", () => {
  let entries = 0;
  for (const product of ["multi-country-focus-search", "global-preliminary-search"]) {
    for (const disposition of ["coexistence-partner", "distinguished", "off-field"]) {
      if (writeUpForm(rowFor(product), { disposition }) === "entry") entries++;
    }
  }
  assert.ok(entries >= 6, `only ${entries} findings were graded to an entry across both graded products — `
    + "the predicate is not grading anything, and every arm above would still pass");
});

test("#1503 NEAR-identical is not identical — only the exact tier carries the non-negotiable", () => {
  assert.equal(writeUpForm(rowFor("global-preliminary-search"),
    { disposition: "off-field" }, { floorTier: "near-identical" }), "entry",
    "near-identical was treated as the floor tier. The two are distinct rungs in band-shape.mjs and the "
    + "ruling names `identical`; widening it here would quietly re-full-card a whole tier nobody ruled on.");
});

test("#1503 gradedWriteUpRung — only the two graded rungs answer yes, and an unknown one fails SAFE", () => {
  assert.equal(gradedWriteUpRung({ narrativeProse: "adversarial" }), true);
  assert.equal(gradedWriteUpRung({ narrativeProse: "adversarial+floors" }), true);
  assert.equal(gradedWriteUpRung({ narrativeProse: "every-finding" }), false, "one country is not a graded rung");
  // FAIL-SAFE DIRECTION, the same one writeUpForm opens with: everything downstream of a `true` can only
  // shorten a report, so an unrecognised rung must answer no. A `true` default would let a renamed or
  // half-deployed policy quietly grade a product nobody graded.
  for (const bad of [null, undefined, {}, { narrativeProse: "" }, { narrativeProse: "adversarial " }, { narrativeProse: "ADVERSARIAL" }, { narrativeProse: 3 }])
    assert.equal(gradedWriteUpRung(bad), false, `${JSON.stringify(bad)} was treated as a graded rung`);
});

test("#1503 the write-up-forms JOURNAL ROW is gated on the RUNG, never on the entry count", () => {
  // My defect, from §9. The row was written `if (entryOrdinals.length)`, which conflates two
  // different empties: one country is empty BY CONSTRUCTION (every form is `full`) while a graded run
  // where every finding earned a card is empty AS A MEASUREMENT — and that second one is the number the
  // ladder has to justify. The shipped sample run is exactly that shape: all ten prose-bearing findings
  // are `adversarial`, so a graded run over it authors every card and the old gate journalled NOTHING,
  // indistinguishable from a run predating the gauge.
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "pipeline.mjs"), "utf8");
  const block = src.slice(Math.max(0, src.indexOf('event: "write-up-forms"') - 700), src.indexOf('event: "write-up-forms"'));
  assert.ok(/if \(gradedWriteUpRung\(ctx\.depth\)\)/.test(block),
    "the write-up-forms row is no longer gated by gradedWriteUpRung — re-read the gate before changing it");
  assert.ok(!/if \(entryOrdinals\.length\)/.test(block),
    "the entry-count gate is back: a graded run with zero entries would journal nothing, and that zero is a measurement");
});
