// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// disposition-call.mjs — THE SEAT STOPS TYPING JSON. It calls; the driver writes the file.
//
// ── WHAT THIS REPLACES, AND WHY THE OLD SHAPE COULD NOT BE PATCHED ──────────────────────────────────
//
// The meaning seat was handed a 140 KB JSON file and asked to fill 74 rows by editing it. On the
// 2026-08-15 terminal it filled every one — 74 notes, 74 rulings — and wrote ONE row's delimiters as
// typographic quotes. The file stopped parsing at char 2535, the driver could read none of it, and the
// run was told `74 rows, not one edit`. A legal analysis was voided by a quote character.
//
// made that failure visible and truthful. It did not make it impossible, and it cannot: as long as
// a model hand-types a structured document, hand-typed-document-fails-to-parse is a failure the engine
// can have. This module removes the class. The seat sends VALUES; the serialization is ours.
//
// ── THE FOUR PROPERTIES, each of which is a decision with a cost ────────────────────────────────────
//
// 1. A CALL CARRIES A BATCH, NOT A ROW. 17 of 23 recorded runs already refuse to hand-author the form:
//    they write a generator program and let a machine emit the JSON. The seats are routing around the
//    transport TODAY. A tool that is tedious at 74 rows gets routed around too, and the next workaround
//    will not be a benign Python script. So the ergonomics are a correctness property, not a courtesy,
//    and the ceremony budget below is pre-registered rather than judged after the fact.
//
// 2. THE SEAT CANNOT NAME AN IDENTIFIER. `receipt_id` is not in the accepted shape at all — supplying
//    one is refused by name. One run wrote the literal `R-RECEIPT` into 27 rows because a prompt had
//    displayed the token's shape; a validator that rejects that has moved the defect, a schema that
//    cannot express it has removed it. The seat gives the POSITION of a candidate in that row's own
//    list and the driver resolves it (resolveCandidate, the same function the gate binds with).
//
// 3. EVERY PER-ROW VALUE IS CHECKED AGAINST THAT ROW, AT CALL TIME. A constant that happens to satisfy
//    the schema still fails, because the anchor must occur in THAT row's captured text and the position
//    must exist in THAT row's candidate list. The seat learns inside its own turn, from the tool's own
//    answer, instead of three attempts later from a corrective.
//
// 4. PARTIAL ACCEPT. Rows that validate are accepted even when their neighbours in the same call are
//    refused. The old transport's whole disease was all-or-nothing: one bad row voided 73 good ones.
//    Anything that re-creates that property here has re-created the bug in a new place.
//
// ── AN OPEN DECISION, NAMED NOW BECAUSE IT IS CHEAP NOW AND EXPENSIVE ONCE THE TOKENS EXIST ─────────
//
// `quote_required` IS NOT STABLE ACROSS A TURN. Spot-check selection sorts the rows holding usable
// snippets by a hash of their row id and takes the first N — so the eligible set is a function of the
// LEDGER, and a mid-turn top-up grows the ledger. That is not hypothetical: it is the documented reason
// the grid tool rewrites the form at all.
//
// The consequence for this transport: a row accepted WITHOUT an anchor on call 1 can owe one by call 3.
// The old transport absorbed that by regenerating the whole form and re-judging it. This one accepts
// into the accumulator against the obligation set that existed AT CALL TIME.
//
// Two honest answers, and one has to be chosen before the failure tokens are built:
//   · RE-DERIVE at judgement — an earlier accept can become insufficient, and the seat is told which
//     rows grew an obligation. Truthful, and it can surprise a seat that was told a row was recorded.
//   · FREEZE the obligation set at the turn's first call — nothing a seat was told is ever revoked, at
//     the cost of a top-up's new rows waiting for the next attempt.
//
// NOT DECIDED HERE, and deliberately not defaulted into by silence: whichever it is, it changes what a
// `partial` failure MEANS, so it belongs to the same piece of work as the tokens.

// PURE — no node imports, so it tests offline, exactly like connotation-search.mjs and
// disposition-union.mjs, whose headers state the same rule for the same reason. It reads those modules
// and neither reads this one: the import runs ONE WAY, so there is no second opinion about what a
// ruling is, what binds, or how a position becomes an id.

import { RULINGS, resolveCandidate, segmentBinding, obligationRows, connotationObligations, livePassages, normText } from "./connotation-search.mjs";

const RULING_SET = new Set(RULINGS);
const str = (v) => String(v ?? "").trim();

// ── THE CEREMONY BUDGET, PRE-REGISTERED ─────────────────────────────────────────────────────────────
//
// Written down BEFORE the tool exists, so "ergonomic" is a measurement and not an opinion formed after
// seeing the result. The largest recorded meaning sweep owes 74 rows.
//
// 25 rows per call clears 74 in THREE calls. The budget allows four, so one retry of a refused chunk
// still lands inside it. A built tool that needs more than four calls for 74 rows has failed decision 1
// and the design is wrong — not the seat, and not the day it was measured.
//
// WHY NOT ONE CALL OF 74: the payload is ~100 KB of arguments the model still emits token by token, and
// an abandoned call loses all of it. Chunking bounds that loss to one chunk.
// WHY NOT 74 CALLS OF ONE: 74 turns of ceremony for a task the seat currently does in one. That is the
// shape most likely to be worked around, which by decision 1 is a correctness failure.
export const MAX_ROWS_PER_CALL = 25;

// THE FIELDS A CALL ROW CARRIES — the seat's own six (MEANING_SEAT_FIELDS) plus `row_index`, the address
// that binds a row to the obligation it answers. Declared as a LITERAL closed set because the skills
// teach it and the vocabulary sweep (skill-contract-enumerations,) reads exported constants from
// source; disposition-call.test.mjs binds it to ["row_index", ...MEANING_SEAT_FIELDS] so the two lists
// cannot drift.
//
// ── — THE ADDRESS IS A POSITION, BECAUSE THE ID WAS NEVER ISSUED ──────────────────────────────
//
// This field was `row_id`, and the issue that changed it reads "the meaning seat invents its own row
// ids". It does not. IT WAS NEVER GIVEN ANY. Four statements, all live on main until this change:
//
//   1. The obligations block's own header: "YOU CITE NO IDENTIFIER ANYWHERE."
//   2. Fifty lines below it: "each with `row_id` (exactly as the obligations sidecar lists it)".
//   3. Nine lines below THAT: "The position is enough. You never type an id".
//   4. The sidecar it names lists `queriesOwed` — QUERY STRINGS. It has never carried a row id, and
//      neither has the block: `renderConnotationObligations` printed each obligation as "- <query>".
//
// So the seat was ordered to copy an identifier out of a document that contains no identifiers, by a
// page that twice told it to type no identifier at all. It resolved that contradiction the only way the
// evidence allowed — it sent the one per-row label it had been shown, the query text — and the driver
// refused all 28 of them `unknown_row` — 27 distinct strings, 10% of every refusal on the production
// run that measured it. Then the tool's ANSWER named what was still outstanding as bare `Q-…`/`X-…`
// tokens, which appear in nothing the seat had ever read, so it could not map a single one back.
//
// "The seat invents ids" describes the symptom. The cause is that the driver asked for an identifier it
// does not issue, and then reported back in it. A validator that refuses the invention has moved the
// defect; an address that cannot be invented removes it — the same sentence property 2 below already
// makes about `receipt_id`, one field over, shipped and proven.
export const CALL_ROW_FIELDS = Object.freeze(["row_index", "receipt_index", "ruling", "note", "segment_index", "fragment", "obstacle"]);
export const CEREMONY_BUDGET_CALLS = 4;
export const ceremonyCallsFor = (rowCount) => Math.ceil(Math.max(0, Number(rowCount) || 0) / MAX_ROWS_PER_CALL);

