// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// crowd-context (2026-07-22) — the counts a lawyer closes a crowd doubt with, as EVIDENCE to judgment.
// Covers: slice selection from synthetic ledger rows (material coverage-limited selected; the
// saturation-probe's count-only / off-field crowd descriptors and never-ran `deferred` rows NOT
// selected; materiality from the row's own axis/term data, never a mark rule); the orchestrator over a
// STUBBED executor (json + md carry the per-term counts and the fully-enumerated exact/near-identical
// sample; the above-cap subset ships its count, never a partial list); the non-fatal contract (executor
// throwing ⇒ null + a `crowd-context-failed` log row, never a throw to the caller); the composed md's
// EVIDENCE-ONLY voice (no decision vocabulary); and the stages seam (optional synthesis input + the
// dictation's additive fourth path). ALL fixture marks/owners/numbers are INVENTED (P0: no client data
// in git) and every test is deterministic and offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  selectCrowdSlices, buildCrowdContext, composeCrowdContext, mintSliceCountEntries, mintSliceEnumEntry,
  termAppearsIn, CROWD_ENUM_CAP, CROWD_MAX_SLICES, CROWD_CONTEXT_AXIS,
} from "../crowd-context.mjs";
import { paths, STAGES, stageInputs } from "../stages.mjs";

// ---- fixtures (all invented) ----------------------------------------------------------------------

// A frozen-plan stand-in for the invented mark GLIMMERVANE (variants GLIMERVANE / GLIM*).
const PLAN = {
  nice_classes: ["9", "41"],
  regions: ["EU", "CH"],
  entries: [
    { qid: "q-exact-glimmervane", axis: "primary-sweep", predicate: "exact", term: "GLIMMERVANE", nice_classes: [9, 41], regions: ["EU", "CH"], expected_kind: "enumerate" },
    { qid: "q-family-orstack", axis: "primary-sweep", predicate: "default", terms: ["GLIMMERVANE", "GLIMERVANE"], nice_classes: [9, 41], regions: ["EU", "CH"], expected_kind: "enumerate" },
    { qid: "q-wild-glim", axis: "primary-sweep", predicate: "wildcard", term: "GLIM*", nice_classes: [9], regions: ["EU"], expected_kind: "enumerate" },
    { qid: "q-translit", axis: "transliteration-numeric", predicate: "default", term: "GL1MMERVANE", nice_classes: [9], regions: ["EU"], expected_kind: "enumerate" },
  ],
};
const PLAN_CTX = { entries: PLAN.entries, niceClasses: PLAN.nice_classes, regions: PLAN.regions };

// The material saturated slice — the coverage-limited shape the synthesis material path is about.
const MATERIAL_ROW = {
  axis: "primary-sweep", status: "coverage-limited",
  unit: "primary-sweep / GLIMMERVANE-formative family × cl.9 live",
  reason: "~6,400 hits — OR-stack saturated; not enumerated to has_more:false",
};

// ---- termAppearsIn: word-bounded joins, wildcard prefixes -----------------------------------------

test("termAppearsIn: word-bounded (no substring false-positives) + wildcard prefix matching", () => {
  assert.ok(termAppearsIn("GLIMMERVANE", "primary-sweep / exact-GLIMMERVANE × cl.9"), "hyphen/× punctuation tokenizes away");
  assert.ok(!termAppearsIn("ION", "coded goods slice"), "a term never joins as a bare substring of another word");
  assert.ok(termAppearsIn("GLIM*", "the GLIMMERVANE family stack"), "trailing-wildcard term prefix-matches row tokens");
  assert.ok(!termAppearsIn("ZORVEX*", "the GLIMMERVANE family stack"), "an unrelated wildcard joins nothing");
  assert.ok(termAppearsIn("NOVA PULSE", "exact NOVA PULSE cl.9 live"), "multi-word terms match as a contiguous token run");
});

// ---- selectCrowdSlices ----------------------------------------------------------------------------

