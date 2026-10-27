// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A PLACEMENT PASS THE DELIVERY GATE REPEATS IS RECORDED LIKE THE FIRST.
//
// When placement's answer goes stale before delivery, the delivery gate runs the step again and the report is
// rebuilt from the new answer. The main path records what each placement pass did, at once: the ground every
// record left the picking step with, the floors it answered, and the stamp that says the pass ran under the
// floors order. The repeated pass recorded none of it, so the discard ledger kept the first pass's grounds and
// the floor duty described placements the delivered report no longer held. One helper now records a pass, and
// both paths call it. The stamp stays the main path's: the repeated pass arms nothing, and the floor the run is
// already held to is applied again to the repeated pass's account, where the gate rebuilds the report from it.
// A pass that was skipped decided nothing: the earlier pass's grounds stand. The record trace is authored before
// the delivery gate and is not derived again after its repairs; that is its own limit, older than this.
// Every mark and owner is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { paths } from "../stages.mjs";
import { buildBandShape, deriveRegisterPositions } from "../band-shape.mjs";
import { setAsideKeysOf, renderPlacementsJson } from "../placement-form.mjs";
import { unionPlacementForm } from "../placement-union.mjs";
import { writePlacementForm } from "../placement-form-io.mjs";
import { goodsWordCounter, goodsWordsMatched } from "../record-goods.mjs";
import { recordPlacementPass } from "../pipeline.mjs";
import { foldDiscardLedger, ledgerEnding, DISCARD_LEDGER_NAME } from "../record-discard.mjs";
import { FLOOR_DUTY_STAMP } from "../floor-duty.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const rec = (id, mark, owner, extra = {}) => ({ record_id: `/mark/eu/${id}`, mark_text: mark, owner_name: owner, classes: ["9"],
  status: "registered", jurisdictions: ["EU"], ...extra });
const BAND = [
  rec("a1", "QZORVAK", "Alpha Ltd"),      // (a), a floor: placed
  rec("a2", "Plimbo", "Alpha Ltd"),       // (d): set aside by name
  rec("b1", "Qzorvak", "Beta GmbH"),      // (b), a floor: no fate
  rec("r1", "Drellux", "Delta AG"),       // the rest: its group's row
];
const GOODS = { a1: "joysticks", a2: "joysticks", b1: "printers", r1: "printers" };

function seedRun(t) {
  const runDir = mkdtempSync(join(tmpdir(), "placement-pass-record-"));
  t.after(() => rmSync(runDir, { recursive: true, force: true }));
  mkdirSync(driverDir(runDir), { recursive: true });
  const positions = deriveRegisterPositions(BAND);
  const goods = { of: (r) => { const g = GOODS[r.record_id.split("/").pop()]; return g ? [{ classes: ["9"], text: g }] : null; },
    hits: goodsWordCounter(["joysticks"]), matched: goodsWordsMatched(["joysticks"]) };
  const { shape } = buildBandShape({ enumerated: BAND }, { targets: ["Qzorvak"], inScopeClasses: ["9"], positions, goods,
    keysOf: setAsideKeysOf(positions.positions) });
  const read = ["a", "b", "c", "d", "rest", "no_goods"].flatMap((g) => shape.groups[g].list.map((l) => l.key));
  const input = { floors: shape.floors.in_class_identical_or_near, positions: positions.positions, groups: shape.groups,
    served: { lines: new Set(read), records: new Set() } };
  const u = unionPlacementForm(null, { rows: [
    { select: "/mark/eu/a1", tier: "headline-candidate", reason: "identical, live, for the client's own goods" },
    { set_aside: "/mark/eu/a2", ground: "a different product, sold only to farmers" },
    { set_aside_group: "rest", count: shape.groups.rest.records, ground: "similar to none of the mark's forms" },
  ] }, input);
  const P = paths(runDir);
  writeFileSync(P.registerNamedBand, JSON.stringify({ enumerated: BAND, crowds: [] }));
  writeFileSync(P.bandShape, JSON.stringify(shape));
  writeFileSync(P.registerPositions, JSON.stringify(positions));
  writePlacementForm(runDir, u.form);
  // Placement read every line: its reading log is what a group's row is checked against again.
  writeFileSync(driverDir(runDir, "reading-log.jsonl"), JSON.stringify({ ts: "2026-10-18T00:00:00Z", tool: "band_shape", args: { format: "md" },
    ok: true, part: 1, parts: 1, served_lines: read, session: "clearance-x-y-placement-inquiry" }) + "\n");
  writeFileSync(P.placementModel, JSON.stringify(renderPlacementsJson(u.form.rows)));
  return { runDir, ctx: { paths: P, run: { runDir } } };
}
const ledgerOf = (runDir) => readFileSync(driverDir(runDir, DISCARD_LEDGER_NAME), "utf8");

