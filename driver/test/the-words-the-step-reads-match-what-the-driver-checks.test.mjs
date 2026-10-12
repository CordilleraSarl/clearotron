// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE WORDS THE STEP READS MATCH WHAT THE DRIVER CHECKS.
//
// The driver refuses a group's row until every line of the group was served, lets a group's row answer a
// floor only in a group of a thousand records or more, and lets a ground by name cover the named line only.
// The shape, the manual, the stage's dictation and the form's contracts said otherwise: a crowded group was
// "open by owner name only those your judgment needs", a floor could be "covered … by its group's row", and
// a name covered "every record of that owner". A step that follows the words then loses rows to refusals it
// was never told about, or believes a floor answered that the floor duty still counts as open. These arms
// tie each sentence to the check it describes. Every mark, owner and goods line is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildBandShape, deriveRegisterPositions, CROWDED_GROUP_RECORDS, groupPageCall } from "../band-shape.mjs";
import { setAsideKeysOf, SET_ASIDE_ROW_CONTRACT, SET_ASIDE_GROUP_CONTRACT, PLACEMENT_FORM_PROVENANCE } from "../placement-form.mjs";
import { unionPlacementForm } from "../placement-union.mjs";
import { goodsWordCounter, goodsWordsMatched } from "../record-goods.mjs";

const MANUAL = readFileSync(new URL("../skills/placement-inquiry/SKILL.md", import.meta.url), "utf8");
const DICTATION = readFileSync(new URL("../stages.mjs", import.meta.url), "utf8").split("\n").filter((l) => /EACH LINE THE SHAPE LISTS|ONE ROW PER GROUP/.test(l)).join("\n");
const CONTRACTS = [...Object.values(SET_ASIDE_ROW_CONTRACT), ...Object.values(SET_ASIDE_GROUP_CONTRACT), PLACEMENT_FORM_PROVENANCE]
  .filter((v) => typeof v === "string").join("\n");

const rec = (id, mark, owner, extra = {}) => ({ record_id: `/mark/eu/${id}`, mark_text: mark, owner_name: owner, classes: ["9"], status: "registered", jurisdictions: ["EU"], ...extra });
function shapeOf(records) {
  const positions = deriveRegisterPositions(records);
  const goods = { of: () => [{ classes: ["9"], text: "printers" }], hits: goodsWordCounter(["joystick"], { stems: true }), matched: goodsWordsMatched(["joystick"], { stems: true }) };
  const { shape, md } = buildBandShape({ enumerated: records, crowds: [] }, { targets: ["Qzorvak"], inScopeClasses: ["9"], positions, goods, goodsWordCount: 1,
    keysOf: setAsideKeysOf(positions.positions), caps: { owners: 5 } });
  const read = ["a", "b", "c", "d", "no_goods"].flatMap((g) => shape.groups[g].list.map((l) => l.key));
  return { shape, md, input: { floors: shape.floors.in_class_identical_or_near, positions: positions.positions, groups: shape.groups,
    served: { lines: new Set(read), records: new Set() } } };
}

test("a crowded group's sentence names the lookup the driver's refusal names, and the manual and the dictation say to page it", () => {
  const { shape, md, input } = shapeOf(Array.from({ length: CROWDED_GROUP_RECORDS }, (_, i) => rec(`c${i}`, "QZORVAK", `Owner ${String(i).padStart(4, "0")} Ltd`)));
  assert.equal(shape.groups.b.records, CROWDED_GROUP_RECORDS, "guard: (b) is crowded");
  assert.ok(md.includes(`page every other line with ${groupPageCall("b")}: this group's row is refused until every line was read.`), "the shape says how to page the group");
  assert.doesNotMatch(md, /open by owner name only those your judgment needs/);
  const refused = unionPlacementForm(null, { rows: [{ set_aside_group: "b", count: CROWDED_GROUP_RECORDS, ground: "identical in class, for printers" }] }, { ...input, served: { lines: new Set(), records: new Set() } });
  assert.ok(refused.form.set_aside_group_refused[0].why.includes(groupPageCall("b")), "the refusal names the same call");
  assert.ok(MANUAL.includes("page every line with `band_lookup`'s `group` filter before the group's row"), "the manual says how to page a group");
  assert.ok(DICTATION.includes("Page a group the shape shows by its first page with band_lookup's group filter before its row."), "the dictation says it too");
});