test("selectCrowdSlices: a material coverage-limited slice is selected with the plan's own terms/classes", () => {
  const { selected, skipped } = selectCrowdSlices([MATERIAL_ROW], PLAN_CTX);
  assert.equal(selected.length, 1);
  assert.equal(skipped.length, 0);
  const s = selected[0];
  assert.equal(s.axis, "primary-sweep");
  // term join comes from the ROW'S OWN text against the plan entries — GLIMMERVANE appears in the unit
  // (word-bounded) and GLIM* prefix-matches it; GLIMERVANE appears nowhere in the row so it does NOT join
  // (materiality/terms from the row's data, never an invented or hardcoded expansion).
  assert.ok(s.terms.includes("GLIMMERVANE"));
  assert.ok(s.terms.includes("GLIM*"), "a wildcard plan term joins by prefix");
  assert.ok(!s.terms.includes("GLIMERVANE"), "an OR-stack sibling the row never names does not join by term text");
  assert.deepEqual([...s.nice_classes].sort(), ["41", "9"], "classes come from the joined plan entries");
  assert.deepEqual(s.regions, ["EU", "CH"], "regions carry the frozen plan's scope");
});

test("selectCrowdSlices: a qid named verbatim in the row joins that entry's WHOLE term set", () => {
  const row = { ...MATERIAL_ROW, reason: "OR-stack q-family-orstack saturated at ~6,400 hits" };
  const { selected } = selectCrowdSlices([row], PLAN_CTX);
  assert.ok(selected[0].terms.includes("GLIMERVANE"), "the qid join (strongest, machine-written) carries every term of the entry");
});

test("selectCrowdSlices: count-only/off-field crowd descriptors and non-qualifying statuses are NOT selected", () => {
  const rows = [
    // the saturation-probe's macro count descriptor — coverage-limited BY DEFINITION, never the named band
    { axis: "saturation-probe", status: "coverage-limited", unit: "saturation-probe / GLIM element-solo", reason: "count-only context probe (12,000 live) — enumerates nothing" },
    // deferred = the search never ran / never reached its data — no live count closes it affirmatively
    { axis: "primary-sweep", status: "deferred", unit: "primary-sweep / NZ (material)", reason: "scoped sub-query not run — NOT searched" },
    // clean needs nothing
    { axis: "primary-sweep", status: "confirmed-clean", unit: "primary-sweep / GLIMMERVANE worldwide", reason: "paged to has_more:false" },
  ];
  const { selected, skipped } = selectCrowdSlices(rows, PLAN_CTX);
  assert.equal(selected.length, 0, "no descriptor row and no deferred/clean row qualifies");
  assert.equal(skipped.length, 0, "these rows are out of scope, not gather failures");
});

test("selectCrowdSlices: a material coverage-limited row with NO joinable term is honestly SKIPPED (never an invented term)", () => {
  const row = { axis: "incumbent-class", status: "coverage-limited", unit: "incumbent-class / broad incumbent field", reason: "yielded to ring-fenced budget" };
  const { selected, skipped } = selectCrowdSlices([row], PLAN_CTX);
  assert.equal(selected.length, 0);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].reason, /no formative term joinable/);
});

// ---- the F2 owner lane at the join (2026-07-29) ----------------------------------------------------
// The plan now routinely carries predicate:"owner" portfolio counts and owner×formative slices on a
// MATERIAL axis (incumbent-class). The join must never turn the owner NAME into a mark-text term
// (doctrine 2: an owner name is never searched as mark text), and an owner-scoped slice must keep its
// scope — un-owned counts would describe the wider formative crowd while claiming to be the same crowd.

const OWNER_LANE_CTX = { niceClasses: ["9", "41"], regions: ["EU"], entries: [
  { qid: "ic-default-glimmervane+incumbent", axis: "incumbent-class", predicate: "default", term: "GLIMMERVANE", nice_classes: ["9"], regions: ["EU"], expected_kind: "enumerate" },
  { qid: "ic-default-glimmervane+owner-vantage", axis: "incumbent-class", predicate: "default", term: "GLIMMERVANE", owner: "Vantage Orchard Inc.", nice_classes: ["9"], regions: ["EU"], expected_kind: "enumerate" },
  { qid: "ic-owner-vantage+watch", axis: "incumbent-class", predicate: "owner", term: "Vantage Orchard Inc.", nice_classes: ["9"], regions: ["EU"], expected_kind: "count", covered_by: ["ic-default-glimmervane+owner-vantage"] },
] };

