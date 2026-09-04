// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// effort-model.mjs — how much work a search is, computed ONCE, server-side.
//
// This is a VERBATIM port of the effort half of portal-ui/src/contract/composerLevers.ts. Every weight,
// every rounding, every clamp is byte-faithful to it, and portal-ui/test/effortModelParity.test.ts pins
// the two together across a matrix of lever combinations. That test is the point of the file: the moment
// they disagree, the number a user was shown when they pressed the button is not the number the run was
// admitted under.
//
// WHY IT MOVED. The effort bar lived entirely in browser TypeScript, so:
//   - an MCP-driven run got no size signal at all (plan_run resolved depth, scope and allowance, and
//     said nothing about how big the search was);
//   - nothing recorded on the run what the requester had been shown, so no later measurement could ever
//     be joined back to the estimate that produced it;
//   - and any second surface would have had to reimplement it, which is how two ladders that must agree
//     forever get created. The codebase already made this move for validateJob and effective-scope:
//     ONE implementation, every door calls it.
//
// WHAT THIS IS NOT. It is not a price, and there is no currency here or downstream of here (owner
// directive 2026-07-11). It is a count of work, in units of its own. Turning units into money is a
// billing-side question answered against a rate card that does not live in the driver.
//
// THE THREE THINGS THAT MUST STAY SEPARATE — this is what keeps the model from locking anyone in:
//   1. SHAPE   — which inputs matter at all (names, classes, platforms, pipeline, lanes, territory).
//                Changes only when the PRODUCT changes. That is this file's structure.
//   2. WEIGHTS — how much each input contributes. Changes on every calibration and after every speed
//                pass. That is `W` and `UNITS_VERSION` below, and nothing else.
//   3. RATE    — units → money. Changes for commercial reasons, independently of both. NOT IN THIS REPO.
// Because the model is ADDITIVE, a new lever is a new term whose weight starts at zero until it has been
// measured: adding one invalidates no existing quote, and a price stays explainable to a lawyer, which a
// fitted non-linear model would not be.
//
// EVERY WEIGHT IS STILL A PLACEHOLDER. What is not a placeholder is the shape: the counts come from the
// engine. `UNITS_VERSION` is stamped onto every quote so weights can be re-fitted freely without making
// historical quotes uninterpretable — a quote already given is honoured at the version it was given.
//
// Pure leaf: no imports at all. A request path must be able to call this without pulling the driver in.

/**
 * Bump on ANY change to `W`, to the shape, or to a rounding rule — anything that could move the number
 * for an unchanged request. Quotes carry it, so a re-fit never rewrites history.
 *
 * 1 — the placeholder weights carried over verbatim from composerLevers.ts (2026-07-21 rebuild),
 *     uncalibrated. The first fit against measured consumption becomes 2.
 * 2 —: the levers became the four products. No weight moved, but the SHAPE did — one
 *     native-language lane instead of up to eight, and the marketplace half is no longer optional
 *     because no product omits it — so a quote at version 1 must not be read with this table.
 * 3 —: the turnaround quote became one ruled range per pipeline. No WEIGHT moved and the units are
 *     untouched, but the quote a request receives DID move — a Full country search went from "3 hours" to
 *     "1.5–2.5 hours" and a knockout from 45 to 15 minutes — and a stored quote is honoured at the version
 *     it was given. A version-2 quote must therefore not be read against this table.
 * 4 —: the wave multiplier is gone and the turnaround quote is a table lookup with no arithmetic
 *     (owner ruling 2026-08-26, recorded at `turnaroundBounds`). No weight moved and no unit changed.
 *     The SHAPE did, which is what this counter tracks — but state the size of it honestly: `runCount`
 *     is 1 for every job any door will admit, so the removed term was 1 on every quote that has ever
 *     been stored. No version-3 quote in any run record holds a number this table would not reproduce.
 *     The bump is the shape rule being followed, not a figure being corrected.
 */
export const UNITS_VERSION = 5;

// The grid-cell budgets, restated from profiles.mjs (SAFE_GRID_CELLS / DENSE_GRID_CELLS) rather than
// imported: this module is the SERVER half of a twin whose other half is a browser bundle, and it is kept
// dependency-free so the two stay structurally identical. Restating is what needs guarding, so it is
// guarded by behaviour instead of by sharing — driver/test/the-effort-model-predicts-the-run-it-quotes.test.mjs
// drives both against profiles.mjs over every value the validator admits.
export const SAFE_GRID_CELLS = 98;
export const DENSE_GRID_CELLS = 16;

