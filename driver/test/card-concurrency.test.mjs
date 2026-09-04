// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Report-card fan-out. The cards reused the gather cap by inertia: a gather member is a long
// provider-bound sweep, a card is a short isolated turn over one finding. At 3-wide, fifteen cards are
// five serial waves.
import { test } from "node:test";
import assert from "node:assert/strict";

const saved = { card: process.env.CLEAROTRON_CARD_CONCURRENCY, gather: process.env.CLEAROTRON_GATHER_CONCURRENCY };
const reload = async () => {
  const m = await import(`../driver.config.mjs?card=${Math.random()}`);
  return m.config;
};

test("cards fan out wider than the gather members, and the two knobs are independent", async () => {
  delete process.env.CLEAROTRON_CARD_CONCURRENCY;
  delete process.env.CLEAROTRON_GATHER_CONCURRENCY;
  const c = await reload();
  assert.equal(c.cardConcurrency, 8);
  // item 26 (2026-08-01): the gather cap moved 3 → 6, and it moved for its OWN reason, not this one.
  // The A1 rationale for 3 was "raising gatherConcurrency alone does nothing while one member IS the
  // critical path"; item 25 removes that for the reopen, and the cap is the gather's MEMBER COUNT, not
  // a bigger number. moved that count to 7 (common-law × 3 — the meaning sweep has its own seat —
  // plus register-unit × 4). The independence this test is actually about is unchanged and asserted
  // below: the number tracks the members, and the cards never follow it.
  assert.equal(c.gatherConcurrency, 7, "the gather cap is the member count — see item 26 in driver.config.mjs");
  process.env.CLEAROTRON_GATHER_CONCURRENCY = "5";
  assert.equal((await reload()).cardConcurrency, 8, "moving the gather cap must not move the cards");
});

test("the card cap is overridable and can never resolve below one", async () => {
  process.env.CLEAROTRON_CARD_CONCURRENCY = "12";
  assert.equal((await reload()).cardConcurrency, 12);
  for (const bad of ["0", "-4", "not-a-number"]) {
    process.env.CLEAROTRON_CARD_CONCURRENCY = bad;
    assert.equal((await reload()).cardConcurrency, bad === "not-a-number" ? 8 : 1,
      `a cap of ${bad} must not stall the phase outright`);
  }
});

test.after(() => {
  for (const [k, v] of [["CLEAROTRON_CARD_CONCURRENCY", saved.card], ["CLEAROTRON_GATHER_CONCURRENCY", saved.gather]])
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
});
