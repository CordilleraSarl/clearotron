// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// PR-8 (Thread D1) — the deterministic band shape: the mechanical classifier, the unconditional
// floors, the census, the crowd-context join (compose, never change) and the blind-spot detectors.
// All fixtures are SYNTHETIC, structure-copied from real artifact SHAPES only (no client data).
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyRecord, prepareTargets, buildBandShape, renderBandShapeMd, isLiveRecord, nonLatinScripts, SHAPE_TIERS } from "../band-shape.mjs";

// ── the classifier ──────────────────────────────────────────────────────────────────────────────────

test("classifyRecord: the five tiers, mechanically", () => {
  const targets = ["NOVA PULSE", "NOVA"];
  assert.equal(classifyRecord("NOVA PULSE", targets).tier, "identical");
  assert.equal(classifyRecord("nova-pulse", targets).tier, "identical", "case/punctuation fold to the same normalized seed");
  assert.equal(classifyRecord("NOVÀ PULSE", targets).tier, "identical", "diacritics fold before comparison");
  assert.equal(classifyRecord("NOVA PULSSE", targets).tier, "near-identical", "edit-1 insertion");
  assert.equal(classifyRecord("NOVA PULE", targets).tier, "near-identical", "edit-1 deletion");
  assert.equal(classifyRecord("N0VA PULSE", targets).tier, "near-identical", "homoglyph 0↔o collides on the confusable skeleton");
  assert.equal(classifyRecord("TROPICAL NOVA", targets).tier, "same-family", "target as a standalone token");
  assert.equal(classifyRecord("ZORVAPLUS", targets).tier, "other");
  assert.equal(classifyRecord("碎冰", targets).tier, "unclassifiable", "no Latin skeleton survives — a blind spot, never an 'other'");
  assert.equal(classifyRecord("", targets).tier, "unclassifiable");
});

test("classifyRecord: precedence is fixed (identical wins over family), basis names the mechanism", () => {
  const r = classifyRecord("NOVA", ["NOVA PULSE", "NOVA"]);
  assert.equal(r.tier, "identical");
  assert.equal(r.target, "NOVA");
  assert.equal(r.basis, "normalized-equal");
  const near = classifyRecord("NOVA PULSSE", ["NOVA PULSE"]);
  assert.equal(near.basis, "edit-1");
  const scr = classifyRecord("碎冰", ["NOVA"]);
  assert.match(scr.basis, /non-latin-script:han/);
});

test("classifyRecord: prepared targets give identical answers to raw strings (and are reusable)", () => {
  const prepared = prepareTargets(["NOVA PULSE"]);
  for (const m of ["NOVA PULSE", "NOVA PULSSE", "TROPICAL NOVA PULSE", "ZORVA"])
    assert.deepEqual(classifyRecord(m, prepared), classifyRecord(m, ["NOVA PULSE"]));
});

test("classifyRecord is deterministic — same inputs, same bytes, every time", () => {
  const a = JSON.stringify(classifyRecord("NOVA PULSAR", ["NOVA PULSE", "PULSE"]));
  for (let i = 0; i < 5; i++) assert.equal(JSON.stringify(classifyRecord("NOVA PULSAR", ["NOVA PULSE", "PULSE"])), a);
});

test("isLiveRecord: screen.live_status wins; dead status words read dead; unknown reads LIVE (fail-safe)", () => {
  assert.equal(isLiveRecord({ status: "Registered" }), true);
  assert.equal(isLiveRecord({ status: "Expired" }), false);
  assert.equal(isLiveRecord({ status: "Cancellation pending" }), false);
  assert.equal(isLiveRecord({ status: "Pending" }), true);
  assert.equal(isLiveRecord({}), true, "no status at all ⇒ live — the floors err toward listing");
  assert.equal(isLiveRecord({ status: "Registered", screen: { live_status: "dead" } }), false, "the screen's read wins");
  assert.equal(isLiveRecord({ status: "Expired", screen: { live_status: "live" } }), true);
});

test("nonLatinScripts: mechanical Unicode script classes", () => {
  assert.deepEqual(nonLatinScripts("碎冰"), ["han"]);
  assert.deepEqual(nonLatinScripts("ЛУНА"), ["cyrillic"]);
  assert.deepEqual(nonLatinScripts("NOVA"), []);
});

