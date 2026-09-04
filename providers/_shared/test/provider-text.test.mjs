// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — the provider's refusal was cut three characters before the word that classifies it.

import test from "node:test";
import assert from "node:assert/strict";

import { clipProviderText, ELISION } from "../provider-text.mjs";

// The string from the delivered run, verbatim. 144 characters; `allowed` starts at 137.
const REFUSAL = "HTTP 500: INTERNAL_SERVER_ERROR - Count Failed - IL - Near/Adj queries with sub "
  + "queries that can return a huge amount of results are not allowed";

// 's predicate, copied here rather than imported: this is a PROVIDER-side module and the driver is
// not on its import path. Kept byte-identical to driver/repairs.mjs on purpose — if the two ever
// diverge, this test is the place that says so, because its whole subject is the two agreeing.
const STRUCTURAL = /\b(?:are|is)\s+not\s+allowed\b/i;
const TRANSIENT = /\bhttp\s?5\d\d\b/i;

test("#1126 THE DEFECT, IN ONE ASSERTION: the old head-clip severs the discriminator", () => {
  const severed = REFUSAL.slice(0, 140);
  assert.equal(severed.endsWith("are not all"), true, "140 lands three characters short of `allowed`");
  assert.equal(STRUCTURAL.test(severed), false, "so #960's structural predicate cannot fire…");
  assert.equal(TRANSIENT.test(severed), true, "…and `HTTP 500` makes it read as weather instead");
});

test("#1126 the tail-preserving clip keeps the word the classifier needs", () => {
  const kept = clipProviderText(REFUSAL, 140);
  assert.ok(kept.length <= 140, `the budget is a real bound: ${kept.length}`);
  assert.equal(STRUCTURAL.test(kept), true, "`are not allowed` survives the clip");
  assert.ok(kept.startsWith("HTTP 500:"), "and the status at the front survives too — a reader needs both");
  assert.ok(kept.includes(ELISION), "the cut is MARKED; a silently shortened record is the whole bug");
});

test("#1126 at the shipped budget the refusal is not clipped at all", () => {
  // The clip is the floor, not the plan. 400 is what enumerate.mjs now passes, and the point of raising
  // it is that the ordinary case stops being a reconstruction.
  assert.equal(clipProviderText(REFUSAL, 400), REFUSAL);
  assert.equal(clipProviderText(REFUSAL, 400).includes(ELISION), false, "nothing that fits is ever marked");
});

test("#1126 a message that fits comes back byte-identical, whatever its length", () => {
  for (const s of ["", "short", "x".repeat(139), "x".repeat(140)]) {
    assert.equal(clipProviderText(s, 140), s);
  }
});

test("#1126 the budget holds at every length, and the tail is always the input's tail", () => {
  const long = "HEAD-" + "m".repeat(500) + "-TAILWORD";
  for (const budget of [20, 40, 140, 240, 400]) {
    const out = clipProviderText(long, budget);
    assert.ok(out.length <= budget, `budget ${budget} exceeded: ${out.length}`);
    assert.ok(long.endsWith(out.slice(out.indexOf(ELISION) + ELISION.length)),
      `budget ${budget}: the kept tail must be a real suffix of the input, not a rewrite`);
  }
  assert.ok(clipProviderText(long, 240).endsWith("TAILWORD"), "the discriminator is the last thing dropped");
});

test("#1126 degenerate budgets do not produce something that is mostly ellipsis", () => {
  assert.equal(clipProviderText("abcdefgh", 0), "");
  assert.equal(clipProviderText("abcdefgh", -5), "");
  // At or below elision + 2 there is no useful middle to cut, so it degrades to a head clip rather than
  // emitting a token whose only content is the mark.
  assert.equal(clipProviderText("abcdefgh", 3), "abc");
  assert.equal(clipProviderText(null, 10), "");
  assert.equal(clipProviderText(undefined, 10), "");
});