test("selectCrowdSlices: a bare-owner portfolio count row is honestly SKIPPED — the owner name never becomes a mark-text term", () => {
  const row = { axis: "incumbent-class", status: "coverage-limited",
    unit: "incumbent-class / Vantage Orchard Inc. portfolio (count-only)",
    reason: "ic-owner-vantage+watch — 41,235 live records; covered record-by-record by ic-default-glimmervane+owner-vantage" };
  // NOTE the row also names the slice qid (the taught disclosure shape names qid/total_hits), so the
  // owner-scoped ENTRY joins too — the point under test is that the owner NAME itself never joins.
  const { selected, skipped } = selectCrowdSlices([row], OWNER_LANE_CTX);
  for (const s of selected) assert.ok(!s.terms.some((t) => /vantage/i.test(t)), "the owner name is never a term");
  const bare = { axis: "incumbent-class", status: "coverage-limited",
    unit: "incumbent-class / Vantage Orchard Inc. portfolio (count-only)", reason: "41,235 live records, not enumerated" };
  const r2 = selectCrowdSlices([bare], OWNER_LANE_CTX);
  assert.equal(r2.selected.length, 0, "a row joining ONLY the predicate:'owner' entry selects nothing");
  assert.equal(r2.skipped.length, 1);
  assert.match(r2.skipped[0].reason, /portfolio count is not closeable by mark-text counts/);
});

test("selectCrowdSlices: owner-scoped and un-owned joins split into SEPARATE slices; the owner scope rides the minted entries", () => {
  const row = { axis: "incumbent-class", status: "coverage-limited",
    unit: "incumbent-class / Vantage Orchard Inc. × GLIMMERVANE",
    reason: "ic-default-glimmervane+owner-vantage saturated at 700 hits in cl.9" };
  const { selected } = selectCrowdSlices([row], OWNER_LANE_CTX);
  // GLIMMERVANE word-joins the un-owned incumbent entry too — the scopes must not blend into one slice
  assert.equal(selected.length, 2);
  const owned = selected.find((s) => s.owner);
  const unowned = selected.find((s) => !s.owner);
  assert.equal(owned.owner, "Vantage Orchard Inc.");
  assert.deepEqual(owned.terms, ["GLIMMERVANE"]);
  assert.ok(unowned && !("owner" in unowned), "the un-owned group carries no owner key");
  // every minted count + the phase-2 enumerate carry the scope — the counts describe the owner's crowd
  const counts = mintSliceCountEntries(owned, 0);
  assert.ok(counts.length > 0 && counts.every((e) => e.owner === "Vantage Orchard Inc."));
  assert.equal(mintSliceEnumEntry(owned, 0).owner, "Vantage Orchard Inc.");
  const unownedCounts = mintSliceCountEntries(unowned, 1);
  assert.ok(unownedCounts.every((e) => !("owner" in e)), "un-owned slices mint scope-less entries exactly as before");
  // …and the composed artifact states the scope so the numbers cannot be read as the un-owned crowd
  const { json, md } = composeCrowdContext([{ slice: owned,
    term_counts: [{ term: "GLIMMERVANE", all_classes: 900, in_scope: 700 }],
    exact: { terms: ["GLIMMERVANE"], nice_classes: ["9"], total_hits: 3, enumerated: true, records: [], sample: [] } }]);
  assert.equal(json.slices[0].owner, "Vantage Orchard Inc.");
  assert.match(md, /Owner scope: Vantage Orchard Inc\./);
});

// ---- entry minting --------------------------------------------------------------------------------

