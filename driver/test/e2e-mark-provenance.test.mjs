// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// e2e-mark-provenance.test.mjs — pins the answer to "did this round enter the register HIT path?"
//
// Why this file exists: every mark in the E2E scenario corpus was invented, so every register call
// returned zero rows, and zero rows is the one input on which screening, close-variation matching,
// record hydration and citation fidelity all do nothing. A whole round could be green while the most
// breakable half of the register path was never entered, and nothing said so.
//
// The three things pinned here are the three ways that finding could quietly come back:
//   1. an unstated label defaulting to "synthetic" — a guess presented as a fact;
//   2. a floor op comparing an UNTAKEN count as if it were a small one, so a dead credential would
//      read as a register that had emptied out;
//   3. a records floor reading a structural REFUSAL as an empty list.
//
// FIXTURES ARE REAL SHAPES. The count and record documents below carry the field names and nesting
// that driver/register-count.mjs and driver/register-records.mjs actually write, including the
// `total: null` + `unavailable` pair and the per-term `ok`/`reason` pair. The mark names are the
// corpus's own or plainly invented; no production matter appears here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { driverDir } from "../../shared/driver-dir.mjs";

import { evalAssertion, markProvenanceOf, registerCountsWitness, MARK_PROVENANCE } from "../../scripts/e2e.mjs";

const runDirWith = (files) => {
  const d = mkdtempSync(join(tmpdir(), "e2e-markprov-"));
  mkdirSync(driverDir(d, ""), { recursive: true });
  for (const [name, doc] of Object.entries(files)) writeFileSync(driverDir(d, name), JSON.stringify(doc, null, 2));
  return d;
};

const counts = (marks) => ({ schema: 1, provider: "clarivate", takenAt: "2026-08-25T00:00:00.000Z", marks });
const records = (extra) => ({ schema: 1, provider: "clarivate", takenAt: "2026-08-25T00:00:00.000Z", ...extra });

// ── the label, and its third state ───────────────────────────────────────────────────────────────────

test("a stated label is read as stated", () => {
  assert.equal(markProvenanceOf({ markProvenance: "live" }).state, MARK_PROVENANCE.LIVE);
  assert.equal(markProvenanceOf({ markProvenance: "synthetic" }).state, MARK_PROVENANCE.SYNTHETIC);
});

test("AN UNSTATED LABEL IS NEVER SYNTHETIC — it is UNSTATED, and it says so", () => {
  for (const sc of [{}, { markProvenance: null }, { markProvenance: "" }, { markProvenance: "  " }]) {
    const mp = markProvenanceOf(sc);
    assert.equal(mp.state, MARK_PROVENANCE.UNSTATED,
      `${JSON.stringify(sc)} must not resolve to a state the store never claimed`);
    assert.match(mp.why, /CANNOT BE TOLD/);
  }
});

test("a label that is neither word is UNSTATED and quotes what it found", () => {
  const mp = markProvenanceOf({ markProvenance: "real" });
  assert.equal(mp.state, MARK_PROVENANCE.UNSTATED);
  assert.match(mp.why, /"real"/);
});

// ── the run's own corroboration ──────────────────────────────────────────────────────────────────────

test("an UNTAKEN count is not a zero — the witness counts the two separately", () => {
  const d = runDirWith({ "register-counts.json": counts([{ name: "ORBIT",
    counts: { identical: { total: null, unavailable: "the credential was refused" }, containing: { total: 0 } } }]) });
  const w = registerCountsWitness([d]);
  assert.equal(w.cells, 2);
  assert.equal(w.taken, 1, "only the cell carrying a number was taken");
  assert.equal(w.untaken, 1);
  assert.equal(w.nonZero, 0);
  rmSync(d, { recursive: true, force: true });
});

test("the witness reports no sidecar rather than an empty register", () => {
  const d = mkdtempSync(join(tmpdir(), "e2e-markprov-"));
  assert.deepEqual(registerCountsWitness([d]), { sidecars: 0, cells: 0, taken: 0, nonZero: 0, untaken: 0, best: 0 });
  rmSync(d, { recursive: true, force: true });
});

// ── register-count-floor ─────────────────────────────────────────────────────────────────────────────