/**
 * THE MACHINERY a search runs, as the effort model needs it. NOT the composer's controls — the composer
 * offers a PRODUCT and a geography, and this is what that product turns into.
 *
 * The split is the point. A requester picks "Multi-country focus search over France and Germany, with
 * the native-language investigation"; the model prices a clearance pipeline, no case law, one language
 * lane, two territories. Keeping the model in machinery terms is what lets the browser and the server
 * compute the SAME number from two different starting points — the browser from the product row it
 * fetched, the server from the policy it resolved — and portal-ui/test/effortModelParity.test.ts pins
 * the two together weight by weight.
 *
 *   pipeline        "knockout" | "clearance" — the registers half is the clearance's, and the
 *                   marketplace / common-law half is in EVERY product (a knockout IS the marketplace
 *                   product; stages-knockout.mjs instructs it in as many words).
 *   caseLaw         the case-law and opposition reading. One product carries it.
 *   nativeLanguage  whether a native-language lane will actually run. ONE lane, not eight labels: the
 *                   offering has one toggle and the engine routes it from the territories in scope.
 *   registerCounts  register filing counts per name. The knockout's, and only there.
 *   territories     the resolved scope. Length 1 is the deep-dive increment.
 */
const leversOf = (l) => ({
  pipeline: l?.pipeline === "knockout" ? "knockout" : "clearance",
  caseLaw: Boolean(l?.caseLaw),
  nativeLanguage: Boolean(l?.nativeLanguage),
  registerCounts: Boolean(l?.registerCounts),
  territories: Array.isArray(l?.territories) ? l.territories : [],
});

/** Which pipeline these levers describe. There is no third answer: "no-search" went with the levers that
 *  could express it — every product in the offering searches something. */
export function deriveMode(l) {
  return leversOf(l).pipeline;
}

/** Whether a native-language lane counts. Only a clearance has the axis — the knockout sweeps exact /
 *  no-spaces / hyphenated and nothing else (stages-knockout.mjs), so a lane there would be priced and
 *  never run. */
export const nativeActive = (l) => deriveMode(l) === "clearance" && leversOf(l).nativeLanguage;

/** Whether the register counts count. Only a knockout has the axis: a clearance runs the full register
 *  sweep — enumerated, screened, read — so a count beside it would be a number nobody needs, billed
 *  again. */
export const countsActive = (l) => deriveMode(l) === "knockout" && leversOf(l).registerCounts;

/** Whether the case-law reading counts. A knockout's pipeline carries no case-law stage at all. */
export const caseLawActive = (l) => deriveMode(l) === "clearance" && leversOf(l).caseLaw;

/** checksPerName = the owner's marketplaces + 1. The +1 is the general web (profiles.mjs derivedFloor). */
export const checksPerName = (platforms) => Math.max(1, (Number(platforms) || 0) + 1);

/**
 * profiles.mjs — SAFE_GRID_CELLS 98, DENSE_GRID_CELLS 16.
 *
 * KEYED ON `"dense"`, STRICTLY, because that is what `gridCellBudget` keys on and this function's only
 * job is to predict it. It keyed on `"high"` until — the word the staff editor put on
 * the screen for the `dense` option, and a value `profiles.mjs` refuses outright, so the branch was dead
 * for every profile that can exist and every dense customer was quoted as sparse.
 *
 * The normalising `.trim().toLowerCase()` went with it, and its absence is the point: the run side does
 * a strict `===`, so anything this accepted that the run did not was a new way to disagree. The two now
 * return the same number for every string in existence, which is what the reality arm asserts.
 */
export const gridBudget = (density) => (density === "dense" ? DENSE_GRID_CELLS : SAFE_GRID_CELLS);

/** derivedBatchSize — how many variants ride ONE grid call. Density is not cosmetic. */
export const batchSize = (platforms, density) =>
  Math.max(1, Math.floor(gridBudget(density) / checksPerName(platforms)));

/** Nominal variant count. Transliteration is standard, so the base already carries the script renderings. */
export const variantCount = (levers) => 20 + (nativeActive(levers) ? 6 : 0);

