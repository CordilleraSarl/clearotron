// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// placement-union.mjs — the placement form's accumulator, sibling of coverage-union.mjs
// and disposition-union.mjs.
//
// THIS IS THE PART THAT CURES THE DEFECT. `placement-inquiry` is re-dispatched from the main path, the
// stale-repair path and the frame-reopen path, and its hard-wall retry is a cold 1.5x re-derivation. On
// R1 2026-08-09 the first attempt wrote a complete artifact, lay quiescent for 371 seconds, was killed at
// its wall and was DISCARDED — 31 minutes of finished tiers re-derived from nothing. A ladder cannot fix
// that. What fixes it is that the driver, which never forgets, holds the answers: a tier placed on
// attempt 1 cannot be lost on attempt 2, so the outstanding count falls monotonically by construction
// rather than by the next turn behaving well.
//
// PURE — no node imports. It reads placement-form.mjs and that module never reads this one, so the import
// runs ONE WAY and there is no second opinion about what a settled row is. This file mints no row, no id
// and no definition of "settled": `buildSelectionIndex` and `rowIsSettled` both come from the module the
// GATE judges with.
//
// WHAT THE CANONICAL SET IS, under selection-by-reference. It is not the band and it is not the floor: it
// is every selection the run has SEEN — the prior accumulator's plus this submission's — each resolved
// against the fold. That makes the set grow monotonically and never shrink, which is the cure stated as
// an invariant: a candidate selected on attempt 1 is still a row on attempt 2 even if attempt 2 was
// killed before it mentioned anything.

import { buildSelectionIndex, selectionOf, rowIsSettled, seatFields, formRowKey, seatRows,
  SEAT_ROW_CONTRACT, SELECT_ROW_CONTRACT, PLACEMENT_FORM_PROVENANCE } from "./placement-form.mjs";
import { normalizeRecordUri } from "./registry-fidelity.mjs";

/**
 * Index a submitted/prior list three ways — by row id, by row key, and BY RECORD URI. An absent prior and
 * a damaged one are the NORMAL inputs here (attempt 1 has no accumulator; a seat can hand back anything),
 * so neither may throw and neither may be the reason a union does not run.
 *
 * THE URI LEG IS THE ONE COVERAGE DOES NOT HAVE. A seat that adds a row naming a record the driver
 * already holds is talking about the driver's candidate, not a new one — matching only on id and key
 * would treat it as a separate row, and the render would emit the same candidate twice. Matching on URI
 * overlap folds it where it belongs.
 * PURE.
 */
function indexRows(rows, { bySelection = true, uriLeg = true } = {}) {
  const list = Array.isArray(rows) ? rows : (Array.isArray(rows?.rows) ? rows.rows : []);
  const byId = new Map(), byKey = new Map(), byUri = new Map();
  for (const r of list) {
    if (!r || typeof r !== "object") continue;
    if (r?.row_id) byId.set(String(r.row_id).trim().toUpperCase(), r);
    byKey.set(formRowKey(r), r);
    // THE SELECTION IS AN INDEX KEY, not only the records. A submitted `{select, tier, reason}` row
    // carries no `records[]` at all — the driver is the one that fills them — so a lookup that only knew
    // record sets would never match the seat's own answer to the row it answers, and every tier would
    // read as outstanding while sitting right there in the file.
    for (const u of (uriLeg ? [...(Array.isArray(r.records) ? r.records : []), bySelection ? selectionOf(r) : null] : [])) {
      const n = u ? (normalizeRecordUri(u) || String(u)) : "";
      if (n && !byUri.has(n)) byUri.set(n, r);
    }
  }
  return (canonical) => {
    const hit = byId.get(String(canonical.row_id).toUpperCase()) ?? byKey.get(formRowKey(canonical));
    if (hit) return hit;
    for (const u of (uriLeg ? [...(Array.isArray(canonical.records) ? canonical.records : []), bySelection ? selectionOf(canonical) : null] : [])) {
      const n = u ? (normalizeRecordUri(u) || String(u)) : "";
      const r = n ? byUri.get(n) : null;
      if (r) return r;
    }
    return null;
  };
}

