// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── Shared screening primitives — the pure, provider-agnostic half of the screen step ──────────────
//
// Lifted verbatim (semantics-for-semantics) from providers/corsearch/src/core.js. These are pure
// functions over a NORMALIZED screening row; the HTTP call that produces the rows stays in each
// provider core (it is vendor glue: Corsearch's brand-json POST, Clarivate's POST /text, Signa's
// search row itself). See _shared/enumerate.mjs `capabilities.screenSource` for that seam.

export const BATCH_SCREEN_CHUNK = 100; // corsearch brand-json page size; clarivate /text caps at exactly 100 too.

// Live/dead status map for brand-json's vocabulary (HAR-counted across 702 rows: Valid 337, Invalid 187,
// Pending 103, Expired 69, GracePeriod 4, Unknown 2). FAIL-OPEN: only Invalid/Expired are confidently dead;
// Valid/Pending/GracePeriod are LIVE (Pending = a live in-progress application; GracePeriod = the post-expiry
// renewal window — both real senior-rights risks that must NEVER be batch-dropped); anything else (Unknown or
// an unrecognized token) is AMBIGUOUS → the skill must fall through to record_fetch, never auto-drop on it.
// brand-json `Valid` ≡ trademark-details `Registered` (status-parity finding, §10).
export const STATUS_DEAD_DEFAULT = Object.freeze(["invalid", "expired"]);
export const STATUS_LIVE_DEFAULT = Object.freeze(["valid", "pending", "graceperiod"]);

/**
 * Build a classifier over a provider's own status vocabulary. The fail-open posture is fixed: an
 * unrecognized token is ALWAYS "ambiguous" (never auto-dropped), whatever the vocabulary.
 */
export function makeClassifyStatus({ live = STATUS_LIVE_DEFAULT, dead = STATUS_DEAD_DEFAULT } = {}) {
  const LIVE = new Set(live.map((s) => String(s).toLowerCase()));
  const DEAD = new Set(dead.map((s) => String(s).toLowerCase()));
  return function classifyStatus(raw) {
    const s = String(raw ?? "").trim().toLowerCase();
    if (LIVE.has(s)) return "live";
    if (DEAD.has(s)) return "dead";
    return "ambiguous"; // Unknown / unrecognized → never auto-drop; fall through to record_fetch
  };
}

export const classifyStatus = makeClassifyStatus();

// All-class detection (fail-open). An all-class registration (e.g. /mark/kr/4019950049726, classes 1..45) must
// NEVER be class-filtered out. Set-based check + a fail-open on any near-complete span (>=40 distinct classes)
// — never a brittle positional check.
export function isAllClass(classes) {
  if (!Array.isArray(classes)) return false;
  const set = new Set(classes.map(Number).filter((c) => Number.isFinite(c)));
  if (set.size >= 40) return true;
  return set.size === 45 && Math.min(...set) === 1 && Math.max(...set) === 45;
}

export function chunk(arr, n = BATCH_SCREEN_CHUNK) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// brand-json plumbing to strip (pure internal batch/source ids) — every screening-meaningful field is KEPT,
// and the `uri` identity is always preserved so the caller can join back to its candidate list.
export const BRAND_JSON_PLUMBING = Object.freeze(["batchId", "sourceId"]);

/**
 * Normalize a raw screening row: strip the provider's internal plumbing keys and stamp the two computed
 * annotations (live_status + all_class) so the skill never re-derives them — and never mis-derives the
 * floor cases. `plumbing` / `classify` are injectable for a non-brand-json vocabulary.
 */
export function normalizeBrandRow(row, { plumbing = BRAND_JSON_PLUMBING, classify = classifyStatus } = {}) {
  if (!row || typeof row !== "object") return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) { if (!plumbing.includes(k)) out[k] = v; }
  out.live_status = classify(row.status);
  out.all_class = isAllClass(row.classes);
  return out;
}

// Closed-set screening verdict — the deterministic control-flow signal the digest and the driver's
// audit validator key on, so a goods/field DROP of an in-scope live mark can NEVER rest on the batch
// row alone (the Finding-1 gate). `drop:*` = batch-screen-authoritative (the easy wins it was built
// for). `surface:*` = a real in-scope candidate, NOT goods/field-droppable here — a drop requires a
// record fetch that reads the actual G&S (the batch row has none). `deepfetch:ambiguous` = status
// unknown, must fetch. With no in_scope_classes, fail-safe: a live mark never class-drops (treated
// in-scope) — recall over thrift. Operates on a normalized row (live_status + all_class computed).
export function screenVerdict(row, inScopeClasses) {
  if (!row || typeof row !== "object") return "deepfetch:ambiguous";
  if (row.all_class) return "surface:all-class";          // in every class incl. in-scope → never class-drop
  if (row.live_status === "dead") return "drop:dead";
  if (row.live_status === "ambiguous") return "deepfetch:ambiguous";
  const scope = new Set((Array.isArray(inScopeClasses) ? inScopeClasses : []).map(Number).filter(Number.isFinite));
  if (scope.size > 0) {
    const classes = (Array.isArray(row.classes) ? row.classes : []).map(Number).filter(Number.isFinite);
    if (classes.length > 0 && !classes.some((c) => scope.has(c))) return "drop:out-of-class";
  }
  // live, in-scope (or scope unknown → fail-safe): a real candidate; any goods/field drop MUST fetch first.
  return "surface:in-scope-live";
}
