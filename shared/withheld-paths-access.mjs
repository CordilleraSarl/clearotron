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
// THREE files read that record, and all three are in this repository:
// `scripts/citation-line-check.mjs`, `scripts/mint-suite-census.mjs` and
// `shared/reference-guard-classes.mjs`. A static import of a module that is not there throws before
// anything runs, and for a test that means its cases VANISH FROM THE COUNT rather than failing. This
// module is how those three degrade on purpose instead.
//
// The list above was wrong in both directions and is corrected here (measured 2026-09-09): it said
// five, naming three tests that exist in this repository under no path, and it omitted
// `shared/reference-guard-classes.mjs`, which had already recorded itself as a reader in its own file.
//
// ── WHY DEGRADING IS SAFE HERE, WHICH IS THE WHOLE ARGUMENT ──────────────────────────────────────
//
// Every one of the three asks the record ONE question: is this file absent because it was deliberately
// withheld, or absent because something broke? On the public tree nothing was withheld FROM that tree,
// so the honest answer is "nothing is withheld" — and each caller then becomes STRICTER, never weaker:
//
//   citation-line-check   every file crosses the cut, so every citation must resolve
//   mint-suite-census     no exemption, so a removed test file is a LOSS
//   reference-guard-classes  nothing is skipped, so the whole tree is counted
//
// MEASURED, not argued (2026-09-09): `censusOf` was run twice over one file list. With no record it
// counted four files and skipped none; with a record naming two of them it counted two and skipped
// two. Absent, the record cannot hide a defect.
//
// A fallback that can only tighten is one that cannot hide a defect. That is the property that makes
// this safe to do without a flag, and it is the property to re-check before adding a sixth caller: if a
// new caller would be LOOSER without the record, it does not belong here.
//
// ── NO TREE CARRIES THE RECORD TODAY, AND THE MODE LINE SAYS WHICH WAY THAT LEANS ───────────────
//
// This block used to say the record exists here and that losing it "would quietly relax five checks".
// Both halves were false, and the second contradicted the paragraph above it. Measured 2026-09-09:
// `CUT_RECORD_PRESENT` is false here and false in the larger tree the suite is also run against — the
// record exists in neither, so every reader has always run in fallback, and fallback is the strict side.
//
// The mode is still announced once to stderr, the way `announceBlocklistMode` does for the identifier
// roster. What the line may NOT do is call itself an alarm: this module can see whether the record is
// present, and cannot see whether it ought to be. So it states the mode and what that means for the
// three readers, and leaves the judgement to a reader who knows which tree they are looking at.
//
// WHAT HOLDS THE ANNOUNCEMENT: `driver/test/the-cut-record-mode-is-announced-once.test.mjs`, in both
// modes, each in a process of its own. Until 2026-09-10 nothing did, although this block said something
// did: deleting the line, or swapping the two modes' wording, passed every gate.

let record = null;
try {
  record = await import("./withheld-paths.mjs");
} catch {
  // Absent is the state of every tree today, as the header says. Whether that is right is the caller's
  // to judge from `CUT_RECORD_PRESENT`; this module only refuses to guess.
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
 * Say which mode this process is in, once, to stderr. Fallback is the strict side, so this line is a
 * statement of fact rather than a warning: it reports what the three readers will do, and whether that
 * is right depends on the tree, which this module cannot see.
 */
export function announceWithheldMode() {
  const line = CUT_RECORD_PRESENT
    ? `[repo-guard] cut record present — ${WITHHELD.length} withheld entry/entries; absences they cover are stated consequences`
    : "[repo-guard] no cut record in this tree — nothing counts as withheld, so every absence is damage "
      + "and every citation must resolve. This is the STRICTER of the two modes: it cannot hide a defect, "
      + "and it is the expected mode wherever nothing was withheld from the tree in hand.";
  if (!announced) { announced = true; console.error(line); }
  return line;
}
