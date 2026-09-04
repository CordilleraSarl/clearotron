// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// term-shape.test.mjs — the shared term-vs-predicate vocabulary (providers/_shared/term-shape.mjs).
//
// PR-1 (plan & dispatch determinism): the 2026-07-28 frozen plan carried {predicate:"exact",
// term:"TIKI*"} ×4 and dispatched frame-diff display LABELS as mark terms — both came back
// state:"enumerated", total_hits:0, i.e. schema-level confident cleans over slices never really
// searched. These are the detectors all four seams (freeze-lint, proposal mint, executor refusal,
// frame-diff fallback) share.
//
// Run:  node --test driver/test/term-shape.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hasAnchoredWildcard, termPredicateIssue, termShapeIssue, entryTermIssues, termMarkupIssue,
} from "../../providers/_shared/term-shape.mjs";

// ── — the two strings that killed R2b, verbatim from that run's own plan ─────────
// `_driver/register-plan.json`, 145 rows, `a017ce8`. Both `predicate=default`. Twenty minutes earlier
// the same matter on the same commit delivered CONDITIONAL at 7/9 recall with 144 rows and neither of
// these; the difference between delivering and dying was a `**` in a term field.
const INCIDENT = [
  "**Core (BIOVELTRIN, BIO VELTRIN, BIO-VELTRIN, etc.)**",
  "**Formative root (VELTRIN, DELPHIN, DELPHINUS, etc.)**",
];

test("hasAnchoredWildcard: anchored stars only — infix stars are legal marks, `?` is never plan syntax", () => {
  assert.equal(hasAnchoredWildcard("TIKI*"), true);
  assert.equal(hasAnchoredWildcard("*TIKI"), true);
  assert.equal(hasAnchoredWildcard("*TIKI*"), true);
  assert.equal(hasAnchoredWildcard("  SLUSH*  "), true);   // whitespace never hides an anchor
  assert.equal(hasAnchoredWildcard("E*TRADE"), false);     // infix star = a mark, not a pattern
  assert.equal(hasAnchoredWildcard("GUESS?"), false);      // `?` is a literal character in a mark
  assert.equal(hasAnchoredWildcard("TIKI"), false);
  assert.equal(hasAnchoredWildcard(""), false);
  assert.equal(hasAnchoredWildcard(null), false);
});

test("termPredicateIssue: an anchored-star term under a LITERAL predicate is the 2026-07-28 false-clean class", () => {
  for (const p of ["exact", "default", "phonetic"]) {
    assert.match(termPredicateIssue("TIKI*", p) ?? "", /false clean/i, `${p} + TIKI* must be an issue`);
    assert.match(termPredicateIssue("*SLUSH", p) ?? "", /wildcard-shaped/i);
  }
  // both directions: a `wildcard` predicate with no star has nothing to anchor
  assert.match(termPredicateIssue("TIKI", "wildcard") ?? "", /neither `\*` nor `\?`/);
  // and the agreeing pairs are clean
  assert.equal(termPredicateIssue("TIKI", "exact"), null);
  assert.equal(termPredicateIssue("TIKI*", "wildcard"), null);
  assert.equal(termPredicateIssue("*TIKI*", "wildcard"), null);
  assert.equal(termPredicateIssue("E*TRADE", "exact"), null);   // infix star stays literal
  assert.equal(termPredicateIssue("GUESS?", "exact"), null);
  // owner names ride their own field — the owner predicate is exempt by the entry-level walk (below);
  // the raw helper is predicate-agnostic for unknown predicates
  assert.equal(termPredicateIssue("", "exact"), null);          // emptiness is the existing rule's job
});

test("termShapeIssue: label/prose-shaped strings fire; marks — including 3-4 word marks — never do on word count alone", () => {
  // the 2026-07-28 label family (A2) and the prose-under-exact family
  assert.match(termShapeIssue("Reverse-order TIKI composites (TROPICAL TIKI, ISLAND TIKI)") ?? "", /label\/prose-shaped/);
  assert.match(termShapeIssue("SLUSH FREEZE, SLUSH ICE, SLUSH POP") ?? "", /words/);
  assert.match(termShapeIssue("TIKTOK / TIK- famous-neighbour family") ?? "", /label\/prose-shaped/);
  assert.match(termShapeIssue("TIKE, TIPI one-keystroke neighbours of TIKI") ?? "", /words/);
  // punctuation signals on 3-4 word strings
  assert.match(termShapeIssue("TIKI family (composites)") ?? "", /parenthetical/);
  assert.match(termShapeIssue("TIKI — the family") ?? "", /sentence punctuation/);
  assert.match(termShapeIssue("TIKI BAR; SLUSH") ?? "", /sentence punctuation/);
  assert.match(termShapeIssue("CORAL / FREEZE") ?? "", /space-flanked slash/);
  // genuine marks never fire
  assert.equal(termShapeIssue("TIKI"), null);
  assert.equal(termShapeIssue("CORAL FREEZE"), null);
  assert.equal(termShapeIssue("BLACK AND DECKER"), null);       // 3 words, no punctuation signal
  assert.equal(termShapeIssue("EAU DE COLOGNE 4711"), null);    // 4 words is still a mark
  assert.equal(termShapeIssue("24/7"), null);                   // tight slash is mark-legal
  // ≤2 words NEVER fires, whatever the punctuation — no short mark is collateral
  assert.equal(termShapeIssue("(TIKI)"), null);
  assert.equal(termShapeIssue("CORAL (FREEZE)"), null);
});