// ── THE REFUSAL VOCABULARY ──────────────────────────────────────────────────────────────────────────
//
// One reason, one cause, one remedy — the rule this whole tranche exists to enforce. `connotation_
// form_damaged` carried two unrelated faults and its corrective sent a seat whose JSON had broken to go
// and fix a receipt id. Nothing here is allowed to mean two things.
//
// These are the TOOL's own per-row answers, returned inside the turn. They are not failure tokens: a
// refused row is not a failed stage, it is a row the seat can fix while it still has the context to.
export const CALL_REFUSALS = Object.freeze([
  "row_position_absent",  // the row was sent with no address at all
  "row_position_invalid", // that number addresses no obligation in the list the seat was shown
  "row_addressed_by_id",  // a row id was typed; rows are addressed by their number in the list
  "duplicate_row",        // the same row twice in one call; which one is the answer is not ours to guess
  "ruling_invalid",       // not one of the accepted rulings
  "note_absent",          // ruled with nothing said about why
  "identifier_supplied",  // a RECEIPT id was typed; the driver resolves ids and the seat never types one
  "position_invalid",     // no such candidate in THAT row's own list
  "position_absent",      // the row offers a choice and none was made
  // ── — THE POINTER AND THE PROOF, EACH WITH ITS OWN REMEDY ─────────────────────────────────
  //
  // REPLACED, NOT DROPPED. The three retired tokens are listed below so the ledger's histogram can show
  // the differential across the change: a corpus where `anchor_unbound` was 162 of 170 refusals and a
  // corpus where `fragment_unbound` is near zero are the SAME measurement of different code, and that
  // comparison is the only evidence this cure worked. Deleting the old names would have left the two
  // populations incomparable, which is the position the whole issue is about.
  "segment_absent",       // a quote_required row that named no segment
  "segment_invalid",      // no such segment in the ruled candidate's own snippet
  "segment_dead_end",     // — the PASSAGE cannot reach FRAGMENT_MIN; no fragment will ever bind there
  // ── — THE HONEST EXIT FROM THE EVIDENCE DUTY ──────────────────────────────────────────────
  "obstacle_absent",      // an obstacle was claimed with nothing said about what blocks the proof
]);

// The proof-of-reading arms, and ONLY those. 's obstacle waives this duty and no other, so this set
// is the exact boundary between "you have not proved you read it" and "you have not judged it" — derived
// by prefix from the vocabulary above rather than retyped, so a new evidence arm joins it automatically
// and a new judgment arm cannot wander in.
const EVIDENCE_REFUSALS = new Set(CALL_REFUSALS.filter((r) => r.startsWith("segment_") || r.startsWith("fragment_")));

// The pointer-era tokens. No live path emits these; `anchorBinding` still parses archived and replayed
// forms, and a replay's refusals are historical. Kept exported so a reader of an old ledger can resolve a
// token that no longer exists in the vocabulary above — a name absent from both lists reads as corruption.
export const RETIRED_CALL_REFUSALS = Object.freeze([
  // — the transcription-era tokens. No live path emits these: the pointer binds and a fragment is
  // recorded rather than required. Kept readable because 85% of the refusals in every archived ledger
  // are these three, and a name absent from both lists reads as corruption rather than as history.
  "fragment_absent",      // a segment was pointed at with nothing copied out of it
  "fragment_too_short",   // too few characters to be evidence of having read anything
  "fragment_unbound",     // the fragment did not occur in the segment pointed at — TRANSCRIPTION, not reading

  "anchor_absent",        // → segment_absent + fragment_absent (the two duties it conflated)
  "anchor_unbound",       // → fragment_unbound, but only within the POINTED segment
  "anchor_foreign",       // → unreachable: the segment resolves against the candidate already bound
  // — RETIRED BY REMOVING WHAT IT JUDGED, not by deciding it was wrong. `unknown_row` fired when a
  // row named an id the driver had not minted, and every one of those firings was CORRECT. It is retired
  // because nothing resolves by id any more: the address is a position, so there is no id to get wrong.
  //
  // KEPT IN THE VOCABULARY FOR THE SAME REASON THE ANCHOR TOKENS ARE. A corpus where `unknown_row` is 28
  // of 280 refusals and a corpus where it is absent are the same measurement of different code, and that
  // differential is the only evidence this change did anything. Delete the name and the two populations
  // stop being comparable — which is the position is about, arriving one level up.
  "unknown_row",          // → row_position_absent / row_position_invalid / row_addressed_by_id
]);

// ── THE DRIVER'S OWN DROPS — A SEPARATE VOCABULARY, AND THE SEPARATION IS THE POINT ─────────────────
//
// A refusal above is the seat's to fix and is returned inside its turn. THIS is the other kind: the tool
// ACCEPTED the row and the accumulator does not carry it afterwards. Nothing the seat can do about that,
// and it must never appear in the same bucket, because the two demand opposite responses — one says
// "change your answer", the other says "stop asking, it is ours".
//
// 's leading unproven hypothesis lives here. The accumulator's rows and candidates are REGENERATED
// on every pass, and `seatFields` re-resolves an already-resolved row against whatever the current pass
// holds (`disposition-union.mjs:98`, which discards `resolveCandidate`'s `state`). If that second
// resolution misses, a row the tool accepted lands with an empty receipt and reads as unruled. This
// records the disagreement instead of leaving it to be re-derived from mtimes a day later.
export const CALL_DROPS = Object.freeze([
  "accepted_not_folded",  // the tool accepted this row and the accumulator does not carry it — OURS, not the seat's
]);

