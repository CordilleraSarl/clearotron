// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// turnaround-bands.mjs — THE OWNER'S TURNAROUND BENCHMARKS, one row per pipeline.
//
// ── WHY THE BAND OWNS THE NUMBER ─────────────────────────────────────────────────────────────
//
// A benchmark held on the thing it judges cannot be exceeded. Four E2E scenarios in ONE band carried
// four different `cost.targetMinutes` — 120, 180, 240 and nothing at all — each copied from that
// scenario's own expected wall. So the harness printed `benchmark 180 min` beside a 171-minute run and
// the run read as comfortably inside, forever, while the engine's own line for the same run said
// "quoted 2h, actual 2.86h — 1.43× the quote". Same run, two numbers, and the one the harness used had
// been derived from the run. That is not a benchmark; it is a mirror.
//
// The number now lives HERE, on the band, and a scenario file cannot carry one at all — the E2E store
// lint refuses `cost.targetMinutes` / `cost.targetBand` outright. Which band a scenario is in is
// DERIVED from the policy its job resolves to at the doors, never from a word the scenario typed.
//
// ── WHAT A BAND IS: `policy.pipeline`, AND THERE ARE EXACTLY TWO ────────────────────────────────────
//
// `PRODUCT_POLICIES[*].pipeline` (search-policy.mjs) takes exactly two values across all four orderable
// products — `knockout` and `clearance`. That is the axis, and it is the axis the store already named.
//
// A THIRD AND FOURTH BAND ARE TABULATED ELSEWHERE AND ARE NOT RIVALS. The E2E role skill lists its
// benchmarks against "depths" — `knockout | 1-2 | 30 min`, `prelim | 3-4 | 120 min`,
// `full depth | 5 | 180 min`. Every one of those depth rows is a RETIRED_PRODUCTS entry: the Depth 1-5
// ladder was DELETED by owner ruling 2026-08-06, stated at search-policy.mjs:13-22 and enforced
// by the orderability wall. Nothing can be ordered at Depth 5, so `full depth` is not a live band.
//
// AND ITS 180 WAS NEVER A BENCHMARK. It was the effort model's own QUOTE for `full-country-search`,
// back when that quote was 1.5h base + 0.5 case law + 0.5 native lane + 0.5 single territory = 3.0h =
// 180 min. retired those adders — every clearance now quotes one ruled 1.5-2.5h range — so the
// coincidence is gone, but the point stands and is the reason this note stays: a quote is the size of
// the search we resolved to run; a benchmark is the wall the
// owner said that search should land inside. Tabulating the first as the second is the same substitution
// the scenario store had made, one document further out — which is why the skill's table reproduces the
// store's wrong 180 exactly. The two taxonomies therefore do not CONFLICT: one is live, the other is
// stale documentation of a deleted ladder, and this table is authoritative for the harness.
//
// ── PURE LEAF, ZERO IMPORTS ─────────────────────────────────────────────────────────────────────────
//
// Deliberately importless. scripts/e2e.mjs may not reach driver.config.mjs — whose unset-env defaults
// are PRODUCTION — through ANY chain, and this is the module it reads the benchmark from. Nothing here
// touches a store, a profile or an env var, so it unit-tests offline and cannot grow a chain later
// without that being visible in one line at the top of this file.
//
// ── IT IS A REPORTING BENCHMARK, NOT A BUDGET ───────────────────────────────────────────────────────
//
// Nothing in the engine reads this table and no stage stops on one of these numbers. A run over its
// band is a FINDING TO REPORT — the harness records it and a reader says why it took that long.

/**
 * The owner's benchmarks, keyed on `policy.pipeline`.
 *
 * `source` is on the row because the number is a DECISION, not a measurement, and a reader who is told
 * "120 min" without being told who set it and when has no way to tell a benchmark from an estimate —
 * which is the whole.
 */
export const TURNAROUND_BANDS = Object.freeze({
  knockout: Object.freeze({
    minutes: 30,
    source: "owner benchmark, 2026-08-04",
  }),
  clearance: Object.freeze({
    minutes: 120,
    source: "owner benchmark 2026-08-04, corrected 2026-08-08 (#523) after three scenarios were found carrying their own estimates instead",
  }),
});

/** The band ids, for a closed-set assertion. */
export const BAND_IDS = Object.freeze(Object.keys(TURNAROUND_BANDS));

/**
 * The band a resolved policy's pipeline falls in — `null` for anything this table has no row for.
 *
 * NULL IS AN ANSWER AND MUST STAY ONE. A default here would print a confident benchmark for a pipeline
 * nobody has set a number for, and the caller could not tell that from a real one.
 */
export function bandForPipeline(pipeline) {
  const key = typeof pipeline === "string" ? pipeline.trim().toLowerCase() : null;
  return key && Object.prototype.hasOwnProperty.call(TURNAROUND_BANDS, key) ? key : null;
}

/**
 * The benchmark in MINUTES for a band, or `null` when there is no such band.
 *
 * Minutes, said in the name, because this figure has three units in play around it: the harness measures
 * walls in SECONDS (runLedger), the engine quotes in HOURS (reconcileTurnaround), and the benchmark is in
 * MINUTES. Mixing them fails by printing a plausible number rather than by throwing.
 *
 * NEVER `?? 0`. A missing band is a band nobody set a number for; zero is a benchmark of zero minutes,
 * which every run on earth exceeds.
 */
export function benchmarkMinutes(band) {
  const row = TURNAROUND_BANDS[bandForPipeline(band)];
  return row ? row.minutes : null;
}

/** The provenance string for a band, or `null` — same three-valuedness as the number it explains. */
export function benchmarkSource(band) {
  const row = TURNAROUND_BANDS[bandForPipeline(band)];
  return row ? row.source : null;
}