test("register-count-floor passes ABOVE the floor and reports what it saw", () => {
  const d = runDirWith({ "register-counts.json": counts([{ name: "ORBIT",
    counts: { identical: { total: 97 }, containing: { total: 601 } } }]) });
  const r = evalAssertion({ op: "register-count-floor", path: "_driver/register-counts.json:ORBIT",
    value: { identical: 45, containing: 250 } }, d);
  assert.equal(r.ok, true);
  assert.match(r.saw, /identical=97/);
  rmSync(d, { recursive: true, force: true });
});

test("register-count-floor FAILS below the floor without proposing a lower one", () => {
  const d = runDirWith({ "register-counts.json": counts([{ name: "ORBIT", counts: { identical: { total: 12 } } }]) });
  const r = evalAssertion({ op: "register-count-floor", path: "_driver/register-counts.json:ORBIT",
    value: { identical: 45 } }, d);
  assert.equal(r.ok, false);
  assert.match(r.saw, /below the floor/);
  rmSync(d, { recursive: true, force: true });
});

test("AN UNTAKEN COUNT FAILS AS UNTAKEN, never as a number below the floor", () => {
  const d = runDirWith({ "register-counts.json": counts([{ name: "ORBIT",
    counts: { identical: { total: null, unavailable: "no register credential in scope" } } }]) });
  const r = evalAssertion({ op: "register-count-floor", path: "_driver/register-counts.json:ORBIT",
    value: { identical: 45 } }, d);
  assert.equal(r.ok, false);
  assert.match(r.saw, /NOT TAKEN/);
  assert.match(r.saw, /no register credential in scope/);
  assert.doesNotMatch(r.saw, /below the floor/,
    "a count that was never taken must not be reported as a register that has thinned out");
  rmSync(d, { recursive: true, force: true });
});

test("register-count-floor fails when the sidecar is absent — nothing written is not nothing found", () => {
  const d = mkdtempSync(join(tmpdir(), "e2e-markprov-"));
  const r = evalAssertion({ op: "register-count-floor", path: "_driver/register-counts.json:ORBIT", value: { identical: 45 } }, d);
  assert.equal(r.ok, false);
  assert.match(r.saw, /absent/);
  rmSync(d, { recursive: true, force: true });
});

test("register-count-floor names the marks it did count when the asked-for one is missing", () => {
  const d = runDirWith({ "register-counts.json": counts([{ name: "SOMETHING ELSE", counts: { identical: { total: 9 } } }]) });
  const r = evalAssertion({ op: "register-count-floor", path: "_driver/register-counts.json:ORBIT", value: { identical: 45 } }, d);
  assert.equal(r.ok, false);
  assert.match(r.saw, /SOMETHING ELSE/);
  rmSync(d, { recursive: true, force: true });
});

// ── register-records-floor ───────────────────────────────────────────────────────────────────────────

const rec = (territory, n) => Array.from({ length: n }, (_, i) => ({ recordId: `/mark/${territory}/${i}`, territory, mark: "ORBIT" }));

test("register-records-floor passes on enough rows across enough offices", () => {
  const d = runDirWith({ "register-records.json": records({ marks: [{ name: "ORBIT",
    terms: [{ term: "ORBIT", basis: "identical", ok: true, fetched: 33, total: 97 }],
    records: [...rec("us", 17), ...rec("em", 22), ...rec("wo", 1)] }] }) });
  const r = evalAssertion({ op: "register-records-floor", path: "_driver/register-records.json:ORBIT",
    value: { records: 20, offices: 2 } }, d);
  assert.equal(r.ok, true);
  assert.match(r.saw, /3 office\(s\)/);
  rmSync(d, { recursive: true, force: true });
});

test("ENOUGH ROWS FROM ONE OFFICE IS NOT ENOUGH — the office span is its own floor", () => {
  const d = runDirWith({ "register-records.json": records({ marks: [{ name: "ORBIT",
    terms: [{ term: "ORBIT", basis: "identical", ok: true, fetched: 40, total: 97 }], records: rec("us", 40) }] }) });
  const r = evalAssertion({ op: "register-records-floor", path: "_driver/register-records.json:ORBIT",
    value: { records: 20, offices: 2 } }, d);
  assert.equal(r.ok, false, "one office satisfying a total would let the dedup property lapse in silence");
  rmSync(d, { recursive: true, force: true });
});