/**
 * FOLD A PER-CALL VERDICT LEDGER INTO A PER-ROW HISTORY — without collapsing the unit that matters.
 *
 * ── WHY THIS KEEPS COUNTS AND NOT A FINAL STATE ─────────────────────────────────────────────────────
 *
 * The R5 investigation nearly killed a TRUE hypothesis on exactly this. The test joined distinct
 * `(row_id, anchor-present)` pairs against each row's FINAL state, so a row sent 85 times with an anchor
 * and once without appeared in both buckets and read as uncorrelated. **Per-call outcome was the only
 * valid unit, and a fold that returns "what happened to this row in the end" reconstructs the defect the
 * ledger exists to remove.**
 *
 * So every row carries `calls` and a `reasons` HISTOGRAM. `84 × anchor_unbound, 1 × position_absent` and
 * `1 × anchor_unbound` are different facts about a seat, and only one of them is a loop. A caller that
 * wants a single state can compute one; a caller handed a single state cannot recover the histogram.
 *
 * `records` is the ledger as parsed, oldest first. Unreadable or missing entries are skipped rather than
 * thrown on: this is diagnostic material, and a fold that dies on one bad line destroys the evidence of
 * every good one.
 *
 * `rulings` is the same idea applied to the seat's CONCLUSION: a histogram, plus `rulingSeq`, the ordered
 * distinct rulings this row claimed across calls. Two rows both showing `{benign: 41, loaded: 85}` are
 * indistinguishable by histogram alone; `["benign", "loaded"]` versus `["loaded", "benign"]` says which
 * way a seat moved, and that is the difference between a seat correcting itself and a seat drifting.
 *
 * ── — A REFUSAL THAT NAMES NO ROW IS STILL A REFUSAL ─────────────────────────────────────────
 *
 * `byRow` is keyed by row id, so an entry whose id does not resolve has no bucket to land in. It used to
 * be dropped there in silence, reason and all. `validateDispositionCall` mints exactly that entry on
 * purpose — when the seat's `row_index` addresses no obligation, the refusal is recorded with
 * `row_id: ""` so the fault is on the record rather than invented onto some row — and its own header
 * says why the park bound must not see it: you cannot park a row you cannot name.
 *
 * Being invisible to the PARK is right. Being invisible to the COUNT is not. On the delivered run that
 * measured it, the ledger held 88 refusals and the fold reported 87 — one `unknown_row` with an empty
 * id — so the receipts artifact under-reported its own ledger and criterion 2 of failed by one.
 *
 * `unattributed` is where those go: counted, kept with their reason, and NOT keyed onto any row. So the
 * histogram totals the ledger while `byRow` stays exactly what it was — the park bound, the drift
 * detector and the unruled partition read the same rows they read before.
 *
 * @returns {{calls:number, byRow:Record<string,{calls:number, accepted:number, refused:number,
 *            dropped:number, reasons:Record<string,number>, rulings:Record<string,number>,
 *            rulingSeq:string[], firstSeq:number|null, lastSeq:number|null}>,
 *            unattributed:{refused:number, dropped:number, reasons:Record<string,number>}}}
 * PURE; never throws.
 */
export function foldCallVerdicts(records) {
  const out = { calls: 0, byRow: {}, unattributed: { refused: 0, dropped: 0, reasons: {} } };
  const list = Array.isArray(records) ? records : [];
  const at = (row_id) => {
    const k = str(row_id);
    if (!k) return null;
    out.byRow[k] ??= { calls: 0, accepted: 0, refused: 0, dropped: 0, reasons: {}, rulings: {}, rulingSeq: [],
      firstSeq: null, lastSeq: null };
    return out.byRow[k];
  };
  for (const rec of list) {
    if (!rec || typeof rec !== "object") continue;
    out.calls += 1;
    const seq = Number.isInteger(rec.seq) ? rec.seq : null;
    // ONE CALL COUNTS ONCE PER ROW even if the payload named that row twice — the second mention is
    // `duplicate_row`, which is already its own refusal. Double-counting it here would inflate `calls`
    // on precisely the rows a reader is trying to judge, and an inflated count is how a log line stops
    // being a measurement.
    const touched = new Set();
    const bump = (row_id, field, reason, ruling) => {
      const r = at(row_id);
      // — NO BUCKET IS NOT NO EVENT. `accepted` is excluded deliberately: an acceptance with no id
      // cannot reach the form either (the union keys on row id), so counting it here would assert work
      // landed that did not. A refusal or a drop happened whatever it names.
      if (!r) {
        if (field === "refused" || field === "dropped") {
          out.unattributed[field] += 1;
          if (reason) out.unattributed.reasons[reason] = (out.unattributed.reasons[reason] ?? 0) + 1;
        }
        return;
      }
      r[field] += 1;
      if (reason) r.reasons[reason] = (r.reasons[reason] ?? 0) + 1;
      const rl = str(ruling).toLowerCase();
      if (rl) {
        r.rulings[rl] = (r.rulings[rl] ?? 0) + 1;
        // Appended only when it CHANGES, so the sequence stays a record of movement rather than of volume.
        if (r.rulingSeq[r.rulingSeq.length - 1] !== rl) r.rulingSeq.push(rl);
      }
      if (!touched.has(row_id)) {
        touched.add(row_id);
        r.calls += 1;
        if (r.firstSeq === null) r.firstSeq = seq;
        r.lastSeq = seq;
      }
    };
    // A BARE STRING IS STILL A ROW ID. `callAnswer` states the same tolerance for the same reason: an
    // older ledger line, or any caller with nothing to say about rulings, must not read as a row with no id.
    for (const x of Array.isArray(rec.accepted) ? rec.accepted : [])
      bump(typeof x === "string" ? x : x?.row_id, "accepted", null, typeof x === "string" ? "" : x?.ruling);
    for (const x of Array.isArray(rec.refused) ? rec.refused : [])
      bump(x?.row_id, "refused", str(x?.reason) || "unnamed_reason", x?.ruling);
    for (const x of Array.isArray(rec.dropped) ? rec.dropped : [])
      bump(x?.row_id, "dropped", str(x?.reason) || "unnamed_drop", x?.ruling);
  }
  return out;
}

/**
 * THE WHOLE LEDGER'S REASON HISTOGRAM — every refusal and drop it recorded, by token.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────
 *
 * The receipts audit built its `refusalReasons` map by walking `partitionUnruledByLedger(...).rows` —
 * the rows that are STILL UNRULED and were addressed. That is a correct population for the question
 * "which outstanding obligation is looping", and the wrong one for the question the field's own name
 * answers. On R5 round 7a30934b every obligation ended up ruled, so `obligationsUnruled` was 0, the
 * partition returned `rows: []` by its `total === 0` branch, and the artifact recorded
 * `refusalReasons: {}` against a ledger holding 193 refusal tokens over 8 types.
 *
 * **An empty refusal histogram reads as "nothing was refused".** The run refused 193 times. That is the
 * absence-reads-as-success class, in the file a reviewer opens to certify the instrument.
 *
 * `rulingDrift` was populated in the same write because `detectRulingDrift` takes the LEDGER. This
 * function gives the histogram the same footing: it folds what was recorded, not what is outstanding.
 *
 * PURE; never throws. `{}` here means the ledger recorded no refusal and no drop — which, unlike the
 * old empty map, is a fact about the ledger rather than about a partition.
 */
export function ledgerReasonHistogram(ledger) {
  const out = {};
  const byRow = (ledger && typeof ledger.byRow === "object" && ledger.byRow) || {};
  for (const row of Object.values(byRow)) {
    for (const [reason, n] of Object.entries(row?.reasons ?? {})) {
      out[reason] = (out[reason] ?? 0) + (Number(n) || 0);
    }
  }
  // — AND THE ONES THAT NAMED NO ROW. This histogram answers "what did the ledger refuse", which
  // is a question about the ledger and not about any row, so an entry with no resolvable id belongs in
  // it. Folding them here rather than minting a placeholder row is what keeps `byRow` — and therefore
  // the park bound, the drift detector and the unruled partition — reading exactly what it read before.
  for (const [reason, n] of Object.entries(ledgerUnattributed(ledger).reasons)) {
    out[reason] = (out[reason] ?? 0) + (Number(n) || 0);
  }
  return out;
}

