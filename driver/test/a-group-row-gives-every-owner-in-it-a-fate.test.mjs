// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A LISTED LINE GETS A FATE, NOT A ROW.
//
// A line the shape lists, one mark of one owner, is placed, set aside by name, or covered by its group's one
// row, which says why everything in the group the step neither placed nor named is not raised with the
// client: her "read the near ones first, list the rest". A ground by name covers the named line only, one
// mark of its owner, so one mark's ground never sets another mark aside unseen. These arms pin the row the
// union keeps and the ones it reports back, the ground each record leaves with, the fate count by list, and
// the floors a group row answers. The shape is built by the product from an invented band, so every key is
// the one a set-aside row reaches.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBandShape, deriveRegisterPositions } from "../band-shape.mjs";
import { buildPlacementForm, buildSelectionIndex, parsePlacementForm, setAsideGrounds, setAsideKeysOf, ownerFates, SET_ASIDE_GROUP_CONTRACT } from "../placement-form.mjs";
import { unionPlacementForm } from "../placement-union.mjs";
import { reconcileFloorDuty, SET_ASIDE_TIER } from "../floor-duty.mjs";
import { goodsWordCounter, goodsWordsMatched } from "../record-goods.mjs";

const rec = (id, mark, owner, classes, extra = {}) => ({ record_id: `/mark/eu/${id}`, mark_text: mark, owner_name: owner, classes, status: "registered", jurisdictions: ["EU"], ...extra });
const BAND = [
  rec("a1", "QZORVAK", "Alpha Ltd", ["9"]),                  // identical, for the goods → (a), a floor
  rec("a2", "Plimbo", "Alpha Ltd", ["9"]),                   // the same owner's other mark, for the goods → (d)
  rec("a3", "Drellux", "Alpha Ltd", ["31"], { status: "expired" }),   // the same owner's dead mark → the rest
  rec("b1", "Qzorvak", "Beta GmbH", ["9"]),                  // identical, in class, goods unrelated → (b), a floor
  rec("b2", "Qzorvak", "Gamma SA", ["9"]),                   // the same → (b), a floor
  rec("r1", "Drellux", "Delta AG", ["9"]),                   // similar to nothing, goods unrelated → the rest
  rec("r2", "Plimbo", "Eta Kft", ["31"], { status: "expired" }),
  rec("u1", "QZORVAK", "Zeta BV", ["9"]),                    // identical, in class, no goods on file → listed apart, a floor
];
const GOODS = { a1: "joysticks", a2: "joysticks", a3: "seeds", b1: "printers", b2: "printers", r1: "printers", r2: "seeds" };

function fixture() {
  const positions = deriveRegisterPositions(BAND);
  const goods = {
    of: (r) => { const t = GOODS[r.record_id.split("/").pop()]; return t ? [{ classes: r.classes, text: t }] : null; },
    hits: goodsWordCounter(["joysticks"]), matched: goodsWordsMatched(["joysticks"]),
  };
  const { shape } = buildBandShape({ enumerated: BAND }, { targets: ["Qzorvak"], inScopeClasses: ["9"], positions, goods,
    keysOf: setAsideKeysOf(positions.positions), markets: ["EU"] });
  // The step read the whole shape: every listed line is in its reading log.
  const read = ["a", "b", "c", "d", "no_goods"].flatMap((g) => shape.groups[g].list.map((l) => l.key));
  return { input: { floors: shape.floors.in_class_identical_or_near, positions: positions.positions, groups: shape.groups,
    served: { lines: new Set(read), records: new Set() } }, shape };
}
const parsed = (u) => parsePlacementForm(JSON.stringify(u.form)).set_aside;

test("the form carries the group row's contract, and the shape's lines are what a row is checked against", () => {
  const { input, shape } = fixture();
  assert.deepEqual(buildPlacementForm(input).set_aside_group_contract, SET_ASIDE_GROUP_CONTRACT);
  assert.deepEqual(["a", "b", "c", "d"].map((g) => shape.groups[g].lines), [1, 2, 0, 1]);
  assert.deepEqual([shape.groups.rest.lines, shape.groups.no_goods.lines], [3, 1]);
});

