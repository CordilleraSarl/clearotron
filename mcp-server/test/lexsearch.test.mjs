// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Lexsearch unit tests — the word-based search that fixes the cited multi-word miss. Pure lib (no fixture).

import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize, scoreLine } from "../lib/lexsearch.mjs";

test("tokenize splits, lowercases, dedupes", () => {
  assert.deepEqual(tokenize("MYRKUR similar mark conflict"), ["myrkur", "similar", "mark", "conflict"]);
  assert.deepEqual(tokenize("ACME, ACME!"), ["acme"]);
  assert.deepEqual(tokenize(""), []);
});

test("mode 'all': every token must appear, order-independent — fixes the cited multi-word miss", () => {
  const line = "the myrkur mark presents a similar prior registration; treat as a mark conflict.";
  const tokens = tokenize("MYRKUR similar mark conflict");
  assert.ok(scoreLine(line, tokens, "all") > 0, "all four words present (scattered) → matches");
  assert.equal(scoreLine("an unrelated line about acme", tokens, "all"), 0);
});

test("mode 'phrase': old whole-substring behaviour reproduces the cited failure", () => {
  const line = "the myrkur mark presents a similar prior registration; treat as a mark conflict.";
  const tokens = tokenize("MYRKUR similar mark conflict");
  assert.equal(scoreLine(line, tokens, "phrase", "myrkur similar mark conflict"), 0, "exact phrase absent → 0 (as before)");
  assert.equal(scoreLine(line, tokenize("myrkur"), "phrase", "myrkur"), 1, "but a bare word is present");
});

test("mode 'any': scores by how many tokens matched (ranking)", () => {
  const tokens = tokenize("MYRKUR similar mark conflict");
  assert.equal(scoreLine("myrkur and conflict only", tokens, "any"), 2);
  assert.equal(scoreLine("nothing relevant here", tokens, "any"), 0);
});

test("empty query never matches (non-phrase)", () => {
  assert.equal(scoreLine("any line at all", tokenize(""), "all"), 0);
  assert.equal(scoreLine("any line at all", tokenize(""), "any"), 0);
});
