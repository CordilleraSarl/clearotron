// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A GRID TOO BIG FOR ONE PRINT COMES BACK IN STEPS, AND EVERY STEP IS READ.
//
// The search service's sandbox cuts a single print off near 1 MiB; its documentation says so, per output
// stream. A big grid's ledger crosses that — a half of 700 cells with today's result titles sits at the cap
// — and a cut-off print is not JSON, so the whole grid fails and a retry fails the same way. The program
// already splits a big grid into groups; it used to gather them all and print once. Now each group runs as
// its own execution and prints only itself, and the capture reads every step's ledger instead of the last.
//
// Still one call per grid, the same searches, and a grid small enough to run as one group reads exactly as
// before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGridProgramTask, captureGridFromResponse, foldStepLedgers, reconcileGridLedger } from "../../providers/perplexity/src/core.js";

// Coined forms and example stores: this repo is de-identified.
const TERMS = ["DRAVOLINE", "DRAVOLYNE", "DRAVO LINE"];
const PLATFORMS = ["prints.example", "web"];
const SPEC = { terms: TERMS, platforms: PLATFORMS, output_path: "/x/studio/clearance-search/r/common-law-grid.json", batch: 1, ledger_required: true };

const cell = (term, platform, status = "no_hit") => ({ term, platform, status, candidates: status === "hit" ? [{ title: `${term} on ${platform}`, url: `https://${platform}/${term}` }] : [] });
const group = (term, extra = {}) => ({ cells: PLATFORMS.map((p) => cell(term, p)), extras: {}, gaps: [], ...extra });
const answer = (...stdouts) => ({ output: [{ type: "sandbox_results", code: "", results: stdouts.map((stdout) => ({ stdout, stderr: "", exit_code: 0 })) }] });
const keys = (cells) => cells.map((c) => `${c.term}|${c.platform}`).sort();

