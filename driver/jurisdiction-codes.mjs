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

// Aliases → canonical code. GB is the ISO 3166-1 code (UK is a habit, not a code); EU is the driver's
// canonical EUIPO token (EM is Compumark's spelling of the same office, EUTM/EUIPO are prose).
export const JURISDICTION_CODE_FOLD = Object.freeze({
  UK: "GB",
  EM: "EU",
  EUTM: "EU",
  EUIPO: "EU",
});

// The known universe: ISO 3166-1 alpha-2 (officially assigned) + the register-world extras — EU
// (EUIPO, canonical), WO (WIPO / Madrid International Register), AP (ARIPO), OA (OAPI), BX (Benelux),
// EA (Eurasian), IB (International Bureau), plus the X*/ZZ extension codes observed in live provider
// office enums (XK Kosovo et al.). A code outside this set is not necessarily wrong — it is UNKNOWN,
// and A12's contract is that it surfaces loudly instead of being silently recorded as a jurisdiction.
export const KNOWN_JURISDICTION_CODES = Object.freeze(new Set([
  // ISO 3166-1 alpha-2, officially assigned
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR", "AS", "AT", "AU", "AW", "AX", "AZ",
  "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ", "BR", "BS",
  "BT", "BV", "BW", "BY", "BZ",
  "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN", "CO", "CR", "CU", "CV", "CW",
  "CX", "CY", "CZ",
  "DE", "DJ", "DK", "DM", "DO", "DZ",
  "EC", "EE", "EG", "EH", "ER", "ES", "ET",
  "FI", "FJ", "FK", "FM", "FO", "FR",
  "GA", "GB", "GD", "GE", "GF", "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GS", "GT",
  "GU", "GW", "GY",
  "HK", "HM", "HN", "HR", "HT", "HU",
  "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR", "IS", "IT",
  "JE", "JM", "JO", "JP",
  "KE", "KG", "KH", "KI", "KM", "KN", "KP", "KR", "KW", "KY", "KZ",
  "LA", "LB", "LC", "LI", "LK", "LR", "LS", "LT", "LU", "LV", "LY",
  "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK", "ML", "MM", "MN", "MO", "MP", "MQ", "MR", "MS",
  "MT", "MU", "MV", "MW", "MX", "MY", "MZ",
  "NA", "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR", "NU", "NZ",
  "OM",
  "PA", "PE", "PF", "PG", "PH", "PK", "PL", "PM", "PN", "PR", "PS", "PT", "PW", "PY",
  "QA",
  "RE", "RO", "RS", "RU", "RW",
  "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI", "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS",
  "ST", "SV", "SX", "SY", "SZ",
  "TC", "TD", "TF", "TG", "TH", "TJ", "TK", "TL", "TM", "TN", "TO", "TR", "TT", "TV", "TW", "TZ",
  "UA", "UG", "UM", "US", "UY", "UZ",
  "VA", "VC", "VE", "VG", "VI", "VN", "VU",
  "WF", "WS",
  "YE", "YT",
  "ZA", "ZM", "ZW",
  // register-world extras (WIPO ST.3 / regional offices / provider extension codes)
  "EU", "WO", "AP", "OA", "BX", "EA", "IB",
  "XA", "XG", "XK", "XS", "XW", "ZZ",
]));

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
