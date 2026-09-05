// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — drives the pure join over fixtures shaped like the artifacts two real runs wrote
// — TWO CORRECT ARTIFACTS, BLIND TOGETHER.
//
// `recall-reconciliation.json` measures the DIGEST and said `unended: 0`. True. `record-carry.json`
// measures REASONS and said `unreasoned: 0`. Also true — it counts `reason_source === "absent"` and
// nothing else. Between them, a position the digest ended as a FINDING was dropped at placement with
// `placement:not-selected` and `reason_source: "step-silent"`, and the client lost the mark while both
// counters read clean. Nobody joined them. This is the join.
//
// WHAT MUST NOT FIRE IS THE HARD PART. Silent drops are the NORM: placement dropped 690 of 741 records
// on the evidence run, and `step-silent` is the MAJORITY disposition on delivered clearances (975 of
// 1455 rows on one). The defect is the CONJUNCTION — silence AFTER a step recorded the record as a
// finding. Measured over six runs, two matters, four lanes: nine divergences from a digest
// finding-ending, every one `step-stated`, and one `step-silent` — the mark this issue was raised on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { silentlyLostFindings } from "../record-carry.mjs";

const URI = "/mark/us/ceeeef5e-ac9f-482b-93a6-9b09165ee1cc";
const OTHER = "/mark/us/ac1100e2-8bce-4731-81dd-7694769f829c";
const recon = (rows) => ({ computable: true, top_slice: rows, residual: [] });
const endedFinding = (uri, mark) => ({ ending: "finding", mark_text: mark, position_records: [uri] });

test("1955 a digest FINDING dropped with no stated reason is reported", () => {
  const r = silentlyLostFindings({
    reconciliation: recon([endedFinding(URI, "DELPHIC HSE")]),
    carryRows: [{ uri: URI.toLowerCase(), mark: "DELPHIC HSE", reach: "screened",
      stopped_at: "placement", reason: "placement:not-selected", reason_source: "step-silent" }],
  });
  assert.equal(r.computable, true);
  assert.equal(r.lost.length, 1, "the shape this issue was raised on must fire");
  assert.equal(r.lost[0].mark, "DELPHIC HSE");
  assert.equal(r.lost[0].stopped_at, "placement");
});

test("1955 the DISCRIMINATOR — the same divergence with a STATED reason is left alone", () => {
  // Nine of these across six runs, all legitimate: a later step reconsidered and said why. A rule that
  // fired on divergence rather than on SILENCE would have flagged every one of them.
  const r = silentlyLostFindings({
    reconciliation: recon([endedFinding(URI, "DELPHIN & EMERENCE")]),
    carryRows: [{ uri: URI.toLowerCase(), reach: "screened", stopped_at: "synthesis",
      reason: "synthesis:declined:not-worth-the-line", reason_source: "step-stated" }],
  });
  assert.deepEqual(r.lost, [], "a recorded judgment call is not a silent loss");
  assert.equal(r.checked, 1, "…and it was actually examined, not skipped");
});

test("1955 a step-silent drop that the digest never ended as a finding is NOT flagged", () => {
  // step-silent is the MAJORITY disposition on real runs. Flagging it alone would flag the whole run.
  const r = silentlyLostFindings({
    reconciliation: recon([endedFinding(URI, "DELPHIC HSE")]),
    carryRows: [
      { uri: URI.toLowerCase(), reach: "finding", stopped_at: null, reason: null, reason_source: null },
      { uri: OTHER.toLowerCase(), reach: "screened", stopped_at: "placement",
        reason: "placement:not-selected", reason_source: "step-silent" },
    ],
  });
  assert.deepEqual(r.lost, [], "only silence AFTER a digest finding-ending is the defect");
});

test("1955 arrival counts as arrival — reach `finding` and `findings-surface` both clear", () => {
  for (const reach of ["finding", "findings-surface"]) {
    const r = silentlyLostFindings({
      reconciliation: recon([endedFinding(URI, "M")]),
      carryRows: [{ uri: URI.toLowerCase(), reach, stopped_at: null, reason: null, reason_source: "step-silent" }],
    });
    assert.deepEqual(r.lost, [], `reach ${reach} reached a reader and is not a loss`);
  }
});

// ── THE GUARD THAT WOULD HAVE SHIPPED THIS DEAD ──────────────────────────────────────────────────
// The two artifacts disagree on URI case — digest side upper, carry side lower. A case-sensitive join
// matches ZERO rows on every run, and zero matches is indistinguishable from zero silent divergences:
// a check that can never fire while reporting clean, on an issue about losses that report clean.
test("1955 the join NORMALISES URI case, and a matched count proves it looked", () => {
  const r = silentlyLostFindings({
    reconciliation: recon([endedFinding(URI.toUpperCase(), "DELPHIC HSE")]),
    carryRows: [{ uri: URI.toLowerCase(), reach: "screened", stopped_at: "placement",
      reason: "placement:not-selected", reason_source: "step-silent" }],
  });
  assert.equal(r.matched, 1,
    "the artifacts disagree on case; a case-sensitive join matches nothing and reports clean forever");
  assert.equal(r.lost.length, 1, "and the loss must survive the normalisation, not just the match");
});