export const gridCalls = (i) => Math.ceil(variantCount(i.levers) / batchSize(i.platforms, i.density));

/** Searches: a knockout carries the whole batch in ONE; a clearance is one name per search. */
export const runCount = (i) =>
  deriveMode(i.levers) === "knockout" ? 1 : Math.max(1, Number(i.names) || 0);

/**
 * The weights. PLACEHOLDERS — the register share is the one that moved (2026-07-21): registers carry a
 * base of 14 and 2 per class, which is what puts a clearance's register half where a client would expect
 * it against the shop sweep beside it. Change these ⇒ bump UNITS_VERSION.
 *
 * `scriptNext` went with the eight-lane picker: the offering has ONE native-language toggle, so there is
 * no second lane to charge for and a weight that can never apply is a weight nobody can check.
 */
export const W = {
  gridPerCheck: 1.1,
  gridPerCall: 0.8,
  registerBase: 14,
  registerPerClass: 2,
  caseLaw: 6,
  script: 8,
  oneTerritory: 9,
  knockoutBase: 1,
  knockoutPerName: 0.4,
  countPerName: 0.5,
};

export function effortRaw(i) {
  const l = leversOf(i.levers);
  const names = Math.max(1, Number(i.names) || 0);
  if (l.pipeline === "knockout")
    return W.knockoutBase + names * (W.knockoutPerName + (countsActive(i.levers) ? W.countPerName : 0));
  // The marketplace / common-law half is in every clearance — there is no product without it.
  let e = checksPerName(i.platforms) * W.gridPerCheck + gridCalls(i) * W.gridPerCall;
  e += W.registerBase + Math.max(Number(i.classes) || 0, 1) * W.registerPerClass;
  if (caseLawActive(i.levers)) e += W.caseLaw;
  if (nativeActive(i.levers)) e += W.script;
  if (l.territories.length === 1) e += W.oneTerritory;
  return e * runCount(i);
}

// The 1–10 bar is normalised between the two searches THIS OWNER could order — the lightest and the
// deepest — because shop count and density are profile, fixed before the screen opens, while the product
// is the choice. Consequence worth carrying: the bar is NOT comparable across accounts, so it must never
// be reused as a billing quantity. `effortRaw` is the absolute figure; `effortUnits` is the bar.
//
// The floor is a Knockout search of one name; the ceiling is a Full country search with everything it
// carries. Both are real products a client can order, which is what the old constant divisor was not.
export const effortFloor = (i) =>
  effortRaw({
    ...i,
    names: 1,
    levers: { pipeline: "knockout", caseLaw: false, nativeLanguage: false, registerCounts: true, territories: [] },
  });

export const effortCeiling = (i) =>
  effortRaw({
    ...i,
    names: 1,
    levers: { pipeline: "clearance", caseLaw: true, nativeLanguage: true, registerCounts: false, territories: ["United States"] },
  });

export function effortUnits(i) {
  const raw = effortRaw(i);
  if (raw <= 0) return 1;
  const span = effortCeiling(i) - effortFloor(i);
  if (!(span > 0)) return 1;   // a bar that divided by zero would render NaN dots on the spend screen
  return Math.max(1, Math.min(10, Math.round(1 + 9 * ((raw - effortFloor(i)) / span))));
}

/** Five dots. Deliberately not a currency figure. */
export const costBand = (i) => Math.max(1, Math.min(5, Math.ceil(effortUnits(i) / 2)));

// ── turnaround ──────────────────────────────────────────────────────────────────────────────────────
//
// THERE IS NO ARITHMETIC IN THIS SECTION, AND THAT IS THE DESIGN. The quote is a table lookup and
// nothing else — owner ruling 2026-08-26, below. Anything that multiplies, adds to or scales the ruled
// range is the thing this section was rebuilt to remove; do not reintroduce one without a new ruling.

