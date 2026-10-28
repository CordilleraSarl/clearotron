// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// saved-findings-block.mjs — what a later attempt of the writer is told about the findings this run already saved.
//
// The writer saves each finding as it completes it (synthesis-record.mjs, `saveFindings`), and an attempt that is
// stopped keeps them. A later attempt is handed them as a file, never in its message: a saved finding carries its
// evidence, and a few hundred of them would swamp the message. The message says how many there are, where they are,
// that they stand, and which positions are still to settle. A first attempt has none, and its message is unchanged.
// The model reads this block, so its words change only as model-facing wording does.
//
// A pure leaf, so the stage table can import it.

/** The file in the run folder a later attempt is handed its run's saved findings in. */
export const SAVED_FINDINGS_FILE = "synthesis-saved.json";

/**
 * The block a later attempt's message ends with, or "" when nothing is saved. `h` is what
 * synthesis-record.mjs's `handSavedFindings` returned: `{ findings, declined, outstanding }`, where `outstanding` is
 * null when the run cannot say which positions are still owed. PURE.
 */
export function savedFindingsBlock(h) {
  if (!h || !(h.findings > 0)) return "";
  const saved = h.findings === 1 ? "saved 1 finding" : `saved ${h.findings} findings`;
  const declined = h.declined > 0 ? ` and declined ${h.declined === 1 ? "1 record" : `${h.declined} records`} through record_declination` : "";
  const shown = Array.isArray(h.outstanding) ? h.outstanding.slice(0, 40) : [];
  const more = Array.isArray(h.outstanding) && h.outstanding.length > shown.length ? `, and ${h.outstanding.length - shown.length} more` : "";
  const owed = !Array.isArray(h.outstanding) ? ""
    : h.outstanding.length ? ` Still to settle: ${h.outstanding.length === 1 ? "1 position" : `${h.outstanding.length} positions`}: ${shown.join(", ")}${more}.`
      : " Every position you were handed is already settled by a saved finding or a declination.";
  return `SAVED IN THIS RUN: an earlier attempt of this stage ${saved} through record_synthesis${declined}. The saved findings are in ${SAVED_FINDINGS_FILE}, `
    + "each as it was accepted, with its evidence. They stand: save one again only for identified contrary evidence, a reasoning error "
    + `or an applicable change in the instructions.${owed} Save each remaining finding as you complete it. Then send the whole record, `
    + "`narrative` with `findings`: it takes every saved finding for a position its `findings[]` does not carry, so that list need hold "
    + "only the findings not saved yet, and the overall conclusions answer for the complete set.";
}
