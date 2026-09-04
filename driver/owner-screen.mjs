// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// owner-screen.mjs — the owner×element screen made READABLE (charter P2b; Round-2 §3).
//
// WHAT WENT WRONG. The screen is not missing and never was: the frozen plan's incumbent-class axis
// mints one owner×dominant-element slice per watchlist owner plus a bare-owner portfolio count, and
// on the 2026-07-29 evidence run all 39 of them dispatched. What was missing is any surface that
// says SO. The digest could only ask the band, the band's dedupe had dropped the incumbent qid off
// every record an earlier axis had also found (named-band.mjs, now fixed), the exact-qid lookup came
// back 0, and the run wrote "the owner-by-owner screen produced no records, so it cannot be relied
// on" — while its own audit claim, "no record anywhere in the band carries an incumbent-class qid",
// was false: four did. A printed negative about named competitors then shipped over a screen the run
// had disowned, and nobody could see which owners had actually been enumerated.
//
// THIS MODULE IS A PROJECTION, exactly like register-positions.json and recall-reconciliation.json:
// the frozen plan × the plan-execution receipt × the merged band, joined by qid, per owner. It
// decides nothing. The Coverage ledger stays the authority on coverage status; this says only what
// the machine can prove about each owner slice — did it run, what did it return, and if it did not
// run, the mechanical reason.
//
// THE STATE VOCABULARY IS THE POINT. `not-run` is a first-class answer and NEVER collapses into a
// zero: a provider with no owner surface at all — `predicates.owner: null` and
// `ownerTermIntersection: false`, so every owner slice compiles `unsupported` and rides the executor's
// deferred lane — must read as NOT RUN on every surface that mentions that owner. A screen that could
// not run is not a screen that found nothing.
//
// The example used to be signa, by name. probed `filters.owner_name` and the name came out, so
// NO shipped provider carries this shape today. The lane stays because the state it protects is not
// hypothetical — an owner slice also lands here when a run defers it for any other reason — and
// because a guard kept only while a current example exists is a guard rediscovered by an incident.
//
// PURE (no node imports) so it tests offline, like coverage-ledger.mjs / named-band.mjs.

import { recordQids } from "./named-band.mjs";

/** Owner-slice states. `enumerated` is the only one that can carry a negative. */
export const OWNER_SLICE_STATES = ["enumerated", "crowd", "not-run", "missing"];

const str = (v) => String(v ?? "").trim();
const norm = (s) => str(s).toLowerCase();

/** Is this plan entry an owner×element intersection slice (the screen itself)? PURE. */
export const isOwnerScreenEntry = (e) =>
  str(e?.owner) !== "" && norm(e?.predicate ?? "default") !== "owner";

/** Is this plan entry the bare-owner portfolio count that rides beside a screen slice? PURE. */
export const isOwnerCountEntry = (e) => norm(e?.predicate) === "owner";

/**
 * Derive the owner screen.
 *
 * @param {object[]} planEntries  the frozen plan's entries[] (every axis; owner slices are selected here)
 * @param {object[]} blocks       the band blocks the executor wrote for those axes (qid-stamped)
 * @param {object[]} bandRecords  the MERGED band's enumerated records (post stamp-union)
 * @param {object}   opts.deferredByQid  qid → mechanical reason, from plan-execution.json's deferred[]
 * @param {object}   opts.capabilities   the active provider's declared contract (id + ownerTermIntersection)
 * @returns {{provider, owner_surface, owners[], totals}}
 * PURE.
 */
export function deriveOwnerScreen(planEntries, blocks, bandRecords, {
  deferredByQid = null, capabilities = null, recordCap = 25,
} = {}) {
  const deferred = deferredByQid instanceof Map
    ? deferredByQid
    : new Map(Object.entries(deferredByQid ?? {}));
  const blockByQid = new Map();
  for (const b of blocks ?? []) if (b && str(b.qid)) blockByQid.set(str(b.qid), b);

  // the stamp union is what makes this join complete — a record surfaced by four slices counts under
  // all four (mergeNamedBands `_qids`).
  const recordsByQid = new Map();
  for (const r of bandRecords ?? []) {
    for (const q of recordQids(r)) {
      if (!recordsByQid.has(q)) recordsByQid.set(q, []);
      recordsByQid.get(q).push(r);
    }
  }

  const entries = (planEntries ?? []).filter(Boolean);
  const countByOwner = new Map();
  for (const e of entries) if (isOwnerCountEntry(e)) countByOwner.set(norm(e.term), e);

  const owners = [];
  for (const e of entries) {
    if (!isOwnerScreenEntry(e)) continue;
    const qid = str(e.qid);
    const block = blockByQid.get(qid) ?? null;
    const recs = recordsByQid.get(qid) ?? [];
    const state = sliceState(e, block);
    const countEntry = countByOwner.get(norm(e.owner)) ?? null;
    const countBlock = countEntry ? (blockByQid.get(str(countEntry.qid)) ?? null) : null;
    owners.push({
      owner: str(e.owner),
      qid,
      terms: Array.isArray(e.terms) ? e.terms.map(str) : (e.term != null ? [str(e.term)] : []),
      nice_classes: (e.nice_classes ?? []).map(str),
      state,
      total_hits: Number(block?.total_hits) || 0,
      records: recs.length,
      record_ids: recs.slice(0, recordCap).map((r) => str(r.record_id)).filter(Boolean),
      reason: sliceReason(e, block, deferred.get(qid) ?? null, capabilities),
      // the bare-owner portfolio count is CROWD CONTEXT beside the slice, never its coverage — the
      // executor's own descriptor says so, and the screen keeps them apart on the same row.
      portfolio: countEntry ? {
        qid: str(countEntry.qid),
        total_hits: Number(countBlock?.total_hits) || 0,
        counted: !!countBlock && countBlock.error !== true,
      } : null,
    });
  }

  const count = (s) => owners.filter((o) => o.state === s).length;
  return {
    provider: str(capabilities?.id) || null,
    // capability-declared, never inferred from a vendor name: false ⇒ the screen cannot run here.
    owner_surface: capabilities ? capabilities.ownerTermIntersection === true : null,
    owners,
    // unconditional counts (AD-4 instrumentation rule): every field written on every run, so "did not
    // happen" is never "not recorded".
    totals: {
      slices: owners.length,
      enumerated: count("enumerated"),
      crowd: count("crowd"),
      not_run: count("not-run"),
      missing: count("missing"),
      records_attributed: owners.reduce((n, o) => n + o.records, 0),
    },
  };
}

