// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A CORRECTED KNOCKOUT DELIVERS ITS CORRECTION. The pre-delivery check compares what publishes with what the review round
// accepted: a removed finding is gone, a changed finding or line is not as it was rated, and the name's block in the order's
// summary heads it with the band the record now gives it. A deliberately stale delivery is caught, a clean review and a
// round that accepted nothing are checked and pass, and a run that holds no review lists the check with its reason.
// Names here are invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { knockoutCorrectionChecks, readCorrectionRound, headedBand } from "../knockout-correction-check.mjs";
import { runKnockoutLint, deliveryFlagLines } from "../predelivery-lint.mjs";

const LADDER = ["High", "Medium", "Low"];
const finding = (over = {}) => ({ ordinal: 1, name: "Tarnwick Lamps", owner: "Tarnwick Lamps Ltd", type: "Registered mark", band: "High",
  net: "Tarnwick Lamps would likely object to this name for lamps.", basis: "The same name on lamps.", evidence: ["https://lamps.example.test/tarnwick"], ...over });
const record = ({ rating, findings, summary }) => ({
  schema_version: 1, framework: { source: "house", ladder: LADDER },
  batch: { productContext: "lamps", standardCaveats: [], executiveSummary: summary },
  marks: [
    { name: "TARNWICK", rating, basis: "The same name on lamps.", assessment: "TARNWICK meets a registered mark.", findings },
    { name: "ORVELLE", rating: "Low", basis: "Nothing found.", assessment: "ORVELLE meets nothing.", findings: [] },
  ],
});
const SUMMARY = (band, line) => `TARNWICK, rated ${band}: ${line}\n\n## TARNWICK — ${band}\n- ${line}\n\nORVELLE, rated Low: nothing found.\n\n## ORVELLE — Low\n- Nothing found.`;

// The round: the names as rated, one defect on TARNWICK's finding, and the correction that moved it to Medium.
const RATED = record({ rating: "High", findings: [finding()], summary: SUMMARY("High", "Tarnwick Lamps trades under the name on lamps.") });
const CORRECTED = record({ rating: "Medium", findings: [finding({ band: "Medium", net: "Tarnwick Lamps sells lamp shades, not lamps; an objection is possible." })],
  summary: SUMMARY("Medium", "Tarnwick Lamps sells lamp shades under the name, next to lamps.") });
const WORK = { schema_version: 1, rated: RATED, defects: [{ n: 1, kind: "band", mark: "TARNWICK", finding: 1, problem: "The band overstates a shade seller.",
  rests_on: [], chunk: 0, names: { name: "Tarnwick Lamps", owner: "Tarnwick Lamps Ltd" } }] };
const CORRECTIONS = { defects: WORK.defects, outcomes: [{ n: 1, kind: "band", outcome: "findings-changed", targets: ["Tarnwick Lamps"], removed: [] }] };
const REVIEW = { schema_version: 1, first_question: "Does each name's band rest on its evidence?", material: [{ kind: "band", mark: "TARNWICK", finding: 1, problem: "x" }] };
const round = { review: REVIEW, corrections: CORRECTIONS, work: WORK };
const failing = (r) => r.checks.filter((c) => !c.pass).map((c) => c.id);

test("a correction delivered as accepted passes, the record and the summary both", () => {
  const r = knockoutCorrectionChecks({ findings: CORRECTED, round });
  assert.equal(r.notApplicable, null);
  assert.deepEqual(r.checks.map((c) => c.id), ["correction-consistency:record:1", "correction-consistency:summary:1"]);
  assert.deepEqual(failing(r), [], JSON.stringify(r.checks));
});

test("a delivery left as it was rated is caught: the finding before its correction, and the summary heading the old band", () => {
  const r = knockoutCorrectionChecks({ findings: RATED, round });
  assert.deepEqual(failing(r), ["correction-consistency:record:1"], "the finding as rated was delivered and nothing flagged it");
  // Only the summary is stale: the record carries the correction, the summary still heads TARNWICK High.
  const staleSummary = { ...CORRECTED, batch: { ...CORRECTED.batch, executiveSummary: RATED.batch.executiveSummary } };
  const s = knockoutCorrectionChecks({ findings: staleSummary, round });
  assert.deepEqual(failing(s), ["correction-consistency:summary:1"]);
  assert.match(s.checks.find((c) => !c.pass).detail, /heads "TARNWICK" High and the delivered record rates it Medium/);
  assert.match(s.checks.find((c) => !c.pass).detail, /moved from High to Medium and its summary block is as it was rated/);
});

