// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// THE CUT RECORD, READ BY CODE THAT MUST STILL WORK WHERE THE RECORD IS NOT.
//
// ── THE RULING ───────────────────────────────────────────────────────────────────────────────────
//
// Owner, 2026-08-31, on workstream E: "do not ship the withheld-paths file. its
// private." `shared/withheld-paths.mjs` STAYS BEHIND. The reading where it ships with a rewritten
// header is dead and must not be revived.
//
// Five files read that record and are wanted on the public tree: `scripts/citation-line-check.mjs`,
// `scripts/mint-suite-census.mjs`, and the arms `no-caveat-repair`,
// `signa-mock-lane-is-unreachable-from-a-run` and `the-providers-suite-is-censused`. A static import of
// a module that is not there throws before anything runs — for a test that means its cases VANISH FROM
// THE COUNT rather than failing, which is the 354-to-279 shape already records. This
// module is how they degrade on purpose instead.
//
// ── WHY DEGRADING IS SAFE HERE, WHICH IS THE WHOLE ARGUMENT ──────────────────────────────────────
//
// Every one of the five asks the record ONE question: is this file absent because it was deliberately
// withheld, or absent because something broke? On the public tree nothing was withheld FROM that tree,
// so the honest answer is "nothing is withheld" — and each caller then becomes STRICTER, never weaker:
//
//   citation-line-check   every file crosses the cut, so every citation must resolve
//   mint-suite-census     no exemption, so a removed test file is a LOSS
//   the three arms        an absence is damage, never a stated consequence
//
// A fallback that can only tighten is one that cannot hide a defect. That is the property that makes
// this safe to do without a flag, and it is the property to re-check before adding a sixth caller: if a
// new caller would be LOOSER without the record, it does not belong here.
//
// ── AND IT ANNOUNCES, SO IT CANNOT FIRE UNNOTICED WHERE IT MUST NOT ──────────────────────────────
//
// On our tree the record exists and behaviour is unchanged. If it ever went missing here, the fallback
// would quietly relax five checks — the exact silent-pass this repository keeps paying for. So the mode
// is announced once to stderr, the way `announceBlocklistMode` does for the identifier roster, and an
// arm pins that the announcement happens.

let record = null;
try {
  record = await import("./withheld-paths.mjs");
} catch {
  // Absent is the PUBLIC tree's normal state and our tree's alarm. Which one it is, is the caller's to
  // decide from `CUT_RECORD_PRESENT`; this module only refuses to guess.
  record = null;
}

/** Does this tree carry the cut record at all? False on the published tree, by design. */
export const CUT_RECORD_PRESENT = record !== null;

/** The withheld entries, or an empty list where the record does not travel. */
export const WITHHELD = record ? record.WITHHELD : [];

/** The entry withholding `relPath`, or null. Null for everything where the record does not travel. */
export const withheldEntryFor = (relPath) => (record ? record.withheldEntryFor(relPath) : null);

/** Is `relPath` deliberately withheld? False for everything where the record does not travel. */
export const isWithheld = (relPath) => (record ? record.isWithheld(relPath) : false);

let announced = false;
/**
 * Say which mode this process is in, once, to stderr. A green run in fallback mode on a tree that
 * SHOULD carry the record is five checks quietly relaxed, and the only thing standing between that and
 * silence is this line.
 */
export function announceWithheldMode() {
  const line = CUT_RECORD_PRESENT
    ? `[repo-guard] cut record present — ${WITHHELD.length} withheld entry/entries; absences they cover are stated consequences`
    : "[repo-guard] NO cut record in this tree — nothing counts as withheld, so every absence is damage "
      + "and every citation must resolve. This is correct on the published tree and an ALARM anywhere else.";
  if (!announced) { announced = true; console.error(line); }
  return line;
}
