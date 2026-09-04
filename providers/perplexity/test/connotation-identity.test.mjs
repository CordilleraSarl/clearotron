// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Per-query identity of the dictated connotation sweep.
//
// The strings here are the REAL ones from the live failure (a CORAL FREEZE clearance
// run, 2026-07-29 — same probe mark as providers/clarivate's parity fixtures): the
// driver dictated `提基斯拉什 offensive meaning`, and the sandbox program's stdout carried
// `提基斯ラッシュ offensive meaning` — the katakana of the sibling Japanese row
// (`ティキスラッシュ`) fused into the Chinese transliteration. 27 dictated, 27
// recorded, one dictated query never searched. Every count-based check passed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findUnrecordedConnotationQueries, captureGridFromResponse } from "../src/core.js";

const DICTATED = "提基斯拉什 offensive meaning";
const MUTATED = "提基斯ラッシュ offensive meaning";

const SPEC = {
  terms: ["CORAL FREEZE"],
  platforms: ["amazon.com"],
  output_path: "/tmp/grid.json",
  connotation: { queries: ["CORAL FREEZE gang", DICTATED, "티키 슬러시 meaning"] },
};

const prRisk = (queries) => queries.map((q) => ({ query: q, results: [] }));
const ledger = (queries, gaps = []) => ({ cells: [], extras: { pr_risk: prRisk(queries) }, gaps });

const sandbox = (stdout) => ({
  output: [{ type: "sandbox_results", code: "…", results: [{ stdout, stderr: "", exit_code: 0, status: "completed" }] }],
});

const fullCells = [{ term: "CORAL FREEZE", platform: "amazon.com", status: "no_hit", candidates: [] }];

test("a mis-transcribed query is caught by identity, though the count is whole", () => {
  const { missing, unmatched } = findUnrecordedConnotationQueries(
    SPEC, ledger(["CORAL FREEZE gang", MUTATED, "티키 슬러시 meaning"]));
  assert.deepEqual(missing, [DICTATED], "the dictated query never ran");
  assert.deepEqual(unmatched, [MUTATED.toLowerCase()], "the substitute is surfaced so the retry can see it");
});

test("all dictated queries recorded ⇒ nothing missing", () => {
  const { missing, unmatched } = findUnrecordedConnotationQueries(SPEC, ledger(SPEC.connotation.queries));
  assert.deepEqual(missing, []);
  assert.deepEqual(unmatched, []);
});

test("a query that THREW owns a gap row and is not reported as a silent drop", () => {
  for (const gaps of [
    [`${DICTATED} | connotation | TimeoutError()`],            // string form, straight from the program
    [{ term: DICTATED, platform: "connotation", error: "TimeoutError()" }], // reconciled object form
  ]) {
    const { missing } = findUnrecordedConnotationQueries(
      SPEC, ledger(["CORAL FREEZE gang", "티키 슬러시 meaning"], gaps));
    assert.deepEqual(missing, [], "an honest error is the driver merge gate's call, not a substitution");
  }
});

test("captureGridFromResponse refuses the substitution and names BOTH strings", () => {
  const out = captureGridFromResponse(sandbox(JSON.stringify({
    cells: fullCells,
    extras: { pr_risk: prRisk(["CORAL FREEZE gang", MUTATED, "티키 슬러시 meaning"]) },
    gaps: [],
  })), SPEC);
  assert.equal(out.ok, false);
  // THE REFUSAL SURVIVES THE 2020 POLICY CHANGE, and this arm is where that is proven. Two of three
  // dictated queries came back, which is below the meaning floor, so a substitution in a small sweep is
  // still refused and still names both strings. The flag is renamed because its MEANING changed — it no
  // longer fires on "any query dropped" but on "too few came back to stand behind" — and a stale label on
  // changed behaviour is its own defect.
  assert.equal(out.connotationBelowFloor, true);
  assert.deepEqual(out.missingQueries, [DICTATED]);
  assert.match(out.error, /提基斯拉什 offensive meaning/, "the retry is told what it was supposed to run");
  assert.match(out.error, /提基斯ラッシュ offensive meaning/, "…and what it ran instead");
});

test("a faithful sweep still passes — the gate does not trip on a clean run", () => {
  const out = captureGridFromResponse(sandbox(JSON.stringify({
    cells: fullCells,
    extras: { pr_risk: prRisk(SPEC.connotation.queries) },
    gaps: [],
  })), SPEC);
  assert.equal(out.ok, true);
  assert.equal(out.connotationBelowFloor, undefined);
});

