// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// close-verify.mjs — Fix 2: the shared close-the-loop primitive (verify the close actually ran the
// intended search).
//
// The problem it fixes is SYSTEMIC. Most dispatched-close arms mark a gap "closed" on r.ok (a shape
// validator / agent-claim) + a byte-diff of the edited file — and ANY byte-change (an empty block, an
// error block, a WRONG-SCOPE 0/0) satisfies that. The observed failure (RUN1 noref000009-project-halcyon):
// a Cl.35/38 field remedy was dispatched as its English description searched in the matter's own classes
// (9/28/41/42) → an evidentially-empty 0/0 block → byte-changed the band → logged closed. The dominant-
// element gap read `domClosed:true` and the clamp was silently lifted.
//
// The fix is uniform: capture the gap the detector found BEFORE the close, re-run the SAME detector AFTER,
// and count a gap closed ONLY if THAT specific gap is gone — never merely that bytes changed. This module
// holds the pure primitive + the register-directive verifier; the arms supply their own detector output
// (joinPlanToBands / findCoverageLimitedCells) and their own stable key.
//
// PURE (no node imports) → tests offline exactly like the frame-diff decision helpers.

/**
 * Diff a before/after gap set by a STABLE key: `closed` = gaps present before and absent after (genuinely
 * closed); `stillOpen` = gaps still present (a false close if the caller trusted a byte-diff). keyOf must
 * be stable across the re-run of the detector. PURE.
 * @returns {{closed: any[], stillOpen: any[]}}
 */
export function verifyGapClosure(before, after, keyOf) {
  const afterKeys = new Set((after ?? []).map(keyOf));
  const closed = [], stillOpen = [];
  for (const g of (before ?? [])) (afterKeys.has(keyOf(g)) ? stillOpen : closed).push(g);
  return { closed, stillOpen };
}

/**
 * The class-pins the executor ACTUALLY searched, read back from a band block's describePlanEntry query
 * ("<predicate> <term> [cl 35,38]"). Empty when the block carries no parseable class tag — the caller then
 * relies on the qid-landed + non-collapse checks alone (an indeterminate block must never manufacture a
 * false DEFER — the class check only fires on POSITIVE evidence of a wrong scope). Numeric strings.
 */
export function blockSearchedClasses(block) {
  const m = String(block?.query ?? "").match(/\[cl\s*([\d,\s]*)\]/i);
  if (!m) return [];
  return [...new Set((m[1].match(/\d+/g) ?? []).map(String))];
}

/**
 * The searched-but-LOST shape: an `enumerated` block that CLAIMED hits (a finite total_hits > 0) and
 * carried ZERO records. The same collapse findCollapsedBands catches at fan-in, and the same one
 * verifyRegisterDirectiveClose refuses a close on (below) — exported so remedy-accounting.mjs can ask
 * the identical question of a per-TERM slice without a second copy of the rule. Two copies of a
 * matcher is how two matchers drift apart (placement-carry.mjs's rule).
 *
 * `Number.isFinite` first, deliberately: the executor writes total_hits NULL for a count it could not
 * take, and `Number(null)` is 0 — so a null total must never be read here as "claimed nothing". PURE.
 */
export function blockCollapsed(block) {
  const state = String(block?.state ?? "").toLowerCase();
  const total = Number(block?.total_hits);
  const recs = Array.isArray(block?.records) ? block.records.length : 0;
  return state === "enumerated" && Number.isFinite(total) && total > 0 && recs === 0;
}

/**
 * Verify a register frame-reopen directive was actually SEARCHED as intended (Part B, arm #1). A directive
 * is closed ONLY if EVERY minted qid clears three checks:
 *   1. qid-landed — the qid joined as an EXECUTED band block (joinPlanToBands). An error/missing/skipped
 *      slice never really ran, however much the band byte-changed;
 *   2. non-collapse — not an `enumerated` block that CLAIMED hits (total_hits>0) but carried ZERO records
 *      (searched-but-lost — the same shape findCollapsedBands catches at fan-in);
 *   3. class-scope — when the block records its class-pins, they COVER the intended classes (the RUN1
 *      wrong-scope 0/0). Indeterminate pins fall through to 1+2 — a strict tightening over byte-diff, never
 *      a new false deferral.
 * PURE. `executedQids` is a Set of joinPlanToBands.executed qids; `blocksByQid` maps qid → band block.
 * @returns {{closed: boolean, reason: string|null}}
 */
export function verifyRegisterDirectiveClose({ qids, intendedClasses = [], executedQids, blocksByQid } = {}) {
  const list = qids ?? [];
  if (!list.length) return { closed: false, reason: "no-slice-dispatched" };
  const want = [...new Set((intendedClasses ?? []).map(String))];
  const executed = executedQids ?? new Set();
  const byQid = blocksByQid ?? new Map();
  for (const qid of list) {
    if (!executed.has(qid)) return { closed: false, reason: `slice-not-landed:${qid}` };
    const b = byQid.get(qid);
    if (!b) return { closed: false, reason: `no-band-block:${qid}` };
    if (blockCollapsed(b)) return { closed: false, reason: `collapsed-slice:${qid}` };
    const searched = blockSearchedClasses(b);
    if (want.length && searched.length && !want.every((c) => searched.includes(c)))
      return { closed: false, reason: `wrong-scope:${qid} searched[${searched.join(",")}]⊉intended[${want.join(",")}]` };
  }
  return { closed: true, reason: null };
}
