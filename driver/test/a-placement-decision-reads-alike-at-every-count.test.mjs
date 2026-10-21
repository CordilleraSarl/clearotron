// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A PLACEMENT DECISION READS ALIKE AT EVERY COUNT THAT READS IT.
//
// Placement gives every line the shape lists one fate: placed, set aside by name, covered by its group's one
// row, or none. Four counts read that fate afterwards, each for its own reader: the form says back what a
// group row covers; the fate count tallies every line; the floor duty answers every floor; and the record
// ledger writes down, per record, the ground it left the picking step with, which the carry trace and the
// delivered audit's open doubts are built from. A ground the ledger gives a record must be one the form
// gave its line, or the trace shows a reason nobody gave. These arms drive the real chain over one invented
// band and hold the four to one answer, line by line and record by record. Every mark and owner is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBandShape, deriveRegisterPositions } from "../band-shape.mjs";
import { buildSelectionIndex, setAsideGrounds, setAsideKeysOf, ownerFates, renderPlacementsJson, lineKey, parsePlacementForm } from "../placement-form.mjs";
import { unionPlacementForm } from "../placement-union.mjs";
import { reconcileFloorDuty } from "../floor-duty.mjs";
import { goodsWordCounter, goodsWordsMatched } from "../record-goods.mjs";
import { placementSeamReason } from "../pipeline.mjs";
import { seamRows, foldDiscardLedger, ledgerEnding } from "../record-discard.mjs";
import { traceRecordCarry } from "../record-carry.mjs";

const rec = (id, mark, owner, jur, extra = {}) => ({ record_id: `/mark/${jur.toLowerCase()}/${id}`, mark_text: mark, owner_name: owner,
  classes: ["9"], status: "registered", jurisdictions: [jur], ...extra });
// The client's goods word is "joysticks". Each record's goods, where the run holds them.
const BAND = [
  rec("a1", "QZORVAK", "Alpha Ltd", "EU"),                                   // (a), a floor: placed
  rec("a2", "Plimbo", "Alpha Ltd", "EU"),                                    // (d): set aside by name
  rec("k1", "QZORVAK", "Ostrel Labs (UK branch)", "GB"),                     // (a), a floor: placed
  rec("k2", "QZORVAK", "Ostrel Labs", "US", { status: "cancelled" }),        // the same line as k1, another position, not placed
  rec("m1", "QZORVAK", "Omega Ltd", "EU"),                                   // (b), a floor
  rec("m2", "QZORVAK", "Omega Ltd", "US", { status: "expired" }),            // the same position as m1, not a floor
  rec("b1", "Qzorvak", "Beta GmbH", "EU"),                                   // (b), a floor
  rec("d1", "Plimbo", "Gamma SA", "EU"),                                     // (d): its group's row covers it
  rec("r1", "Drellux", "Delta AG", "EU"),                                    // the rest
  rec("r2", "Plimbo", "Eta Kft", "EU", { classes: ["31"], status: "expired" }),   // the rest
  rec("u1", "QZORVAK", "Zeta BV", "EU"),                                     // no goods on file, a floor
];
const GOODS = { a1: "joysticks", a2: "joysticks", k1: "joysticks", k2: "joysticks", m1: "printers", m2: "printers",
  b1: "printers", d1: "joysticks", r1: "printers", r2: "seeds" };

