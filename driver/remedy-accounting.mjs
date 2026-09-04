// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// remedy-accounting.mjs — the frame-reopen remedy ledger, per TERM: every term a firing directive
// restated ends in a NAMED state, and a term that was searched and found nothing looks different from
// a term that was never searched.
//
// THE DEFECT. partitionFiring (frame-diff-model.mjs) already guarantees every firing DIRECTIVE ends
// recorded — swept or a deferral with a reason. The unit that actually reaches the wire is not the
// directive: it is the remedy TERM. One directive mints a proposal per term (× predicate), each term
// becomes its own qid, each qid its own band block. The receipt records `directive_qids` — the qid
// STRINGS and nothing else. Not the term, not the executed query, not what came back.
//
// So a directive reads "swept" while a term inside it never ran, or ran and returned nothing, and in
// both cases the receipt says the same thing: a qid existed. On the preserved 2026-07-31 R2 reopen
// (fixtures/remedy-accounting-2026-07-31) five register directives mint 17 slices across 11 terms;
// the receipt carries every qid and not one query or result, and `domClosed` reads true. Where those
// terms appear in the delivered findings at all, they appear because the DIGEST MODEL chose to write
// the matrix — driver/publish reads no execution receipt (it never opens plan-execution.json), so
// nothing derives that record and nothing checks it.
//
// ZERO SEMANTICS — the whole point. `searched-empty` (the query ran, the register answered a counted
// zero) and `not-dispatched` (no slice was ever minted) are the two states this module exists to keep
// apart. Collapsing them is the null-read-as-zero class that has now shipped seven times in this
// codebase. So they are separate classes, they are counted separately, and the not-accounted ones are
// NAMED — the shape provider-usage.mjs uses for `unclassified` and placement-carry.mjs uses one
// layer down, deliberately, because consistency between them is worth more than a better idea.
//
// WHAT THIS MODULE DOES NOT DO. It never changes what the remedy searches and it writes no
// report-facing prose ( puts both out of scope). It never re-decides a directive's closure —
// partitionFiring still owns that. It answers one mechanical question per term, records the answer,
// and lets `domClosed` be computed over it.
//
// SCOPE — the register layers only, and the boundary is NAMED rather than silent. A source-layer
// directive names a CHANNEL for the common-law lane (a store, a registry, a domain); it mints no
// register query and has no term unit, and its sweep is verified by a prose byte-diff that produces
// no per-query record to account. Those directives are listed in the artifact's `out_of_scope[]` with
// that reason and counted — visible, never dropped. Giving them a term class would either invent a
// term they do not have or manufacture an unaccounted row on every run that fires one.
//
// PURE (no node imports) like placement-carry.mjs / recall-reconciliation.mjs — the pipeline owns all
// IO, events and enforcement. The collapse predicate is IMPORTED from close-verify.mjs rather than
// re-stated: verifyRegisterDirectiveClose asks the identical question of the same blocks, and two
// copies of a matcher is how two matchers drift apart.

import { blockCollapsed } from "./close-verify.mjs";
import { reopenKey } from "./frame-diff-model.mjs";

export const REMEDY_ACCOUNTING_SCHEMA_VERSION = 1;

/**
 * The five term classes. EXACTLY ONE per remedy term, decided in the fixed order in classifyRemedyTerm.
 *
 *   found          — every slice landed and the register returned material (records, or a counted crowd
 *                    too large to enumerate). The term is answered.
 *   searched-empty — every slice landed and every one is a COUNTED zero: state `enumerated`, a finite
 *                    total_hits of 0, an empty records array. The executed query and its empty result
 *                    are both recorded on the row. This is the state that used to leave no trace.
 *   not-dispatched — no slice was ever minted for this term, with the reason the mint or the remedy
 *                    derivation gave. The term was NOT searched, and now says so.
 *   dispatch-failed— a slice was minted but did not land as a usable executed block: unlanded, error,
 *                    a deterministic capability-gap deferral, or the searched-but-lost collapse. What
 *                    the term would have returned is unknown, which is not the same as empty.
 *   unaccounted    — the join cannot decide. A slice landed in a shape that is neither material nor a
 *                    counted zero (an uncountable total, an unrecognised state), or the receipt offers
 *                    no mapping at all. NEVER guessed in either direction.
 */
export const REMEDY_TERM_CLASSES = ["found", "searched-empty", "not-dispatched", "dispatch-failed", "unaccounted"];

/**
 * The two classes that mean "this term's search is ON THE RECORD". Deliberately NOT every class with a
 * reason attached: `not-dispatched` and `dispatch-failed` are honestly recorded endings, but neither is
 * evidence that the term was searched, and the closure claim below rests on searchedness alone.
 */
export const ACCOUNTED_CLASSES = ["found", "searched-empty"];