/**
 * THE QUOTED BOUNDS. ONE SOURCE — owner ruling, 2026-08-23, relayed by overwatch.
 *
 * WHAT THIS REPLACED, and why a constant beat a model. The old quote was a base plus one adder per lane:
 * 1.5h, +0.5 for case law, +0.5 for a native-language lane, +0.5 for a single territory. It missed the
 * actual wall by +66%, +82% and −22% on three consecutive delivered runs, in BOTH directions, on one
 * engine build in one night ('s table). Every wall I could find from either source, eight runs:
 *
 *     quoted 1.5h  ×6   →  actual 2.23  2.28  2.38  2.40  2.49  2.49
 *     quoted 3.0h  ×1   →  actual 2.33      (the run with the MOST lanes came in SHORTER than five others)
 *     quoted 1.5h  ×1   →  actual 2.73
 *
 * The quote ranged 1.5–3.0h; the actual ranged 2.23–2.73h. **The lever adders were adding variation the
 * wall does not have, and the base sat below every observed actual.** One model, spread pointing the wrong
 * way — too low where it is flat, too high where it varies. So the adders are gone.
 *
 * THE UPPER BOUND SITS BELOW THE HIGHEST MEASURED WALL, and that is the owner's call, made with the
 * measurements in front of him: 2.5h quoted against a 2.73h observed maximum (2h44). Recorded here so
 * nobody "corrects" it later believing it was set without the evidence. The band, not this, is what the
 * harness judges against — see reconcileTurnaround.
 *
 * KNOCKOUT was quoted 45 min against 4–6 min delivered. Ruled "~15 min" — and SUPERSEDED by a later
 * owner ruling to 5-10 minutes, a range. Recorded rather than rewritten,
 * because the 4–6 min measurement beside it is the reason 5-10 is the better quote: 15 never sat on it.
 */
export const TURNAROUND_QUOTE = Object.freeze({
  clearance: Object.freeze({ lowHours: 1.5, highHours: 2.5 }),
  // — OWNER RULING: a knockout quotes 5-10 MINUTES, a range, not a flat figure.
  //
  // The flat 0.25 came from 's "no compute, just say it, keep it simple", and that ruling is
  // untouched here: this is still one stated figure per pipeline with nothing computed from levers. What
  // changed is the figure, and the shape of it.
  //
  // THE EIGHT-RUN NOTE BELOW WAS CONSIDERED, NOT MISSED. That evidence is about VARIANCE — it refuted a
  // base-plus-adder model that manufactured variation the wall does not have — and it says nothing about
  // fifteen minutes being the right centre. The same file's own header records what the knockout actually
  // delivered when the ruling was made: 4-6 minutes, against 45 quoted. So 5-10 is closer to the measured
  // wall than 15 was, and a range that spans it says something a single figure cannot.
  knockout: Object.freeze({ lowHours: 5 / 60, highHours: 10 / 60 }),
});

/** Which row of the table a job's levers select. The ONLY place that choice is made. */
export const quoteBoundsFor = (l) => TURNAROUND_QUOTE[deriveMode(l) === "knockout" ? "knockout" : "clearance"];

/**
 * The bounds for THIS job. The ruled range, and NOTHING is done to it.
 *
 * — OWNER RULING, 2026-08-26, relayed by overwatch: "No compute. We just say 1.5–2.5 hours for
 * big reports, period. Keep it simple." The question put to him was which run-slot cap the quote should
 * divide by, and he removed the division instead of answering it.
 *
 * WHAT WENT, AND WHY IT WAS A DEFECT RATHER THAN A SIMPLIFICATION. The bounds used to be multiplied by
 * `waveCount` — `ceil(runCount / CONCURRENCY)`, where `CONCURRENCY` was a hard-coded 2 annotated
 * `CLEAROTRON_MAX_CONCURRENT_RUNS`. That constant was a FOURTH copy of a default whose live value is an
 * operator's to change with an `.env` edit and no deploy, so the two numbers were designed to move
 * independently and only one of them ever did. A deployment at cap 1 quoted two thirds of the truth; at
 * cap 3, double it. Both directions, from a constant nobody would think to look at while tuning a cap.
 *
 * THE PREVIOUS TEXT HERE ARGUED THE OPPOSITE, and it is worth saying why it was wrong rather than
 * deleting it quietly. It said the multiplier stayed "because removing it would under-quote a multi-run
 * job, and that is the direction that hurts". True as far as it went — but it defended a wave count
 * computed from a constant that was already disagreeing with the deployment, so the protection it named
 * was against a number the code could not actually read. Correctness first, direction second.
 *
 * WHAT IT COSTS, STATED PLAINLY. A job carrying more than one name is now quoted the same range as a
 * job carrying one. No product this engine offers can order such a job — every clearance is capped at
 * one name by `maxNames` in products.mjs and enforced by `checkMarkBudget`, and a knockout is a single
 * search however many names it screens — so `runCount` is 1 for everything that passes a door. The
 * multiplier could only ever fire on a PREVIEW of a job the door would refuse. That is the whole of the
 * behaviour change, and it is why the ruling costs no orderable client a correct number.
 *
 * If family searching ever lands (several names, several searches, several reports), this is where the
 * question comes back — and it comes back as a ruling, not as a restored constant.
 */
