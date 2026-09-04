// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A meaning query that THREW is not a meaning query that VANISHED.
//
// Under the split common-law lane, every dictated connotation query must appear in the merged
// extras.pr_risk[]. A missing one fails the merge gate — correctly: a meaning check that did not complete
// cannot back a clean reputational read, which is the gang-slang-near-miss false-clean class the gate
// exists to prevent.
//
// But it failed with ONE classification for TWO very different causes, and the harsher one won whenever
// both halves completed: failClass "deterministic" ⇒ park budget 0 ⇒ zero retries, run dead after the full
// spend, re-run fails identically. One flaky web request inside an otherwise healthy plugin killed a paid
// job outright. The same thrown query on an UNSPLIT run passes cleanly — only split runs died.
//
// The signal to tell them apart was already in the data and was being discarded. The plugin's contract
// wraps each connotation query and, on an exception, appends "<query> | connotation | <error>" to gaps and
// continues; mergeGrids' non-spec union branch carries that row through verbatim. The in-code comment
// asserting the opposite ("never a gap row — gaps are term × platform only") was the stated justification
// for the classification, and it was wrong.
//
// WHAT DOES NOT CHANGE: an errored query still fails the gate. Counting it as searched to keep the run
// alive would launder a real hole into a clean receipt — worse than the defect being fixed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { findDroppedConnotationQueries, findErroredConnotationQueries } from "../common-law-receipts.mjs";

const SPEC = { connotation: { queries: ["SATIN STEEL slang meaning", "SATIN STEEL offensive connotation"] } };
const receipt = (q) => ({ query: q, results: [] });          // an empty results[] IS a searched-clean receipt
const gap = (q, error) => ({ term: q, platform: "connotation", error });

test("a query that threw is reported as ERRORED — the gap row carries it, and we now read it", () => {
  const grid = {
    extras: { pr_risk: [receipt("SATIN STEEL slang meaning")] },
    gaps: [gap("SATIN STEEL offensive connotation", "HTTPError: upstream timeout")],
  };
  assert.deepEqual(findDroppedConnotationQueries(SPEC, grid), ["SATIN STEEL offensive connotation"],
    "still missing a receipt — the gate must still fail");
  const errored = findErroredConnotationQueries(SPEC, grid);
  assert.equal(errored.length, 1);
  assert.equal(errored[0].query, "SATIN STEEL offensive connotation");
  assert.match(errored[0].error, /upstream timeout/, "the plugin's own error text is carried, not invented");
});

test("a query that VANISHED is not errored — nothing anywhere is a plugin defect, not weather", () => {
  const grid = { extras: { pr_risk: [receipt("SATIN STEEL slang meaning")] }, gaps: [] };
  assert.equal(findDroppedConnotationQueries(SPEC, grid).length, 1, "missing");
  assert.deepEqual(findErroredConnotationQueries(SPEC, grid), [], "and unexplained");
});

test("AN ERRORED QUERY IS NEVER COUNTED AS SEARCHED — the hole stays a hole", () => {
  // The load-bearing negative. The whole point of the gate is that a clean reputational read must be
  // backed by completed meaning searches; if this fix ever made an errored query satisfy that, it would
  // ship exactly the false-clean the gate was built to stop.
  const grid = {
    extras: { pr_risk: [] },
    gaps: SPEC.connotation.queries.map((q) => gap(q, "boom")),
  };
  assert.equal(findDroppedConnotationQueries(SPEC, grid).length, 2,
    "both are still DROPPED — being honestly reported does not make a query searched");
  assert.equal(findErroredConnotationQueries(SPEC, grid).length, 2, "…and both are explained");
});

test("gap rows for other platforms are not mistaken for meaning queries", () => {
  const grid = {
    extras: { pr_risk: [receipt("SATIN STEEL slang meaning")] },
    gaps: [
      { term: "SATIN STEEL", platform: "etsy", error: "429" },                  // an ordinary marketplace cell
      gap("SATIN STEEL offensive connotation", "boom"),
    ],
  };
  const errored = findErroredConnotationQueries(SPEC, grid);
  assert.equal(errored.length, 1, "only the connotation row counts");
  assert.equal(errored[0].query, "SATIN STEEL offensive connotation");
});

