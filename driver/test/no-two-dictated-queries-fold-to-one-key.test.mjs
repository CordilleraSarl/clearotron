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
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildConnotationQueries, buildTranslitConnotationQueries, pickConnotationTerms,
  meaningAnglesFromMatterContext, queryKey } from "../connotation-search.mjs";

const keysOf = (qs) => qs.map(queryKey);
const collisions = (qs) => keysOf(qs).length - new Set(keysOf(qs)).size;

// Invented marks throughout. No client data reaches a test fixture.
const MARK = "Zarvex";

test("the transliteration bucket dictates no two queries the gate reads as one", () => {
  // THE REALISTIC CASE, and the reason this bucket is where it bites: it exists to carry non-Latin and
  // accented forms, mixed sources are where an NFC/NFD pair comes from, and NFKC folds them. Composed
  // U+00E9 against decomposed e + U+0301 — the same letter, two encodings, distinct to `toLowerCase`.
  const composed = "Zarvéx";
  const decomposed = "Zarvéx";
  assert.notEqual(composed, decomposed, "the fixture's two forms are byte-identical, so this arm proves nothing");

  const qs = buildTranslitConnotationQueries(
    [{ value: composed, category: "transliteration" }, { value: decomposed, category: "transliteration" }],
    { coreTerms: [] });

  // THE FLOOR, because an empty bucket has no collisions either and would read as a pass.
  assert.ok(qs.length >= 2, `the bucket dictated ${qs.length} queries, so the distinctness below is vacuous`);
  assert.equal(collisions(qs), 0,
    `the bucket dictated ${qs.length} queries the gate can only see as ${new Set(keysOf(qs)).size}. `
    + "A seat recording the smaller number satisfies the gate for all of them");
});

test("a core term suppresses its own folded twin in the transliteration bucket", () => {
  // The seed set is the other half of the same bug: a core term that folds onto a variant must suppress
  // it, or the variant is dictated a second time under a key the gate already holds.
  const qs = buildTranslitConnotationQueries(
    [{ value: "Zarvéx", category: "transliteration" }],
    { coreTerms: ["Zarvéx"] });
  assert.equal(qs.length, 0,
    "a transliteration that folds onto a core term was dictated again; the gate holds one key for both");
});

test("the authored meaning angles dictate no two queries the gate reads as one", () => {
  // The other producer, and a different folding class: a trailing question mark and an em-dash against a
  // hyphen. Both are things a human types twice in one authored line without noticing.
  const md = "Meaning angles: street slang for zarvex in skate culture; "
    + "street slang for zarvex in skate culture?; "
    + "does zarvex read as an insult—UK market; "
    + "does zarvex read as an insult-UK market";
  const angles = meaningAnglesFromMatterContext(md, { alreadyQueried: buildConnotationQueries([MARK]) });

  assert.ok(angles.length >= 2, `only ${angles.length} angle(s) parsed, so the distinctness below is vacuous`);
  assert.equal(collisions(angles), 0,
    `the frame dictated ${angles.length} angles the gate can only see as ${new Set(keysOf(angles)).size}`);
});

test("an already-queried floor query suppresses an angle that folds onto it", () => {
  // The seed set again, one producer over. An angle re-stating a floor query in different punctuation is
  // dictated twice and recorded once, and the gate cannot tell that from a search that ran.
  const floor = buildConnotationQueries([MARK]);
  assert.ok(floor.length >= 1, "the floor is empty, so this arm's premise is missing");
  const md = `Meaning angles: ${floor[0]}’s meaning; ${floor[0]}'s meaning`;
  const angles = meaningAnglesFromMatterContext(md, { alreadyQueried: floor });
  assert.equal(collisions(angles), 0, "two angles differing only by apostrophe form were both dictated");
});

test("the list the pipeline composes from all three producers is distinct under the key", () => {
  // THE PROPERTY THAT ACTUALLY MATTERS, composed the way pipeline.mjs composes it: the floor, then the
  // transliteration bucket seeded with the picked core terms, then the angles seeded with both. A
  // per-producer arm cannot see a collision BETWEEN two producers; this one can.
  const gridVariants = [MARK, "Zarvéx", "Zarvéx", "ZARVEX"];
  const connotation = buildConnotationQueries(gridVariants);
  const translit = buildTranslitConnotationQueries(
    [{ value: "Zarvéx", category: "transliteration" }, { value: "Zarvéx", category: "transliteration" }],
    { coreTerms: pickConnotationTerms(gridVariants) });
  const angles = meaningAnglesFromMatterContext(
    "Meaning angles: zarvex in skate culture; zarvex in skate culture?",
    { alreadyQueried: [...connotation, ...translit] });

  const dictated = [...connotation, ...translit, ...angles];
  assert.ok(dictated.length >= 6, `the composed list holds ${dictated.length} queries, too few to be a real check`);
  assert.equal(collisions(dictated), 0,
    `the composed spec dictates ${dictated.length} queries the gate can only see as `
    + `${new Set(keysOf(dictated)).size}. Every one of that difference is a query a seat may skip while `
    + "the gate reports it searched");
});
