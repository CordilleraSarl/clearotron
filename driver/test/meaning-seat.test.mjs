// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// meaning-seat.test.mjs —: the meaning sweep gets its own seat.
//
// THE FACT THIS IS BUILT FROM. Measured across 14 preserved clearance runs (2026-08-04 → 08-08), one
// attempt-1 row per seat per run, `_history/` re-dispatches excluded:
//
//                          half:a    half:b
//   attempt-1 wall, median   338s      376s
//   attempt 1 REFUSED       3 / 14   13 / 14
//   total wall, all attempts 10,644s  22,954s   (2.16x)
//
// `half:b` was the half that also owned the whole connotation sweep. The obvious reading — it is
// overloaded — is refuted by its own numbers. Per attempt it is ~11% longer at the median, so the 2.16x
// is retries and not work; and on three runs it spent LESS wall than its sibling and refused anyway
// (228s against 428s on one, ruling zero of 61 rows). A seat that finishes early and rules nothing is
// not a seat running out of capacity.
//
// So a weighted grid split — the other candidate remedy — would rebalance the wall and leave the
// 13-of-14 refusal exactly where it is. What the evidence supports is a seat asked to do two unlike
// jobs in one turn, finishing the one with a visible end. This file pins the alternative: a seat whose
// whole dispatch IS the meaning work, and two grid halves that are handed no meaning obligation at all.
//
// WHAT IT DOES NOT CLAIM. That the refusal is gone. This seat can still fail its own gate — the gate is
// unchanged and 's Out of scope keeps it that way. What is proven here is structural: the gate that
// fired on 13 of 14 first attempts can no longer arm on a grid half, because a grid half is dictated
// nothing to rule. Whether the sweep itself converges first-try is a statement about what a clearance
// run produced, and it belongs to the round that runs one.
//
// Run:  node --test driver/test/meaning-seat.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { GRID_HALVES, GRID_SEATS, MEANING_SEAT, splitGridSpec, splitGridTerms, halfOfTerm, mergeGrids } from "../common-law-receipts.mjs";
import { buildGridProgramTask, validateGridSpec, requiredLedgerRefusal } from "../../providers/perplexity/src/core.js";
import { readFileSync as readSrc } from "node:fs";
import { fileURLToPath } from "node:url";

const SPEC = {
  terms: ["novapulse", "nuvapulse", "n0vapulse", "转码", "project novapulse"],
  platforms: ["etsy", "web"],
  batch: 14,
  ledger_required: true,
  connotation: { queries: ["novapulse gang", "novapulse offensive", "转码 meaning"], disposition_required: true },
};

test("#517 the seat set is the two grid halves PLUS one, and the meaning seat is never a grid half", () => {
  assert.deepEqual(GRID_HALVES, ["a", "b"], "the grid partition is untouched — that is the point");
  assert.deepEqual(GRID_SEATS, ["a", "b", MEANING_SEAT]);
  assert.ok(!GRID_HALVES.includes(MEANING_SEAT),
    "halfOfTerm, splitGridTerms and the closure cell balancer are all TERM-keyed, and this seat owns no terms — including it in GRID_HALVES would hand it cells the moment any of them iterates");
});

test("#517 the sweep is undivided and it is nowhere near a grid half — the 49/0 imbalance becomes 0/0", () => {
  const seats = splitGridSpec(SPEC, {});
  assert.deepEqual(seats[MEANING_SEAT].connotation.queries, SPEC.connotation.queries,
    "#345 stands: the recurrence floor is a property of the WHOLE sweep, so the sweep stays whole");
  for (const h of GRID_HALVES)
    assert.deepEqual(seats[h].connotation.queries, [],
      `grid half ${h} is dictated nothing to rule, so connotation_no_ruling cannot arm on it`);
  // the containment argument rests on is TIGHTER now, not weaker: both siblings carry zero queries
  // rather than one of them, so the merged meaning receipt set IS this seat's.
  assert.equal(GRID_SEATS.filter((h) => seats[h].connotation.queries.length).length, 1,
    "exactly one seat owns meaning work — an obligation observable at the merge and nowhere else is the VENZY terminal");
});

