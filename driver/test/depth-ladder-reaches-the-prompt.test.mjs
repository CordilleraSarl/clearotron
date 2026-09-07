// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — the ladder REACHES THE PROMPT, and product 4's prompt does not move.
//
// Every other arm in this family tests the rung FUNCTIONS. A rung can be correct, exported, guarded and
// called, and still never reach a model: the stage destructures a field the driver does not set, or the
// builder that carries it is not the one dispatched. That failure has no error and no red — the graded
// products simply run at one-country depth and the ladder's whole observable effect is that nothing
// happens. So this file builds the REAL stage message and reads what comes out.
//
// The one-country arm is 's central acceptance criterion — "product 4 untouched" — and it is
// asserted the strongest way available: the whole message, byte for byte, against the same stage built
// with no depth at all.
import test from "node:test";
import assert from "node:assert/strict";
import { STAGES } from "../stages.mjs";
import * as stages from "../stages.mjs";
import { depthFor } from "../search-policy.mjs";

/** Which stage carries which rung. Every discovered rung must appear here — see the first arm. */
const STAGE_OF = {
  proseRungDirective: "synthesis",
  inquiryRungDirective: "placement-inquiry",
  skepticRungDirective: "skeptic",
  variantRungDirective: "prelim-variants",
  profileRungDirective: "narrative-refutation",
};
// — `profileRungDirective` was CONVERTED to driver selection and is no longer called by any
// builder, so it cannot "reach a prompt" and these arms would report a live lever as dead. Its
// replacement reaches the refutation prompt through `ctx.profileSelection`, asserted at the end of this
// file — because "converted" and "quietly unwired" look identical from here, and only one is fine.
const CONVERTED_TO_DRIVER_SELECTION = new Set(["profileRungDirective"]);
const RUNG_NAMES = Object.keys(stages)
  .filter((n) => /RungDirective$/.test(n) && typeof stages[n] === "function")
  .filter((n) => !CONVERTED_TO_DRIVER_SELECTION.has(n));

// A ctx generous enough for any builder: every path resolves, every list is empty rather than absent.
const paths = new Proxy({}, { get: (_t, k) => (typeof k === "string" ? `<${k}>` : undefined) });
const baseCtx = () => ({
  paths, axes: [], intakeAsks: [], openDoubts: [], openAsks: [], registerOnly: false, framework: null,
  job: { mark: "TESTMARK", classes: [25], territories: ["CH"] }, profile: { key: "demo" },
});
const build = (stageKey, product) => STAGES[stageKey].message(
  product === null ? baseCtx() : { ...baseCtx(), depth: depthFor({ product }) });

const ONE_COUNTRY = "full-country-search";
const GRADED = ["multi-country-focus-search", "global-preliminary-search"];

test("#1503 every rung's stage is named here — an unmapped rung is a rung nothing checks reaches", () => {
  assert.ok(RUNG_NAMES.length > 0, "no rungs discovered — the instrument is broken, not the ladder");
  for (const name of RUNG_NAMES) {
    assert.ok(STAGE_OF[name], `${name} ships with no stage mapped in this file, so nothing asserts it `
      + "reaches a prompt. Add it here when you add the rung.");
    assert.ok(STAGES[STAGE_OF[name]], `${name} is mapped to stage "${STAGE_OF[name]}", which does not exist`);
  }
});

test("#1503 PRODUCT 4 IS UNTOUCHED — the one-country message is byte-identical to no ladder at all", () => {
  for (const name of RUNG_NAMES) {
    const stageKey = STAGE_OF[name];
    const withOneCountry = build(stageKey, ONE_COUNTRY);
    const withNoDepth = build(stageKey, null);
    assert.equal(withOneCountry, withNoDepth,
      `${stageKey}'s prompt MOVED on a one-country run. Product 4's column is AS TODAY on every row by `
      + "owner ruling, and this is the guard for it — the depth table's one-country value for "
      + `${name}'s field must produce an empty directive.`);
  }
});

test("#1503 the rung REACHES the prompt on a graded product — a no-op here is a ladder that does nothing", () => {
  for (const name of RUNG_NAMES) {
    const stageKey = STAGE_OF[name];
    const baseline = build(stageKey, ONE_COUNTRY);
    for (const product of GRADED) {
      const graded = build(stageKey, product);
      assert.notEqual(graded, baseline,
        `${stageKey} produced an IDENTICAL prompt on ${product} as on one-country. ${name} is defined and `
        + "called, but its text never reaches the model — check that the builder destructures `depth` and "
        + "that this is the builder the dispatch uses.");
      // and what changed is exactly the rung's own text, not something incidental
      const directive = stages[name](depthFor({ product }));
      assert.ok(directive, `${name} returned empty for ${product} — the depth table's value for its field `
        + "is outside the rung's whitelist, so the product is silently ungraded");
      assert.ok(graded.includes(directive),
        `${stageKey}'s prompt changed on ${product}, but not by ${name}'s text — something else moved`);
    }
  }
});

test("#1503 the two graded products differ from each other — one bar, not two names for it", () => {
  for (const name of RUNG_NAMES) {
    const stageKey = STAGE_OF[name];
    assert.notEqual(build(stageKey, GRADED[0]), build(stageKey, GRADED[1]),
      `${stageKey} sends the same prompt to multi-country and worldwide. The ladder has three settings; `
      + "if two are meant to be identical, say so in the table rather than in the rung's wording.");
  }
});

test("#1503 the DRIVER'S PROFILE LIST reaches the refutation prompt, and one-country's does not", () => {
  // The converted lever's half of the reach guarantee. A selection computed and never rendered is the
  // same defect as a directive defined and never called — the product runs ungraded and the only
  // symptom is work nobody asked about still being done.
  const withList = STAGES["narrative-refutation"].message({
    ...baseCtx(), profileSelection: { ordinals: [1, 4], total: 9, keyless: 0 } });
  assert.match(withList, /by ordinal: 1, 4\./,
    "the driver's ordinal list never reaches the refutation prompt — check the builder destructures "
    + "`profileSelection` and that this is the builder the dispatch uses");

  // null = every finding, and it must render NOTHING rather than a permissive sentence.
  const none = STAGES["narrative-refutation"].message({ ...baseCtx(), profileSelection: { ordinals: null, total: 9, keyless: 0 } });
  assert.doesNotMatch(none, /GROUNDED PROFILES —/,
    "a run profiling every finding still carried a profiles instruction — that is a changed dispatch "
    + "for no change in what is asked");
  assert.equal(STAGES["narrative-refutation"].message(baseCtx()).includes("GROUNDED PROFILES —"), false,
    "a ctx with no selection at all emitted an instruction");
});
