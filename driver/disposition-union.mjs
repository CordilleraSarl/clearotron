// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// disposition-union.mjs — the meaning-sweep form's accumulator.
//
// THE DEFECT THIS CLOSES. The gate's outstanding count did not shrink across attempts; it CHURNED. On the
// terminal production run of 2026-08-06 the residual went 73 → 7 → 7 → 6 → 5 → 4 → 3 → 2 → 1 and the run
// died owing one row, because six of its ten dispatches started COLD and threw the previous draft away —
// a receipt cleared on one attempt reappeared on a later one. Every attempt re-earned work that had
// already been done correctly, and the ladder ran out before the last row.
//
// The cure is not a better prompt and not a deeper ladder: it is that the driver, which never forgets,
// holds the answers. Each attempt's rulings are unioned into the form the driver keeps, so a row ruled on
// attempt 1 CANNOT be lost on attempt 3 — and the outstanding count is therefore monotonically
// non-increasing BY CONSTRUCTION rather than by the model behaving well.
//
// PURE — no node imports, so it tests offline, exactly like connotation-search.mjs (whose header states
// the same rule and for the same reason). It reads that module and that module never reads this one: the
// import runs ONE WAY, so there is no cycle and no second opinion about what a ruling is.
//
// ONE CALCULATION, NOT TWO KEPT IN STEP. This file mints no obligation set, no row id, no normaliser, no
// definition of "ruled" and — since the review of this build — no row LOOKUP either. `obligationRows`,
// `formRowFinder` and `isRuled` all come from connotation-search.mjs, the same code the GATE
// judges with. A union that preserved a ruling the gate would refuse, or dropped one it would accept,
// would make the outstanding count mean two different things in two places, which is 's defect
// exactly: one calculation running twice, silently disagreeing, both copies looking correct. The lookup
// had been written out twice — here and in the gate — and both copies carried the same punctuation defect.

import { obligationRows, formRowFinder, isRuled, resolveCandidate, anchorBinding } from "./connotation-search.mjs";

const PROVENANCE = "driver-written accumulator (#460/B). Rows, ids and candidates are computed by "
  + "connotationObligations() from the half grid ledger — the same calculation the validator judges with — "
  + "and are REGENERATED on every pass. No seat edits this file, or any file: the seat sends values "
  + "through the `record_dispositions` tool — `ruling` and `note` per row, `receipt_index` with the "
  + "POSITION of the candidate it ruled on (the driver resolves that to `receipt_id`), and — where the "
  + "answer marks proof of reading owed — `segment_index`, the NUMBER of the passage it relied on, plus a "
  + "`fragment` copied out of that same passage (the driver extracts the passage around it) — and the "
  + "driver folds accepted rows in here. Rulings accumulate across calls and attempts: a row ruled once "
  + "stays ruled.";

/**
 * The DRIVER'S OWN COPY of the form, in `_driver/` — under B the ONLY copy: the seat-facing mirror
 * died with the form path, and rulings arrive by typed call. Two things need this file:
 *
 *   1. THE ACCUMULATOR. It survives an attempt, a recovery park and a process restart — which is where
 *      the convergence used to be lost.
 *   2. THE ERA STAMP. It exists only where a driver carrying this code ran, and the seat is never told
 *      about `_driver/`, so it can be neither forged nor deleted into a pass. That is what lets the gate
 *      arm on it: no archived run has one (they all predate the form), so replaying the corpus flips no
 *      verdict on a document that never had a form to fill — including the one archived run that carries
 *      a -era `{dispositions:[…]}` sibling, which is the RETIRED artifact and not this one.
 *
 * Derived from the dictated `connotation.dispositions_path` and from nothing else, so the driver's two
 * readers (gateway.mjs writing it, verify.mjs judging it) cannot disagree about the name — deriving a
 * filename twice is the drift cost weeks. PURE: string work only, no path module.
 */
