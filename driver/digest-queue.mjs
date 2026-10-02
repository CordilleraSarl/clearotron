// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// digest-queue.mjs — (t1cd): the durable work queue that settles re-judgement of step 3.
//
// THE DEFECT CLASS (live run, 2026-07-22). One run's register-digest stage ran 13 times across 3
// sessions (~2h, ~33M tokens in that stage alone). Seven passes were each INDIVIDUALLY legitimate:
// escalation, envelope, screen-gate re-decide, frame-reopen, pre-delivery corrections — half a dozen
// mechanisms each independently allowed to trigger an opus pass, with per-mechanism "max one" bounds
// that RESET on every resume. And every pass invalidates the whole back half (skeptic/synthesis/cards)
// under the stage-freshness staleness contract, so the cascade multiplies.
//
// THE DESIGN (owner-approved): the queue is the ONLY path to a non-fresh re-judgement. Mechanisms keep
// their own cheap unit-level work (warm unit followups, driver code-fetches) but do not re-run step 3
// themselves — they MINT durable queue items instead, and step 3 is judged again at defined settlement
// points: ONCE before synthesis, plus at most one bounded late flush for post-synthesis triggers.
// Receipts survive resume: an item's receiptKey is minted at most once for the life of the run (a
// re-mint of a flushed OR pending key is a no-op), so per-mechanism bounds no longer reset on resume.
// Since step 3 judges by owner, a flush composes the judges' message again from the pile as it then
// stands, so an item carries no text of its own: what a mechanism moved reaches the judges as the pile.
//
// PURE (repo doctrine: decision logic tests offline). No fs, no clock — timestamps are injected by
// the caller (the pipeline stamps `new Date().toISOString()`, the receipt idiom everywhere else);
// the pipeline owns the `_driver/digest-queue.json` sidecar via atomicWrite on every mint/flush.
//
// Item shape: { id, trigger, receiptKey, mintedAt, flushedAt|null }. Receipt keys are
// `<trigger>:<hash of the firing set>` — escalation:<axis-set-hash>, envelope:<deferred-row-set-hash> —
// so the SAME firing set re-encountered on a resume no-ops, while a genuinely NEW set (a different
// axis, a new deferred row) mints a fresh item and rides the next settlement flush.

import { createHash } from "node:crypto";

/** A fresh, empty queue document (the sidecar's on-disk shape). PURE. */
export function emptyQueue() {
  return { schema_version: 1, items: [] };
}

/**
 * Coerce a loaded sidecar document into a valid queue — a missing/torn/legacy document degrades to
 * an empty queue (never a throw: the funnel must never be worse than the legacy path it replaces).
 * PURE.
 */
export function coerceQueue(doc) {
  const items = Array.isArray(doc?.items)
    ? doc.items.filter((i) => i && typeof i.receiptKey === "string" && i.receiptKey)
    : [];
  return { schema_version: 1, items };
}

/**
 * Deterministic hash of a SET of strings — order-insensitive, duplicate-insensitive, stable across
 * processes (sha256 of the sorted unique members, 12 hex chars — the sha12 receipt idiom). PURE.
 */
export function hashSet(parts) {
  const canon = [...new Set((parts ?? []).map((p) => String(p)))].sort().join("\n");
  return createHash("sha256").update(canon).digest("hex").slice(0, 12);
}

/** `<trigger>:<set-hash>` — the durable idempotency key a mechanism mints under. PURE. */
export function receiptKeyFor(trigger, parts) {
  return `${trigger}:${hashSet(parts)}`;
}

/**
 * Mint a queue item. IDEMPOTENT by receiptKey: a re-mint of a PENDING key (same firing set, not yet
 * flushed — e.g. a crash-resume re-entering the mechanism before the settlement point) or a FLUSHED key
 * (the work already landed in a re-judgement — the resume-reset defect) is a no-op.
 * Returns { queue, minted, item } without mutating the input. PURE.
 */
export function mintItem(queue, { trigger, receiptKey, mintedAt }) {
  const q = coerceQueue(queue);
  const existing = q.items.find((i) => i.receiptKey === receiptKey);
  if (existing) return { queue: q, minted: false, item: existing };
  const item = {
    id: `dq${q.items.length + 1}`,   // items are append-only (flushed items are kept as receipts), so this is unique
    trigger: String(trigger),
    receiptKey,
    mintedAt: mintedAt ?? null,
    flushedAt: null,
  };
  return { queue: { ...q, items: [...q.items, item] }, minted: true, item };
}

/** The items awaiting a settlement flush (minted, not yet landed in a re-judgement). PURE. */
export function pendingItems(queue) {
  return coerceQueue(queue).items.filter((i) => i.flushedAt == null);
}

/**
 * Mark items flushed (the re-judgement they were queued for succeeded). A flushed item is a permanent
 * receipt: it can never re-fire, on this pass or any resume. PURE.
 */
export function markFlushed(queue, ids, flushedAt) {
  const q = coerceQueue(queue);
  const idSet = new Set(ids ?? []);
  return {
    ...q,
    items: q.items.map((i) => (idSet.has(i.id) && i.flushedAt == null ? { ...i, flushedAt: flushedAt ?? null } : i)),
  };
}

// ── THE FUNNEL'S DECLARED EXEMPTIONS ───────────────────────────────────────────────────────────────
//
// The header above says the queue is the ONLY path to a non-fresh re-judgement. Two sites force step 3
// to run again outside it, each for a reason, and an arm censuses every forced site against this list
// in both directions: an undeclared site fails, and a declared site that no longer exists fails too.
export const DIGEST_OWN_PASS_EXEMPTIONS = Object.freeze([
  Object.freeze({
    fn: "checkLateBind",
    reason: "customer late-bind re-classification — driven by an external answer arriving mid-run, not by "
      + "a findings-level trigger; the requester has already been acked that the bind landed, so it cannot "
      + "wait for a settlement flush",
  }),
  Object.freeze({
    fn: "runExperimentArm",
    reason: "the --experiment rig re-runs step 3 inside its own sandbox directory and never on the run, so "
      + "there is no queue for it to settle",
  }),
]);
