// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — THE DEPTH LADDER'S TABLE, and the guard that makes "product 4 is unchanged" mechanical.
//
// The spec's one-country column is AS TODAY on every row, and that IS the byte-identical guard: the
// dispatch reads this table for every category, so category 4 taking today's path is a property of the
// DATA rather than of a branch somebody remembered to leave alone.
//
// A guard on a table is only worth something if a WRONG value fails it. Two ways this table can be
// wrong without anything throwing, and both have an arm:
//   · a one-country value drifts — the flagship product quietly gets a graded path;
//   · a graded value is MISSPELLED — a consumer that treats an unknown value as "as today" then
//     un-grades a product silently, which reads as "the ladder did nothing" rather than as a defect.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { depthFor, PRODUCT_POLICIES } from "../search-policy.mjs";

/** The clearance products the ladder governs. Product 1 (knockout) is out of scope by the spec. */
const GRADED_PRODUCTS = ["global-preliminary-search", "multi-country-focus-search", "full-country-search"];

/**
 * Closed vocabularies, per field. A value outside these is a typo, and a typo that a consumer reads as
 * "as today" un-grades a product in silence — the failure this ladder cannot afford, because its whole
 * observable effect is that some prose stops being written.
 */
const VOCAB = {
  narrativeProse: ["every-finding", "adversarial+floors", "adversarial"],
  skepticFlagging: ["as-today", "graded", "graded-high"],
  variantManifest: ["as-today", "graded", "graded-high"],
  // The spec writes these "band 1 / band 2"; its own definition table maps them to DISPOSITIONS, and a
  // finding's real `band` field is a framework risk word ("High", "Manageable") that gateway.mjs forbids
  // numbering. The vocabulary here is the one the stage can act on.
  groundedProfiles: ["every-finding", "adversarial+partner", "adversarial"],
  // Every product still reads `every-doubt`, and not by omission. The cut the owner's architecture table
  // names for this stage — bands 1+2 / band 1 — remains UNIMPLEMENTABLE for the reason
  // doubt-closure-grading-cannot-bind.test.mjs gives: no doubt that is still OPEN carries a disposition or
  // band to key on. The two tier words below are implementable and unused: the driver can act on them
  // (doubt-selection.mjs), and no row names one until the owner rules the cut for THIS stage. The ruled
  // tiers on the table belong to the placement-inquiry trace row.
  doubtClosure: ["every-doubt", "headline-candidate", "headline-candidate+sheet-2"],
  envelopeRounds: ["as-today", "one"],
  coverageClosureRounds: ["as-today", "one"],
};

/**
 * TODAY'S BEHAVIOUR, written out. This is not a copy of the table — it is the independent statement of
 * what product 4 did before, and the two agreeing is the guard. Changing the table without
 * changing this fails, which is the point: a one-country value may only move deliberately.
 */
const ONE_COUNTRY_TODAY = Object.freeze({
  narrativeProse: "every-finding",
  skepticFlagging: "as-today",
  variantManifest: "as-today",
  groundedProfiles: "every-finding",
  doubtClosure: "every-doubt",
  envelopeRounds: "as-today",
  coverageClosureRounds: "as-today",
});

test("the one-country row is TODAY'S behaviour, value by value — this is the byte-identical guard", () => {
  const depth = PRODUCT_POLICIES["full-country-search"]?.depth;
  assert.ok(depth, "full-country-search carries no depth row, so the dispatch has no table to read for it "
    + "and product 4's path is a branch again");
  assert.deepEqual({ ...depth }, { ...ONE_COUNTRY_TODAY },
    "a one-country depth value moved. Product 4's column is AS TODAY on every row by owner ruling — "
    + "\"what i dont want to do is change product 4 into a monster. its already great.\" If this change "
    + "is deliberate it is a spec change, not a test update.");
});

