// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A name its own documentation calls "not a knob" is not a deletion candidate.
//
// THE CLASSIFIER KEYS ON THE NAME, and `tuning` is its residual — what a name falls to when no shape
// matches. The deletion walk starts from `tuning` with no recorded set-site. So a name whose catalogue
// row declares ANY effect other than `tuning` reaches that walk on a class its own documentation
// contradicts, and the only thing that then keeps it off the candidate list is whatever the later
// filters happen to make of its spelling.
//
// FIVE CLASSES, NOT THREE. `tuning` is the only declared effect that agrees with being a knob, so the
// rule is `!== "tuning"` and every other class is excluded: `silent-output-change`, `disclosed-gate`,
// `credential`, `deployment` and `harness`. The two that read as safe to delete are the two that must
// not be missed — `deployment` is the class the rule comes from (notification addresses, legitimately
// unset on the deployment being read, proposed for deletion on exactly this mismatch), and `harness`
// looks deletable because no production run reaches it, when deleting it removes the only way a test
// can run. Every one of the five is driven below.
//
// MEASURED 2026-09-08 over the full catalogue: seventeen names sit in exactly that position — ten
// declared `silent-output-change`, four `disclosed-gate`, two `harness`, one `credential` — and every
// one of them leaves the walk for an UNRELATED reason: their names contain `DUMP`, `PROBE`,
// `DISPATCH_RECORD` and the like, or a non-numeric default, or no default found. Not one is excluded
// because a document says it changes what a run produces. `scripts/env-classify.mjs` already wrote the
// verdict on that, about a different name: exclusion "for an unrelated reason (no default found), which
// is luck, not a rule."
//
// That count is a dated reading and it moves — two of the seventeen were added the same week. What is
// asserted below is the RULE, and none of it is asserted on a count.
//
// ── WHY THIS PLANTS A CATALOGUE INSTEAD OF READING THE REAL ONE ─────────────────────────────────────
//
// The half of the catalogue those seventeen live in is not on this tree — this checkout carries 43 rows
// and 12 declarations, and NO name here is in the contradicting position at all. A check written against
// the real catalogue would pass here while checking nothing, which is the shape that has cost this
// repository more than any other. So every name below is planted, and the members are deliberately one
// per declared class: a filter written for one spelling of "not a knob" must refuse the others too.
import test from "node:test";
import assert from "node:assert/strict";
import { classify } from "../../scripts/env-classify.mjs";

/** No source sets any of these, so every one reaches the deletion walk on `everSet: []`. */
const NOTHING_SET = { prod: new Set(), test: new Set(), config: new Set(), ci: new Set(), e2e: new Set(), docs: new Set() };

const run = (catalogue, declared) =>
  classify({ catalogue, sources: NOTHING_SET, setup: new Set(), declared: new Map(declared) });

test("a declared non-knob leaves the deletion walk by RULE, whatever its spelling", () => {
  // EVERY declared class except `tuning`, one name each, in spellings that match none of the later
  // filters — so if the declaration were not read, every one of these would walk on to be judged by its
  // default. Driving four of the five would leave the fifth excluded by a predicate no arm exercises,
  // and `deployment` is the class the whole rule was written for.
  const declared = [
    ["CLEAROTRON_ALPHA_SETTING", "silent-output-change"],
    ["CLEAROTRON_BETA_SETTING", "disclosed-gate"],
    ["CLEAROTRON_GAMMA_SETTING", "credential"],
    ["CLEAROTRON_DELTA_SETTING", "harness"],
    ["CLEAROTRON_EPSILON_SETTING", "deployment"],
  ];
  const { buckets } = run(declared.map(([n]) => n), declared);
  assert.deepEqual(buckets["declared-not-a-knob"], declared.map(([n]) => n).sort(),
    "a name whose document says it changes what a run produces reached the deletion walk");
  assert.deepEqual(buckets["deletable-number"], [], "and none of them is a candidate");
});

// THE NEGATIVE, and the rule above is worth nothing without it: the rule must not empty the walk. A name
// declared `tuning` agrees with the classifier and is exactly what the deletion work is FOR.
test("a name declared `tuning` still reaches the walk — the rule is not a blanket exemption", () => {
  const { buckets, sub } = run(["CLEAROTRON_EPSILON_SETTING"], [["CLEAROTRON_EPSILON_SETTING", "tuning"]]);
  assert.deepEqual(buckets["declared-not-a-knob"], [], "an agreeing declaration is not an exclusion");
  assert.ok(sub.CLEAROTRON_EPSILON_SETTING, "…and the name was judged by the walk rather than dropped");
});

// AND THE OTHER HALF OF THE SAME REQUIREMENT: an UNDECLARED name is not excluded either. The catalogue
// carries far more names than declarations, and reading "no declaration" as "not a knob" would empty the
// candidate list by silence — the failure this whole script was rewritten to end.
test("an UNDECLARED name is not excluded — silence is not a declaration", () => {
  const { buckets } = run(["CLEAROTRON_ZETA_SETTING"], []);
  assert.deepEqual(buckets["declared-not-a-knob"], [], "a name nobody documented was treated as documented");
});

// THE BUCKET SAYS WHY, or a reviewer reading the artifact meets a name in a list with no reason attached.
test("the row carries the declaration that excluded it", () => {
  const { rows } = run(["CLEAROTRON_ETA_SETTING"], [["CLEAROTRON_ETA_SETTING", "disclosed-gate"]]);
  assert.equal(rows[0].declared, "disclosed-gate", "the row does not say what the document declared");
  assert.equal(rows[0].class, "tuning", "…and it still records the class the classifier derived, "
    + "because the disagreement is the finding and hiding it would answer the wrong question");
});
