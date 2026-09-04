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
// module has already been bitten by it once — its own comment says so: "TWO SAMPLES BECAUSE THE
// COMPOSER HAS TWO SHAPES ... A guard walking only one of them walks half the surface." A rule placed
// inside the `scopeBlock` conditional reaches only the dispatches where the reviewer declared
// ordinals, and vanishes silently on every other one. So the arms walk the composer's OWN declared
// samples — both shapes — rather than a hand-written argument list that would go stale beside them.
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

test("1889: the two declared shapes really are different dispatches — the control for every arm below", () => {
  const [a, b] = shapes();
  assert.equal(shapes().length, 2, "the composer declares two shapes; an arm that walks one walks half");
  assert.notEqual(a.text, b.text,
    "if both samples composed the same text, every 'in both shapes' assertion below would be one "
    + "assertion wearing two hats. The declared scope block is what makes them differ.");
  assert.match(b.text, /SCOPE — THE REVIEWER DECLARED/, "and the difference is the scope block, not incidental");
  assert.doesNotMatch(a.text, /SCOPE — THE REVIEWER DECLARED/);
});

test("1889: a repair may narrow and never broaden — in BOTH shapes, not only the scoped one", () => {
  for (const { name, text } of shapes()) {
    assert.match(text, /MAY NARROW A CLAIM AND MAY NEVER BROADEN ONE/,
      `${name}: a rule that reaches only the scoped dispatch is absent from most of them`);
    assert.match(text, /never replace a specific sentence with a general one/, name);
  }
});

test("1889: the coverage account may not be reopened, and the rule names the file it governs", () => {
  for (const { name, args } of CORRECTIVE.samples.map((s) => ({ name: s.name, args: s.args }))) {
    const text = CORRECTIVE.compose(args);
    assert.match(text, /THE COVERAGE ACCOUNT IS NOT YOURS TO REOPEN HERE/, name);
    // The interpolation has to be LIVE: a refactor that drops `${narrative}` leaves an instruction
    // about "the narrative" with no path in it, on a pass whose whole context is two file names.
    assert.ok(text.includes(`that is not already in ${args.narrative}`),
      `${name}: the coverage rule must name the narrative path, not the word "narrative"`);
    assert.match(text, /Replacing it with a different coverage sentence is not/, name);
  }
});

test("1889: 'narrowing is not hedging' ships WITH the never-soften rule, or the two contradict", () => {
  // This is the arm most at risk of being tidied away as redundant. It is not redundant: the pass is
  // told never to soften a statement AND to state less when it claims too much. Handed both without
  // the distinction a model picks one, and the one it picks is the one that reads as more permissive.
  for (const { name, text } of shapes()) {
    assert.match(text, /never softened/, `${name}: the rule the distinction resolves must still be here`);
    assert.match(text, /NARROWING IS NOT HEDGING/, `${name}: and the distinction that resolves it`);
    assert.ok(text.indexOf("never softened") < text.indexOf("NARROWING IS NOT HEDGING"),
      `${name}: the resolution must follow the rule it resolves — a reader meets them in order`);
  }
});

test("1889: removing the support for a claim removes the claim", () => {
  for (const { name, text } of shapes()) {
    assert.match(text, /IF YOU REMOVE THE SUPPORT FOR A CLAIM, THE CLAIM GOES WITH IT/, name);
  }
});