test("A REFUSED LISTING FAILS AS A REFUSAL, never as a register holding nothing", () => {
  const d = runDirWith({ "register-records.json": records({
    unavailable: "this run counted from fixtures and no record fixtures are configured", marks: [] }) });
  const r = evalAssertion({ op: "register-records-floor", path: "_driver/register-records.json:ORBIT",
    value: { records: 20, offices: 2 } }, d);
  assert.equal(r.ok, false);
  assert.match(r.saw, /never listed/);
  assert.match(r.saw, /not a register that holds nothing/);
  rmSync(d, { recursive: true, force: true });
});

test("a failed term is named even when the floor is MET — it is reduced coverage either way", () => {
  const d = runDirWith({ "register-records.json": records({ marks: [{ name: "ORBIT",
    terms: [{ term: "ORBIT", basis: "identical", ok: true, fetched: 40, total: 97 },
            { term: "ORBYT", basis: "close", ok: false, reason: "the register timed out" }],
    records: [...rec("us", 20), ...rec("em", 20)] }] }) });
  const r = evalAssertion({ op: "register-records-floor", path: "_driver/register-records.json:ORBIT",
    value: { records: 20, offices: 2 } }, d);
  assert.equal(r.ok, true);
  assert.match(r.saw, /ORBYT/, "a pass that hides a refused term is how reduced coverage reads as full coverage");
  rmSync(d, { recursive: true, force: true });
});

test("a shortfall alongside a failed term says the fetch may be the cause", () => {
  const d = runDirWith({ "register-records.json": records({ marks: [{ name: "ORBIT",
    terms: [{ term: "ORBIT", basis: "identical", ok: false, reason: "HTTP 503" }], records: [] }] }) });
  const r = evalAssertion({ op: "register-records-floor", path: "_driver/register-records.json:ORBIT",
    value: { records: 20, offices: 2 } }, d);
  assert.equal(r.ok, false);
  assert.match(r.saw, /FAILED to fetch/);
  rmSync(d, { recursive: true, force: true });
});

// ── the clearance lane's counterparts: band-count-floor, band-records-floor ───────────────────────────
//
// The two ops above read files only the KNOCKOUT lane writes, so a clearance scenario asserting them is
// told its register lane wrote nothing while the lane in fact recorded a dense band under other names.
// These two read the record the clearance lane does keep, `_driver/band-shape.json`.
//
// THE FIXTURE IS THE REAL SHAPE, down to the three populations that are easy to conflate: `totals.records`
// is the whole in-scope band, `totals.by_tier` counts every record in it, and
// `floors.in_class_identical_or_near` is the narrower live in-class list. Every arm below states which
// one it is about, because an arm that reads a number off the wrong population passes for the wrong reason.

const bandShape = ({ targets = ["CORE", "KORE"], records = 1554, byTier = {}, floors = [], blindSpots = [], ...rest } = {}) => ({
  schema_version: 1,
  targets,
  in_scope_classes: ["9"],
  totals: { records, crowds: 22,
    by_tier: { identical: 245, "near-identical": 226, "same-family": 173, other: 910, unclassifiable: 0, ...byTier } },
  floors: { in_class_identical_or_near: floors },
  by_registry: { EM: 471, US: 1047, WO: 36 },
  blind_spots: blindSpots,
  ...rest,
});

const floorRows = (registry, n, from = 0) => Array.from({ length: n }, (_, i) => ({
  record_id: `/mark/${registry.toLowerCase()}/FIXTURE${from + i}`, mark_text: "CORE", tier: "identical",
  matched_target: "CORE", basis: "normalized-equal", classes: ["9"], status: "REGISTERED", live: true,
  owner_name: "An Owner", registry,
}));

const P = "_driver/band-shape.json:CORE";
const drive = (op, value, doc, path = P) => {
  const d = runDirWith({ "band-shape.json": doc });
  try { return evalAssertion({ op, path, value }, d); } finally { rmSync(d, { recursive: true, force: true }); }
};

test("band-count-floor passes above the floor and says which population each number came from", () => {
  const r = drive("band-count-floor", { records: 1000, by_tier: { identical: 54 } }, bandShape());
  assert.equal(r.ok, true);
  assert.match(r.saw, /1554 record\(s\) in the whole in-scope band/);
  assert.match(r.saw, /245 record\(s\) tiered identical across the whole band/);
});