test("the repeated pass writes its own rows and its floor duty, as the first pass does, and arms nothing", (t) => {
  const { runDir, ctx } = seedRun(t);
  recordPlacementPass(ctx, { ok: true }, "stale-repair");
  const rows = ledgerOf(runDir).trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(rows.map((r) => r.uri).sort(), BAND.map((r) => r.record_id).sort(), "one row for every record the pass had in front of it");
  assert.ok(rows.every((r) => r.trigger === "stale-repair"), "each row says which pass wrote it");
  const folded = foldDiscardLedger(ledgerOf(runDir));
  assert.equal(ledgerEnding(folded, "/mark/eu/a2").reason, "placement:set-aside");
  assert.equal(ledgerEnding(folded, "/mark/eu/r1").reason, "placement:set-aside");
  assert.equal(ledgerEnding(folded, "/mark/eu/b1").reason, "placement:not-selected");
  assert.equal(ledgerEnding(folded, "/mark/eu/a1"), null, "the placed record is carried");
  const duty = JSON.parse(readFileSync(ctx.paths.floorDuty, "utf8"));
  assert.equal(duty.trigger, "stale-repair", "the floor duty is derived again for the pass that delivered");
  assert.deepEqual([duty.totals.floors, duty.totals.accounted, duty.undischarged_by_seat], [2, 1, 1]);
  assert.equal(existsSync(driverDir(runDir, FLOOR_DUTY_STAMP)), false, "the delivery gate's repeat armed the floor: the stamp is the main path's");
});

test("the main path's pass that ran is armed", (t) => {
  const { runDir, ctx } = seedRun(t);
  recordPlacementPass(ctx, { ok: true }, null);
  assert.ok(existsSync(driverDir(runDir, FLOOR_DUTY_STAMP)), "a pass that ran on the main path is armed");
  assert.equal(JSON.parse(readFileSync(ctx.paths.floorDuty, "utf8")).trigger, null);
});

test("a skipped pass decides nothing: the earlier pass's grounds stand and no stamp is written", (t) => {
  const { runDir, ctx } = seedRun(t);
  recordPlacementPass(ctx, { ok: true }, null);
  rmSync(driverDir(runDir, FLOOR_DUTY_STAMP));
  recordPlacementPass(ctx, { ok: true, skipped: true }, null);
  const folded = foldDiscardLedger(ledgerOf(runDir));
  assert.equal(ledgerEnding(folded, "/mark/eu/a2").reason, "placement:set-aside", "the skipped pass erased the step's ground");
  assert.equal(ledgerEnding(folded, "/mark/eu/r1").reason, "placement:set-aside");
  assert.equal(existsSync(driverDir(runDir, FLOOR_DUTY_STAMP)), false, "a skipped pass arms nothing");
  assert.deepEqual(JSON.parse(readFileSync(ctx.paths.floorDuty, "utf8")).pass, { ok: true, skipped: true });
});

test("the delivery gate's repeat of placement goes through the one helper, as the main path does", () => {
  const src = readFileSync(join(HERE, "..", "pipeline.mjs"), "utf8");
  const map = src.slice(src.indexOf("const UPSTREAM_STALE_REPAIR = {"), src.indexOf("export const DELIVERY_TAIL_LABEL_RE"));
  assert.match(map, /"placement-inquiry": async \(ctx\) => recordPlacementPass\(ctx, await stage\("placement-inquiry", ctx, \{ force: true, trigger: "stale-repair" \}\), "stale-repair"\)/);
  const start = src.indexOf("const placementPass = await asPartNotCompleted(\"assessment\", () => stage(\"placement-inquiry\", ctx));");
  const end = src.indexOf("await asPartNotCompleted(\"assessment\", async () => must(placementPass, \"placement-inquiry\"));");
  assert.ok(start >= 0 && end > start, "guard: the main path's placement call is not where this test reads it");
  const main = src.slice(start, end);
  assert.match(main, /recordPlacementPass\(ctx, placementPass\);/, "the main path records its pass through the same helper");
  // After a repeated placement pass the gate applies the floor again, through the one clamp the terminal checks use.
  const arm = src.slice(src.indexOf("} else if (UPSTREAM_STALE_REPAIR[s2.label]) {"), src.indexOf("} else if (s2.label.startsWith(\"report-card:\")) {"));
  assert.match(arm, /if \(s2\.label === "placement-inquiry"\) \{[\s\S]*?clampOnTheFloorDuty\(\{ again: true \}\);[\s\S]*?clampOnTheWritersDuty\(\{ again: true \}\);[\s\S]*?saveTheLabel\(/,
    "the repeated pass's floor account, and the recall gate's floor exclusion, are not judged again and the label saved before the report is rebuilt from them");
  assert.match(src, /const clampOnTheFloorDuty = \(\{ again = false \} = \{\}\) => \{\n\s+\/\/ THE PREDICATE IS `floorDutyBlock`/, "the terminal checks and the repair share one clamp");
});