test("#517 the grid split is untouched: even parity, full platform list, and the meaning seat sweeps nothing", () => {
  const seats = splitGridSpec(SPEC, {});
  const parity = splitGridTerms(SPEC.terms);
  assert.deepEqual(seats.a.terms, parity.a, "the parity partition is byte-identical to what it always was");
  assert.deepEqual(seats.b.terms, parity.b);
  assert.deepEqual([...seats.a.terms, ...seats.b.terms].sort(), [...SPEC.terms].sort(), "terms union = full spec");
  assert.deepEqual(seats[MEANING_SEAT].terms, []);
  for (const h of GRID_SEATS) assert.deepEqual(seats[h].platforms, SPEC.platforms);
  // halfOfTerm still resolves every term to a GRID half — nothing routes work to the meaning seat
  for (const t of SPEC.terms) assert.ok(GRID_HALVES.includes(halfOfTerm(parity, t)), `${t} is owned by a grid half`);
});

test("#517 the disposition_required stamp still rides every seat", () => {
  // Unchanged from 's reasoning: it is the receipt-PRESENCE arm, so a stray pr_risk block in a seat
  // that owes nothing must still be judged rather than waved through because it "should not be there".
  const seats = splitGridSpec(SPEC, {});
  for (const h of GRID_SEATS) assert.equal(seats[h].connotation.disposition_required, true);
});

test("#517 each seat's dispositions path is DICTATED — inheriting one would have two seats overwrite each other", () => {
  const paths = Object.fromEntries(GRID_SEATS.map((h) => [h, `/run/common-law-dispositions.half-${h}.json`]));
  const seats = splitGridSpec(SPEC, { dispositionsPaths: paths });
  for (const h of GRID_SEATS) assert.equal(seats[h].connotation.dispositions_path, paths[h]);
  // and an undictated path is DELETED rather than inherited from the canonical spec
  const bare = splitGridSpec({ ...SPEC, connotation: { ...SPEC.connotation, dispositions_path: "/run/common-law-dispositions.json" } }, {});
  for (const h of GRID_SEATS) assert.ok(!("dispositions_path" in bare[h].connotation), `seat ${h} inherits no sibling's form path`);
});

test("#517 the merged ledger is the three seats folded, and the meaning seat contributes receipts but no cells", () => {
  // The driver chains mergeGrids rather than widening its signature — the return shape is the input
  // shape, and the guards are written against the two-argument form.
  const parity = splitGridTerms(SPEC.terms);
  const cellsFor = (ts) => ts.flatMap((t) => SPEC.platforms.map((pl) => ({ term: t, platform: pl, status: "no_hit", results: [] })));
  const a = { cells: cellsFor(parity.a), extras: { pr_risk: [] }, gaps: [] };
  const b = { cells: cellsFor(parity.b), extras: { pr_risk: [] }, gaps: [] };
  const m = { cells: [], extras: { pr_risk: SPEC.connotation.queries.map((q) => ({ query: q, results: [] })) }, gaps: [] };
  const merged = mergeGrids(mergeGrids(a, b, { spec: SPEC }), m, { spec: SPEC });
  assert.equal(merged.cells.length, SPEC.terms.length * SPEC.platforms.length, "no cell lost, no cell invented");
  assert.deepEqual(merged.gaps, [], "a fully-run grid recomputes to zero gaps — the meaning seat adds none");
  assert.deepEqual(merged.extras.pr_risk.map((e) => e.query).sort(), [...SPEC.connotation.queries].sort(),
    "the merged meaning receipt set IS the meaning seat's, because both grid halves record none");
});

test("#517 a meaning seat that never ran leaves its queries UNRECORDED — the merge can see the hole", () => {
  // The false-clean this guards: the canonical connotation gate is COUNT-based and the merged document
  // still concatenates two complete grid halves, so nothing else in the pipeline can notice. Dropping
  // the seat's ledger must leave the receipt set EMPTY rather than plausibly full.
  const parity = splitGridTerms(SPEC.terms);
  const cellsFor = (ts) => ts.flatMap((t) => SPEC.platforms.map((pl) => ({ term: t, platform: pl, status: "no_hit", results: [] })));
  const merged = mergeGrids(
    mergeGrids({ cells: cellsFor(parity.a), extras: {}, gaps: [] }, { cells: cellsFor(parity.b), extras: {}, gaps: [] }, { spec: SPEC }),
    null, { spec: SPEC });
  assert.deepEqual(merged.extras.pr_risk ?? [], [], "not one meaning receipt survives a seat that did not run");
  assert.equal(merged.cells.length, SPEC.terms.length * SPEC.platforms.length, "…and the grid is still complete, which is exactly why the hole is invisible without a per-query join");
});

