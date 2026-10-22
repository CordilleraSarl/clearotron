// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A CROWD'S ROW COVERS A FLOOR ONLY ONCE ITS LINE HAS BEEN READ.
//
// A crowd of a thousand records or more in (b), identical marks in the ordered classes whose goods hold none of the
// client's words, stands on its first page read and its count. Its row also stood for every floor in it, read or not:
// on a delivered test run, two identical live marks on the group's second and seventh pages were covered by the row
// and never read. The row now covers a floor only once the page listing its line was served. Until then the floor is
// said back with the floors the row does not cover, and the floor duty owes it. Each floor line in (b) shows the goods
// the test read, cut short, so a page of floors can be judged without opening a record. Every mark, owner and goods
// line is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBandShape, deriveRegisterPositions, CROWDED_GROUP_RECORDS, withoutPlacementOrders, A_CROWDS_ROW_COVERS_A_READ_FLOOR,
  FLOOR_GOODS_SHOWN } from "../band-shape.mjs";
import { setAsideKeysOf, setAsideGrounds, buildSelectionIndex, parsePlacementForm, servedLines, groupRowCoversFloorLine,
  SET_ASIDE_GROUP_CONTRACT } from "../placement-form.mjs";
import { unionPlacementForm } from "../placement-union.mjs";
import { reconcileFloorDuty } from "../floor-duty.mjs";
import { goodsWordCounter, goodsWordsMatched } from "../record-goods.mjs";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const LONG = "printers, printer cartridges, ink for printers, toner for photocopiers and laser printers, paper feeders for printers, "
  + "printer stands and cases, printing plates, print heads";
const rec = (i) => ({ record_id: `/mark/eu/c${i}`, mark_text: "QZORVAK", owner_name: `Owner ${String(i).padStart(4, "0")} Ltd`, classes: ["9"], status: "registered", jurisdictions: ["EU"] });
function crowded() {
  const band = { enumerated: Array.from({ length: CROWDED_GROUP_RECORDS }, (_, i) => rec(i)), crowds: [] };
  const positions = deriveRegisterPositions(band.enumerated);
  const goods = { of: (r) => [{ classes: ["9"], text: r.record_id.endsWith("/c1") ? LONG : "printers" }], hits: goodsWordCounter(["joysticks"]), matched: goodsWordsMatched(["joysticks"]) };
  const { shape, md } = buildBandShape(band, { targets: ["Qzorvak"], inScopeClasses: ["9"], positions, goods, goodsWordCount: 1,
    keysOf: setAsideKeysOf(positions.positions), caps: { owners: 5 } });
  return { shape, md, input: { floors: shape.floors.in_class_identical_or_near, positions: positions.positions, groups: shape.groups } };
}
const ROW = { set_aside_group: "b", count: CROWDED_GROUP_RECORDS, ground: "identical marks in the class, for goods unrelated to the client's" };
const owed = (input, served, form) => reconcileFloorDuty({ floors: input.floors, placements: [],
  setAsideGroundOf: setAsideGrounds(parsePlacementForm(JSON.stringify(form)).set_aside, buildSelectionIndex(input), input.groups, input.floors,
    { served: servedLines(input.groups, served, buildSelectionIndex(input)) }) }).undischarged_by_seat;

test("the row covers the floors on the pages read, says every other floor back, and the floor duty owes those", () => {
  const { shape, input } = crowded();
  const served = { lines: new Set(shape.groups.b.list.slice(0, 5).map((l) => l.key)), records: new Set() };
  const u = unionPlacementForm(null, { rows: [ROW] }, { ...input, served });
  const b = u.form.set_aside_groups.find((g) => g.set_aside_group === "b");
  assert.equal(b.covers_lines, 5);
  assert.equal(b.floors_not_covered.length, CROWDED_GROUP_RECORDS - 5, "an unread floor was covered by the row");
  assert.equal(owed(input, served, u.form), CROWDED_GROUP_RECORDS - 5, "an unread floor left the floor duty discharged");
});

test("once every page is read the row covers every floor, and nothing is owed", () => {
  const { shape, input } = crowded();
  const served = { lines: new Set(shape.groups.b.list.map((l) => l.key)), records: new Set() };
  const u = unionPlacementForm(null, { rows: [ROW] }, { ...input, served });
  const b = u.form.set_aside_groups.find((g) => g.set_aside_group === "b");
  assert.deepEqual([b.covers_lines, b.floors_not_covered ?? []], [CROWDED_GROUP_RECORDS, []]);
  assert.equal(owed(input, served, u.form), 0);
});

test("the cover is per line: only a crowded (b) may cover a floor, and only once its line was read", () => {
  const { shape, input } = crowded();
  const key = shape.groups.b.list[0].key;
  assert.equal(groupRowCoversFloorLine(input.groups, "b", key, new Set([key])), true);
  assert.equal(groupRowCoversFloorLine(input.groups, "b", key, new Set()), false);
  assert.equal(groupRowCoversFloorLine(input.groups, "b", key, null), false, "no record of reading is nothing read");
  assert.equal(groupRowCoversFloorLine(input.groups, "a", key, new Set([key])), false, "a row on (a) never answers a floor");
});

test("a crowded (b) says its row covers a floor once read, and each floor line shows the goods the test read, cut short", () => {
  const { md } = crowded();
  assert.match(md, /The first 5 lines are below; page with band_lookup \{"group":"b"\} only where a line needs reading\. This row covers a floor only once you have read its line\. Where more floors are counted than this page shows, page the rest with band_lookup \{"group":"b"\}; they come first\./);
  assert.ok(!withoutPlacementOrders(md).includes(A_CROWDS_ROW_COVERS_A_READ_FLOOR), "another stage was told placement's order");
  const line = (id) => md.split("\n").find((l) => l.includes(`| ${id} |`));
  assert.match(line("/mark/eu/c0"), /\| 0 of 1 «printers» \|/, "a floor line in (b) does not show the goods the test read");
  const long = line("/mark/eu/c1").match(/«([^»]*)»/)?.[1] ?? "";
  assert.ok(long.endsWith("…") && long.length <= FLOOR_GOODS_SHOWN + 1, `the goods were not cut short: ${long}`);
});

test("the placement manual and the group contract carry the five sentences", () => {
  const manual = readFileSync(join(DRIVER, "skills", "placement-inquiry", "SKILL.md"), "utf8").replace(/\s+/g, " ");
  assert.ok(manual.includes("it covers a floor only in such a crowd in (b), and only once you have read the floor's line."));
  assert.ok(manual.includes("or sits in a crowd of a thousand or more identical marks for other goods, where the crowd's row stands for it once its line has been read;"));
  assert.ok(SET_ASIDE_GROUP_CONTRACT.when.includes("It covers a floor only in such a crowd in (b), and only once you have read the floor's line; a floor among the lines the goods test could not place, like any other floor, is placed or set aside by name."));
  assert.ok(SET_ASIDE_GROUP_CONTRACT.unresolved.includes("or a group with lines you have not read (its first page, in a crowd outside (a), and in (b) every floor),"));
});
