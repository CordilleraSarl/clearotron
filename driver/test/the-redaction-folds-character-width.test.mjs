// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A WITHHELD SCORE PRINTED A NAME IN CLEAR BECAUSE THE NAME WAS FULL WIDTH.
//
// A score taken without `--names` printed a mark and its proprietor in clear, in the same sentence as
// three that redacted correctly, from the same template, on the same run. The one that leaked renders its
// mark in full-width characters; the three that redacted do not. The protected set matched only the exact
// code points the reference happened to carry, so a name rendered at another width passed straight
// through - and the rows that did redact are what made the fourth easy to miss.
//
// Full-width Latin is ordinary in East Asian filings, so the failure concentrates in exactly the matters
// read in more than one script. A register can also hand back full-width digits and punctuation,
// half-width katakana, and an accented name either composed or decomposed. Those are one class, and one
// compatibility fold answers all of them.
//
// BOTH DIRECTIONS, EVERY SHAPE. A fold applied to one side only moves the failure rather than removing
// it, so each shape is driven with the protected side at one width and the text at the other, and again
// the other way round.
//
// THE WIDTH-SENSITIVE STRINGS ARE WRITTEN AS ESCAPES, NOT GLYPHS. Full-width and half-width forms are
// near-indistinguishable on screen and in a diff, which is how this survived review. The escapes let a
// reader see which is which. The katakana arm asserts on code points for the same reason: the two forms
// of a voiced syllable render identically and are not equal.
//
// THE STRINGS ARE INVENTED and built from words already in this tree - no name here comes from a matter.
import { test } from "node:test";
import assert from "node:assert/strict";
import { protectedStrings, redactor, authoredRedactor, foldForMatching } from "../score-redaction.mjs";

const HALF = "Quillion";
const FULL = "\uFF31\uFF55\uFF49\uFF4C\uFF4C\uFF49\uFF4F\uFF4E";            // Quillion, full width
const KATA_FULL = "\u30AF\u30A4\u30EA\u30AA\u30F3\u30BA";                   // full-width katakana
const KATA_HALF = "\uFF78\uFF72\uFF98\uFF75\uFF9D\uFF7D\uFF9E";             // the same, half width
// ONE WORD, DELIBERATELY. A two-word accented name is carried by its distinctive word, which is protected
// without any folding, so such an arm passes with the fold removed - driven to red to check that.
const ACCENT_COMPOSED = "Quilli\u00F3n";                                    // o-acute as one character
const ACCENT_DECOMPOSED = "Quillio\u0301n";                                 // o + combining acute
const LTD_FULL = "\uFF2C\uFF54\uFF44";                                      // Ltd, full width
const PARTY_FULL = "\uFF24\uFF45\uFF50\uFF54\uFF48 \uFF23\uFF48\uFF41\uFF52\uFF47\uFF45";   // "Depth Charge", full width

/** The redactor the scorer installs for a reference naming one party. */
const forParty = (name) => {
  const { names, prose } = protectedStrings({ findings: [{ owner: { name } }] });
  return redactor({ names, prose });
};

/** Every shape, both directions: protected as one rendering, met in the text as the other. */
const BOTH_WAYS = [
  ["full-width Latin", HALF, FULL],
  ["full-width digits and a space", `${HALF} 2000`, `${FULL}\u3000\uFF12\uFF10\uFF10\uFF10`],
  ["half-width katakana", KATA_FULL, KATA_HALF],
  ["a decomposed accent", ACCENT_COMPOSED, ACCENT_DECOMPOSED],
];

for (const [shape, a, b] of BOTH_WAYS) {
  for (const [protectedAs, metAs, way] of [[a, b, "protected one way, met the other"], [b, a, "and the reverse"]]) {
    test(`${shape} - ${way}`, () => {
      const line = `  owner ${metAs} filed in 2019`;
      const out = forParty(protectedAs)(line);
      assert.ok(!out.includes(metAs),
        `the name was printed in clear at the other rendering:\n    protected ${JSON.stringify(protectedAs)}\n    printed   ${JSON.stringify(out)}`);
      assert.match(out, /«name \d+»/, "nothing was withheld at all, so the arm above passed on an empty redactor");
      assert.ok(out.startsWith("  owner ") && out.endsWith(" filed in 2019"),
        `the surrounding text was mangled by the splice: ${JSON.stringify(out)}`);
    });
  }
}

