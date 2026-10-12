// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A LISTED OWNER GETS A FATE, NOT A ROW.
//
// An owner the shape lists is placed, set aside by name, or covered by its group's one row, which says why
// everything in the group the step neither placed nor named is not raised with the client. These arms pin
// the row the union keeps and the ones it reports back, the ground each record leaves with, the fate count
// by list, and the floors a group row answers. The shape is built by the product from an invented band, so
// every key is the one a set-aside row reaches.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBandShape, deriveRegisterPositions } from "../band-shape.mjs";
import { buildPlacementForm, buildSelectionIndex, parsePlacementForm, setAsideGrounds, setAsideKeyOf, ownerFates, SET_ASIDE_GROUP_CONTRACT } from "../placement-form.mjs";
import { unionPlacementForm } from "../placement-union.mjs";
import { reconcileFloorDuty, SET_ASIDE_TIER } from "../floor-duty.mjs";
import { goodsWordCounter, goodsExcerpt } from "../record-goods.mjs";

const rec = (id, mark, owner, classes, extra = {}) => ({ record_id: `/mark/eu/${id}`, mark_text: mark, owner_name: owner, classes, status: "registered", ...extra });
const BAND = [
  rec("a1", "QZORVAK", "Alpha Ltd", ["9"]),                 // identical, for the goods → (a), a floor
  rec("b1", "Qzorvak", "Beta GmbH", ["9"]),                 // identical, in class, goods unrelated → (b), a floor
  rec("b2", "Qzorvak", "Gamma SA", ["9"]),                  // the same → (b), a floor
  rec("r1", "Drellux", "Delta AG", ["9"]),                  // similar to nothing, goods unrelated → the rest
  rec("r2", "Plimbo", "Eta Kft", ["31"], { status: "expired" }),
  rec("u1", "Drellux", "Zeta BV", ["9"]),                   // the rest on goods alone, goods cut → listed, not covered
];
const GOODS = { a1: "joysticks", b1: "printers", b2: "printers", r1: "printers", r2: "seeds", u1: "printers; ".repeat(40) };

function fixture() {
  const positions = deriveRegisterPositions(BAND);
  const goods = {
    of: (r) => [{ classes: r.classes, text: GOODS[r.record_id.split("/").pop()] }],
    hits: goodsWordCounter(["joysticks"]),
    line: (g) => goodsExcerpt(g, { inScopeClasses: ["9"], maxChars: 40 }),
    rowCut: (g) => Boolean(goodsExcerpt(g, { inScopeClasses: ["9"], maxChars: 100 })?.cut),
  };
  const { shape } = buildBandShape({ enumerated: BAND }, { targets: ["Qzorvak"], inScopeClasses: ["9"], positions, goods,
    ownerKeyOf: setAsideKeyOf(positions.positions) });
  return { input: { floors: shape.floors.in_class_identical_or_near, positions: positions.positions, groups: shape.groups }, shape };
}

test("the form carries the group row's contract, and the shape's groups are what a row is checked against", () => {
  const { input, shape } = fixture();
  assert.deepEqual(buildPlacementForm(input).set_aside_group_contract, SET_ASIDE_GROUP_CONTRACT);
  assert.deepEqual([shape.groups.a.owners, shape.groups.b.owners, shape.groups.rest.owners, shape.groups.unresolved.owners], [1, 2, 2, 1]);
});

