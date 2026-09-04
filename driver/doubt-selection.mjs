// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// doubt-selection.mjs — which OPEN doubts the closure seat is asked about, chosen by the DRIVER.
//
// 's architecture, one lane over from profile-selection.mjs: "prefer driver selection wherever the
// key precedes the dispatch." The key is on the doubt before doubt-closure is dispatched, so there is
// nothing here for a directive to ask a seat to judge — the driver lists the ids, and a doubt it does
// not list is never mentioned.
//
// ── WHY THE KEY IS THE PLACEMENT TIER AND NOT THE FINDING'S BAND ─────────────────────────────────────
//
// The obvious key is the disposition or band of the finding each doubt is about. IT CANNOT BIND, and
// the repo said so before anyone measured it: doubt-closure-grading-cannot-bind.test.mjs. stitchDoubts
// settles on a findings.json join FIRST, so a doubt that joins a finding is already settled and never
// reaches this stage; every doubt still open has no join and therefore no band to grade on. Measured
// afterwards on 28 delivered runs: 0 of 420 open doubts join a finding. The test predicted the zero.
//
// The PLACEMENT TIER is a different key with a different provenance. It comes from the carry artifact —
// where placement-inquiry put the candidate — not from a finding, so the stitch cannot have consumed it.
// Measured on the same population: 199 of 420 open doubts carry one.
//
// ── THE PRODUCERS ALREADY HELD IT AND SPENT IT ON PROSE ──────────────────────────────────────────────
//
// No lookup, no `placements.json` read, no join. Both mints had the tier in hand and interpolated it
// into `subject.text` instead of writing it down as a field:
//
//   placement-carry.mjs   `r.tier`             — always present, "(untiered)" when the entry declared none
//   record-carry.mjs      `r.placement?.tier`  — from `seat = { tier: placed.tier, … }`, null on two branches
//
// Those two record-carry branches — the in-line record screen and the synthesis seam — carry
// `placement: null` because the record never reached placement at all. They are KEYLESS BY CONSTRUCTION,
// which is a fact about the record and not a gap in this file.
//
// ── THE DIRECTION IT FAILS IN ────────────────────────────────────────────────────────────────────────
//
// `null` means EVERY doubt, and every unreadable state returns null: no cut on the row, an unknown cut
// word, an empty kept list. Being wrong toward asking costs one cheap call on a stage that gates nothing.
// Being wrong toward silence drops a question about a record the reader IS being shown, and its only
// symptom is a doubt nobody ever asked about — the failure this issue keeps paying for.
//
// A doubt with no tier is DISPATCHED AND COUNTED, never dropped. It cannot be shown to sit below the cut,
// and "cannot be shown" is not "does not". The count is the measurement that says whether this selection
// is worth having: if most doubts are keyless, the cut saves nothing and should not be given a value.

/** The cuts a depth row may name. `every-doubt` is today's behaviour and the only value any row carries. */
const TIER_CUTS = Object.freeze({
  "every-doubt": null,
  "headline-candidate": Object.freeze(["headline-candidate"]),
  "headline-candidate+sheet-2": Object.freeze(["headline-candidate", "sheet-2"]),
});

/** Case-folded, trimmed. The one place a tier string becomes comparable. */
const fold = (t) => String(t ?? "").trim().toLowerCase();

/**
 * The tiers a `doubtClosure` cut keeps, or null for "every doubt".
 *
 * An UNKNOWN word returns null rather than an empty list. An empty list would drop every keyed doubt in
 * the run, which is the silent direction; a typo in the product table must cost a cheap extra call, not
 * a stage that quietly stops asking.
 */
export function keptTiersFor(doubtClosure) {
  const cut = TIER_CUTS[fold(doubtClosure)];
  return Array.isArray(cut) && cut.length ? cut : null;
}

