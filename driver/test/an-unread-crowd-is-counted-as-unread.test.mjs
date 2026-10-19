// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// AN UNREAD CROWD IS COUNTED AS UNREAD, AND A GROUP ROW'S LINES SAY WHAT THEIR GOODS REST ON.
//
// A crowd of a thousand records or more outside (a) takes its group's one row on its first page read and the count:
// the crowded-field method's "do not write up the rest" (ruled 2026-10-12). The row gives every line of the crowd a
// fate, and the fate count read each of them as covered by the group, whether the step had read the line or not.
// An unread crowd is not a clean negative (ruled 2026-10-18). The fate count now says, per list and in total, how
// many of the lines a group's row covers were never served to placement, and, where the run recorded what each
// record's goods rest on, what the goods of the covered lines rest on. Nothing is refused or clamped: this is the
// run's own record of an uncertainty the ruled method accepts, in the floor duty's artifact where the fate count
// already lives. Every mark and owner is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBandShape, deriveRegisterPositions, CROWDED_GROUP_RECORDS } from "../band-shape.mjs";
import { setAsideKeysOf, buildSelectionIndex, ownerFates, parsePlacementForm, renderPlacementsJson } from "../placement-form.mjs";
import { unionPlacementForm } from "../placement-union.mjs";
import { writePlacementForm } from "../placement-form-io.mjs";
import { goodsWordCounter, goodsWordsMatched } from "../record-goods.mjs";
import { placementOwnerFates } from "../pipeline.mjs";
import { paths } from "../stages.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";

const rec = (i) => ({ record_id: `/mark/eu/c${i}`, mark_text: "QZORVAK", owner_name: `Owner ${String(i).padStart(4, "0")} Ltd`, classes: ["9"], status: "registered", jurisdictions: ["EU"] });
function crowded() {
  const band = { enumerated: Array.from({ length: CROWDED_GROUP_RECORDS }, (_, i) => rec(i)), crowds: [] };
  const positions = deriveRegisterPositions(band.enumerated);
  const goods = { of: () => [{ classes: ["9"], text: "printers" }], hits: goodsWordCounter(["joysticks"]), matched: goodsWordsMatched(["joysticks"]) };
  const { shape } = buildBandShape(band, { targets: ["Qzorvak"], inScopeClasses: ["9"], positions, goods, goodsWordCount: 1,
    keysOf: setAsideKeysOf(positions.positions), caps: { owners: 5 } });
  return { band, shape, positions, input: { floors: shape.floors.in_class_identical_or_near, positions: positions.positions, groups: shape.groups } };
}
const ROW = { set_aside_group: "b", count: CROWDED_GROUP_RECORDS, ground: "identical marks in the class, for goods unrelated to the client's" };

test("a crowd's row covers lines placement never read: the fate count says how many, and the four fates still sum to the lines", () => {
  const { shape, input } = crowded();
  const read = new Set(shape.groups.b.list.slice(0, 5).map((l) => l.key));
  const u = unionPlacementForm(null, { rows: [ROW] }, { ...input, served: { lines: read, records: new Set() } });
  assert.equal(u.form.set_aside_groups.length, 1, "guard: the crowd's row stands on its first page read");
  const fates = ownerFates({ groups: input.groups, entries: parsePlacementForm(JSON.stringify(u.form)).set_aside,
    index: buildSelectionIndex(input), placedUris: [], served: read });
  assert.equal(fates.by_list.b.by_group, CROWDED_GROUP_RECORDS);
  assert.equal(fates.by_list.b.by_group_unread, CROWDED_GROUP_RECORDS - 5, "the lines past the first page were covered unread, and the count read them as any other");
  assert.equal(fates.by_group_unread, CROWDED_GROUP_RECORDS - 5);
  assert.equal(fates.reconciles, true, "covered unread is a kind of covered by the group, never a fifth fate");
});

test("the lines a group's row covers are counted by what their goods rest on", () => {
  const { shape, input } = crowded();
  const read = new Set(shape.groups.b.list.slice(0, 5).map((l) => l.key));
  const u = unionPlacementForm(null, { rows: [ROW] }, { ...input, served: { lines: read, records: new Set() } });
  const lineEvidence = (line) => (Number(String(line.record_id).replace(/\D/g, "")) % 2 ? "not-held" : "complete");
  const fates = ownerFates({ groups: input.groups, entries: parsePlacementForm(JSON.stringify(u.form)).set_aside,
    index: buildSelectionIndex(input), placedUris: [], served: read, lineEvidence });
  assert.deepEqual(fates.by_list.b.by_group_goods, { complete: CROWDED_GROUP_RECORDS / 2, "not-held": CROWDED_GROUP_RECORDS / 2 });
});

test("the run's fate count reads placement's own reading log and the run's goods record", (t) => {
  const { band, shape, positions, input } = crowded();
  const runDir = mkdtempSync(join(tmpdir(), "unread-crowd-"));
  t.after(() => rmSync(runDir, { recursive: true, force: true }));
  mkdirSync(driverDir(runDir), { recursive: true });
  const P = paths(runDir);
  writeFileSync(P.bandShape, JSON.stringify(shape));
  writeFileSync(P.registerPositions, JSON.stringify(positions));
  const read = shape.groups.b.list.slice(0, 5).map((l) => l.key);
  writeFileSync(driverDir(runDir, "reading-log.jsonl"), [
    { tool: "band_shape", args: { format: "md" }, ok: true, part: 1, parts: 1, served_lines: read, session: "clearance-x-y-placement-inquiry" },
    { tool: "band_shape", args: { format: "md" }, ok: true, part: 1, parts: 1, served_lines: shape.groups.b.list.map((l) => l.key), session: "clearance-x-y-synthesis" },
  ].map((r) => JSON.stringify(r)).join("\n") + "\n");
  const u = unionPlacementForm(null, { rows: [ROW] }, { ...input, served: { lines: new Set(read), records: new Set() } });
  writePlacementForm(runDir, u.form);
  const placements = renderPlacementsJson(u.form.rows).placements;
  writeFileSync(P.placementModel, JSON.stringify({ schema_version: 1, placements }));
  writeFileSync(driverDir(runDir, "goods-evidence.json"), JSON.stringify({ schema_version: 1,
    records: band.enumerated.map((r, i) => ({ uri: r.record_id, state: i < 10 ? "unavailable" : "complete" })) }));
  const { counted } = placementOwnerFates(P, placements);
  assert.equal(counted.by_list.b.by_group_unread, CROWDED_GROUP_RECORDS - 5, "what another stage read does not count as read by placement");
  assert.equal(counted.by_list.b.by_group_goods.unavailable, 10);
  assert.equal(counted.by_list.b.by_group_goods.complete, CROWDED_GROUP_RECORDS - 10);
});
