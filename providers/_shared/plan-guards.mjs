// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// plan-guards.mjs — what a register plan entry's `when` guard means, read from one place.
//
// THE TWO WAITS A PLAN ENTRY CAN CARRY, and they are different questions.
//
//   `runs_if_enumerated: <parent qid>` is a fact about a RESULT: this slice runs if its parent question
//   came back as a list rather than a crowd. A crowd parent is terminal for it.
//
//   `awaits_reading_turn: true` is a fact about JUDGMENT NOT YET MADE (ruling 204): this family runs
//   when the reading turn asks for it, having read the identical mark's own list and found it thin. No
//   result releases it — not the identical question coming back as a comfortable list, not a clean
//   zero, nothing. The ask arrives as a supplemental entry, so the guarded entry itself never runs: it
//   stands in the plan as the record of a question deliberately not asked.
//
// WHY THIS IS ITS OWN MODULE, on the provider side, rather than a constant in the compiler. Both the
// COMPILER (driver/register-plan.mjs, which writes the guard and joins it back to the band) and the
// EXECUTOR (providers/_shared/execute-plan.mjs, which decides what to dispatch) must agree on what a
// guard means, and a guard the executor does not recognise is not a guard at all — the entry runs as
// though it were ungated, which is silently the opposite of what was asked for. The executor cannot
// import the compiler: nothing under providers/ imports driver/, and inverting that for one predicate
// would invert it for the whole provider tree. So the meaning lives here, where both sides can read
// it, and neither side carries a second copy to drift.

/** The guard a decision-10 family carries under ruling 204. Frozen: entries spread a copy. */
export const AWAITS_READING_TURN = Object.freeze({ awaits_reading_turn: true });

/** Is this guard the ruling-204 wait — the one no result can release? */
export const awaitsReadingTurn = (when) => when?.awaits_reading_turn === true;

/**
 * The parent qid a guard waits on, or null where it waits on no question at all.
 *
 * Every caller that resolves a guard against a band, validates it against the plan's qids, or reports
 * which question held an entry back goes through this. A ruling-204 wait names no qid, and a caller
 * reading `when.runs_if_enumerated` directly would get `undefined` and then decide something about it
 * — orphan it, look it up and miss, or print it.
 */
export const guardParentQid = (when) => (awaitsReadingTurn(when) ? null : when?.runs_if_enumerated ?? null);