/**
 * THE REFUSALS AND DROPS THE LEDGER RECORDED AGAINST NO ROW.
 *
 * Its own field on the receipts artifact, because the alternative is a reader finding `refusalReasons`
 * summing to 88 beside `callRows` summing to 87 and having no way to learn where the difference went.
 * That gap is the exact shape of the defect this family keeps producing: two numbers side by side, both
 * correct, disagreeing, with nothing naming the reason. Here the residue is named, so the two reconcile
 * by subtraction rather than by trust.
 *
 * `{refused: 0, dropped: 0, reasons: {}}` on a ledger where every entry named a row — a fact about the
 * ledger, and the answer a reader wants when they ask whether anything went unattributed.
 *
 * PURE; never throws. Tolerates a fold from before this field existed.
 */
export function ledgerUnattributed(ledger) {
  const u = (ledger && typeof ledger.unattributed === "object" && ledger.unattributed) || {};
  return {
    refused: Number(u.refused) || 0,
    dropped: Number(u.dropped) || 0,
    reasons: (typeof u.reasons === "object" && u.reasons) || {},
  };
}

/**
 * EVERY ROW THE LEDGER TOUCHED, as a flat list — the per-row view of what a seat actually did.
 *
 * Sibling of the histogram above and added for the same reason: the audit's `addressedRows` is
 * scoped to the unruled∩ledger intersection, which is the right evidence for
 * `obligationsAddressedNotDischarged` and is EMPTY on a run that discharged everything. It was correct
 * and unexplained, sitting beside a map that was simply wrong, and a reader could not tell which was
 * which. This is the population "what rows were called, and how did they end" actually asks for.
 *
 * Sorted by call volume, descending, so the loop is the first thing a reader sees. PURE.
 */
export function ledgerRows(ledger) {
  const byRow = (ledger && typeof ledger.byRow === "object" && ledger.byRow) || {};
  return Object.entries(byRow)
    .map(([row, r]) => ({ row, calls: r?.calls ?? 0, accepted: r?.accepted ?? 0,
      refused: r?.refused ?? 0, dropped: r?.dropped ?? 0, reasons: r?.reasons ?? {} }))
    .sort((a, b) => b.calls - a.calls || String(a.row).localeCompare(String(b.row)));
}

/**
 * ROWS WHOSE LEGAL CONCLUSION MOVED ACROSS CALLS. A DETECTOR, AND ONLY A DETECTOR.
 *
 * ── WHY THIS IS A CORRECTNESS INSTRUMENT AND NOT A COST ONE ─────────────────────────────────────────
 *
 * R5's terminal, partitioned by attempt over ONE seat with no regeneration boundary between them:
 *
 *   A1 — 18 calls — `benign`
 *   A2 — 23 calls — `benign`
 *   A3 — 85 calls — `loaded` and `off-topic`, with `benign` gone entirely from two rows
 *   RESUME — 5 calls — `benign`, accepted
 *
 * **Had any single A3 call been accepted, a contradicting legal ruling would have banked against 41
 * prior `benign` calls from the same seat.** The only thing that kept it out of the delivered opinion was
 * that the anchor refusals kept refusing. That is not a safety property, it is a coincidence — and a run
 * that happened to accept an A3 call would have shipped the contradiction with a clean audit.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ────────────────────────────────────────────────────────────────
 *
 * It does not normalise, pick, rank or repair. A seat is ALLOWED to correct itself — that is the whole
 * reason the union lets a later submitted row win — so movement is not by itself a defect, and a
 * detector that resolved it would be choosing a legal conclusion in code. It records that the movement
 * happened and hands it to a reader.
 *
 * ── THE LIMIT, STATED BECAUSE A SILENT ONE BECOMES A FALSE CLAIM ────────────────────────────────────
 *
 * The ledger is per call and carries no regeneration boundary, so this CANNOT tell a seat that re-ruled
 * after its candidate list was regenerated (legitimate) from one that drifted inside a single obligation
 * set (the R5 shape). It reports movement and the call range it spans; whether a boundary sat inside that
 * range is a question for whoever reads it against the attempt record. Flagging movement and saying so is
 * honest; flagging it as contradiction would be a claim this data cannot support.
 *
 * @returns {Array<{row_id:string, rulingSeq:string[], rulings:object, calls:number,
 *                  firstSeq:number|null, lastSeq:number|null, accepted:number, refused:number}>}
 * PURE; never throws.
 */
export function detectRulingDrift(ledger) {
  const byRow = (ledger && typeof ledger.byRow === "object" && ledger.byRow) || {};
  const out = [];
  for (const [row_id, r] of Object.entries(byRow)) {
    const seq = Array.isArray(r?.rulingSeq) ? r.rulingSeq : [];
    if (seq.length < 2) continue;              // one conclusion, however many times — not movement
    out.push({ row_id, rulingSeq: seq, rulings: r?.rulings ?? {}, calls: r?.calls ?? 0,
      firstSeq: r?.firstSeq ?? null, lastSeq: r?.lastSeq ?? null,
      accepted: r?.accepted ?? 0, refused: r?.refused ?? 0 });
  }
  return out;
}

/**
 * SPLIT "UNRULED" INTO ADDRESSED AND NEVER-ADDRESSED — the misclassification is named after.
 *
 * `obligationsNeverAddressed: 2` was the R5 park's only surviving trace of two rows the seat had
 * addressed 163 times. It is the one description of that run that demonstrably did not happen, and it is
 * worse than a loud rejection: it sends the reader hunting the seat, when the seat did its job.
 *
 * ── THE NO-LEDGER CASE IS THE OLD BEHAVIOUR, EXACTLY ────────────────────────────────────────────────
 *
 * With an empty or absent ledger this returns `{neverAddressed: unruledTotal, addressed: 0}` — bit for
 * bit what the audit reported before. Every archived run and every run on the form path keeps its
 * numbers, so this cannot silently restate history it has no evidence about. The split only ever appears
 * where a ledger exists to support it.
 *
 * ── WHY THE TOTAL IS RETURNED TOO ───────────────────────────────────────────────────────────────────
 *
 * 's warning sits in this exact number: filtering it after a split reported
 * `obligationsNeverAddressed: 0` on the run that died owing 75. So the total comes back as its own field
 * and the two parts must sum to it. Nothing can go to zero without a companion number rising to meet it.
 *
 * `unruledRows` are the row ids the audit could NAME. `form_untouched` is one aggregate violation
 * carrying its population in a count and naming no rows, so an empty list beside a non-zero total is a
 * real state, not a bug: there the whole obligation set is unruled, and every addressed row is therefore
 * an addressed unruled row. That branch is flagged (`populationUnnamed`) rather than blended in, because
 * a reader must be able to tell a measured intersection from a bounded inference.
 *
 * @returns {{total:number, neverAddressed:number, addressed:number, populationUnnamed:boolean,
 *            rows:Array<{row_id:string, calls:number, refused:number, dropped:number, reasons:object}>}}
 * PURE; never throws.
 */
