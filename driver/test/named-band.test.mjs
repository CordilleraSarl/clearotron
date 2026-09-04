// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Named-band contract (judgment-relocation Move 2). Proves the artifact that crosses the lifted firewall parses
// into {enumerated records, crowd descriptors}, surfaces both without judging, and throws token-first on defects.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNamedBand, bandRecords, bandCrowds, mergeNamedBands, findCollapsedBands, BAND_STATES } from "../named-band.mjs";

const BAND = JSON.stringify([
  { state: "enumerated", query: "exact NOVAPULSE cl.9 region:GB", total_hits: 2,
    records: [
      { record_id: "/mark/gb/UK00911505377", mark_text: "NOVAPULSE", classes: [9], status: "Registered", owner_name: "Larkmoor Music Systems", screen_verdict: "surface:in-scope-live" },
      { record_id: "/mark/gb/X2", mark_text: "NOVAPULSE", classes: [9], status: "Registered", owner_name: "Other", screen_verdict: "surface:in-scope-live" },
    ] },
  { state: "incomplete", query: "contains NOVAPULSE cl.9 worldwide", total_hits: 768, fetched: 100,
    sample: [{ record_id: "/mark/eu/1", mark_text: "RAZER NOVAPULSE" }], reason: "crowd over ceiling — descriptor only, judgment to command/halt" },
]);

test("parseNamedBand: flattens enumerated records (with _query provenance) + collects crowd descriptors", () => {
  const band = parseNamedBand(BAND);
  assert.equal(bandRecords(band).length, 2, "every enumerated record crosses");
  assert.equal(bandRecords(band)[0].owner_name, "Larkmoor Music Systems", "the named incumbent is in the band judgment reads");
  assert.equal(bandRecords(band)[0]._query, "exact NOVAPULSE cl.9 region:GB", "record carries which slice surfaced it");
  assert.equal(bandCrowds(band).length, 1, "the un-enumerated crowd is surfaced as a descriptor");
  assert.equal(bandCrowds(band)[0].total_hits, 768);
  assert.match(bandCrowds(band)[0].reason, /command|halt|descriptor/i, "the crowd reason is a signal to judgment, not a clean");
});

test("parseNamedBand: a qid-stamped crowd keeps its plan identity; a model-authored one gains none", () => {
  const band = parseNamedBand(JSON.stringify([
    { state: "incomplete", qid: "saturation-probe:default:nova", query: "contains NOVA cl.9", total_hits: 4321, fetched: 0, sample: [], reason: "count-only crowd descriptor (plan-dictated)" },
    { state: "incomplete", query: "judgment-proposed slice", total_hits: 99, fetched: 0, sample: [], reason: "crowd" },
  ]));
  assert.equal(bandCrowds(band)[0].qid, "saturation-probe:default:nova", "the executor's qid survives the projection — Layer B joins exactly, not via query text");
  assert.ok(!("qid" in bandCrowds(band)[1]), "no invented qid on a judgment block");
});

test("parseNamedBand: a qid-stamped block stamps _qid on its records (the plan-execution join); model-authored blocks do not", () => {
  const band = parseNamedBand(JSON.stringify([
    { state: "enumerated", qid: "primary-sweep:exact:novapulse", query: "exact NOVAPULSE cl.9", total_hits: 1,
      records: [{ record_id: "/mark/gb/Q1", mark_text: "NOVAPULSE" }] },
    { state: "enumerated", query: "model-authored slice", total_hits: 1,
      records: [{ record_id: "/mark/gb/Q2", mark_text: "NOVAPULSE" }] },
  ]));
  assert.equal(bandRecords(band)[0]._qid, "primary-sweep:exact:novapulse", "provenance reaches judgment (band_lookup qid filter joins on it)");
  assert.equal(bandRecords(band)[1]._qid, undefined, "a qid-less block stays qid-less — never invented");
});

test("parseNamedBand: surfaces, never judges — a crowd is data, not a drop/accept", () => {
  // the module exposes both; it makes NO materiality call (that is Layer B). Just assert both are present + raw.
  const band = parseNamedBand(BAND);
  assert.ok(Array.isArray(band.enumerated) && Array.isArray(band.crowds));
  assert.deepEqual(BAND_STATES, ["enumerated", "incomplete"]);
});

