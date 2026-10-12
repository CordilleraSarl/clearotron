// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A LISTED LINE GETS A FATE, NOT A ROW, AND GROUP (a) IS READ WHOLE.
//
// A line the shape lists, one mark of one owner, is placed, set aside by name, or, in (b) to (d), covered by
// its group's one row, which says why everything in the group the step neither placed nor named is not
// raised with the client. Group (a) takes no such row: it is the list her rule says to read. A ground by name
// covers the named line only where the shape lists its owner on several lines, so one mark's ground never
// sets another mark aside unseen. These arms pin the row the union keeps and the ones it reports back, the
// ground each record leaves with, the fate count by list, and the floors a group row answers. The shape is
// built by the product from an invented band, so every key is the one a set-aside row reaches.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBandShape, deriveRegisterPositions } from "../band-shape.mjs";
import { buildPlacementForm, buildSelectionIndex, parsePlacementForm, setAsideGrounds, setAsideKeysOf, ownerFates, SET_ASIDE_GROUP_CONTRACT } from "../placement-form.mjs";
import { unionPlacementForm } from "../placement-union.mjs";
import { reconcileFloorDuty, SET_ASIDE_TIER } from "../floor-duty.mjs";
import { goodsWordCounter, goodsExcerpt } from "../record-goods.mjs";

const rec = (id, mark, owner, classes, extra = {}) => ({ record_id: `/mark/eu/${id}`, mark_text: mark, owner_name: owner, classes, status: "registered", jurisdictions: ["EU"], ...extra });
const BAND = [
  rec("a1", "QZORVAK", "Alpha Ltd", ["9"]),                  // identical, for the goods → (a), a floor
  rec("a2", "Plimbo", "Alpha Ltd", ["9"]),                   // the same owner's other mark, for the goods → (d)
  rec("a3", "Drellux", "Alpha Ltd", ["31"], { status: "expired" }),   // the same owner's dead mark → the rest
  rec("b1", "Qzorvak", "Beta GmbH", ["9"]),                  // identical, in class, goods unrelated → (b), a floor
  rec("b2", "Qzorvak", "Gamma SA", ["9"]),                   // the same → (b), a floor
  rec("r1", "Drellux", "Delta AG", ["9"]),                   // similar to nothing, goods unrelated → the rest
  rec("r2", "Plimbo", "Eta Kft", ["31"], { status: "expired" }),
  rec("u1", "Drellux", "Zeta BV", ["9"]),                    // the rest on goods alone, goods cut → listed, not covered
];
const GOODS = { a1: "joysticks", a2: "joysticks", a3: "seeds", b1: "printers", b2: "printers", r1: "printers", r2: "seeds", u1: "printers; ".repeat(40) };

function fixture() {
  const positions = deriveRegisterPositions(BAND);
  const goods = {
    of: (r) => [{ classes: r.classes, text: GOODS[r.record_id.split("/").pop()] }],
    hits: goodsWordCounter(["joysticks"]), score: goodsWordCounter(["joysticks"]),
    line: (g) => goodsExcerpt(g, { inScopeClasses: ["9"], maxChars: 40 }),
    rowCut: (g) => Boolean(goodsExcerpt(g, { inScopeClasses: ["9"], maxChars: 100 })?.cut),
  };
  const { shape } = buildBandShape({ enumerated: BAND }, { targets: ["Qzorvak"], inScopeClasses: ["9"], positions, goods,
    keysOf: setAsideKeysOf(positions.positions), markets: ["EU"] });
  return { input: { floors: shape.floors.in_class_identical_or_near, positions: positions.positions, groups: shape.groups }, shape };
}
const parsed = (u) => parsePlacementForm(JSON.stringify(u.form)).set_aside;

test("the form carries the group row's contract, and the shape's lines are what a row is checked against", () => {
  const { input, shape } = fixture();
  assert.deepEqual(buildPlacementForm(input).set_aside_group_contract, SET_ASIDE_GROUP_CONTRACT);
  assert.deepEqual(["a", "b", "c", "d"].map((g) => shape.groups[g].lines), [1, 2, 0, 1]);
  assert.deepEqual([shape.groups.rest.lines, shape.groups.unresolved.lines], [3, 1]);
});

