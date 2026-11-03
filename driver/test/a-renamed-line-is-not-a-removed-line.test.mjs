// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-renamed-line-is-not-a-removed-line.test.mjs — a coverage line the corrective pass retitled as its flag asked is
// the same line, changed, in the driver's table of applied fixes; a line the pass deleted is still a removal.
//
// The table knows a coverage line by its title, so a retitled line left no line under the old key and read as
// `line-removed`, and the reviewing lawyer's open questions said "removed rather than corrected" of two lines the
// writer had answered (one test run, 2026-11-03). One of the two was also split: the writer put a second line beside
// it, so the successor is the added line that keeps the gone line's words, not merely the line in its place.
import test from "node:test";
import assert from "node:assert/strict";
import { buildCorrectionsApplied, unresolvedFlags, renamedAs, reportLines } from "../corrections-feedforward.mjs";
import { correctionTargets, deliveredOutcomes } from "../corrections-delivered.mjs";

const line = (area, note, state = "open") => ({ area, state, note });
const BEFORE = line("Registers with no goods wording held", "Seven earlier marks were set aside on their marks or fields, not because their goods were shown to be unrelated.");
const AFTER = line("Earlier marks with no goods list held", "Seven earlier marks were set aside on their marks or fields, not because their goods were shown to be unrelated.");
const OWNERS = line("Goods, status and owners on the registers", "Each register's goods, status and owner were read for every record retrieved.");
const PORTFOLIO = line("The client's own portfolio", "Searched by owner name.", "confirmed-clean");
const WEB = line("Common-law web search", "Searched.", "confirmed-clean");
const flag = { n: 17, kind: "narrative", typed: true, ordinals: null,
  text: "The coverage line for 'Registers with no goods wording held' runs 30 words, and 'Registers' is an engine word here." };
const doc = (coverage) => ({ findings: [], coverage });
const outcome = (pre, post) => buildCorrectionsApplied([flag], doc(pre), doc(post))[0];

test("a line retitled in place, as its flag asked, is changed, and is not an open question", () => {
  const row = outcome([WEB, BEFORE, PORTFOLIO], [WEB, AFTER, PORTFOLIO]);
  assert.equal(row.outcome, "line-changed", `a retitled line read as ${row.outcome}`);
  assert.deepEqual(row.removed, [], "nothing left the report");
  assert.equal(unresolvedFlags([row]).length, 0, "the lawyer's open questions would still list it");
});

test("a line the writer split keeps its successor: the added line that keeps its words", () => {
  const row = outcome([WEB, BEFORE, PORTFOLIO], [WEB, OWNERS, AFTER, PORTFOLIO]);
  assert.equal(row.outcome, "line-changed", `a line rewritten as two read as ${row.outcome}`);
});

test("a line deleted, with nothing or something unrelated in its place, is still a removal", () => {
  assert.equal(outcome([WEB, BEFORE, PORTFOLIO], [WEB, PORTFOLIO]).outcome, "line-removed", "nothing in its place");
  assert.equal(outcome([WEB, BEFORE, PORTFOLIO], [WEB, OWNERS, PORTFOLIO]).outcome, "line-removed",
    "an unrelated line added in its place is not the same line");
  const row = outcome([WEB, BEFORE, PORTFOLIO], [WEB, OWNERS, PORTFOLIO]);
  assert.deepEqual(row.removed, ['the coverage line for "Registers with no goods wording held"'], "the removal names the line");
});

test("anything ambiguous stays a removal: two gone from one gap, two successors, neighbours reordered", () => {
  const OTHER = line("Registers with no goods wording kept", "Seven earlier marks were set aside on their marks or fields.");
  // Two lines gone between the same kept neighbours: which one became the new line is not shown.
  assert.equal(outcome([WEB, BEFORE, OTHER, PORTFOLIO], [WEB, AFTER, PORTFOLIO]).outcome, "line-removed");
  // Two added lines that both keep its words.
  const AFTER2 = line("Earlier marks with no goods wording", AFTER.note);
  assert.equal(outcome([WEB, BEFORE, PORTFOLIO], [WEB, AFTER, AFTER2, PORTFOLIO]).outcome, "line-removed");
  // The kept neighbours swapped places: there is no gap to have been renamed in.
  assert.equal(outcome([WEB, BEFORE, PORTFOLIO], [PORTFOLIO, AFTER, WEB]).outcome, "line-removed");
});

test("the mark assessment's reads are never renamed", () => {
  const pre = reportLines({ markAssessment: { distinctiveness: "The mark is inherently distinctive for these goods." } });
  const post = reportLines({ markAssessment: { connotation: "The mark is inherently distinctive for these goods." } });
  assert.equal(renamedAs(pre[0], pre, post), null);
});

test("the delivery check follows a renamed line to its new title", () => {
  const pre = doc([WEB, BEFORE, PORTFOLIO]), post = doc([WEB, AFTER, PORTFOLIO]);
  const applied = buildCorrectionsApplied([flag], pre, post);
  const basis = correctionTargets(applied, pre, post);
  assert.equal(basis[0].changes.length, 1, "the renamed line's text was not collected");
  assert.equal(basis[0].changes[0].line, "coverage:earlier marks with no goods list held");
  assert.equal(deliveredOutcomes({ basis, deliveredDoc: post })[0].outcome, "delivered");
  assert.equal(deliveredOutcomes({ basis, deliveredDoc: pre })[0].outcome, "not-found", "a record without the new line does not deliver it");
});