test("a finding the correction removed must not be delivered, nor named in the name's summary block", () => {
  const removed = { ...round, corrections: { ...CORRECTIONS, outcomes: [{ n: 1, kind: "band", outcome: "findings-removed", targets: ["Tarnwick Lamps"], removed: ["Tarnwick Lamps"] }] } };
  const gone = record({ rating: "Low", findings: [], summary: SUMMARY("Low", "Nothing found that would block the name.") });
  assert.deepEqual(failing(knockoutCorrectionChecks({ findings: gone, round: removed })), []);
  const stillThere = record({ rating: "Low", findings: [finding({ band: "Low" })], summary: SUMMARY("Low", "Tarnwick Lamps trades under the name on lamps.") });
  assert.deepEqual(failing(knockoutCorrectionChecks({ findings: stillThere, round: removed })), ["correction-consistency:record:1"]);
  const namedInSummary = record({ rating: "Low", findings: [], summary: SUMMARY("Low", "Tarnwick Lamps trades under the name on lamps.") });
  const r = knockoutCorrectionChecks({ findings: namedInSummary, round: removed });
  assert.deepEqual(failing(r), ["correction-consistency:summary:1"]);
  assert.match(r.checks.find((c) => !c.pass).detail, /still names "Tarnwick Lamps", which the correction removed/);
});

test("a clean review, and a round that accepted nothing, are checked and pass", () => {
  const clean = knockoutCorrectionChecks({ findings: RATED, round: { review: { ...REVIEW, material: [] }, corrections: null, work: null } });
  assert.deepEqual(clean.checks.map((c) => [c.id, c.pass]), [["correction-consistency", true]]);
  assert.match(clean.checks[0].detail, /raised no defect/);
  const stoodDown = knockoutCorrectionChecks({ findings: RATED, round: { ...round, corrections: { ...CORRECTIONS, outcomes: [], failure: "correction-failed" } } });
  assert.deepEqual(stoodDown.checks.map((c) => [c.id, c.pass]), [["correction-consistency", true]]);
  assert.match(stoodDown.checks[0].detail, /stood down \(correction-failed\)/);
  const unchanged = knockoutCorrectionChecks({ findings: RATED, round: { ...round, corrections: { ...CORRECTIONS, outcomes: [{ n: 1, outcome: "findings-unchanged" }] } } });
  assert.deepEqual(failing(unchanged), []);
});

test("what cannot be compared is said, never passed: no review, or an accepted correction with the names as rated gone", () => {
  const none = knockoutCorrectionChecks({ findings: RATED, round: { review: null, corrections: null, work: null } });
  assert.deepEqual(none.checks, []);
  assert.match(none.notApplicable.reason, /holds no review record/);
  const noWork = knockoutCorrectionChecks({ findings: CORRECTED, round: { ...round, work: null } });
  assert.deepEqual(noWork.checks.map((c) => [c.id, c.surface, c.pass]), [["correction-consistency:round", "findings", false]]);
  const noRecord = knockoutCorrectionChecks({ findings: RATED, round: { review: REVIEW, corrections: null, work: null } });
  assert.deepEqual(noRecord.checks.map((c) => [c.id, c.surface, c.pass]), [["correction-consistency:round", "findings", false]]);
});

test("the lint carries the check: a stale delivery reaches the lawyer through the correction sentence, and an unhanded round is listed", () => {
  const dir = mkdtempSync(join(tmpdir(), "ko-correction-"));
  mkdirSync(join(dir, "_driver"), { recursive: true });
  writeFileSync(join(dir, "knockout-review.json"), JSON.stringify(REVIEW));
  writeFileSync(join(dir, "_driver", "knockout-corrections.json"), JSON.stringify(CORRECTIONS));
  writeFileSync(join(dir, "_driver", "knockout-correction-work.json"), JSON.stringify(WORK));
  const lint = runKnockoutLint({ findings: RATED, correction: knockoutCorrectionChecks({ findings: RATED, round: readCorrectionRound(dir) }) });
  const ours = lint.failures.filter((c) => c.id.startsWith("correction-consistency"));
  // The whole delivery as rated: its summary agrees with its record, so the record is what the check catches.
  assert.deepEqual(ours.map((c) => c.id), ["correction-consistency:record:1"]);
  assert.deepEqual(deliveryFlagLines(ours.filter((c) => c.surface === "report")).filter((l) => /review corrected/.test(l)).length, 1,
    "a stale correction does not reach the reviewing lawyer as one line");
  assert.ok(!lint.notApplicable.some((x) => x.id === "correction-consistency"), "a checked round is still listed as not applicable");
  const unhanded = runKnockoutLint({ findings: RATED });
  assert.ok(unhanded.notApplicable.some((x) => x.id === "correction-consistency" && /not handed/.test(x.reason)));
});

test("a corrected name the summary gives no block is recorded as not compared, never passed and never put to the reader", () => {
  const noBlock = { ...CORRECTED, batch: { ...CORRECTED.batch, executiveSummary: "ORVELLE, rated Low: nothing found.\n\n## ORVELLE — Low\n- Nothing found." } };
  const r = knockoutCorrectionChecks({ findings: noBlock, round });
  assert.deepEqual(r.checks.filter((c) => !c.pass).map((c) => [c.id, c.surface]), [["correction-consistency:summary:1", "findings"]]);
});

test("the heading's band is read from the ladder, never from a name that holds a band word", () => {
  assert.equal(headedBand("## HIGH TIDE — Low", "HIGH TIDE", LADDER), "Low");
  assert.equal(headedBand("## TARNWICK", "TARNWICK", LADDER), null);
  assert.equal(headedBand("## TARNWICK — Very High", "TARNWICK", ["Very High", "High", "Low"]), "Very High");
});