export function partitionUnruledByLedger({ unruledTotal = 0, unruledRows = [], ledger = null } = {}) {
  const total = Math.max(0, Number(unruledTotal) || 0);
  const byRow = (ledger && typeof ledger.byRow === "object" && ledger.byRow) || {};
  const addressedIds = Object.keys(byRow);
  const named = (Array.isArray(unruledRows) ? unruledRows : []).map((r) => str(r)).filter(Boolean);
  const detail = (ids) => ids.map((id) => ({
    row_id: id, calls: byRow[id]?.calls ?? 0, refused: byRow[id]?.refused ?? 0,
    dropped: byRow[id]?.dropped ?? 0, reasons: byRow[id]?.reasons ?? {},
  }));

  if (!addressedIds.length || total === 0)
    return { total, neverAddressed: total, addressed: 0, populationUnnamed: false, rows: [] };

  if (named.length) {
    const hit = named.filter((id) => Object.hasOwn(byRow, id));
    // The intersection cannot exceed the total it partitions. It could only do so if `unruledRows` named
    // rows the count does not cover, which would mean the two came from different derivations — so the
    // clamp is a guard on THAT, not a tidy-up, and it is recorded by the sum invariant the tests assert.
    const addressed = Math.min(hit.length, total);
    return { total, neverAddressed: total - addressed, addressed, populationUnnamed: false,
      rows: detail(hit.slice(0, addressed)) };
  }

  // NOTHING NAMEABLE, AND A NON-ZERO TOTAL — the untouched-form branch. Bounded, not blended.
  const addressed = Math.min(addressedIds.length, total);
  return { total, neverAddressed: total - addressed, addressed, populationUnnamed: true,
    rows: detail(addressedIds.slice(0, addressed)) };
}

/**
 * Validate one typed call against the driver's own obligation rows.
 *
 * `rows` is the seat's payload: `[{row_id, ruling, note, receipt_index?, anchor?}]`. Nothing else is
 * read, and `receipt_id` is refused rather than ignored — silently dropping it would let a seat believe
 * it had cited something.
 *
 * Returns `{accepted, refused, overflow}`:
 *   accepted — rows carrying the DRIVER's resolved receipt id, ready for the accumulator
 *   refused  — `{row_id, reason, detail}` per row, for the tool's answer inside the turn
 *   overflow — rows beyond MAX_ROWS_PER_CALL, neither accepted nor refused; the caller re-sends them
 *
 * PURE. Never throws — a malformed payload is refused, not an exception, because an exception here
 * would surface as a tool error and tell the seat nothing about which row was wrong.
 */
/**
 * The list a `row_index` counts off: the order the driver RECORDED when it rendered the obligations
 * block, with any newly-canonical row appended. A `told` entry that is no longer an obligation keeps its
 * slot as `null` — a hole, deliberately, because closing it would slide every later row up one and
 * silently re-point a number the seat is holding. PURE.
 */
export function addressableRows(canonical, told) {
  const rows = Array.isArray(canonical) ? canonical : [];
  const byId = new Map(rows.map((c) => [str(c?.row_id), c]));
  const order = Array.isArray(told) ? told : null;
  if (!order) return rows;
  const out = [], used = new Set();
  for (const id of order) {
    const k = str(id);
    if (!k || used.has(k)) continue;
    used.add(k);
    out.push(byId.get(k) ?? null);
  }
  for (const c of rows) if (!used.has(str(c?.row_id))) out.push(c);
  return out;
}