test("group (a) takes no row; a (b) row with the shape's count is kept and says how many lines it covers", () => {
  const { input } = fixture();
  const u = unionPlacementForm(null, { rows: [
    { select: "/mark/eu/b1", tier: "watchlist-annex", reason: "identical in class; the owner's goods are printers, far from the client's" },
    { set_aside_group: "a", count: 1, ground: "none trades where the client trades" },
    { set_aside_group: "(b)", count: 2, ground: "identical marks in the class, for goods unrelated to the client's" },
    { set_aside_group: "rest", count: 99, ground: "similar to none of the mark's forms" },
    { set_aside_group: "c", count: 0, ground: "nothing here" },
    { set_aside_group: "e", count: 1, ground: "no such group" },
  ] }, input);
  assert.deepEqual(u.form.set_aside_groups.map((g) => [g.set_aside_group, g.count, g.covers_lines]), [["b", 2, 1]], "(b) covers Gamma's line only: Beta's is selected");
  const why = Object.fromEntries(u.form.set_aside_group_refused.map((x) => [x.set_aside_group, x.why]));
  assert.match(why.a, /group \(a\) takes no group row: place or set aside by name every line in it/);
  assert.match(why.rest, /count 99 is not the shape's 3/);
  assert.match(why.c, /lists no line in this group/);
  assert.ok(why.e, "an unknown group is reported back");
  assert.equal(u.form.rows.length, 1, "a group row is never a candidate");
  const next = unionPlacementForm(parsePlacementForm(JSON.stringify(u.form)), { rows: [{ set_aside_group: "b", count: 2, ground: "a second ground" }] }, input);
  assert.deepEqual(next.form.set_aside_groups.map((g) => g.ground), ["a second ground"]);
  const gone = unionPlacementForm(parsePlacementForm(JSON.stringify(next.form)), { rows: [{ retract: "group:b" }] }, input);
  assert.deepEqual(gone.form.set_aside_groups, []);
});

test("a ground by name covers the named line where the owner has several lines, and the owner's set where it has one", () => {
  const { input } = fixture();
  const u = unionPlacementForm(null, { rows: [
    { set_aside: "/mark/eu/a2", ground: "a different product, sold only to farmers" },
    { set_aside: "/mark/eu/b2", ground: "the owner's printers are far from the client's goods" },
    { set_aside_group: "b", count: 2, ground: "identical in class, for unrelated goods" },
    { set_aside_group: "rest", count: 3, ground: "similar to none of the mark's forms, or not live" },
  ] }, input);
  const groundOf = setAsideGrounds(parsed(u), buildSelectionIndex(input), input.groups);
  assert.equal(groundOf("/mark/eu/a2").by, "name");
  assert.equal(groundOf("/mark/eu/a1"), null, "Alpha's (a) line is not set aside by a ground written about its other mark");
  assert.equal(groundOf("/mark/eu/a3").group, "rest", "Alpha's dead mark falls to the rest's row, not to the named line");
  assert.equal(groundOf("/mark/eu/b2").by, "name", "a one-line owner named covers its set");
  assert.deepEqual([groundOf("/mark/eu/b1").by, groundOf("/mark/eu/b1").group], ["group", "b"]);
  assert.equal(groundOf("/mark/eu/u1"), null, "the rest's row does not cover a line whose goods were cut on the row");
});

test("every line's fate is counted by the list the shape put it in, and only placement or a name answers a floor in (a)", () => {
  const { input } = fixture();
  const u = unionPlacementForm(null, { rows: [
    { select: "/mark/eu/a1", tier: "headline-candidate", reason: "identical, live, for the client's own goods" },
    { set_aside: "/mark/eu/a2", ground: "a different product, sold only to farmers" },
    { set_aside_group: "b", count: 2, ground: "identical in class, for unrelated goods" },
    { set_aside_group: "rest", count: 3, ground: "similar to none of the mark's forms, or not live" },
  ] }, input);
  const index = buildSelectionIndex(input);
  const fates = ownerFates({ groups: input.groups, entries: parsed(u), index, placedUris: ["/mark/eu/a1"] });
  assert.deepEqual({ lines: fates.lines, placed: fates.placed, by_name: fates.by_name, by_group: fates.by_group, unfated: fates.unfated },
    { lines: 8, placed: 1, by_name: 1, by_group: 5, unfated: 1 });
  assert.deepEqual([fates.owners, fates.owners_fated], [6, 5], "Zeta's goods-cut line is its one line without a fate");
  assert.deepEqual(fates.unfated_lines.map((x) => x.list), ["unresolved"]);
  const duty = reconcileFloorDuty({ floors: input.floors, placements: [{ records: ["/mark/eu/a1"], tier: "headline-candidate", reason: "identical, live" }],
    setAsideGroundOf: setAsideGrounds(parsed(u), index, input.groups) });
  assert.deepEqual([duty.totals.floors, duty.totals.accounted, duty.undischarged_by_seat], [3, 3, 0]);
  assert.equal(duty.by_tier[SET_ASIDE_TIER], 2, "the two (b) floors are answered by the group's row");
  const unplaced = reconcileFloorDuty({ floors: input.floors, placements: [], setAsideGroundOf: setAsideGrounds(parsed(u), index, input.groups) });
  assert.equal(unplaced.undischarged_by_seat, 1, "(a)'s floor, neither placed nor named, has no fate: no row of (a) exists to cover it");
});
