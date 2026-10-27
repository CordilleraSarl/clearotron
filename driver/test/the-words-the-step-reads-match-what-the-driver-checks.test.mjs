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

test("a crowd outside (a) stands on its first page and the count, and the shape, the manual, the dictation and the refusal say so alike", () => {
  const { shape, md, input } = shapeOf(Array.from({ length: CROWDED_GROUP_RECORDS }, (_, i) => rec(`c${i}`, "QZORVAK", `Owner ${String(i).padStart(4, "0")} Ltd`)));
  assert.equal(shape.groups.b.records, CROWDED_GROUP_RECORDS, "guard: (b) is crowded");
  assert.ok(md.includes(`set the rest aside in this group's one row with the count: the client is told the field is crowded. The first 5 lines are below; page with ${groupPageCall("b")} only where a line needs reading.`));
  assert.doesNotMatch(md, /refused until every line was read|page every other line with band_lookup \{"group":"b"\}/, "the shape still makes paging a crowd a precondition");
  const refused = unionPlacementForm(null, { rows: [{ set_aside_group: "b", count: CROWDED_GROUP_RECORDS, ground: "identical in class, for printers" }] }, { ...input, served: { lines: new Set(), records: new Set() } });
  assert.match(refused.form.set_aside_group_refused[0].why, /^0 of the first 5 lines of group b were read: read the parts of band_shape that print them, before its row$/, "the refusal asks for the first page only");
  assert.ok(!refused.form.set_aside_group_refused[0].why.includes(groupPageCall("b")), "and asks no paging of a crowd");
  assert.ok(MANUAL.includes("A crowd of a thousand or more outside (a) stands on its first page read and the count."));
  assert.ok(DICTATION.includes("a crowd of a thousand or more outside (a) stands on its first page read and the count"));
  assert.match(SET_ASIDE_GROUP_CONTRACT.when, /in a crowd of a thousand or more outside \(a\), it stands on the first page read and the count/);
});