/**
 * Union the seat's tiers into what the driver already holds.
 *
 * THE RULE, and why it is that way round — identical to 's, for identical reasons:
 *   · a SUBMITTED row the gate would accept wins, so the seat can CORRECT itself;
 *   · otherwise a PRIOR row the gate would accept is kept, so a killed or cold attempt cannot destroy
 *     work already done;
 *   · otherwise the row stays unsettled and any partial fields are carried forward, so the next pass
 *     sees its own half-finished work rather than a blank row.
 *
 * THE ROWS ARE ALWAYS THE DRIVER'S, REGENERATED from the band's projections. Neither the prior form nor
 * the submitted one can add, drop or alter a candidate, its records or its owner. A seat that deletes
 * half the file changes nothing about what it owes.
 *
 * @returns {{form, total, settled, outstanding, carried, seat_rows}}
 *   carried — settled rows this attempt's own submission would NOT have carried on its own: exactly the
 *             work a killed or cold re-dispatch used to destroy.
 * PURE; never throws.
 */
export function unionPlacementForm(prior, submitted, input) {
  const index = buildSelectionIndex(input);
  const priorRows = Array.isArray(prior) ? prior : (Array.isArray(prior?.rows) ? prior.rows : []);
  const submittedRows = Array.isArray(submitted) ? submitted : (Array.isArray(submitted?.rows) ? submitted.rows : null);

  // EVERY SELECTION THE RUN HAS SEEN, prior first so the accumulator's order is stable across attempts.
  // A register row is one the seat selected; a row with no selection is a seat-authored candidate and is
  // handled below on the opposite rule.
  const selections = [];
  const seenSel = new Set();
  const unresolved = [];
  // Rows this pass consumed AS SELECTIONS, by identity. Without it a submitted `{select, tier, reason}`
  // row — which carries no `kind` — would fall through to seatRows() below and be re-added as a
  // seat-authored candidate with a null mark and no records: the same judgment counted twice, once as a
  // register candidate and once as a nameless one.
  const consumed = new WeakSet();
  // RETRACTION IS EXPLICIT, and it is the only way a row leaves this form.
  //
  // 's seat rows were retracted by SILENCE — a submission that spoke owned them — and that was right
  // there, because that seat rewrote its whole form every pass. This one does not: it writes DELTAS, so a
  // corrective attempt that re-tiers two register rows says nothing about the run's common-law
  // candidates, and silence-retraction would delete every one of them without a word. The 2026-08-09
  // round carried 5-11 of those per run.
  //
  // So both kinds obey one rule — silence never destroys — and removal costs a row that says so. That
  // also keeps the wrong-row-on-attempt-1 case answerable, which is what silence-retraction was for.
  const retracted = new Set();
  for (const r of (submittedRows ?? [])) {
    const id = typeof r?.retract === "string" ? r.retract.trim() : "";
    if (id) { retracted.add(id.toUpperCase()); retracted.add(id); consumed.add(r); }
  }
  const isRetracted = (row) => retracted.has(String(row?.row_id ?? "").toUpperCase())
    || (selectionOf(row) ? retracted.has(selectionOf(row)) : false);
  const pushSelection = (row) => {
    if (!row || typeof row !== "object") return;
    const sel = selectionOf(row);
    if (!sel) return;                       // no id and no records ⇒ a seat-authored candidate; see below
    const canonical = index.resolve(sel);
    // A row the seat wrote as its OWN (kind:"seat") but which names a record the fold holds is talking
    // about the driver's candidate, not a new one. It folds — dropping it would delete a judgment, and
    // keeping it separate would put the same right in the file twice. A seat row whose record the fold
    // does NOT hold stays the seat's, and falls through to seatRows() below untouched.
    if (row.kind === "seat" && !canonical) return;
    consumed.add(row);
    if (!canonical) {
      // NEVER SILENTLY DROPPED. A `select` the fold does not hold is the seat naming something that is not
      // there — a typo, a record the band lost on a re-enumeration, or a candidate that belongs on a seat
      // row. It is reported back by id so the next pass can fix it, and counted so nobody reads the
      // shortfall as agreement.
      if (!seenSel.has(`?${sel}`)) { seenSel.add(`?${sel}`); unresolved.push({ select: sel, tier: seatFields(row).tier }); }
      return;
    }
    const key = formRowKey(canonical);
    if (seenSel.has(key)) return;
    seenSel.add(key);
    const next = { ...canonical, select: sel };
    if (isRetracted(next) || isRetracted(row)) return;
    selections.push(next);
  };
  for (const r of priorRows) pushSelection(r);
  for (const r of (submittedRows ?? [])) pushSelection(r);

  const form = { _provenance: PLACEMENT_FORM_PROVENANCE, select_row_contract: SELECT_ROW_CONTRACT,
    seat_row_contract: SEAT_ROW_CONTRACT,
    generated_from: { ...index.derived_from, selected: selections.length, unresolved: unresolved.length },
    ...(unresolved.length ? { unresolved } : {}), rows: selections };

  // THE TWO SIDES ARE MATCHED DIFFERENTLY, and the asymmetry is the point.
  //
  // A SUBMITTED row is `{select, tier, reason}` — it carries no records at all, because the driver is the
  // one that fills them — so it can only be matched by the id it selected.
  //
  // A PRIOR row is driver-filled and its RECORD SET IS ITS IDENTITY, so it is matched on that and never
  // on the selection. That is what keeps the old design's best property: after a re-enumeration splits a
  // family, the selection id is unchanged but the candidate is not, so the row arrives unsettled with no
  // carry — automatically, with no invalidation logic and no trigger-sniffing. Matching the prior row by
  // selection would hand a reason written about a three-territory family to a single-record candidate,
  // on a client deliverable, without a word.
  // …and not by URI OVERLAP either, for the same reason one level down: the split family's single
  // remaining record is still one of the three the old row held, so an overlap match would hand the
  // family's tier to the leg. Overlap is the SUBMITTED side's leg — it is how a seat row naming a record
  // the driver holds folds onto the driver's candidate instead of duplicating it.
  const findPrior = indexRows(priorRows, { bySelection: false, uriLeg: false });
  const findSubmitted = indexRows(submittedRows ?? []);
  let settled = 0, carried = 0;
  for (const row of form.rows) {
    const pr = findPrior(row), s = findSubmitted(row);
    const sOk = s && rowIsSettled(s, row), pOk = pr && rowIsSettled(pr, row);
    let fields;
    if (sOk) fields = seatFields(s);
    else if (pOk) fields = seatFields(pr);
    else {
      const sf = seatFields(s ?? {}), pf = seatFields(pr ?? {});
      fields = { tier: sf.tier || pf.tier, reason: sf.reason || pf.reason, borderline: sf.borderline ?? pf.borderline };
    }
    row.tier = fields.tier || null;
    row.reason = fields.reason || null;
    row.borderline = fields.borderline === true ? true : null;
    // JUDGED ON THE MERGED ROW, not on either input — a tier written on one pass and its reason on the
    // next completes a row neither attempt finished alone, and counting whole settled inputs would report
    // it outstanding while the gate, reading this same merged row, accepts it.
    if (rowIsSettled(row, row)) { settled += 1; if (!sOk) carried += 1; }
  }
  // SEAT ROWS accumulate exactly as selections do — prior ∪ submitted, minus explicit retractions. A
  // TORN write is still safe: it fails to parse, so it "said nothing", contributes no rows and retracts
  // none, and no corrupt judgment can enter.
  const driverKeys = new Set(form.rows.map(formRowKey));
  const source = [...priorRows, ...(submittedRows ?? [])].filter((r) => !consumed.has(r));
  const carriedSeat = seatRows(source, driverKeys).filter((r) => !isRetracted(r));
  for (const r of carriedSeat) {
    form.rows.push(r);
    if (rowIsSettled(r, r)) settled += 1;
  }
  return { form, total: form.rows.length, settled, outstanding: form.rows.length - settled,
    carried, seat_rows: carriedSeat.length, unresolved: unresolved.length };
}

/** How many rows of an already-unioned form the render would still omit. PURE. */
export function outstandingPlacementRows(form) {
  const rows = Array.isArray(form) ? form : (form?.rows ?? []);
  return rows.filter((r) => !rowIsSettled(r, r));
}
