// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// coverage-disclosure-carries-no-engine-output.test.mjs —, two leaks on one surface.
//
// ── WHAT WAS MEASURED, AND ON WHICH SIDE OF THE TRANSFORM ─────────────────────────────────────────
//
// Both defects were filed off the RAW `report.html` and both severities were wrong, in opposite
// directions, because the client is not served that file: `readReport` → `prepareReportForEmbed(html,
// {staff:false})` sits in between, and `portal-report.mjs` strips the `cov-read` paragraph BY NAME while
// passing coverage rows through untouched. Re-measured on the served side:
//
//   the paragraph          419,677 raw → 124,650 served, `cov-read` GONE      (internal surface)
//   `no-resumable-session`      8 raw →       8 served                        (CLIENT surface)
//
// So the fold is an internal bloat defect with a spectacular tail, and the raw tokens are the
// client-facing one. Both are fixed here because they are one surface and one revert story; the
// assertions below keep the two severities straight so a later reader does not re-invert them.
import test from "node:test";
import assert from "node:assert/strict";
import { projectCoverageJudgment, COVERAGE_JUDGMENT_ROW_CAP } from "../findings-model.mjs";
import { deferralCoverageRow } from "../pipeline.mjs";

const row = (i) => ({
  area: `saturation-probe / default: TERM${i} [cl 5, 32]`,
  areaLabel: `field-size count / default: TERM${i} [cl 5, 32]`,
  note: "deferred — How crowded this term is in the Chinese register was never measured, because this run's register cannot search China.",
});
const cj = (n) => ({ sufficient: false, reason: "The dangerous category here is a prior Chinese right, and none of it was seen.", rows: Array.from({ length: n }, (_, i) => row(i)) });

// ── the fold ──────────────────────────────────────────────────────────────────────────────────────

test("the cap clears every row count the delivered corpus actually produced", () => {
  // Swept against the 17 delivered runs in the pool: 3 5 6 6 6 7 7 8 9 9 10 11 13 13 14 18, and one at
  // 1,278. A cap of 12 would clip five of them; 18 and above clips exactly the one. The bound is derived
  // from that sweep and this arm is what stops it being lowered into the working range by eye.
  assert.ok(COVERAGE_JUDGMENT_ROW_CAP >= 18,
    `the cap is ${COVERAGE_JUDGMENT_ROW_CAP}, below the 18 rows a real delivered run produced — that clips ordinary matters, not the tail`);
  const ordinary = projectCoverageJudgment(cj(18));
  assert.doesNotMatch(ordinary.reason, /further coverage row/,
    "an 18-row run is an ORDINARY run in this corpus and must fold whole — a cap that trims it is trimming the product, not the defect");
});

test("the pathological run folds to a paragraph instead of a document", () => {
  const out = projectCoverageJudgment(cj(1278));
  assert.ok(out.reason.length < 8000,
    `1,278 rows folded to ${out.reason.length} chars — the delivered defect was 287,233, which was 68% of the whole report.html`);
});

test("the overflow is STATED and names where the rest live — silence here is the original disease", () => {
  const out = projectCoverageJudgment(cj(1278));
  assert.match(out.reason, /1254 further coverage row/, "the count of what was withheld must be on the page; '24 rows' and '24 of 1,278' are different claims");
  assert.match(out.reason, /coverage_judgment\.rows/, "…and it must name the artifact holding the rest, or the reader cannot go and look");
});

test("nothing else about the projection moved", () => {
  assert.equal(projectCoverageJudgment(cj(1278)).sufficient, false, "the sufficiency verdict is not this fix's business");
  assert.equal(projectCoverageJudgment({ sufficient: true, reason: "x", rows: [] }).reason, "x", "a rows-less judgment passes through untouched");
  assert.equal(projectCoverageJudgment(null), null);
  const three = projectCoverageJudgment(cj(3));
  assert.doesNotMatch(three.reason, /further coverage row/, "no overflow clause on a run that has no overflow");
});

test("PLANT: uncap the fold and the pathological run explodes again", () => {
  // The arm above passes trivially if the cap is doing nothing, so prove the mechanism carries the
  // result: the same rows, folded the way the shipped code folded them, are two orders of magnitude
  // larger. If this ever fails, the cap has stopped being what keeps the paragraph small.
  const rows = cj(1278).rows;
  const uncapped = rows.map((r) => `${r.areaLabel}: ${r.note}`).join("; ");
  assert.ok(uncapped.length > 100_000, "the uncapped fold is what shipped — if it is small now, this fixture stopped reproducing the defect");
  assert.ok(projectCoverageJudgment(cj(1278)).reason.length * 20 < uncapped.length,
    "the capped projection is not dramatically smaller than the uncapped fold — the cap is not the thing doing the work");
});

// ── the tokens ────────────────────────────────────────────────────────────────────────────────────

// Every token `regDeferReason` / `partitionFiring` mint, plus the two families already translated,
// plus one that does not exist. The last is the important row: the set is OPEN, and `return t` published
// whatever it did not recognise, so a token minted tomorrow leaked on the day it was minted.
const MINTED = [
  "no-resumable-session", "unchanged-after-resume", "not-verified-closed", "source-not-swept",
  "digest-locked-resume", "resume-arm-unverifiable: the warm-resume arm has no deterministic evidence",
  "proposals-rejected: term 珂萝玛 is not in Latin script",
  "slice-not-landed:supp:primary-sweep:exact:vibrante:f2df73b9",
  "redigest-fail:timeout", "mechanical-fail:timeout", "mechanical-fail:429",
  "no-code-remedy: a field class-gap with no searchable term×class pair",
  "a-token-nobody-has-minted-yet:with-a-hash-abc123",
];

test("no minted deferral token reaches the client's own prose", () => {
  for (const t of MINTED) {
    const note = deferralCoverageRow("Follow-up on the ACME portfolio", t).note;
    const tail = note.split("not completed this run — ")[1] ?? "";
    assert.ok(tail, `no reader-facing tail at all for "${t}"`);
    assert.doesNotMatch(tail, /[a-z]+-[a-z]+(-[a-z]+)*:/,
      `"${t}" reached the client as an engine token: ${tail.slice(0, 90)}`);
    assert.ok(!tail.includes(t), `"${t}" was published verbatim`);
  }
});

test("…and the disclosure SURVIVES the translation — #762's ruling is translate, never filter", () => {
  // The failure mode on the other side: a translation that drops the sentence has filtered the
  // disclosure by other means, and a reader told nothing about an unsearched slice is worse off than one
  // told about it in engine words.
  for (const t of MINTED) {
    const note = deferralCoverageRow("Follow-up on the ACME portfolio", t).note;
    assert.match(note, /not completed this run/, `"${t}" lost the not-completed statement`);
    assert.ok(note.length > 60, `"${t}" reduced to a stub — the row still has to tell the reader the slice is open`);
  }
});

test("an UNKNOWN token is the case the fallback exists for, and it is the one that used to leak", () => {
  const tail = deferralCoverageRow("Follow-up", "brand-new-shape:9f2a1c").note.split("not completed this run — ")[1];
  assert.doesNotMatch(tail, /brand-new-shape|9f2a1c/,
    "the default still publishes what it does not recognise — the nine named arms are the courtesy and this is the fix");
  assert.match(tail, /not completed this run|could not be completed/, "…and it must still say the slice is open");
});