test("#517 the grid tool accepts a cell-less meaning spec and dictates no grid in it", () => {
  const seats = splitGridSpec(SPEC, { outputPaths: Object.fromEntries(GRID_SEATS.map((h) => [h, `/run/common-law-grid.half-${h}.json`])) });
  const task = buildGridProgramTask(seats[MEANING_SEAT]);
  assert.doesNotThrow(() => validateGridSpec(seats[MEANING_SEAT]),
    "a spec dictates SOME work, not necessarily CELLS — the old guard refused terms:[] outright and would refuse this seat every run");
  assert.match(task, /MEANING\/CONNOTATION sweep/);
  assert.ok(!/cells total/.test(task),
    "no grid instruction: telling the sandbox to run a term x platform grid and then handing it an empty list is an instruction nobody can follow");
  for (const q of SPEC.connotation.queries) assert.ok(task.includes(q), `the dictated query ${q} reaches the program verbatim`);
  // the grid halves still get the full grid dictate, unchanged
  const gridTask = buildGridProgramTask(seats.a);
  assert.match(gridTask, /cells total/);
  assert.match(gridTask, /marketplace clearance search grid/);
});

test("#517 a spec that dictates NOTHING is still malformed", () => {
  // The relaxed guard must not become no guard: an empty terms[] with an empty sweep is a driver bug,
  // and letting it through would spawn a seat with nothing to do and no way to say so.
  const OUT = { output_path: "/run/common-law-grid.half-m.json" };
  assert.throws(() => validateGridSpec({ ...SPEC, ...OUT, terms: [], connotation: { queries: [] } }), /dictates no work/);
  assert.throws(() => validateGridSpec({ ...SPEC, ...OUT, terms: [], connotation: undefined }), /dictates no work/);
  assert.throws(() => validateGridSpec({ ...SPEC, ...OUT, terms: undefined }), /missing or empty/);
});

test("#517 the gather cap is the MEMBER COUNT, and the seat moved it from 6 to 7", async () => {
  // The cap's own doc block sets the rule: "the cap is the member count... at 3 that is two serial waves
  // for a set of independent provider-bound sweeps". A third common-law seat makes the count 7, and left
  // at 6 the seventh member waits for a slot — one serial wave, inside the gather, produced by a change
  // whose entire purpose is a stage that converges sooner. That would read as "the seat made it slower".
  const { config } = await import("../driver.config.mjs");
  const { REGISTER_AXES } = await import("../coverage-ledger.mjs");
  const members = GRID_SEATS.length + REGISTER_AXES.length;
  assert.equal(members, 7, "3 common-law seats + 4 register units");
  assert.ok(config.gatherConcurrency >= members,
    `every gather member must get a slot in one wave — cap ${config.gatherConcurrency} against ${members} members`);
});

// ── — A REQUIRED LEDGER THAT WAS NOT PRODUCED FAILS AT THE TOOL, NAMING THE SPEC ──
//
// R14 died at `common-law-half:m` and the recorded failure was
// `missing_file:common-law-findings.half-m.md` — the seat's REPORT. The seat was fine: the grid tool had
// refused it a ledger (twenty times, "2 dictated queries produced neither a receipt nor a gap row"), and
// a seat with no ledger to summarise correctly wrote nothing. The record therefore named the one party
// that behaved correctly, and pointed every future reader at the seat.
//
// The driver-side gate cannot close this. verify.mjs DOES carry `grid_ledger_missing` naming the halved
// spec — but inside the validator for that seat's report, and a missing ledger is what stops the report
// existing. Unreachable exactly when needed.

