// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A RUN THAT LEFT COVERAGE UNTRACED DECLARES IT AT DELIVERY.
//
// This is a NEW check rather than a repaired one, and the distinction is the reason it exists. Every other
// check in that module reads a stage or a step that failed, or a store the publisher could not read. None
// of them asked whether the run left coverage untraced — so a run delivering with slices it could not
// account for declared nothing, not because the mechanism was silent but because nothing in it was about
// coverage completeness. The part name had been there since the module shipped, reachable only through one
// store being unreadable.
//
// Measured on the run of 2026-09-27: 41 untraceable slices holding 4,835,678 hits against 9,865 records
// retrieved, and the delivery record read `parts: 0`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { degradedParts, PART_NAMES, NOT_COMPLETED } from "../degraded-parts.mjs";

/** A run directory carrying one record-carry artifact, or none when `totals` is null. */
function runWith(totals) {
  const dir = mkdtempSync(join(tmpdir(), "untraced-"));
  mkdirSync(driverDir(dir), { recursive: true });
  if (totals) writeFileSync(driverDir(dir, "record-carry.json"), JSON.stringify({ totals }));
  return dir;
}
const coverageOf = (dir) => degradedParts(dir).find((p) => p.part === "coverage");

test("a run with untraced slices declares the part, in the row's own words", () => {
  const dir = runWith({ untraceable_slices: 41, untraced_hits: 4_835_678, untraced_unknown_slices: 3 });
  try {
    const part = coverageOf(dir);
    assert.ok(part, "a run that left 41 slices untraced declared nothing at delivery");
    assert.equal(part.name, PART_NAMES.coverage, "the part is named something other than the tab a reader opens");
    assert.equal(part.reason, NOT_COMPLETED,
      "the reason is not one of the two tokens the shipped row translates, so a raw cause would reach a reader");
    assert.match(part.cause, /41 slice\(s\) left untraced/);
    assert.match(part.cause, /4835678 known hit\(s\)/);
    assert.match(part.cause, /3 of them with an unmeasurable remainder/,
      "the sum is stated as complete when three slices could not be added to it");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the gate is the slice COUNT, never the hit sum", () => {
  // THE ARITHMETIC THIS EXISTS FOR. A slice the provider REFUSED carries no untraced hits, so a run whose
  // provider refused every slice sums to zero — and a hit-sum gate reads that as a run with nothing to
  // say, which is the loudest possible run reported as silent.
  const dir = runWith({ untraceable_slices: 12, untraced_hits: 0, untraced_unknown_slices: 12 });
  try {
    const part = coverageOf(dir);
    assert.ok(part, "twelve refused slices summing to zero hits declared nothing — the gate is the sum");
    assert.doesNotMatch(part.cause, /known hit/, "a zero sum is stated as a quantity rather than omitted");
    assert.match(part.cause, /12 slice\(s\) left untraced/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a run that traced everything declares no part", () => {
  // The control. Without it the arms above cannot tell a check that fires on a real state from one that
  // fires on every run, which would put a caveat on every clearance this engine delivers.
  const dir = runWith({ untraceable_slices: 0, untraced_hits: 0, untraced_unknown_slices: 0 });
  try {
    assert.equal(coverageOf(dir), undefined, "a run with nothing untraced still declares a degraded part");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a run with no record-carry artifact declares nothing, and does not throw", () => {
  // AN ABSENT INPUT READS NOTHING AND REPORTS NOTHING — the module's own contract for every check, and
  // the reason it is right here: the run's record already carries that artifact's absence, and a check
  // that invented a part from a missing file would put a caveat on every archived run.
  const dir = runWith(null);
  try {
    assert.doesNotThrow(() => degradedParts(dir));
    assert.equal(coverageOf(dir), undefined, "a missing artifact was read as untraced coverage");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