const clip = (s, n = 240) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

const key = (c) => c.replace(/-/g, "_");

/** The per-slice record: what was asked, and what came back. Never a bare qid. PURE. */
function sliceRow(qid, block, executed) {
  const recs = Array.isArray(block?.records) ? block.records.length : null;
  return {
    qid: String(qid ?? ""),
    // the EXECUTED query as the executor described it ("exact KENZY [cl 5,44]"), not the plan entry —
    // this is the string a reader needs to see next to a zero.
    query: block ? clip(block.query, 200) : null,
    executed: executed === true,
    state: block ? String(block.state ?? "") : null,
    // three-valued on purpose (execute-plan.mjs's own rule): a number is a taken count, null is a count
    // that could NOT be taken. Number(null) is 0, so these must never be folded together.
    total_hits: Number.isFinite(Number(block?.total_hits)) && block?.total_hits !== null ? Number(block.total_hits) : null,
    records: recs,
    error: block?.error === true,
    deferred: block?.deferred === true,
    reason: block?.reason ? clip(block.reason, 200) : null,
  };
}

/** A slice that landed clean: executed, a block exists, not an error, not a capability-gap deferral,
 *  not the searched-but-lost collapse. Same three tests verifyRegisterDirectiveClose applies. PURE. */
function sliceLanded(block, executed) {
  return executed === true && !!block && block.error !== true && block.deferred !== true && !blockCollapsed(block);
}

/** A COUNTED zero — the only shape that may be read as "searched and found nothing". All three
 *  conditions are load-bearing: an `enumerated` state (the one state a negative may rest on), a
 *  total_hits that IS a number and is 0, and an records ARRAY that is empty. A block whose `records`
 *  is absent has not stated an empty result, and a null total is an uncountable one. PURE. */
function countedZero(block) {
  return String(block?.state ?? "").toLowerCase() === "enumerated"
    && Number.isFinite(Number(block?.total_hits)) && block?.total_hits !== null && Number(block.total_hits) === 0
    && Array.isArray(block?.records) && block.records.length === 0;
}

/** Material: any record carried, or a finite positive count (the crowd descriptor an enumerate ceiling
 *  refused — `state:"incomplete", total_hits:20432, records` absent). Too big to enumerate is the
 *  opposite of empty, and a `(records ?? []).length === 0` test would call it empty. PURE. */
function material(block) {
  const recs = Array.isArray(block?.records) ? block.records.length : 0;
  if (recs > 0) return true;
  const total = Number(block?.total_hits);
  return Number.isFinite(total) && block?.total_hits !== null && total > 0;
}

/**
 * Classify ONE remedy term. `row` is `{directive, layer, severity, term, predicate, qids[],
 * dispatch_reason}`; `blocksByQid` maps qid → band block; `executedQids` is a Set of
 * joinPlanToBands.executed qids.
 *
 * Fixed order, so the answer is a function of the inputs and nothing else:
 *   1. no qids ⇒ `not-dispatched`, carrying the reason the mint or deriveDirectiveRemedy recorded (or
 *      `unaccounted` when there is no reason either — a legacy receipt states neither, and inventing
 *      "not dispatched" from silence would be the same guess in a new place);
 *   2. ANY slice that did not land clean ⇒ `dispatch-failed`, naming the first such qid. Every slice
 *      must land, exactly as verifyRegisterDirectiveClose requires of a directive — one convention;
 *   3. all landed, ANY slice material ⇒ `found`;
 *   4. all landed, EVERY slice a counted zero ⇒ `searched-empty`;
 *   5. otherwise ⇒ `unaccounted`, with the shape that defeated the join stated.
 * PURE.
 */
export function classifyRemedyTerm(row, { blocksByQid = new Map(), executedQids = new Set() } = {}) {
  const qids = (Array.isArray(row?.qids) ? row.qids : []).filter(Boolean);
  const slices = qids.map((q) => sliceRow(q, blocksByQid.get(q), executedQids.has(q)));
  if (!qids.length) {
    const reason = String(row?.dispatch_reason ?? "").trim();
    return reason
      ? { class: "not-dispatched", basis: "no-slice-minted", reason: clip(reason, 300), slices }
      : { class: "unaccounted", basis: "no-mapping", reason: "the receipt records no slice and no reason for this term — the join cannot say whether it was searched", slices };
  }
  for (const q of qids) {
    const b = blocksByQid.get(q);
    if (sliceLanded(b, executedQids.has(q))) continue;
    const why = !executedQids.has(q) ? "slice-not-landed"
      : !b ? "no-band-block"
        : b.deferred === true ? "capability-gap-deferral"
          : b.error === true ? "provider-error"
            : "collapsed-slice";
    return { class: "dispatch-failed", basis: why, reason: `${why}:${q}${b?.reason ? ` — ${clip(b.reason, 200)}` : ""}`, slices };
  }
  const blocks = qids.map((q) => blocksByQid.get(q));
  if (blocks.some(material)) return { class: "found", basis: "band-block", reason: null, slices };
  if (blocks.every(countedZero)) return { class: "searched-empty", basis: "counted-zero", reason: null, slices };
  const odd = blocks.find((b) => !countedZero(b));
  return {
    class: "unaccounted", basis: "indeterminate-block",
    reason: `the slice landed in a shape that is neither material nor a counted zero (state "${String(odd?.state ?? "")}", total_hits ${odd?.total_hits === null ? "null — a count that could not be taken" : String(odd?.total_hits)}, records ${Array.isArray(odd?.records) ? odd.records.length : "absent"}) — an uncountable result is not an empty one`,
    slices,
  };
}

