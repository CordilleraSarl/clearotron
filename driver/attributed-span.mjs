// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// attributed-span.mjs — driver work that takes real time, written where the decomposition can see it.
//
//, from the D8 addendum. Measured on R5 `7a30934b`: 13m41s of a 217-minute run sat
// "outside any stage", and the owner's question was the right one — how can code take 32 minutes? It
// cannot, and it did not. Driver compute across all three seams was **~5.5 seconds**. The rest was
// register dispatches and a completed engine turn, both of which happen between stages and neither of
// which left a row anything could attribute the time to. The term was never slack; it was mis-labelled
// search work.
//
// ── WHY A NEW SINK AND NOT AN EXISTING ONE ────────────────────────────────────────────────────────
//
// The decomposition reads `_driver/*.jsonl`, takes the FILENAME as the stage label, and counts a row
// only when it carries `wall` (seconds) and `ts` (the end). It skips `run.jsonl`. So the events that
// already describe this work — `repair-attempted`, `engine-turn-probe` — cannot attribute it no matter
// what fields they gain: they are written to the one file the instrument does not read. A duration on
// them makes the cost legible to a person; it moves the term by zero.
//
// ── WHY THESE ROWS ARE DELIBERATELY NOT DISPATCH-SHAPED ───────────────────────────────────────────
//
// `_driver/*.jsonl` is read by two instruments with different contracts, and this file has to satisfy
// exactly one of them:
//
//   · the wall decomposition wants `{ts, wall}` and attributes the interval `[ts − wall, ts]`.
//   · `seat-attempts.mjs` `isDispatchRow` wants `{attempt:int≥1, key, status}` and treats a file with
//     any such rows as a SEAT — which `scripts/seat-retry-report.mjs` then counts in its
//     fault-vs-refinement statistics.
//
// A register repair is not a seat, and an engine-turn preflight is not a seat. Filing them as seats
// would put driver-side work into a denominator that report keeps deliberately model-driven — the same
// distortion it already excludes `codeSeats` to avoid, except silent, because nothing would announce
// that the population had changed. So these rows carry `ts` and `wall` and NONE of the dispatch triple,
// which makes them invisible to the seat reader by construction rather than by a filename convention
// somebody has to maintain. The test pins that, because it is the whole design.
//
// ── WHAT THIS DELIBERATELY DOES NOT DO ────────────────────────────────────────────────────────────
//
// IT IS NOT A TIMER. It records a span the caller already measured. A helper that started its own clock
// would be a second opinion about when work began, and the caller is the only thing that knows.
//
// IT NEVER THROWS. Losing a receipt must not cost the work it describes — the same rule every other
// sidecar writer in this directory follows.

import { appendFileSync } from "node:fs";
import { ensureDriverDir, driverDir } from "../shared/driver-dir.mjs";

/** The fields that would make a row a SEAT dispatch. Named so the guard and the writer cannot disagree. */
export const DISPATCH_FIELDS = Object.freeze(["attempt", "key", "status"]);

/**
 * Record one span of driver-side work so the wall decomposition attributes it.
 *
 * @param {string} runDir
 * @param {string} name    the stage label the decomposition will print — it is the filename
 * @param {{startedMs: number, endedMs?: number}} span  milliseconds, from the caller's own clock
 * @param {object} detail  anything else worth keeping on the row; dispatch fields are refused
 */
export function recordSpan(runDir, name, { startedMs, endedMs = Date.now() } = {}, detail = {}) {
  try {
    if (!runDir || !name) return null;
    if (!Number.isFinite(startedMs) || !Number.isFinite(endedMs) || endedMs < startedMs) return null;
    // A span that claimed a dispatch field would silently enrol this file as a seat. Dropped rather than
    // written, and dropped here rather than trusted to every call site.
    const row = { ts: new Date(endedMs).toISOString(), wall: (endedMs - startedMs) / 1000 };
    for (const [k, v] of Object.entries(detail ?? {})) if (!DISPATCH_FIELDS.includes(k)) row[k] = v;
    ensureDriverDir(runDir);
    appendFileSync(driverDir(runDir, `${name}.jsonl`), JSON.stringify(row) + "\n");
    return row;
  } catch { return null; }   // a receipt we could not write is never worse than the work not happening
}
