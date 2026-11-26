// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// lib/urgent.mjs — whether THIS installation can run an Urgent order, asked the way the run itself asks it.
//
// One answer, and it is the wall's: driver/urgent-count.mjs `urgentRunsHere`, the decision the run records at its
// start (steps/open-run.mjs) and admission counts by, from the engine this machine selects and the way that engine is
// billed. So what an assistant is told before it orders, what it is charged and how the run runs cannot differ.
//
// THE SENTENCE IS THE BOARD'S, byte for byte (the urgent-clearance board inventory, board 2): an order this
// installation cannot run starts at Standard, counts as one search, and its reply says so in these words.
import { urgentRunsHere } from "../../driver/urgent-count.mjs";

export const URGENT_UNAVAILABLE = "Not available with this installation's AI service. Searches run at Standard.";

/** `{ available }` for this installation: the wall's own answer. An engine or billing it cannot read answers no. */
export function urgentHere() {
  return { available: urgentRunsHere() };
}

/**
 * The order as this installation will run it. An Urgent order it cannot run is written as Standard, so it runs and
 * counts as one search, and the reply carries the board's sentence. Anything other than `true` is left as sent for the
 * shared validator to refuse or pass.
 */
export function orderUrgency(job) {
  if (job?.urgent !== true) return { job, warnings: [] };
  if (urgentHere().available) return { job, warnings: [] };
  return { job: { ...job, urgent: false }, warnings: [URGENT_UNAVAILABLE] };
}