test("mergeNamedBands: unions across axes, de-dups enumerated by record_id, keeps every crowd", () => {
  const a = parseNamedBand(BAND);
  const b = parseNamedBand(JSON.stringify([
    { state: "enumerated", query: "exact NOVAPULSE cl.9 region:EU", total_hits: 1,
      records: [{ record_id: "/mark/gb/UK00911505377", mark_text: "NOVAPULSE" }, { record_id: "/mark/eu/NEW", mark_text: "NOVAPULSE" }] },
    { state: "incomplete", query: "色度 contains cl.9 CN", total_hits: 363, sample: [], reason: "character-indexed crowd descriptor" },
  ]));
  const merged = mergeNamedBands([a, b]);
  const ids = bandRecords(merged).map((r) => r.record_id);
  assert.equal(ids.filter((x) => x === "/mark/gb/UK00911505377").length, 1, "dup record_id collapsed once");
  assert.ok(ids.includes("/mark/eu/NEW"), "new record kept");
  assert.equal(bandCrowds(merged).length, 2, "both crowd descriptors preserved");
});

test("throws token-first on defects (corrective-retry contract)", () => {
  assert.throws(() => parseNamedBand("{not json"), /named_band_unparseable/);
  assert.throws(() => parseNamedBand(JSON.stringify({ no: "array" })), /named_band_unparseable/);
  assert.throws(() => parseNamedBand(JSON.stringify([{ state: "maybe", query: "x" }])), /named_band_state_invalid/);
  assert.throws(() => parseNamedBand(JSON.stringify(["not-an-object"])), /named_band_block_invalid/);
});

// FIX: a collapsed core search must FAIL. findCollapsedBands flags an enumerated slice that CLAIMED hits
// (total_hits > 0) but carried ZERO records into the band — the "zero records reached the band" recall loss.
test("findCollapsedBands: flags an enumerated slice that claimed hits but extracted zero records", () => {
  const raw = JSON.stringify([
    { state: "enumerated", query: "exact ZURENA cl.25 region:US", total_hits: 212, records: [] },
  ]);
  const collapsed = findCollapsedBands(raw);
  assert.equal(collapsed.length, 1, "the collapsed slice is detected");
  assert.equal(collapsed[0].total_hits, 212);
  assert.equal(collapsed[0].query, "exact ZURENA cl.25 region:US");
});

test("findCollapsedBands: a healthy band (records present, plus a crowd) is clean", () => {
  assert.deepEqual(findCollapsedBands(BAND), [], "the 2-record band + crowd is not a collapse");
});

test("findCollapsedBands: PER-BLOCK — one collapsed slice inside a large multi-slice band is still caught", () => {
  // The real failing run had ~220 records overall; only the DANGEROUS slice was missing. A per-axis aggregate
  // would miss it — per-block detection does not.
  const records = Array.from({ length: 220 }, (_, i) => ({ record_id: `/r/${i}`, mark_text: "ACME" }));
  const raw = JSON.stringify([
    { state: "enumerated", query: "broad ACME cl.9", total_hits: 220, records },
    { state: "enumerated", query: "exact ACME-near cl.9 region:DE", total_hits: 7, records: [] }, // the lost slice
    { state: "incomplete", query: "contains ACME worldwide", total_hits: 9000, fetched: 100, sample: [], reason: "crowd" },
  ]);
  const collapsed = findCollapsedBands(raw);
  assert.equal(collapsed.length, 1, "only the collapsed slice is flagged, not the 220-record one");
  assert.equal(collapsed[0].query, "exact ACME-near cl.9 region:DE");
});

test("findCollapsedBands: FLOOR-SAFE — absent / zero / non-numeric total_hits never fires", () => {
  assert.deepEqual(findCollapsedBands(JSON.stringify([{ state: "enumerated", query: "x", records: [] }])), [], "absent total_hits");
  assert.deepEqual(findCollapsedBands(JSON.stringify([{ state: "enumerated", query: "x", total_hits: 0, records: [] }])), [], "a genuinely 0-hit slice");
  assert.deepEqual(findCollapsedBands(JSON.stringify([{ state: "enumerated", query: "x", total_hits: "lots", records: [] }])), [], "non-numeric total_hits");
});

test("findCollapsedBands: a crowd / incomplete descriptor is never a collapse (it is a signal for judgment)", () => {
  const raw = JSON.stringify([{ state: "incomplete", query: "contains X worldwide", total_hits: 768, fetched: 0, sample: [], reason: "crowd over ceiling" }]);
  assert.deepEqual(findCollapsedBands(raw), [], "an un-enumerated crowd flows to judgment, never a hard fail");
});