export function formSidecarName(dispositionsPath) {
  const base = String(dispositionsPath ?? "").split(/[\\/]/).pop();
  if (!base) return "";
  return `${base.replace(/\.json$/i, "")}.form.json`;
}

/**
 * WHERE THE ACCUMULATOR LIVES, derived ONCE. The driver's own copy sits in `_driver/` beside the
 * seat-facing file, and until this it was assembled by hand in three places — the gateway before every
 * judgement, the pipeline at the merge, and the grid tool. Three hand-assemblies of one path is the drift
 * cost weeks, and the third one was added by the very fix that needed to read what the other two
 * write. PURE string work, no path module, for the reason in the header: this file tests offline.
 *
 * POSIX only, like every other absolute path in this codebase. A bare filename (no separator) yields a
 * RELATIVE `_driver/…`, never a rooted one — inventing a leading slash would silently aim a write at `/`.
 */
export function formSidecarPath(dispositionsPath) {
  const name = formSidecarName(dispositionsPath);
  if (!name) return "";
  const s = String(dispositionsPath);
  const cut = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
  return cut < 0 ? `_driver/${name}` : `${s.slice(0, cut)}/_driver/${name}`;
}

/**
 * The seat's four fields, trimmed. Anything else on a submitted row is the driver's and is ignored.
 *
 * M1 — THIS IS WHERE THE ORDINAL DIES, and it has to be somewhere this narrow. A seat now answers
 * with `receipt_index`, a position into the driver's own candidate list, and what belongs in the
 * accumulator is the ID that position resolves to. Passing `canonical` turns the number into the id
 * here; the returned object still has exactly the four fields, so no ordinal can reach a carried row.
 *
 * That matters more than it looks. formRowFinder's third rule is that an unbound row on an ambiguous key
 * resolves to NOTHING, precisely because the field-wise carry would otherwise write a foreign receipt
 * into the accumulator, where the next attempt reads it as pre-filled, is told to change nothing else,
 * and the row becomes a permanent fixed point. An ordinal carried forward would be the same defect in a
 * new coat: `2` means a different receipt on every regeneration whose candidate order moved.
 *
 * Called with no `canonical` it falls back to the seat's literal `receipt_id` — the pre-M1 behaviour,
 * kept so a caller without a canonical row is never silently resolving against nothing.
 */
function seatFields(row, canonical = null) {
  return {
    receipt_id: canonical
      ? resolveCandidate(row ?? {}, canonical).id
      : String(row?.receipt_id ?? "").trim(),
    ruling: String(row?.ruling ?? "").trim(),
    note: String(row?.note ?? "").trim(),
    // M2 — WHERE CODE COPIES THE PASSAGE OUT. A seat that pointed with an `anchor` instead of
    // transcribing 24 characters gets the run extracted from the driver's own captured snippet and
    // written here, so what lands in the artifact is verbatim text the TOOL fetched — a stronger
    // guarantee than the old one, which was only ever as good as the model's typing.
    //
    // The seat's own quote wins where it has one: archived forms carry quotes and no anchors, and a
    // replay must not have its discharged rows rewritten underneath it.
    //
    // The anchor itself does NOT persist, for the reason the ordinal does not — it points into a
    // candidate list that is regenerated every pass, and a pointer in the accumulator is a fixed point
    // waiting to happen. The extracted text is the durable thing.
    quote: String(row?.quote ?? "").trim()
      || (canonical ? (anchorBinding(row?.anchor, canonical.candidates).quote ?? "") : ""),
  };
}

/**
 * The empty form for an obligation set — every row present, every seat field null.
 * Written the instant the obligations exist (the grid tool) and regenerated whenever it is needed again.
 * PURE.
 */
export function buildDispositionForm(ob, { half = null, generatedFrom = null } = {}) {
  return {
    _provenance: PROVENANCE,
    ...(half ? { half } : {}),
    floor: ob?.floor ?? null,
    ...(generatedFrom ? { generated_from: generatedFrom } : {}),
    rows: obligationRows(ob),
  };
}

