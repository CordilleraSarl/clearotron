// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// coverage-union.mjs — the coverage form's accumulator, the register sibling of
// disposition-union.mjs.
//
// THE DEFECT THIS CLOSES. register-digest re-dispatches from EIGHT triggers (fresh, settlement-flush,
// late-flush, the flush's cold retry, late-bind, stale-repair, the coverage-ledger save followup and the
// recall-reconcile followup) and three of those are COLD — a fresh session that re-derives a 160 KB
// document from a 1.9 MB band instead of editing what the last attempt wrote. The one measured
// three-attempt profile in the repo is this stage's (repair-contract.mjs:10-18): 105,747 output tokens
// FAIL, 137,519 FAIL, 36,362 PASS, and the attempt that passed is the one that PATCHED. Every cold
// attempt re-earned judgments that had already been made correctly.
//
// The cure is not a deeper ladder: it is that the driver, which never forgets, holds the answers. Each
// attempt's statuses are unioned into the form the driver keeps, so a row settled on attempt 1 CANNOT be
// lost on attempt 3 — and the outstanding count is monotonically non-increasing BY CONSTRUCTION rather
// than by the model behaving well.
//
// PURE — no node imports, so it tests offline. It reads coverage-form.mjs and that module never reads
// this one: the import runs ONE WAY, so there is no cycle and no second opinion about what a settled row
// is. This file mints no row, no id, no unit label and no definition of "settled": `coverageFormRows`
// and `rowIsSettled` both come from coverage-form.mjs — the same code the GATE judges with. A union that
// preserved a status the gate would refuse, or dropped one it would accept, would make the outstanding
// count mean two different things in two places, which is 's defect exactly.

import { coverageFormRows, rowIsSettled, seatFields, formRowKey, seatRows, SEAT_ROW_CONTRACT } from "./coverage-form.mjs";

const PROVENANCE = "driver-written form (#476; typed transport). Axes, coverage units, open crowd blocks "
  + "with their query ids and hit counts, and deferred slices with their receipt reasons are computed by "
  + "the driver from the frozen register plan, the plan-execution receipt and the per-axis bands — the "
  + "same calculation the validator judges with — and are REGENERATED on every pass. Statuses and "
  + "reasons arrive ONLY through the `record_coverage` tool; no seat opens or edits this file. A row "
  + "marked `open` carries an obligation the machine computed and the seat cannot call confirmed-clean; "
  + "its own `open_because` says which — a slice that was never searched is `deferred`, an unaccounted "
  + "crowd block that ran and saturated is `coverage-limited`. EACH OPEN ROW IS DISCHARGED ONLY BY "
  + "ITSELF: a status on one row never accounts for another row's slice. Statuses accumulate across "
  + "attempts: a row settled once stays settled. Seat-added rows arrive through the same tool — see "
  + "`seat_row_contract` for their closed axis vocabulary.";

/**
 * Index a submitted/prior row list by driver row id AND by obligation key — see the gate's own lookup.
 * Takes a form object, a bare row array, null or junk: an absent prior and a damaged one are the NORMAL
 * inputs here (attempt 1 has no accumulator; a seat can hand back anything), so neither may throw and
 * neither may be the reason a union does not run. PURE.
 */
function indexRows(rows) {
  const list = Array.isArray(rows) ? rows : (Array.isArray(rows?.rows) ? rows.rows : []);
  const byId = new Map(), byKey = new Map();
  for (const r of list) {
    if (!r || typeof r !== "object") continue;
    if (r?.row_id) byId.set(String(r.row_id).trim().toUpperCase(), r);
    byKey.set(formRowKey(r), r);
  }
  return (canonical) => byId.get(String(canonical.row_id).toUpperCase()) ?? byKey.get(formRowKey(canonical));
}

/**
 * Union the seat's submitted rows into the statuses the driver already holds.
 *
 * THE RULE, and why it is that way round:
 *   · a SUBMITTED row the gate would accept wins — the seat is allowed to CORRECT itself, and a form
 *     whose later judgment was ignored would make a corrective attempt unable to fix anything;
 *   · otherwise a PRIOR row the gate would accept is kept — a settled row never un-settles, so an
 *     attempt that rewrote the file from scratch, or wrote nothing at all, cannot destroy work already
 *     done;
 *   · otherwise the row stays unsettled, and any partial fields the seat did write are carried forward
 *     so the next pass sees its own half-finished work rather than a blank row.
 * The outstanding count therefore cannot rise. That is a property of this function rather than a hope
 * about the next turn.
 *
 * THE ROWS ARE ALWAYS THE DRIVER'S, REGENERATED. Neither the prior form nor the submitted one can add,
 * drop or alter an obligation, a qid, a hit count or an `open` flag: the plan, the skeleton and the bands
 * decide the row set, every pass. A seat that deletes half the file changes nothing about what it owes.
 *
 * @returns {{form:object, total:number, settled:number, parked:number, outstanding:number, carried:number}}
 *   carried — settled rows this attempt's own submission would NOT have carried on its own, i.e. exactly
 *             the work a cold re-dispatch used to destroy.
 *   parked  — /: rows given up on after the per-row refusal bound. On their OWN axis, never
 *             folded into `settled`, and subtracted from `outstanding` so the stage can finish.
 * PURE; never throws.
 */
