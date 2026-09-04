// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// acceptance 5 — the run record says which ladder setting applied.
//
// Every other number acceptance 5 asks for counts what the ladder produced. This one makes those counts
// mean anything: without the row in force written down, a reader comparing two runs cannot tell a graded
// product from an ungraded one, and every measurement across the change is unattributable. The failure
// is silent by construction — the counts are all still there, they just cannot be interpreted.
import test from "node:test";
import assert from "node:assert/strict";
import { depthLadderEvent } from "../pipeline.mjs";
import { PRODUCT_POLICIES, depthFor } from "../search-policy.mjs";

const ev = (product) => depthLadderEvent({ searchPolicy: { product }, depth: depthFor({ product }) });
const ROW_FIELDS = Object.keys(PRODUCT_POLICIES["full-country-search"].depth);

test("#1503 every graded product's event carries the WHOLE row — a missing field reads as unset", () => {
  assert.ok(ROW_FIELDS.length > 0, "the one-country row is empty — nothing below discriminates");
  for (const product of Object.keys(PRODUCT_POLICIES)) {
    const e = ev(product);
    assert.equal(e.event, "depth-ladder");
    for (const f of ROW_FIELDS) {
      assert.ok(f in e, `${product}'s run record omits ${f}. A reader cannot tell an omitted setting from `
        + "one that was never graded, and the counts beside it become uninterpretable.");
    }
  }
});

test("#1503 the event is DERIVED from the table, never a copy of it", () => {
  for (const [product, policy] of Object.entries(PRODUCT_POLICIES)) {
    if (!policy?.depth) continue;
    const e = ev(product);
    for (const [f, v] of Object.entries(policy.depth)) {
      if (f === "source") continue;
      assert.deepEqual(e[f], v, `${product}'s recorded ${f} is ${JSON.stringify(e[f])} but the table says `
        + `${JSON.stringify(v)}. The run record would attribute a run to a setting it did not use.`);
    }
  }
});

test("#1503 a product this build does not grade is recorded as default-ungraded, not as a choice", () => {
  const e = ev("some-product-shipped-after-this-build");
  assert.equal(e.source, "default-ungraded",
    "an unknown product recorded a graded source. A fallback that reads as a deliberate setting is one "
    + "nobody will find when a later run's numbers do not add up.");
  for (const [f, v] of Object.entries(PRODUCT_POLICIES["full-country-search"].depth)) {
    assert.deepEqual(e[f], v, `the fallback recorded ${f} as ${JSON.stringify(e[f])} rather than the `
      + "one-country value it actually ran at");
  }
});

test("#1503 a run with NO depth still writes the event — the record never loses the row entirely", () => {
  const e = depthLadderEvent({});
  assert.equal(e.event, "depth-ladder", "the event vanished when depth was absent");
  assert.equal(e.source, null, "an absent depth must record as null, which is a readable answer");
  assert.equal(e.product, null);
  assert.doesNotThrow(() => depthLadderEvent(undefined), "the event builder threw on an empty ctx — a run "
    + "record that can fail to write is one that goes missing on exactly the runs worth reading");
});