test("mintSliceCountEntries/mintSliceEnumEntry: per-term all-classes + in-scope counts, one exact probe, dedicated axis", () => {
  const slice = { axis: "primary-sweep", unit: "u", reason: "r", terms: ["GLIMMERVANE", "GLIM*"], nice_classes: ["9", "41"], regions: ["EU"] };
  const entries = mintSliceCountEntries(slice, 0);
  assert.equal(entries.length, 5, "2 terms × (all + in-scope) + 1 exact-subset count");
  assert.ok(entries.every((e) => e.axis === CROWD_CONTEXT_AXIS), "never a register axis — these entries must not be confusable with the frozen plan");
  assert.ok(entries.every((e) => e.expected_kind === "count"), "phase 1 buys counts only");
  const all = entries.find((e) => e.qid === "crowdctx:s0-t0-glimmervane-all");
  assert.deepEqual(all.nice_classes, [], "the all-classes count carries no class restriction");
  const cls = entries.find((e) => e.qid === "crowdctx:s0-t0-glimmervane-cls");
  assert.deepEqual(cls.nice_classes, ["9", "41"]);
  const exact = entries.find((e) => e.qid === "crowdctx:s0-exact-count");
  assert.equal(exact.predicate, "exact");
  assert.deepEqual(exact.terms, ["GLIMMERVANE", "GLIM*"]);
  const en = mintSliceEnumEntry(slice, 0);
  assert.equal(en.expected_kind, "enumerate");
  assert.equal(en.qid, "crowdctx:s0-exact-enum");
});

// ---- the orchestrator over a stubbed executor -----------------------------------------------------

// A stub executor answering from a qid→block table, recording every batch it was asked to run.
const stubExecutor = (table, calls = []) => async (entries) => {
  calls.push(entries);
  return entries.map((e) => ({ qid: e.qid, state: "incomplete", total_hits: 0, fetched: 0, ...(table[e.qid] ?? {}) }));
};

const INVENTED_RECORDS = [
  { record_id: "/mark/eu/000900111", mark_text: "GLIMMERVANE", classes: ["9"], status: "Registered", owner_name: "Aurelia Skyworks AG", owner_country: "CH", jurisdictions: ["EU"] },
  { record_id: "/mark/ch/000900222", mark_text: "GLIMMERVANE STUDIO", classes: ["41"], status: "Registered", owner_name: "Brindlewood Media SARL", owner_country: "CH", jurisdictions: ["CH"] },
  { record_id: "/mark/eu/000900333", mark_text: "GLIMERVANE", classes: ["9"], status: "Pending", owner_name: "Nockturne Labs Oy", owner_country: "FI", jurisdictions: ["EU"] },
];

test("buildCrowdContext: counts + the fully-enumerated exact subset land in json AND md (stubbed executor, no network)", async () => {
  const calls = [];
  const exec = stubExecutor({
    "crowdctx:s0-t0-glimmervane-all": { total_hits: 6400 },
    "crowdctx:s0-t0-glimmervane-cls": { total_hits: 512 },
    "crowdctx:s0-t1-glim-all": { total_hits: 9100 },
    "crowdctx:s0-t1-glim-cls": { total_hits: 745 },
    "crowdctx:s0-exact-count": { total_hits: 3 },
    "crowdctx:s0-exact-enum": { state: "enumerated", total_hits: 3, fetched: 3, records: INVENTED_RECORDS },
  }, calls);
  const out = await buildCrowdContext({ ledger: [MATERIAL_ROW], planContext: PLAN_CTX, executor: exec });
  assert.ok(out, "a qualifying slice with a working lane produces the artifact");
  assert.equal(calls.length, 2, "one batched count call, one enumerate call");
  assert.ok(calls[0].every((e) => e.expected_kind === "count"));
  assert.deepEqual(calls[1].map((e) => e.qid), ["crowdctx:s0-exact-enum"], "phase 2 enumerates ONLY the count-proven-tractable subset");
  const s = out.json.slices[0];
  assert.equal(s.term_counts.find((t) => t.term === "GLIMMERVANE").all_classes, 6400);
  assert.equal(s.term_counts.find((t) => t.term === "GLIMMERVANE").in_scope, 512);
  assert.equal(s.exact_subset.enumerated, true);
  assert.equal(s.exact_subset.records.length, 3, "the dangerous category actually seen, record by record");
  assert.equal(s.exact_subset.records[0].owner_name, "Aurelia Skyworks AG");
  assert.equal(out.stats.enumerated_records, 3);
  // the md carries the same evidence in readable form
  assert.match(out.md, /6,400/);
  assert.match(out.md, /512/);
  assert.match(out.md, /GLIMMERVANE STUDIO/);
  assert.match(out.md, /FULLY enumerated/);
});