/**
 * Union the seat's submitted rows into the rulings the driver already holds.
 *
 * THE RULE, and why it is that way round:
 *   · a SUBMITTED row the gate would accept wins — the seat is allowed to CORRECT itself, and a form
 *     whose later ruling was ignored would make a corrective attempt unable to fix anything;
 *   · otherwise a PRIOR row the gate would accept is kept — a ruling never un-rules, so an attempt that
 *     rewrote the file from scratch, or wrote nothing at all, cannot destroy work already done;
 *   · otherwise the row stays unruled, and any partial fields the seat did write are carried forward so
 *     the next pass sees its own half-finished work rather than a blank row.
 * The outstanding count therefore cannot rise. That is the whole of what asked for, and it is a
 * property of this function rather than a hope about the next turn.
 *
 * THE ROWS ARE ALWAYS THE DRIVER'S, REGENERATED. Neither the prior form nor the submitted one can add,
 * drop or alter an obligation: `ob` decides the row set, every pass. A seat that deletes half the file
 * changes nothing about what it owes, which is the point of the funnel-weakening reject.
 *
 * @returns {{form:object, total:number, ruled:number, parked:number, outstanding:number, carried:number}}
 *   carried — ruled rows this attempt's own submission would NOT have carried on its own, i.e. exactly the
 *             work a cold re-dispatch used to destroy.
 * PURE; never throws.
 */
