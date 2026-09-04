// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// stop-reason.mjs —. Why a run ENDED, when it ended because somebody stopped it.
//
// `status.json`'s `reason` was null on every cancelled run — five of five on the test box. The
// provenance existed, in the `.cancelled` sidecar, so nobody had lost it; but a reader holding
// status.json ALONE, which is what the portal and every metrics reader hold, could not tell a
// deliberate stop from a crash. Two very different facts, one indistinguishable record.
//
// ── THE RULING THIS REVISES, AND WHY IT WAS RIGHT ──────────────────────────────────────────────────
//
// pipeline.mjs said, at the site: "`reason` stays null — there is no fault." That is TRUE and it is not
// the question. `reason` sits beside `state`, and `state` already carries whether there was a fault;
// what `reason` owes is why the run ENDED. For a stop, "somebody asked" is the whole answer, and it is
// exactly the answer that distinguishes it from the crash it currently reads as.
//
// So the field's meaning is not widened to "fault or not". It is read as what it always said: the
// reason. A cancel has one.
//
// ── AND IT CHANGES NOTHING A CLIENT SEES ───────────────────────────────────────────────────────────
//
// Checked before writing this: `portal-ui/src/components/RiskDot.tsx`'s `cancelled` branch does not read
// `reason` at all — it renders "Stopped" and a fixed sub-line, deliberately, because "asking someone to
// read an explanation of their own decision is noise". That reasoning still holds and is untouched. This
// is the machine-readable half only.
//
// ONE BUILDER, FOUR SITES. Four different modules write the cancelled terminal, and a string assembled
// four times is four strings that drift. Anything reading these back keys on the prefix, not on prose.

/** The invariant lead every deliberate stop's reason starts with. Readers key on THIS, never on the tail. */
export const STOP_REASON_PREFIX = "stopped by request";

/**
 * Build the `reason` for a run that was stopped on purpose, from whatever the writing site knows.
 *
 * Every part is optional because the four sites genuinely know different things — the MCP path knows who
 * asked and through what door, the pipeline paths know which stage was interrupted, the runner's parked
 * path knows only that it was parked. A site passes what it has; it never invents a field to look
 * complete, which is the defect class this issue belongs to.
 *
 * @param {{stage?: string|null, via?: string|null, by?: string|null, requestedAt?: string|null}} [what]
 * @returns {string}
 */
export function stopReason(what = {}) {
  const s = (v) => { const t = String(v ?? "").trim(); return t || null; };
  const parts = [STOP_REASON_PREFIX];
  const stage = s(what.stage), via = s(what.via), by = s(what.by), asked = s(what.requestedAt);
  if (stage) parts.push(`at ${stage}`);
  if (via) parts.push(`via ${via}`);
  if (by) parts.push(`by ${by}`);
  if (asked) parts.push(`(asked ${asked})`);
  return parts.join(" ");
}

/**
 * Does this `reason` describe a deliberate stop? The reader's half of the contract, so nobody has to
 * re-derive the prefix by hand — a second copy of a matching rule is how the writer and the reader
 * come to disagree.
 */
export const isStopReason = (reason) => String(reason ?? "").startsWith(STOP_REASON_PREFIX);
