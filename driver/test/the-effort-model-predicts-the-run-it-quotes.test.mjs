// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE EFFORT MODEL PREDICTS THE RUN IT QUOTES —.
//
// ── WHAT WENT WRONG ─────────────────────────────────────────────────────────────────────────────────
//
// `marketplaceDensity` is the profile knob that shrinks the grid batch so a byte-heavy marketplace's
// verbatim stdout cannot overflow the worker output channel (profiles.mjs gridCellBudget; the incident
// it exists for is named there). The effort model predicts that same budget so a client can be quoted
// before the run starts.
//
// The two keyed on DIFFERENT WORDS. `profiles.mjs` admits `"sparse"` or `"dense"` and dies on anything
// else; both effort models tested `=== "high"` — the label the staff editor SHOWED for the dense option,
// which no profile can ever hold. So the density branch was dead for every profile that can exist, and
// every dense customer was quoted at the sparse budget while the run executed them at 16 cells.
//
// ── WHY THE EXISTING TESTS COULD NOT SEE IT ─────────────────────────────────────────────────────────
//
// `portal-ui/test/effortModelParity.test.ts` pins the browser twin against the server twin, and it was
// green throughout: the twins agreed with each other, including in being wrong together. Its density
// population was hand-written and did not include `"dense"`, so no input in it could have failed.
//
// A parity test proves the twins match. NOTHING proved either matched the run. That is this file: it is
// the only place the quote's arithmetic is driven against the arithmetic the run actually performs.
//
// ── WHAT THIS FILE MUST KEEP TRUE ───────────────────────────────────────────────────────────────────
//
// The population comes from `MARKETPLACE_DENSITIES` — the validator's own list — so a third density
// added to the profile schema arrives here automatically instead of waiting to be remembered.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as effort from "../effort-model.mjs";
import {
  MARKETPLACE_DENSITIES, gridCellBudget, derivedBatchSize, validateProfileEdit,
  SAFE_GRID_CELLS, DENSE_GRID_CELLS,
} from "../profiles.mjs";

/** A profile shape the validator accepts, so a density can be varied against a real acceptance. */
const BASE = { name: "Spine Co", platforms: ["example.com"] };

/** Absent is a legal state — the default — so it is part of the population, not an edge case. */
const ADMITTED = [undefined, ...MARKETPLACE_DENSITIES];

test("the budget the quote assumes is the budget the run will use, for every density a profile may hold", () => {
  // ANTI-VACUITY FIRST. Every assertion below is an equality between two functions; if the population
  // only ever exercised one branch, they would agree trivially and this file would prove nothing. The
  // interesting value is the one whose absence hid for the whole life of the defect.
  const budgets = new Set(ADMITTED.map((d) => gridCellBudget({ marketplaceDensity: d })));
  assert.ok(budgets.has(DENSE_GRID_CELLS),
    "no admitted density selects the dense budget — the population cannot distinguish a working branch "
    + "from a dead one, which is exactly the state that let the effort model key on a value nothing stores");
  assert.ok(budgets.has(SAFE_GRID_CELLS), "no admitted density selects the safe budget");

  for (const density of ADMITTED) {
    assert.equal(effort.gridBudget(density), gridCellBudget({ marketplaceDensity: density }),
      `density=${String(density)}: the quote and the run disagree about the grid cell budget, so a client `
      + "is shown a number computed from work the engine will not do");
  }
});

test("batch size agrees too — the number of variants per grid call, not just the budget behind it", () => {
  // The budget is upstream arithmetic; batchSize is what actually divides the work, and it is derived on
  // each side by a DIFFERENT expression (effort-model: gridBudget / checksPerName; profiles: gridCellBudget
  // / derivedFloor). Equal inputs must give equal answers or the two expressions have drifted.
  for (const platforms of [0, 1, 6, 7, 13, 40]) {
    const list = Array.from({ length: platforms }, (_, i) => `shop${i}.example`);
    for (const density of ADMITTED) {
      assert.equal(
        effort.batchSize(platforms, density),
        derivedBatchSize({ platforms: list, marketplaceDensity: density }),
        `platforms=${platforms} density=${String(density)}: quoted batch size is not the batch size the run derives`);
    }
  }
});

test("a density the validator REFUSES cannot select a budget — the shape of tracker issue 2008", () => {
  // Driven against the validator rather than asserted from a list, because the claim is about what a
  // profile can HOLD, and the validator is the only thing that decides that.
  //
  // "high" is the word this is really about: it was the staff editor's label for `dense`, and both effort
  // models were written against the label instead of the stored value. Under the defect, gridBudget("high")
  // returned 16 — the dense budget, selected by a string no profile can carry — while a genuinely dense
  // profile got 98. The two rows that mattered were wrong in OPPOSITE directions.
  const refused = ["high", "HIGH", "DENSE", "Dense", " dense", "dense ", ""];
  let proven = 0;
  for (const density of refused) {
    const verdict = validateProfileEdit("spine", { ...BASE, marketplaceDensity: density });
    assert.equal(verdict.ok, false,
      `the validator now ACCEPTS "${density}" — this arm was written when it did not, and it is asserting `
      + "nothing until its population is corrected");
    assert.match(verdict.errors.join(" "), /marketplaceDensity/,
      `"${density}" was refused for some other reason, so this row does not test what it claims`);
    assert.equal(effort.gridBudget(density), SAFE_GRID_CELLS,
      `gridBudget("${density}") selects a budget for a value no profile can hold — a dead branch that `
      + "looks live is how the next person reasons wrongly about it");
    proven++;
  }
  assert.equal(proven, refused.length, "not every refused spelling was actually driven");
});

test("the budgets the twin restates are the budgets profiles.mjs defines", () => {
  // effort-model.mjs is kept dependency-free so it stays structurally identical to its browser twin, which
  // cannot import from driver/ at all. That means the two constants are RESTATED there, and a restatement
  // is a copy that drifts silently. This is the guard that makes the copy safe.
  assert.equal(effort.SAFE_GRID_CELLS, SAFE_GRID_CELLS, "the quote's safe grid budget has drifted from the run's");
  assert.equal(effort.DENSE_GRID_CELLS, DENSE_GRID_CELLS, "the quote's dense grid budget has drifted from the run's");
});