// — the fields that exist ONLY on a graded row, and whose ABSENCE is the rule on one-country.
// The narrative directive is emitted only when both are present, so a one-country row carrying them
// would emit a directive and end the byte-identical guarantee. Listed here rather than derived, because
// the whole point is that the two row shapes are deliberately different.
const GRADED_ONLY = ["narrativeKeptBandRank", "narrativeWriteUpWords", "profileKeptBandRank"];

// `GRADED_PRODUCTS` above means "has a row in the ladder table", and one-country has one — its row
// states today's behaviour explicitly, which is what makes the table complete. The two products that are
// actually GRADED are a different set, and only they carry the fields above.
const DIRECTIVE_PRODUCTS = ["global-preliminary-search", "multi-country-focus-search"];

test("every graded product carries a COMPLETE row — a missing key is not a default", () => {
  const shared = Object.keys(ONE_COUNTRY_TODAY);
  for (const p of GRADED_PRODUCTS) {
    const depth = PRODUCT_POLICIES[p]?.depth;
    assert.ok(depth, `${p} carries no depth row`);
    assert.deepEqual(Object.keys(depth).filter((k) => !GRADED_ONLY.includes(k)).sort(), [...shared].sort(),
      `${p}'s depth row does not carry exactly the ladder's shared fields. A MISSING key is the dangerous `
      + "direction: a consumer reading undefined and falling back to today's behaviour un-grades that "
      + "product silently, and the only symptom is that the ladder appears to have done nothing.");
    if (DIRECTIVE_PRODUCTS.includes(p))
      for (const k of GRADED_ONLY)
        assert.ok(k in depth, `${p} takes the narrative directive and carries no ${k} — the directive is `
          + "emitted only when both are present, so a half-filled row silently ungrades the product");
  }
});

test("the ONE-COUNTRY row carries NONE of the graded-only fields", () => {
  // The other half, and the one that keeps the byte-identical guarantee honest. Adding either field to
  // this row emits a directive into a dispatch that has never had one.
  const depth = PRODUCT_POLICIES["full-country-search"].depth;
  for (const k of GRADED_ONLY)
    assert.equal(k in depth, false,
      `the one-country row carries ${k}. That row's guarantee is that its dispatch is unchanged, and a `
      + "graded-only field on it produces a directive where there was none.");
});

test("every value is in its field's closed vocabulary — a typo cannot mean 'as today'", () => {
  for (const p of GRADED_PRODUCTS) {
    const depth = PRODUCT_POLICIES[p].depth;
    for (const [field, allowed] of Object.entries(VOCAB)) {
      assert.ok(allowed.includes(depth[field]),
        `${p}.depth.${field} is ${JSON.stringify(depth[field])}, which is not one of ${allowed.join(" / ")}. `
        + "An unrecognised value is read as 'as today' by a defaulting consumer, so a typo here un-grades "
        + "a product and reports nothing.");
    }
  }
});

test("the ladder grades the graded products and NOT product 1", () => {
  assert.equal(PRODUCT_POLICIES["knockout-search"]?.depth, undefined,
    "the knockout carries a depth row. Product 1 is out of scope by the spec — it has its own machinery, "
    + "and a row here invites a consumer to grade it.");
  // The ladder must actually differ from one-country somewhere, or it is decoration. Asserted per
  // product rather than in aggregate: a table where worldwide grades and multi-country silently does not
  // would satisfy any total.
  for (const p of ["global-preliminary-search", "multi-country-focus-search"]) {
    const depth = PRODUCT_POLICIES[p].depth;
    const differs = Object.keys(ONE_COUNTRY_TODAY).filter((k) => depth[k] !== ONE_COUNTRY_TODAY[k]);
    assert.ok(differs.length > 0,
      `${p}'s depth row is identical to one-country's in every field, so the ladder does nothing for it`);
  }
});

