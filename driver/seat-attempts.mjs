// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// seat-attempts.mjs — READING A SEAT'S OWN ATTEMPT RECORD. PURE, and the ONE reader of that shape.
//
// The driver writes one row per dispatch into `_driver/<seat>.jsonl`: `{attempt, key, status, fail?}`.
// That file is the authority on what a seat was asked, how many times, and what refused it — never the
// dispatch files on disk, whose names tell you nothing reliable and which produced two false blanks the
// last time they were read as a substitute.
//
// These primitives moved here FROM scripts/seat-retry-report.mjs when needed them at
// RUNTIME, not just in a reporting tool. They were not copied: the script imports them from here now.
// A second reader of one record shape is the defect this codebase spent 2026-08-14 removing, and it
// would be a poor day's work to introduce one while fixing an instance of it.

/** A SEAT DISPATCH row, by shape — the filename tells you nothing reliable. */
export function isDispatchRow(d) {
  return !!d && typeof d === "object"
    && Number.isInteger(d.attempt) && d.attempt >= 1
    && typeof d.key === "string" && d.key.length > 0
    && typeof d.status === "string" && d.status.length > 0;
}

/** Parse one jsonl, keeping dispatch rows in file order. A damaged line is skipped, never fatal. */
export function dispatchRows(text) {
  const rows = [];
  for (const line of String(text ?? "").split("\n")) {
    if (!line.trim()) continue;
    let d; try { d = JSON.parse(line); } catch { continue; }
    if (isDispatchRow(d)) rows.push(d);
  }
  return rows;
}

/**
 * Split one seat's dispatches into CYCLES.
 *
 * A cycle boundary is an attempt number that does not advance — the driver re-ran the stage from the
 * top. This reads the attempt counter the driver itself wrote; it never infers a cycle from files on
 * disk. PURE.
 */
export function cyclesOf(rows) {
  const cycles = [];
  let cur = [];
  for (const d of rows) {
    if (cur.length && d.attempt <= cur[cur.length - 1].attempt) { cycles.push(cur); cur = []; }
    cur.push(d);
  }
  if (cur.length) cycles.push(cur);
  return cycles;
}

/** The fault class, not the whole string: `invalid_file:<long path>` groups with its siblings. */
export const failKind = (f) => (typeof f === "string" && f ? f.split(":")[0] : null);

/**
 * The fail signatures THIS RUN HAS ALREADY CORRECTED for one seat.
 *
 * A signature is CLEARED when it fired inside a cycle that the seat then finished clean. That is a
 * fact about work already done, and it is the thing a designed followup was throwing away: the
 * corrective ladder resumes and composes from `lastFail`, but `composeFollowup` is — in its own doc
 * block — addressed to "a session that has nothing". So a refinement pass twenty-seven minutes later
 * re-authored under doctrine alone and reintroduced the violation the earlier cycle had corrected,
 * eight times over, because the refinement touched eight findings where the first fault touched one.
 *
 * A CYCLE THAT IS STILL OPEN CONTRIBUTES NOTHING, and that is the load-bearing half. Its last attempt
 * may yet fail; calling its faults "corrected" would tell the next dispatch a repair had held when it
 * had not, which is a worse instruction than silence. Only a cycle whose final row carries no `fail`
 * counts — the same evidence a reader would use.
 *
 * Returns fail KINDS, not whole signatures: `invalid_file:/very/long/path` is the same defect whichever
 * path it names, and the constraint a followup needs to state is the class.
 *
 * @param {Array<object>} rows  dispatch rows for ONE seat, in file order
 * @returns {string[]} sorted, deduped
 */
export function clearedSignatures(rows) {
  const out = new Set();
  for (const cycle of cyclesOf(rows)) {
    const last = cycle[cycle.length - 1];
    if (!last || (typeof last.fail === "string" && last.fail)) continue;   // still open, or ended failing
    for (const d of cycle) {
      const kind = failKind(d.fail);
      if (kind) out.add(kind);
    }
  }
  return [...out].sort();
}
