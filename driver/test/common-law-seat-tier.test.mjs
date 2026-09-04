// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — the meaning seat's tier, and the blast radius of moving it.
//
// RE-POINTED 2026-08-11, not rewritten. This file's original job was to prove NOTHING moved: built
// the per-seat map and deliberately did not exercise it, so every arm asserted haiku/low on all three
// seats. The tier has now moved for one seat on the round's evidence, so the arm that pinned it says
// the opposite — and every other arm is unchanged, because what they guard is unchanged.
//
// WHAT THE EVIDENCE WAS. Across six measured clearances the meaning seat never converged on attempt 1
// on haiku/low. Both candidate confounds were eliminated by shipping them: the write-mode contract
// (`cdec607`) did not close it, and 's clause split did not close it. Its ladder costs 15–28
// minutes of critical path per clearance, and the halves fan in, so on a dense matter that is the
// wave's whole wall.
//
// THE ARM THAT MATTERS IS THE BLAST RADIUS. One seat moved; the other two must not have. That is the
// property the map exists for, and it is asserted through the REAL resolution path (`chainEntries`)
// rather than by reading the constant back to itself — a test that asserts the constant equals the
// constant would pass with the resolution broken.
//
// AND ONE VARIABLE MOVED. `thinking` is `low` on all three seats, before and after. The obvious
// alternative was the sonnet/adaptive pair `axisTier` hands every non-seat axis, which moves the model
// AND the thinking budget — and a round that improves under it cannot say which one bought the
// improvement. Arm 6 pins that, because it is the difference between a measurement and an anecdote.
//
// Run:  node --test driver/test/common-law-seat-tier.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMON_LAW_SEAT_TIER, axisTier, chainEntries, assertTierSanity, STAGES } from "../stages.mjs";
import { GRID_SEATS, MEANING_SEAT } from "../common-law-receipts.mjs";

test("#561 the map covers exactly the seats that exist — no seat without a tier, no tier without a seat", () => {
  assert.deepEqual(Object.keys(COMMON_LAW_SEAT_TIER).sort(), [...GRID_SEATS].sort(),
    "a seat missing from the map falls through to axisTier's SONNET default — the exact misread the old "
    + "`def.model wins over axisTier` comment was avoiding, and it would be silent");
});

// — the question opened is SETTLED and the seat is back on haiku (owner ruling, 2026-08-12).
// Measured on 857db4a: haiku converges in 2 attempts / 422.9s against sonnet's 1 attempt / 1674.2s for
// the same delivered outcome. The sonnet flip had been measured against PRE- haiku and was credited
// with a convergence actually bought.
//
// So all three seats read haiku/low again — and THE MAP STILL EARNS ITS PLACE, which is the thing this
// test now has to prove, because "every seat has the same value" is exactly when a lookup table looks
// deletable. Delete it and `axisTier` hands a seat id its SONNET/ADAPTIVE default, silently, which is
// the misread the map was built to make impossible.
test("#754 every seat is haiku/low — and the map is still what makes that true, not axisTier", () => {
  // chainEntries is what stageWithChain actually calls, so this exercises def → axisTier → thinkingFor
  // rather than reading the constant back.
  assert.deepEqual(chainEntries("common-law-half", MEANING_SEAT), [{ model: "haiku", thinking: "low" }],
    "the meaning seat is the one that moved");
  assert.deepEqual(axisTier("primary-sweep"), { model: "sonnet", thinking: "adaptive" },
    "axisTier's default is still sonnet/adaptive — so a seat that fell through the map would NOT read haiku, "
    + "and this test would catch the map being dropped as redundant");
  for (const seat of GRID_SEATS.filter((s) => s !== MEANING_SEAT))
    assert.deepEqual(chainEntries("common-law-half", seat), [{ model: "haiku", thinking: "low" }],
      `seat ${seat} must be byte-identical to the tier it had before the map existed — a grid half does a `
      + "term × platform sweep and nothing about that job changed");
});

