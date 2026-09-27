// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A REDACTION THAT EATS THE SCAFFOLDING MAKES A READER DOUBT WHAT IS INTACT.
//
// The distinctive-word rule protects every word of five characters or more, bar legal forms, from each
// party name — so prose shortening a two-word proprietor is still covered. That closed a real leak and
// keeps its teeth here. What it also does is put ORDINARY long words into the protected set: a party
// called something like "Depth Charge" protects "Depth", and `installRedaction` wraps every print, so
// the scorer's own heading comes out as `per-territory «name 1» depth`.
//
// WHY THAT IS NOT OVER-REDACTION IN THE SAFE DIRECTION, which is how it was cleared when the rule
// landed: a reader of a redacted score cannot tell a redaction from a word. `per-«name 1» depth` reads
// as though a party were named in a heading. The structure surviving while only the parties go is the
// whole value of a withheld read, and eating the scaffolding makes a reader doubt the parts that are
// intact. Proved below against the real word and the actual heading rather than an invented example —
// reasoning about an invented one is what let the cost be talked past.
//
// THE FLOOR IS NOT THE DEFECT. A short party name is unsafe and a long ordinary word is unsafe, so
// raising five to seven moves the collision rather than removing it. The arms below hold the teeth:
// a party's own distinctive word is still redacted in prose.
import { test } from "node:test";
import assert from "node:assert/strict";
import { protectedStrings, redactor, authoredRedactor } from "../score-redaction.mjs";

// The heading the scorer actually prints, copied from scripts/score.mjs rather than invented.
const HEADING = `\n── axis E · per-territory depth ${"─".repeat(45)}`;
// A party whose name carries an ordinary long word. "Charge" is a second one, so the arm is not resting
// on a single collision.
const REF = { findings: [{ owner: { name: "Depth Charge" } }] };

test("a party's ordinary long word does not rewrite the scorer's own heading", () => {
  const { names, prose, derived } = protectedStrings(REF);
  assert.ok([...derived].includes("Depth"), "precondition: the distinctive-word rule protects it at all");
  const authored = authoredRedactor({ names, prose, derived });
  assert.equal(authored(HEADING), HEADING, "the heading came back rewritten, so a reader sees a party named in it");
});

test("and the teeth are intact — the same word IS redacted in the run's own prose", () => {
  // The control. Without this the arm above passes on a redactor that stopped redacting.
  const { names, prose, derived } = protectedStrings(REF);
  const red = redactor({ names, prose, derived });
  const line = "  the proprietor Depth objected on goods grounds";
  assert.notEqual(red(line), line, "a party's distinctive word survived in prose, which is the leak the rule closed");
  assert.doesNotMatch(red(line), /\bDepth\b/, "the word is still there");
});

test("an authored line carrying a party's FULL name is still redacted", () => {
  // The authored path is not a bypass: it drops the derived layer only. A data line routed through it by
  // mistake still has its party names taken out, so the worst case is a shortened form and never a name.
  const { names, prose, derived } = protectedStrings(REF);
  const authored = authoredRedactor({ names, prose, derived });
  assert.doesNotMatch(authored("owner: Depth Charge"), /Depth Charge/, "the full name survived an authored line");
});

test("a party name with no ordinary long word is unaffected either way", () => {
  // Acme is short, so nothing is derived from it — which is why this was invisible until a long
  // ordinary word turned up in a reference.
  const { names, prose, derived } = protectedStrings({ findings: [{ owner: { name: "Acme" } }] });
  assert.deepEqual([...derived], [], "a single short name derived a word, and the floor is not doing its job");
  assert.equal(authoredRedactor({ names, prose, derived })(HEADING), HEADING);
});
