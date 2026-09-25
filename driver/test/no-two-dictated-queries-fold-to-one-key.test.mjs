// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// WHAT THIS IS FOR. The gates that police the meaning sweep compare a dictated query against a recorded
// one on `queryKey`. The producers that BUILD the dictated list must dedup on the same key, or the list
// contains two queries the gate can only see as one — and a seat that records either satisfies the gate
// for both. The gate then reports a query as searched when it never ran, which is the exact fault the
// gate exists to catch, inverted into a fail-open.
//
// Driven, not tabulated. A folding table over queryKey passes everything and says nothing about this:
// the defect is not in what the key folds, it is in two callers disagreeing about the key. So these arms
// compose the dictated list the way the pipeline composes it and assert one property over the result.
//
// ONE PRODUCER NOW (ruled 2026-09-25). The meaning sweep is the matter frame's own list; the two fixed
// builders that rode beside it are gone, so the list the pipeline dictates is exactly what this reader
// returns from the frame's line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { meaningAnglesFromMatterContext, queryKey, CONNOTATION_SHAPES, CONNOTATION_SHAPES_TRANSLIT } from "../connotation-search.mjs";

const keysOf = (qs) => qs.map(queryKey);
const collisions = (qs) => keysOf(qs).length - new Set(keysOf(qs)).size;

// Invented marks throughout. No client data reaches a test fixture.
const MARK = "Zarvex";

test("the authored meaning angles dictate no two queries the gate reads as one", () => {
  // A trailing question mark and an em-dash against a hyphen: things a human types twice in one authored
  // line without noticing.
  const md = "Meaning angles: street slang for zarvex in skate culture; "
    + "street slang for zarvex in skate culture?; "
    + "does zarvex read as an insult—UK market; "
    + "does zarvex read as an insult-UK market";
  const angles = meaningAnglesFromMatterContext(md);

  assert.ok(angles.length >= 2, `only ${angles.length} angle(s) parsed, so the distinctness below is vacuous`);
  assert.equal(collisions(angles), 0,
    `the frame dictated ${angles.length} angles the gate can only see as ${new Set(keysOf(angles)).size}`);
});

test("two angles differing only by apostrophe form are dictated once", () => {
  const angles = meaningAnglesFromMatterContext(`Meaning angles: ${MARK.toLowerCase()}’s meaning in Portuguese; ${MARK.toLowerCase()}'s meaning in Portuguese`);
  assert.equal(angles.length, 1, "two angles differing only by apostrophe form were both dictated");
});

test("the list the pipeline dictates is the frame's list: distinct under the key, uncapped, with no fixed shape beside it", () => {
  // THE PROPERTY THAT ACTUALLY MATTERS, over the one producer left. Ten distinct angles and two folded
  // twins: all ten are dictated (the frame decides how many; there is no cap), once each.
  const distinct = Array.from({ length: 10 }, (_, i) => `zarvex reading ${i + 1} in skate culture`);
  const md = `Meaning angles: ${[...distinct, `${distinct[0]}?`, distinct[1].toUpperCase()].join("; ")}`;
  const dictated = meaningAnglesFromMatterContext(md);
  assert.equal(dictated.length, 10, `the frame named 10 distinct angles and ${dictated.length} were dictated`);
  assert.equal(collisions(dictated), 0,
    `the composed spec dictates ${dictated.length} queries the gate can only see as `
    + `${new Set(keysOf(dictated)).size}. Every one of that difference is a query a seat may skip while `
    + "the gate reports it searched");
  for (const q of dictated)
    for (const s of [...CONNOTATION_SHAPES, ...CONNOTATION_SHAPES_TRANSLIT])
      assert.ok(!q.endsWith(` ${s}`), `a fixed shape reached the dictated list: ${q}`);
  assert.deepEqual(meaningAnglesFromMatterContext("Meaning angles: none"), [], "an asserted none dictated a query");
});
