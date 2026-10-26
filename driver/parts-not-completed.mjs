// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// parts-not-completed.mjs — the record that one part of a clearance run could not be completed, written where the
// run would otherwise end with no report and read where the run is resumed, so the resumed pass delivers without
// that part and says so.
//
// THE RULE (a run always delivers; 2026-09-25: a part that still fails ships flagged). A failure whose recovery
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
// tries the part again. The searches are the one part whose record grows: each failure names the slices it could not
// prove ran, and a failure that names a slice the record does not hold yet adds it; one that names none new ends the
// run, so the run still ends.
//
// A pure leaf: node:fs, node:path, shared/driver-dir.mjs and shared/slices-taken-out.mjs (node:fs and the same) only.
import { readFileSync, writeFileSync, renameSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { driverDir, ensureDriverDir } from "../shared/driver-dir.mjs";
// Where the record sits is stated with the band readers outside the driver, which read the searches' record too.
import { NOT_COMPLETED_DIR, notCompletedPath } from "../shared/slices-taken-out.mjs";

export { NOT_COMPLETED_DIR, notCompletedPath };

// The covered parts. `assessment` is the run's overall assessment: placement, the register write-up and synthesis, and
// everything built from them. `review` is the first review of the assessment, whose verdict the sign-off is. `overview`
// is the report overview, the conclusion under the rating. `delivery` is the
// changed-material check before publishing: it never delivers past staleness, and its record buys the report one more
// assembly from the current material instead of the stop notice. `searches` is the register's searches: the slices a
// check could not prove ran, each with its axis, its qid and the reason it is open, taken out of the band and
// delivered as open rows; and the axes whose pass was killed at its time limit, read as the last pass left them and
// disclosed, their clean claims open (`disclosed_axes`).
export const NOT_COMPLETED_PARTS = Object.freeze(["assessment", "review", "overview", "delivery", "searches"]);

/**
 * Record that `part` could not be completed. `stage` is the stage that failed, `reason` its cause for the run's record
 * (never a reader's cell), `sig` and `terminalKind` what the recovery decision said. Written through a temporary file
 * and a rename, so a reader never sees half a record. Returns the record.
 */
export function writePartNotCompleted(runDir, part, { stage = null, reason = null, sig = null, terminalKind = null, slices = null, disclosedAxes = null } = {}) {
  if (!NOT_COMPLETED_PARTS.includes(part)) throw new Error(`parts-not-completed: "${part}" is not a covered part`);
  const record = { part, stage, reason: reason == null ? null : String(reason).slice(0, 600), sig, terminalKind,
    ...(Array.isArray(slices) ? { slices } : {}), ...(Array.isArray(disclosedAxes) && disclosedAxes.length ? { disclosed_axes: disclosedAxes } : {}),
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

/**
 * The slices of `failed` that `record` does not hold yet, each `{axis, qid, reason}`, or `{axis, query, reason}` for a
 * slice with no qid, which its query names: what a failure of the searches adds to their record. [] when it adds
 * none. PURE.
 */
export function slicesNotYetRecorded(record, failed) {
  const keyOf = (s) => `${s?.axis}\u0000${s?.qid ? `qid:${s.qid}` : `query:${s?.query}`}`;
  const held = new Set((Array.isArray(record?.slices) ? record.slices : []).map(keyOf));
  const out = [];
  for (const s of Array.isArray(failed) ? failed : []) {
    if (!s?.axis || (!s?.qid && !s?.query) || held.has(keyOf(s))) continue;
    held.add(keyOf(s));
    out.push(s.qid ? { axis: String(s.axis), qid: String(s.qid), reason: String(s.reason ?? "") }
      : { axis: String(s.axis), query: String(s.query), reason: String(s.reason ?? "") });
  }
  return out;
}

/**
 * The axes of `failed` that `record` does not list as disclosed yet: a pass on each was killed at its time limit and its
 * recovery is spent, so the delivering pass reads its band as it stands and discloses it. [] when it adds none. PURE.
 */
export function axesNotYetDisclosed(record, failed) {
  const held = new Set(Array.isArray(record?.disclosed_axes) ? record.disclosed_axes : []);
  return [...new Set((Array.isArray(failed) ? failed : []).map((a) => String(a ?? "").trim()).filter((a) => a && !held.has(a)))];
}

/** Remove one part's record, once that part has completed after all. */
export function clearPartNotCompleted(runDir, part) {
  try { rmSync(notCompletedPath(runDir, part), { force: true }); } catch { /* none */ }
}

/** Remove every part's record, when the run ends with the stop notice instead of a delivery. */
export function clearPartsNotCompleted(runDir) {
  try { rmSync(join(driverDir(runDir), NOT_COMPLETED_DIR), { recursive: true, force: true }); } catch { /* none */ }
}