test("1955 NOT COMPUTABLE is never a pass — the knockout lane writes no record-carry", () => {
  const r = silentlyLostFindings({ reconciliation: recon([endedFinding(URI, "M")]), carryRows: null });
  assert.equal(r.computable, false, "an absent artifact must not answer `no losses`");
  assert.match(r.reason, /knockout/i, "and the exclusion is NAMED, so a reader knows what went unchecked");
  assert.deepEqual(r.lost, []);
});

test("1955 an EMPTY population is its own state, not a clean answer", () => {
  // Measured: two of seven runs carry `computable: true` with zero candidates while an independent walk
  // of their typed digest calls names finding-shaped records. There, this join looks at nothing.
  const r = silentlyLostFindings({ reconciliation: recon([]), carryRows: [] });
  assert.equal(r.population_empty, true, "zero-population must be distinguishable from zero-losses");
  assert.equal(r.checked, 0);
  assert.match(r.reason, /no population/i);
});

// ── — ZERO IS NOT THE ONLY WAY TO LOOK AT THE WRONG SET ───────────────────────
//
// The e2e lane drove the merged check against archived artifacts and found a run where the
// reconciliation carried ONE finding-ended position while the digest's typed calls recorded NINE
// finding rows, sharing nothing. `checked 1, matched 1, lost 0` — looked, and found nothing.
const DIGEST_A = "/mark/gb/c3154106-158a-4756-b8f6-116bc310172f";
const DIGEST_B = "/mark/jp/310027f2-0562-46fe-abea-385f068a8150";

test("2141 populations that share NOTHING are not computable — the answer cannot be trusted", () => {
  const r = silentlyLostFindings({
    reconciliation: recon([endedFinding(URI, "VENTORI")]),
    carryRows: [{ uri: URI.toLowerCase(), reach: "finding", stopped_at: null, reason_source: null }],
    digestFindingUris: [DIGEST_A, DIGEST_B],
  });
  assert.equal(r.computable, false, "a disjoint population must refuse, not report clean");
  assert.match(r.reason, /disjoint/i, "and it must say WHICH way it is broken");
  assert.deepEqual(r.lost, []);
});

test("2141 a SHORTFALL alone must NOT trip it — that naive rule breaks the detection", () => {
  // The reconciliation's population is POSITIONS over the screened dominant-element set, so it is
  // NARROWER than the digest's finding rows by construction. Measured on two healthy delivered runs:
  // 5 against 9, and 5 against 8, both sharing 3. Refusing on a shortfall would refuse on the very run
  // this family was raised from. Overlap is the signal; count is not.
  const r = silentlyLostFindings({
    reconciliation: recon([endedFinding(URI, "DELPHIC HSE")]),
    carryRows: [{ uri: URI.toLowerCase(), reach: "screened", stopped_at: "placement",
      reason: "placement:not-selected", reason_source: "step-silent" }],
    digestFindingUris: [URI, DIGEST_A, DIGEST_B],   // 3 digest rows vs 1 position, but they OVERLAP
  });
  assert.equal(r.computable, true, "a narrower population is normal and must still be answerable");
  assert.equal(r.lost.length, 1, "…and the loss must still be found — this is the detection the guard protects");
});

test("2141 nothing to compare is DISTINGUISHABLE from compared-and-clean", () => {
  // The criterion this arm replaces asserted only that the join still answers, which it did — and the
  // two returns were byte-identical, so "could not look" read exactly like "looked and found nothing".
  // The real test is that they DIFFER, so it is written as a comparison rather than as two assertions.
  const args = {
    reconciliation: recon([endedFinding(URI, "M")]),
    carryRows: [{ uri: URI.toLowerCase(), reach: "finding", stopped_at: null, reason_source: null }],
  };
  const compared = silentlyLostFindings({ ...args, digestFindingUris: [URI, DIGEST_A] });
  const notCompared = silentlyLostFindings({ ...args, digestFindingUris: [] });
  assert.equal(compared.lost.length, 0);
  assert.equal(notCompared.lost.length, 0);
  assert.notDeepEqual(compared, notCompared,
    "a run where no cross-check was possible must not return the same thing as one that was compared "
    + "and came back clean — that is an absence reading as a pass, inside the check built to stop it");
  assert.equal(compared.cross_checked, true);
  assert.equal(notCompared.cross_checked, false, "and the flag must say which happened");
  assert.equal(compared.reason, null);
  assert.match(notCompared.reason, /no cross-check was possible/i, "…with a reason, like the other two states");
});

test("2141 a missing cross-check population still lets the join answer on what it has", () => {
  // Two of the eight archived runs recorded no typed finding rows at all. A caller with no cross-check
  // population passes null, and the guard must stay silent rather than invent a verdict.
  for (const digestFindingUris of [null, []]) {
    const r = silentlyLostFindings({
      reconciliation: recon([endedFinding(URI, "M")]),
      carryRows: [{ uri: URI.toLowerCase(), reach: "screened", stopped_at: "placement",
        reason: "placement:not-selected", reason_source: "step-silent" }],
      digestFindingUris,
    });
    assert.equal(r.computable, true, `${JSON.stringify(digestFindingUris)} must not refuse`);
    assert.equal(r.lost.length, 1, "the join still answers on the evidence it does have");
  }
});