test("a group row with the shape's count is kept, says how many owners it covers, and a wrong one is reported back", () => {
  const { input } = fixture();
  const u = unionPlacementForm(null, { rows: [
    { select: "/mark/eu/b1", tier: "watchlist-annex", reason: "identical in class; the owner's goods are printers, far from the client's" },
    { set_aside_group: "(b)", count: 2, ground: "identical marks in the class, for goods unrelated to the client's" },
    { set_aside_group: "rest", count: 99, ground: "similar to none of the mark's forms" },
    { set_aside_group: "c", count: 0, ground: "nothing here" },
    { set_aside_group: "e", count: 1, ground: "no such group" },
    { set_aside_group: "a", count: 1, ground: "  " },
  ] }, input);
  assert.deepEqual(u.form.set_aside_groups.map((g) => [g.set_aside_group, g.count, g.covers_owners]), [["b", 2, 1]],
    "(b) covers Gamma only: Beta is selected");
  assert.deepEqual(u.form.set_aside_group_refused.map((x) => x.set_aside_group).sort(), ["a", "c", "e", "rest"]);
  assert.match(u.form.set_aside_group_refused.find((x) => x.set_aside_group === "rest").why, /count 99 is not the shape's 2/);
  assert.equal(u.form.rows.length, 1, "a group row is never a candidate");
  // It survives the next attempt through the prior form, a later row replaces it, and `group:<name>` retracts it.
  const prior = parsePlacementForm(JSON.stringify(u.form));
  const next = unionPlacementForm(prior, { rows: [{ set_aside_group: "b", count: 2, ground: "a second ground" }] }, input);
  assert.deepEqual(next.form.set_aside_groups.map((g) => g.ground), ["a second ground"]);
  const gone = unionPlacementForm(parsePlacementForm(JSON.stringify(next.form)), { rows: [{ retract: "group:b" }] }, input);
  assert.deepEqual(gone.form.set_aside_groups, []);
});

test("a record leaves with its owner's ground by name first, else its group's, and a goods-cut owner with neither", () => {
  const { input } = fixture();
  const u = unionPlacementForm(null, { rows: [
    { set_aside: "/mark/eu/b2", ground: "the owner's printers are far from the client's goods" },
    { set_aside_group: "b", count: 2, ground: "identical in class, for unrelated goods" },
    { set_aside_group: "rest", count: 2, ground: "similar to none of the mark's forms, or not live" },
  ] }, input);
  const groundOf = setAsideGrounds(parsePlacementForm(JSON.stringify(u.form)).set_aside, buildSelectionIndex(input), input.groups);
  assert.equal(groundOf("/mark/eu/b2").by, "name");
  assert.deepEqual([groundOf("/mark/eu/b1").by, groundOf("/mark/eu/b1").group], ["group", "b"]);
  assert.equal(groundOf("/mark/eu/r2").group, "rest");
  assert.equal(groundOf("/mark/eu/u1"), null, "the rest's row does not cover an owner whose goods were cut on the row");
  assert.equal(groundOf("/mark/eu/a1"), null, "(a) has no row here, so its owner has no ground");
});

test("every owner's fate is counted by the list the shape put it in, and a group row answers its floors", () => {
  const { input } = fixture();
  const u = unionPlacementForm(null, { rows: [
    { select: "/mark/eu/a1", tier: "headline-candidate", reason: "identical, live, for the client's own goods" },
    { set_aside_group: "b", count: 2, ground: "identical in class, for unrelated goods" },
    { set_aside_group: "rest", count: 2, ground: "similar to none of the mark's forms, or not live" },
  ] }, input);
  const entries = parsePlacementForm(JSON.stringify(u.form)).set_aside;
  const index = buildSelectionIndex(input);
  const fates = ownerFates({ groups: input.groups, entries, index, placedUris: ["/mark/eu/a1"] });
  assert.deepEqual({ owners: fates.owners, placed: fates.placed, by_name: fates.by_name, by_group: fates.by_group, unfated: fates.unfated.length },
    { owners: 6, placed: 1, by_name: 0, by_group: 4, unfated: 1 });
  assert.deepEqual(fates.unfated.map((x) => x.list), ["unresolved"]);
  const duty = reconcileFloorDuty({ floors: input.floors, placements: [{ records: ["/mark/eu/a1"], tier: "headline-candidate", reason: "identical, live" }],
    setAsideGroundOf: setAsideGrounds(entries, index, input.groups) });
  assert.deepEqual([duty.totals.floors, duty.totals.accounted, duty.undischarged_by_seat], [3, 3, 0]);
  assert.equal(duty.by_tier[SET_ASIDE_TIER], 2, "the two (b) floors are answered by the group's row");
});
