// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-refusal-is-not-a-pass.test.mjs — pins the one line that says whether the order was delivered.
//
// Owner's rule, 2026-08-25: A REFUSAL AFTER MODEL WORK IS NEVER REPORTED AS A PASS.
//
// The defect this closes is not missing information. `state=failed` was always printed. It was printed
// BESIDE the verdict, on one line, in a form whose last word is the wrong one:
//
//     state=failed verdict=CONDITIONAL sendPending=undefined
//
// Five R2 rounds in the seven days to 2026-08-25 refused at the verdict stage, each having written a
// complete narrative and all thirteen report cards first. A refused run therefore has every artifact a
// delivered one has, and a reader who skims to the verdict — or, in the scorer, to the buckets — reads
// unsigned prose as a shipped report.
//
// The fixtures are real shapes, taken from two R2 rounds a day apart: the 2026-08-25 round that refused
// at the verdict stage, and the 2026-08-24 round that delivered. The rounds are not named here — a
// run codename is indistinguishable from a production one, and `no-client-identifiers` refuses them
// in the corpus for exactly that reason.

import { test } from "node:test";
import assert from "node:assert/strict";
import { deliveryLine } from "../../scripts/e2e.mjs";

// The refusal, verbatim shape: it reached a CONDITIONAL verdict and then refused to sign.
const REFUSED = { state: "failed", verdict: "CONDITIONAL", failedStage: "verdict", deliveredAt: null };
// The delivered round.
const DELIVERED = { state: "delivered", verdict: "CONDITIONAL", deliveredAt: "2026-08-24T14:40:39.851Z" };

test("a delivered run says so, with the timestamp that proves it settled", () => {
  const line = deliveryLine(DELIVERED);
  assert.match(line, /^DELIVERED — 2026-08-24T14:40:39\.851Z$/);
});

test("A REFUSAL AFTER MODEL WORK SAYS SO BEFORE ANYTHING ELSE", () => {
  const line = deliveryLine(REFUSED);
  assert.match(line, /^NOT DELIVERED — THE ORDER WAS REFUSED\./,
    "the first words a reader sees must be the delivery answer, not the verdict");
  assert.match(line, /at verdict/, "it names the stage that refused");
  assert.doesNotMatch(line, /CONDITIONAL/,
    "the verdict of a report nobody signed must not appear on the line that answers 'was this delivered'");
});

// ── the two ways `state` and `deliveredAt` disagree, and both must read as NOT delivered ─────────────

test("`state: delivered` with NO deliveredAt is NOT delivered — reaching the contract is not settling in it", () => {
  const line = deliveryLine({ state: "delivered", deliveredAt: null });
  assert.match(line, /^NOT DELIVERED/);
  assert.match(line, /never settled into delivery/);
});

test("a deliveredAt on a run whose state is not delivered does not rescue it", () => {
  const line = deliveryLine({ state: "failed", deliveredAt: "2026-08-25T03:16:00.000Z" });
  assert.match(line, /^NOT DELIVERED — THE ORDER WAS REFUSED\./);
});

// ── an absent status is an absence, never a pass ─────────────────────────────────────────────────────

test("no status at all reads as NOT DELIVERED, not as unknown-therefore-fine", () => {
  for (const st of [null, undefined, {}]) {
    const line = deliveryLine(st);
    assert.match(line, /^NOT DELIVERED — THE ORDER WAS REFUSED\./,
      `${JSON.stringify(st)} must not be able to read as delivered`);
  }
});

test("a cancelled or in-flight run is NOT DELIVERED and keeps its own word", () => {
  for (const state of ["cancelled", "running", "clarify"]) {
    const line = deliveryLine({ state, deliveredAt: null });
    assert.match(line, /^NOT DELIVERED/);
    assert.match(line, new RegExp(`state=${state}`), "the run's own state survives into the line");
  }
});
