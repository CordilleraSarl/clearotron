// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// owner-descriptor-claims-only-what-it-observes.test.mjs —, the annotation half.
//
// The bare-owner portfolio descriptor said "this owner is answered record-by-record by the owner×term
// slice(s) …". `covered_by` is stamped at PLAN COMPILE time and names the slices DICTATED for that
// owner — it says nothing about whether they enumerated. Measured across a delivered round: the claim
// held for 4 of 14 owners and was false for 10, covering 39,302 hits — 31% of the untraced total, and
// the largest single class in the artifact.
//
// AND THE ARM THAT SHOULD HAVE CAUGHT IT ASSERTED A FIXTURE. The first pass carried a truncated
// copy of the sentence in its own test data, ending at "never coverage" — the half that is true. The
// producer kept the full claim. Both looked right; nothing compared them. This file reads the exported
// builder the producer itself calls, which is why the divergence cannot recur: there is one string now,
// and the last arm here fails if anyone inlines a second one.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const PRODUCER_URL = new URL("../../providers/_shared/execute-plan.mjs", import.meta.url);
const PRODUCER = readFileSync(PRODUCER_URL, "utf8");

// THE PRODUCER'S SENTENCE, however the producer currently spells it. Imported when the builder exists;
// otherwise reconstructed from the inline template the pre- producer used. Deliberately NOT a
// static import of the new export: this file must LOAD against the old tree, or the revert check
// reports one dead file instead of which arms discriminate — and the whole point of this test is that
// it reads the product rather than something the test made up.
const mod = await import(PRODUCER_URL.href);
const build = mod.ownerPortfolioDescriptorReason ?? ((coveredBy) => {
  // Mirrors the pre- ternary exactly, INCLUDING its bare branch — otherwise the control arm below
  // reds against the old tree for a defect in this fallback rather than a difference in the product.
  if (!coveredBy?.length) return "count-only crowd descriptor (plan-dictated)";
  const m = PRODUCER.match(/`count-only owner-portfolio descriptor[^`]*`/);
  return m ? m[0].slice(1, -1).replace(/\$\{coveredBy\.join\(", "\)\}/g, coveredBy.join(", ")) : "";
});
const WITH = build(["incumbent-class:owner:verrit-instruments-ltd+watch", "b:2"]);

test("#1424 the descriptor no longer asserts the owner IS answered", () => {
  // The exact claim, and it must be gone from the PRODUCT's string rather than from a fixture's.
  assert.equal(/is answered record-by-record/.test(WITH), false,
    `the producer still asserts coverage it cannot observe:\n  ${WITH}`);
  // Nor any softer form of the same assertion.
  for (const claim of [/\bis covered by\b/i, /\bhas been enumerated\b/i, /\bwas answered\b/i]) {
    assert.equal(claim.test(WITH), false, `${claim} is the same claim in other words`);
  }
});

test("#1424 it still points at the slices — the useful half survives", () => {
  // Dropping the pointer would be the opposite failure: a reader told the number is not coverage and
  // not told where coverage would be has nowhere to go, and "portfolio too large, noted" grows back.
  assert.match(WITH, /incumbent-class:owner:verrit-instruments-ltd\+watch/);
  assert.match(WITH, /b:2/);
  assert.match(WITH, /CROWD CONTEXT, never coverage/);
  assert.match(WITH, /"Portfolio too large, noted" is not a finding/);
});

test("#1424 and it says whose job it is to check they landed", () => {
  // The replacement claim has to be actionable, not merely weaker. A reader must know that the slice's
  // own state is the thing to read, and that a dictated slice can itself fail.
  assert.match(WITH, /SOUGHT/);
  assert.match(WITH, /THEIR state to read/);
  assert.match(WITH, /crowd, deferred or errored/,
    "the reader must be told the pointed-at slice can itself come back unusable");
});

test("#1424 the bare descriptor — no covered_by — is unchanged", () => {
  // THE CONTROL. Most count-only slices carry no owner pointer at all, and their sentence must not
  // have moved: this change is scoped to the class that made the unbacked claim.
  assert.equal(build(null), "count-only crowd descriptor (plan-dictated)");
  assert.equal(build([]), "count-only crowd descriptor (plan-dictated)");
});

test("#1424 ONE string — the producer builds it here and nowhere else", () => {
  // The arm that closes the failure mode this file exists for. A second inline copy is how the last one
  // drifted from its test, so the literal must appear only inside the exported builder.
  const inlined = PRODUCER.split("\n")
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => /count-only owner-portfolio descriptor/.test(l));
  assert.equal(inlined.length, 1,
    `the descriptor sentence appears at ${inlined.length} sites — a second copy is how the fixture and the producer diverged:\n  `
    + inlined.map(([n, l]) => `${n}: ${l.trim().slice(0, 70)}`).join("\n  "));
  // …and the call site reads the helper rather than restating it.
  assert.match(PRODUCER, /descriptorReason = ownerPortfolioDescriptorReason\(coveredBy\)/);
});