test("#561 ONE VARIABLE moved — the thinking budget is identical across all three seats", () => {
  // The attribution property. If a round improves and `thinking` also moved, the round has measured two
  // changes and can attribute neither. sonnet/adaptive — axisTier's own default for every non-seat axis,
  // and the value the A/B's illustration used — is exactly that mistake, which is why it is not shipped.
  const thinking = GRID_SEATS.map((s) => chainEntries("common-law-half", s)[0].thinking);
  assert.deepEqual([...new Set(thinking)], ["low"],
    `every seat must still think at the same budget (got ${JSON.stringify(thinking)})`);
});

test("#561 the static tier is GONE from the stage def, or the map is dead", () => {
  // A static def.model wins over axisTier in stageOnce (`opts.model ?? def.model ?? tier.model`), so a
  // leftover pair here would leave the map looking authoritative and doing nothing — the failure mode
  // where the next round flips a value and measures no change.
  assert.equal(STAGES["common-law-half"].model, undefined,
    "def.model would out-rank the per-seat map");
  assert.equal(STAGES["common-law-half"].thinking, undefined);
  // The wall and the stall stay on the def: they are the same for every seat and are about the grid
  // tool's silence, not about the judgment tier.
  assert.equal(STAGES["common-law-half"].timeoutSec, 2250);
  assert.equal(STAGES["common-law-half"].stallSec, 1100);
});

test("#754 the move is REVERSIBLE by the same one-line edit, and still moves only that seat", () => {
  // The rollback, proven rather than assumed. inverts the DIRECTION — the seat is haiku now, so the
  // rollback is back to sonnet — and the property is unchanged: the blast radius is one seat either way.
  // This is what makes the tier a value and not a feature gate.
  const saved = { ...COMMON_LAW_SEAT_TIER[MEANING_SEAT] };
  try {
    COMMON_LAW_SEAT_TIER[MEANING_SEAT] = { model: "sonnet", thinking: "low" };
    assert.deepEqual(chainEntries("common-law-half", MEANING_SEAT), [{ model: "sonnet", thinking: "low" }]);
    for (const seat of GRID_SEATS.filter((s) => s !== MEANING_SEAT))
      assert.deepEqual(chainEntries("common-law-half", seat), [{ model: "haiku", thinking: "low" }],
        `rolling the meaning seat back must not move ${seat} — that is the whole point of a per-seat tier`);
  } finally { COMMON_LAW_SEAT_TIER[MEANING_SEAT] = saved; }
  // and restored to the shipped default
  assert.deepEqual(chainEntries("common-law-half", MEANING_SEAT), [{ model: "haiku", thinking: "low" }]);
});

test("#561 the haiku+adaptive sanity check reaches the seats — it could not before", () => {
  assert.equal(assertTierSanity(), true, "the shipped table is sane");
  // assertTierSanity's STAGES loop keys on `s.model`, which common-law-half no longer has, so without a
  // seat loop the forbidden pairing would go UNCHECKED on exactly the seats whose tier is now movable.
  const saved = { ...COMMON_LAW_SEAT_TIER[MEANING_SEAT] };
  try {
    COMMON_LAW_SEAT_TIER[MEANING_SEAT] = { model: "haiku", thinking: "adaptive" };
    assert.throws(() => assertTierSanity(), /common-law-half:m/,
      "a forbidden pairing on a seat must be caught and NAMED, not skipped because the def is empty");
  } finally { COMMON_LAW_SEAT_TIER[MEANING_SEAT] = saved; }
  assert.equal(assertTierSanity(), true);
});

test("#561 a non-seat axis is untouched — the register tiers still resolve as they did", () => {
  assert.deepEqual(axisTier("saturation-probe"), { model: "haiku", thinking: "off" });
  assert.deepEqual(axisTier("primary-sweep"), { model: "sonnet", thinking: "adaptive" });
  assert.deepEqual(axisTier("incumbent-class"), { model: "sonnet", thinking: "adaptive" });
});

