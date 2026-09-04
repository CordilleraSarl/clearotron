// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — A CITATION WITH NO LINE NUMBER IS THE ONLY KIND THAT SURVIVES AN EDIT.
//
// Every arm in citation-line-check.mjs narrows the wrong-live-line class without closing it, and the
// script says so in its own summary: "a citation that drifted onto a different REAL line reads as
// correct to it". This arm does not narrow that class. It removes the number, which is the part that
// goes stale.
//
// THE PLANT IS THE POINT, and it is written first below because it is the criterion the issue sets:
// move a cited symbol within its file and the citation still resolves; delete it and the citation fails.
// A line citation gets both of those backwards — it survives the deletion, pointing at whatever slid
// into the vacated line, and it breaks on the move.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { symbolCitationsIn, symbolCitationMisses, SYMBOLIC } from "../../scripts/citation-line-check.mjs";

/** A one-file corpus and a reader over a fake tree, so the arms drive the real functions. */
function harness(citedBody) {
  const byBase = new Map([["target.mjs", ["driver/target.mjs"]]]);
  const readLines = (p) => (p === "driver/target.mjs" ? citedBody.split("\n") : null);
  return { byBase, readLines };
}
const cite = (text, h) => symbolCitationsIn([{ file: "driver/stages.mjs", text }], h.byBase);

const WITH_SYMBOL_EARLY = [
  "// a file",
  "export function coerceAxisToken(t) {",
  "  return String(t);",
  "}",
].join("\n");

const WITH_SYMBOL_MOVED = [
  "// a file",
  ...Array.from({ length: 40 }, (_, i) => `// filler line ${i} — every one of these shifts a line citation`),
  "export function coerceAxisToken(t) {",
  "  return String(t);",
  "}",
].join("\n");

const WITHOUT_SYMBOL = [
  "// a file",
  "export function somethingElse(t) {",
  "  return String(t);",
  "}",
].join("\n");

test("PLANT — the symbol MOVES within its file and the citation still resolves", () => {
  // 40 lines inserted above the declaration. A line citation is now 40 lines stale and, on this repo's
  // measured rate, would be pointing at real unrelated code and reading as correct.
  const text = "why: the axis is normalised by coerceAxisToken() in target.mjs before the join";
  for (const [where, body] of [["at the top", WITH_SYMBOL_EARLY], ["40 lines down", WITH_SYMBOL_MOVED]]) {
    const h = harness(body);
    const cites = cite(text, h);
    assert.equal(cites.length, 1, `the citation must be found with the symbol ${where}`);
    assert.deepEqual(symbolCitationMisses(cites, h.readLines), [],
      `a symbol ${where} must still resolve — surviving the move is the whole property`);
  }
});

test("PLANT — the symbol is DELETED and the citation fails, in the commit that deleted it", () => {
  const text = "why: the axis is normalised by coerceAxisToken() in target.mjs before the join";
  const h = harness(WITHOUT_SYMBOL);
  const cites = cite(text, h);
  assert.equal(cites.length, 1);
  const misses = symbolCitationMisses(cites, h.readLines);
  assert.equal(misses.length, 1, "a deleted symbol must FAIL — a line citation would have survived it, "
    + "pointing at whatever code moved into the vacated line");
  assert.equal(misses[0].symbol, "coerceAxisToken");
});

test("both spellings are read, and only those two", () => {
  const h = harness([WITH_SYMBOL_EARLY, "export const AXIS_FLOOR = 3;"].join("\n"));
  assert.equal(cite("normalised by coerceAxisToken() in target.mjs", h).length, 1, "the () form");
  assert.equal(cite("the AXIS_FLOOR declared in target.mjs", h).length, 1, "the `declared in` form");
  assert.deepEqual(symbolCitationMisses(cite("the AXIS_FLOOR declared in target.mjs", h), h.readLines), []);
});