const emptyTotals = () => {
  const t = { terms: 0 };
  for (const c of REMEDY_TERM_CLASSES) t[key(c)] = 0;
  return t;
};

/**
 * THE LEDGER. `terms` is one row per (directive, term, predicate-set) the reopen derived; `blocksByQid`
 * and `executedQids` come from the same joinPlanToBands the per-directive verify already runs, so the
 * two answers cannot disagree about what executed.
 *
 * `out_of_scope` carries the directives that have no term unit (source-layer channels), with the reason
 * — counted and named, never silently absent.
 *
 * Deterministic; no timestamps (the caller stamps `ts`), no IO, no judgment. PURE.
 */
export function accountRemedyTerms({ terms = [], blocksByQid = new Map(), executedQids = new Set(), outOfScope = [] } = {}) {
  const totals = emptyTotals();
  const byDirective = {};
  const rows = [];
  for (const t of Array.isArray(terms) ? terms : []) {
    const c = classifyRemedyTerm(t, { blocksByQid, executedQids });
    const directive = String(t?.directive ?? "");
    totals.terms++;
    totals[key(c.class)]++;
    const bd = (byDirective[directive] ??= emptyTotals());
    bd.terms++;
    bd[key(c.class)]++;
    rows.push({
      directive, layer: String(t?.layer ?? ""), severity: String(t?.severity ?? ""),
      term: String(t?.term ?? ""), predicates: (Array.isArray(t?.predicates) ? t.predicates : []).map(String),
      qids: (Array.isArray(t?.qids) ? t.qids : []).filter(Boolean),
      class: c.class, basis: c.basis, reason: c.reason,
      slices: c.slices,
    });
  }
  return {
    schema_version: REMEDY_ACCOUNTING_SCHEMA_VERSION,
    computable: true,
    unit: "remedy-term",
    totals,
    by_directive: byDirective,
    // the two lists a reader is owed, kept APART on purpose (see the zero-semantics note in the header):
    // a term that ran and found nothing is EVIDENCE; a term that never ran is a hole.
    searched_empty: rows.filter((r) => r.class === "searched-empty"),
    not_accounted: rows.filter((r) => !ACCOUNTED_CLASSES.includes(r.class)),
    out_of_scope: (Array.isArray(outOfScope) ? outOfScope : []).map((o) => ({
      directive: String(o?.directive ?? ""), layer: String(o?.layer ?? ""),
      reason: clip(o?.reason ?? "source-channel directive — swept by a prose byte-diff on the common-law findings, so it has no term unit and no per-query record to account", 300),
    })),
    rows,
  };
}

/**
 * THE CLOSURE READ ('s second criterion). `domClosed` may be true only over the ACCOUNTED set: a
 * dominant-element directive must be verified-closed AND every remedy term that directive restated must
 * be `found` or `searched-empty`. One unaccounted term and the dominant-element gap is not closed —
 * because it demonstrably is not: something the remedy named either never ran or ran into a shape the
 * record cannot read.
 *
 * SCOPED TO THE DOMINANT-ELEMENT DIRECTIVES, and that bound is load-bearing in both directions:
 *   * applyDominantBackstop upgrades severity by ITEM TEXT and does not filter by layer, so a SOURCE
 *     directive can carry severity "dominant-element". It has no term unit at all, so gating on "every
 *     term everywhere" would clamp every run whose dominant-element directive happens to be a channel
 *     — a manufactured deferral out of a structural absence, which is the opposite of this fix.
 *   * a minor/material variant directive's unrun term is recorded and mints a doubt, but it is not the
 *     dominant-element crowd and must not clamp the verdict on its own.
 *
 * `accounting` may be null (the ledger did not build) — then this returns the caller's own prior answer
 * untouched, because a join that could not run is not evidence of a gap. PURE.
 *
 * @returns {{domClosed: boolean, blockedBy: {term, directive, class, reason}[]}}
 */
