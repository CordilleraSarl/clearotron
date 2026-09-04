// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — A QUERY BUILT FROM NOTHING. On one measured run the engine built an applicant-name query that was
// A SINGLE PERIOD, dispatched it, and took two HTTP 400 APPLICANT_NAME refusals from the provider. The
// run then did everything right: it disclosed both as coverage gaps and told the client two slices
// could not be searched. So the defect shipped as HONEST OUTPUT — better for the reader than a crash,
// and worse for anyone hoping to notice that the engine had asked a question with no possible answer.
//
// The near fix was to special-case the period. The stable one is a floor at the builder: a term with no
// letter and no digit is un-searchable under ANY predicate, and that is the one rule the deliberate
// `owner` exemption must not swallow.

import { test } from "node:test";
import assert from "node:assert/strict";

import { termSubstanceIssue, entryTermIssues } from "../../providers/_shared/term-shape.mjs";

test("THE TERM THAT SHIPPED — a single period is refused, under the predicate that let it through", () => {
  assert.ok(termSubstanceIssue("."), "a period carries nothing to match");
  assert.equal(entryTermIssues({ predicate: "owner", term: "." }).length, 1,
    "and the owner predicate, which returned before looking at any term, now sees it");
});

test("the whole degenerate family, not just the one that shipped", () => {
  // The class question, answered as a test rather than as a claim: the period was one shape of "nothing
  // in it", and a fix that only knew about periods would wait for the next one.
  for (const t of [".", "..", "-", "—", "…", "()", "[]", "/", "•", "  .  ", "·", "'", "\"\"", "?", "*"])
    assert.ok(termSubstanceIssue(t), `${JSON.stringify(t)} must be refused`);
});

test("EMPTY IS NOT THIS RULE'S BUSINESS — it belongs to the feasibility rule, as everywhere in this file", () => {
  // Deliberate: an absent term is a different defect with a different remedy, and folding the two would
  // make one message answer for both.
  assert.equal(termSubstanceIssue(""), null);
  assert.equal(termSubstanceIssue("   "), null);
  assert.equal(termSubstanceIssue(null), null);
  assert.equal(termSubstanceIssue(undefined), null);
});

test("UNICODE, NOT ASCII — the marks the jx lane exists to search must survive this floor", () => {
  // An ASCII-only test would refuse every CJK, Cyrillic and Arabic mark: the exact records R1's Chinese
  // registration and the transliteration lane are for. `\p{L}`/`\p{N}` is the difference between a floor
  // and an outage.
  for (const t of ["デルフィ", "德尔菲", "Дельфи", "دلفي", "Δελφοί", "델피", "2", "٣"])
    assert.equal(termSubstanceIssue(t), null, `${t} carries searchable content`);
});

test("a real owner name is untouched — the exemption this preserves is the point", () => {
  // The owner exemption exists because company names are legitimately long and prose-shaped, and the
  // shape rules would maul them. Substance runs first and lets every one of these through.
  for (const owner of [
    "MONSTER ENERGY COMPANY, SOCIÉTÉ ORGANISÉE SELON LES LOIS DE L ETAT DU DELAWARE",
    "Delphi Technologies (BorgWarner Inc.)",
    "QUANTALX NEUROSCIENCE LTD",
    "AKTIESELSKABET LAGERMAN, JUNR.",
  ]) assert.deepEqual(entryTermIssues({ predicate: "owner", term: owner }), [], owner);
});

test("`term_literal` DOES NOT SHIELD IT — the same reasoning that stops markup earning the stamp", () => {
  // The stamp claims "this string IS the mark, verbatim". A punctuation run cannot make that claim
  // truthfully, and a model can set the stamp itself on a supplemental proposal.
  assert.equal(entryTermIssues({ predicate: "exact", term: ".", term_literal: true }).length, 1);
});

test("a mark-shaped term still reaches the shape rules below — the floor did not swallow them", () => {
  // Guarding the guard: an early return that answered for everything would silently disable
  // markup/predicate/shape screening, which is a bigger hole than the one being closed.
  assert.equal(entryTermIssues({ predicate: "exact", term: "TIKI*" }).length, 1, "wildcard-under-literal still fires");
  assert.equal(entryTermIssues({ predicate: "wildcard", term: "VELTRI" }).length, 1, "wildcard-with-no-star still fires");
  assert.deepEqual(entryTermIssues({ predicate: "exact", term: "BIOVELTRIN" }), [], "and a plain mark passes");
});
