// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A GROUP'S ROW COVERS NO LINE A LATER SHAPE ADDED.
//
// The union checks a group's row against the band shape when it takes the row: its count must be the shape's,
// and every line it covers must have been read. The set-aside grounds and the fate count read the saved form
// against the shape on disk, and that shape can be derived again after the row was taken: a resumed run derives
// it afresh, and a record body fetched after placement moves a line from the list the goods test could not
// place into a group. The readers took the row without checking it again, so the new line left with a ground
// written about lines the step had read. They now check it as the union does, and a ground by name stands as
// stored. Every mark and owner here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { paths } from "../stages.mjs";
import { deriveFloorDuty, placementSetAsideGrounds } from "../pipeline.mjs";
import { buildBandShape, deriveRegisterPositions } from "../band-shape.mjs";
import { setAsideKeysOf, renderPlacementsJson } from "../placement-form.mjs";
import { unionPlacementForm } from "../placement-union.mjs";
import { writePlacementForm } from "../placement-form-io.mjs";
import { goodsWordCounter, goodsWordsMatched } from "../record-goods.mjs";

const rec = (id, mark, owner, classes, extra = {}) => ({ record_id: `/mark/eu/${id}`, mark_text: mark, owner_name: owner, classes, status: "registered", jurisdictions: ["EU"], ...extra });
const A1 = rec("a1", "QZORVAK", "Alpha Ltd", ["9"]);                      // identical, for the client's goods → (a), a floor
const R1 = rec("r1", "Drellux", "Delta AG", ["9"]);                       // similar to nothing, goods unrelated → the rest
const R2 = rec("r2", "Plimbo", "Eta Kft", ["31"], { status: "expired" }); // a dead mark out of class → the rest
const N1 = rec("n1", "Vantrel", "Theta Oy", ["9"]);                       // live in class; its goods are read only later
const N2 = rec("n2", "Corvesh", "Iota Oy", ["31"], { status: "expired" });
const GOODS = { a1: "joysticks", r1: "printers", r2: "seeds", n2: "seeds" };
const LISTS = ["a", "b", "c", "d", "rest", "no_goods"];

function derive(band, goodsById) {
  const derived = deriveRegisterPositions(band);
  const goods = { of: (r) => { const t = goodsById[r.record_id.split("/").pop()]; return t ? [{ classes: r.classes, text: t }] : null; },
    hits: goodsWordCounter(["joysticks"]), matched: goodsWordsMatched(["joysticks"]) };
  const { shape } = buildBandShape({ enumerated: band }, { targets: ["Qzorvak"], inScopeClasses: ["9"], positions: derived, goods,
    keysOf: setAsideKeysOf(derived.positions), markets: ["EU"] });
  return { shape, positions: derived.positions };
}
// The shape the step was shown: Theta's goods are not on file, so its line waits in the list the goods test could not place.
const SHOWN = derive([A1, R1, R2, N1], GOODS);
// The same band once Theta's record body was fetched: its goods are unrelated, so its line joins the rest.
const LATER = derive([A1, R1, R2, N1], { ...GOODS, n1: "printers" });
// A shape where one line left the rest as another entered it, at the same count.
const SWAPPED = derive([A1, R1, N1, N2], GOODS);
const lineOf = (s, id) => LISTS.flatMap((g) => s.shape.groups[g].list).find((l) => l.record_id === `/mark/eu/${id}`)?.key;

const GROUND = "similar to none of the mark's forms, or not live";
const PLACED = { select: "/mark/eu/a1", tier: "headline-candidate", reason: "identical, live, for the client's own goods" };

