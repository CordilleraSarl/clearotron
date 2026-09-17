// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sarl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// WHICH ANSWER THE DEPLOYMENT CHECK GIVES, as a number a caller can act on.
//
// Extracted from scripts/live-surface-check.mjs for the reason roster-verdict.mjs and
// unit-state-verdict.mjs were: that file is a program, and importing it to reach one decision runs its
// preflight and exits. A decision nobody can drive without a deployment to point at is a decision nobody
// drives.
//
// ── THE DEFECT THIS SETTLES ──────────────────────────────────────────────────────────────────────────
//
// The check reported "I could not look" and "this has drifted" through the same FAIL. Two arms said in
// their own message "This is a failure to look, never a pass" and then returned the verdict a genuine
// drift returns, so a reader could not tell them apart without reading to the end of the message.
//
// They want different things done. A drift is fixed by redeploying. A could-not-look is fixed by pointing
// the check at something it can read, and until somebody does, nothing is known about that surface in
// either direction — redeploying would change nothing, because nothing was compared.
//
// The cost of leaving it is the familiar one: a FAIL that turns out to be "could not look" teaches
// whoever runs the check to read FAIL as noise, and the run where it means drift is the one nobody acts
// on. A deployment check is exactly where that is expensive.

/**
 * The exit code for a finished run.
 *
 *   0  every surface was read and none disagreed
 *   1  a surface DRIFTED — redeploy; the report names which
 *   3  nothing drifted, and a surface COULD NOT BE READ
 *
 * 2 belongs to the preflight refusals, which fire before any surface is examined: the instance did not
 * say where its pool or its doors are, so the run has nothing to report rather than something to report
 * badly.
 *
 * A DRIFT OUTRANKS A COULD-NOT-LOOK when both are present. The drift is actionable now and the unreadable
 * surface is a second errand; both are on the report, and only the code is ordered.
 *
 * ORDINARY SKIPS MUST NOT REACH HERE, which is why the caller passes a separate count rather than every
 * skip. Several surfaces are deliberately not probed — a client door behind an access proxy, a door this
 * instance does not name — and those are the resting state of a healthy box. A code that moved on them
 * would fire on every good run and be ignored inside a week, which is this same defect one level up.
 *
 * @param {{failed?: number, couldNotLook?: number}} counts
 */
export function exitFor({ failed = 0, couldNotLook = 0 } = {}) {
  if (failed) return 1;
  if (couldNotLook) return 3;
  return 0;
}

/** What each code means, for a caller printing it or a reader wondering. Keyed by the code itself. */
export const EXIT_MEANING = Object.freeze({
  0: "every surface was read and none disagreed",
  1: "a surface drifted — redeploy; the report names which",
  2: "the instance did not say where its pool or its doors are, so nothing was examined",
  3: "nothing drifted, and a surface could not be read — nothing is known about it either way",
});