// ── — ONE POLICY FOR ONE FAILURE CLASS ───────────────────────────────────────────
//
// R14, the first real-client lawyer-scored scenario, died at common-law-half:m with nothing delivered.
// Its meaning sweep dictated 61 queries and 59 came back. The tool discarded all 59 — a paid-for,
// 90-second sweep — because two were missing, and re-bought the whole thing on each of four attempts,
// meeting the same deterministic pair every time. An unreturned marketplace CELL in the very same
// function was meanwhile reconciled into an honest gap row and shipped.
//
// The fixture below is that run's own failure.

const bigSpec = (n, output_path = "/studio/prelim-search/run/g.json") => ({
  terms: [], platforms: ["web"], output_path, ledger_required: true,
  connotation: { queries: Array.from({ length: n }, (_, i) => `meaning probe ${i}`) },
});
const returned = (n) => prRisk(Array.from({ length: n }, (_, i) => `meaning probe ${i}`));

test("2020: R14's shape — 59 of 61 queries DELIVERS, receipts intact and the two recorded as gaps", () => {
  const spec = bigSpec(61);
  const out = captureGridFromResponse(sandbox(JSON.stringify({
    cells: [], gaps: [], extras: { pr_risk: returned(59) },
  })), spec);

  assert.equal(out.ok, true,
    `the sweep was refused (${out.error}). 59 of 61 receipts, already bought, discarded to avoid shipping `
    + "two gap rows — that is the contradiction this change deletes");
  const led = JSON.parse(out.ledgerJson);
  assert.equal(led.extras.pr_risk.length, 59, "every receipt that came back survives into the ledger");
  const connGaps = led.gaps.filter((g) => g?.platform === "connotation");
  assert.deepEqual(connGaps.map((g) => g.term), ["meaning probe 59", "meaning probe 60"],
    "the two that did not come back are recorded as honest gap rows, by name — an unreturned query is a "
    + "coverage fact, not a reason to throw away the sweep");
  assert.ok(connGaps.every((g) => /reconciled gap/.test(g.error)), "…and they say how they got there");
});

test("2020: the gap rows END THE RE-BUY — the ledger reads as accounted on a retry", () => {
  // The persistence half, and it falls out of the reconciliation rather than being bolted on: a retry
  // re-runs a spec whose queries carry neither a receipt nor a gap row. R14 paid for the same sweep four
  // times because the refusal path wrote nothing at all.
  const spec = bigSpec(61);
  const out = captureGridFromResponse(sandbox(JSON.stringify({
    cells: [], gaps: [], extras: { pr_risk: returned(59) },
  })), spec);
  const ident = findUnrecordedConnotationQueries(spec, JSON.parse(out.ledgerJson));
  assert.deepEqual(ident.missing, [],
    "a query with a gap row is accounted, so the recorded-ledger check answers from disk instead of "
    + "buying the sweep again");
});

test("2020: the refusal is PROPORTIONATE, not deleted — a mostly-failed sweep still refuses", () => {
  // Without this the change reads as "stop refusing", which would ship a meaning sweep that barely ran.
  // The floor is the same mechanism the marketplace grid uses, at a bound derived for this population.
  const spec = bigSpec(61);
  const out = captureGridFromResponse(sandbox(JSON.stringify({
    cells: [], gaps: [], extras: { pr_risk: returned(20) },
  })), spec);
  assert.equal(out.ok, false, "20 of 61 is not a sweep with gaps, it is a broken program");
  assert.equal(out.connotationBelowFloor, true);
  assert.match(out.error, /20\/61/, "the refusal states what came back");
  assert.match(out.error, /floor 90%/, "…and the bound it was judged against");
});

test("2020: ZERO recorded keeps its own message — a sweep that never ran is not a sweep with gaps", () => {
  const out = captureGridFromResponse(sandbox(JSON.stringify({
    cells: [], gaps: [], extras: { pr_risk: [] },
  })), bigSpec(61));
  assert.equal(out.ok, false);
  assert.match(out.error, /recorded ZERO/, "the distinct case keeps its distinct wording");
  assert.match(out.error, /dictionary gloss is never a clearance/, "…and its reason");
});

test("2020: the MARKETPLACE side is untouched — this deletes a contradiction, it does not widen a hole", () => {
  // The change must not have relaxed the grid's own floor while aligning the sweep to it. Same function,
  // same run, the other collection.
  const spec = { terms: ["A", "B", "C", "D"], platforms: ["amazon.com"], output_path: "/studio/prelim-search/run/g.json" };
  const out = captureGridFromResponse(sandbox(JSON.stringify({
    cells: [{ term: "A", platform: "amazon.com", status: "no_hit", candidates: [] }], gaps: [], extras: {},
  })), spec);
  assert.equal(out.ok, false, "1 of 4 cells is below the marketplace floor and must still refuse");
  assert.equal(out.catastrophic, true, "…through the mechanism it always used");
});