test("entryTermIssues: the entry-level walk — owner predicate exempt, term_literal is the escape hatch", () => {
  // the 2026-07-28 run's four qids, exactly
  for (const term of ["TIKI*", "*TIKI", "SLUSH*", "*SLUSH"]) {
    const issues = entryTermIssues({ predicate: "exact", term });
    assert.equal(issues.length, 1, `${term} under exact must be refused`);
    assert.match(issues[0].issue, /false clean/i);
  }
  // an OR-stack walks every member
  const stack = entryTermIssues({ predicate: "exact", terms: ["TIKI", "SLUSH*", "TIKI POP"] });
  assert.equal(stack.length, 1);
  assert.equal(stack[0].term, "SLUSH*");
  // owner names are legitimately long/prose-shaped — the owner predicate is fully exempt
  assert.deepEqual(entryTermIssues({ predicate: "owner", term: "MONSTER ENERGY COMPANY, SOCIÉTÉ ORGANISÉE SELON LES LOIS DE L'ETAT DU DELAWARE" }), []);
  // term_literal:true asserts "this IS the mark, verbatim" — a genuine 6-word slogan mark passes
  assert.deepEqual(entryTermIssues({ predicate: "exact", term: "I CAN'T BELIEVE IT'S NOT BUTTER", term_literal: true }), []);
  assert.equal(entryTermIssues({ predicate: "exact", term: "I CAN'T BELIEVE IT'S NOT BUTTER" }).length, 1);
  // a clean mark entry is clean
  assert.deepEqual(entryTermIssues({ predicate: "wildcard", term: "TIKI*" }), []);
  assert.deepEqual(entryTermIssues({ predicate: "default", term: "TIKI" }), []);
});

// ══ — markup and enumeration, at any word count and through the escape hatch ═══════════════════