/** The row is taken on the shape the step read; the readers then read the saved form against the shape on disk. */
function run(t, now, rows) {
  const runDir = mkdtempSync(join(tmpdir(), "group-row-again-"));
  t.after(() => rmSync(runDir, { recursive: true, force: true }));
  mkdirSync(driverDir(runDir), { recursive: true });
  const read = LISTS.flatMap((g) => SHOWN.shape.groups[g].list.map((l) => l.key));
  writeFileSync(driverDir(runDir, "reading-log.jsonl"), JSON.stringify({ ok: true, tool: "band_lookup", served_lines: read }) + "\n");
  const { form } = unionPlacementForm(null, { rows }, { floors: SHOWN.shape.floors.in_class_identical_or_near,
    positions: SHOWN.positions, groups: SHOWN.shape.groups, served: { lines: new Set(read), records: new Set() } });
  assert.deepEqual(form.set_aside_groups.map((g) => [g.set_aside_group, g.count]), [["rest", 2]], "guard: the row was taken on the shape it was read on");
  writePlacementForm(runDir, form);
  writeFileSync(driverDir(runDir, "band-shape.json"), JSON.stringify(now.shape));
  writeFileSync(driverDir(runDir, "register-positions.json"), JSON.stringify({ positions: now.positions }));
  const P = paths(runDir);
  writeFileSync(P.placementModel, JSON.stringify(renderPlacementsJson(form.rows), null, 2));
  deriveFloorDuty({ paths: P }, { ok: true });
  const duty = JSON.parse(readFileSync(P.floorDuty, "utf8"));
  return { groundOf: placementSetAsideGrounds(P), rest: duty.owners?.by_list?.rest, unfated: duty.owners?.unfated_lines ?? [] };
}

test("a line a later shape added to a group leaves with no ground, and the row taken before it covers nothing", (t) => {
  assert.deepEqual([SHOWN.shape.groups.rest.records, LATER.shape.groups.rest.records], [2, 3], "guard: the later shape's rest holds Theta's line");
  const { groundOf, rest, unfated } = run(t, LATER, [PLACED, { set_aside_group: "rest", count: 2, ground: GROUND }]);
  assert.equal(groundOf("/mark/eu/n1"), null, "a line the step never read left with the rest's ground");
  assert.equal(groundOf("/mark/eu/r1"), null, "a row whose count is no longer the shape's still covered its lines");
  assert.deepEqual({ lines: rest.lines, by_group: rest.by_group, unfated: rest.unfated }, { lines: 3, by_group: 0, unfated: 3 });
  assert.ok(unfated.some((x) => x.list === "rest" && x.key === lineOf(LATER, "n1")), "the new line was not counted without a fate");
});

test("a line that entered a group as another left, at the same count, is not covered either", (t) => {
  assert.equal(SWAPPED.shape.groups.rest.records, 2, "guard: the count is unchanged");
  const { groundOf, rest } = run(t, SWAPPED, [PLACED, { set_aside_group: "rest", count: 2, ground: GROUND }]);
  assert.equal(groundOf("/mark/eu/n2"), null, "a line the step never read left with the rest's ground");
  assert.equal(rest.by_group, 0, "a row was kept over a line nobody read");
});

test("on the shape it was taken on, the row covers its lines as before", (t) => {
  const { groundOf, rest } = run(t, SHOWN, [PLACED, { set_aside_group: "rest", count: 2, ground: GROUND }]);
  assert.equal(groundOf("/mark/eu/r1")?.ground, GROUND);
  assert.equal(groundOf("/mark/eu/r1")?.group, "rest");
  assert.equal(groundOf("/mark/eu/n1"), null, "no row covers a line the goods test could not place");
  assert.deepEqual({ lines: rest.lines, by_group: rest.by_group, unfated: rest.unfated }, { lines: 2, by_group: 2, unfated: 0 });
});

test("a ground by name stands as stored on the later shape", (t) => {
  const named = { set_aside: "/mark/eu/r2", ground: "This registration lapsed and was never renewed.", on: "status" };
  const { groundOf, rest } = run(t, LATER, [PLACED, named, { set_aside_group: "rest", count: 2, ground: GROUND }]);
  assert.equal(groundOf("/mark/eu/r2")?.by, "name");
  assert.equal(groundOf("/mark/eu/r2")?.ground, named.ground);
  assert.equal(rest.by_name, 1, "the named line lost its fate");
});