export function domClosedOverAccounted({ directives = [], swept = [], accounting = null, reopenKeyOf = reopenKey } = {}) {
  const sweptSet = new Set(swept ?? []);
  // reopenKey by default, never a hand-rolled `${layer}:${item}`: reopenKey NORMALIZES the item, so an
  // unnormalized fallback would silently miss every swept key and read as "no dominant directive
  // closed" — a wrong answer wearing the shape of a safe one.
  const domKeys = new Set((directives ?? [])
    .filter((d) => d?.severity === "dominant-element")
    .map((d) => reopenKeyOf(d)));
  const closedOnADominant = [...domKeys].some((k) => sweptSet.has(k));
  if (!closedOnADominant) return { domClosed: false, blockedBy: [] };
  if (!accounting || accounting.computable !== true) return { domClosed: true, blockedBy: [] };
  const blockedBy = (accounting.rows ?? [])
    .filter((r) => domKeys.has(r.directive) && !ACCOUNTED_CLASSES.includes(r.class))
    .map((r) => ({ term: r.term, directive: r.directive, class: r.class, reason: r.reason }));
  return { domClosed: blockedBy.length === 0, blockedBy };
}

// ── the run.jsonl row ─────────────────────────────────────────────────────────────────────────────
// AD-4 house rule: every field is written on EVERY row, so "no term went unaccounted"
// (unaccounted:0) and "the ledger could not run" (unaccounted:null) differ by VALUE, never by field
// presence.
export const REMEDY_ACCOUNTING_EVENT_FIELDS = ["terms", "found", "searched_empty", "not_dispatched",
  "dispatch_failed", "unaccounted"];

export function remedyAccountingEvent({ trigger = null, artifact = null, reason = null } = {}) {
  const computable = artifact?.computable === true;
  const vals = computable ? artifact.totals : {};
  const row = { event: "remedy-accounting", trigger, computable, reason };
  for (const k of REMEDY_ACCOUNTING_EVENT_FIELDS) row[k] = vals[k] ?? null;
  row.out_of_scope = computable ? (artifact.out_of_scope ?? []).length : null;
  return row;
}

// ── the mint ──────────────────────────────────────────────────────────────────────────────────────
/**
 * One doubt per term this ledger could not put on the record — the three not-accounted classes, minted
 * with distinct ids so the facts stay apart in the `# Doubt Ledger`:
 *   doubt:remedy-accounting:not-dispatched:N — the remedy named this term and no slice was ever minted
 *   doubt:remedy-accounting:dispatch-failed:N — a slice was minted and did not land; the answer is unknown
 *   doubt:remedy-accounting:unaccounted:N     — the join cannot say either way
 * A `searched-empty` term mints NOTHING: it is answered, and its query and empty result ride the
 * artifact and the receipt. Minting a doubt for it would turn a completed search into an open question.
 *
 * The frozen doubt-record shape, status "open"; stitchDoubts and the doubt-closure stage decide endings
 * exactly as for every other doubt family, and an OPEN one shipping is the system working. Never gates,
 * never re-runs a search. PURE.
 */
export function mintRemedyAccountingDoubts(artifact, { sourceName = "_driver/frame-reopen.json" } = {}) {
  const doubts = [];
  const byClass = { "not-dispatched": [], "dispatch-failed": [], unaccounted: [] };
  for (const r of artifact?.not_accounted ?? []) if (byClass[r.class]) byClass[r.class].push(r);
  const text = {
    "not-dispatched": (r) => `the frame reopen restated "${r.term}" as a remedy search term and no register slice was ever minted for it, so the term was not searched: ${r.reason ?? "no reason recorded"}`,
    "dispatch-failed": (r) => `the frame reopen dispatched "${r.term}" and the slice did not land as a usable result, so what this term would have returned is unknown — which is not the same as empty: ${r.reason ?? "no reason recorded"}`,
    unaccounted: (r) => `the frame reopen restated "${r.term}" and the execution record cannot show whether it was searched: ${r.reason ?? "no reason recorded"}`,
  };
  for (const cls of ["not-dispatched", "dispatch-failed", "unaccounted"]) {
    byClass[cls].forEach((r, i) => {
      doubts.push({
        id: `doubt:remedy-accounting:${cls}:${i + 1}`,
        birth: {
          place: "remedy-accounting",
          artifact: String(sourceName ?? ""),
          quote: clip(`${r.directive} → ${r.term}${r.qids?.length ? ` (${r.qids.join(", ")})` : ""}`),
        },
        subject: { mark: r.term, owner: "", uris: [], terms: [r.term].filter(Boolean), text: text[cls](r) },
        status: "open",
        ending: null,
      });
    });
  }
  return doubts;
}
