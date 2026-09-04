// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// member 2 — A RELABELLED RECORD IS THE SAME MARK, AND IT WAS TIERING BELOW THE FLOOR.
//
// Measured against the scorer: `VENZAL / VENZALMONO / VENZALKOMB` and `CHROMA & Device` are `alias` to
// reference-score and were `same-family / token-identical` here. Not dropped — tiered below the line.
// The floors take `identical` and `near-identical` only, so a register record that IS the mark under a
// relabelling never became a row a lawyer had to answer.
//
// Same consequence as member 1, different cause: member 1 could not compare at all; this one compares
// and under-rates. The tests below pin the fix AND the two ways it could have gone wrong — collapsing a
// longer mark into its first word, and matching on resemblance rather than equality.

import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyRecord, aliasesOf } from "../band-shape.mjs";

test("THE MEASURED PAIR — a relabelled entry is identical, and rides the floor", () => {
  const r = classifyRecord("VENZAL / VENZALMONO / VENZALKOMB", ["VENZAL"]);
  assert.equal(r.tier, "identical", "the tier the floors accept — the whole point");
  assert.equal(r.basis, "alias-exact");
  assert.equal(r.target, "VENZAL");
});

test("a device note is a relabelling, not a different mark", () => {
  assert.equal(classifyRecord("CHROMA & Device", ["CHROMA"]).basis, "alias-exact");
});

test("THE COLLISION THIS MUST NOT CAUSE — a word separator never collapses a longer mark", () => {
  // reference-score's rule-2 block warns about exactly this: conflating word separators with alias
  // separators makes every multi-word mark match its own first word. `TIKI TWIST` is a different
  // proprietor's different mark. Whitespace and hyphen are deliberately NOT in the separator class.
  for (const rec of ["TIKI TWIST", "TIKI-TWIST", "TIKI  TWIST"]) {
    const r = classifyRecord(rec, ["TIKI"]);
    assert.notEqual(r.tier, "identical", `${rec} must not be identical to TIKI`);
  }
  assert.deepEqual(aliasesOf("TIKI TWIST"), ["tikitwist"], "one name, not two aliases");
});

test("EQUALITY, NOT RESEMBLANCE — an alias that merely looks like a target is the family tiers' business", () => {
  // MEASURED, not assumed — I wrote `same-family` here first and the test refused it. The engine has no
  // substring or prefix rule, so a concatenated neighbour is `other`, and that is the correct answer:
  // `VENZALMONO` is a different mark from `VENZAL`. Only an alias LIST promotes, and only on equality.
  assert.equal(classifyRecord("VELTRINSOFT", ["VELTRIN"]).tier, "other");
  assert.equal(classifyRecord("VENZALMONO", ["VENZAL"]).tier, "other",
    "a neighbour that is not an alias list keeps the tier it earned; the alias arm cannot reach it");
});

test("the separator class is reference-score's, character for character", () => {
  // The scorer and the engine must agree about what a relabelling IS, or a record the score calls found
  // is a record the engine never put on the floor.
  assert.deepEqual(aliasesOf("A / B , C · D & E | F"), ["a", "b", "c", "d", "e", "f"]);
  assert.deepEqual(aliasesOf(""), []);
  assert.deepEqual(aliasesOf(null), []);
});

test("member 1 and the existing tiers are untouched", () => {
  assert.equal(classifyRecord("色度", ["PROJECT SABLE", "色度"]).basis, "script-exact");
  assert.equal(classifyRecord("PROJECT SABLE", ["PROJECT SABLE"]).basis, "normalized-equal");
  assert.equal(classifyRecord("PROJECT SABLES", ["PROJECT SABLE"]).tier, "near-identical");
  assert.equal(classifyRecord("ZEBRA WIDGET", ["PROJECT SABLE"]).tier, "other");
});

test("a single-token label never takes the alias path — no list, no promotion", () => {
  // The arm requires more than one alias, so an ordinary mark cannot reach `identical` by a route that
  // was built for relabellings.
  assert.equal(aliasesOf("VENZAL").length, 1);
  assert.equal(classifyRecord("VENZAL", ["VENZAL"]).basis, "normalized-equal", "it takes the direct route");
});