test("band-count-floor FAILS below the floor without proposing a lower one", () => {
  const r = drive("band-count-floor", { records: 1000 }, bandShape({ records: 41 }));
  assert.equal(r.ok, false);
  assert.match(r.saw, /below the floor of 1000/);
  assert.doesNotMatch(r.saw, /lower the floor to/);
});

test("AN UNSIZED BAND IS NOT A SMALL ONE — four ways it can be unsized, four refusals", () => {
  // Each of these would compare as zero under a floor op that reached for a number without asking
  // whether one was taken, and a dead derivation would then read as a register that had emptied out.
  const d = mkdtempSync(join(tmpdir(), "e2e-markprov-"));
  mkdirSync(driverDir(d, ""), { recursive: true });
  const absent = evalAssertion({ op: "band-count-floor", path: P, value: { records: 1000 } }, d);
  assert.equal(absent.ok, false);
  assert.match(absent.saw, /not a register that holds nothing/);
  rmSync(d, { recursive: true, force: true });

  const noTotals = drive("band-count-floor", { records: 1000 }, { schema_version: 1, targets: ["CORE"], floors: { in_class_identical_or_near: [] } });
  assert.equal(noTotals.ok, false);
  assert.match(noTotals.saw, /never sized/);

  const nullTotal = drive("band-count-floor", { records: 1000 }, bandShape({ records: null }));
  assert.equal(nullTotal.ok, false);
  assert.match(nullTotal.saw, /NOT TAKEN/);

  const noTiers = drive("band-count-floor", { by_tier: { identical: 54 } },
    { schema_version: 1, targets: ["CORE"], totals: { records: 1554 }, floors: { in_class_identical_or_near: [] } });
  assert.equal(noTiers.ok, false);
  assert.match(noTiers.saw, /never tiered/);
});

test("A TIER THAT DOES NOT EXIST IS REFUSED, never compared against a missing key", () => {
  const r = drive("band-count-floor", { by_tier: { identicle: 10 } }, bandShape());
  assert.equal(r.ok, false, "an unknown tier read as undefined would compare as a band holding none of it");
  assert.match(r.saw, /NO SUCH TIER/);
  assert.match(r.saw, /near-identical/, "the refusal lists the tiers that do exist, or nobody can fix the typo");
});

test("a floor key nothing reads is REFUSED rather than ignored — both ops", () => {
  // The store is another repository, so a mistyped key is written without this file's author seeing it.
  // Ignored, it makes a scenario that asserts nothing and reports a pass.
  const c = drive("band-count-floor", { recrods: 1000 }, bandShape());
  assert.equal(c.ok, false);
  assert.match(c.saw, /unknown floor key\(s\) "recrods"/);
  const rr = drive("band-records-floor", { offices: 2, ofice: 3 }, bandShape({ floors: floorRows("US", 40) }));
  assert.equal(rr.ok, false);
  assert.match(rr.saw, /unknown floor key\(s\) "ofice"/);
});

test("band-count-floor states nothing when asked for nothing, and says so", () => {
  const r = drive("band-count-floor", {}, bandShape());
  assert.equal(r.ok, false);
  assert.match(r.saw, /no floor stated/);
});

test("band-records-floor passes on enough rows across enough offices", () => {
  const r = drive("band-records-floor", { records: 20, offices: 2 },
    bandShape({ floors: [...floorRows("EM", 147), ...floorRows("US", 127, 147), ...floorRows("WO", 15, 274)] }));
  assert.equal(r.ok, true);
  assert.match(r.saw, /289 live in-class identical\/near-identical floor row\(s\)/);
  assert.match(r.saw, /3 office\(s\) \[em, us, wo\]/);
});

test("BOTH PROPERTIES COME OUT OF THE FLOOR LIST, never off the band-wide registry table", () => {
  // The fixture's `by_registry` spans three offices while every floor row is one. Reading the span from
  // that table would report a multi-office band whose whole floor was EM — the total-only fail-open the
  // knockout records floor exists to refuse, reproduced one lane over.
  const doc = bandShape({ floors: floorRows("EM", 40) });
  assert.equal(Object.keys(doc.by_registry).length, 3, "the fixture must offer the wider field, or this arm proves nothing");
  const r = drive("band-records-floor", { records: 20, offices: 2 }, doc);
  assert.equal(r.ok, false);
  assert.match(r.saw, /1 office\(s\) \[em\]/);
});

