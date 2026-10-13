// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A RESUMED RUN ASKS THE STEP AGAIN WHEN THE SHAPE MOVED.
//
// On a resumed run, placement's skip was decided on the floor-duty artifact its last pass wrote. The run derives the
// band shape afresh, and a shape derived since can owe more: a floor it adds, or a crowded (b) whose row no longer
// stands because a record fetched after placement moved one more line into it. Placement skipped, the duty was
// derived again straight after, every such floor read unanswered, and the report shipped clamped with the step
// never asked. The skip now also reads the duty on the shape now on disk: placement runs again, its dispatch-time
// union refuses what no longer holds, and the judgement says so to the step. Every mark and owner here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { paths } from "../stages.mjs";
import { deriveFloorDuty, floorDutyOwedNow } from "../pipeline.mjs";
import { buildBandShape, deriveRegisterPositions } from "../band-shape.mjs";
import { setAsideKeysOf, renderPlacementsJson } from "../placement-form.mjs";
import { unionPlacementForm } from "../placement-union.mjs";
import { writePlacementForm, readPlacementForm, readPlacementFormInput } from "../placement-form-io.mjs";
import { goodsWordCounter, goodsWordsMatched } from "../record-goods.mjs";
import { armFloorDuty, floorDutyBlocksSkip } from "../floor-duty.mjs";
import { validators } from "../verify.mjs";

const rec = (id, owner, classes = ["9"]) => ({ record_id: `/mark/eu/${id}`, mark_text: "QZORVAK", owner_name: owner, classes, status: "registered", jurisdictions: ["EU"] });
const LISTS = ["a", "b", "c", "d", "rest", "no_goods"];
function derive(band, goodsOf, inScopeClasses = ["9"]) {
  const d = deriveRegisterPositions(band);
  const goods = { of: (r) => { const t = goodsOf(r.record_id.split("/").pop()); return t ? [{ classes: r.classes, text: t }] : null; },
    hits: goodsWordCounter(["joysticks"]), matched: goodsWordsMatched(["joysticks"]) };
  const { shape } = buildBandShape({ enumerated: band }, { targets: ["Qzorvak"], inScopeClasses, positions: d, goods, goodsWordCount: 1,
    keysOf: setAsideKeysOf(d.positions), markets: ["EU"] });
  return { shape, positions: d };
}
const SPECIMEN = ["# Candidate grouping — TESTMARK", "", "## Band reconciliation", "", "Padding so the specimen clears the nonEmpty floor and the structural arm is what decides it.", "",
  "## Headline candidates", "<!-- clearotron:section=placement-tiers -->", "", "- CANDIDATE", ""].join("\n");

