// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// reference-score-counts.test.mjs —. A knockout is graded on what a knockout promises.
//
// R3 and R4 are knockout scenarios whose gold sets are clearance-grade lawyer reviews listing SIMILAR
// marks. A knockout counts the exact mark and its close variations; it never retrieves similar marks, so
// every entry on those sheets is unreachable BY CONSTRUCTION. The 2026-08-12 round scored 0/8 and 0/9 on
// both free-tier and clarivate — same day, same engine — and the scorer footnoted every miss
// "register-only run: no gather/judgment seam to measure".
//
// Two costs, and the tests below are split along them:
//
//   · the two cheapest scenarios cannot detect a recall regression, because they are pinned at the floor.
//     If close-variation counting broke, nothing in R3/R4 scoring would move. That is what `scoreCounts`
//     and its `close_variations` axis are for.
//   · every scoreboard reader sees "0/8 found · band Medium" and reads a broken product. That is what
//     `referenceLaneMismatch` is for, and it must REFUSE rather than annotate — a footnote under a
//     headline nobody reads past is not a disclosure.
import { test } from "node:test";
import assert from "node:assert/strict";

import { scoreCounts, referenceLaneMismatch, validateReference, REFERENCE_SCHEMA_VERSION } from "../reference-score.mjs";

const SIMILAR_MARKS_SHEET = {
  schema_version: REFERENCE_SCHEMA_VERSION,
  scenario: "R3",
  source: "lawyer review, synthetic fixture",
  register: [{ mark: "TIKI PUNCH", classes: ["30"] }, { mark: "TIKI TROPICS", classes: ["30"] }],
};

const COUNT_SHEET = {
  ...SIMILAR_MARKS_SHEET,
  counts: [{
    mark: "CORAL FREEZE", classes: [30, 32],
    identical: { min: 0, max: 4 },
    close_variations: ["CORALFREEZE", "CORAL-FREEZE"],
  }],
};

const runCounts = (total) => ({
  schema: 1, provider: "free-tier",
  marks: [{ name: "CORAL FREEZE", classes: [30, 32], counts: { identical: { total }, containing: { total: 411 } } }],
});
const runRecords = (terms) => ({
  schema: 1, provider: "free-tier",
  marks: [{ name: "CORAL FREEZE", terms: terms.map((t) => ({ term: t, basis: "close", ok: true })) }],
});

// ── the refusal ──────────────────────────────────────────────────────────────────────────────────────

test("#814 a knockout against a similar-marks sheet is REFUSED, and the refusal says why", () => {
  const why = referenceLaneMismatch({ lane: "knockout", ref: SIMILAR_MARKS_SHEET });
  assert.ok(why, "the pairing that produced 0/8 twice in one day must not score at all");
  assert.match(why, /KNOCKOUT lane/);
  assert.match(why, /naming 2 mark\(s\)/, "it names the size of the sheet it is refusing");
  assert.match(why, /counts/, "and names the block that would fix it");
  assert.match(why, /R3/, "and which scenario, so a batch run says which one stopped");
});

test("#814 a knockout WITH a counts block scores normally", () => {
  assert.equal(referenceLaneMismatch({ lane: "knockout", ref: COUNT_SHEET }), null);
});

test("#814 the clearance lane is untouched — a similar-marks sheet is the RIGHT reference there", () => {
  // The other half of the issue: the lawyer sheets stay the gold sets where the product promises
  // retrieval of similar marks. A refusal that fired on R2/R6 would delete the programme's main measure.
  for (const lane of ["clearance", "register", "prelim"])
    assert.equal(referenceLaneMismatch({ lane, ref: SIMILAR_MARKS_SHEET }), null, `${lane} must still score`);
});

test("#814 an empty counts array does not satisfy the refusal", () => {
  // `counts: []` is a gold set someone started and did not finish. Reading it as "count-shaped" would
  // score the knockout against nothing at all and print a clean sheet.
  assert.ok(referenceLaneMismatch({ lane: "knockout", ref: { ...SIMILAR_MARKS_SHEET, counts: [] } }));
});

// ── the count axis ───────────────────────────────────────────────────────────────────────────────────

