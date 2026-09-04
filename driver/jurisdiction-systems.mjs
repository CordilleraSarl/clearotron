// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// jurisdiction-systems.mjs — first-to-use vs first-to-register, as DATA ( WS3 C1).
//
// The run treated every jurisdiction as if registration alone decides rights. It does not: in
// first-to-USE systems (US and the common-law family) unregistered marketplace use creates
// enforceable rights — the common-law sweep is a RIGHTS search there, not colour; in
// first-to-REGISTER systems the register is the battlefield and marketplace presence is
// commercial context. This table lets the driver LABEL jurisdictions by system and scope the
// marketplace-risk directives to where use actually creates rights.
//
// SOURCED CONSERVATIVELY and flagged for a staff lawyer's confirmation on the PR ( checklist item):
// only systems we are confident of are listed; an UNKNOWN code returns null and every consumer
// leaves it UNLABELED — the system never guesses a legal system. ("Hybrid" realities — e.g. the
// UK's registration system alongside passing-off rights — are classified by where unregistered
// USE can defeat/coexist with a later registration, the property the prelim actually acts on.)
//
// PURE (no node imports) → tests offline.

import { canonicalJurisdictionCode } from "./jurisdiction-codes.mjs";

// Unregistered use creates enforceable rights (common-law family / use-based systems).
export const FIRST_TO_USE = [
  "US", "CA", "AU", "NZ", "IN", "PH",          // named in the spec
  "UK", "GB", "IE",                            // common-law core (passing off) — staff lawyer to confirm
];

// Registration is the source of rights; prior unregistered use gives little or no priority.
export const FIRST_TO_REGISTER = [
  "CH", "EU", "EM", "EUTM", "CN", "JP", "KR", "DE", "FR", "ES", "IT",   // named in the spec
  "BX", "NL", "BE", "AT", "PT", "SE", "NO", "DK", "FI", "PL", "CZ",     // EU/EFTA civil family
  "RU", "TR", "BR", "MX",                                                // well-established first-to-file
];

/** "first-to-use" | "first-to-register" | null (unknown — NEVER guessed, consumers leave it unlabeled).
 *  A12: the lookup runs on the CANONICAL code (UK→GB, EM/EUTM/EUIPO→EU — driver/jurisdiction-codes.mjs),
 *  so both spellings of one territory always label identically; the alias entries in the lists above
 *  stay as documentation of the accepted matter vocabulary. */
export function registrationSystem(code) {
  const c = canonicalJurisdictionCode(code);
  if (!c) return null;
  if (FIRST_TO_USE.includes(c)) return "first-to-use";
  if (FIRST_TO_REGISTER.includes(c)) return "first-to-register";
  return null;
}

/** Partition a jurisdiction list by system. Unknowns are carried, never dropped or guessed.
 *  A12: partitions carry CANONICAL codes, deduped — a matter scoped "UK, GB" is one GB entry, and the
 *  scope directive below can never name one territory twice under two spellings. */
export function partitionBySystem(codes) {
  const out = { firstToUse: [], firstToRegister: [], unknown: [] };
  for (const c of codes ?? []) {
    const canon = canonicalJurisdictionCode(c);
    const s = registrationSystem(canon);
    const bucket = s === "first-to-use" ? out.firstToUse : s === "first-to-register" ? out.firstToRegister : out.unknown;
    if (!bucket.includes(canon)) bucket.push(canon);
  }
  return out;
}

/**
 * The one-line marketplace-risk scope directive for a stage message, derived from the instructed
 * territories. Returns "" when nothing is known (no labels ⇒ no directive — never a guess).
 */
export function marketplaceScopeDirective(codes) {
  const { firstToUse, firstToRegister } = partitionBySystem(codes);
  if (!firstToUse.length && !firstToRegister.length) return "";
  const parts = [];
  if (firstToUse.length) parts.push(
    `In ${firstToUse.join(", ")} (first-to-USE), unregistered marketplace use creates enforceable rights — weight common-law/marketplace findings there as RIGHTS, not colour.`);
  if (firstToRegister.length) parts.push(
    `In ${firstToRegister.join(", ")} (first-to-REGISTER), the register decides priority — marketplace presence there is commercial context, never a rights conflict on its own.`);
  return parts.join(" ");
}
