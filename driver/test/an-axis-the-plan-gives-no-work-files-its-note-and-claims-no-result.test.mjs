// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// AN AXIS THE PLAN GIVES NO WORK FILES ITS NOTE, AND CLAIMS NO RESULT.
//
// On a plan run the driver sends a register unit for every axis the manifest's markers suggest, and the frozen plan can
// hold no entries for one of them. The plan executor refuses an empty axis, so a unit that judged its axis did not apply
// and searched nothing had no band, and its note was refused as an account of nothing: the pass then failed for want of
// a note no work was owed. The driver now writes that axis's band empty before the unit runs, as it already does for the
// code-side saturation probe. The note says no searches were planned, which tells no instructed work apart from
// unfinished instructed work, and a clean negative over a band where nothing ran is refused.
//
// Invented values only.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { seedUnplannedBands, plannedEntries, acceptUnitNote, recordUnitNote, renderUnitNote, unitPaths, bandAccount } from "../register-unit-record.mjs";
import { paths } from "../run-record.mjs";
import { driverSource } from "./driver-source.mjs";

const DIRS = [];
const runDir = () => { const d = mkdtempSync(join(tmpdir(), "unplanned-axis-")); DIRS.push(d); return d; };
after(() => { for (const d of DIRS) rmSync(d, { recursive: true, force: true }); });
const PLAN = { plan_version: 1, entries: [{ qid: "q1", axis: "primary-sweep", term: "INVENTED" }] };
const freeze = (dir, plan = PLAN) => { mkdirSync(join(dir, "_driver"), { recursive: true }); writeFileSync(paths(dir).registerPlan, JSON.stringify(plan)); };
const WHY = "The mark is in Latin script with no numerals, so this axis has nothing to transliterate or substitute.";

test("the driver writes the empty band only for an axis the plan gives no work, and never over a band already there", () => {
  const dir = runDir();
  assert.deepEqual(seedUnplannedBands(dir, PLAN, ["primary-sweep", "transliteration-numeric", "incumbent-class"]), ["transliteration-numeric", "incumbent-class"]);
  assert.equal(readFileSync(unitPaths(dir, "transliteration-numeric").band, "utf8"), "[]\n");
  assert.equal(existsSync(unitPaths(dir, "primary-sweep").band), false, "a planned axis was given a band before its searches ran");
  writeFileSync(unitPaths(dir, "incumbent-class").band, JSON.stringify([{ qid: "supp:x", state: "enumerated", records: [{}] }]));
  assert.deepEqual(seedUnplannedBands(dir, PLAN, ["incumbent-class"]), [], "a resumed unit's own band was overwritten");
  assert.deepEqual(seedUnplannedBands(dir, null, ["transliteration-numeric"]), [], "a run with no plan was given a band");
});

test("the note says no searches were planned, and a run without a plan keeps the counts line", () => {
  const empty = bandAccount([]);
  assert.match(renderUnitNote({ axis: "transliteration-numeric", account: empty, note: WHY, planned: 0 }), /^# Register unit — transliteration-numeric\n\nNo searches were planned for this axis\.\n\n/);
  assert.match(renderUnitNote({ axis: "transliteration-numeric", account: empty, note: WHY, planned: null }), /Searched this axis over 0 band blocks/);
  assert.match(renderUnitNote({ axis: "incumbent-class", account: bandAccount([{ state: "enumerated", records: [{}] }]), planned: 0 }), /Searched this axis over 1 band block/,
    "a unit that proposed its own searches is counted as searched");
});

test("a clean negative over a band where nothing ran is refused; over completed searches it stands", () => {
  const refused = acceptUnitNote({ axis: "transliteration-numeric", null_result: true, note: WHY }, { account: bandAccount([]), planned: 0 });
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /^unit_null_result_unsearched:transliteration-numeric — no search ran on this axis, so it has no result to call null\./);
  const searched = acceptUnitNote({ axis: "incumbent-class", null_result: true, note: WHY }, { account: bandAccount([{ state: "enumerated", records: [] }]), planned: 2 });
  assert.equal(searched.ok, true, searched.reason);
});

test("the note of a unit whose axis the plan gives no work is recorded, through the tool, over the band the driver wrote", () => {
  const dir = runDir();
  freeze(dir);
  assert.equal(plannedEntries(dir, "transliteration-numeric"), 0);
  assert.equal(plannedEntries(dir, "primary-sweep"), 1);
  // Before the driver writes the band, the note is an account of nothing, as it always was.
  assert.match(String(recordUnitNote(dir, { axis: "transliteration-numeric", note: WHY }).refused), /^unit_band_unreadable:/);
  seedUnplannedBands(dir, PLAN, ["transliteration-numeric"]);
  assert.match(String(recordUnitNote(dir, { axis: "transliteration-numeric", note: WHY, null_result: true }).refused), /^unit_null_result_unsearched:/);
  const r = recordUnitNote(dir, { axis: "transliteration-numeric", note: WHY });
  assert.equal(r.refused, null, r.refused);
  const note = readFileSync(unitPaths(dir, "transliteration-numeric").note, "utf8");
  assert.ok(note.includes("No searches were planned for this axis.") && note.includes(WHY), note);
});

test("the sweep writes those bands before its units run, and logs which", () => {
  const src = driverSource("steps/register-sweep.mjs");
  const seed = src.indexOf("seedUnplannedBands(P.runDir, ctx.registerPlan");
  assert.ok(seed > 0, "the sweep does not write the empty bands");
  assert.ok(seed < src.indexOf("const gather = clSplit"), "the empty bands are written after the units are sent");
  assert.ok(src.includes(`runLog(run.runDir, { event: "unit-band-seeded-empty", axes: seeded })`));
});
