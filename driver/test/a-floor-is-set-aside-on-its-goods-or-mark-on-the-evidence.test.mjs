// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A FLOOR IS CONSIDERED, AND SET ASIDE ON ITS GOODS OR ITS MARK ONLY ON THE EVIDENCE (ruled 2026-10-27).
//
// A live identical or near-identical mark in an ordered class used to be placed, sheet 2 at the least, unless it
// was set aside on its status or its territory. Identical spelling and a shared class then decided the fate, and a
// test run carried every such line to the writer. Now the step may set a floor aside on its registered goods or on
// a reasoned comparison with the client's mark, and the form checks the evidence the ground rests on: a goods
// ground needs the line read and every floor's goods held complete, and a mark ground cannot set aside the client's
// own mark. One ground may cover a list of lines, each judged on its own, so an exception is said back by id and
// the others stand. Every mark, owner and goods line is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildBandShape, deriveRegisterPositions } from "../band-shape.mjs";
import { buildSelectionIndex, parsePlacementForm, setAsideGrounds, setAsideKeysOf } from "../placement-form.mjs";
import { unionPlacementForm } from "../placement-union.mjs";
import { readPlacementFormInput } from "../placement-form-io.mjs";
import { reconcileFloorDuty } from "../floor-duty.mjs";
import { goodsWordCounter, goodsWordsMatched } from "../record-goods.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";

const rec = (id, mark, owner, extra = {}) => ({ record_id: `/mark/eu/${id}`, mark_text: mark, owner_name: owner, classes: ["9"], status: "registered", jurisdictions: ["EU"], ...extra });
// Four floors in (b): identical marks in the ordered class whose goods miss the client's word. One is a searched
// form of the mark, not the mark itself.
const BAND = [
  rec("b1", "QZORVAK", "Beta GmbH"),
  rec("b2", "Qzorvak", "Gamma SA"),
  rec("b3", "QZORVAK", "Delta AG"),
  rec("v1", "QZORVAX", "Epsilon Oy"),
];
const GOODS = { b1: "industrial pumps", b2: "printing ink", b3: "fire extinguishers", v1: "garden hoses" };

function fixture({ read = true } = {}) {
  const positions = deriveRegisterPositions(BAND);
  const goods = {
    of: (r) => [{ classes: r.classes, text: GOODS[r.record_id.split("/").pop()] }],
    hits: goodsWordCounter(["joystick"]), matched: goodsWordsMatched(["joystick"]),
  };
  const { shape } = buildBandShape({ enumerated: BAND }, { targets: ["Qzorvak", "Qzorvax"], inScopeClasses: ["9"], positions, goods,
    keysOf: setAsideKeysOf(positions.positions) });
  const lines = read ? ["a", "b", "c", "d", "rest", "no_goods"].flatMap((g) => shape.groups[g].list.map((l) => l.key)) : [];
  return { floors: shape.floors.in_class_identical_or_near, positions: positions.positions, groups: shape.groups,
    served: { lines: new Set(lines), records: new Set() }, marks: ["Qzorvak"],
    evidence: new Map(BAND.map((r) => [r.record_id, "complete"])) };
}
const refusedBy = (u) => Object.fromEntries((u.form.set_aside_refused ?? []).map((x) => [x.set_aside, x.why]));
const taken = (u) => u.form.set_aside.map((e) => [e.set_aside, e.on]);
const GOODS_GROUND = "registered for industrial and household goods that do not meet the client's game controllers";

test("guard: the fixture's four lines are floors in (b)", () => {
  const input = fixture();
  assert.equal(input.floors.length, 4);
  assert.deepEqual([input.groups.b.lines, input.groups.b.list.every((l) => l.floors === 1)], [4, true]);
});

test("one goods ground over a list covers each line whose goods are held complete, and says back the one that is not", () => {
  const input = fixture();
  input.evidence.set("/mark/eu/b3", "unknown");
  const u = unionPlacementForm(null, { rows: [
    { set_aside: ["/mark/eu/b1", "/mark/eu/b2", "/mark/eu/b3", "/mark/eu/zz"], ground: GOODS_GROUND, on: "goods" },
  ] }, input);
  assert.deepEqual(taken(u), [["/mark/eu/b1", "goods"], ["/mark/eu/b2", "goods"]]);
  const why = refusedBy(u);
  assert.match(why["/mark/eu/b3"], /does not hold the goods of \/mark\/eu\/b3 \(unknown\) in full, so a goods ground cannot stand/);
  assert.match(why["/mark/eu/zz"], /the band holds no record with this id/);
  assert.equal(u.form.rows.length, 0, "a list of set-asides is never a candidate");
  // The floor duty counts the two lines the ground covers, and still owes the exception and the line never named.
  const index = buildSelectionIndex(input);
  const kept = parsePlacementForm(JSON.stringify(u.form)).set_aside;
  const duty = reconcileFloorDuty({ floors: input.floors, placements: [], setAsideGroundOf: setAsideGrounds(kept, index, input.groups, input.floors) });
  assert.deepEqual([duty.totals.floors, duty.totals.accounted, duty.undischarged_by_seat], [4, 2, 2]);
});