test("a grid split into groups tells each group to print only itself; a grid of one group reads as before", () => {
  const split = buildGridProgramTask(SPEC);
  assert.match(split, /^Batch into groups of <= 1 terms and run each group as its own sandbox execution that prints only that group's JSON object — output over about 1 MiB is cut off, so never print the whole grid at once\.$/m);
  assert.match(split, /^Each execution prints to stdout EXACTLY one JSON object \(no prose, no markdown fences\):$/m);
  assert.doesNotMatch(split, /accumulate ALL cells before printing/);

  const whole = buildGridProgramTask({ ...SPEC, batch: 14 });
  assert.doesNotMatch(whole, /Batch into groups|Each execution prints/);
  assert.match(whole, /^Print to stdout EXACTLY one JSON object \(no prose, no markdown fences\):$/m);
});

test("every step's ledger is read: all groups present, a cut-off step is not JSON and its cells are recorded gaps", () => {
  const cutOff = JSON.stringify(group("DRAVOLYNE")).slice(0, 40);
  const cap = captureGridFromResponse(answer(JSON.stringify(group("DRAVOLINE")), cutOff, JSON.stringify(group("DRAVO LINE"))), SPEC);
  assert.equal(cap.ok, true, cap.error);
  const ledger = JSON.parse(cap.ledgerJson);
  assert.deepEqual(keys(ledger.cells), ["DRAVO LINE|prints.example", "DRAVO LINE|web", "DRAVOLINE|prints.example", "DRAVOLINE|web"]);
  const gapOf = (g) => (typeof g === "string" ? { term: g.split("|")[0].trim(), platform: g.split("|")[1].trim() } : g);
  assert.deepEqual(keys(ledger.gaps.map(gapOf)), ["DRAVOLYNE|prints.example", "DRAVOLYNE|web"]);
  assert.equal(`${cap.present}/${cap.requested}`, "4/6", "the floor is judged on the whole grid");

  const steps = captureGridFromResponse(answer(...TERMS.map((t) => JSON.stringify(group(t)))), SPEC);
  assert.equal(`${steps.present}/${steps.requested}`, "6/6");
  assert.deepEqual(steps.missing, []);
});

test("a step printed again keeps its last result, and a gap a later step filled is dropped", () => {
  const first = group("DRAVOLINE", { cells: [cell("DRAVOLINE", "web")], gaps: ["DRAVOLINE | prints.example | TimeoutError()"] });
  const again = { cells: [cell("DRAVOLINE", "prints.example", "hit"), cell("DRAVOLINE", "web", "hit")], extras: {}, gaps: [] };
  const folded = JSON.parse(foldStepLedgers([first, again, group("DRAVOLYNE"), group("DRAVO LINE")]));
  assert.equal(folded.cells.length, 6, "each cell once");
  assert.deepEqual(folded.cells.filter((c) => c.term === "DRAVOLINE").map((c) => c.status), ["hit", "hit"]);
  assert.deepEqual(folded.gaps, []);
  const rec = reconcileGridLedger(JSON.stringify(folded), SPEC);
  assert.equal(`${rec.present}/${rec.requested}`, "6/6");
});

test("every step's meaning receipts are kept, the last per query, and a query gap a later step answered is dropped", () => {
  const folded = JSON.parse(foldStepLedgers([
    { cells: [], extras: { pr_risk: [{ query: "q1", results: [] }, { query: "q2", results: [] }] }, gaps: ["q3 | connotation | TimeoutError()"] },
    { cells: [], extras: { pr_risk: [{ query: "q2", results: [{ title: "t", url: "u", snippet: "" }] }] }, gaps: [] },
    { cells: [], extras: { pr_risk: [{ query: "q3", results: [] }] }, gaps: [] },
  ]));
  assert.deepEqual(folded.extras.pr_risk.map((r) => [r.query, r.results.length]), [["q1", 0], ["q2", 1], ["q3", 0]]);
  assert.deepEqual(folded.gaps, []);
});

test("meaning queries are matched as the reconcile matches them: a re-cased receipt is one receipt, and it fills its gap", () => {
  const spec = { ...SPEC, connotation: { queries: ["DRAVOLINE meaning", "DRAVOLINE slang"] } };
  const folded = JSON.parse(foldStepLedgers([
    { cells: [], extras: { pr_risk: [{ query: "DRAVOLINE meaning", results: [] }, { query: "dravoline meaning", results: [{ title: "t", url: "u", snippet: "" }] }] }, gaps: ["DRAVOLINE slang | connotation | TimeoutError()"] },
    { cells: [], extras: { pr_risk: [{ query: "Dravoline Slang", results: [] }] }, gaps: [] },
  ], spec));
  assert.deepEqual(folded.extras.pr_risk.map((r) => [r.query, r.results.length]), [["dravoline meaning", 1], ["Dravoline Slang", 0]],
    "one receipt per query, the last kept, whatever its case");
  assert.deepEqual(folded.gaps, [], "the re-cased receipt fills the dictated query's gap");
  const cap = captureGridFromResponse(answer(...TERMS.map((t) => JSON.stringify(group(t))), JSON.stringify({ cells: [], extras: { pr_risk: [{ query: "dravoline meaning", results: [] }, { query: "DRAVOLINE SLANG", results: [] }] }, gaps: [] })), spec);
  assert.equal(cap.ok, true, cap.error);
  const ledger = JSON.parse(cap.ledgerJson);
  assert.equal(ledger.extras.pr_risk.length, 2);
  assert.deepEqual(ledger.gaps, [], "no meaning query is left unrecorded because the program re-cased it");
});

test("a stray trial print adds nothing: only the grid's own cells, gaps and meaning queries are folded", () => {
  const spec = { ...SPEC, connotation: { queries: ["DRAVOLINE meaning"] } };
  const trial = { cells: [cell("TEST", "prints.example", "hit"), cell("DRAVOLINE", "games.example", "hit")], extras: { pr_risk: [{ query: "test query", results: [] }] },
    gaps: ["TEST | web | TimeoutError()"] };
  const meaning = { cells: [], extras: { pr_risk: [{ query: "DRAVOLINE meaning", results: [] }] }, gaps: [] };
  const cap = captureGridFromResponse(answer(JSON.stringify(trial), ...TERMS.map((t) => JSON.stringify(group(t))), JSON.stringify(meaning)), spec);
  assert.equal(cap.ok, true, cap.error);
  const ledger = JSON.parse(cap.ledgerJson);
  assert.equal(`${cap.present}/${cap.requested}`, "6/6", "the trial's cells neither add to the grid nor count toward the floor");
  assert.equal(ledger.cells.length, 6);
  assert.deepEqual(cap.candidates, [], "and nothing from the trial is sent for judgment");
  assert.deepEqual(ledger.extras.pr_risk.map((r) => r.query), ["DRAVOLINE meaning"]);
  assert.deepEqual(ledger.gaps, []);
});

test("one printed ledger is read exactly as before", () => {
  const stdout = JSON.stringify({ cells: TERMS.flatMap((t) => PLATFORMS.map((p) => cell(t, p))), extras: {}, gaps: [] });
  const cap = captureGridFromResponse(answer(JSON.stringify({ probe: "sdk ok" }), stdout), SPEC);
  assert.equal(cap.ledgerJson, JSON.stringify(reconcileGridLedger(stdout, SPEC).ledger), "a probe print that is not a ledger changes nothing");
  const cut = captureGridFromResponse(answer(stdout.slice(0, 50)), SPEC);
  assert.equal(cut.ok, false);
  assert.match(cut.error, /^sandbox stdout is not valid JSON \(exit 0\)$/, "a single cut-off print still fails the way it always did");
});