export function unionDispositionForm(prior, submitted, ob, { half = null, generatedFrom = null, parkedIds = null } = {}) {
  const form = buildDispositionForm(ob, { half, generatedFrom });
  const findPrior = formRowFinder(prior, form.rows);
  const findSubmitted = formRowFinder(submitted, form.rows);
  // — a park is STICKY, for the same reason a ruling is. This module exists because the outstanding
  // count churned instead of shrinking (see the header): a park that could lift would let the count rise
  // again, which is 's defect in new clothes. So the prior form's park is authority, and `parkedIds`
  // only ever ADDS.
  const newlyParked = new Set((parkedIds ?? []).map((x) => String(x ?? "").trim()).filter(Boolean));
  let ruled = 0, carried = 0, parked = 0;
  for (const row of form.rows) {
    const p = findPrior(row), s = findSubmitted(row);
    const sOk = s && isRuled(s, row), pOk = p && isRuled(p, row);
    let fields;
    if (sOk) fields = seatFields(s, row);
    else if (pOk) fields = seatFields(p, row);
    else {
      const sf = seatFields(s ?? {}, row), pf = seatFields(p ?? {}, row);
      fields = Object.fromEntries(Object.entries(sf).map(([k, v]) => [k, v || pf[k]]));
    }
    // A row with exactly ONE candidate has a receipt that is the driver's — there is exactly one it can
    // name, and letting a seat field overwrite it would turn a pre-filled row into one it could get
    // wrong. M1: this was `kind === "recurrence"`, and the kind was never the reason — the COUNT
    // was. Recurrence rows carry one candidate by construction, so this still covers every one of them,
    // and it now also covers the query rows that have nothing to choose either.
    if ((row.candidates?.length ?? 0) === 1) fields.receipt_id = row.receipt_id;
    for (const [k, v] of Object.entries(fields)) row[k] = v || null;
    // JUDGED ON THE MERGED ROW, not on either input. The field-wise carry can COMPLETE a row neither
    // attempt finished alone — a ruling written on one pass and its note on the next — and counting only
    // whole ruled inputs would report that row outstanding while the gate, which reads this same merged
    // row, accepts it. Two counts of one thing is how the convergence ledger stops meaning anything.
    const ok = isRuled(row, row);
    if (ok) { ruled += 1; if (!sOk) carried += 1; }
    // PARKED IS NOT RULED. A parked row keeps `ruling: null` and is counted on its own axis, so the form
    // reports "72 ruled, 1 parked" and never 73 ruled. Counting it as ruled would hand the narrative the
    // same false completeness the guard caught on the terminal run — "73 processed; 73 recorded" against a
    // machine-checked 72. A row that IS ruled can never be parked: the work landed, so there is nothing to
    // park, and re-parking it would subtract a real ruling from the outstanding arithmetic twice.
    // ── — TWO WAYS INTO THE PARK, AND WHICH ONE HAPPENED IS EVIDENCE ─────────────────────────
    //
    //   `declared`  — the seat looked and said it cannot rule this receipt. Speaks about the RECEIPT.
    //   `exhausted` — the seat was refused past the per-row bound. Speaks about the PROCESS.
    //
    // They are NOT merged into one "parked", and the reason is measurement, not tidiness. The declared
    // exit exists to make the exhausted one unnecessary, so the ratio between them is the only evidence
    // that it worked: if seats take the honest exit, `exhausted` should wither toward zero. Conflated,
    // that signal does not exist to be read. Nothing consumes `parked_kind` yet — it is recorded now so
    // the measurement is possible later, and that is the whole of its current job.
    const declaredObstacle = String(s?.obstacle ?? "").trim();
    const declared = s?.parked_kind === "declared" && !!declaredObstacle;
    const wasParked = (p?.parked === true) || newlyParked.has(String(row.row_id ?? "").trim());
    if (!ok && (wasParked || declared)) {
      row.parked = true;
      // STICKY, AND THE PRIOR KIND WINS. A row first parked by exhaustion is not re-labelled `declared`
      // because a later call finally said so — the run really did spend those refusals, and rewriting
      // that would erase the cost the ratio above exists to count.
      row.parked_kind = String(p?.parked_kind ?? "").trim()
        || (declared ? "declared" : "exhausted");
      // THE DECLARED KIND MUST NOT INHERIT THE EXHAUSTED SENTENCE. The default below describes a row
      // refused past the bound; handing it to a row that was never refused at all would put a false
      // account of the run in front of the reviewing lawyer, and would do it in the exact field that is
      // supposed to tell them why the obligation is undecided.
      // ONE WRITER OWNS EACH KIND'S SENTENCE, and this module owns only the DECLARED one.
      //
      // It used to invent a generic sentence for the exhausted kind too — and that generic sentence made
      // `disposition-tool.mjs`'s informative writer unreachable on EVERY real park, because that writer is
      // guarded on emptiness and this had already filled it. So live parks read "refused the per-row bound
      // without binding" while the tool stood ready to say "refused 30 times without binding (bound 30)".
      // The count and the bound are the two facts a reader of an undecided row actually needs, and they
      // were the two the sentence could never carry.
      //
      // Left EMPTY here for the exhausted kind rather than fixing it by dropping the tool's guard: that
      // guard is what stops a re-union overwriting a genuine reason carried from a prior form. The prior
      // still wins over both — a sentence already written is never re-invented.
      row.parked_reason = String(p?.parked_reason ?? "").trim()
        || (row.parked_kind === "declared" ? declaredObstacle : "");
      row.parked_refusals = Math.max(Number(p?.parked_refusals) || 0, 0);
      parked += 1;
    } else {
      row.parked = false; row.parked_reason = ""; row.parked_refusals = 0; row.parked_kind = "";
    }
  }
  // OUTSTANDING EXCLUDES PARKED, and that single subtraction is what ends the live-lock: the gate reads
  // this number (gateway.mjs) to decide the stage still owes work, so a parked row stops holding the run
  // hostage while still being visibly undecided in `parked`.
  return { form, total: form.rows.length, ruled, parked,
    outstanding: form.rows.length - ruled - parked, carried };
}

/** How many rows of an already-unioned form the gate would still refuse. PURE. */
export function outstandingRows(form, ob) {
  const canonical = obligationRows(ob);
  const find = formRowFinder(form, canonical);
  return canonical.filter((c) => !isRuled(find(c) ?? {}, c));
}