export function unionCoverageForm(prior, submitted, input, { parkedIds = null } = {}) {
  const { rows, derived_from } = coverageFormRows(input);
  // THE SEAT-ROW CONTRACT RIDES ON EVERY PASS, not just the pre-dispatch build. This form is what
  // writeCoverageForm puts in BOTH copies from the second pass onwards, so a contract carried only by
  // buildCoverageForm would be missing from precisely the file a corrective attempt opens — the surface
  // that has to carry the closed axis vocabulary is the one the repair reads.
  const form = { _provenance: PROVENANCE, seat_row_contract: SEAT_ROW_CONTRACT, generated_from: derived_from, rows };
  const findPrior = indexRows(prior);
  const findSubmitted = indexRows(submitted);
  // ── / — A PARKED ROW IS ITS OWN OUTCOME, NEITHER SETTLED NOR STILL OWED ─────────────────
  //
  // The prior form's park is AUTHORITY and `parkedIds` only adds to it: a row parked on call 30 must
  // stay parked on call 31, and re-deriving the park from a ledger the union cannot see would drop it.
  // Same shape as disposition's, and for the same reason.
  //
  // PARKED IS NOT SETTLED. The corpse of was a narrative reporting "73 processed; 73 recorded"
  // over a machine-checked 72; a park counted as settled rebuilds that lie in one line. It is not
  // outstanding either — that is what lets the stage finish instead of asking forever for a row the
  // seat has been refused thirty times on. Three states, three counts.
  const newlyParked = new Set((parkedIds ?? []).map((x) => String(x ?? "").trim()).filter(Boolean));
  let settled = 0, carried = 0, parked = 0;
  for (const row of form.rows) {
    const p = findPrior(row), s = findSubmitted(row);
    const sOk = s && rowIsSettled(s, row), pOk = p && rowIsSettled(p, row);
    let fields;
    if (sOk) fields = seatFields(s);
    else if (pOk) fields = seatFields(p);
    else {
      const sf = seatFields(s ?? {}), pf = seatFields(p ?? {});
      fields = { status: sf.status || pf.status, reason: sf.reason || pf.reason };
    }
    row.status = fields.status || null;
    row.reason = fields.reason || null;
    // JUDGED ON THE MERGED ROW, not on either input. The field-wise carry can COMPLETE a row neither
    // attempt finished alone — a status written on one pass and its reason on the next — and counting
    // only whole settled inputs would report that row outstanding while the gate, which reads this same
    // merged row, accepts it. Two counts of one thing is how the convergence ledger stops meaning
    // anything.
    if (rowIsSettled(row, row)) { settled += 1; if (!sOk) carried += 1; continue; }
    // Not settled — is it parked? A row that IS settled can never be parked: the work landed, so there
    // is nothing to give up on. Checked in that order for exactly that reason.
    const id = String(row.row_id ?? "").trim();
    if (newlyParked.has(id) || p?.parked === true) {
      row.parked = true;
      const priorCount = Number(p?.parked_refusals) || 0;
      if (priorCount) row.parked_refusals = priorCount;
      if (p?.parked_reason) row.parked_reason = p.parked_reason;
      parked += 1;
    }
  }
  // ── SEAT ROWS RIDE THROUGH, AND THEY OBEY THE OPPOSITE RULE TO THE DRIVER'S ──────────────────────
  //
  // A DRIVER row is an OBLIGATION: the plan decides it, every pass, and a submission that omits it has
  // changed nothing about what is owed. That is why a submitted blank never destroys a prior status.
  //
  // A SEAT row is the digest's OWN coverage unit — a per-jurisdiction reconciliation, a
  // cross-class merch check. The plan does not decide it, so the same argument does not hold, and holding
  // it anyway would make a slice row wrong on attempt 1 PERMANENT — permanent in the table a lawyer
  // reads, with a corrective pass told "that row is wrong" unable to comply. Rewriting the prose section
  // used to drop it; that has to stay possible.
  //
  // So: a submission that SPOKE (the seat's file parsed to a row array, even an empty one) owns the seat
  // rows outright — omission is retraction. A submission that said NOTHING (no file, unreadable, or the
  // driver's own pre-dispatch write) inherits the prior pass's, so a cold turn that wrote nothing at all
  // still loses none of them. A seat row colliding with a driver row's key is dropped either way.
  const driverKeys = new Set(form.rows.map(formRowKey));
  const submittedRows = Array.isArray(submitted) ? submitted : submitted?.rows;
  const carriedSeat = Array.isArray(submittedRows)
    ? seatRows(submittedRows, driverKeys)
    : seatRows(Array.isArray(prior) ? prior : prior?.rows, driverKeys);
  for (const r of carriedSeat) {
    r.status = r.status || null;
    r.reason = r.reason || null;
    form.rows.push(r);
    if (rowIsSettled(r, r)) settled += 1;
  }
  return { form, total: form.rows.length, settled, parked,
    // THREE STATES, AND `outstanding` IS WHAT IS STILL ASKED FOR. A parked row is neither settled nor
    // asked for again; subtracting it here is what ends the loop, and keeping it out of `settled` is
    // what keeps the count true.
    outstanding: form.rows.length - settled - parked, carried };
}

/** How many rows of an already-unioned form the gate would still refuse. PURE. */
export function outstandingCoverageRows(form) {
  const rows = Array.isArray(form) ? form : (form?.rows ?? []);
  // — a parked row is not refused-and-still-owed; it is given up on, on the record. It leaves this
  // list so the stage can complete, and `rowIsSettled` is untouched so nothing reads it as judged.
  return rows.filter((r) => !rowIsSettled(r, r) && r?.parked !== true);
}

/** The rows given up on after the refusal bound, with their evidence. PURE. /. */
export function parkedCoverageRows(form) {
  const rows = Array.isArray(form) ? form : (form?.rows ?? []);
  return rows.filter((r) => r?.parked === true);
}