test("findCollapsedBands: throws token-first on a top-level parse defect (mirrors parseNamedBand)", () => {
  assert.throws(() => findCollapsedBands("{not json"), /named_band_unparseable/);
  assert.throws(() => findCollapsedBands(JSON.stringify({ no: "array" })), /named_band_unparseable/);
});

// ── T1 (J1c): terminal quarantine for model-authored vocabulary misses ─────────────────────────
import { quarantineUnknownStates } from "../named-band.mjs";

const POISONED = JSON.stringify([
  { state: "enumerated", qid: "q1", query: "exact AURA cl.9", total_hits: 1, records: [{ record_id: "/mark/us/1", mark_text: "AURA" }] },
  { state: "verified", query: "judgment: cross-class merch check", total_hits: 3,
    records: [{ record_id: "/mark/us/2", mark_text: "AURA GEAR" }], reason: "checked the merch class" },
  { state: "incomplete", query: "contains AURA worldwide", total_hits: 900, fetched: 0, sample: [], reason: "crowd" },
]);

test("quarantineUnknownStates: a qid-less unknown state coerces to an honest incomplete descriptor (content survives)", () => {
  const { blocks, quarantined } = quarantineUnknownStates(POISONED);
  assert.equal(quarantined.length, 1);
  assert.equal(quarantined[0].state, "verified");
  const q = blocks.find((b) => /QUARANTINED/.test(b.reason ?? ""));
  assert.ok(q, "the repaired block carries the QUARANTINED reason");
  assert.equal(q.state, "incomplete");
  assert.equal(q.total_hits, 3);
  assert.equal(q.fetched, 1, "records count survives as fetched");
  assert.equal(q.sample[0].mark_text, "AURA GEAR", "the block's own material survives in sample — judgment still reads it");
  assert.match(q.reason, /vocabulary miss/, "labelled a vocabulary miss, never a clean");
  assert.match(q.reason, /Original reason: checked the merch class/);
  // the repaired band round-trips through the STRICT parser — the validator passes it afterwards
  const band = parseNamedBand(JSON.stringify(blocks));
  assert.equal(bandCrowds(band).length, 2);
  assert.equal(bandRecords(band).length, 1, "valid blocks untouched");
});

test("quarantineUnknownStates: a QID-STAMPED unknown state still throws — machine states are code-owned (tool bug)", () => {
  const bad = JSON.stringify([{ state: "verified", qid: "q9", query: "x", total_hits: 1, records: [] }]);
  assert.throws(() => quarantineUnknownStates(bad), /named_band_state_invalid:verified.*qid-stamped/s);
});

test("quarantineUnknownStates: a fully valid band passes through untouched (zero quarantined)", () => {
  const { blocks, quarantined } = quarantineUnknownStates(BAND);
  assert.equal(quarantined.length, 0);
  assert.equal(blocks.length, 2);
  assert.throws(() => quarantineUnknownStates("not json"), /named_band_unparseable/);
});

// ── count-first rescue passthrough (2026-07-10, copper-lattice) ────────────────────────────────────────
// A rescued crowd descriptor carries per-term truth: `term_counts` stays on the crowd (the clean-gate
// discriminates on it) and the fully-enumerated tractable terms' `records` join the enumerated stream —
// the rare record reaches judgment like any other named-band material.
test("parseNamedBand: a rescued incomplete block surfaces term_counts on the crowd + harvests carried records", () => {
  const band = parseNamedBand(JSON.stringify([
    { state: "incomplete", query: "exact FROSTBERRY|ICEBERRY cl.32", total_hits: 28001, fetched: 1,
      sample: [{ record_id: "/mark/us/90491258" }],
      reason: "count-first per-term rescue ran — a populated term is never recorded 0",
      term_counts: { FROSTBERRY: { total_hits: 1, disposition: "enumerated" }, ICEBERRY: { total_hits: 28000, disposition: "crowd" } },
      records: [{ record_id: "/mark/us/90491258", mark_text: "Xyience FROSTBERRY", classes: [32], status: "Registered", owner_name: "Xyience" }] },
  ]));
  assert.equal(bandRecords(band).length, 1, "the rescue-carried record joins the enumerated stream");
  assert.equal(bandRecords(band)[0].record_id, "/mark/us/90491258");
  assert.equal(bandRecords(band)[0]._query, "exact FROSTBERRY|ICEBERRY cl.32", "provenance carried");
  assert.equal(bandCrowds(band)[0].term_counts.ICEBERRY.disposition, "crowd", "per-term truth stays on the descriptor");
  assert.equal(bandCrowds(band)[0].term_counts.FROSTBERRY.total_hits, 1);
});

