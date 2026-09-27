// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// THE GRID IS TOLD TO RUN ITS CELLS AT ONCE, AND TOLD WHAT THAT MUST NOT CHANGE.
//
// The grid is not run by our code. We hand the provider's sandbox one task saying "write and run ONE program
// that executes this grid", and the program runs the cells. Measured over two archived rounds — seven grid
// programs, every one a nested `for` loop with no concurrency primitive of any kind — so the cells ran one
// after another, and a name's grid cost its cell count times a cell at about 1.2 seconds each.
//
// WHAT IS ASSERTED HERE IS THE TEXT, BECAUSE THE TEXT IS THE CHANGE. There is no code path to drive: the
// instruction is engine behaviour, the same class as a manual a model reads. So these arms hold the three
// things that instruction must say, and the one it must not stop saying.
//
// THE CONCURRENCY BOUND IS READ FROM THE CONSTANT, NEVER RETYPED. A hand-copied 8 here would keep passing
// after somebody raised the constant, asserting a number the program is no longer given — the same defect
// as an arm whose fixture invents a producer's string instead of building it from the producer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGridProgramTask, dictatedCells, GRID_CELL_CONCURRENCY } from "../../providers/perplexity/src/core.js";
import { splitGridSpec } from "../common-law-receipts.mjs";   // the producer that cuts the meaning seat's spec

// Coined forms and example stores: this repo is de-identified.
const SPEC = {
  terms: ["DRAVOLINE", "DRAVOLYNE"],
  platforms: ["prints.example", "web"],
  output_path: "/x/studio/clearance-search/r/common-law-grid.json",
  results_per_cell: 10,
};

const CONCURRENCY_LINE = /^Run the cells CONCURRENTLY rather than one after another: .*$/m;

test("the task tells the program to run the cells together, bounded by the constant", () => {
  const task = buildGridProgramTask(SPEC);
  const line = task.match(CONCURRENCY_LINE);
  assert.ok(line, "the cells are still dictated as a sequence — this is the whole of lever B");
  assert.match(line[0], new RegExp(`max_workers=min\\(${GRID_CELL_CONCURRENCY}, number of cells\\)`),
    "the bound in the text is not the bound in the module, so raising the constant would leave the program on the old one");
  assert.match(line[0], /concurrent\.futures\.ThreadPoolExecutor/,
    "the mechanism is unnamed, and a cell is an HTTP search: a program left to choose may well choose a loop");
});

test("it says each cell keeps its own results list and its own row", () => {
  // THE ONE WAY CONCURRENCY CAN CHANGE WHAT IS RECORDED. The dictated idiom shows `results = []` as a flat
  // snippet. A program that hoists that list and appends to it from several threads puts one cell's hits in
  // another cell's row — every cell reports a hit, with somebody else's URLs. The coverage floor sees a full
  // ledger, the reconcile sees every dictated cell accounted, and nothing downstream can tell.
  const line = buildGridProgramTask(SPEC).match(CONCURRENCY_LINE)[0];
  assert.match(line, /OWN results list/, "nothing forbids a list shared between cells, which is how threads cross-contaminate candidates");
  assert.match(line, /OWN cells\[\] row/);
  assert.match(line, /which cells run, what each one asks for and what is recorded are unchanged/,
    "the instruction does not say what running them together must not change");
});

test("the per-cell try/except survives it, and so does the ledger shape", () => {
  // The refusal that makes a failed cell its own gap row rather than a lost grid is what keeps the record
  // honest whichever way the program runs the cells. An instruction to run them together that displaced it
  // would trade the saving for a grid that dies on one bad cell.
  const task = buildGridProgramTask(SPEC);
  assert.match(task, /Wrap EACH cell in its own try\/except; on an exception append the string "<term> \| <platform> \| <repr\(exception\)>" to gaps and CONTINUE — one failing cell must never abort the grid\./);
  assert.match(task, /^\{"cells":\[\{"term":"<verbatim>","platform":"<verbatim>","status":"hit\|no_hit"/m);
  assert.match(task, /^Every \(term × platform\) pair appears once — in cells\[\] if it ran, or in gaps\[\] only if that specific cell threw\.$/m);
  // AND THE ORDER: the try/except rule is stated before the concurrency rule, so a program reading top to
  // bottom has the failure rule in hand before it is told to fan out.
  assert.ok(task.indexOf("Wrap EACH cell in its own try/except") < task.search(CONCURRENCY_LINE));
});

test("a meaning-only spec is told nothing about cells at all", () => {
  // A spec with no terms dictates no grid. Emitting a concurrency instruction there would tell the sandbox
  // to fan out over an empty list, in a task whose whole content is the meaning sweep.
  // BUILT BY THE PRODUCER, not typed here: `splitGridSpec` is what cuts the meaning seat's spec, and a
  // hand-written one with empty term and place lists is refused by the validator — so an arm that typed it
  // would be asserting about a spec no seat is ever handed.
  const meaningOnly = splitGridSpec({ ...SPEC, connotation: { queries: ["what does DRAVOLINE mean"] } }).m;
  assert.equal(dictatedCells(meaningOnly).length, 0, "precondition: the meaning seat's spec dictates no cell");
  const task = buildGridProgramTask(meaningOnly);
  assert.doesNotMatch(task, CONCURRENCY_LINE);
  assert.match(task, /MEANING\/CONNOTATION sweep/, "precondition: this is the meaning-only task, or the arm above passes over the wrong text");
});
