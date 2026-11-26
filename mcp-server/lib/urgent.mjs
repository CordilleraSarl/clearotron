// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// lib/urgent.mjs — whether THIS installation can run an Urgent order, asked the way the run itself asks it.
//
// The run decides at its start (driver/steps/open-run.mjs) from the engine this machine selects and the way that
// engine is billed, through engine/speed.mjs `urgentAvailability`. The connector asks the same function with the same
// two inputs, so the answer an assistant is given before it orders and the decision the run makes cannot differ.
//
// THE SENTENCE IS THE BOARD'S, byte for byte (the urgent-clearance board inventory, board 2): an order this
// installation cannot run starts at Standard, counts as one search, and its reply says so in these words.
import { selectEngine } from "../../driver/engine/registry.mjs";
import { resolveAuthMode } from "../../driver/engine/auth.mjs";
import { urgentAvailability } from "../../driver/engine/speed.mjs";

export const URGENT_UNAVAILABLE = "Not available with this installation's AI service. Searches run at Standard.";

/** `{ available, reason }` for this installation. An engine or billing that cannot be read answers not available. */
export function urgentHere() {
  let engine = null;
  try { engine = selectEngine().name; } catch { return { available: false, reason: "unknown-engine" }; }
  let auth = null;
  try { auth = resolveAuthMode({ engineName: engine }); } catch { /* unreadable billing ⇒ the function says so */ }
  return urgentAvailability({ engine, auth });
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