export const turnaroundBounds = (i) => ({ ...quoteBoundsFor(i.levers) });

/**
 * The single figure the run record carries, and it is the UPPER bound deliberately.
 *
 * `reconcileTurnaround` divides the actual wall by this to get a ratio, and a range cannot be divided by.
 * The upper bound is the number a client would be told not to expect to exceed, so a ratio above 1 means
 * the promise was missed — which is the reading someone glancing at the field will take anyway. The range
 * itself travels beside it as `turnaroundLowHours`/`turnaroundHighHours`, so nothing is lost.
 */
export const turnaroundHours = (i) => turnaroundBounds(i).highHours;

const fmtHours = (h) => (h % 1 ? h.toFixed(1) : String(h));

export function turnaround(i) {
  const { lowHours, highHours } = turnaroundBounds(i);
  // — the sub-hour branch prints a RANGE when there is one. It printed the high
  // bound alone, so setting a 5-10 range rendered "~10 min": the change looks landed, the picker still
  // shows one figure, and nobody notices until a screenshot. `~N min` is kept for the flat case rather
  // than deleted — a pipeline whose two bounds are equal has one figure, and saying "5-5" would be worse.
  if (highHours < 1) {
    const lo = Math.round(lowHours * 60), hi = Math.round(highHours * 60);
    return lo === hi ? `~${hi} min` : `${lo}–${hi} min`;
  }
  if (lowHours === highHours) return `~${fmtHours(highHours)} ${highHours === 1 ? "hour" : "hours"}`;
  return `${fmtHours(lowHours)}–${fmtHours(highHours)} hours`;
}

/**
 * Machinery reconstructed from what the ENGINE resolved, rather than from what the browser sent.
 *
 * The composer's choices do not all survive the wire as choices: a request carries a PRODUCT, a
 * geography and one toggle, and whether a native-language lane actually fires is decided server-side
 * from the jurisdictions (`decideJxLanes`). So the server quotes from the resolved policy; where the two
 * differ, the SERVER is right, and the composer shows this number at REVIEW, which is the step that
 * exists for exactly that.
 *
 * `components` is the search-policy block (registerProbe / jxLanes / commonLawGrid) — the engine's own
 * statement of what the run will do, not a second opinion about it.
 */
export function leversFromResolved({ pipeline, components, caseLaw = false, territories = [] } = {}) {
  const c = components ?? {};
  const knockout = pipeline === "knockout";
  return {
    pipeline: knockout ? "knockout" : "clearance",
    caseLaw: Boolean(caseLaw),
    nativeLanguage: Boolean(c.jxLanes),
    registerCounts: knockout && Boolean(c.registerProbe),
    territories: Array.isArray(territories) ? territories : [],
  };
}

/**
 * The whole estimate in one object — what a plan door returns and what gets stamped on the run.
 *
 * `raw` is the absolute, cross-account-comparable figure and is the ONLY one a future price may be fitted
 * against; `units` is the owner-relative 1–10 bar for display. Keeping both, with the version that
 * produced them, is what lets a later calibration join "what we quoted" to "what it consumed".
 */
export function quoteEffort(input) {
  const i = { levers: leversOf(input?.levers), names: input?.names ?? 1, classes: input?.classes ?? 0,
    platforms: input?.platforms ?? 0, density: input?.density ?? null };
  return {
    unitsVersion: UNITS_VERSION,
    pipeline: deriveMode(i.levers),
    raw: Number(effortRaw(i).toFixed(4)),
    units: effortUnits(i),
    costBand: costBand(i),
    searches: runCount(i),
    checksPerName: checksPerName(i.platforms),
    gridCalls: deriveMode(i.levers) === "knockout" ? 0 : gridCalls(i),
    turnaroundHours: turnaroundHours(i),
    turnaroundLowHours: turnaroundBounds(i).lowHours,
    turnaroundHighHours: turnaroundBounds(i).highHours,
    turnaround: turnaround(i),
  };
}