function chain(submitted) {
  const positions = deriveRegisterPositions(BAND);
  const goods = {
    of: (r) => { const t = GOODS[r.record_id.split("/").pop()]; return t ? [{ classes: r.classes, text: t }] : null; },
    hits: goodsWordCounter(["joysticks"]), matched: goodsWordsMatched(["joysticks"]),
  };
  const { shape } = buildBandShape({ enumerated: BAND }, { targets: ["Qzorvak"], inScopeClasses: ["9"], positions, goods,
    keysOf: setAsideKeysOf(positions.positions) });
  // The step read every line the shape lists.
  const read = ["a", "b", "c", "d", "rest", "no_goods"].flatMap((g) => shape.groups[g].list.map((l) => l.key));
  const input = { floors: shape.floors.in_class_identical_or_near, positions: positions.positions, groups: shape.groups,
    served: { lines: new Set(read), records: new Set() } };
  const counts = (g) => shape.groups[g].records;
  const rows = typeof submitted === "function" ? submitted(counts) : submitted;
  const u = unionPlacementForm(null, { rows }, input);
  const entries = parsePlacementForm(JSON.stringify(u.form)).set_aside;
  const placements = renderPlacementsJson(u.form.rows).placements;
  const placedUris = placements.flatMap((p) => p.records);
  const index = buildSelectionIndex(input);
  const groundOf = setAsideGrounds(entries, index, input.groups, input.floors, { placedUris });
  const fates = ownerFates({ groups: input.groups, entries, index, placedUris });
  const duty = reconcileFloorDuty({ floors: input.floors, placements, setAsideGroundOf: groundOf });
  const ledgerRows = seamRows({ seam: "placement", stage: "placement-inquiry", completed: true,
    saw: BAND.map((r) => ({ uri: r.record_id })), carried: placedUris.map((uri) => ({ uri })), reasonFor: placementSeamReason(groundOf) });
  const ledger = foldDiscardLedger(ledgerRows.map((r) => JSON.stringify(r)).join("\n"));
  const trace = traceRecordCarry({ bandRecords: BAND, placements, ledger });
  return { shape, input, index, u, placements, placedUris, groundOf, fates, duty, ledgerRows, trace };
}

const ROWS = (n) => [
  { select: "/mark/eu/a1", tier: "headline-candidate", reason: "identical, live, for the client's own goods" },
  { select: "/mark/gb/k1", tier: "sheet-2", reason: "identical, live in the United Kingdom, for joysticks" },
  { set_aside: "/mark/eu/a2", ground: "a different product, sold only to farmers" },
  { set_aside_group: "a", count: n("a"), ground: "identical marks for the client's goods, each answered above" },
  { set_aside_group: "b", count: n("b"), ground: "identical marks in the class for goods unrelated to the client's" },
  { set_aside_group: "d", count: n("d"), ground: "other marks for the client's goods that a lawyer would not raise" },
  { set_aside_group: "rest", count: n("rest"), ground: "similar to none of the mark's forms, or not live" },
];

test("every line holds one fate, and the fate count adds up and says so", () => {
  const { fates, u } = chain(ROWS);
  assert.equal((u.form.set_aside_group_refused ?? []).length, 0, "guard: every group row was taken");
  assert.deepEqual({ lines: fates.lines, placed: fates.placed, by_name: fates.by_name, by_group: fates.by_group, unfated: fates.unfated },
    { lines: 9, placed: 2, by_name: 1, by_group: 3, unfated: 3 });
  assert.equal(fates.reconciles, true, "the four fates sum to the lines, and the count says so rather than leaving a reader to add them");
  for (const [list, c] of Object.entries(fates.by_list)) {
    assert.equal(c.lines, c.placed + c.by_name + c.by_group + c.unfated, `${list}: one fate per line`);
    assert.equal(c.reconciles, true, `${list}: the list's own sum is stated`);
  }
});

test("a record leaves the picking step with the ground its line was given, and with none where its line has none", () => {
  const { fates, trace, input, index, placedUris } = chain(ROWS);
  const fateOf = new Map();
  for (const [list, lines] of Object.entries({ a: input.groups.a.list, b: input.groups.b.list, c: input.groups.c.list, d: input.groups.d.list,
    rest: input.groups.rest.list, no_goods: input.groups.no_goods.list })) for (const l of lines) fateOf.set(l.key, { list });
  for (const x of fates.unfated_lines) fateOf.get(x.key).fate = "unfated";
  const placedLines = new Set(placedUris.map((u) => lineKey(index.resolve(u))));
  const byUri = new Map(trace.rows.map((r) => [r.uri, r]));
  for (const r of BAND) {
    const key = lineKey(index.resolve(r.record_id));
    const row = byUri.get(r.record_id);
    const at = `${r.mark_text} / ${r.owner_name} (${r.record_id})`;
    if (placedUris.includes(r.record_id)) { assert.notEqual(row.stopped_at, "placement", `${at} was placed`); continue; }
    if (placedLines.has(key)) {
      assert.equal(row.reason, "placement:not-selected",
        `${at}: its line was placed through another of its positions, so no group row covers it, and the ledger gave it the group's ground`);
      continue;
    }
    if (fateOf.get(key)?.fate === "unfated") {
      assert.equal(row.reason, "placement:not-selected",
        `${at}: its line holds a floor the group's row cannot answer, so the line has no fate, and the ledger gave this record the group's ground`);
      continue;
    }
    assert.equal(row.reason, "placement:set-aside", `${at} carries its line's ground`);
  }
});

