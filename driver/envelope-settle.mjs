// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// envelope-settle.mjs — decide what happens to a deferred slice AT THE RECEIPT, not two expensive stages later.
//
// THE ORDERING DEFECT, measured on the E2E R2 evidence run (2026-07-30):
//
//   11:47:26  the fan-in writes plan-execution.json: 3 dictated qids DEFERRED, each carrying the executor's
//             own mechanical reason ("capability-gap: the term is not in Latin script and the active
//             register provider indexes non-Latin filings by TRANSLITERATION, not by their characters").
//   11:47:26  placement-inquiry starts — ONE SECOND later, on inputs the run has just recorded as unfinished.
//     +626s   placement completes.
//     +810s   register-digest fails its validator on coverage_clean_deferred — a condition that was fully
//             recorded in plan-execution.json before the stage began. The failure was not bad luck; it was
//             guaranteed at dispatch.
//     +697s   the digest retry.
//     +335s   the skeptic escalates the very axes the provider cannot search.
//   12:31:22  the envelope finally decides — and decides close:true, "no deadline given, time permits",
//             because its closeability test read the clock and never the deferral's own reason. Time cannot
//             close a capability gap.
//     +189s   the close does what it can, and buys nothing.
//
// 1,436 seconds of opus-class work ran after the run had recorded that its inputs were unfinished, and the
// correction, when it finally came, took 189. fixed the DECISION (a capability-gap deferral is never
// closeable by time); this module fixes its TIME.
//
// WHAT THIS IS NOT. It does not compute the coverage ledger early, and it must never look like it does.
// The ledger's `coverage-limited` is a SUFFICIENCY JUDGMENT that placement-inquiry makes and the digest
// carries; its rows are per (axis / scope) with jurisdictions and classes that no machine receipt holds;
// and plan-execution is blind by construction to a narrowed-jurisdiction gap. All of that stays where it is.
// This module decides one mechanical question — "for each qid the executor refused, is there anything left
// to try?" — and records the answer so the expensive stages start on settled inputs.
//
// ZERO MODEL TURNS. The only close mechanism here is the code executor (seconds); the model-warm economics
// that envelopeDecision prices belong to the late, ledger-level arm, which is untouched and still runs.
// Deliberately, therefore, nothing here reads job.deadline — and no string it produces mentions time.

import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { isCapabilityGapReason } from "./coverage-ledger.mjs";
import { fullyDeferredAxes } from "./register-plan.mjs";

export const SETTLE_SCHEMA_VERSION = 1;

/**
 * Split a receipt's `deferred[]` into what is DECIDED by its own reason and what is worth one attempt.
 *
 * accepted — the executor refused deterministically: a predicate it lacks, an office outside its
 *   vocabulary, a term its query language cannot state. Re-running produces the identical refusal, so the
 *   only honest outcome is disclosure. "Accepted" removes the RETRY, never the disclosure: the digest still
 *   authors the deferred ledger row, computeOpenFloors still lists it, the verdict clamp still stands.
 * suspect — anything else. In practice this is nearly empty by construction, and that is worth stating
 *   plainly: joinPlanToBands routes deterministic refusals (`error && deferred`) to `deferred[]` and
 *   transient errors to `missing[]`, and the fan-in ladder already closes-or-kills `missing` before the
 *   receipt is final. So `suspect` catches a MIS-STAMPED deferral — an executor bug flagging a transient as
 *   deterministic — and exists so that shape gets one attempt instead of silently becoming permanent.
 *
 * STICKY — a qid this run has already accepted as a capability gap, under any plan version, is accepted
 * again whatever its current reason text says (stickyGaps below). PURE.
 */
export function partitionReceiptDeferrals(plan, receipt, { sticky = new Set() } = {}) {
  const axisOf = new Map((plan?.entries ?? []).map((e) => [String(e?.qid ?? ""), String(e?.axis ?? "").toLowerCase()]));
  // An axis the frozen plan says is deferred end to end is accepted whatever its per-qid reason text says:
  // there is no slice of it left for a dispatch to reach.
  //
  // THE PLAN SAYS SO, NOT THE COVERAGE SKELETON. This read the skeleton's `deferred` state, which
  // deriveCoverageSkeleton sets for an axis carrying ANY deferred qid and nothing missing, and at the
  // fan-in nothing is missing. So every deferral on every axis was accepted: a provider hard error was
  // logged "ACCEPTED as provider capability gaps … never retried", skipped the one bounded attempt the
  // hard-error path is designed to get, and was then re-opened by the envelope, which reads the reason.
  // fullyDeferredAxes asks the plan: every entry on the axis `unsupported`.
  const fullyDeferred = new Set(fullyDeferredAxes(plan).map((a) => String(a.axis ?? "").toLowerCase()));
  const accepted = [], suspect = [];
  for (const d of receipt?.deferred ?? []) {
    const qid = String(d?.qid ?? "");
    const axis = axisOf.get(qid) ?? "";
    const reason = String(d?.reason ?? "");
    const row = { qid, axis, reason };
    (isCapabilityGapReason(reason) || fullyDeferred.has(axis) || sticky.has(qid) ? accepted : suspect).push(row);
  }
  return { accepted, suspect };
}

