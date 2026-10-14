// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE KNOCKOUT REVIEW'S REWRITES MEET THE TONE AND FIGURE CHECKS THE FIRST PASS MUST MEET.
//
// A rewrite the reviewing pass applies replaces the rated record only after the merged gate passes it, "the same
// gate, not a lighter one". The banned-tone and quantity checks ran in the chunk gate alone, so a rewritten basis
// line could reach the knockout report with a phrase or a figure the first pass would have refused. Both checks
// now run on the merged record too, in the chunk gate's own words, and a refused rewrite leaves the rated record
// standing. Invented data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateMergedFindings } from "../verify-knockout.mjs";
import { applyKnockoutReview } from "../knockout-review-record.mjs";
import { invented, merged, mark, finding } from "./ko-fixture-invented.mjs";

const rewrite = (text) => applyKnockoutReview(merged(mark("Slight", [finding("Slight")])), { rewrites: [{ at: { field: "basis", mark: "TESTMARK" }, text }] });
const toneOrFigure = (failures) => failures.filter((x) => /banned tone|quantitative claim/.test(x));

test("a rewrite that adds a banned phrase or a figure is refused by the gate it must pass", () => {
  const d = invented();
  const loud = rewrite("This name will be extremely difficult to clear.");
  assert.equal(loud.receipt.applied, 1, "guard: the rewrite was applied to the record the gate then reads");
  assert.deepEqual(toneOrFigure(validateMergedFindings(d, loud.doc, { marks: [] }).failures),
    ['mark "TESTMARK": banned tone "extremely difficult" — measured tone only (the band colour carries urgency)']);
  assert.deepEqual(toneOrFigure(validateMergedFindings(d, rewrite("The owner's track has 2 million streams.").doc, { marks: [] }).failures),
    ['mark "TESTMARK": quantitative claim "2 million streams" — describe nature and reach, never counts/figures']);
});

test("a clean rewrite still passes, and so does the first pass's own record", () => {
  const d = invented();
  assert.deepEqual(toneOrFigure(validateMergedFindings(d, rewrite("The name sits near a property known in the client's field.").doc, { marks: [] }).failures), []);
  assert.deepEqual(toneOrFigure(validateMergedFindings(d, merged(mark("Slight", [finding("Slight")])), { marks: [] }).failures), []);
});