test("the floor duty answers each floor exactly as its line's fate does", () => {
  const { duty, fates } = chain(ROWS);
  const by = Object.fromEntries(duty.rows.map((r) => [r.record_id, r.disposition]));
  assert.deepEqual(by, { "/mark/eu/a1": "accounted", "/mark/gb/k1": "accounted", "/mark/eu/m1": "unanswered", "/mark/eu/b1": "unanswered", "/mark/eu/u1": "unanswered" });
  assert.equal(duty.undischarged_by_seat, fates.unfated, "each unfated line here holds one floor the duty still owes");
});

test("a line placed through one position is placed: the group's row covers neither it nor its other positions", () => {
  const { u, groundOf } = chain(ROWS);
  const a = u.form.set_aside_groups.find((g) => g.set_aside_group === "a");
  assert.equal(a.covers_lines, 0, "guard: the form says (a)'s row covers no line");
  assert.equal(groundOf("/mark/us/k2"), null, "the cancelled US position of the placed Ostrel line took (a)'s ground");
});

test("a line holding a floor that its group's row cannot answer has no fate, and none of its records takes the row's ground", () => {
  const { u, groundOf } = chain(ROWS);
  const b = u.form.set_aside_groups.find((g) => g.set_aside_group === "b");
  assert.deepEqual([b.covers_lines, [...b.floors_not_covered].sort()], [0, ["/mark/eu/b1", "/mark/eu/m1"]],
    "guard: the form says (b)'s row covers no line and names both floor lines");
  assert.equal(groundOf("/mark/eu/m1"), null, "the floor itself has no ground");
  assert.equal(groundOf("/mark/us/m2"), null, "the expired record on the same line took (b)'s ground though the line has no fate");
});

test("without the placed records, a group's row still answers only the lines it covers", () => {
  // A caller that does not say what was placed keeps the earlier answer for a placed line's other positions,
  // and still never gives a floor line's records a ground its group's row cannot give.
  const { input, index, u } = chain(ROWS);
  const entries = parsePlacementForm(JSON.stringify(u.form)).set_aside;
  const groundOf = setAsideGrounds(entries, index, input.groups, input.floors);
  assert.equal(groundOf("/mark/us/m2"), null);
  assert.equal(groundOf("/mark/eu/d1").group, "d");
});

test("a pass skipped on a resumed run leaves the earlier pass's grounds standing, and records only what nobody had", () => {
  // A resumed run skips placement when its answer is on disk. That pass decided nothing, and the ledger keeps the
  // last row a seam wrote, so an incompletion written over the earlier pass's rows erased every ground the step gave.
  const { ledgerRows, placedUris } = chain(ROWS);
  const first = ledgerRows.map((r) => JSON.stringify(r)).join("\n");
  const skipped = seamRows({ seam: "placement", stage: "placement-inquiry", pass: 2, completed: false, skipped: true,
    prior: foldDiscardLedger(first), saw: [...BAND.map((r) => ({ uri: r.record_id })), { uri: "/mark/eu/n1" }],
    carried: placedUris.map((uri) => ({ uri })), evidence: "the pass was SKIPPED on an artifact already on disk, so it made no decision this pass" });
  const folded = foldDiscardLedger([first, ...skipped.map((r) => JSON.stringify(r))].join("\n"));
  for (const uri of ["/mark/eu/a2", "/mark/eu/d1", "/mark/eu/r1", "/mark/eu/r2"])
    assert.equal(ledgerEnding(folded, uri)?.reason, "placement:set-aside", `${uri}: the skipped pass erased the ground the step gave it`);
  assert.equal(ledgerEnding(folded, "/mark/eu/b1")?.reason, "placement:not-selected", "a record the earlier pass gave no ground keeps that account");
  assert.equal(ledgerEnding(folded, "/mark/eu/n1")?.reason, "placement:stage-incomplete",
    "a record no earlier pass spoke about is still recorded as not reached by a pass that decided nothing");
  assert.equal(ledgerEnding(folded, "/mark/eu/a1"), null, "the placed record stays carried");
});
