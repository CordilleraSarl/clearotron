// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE MERGED KNOCKOUT RECORD MEETS THE TONE AND FIGURE CHECKS EACH GROUP MUST MEET.
//
// The banned-tone and quantity checks run on each group's record and again on the record composed from them, in the chunk gate's own
// words, so a phrase or a figure on the merged record is refused at the gate the report is delivered through. Invented data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateMergedFindings } from "../verify-knockout.mjs";
import { invented, merged, mark, finding } from "./ko-fixture-invented.mjs";

/** The merged record with one name's basis set to `text`. */
const withBasis = (text) => { const doc = merged(mark("Slight", [finding("Slight")])); doc.marks[0].basis = text; return doc; };
const toneOrFigure = (failures) => failures.filter((x) => /banned tone|quantitative claim/.test(x));

test("a merged record carrying a banned phrase or a figure is refused by the gate it must pass", () => {
  const d = invented();
  assert.deepEqual(toneOrFigure(validateMergedFindings(d, withBasis("This name will be extremely difficult to clear."), { marks: [] }).failures),
    ['mark "TESTMARK": banned tone "extremely difficult" — measured tone only (the band colour carries urgency)']);
  assert.deepEqual(toneOrFigure(validateMergedFindings(d, withBasis("The owner's track has 2 million streams."), { marks: [] }).failures),
    ['mark "TESTMARK": quantitative claim "2 million streams" — describe nature and reach, never counts/figures']);
});

test("a measured line passes, and so does the record as rated", () => {
  const d = invented();
  assert.deepEqual(toneOrFigure(validateMergedFindings(d, withBasis("The name sits near a property known in the client's field."), { marks: [] }).failures), []);
  assert.deepEqual(toneOrFigure(validateMergedFindings(d, merged(mark("Slight", [finding("Slight")])), { marks: [] }).failures), []);
});