/**
 * WHICH ROWS ARE LIVE. A depth row that nothing reads is not a setting — it is a claim about behaviour
 * that no code makes true, and it reads exactly like a live one from the table. Three rows are declared
 * and not consumed, each for a stated reason, and this arm is what keeps that list honest: wire one
 * without moving it here and the arm reds, leave one wired-but-unlisted and it reds the other way.
 */
const DECLARED_ONLY = {
  envelopeRounds: "the envelope already runs ONE round per run; the spec's 'not to exhaustion' has a second "
    + "reading (cap the axes closed WITHIN the round) that re-opens the V4-4 failure — awaiting a ruling",
  coverageClosureRounds: "coverage closure already runs exactly ONE warm followup, idempotent across resumes",
};

test("every depth row is either CONSUMED by the driver or listed as declared-only, with a reason", () => {
  const sources = ["../pipeline.mjs", "../stages.mjs"]
    .map((f) => readFileSync(new URL(f, import.meta.url), "utf8")).join("\n");
  const fields = Object.keys(PRODUCT_POLICIES["full-country-search"].depth);
  assert.ok(fields.length > 0, "the one-country row is empty — nothing below discriminates");
  for (const field of fields) {
    const consumed = new RegExp(`depth\\??\\.${field}\\b`).test(sources);
    if (DECLARED_ONLY[field]) {
      assert.equal(consumed, false,
        `${field} is listed as declared-only but the driver now READS it. Move it out of DECLARED_ONLY — `
        + "the list is what tells the next reader which half of the ladder is live.");
    } else {
      assert.equal(consumed, true,
        `${field} is in the depth table and NOTHING reads it. Either wire it, or add it to DECLARED_ONLY `
        + "with the reason. A row nothing reads still looks like a setting to everyone who reads the table.");
    }
  }
});

test("every product RESOLVES to a row, graded or not — no product runs on an absent setting", () => {
  for (const product of Object.keys(PRODUCT_POLICIES)) {
    const depth = depthFor({ product });
    assert.ok(depth && depth.source, `${product} resolves to no depth at all, so every rung reading it `
      + "falls through to its own default and the table stops being the single statement of the ladder");
    for (const f of Object.keys(ONE_COUNTRY_TODAY)) {
      assert.ok(f in depth, `${product} resolves without ${f} — a rung reading it would grade on undefined`);
    }
  }
});

test("`default-ungraded` means ONE thing — a product this build does not recognise", () => {
  for (const product of Object.keys(PRODUCT_POLICIES)) {
    assert.notEqual(depthFor({ product }).source, "default-ungraded",
      `${product} resolves to the unrecognised-product fallback. A product this build does not know is a `
      + `real bug; sharing a name with ${product} means it hides in that population instead of showing up.`);
  }
  assert.equal(depthFor({ product: "a-product-no-build-has-ever-shipped" }).source, "default-ungraded",
    "the fallback is unreachable, so the signal it carries can never fire");
  assert.equal(depthFor({}).source, "default-ungraded", "a policy with no product must reach the fallback");
});

test("a KNOWN but ungraded product names itself, and runs at one-country depth", () => {
  // The knockout carries no depth row on purpose (see the arm above): a row would invite a consumer to
  // grade a lane the spec puts out of scope. It must still be told apart from an unrecognised product.
  assert.equal(PRODUCT_POLICIES["knockout-search"]?.depth, undefined,
    "the knockout grew a depth row — the arm above says why it must not have one");
  const resolved = depthFor({ product: "knockout-search" });
  assert.equal(resolved.source, "ungraded:knockout-search",
    "a known-but-ungraded product resolved anonymously, so its runs and a genuinely broken product's "
    + "runs read identically in the record");
  const { source, ...values } = resolved;
  assert.deepEqual(values, { ...ONE_COUNTRY_TODAY },
    "an ungraded product resolved to something other than AS TODAY. Falling back to anything but the "
    + "one-country column is the ladder grading a product nobody graded.");
});