export function validateDispositionCall(rows, recorded, { told = null } = {}) {
  // ONE DERIVATION, THE SAME ONE THE GATE USES. `obligationRows` takes the OBLIGATIONS, not the ledger —
  // handing it the ledger yields a different row set and every real row reads as unaddressable, which is
  // a confident refusal of correct work. Caught by the first test that used a real row.
  const canonical = obligationRows(connotationObligations(recorded));
  // ── — THE NUMBERS ARE THE ONES THE SEAT WAS SHOWN, NOT THE ONES WE WOULD MINT NOW ──────────
  //
  // The obligation set is RE-DERIVED on every call against the ledger as it stands at that moment, and
  // this module's header calls that deliberate: a mid-turn top-up grows the ledger, and a row can acquire
  // an evidence obligation it did not have at call 1. That is right for what a row OWES and fatal for
  // what a row IS CALLED. A query recorded with zero results is filtered out of the obligations; topped
  // up into one with results it re-enters at its ORIGINAL slot, and every number after it moves by one.
  // The seat, counting off the page it was handed, would then address row 12 and bind row 11.
  //
  // A WRONG ID GETS REFUSED. A WRONG NUMBER GETS ACCEPTED. That asymmetry is the whole reason this list
  // exists rather than a re-derivation: positional addressing without it would trade a loud failure for a
  // silent mis-binding, which is a worse artifact than the one is about.
  //
  // So the addressing list is the order the driver recorded when it rendered the block (`told`), with any
  // newly-canonical row appended after it — append-only by construction, and taken from the driver's own
  // record of what it said rather than from a derivation with no memory of it. Absent `told` (a pure-core
  // caller, or a run whose sidecar could not be read) this is exactly the canonical order, as before.
  const addressable = addressableRows(canonical, told);
  const numberOf = new Map();
  addressable.forEach((c, i) => { if (c) numberOf.set(str(c.row_id), i + 1); });
  // The remedy for a typed id, RESOLVED: an id we minted, the raw query text, or a folded query text that
  // matches exactly one row. This is what turns the observed failure into one round trip — the seat sent
  // `MERIDIAN THISTLE gang`, and the answer can say which number that query is, instead of only that it
  // is not an id. A fold matching two rows names neither: the twins are two obligations, not one.
  const numberForTyped = (typed) => {
    const t = str(typed);
    if (!t) return 0;
    if (numberOf.has(t)) return numberOf.get(t);
    const exact = addressable.filter((c) => c && str(c.query) === t);
    if (exact.length === 1) return numberOf.get(str(exact[0].row_id)) ?? 0;
    const folded = addressable.filter((c) => c && str(c.query) && normText(c.query) === normText(t));
    return folded.length === 1 ? (numberOf.get(str(folded[0].row_id)) ?? 0) : 0;
  };
  const accepted = [], refused = [], seen = new Set();
  const list = Array.isArray(rows) ? rows : [];
  // COUNT THEM ALL, name the ones that can be named. Filtering out the address-less ones would drop them
  // from the count under a comment that says a truncation nobody is told about is an absence reading as a
  // pass.
  const overflow = list.slice(MAX_ROWS_PER_CALL)
    .map((r) => (str(r?.row_index ?? r?.rowIndex) ? "row " + str(r?.row_index ?? r?.rowIndex) : "(no row_index)"));

  for (const raw of list.slice(0, MAX_ROWS_PER_CALL)) {
    // THE ADDRESS RESOLVES BEFORE ANYTHING ELSE IS READ, and what every record carries afterwards is the
    // DRIVER's row id, never the seat's bytes. Nothing downstream changed: the park count, the verdict
    // ledger and the accumulator are all still keyed by row id. What changed is that the seat no longer
    // types that key, so it can no longer type one that does not exist.
    const rawIdx = raw?.row_index ?? raw?.rowIndex;
    const hasIdx = rawIdx != null && str(rawIdx) !== "";
    // DIGITS ONLY — the rule `resolveCandidate` applies to `receipt_index`, for the same reason: Number()
    // takes "2.5", " 2 " and "2px", and an ordinal that is not an integer is not an ordinal.
    const n = hasIdx && /^\d+$/.test(str(rawIdx)) ? Number(str(rawIdx)) : NaN;
    const c = Number.isInteger(n) && n >= 1 && n <= addressable.length ? addressable[n - 1] : null;
    // `let`, not `const`: a typed id that RESOLVES tells us which row the refusal is about, and a refusal
    // that names no row is invisible to the park bound — a seat stuck re-sending one row by name
    // would never be parked, which is the live-lock that bound exists to end.
    let row_index = hasIdx ? str(rawIdx) : "";
    let row_id = c ? str(c.row_id) : "";
    // THE RULING AS SENT RIDES ON THE REFUSAL. Read off the RAW payload, before any normalisation, and
    // carried even when the refusal is about something else entirely — a row refused for `anchor_unbound`
    // still asserted a legal conclusion, and whether that conclusion CHANGED across attempts is the
    // difference between wasted calls and a contradicted opinion. R5's A3 moved `benign` → `loaded` over
    // 85 refused calls; nothing outside the seat's turn could have shown it.
    // AN EVIDENCE REFUSAL ON A ROW THAT DECLARED AN OBSTACLE IS A PARK, NOT A REFUSAL. This is the whole
    // mechanism: the seat keeps being told exactly what is wrong for every other class of fault, and stops
    // being told to retry the one thing it has just said it cannot do. Judgment faults are untouched — an
    // obstacle does not buy a missing note or an invented ruling.
    const no = (reason, detail) => {
      if (obstacleRow && EVIDENCE_REFUSALS.has(reason)) {
        accepted.push({ row_id, ruling: str(raw?.ruling).toLowerCase(), note: str(raw?.note),
                        obstacle: obstacleRow, parked_kind: "declared" });
        return;
      }
      refused.push({ row_id, row_index, reason, detail, ruling: str(raw?.ruling).toLowerCase() });
    };
    const obstacleRow = str(raw?.obstacle);

    // — A TYPED ROW ID IS REFUSED BY NAME, and the refusal carries the number when it can find one.
    // Silently ignoring it would let a seat believe its id had addressed the row — the identical mistake
    // `identifier_supplied` exists to stop one field over. Refused even alongside a good `row_index`, for
    // that same reason; the detail then says so, so the remedy reads "delete a field", never "re-rule".
    const typedId = raw?.row_id ?? raw?.rowId;
    if (typedId != null && str(typedId) !== "") {
      const at = numberForTyped(typedId);
      const already = at && numberOf.get(row_id) === at
        ? ", which is the number you already gave — only the named field has to go" : "";
      if (at && !row_id) { row_index = String(at); row_id = str(addressable[at - 1]?.row_id); }
      no("row_addressed_by_id", at
        ? "do not name a row. That is row " + at + " in the obligations list: re-send it with "
          + "`row_index`: " + at + already + ". Your ruling and your note are not in question."
        : "do not name a row. Rows are addressed by their NUMBER in the numbered obligations list you "
          + "were given, as `row_index` (1, 2, …). What you sent is not one of the driver's rows, and a "
          + "query string is not an address: the query is the row's TEXT and the number beside it is its "
          + "address. Count it off the list and send the number — nothing has to be copied.");
      continue;
    }
    if (!hasIdx) {
      no("row_position_absent", "this row carries no `row_index` — give the NUMBER of the obligation it "
        + "answers, counted off the numbered obligations list you were given (1 to " + addressable.length + ")");
      continue;
    }
    if (!c) {
      const why = Number.isInteger(n) && n >= 1 && n <= addressable.length
        ? " — that row is no longer owed on this run"
        : " — the list is numbered 1 to " + addressable.length;
      no("row_position_invalid", "`row_index` " + (row_index || "(none)") + " addresses no obligation" + why);
      continue;
    }
    if (seen.has(row_id)) { no("duplicate_row", "row " + row_index + " appears twice in one call — send each row once"); continue; }
    seen.add(row_id);

    // THE FIELD THAT DOES NOT EXIST, refused BY NAME rather than dropped. A seat that typed an id and
    // was silently ignored would believe it had cited a receipt, and the row would bind to whatever the
    // position said — a confident wrong answer, which is the failure mode of the whole week.
    if (raw && (raw.receipt_id != null || raw.receiptId != null)) {
      no("identifier_supplied", "do not type a receipt id — give `receipt_index`, the POSITION of the candidate in this row's own list (1, 2, …), and the driver writes the id for you");
      continue;
    }

    // ── — THE OBSTACLE EXCUSES THE PROOF, NEVER THE JUDGMENT ─────────────────────────────────
    //
    // SCOPED OFF THE FORENSICS, NOT OFF THE BRIEF. The row that killed a production run was refused 217
    // times and every single refusal was an EVIDENCE-duty one — fragment_unbound 106, fragment_absent 84,
    // fragment_too_short 18, segment_* 4. Zero `ruling_invalid`, zero `note_absent`. The seat HAD its
    // ruling the whole time; what it could not do was copy a fragment that binds. So the missing exit was
    // never from the judgment.
    //
    // AND THE JUDGMENT ALREADY HAS ONE. prelim-common-law/SKILL.md dictates it: a row that is on-topic but
    // cannot responsibly be called benign or loaded is ruled `loaded` with the note saying what could not
    // be established, "which is where an unresolved reputational question belongs". Adding a second way
    // to decline a ruling would compete with that, and an easier road past a hard row is the one outcome
    // that doctrine says no gate detects.
    //
    // So `obstacle` is not a ruling and not a substitute for one. It says: I read this and I cannot prove
    // I read it. The ruling and note are still owed and still validated — only the proof-of-reading is
    // waived, and the row is then PARKED rather than counted, so nothing claims it was decided.
    if (raw?.obstacle != null && !obstacleRow) {
      no("obstacle_absent", `row ${row_index} carries an empty \`obstacle\` — say in one line what stops you evidencing this row, because that sentence is what the reviewing lawyer reads in its place. If you can point at a passage and copy from it, do that instead.`);
      continue;
    }

    if (!RULING_SET.has(str(raw?.ruling).toLowerCase())) {
      no("ruling_invalid", `\`ruling\` must be exactly one of ${RULINGS.join(" / ")}`);
      continue;
    }
    if (!str(raw?.note)) { no("note_absent", "`note` says in one line what this receipt says and why it reads that way"); continue; }

    // THE POSITION, resolved by the DRIVER against the DRIVER's row. A one-candidate row has nothing to
    // choose and is pre-bound already, so asking for a position there would be ceremony over a decision
    // that does not exist.
    const cands = Array.isArray(c.candidates) ? c.candidates : [];
    const sole = cands.length === 1;
    const gaveIndex = raw?.receipt_index != null && str(raw.receipt_index) !== "";
    if (!sole && !gaveIndex) {
      no("position_absent", `row ${row_index} lists ${cands.length} candidates — set \`receipt_index\` to the POSITION of the one you ruled on (1, 2, …)`);
      continue;
    }
    const bound = resolveCandidate({ receipt_index: sole && !gaveIndex ? 1 : raw.receipt_index }, c);
    if (bound.state !== "bound") {
      no("position_invalid", `\`receipt_index\` ${str(raw?.receipt_index) || "(none)"} is not a position in row ${row_index}'s own candidate list — it holds ${cands.length}`);
      continue;
    }

    // THE ANCHOR, checked against THAT ROW'S captured text at call time. Today this is discovered at
    // judgement, by which point the seat has ended its turn and is told about it in a corrective one
    // attempt later. Checked here, it is a sentence the seat can act on while it still holds the page.
    // THE ANCHOR IS RESOLVED TO A QUOTE HERE, exactly as the position is resolved to an id — and for the
    // same reason. `disposition-union.mjs` does not persist `anchor` at all: it points into a candidate
    // list the driver regenerates every pass, so only the EXTRACTED TEXT is durable. Returning an anchor
    // would hand the accumulator a field it drops on the floor, and the row would read as unquoted on the
    // next regeneration. `anchorBinding` already hands back the passage it found; take it.
    // THE ANCHOR BINDS AGAINST THE RULED CANDIDATE, NOT AGAINST THE ROW. This was row-wide and it was
    // wrong, and the fault is this week's own shape: a decision recorded against one token while the
    // evidence says another. `anchorBinding` scans every candidate and reports which one it hit, and the
    // first cut took its `quote` while discarding its `receipt_id`. A seat could rule on candidate 2 and
    // quote candidate 1, and the accepted row asserted "receipt X, and here is the passage proving it"
    // over text out of receipt Y. Reproduced before it was fixed, not reasoned about: `receipt_index: 2`
    // with an anchor from candidate 1 was accepted with zero refusals.
    //
    // THE GATE THIS TRANSPORT REPLACES IS MORE TRUTHFUL HERE — it emits `id` and `near_receipt` side by
    // side, so a divergence is at least visible in the record. A replacement that silently collapses two
    // fields the old one kept apart has lost information, and losing it at the exact point the row claims
    // to be evidenced is the worst place to lose it.
    const ruled = cands.find((x) => String(x?.receipt_id ?? "").trim() === bound.id) ?? null;
    let quote = null;
    let fragmentState = null;
    if (c.quote_required) {
      // — TWO FIELDS, TWO REFUSALS, TWO REMEDIES. The pointer is resolved against the candidate
      // `resolveCandidate` ALREADY BOUND, so `anchor_foreign` is unreachable rather than refused: a ruling
      // on candidate 2 can no longer be evidenced by candidate 1's text, which the old row-wide anchor
      // search had to catch after the fact.
      const b = segmentBinding({ segment_index: raw?.segment_index ?? raw?.segmentIndex, fragment: raw?.fragment }, ruled);
      if (b.state !== "bound") {
        // EVERY REMEDY NAMES AN ACT THE SEAT CAN PERFORM. That is the whole lesson of the 163-call walk:
        // the old refusals were correct, specific and actionable, and the act they named was impossible.
        //
        // ── WHY TWO REFUSALS COLLAPSED INTO ONE, AND THE CONDITION THAT MADE IT LEGAL ────────────────
        //
        // `anchor_foreign` and `anchor_unbound` were deliberately kept apart: one said "you quoted the
        // wrong receipt", the other "you quoted nothing that exists", and collapsing them would have sent
        // a seat that mis-indexed off hunting a transcription error it never made. Both now resolve to
        // `fragment_unbound`.
        //
        // **TWO REMEDIES MAY ONLY COLLAPSE INTO ONE WHEN THE SURVIVING ACT IS ALWAYS POSSIBLE.** That is
        // the condition, and it is the only reason this is not a regression. "Copy characters out of the
        // passage you named" can always be done: the passage is named by an in-range integer, and the
        // integer always exists. The old pair could not promise that — which is precisely why it needed
        // two messages, and why neither of them helped.
        //
        // So the distinction was a consequence of the defect, not a requirement of the design. Anything
        // that re-introduces a route where the remedy CANNOT be performed has to split them again.
        const n = b.segments;
        if (b.state === "no_segments") {
          no("segment_invalid", `row ${row_index}'s ruled receipt carries no readable snippet text to point into — this is a driver fault, not yours; do not re-send this row`);
        } else if (b.state === "segment_missing") {
          no("segment_absent", `row ${row_index} needs \`segment_index\`: the NUMBER of the numbered passage you relied on in the snippet of the receipt you ruled on (1 to ${n})`);
        } else if (b.state === "segment_invalid") {
          no("segment_invalid", `\`segment_index\` ${str(raw?.segment_index) || "(none)"} is not a passage in row ${row_index}'s ruled receipt — it is numbered 1 to ${n}`);
        } else if (b.state === "segment_dead_end") {
          // — SPLIT BECAUSE THE SURVIVING ACT WAS NOT POSSIBLE, which is the condition the block
          // above sets for collapsing two remedies into one. A passage that cannot reach FRAGMENT_MIN
          // reported `fragment_too_short`, whose remedy is "copy a few more characters out of it" — an
          // act the seat cannot perform on a passage of "...". Five of the twelve passages on the receipt
          // that killed a run were exactly that, and nothing warned the seat off them.
          const live = livePassages(ruled?.snippet);
          no("segment_dead_end", live.length
            ? `passage ${str(raw?.segment_index)} of row ${row_index}'s receipt is an ELISION MARKER or stub — nothing can be copied out of it that is long enough to count, so no fragment will ever bind there. Point at one of the passages that carry text instead: ${live.join(", ")}.`
            : `row ${row_index}'s receipt has NO passage long enough to quote from — every one is an elision marker or stub, so this row cannot be evidenced at all. Do not keep re-pointing: rule it and send \`obstacle\` saying the snippet carries nothing quotable.`);
        } else {
          // — NO FRAGMENT BRANCH REMAINS, because `segmentBinding` no longer refuses on one. The
          // pointer binds; a fragment that arrives is weighed, recorded as `fragmentState`, and never
          // charged for. This arm is the honest catch-all: a state this file does not know how to
          // remedy must say so rather than fall through to a fragment message that no longer applies.
          no("segment_invalid", `row ${row_index} could not be bound to a passage of the receipt you ruled on (${b.state}) — re-point at one of its numbered passages`);
        }
        continue;
      }
      quote = b.quote;             // the DRIVER's extract, out of the RAW snippet — never the seat's bytes
      // — EVIDENCE, NOT A VERDICT. The row is accepted either way; this records whether a fragment
      // arrived and whether it matched, so the transcription-quality signal that settled this issue keeps
      // being measurable after the duty that produced it is gone. Without it the change would delete its
      // own evidence base: the next reader asking "was dropping the fragment safe" would have 85% of an
      // archived ledger and nothing current to compare it against.
      fragmentState = b.fragmentState ?? null;
    }

    accepted.push({
      row_id,
      ruling: str(raw.ruling).toLowerCase(),
      note: str(raw.note),
      receipt_id: bound.id,        // the DRIVER's, off the canonical candidate — never the seat's bytes
      quote,                       // the DRIVER's extract; `anchor` is deliberately NOT carried (see above)
      // Null on a row that owed no proof, so a counter over these can tell "not asked" from "asked and
      // sent nothing" — differ by VALUE, never by field presence.
      fragment_state: fragmentState,
    });
  }
  return { accepted, refused, overflow };
}

