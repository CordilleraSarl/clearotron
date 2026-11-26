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
