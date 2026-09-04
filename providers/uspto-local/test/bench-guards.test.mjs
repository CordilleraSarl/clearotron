// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — THE TWO GUARDS THAT ARE THE ONLY REASON TO TRUST A NUMBER THE BENCHMARK PRINTS.
//
// The latency tables this harness replaces were wrong for a reason worth pinning: they were measured
// on queries that matched nothing. Nice classes were compared in two spellings (`cfbc0cf`), so every
// filtered query returned zero rows — and a query that returns zero rows is FAST. The numbers were
// real timings of an empty result, quoted as register performance.
//
// A latency column cannot show that. So the harness carries two guards, and a benchmark whose guards
// are untested is the same instrument that produced the numbers being replaced:
//
//   1. every timing is printed with its `total_hits`, and a zero is marked in the cell — not in a
//      footnote a reader skips;
//   2. the OR-width stack uses DISTINCT terms. Repeating them keeps the latency honest (the cost
//      follows LIKE comparisons per row) while `total_hits` stops moving, so the table reads as
//      "wider queries find no more" rather than "the harness ran out of vocabulary".
//
// Importing bench.mjs must not run a benchmark; the module guards its own main.

import { test } from "node:test";
import assert from "node:assert/strict";

import { distinctStems, hitsCell } from "../bench/bench.mjs";

test("a probe that matched NOTHING is marked in its own cell", () => {
  assert.match(hitsCell({ hits: 0 }), /MEASURES NOTHING/,
    "a zero-hit timing is the failure that produced the numbers this harness replaces. Printing a bare "
    + "`0` beside a fast median is how it got quoted the first time.");
  assert.equal(hitsCell({ hits: 5358 }), "5358");
  assert.match(hitsCell({ error: "boom" }), /ERROR/);
});

test("the OR-width stack grows its term length until the terms are distinct", () => {
  // Thousands of US marks begin AMERIC. At six characters they collapse to one term; the stack then
  // has the width it claims and the vocabulary of a single query.
  const marks = ["AMERICAN ARBORA", "AMERICAN LUMEN", "AMERICAN NOVA", "AMERICAN TERRA"];
  const six = [...new Set(marks.map((m) => m.slice(0, 6)))];
  assert.equal(six.length, 1, "the premise: at six characters these four marks are one term");

  const { stems, termLen } = distinctStems(marks, 4);
  assert.equal(stems.length, 4, "all four must survive as distinct terms");
  assert.ok(termLen > 6, `the length must grow past the collapse, got ${termLen}`);
});

test("it stops at the shortest length that works, rather than always using the longest", () => {
  // Marks long enough that SEVERAL lengths separate them, which is the only fixture that can tell the
  // two orders apart: a short mark is filtered out of every length above its own, so four six-letter
  // marks land on six whichever way the loop runs.
  //
  // The length is not cosmetic. A longer term matches fewer rows, so the OR stack it builds is a
  // different query — and quoting a 16-character curve as the setting for a plan whose terms are
  // whole marks measures something the engine never runs.
  const marks = ["ALPHA1 INDUSTRIES", "BRAVO2 INDUSTRIES", "CHARLIE3 INDUSTRY", "DELTA4 INDUSTRIES"];
  const six = [...new Set(marks.map((m) => m.slice(0, 6)))];
  assert.equal(six.length, 4, "the premise: six characters already separate these four");
  const sixteen = [...new Set(marks.map((m) => m.slice(0, 16)))];
  assert.equal(sixteen.length, 4, "and so do sixteen — so the ORDER of the loop is what decides");

  const { stems, termLen } = distinctStems(marks, 4);
  assert.equal(termLen, 6, "six works, so six is what must be used");
  assert.equal(stems.length, 4);
});

test("when NO length separates them, it says so rather than returning a short list silently", () => {
  // The caller's contract: fewer stems than asked for. bench.mjs turns that into a SKIPPED row naming
  // the count, because a width row built from too few terms is a number that cannot be read.
  const marks = ["SAME", "SAME", "SAME"];
  const { stems } = distinctStems(marks, 400);
  assert.ok(stems.length < 400, "it must not pad, repeat or invent terms to reach the width");
  assert.equal(stems.length, 1);
});