// ── the shape ───────────────────────────────────────────────────────────────────────────────────────

const REC = (id, mark, { classes = [32], status = "Registered", owner = "Synth Co", query = "exact nova [cl 32]", screen } = {}) =>
  ({ record_id: `/mark/us/${id}`, mark_text: mark, classes, status, owner_name: owner, owner_country: "US",
    application_date: "2019-04-01", jurisdictions: ["US"], screen_verdict: "carry", _query: query, ...(screen ? { screen } : {}) });

const BAND = {
  enumerated: [
    REC(1, "NOVA PULSE"),                                                    // identical, live, in-class → FLOOR
    REC(2, "NOVA PULSSE"),                                                   // near-identical, live, in-class → FLOOR
    REC(3, "NOVA PULSE", { status: "Expired" }),                             // identical but DEAD → not a floor row
    REC(4, "NOVA PULSE", { classes: [45] }),                                 // identical, live, OUT of class → not a floor row
    REC(5, "TROPICAL NOVA"),                                                 // same-family
    REC(6, "ZORVAPLUS", { owner: "Zorva Holdings" }),                        // other
    REC(7, "碎冰", { owner: "Synthetic HK" }),                               // unclassifiable + script gap
  ],
  crowds: [
    { query: "owner:MEGACORP BEVERAGES [all classes]", total_hits: 41000, fetched: 0, reason: "total_hits 41000 exceeds the enumerate ceiling 600" },
    { query: "contains NOVA [cl 32]", total_hits: 895, fetched: 100, sample: [], reason: "total_hits 895 exceeds the enumerate ceiling 600" },
  ],
};

test("buildBandShape: totals, unconditional floors (live + in-class only), census, owners", () => {
  const { shape } = buildBandShape(BAND, { targets: ["NOVA PULSE"], inScopeClasses: ["5", "32"] });
  assert.equal(shape.totals.records, 7);
  assert.equal(shape.totals.crowds, 2);
  assert.deepEqual(Object.keys(shape.totals.by_tier), SHAPE_TIERS);
  assert.equal(shape.totals.by_tier.identical, 3, "the dead and out-of-class identicals still COUNT in the tier census");
  // the floors: every LIVE IN-CLASS identical/near-identical, individually — and nothing else
  const floors = shape.floors.in_class_identical_or_near;
  assert.deepEqual(floors.map((f) => f.record_id), ["/mark/us/1", "/mark/us/2"], "identical first, then near-identical");
  assert.equal(floors[0].matched_target, "NOVA PULSE");
  assert.ok(floors.every((f) => f.live === true));
  assert.equal(shape.by_class["32"], 6);
  assert.equal(shape.by_status.registered, 6);
  assert.equal(shape.owners.distinct, 3);
  assert.equal(shape.owners.concentrations[0].owner_name, "Synth Co");
});

test("buildBandShape: provider-scored fields are never keyed on (score/poca/highlight/raw ignored)", () => {
  // two records identical on the NEUTRAL fields, one dressed in vendor-only noise — same classification
  const plain = REC(1, "NOVA PULSE");
  const noisy = { ...REC(1, "NOVA PULSE"), score: 99.1, poca_scores: [0.97], onomaticsAggression: 5, highlight: "<b>NOVA</b>", raw: { vendor: "blob" } };
  const a = buildBandShape({ enumerated: [plain], crowds: [] }, { targets: ["NOVA PULSE"] }).shape;
  const b = buildBandShape({ enumerated: [noisy], crowds: [] }, { targets: ["NOVA PULSE"] }).shape;
  assert.deepEqual(a.totals, b.totals);
  assert.deepEqual(a.floors, b.floors);
});

test("buildBandShape: blind spots each carry their mechanical detector", () => {
  const { shape } = buildBandShape(BAND, { targets: ["NOVA PULSE"], inScopeClasses: ["32"] });
  const kinds = Object.fromEntries(shape.blind_spots.map((b) => [b.kind, b]));
  assert.ok(kinds["count-only-owner-zone"], "owner crowd counted, never screened");
  assert.equal(kinds["count-only-owner-zone"].count, 1);
  assert.match(kinds["count-only-owner-zone"].detector, /fetched<=1/);
  assert.equal(kinds["unenumerated-crowd"].count, 2);
  assert.equal(kinds["unclassifiable-record"].count, 1);
  assert.equal(kinds["script-gap"].scripts, "han");
  for (const b of shape.blind_spots) assert.ok(b.detector && b.detector.length > 10, `${b.kind} names its detector`);
  assert.deepEqual(shape.owners.count_only_zones.map((z) => z.query), ["owner:MEGACORP BEVERAGES [all classes]"]);
});

