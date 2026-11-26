// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// urgent-count.mjs — what an order counts against its account's allowance, decided once, at admission.
//
// An Urgent order counts as two searches (ruling 2026-11-25) WHERE IT RUNS FAST. On an installation whose AI
// service has no faster setting the order runs at Standard speed and counts one, which is what the connector's
// start_run does when it writes such an order as Standard. The answer is the one steps/open-run.mjs records when
// the run starts (engine/speed.mjs `urgentDecision`, from this machine's engine and billing), so the count a
// client is charged and the speed their run records cannot disagree. Decided at claim and never rewritten: a
// vendor that drops a fast run to standard partway does not refund a search.
import { searchesCounted } from "./effort-model.mjs";
import { urgentDecision } from "./engine/speed.mjs";
import { selectEngine } from "./engine/registry.mjs";
import { resolveAuthMode } from "./engine/auth.mjs";

/** Whether an Urgent order runs on the faster setting on this installation. False where the answer cannot be read. */
export function urgentRunsHere() {
  try {
    const engine = selectEngine().name;
    let auth = null;
    try { auth = resolveAuthMode({ engineName: engine }); } catch { auth = null; }
    return urgentDecision({ ordered: true, engine, auth }).fast === true;
  } catch { return false; }
}

/**
 * The searches this order counts against its allowance: 2 for an Urgent order that runs fast here, 1 for every
 * other. Every order a door admits is ONE search (a clearance takes one name, a Knockout screens its batch in one),
 * so this is the effort model's own `searchesCounted` for one search, the same function the quote's `searches`
 * comes from. `job.urgent` counts only as `true`, the run's own reading of the field (enqueue-schema.mjs).
 */
export function admittedSearches(job, { runsHere = urgentRunsHere } = {}) {
  const urgent = job?.urgent === true && runsHere() === true;
  return searchesCounted({ levers: { urgent }, names: 1 });
}

/**
 * THE SENTENCE AN ORDER MEETS WHERE IT COUNTS MORE THAN THE ONE SEARCH LEFT TODAY (design, 2026-11-26): the order
 * screen's own words for one search left (portal-ui/src/contract/allowance.ts `allowanceLine`), given by every door
 * that refuses such an order — the connector's preview, the portal's pre-check and the runner's wall.
 */
export const ONE_SEARCH_LEFT = "1 search left today.";

/**
 * ONE SEARCH LEFT, AND AN ORDER THAT COUNTS TWO: refused in the screen's words, never run, and never counted, as
 * Standard. Only that case: an account with none left keeps its own refusal, an order that fits is admitted, and an
 * Urgent order on an installation that cannot run it fast already counts one (`admittedSearches`), so it fits.
 *
 * @param {{ used: number, limit: number, searches: number }} at today's count, the daily limit, and the order's count
 * @returns {string|null} the sentence, or null where this rule does not refuse
 */
export function oneLeftRefusal({ used, limit, searches }) {
  return Number.isInteger(limit) && Number.isFinite(used) && limit - used === 1 && searches > 1 ? ONE_SEARCH_LEFT : null;
}