test("no sentence the step reads lets a group's row answer a floor below a thousand records", () => {
  assert.equal(CROWDED_GROUP_RECORDS, 1000, "the words say a thousand: they move with the number or not at all");
  assert.doesNotMatch(MANUAL, /by name or by its group's row/);
  assert.match(MANUAL, /only a crowd's row of a thousand records or more in \(b\) covers a floor/);
  assert.match(MANUAL, /A group's row is refused until every line of the group was read/);
  assert.doesNotMatch(MANUAL, /you were served|covers only the lines/, "the manual still says a row covers a subset of a group");
  assert.match(MANUAL, /left to the group's row with the reason, except a floor, which is placed or set aside by name/);
  assert.match(SET_ASIDE_GROUP_CONTRACT.when, /It covers a floor only in such a crowd in \(b\), and only once you have read the floor's line; a floor among the lines the goods test could not place, like any other floor, is placed or set aside by name/);
  assert.match(DICTATION, /A floor is placed, sheet-2 at the least, or set aside by name on its status or its territory; only a crowd's row in \(b\) may leave it to the row/);
  assert.doesNotMatch(MANUAL + DICTATION, /among the lines the goods test could not place, covers a floor|or in those lines/, "no sentence lets the no-goods row cover a floor");
});

test("no sentence the step reads lets a name cover an owner's other marks", () => {
  for (const [where, text] of [["manual", MANUAL], ["dictation", DICTATION], ["form", CONTRACTS]])
    assert.doesNotMatch(text, /every record of that owner|owner's set|as a set and do not carry|several lines|more than one line/, `the ${where} still sets an owner's marks aside by one name`);
  assert.match(SET_ASIDE_ROW_CONTRACT.set_aside, /never another mark of the owner/);
  assert.match(SET_ASIDE_ROW_CONTRACT.on, /status or territory\. A floor is never set aside on its goods, which decide its group, nor on its owner, its customers or its field/);
  assert.match(MANUAL, /set aside by name on its status or its territory \(the row's `on`\), never on its goods or its owner's customers or field/);
  assert.match(DICTATION, /sets a floor aside only on its status or its territory, said in "on", never on its goods or its owner's customers or field/);
  assert.match(MANUAL, /never an identical mark live in an ordered or frame-added class\. For each:/, "the out-of-scope section names the exception");
});

test("a group's row says back the lines holding a floor it leaves to be placed or named", () => {
  const { input } = shapeOf([rec("b1", "QZORVAK", "Beta GmbH"), rec("b2", "Qzorvak", "Gamma SA"), rec("b3", "QZORVAK", "Delta AG", { status: "expired" })]);
  assert.deepEqual(input.groups.b.list.map((l) => l.floors).sort(), [0, 1, 1], "guard: two of (b)'s three lines hold a floor");
  const u = unionPlacementForm(null, { rows: [
    { set_aside: "/mark/eu/b2", ground: "the registration was cancelled", on: "status" },
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

test("nothing the step reads orders the shape read whole; a part says only that the groups continue", async () => {
  const { BAND_READING_CONTRACT } = await import("../stages.mjs");
  const SERVER = readFileSync(new URL("../engine/mcp/band-server.mjs", import.meta.url), "utf8");
  const SHAPE_TOOL = SERVER.slice(SERVER.indexOf("function bandShape("), SERVER.indexOf("\n}\n", SERVER.indexOf("function bandShape("))) + SERVER.match(/description: "The deterministic shape[^"]*"/)[0];
  for (const [where, text] of [["reading contract", BAND_READING_CONTRACT], ["manual", MANUAL], ["band_shape tool", SHAPE_TOOL]])
    assert.doesNotMatch(text, /read every part|read ALL parts|COMPLETE only once|complete once parts|no lookup pattern excuses|a partial shape is never the shape/, `the ${where} still orders a whole read`);
  assert.ok(SHAPE_TOOL.includes("Read each group by the size sentence at its head; the next part continues the groups."), "the banner says what a part is");
  assert.ok(SHAPE_TOOL.includes("A large shape is served in parts, each naming the next call."), "the description says only that");
  assert.doesNotMatch(MANUAL, /\bher\b/, "the manual points at a person it never names");
  assert.match(MANUAL, /read its goods in `band_record`, unless its goods words already show the ground/);
});


test("the fallback names its words as the register search's, and (c)'s heading names the searched word it holds", () => {
  const { md } = buildBandShape({ enumerated: [rec("x1", "QZORVAK", "Alpha Ltd")], crowds: [] }, { targets: ["Qzorvak"], inScopeClasses: ["9"],
    goodsTest: { source: "goods_words", words: ["joysticks"] } });
  assert.ok(md.includes("No product words were given, so the goods test reads each record's goods for the words the register search was narrowed by: «joysticks». They include words other filings use for the same goods, so \"for the client's goods\" below is wider than the client's own product."));
  assert.doesNotMatch(md, /class words/);
  assert.ok(md.includes("### (c) The same family as the mark, or carrying the searched word, for the client's goods"));
});

test("the three places that ask for product words ask for whole words in the singular, never a stem", () => {
  const RECORDING = readFileSync(new URL("../engine/mcp/recording-server.mjs", import.meta.url), "utf8");
  const STAGES = readFileSync(new URL("../stages.mjs", import.meta.url), "utf8");
  const VARIANTS = readFileSync(new URL("../skills/clearance-variants/SKILL.md", import.meta.url), "utf8");
  for (const [where, text] of [["recording tool", RECORDING], ["dictation", STAGES], ["variants manual", VARIANTS]]) {
    assert.doesNotMatch(text, /the stem that matches/, `the ${where} still asks for a stem`);
    assert.ok(text.includes("in the singular; the engine matches the plural too"), `the ${where} does not ask for the singular`);
  }
});

test("no part banner or role text orders a whole read, and the manual's identical-in-class line agrees with the floor rules", async () => {
  const SERVER = readFileSync(new URL("../engine/mcp/band-server.mjs", import.meta.url), "utf8");
  const SHAPE_SRC = readFileSync(new URL("../band-shape.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(SERVER, /COMPLETE only once|is complete once parts/, "a record's banner still orders a whole read");
  assert.ok(SERVER.includes("This record is served in ${total} parts; the next part continues it."));
  assert.doesNotMatch(SHAPE_SRC, /reads THIS whole/);
  assert.ok(MANUAL.includes("An identical mark live in an ordered or added class is placed, sheet 2 at the least, unless it is set aside by name on its status or territory, or sits in a crowd of a thousand or more identical marks and its goods, read on its line, are not the client's goods, where the crowd's row stands for it; it is never out-of-scope-filtered."));
  assert.doesNotMatch(MANUAL, /is never out-of-scope-filtered: sheet 2 at the least\./, "the old line 172 still stands beside the by-name rule");
});
