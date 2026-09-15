// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A NAME RATED ABOVE EVERY CONFLICT FOUND AGAINST IT.
//
// Delivered, 2026-09-14. A batch of three names for a client whose own scale has four bands and no Low.
// All three names came back a band above every card on their own pages — twelve cards, all at the
// bottom band, under three names sitting above them, with nothing on any page explaining the gap. The
// reviewing lawyer read the cards as right and the names as wrong.
//
// Two causes, and this file is the floor under the second. The first was doctrine: a rule forbidding
// the lowest band for everyday words, which on a scale ending in Low kept a name off "no issues found"
// and on a scale without one lifted it a whole band. That rule is retired in this change. The second is
// that NOTHING TIED A NAME'S BAND TO ITS CARDS — the name's band was the model's own `rating` and no
// check compared it with the bands underneath. Retiring the doctrine alone would leave the second
// cause live, and the same shape could arrive by any other route.
//
// THE DIRECTION IS THE TRAP AND IT IS ASSERTED, NOT COMMENTED. Index 0 is the WORST band, so "above"
// is a SMALLER index. Written the other way round this check passes on the exact production run it was
// written for and fires on correct ones, which is why arm 1 pins the ladder's order before it pins
// anything about a mark.
import { test } from "node:test";
import assert from "node:assert/strict";
import { markRatedAboveItsCards } from "../verify-knockout.mjs";

// The real shape of the client's scale from the delivered batch: four bands, no Low.
const FOUR_BAND = { bands: [{ label: "Very High" }, { label: "High" }, { label: "Medium" }, { label: "Manageable" }] };
const mark = (rating, extra = {}) => ({ name: "FIXTUREMARK", rating, ...extra });

test("the floor: index 0 is the WORST band on this ladder, which is what 'above' means", () => {
  // Everything below reads as its opposite if this is wrong, and a comment cannot hold it.
  const worstRated = markRatedAboveItsCards(FOUR_BAND, mark("Very High", { findings: [{ band: "Manageable" }] }));
  const bestRated = markRatedAboveItsCards(FOUR_BAND, mark("Manageable", { findings: [{ band: "Very High" }] }));
  assert.ok(worstRated, "the most severe band over the least severe card was not refused — the ladder is being read upside down");
  assert.equal(bestRated, null, "the least severe band under the most severe card was refused — rating BELOW the worst card is allowed");
});

test("A NAME RATED ABOVE EVERY CARD ON ITS PAGE IS REFUSED, and the refusal names the worst card", () => {
  // The delivered shape exactly: the name a band above, every card at the bottom.
  const reason = markRatedAboveItsCards(FOUR_BAND, mark("Medium", {
    findings: [{ band: "Manageable" }, { band: "Manageable" }],
    registerReads: [{ recordId: "R-1", read: "a live filing", band: "Manageable" }],
  }));
  assert.match(String(reason), /^knockout_rating_above_cards:/, "the refusal must be token-first, like the others in this file");
  assert.match(String(reason), /"Manageable"/, "the refusal does not name the worst card, so the seat cannot act on it");

  // A BANDED REGISTER READ IS A CARD, AND THE REFUSAL MUST NAME ITS BAND. Asserting only that something
  // was refused passes for the wrong reason — drop registerReads from the card list and the mark has no
  // cards at all, which refuses too, by the other branch. A plant found that: this arm was green with
  // register reads removed entirely. The band word is what separates the two paths.
  const viaRegister = String(markRatedAboveItsCards(FOUR_BAND, mark("High", {
    registerReads: [{ recordId: "R-1", read: "a live filing", band: "Medium" }],
  })));
  assert.match(viaRegister, /above every card on its page/, "a banded register read was not counted as a card — this refused as a name with NO cards instead");
  assert.match(viaRegister, /"Medium"/, "the refusal does not name the register read's own band");

  // AND IT IS THE ONLY CARD THERE: rated at that band exactly, it passes.
  assert.equal(markRatedAboveItsCards(FOUR_BAND, mark("Medium", {
    registerReads: [{ recordId: "R-1", read: "a live filing", band: "Medium" }],
  })), null, "a name equal to its only card, a register read, was refused");

  // AND A ROW WITH NO BAND IS NOT A CARD. Its band is optional by design — a read with no band prints
  // no chip — so counting it would invent a floor out of silence.
  assert.equal(markRatedAboveItsCards(FOUR_BAND, mark("Manageable", {
    findings: [{ band: "Manageable" }],
    registerReads: [{ recordId: "R-1", read: "a read with no band" }],
  })), null, "a bandless register row changed the answer");

  // EQUAL TO THE WORST CARD IS THE ORDINARY CASE and must pass: twelve of the nineteen names on the
  // box sit exactly there.
  assert.equal(markRatedAboveItsCards(FOUR_BAND, mark("Manageable", { findings: [{ band: "Manageable" }] })), null);
});

test("A NAME WITH NO RATED CARDS IS NOT THIS CHECK'S BUSINESS — the doctrine says it, the code does not", () => {
  // The first draft refused a cardless name that was not at the bottom band, and the end-to-end batch
  // found it: a mark with no cards, correctly rated Manageable on a five-band ladder, refused because
  // that ladder's bottom is Low. Forcing a band down is a floor, and the ruling forbids replacing the
  // retired rule with another one — the doctrine states the bottom-band reading (calibration rule 8)
  // and the model reasons it. With no cards there is nothing to be above, so this refuses nothing.
  const FIVE_BAND = { bands: [...FOUR_BAND.bands, { label: "Low" }] };
  assert.equal(markRatedAboveItsCards(FIVE_BAND, mark("Manageable", {})), null,
    "a cardless name was refused for not being at the bottom band — that is a floor, not this rule");
  assert.equal(markRatedAboveItsCards(FOUR_BAND, mark("Medium", { findings: [] })), null);
  assert.equal(markRatedAboveItsCards(FIVE_BAND, mark("Low", {})), null);
  // A row with no band leaves the page cardless for this purpose, so the same silence applies.
  assert.equal(markRatedAboveItsCards(FOUR_BAND, mark("High", {
    registerReads: [{ recordId: "R-1", read: "a read with no band" }],
  })), null, "a bandless register row was treated as a card");
});

test("what must not break: no frozen ladder, and an unknown band, are other checks' business", () => {
  // Refusing here would double-report what knockout_band_unknown already says, and a run with no frozen
  // framework has no ladder to reason against — silence is the honest answer in both.
  assert.equal(markRatedAboveItsCards({ bands: [] }, mark("Medium", { findings: [{ band: "Manageable" }] })), null);
  assert.equal(markRatedAboveItsCards(FOUR_BAND, mark("Catastrophic", { findings: [{ band: "Manageable" }] })), null);
});