// ── — THE SEAT'S MODEL IS OVERRIDABLE, SO THE QUESTION CAN BE SETTLED ───────────────────────────
//
// The tier moved to sonnet and moved what this seat is TOLD on a refusal, in the same range. So a
// first-attempt pass next round cannot be attributed to either, and the owner has withdrawn the claim
// that the tier was the cause. A one-variable run against CURRENT code settles it.
//
// The measured result is also not what the flip was bought for: on the delivered run of 2026-08-11 the
// seat converged in ONE attempt and still took 1674.2s, against 1721s over EIGHT attempts on haiku —
// the tier bought convergence, not wall. And `:a` (431.1s) and `:b` (452.9s) passed first time on the
// same haiku tier `:m` failed on, which is the strongest evidence available that the defect is
// bookkeeping rather than judgment.
test("#561 CLEAROTRON_MEANING_SEAT_MODEL moves the meaning seat, and nothing else", async () => {
  const saved = process.env.CLEAROTRON_MEANING_SEAT_MODEL;
  try {
    // — the override is now exercised with SONNET. Setting it to haiku would set the value the
    // default already has, so the assertion would pass with the override entirely disconnected. An A/B
    // knob tested at its own default is not tested.
    process.env.CLEAROTRON_MEANING_SEAT_MODEL = "sonnet";
    // re-import with a cache-busting query: the map is evaluated at module load, exactly as it is on a run
    const fresh = await import(`../stages.mjs?seat-tier=${Date.now()}`);
    assert.deepEqual(fresh.chainEntries("common-law-half", MEANING_SEAT), [{ model: "sonnet", thinking: "low" }],
      "the override reaches the REAL resolution path, not just the constant — and moves the seat OFF its default");
    for (const seat of GRID_SEATS.filter((s) => s !== MEANING_SEAT))
      assert.deepEqual(fresh.chainEntries("common-law-half", seat), [{ model: "haiku", thinking: "low" }],
        `${seat} is untouched — the override is one seat, like CLEAROTRON_SYNTHESIS_MODEL is one stage`);
    assert.equal(fresh.assertTierSanity(), true, "…and the haiku+adaptive prohibition still reaches the seats");
  } finally {
    if (saved === undefined) delete process.env.CLEAROTRON_MEANING_SEAT_MODEL; else process.env.CLEAROTRON_MEANING_SEAT_MODEL = saved;
  }
});

test("#561 UNSET is the shipped default — an A/B knob that changes the default is not one", () => {
  const saved = process.env.CLEAROTRON_MEANING_SEAT_MODEL;
  try {
    delete process.env.CLEAROTRON_MEANING_SEAT_MODEL;
    assert.deepEqual(COMMON_LAW_SEAT_TIER[MEANING_SEAT], { model: "haiku", thinking: "low" });
    assert.deepEqual(chainEntries("common-law-half", MEANING_SEAT), [{ model: "haiku", thinking: "low" }]);
  } finally { if (saved !== undefined) process.env.CLEAROTRON_MEANING_SEAT_MODEL = saved; }
});

test("#561 `thinking` is NOT overridable — two movable variables is the trap", () => {
  // The whole entry exists so a round can attribute a change to one thing. An env knob on the thinking
  // budget beside the model one would re-create the confound the sonnet/adaptive pair was rejected for.
  const src = readFileSync(new URL("../stages.mjs", import.meta.url), "utf8");
  const entry = src.slice(src.indexOf("export const COMMON_LAW_SEAT_TIER"), src.indexOf("export const COMMON_LAW_SEAT_TIER") + 400);
  assert.match(entry, /process\.env\.CLEAROTRON_MEANING_SEAT_MODEL \|\| "haiku"/);
  assert.ok(!/thinking:\s*process\.env/.test(entry), "the thinking budget stays a value, not a knob");
});
import { readFileSync } from "node:fs";
