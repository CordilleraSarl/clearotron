// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// product-rows.mjs — the one canonical wire row, and the two things that could quietly go wrong with it.
//
// (1) A NAME that is not the report's name. The whole point of putting `report.identity` on the wire is
//     that the interface calls a product the same thing the delivered document calls it. A row that
//     invented its own wording would restore exactly the split it was built to close.
// (2) A TURNAROUND that stopped being computed. `baseTurnaround` replaced a hand-written coarse band, so
//     the one failure that matters is somebody hand-editing the figure back in. Every base is re-derived
//     here from effort-model.mjs and compared, which makes a literal impossible to smuggle past.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ORDERABLE_PRODUCTS, PRODUCT_POLICIES } from "../search-policy.mjs";
import { leversFromResolved, turnaround, turnaroundHours } from "../effort-model.mjs";
import { productRow, productRows, baseTurnaroundFor } from "../product-rows.mjs";
import { registryProducts as recipeRegistryLevels } from "../recipe-service.mjs";

test("every level has a client-facing name, and it is the REPORT's name", () => {
  for (const key of ORDERABLE_PRODUCTS) {
    const row = productRow(key);
    assert.ok(row.name, `${key}: no name to lead with`);
    assert.equal(row.name, PRODUCT_POLICIES[key].report.identity,
      `${key}: the wire name must BE report.identity — a second wording is a product called two things`);
    assert.doesNotMatch(row.name, /^Depth /,
      `${key}: a name that starts with a stage number is the thing this field replaced`);
  }
});


test("every label is a BARE rung, which is why there is no separate stage field", () => {
  // There is no ladder to be a rung ON. The label used to be a position ("Depth 4") and is the PRODUCT'S
  // OWN NAME — the same string the report prints at the top — so a surface can lead with `name` and fall
  // back to `stageLabel` and get the same words either way. A RETIRED row keeps its rung, which is the
  // only reason those rows still exist.
  for (const key of ORDERABLE_PRODUCTS) {
    assert.equal(productRow(key).stageLabel, productRow(key).name, `${key}: the label is the name`);
    assert.doesNotMatch(productRow(key).stageLabel, /^Depth \d/, `${key}: a rung survived into the offering`);
  }
  assert.equal(productRow("prelim").stageLabel, "Depth 4", "an archived run keeps the rung it was sold under");
});

test("the menu is the offering, in offering order, and it ascends by effort", () => {
  const rows = productRows();
  assert.deepEqual(rows.map((r) => r.name),
    ["Knockout search", "Global preliminary search", "Multi-country focus search", "Full country search"]);
  assert.ok(rows.every((r) => r.orderable), "productRows offers; it never lists a retired row");
  // EVERY RETIRED ROW IS STILL NAMEABLE, and that is what separates naming from offering: a run
  // delivered before the offering existed re-renders under the name it was sold under.
  for (const key of ["knockout", "knockout-register", "prelim", "prelim-jx", "prelim-register-only"]) {
    const row = productRow(key);
    assert.ok(row, `${key}: a retired row must stay nameable`);
    assert.equal(row.orderable, false, `${key}: …and must not be orderable`);
  }
  const hours = rows.map((r) => r.baseTurnaroundHours);
  assert.deepEqual(hours, [...hours].sort((a, b) => a - b), "the menu must ascend by effort");
});

test("stageLabel is untouched — archived runs are stamped with it", () => {
  // A frozen _driver/search-policy.json sidecar and every published meta.json carry this string. Moving
  // it rewrites what a delivered run claims it was, which is why `stage` exists as a separate field.
  for (const key of ORDERABLE_PRODUCTS) {
    assert.equal(productRow(key).stageLabel, PRODUCT_POLICIES[key].stageLabel, `${key}: stageLabel moved`);
  }
});


test("every base turnaround is COMPUTED — no literal survives this", () => {
  for (const key of ORDERABLE_PRODUCTS) {
    const p = PRODUCT_POLICIES[key];
    const i = { levers: leversFromResolved({ pipeline: p.pipeline, components: p.components, caseLaw: productRow(key).caseLaw }),
      names: 1, classes: 0, platforms: 0, density: null };
    const row = productRow(key);
    assert.equal(row.baseTurnaround, turnaround(i), `${key}: base turnaround is not the model's answer`);
    assert.equal(row.baseTurnaroundHours, turnaroundHours(i), `${key}: base hours are not the model's answer`);
  }
});

test("the retired coarse band is gone from the registry and cannot come back through a row", () => {
  // "under an hour" / "same day" — the strings that gave a one-hour register read and a two-hour
  // clearance the same answer, while the composer's footer computed a different one on the same screen.
  for (const key of ORDERABLE_PRODUCTS) {
    assert.equal(PRODUCT_POLICIES[key].turnaroundHint, undefined, `${key}: turnaroundHint is retired`);
    const json = JSON.stringify(productRow(key));
    assert.doesNotMatch(json, /same day|under an hour|next day/i, `${key}: a coarse band reappeared`);
  }
});

test("the bands separate the products the old prose flattened", () => {
  const by = Object.fromEntries(productRows().map((r) => [r.key, r.baseTurnaroundHours]));
  // "same day" said the same thing about all three clearances, and a knockout is genuinely a different
  // size of job. That separation is the one this test was written for and it still holds.
  assert.ok(by["knockout-search"] < by["global-preliminary-search"]);

  // ALL THREE CLEARANCES NOW AGREE, and that is the ruling rather than a flattening returning.
  //
  // This line used to read `global-preliminary < full-country`, justified as "case law and a native lane
  // add time". Measurement refuted it: across the eight delivered runs collected, the run with the
  // MOST lanes — the only full-country one — came in at 2.33h, SHORTER than five of the other seven, all
  // of which carried fewer lanes and were quoted 1.5h. The adders were producing spread the wall does not
  // have. The owner ruled one range for every clearance, 1.5–2.5 hours, with the walls in front of him.
  //
  // So a future reader finding these three equal is looking at a decision, not a bug. What separates the
  // clearance products is SCOPE — where they point and how much they read — which the effort units and the
  // cost band still express. Turnaround simply is not the axis that tells them apart.
  assert.equal(by["global-preliminary-search"], by["multi-country-focus-search"]);
  assert.equal(by["global-preliminary-search"], by["full-country-search"],
    "one ruled range for every clearance (#1669) — the lane adders were unsupported by the measured walls");
});

test("an unknown product is null, never a guess", () => {
  assert.equal(productRow("nope"), null);
  assert.equal(productRow(undefined), null);
  assert.deepEqual(baseTurnaroundFor(null), { text: null, hours: null });
});

test("product lookup is case- and whitespace-insensitive, like policyFor", () => {
  assert.equal(productRow("  KNOCKOUT-SEARCH ").key, "knockout-search");
});

test("rows come back in registry order, so a menu built from this reads up the ladder", () => {
  assert.deepEqual(productRows().map((r) => r.key), [...ORDERABLE_PRODUCTS]);
});

test("the recipe service emits exactly this row — one derivation, not three", () => {
  // portal-service, recipe-service and the ops-MCP each used to build this by hand. That was safe while
  // every field was a copy; it stopped being safe when a field became computed.
  assert.deepEqual(recipeRegistryLevels(), productRows());
});
