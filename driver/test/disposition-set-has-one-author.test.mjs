// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — THE CLOSED DISPOSITION SET HAS ONE AUTHOR, AND THE DICTATION IS NOT A SECOND ONE.
//
// `findings-model.mjs` declares the five dispositions and the four that must carry both positions. A
// dictation that hand-lists them is a second author of a closed set: retire a token there and the
// dictation keeps teaching it; add one and the dictation silently omits it. The sentence stays
// grammatical either way — it just describes a contract the code no longer has.
//
// ── WHAT THE MEASUREMENT ACTUALLY SAID, INCLUDING WHERE IT CORRECTED ME ─────────────────────────────
//
// I recommended registering an E12 contract at the tightest boundary — all five tokens in one served
// unit — on the basis that its three hits were "all real restatements". Re-measured against main, that
// was wrong, and the correction is why this file guards a property instead of registering a contract:
//
//   · driver/gateway.mjs               a genuine hand-typed restatement.   ← the only true positive
//   · synthesis-rules.md               a SKILL the model reads; it must state the set in prose, and it
//                                      is already bound by a set-equality test (PR).
//   · driver/stages.mjs                CORRECT CODE. It renders the list from the constant —
//                                      `${POSITION_REQUIRED_DISPOSITIONS.join(" / ")}` — and fires only
//                                      because `servedUnits` STRIPS INTERPOLATION before a contract sees
//                                      the text. The derived list is gone from the unit; what trips the
//                                      boundary is the prose gloss further down the same string.
//
// So one of three hits is a defect, one is covered elsewhere, and one is a FALSE POSITIVE ON CORRECT
// CODE. Registering the contract would turn E12 red on a site that is doing the right thing, and the
// only way to green it would be an exemption — which the registry forbids by name ("no hand-maintained
// pair list, or it rots exactly the way the instances did").
//
// THE PREREQUISITE IS REAL AND UNRESOLVED: a contract cannot ask "did this site derive the set or retype
// it?" while the shared unit splitter erases the interpolation that answers it. Changing `servedUnits`
// is a change every other contract reads, and it is not being made in passing.
//
// What IS buildable today is the fix plus this guard: the one true restatement now derives, and the
// property is asserted where behaviour cannot reach it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DISPOSITIONS, POSITION_REQUIRED_DISPOSITIONS } from "../findings-model.mjs";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const gateway = readFileSync(join(DRIVER, "gateway.mjs"), "utf8");

test("#1011 the v6 dictation derives its set from the constant, and does not retype it", () => {
  assert.match(gateway, /POSITION_REQUIRED_DISPOSITIONS\.join\(", "\)/,
    "the v6 sentence stopped deriving the set — it is a second author of a closed set again");
  assert.match(gateway, /DISPOSITIONS\.filter\(\(d\) => !POSITION_REQUIRED_DISPOSITIONS\.includes\(d\)\)/,
    "the parenthetical stopped computing the complement. Restating which token is the odd one out is the "
    + "same defect in the same sentence, one clause over");
  // The retired literal must not come back beside the derivation — that is how a "helpful" edit
  // reintroduces the second author while the derivation sits there looking correct.
  assert.ok(!/adversarial, coexistence-partner, distinguished AND off-field/.test(gateway),
    "the hand-typed list is back in gateway.mjs");
});

test("#1011 the derived sentence is BYTE-IDENTICAL to the literal it replaced", () => {
  // Dispatch wording is not free to tidy in passing: measured a field phrased outside its own
  // imperative written 0 of 9 times, against 74 of 74 when it was inside one. So the join restores the
  // conjunction rather than settling for the comma `Array.join` produces, and this is the proof.
  const derived = `${POSITION_REQUIRED_DISPOSITIONS.join(", ").replace(/, ([^,]+)$/, " AND $1")} alike `
    + `(only a review-killed ${DISPOSITIONS.filter((d) => !POSITION_REQUIRED_DISPOSITIONS.includes(d))
      .map((d) => `"${d}"`).join(" / ")} finding is `;
  assert.equal(derived,
    'adversarial, coexistence-partner, distinguished AND off-field alike (only a review-killed "withdrawn" finding is ',
    "the derivation no longer reproduces the dictation the engine has always sent — the model is being "
    + "told something new, which is a change to make deliberately or not at all");
});

test("#1011 the complement is exactly one token, which is the premise the sentence is built on", () => {
  // "only a review-killed X" is singular by construction. If a second non-position disposition is ever
  // added, the derivation still renders (`"a" / "b"`) but the surrounding sentence reads wrong — so the
  // premise is asserted here rather than discovered in a delivered dispatch.
  const complement = DISPOSITIONS.filter((d) => !POSITION_REQUIRED_DISPOSITIONS.includes(d));
  assert.deepEqual(complement, ["withdrawn"],
    "the set of dispositions outside the v6 position contract is no longer just `withdrawn`. The gateway "
    + "sentence says 'only a review-killed …', which is singular — re-read it before adding a token here.");
});

test("#1011 the derived site in stages.mjs is left alone, and the reason is recorded", () => {
  // The false positive. It is correct code, and a sweep that "fixed" it would be rewriting a derivation
  // into… a derivation, on the say-so of a checker that cannot see interpolation.
  const stages = readFileSync(join(DRIVER, "stages.mjs"), "utf8");
  assert.match(stages, /POSITION_REQUIRED_DISPOSITIONS\.join\(" \/ "\)/,
    "stages.mjs stopped deriving its disposition list — that site was the one already doing this right");
});
