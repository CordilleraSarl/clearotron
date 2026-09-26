// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// cross-check-wait.mjs — the web-to-register cross-checks wait for the register reading step.
//
// Every register widening waits for the reading step, which asks it or records why not. The cross-checks
// are late by construction: the web search and the register units run side by side, and the lane mints
// its questions from the web's findings after both, when the reading step has already decided its plan.
// So they are minted waiting, the reading step is asked once more in its own session, and whatever it
// leaves undecided runs as code, as the lane did before the wait. Holding them instead would search
// nothing and hold up delivery. PURE.
import { AWAITS_READING_TURN, awaitsReadingTurn } from "../providers/_shared/plan-guards.mjs";

export const CROSS_CHECK_QID = /^xcheck-/;

/** A cross-check entry as the lane mints it: waiting for the reading step. */
export const waitingCrossCheck = (entry) => ({ ...entry, when: { ...AWAITS_READING_TURN } });

/** The cross-checks still waiting that the reading step has neither released nor withheld. */
export function undecidedCrossChecks(plan, { released = new Set(), withheld = {} } = {}) {
  return (Array.isArray(plan?.entries) ? plan.entries : [])
    .filter((e) => CROSS_CHECK_QID.test(String(e?.qid ?? "")) && awaitsReadingTurn(e?.when))
    .filter((e) => !released.has(e.qid) && !withheld?.[e.qid])
    .map((e) => e.qid);
}

/**
 * The plan with those entries' wait lifted: the join then dictates them and the direct executor runs
 * them. The version moves, as for any plan that grew, so a receipt of the waiting plan is not reused.
 */
export function withoutWait(plan, qids) {
  const lift = new Set(qids);
  if (!lift.size) return plan;
  return {
    ...plan,
    plan_version: (Number(plan?.plan_version) || 0) + 1,
    entries: plan.entries.map((e) => {
      if (!lift.has(e.qid)) return e;
      const { when, ...rest } = e;
      return rest;
    }),
  };
}