test("a goods ground on a line the step never read, or on a run with no record of its goods, is said back", () => {
  const unread = unionPlacementForm(null, { rows: [{ set_aside: "/mark/eu/b1", ground: GOODS_GROUND, on: "goods" }] }, fixture({ read: false }));
  assert.equal(unread.form.set_aside.length, 0);
  assert.match(refusedBy(unread)["/mark/eu/b1"], /^this line has not been read\./);
  const opened = fixture({ read: false });
  opened.served.records.add("/mark/eu/b1");
  assert.equal(unionPlacementForm(null, { rows: [{ set_aside: "/mark/eu/b1", ground: GOODS_GROUND, on: "goods" }] }, opened).form.set_aside.length, 1,
    "a record opened with band_record reads its line");
  const none = fixture();
  none.evidence = null;
  const u = unionPlacementForm(null, { rows: [{ set_aside: "/mark/eu/b1", ground: GOODS_GROUND, on: "goods" }] }, none);
  assert.match(refusedBy(u)["/mark/eu/b1"], /^the run has no record of this line's goods, so a goods ground cannot be checked\./);
});

test("a mark ground stands on a searched form of the mark and never on the client's mark itself", () => {
  const input = fixture();
  const u = unionPlacementForm(null, { rows: [
    { set_aside: "/mark/eu/v1", ground: "QZORVAX ends in a hard X the client's mark lacks; read and heard as a whole it is a different word", on: "mark" },
    { set_aside: "/mark/eu/b2", ground: "the stylisation sets it apart from the client's mark", on: "mark" },
  ] }, input);
  assert.deepEqual(taken(u), [["/mark/eu/v1", "mark"]]);
  assert.match(refusedBy(u)["/mark/eu/b2"], /carries the client's own mark, so a mark ground cannot set it aside/);
  const noMarks = fixture();
  noMarks.marks = [];
  assert.match(refusedBy(unionPlacementForm(null, { rows: [{ set_aside: "/mark/eu/v1", ground: "a different word as a whole", on: "mark" }] }, noMarks))["/mark/eu/v1"],
    /^the run has no applied-for mark to compare with\./);
});

test("a goods ground needs no product words: the evidence is what the form reads", () => {
  // A goods ground quotes the specification, and a specification speaks of fields, industries and retail. The words
  // that refuse a status ground do not refuse a goods ground; the evidence decides it.
  const input = fixture();
  const ground = "the specification covers industrial pumps for commercial use in the field of oil extraction; nothing in it meets the client's game controllers";
  assert.equal(unionPlacementForm(null, { rows: [{ set_aside: "/mark/eu/b1", ground, on: "goods" }] }, input).form.set_aside.length, 1);
  assert.equal(unionPlacementForm(null, { rows: [{ set_aside: "/mark/eu/b1", ground, on: "status" }] }, input).form.set_aside.length, 0,
    "the same words are still refused as a ground on its status");
});

test("the run's files give the form the applied-for marks and what each record's goods rest on", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "floor-evidence-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(driverDir(dir), { recursive: true });
  writeFileSync(driverDir(dir, "instructed-scope.json"), JSON.stringify({ marks: "Qzorvak", classes: [9] }));
  writeFileSync(driverDir(dir, "goods-evidence.json"), JSON.stringify({ schema_version: 1, records: [
    { uri: "/mark/eu/B1", state: "complete" }, { uri: "/mark/eu/b3", state: "cut" }] }));
  const input = readPlacementFormInput(dir);
  assert.deepEqual(input.marks, ["Qzorvak"], "a scope naming one mark as a string names it all the same");
  assert.deepEqual([...input.evidence], [["/mark/eu/b1", "complete"], ["/mark/eu/b3", "cut"]]);
  const bare = mkdtempSync(join(tmpdir(), "floor-evidence-"));
  t.after(() => rmSync(bare, { recursive: true, force: true }));
  assert.deepEqual([readPlacementFormInput(bare).marks, readPlacementFormInput(bare).evidence], [[], null], "no files: no marks and no evidence, never an empty pass");
});