/** The mechanical state of one owner slice. PURE. */
function sliceState(entry, block) {
  // compile-time capability stamp (register-plan.mjs) — the slice was never built, let alone sent.
  if (entry?.unsupported === true) return "not-run";
  if (!block) return "missing";
  // the executor's deterministic deferral lane: error kept (never a sanctioned crowd) + deferred
  // added. Nothing a retry can change, so it is NOT RUN — never a zero.
  if (block.deferred === true) return "not-run";
  if (block.error === true) return "missing";
  return norm(block.state) === "enumerated" ? "enumerated" : "crowd";
}

/** Plain-English reason a slice is not an enumerated answer (null when it is). PURE. */
function sliceReason(entry, block, deferredReason, capabilities) {
  if (entry?.unsupported === true)
    return str(entry.unsupported_reason) || `the active register provider (${str(capabilities?.id) || "unknown"}) has no owner surface — this slice was never searched`;
  if (!block) return "no band block carries this qid — the slice is unaccounted for, never a clean";
  if (block.deferred === true) return str(deferredReason) || str(block.reason).slice(0, 300);
  if (block.error === true) return `provider error — the slice never really ran: ${str(block.reason).slice(0, 200)}`;
  if (norm(block.state) !== "enumerated") return str(block.reason).slice(0, 300);
  return null;
}

/**
 * The screen's own printed negative, code-built: exactly which owner slices enumerated, which
 * returned records, and which did NOT run. This is the sentence the report's owner paragraph has to
 * agree with — a negative may only be attributed to the slices named in `enumerated`.
 * PURE. Returns "" when the run has no owner screen at all (no incumbent lane).
 */
export function ownerScreenNegative(screen) {
  const owners = screen?.owners ?? [];
  if (!owners.length) return "";
  const name = (o) => `${o.owner} (${o.qid})`;
  const enumerated = owners.filter((o) => o.state === "enumerated");
  const zero = enumerated.filter((o) => o.records === 0);
  const hit = enumerated.filter((o) => o.records > 0);
  const notRun = owners.filter((o) => o.state === "not-run");
  const crowd = owners.filter((o) => o.state === "crowd");
  const missing = owners.filter((o) => o.state === "missing");
  const parts = [
    `Owner×element screen: ${owners.length} owner slice(s) planned; ${enumerated.length} enumerated to completion, ` +
    `${crowd.length} returned a count-only crowd descriptor, ${notRun.length} did NOT run, ${missing.length} unaccounted for.`,
  ];
  if (hit.length) parts.push(`Enumerated WITH records: ${hit.map((o) => `${name(o)} — ${o.records} record(s)`).join("; ")}.`);
  if (zero.length) parts.push(`Enumerated with zero records — a negative may be stated for these owners and ONLY these: ${zero.map(name).join("; ")}.`);
  if (crowd.length) parts.push(`Count-only (NOT a clean — the slice was never enumerated): ${crowd.map((o) => `${name(o)} — ${o.total_hits} hit(s)`).join("; ")}.`);
  if (notRun.length) parts.push(`NOT RUN — no negative may be stated for these owners; the gap is disclosed, never a clean: ${notRun.map((o) => `${name(o)}: ${o.reason ?? "capability absent"}`).join("; ")}.`);
  if (missing.length) parts.push(`Unaccounted for: ${missing.map(name).join("; ")}.`);
  return parts.join(" ");
}

/**
 * The owners a delivered surface may NOT state a negative about — everything the screen did not
 * enumerate. Used by the predelivery lint (the printed-negative net) and by the competitor-claim
 * check. PURE. Returns a Map owner(lowercased) → {state, reason, qid}.
 */
export function unscreenedOwners(screen) {
  const out = new Map();
  for (const o of screen?.owners ?? []) {
    if (o.state === "enumerated") continue;
    out.set(norm(o.owner), { state: o.state, reason: o.reason ?? null, qid: o.qid });
  }
  return out;
}

/** Every owner the screen knows about, lowercased → the row. PURE. */
export function screenedOwnerIndex(screen) {
  const out = new Map();
  for (const o of screen?.owners ?? []) out.set(norm(o.owner), o);
  return out;
}
