// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — the reconciliation ratchet: rates, floor, verdict.
//
// THE DEFECT: of 2116 retrieved common-law candidates in one round, 1609 carried no ground at
// all, and 253 of 292 candidate-bearing cells lacked the negative row the dictation owes each of them.
// The instrument was never blind — 272 rows carry `step-stated` against 1609 `absent` — so the
// classification worked and nothing compared it to anything. Third instance in one round of a
// discriminator computed correctly and never read.
//
// TWO DEGENERATE MODES WERE REFUSED BY RULING, and both are asserted here because they are what this
// design is FOR:
//
//   · a HARD gate would fire on 253 of 292 cells today — every run red, which teaches a reader that red
//     means nothing ('s entire complaint), and
//   · a bare WARNING never bites, which is decoration.
//
// So: record always, trip only against a committed floor seeded from a delivered round, and a trip
// ANNOTATES — the deliverable ships first and below-floor means the ROUND cannot claim the contract
// held, never that a client gets nothing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { reconciliationRates, reconciliationVerdict } from "../commonlaw-carry.mjs";

const FLOOR = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "commonlaw-carry-floor.json"), "utf8"));

// The delivered R1 shape, from the cell join recorded. Not invented: these are the measured
// numbers, which is what makes the floor a record of what the contract achieves.
const R1 = (over = {}) => ({
  computable: true,
  totals: { retrieved: 2116, unreasoned: 1609, cells_with_candidates: 292, cells_with_reasoned_row: 39, ...over },
});

test("#703 each rate ships the arithmetic behind it, never a bare percentage", () => {
  const r = reconciliationRates(R1());
  assert.equal(r.candidates.reconciled, 507);
  assert.equal(r.candidates.retrieved, 2116);
  assert.ok(Math.abs(r.candidates.rate - 507 / 2116) < 1e-9);
  assert.equal(r.cells.rowed, 39);
  assert.equal(r.cells.candidate_bearing, 292);
  assert.ok(Math.abs(r.cells.rate - 39 / 292) < 1e-9,
    "a floor over a rate whose numerator and denominator are not reported is a floor nobody can audit");
});

test("#703 an undefined rate is null, never 0 — a run with nothing to reconcile has not failed", () => {
  const r = reconciliationRates({ computable: true, totals: { retrieved: 0, unreasoned: 0, cells_with_candidates: 0, cells_with_reasoned_row: 0 } });
  assert.equal(r.candidates.rate, null);
  assert.equal(r.cells.rate, null);
  const v = reconciliationVerdict({ computable: true, totals: { retrieved: 0, unreasoned: 0, cells_with_candidates: 0, cells_with_reasoned_row: 0 } }, FLOOR);
  assert.equal(v.state, "at-or-above-floor", "nothing to compare is not a regression");
  assert.deepEqual(v.trips, []);
});

test("#703 THE RULING'S POINT: today's measured run sits AT the floor and does not trip", () => {
  // If this went red the gate would be the always-fires mode the ruling refused. The floor IS today's
  // number, so today's number passes — and only a regression from here trips.
  const v = reconciliationVerdict(R1(), FLOOR);
  assert.equal(v.state, "at-or-above-floor", `seeded floor must not fire on the run it was seeded from: ${JSON.stringify(v.trips)}`);
});

test("#703 …and it DOES bite: one candidate less reconciled trips the candidates arm", () => {
  // The other degenerate mode. A ratchet that cannot go red is decoration.
  const v = reconciliationVerdict(R1({ unreasoned: 1610 }), FLOOR);
  assert.equal(v.state, "below-floor");
  assert.equal(v.trips.length, 1);
  assert.equal(v.trips[0].metric, "candidates");
  assert.ok(v.trips[0].shortfall > 0);
  assert.match(v.trips[0].label, /share of retrieved candidates reconciled/);
});

test("#703 one cell less rowed trips the cells arm, independently", () => {
  const v = reconciliationVerdict(R1({ cells_with_reasoned_row: 38 }), FLOOR);
  assert.equal(v.state, "below-floor");
  assert.deepEqual(v.trips.map((t) => t.metric), ["cells"],
    "the two arms are separate: a cells regression must not hide behind a healthy candidates rate");
});

test("#703 IMPROVEMENT never trips — the ratchet only looks downward", () => {
  const v = reconciliationVerdict(R1({ unreasoned: 800, cells_with_reasoned_row: 250 }), FLOOR);
  assert.equal(v.state, "at-or-above-floor");
});

test("#703 an UNCOMPUTABLE trace is unmeasured, never below-floor", () => {
  // The absence-as-value shape this round spent the day removing: a run whose grid never parsed has no
  // measurement, and reporting "worse than floor" for a missing number invents a regression.
  const v = reconciliationVerdict({ computable: false, reason: "no common-law-grid.json on this run" }, FLOOR);
  assert.equal(v.state, "unmeasured");
  assert.match(v.reason, /no common-law-grid/);
  assert.deepEqual(v.trips, []);
});

test("#703 a missing floor is 'no-floor', not a silent pass", () => {
  const v = reconciliationVerdict(R1(), null);
  assert.equal(v.state, "no-floor");
  assert.deepEqual(v.trips, [], "and it does not invent trips it cannot compute");
});

test("#703 the committed floor states its provenance — a floor from nowhere ratchets against nothing", () => {
  assert.match(FLOOR.seeded.date, /^\d{4}-\d{2}-\d{2}$/, "dated");
  assert.ok(FLOOR.seeded.round, "names the round it was measured on");
  for (const k of ["candidates", "cells"]) {
    assert.ok(Number.isFinite(FLOOR[k].min_rate), `${k}: a numeric floor`);
    assert.ok(FLOOR[k].seeded_from && Object.keys(FLOOR[k].seeded_from).length === 2,
      `${k}: the counts the rate came from, so the floor can be re-derived rather than trusted`);
    assert.ok(FLOOR[k].what, `${k}: says what it measures in words`);
  }
});

test("#703 a floor may never sit ABOVE the counts it was seeded from", () => {
  // How the always-fires mode nearly arrived: the cells floor was rounded to nearest and landed at
  // 0.133562 over a measured 39/292 = 0.1335616…, so the seeded floor tripped on its own seed. Rates
  // are truncated DOWNWARD. This assertion is the one that catches it, and it caught it.
  for (const k of ["candidates", "cells"]) {
    const f = FLOOR[k], [n, d] = Object.values(f.seeded_from);
    assert.ok(f.min_rate <= n / d + 1e-12,
      `${k}: floor ${f.min_rate} exceeds its own seed ${n}/${d} = ${n / d} — it would trip on the run it came from`);
  }
});

test("#703 the floor's stated counts REPRODUCE its stated rate", () => {
  // The floor file is two numbers plus the arithmetic behind them. If they disagree, one is a typo and
  // the ratchet is calibrated to a number nobody measured.
  const c = FLOOR.candidates, k = FLOOR.cells;
  assert.ok(Math.abs(c.min_rate - c.seeded_from.reconciled / c.seeded_from.retrieved) < 1e-5,
    `candidates: ${c.min_rate} vs ${c.seeded_from.reconciled}/${c.seeded_from.retrieved}`);
  assert.ok(Math.abs(k.min_rate - k.seeded_from.rowed / k.seeded_from.candidate_bearing) < 1e-5,
    `cells: ${k.min_rate} vs ${k.seeded_from.rowed}/${k.seeded_from.candidate_bearing}`);
});
