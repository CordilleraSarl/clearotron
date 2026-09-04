// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Item 11 — the ORDER-EFFECT seam, and the two things that have to be true about it at once.
//
//   1. INERT. Production ordering is byte-identical unless someone sets CLEAROTRON_ORDER_PROBE_SEED to a
//      positive integer. This is the owner's binding constraint on the item, and it is what these tests
//      exist for: a probe that could fire by accident during the round it exists to make readable would
//      be worse than not having one.
//   2. NOT DEAD. It has to actually do something when armed. Item 24's finding this batch was a mechanism
//      described as working that was configured out — no telemetry could ever have shown otherwise. An
//      inert-by-default seam that is ALSO inert when armed is that same failure, shipped deliberately.
//
// Both are asserted here, on the same three call sites.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { probeSeed, probeOrder, probeActive } from "../order-probe.mjs";
import { buildBandShape } from "../band-shape.mjs";

// The band fixture shape this repo already uses (band-shape.test.mjs REC/BAND), widened so the floors
// list holds enough members for an order to exist at all: six live in-class identical/near records.
const REC = (id, mark, { classes = [32], status = "Registered", owner = "Synth Co" } = {}) =>
  ({ record_id: `/mark/us/${id}`, mark_text: mark, classes, status, owner_name: owner, owner_country: "US",
    application_date: "2019-04-01", jurisdictions: ["US"], screen_verdict: "carry", _query: "exact nova [cl 32]" });

const BAND = {
  enumerated: [
    REC(1, "NOVA PULSE"), REC(2, "NOVA PULSSE", { owner: "Beta Co" }), REC(3, "NOVAPULSE", { owner: "Gamma Co" }),
    REC(4, "NOVA PULS", { owner: "Delta Co" }), REC(5, "NOVA PULSE", { owner: "Epsilon Co" }),
    REC(6, "NOVA PULCE", { owner: "Zeta Co" }), REC(7, "NOVA PULSE", { owner: "Eta Co" }),
  ],
  crowds: [],
};
const shapeOf = () => buildBandShape(BAND, { targets: ["NOVA PULSE"], inScopeClasses: [32] }).shape;

const withEnv = (v, fn) => {
  const saved = process.env.CLEAROTRON_ORDER_PROBE_SEED;
  if (v == null) delete process.env.CLEAROTRON_ORDER_PROBE_SEED; else process.env.CLEAROTRON_ORDER_PROBE_SEED = v;
  try { return fn(); } finally { if (saved === undefined) delete process.env.CLEAROTRON_ORDER_PROBE_SEED; else process.env.CLEAROTRON_ORDER_PROBE_SEED = saved; }
};

test("item 11 — OFF is the identity, and it is the identity by REFERENCE, not by luck", () => {
  const list = [1, 2, 3, 4, 5];
  assert.equal(probeOrder(list, "x", {}), list, "no seed ⇒ the same array object, so there is nothing to get wrong");
  assert.equal(probeSeed({}), null);
  assert.equal(probeActive({}), false);
});

test("item 11 — a malformed seed fails CLOSED (a typo must never silently pick an arm)", () => {
  for (const bad of ["", "0", "-1", "abc", "1.5", "1e3", " ", "true", "07x"]) {
    assert.equal(probeSeed({ CLEAROTRON_ORDER_PROBE_SEED: bad }), null, `"${bad}" must read as OFF`);
    const list = [1, 2, 3];
    assert.equal(probeOrder(list, "x", { CLEAROTRON_ORDER_PROBE_SEED: bad }), list, `"${bad}" must leave the order alone`);
  }
  assert.equal(probeSeed({ CLEAROTRON_ORDER_PROBE_SEED: "7" }), 7);
});

test("item 11 — the shape is byte-identical with the probe off, however the env is malformed", () => {
  const baseline = JSON.stringify(withEnv(null, shapeOf));
  for (const bad of [undefined, "", "0", "-1", "abc"])
    assert.equal(JSON.stringify(withEnv(bad, shapeOf)), baseline,
      `CLEAROTRON_ORDER_PROBE_SEED=${JSON.stringify(bad)} must leave production ordering untouched`);
});

test("item 11 — ARMED, the seam actually moves the three lists (an inert probe is item 24's defect on purpose)", () => {
  const off = withEnv(null, shapeOf);
  const on = withEnv("7", shapeOf);
  assert.notEqual(JSON.stringify(on.floors), JSON.stringify(off.floors), "floors reorder under an arm");
  // same MEMBERS, different order — a probe that dropped or invented a record would be testing nothing
  const ids = (s) => s.floors.in_class_identical_or_near.map((f) => f.record_id).slice().sort();
  assert.deepEqual(ids(on), ids(off), "the permutation is a permutation: same records, same count");
  assert.equal(on.floors.in_class_identical_or_near.length, off.floors.in_class_identical_or_near.length);
});

test("item 11 — the arm is REPRODUCIBLE: same seed, same permutation, every time and every machine", () => {
  const a = withEnv("7", shapeOf), b = withEnv("7", shapeOf);
  assert.equal(JSON.stringify(a), JSON.stringify(b), "an arm you cannot reproduce is not an arm");
  assert.notEqual(JSON.stringify(withEnv("8", shapeOf)), JSON.stringify(a), "a different seed is a different arm");
});

test("item 11 — each call site gets its OWN permutation (one shuffle repeated is one test wearing three hats)", () => {
  const list = Array.from({ length: 12 }, (_, i) => i);
  const env = { CLEAROTRON_ORDER_PROBE_SEED: "7" };
  assert.notDeepEqual(probeOrder(list, "floors", env), probeOrder(list, "positions", env));
});

test("item 11 — the seam never REPLACES a sort; it always follows one", () => {
  const src = readFileSync(new URL("../band-shape.mjs", import.meta.url), "utf8");
  const sites = [...src.matchAll(/probeOrder\(/g)];
  assert.equal(sites.length, 3, "three seams: composites, positions, floors — add one and add its proof here too");
  // Determinism is the product behaviour and stays. The probe asks what happens AFTER it, never instead
  // of it: if a seam ever came to stand in for a sort, production order would depend on the env var.
  for (const m of sites) {
    const before = src.slice(Math.max(0, m.index - 700), m.index);
    assert.match(before, /\.sort\(/, "every probeOrder call site is preceded by the deterministic sort it follows");
  }
});