test("buildCrowdContext: an above-cap exact subset ships its COUNT (no enumerate call, never a partial list)", async () => {
  const calls = [];
  const exec = stubExecutor({
    "crowdctx:s0-t0-glimmervane-all": { total_hits: 6400 },
    "crowdctx:s0-t0-glimmervane-cls": { total_hits: 512 },
    "crowdctx:s0-t1-glim-all": { total_hits: 9100 },
    "crowdctx:s0-t1-glim-cls": { total_hits: 745 },
    "crowdctx:s0-exact-count": { total_hits: 5200 },
  }, calls);
  const out = await buildCrowdContext({ ledger: [MATERIAL_ROW], planContext: PLAN_CTX, executor: exec });
  assert.equal(calls.length, 1, "no phase-2 call — the cap bounds spend");
  const ex = out.json.slices[0].exact_subset;
  assert.equal(ex.enumerated, false);
  assert.equal(ex.total_hits, 5200);
  assert.deepEqual(ex.records, [], "an un-enumerated subset never carries a records list dressed as complete");
  assert.match(out.md, /5,200 record\(s\) — above the 200-record enumeration cap/);
});

test("buildCrowdContext: a verified-zero exact count IS the enumeration (no second call, honest empty subset)", async () => {
  const calls = [];
  const exec = stubExecutor({
    "crowdctx:s0-t0-glimmervane-all": { total_hits: 6400 },
    "crowdctx:s0-t0-glimmervane-cls": { total_hits: 512 },
    "crowdctx:s0-t1-glim-all": { total_hits: 9100 },
    "crowdctx:s0-t1-glim-cls": { total_hits: 745 },
    "crowdctx:s0-exact-count": { total_hits: 0 },
  }, calls);
  const out = await buildCrowdContext({ ledger: [MATERIAL_ROW], planContext: PLAN_CTX, executor: exec });
  assert.equal(calls.length, 1);
  assert.equal(out.json.slices[0].exact_subset.enumerated, true);
  assert.deepEqual(out.json.slices[0].exact_subset.records, []);
});

test("buildCrowdContext: executor throwing ⇒ null + a crowd-context-failed log row (non-fatal by contract)", async () => {
  const logged = [];
  const out = await buildCrowdContext({
    ledger: [MATERIAL_ROW], planContext: PLAN_CTX,
    executor: async () => { throw new Error("provider lane down"); },
    log: (row) => logged.push(row),
  });
  assert.equal(out, null, "the caller sees null-ish, never a throw");
  assert.equal(logged.length, 1);
  assert.equal(logged[0].event, "crowd-context-failed");
  assert.match(logged[0].fail, /provider lane down/);
});

test("buildCrowdContext: no qualifying slice / no executor lane ⇒ null and the lane is never dialed", async () => {
  let dialed = 0;
  const exec = async () => { dialed++; return []; };
  assert.equal(await buildCrowdContext({ ledger: [{ axis: "primary-sweep", status: "confirmed-clean", unit: "u", reason: "" }], planContext: PLAN_CTX, executor: exec }), null);
  assert.equal(dialed, 0, "nothing material to close ⇒ zero provider spend");
  assert.equal(await buildCrowdContext({ ledger: [MATERIAL_ROW], planContext: PLAN_CTX, executor: null }), null, "no lane ⇒ skip, never a crash");
});

test("buildCrowdContext: the slice cap bounds spend, never selection honesty", async () => {
  // 6 identical-shape material rows; only CROWD_MAX_SLICES get gathered
  const rows = Array.from({ length: 6 }, (_, k) => ({ ...MATERIAL_ROW, unit: `primary-sweep / GLIMMERVANE saturated slice ${k}` }));
  const table = {};
  for (let i = 0; i < CROWD_MAX_SLICES; i++) {
    table[`crowdctx:s${i}-t0-glimmervane-all`] = { total_hits: 100 + i };
    table[`crowdctx:s${i}-t0-glimmervane-cls`] = { total_hits: 10 + i };
    table[`crowdctx:s${i}-t1-glim-all`] = { total_hits: 200 + i };
    table[`crowdctx:s${i}-t1-glim-cls`] = { total_hits: 20 + i };
    table[`crowdctx:s${i}-exact-count`] = { total_hits: 0 };
  }
  const out = await buildCrowdContext({ ledger: rows, planContext: PLAN_CTX, executor: stubExecutor(table) });
  assert.equal(out.json.slices.length, CROWD_MAX_SLICES);
});