/** A pass that answered every floor on the shape it was shown, then a shape derived again on resume. */
function resumed(t, shown, later, rows) {
  const dir = mkdtempSync(join(tmpdir(), "resumed-shape-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(driverDir(dir), { recursive: true });
  writeFileSync(driverDir(dir, "stage-contracts.json"), JSON.stringify({ "placement-inquiry": { structuredPlacements: 1, placementForm: 1, placementAccount: 1, placementSaidBack: 1 } }));
  armFloorDuty(dir);
  const read = LISTS.flatMap((g) => shown.shape.groups[g].list.map((l) => l.key));
  writeFileSync(driverDir(dir, "reading-log.jsonl"), JSON.stringify({ ok: true, tool: "band_lookup", served_lines: read }) + "\n");
  writeFileSync(driverDir(dir, "band-shape.json"), JSON.stringify(shown.shape));
  writeFileSync(driverDir(dir, "register-positions.json"), JSON.stringify(shown.positions));
  const { form } = unionPlacementForm(null, { rows }, readPlacementFormInput(dir));
  writePlacementForm(dir, form);
  const P = paths(dir);
  writeFileSync(P.placementModel, JSON.stringify(renderPlacementsJson(form.rows), null, 2));
  const out = join(dir, "placement-recommendations.md");
  writeFileSync(out, SPECIMEN);
  const pass = deriveFloorDuty({ paths: P }, { ok: true });
  assert.equal(pass?.undischarged_by_seat, 0, "guard: the pass answered every floor on the shape it was shown");
  writeFileSync(driverDir(dir, "band-shape.json"), JSON.stringify(later.shape));
  writeFileSync(driverDir(dir, "register-positions.json"), JSON.stringify(later.positions));
  // What placement's dispatch does when it runs again: the union over the prior form, on the shape now on disk.
  const redispatch = () => {
    const prior = readPlacementForm(dir);
    writePlacementForm(dir, unionPlacementForm({ rows: prior.rows, set_aside: prior.set_aside }, null, readPlacementFormInput(dir)).form);
    return validators.placement(out, readFileSync(out, "utf8"));
  };
  return { dir, P, redispatch };
}

test("a crowded (b) one line larger: placement runs again, and the step is told its row's count no longer holds", (t) => {
  const band = [...Array.from({ length: 1000 }, (_, i) => rec(`b${i}`, `Owner ${i} Ltd`)), rec("x1", "Owner X Ltd")];
  const shown = derive(band, (id) => (id === "x1" ? null : "printers"));   // x1's goods not yet on file
  const later = derive(band, () => "printers");                             // fetched after placement: x1 joins (b)
  assert.deepEqual([shown.shape.groups.b.records, later.shape.groups.b.records], [1000, 1001], "guard: (b) is crowded and grew by one");
  const x1 = shown.shape.floors.in_class_identical_or_near.find((f) => f.record_id === "/mark/eu/x1");
  const { dir, P, redispatch } = resumed(t, shown, later, [
    { set_aside_group: "b", count: 1000, ground: "identical marks in the class, for goods unrelated to the client's" },
    { select: x1.record_id, tier: "watchlist-annex", reason: "identical, live, goods not on file" },
  ]);
  assert.equal(floorDutyBlocksSkip(dir, "placement-inquiry"), false, "control: the pass's own artifact would let placement skip");
  assert.equal(floorDutyOwedNow(P, "placement-inquiry"), true, "the duty on the shape now on disk did not send placement out again");
  const said = redispatch();
  assert.equal(said.ok, false);
  assert.match(said.reason, /the row on group b \(count 1000 is not the shape's 1001\)/, "the step was not told why its row no longer holds");
});

test("a floor the new shape adds: placement runs again, and the step is told the floor it owes", (t) => {
  const band = [rec("f1", "Alpha Ltd"), rec("f2", "Beta GmbH", ["10"])];
  const shown = derive(band, () => "printers", ["9"]);
  const later = derive(band, () => "printers", ["9", "10"]);                // class 10 now read in scope: f2 is a floor
  assert.deepEqual([shown.shape.floors.in_class_identical_or_near.length, later.shape.floors.in_class_identical_or_near.length], [1, 2], "guard: one floor added");
  const { P, redispatch } = resumed(t, shown, later, [{ select: "/mark/eu/f1", tier: "watchlist-annex", reason: "identical, live, goods unrelated" }]);
  assert.equal(floorDutyOwedNow(P, "placement-inquiry"), true, "a floor the new shape adds did not send placement out again");
  assert.match(redispatch().reason, /placement_floors_without_fate=1: \/mark\/eu\/f2/, "the step was not told the floor it owes");
});

test("an unchanged shape, a fresh run and an unarmed run skip as before", (t) => {
  const band = [rec("f1", "Alpha Ltd")];
  const shown = derive(band, () => "printers");
  const { dir, P } = resumed(t, shown, shown, [{ select: "/mark/eu/f1", tier: "watchlist-annex", reason: "identical, live, goods unrelated" }]);
  assert.equal(floorDutyOwedNow(P, "placement-inquiry"), false, "an unchanged shape sent placement out again");
  assert.equal(floorDutyOwedNow(P, "register-digest"), false, "another stage was held to placement's duty");
  rmSync(P.placementModel);
  assert.equal(floorDutyOwedNow(P, "placement-inquiry"), false, "a run with no placement yet was held");
  rmSync(driverDir(dir), { recursive: true, force: true });
  mkdirSync(driverDir(dir), { recursive: true });
  assert.equal(floorDutyOwedNow(P, "placement-inquiry"), false, "an unarmed run was held");
});