export function readEnvelopeDecision(P) {
  try {
    const p = P?.envelopeDecision;
    return p && existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
  } catch { return null; }   // unreadable ⇒ treated as absent ⇒ re-settled ⇒ overwritten
}

export function writeEnvelopeDecision(P, doc) {
  writeFileSync(`${P.envelopeDecision}.tmp`, JSON.stringify(doc, null, 2) + "\n");
  renameSync(`${P.envelopeDecision}.tmp`, P.envelopeDecision);
  return doc;
}

/**
 * Is every recorded deferral matched by a recorded decision?
 *
 * SETTLED IS NOT "NO DEFERRALS". A capability gap is permanent — a run carrying eight of them is settled
 * the moment each one is recorded as accepted. What must never happen is a stage starting while an
 * unresolved item is still about to change its inputs.
 *
 * `close_failed` COUNTS AS DECIDED. It is a recorded ending — tried once, could not close, stays disclosed —
 * and the late ledger-level arm may still act on it. The alternative (unsettled until closed) would hold
 * placement and the digest forever behind a dispatch that can never succeed, which is a worse failure than
 * the one this module exists to prevent.
 *
 * A run with no frozen plan, or an archived run predating this file, is VACUOUSLY settled: no artifact ⇒
 * exactly today's behaviour, so replays of the archive cannot flip.
 */
export function receiptSettled(P, receipt) {
  if (!receipt) return { settled: true, unsettled: [], cause: "no-receipt" };
  const deferred = receipt.deferred ?? [];
  if (!deferred.length) return { settled: true, unsettled: [], cause: "no-deferrals" };
  const doc = readEnvelopeDecision(P);
  if (!doc) return { settled: false, unsettled: deferred.map(shallowRow), cause: "no-decision" };
  // Normalise both sides: an archived or partial receipt may carry no plan_version at all, and an absent
  // version must compare equal to the absence the decision recorded — not read as a version that moved.
  if ((doc.plan_version ?? null) !== (receipt.plan_version ?? null))
    return { settled: false, unsettled: deferred.map(shallowRow), cause: "plan-version-moved" };
  const decided = new Set([...(doc.accepted ?? []), ...(doc.closed ?? []), ...(doc.close_failed ?? [])].map((r) => String(r?.qid ?? "")));
  const open = deferred.filter((d) => !decided.has(String(d?.qid ?? "")));
  return open.length
    ? { settled: false, unsettled: open.map(shallowRow), cause: "undecided-qids" }
    : { settled: true, unsettled: [], cause: "decided" };
}

const shallowRow = (d) => ({ qid: String(d?.qid ?? ""), reason: String(d?.reason ?? "").slice(0, 160) });

/**
 * The decision document. Every array is written unconditionally, empty or not (the AD-4 instrumentation
 * house rule): a reader must be able to tell "nothing was deferred" from "nobody looked".
 *
 * `history` carries the SUPERSEDED decisions. A re-settle (a resume reusing the receipt, a plan_version
 * bump after a supplemental fold, a guard finding an undecided receipt) overwrites the live fields, and
 * without this the record of what was decided the first time would be destroyed by the second — which is
 * the one case the file exists to make durable. `supersede()` builds the entry; it is deliberately a
 * summary rather than a full copy, because the qid-level truth is always re-derivable from the receipt.
 */
export function buildDecisionDoc({ planVersion, deferredTotal, accepted, closed, closeFailed, decidedAt, history = [], stickyGaps = [], settleTried = [] }) {
  return {
    schema_version: SETTLE_SCHEMA_VERSION,
    plan_version: planVersion ?? null,
    decided_at: decidedAt ?? null,
    deferred_total: deferredTotal ?? 0,
    accepted: accepted ?? [],
    closed: closed ?? [],
    close_failed: closeFailed ?? [],
    sticky_gaps: stickyGaps ?? [],
    settle_tried: settleTried ?? [],
    history: history ?? [],
  };
}

