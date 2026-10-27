// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// slices-taken-out.mjs — a band read with the slices a check could not prove ran taken out, by every reader of it.
//
// The run's searches record (driver/parts-not-completed.mjs, its `searches` part) names each slice taken out of a band
// and delivered open: its axis, and its qid or, for a slice with none, its query. A unit re-run after the fan-in writes
// its axis's band whole, so such a slice can come back with the records nobody could prove were searched. Every reader
// that takes a band's blocks as answers reads the recorded slices out: the pipeline's merge and plan join, the answers
// the workers share, the propose tool's check on a re-proposed question, and the executor's checks on a follow-up asked
// before and on a parent before it releases a child. Each reads them out in memory and never by writing the file: a
// unit or the executor may be writing that band at the same moment.
//
// HERE AND NOT IN THE DRIVER, because the executor reads it too and nothing under providers/ imports the driver. Where
// the record sits is stated here for the same reason, once, for its writer and its readers alike.
//
// A pure leaf: node:fs and shared/driver-dir.mjs only.
import { readFileSync } from "node:fs";
import { driverDir } from "./driver-dir.mjs";

/** The folder under `_driver/` holding the record of each part a run could not complete. */
export const NOT_COMPLETED_DIR = "not-completed";

/** The record's path for `part`. */
export function notCompletedPath(runDir, part) {
  return driverDir(runDir, NOT_COMPLETED_DIR, `${part}.json`);
}

/**
 * The slices the run's searches record took out of the band, by axis, each named by its qid or, with none, its query.
 * Empty when the run has no record, and when its record cannot be read: a damaged record names no slice. IMPURE (reads
 * the record).
 */
export function slicesTakenOutByAxis(runDir) {
  const byAxis = new Map();
  let slices = [];
  try { slices = runDir ? JSON.parse(readFileSync(notCompletedPath(runDir, "searches"), "utf8"))?.slices : []; } catch { slices = []; }
  for (const s of Array.isArray(slices) ? slices : []) {
    if (!s?.axis || (!s?.qid && !s?.query)) continue;
    if (!byAxis.has(s.axis)) byAxis.set(s.axis, []);
    byAxis.get(s.axis).push(s);
  }
  return byAxis;
}

/**
 * A band's blocks with `slices` taken out: each becomes the executor's deferred block, or is added as one. A slice with
 * no qid is named by its query: the block with no qid on that query becomes a deferred block on it, and nothing is
 * added where the band holds none. PURE.
 */
export function bandWithSlicesOut(blocks, slices) {
  const out = Array.isArray(blocks) ? [...blocks] : [];
  const taken = [];
  for (const s of Array.isArray(slices) ? slices : []) {
    const i = s.qid ? out.findIndex((b) => b?.qid === s.qid) : out.findIndex((b) => b && !b.qid && b.query === s.query);
    if (!s.qid && i < 0) continue;
    const was = i >= 0 ? out[i] : null;
    if (was?.error === true && was.deferred === true && was.reason === s.reason) continue;
    const block = { state: "incomplete", ...(s.qid ? { qid: s.qid } : {}), query: String(was?.query ?? s.query ?? s.qid), total_hits: 0, fetched: 0,
      sample: [], error: true, deferred: true, reason: String(s.reason) };
    if (i >= 0) out[i] = block; else out.push(block);
    taken.push(s);
  }
  return { blocks: out, taken };
}
