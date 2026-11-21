// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// jurisdiction-codes.mjs — THE canonical jurisdiction-code map (addendum A12, 2026-07-30).
//
// The engine's own recording/comparison surfaces spoke SEVERAL jurisdiction dialects at once: the UK
// arrived as "UK" (intake habit) and "GB" (ISO / clarivate office code); the EUIPO as "EU" (ISO-ish
// matter code), "EM" (the Compumark office code every clarivate-executed band records), "EUTM" and
// "EUIPO" (prose). Each consumer folded locally or not at all — frame-diff-model carried its own
// EU_TOKENS set, jurisdiction-systems listed UK and GB as separate first-class entries, and the
// coverage/scope reconciliation compared raw tokens — so a scope of "UK" against a ledger row of "GB"
// (or "EU" vs a band's "EM") read as a DIFFERENT territory: false under-coverage/over-reach flags, and
// two names for one office in the same run's records. This module is the ONE fold; every driver-side
// consumer routes through it.
//
// WHAT THIS IS NOT (scope, deliberate): the WIRE vocabulary is untouched. Provider request translation
// stays with each provider's offices.translate (clarivate spells the EUIPO "EM" and the UK "GB";
// corsearch is an ISO passthrough) — providers/_shared/territory-codes.mjs remains the display-name →
// code bridge for the compile path. This module canonicalizes what the DRIVER records and compares,
// after the fact and provider-neutrally.
//
// UNKNOWN CODES SURFACE LOUDLY, NEVER SILENTLY (A12's second half): foldJurisdictionCodes returns the
// unknowns alongside the fold so the caller can note/log them by name. Unknowns are CARRIED, never
// dropped or guessed (the partitionBySystem doctrine) — the loudness is the point, not a filter.
//
// PURE (no node imports) → tests offline.

import { JURISDICTION_CODE_FOLD, KNOWN_JURISDICTION_CODES } from "../shared/jurisdiction-tables.mjs";   // a jurisdiction's tables live in one home
export { JURISDICTION_CODE_FOLD, KNOWN_JURISDICTION_CODES };

/**
 * Canonicalize ONE jurisdiction token: trim, uppercase, fold the aliases (UK→GB, EM/EUTM/EUIPO→EU).
 * An unrecognized value passes through uppercased — carried, never dropped or guessed; loudness about
 * unknowns is foldJurisdictionCodes' (and the caller's) job. "" in → "" out (the worldwide sentinel).
 */
export function canonicalJurisdictionCode(code) {
  const c = String(code ?? "").trim().toUpperCase();
  if (!c) return "";
  return JURISDICTION_CODE_FOLD[c] ?? c;
}

/** Is this token, after the canonical fold, inside the known universe? */
export function isKnownJurisdictionCode(code) {
  const c = canonicalJurisdictionCode(code);
  return Boolean(c) && KNOWN_JURISDICTION_CODES.has(c);
}

/**
 * Fold a list: canonical codes, deduped, order-preserved (blank entries stripped) — plus the UNKNOWNS
 * (post-fold codes outside the known universe), so the caller can surface them loudly by name. The
 * unknowns remain IN `codes` too: recorded loudly, never silently — and never dropped.
 */
export function foldJurisdictionCodes(codes) {
  const out = [];
  const unknown = [];
  for (const raw of codes ?? []) {
    const c = canonicalJurisdictionCode(raw);
    if (!c) continue;
    if (!out.includes(c)) out.push(c);
    if (!KNOWN_JURISDICTION_CODES.has(c) && !unknown.includes(c)) unknown.push(c);
  }
  return { codes: out, unknown };
}
