// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// two-word-annotated-variant-is-refused.test.mjs —.
//
// `variantTermIssue` checked markup, then applied a `words.length <= 2` floor and returned null before
// it ever reached the parenthetical arm. So an annotation short enough to stay inside two words was
// invisible: `ORVELLA (root)` compiled bare, dispatched verbatim, and returned a confident zero over
// marks that may well exist.
//
// AND THE DISCLOSURE RIDES ON THIS VERDICT. Two compiler push sites carry it as a `dropIssue`, so a
// prose-shaped variant normally becomes a disclosed deferred row. A null verdict means no deferred row
// either — the nil search shipped as a clean with nothing anywhere saying otherwise. That is the
// class, and this is its silent half.
//
// THE FLOOR IS DOING REAL WORK AND STAYS. `DOLPHIN DEVICE` is two words and a perfectly good term, and
// refusing ordinary two-word marks is the failure this arm must not cause. What separates the two is
// not length, it is the ANNOTATION — and an annotation always has a remedy (delete the note, keep the
// term), which is why this arm may sit above the floor where the LENGTH arm may not. Same reasoning
// used to put the markup arm above the same floor.
//
// MEASURED BEFORE LANDING: 589 archived variant manifests, 4,280 variant terms, 0 newly refused by
// this change. 30 already-annotated terms above the floor are refused today, which is the control that
// makes the zero a result rather than a blind instrument.

import { test } from "node:test";
import assert from "node:assert/strict";
import { variantTermIssue } from "../register-plan.mjs";
import { variantTermShapeGaps } from "../variant-manifest-model.mjs";

test("#1520 a two-word annotated variant is refused instead of dispatched", () => {
  for (const t of ["ORVELLA (root)", "FOO (bar)", "ZEPHYR (root)"]) {
    const v = variantTermIssue(t);
    assert.ok(v, `${JSON.stringify(t)} still compiles bare — it would dispatch verbatim as a nil search`);
    assert.match(v, /parenthetical/);
    // The refusal has to say what a nil search costs, or the reader treats it as a style note.
    assert.match(v, /nil search that reads as a clean/);
  }
  // The other two annotation shapes, also inside the floor.
  assert.match(variantTermIssue("ONE; TWO"), /sentence punctuation/);
  assert.match(variantTermIssue("ALPHA / BETA"), /space-flanked slash/);
});

test("#1520 THE CONTROL — an ordinary short mark still compiles", () => {
  // If any of these flip, the arm has started refusing real marks, which is strictly worse than the
  // defect it fixes: a nil search is one slice, a refused manifest is the whole matter.
  for (const t of ["DOLPHIN DEVICE", "NOVA PULSE", "ZEPHYR", "E*TRADE", "COCA COLA", "ZORVIL 9"]) {
    assert.equal(variantTermIssue(t), null, `${JSON.stringify(t)} — an ordinary mark was refused`);
  }
  // `DOLPHIN DEVICE` is the residue of the real incident string `DOLPHIN DEVICE (VIENNA 03.09.14)`:
  // the annotated form is refused, and what remains after the remedy — delete the note, keep the
  // term — must compile. Both halves asserted together, because the remedy is what makes hoisting
  // this arm safe.
  assert.ok(variantTermIssue("DOLPHIN DEVICE (VIENNA 03.09.14)"));
  assert.equal(variantTermIssue("DOLPHIN DEVICE"), null);
});

test("#1520 nothing already refused changes the reason it gives", () => {
  // The length arm keeps its precedence, so a long annotated value still reports its word count. If
  // the annotation arm had gone first, every archived >4-word parenthetical would silently start
  // reporting a different reason — a disclosed row changing its text for no reason a reader can see.
  assert.match(variantTermIssue("A B C D E F (x)"), /\(7 words\)/);
  assert.match(variantTermIssue("ORVELLA (formative root DELPH-)"), /parenthetical/);
  assert.match(variantTermIssue("PLAY * WAY"), /infix-star/, "markup and infix-star still outrank everything");
});

test("#1520 one predicate, and the division of labour it serves is unchanged", () => {
  // The two copies had drifted: the gate's caught a lone `)` and the compiler's did not. Asserted as
  // the OBSERVABLE property — both callers reach the same verdict on the character that differed —
  // rather than by importing the shared function, so this file still LOADS against the pre-fix tree
  // and every arm below reports its own verdict instead of the suite dying on a missing export.
  assert.ok(variantTermShapeGaps({ dominant_element: "ZEPHYR root)" }).includes("ZEPHYR root)"),
    "the gate stopped catching the lone-paren case");
  assert.ok(variantTermIssue("ZEPHYR root)"), "the compiler disagrees with the gate on the lone-paren case");

  // THE GATE FIRES ANNOTATION ON dominant_element — nothing downstream shields that field, so a note
  // there reaches validatePlanFeasibility as unexecutable and throws the whole matter away.
  assert.ok(variantTermShapeGaps({ dominant_element: "ZEPHYR (root)" }).includes("ZEPHYR (root)"));

  // AND DELIBERATELY DOES NOT FIRE ON `variants` — the standing MARKUP ARM ONLY ruling. This arm pins
  // that on purpose: it is the behaviour a careless reading of would "fix" next, and it must not
  // change. Firing here would refuse manifests the compiler handles correctly.
  assert.deepEqual(variantTermShapeGaps({ variants: [{ value: "ZEPHYR (root)", category: "root" }] }), []);
});

test("#1520 the ruling's premise is restored, not overturned", () => {
  // The MARKUP ARM ONLY ruling holds `variants` to markup only BECAUSE "a prose-shaped VARIANT becomes
  // a disclosed deferred row and costs nothing" — the compiler discloses it, so the gate need not
  // refuse it. For a variant short enough to sit under the two-word floor that premise was FALSE:
  // `variantTermIssue` returned null, no dropIssue rode, and no deferred row existed. The slice
  // dispatched verbatim and its zero read as a clean.
  //
  // So the compiler must refuse exactly what the gate deliberately lets past, and this arm holds the
  // two halves against each other. If it ever fails, the gate is passing something nothing discloses.
  for (const t of ["ZEPHYR (root)", "ORVELLA (root)", "ONE; TWO", "ALPHA / BETA"]) {
    assert.deepEqual(variantTermShapeGaps({ variants: [{ value: t, category: "root" }] }), [],
      `premise: the gate lets ${JSON.stringify(t)} past`);
    assert.ok(variantTermIssue(t), `and nothing discloses ${JSON.stringify(t)} — a nil search would ship as a clean`);
  }
});

test("#1520 the floor still exists — length alone refuses nothing under three words", () => {
  // The premise the whole change rests on: this is an ANNOTATION test above the floor, not the floor
  // being removed. A two-word term with no annotation must still pass on length grounds alone.
  assert.equal(variantTermIssue("TWO WORDS"), null);
  assert.equal(variantTermIssue("THREE SMALL WORDS"), null, "three un-annotated words are still fine");
  assert.equal(variantTermIssue("FOUR SMALL PLAIN WORDS"), null, "four un-annotated words are still fine");
  assert.match(variantTermIssue("FIVE SMALL PLAIN ORDINARY WORDS"), /5 words/, "the length arm still fires above four");
});
