// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A REDACTION MUST NEVER SHRINK ITS OWN COVERAGE.
//
// The redactor collects every range it will replace and splices once. The first version DROPPED a
// candidate range that overlapped one already accepted, which reads as the safe choice and is not: a name
// STRADDLING the edge of an accepted prose range was refused whole, and the part of it outside that range
// was then emitted exactly as it stood. Measured with invented strings: prose "hello DRAV" beside a
// protected "DRAVOLINE" printed "OLINE" in clear, immediately after a withheld token.
//
// THAT IS THE WORST SHAPE THIS MODULE HAS, and worse than a plain miss. The token beside the fragment
// tells the reader the redaction is working, so the fragment reads as ordinary text and nobody re-reads
// the page. A name wholly inside a prose range was always handled correctly; only the straddle leaked,
// which is why it survived the obvious cases.
//
// Ranges are now MERGED rather than dropped, so coverage only ever grows. The arms below hold both edges
// of the straddle, the contained case that already worked, and the determinism the token numbering needs.
//
// THE STRINGS ARE INVENTED. No name here comes from a matter.
import { test } from "node:test";
import assert from "node:assert/strict";
import { redactor } from "../score-redaction.mjs";

const NAME = "Quillion";
const TEXT = "hello Quillion said the clerk";
/** The fragments a straddle used to leave behind, either side of the name. */
const FRAGMENTS = ["Quil", "lion", "Quillio", "uillion"];

const leftovers = (out) => FRAGMENTS.filter((f) => out.includes(f));

test("a name straddling the START of a withheld sentence leaves no part of itself on the page", () => {
  const out = redactor({ names: new Set([NAME]), prose: new Set(["hello Quil"]) })(TEXT);
  assert.deepEqual(leftovers(out), [], `part of the name survived beside a withheld token: ${JSON.stringify(out)}`);
});

test("a name straddling the END of a withheld sentence leaves no part of itself on the page", () => {
  const out = redactor({ names: new Set([NAME]), prose: new Set(["lion said the clerk"]) })(TEXT);
  assert.deepEqual(leftovers(out), [], `part of the name survived beside a withheld token: ${JSON.stringify(out)}`);
});

test("a name wholly inside a withheld sentence yields ONE token, not a token per layer", () => {
  // The case that always worked. Without it the arms above pass on a redactor that blanks whole lines.
  const out = redactor({ names: new Set([NAME]), prose: new Set(["hello Quillion said"]) })(TEXT);
  assert.deepEqual(leftovers(out), []);
  assert.equal(out.match(/\[withheld/g).length, 1, `the sentence was withheld more than once: ${JSON.stringify(out)}`);
  assert.doesNotMatch(out, /«name/, "a name token appeared inside a sentence that was withheld whole");
  assert.ok(out.endsWith(" the clerk"), `text outside the withheld sentence was eaten: ${JSON.stringify(out)}`);
});

test("two overlapping names merge to one token, and the same input redacts the same way twice", () => {
  // Token numbers are the entry's position in a stable ordering, so two runs of one page must agree.
  const names = new Set(["Quillion Works", "Works Limited"]);
  const line = "  the proprietor Quillion Works Limited objected";
  const once = redactor({ names })(line);
  const twice = redactor({ names })(line);
  assert.equal(once, twice, "the same page redacted two different ways");
  for (const f of ["Quillion", "Works", "Limited"]) {
    assert.ok(!once.includes(f), `${f} survived: ${JSON.stringify(once)}`);
  }
});

test("an empty protected entry is skipped rather than looping forever", () => {
  // A hang has no error message, and this is the consumer trusting the producer: nothing empty can arrive
  // from a reference today, because every branch that collects one tests it first. That is the producer's
  // property, not this function's. `indexOf("")` is 0 and the scan advances by the needle's length.
  assert.equal(redactor({ prose: new Set([""]) })("anything at all"), "anything at all");
  assert.equal(redactor({ names: new Set([""]) })("anything at all"), "anything at all");
});