test("a gap naming a query that was NOT dictated is ignored", () => {
  const grid = {
    extras: { pr_risk: [receipt("SATIN STEEL slang meaning")] },
    gaps: [gap("something nobody asked for", "boom"), gap("SATIN STEEL offensive connotation", "boom")],
  };
  assert.deepEqual(findErroredConnotationQueries(SPEC, grid).map((e) => e.query),
    ["SATIN STEEL offensive connotation"], "the join is against the DICTATED set, not the gap list");
});

test("nothing missing ⇒ no work done, whatever the gaps say", () => {
  const grid = {
    extras: { pr_risk: SPEC.connotation.queries.map(receipt) },
    gaps: [gap("SATIN STEEL offensive connotation", "a stale row from an earlier attempt")],
  };
  assert.deepEqual(findDroppedConnotationQueries(SPEC, grid), []);
  assert.deepEqual(findErroredConnotationQueries(SPEC, grid), [],
    "a query that later succeeded is not errored — the receipt wins");
});

test("malformed or absent grids never throw", () => {
  for (const grid of [undefined, null, {}, { gaps: null }, { gaps: [null, {}] }, { gaps: [{ platform: "connotation" }] }])
    assert.doesNotThrow(() => findErroredConnotationQueries(SPEC, grid), `grid ${JSON.stringify(grid)}`);
  assert.deepEqual(findErroredConnotationQueries({}, { gaps: [gap("x", "y")] }), [],
    "no dictated queries ⇒ nothing can be missing");
});

// ── the classification at the gate ───────────────────────────────────────────────────────────────────

test("THE GATE'S CLASSIFICATION: explained ⇒ one retry, unexplained ⇒ still terminal", () => {
  // Asserted at the source, because the branch lives inside pipelineInner's mergeCommonLawArtifacts
  // closure and cannot be imported. What matters is that the three cases stay distinct: a quarantined half
  // keeps its transient ladder, a fully-explained drop drops to `unknown` (one park), and anything
  // unexplained keeps `deterministic` (zero). Collapsing them back to one class is how this returns.
  const src = readFileSync(fileURLToPath(new URL("../pipeline.mjs", import.meta.url)), "utf8");
  const gate = src.slice(src.indexOf("const dropped = findDroppedConnotationQueries(fullSpec, mergedGrid);"));
  const body = gate.slice(0, gate.indexOf("return { mergedGrid, fullSpec };"));
  assert.ok(body.includes("findErroredConnotationQueries"), "the gate consults the gap rows");
  assert.match(body, /anyQuarantined \? clFailClass : \(allExplained \? "unknown" : "deterministic"\)/,
    "all three classifications remain distinct");
  assert.ok(body.includes("throw new StageFailure"), "and an errored query still FAILS the gate");
});

test("the false justification is corrected in place, not merely deleted", () => {
  // "never a gap row (gaps are term×platform only)" was the stated reason the signal was discarded, and it
  // was wrong — mergeGrids' non-spec union branch re-adds it. The correction is asserted POSITIVELY rather
  // than by the absence of the old phrase, because the new comment quotes that phrase in order to correct
  // it; a bare absence check would fail on its own citation, and deleting the sentence would leave the
  // next reader to rediscover the same wrong conclusion from the same code.
  const src = readFileSync(fileURLToPath(new URL("../pipeline.mjs", import.meta.url)), "utf8");
  assert.match(src, /That is not true and it was the stated justification/,
    "the comment says plainly that the old claim was false");
  assert.match(src, /non-spec\s*\n?\s*\/\/ union branch re-adds any gap whose platform is not in the spec/,
    "…and says why, naming the branch that carries the row");
});