test("a group row with the shape's count is kept and says how many lines it covers, and a wrong one is reported back", () => {
  const { input } = fixture();
  const u = unionPlacementForm(null, { rows: [
    { select: "/mark/eu/b1", tier: "watchlist-annex", reason: "identical in class; the owner's goods are printers, far from the client's" },
    { set_aside_group: "a", count: 1, ground: "none trades where the client trades" },
    { set_aside_group: "(b)", count: 2, ground: "identical marks in the class, for goods unrelated to the client's" },
    { set_aside_group: "rest", count: 99, ground: "similar to none of the mark's forms" },
    { set_aside_group: "c", count: 0, ground: "nothing here" },
    { set_aside_group: "e", count: 1, ground: "no such group" },
  ] }, input);
  assert.deepEqual(u.form.set_aside_groups.map((g) => [g.set_aside_group, g.count, g.covers_lines]), [["a", 1, 0], ["b", 2, 0]],
    "both rows are taken, and neither covers a line holding a floor in a group below a thousand records");
  const why = Object.fromEntries(u.form.set_aside_group_refused.map((x) => [x.set_aside_group, x.why]));
  assert.equal(why.a, undefined, "group (a) takes its row like the others");
  assert.match(why.rest, /count 99 is not the shape's 3/);
  assert.match(why.c, /lists no line in this group/);
  assert.ok(why.e, "an unknown group is reported back");
  assert.equal(u.form.rows.length, 1, "a group row is never a candidate");
  const next = unionPlacementForm(parsePlacementForm(JSON.stringify(u.form)), { rows: [{ set_aside_group: "b", count: 2, ground: "a second ground" }] }, input);
  assert.deepEqual(next.form.set_aside_groups.map((g) => [g.set_aside_group, g.ground]),
    [["a", "none trades where the client trades"], ["b", "a second ground"]], "a later row replaces its own group's, and leaves the others");
  const gone = unionPlacementForm(parsePlacementForm(JSON.stringify(next.form)), { rows: [{ retract: "group:b" }] }, input);
  assert.deepEqual(gone.form.set_aside_groups.map((g) => g.set_aside_group), ["a"], "`group:b` retracts (b)'s row only");
});

test("a ground by name covers the named line only, whatever else its owner holds", () => {
  const { input } = fixture();
  const u = unionPlacementForm(null, { rows: [
    { set_aside: "/mark/eu/a2", ground: "a different product, sold only to farmers" },
    { set_aside: "/mark/eu/b2", ground: "the owner's printers are far from the client's goods" },
    { set_aside_group: "b", count: 2, ground: "identical in class, for unrelated goods" },
    { set_aside_group: "rest", count: 3, ground: "similar to none of the mark's forms, or not live" },
  ] }, input);
  const groundOf = setAsideGrounds(parsed(u), buildSelectionIndex(input), input.groups, input.floors);
  assert.equal(groundOf("/mark/eu/a2").by, "name");
  assert.equal(groundOf("/mark/eu/a1"), null, "Alpha's (a) line is not set aside by a ground written about its other mark");
  assert.equal(groundOf("/mark/eu/a3").group, "rest", "Alpha's dead mark falls to the rest's row, not to the named line");
  assert.equal(groundOf("/mark/eu/b2").by, "name", "the named line leaves with its own ground");
  assert.equal(groundOf("/mark/eu/b1"), null, "b1 is a floor in a group below a thousand records: (b)'s row does not answer it");
  assert.equal(groundOf("/mark/eu/u1"), null, "no group row covers a line with no goods on file");
});

test("every line's fate is counted by the list the shape put it in, and a small group's row answers none of its floors", () => {
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
    { lines: 8, placed: 1, by_name: 1, by_group: 3, unfated: 3 }, "(b)'s two lines hold floors, so its row of two records answers neither");
  assert.deepEqual([fates.owners, fates.owners_fated], [6, 3]);
  assert.deepEqual(fates.unfated_lines.map((x) => x.list).sort(), ["b", "b", "no_goods"]);
  const duty = reconcileFloorDuty({ floors: input.floors, placements: [{ records: ["/mark/eu/a1"], tier: "headline-candidate", reason: "identical, live" }],
    setAsideGroundOf: setAsideGrounds(parsed(u), index, input.groups, input.floors) });
  assert.deepEqual([duty.totals.floors, duty.totals.accounted, duty.undischarged_by_seat], [4, 1, 3],
    "below a thousand records a floor is placed or named: (b)'s row answers neither of its floors, and Zeta's waits to be opened");
  assert.equal(duty.by_tier[SET_ASIDE_TIER], undefined);
  const unplaced = reconcileFloorDuty({ floors: input.floors, placements: [], setAsideGroundOf: setAsideGrounds(parsed(u), index, input.groups, input.floors) });
  assert.equal(unplaced.undischarged_by_seat, 4, "nothing placed: every floor is still owed");
});