/**
 * WHICH OF THE THREE SILENCES THIS IS. `keptTiersFor` returns null for `every-doubt` AND for a word it
 * does not know, deliberately — a typo must not silently drop every keyed doubt. But that makes the two
 * indistinguishable in the run's event: a misspelt cut records exactly what the shipped cut records, and
 * the product row looks graded while the dispatch is not. 's arm catches a bad word on the ROW; this
 * is the runtime face of the same question, on the run that actually happened.
 *
 * `hasOwnProperty` rather than a truthiness test on the lookup, because `TIER_CUTS[w]` reaches the
 * prototype: `fold("constructor")` would otherwise resolve to a function and read as a known word.
 */
export function cutStateFor(doubtClosure) {
  const word = fold(doubtClosure);
  if (!word) return "absent";
  if (!Object.prototype.hasOwnProperty.call(TIER_CUTS, word)) return "unrecognised";
  return TIER_CUTS[word] ? "live" : "every-doubt";
}

/**
 * The open-doubt ids to ask about, or null for "every doubt".
 *
 * @param {Array} doubts             the OPEN doubts, as the dispatch would send them
 * @param {string|null} doubtClosure the product's depth-row cut; absent or `every-doubt` ⇒ null ⇒ all
 * @returns {{ids: string[]|null, total: number, keyless: number, dropped: number, keyed: number}}
 */
export function doubtsForClosure({ doubts = null, doubtClosure = null } = {}) {
  const list = Array.isArray(doubts) ? doubts : [];
  const kept = keptTiersFor(doubtClosure);
  // THE LOOP RUNS WHETHER OR NOT A CUT IS LIVE, and that is the whole point of the counts.
  //
  // This returned `{keyed: 0, keyless: 0}` before the loop whenever `kept` was null — which is every
  // shipped product, since `TIER_CUTS["every-doubt"] === null`. R2 on 44654e02 recorded
  // `{of: 31, selected: 31, keyed: 0, keyless: 0}` and the zeros were the instrument, not the tree.
  //
  // The event exists to answer whether a cut is WORTH giving a value, before any row has one: if most
  // doubts carry no tier the cut saves nothing. A count written only when the cut is live needs the cut
  // to exist in order to measure whether the cut should exist — the circularity pipeline.mjs's own
  // comment says this event prevents. Found by role-e2e eggie on the R2 artifacts.
  //
  // `keepSet` null means "keep everything": nothing is ever dropped, `ids` is discarded below, and the
  // dispatch stays byte-identical. Only the COUNTS change.
  const keepSet = kept ? new Set(kept.map(fold)) : null;

  const ids = [];
  let keyless = 0, dropped = 0, keyed = 0;
  for (const d of list) {
    const id = d?.id;
    if (!id) continue;
    const tier = fold(d?.subject?.placementTier);
    // "(untiered)" is placement-carry's own sentinel for an entry that declared no tier. It is a record
    // of absence, not a tier, so it takes the keyless path rather than being compared against the cut.
    if (!tier || tier === "(untiered)") { keyless++; ids.push(id); continue; }
    keyed++;
    if (!keepSet || keepSet.has(tier)) ids.push(id);
    else dropped++;
  }
  // Selecting every doubt is the same as no selection, and saying so keeps the dispatch byte-identical
  // on a run where the cut happens to keep everything. `!keepSet` short-circuits FIRST so that a doubt
  // with no id — skipped by the loop, and therefore absent from `ids` — cannot make a no-cut run look
  // like a selection.
  const cutState = cutStateFor(doubtClosure);
  if (!keepSet || ids.length === list.length) return { ids: null, total: list.length, keyless, dropped, keyed, cutState };
  return { ids, total: list.length, keyless, dropped, keyed, cutState };
}

/** The one-line coverage note the run records. Empty when no selection was made. */
export function doubtSelectionNote(sel) {
  if (!sel || sel.ids === null) return "";
  return `doubt-closure selection: ${sel.ids.length} of ${sel.total} doubt(s) dispatched `
    + `(${sel.keyed} carried a placement tier, ${sel.dropped} dropped below the cut, `
    + `${sel.keyless} dispatched for want of a tier)`;
}