// ---- md voice: evidence only, no decision language ------------------------------------------------

test("composeCrowdContext: the md carries NO decision language — counts and records, evidence only", async () => {
  const exec = stubExecutor({
    "crowdctx:s0-t0-glimmervane-all": { total_hits: 6400 },
    "crowdctx:s0-t0-glimmervane-cls": { total_hits: 512 },
    "crowdctx:s0-t1-glim-all": { total_hits: 9100 },
    "crowdctx:s0-t1-glim-cls": { total_hits: 745 },
    "crowdctx:s0-exact-count": { total_hits: 3 },
    "crowdctx:s0-exact-enum": { state: "enumerated", total_hits: 3, fetched: 3, records: INVENTED_RECORDS },
  });
  const { md } = await buildCrowdContext({ ledger: [MATERIAL_ROW], planContext: PLAN_CTX, executor: exec });
  // the coverage/verdict vocabulary must not appear: the artifact reports, judgment decides
  for (const forbidden of [/sufficient/i, /confirmed-clean/i, /\bverdict\b/i, /\bCONDITIONAL\b/, /\bCLEAR\b/, /\bBLOCKING\b/, /coverage_judgment/])
    assert.ok(!forbidden.test(md), `md must not carry decision language: ${forbidden}`);
  assert.match(md, /evidence for the reasoning/, "the artifact names its own standing");
  assert.match(md, /no figure is a threshold/);
});

// ---- the stages seam: optional input + the additive fourth dictation path -------------------------

test("stages seam: crowd-context is a declared OPTIONAL synthesis input and the message stays byte-identical without it", () => {
  const P = paths("/RUN");
  const ins = stageInputs("synthesis", P, { axes: [] });
  assert.ok(ins.includes(P.crowdContext), "the json artifact joins the P2 staleness contract");
  assert.ok(ins.includes(P.crowdContextMd), "so does the readable mirror the dictation names");
  const base = { paths: P, job: { markName: "GLIMMERVANE", classes: [9] }, profile: {}, intakeAsks: [], framework: null };
  const off = STAGES.synthesis.message(base);
  assert.ok(!off.includes("CROWD CONTEXT (evidence"), "no artifact ⇒ no evidence directive (byte-identical message)");
  const on = STAGES.synthesis.message({ ...base, crowdContext: { slices: 2 } });
  assert.ok(on.includes("CROWD CONTEXT (evidence"));
  assert.ok(on.includes(P.crowdContext));
  assert.match(on, /never a threshold/);
});

test("dictation: the fourth (ubiquity) path is ADDITIVE — the material⇒sufficient:false path survives verbatim", () => {
  const P = paths("/RUN");
  const msg = STAGES.synthesis.message({ paths: P, job: { markName: "GLIMMERVANE", classes: [9] }, profile: {}, intakeAsks: [], framework: null });
  // the pre-existing material path is untouched
  assert.match(msg, /IS material .* → sufficient:false/s);
  // the new path licenses explicit crowded-field reasoning that NAMES the counts + the clean sample…
  assert.match(msg, /crowded-field\/ubiquity path is OPEN/);
  assert.match(msg, /NAMES those counts and the clean enumerated sample/);
  // …states verbatim that counts are evidence, never a threshold…
  assert.ok(msg.includes("The counts are evidence for the reasoning, never a threshold"));
  // …keeps sufficient:false when the sample is absent or uncleared…
  assert.match(msg, /stays sufficient:false when the enumerated exact\/near-identical sample is ABSENT/);
  // …and leaves the no-artifact world unchanged.
  assert.match(msg, /With NO crowd-context artifact on disk, the previous path stands unchanged/);
});
