// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// band-size.mjs — how big the register band was when a stage was dispatched against it.
//
// WHY A BUDGET NEEDS THIS BESIDE IT. Two judgment stages carry hand-set walls — 2700s and 2400s — and
// each was raised after a kill on one crowded matter. The numbers are in the stage table with their
// post-mortems, and not one of them records the BAND SIZE it was sized against, so the next person
// asking "is 2400 enough" has no denominator and re-derives it from an archived run by hand. That
// happened; it is why this exists.
//
// IT READS THE SHAPE, NOT THE BAND. `band-shape.json` is derived once per run and already carries the
// record and crowd totals, so the cost here is one small read rather than parsing the merged band on
// every dispatch. The band's own file supplies bytes, which is a stat.
//
// AN ABSENT BAND IS A NAMED REASON, NEVER A ZERO. A register-only run with nothing retrieved, a matter
// with no Nice classes (which compiles no register plan at all), and a replay of an archived run that
// predates the shape all reach a dispatch with no band on disk. Written as `0` those become a
// measurement saying the band was empty, which is a different and false claim — and every rollup that
// averages this field would silently take it. The same distinction `toolWaitByTool` draws: an object is
// a measurement, and the absence says which absence it is.
import { existsSync, readFileSync, statSync } from "node:fs";
import { BAND_READING_STAGES } from "./stages.mjs";

/**
 * The band this dispatch is about to be judged against, as a measurement or a named absence.
 *
 * @param {{bandShape: string, registerNamedBand: string}} paths  the run's own paths (`ctx.paths`)
 * @param {object} [io]  injectable for tests — the real fs by default
 * @returns {{records:number, crowds:number, bytes:number}|{absent:string}}
 */
export function bandSizeAtDispatch(paths, {
  exists = existsSync, read = readFileSync, stat = statSync,
} = {}) {
  const shapePath = paths?.bandShape;
  const bandPath = paths?.registerNamedBand;
  if (!shapePath || !bandPath) return { absent: "no run paths" };
  if (!exists(bandPath)) return { absent: "no merged register band on disk" };
  // Bytes first: it is a stat, it cannot fail the way a parse can, and a band whose shape has not been
  // derived yet is still a band whose size is worth recording.
  let bytes = null;
  try { bytes = stat(bandPath).size; } catch (e) { return { absent: `band unstatable (${e?.code ?? "unknown"})` }; }
  if (!exists(shapePath)) return { absent: "no band shape derived yet", bytes };
  let shape;
  try { shape = JSON.parse(read(shapePath, "utf8")); }
  catch (e) { return { absent: `band shape unreadable (${e?.code ?? "parse"})`, bytes }; }
  const t = shape?.totals;
  // A shape whose totals are not numbers is not a measurement of anything — say so rather than coercing.
  if (!t || !Number.isFinite(t.records) || !Number.isFinite(t.crowds)) {
    return { absent: "band shape carries no totals", bytes };
  }
  return { records: t.records, crowds: t.crowds, bytes };
}

/**
 * The band size to record for `stage`, or undefined for a stage that does not read the band.
 *
 * THE DECISION LIVES HERE RATHER THAN AT THE CALL SITE, and that is the lesson of a plant that did not
 * red: with the branch written inline in the dispatch, disabling the measurement outright changed
 * nothing any test could see. A stage outside the set gets `undefined` and not a named absence, because
 * "this stage does not read the band" is not a fact about the band.
 */
export function bandSizeForStage(stage, paths, io) {
  if (!BAND_READING_STAGES.has(stage)) return undefined;
  return bandSizeAtDispatch(paths, io);
}
