// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A finding dropped WITH a stated reason is checked by something (tracker issue 248).
//
// THE GAP. `silentlyLostFindings` covers `step-silent` — a finding-ending followed by silence. It is
// correct and its boundary is deliberate. The stated case sat outside it and is the one that reached a
// client: on a delivered R2 run the sibling reported `{checked:5, matched:5, lost:0}` while two marks
// from the lawyer's final list, one rated HIGH, were absent from `findings.json` — dropped WITH a reason.
//
// A silent drop leaves a hole. A stated drop leaves a SENTENCE, and the sentence reads as diligence.
// That delivery carried 92 recall asks and 66 rulings of IMMATERIAL.
import { test } from "node:test";
import assert from "node:assert/strict";
import { statedDivergenceFindings, silentlyLostFindings } from "../record-carry.mjs";

const URI = "/mark/us/USAFI298B5701456D11E9B841005056B74373";
const recon = (uris = [URI]) => ({ computable: true,
  top_slice: [{ ending: "finding", mark_text: "OSLER DELPHI", position_records: uris }], residual: [] });

// The real shape: the digest ended it as a finding, it did not reach the findings, and the reason names
// a DIFFERENT artifact than the one the absence is about.
const STATED_ROW = { uri: URI, mark: "OSLER DELPHI", reach: "placed", stopped_at: "digest",
  reason: "already reasoned on the incumbent sheet in register-findings.md", reason_source: "step-stated" };

test("DRIVEN: a finding-ended position dropped with a stated reason is REPORTED", () => {
  const r = statedDivergenceFindings({ reconciliation: recon(), carryRows: [STATED_ROW], digestFindingUris: [URI] });
  assert.equal(r.computable, true);
  assert.equal(r.diverged.length, 1, "this is the class nothing checked, and it is the one that shipped");
  assert.equal(r.diverged[0].mark, "OSLER DELPHI");
});

test("DRIVEN: it names the artifact the reason points at — the substitution is the defect", () => {
  const r = statedDivergenceFindings({ reconciliation: recon(), carryRows: [STATED_ROW], digestFindingUris: [URI] });
  assert.deepEqual(r.diverged[0].cites_artifact, ["register-findings.md"],
    "an absence discharged by the WRONG artifact is what this check is for — a reader must be able to "
    + "see that the ask was about the findings and the answer was about the evidence sheet");
});

test("DRIVEN: the sibling still reports this row CLEAN — the two populations do not overlap", () => {
  // The whole reason this check exists. If the sibling caught it, widening the sibling would have been
  // the fix; it does not, by design, and asserting that keeps the boundary honest.
  const s = silentlyLostFindings({ reconciliation: recon(), carryRows: [STATED_ROW], digestFindingUris: [URI] });
  assert.equal(s.computable, true);
  assert.equal(s.lost.length, 0,
    "silentlyLostFindings owns step-silent; a stated drop sits outside its population and it is right to");
});

test("DRIVEN: a SILENT drop stays the sibling's, and this check does not double-report it", () => {
  const silent = { ...STATED_ROW, reason: null, reason_source: "step-silent" };
  const r = statedDivergenceFindings({ reconciliation: recon(), carryRows: [silent], digestFindingUris: [URI] });
  assert.deepEqual(r.diverged, [], "one row, one owner — two checks reporting it would double-count the class");
  const s = silentlyLostFindings({ reconciliation: recon(), carryRows: [silent], digestFindingUris: [URI] });
  assert.equal(s.lost.length, 1, "and the sibling must still catch it");
});

test("a position that ARRIVED is not a divergence, however it is reasoned", () => {
  for (const reach of ["finding", "findings-surface"]) {
    const r = statedDivergenceFindings({ reconciliation: recon(),
      carryRows: [{ ...STATED_ROW, reach }], digestFindingUris: [URI] });
    assert.deepEqual(r.diverged, [], `reach=${reach} means it arrived — reporting it would be a false positive`);
  }
});

test("step-structural is NOT in this population, and that is a decision rather than an omission", () => {
  // A mechanical screen verdict is not a judgment sentence a reader takes on trust, which is what this
  // check is about. Named here so the next reader sees it was considered.
  const r = statedDivergenceFindings({ reconciliation: recon(),
    carryRows: [{ ...STATED_ROW, reason_source: "step-structural" }], digestFindingUris: [URI] });
  assert.deepEqual(r.diverged, []);
});

// ── NOT COMPUTABLE IS NOT A PASS — the contract the sibling paid for, mirrored ─────────────────────
test("no reconciliation is a NAMED refusal, never a clean empty", () => {
  const r = statedDivergenceFindings({ reconciliation: null, carryRows: [STATED_ROW] });
  assert.equal(r.computable, false);
  assert.match(r.reason, /no computable recall-reconciliation/);
});

test("no carry rows is a NAMED refusal — the knockout lane writes none", () => {
  const r = statedDivergenceFindings({ reconciliation: recon(), carryRows: null });
  assert.equal(r.computable, false);
  assert.match(r.reason, /no record-carry rows/);
});