// F2 owner lane (2026-07-29): the classSplitRescue's per-CLASS truth and the bare-owner count's
// covered_by pointers cross the projection EXACTLY like term_counts — register-named-band.json is the
// only band artifact judgment reads, so without the carry "Cl. 30 leg unopened" survives only as the
// reason string's anonymous tally and the slice qids truncate away with the reason's 400-char cap.
test("parseNamedBand: a class-split crowd surfaces class_counts + covered_by on the descriptor", () => {
  const band = parseNamedBand(JSON.stringify([
    { state: "incomplete", query: "owner Aurora Beverages × GLIMMER cl.5,30,32", total_hits: 805, fetched: 120,
      sample: [],
      reason: "owner-scoped total_hits 805 exceeds the enumerate ceiling 600; count-first per-CLASS rescue ran",
      class_counts: { "5": { total_hits: 700, disposition: "crowd" }, "30": { total_hits: 90, disposition: "unenumerated" }, "32": { total_hits: 15, disposition: "enumerated" } },
      records: [{ record_id: "/mark/eu/000123456", mark_text: "GLIMMERTONIC", classes: [32], status: "Registered", owner_name: "Aurora Beverages Holding GmbH & Co. KG" }] },
    { state: "incomplete", qid: "incumbent-class:owner:aurora+watch", query: "owner Aurora Beverages (portfolio count)", total_hits: 41235, fetched: 0,
      sample: [], reason: "count-only owner-portfolio descriptor (plan-dictated)",
      covered_by: ["incumbent-class:default:glimmer+owner-aurora", "incumbent-class:default:lumengarde+owner-aurora"] },
  ]));
  const crowds = bandCrowds(band);
  assert.equal(crowds[0].class_counts["30"].disposition, "unenumerated", "the open class leg is NAMED, not an anonymous tally");
  assert.equal(crowds[0].class_counts["5"].total_hits, 700);
  assert.equal(crowds[0].covered_by, undefined, "no key invented where the block carries none");
  assert.deepEqual(crowds[1].covered_by,
    ["incumbent-class:default:glimmer+owner-aurora", "incumbent-class:default:lumengarde+owner-aurora"],
    "the count descriptor's slice pointers survive intact, never only inside reason.slice(0,400)");
  assert.equal(crowds[1].class_counts, undefined);
  assert.equal(bandRecords(band).length, 1, "rescue-carried records still join the enumerated stream");
});

test("parseNamedBand: a legacy incomplete block (no term_counts/records) parses exactly as before", () => {
  const band = parseNamedBand(BAND);
  assert.equal(bandCrowds(band)[0].term_counts, undefined, "no key invented on old bands");
  assert.equal(bandCrowds(band)[0].class_counts, undefined, "no key invented on old bands");
  assert.equal(bandRecords(band).length, 2, "nothing harvested from a records-less crowd");
});

// ── copper-lattice T0: taint quarantine of self-reported-clean judgment blocks ─────────────────────────
test("taintQuarantineCleanBlocks: qid-less enumerated-with-zero-records → honest incomplete; tool/record blocks untouched; idempotent", async () => {
  const { taintQuarantineCleanBlocks } = await import("../named-band.mjs");
  const band = JSON.stringify([
    { state: "enumerated", query: "supplemental FROSTBERRY|ICEBERRY", total_hits: 0, records: [] },      // the false clean — quarantined
    { state: "enumerated", qid: "primary-sweep:exact:novapulse", query: "exact NOVAPULSE", total_hits: 2, records: [] },  // qid-stamped — tool-written, never touched
    { state: "enumerated", query: "exact KEEPME", total_hits: 1, records: [{ record_id: "/mark/us/1" }] },  // carries records — kept (recall-monotone)
    { state: "incomplete", query: "contains BIG", total_hits: 900, fetched: 0, sample: [], reason: "crowd" },  // already a descriptor
  ]);
  const { blocks, quarantined } = taintQuarantineCleanBlocks(band);
  assert.equal(quarantined.length, 1);
  assert.equal(blocks[0].state, "incomplete");
  assert.match(blocks[0].reason, /\(taint\)/);
  assert.equal(blocks[1].state, "enumerated", "qid block untouched");
  assert.equal(blocks[2].records.length, 1, "record-carrying block untouched");
  assert.equal(blocks[3].reason, "crowd", "existing descriptor untouched");
  const again = taintQuarantineCleanBlocks(JSON.stringify(blocks));
  assert.equal(again.quarantined.length, 0, "idempotent — a quarantined descriptor never re-quarantines");
});
