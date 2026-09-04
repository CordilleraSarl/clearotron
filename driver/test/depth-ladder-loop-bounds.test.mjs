// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// amendment 2 — the LOOP BOUNDS, and the direction they fail in.
//
// The rungs write less prose. These rows run fewer ROUNDS, and a round that does not run is a search
// that did not happen. So the only interesting question about each is what it does when it does not
// know: an ungraded run, a product this build has no row for, a malformed table. Every one of those
// must get TODAY'S number, never a smaller one — a bound that fails short would quietly shorten a
// recall check on exactly the runs we understand least, and nothing would report it.
import test from "node:test";
import assert from "node:assert/strict";
import { recallFollowupMaxFor } from "../pipeline.mjs";
import { PRODUCT_POLICIES, depthFor } from "../search-policy.mjs";

const ONE_COUNTRY = "full-country-search";
const todays = PRODUCT_POLICIES[ONE_COUNTRY].depth.recallFollowupMax;

test("#1503 CONTROL — a graded product really does get a smaller bound than today", () => {
  assert.equal(recallFollowupMaxFor({ depth: depthFor({ product: ONE_COUNTRY }) }), todays);
  const graded = recallFollowupMaxFor({ depth: depthFor({ product: "global-preliminary-search" }) });
  assert.ok(graded < todays, `worldwide's bound is ${graded} against today's ${todays} — the row is not `
    + "graded at all, so every arm below would pass on a ladder that does nothing");
});

test("#1503 an unknown, absent or malformed depth gets TODAY'S bound — never fewer", () => {
  const shouldFallBack = [
    ["no ctx at all", undefined],
    ["a ctx with no depth", {}],
    ["depth present but the row missing", { depth: {} }],
    ["a null row", { depth: { recallFollowupMax: null } }],
    ["ZERO — which would disable the follow-up entirely", { depth: { recallFollowupMax: 0 } }],
    ["a negative row", { depth: { recallFollowupMax: -1 } }],
    ["a string that looks like a number", { depth: { recallFollowupMax: "1" } }],
    ["a fraction", { depth: { recallFollowupMax: 1.5 } }],
  ];
  for (const [what, ctx] of shouldFallBack) {
    assert.equal(recallFollowupMaxFor(ctx), todays,
      `${what} produced a bound other than today's ${todays}. An unrecognised depth must fail toward `
      + "depth: the run gets the full follow-up budget and the ladder simply does not apply.");
  }
});

test("#1503 a product this build does not grade falls back to the one-country row, by NAME", () => {
  // depthFor stamps `source` so a silent fallback is visible in the run record rather than looking like
  // a ladder that ran and chose today's values.
  const unknown = depthFor({ product: "some-product-shipped-after-this-build" });
  assert.equal(unknown.source, "default-ungraded",
    "an unknown product resolved to a graded row, or lost its source stamp — a fallback that cannot be "
    + "told apart from a deliberate setting is one nobody will find in a run record");
  assert.equal(recallFollowupMaxFor({ depth: unknown }), todays);
});

test("#1503 THE LADDER MAY ONLY REDUCE — no product may ask for more rounds than one country gets", () => {
  for (const [product, policy] of Object.entries(PRODUCT_POLICIES)) {
    const n = policy?.depth?.recallFollowupMax;
    if (n === undefined) continue;
    assert.ok(n <= todays,
      `${product} asks for ${n} follow-ups against one country's ${todays}. Product 4's column is the `
      + "ceiling on every row by owner ruling. This is asserted rather than clamped in the driver on "
      + "purpose — a clamp would silently serve a number nobody wrote.");
  }
});

test("#917 multi-country's recall follow-up budget is 2, level with one-country", () => {
  // Owner-ruled, raised 1 → 2. Pinned because the value is one integer in a table of nine and a revert
  // would be invisible: the run still completes, the receipt still prints, and the only difference is a
  // recall round that did not happen. A search that did not run does not announce itself.
  assert.equal(recallFollowupMaxFor({ depth: depthFor({ product: "multi-country-focus-search" }) }), 2);
  assert.equal(recallFollowupMaxFor({ depth: depthFor({ product: ONE_COUNTRY }) }), 2,
    "the one-country row moved — this arm pins multi-country LEVEL WITH it, so both must be read together");
});

test("#917 worldwide is deliberately NOT raised, and that leaves an inversion on the record", () => {
  // The broader product now has the WEAKER recall follow-up. That is the state the ruling produces: it
  // named multi-country, and widening it to the most expensive product is an owner call, not a dev one.
  // Asserted rather than left implicit so nobody "fixes" the ladder without going back to the ruling —
  // and so that if worldwide IS raised later, this arm is what makes them say so.
  const worldwide = recallFollowupMaxFor({ depth: depthFor({ product: "global-preliminary-search" }) });
  const multi = recallFollowupMaxFor({ depth: depthFor({ product: "multi-country-focus-search" }) });
  assert.equal(worldwide, 1);
  assert.ok(worldwide < multi, "worldwide was raised without the ruling this arm records the absence of");
});