test("buildBandShape: crowd_context_slice join composes with the crowd-context artifact (term-in-query)", () => {
  const crowdContext = { slices: [
    { unit: "primary-sweep / NOVA", axis: "primary-sweep", terms: ["NOVA"], exact_subset: { enumerated: true, total_hits: 12 } },
    { unit: "unrelated", axis: "incumbent-class", terms: ["QUARTZ"], exact_subset: { enumerated: false, total_hits: 900 } },
  ] };
  const { shape } = buildBandShape(BAND, { targets: ["NOVA PULSE"], crowdContext });
  const joined = shape.crowds.find((c) => c.query === "contains NOVA [cl 32]");
  assert.equal(joined.crowd_context_slice.length, 1);
  assert.equal(joined.crowd_context_slice[0].unit, "primary-sweep / NOVA");
  assert.equal(joined.crowd_context_slice[0].exact_subset_enumerated, true);
  const unjoined = shape.crowds.find((c) => /MEGACORP/.test(c.query));
  assert.equal(unjoined.crowd_context_slice, null, "no matching slice ⇒ null, never an invented join");
});

test("buildBandShape: no instructed classes ⇒ nothing filtered from the floors (fail-safe)", () => {
  const { shape } = buildBandShape(BAND, { targets: ["NOVA PULSE"], inScopeClasses: [] });
  assert.deepEqual(shape.floors.in_class_identical_or_near.map((f) => f.record_id), ["/mark/us/1", "/mark/us/4", "/mark/us/2"],
    "the class-45 identical joins the floors when no class scope was instructed");
});

test("buildBandShape is deterministic: same band ⇒ byte-identical shape + md (no timestamps)", () => {
  const opts = { targets: ["NOVA PULSE"], inScopeClasses: ["32"] };
  const a = buildBandShape(BAND, opts);
  const b = buildBandShape(BAND, opts);
  assert.equal(JSON.stringify(a.shape), JSON.stringify(b.shape));
  assert.equal(a.md, b.md);
});

test("the md mirror stays small (<256KB) on a large band while the floors stay COMPLETE in both forms", () => {
  const enumerated = [];
  for (let i = 0; i < 6000; i++) enumerated.push(REC(1000 + i, `SYNTH MARK ${i}`, { owner: `Owner ${i % 700}`, classes: [String(1 + (i % 45))] }));
  for (let i = 0; i < 300; i++) enumerated.push(REC(9000 + i, "NOVA PULSE", { classes: [32], owner: `Floor Owner ${i}` }));
  const { shape, md } = buildBandShape({ enumerated, crowds: BAND.crowds }, { targets: ["NOVA PULSE"], inScopeClasses: ["32"] });
  assert.equal(shape.floors.in_class_identical_or_near.length, 300, "every floor record listed individually — never capped");
  const floorSection = md.slice(md.indexOf("## Floors"));
  for (let i = 0; i < 300; i += 37) assert.ok(floorSection.includes(`/mark/us/${9000 + i}`), `floor row ${i} present in the md`);
  assert.ok(md.length < 256 * 1024, `md fits one Read (${md.length} bytes)`);
  assert.ok(shape.owners.concentrations.length <= 40, "aggregate owner list is bounded — only the floors are unconditional");
});

test("renderBandShapeMd: honest zero-floor line; markdown table cells escape pipes", () => {
  const { shape } = buildBandShape({ enumerated: [REC(1, "ZORVA|X", { classes: [9] })], crowds: [] }, { targets: ["NOVA"], inScopeClasses: ["9"] });
  const md = renderBandShapeMd(shape);
  assert.match(md, /none — no live in-class record classified identical or near-identical/);
  assert.ok(!/ZORVA\|X \|/.test(md), "raw pipe never breaks a table row");
});