test("2020: a refusal for a spec that REQUIRED a ledger names the spec, not the seat's report", () => {
  const spec = { ledger_required: true, output_path: "/run/common-law-grid.half-m.json" };
  const out = requiredLedgerRefusal("ERROR: grid run failed — connotation/meaning sweep incomplete.",
    { spec, gridSpecPath: "/run/_driver/grid-spec.half-m.json" });

  assert.match(out, /grid-spec\.half-m\.json/,
    "the refusal must name the SPEC whose ledger_required was not honoured — that is the file a reader "
    + "has to open, and naming only the consuming seat's report is what sent R14's diagnosis to the seat");
  assert.match(out, /ledger_required/, "…and say which promise was broken");
  assert.match(out, /common-law-grid\.half-m\.json/, "…and name the artifact that was not written");
  assert.ok(!/common-law-findings/.test(out),
    "the refusal must NOT name the seat's report: that file's absence is the CONSEQUENCE, and naming it "
    + "is precisely the misdirection this arm exists to end");
  assert.match(out, /ERROR: grid run failed/, "the original reason survives — this augments, never replaces");
});

test("2020: a spec that never promised a ledger is handed the reason UNCHANGED", () => {
  // Without this the function could satisfy the arm above by decorating every refusal, and a spec with no
  // ledger_required would be told it broke a promise it never made.
  const why = "ERROR: grid run failed — something else.";
  assert.equal(requiredLedgerRefusal(why, { spec: { ledger_required: false, output_path: "/x" }, gridSpecPath: "/s" }), why);
  assert.equal(requiredLedgerRefusal(why, { spec: {}, gridSpecPath: "/s" }), why);
  assert.equal(requiredLedgerRefusal(why, {}), why, "…and a missing spec is not an excuse to throw");
});

test("2020: EVERY grid refusal the server returns after the spec is read goes through the wrapper", () => {
  // THE ANTI-DRIFT HALF. The two arms above prove the composer; they cannot see a NEW refusal path added
  // beside it that returns a bare string. That is how this defect class returns: one more `return
  // \`ERROR: ...\`` inside the grid branch, correct-looking, and silent about the unwritten ledger.
  const src = readSrc(fileURLToPath(new URL("../engine/mcp/perplexity-server.mjs", import.meta.url)), "utf8");

  // ONE REFUSAL IS EXEMPT, AND THE EXEMPTION IS ASSERTED RATHER THAN ASSUMED: the spec that would not
  // PARSE. There is no `ledger_required` to read on a spec that is not an object, so the wrapper has
  // nothing to decide with. It still points the reader at the right file, which is the property that
  // matters — so that is checked here instead of waived.
  const preParse = src.slice(src.indexOf("if (grid_spec_path) {"), src.indexOf("if (!/\\/studio\\/prelim-search"));
  const preParseRefusals = preParse.split("\n").filter((l) => /return\s+[`'"]ERROR:/.test(l));
  assert.equal(preParseRefusals.length, 1, "the pre-parse region gained or lost a refusal — re-derive this exemption");
  assert.match(preParseRefusals[0], /grid_spec_path/,
    "the one exempt refusal must still name the spec path in its own text, or an unparseable spec sends "
    + "the reader nowhere");

  // Everything from the output_path guard onward runs with a PARSED spec in hand and is covered.
  const grid = src.slice(src.indexOf("if (!/\\/studio\\/prelim-search"), src.indexOf("if (!task || task.trim().length === 0)"));
  assert.ok(grid.length > 500, "the post-parse grid region was not located — this arm is reading nothing");

  const refusals = grid.split("\n").filter((l) => /return\s+[`'"]ERROR:/.test(l));
  assert.deepEqual(refusals.map((l) => l.trim()), [],
    "a grid refusal returns a bare ERROR string instead of going through requiredLedgerRefusal(). Every "
    + "refusal reached AFTER the spec is parsed must carry the unproduced-ledger statement, or a seat is "
    + "told the call failed without being told the required artifact is missing:\n" + refusals.join("\n"));

  const wrapped = (grid.match(/requiredLedgerRefusal\(/g) || []).length;
  assert.ok(wrapped >= 3,
    `only ${wrapped} refusal path(s) go through the wrapper; the grid branch had three at the time this `
    + "was written (output_path guard, capture failure, outer catch). A drop means a path stopped being covered");
});
