// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// SYNTHETIC SENTINELS FOR THE IDENTIFIER SWEEP. Every name here was invented for this file.
//
// shared/identifier-scan.mjs is the matcher and it names no identity of its own. The table it reads
// lives outside this repository and always will: a public tree cannot carry a list of the real names it
// is meant to keep out, because the list IS the disclosure. So the sweep ships here with nothing to
// look for, and a sweep with an empty table returns zero over any tree at all — the reassuring answer,
// on a corpus nobody checked.
//
// These sentinels are what make that zero mean something. They are invented words, they appear nowhere
// in the tree, and the arms beside this file assert BOTH halves: the sweep finds none of them here, and
// the same sweep over a planted line finds one. A zero from an instrument never shown non-zero licenses
// nothing.
//
// THEY ARE NOT A SAMPLE OF THE REAL TABLE and must never be replaced by one. Anyone arming this sweep
// for real supplies the private roster at the call; these rows stay, because they are the part that can
// be published and the part that proves the machinery runs.
//
// Each row is `[name, twin]` — the twin is what a writer should use instead, and the sweep prints it.

/** @type {[string, string][]} */
export const SENTINELS = [
  ["Vantis Orriden", "Northwind Partners"],
  ["Thalvic Reach", "Harbourline Group"],
  ["Marrowgate Holdings", "Fairgate Holdings"],
  ["Brindlow", "Ashfield"],
];

// Entries whose trailing word-boundary guard is dropped, so `Brindlow` also fires inside `Brindlows`
// and `Brindlow-Reach`. One row carries it so the option itself is exercised rather than merely
// declared — an unexercised option is a setting nobody has watched work.
export const SUFFIXABLE = new Set(["Brindlow"]);
