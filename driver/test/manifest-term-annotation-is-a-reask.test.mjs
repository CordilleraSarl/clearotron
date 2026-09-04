// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A manifest term carrying a NOTE about what it stands for is bounced back to the authoring stage,
// where it costs one re-ask — not forward to the compiler, where it costs the run.
//
// THE INCIDENT. R2 on the 6ea1008f baseline died at register-plan at 9m30s with two terms:
//
//     ORVELLA (formative root DELPH-)
//     DOLPHIN DEVICE (VIENNA 03.09.14)
//
// Both are a term plus a note saying which family the term stands for. Dispatched verbatim they are a
// nil search that reads as a CLEAN — the class — and here they were not even dispatched: they
// reached validatePlanFeasibility as `unexecutable` on a freshly minted plan and threw StageFailure.
//
// WHY THE EXISTING SHIELD DID NOT COVER THEM, which is the whole reason this arm is scoped the way it
// is. `variantTermIssue` catches prose shape, and exactly two compiler push sites carry its verdict as a
// `dropIssue` — primary-sweep and transliteration-numeric, both fed from `variants`. So a prose-shaped
// VARIANT becomes a disclosed deferred row and costs nothing. `dominant_element` and `elements[]` are
// pushed as bare terms at four other sites with no dropIssue at all, so for those two fields prose shape
// is terminal rather than disclosed.
//
// WHAT IS DELIBERATELY NOT CHECKED: length. `variantTermIssue` also refuses a value for being over four
// words, which is right at the compiler and wrong at a corrective stage gate — a slogan mark has a
// legitimately long dominant element and the stage cannot restate it any shorter, so flagging length
// here would hand back a reason with no remedy. An annotation always has a remedy: delete the note.
import { test } from "node:test";
import assert from "node:assert/strict";
import { variantTermShapeGaps } from "../variant-manifest-model.mjs";

const INCIDENT = ["ORVELLA (formative root DELPH-)", "DOLPHIN DEVICE (VIENNA 03.09.14)"];
const model = (o) => ({ dominant_element: "ORVELLA", elements: [], variants: [], ...o });

test("the two terms that lost R2 are bounced at the stage gate", () => {
  for (const term of INCIDENT) {
    assert.deepEqual(variantTermShapeGaps(model({ dominant_element: term })), [term],
      `a dominant element of ${JSON.stringify(term)} passed the manifest gate. It compiles as a bare `
      + "term at four push sites, none of which carries a dropIssue, and the run dies at the compiler.");
    assert.deepEqual(variantTermShapeGaps(model({ elements: [{ value: term }] })), [term],
      `an element value of ${JSON.stringify(term)} passed the manifest gate — same path, same ending`);
  }
});

test("CONTROL — a clean manifest is untouched, so a gap above means something", () => {
  assert.deepEqual(variantTermShapeGaps(model({
    dominant_element: "ORVELLA",
    elements: [{ value: "DOLPHIN DEVICE" }],
    variants: [{ value: "DELFIS" }, { value: "БИОДЕЛЬФИС" }],
  })), [], "the gate flags a manifest with nothing wrong with it, so it would re-ask every run");
});

test("a LONG dominant element is NOT bounced — a slogan mark has no shorter one to give", () => {
  assert.deepEqual(variantTermShapeGaps(model({ dominant_element: "THE BEST COFFEE IN TOWN" })), [],
    "length is being flagged at the stage gate. The stage cannot restate a slogan any shorter, so the "
    + "corrective ladder would hand back a reason with no remedy and the matter would brick — the "
    + "unremediable-floor failure this file's header names.");
});

test("a prose VARIANT is still NOT bounced here — it is disclosed at the compiler, and that is correct", () => {
  assert.deepEqual(variantTermShapeGaps(model({ variants: [{ value: "ORVELLA (formative root)" }] })), [],
    "the gate now fires on variants. Their prose arm is legitimately shielded for a slogan variant and "
    + "already becomes a disclosed deferred row, so refusing the manifest would refuse one the compiler "
    + "handles correctly — the ruling this fix was careful not to overturn.");
});

test("markup is still caught everywhere, variants included — the pre-existing arm is not narrowed", () => {
  assert.deepEqual(variantTermShapeGaps(model({ variants: [{ value: "**BIOVELTRIN**" }] })), ["**BIOVELTRIN**"],
    "#516's markup arm stopped covering variants");
});