// ── A CAPABILITY GAP IS DECIDED ONCE PER RUN, NOT ONCE PER PLAN VERSION ────────────────────────────────
//
// The live `accepted[]` is rebuilt from the current receipt on every settle, and a settle happens again
// whenever the plan version moves — every supplemental fold bumps it. So an acceptance lasted exactly as
// long as the version it was made under. On a production run on 2026-09-22 one slice the provider refused
// was accepted ("never retried"), re-opened, re-proposed, re-executed and accepted again, several times
// in one run, each pass paying the provider for an answer that could not change.
//
// `sticky_gaps` is the run's memory of them: every qid accepted with a reason that states a capability gap
// (isCapabilityGapReason), with the reason and the plan version it was first accepted under. It is carried
// forward on every settle and never dropped: not when the plan version moves, not when the receipt stops
// listing the qid. Only a REASON-MATCHED gap enters it. An axis-level acceptance (the skeleton branch in
// partitionReceiptDeferrals) and every suspect or close_failed row stay out, so a deferral a later attempt
// could close keeps today's behaviour.
export function stickyGapsAfter(prior, accepted, planVersion) {
  const out = new Map((prior?.sticky_gaps ?? []).map((g) => [String(g?.qid ?? ""), g]));
  for (const a of accepted ?? []) {
    const qid = String(a?.qid ?? "");
    if (!qid || out.has(qid) || !isCapabilityGapReason(a?.reason)) continue;
    out.set(qid, { qid, axis: String(a?.axis ?? ""), reason: String(a?.reason ?? "").slice(0, 400), since_plan_version: planVersion ?? null });
  }
  out.delete("");
  return [...out.values()];
}

// ── A SUSPECT DEFERRAL GETS ITS ONE ATTEMPT ONCE PER RUN ─────────────────────────────────────────────
//
// The settle step spends one executor attempt on a suspect deferral: a hard error the run could not
// classify as permanent, on the chance the provider has recovered. Every supplemental fold bumps the plan
// version and re-settles, and the repair ledger's budget is keyed on the plan version, so "one attempt"
// was one per plan version. `settle_tried` records each qid the settle step has sent, carried forward like
// `sticky_gaps`; a suspect already in it is recorded close_failed without another call.
export function settleTriedAfter(prior, dispatched, planVersion) {
  const out = new Map((prior?.settle_tried ?? []).map((t) => [String(t?.qid ?? ""), t]));
  for (const d of dispatched ?? []) {
    const qid = String(d?.qid ?? "");
    if (!qid || out.has(qid)) continue;
    out.set(qid, { qid, axis: String(d?.axis ?? ""), plan_version: planVersion ?? null, outcome: String(d?.outcome ?? "").slice(0, 160) });
  }
  out.delete("");
  return [...out.values()];
}

/** The run's sticky capability gaps, by qid → row. Absent or unreadable decision ⇒ none. */
export function readStickyGaps(P) {
  return new Map((readEnvelopeDecision(P)?.sticky_gaps ?? []).map((g) => [String(g?.qid ?? ""), g]).filter(([q]) => q));
}

/** One history entry per superseded decision. Returns the prior history with the old decision appended. */
export function supersede(prior, source) {
  if (!prior) return [];
  const entry = {
    source: source ?? null,
    decided_at: prior.decided_at ?? null,
    plan_version: prior.plan_version ?? null,
    accepted: (prior.accepted ?? []).length,
    closed: (prior.closed ?? []).length,
    close_failed: (prior.close_failed ?? []).length,
  };
  return [...(prior.history ?? []), entry];
}

/**
 * Decide a receipt's deferrals and write the decision. The ONLY moving part is `dispatch`: given one, a
 * suspect deferral gets a single budgeted executor attempt; without one, it is recorded as ended rather
 * than left open (an item nothing can decide would otherwise hold every downstream stage forever).
 *
 * Extracted from the fan-in closure so the settled-inputs guard can reach it too. The guard runs at seams
 * where the executor lane may not be in scope, and a guard that could only log would promise a self-heal
 * it cannot perform — which is exactly the shape of defect this module exists to remove.
 */
