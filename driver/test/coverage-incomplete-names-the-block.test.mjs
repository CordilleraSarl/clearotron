// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// What bought, carried forward onto the mechanism that replaced it.
//
// 's four hint tests are gone with the hint. Their whole subject was making a TRANSCRIPTION
// requirement clearable: the token had to name the qid and the exact hit count because those were the
// only two strings blockIsDisclosed accepted, and the hint had to describe the right arm (class vs term)
// or it sent the model hunting for a defect the run did not have. The driver writes the qid and the
// count into the row now, so there is no requirement left to explain.
//
// TWO OF THE SIX WERE NEVER ABOUT THE HINT, and they carry:
//   · the WIRE FORMAT pin — a greedy capture must not swallow the appended detail;
//   · the RETURN SHAPE pin — the calculation carries total_hits and the unaccounted legs, because they
//     are what the row is built from.
//
// The de-identified fixture below replaces the one this file used to carry, which named a real company
// inside a qid. This repo is de-identified by design; a test fixture is code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { correctionHint } from "../gateway.mjs";
import { openBlocksByAxis } from "../register-plan.mjs";
import { progressQuantity } from "../repairs.mjs";

// The live token shape, as verify.coverageFormFail builds it.
const TOKEN = "coverage_no_status:no_status=3;CB-A1B2C3D4 [incumbent-class / owner: GLIMMER [cl 5, 30]],"
  + "CD-E5F6A7B8 [transliteration-numeric / default: ГЛИММЕР [cl 9]] (+1 more)";

test("THE WIRE FORMAT: the census is first, and the appended row list never swallows it", () => {
  // The pin left behind, restated against what replaced it. The old token put the AXIS first and
  // space-separated because correctionHint's `([^\s)]+)` capture would otherwise absorb `qid=…`. The new
  // token puts the CENSUS first because repairs.mjs CENSUS_RE is anchored at the start of the tail and a
  // census that is not first reads as a MISSING quantity — i.e. as a converged run.
  const q = progressQuantity(TOKEN);
  assert.deepEqual(q, { token: "coverage_no_status", value: 3 });
  // The row list is bracketed and comma-joined AFTER the census, and cannot move it.
  assert.match(TOKEN, /^coverage_no_status:no_status=3;/);
  assert.ok(!/\(/.test(TOKEN.split(";")[0]), "no parenthesis before the census — the merge-gate remedy truncates at the first one");
});

test("the hint names the rows, not a rule for reproducing identifiers", () => {
  const h = correctionHint(TOKEN);
  assert.match(h, /CB-A1B2C3D4/, "the driver's own row id — the string the seat can find without searching");
  assert.match(h, /confirmed-clean \/ coverage-limited \/ deferred/, "the closed status set");
  assert.ok(!/verbatim/i.test(h),
    "nothing is transcribed any more, so nothing is required verbatim — that instruction was the defect");
  assert.ok(!/standing alone/i.test(h), "the hit-count join is gone with the join");
  assert.match(h, /open/, "and it still states the one thing an open row may not be");
});

test("a form_damaged token still produces a usable, non-empty hint", () => {
  const h = correctionHint("coverage_form_damaged:form_damaged=1;unparseable json Unexpected token");
  assert.match(h, /rows/);
  assert.ok(h.length > 80, "no empty hint on the damaged shape");
});

test("coverage_form_missing tells the truth: this is not the model's to repair", () => {
  const h = correctionHint("coverage_form_missing:_driver/register-coverage-form.form.json absent");
  assert.match(h, /DRIVER defect/);
  assert.ok(!/EDIT|fix the form/i.test(h), "a seat cannot patch a file it was never told about");
});

test("THE RETURN SHAPE: the calculation carries total_hits and the unaccounted legs", () => {
  // 's:64-76, unchanged in substance: total_hits was a disclosure key and the gate always had it.
  // It rides the row now instead of a failure token, and the assertion is the same one.
  const plan = { entries: [{ qid: "ic:owner:glimmer+holdings", axis: "incumbent-class", predicate: "owner",
    term: "GLIMMER", owner: "Incumbent Holdings", nice_classes: ["5", "30"], expected_kind: "enumerate" }] };
  const skeleton = [{ axis: "incumbent-class", state: "incomplete", entries: 1, executed: 1, crowds: 1, skipped: 0, missing: [] }];
  const bands = { "incumbent-class": [{ state: "incomplete", qid: "ic:owner:glimmer+holdings",
    query: "owner × GLIMMER", total_hits: 805, reason: "count-first per-CLASS rescue ran",
    class_counts: { 5: { total_hits: 700, disposition: "crowd" }, 30: { total_hits: 90, disposition: "unenumerated" } } }] };
  const open = openBlocksByAxis(skeleton, bands, plan);
  assert.deepEqual(Object.keys(open), ["incumbent-class"]);
  assert.equal(open["incumbent-class"][0].total_hits, 805, "the number the model used to have to write is the number the gate computed");
  assert.deepEqual(open["incumbent-class"][0].unaccounted_classes, ["30"]);
});