test("THE TWO OPS READ DIFFERENT POPULATIONS — a sized band with an empty floor list proves it", () => {
  // If one op's fixture satisfied the other, both would be decoration. This one passes the count floor
  // on 1554 in-scope records and fails the records floor on the list that is empty beside it.
  const doc = bandShape({ floors: [] });
  assert.equal(drive("band-count-floor", { records: 1000 }, doc).ok, true);
  const r = drive("band-records-floor", { records: 20, offices: 2 }, doc);
  assert.equal(r.ok, false);
  assert.match(r.saw, /0 live in-class/);
});

test("A MISSING FLOOR LIST IS NOT AN EMPTY ONE", () => {
  const doc = bandShape();
  delete doc.floors;                                  // the derivation fell over before it wrote the list
  const r = drive("band-records-floor", { records: 20 }, doc);
  assert.equal(r.ok, false);
  assert.match(r.saw, /complete by construction was never written/);
  assert.match(r.saw, /not a band holding no identical marks/);
});

test("the office comes off the row, from the registry or the record id, and a row with neither is counted", () => {
  const rows = [...floorRows("EM", 3), ...floorRows("US", 3).map((r) => ({ ...r, registry: "unknown" })),
    { record_id: null, mark_text: "CORE", tier: "identical", registry: null }];
  const r = drive("band-records-floor", { records: 5, offices: 2 }, bandShape({ floors: rows }));
  assert.equal(r.ok, true, "the id carries the office the registry field lost");
  assert.match(r.saw, /\[em, us\]/);
  assert.match(r.saw, /1 row\(s\) carry no office/, "a row nobody can place must narrow what this op claims, not vanish");
});

test("A REFUSED SLICE QUALIFIES A PASS AND MAY EXPLAIN A MISS", () => {
  const spots = [{ kind: "refused-slice", count: 2, detector: "a slice the register refused" }];
  const pass = drive("band-count-floor", { records: 1000 }, bandShape({ blindSpots: spots }));
  assert.equal(pass.ok, true);
  assert.match(pass.saw, /covered less than it asked for/, "a pass that hides a refusal reads as full coverage");
  const miss = drive("band-count-floor", { records: 1000 }, bandShape({ records: 41, blindSpots: spots }));
  assert.equal(miss.ok, false);
  assert.match(miss.saw, /may be what it would not answer/);
});

test("AN UNENUMERATED CROWD EXCUSES NOTHING — it is evidence of size, not a gap in it", () => {
  // The register stated a total LARGER than what was fetched. A dense band carries these by
  // construction, so letting them soften a shortfall would make every real thinning report for ever as
  // "the register may not have answered", which is this whole issue's defect wearing the other face.
  const spots = [{ kind: "unenumerated-crowd", count: 19, read_depth: [200] }];
  const miss = drive("band-count-floor", { records: 1000 }, bandShape({ records: 41, blindSpots: spots }));
  assert.equal(miss.ok, false);
  assert.doesNotMatch(miss.saw, /may be what it would not answer/, "a stated total above what was fetched is not the register declining to answer");
  assert.match(miss.saw, /NOT a reason to lower the floor/);
  assert.match(miss.saw, /read 200 deep/, "the depth actually read is the actionable half, so it is named");
});

test("THE MARK IS CHECKED AGAINST THE SHAPE'S TARGETS, and a mismatch says so in its own words", () => {
  // "the store's mark moved" and "the register thinned" need opposite answers, so they must not share
  // a sentence. Membership, not position: the driver puts the job's mark in the list and the variant
  // lane owns the order, so pinning to the first entry would fire when only the ordering moved.
  const later = drive("band-count-floor", { records: 1000 }, bandShape({ targets: ["KORE", "CORE"] }));
  assert.equal(later.ok, true, "the mark is in the list; where the variant lane put it is not this op's business");
  const other = drive("band-count-floor", { records: 1000 }, bandShape({ targets: ["ORBIT"] }));
  assert.equal(other.ok, false);
  assert.match(other.saw, /targets that do not include "CORE"/);
  assert.doesNotMatch(other.saw, /below the floor/);
  const none = drive("band-count-floor", { records: 1000 }, bandShape({ targets: [] }));
  assert.equal(none.ok, false);
  assert.match(none.saw, /carries no targets/);
});
