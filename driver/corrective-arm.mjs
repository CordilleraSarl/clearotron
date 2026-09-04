// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// corrective-arm.mjs — an arm can reach the corrective seam, and says which pass it reproduced.
//
//. `--dispatch-trigger` exists so an arm reproduces a SPECIFIC production pass, and
// `corrective` was not in its vocabulary — so the one pass the losses actually happen in was the one no
// arm could dispatch. On the run that motivated this, pass 1 lost nothing and pass 2 discarded 25 of 31
// findings, five of them marks a reviewing lawyer had rated.
//
// ── WHY THIS IS NOT SIMPLY "ALLOW THE WORD" ─────────────────────────────────────────────────────────
//
// The production corrective pass is a WARM followup: it resumes the synthesis session and sends only
// `correctionsExtra`'s blocks. An experiment arm always builds a fresh key and dispatches into a sandbox,
// so it cannot resume anything — and resuming the REAL session from a sandbox was rejected outright,
// because "canonical run untouched" is the arm's whole contract and an arm that breaks its contract to
// gain fidelity is measuring with a broken instrument.
//
// So an arm carries the corrective pass's INPUTS on a COLD turn, composed by the same function production
// uses. That reaches the seam nothing else reaches without a two-hour run. It is NOT the warm pass, and
// the receipt says so in a word rather than leaving it to be inferred:
//
//   dispatched-warm            production only — the resumed followup
//   dispatched-cold            the arm — the same blocks, a fresh turn
//   refused-no-corrective-state  neither — this run has no corrective pass to reproduce
//
// Two states where the truth has three is the shape most of this week's defects have had.

/**
 * Can this run's corrective pass be reproduced at all?
 *
 * Acceptance's refusal condition: a run that carries no pre-corrective snapshot and no reviewer verdict
 * has no corrective pass to reproduce, and composing a fresh one under a corrective label would be the
 * quietly-different-prompt the trigger vocabulary's own refusal exists to prevent.
 */
export function correctiveReadiness({ preCorrective = false, reviewerVerdict = false } = {}) {
  const missing = [];
  if (!preCorrective) missing.push("the pre-corrective findings snapshot (_driver/findings-pre-corrective.json)");
  if (!reviewerVerdict) missing.push("the reviewer's verdict (the senior-eye review this pass answers)");
  return { ready: missing.length === 0, missing };
}

/** The refusal, by name — never a fresh pass wearing a corrective label. */
export function correctiveRefusalLine(stage, missing) {
  return `--experiment ${stage} --dispatch-trigger corrective: THIS RUN HAS NO CORRECTIVE PASS TO `
    + "REPRODUCE.\n"
    + missing.map((m) => `           absent: ${m}`).join("\n") + "\n"
    + "           Composing a fresh pass under a corrective label would be a quietly different prompt, "
    + "which is what\n           the trigger vocabulary refuses a typo for. Pick a run whose synthesis "
    + "went through a corrective cycle.";
}

/**
 * Which pass an arm reproduced, for the receipt —.
 *
 * `dispatched-warm` is production's word and an arm never earns it. A reader must be able to tell the
 * three apart WITHOUT inferring from wall time, which is what acceptance asks for.
 */
export function correctivePassState({ trigger = null, ready = null } = {}) {
  if (trigger !== "corrective") return null;          // not a corrective arm; the field says nothing
  return ready ? "dispatched-cold" : "refused-no-corrective-state";
}
