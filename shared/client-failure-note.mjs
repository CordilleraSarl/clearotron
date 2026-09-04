// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// client-failure-note.mjs — the one sentence a client is given when their search did not finish.
//
// ── THE OWNER'S RULING, AND WHY THE OLD SENTENCE HAD TO GO ──────────────────────────────────────────
//
// Ruling 2026-09-04, in session, verbatim: *"It should just say something like clearotron failed,
// notify the admin kind of thing."* State the failure plainly, direct the reader to notify their
// administrator, and CLAIM NOTHING ABOUT WHO HAS BEEN TOLD.
//
// What shipped instead was "<BRAND> has been notified and will follow up. Nothing is needed from your
// side." Nobody had been notified. The box has no outbox, so on the install where this was measured the
// sentence was false twice over — false about the notification, and false about there being nothing for
// the reader to do, since telling their operator was the only thing that would move it.
//
// A client who is told someone is already handling it does not tell anyone. That is the cost: the
// sentence did not merely overclaim, it actively stopped the one action that would have helped.
//
// ── WHY THIS IS A MODULE AND NOT THREE EDITS ────────────────────────────────────────────────────────
//
// There were THREE client-facing copies of this claim, and two of them were the same sentence written
// out twice — one a const in the portal service, one an exported function in the MCP surface. A reword
// that fixes two of three is how a retired claim survives in the third, and the third is whichever
// surface the next reader is not looking at.
//
// So: one authority, in shared/, importing nothing. The brand name is a parameter rather than an import
// because the MCP copy already took it as one and the portal's reads a module the mcp-server workspace
// does not.
//
// ── WHAT IS DELIBERATELY NOT SAID ───────────────────────────────────────────────────────────────────
//
// The ruling permits "the failure is recorded" WHERE TRUE. It is not said here, because whether a given
// failure reaches a durable record differs by the stage it stopped at, and this one sentence is used by
// all three surfaces for every failure shape. A claim that is true of most cases and false of some is
// exactly the class being retired. If a surface can establish it for its own case, it can add it there.

/**
 * The sentence, in the client's own terms.
 *
 * @param {object} a
 * @param {boolean} a.refused  the run never started, as opposed to stopping part-way. A client who was
 *                             told their search "stopped before it finished" when it never began has
 *                             been told something false about their own order, and the surfaces that
 *                             know the difference already branch on it.
 * @returns {string} plain text; callers that render HTML escape it themselves.
 */
export function clientFailureNote({ refused = false } = {}) {
  return `${refused
    ? "This search was not started, and nothing was delivered."
    : "This search stopped before it finished, and nothing was delivered."} ${CLIENT_ACTION}`;
}

/**
 * The ACTION half on its own, for a surface that composes its own description of what failed.
 *
 * Split out after the first cut of this change replaced a whole paragraph and dropped the MARK with it.
 * The client email named the search — "for IRONWHISK +2 more" — and a client with several searches
 * running is not told which one failed by the word "this". An existing arm caught it, and it was right:
 * the ruling retires a claim about who was notified, it does not ask any surface to say less about the
 * order the client actually placed.
 *
 * So a surface that already knows the mark keeps its own sentence and appends this one; a surface that
 * does not use the whole note above. Either way the action is worded once.
 */
export const CLIENT_ACTION = "Please tell whoever administers this installation.";

/** The words no client-facing surface may say again — asserted by an arm, so the retirement holds. */
export const RETIRED_CLAIMS = Object.freeze([
  "has been notified",
  "will follow up",
  "Nothing is needed from your side",
]);
