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

// ── A STAGE'S TIME LIMIT IS DERIVED FROM WHAT IT IS HANDED, NEVER A FIXED CONSTANT ────────────────
//
// THE DEFECT. The two stages that read the register band carried per-stage constants — numbers chosen
// once, against a band nobody recorded beside them. On a dense matter both died at their wall having
// written nothing: the placement attempt at 2,765s against a 2,700s budget, the digest at 2,470s
// against 2,400s. Both sat exactly AT the ceiling, so what ended them was the budget expiring rather
// than any guard firing; the stall guards had half an hour of quiet to fire in and could not, because
// tokens were still moving. Nothing malfunctioned. The number was simply sized for a different matter.
//
// THE TWO MEASUREMENTS THESE CONSTANTS ARE SET AGAINST, named here because a budget without the band
// it was measured at is the thing being fixed:
//   · 2026-09-16, the dense matter: an 8 MB merged band; the placement attempt needed more than 2,765s
//     and was killed at 2,700s. The derived limit at that size must exceed what the attempt took.
//   · Every ordinary matter before it: a band at or under REFERENCE_MB, where 2,700s was sufficient and
//     is what those runs are verified at. At or below that size the derivation must return the base
//     unchanged, so no existing run's budget moves and no archived verdict is re-decided.
export const LIMIT_REFERENCE_MB = 2;
export const LIMIT_GROWTH_PER_MB = 0.03;
// The band size above which a stage is refused at dispatch rather than started. A limit past this is
// not a budget, it is a prediction that the stage will die: the 177 MB band measured on an earlier
// round would derive past an hour and a half, and starting it spends that hour and a half to arrive
// where the refusal already is. Refusing NAMES the size, which is the finding; being killed does not.
export const LIMIT_CEILING_SEC = 5400;

/**
 * The time limit for this dispatch, derived from the band it is handed. PURE.
 *
 * ABOVE THE REFERENCE SIZE ONLY. A band at or under the reference returns the stage's own base
 * unchanged — that is what every run before this is verified at, and a derivation that moved those
 * numbers would re-decide archived verdicts to fix a defect they never had.
 *
 * AN UNMEASURABLE BAND RETURNS THE BASE, and says so through `basis`. The alternatives are worse in
 * both directions: guessing a bigger number spends a client's money on an input nobody measured, and
 * guessing a smaller one kills a stage for a band that might have been ordinary. The base is what the
 * run would have used anyway, so an absent measurement changes nothing rather than changing something
 * arbitrary.
 */
export function derivedLimitSec(baseSec, bandSize) {
  const base = Number.isFinite(baseSec) && baseSec > 0 ? baseSec : null;
  if (base === null) return { sec: null, inputBytes: null, basis: "no base for this stage" };
  const bytes = Number.isFinite(bandSize?.bytes) ? bandSize.bytes : null;
  if (bytes === null) return { sec: base, inputBytes: null, basis: bandSize?.absent ? `band unmeasured: ${bandSize.absent}` : "no band for this stage" };
  const mb = bytes / (1024 * 1024);
  const over = Math.max(0, mb - LIMIT_REFERENCE_MB);
  const sec = Math.round(base * (1 + LIMIT_GROWTH_PER_MB * over));
  return { sec, inputBytes: bytes, basis: over > 0 ? `derived from ${mb.toFixed(1)} MB` : `at or under the ${LIMIT_REFERENCE_MB} MB reference` };
}

/** Is this derived limit past the point where starting the stage only buys a later kill? PURE. */
export function limitExceedsCeiling(sec) {
  return Number.isFinite(sec) && sec > LIMIT_CEILING_SEC;
}

/** The refusal a dispatch past the ceiling carries — it NAMES the size, which is the finding. PURE. */
export function ceilingRefusal(stage, derived) {
  const mb = Number.isFinite(derived?.inputBytes) ? (derived.inputBytes / (1024 * 1024)).toFixed(1) : "an unmeasured";
  return `stage_input_over_ceiling:${stage} was handed a ${mb} MB band, which derives a ${derived?.sec}s limit against a ${LIMIT_CEILING_SEC}s ceiling — the stage is refused at dispatch rather than started, because a limit past the ceiling is a prediction that it will be killed and starting it spends the whole budget to arrive at the same place. The band size is the finding: a band this size is the defect, not the budget`;
}
