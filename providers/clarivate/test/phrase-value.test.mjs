// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// compilePhraseValue — the exact value string this provider is sent for a multi-word term.
//
// THERE WAS NO TEST ON THIS FUNCTION AT ALL, in either direction, and that is how a rule written for
// one end of a phrase went years without its mirror at the other. A family search on a root whose last
// word is one character — a sequel number, an article, an initial — compiled to `*PLAN ADJ B*`, and
// that trailing `B*` is a sub-query over most of the register: the provider answers HTTP 500 rather
// than a count. On a delivered matter every attempt at that search was refused, the refusal was
// retried as though it were an outage, and a family of pending third-party filings went unseen.
//
// The provider refuses the wrapped form and answers the unwrapped one, at both ends of the phrase; the
// same is already true of the leading rule this mirrors. The round that established that, and the figures
// it returned, are on the tracker rather than here — this file publishes.
//
// ASSERTED AS EXACT STRINGS, not as "contains no trailing star". The value is the query; a test that
// checked a property of it would pass on a string that searches something else.
import { test } from "node:test";
import assert from "node:assert/strict";

import { compilePhraseValue, MATCH_MODE_TO_FIELD } from "../src/core.js";

// THE MODES COME FROM THE TABLE THE PROVIDER ACTUALLY SENDS, never retyped here. A copy would agree
// with it on the day it was written and drift afterwards, and these arms would then keep passing while
// describing a query nothing sends — which is the failure this whole file exists to catch, one layer up.
const DEFAULT_MODE = MATCH_MODE_TO_FIELD.default;
const STARTS_WITH = MATCH_MODE_TO_FIELD.starts_with;
const ENDS_WITH = MATCH_MODE_TO_FIELD.ends_with;
const WILDCARD = MATCH_MODE_TO_FIELD.wildcard;

test("a one-character LAST word loses the trailing wrap — the shape the provider refuses is not sent", () => {
  assert.equal(compilePhraseValue("PLAN B", DEFAULT_MODE), "*PLAN ADJ B");
  assert.equal(compilePhraseValue("LEVEL 2", DEFAULT_MODE), "*LEVEL ADJ 2");
  assert.equal(compilePhraseValue("ROB A", DEFAULT_MODE), "*ROB ADJ A");
  // BOTH ENDS AT ONCE is a real root shape, and neither rule may cancel the other.
  assert.equal(compilePhraseValue("A B", DEFAULT_MODE), "A ADJ B");
});

test("the leading rule is unchanged, and a one-character MIDDLE word is untouched", () => {
  // The mirror that already existed. Pinned here because this file is where somebody will come to
  // change one of the two, and a pair of rules with only one of them tested is how this defect began.
  assert.equal(compilePhraseValue("A MOB", DEFAULT_MODE), "A ADJ MOB*");
  // MIDDLE TOKENS ARE NOT THIS. A one-character word inside the chain is not a sub-query at either
  // boundary — the main sweep carrying one ran fine — so the wraps stay exactly where they were.
  assert.equal(compilePhraseValue("STEAL A MOB", DEFAULT_MODE), "*STEAL ADJ A ADJ MOB*");
  assert.equal(compilePhraseValue("STEAL A MOB 2", DEFAULT_MODE), "*STEAL ADJ A ADJ MOB ADJ 2");
});

test("an ordinary multi-word term is compiled exactly as before", () => {
  // THE CONTROL, and it is the half that says the fix is a subtraction rather than a narrowing: a term
  // with no one-character word at either end must be byte-identical to what this provider has always
  // been sent, or the change costs recall on every search that was working.
  assert.equal(compilePhraseValue("MOB SQUAD", DEFAULT_MODE), "*MOB ADJ SQUAD*");
  assert.equal(compilePhraseValue("BLACK AND DECKER", DEFAULT_MODE), "*BLACK ADJ2 DECKER*");
  assert.equal(compilePhraseValue("SOLO", DEFAULT_MODE), "*SOLO*", "a single token is not a phrase and keeps both wraps");
});

test("the rule follows the wrap, not the predicate name: begins-with and ends-with each lose only their own", () => {
  assert.equal(compilePhraseValue("PLAN B", STARTS_WITH), "PLAN ADJ B", "the only wrap it has is the one that would be refused");
  assert.equal(compilePhraseValue("MOB SQUAD", STARTS_WITH), "MOB ADJ SQUAD*");
  // ends_with wraps at the FRONT, so a one-character last word costs it nothing — its wrap is not on
  // that token. The leading rule still applies to it, as it always did.
  assert.equal(compilePhraseValue("PLAN B", ENDS_WITH), "*PLAN ADJ B");
  assert.equal(compilePhraseValue("A MOB", ENDS_WITH), "A ADJ MOB");
});

test("the wildcard predicate carries its own star, and it comes off the same one-character token", () => {
  // On this predicate the caller writes the metacharacters, so `post` is empty and the two wrap rules
  // cannot reach the star at all — it is part of the token. Same shape reaching the provider, same
  // refusal, so the same subtraction.
  assert.equal(compilePhraseValue("STEAL A*", WILDCARD), "STEAL ADJ A");
  // AND NOTHING ELSE IS TOUCHED. A longer final token keeps the caller's pattern exactly as written —
  // this is not the compiler deciding what a caller meant.
  assert.equal(compilePhraseValue("STEAL AB*", WILDCARD), "STEAL ADJ AB*");
  assert.equal(compilePhraseValue("STEAL A?", WILDCARD), "STEAL ADJ A?",
    "a `?` matches one character rather than opening a sub-query, so it is not this defect");
});

test("the wraps these arms are written against are the ones the table carries", () => {
  // THE PREMISE, ASSERTED. Every string above is what the compiler produces given a particular pair of
  // wraps; if a mode's wrap moved, those strings would still be produced by this test's inputs and the
  // file would go on passing about a query nothing sends. This is the line that reds instead.
  assert.deepEqual({ pre: DEFAULT_MODE.pre, post: DEFAULT_MODE.post }, { pre: "*", post: "*" });
  assert.deepEqual({ pre: STARTS_WITH.pre, post: STARTS_WITH.post }, { pre: "", post: "*" });
  assert.deepEqual({ pre: ENDS_WITH.pre, post: ENDS_WITH.post }, { pre: "*", post: "" });
  assert.deepEqual({ pre: WILDCARD.pre, post: WILDCARD.post }, { pre: "", post: "" });
  assert.equal(DEFAULT_MODE.dropReserved, true, "the ADJ chain drops operator words on this mode");
  assert.equal(WILDCARD.allowWildcard, true, "and the wildcard mode is the one that lets a star through at all");
});
