// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// knockout-caveats.mjs — the sentences a knockout's engine appends itself, and how to tell them from the rater's.
import { CAPABILITY_SKIPPED_NOTE } from "./search-policy.mjs";

export const SURVIVOR_BOUNDARY_RE = /not knocked out at this screen's depth/i;

/**
 * Is this caveat the ENGINE'S OWN WORDS rather than the rater's?
 *
 * The engine appends two, both stated in code because the assessing model cannot see the facts behind
 * them: the survivor boundary, and the capability-skipped note. Neither is something "the rater
 * supplied", and telling them apart is the whole of — the standing-caveat lint asked
 * "did the rater supply caveats?" of an array the engine had already written into, so from the moment
 * the survivor sentence was appended the answer was always yes and the check could never fire again.
 */
export function isEngineAppendedCaveat(text) {
  const t = String(text ?? "");
  if (SURVIVOR_BOUNDARY_RE.test(t)) return true;
  return Object.values(CAPABILITY_SKIPPED_NOTE).some((note) => t.trim() === String(note).trim());
}