test("an empty population is its own state, not a pass", () => {
  // The population is the CARRY ROWS, so an empty one means no stated drop was recorded — not an empty
  // reconciliation. A row that ARRIVED is not a population member.
  const r = statedDivergenceFindings({ reconciliation: { computable: true, top_slice: [], residual: [] },
    carryRows: [{ ...STATED_ROW, reach: "finding" }] });
  assert.equal(r.population_empty, true);
  assert.equal(r.computable, true);
  assert.deepEqual(r.diverged, []);
  assert.ok(r.reason, "a zero population must say so — silence here reads as checked-and-fine");
});

// ── THE REGRESSION THIS FUNCTION SHIPPED WITH, AND THE FIXTURE THAT HID IT ─────────────────────────
//
// The first cut gated on the reconciliation's finding-ended positions, mirroring the sibling — and so
// inherited the sibling's blind spot. Replayed against the real R2 delivery it reported diverged=0 on a
// run that lost two of the lawyer's marks. The unit arms all passed because every fixture put the mark
// in BOTH populations at once, which the real run does not: the reconciliation named five OTHER marks.
//
// A fixture that satisfies two joins simultaneously cannot tell you the joins disagree. This arm is the
// real shape — present in carry, ABSENT from the reconciliation — and it is the one that would have
// caught it.
test("REGRESSION: a stated drop the reconciliation never mentions is still reported", () => {
  const reconciliationNamesOtherMarks = { computable: true, residual: [],
    top_slice: [{ ending: "finding", mark_text: "DELPHIC HSE", position_records: ["/mark/ch/SOMETHING-ELSE"] }] };
  const r = statedDivergenceFindings({ reconciliation: reconciliationNamesOtherMarks,
    carryRows: [STATED_ROW], digestFindingUris: null });
  assert.equal(r.diverged.length, 1,
    "the reconciliation's SILENCE about a position is not evidence the position is fine — gating on it "
    + "is what made this check inert on the delivery it was written for");
  assert.equal(r.diverged[0].mark, "OSLER DELPHI");
  assert.equal(r.diverged[0].reconciliation_agrees, false,
    "and the row says the reconciliation did not corroborate it, rather than hiding that");
  assert.equal(r.matched, 0, "`matched` now counts corroboration; zero is a fact about the reconciliation");
  assert.equal(r.checked, 1, "`checked` is the population this check actually walked");
});

test("disjoint populations refuse rather than answer — overlap is the signal, not a shortfall", () => {
  const r = statedDivergenceFindings({ reconciliation: recon(["/mark/ch/UNRELATED"]),
    carryRows: [STATED_ROW], digestFindingUris: [URI] });
  assert.equal(r.computable, false);
  assert.equal(r.cross_checked, true);
  assert.match(r.reason, /share NOTHING/);
});

test("`matched` is returned so a caller can insist the join actually joined", () => {
  // The field exists because a case-sensitive URI join once matched zero rows on every run and read as
  // zero divergences. A caller that reads `diverged: []` without reading `matched` repeats that.
  const r = statedDivergenceFindings({ reconciliation: recon(),
    carryRows: [{ ...STATED_ROW, uri: URI.toUpperCase() }], digestFindingUris: [URI] });
  assert.equal(r.matched, 1, "the join must be case-normalised on both sides, as the sibling learned");
  assert.equal(r.checked, 1);
});

// ── THE WIRING, WHICH IS THE HALF THAT MAKES IT A CHECK ────────────────────────────────────────────
//
// A pure function nobody calls is fully composed and completely unreachable — it reads exactly like a
// fix and answers nothing. The sibling is called from pipeline.mjs at the seam where the findings
// demonstrably exist; this must be called from the same place, on the same inputs.
test("the pipeline CALLS it, beside its sibling, on the same inputs", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
  const pipeline = readFileSync(join(ROOT, "pipeline.mjs"), "utf8");

  assert.match(pipeline, /import \{[^}]*statedDivergenceFindings[^}]*\} from "\.\/record-carry\.mjs"/s,
    "it must be imported from the module that owns it, not re-implemented");
  assert.match(pipeline, /statedDivergenceFindings\(\{/,
    "and actually called — an uncalled check is the shape this whole family exists to refuse");
  assert.match(pipeline, /event: "stated-divergence-findings"/,
    "its result must reach the run log, or nobody can read what it found");

  // The same three inputs the sibling gets. A call that omitted digestFindingUris would lose the
  // disjoint-population guard silently and answer clean on a run looking at the wrong set.
  const call = pipeline.slice(pipeline.indexOf("statedDivergenceFindings({"));
  const body = call.slice(0, call.indexOf("});") + 3);
  for (const field of ["reconciliation:", "carryRows:", "digestFindingUris:"]) {
    assert.ok(body.includes(field), `the call must pass ${field} — the sibling's guards need all three`);
  }
});