export async function settleReceipt({ P, plan, receipt, dispatch = null, rejoin = null, now = null }) {
  const deferred = receipt?.deferred ?? [];
  const prior = readEnvelopeDecision(P);
  const sticky = new Set((prior?.sticky_gaps ?? []).map((g) => String(g?.qid ?? "")));
  let { accepted, suspect } = partitionReceiptDeferrals(plan, receipt, { sticky });
  const closed = [], closeFailed = [];
  const tried = new Map((prior?.settle_tried ?? []).map((t) => [String(t?.qid ?? ""), t]));
  for (const s of suspect.filter((x) => tried.has(x.qid)))
    closeFailed.push({ qid: s.qid, axis: s.axis, outcome: `already tried once this run (${String(tried.get(s.qid)?.outcome ?? "").slice(0, 100)}) — not sent again` });
  suspect = suspect.filter((x) => !tried.has(x.qid));
  const dispatched = [];
  if (suspect.length && dispatch && rejoin) {
    const byAxis = new Map();
    for (const s of suspect) { if (!byAxis.has(s.axis)) byAxis.set(s.axis, []); byAxis.get(s.axis).push(s.qid); }
    for (const [axis, qids] of byAxis) { if (axis) await dispatch(axis, qids); }
    const after = await rejoin();
    const stillDeferred = new Map((after?.deferred ?? []).map((d) => [String(d.qid), String(d.reason ?? "")]));
    const re = partitionReceiptDeferrals(plan, after, { sticky });
    accepted = re.accepted;
    for (const s of suspect) {
      // Only a qid that was actually sent (dispatch skips one with no axis) counts as tried.
      if (!stillDeferred.has(s.qid)) { closed.push({ qid: s.qid, axis: s.axis, outcome: "ok" }); if (s.axis) dispatched.push({ ...s, outcome: "ok" }); }
      else if (!re.accepted.some((a) => a.qid === s.qid)) {
        const outcome = `still deferred: ${stillDeferred.get(s.qid).slice(0, 140)}`;
        closeFailed.push({ qid: s.qid, axis: s.axis, outcome });
        if (s.axis) dispatched.push({ ...s, outcome });
      }
    }
  } else if (suspect.length) {
    for (const s of suspect) closeFailed.push({ qid: s.qid, axis: s.axis, outcome: "no executor lane at this seam" });
  }
  return writeEnvelopeDecision(P, buildDecisionDoc({
    planVersion: receipt?.plan_version, deferredTotal: deferred.length,
    accepted: accepted.map((a) => ({ ...a, decision: "accepted-capability-gap" })),
    closed, closeFailed, decidedAt: now ?? new Date().toISOString(),
    history: supersede(prior, prior ? "re-settled" : null),
    stickyGaps: stickyGapsAfter(prior, accepted, receipt?.plan_version),
    settleTried: settleTriedAfter(prior, dispatched, receipt?.plan_version),
  }));
}

/**
 * The settled facts a digest dispatch needs, as a message section — mechanical only, quoting the executor's
 * own reason. Every digest pass gets this, not just the first: the dispatch hint reaches FRESH dispatches
 * by construction (stageOnce ignores `extra` when opts.followup is set), and the flush passes it misses are
 * exactly where the evidence run burned 2,908 seconds failing the same validator twice more.
 *
 * Returns null when there is nothing to say, so a caller can append it unconditionally.
 * Contains no clock, no deadline, no budget — a model told it is running short decides fewer things matter.
 */
export function settledDeferralsSection(doc) {
  const accepted = doc?.accepted ?? [];
  if (!accepted.length) return null;
  const byAxis = new Map();
  for (const r of accepted) {
    const ax = r.axis || "(unknown axis)";
    if (!byAxis.has(ax)) byAxis.set(ax, []);
    byAxis.get(ax).push(r);
  }
  const lines = [
    "SETTLED COVERAGE FACTS (from the run's own execution receipt — these are not open questions):",
    "The active register provider REFUSED these dictated slices. They were never searched, re-running them",
    "returns the identical refusal, and the driver has recorded that. Give each one an honest `deferred` row",
    "in your Coverage ledger, quoting the reason below; a `confirmed-clean` claim over any of them fails",
    "validation. The slices of these axes that genuinely enumerated stay confirmed-clean — disclosing a gap",
    "is not a reason to downgrade the work that did run.",
  ];
  for (const [axis, rows] of byAxis) {
    lines.push(`- axis ${axis}:`);
    for (const r of rows) lines.push(`    ${r.qid} ← ${String(r.reason).slice(0, 200)}`);
  }
  return lines.join("\n");
}