test("#516 termMarkupIssue fires on the two incident strings, and on the shapes that would be quieter", () => {
  for (const t of INCIDENT) {
    const issue = termMarkupIssue(t);
    assert.ok(issue, `the string that killed the run must be refused: ${t}`);
    assert.match(issue, /markdown emphasis/);
    assert.match(issue, /etc\." enumeration/);
  }
  // The ONE-WORD case is the reason this arm exists separately from termShapeIssue. Both incident
  // strings are 6 words, so the pre-existing >4-word arm caught them BY LUCK. `**BIOVELTRIN**` is one
  // word: it trips nothing under the old rules, dispatches literally, and comes back
  // state:"enumerated", total_hits:0 — a false clean, and quieter than the run that died.
  assert.match(termMarkupIssue("**BIOVELTRIN**") ?? "", /markdown emphasis/);
  assert.match(termMarkupIssue("__VELTRIN__") ?? "", /markdown emphasis/);
  // The enumeration alone, with the emphasis stripped — this is the half that survives a `**` cleanup
  // and still stands for a GROUP no single literal can search.
  assert.match(termMarkupIssue("Formative root (VELTRIN, DELPHIN, DELPHINUS, etc.)") ?? "", /etc\." enumeration/);
  assert.match(termMarkupIssue("TIKI variants, …") ?? "", /etc\." enumeration/);
  assert.match(termMarkupIssue("TIKI variants, ...") ?? "", /etc\." enumeration/);
  // A heading marker — the other way a section title reaches a term field.
  assert.match(termMarkupIssue("# Core") ?? "", /heading marker/);
  assert.match(termMarkupIssue("### Formative root") ?? "", /heading marker/);
});

test("#516 the message says WHAT TO SEARCH — the stage that wrote the string is the one that must restate it", () => {
  // The issue's second acceptance criterion, and it is not decorative: "invalid term" is a refusal the
  // composing stage cannot act on. This mirrors the frame-diff guard's remedy shape.
  const issue = termMarkupIssue(INCIDENT[0]);
  assert.match(issue, /\*\*Core \(BIOVELTRIN/, "the row is quoted, so a reader can find it");
  assert.match(issue, /nil search that reads as CLEAN/, "and why it is refused rather than dispatched");
  assert.match(issue, /terms:\[/, "the remedy is a SHAPE the stage can fill in");
  assert.match(issue, /Say WHAT to search, not what the group is called/);
});

test("#516 the discriminators are markup and the enumeration — NEVER the bracket", () => {
  // The issue's binding trap. `predicate=owner` rows legitimately carry parenthesised company names,
  // and the cross-check lane — the one this fix screens — is exactly where they are minted. A bracket
  // rule breaks owner search on the lane the fix exists to protect.
  assert.equal(termMarkupIssue("Delphi Technologies (BorgWarner Inc.)"), null);
  assert.equal(termMarkupIssue("(TIKI)"), null);
  assert.equal(termMarkupIssue("CORAL (FREEZE)"), null);
  // `#LIKEAGIRL` is a registered mark. The heading arm REQUIRES the trailing whitespace, and a bare
  // `/^\s*#/` would refuse it — a real mark, silently unsearched, on a hashtag-shaped brand.
  assert.equal(termMarkupIssue("#LIKEAGIRL"), null);
  assert.equal(termMarkupIssue("#1 CHOICE"), null, "a leading # with no space is mark text, not a heading");
  // An infix star is a mark (E*TRADE) and a leading star is the WILDCARD predicate's business, not a
  // bullet: `*TIKI` is a legitimate variant, so no leading-bullet arm may exist here.
  assert.equal(termMarkupIssue("E*TRADE"), null);
  assert.equal(termMarkupIssue("*TIKI"), null);
  assert.equal(termMarkupIssue("TIKI*"), null);
  assert.equal(termMarkupIssue("24/7"), null);
  assert.equal(termMarkupIssue("I CAN'T BELIEVE IT'S NOT BUTTER"), null, "a genuine slogan mark carries no markup");
  assert.equal(termMarkupIssue(""), null);
  assert.equal(termMarkupIssue(null), null);
});

test("#516 the pre-existing ≤2-word invariants are untouched — this arm adds, it does not tighten", () => {
  // The regression guard for the binding trap, at the shared detector: termShapeIssue now delegates to
  // the markup arm first, and if that arm were implemented as a bare `(` test these would go red.
  assert.equal(termShapeIssue("(TIKI)"), null);
  assert.equal(termShapeIssue("CORAL (FREEZE)"), null);
  assert.equal(termShapeIssue("TIKI"), null);
  assert.equal(termShapeIssue("24/7"), null);
  // and it DOES inherit the new arm, so every existing caller gets it with no signature change
  assert.match(termShapeIssue("**BIOVELTRIN**") ?? "", /markdown emphasis/);
});

test("#516 the owner predicate stays fully exempt — screening the cross-check lane depends on it", () => {
  assert.deepEqual(entryTermIssues({ predicate: "owner", term: "Delphi Technologies (BorgWarner Inc.)" }), []);
  assert.deepEqual(entryTermIssues({ predicate: "owner", term: "**Delphi Technologies (BorgWarner Inc.)**" }), [],
    "exempt means exempt — a markup owner name is a separate, unevidenced question, and firing here would break owner search on the lane this fix protects");
  assert.deepEqual(entryTermIssues({ predicate: "owner", terms: ["ACME, ETC. LTD", "# NORTH CO"] }), []);
});

test("#516 term_literal shields the SHAPE arms and never the markup arm", () => {
  // The hatch means "this string IS the mark, verbatim". A slogan mark can say that truthfully.
  assert.deepEqual(entryTermIssues({ predicate: "exact", term: "I CAN'T BELIEVE IT'S NOT BUTTER", term_literal: true }), []);
  // A `**`-wrapped string cannot, and the flag is a field the MODEL fills in on a supplemental
  // proposal. Under the old blanket `if (e.term_literal === true) return []` this dispatched: the
  // executor runs this same walk, so the shield rode all the way to the wire and enumerated nothing.
  const shielded = entryTermIssues({ predicate: "exact", term: "**BIOVELTRIN**", term_literal: true });
  assert.equal(shielded.length, 1, "markup bypasses the hatch");
  assert.match(shielded[0].issue, /markdown emphasis/);
  assert.equal(shielded[0].term, "**BIOVELTRIN**");
  // and the shield still works on the arm it is for, on the same entry shape
  assert.deepEqual(entryTermIssues({ predicate: "exact", terms: ["I CAN'T BELIEVE IT'S NOT BUTTER"], term_literal: true }), []);
});
