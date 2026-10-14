// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A MISSING FATE COUNT SAYS WHY.
//
// The floor duty's artifact carries every owner's fate at placement, counted by the band shape's lists. Its
// `owners` read null both when the shape had no groups to count by and when an input would not read, so the record
// could not tell an earlier shape from a gap. `owners` is still null whenever there is no count, so no reader takes
// an absence for a count, and `owners_absent` now says which it was. Every mark and owner here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { paths } from "../stages.mjs";
import { deriveFloorDuty, placementOwnerFates } from "../pipeline.mjs";
import { buildBandShape, deriveRegisterPositions } from "../band-shape.mjs";
import { setAsideKeysOf } from "../placement-form.mjs";

const band = [{ record_id: "/mark/eu/f1", mark_text: "QZORVAK", owner_name: "Alpha Ltd", classes: ["9"], status: "registered", jurisdictions: ["EU"] }];

function runWith(t, shape) {
  const dir = mkdtempSync(join(tmpdir(), "fate-count-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(driverDir(dir), { recursive: true });
  const positions = deriveRegisterPositions(band);
  writeFileSync(driverDir(dir, "register-positions.json"), JSON.stringify(positions));
  writeFileSync(driverDir(dir, "band-shape.json"), JSON.stringify(shape(positions)));
  const P = paths(dir);
  writeFileSync(P.placementModel, JSON.stringify({ placements: [] }));
  deriveFloorDuty({ paths: P }, { ok: true });
  return JSON.parse(readFileSync(P.floorDuty, "utf8"));
}

test("a shape with no groups: no count, and the record says the shape lists none", (t) => {
  const duty = runWith(t, () => ({ floors: { in_class_identical_or_near: [] } }));
  assert.equal(duty.computable, true);
  assert.equal(duty.owners, null, "an absence was written as a count");
  assert.equal(duty.owners_absent, "the band shape lists no groups");
});

test("a shape with groups: the count, and no absence beside it", (t) => {
  const duty = runWith(t, (positions) => buildBandShape({ enumerated: band }, { targets: ["Qzorvak"], inScopeClasses: ["9"], positions,
    keysOf: setAsideKeysOf(positions.positions), markets: ["EU"] }).shape);
  assert.equal(duty.owners?.lines, 1);
  assert.equal(duty.owners_absent, undefined);
});

test("an input that would not read: no count, and the record names the failure", () => {
  const r = placementOwnerFates({ runDir: undefined }, []);
  assert.equal(r.counted, undefined);
  assert.match(r.absent, /^an input could not be read: /, "a read failure was recorded as a shape with no groups");
});
