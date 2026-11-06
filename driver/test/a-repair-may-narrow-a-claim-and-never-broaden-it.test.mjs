// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — THE CORRECTIVE PASS IS THE WRITER THAT INTRODUCES THESE.
//
// Five verdict refusals in seven days, one shape: a coverage or search-completion claim contradicted
// by the run's own records. Four of the five were introduced or worsened by the corrective pass, and
// the third run's was measured at the sentence level — that pass removed one coverage assertion and
// wrote two, one of which refused the run.
//
// Nothing in the composer forbade it. The instruction constrains WHICH passages may move and says
// nothing about what the replacement may ASSERT; every one of these was an in-scope rewrite that
// broadened.
//
// WHY THESE ARMS AND NOT A STRING GREP. A test that greps a composer for sentences the same commit
// wrote proves only that the commit happened. The failure mode worth pinning is STRUCTURAL and this
// module has already been bitten by it once — its own comment says so: "THREE SAMPLES BECAUSE THE
// COMPOSER HAS THREE SHAPES ... A guard walking only one of them walks part of the surface." A rule placed
// inside the `scopeBlock` conditional reaches only the dispatches where the reviewer declared
// ordinals, and vanishes silently on every other one. So the arms walk the composer's OWN declared
// samples — every shape — rather than a hand-written argument list that would go stale beside them.
//
// The prose gate this issue also proposed is NOT here, and deliberately: measured over 32 delivered
// narratives it fired on 31 of them (141 sentences) while nine of twelve before/after run-pairs read
// identically. It was withdrawn with evidence. The typed half of this class IS enforced structurally
// by `evidenceClaimViolations` over findings.json meters; a narrative sentence with no
// findings-side counterpart is invisible to it, and closing that is conversion-era work. This file
// pins the instruction, which is the part that ships.
import { test } from "node:test";
import assert from "node:assert/strict";
import { composerFor } from "../repair-composers.mjs";

const CORRECTIVE = composerFor("synthesis:corrective");
const shapes = () => CORRECTIVE.samples.map((s) => ({ name: s.name, text: CORRECTIVE.compose(s.args) }));

test("the three declared shapes really are different dispatches — the control for every arm below", () => {
  const [a, b, c] = shapes();
  assert.equal(shapes().length, 3, "the composer declares three shapes; an arm that walks one walks a third");
  assert.notEqual(a.text, b.text,
    "if both samples composed the same text, every 'in both shapes' assertion below would be one "
    + "assertion wearing two hats. The declared scope block is what makes them differ.");
  assert.match(b.text, /SCOPE — THE REVIEWER DECLARED/, "and the difference is the scope block, not incidental");
  assert.doesNotMatch(a.text, /SCOPE — THE REVIEWER DECLARED/);
  // The third is an undeclared scope whose flags name an excluded position: no scope block, and the position line alone.
  assert.doesNotMatch(c.text, /SCOPE — THE REVIEWER DECLARED/);
  assert.match(c.text, /THE EXCLUDED POSITIONS THE REVIEWER'S FLAGS ARE ABOUT: /);
});

test("a repair may narrow and never broaden — in EVERY shape, not only the scoped one", () => {
  for (const { name, text } of shapes()) {
    assert.match(text, /REPAIR THE FLAGGED CLAIM TO WHAT ITS HELD EVIDENCE SUPPORTS\. If the error is an overclaim, narrow it/,
      `${name}: a rule that reaches only the scoped dispatch is absent from most of them`);
    assert.match(text, /Do not replace a specific result with a general conclusion/, name);
  }
});

test("a correction keeps the true coverage facts of the passage it corrects, and the rule names the file it governs", () => {
  for (const { name, args } of CORRECTIVE.samples.map((s) => ({ name: s.name, args: s.args }))) {
    const text = CORRECTIVE.compose(args);
    assert.match(text, /CORRECT ONLY THE FLAGGED COVERAGE ACCOUNT/, name);
    // The interpolation has to be LIVE: a refactor that drops `${narrative}` leaves an instruction
    // about "the narrative" with no path in it, on a pass whose whole context is two file names.
    assert.ok(text.includes(`Preserve true, relevant coverage facts already in ${args.narrative}.`),
      `${name}: the coverage rule must name the narrative path, not the word "narrative"`);
    // THE TWO RULES NO LONGER DISAGREE. The rule this one replaced ordered a false coverage sentence struck with
    // nothing in its place, beside a rule that allows the smaller supported claim; a correction then removed two true
    // zero results that shared a passage with the wrong statement. Neither half of the old order survives in any shape.
    assert.doesNotMatch(text, /say nothing in its place|strike the claim/i, `${name}: the order to strike a coverage sentence whole is back`);
    // A fact the pass keeps or corrects comes from a record it can open here, inside that record's limits; a record
    // it cannot open leaves the claim smaller and the uncertainty said, never a fact supplied in its place.
    assert.match(text, /from an identified record held at this step\. Read that record before relying on it/, name);
    assert.match(text, /If the supporting record is unavailable or does not settle the claim, remove the unsupported part and keep the uncertainty explicit/, name);
  }
});

test("'narrowing is not hedging' ships WITH the never-soften rule, or the two contradict", () => {
  // This is the arm most at risk of being tidied away as redundant. It is not redundant: the pass is
  // told never to soften a statement AND to state less when it claims too much. Handed both without
  // the distinction a model picks one, and the one it picks is the one that reads as more permissive.
  for (const { name, text } of shapes()) {
    assert.match(text, /never softened/, `${name}: the rule the distinction resolves must still be here`);
    assert.match(text, /Narrowing is not hedging/, `${name}: and the distinction that resolves it`);
    assert.ok(text.indexOf("never softened") < text.indexOf("Narrowing is not hedging"),
      `${name}: the resolution must follow the rule it resolves — a reader meets them in order`);
  }
});

test("removing the support for a claim removes the claim", () => {
  for (const { name, text } of shapes()) {
    assert.match(text, /IF YOU REMOVE THE SUPPORT FOR A CLAIM, THE CLAIM GOES WITH IT/, name);
  }
});
