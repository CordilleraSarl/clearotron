// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// register-floor.mjs — a register's floor, read one way and printed one way, on every path that meets it.
//
// A register asked something very broad can answer "at least 10,000" instead of a count: it counted, and
// gave a floor. That is an answer, never a failure and never a zero (ruled 2026-10-02). The knockout count
// has printed it as "more than 10,000" since it first met one; the clearance path reads and prints it here
// with the same words, so the two can never say it two ways.

/** A floor as every page prints it: the register's own figure, and no sentence around it. */
export const moreThan = (floor) => `more than ${floor.toLocaleString("en-US")}`;

/**
 * The register's floor on a parsed answer that gave one instead of a count, or null. A floor counts only
 * with the register's flag AND the number: a flag with no number says no more than "unknown" does. PURE.
 */
export function floorOf(parsed) {
  return parsed?.total_approximate === true && Number.isFinite(parsed?.total_floor) ? parsed.total_floor : null;
}