/**
 * What the tool says back, inside the turn. The outstanding set is the point: a seat that can see what
 * is left does not have to guess whether it is finished, and "I thought I was done" is the state that
 * produced every `form_untouched` in the record.
 *
 * ── THE ANSWER CARRIES ANCHOR-OWED PER ROW, AND THAT IS NOT COSMETIC ────────────────────────────────
 *
 * Under the old transport the seat learned which rows needed a quote by READING the form — `quote_required`
 * is a field on the row. B removes the form from the seat's world entirely, and the obligations block
 * never names `quote_required`. So this answer is the only place a seat can learn it. A bare list of row
 * ids would judge a seat on a requirement nobody ever showed it, which is this tranche's whole disease
 * wearing new clothes.
 *
 * It also NAMES ROWS THAT GREW AN OBLIGATION. `quote_required` is not stable across a turn — a mid-turn
 * top-up grows the ledger and can put an anchor obligation on a row already accepted without one. Those
 * rows come back here, marked, while the seat still holds the page. Freezing the obligation set at the
 * turn's first call would have hidden exactly this, papering over a missing message with a weaker gate.
 *
 * ── — THE ANSWER NAMES ROWS THE WAY THE PAGE NUMBERS THEM ────────────────────────────────────
 *
 * It used to list outstanding rows as bare `Q-…` / `X-…` tokens. Those appear in NOTHING the seat has
 * ever read: not in the obligations block, not in the sidecar, not in the skill. So the one message
 * whose whole purpose is "here is what is left" was written in a vocabulary its reader does not have,
 * and a seat that wanted to finish could not tell which of its queries the tokens referred to. That is
 * the same defect as the address itself, arriving on the return leg.
 *
 * Rows are named by their NUMBER now, and the number is the one the block printed beside them.
 *
 * Accepts `[{row_index, evidence_owed, ruled}]`. A bare string or a row missing its number degrades to
 * whatever it can say rather than printing `undefined`, because a pure-core caller that has nothing to
 * say about evidence must keep working.
 * PURE.
 */