test("ORDINARY PROSE IS NOT A CITATION — every one of these was a measured false positive", () => {
  // The first cut accepted a backticked token before `in <file>`. This repo backticks every code-ish
  // span, so backticks carry no intent, and four pieces of prose read as citations. The second cut
  // accepted any word before `declared in`, and English puts "is" there — three more. Both classes are
  // pinned here by the exact text that produced them, not by a paraphrase — with ONE substitution,
  // named so nobody reads the list as untouched: the first row's variable was measured under its
  // pre-sweep spelling, which retired. It carries the live name now — written out
  // rather than the dead one, because a dead name in new code is a defect however it is framed. The
  // SHAPE is what these rows pin, and the shape is unchanged.
  const h = harness(WITH_SYMBOL_EARLY);
  const PROSE = [
    "`CLEAROTRON_DATABASE` in target.mjs is read at dispatch",   // an env var READ there, never declared
    "`contractElements` in target.mjs carries the rows",              // an object key, not a declaration
    "the field in target.mjs holds it",                               // plain English
    "the value is declared in target.mjs somewhere",                  // "is" before `declared in`
    "this is no longer in target.mjs",                                // "longer" before `in`
    "as in target.mjs, the shape is fixed",                           // "as" before `in`
  ];
  for (const p of PROSE) {
    assert.deepEqual(cite(p, h), [],
      `read as a citation and it is prose — a gate that flags prose gets switched off:\n    ${p}`);
  }
});

test("the shape test is what drops the prose, and it drops exactly the prose words", () => {
  // The discriminator, driven directly, so a change to SYMBOLIC that quietly admits English shows up
  // here rather than as a wave of false positives in the gate.
  for (const t of ["coerceAxisToken", "AXIS_FLOOR", "ElementKinds", "_private"]) assert.ok(SYMBOLIC(t), t);
  for (const t of ["is", "as", "longer", "field", "value", "in"]) assert.ok(!SYMBOLIC(t), t);
});

test("a NON-CODE target is not matched at all — that is the declared policy, not a gap", () => {
  // 7 of the doubt ledger's 81 citations point at `.md` files, which have no symbols to name. They stay
  // line-form and the blank-target arm keeps watching them. Inventing a heading-anchor scheme would put
  // TWO citation schemes in one table, which is how the first one stops being read.
  const h = harness(WITH_SYMBOL_EARLY);
  assert.deepEqual(cite("the shape is set by coerceAxisToken() in digest.md", h), [],
    "a .md target has nothing to resolve, so the symbol form must not pretend to check it");
  assert.deepEqual(cite("the shape is set by coerceAxisToken() in schema.json", h), []);
});

test("an unresolvable cited file is left to the arms that own it — one defect, one report", () => {
  // Reporting a missing file here as well as in the dangling arm would make one defect look like two,
  // and the second report would name the wrong remedy.
  const h = harness(WITH_SYMBOL_EARLY);
  const cites = symbolCitationsIn([{ file: "driver/stages.mjs", text: "by coerceAxisToken() in nowhere.mjs" }], h.byBase);
  assert.equal(cites.length, 1, "it is still READ, so the dangling arm can report it");
  assert.deepEqual(symbolCitationMisses(cites, h.readLines), [],
    "but it is not a symbol miss — the file, not the symbol, is what is wrong");
});

test("the gate FAILS on a symbol miss — the check is wired to the exit code, not merely printed", () => {
  // A finding that prints and exits 0 is a finding nobody acts on. Measured on this repo more than once.
  const src = readFileSync(new URL("../../scripts/citation-line-check.mjs", import.meta.url), "utf8");
  const code = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
  assert.ok(code.length > 300, `the comment strip left ${code.length} lines — it removed too much to prove anything`);
  const exits = code.filter((l) => /process\.exit\(/.test(l) || /\|\| symbolGone\.length/.test(l));
  assert.ok(exits.some((l) => /symbolGone\.length/.test(l)),
    "symbolGone must appear in the exit-code expression, in both the --json and the printed path");
  assert.equal(code.filter((l) => /symbolGone\.length \|\|/.test(l)).length, 2,
    "both exit paths, or the JSON caller and the human caller disagree about whether the tree is clean");
});