test("the half-width voiced mark is folded into the syllable, not left beside it", () => {
  // THE REASON THE CLUSTER RULE NAMES THOSE TWO CODE POINTS EXPLICITLY. They are modifier LETTERS, not
  // marks, so grouping a character with \p{M} alone leaves U+30C8 U+3099 where the reference carries
  // U+30C9 - the same glyph on screen, and not a match. Reading the folded output could not catch this.
  const folded = foldForMatching(KATA_HALF).folded;
  assert.equal([...folded].map((c) => c.codePointAt(0).toString(16)).join(" "),
    [...KATA_FULL].map((c) => c.codePointAt(0).toString(16)).join(" "),
    "the half-width form folded to a different sequence of code points than the full-width one");
});

test("the fold must not turn a legal form into a protected word", () => {
  // THE FOLD IS WHAT MAKES THIS BITE. The distinctive-word rule excludes legal forms, but it did so on the
  // unfolded word: a full-width "Ltd" lowercases to full-width letters, which are not in the list.
  // Unfolded that was a harmless stray entry, because nothing matched it. Fold the text too and it matches
  // every "Ltd" the run prints - shredding output that names nobody, which is the cost the list avoids.
  const { names, derived } = protectedStrings({ findings: [{ owner: { name: `${FULL} ${LTD_FULL}` } }] });
  assert.ok(![...derived].some((d) => d.toLowerCase() === "ltd"),
    `a legal form reached the protected set: ${JSON.stringify([...derived])}`);
  assert.ok([...derived].includes(HALF), `the distinctive word was not derived: ${JSON.stringify([...derived])}`);
  const line = "  3 marks held by Ltd companies";
  assert.equal(redactor({ names, prose: new Set() })(line), line, "an ordinary legal form in the run's output was rewritten");
});

test("both fixes together - a full-width party whose word collides with the scorer's own heading", () => {
  // NEITHER FIX MAY PASS WITH THE OTHER'S DEFECT INTACT, which is what 1004 asks for. Without the fold the
  // full-width party is not matched at all and the data line below keeps its name. Without the authored
  // exemption the heading is rewritten. One party, both assertions.
  const HEADING = `\n── axis E · per-territory depth ${"─".repeat(45)}`;   // copied from scripts/score.mjs
  const { names, prose, derived } = protectedStrings({ findings: [{ owner: { name: PARTY_FULL } }] });
  assert.equal(authoredRedactor({ names, prose, derived })(HEADING), HEADING,
    "the scorer's own heading was rewritten, so a reader sees a party named in it");
  const data = `  owner ${PARTY_FULL} filed`;
  assert.ok(!redactor({ names, prose })(data).includes(PARTY_FULL),
    `the full-width party was printed in clear: ${JSON.stringify(redactor({ names, prose })(data))}`);
});

test("a zero-width character inside a name does not defeat the match", () => {
  // THE SAME DEFECT AS THE WIDTH ONE AND NOT FIXED BY THE FOLD. NFKC keeps every format character, so a
  // zero-width space one character into a protected name left it printed in clear - and a reader cannot
  // see the difference between that line and the redacted rows beside it. Both directions: the invisible
  // character can sit in the record or in the text.
  const ZW = "\u200B";
  for (const [protectedAs, metAs] of [[HALF, `Quil${ZW}lion`], [`Quil${ZW}lion`, HALF]]) {
    const out = forParty(protectedAs)(`  owner ${metAs} filed`);
    assert.ok(!out.includes(metAs), `the name was printed in clear: ${JSON.stringify(out)}`);
  }
});

test("a line carrying no protected name comes back unchanged, character for character", () => {
  // The splice is new. A redaction that quietly rewrites text naming nobody is the same fault as one that
  // eats a heading, and an unfolded page is the common case.
  const line = "  axis E, 4 territories, depth 2, 3 searched: Ltd, GmbH, K.K.";
  assert.equal(forParty(HALF)(line), line);
});
