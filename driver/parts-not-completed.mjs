// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// parts-not-completed.mjs — the record that one part of a clearance run could not be completed, written where the
// run would otherwise end with no report and read where the run is resumed, so the resumed pass delivers without
// that part and says so.
//
// THE RULE (874: a run always delivers; 2026-09-25: a part that still fails ships flagged). A failure whose recovery
// is spent used to end the run with the stop notice and nothing delivered, even where the run held everything but
// the part that failed. For a covered part, the run-level catch writes this record instead and parks the run for an
// immediate resume. The resumed pass reaches the part, finds the record, and takes the part's delivery without it.
//
// ONE FILE PER PART, under `_driver/not-completed/<part>.json`, so each part's state is read on its own and a
// republish reads the same state the delivery did. The record is a STATED STATE, never inferred from an absence:
// publishing, the workbook, the email and the portal read it, so an empty findings section is never mistaken for a
// search that found nothing.
//
// ONCE PER PART. The catch never writes a part whose record already exists: a failure on the pass that delivers
// without it ends the run as it always did, with the stop notice, and the record is removed then, so a later resume
// tries the part again.
//
// A pure leaf: node:fs, node:path and shared/driver-dir.mjs only.
import { readFileSync, writeFileSync, renameSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { driverDir, ensureDriverDir } from "../shared/driver-dir.mjs";

export const NOT_COMPLETED_DIR = "not-completed";

// The covered parts. `assessment` is the run's overall assessment: synthesis, and everything built from it.
export const NOT_COMPLETED_PARTS = Object.freeze(["assessment"]);

/** The record's path for `part`. */
export function notCompletedPath(runDir, part) {
  return driverDir(runDir, NOT_COMPLETED_DIR, `${part}.json`);
}

/**
 * Record that `part` could not be completed. `stage` is the stage that failed, `reason` its cause for the run's record
 * (never a reader's cell), `sig` and `terminalKind` what the recovery decision said. Written through a temporary file
 * and a rename, so a reader never sees half a record. Returns the record.
 */
export function writePartNotCompleted(runDir, part, { stage = null, reason = null, sig = null, terminalKind = null } = {}) {
  if (!NOT_COMPLETED_PARTS.includes(part)) throw new Error(`parts-not-completed: "${part}" is not a covered part`);
  const record = { part, stage, reason: reason == null ? null : String(reason).slice(0, 600), sig, terminalKind,
    ts: new Date().toISOString() };
  const path = notCompletedPath(runDir, part);
  ensureDriverDir(runDir, NOT_COMPLETED_DIR);
  writeFileSync(`${path}.tmp`, JSON.stringify(record, null, 2) + "\n");
  renameSync(`${path}.tmp`, path);
  return record;
}

/**
 * The record for `part`, or null when there is none. A record that is there and cannot be read still states the
 * part as not completed: the file's presence is the state, so a damaged one returns `{ part, damaged: true }` rather
 * than null, and nothing reads a damaged record as a completed part.
 */
export function readPartNotCompleted(runDir, part) {
  let raw;
  try { raw = readFileSync(notCompletedPath(runDir, part), "utf8"); } catch { return null; }
  try {
    const record = JSON.parse(raw);
    if (record && typeof record === "object" && !Array.isArray(record)) return { ...record, part };
  } catch { /* damaged, below */ }
  return { part, damaged: true };
}

/** Every part this run records as not completed, in NOT_COMPLETED_PARTS order. */
export function partsNotCompleted(runDir) {
  let names = [];
  try { names = readdirSync(driverDir(runDir, NOT_COMPLETED_DIR)); } catch { return []; }
  return NOT_COMPLETED_PARTS.filter((p) => names.includes(`${p}.json`)).map((p) => readPartNotCompleted(runDir, p));
}

/** Remove every part's record, when the run ends with the stop notice instead of a delivery. */
export function clearPartsNotCompleted(runDir) {
  try { rmSync(join(driverDir(runDir), NOT_COMPLETED_DIR), { recursive: true, force: true }); } catch { /* none */ }
}
