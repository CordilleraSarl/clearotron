// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A FLOOR ROW WHOSE OWNER'S SET WAS SET ASIDE WITH A GROUND IS ANSWERED.
//
// The picking step gives an owner's set of records one ground in a set-aside row, and by design that row
// renders into no placement. The floor check read `placements.json` alone, so it counted every record of
// a set-aside owner as unanswered, and the reviewer's floor ground blocked on records the step had
// answered. Measured 2026-09-25: 985 of the 990 floor rows one run reported unanswered had left the
// picking step with a ground.
//
// Driven through the pipeline's own floor-duty step over a run folder written the way a run writes it:
// the band shape, the positions, the driver's copy of the form and the rendered placements.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { paths } from "../stages.mjs";
import { deriveFloorDuty } from "../pipeline.mjs";
import { unionPlacementForm } from "../placement-union.mjs";
import { renderPlacementsJson } from "../placement-form.mjs";
import { writePlacementForm } from "../placement-form-io.mjs";
import { SET_ASIDE_TIER } from "../floor-duty.mjs";

// Invented owners and marks. Owner A holds three records, owner B one, and one record names no owner.
const pos = (records, mark, owner) => ({ records, mark_text: mark, owners: owner ? [owner] : [], owner_strings: [], classes: ["9"], territories: ["US"] });
const positions = [
  pos(["/mark/us/1001"], "TALVORIN", "Owner A Holdings"),
  pos(["/mark/us/1002"], "TALVORINE", "Owner A Holdings"),
  pos(["/mark/eu/1003"], "TALVOR", "Owner A Holdings"),
  pos(["/mark/us/2001"], "TALVARIN", "Owner B GmbH"),
  pos(["/mark/us/3001"], "TALVORINA", null),
];
const floors = positions.map((p) => ({
  record_id: p.records[0], mark_text: p.mark_text, owner_name: p.owners[0] ?? "", registry: p.territories[0],
  basis: "edit-1", status: "REGISTERED", live: true,
}));

function runWith(submitted) {
  const runDir = mkdtempSync(join(tmpdir(), "floor-set-aside-"));
  mkdirSync(driverDir(runDir), { recursive: true });
  writeFileSync(driverDir(runDir, "band-shape.json"), JSON.stringify({ floors: { in_class_identical_or_near: floors } }));
  writeFileSync(driverDir(runDir, "register-positions.json"), JSON.stringify({ positions }));
  const { form } = unionPlacementForm({ rows: [], set_aside: [] }, submitted, { floors, positions });
  writePlacementForm(runDir, form);
  const P = paths(runDir);
  writeFileSync(P.placementModel, JSON.stringify(renderPlacementsJson(form.rows), null, 2));
  deriveFloorDuty({ paths: P }, { ok: true });
  const duty = JSON.parse(readFileSync(P.floorDuty, "utf8"));
  rmSync(runDir, { recursive: true, force: true });
  return duty;
}

const PLACED = { select: "/mark/us/1001", tier: "sheet-2", reason: "Owner A's one software filing completes the record but does not change the advice." };

test("every unplaced record of a set-aside owner is answered, and so is a set-aside record with no owner", () => {
  const duty = runWith({ rows: [
    PLACED,
    { set_aside: "/mark/us/1002", ground: "Owner A's other marks are for kitchen tools, nowhere near the client's software." },
    { set_aside: "/mark/us/3001", ground: "A lapsed filing with no owner on record, for garden furniture." },
  ] });
  assert.equal(duty.computable, true, `the check could not run: ${duty.reason}`);
  assert.deepEqual(duty.totals, { floors: 5, accounted: 4, named_without_ground: 0, unanswered: 1, unanswerable: 0 });
  assert.deepEqual(duty.by_tier, { "sheet-2": 1, [SET_ASIDE_TIER]: 3 });
  const by = Object.fromEntries(duty.rows.map((r) => [r.record_id, `${r.disposition}/${r.tier}`]));
  assert.equal(by["/mark/us/1001"], "accounted/sheet-2", "the placed record lost its placement tier");
  assert.equal(by["/mark/eu/1003"], `accounted/${SET_ASIDE_TIER}`, "a record of the set-aside owner the row did not name was not answered");
  assert.equal(by["/mark/us/2001"], "unanswered/null", "an owner nobody answered for was counted answered");
  assert.equal(duty.undischarged_by_seat, 1);
  assert.equal(duty.reconciles, true);
});

test("THE CONTROL: with no set-aside row, only the placed record is answered, as before", () => {
  const duty = runWith({ rows: [PLACED] });
  assert.deepEqual(duty.totals, { floors: 5, accounted: 1, named_without_ground: 0, unanswered: 4, unanswerable: 0 });
  assert.deepEqual(duty.by_tier, { "sheet-2": 1 });
});
