// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — THE jx LANE RETRIEVED ITS TARGET TEN TIMES AND REACHED THE FINDINGS ZERO TIMES.
//
// R1 returned ten exact-match 色度 registrations — four REGISTERED, three in class 9, all in the
// matter's own classes — and the delivered report did not mention the token once. Not a recall problem:
// the lane generated the token, the plan carried it, the register answered. The records were classified
// `unclassifiable`, which is not one of the two tiers the FLOORS accept, so they landed in the script
// blind-spot list (context) instead of the floor list (obligations). Retrieved, banded, positioned, and
// never something a lawyer had to answer.
//
// Both ends of the comparison were discarding non-Latin content, which is why a mark could not be
// identical to itself: prepareTargets dropped a target with no Latin skeleton, and classifyRecord tiered
// a record with none as uncomparable. The tests below pin both, and pin the two things the fix must NOT
// do — widen the floor by containment, and let an empty skeleton pull Latin marks into a CJK
// neighbourhood.

import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyRecord, prepareTargets } from "../band-shape.mjs";

const TARGETS = ["PROJECT SABLE", "色度"];

test("A MARK IS IDENTICAL TO ITSELF, whatever script it is written in", () => {
  const r = classifyRecord("色度", TARGETS);
  assert.equal(r.tier, "identical", "this is the tier the floors accept — the whole issue");
  assert.equal(r.target, "色度");
  assert.equal(r.basis, "script-exact", "and the basis names WHY, so a floor row can be audited");
});

test("the target survives preparation — the other half of the seam", () => {
  // `if (!norm) continue` dropped it, so the jx lane's own generated token was not a comparison target
  // at all. A lane built to generate a token no Latin sweep reaches, whose token is then discarded
  // before comparison, buys exactly nothing.
  assert.deepEqual(prepareTargets(TARGETS).map((t) => t.text), ["PROJECT SABLE", "色度"]);
});

test("EQUALITY ONLY — 色度計 contains 色度 and is a different mark", () => {
  // The scorer's rule 1 takes containment both ways; the floors may not. A floor row is a mechanical
  // obligation a lawyer answers individually, so every member must be defensible without judgment.
  // Whether a longer mark containing the token matters is judgment's call, reached through the family
  // tiers and the crowd descriptors.
  assert.equal(classifyRecord("色度計", TARGETS).tier, "unclassifiable");
});

test("AN EMPTY SKELETON PULLS NOTHING IN — the failure mode the fix could have introduced", () => {
  // A non-Latin target is kept with empty edit1/cons/metaphone deliberately. Populated from an empty
  // skeleton, a one-character Latin mark would land in its edit neighbourhood and read as
  // near-identical to a Chinese mark — a fabricated conflict on a floor that must never carry one.
  for (const latin of ["X", "A", "AB", "ZZ"]) {
    const r = classifyRecord(latin, TARGETS);
    assert.notEqual(r.tier, "identical", `${latin} must not match 色度`);
    assert.notEqual(r.tier, "near-identical", `${latin} must not match 色度`);
  }
});

test("full-width and compatibility forms of the SAME characters still match (NFKC)", () => {
  assert.equal(classifyRecord("色度", ["色度"]).tier, "identical");
  assert.equal(classifyRecord("ﾃﾞﾙﾌｨ", ["デルフィ"]).tier, "identical", "half-width katakana is the same mark");
});

test("Latin classification is untouched — every existing tier still fires", () => {
  assert.equal(classifyRecord("PROJECT SABLE", TARGETS).basis, "normalized-equal");
  assert.equal(classifyRecord("PROJECT SABLES", TARGETS).tier, "near-identical");
  assert.equal(classifyRecord("ZEBRA WIDGET", TARGETS).tier, "other");
  assert.equal(classifyRecord("", TARGETS).basis, "no-comparable-content");
});

test("a record in a script with NO matching target is still a declared blind spot", () => {
  // The blind-spot list keeps its job: this fix promotes only what it can prove, and everything else
  // stays visible as a script gap rather than silently becoming `other`.
  const r = classifyRecord("デルフィ", TARGETS);
  assert.equal(r.tier, "unclassifiable");
  assert.match(r.basis, /^non-latin-script:/);
});