/**
 * CAN THIS ROW'S EVIDENCE DEMAND EVER BE SATISFIED?
 *
 * — the agreement guard for the `evidence_owed` seam, and it is 's shape one module over. The
 * demand (`quote_required`) is SET at form-build against candidates that carried text; the satisfaction is
 * enforced by `segmentBinding` against the candidate's snippet AS IT IS NOW. Between the two, candidates
 * regenerate. When they come back without quotable passages the flag survives and its justification does
 * not, and nothing asserted the two still agreed.
 *
 * THE CALL PATH ALREADY KNEW. Send such a row and it is refused with `no_segments` ("a driver fault, not
 * yours; do not re-send this row") or `segment_dead_end` ("this row cannot be evidenced at all — rule it
 * and send `obstacle`"). The OUTSTANDING path did not: it reported `evidence_owed` unconditionally, so the
 * answer kept printing "needs `segment_index` and `fragment`" for a row on which neither can ever bind.
 * Two ends of one contract, one of them able to say the work is impossible and the other still demanding
 * it — which is a live-lock the seat cannot reason its way out of, and the / comments above are
 * what it costs when it happens.
 *
 * Two cases, because "satisfiable" means different things before and after a ruling:
 *
 *   RULED      the receipt is chosen, so only THAT snippet can be pointed into.
 *   NOT RULED  no receipt is chosen yet, so the row is satisfiable if ANY candidate carries a live
 *              passage — a demand is only impossible when no choice the seat could make would work.
 *
 * `livePassages` is the measure, never `snippetSegments`: a snippet of elision markers has passages and
 * none of them can carry a binding fragment. PURE; never throws.
 */
export function evidenceSatisfiable(canonicalRow, formRow) {
  const cands = Array.isArray(canonicalRow?.candidates) ? canonicalRow.candidates : [];
  const rid = String(formRow?.receipt_id ?? "").trim();
  const chosen = rid ? cands.find((x) => String(x?.receipt_id ?? "").trim() === rid) : null;
  const pool = chosen ? [chosen] : cands;
  return pool.some((c) => livePassages(c?.snippet).length > 0);
}

export function callAnswer({ accepted, refused, overflow }, outstanding) {
  const lines = [`Recorded ${accepted.length} row${accepted.length === 1 ? "" : "s"}.`];
  if (refused.length) {
    lines.push(`${refused.length} refused — each one names what to change, and the rest of this call was KEPT:`);
    for (const r of refused) lines.push(`  ${r.row_index ? `row ${r.row_index}` : "(no row_index)"} — ${r.detail}`);
  }
  if (overflow.length) lines.push(`${overflow.length} row${overflow.length === 1 ? "" : "s"} beyond the ${MAX_ROWS_PER_CALL}-row limit were not read; send them in the next call.`);
  const left = (Array.isArray(outstanding) ? outstanding : [])
    .map((r) => (typeof r === "string" ? { row_id: r } : r ?? {}));
  const name = (r) => (r.row_index ? `row ${r.row_index}` : str(r.row_id) || "(unnamed row)");
  if (!left.length) {
    lines.push("Nothing is outstanding. Every obligation carries a ruling.");
    return lines.join("\n");
  }
  lines.push(`${left.length} obligation${left.length === 1 ? "" : "s"} still outstanding:`);
  for (const r of left) {
    // `ruled` distinguishes "you have not answered this row" from "you answered it and it now owes an
    // anchor too" — different work, and a seat told only "outstanding" would re-rule a row it had
    // already judged.
    // — the answer names BOTH fields, because they are two acts and a seat told "evidence" will
    // supply one of them. The passage NUMBER and a few characters copied out of that passage.
    // — AN IMPOSSIBLE DEMAND IS NAMED AS ONE. Repeating "supply a fragment" for a row whose
    // candidates carry no quotable passage is the live-lock: the seat cannot perform the act, and the only
    // thing this answer told it was to try again. The remedy here is the one the refusal path already
    // gives on the same condition, so the two ends of the contract now say the same thing.
    const owed = !r.evidence_owed ? ""
      : r.evidence_unsatisfiable === true
        ? " — this row CANNOT be evidenced: no passage on its candidates is long enough to quote from, so no `fragment` will ever bind. Do not keep re-sending it. Rule it and send `obstacle` saying the snippet carries nothing quotable."
        : (r.ruled ? " — RULED, but this row now also needs `segment_index` (the number of the passage you relied on, from the ruled receipt's numbered passages) and `fragment` (a few characters copied exactly out of that passage)"
                   : " — needs `segment_index` (the number of the passage you rely on, from the ruled receipt's numbered passages) and `fragment` (a few characters copied exactly out of that passage)");
    lines.push(`  ${name(r)}${owed}`);
  }
  return lines.join("\n");
}