test("#814 a count inside the lawyer's range is in-range; outside it says which side", () => {
  const at = (total) => scoreCounts({ counts: COUNT_SHEET.counts, registerCounts: runCounts(total),
    registerRecords: runRecords(["CORALFREEZE", "CORAL-FREEZE"]) }).rows[0];
  assert.equal(at(2).state, "in-range");
  assert.equal(at(0).state, "in-range", "the lawyer's floor is 0 — a true zero is an answer, not a miss");
  assert.equal(at(4).state, "in-range", "the range is inclusive at both ends");
  assert.equal(at(9).state, "above-range");
  assert.equal(at(2).counted, 2, "the figure itself is reported, never only the verdict");
});

test("#814 a count BELOW the floor is the recall regression this axis exists to catch", () => {
  const row = scoreCounts({
    counts: [{ mark: "CORAL FREEZE", identical: { min: 3, max: 9 } }],
    registerCounts: runCounts(1),
  }).rows[0];
  assert.equal(row.state, "below-range");
});

test("#814 the close variations are graded on whether the run PUT THEM to the register", () => {
  // Asked-and-answered-zero is a fact about the register. Never asked is a fact about the engine, and it
  // is the one "CORALFREEZE no longer caught" produces. They must not read the same.
  const { rows } = scoreCounts({ counts: COUNT_SHEET.counts, registerCounts: runCounts(2),
    registerRecords: runRecords(["CORALFREEZE"]) });
  assert.deepEqual(rows[0].variations, [
    { form: "CORALFREEZE", counted: true },
    { form: "CORAL-FREEZE", counted: false },
  ]);
});

test("#814 variation matching is case- and whitespace-insensitive, not a literal compare", () => {
  const { rows } = scoreCounts({ counts: COUNT_SHEET.counts, registerCounts: runCounts(2),
    registerRecords: runRecords([" coralfreeze ", "coral-freeze"]) });
  assert.ok(rows[0].variations.every((v) => v.counted),
    "a lane that lower-cased its terms would otherwise read as never having asked");
});

// ── the absences, which must never read as passes ────────────────────────────────────────────────────

test("#814 no counts sidecar is a FINDING, not a row of in-range zeros", () => {
  const out = scoreCounts({ counts: COUNT_SHEET.counts, registerCounts: null });
  assert.match(out.missingArtifact ?? "", /register-counts\.json is absent/);
  assert.deepEqual(out.rows, [], "no rows at all — an ungraded run must not print a graded one");
});

test("#814 a mark the run never counted is named, not skipped", () => {
  const row = scoreCounts({
    counts: COUNT_SHEET.counts,
    registerCounts: { schema: 1, marks: [{ name: "SOMETHING ELSE", counts: { identical: { total: 3 } } }] },
  }).rows[0];
  assert.equal(row.state, "not-counted");
  assert.equal(row.counted, null);
  assert.match(row.why, /holds no entry for this mark/);
});

test("#814 a records sidecar that is absent is reported, not rendered as every form uncounted", () => {
  const out = scoreCounts({ counts: COUNT_SHEET.counts, registerCounts: runCounts(2), registerRecords: null });
  assert.match(out.missingArtifact ?? "", /register-records\.json is absent/);
});

// ── the schema, and the migration ────────────────────────────────────────────────────────────────────

test("#814 every gold set in the config store keeps validating — counts is optional", () => {
  assert.deepEqual(validateReference(SIMILAR_MARKS_SHEET), []);
  assert.equal(REFERENCE_SCHEMA_VERSION, 1,
    "the version must NOT move: validateReference refuses any other value, so a bump stops every "
    + "existing gold set scoring at once");
});

test("#814 a well-formed counts block validates, and a malformed one is an ERROR not an ignore", () => {
  assert.deepEqual(validateReference(COUNT_SHEET), []);
  const bad = (counts) => validateReference({ ...SIMILAR_MARKS_SHEET, counts });
  assert.match(bad([{ identical: { min: 1 } }]).join(" "), /counts\[0\] has no `mark`/);
  assert.match(bad([{ mark: "X", identical: { min: 9, max: 2 } }]).join(" "), /min 9 above max 2/);
  assert.match(bad([{ mark: "X", identical: { min: "many" } }]).join(" "), /identical\.min must be a number/);
  assert.match(bad([{ mark: "X", close_variations: "CORALFREEZE" }]).join(" "), /close_variations must be an array/);
  assert.match(bad([{ mark: "X", close_variations: ["", "  "] }]).join(" "), /must be a non-empty string/);
  assert.match(bad("counts").join(" "), /must be a non-empty array/);
});