test("no sentence the step reads lets a group's row answer a floor below a thousand records", () => {
  assert.equal(CROWDED_GROUP_RECORDS, 1000, "the words say a thousand: they move with the number or not at all");
  assert.doesNotMatch(MANUAL, /by name or by its group's row/);
  assert.match(MANUAL, /only group \(b\)'s row, in a crowd of a thousand records or more, covers a floor/);
  assert.match(MANUAL, /A group's row is refused until every line of the group was read/);
  assert.doesNotMatch(MANUAL, /you were served|covers only the lines/, "the manual still says a row covers a subset of a group");
  assert.match(MANUAL, /left to the group's row with the reason, except a floor, which is placed or set aside by name/);
  assert.match(SET_ASIDE_GROUP_CONTRACT.when, /It covers a floor only in group \(b\) of a thousand records or more/);
  assert.match(DICTATION, /A floor is placed or set aside by name; only group \(b\), in a crowd of a thousand records or more, may leave it to its row/);
});

test("no sentence the step reads lets a name cover an owner's other marks", () => {
  for (const [where, text] of [["manual", MANUAL], ["dictation", DICTATION], ["form", CONTRACTS]])
    assert.doesNotMatch(text, /every record of that owner|owner's set|as a set and do not carry|several lines|more than one line/, `the ${where} still sets an owner's marks aside by one name`);
  assert.match(SET_ASIDE_ROW_CONTRACT.set_aside, /never another mark of the owner/);
  assert.match(SET_ASIDE_ROW_CONTRACT.on, /one of goods, status or territory\. A floor is never set aside on its owner, its customers or its field/);
  assert.match(MANUAL, /set aside by name on a ground about the mark, its goods, its status or its territory \(the row's `on`\)/);
  assert.match(DICTATION, /sets a floor aside only on a ground about the mark, its goods, its status or its territory, said in "on"/);
});

test("a group's row says back the lines holding a floor it leaves to be placed or named", () => {
  const { input } = shapeOf([rec("b1", "QZORVAK", "Beta GmbH"), rec("b2", "Qzorvak", "Gamma SA"), rec("b3", "QZORVAK", "Delta AG", { status: "expired" })]);
  assert.deepEqual(input.groups.b.list.map((l) => l.floors).sort(), [0, 1, 1], "guard: two of (b)'s three lines hold a floor");
  const u = unionPlacementForm(null, { rows: [
    { set_aside: "/mark/eu/b2", ground: "registered for printers only", on: "goods" },
    { set_aside_group: "b", count: 3, ground: "identical in class, for printers" },
  ] }, input);
  const b = u.form.set_aside_groups.find((g) => g.set_aside_group === "b");
  assert.deepEqual([b.covers_lines, b.floors_not_covered], [1, ["/mark/eu/b1"]], "the dead mark is covered; Beta's floor is said back, Gamma's was named");
  assert.match(SET_ASIDE_GROUP_CONTRACT.said_back, /floors_not_covered/);
});

test("nothing the step reads promises the floors listed a second time, one per record", async () => {
  const { BAND_READING_CONTRACT } = await import("../stages.mjs");
  const SERVER = readFileSync(new URL("../engine/mcp/band-server.mjs", import.meta.url), "utf8");
  assert.match(BAND_READING_CONTRACT, /Every floor has a fate on the form/);
  for (const [where, text] of [["reading contract", BAND_READING_CONTRACT], ["manual", MANUAL], ["band_shape description", SERVER]])
    assert.doesNotMatch(text, /listed individually|Every floor row must be weighed|complete floors list|floors-heavy shape/, `the ${where} still promises a per-record floors list`);
  assert.match(MANUAL, /every live in-class identical\/near-identical record, each marked on its line in the band/);
});
