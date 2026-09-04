// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Territory vocabulary → ISO 3166 / WIPO ST.3 region codes.
//
// WHY THIS EXISTS: the portal composer offers
// territories by display name ("United States", "European Union" — driver/compose-read.mjs
// PROMPT_TERRITORIES, mirroring portal-ui composerLevers), and those names flowed verbatim into
// `region:` clauses because corsearch's offices.translate is an ISO passthrough that ASSUMES codes.
// Corsearch answers an unknown multi-word region value with HTTP 500 — not a 400 — so auto-recovery
// classified the failure transient and burned its park budget re-sending the same malformed query.
// The run died at fan-in with terminalKind:repeat-signature.
//
// The register wire vocabulary is CODES (providers/corsearch/src/index.js: "UPPERCASE 2-letter
// codes"); display names are a UI vocabulary. This module is the one deterministic bridge between
// them. Model phrasing must never be load-bearing for a wire call.
//
// Contract:
//   normalizeTerritory(value) →
//     - a 2-letter code (any 2-letter input passes through uppercased — provider translate owns
//       provider-specific spelling, e.g. EU→EM on clarivate)
//     - ""   for Worldwide (meaning: NO region restriction — the caller omits the clause/filter)
//     - null for an unknown value (caller decides: defer the jurisdiction, or fail loud with a
//       message the composing model can act on — NEVER pass it to the wire)

const strip = (s) => String(s ?? "")
  .normalize("NFKD").replace(/\p{M}/gu, "")           // fold diacritics (Türkiye → Turkiye)
  .toUpperCase()
  .replace(/[().]/g, " ")                             // "African Regional (ARIPO)" → tokens
  .replace(/\s+/g, " ")
  .trim();

// Keys are strip()-normalized display names and common aliases. Values are the ISO 3166-1 alpha-2
// code (WIPO ST.3 for the regional systems). "" = worldwide sentinel.
export const TERRITORY_TO_CODE = Object.freeze({
  "WORLDWIDE": "", "GLOBAL": "", "ALL": "",
  "EUROPEAN UNION": "EU", "EUIPO": "EU", "EUTM": "EU",
  "BENELUX": "BX",
  "AFRICAN REGIONAL ARIPO": "AP", "ARIPO": "AP", "AFRICAN REGIONAL": "AP",
  "INTERNATIONAL": "WO", "INTERNATIONAL MADRID": "WO", "MADRID": "WO", "WIPO": "WO",
  "UNITED STATES": "US", "UNITED STATES OF AMERICA": "US", "USA": "US", "U S": "US", "U S A": "US",
  "UNITED KINGDOM": "GB", "GREAT BRITAIN": "GB",
  "IRELAND": "IE",
  "FRANCE": "FR",
  "GERMANY": "DE",
  "SPAIN": "ES",
  "ITALY": "IT",
  "NETHERLANDS": "NL",
  "SWITZERLAND": "CH",
  "AUSTRIA": "AT",
  "SWEDEN": "SE",
  "NORWAY": "NO",
  "POLAND": "PL",
  "BULGARIA": "BG",
  "GREECE": "GR",
  "TURKEY": "TR", "TURKIYE": "TR",
  "CANADA": "CA",
  "MEXICO": "MX",
  "BRAZIL": "BR",
  "ARGENTINA": "AR",
  "CHINA": "CN", "PEOPLES REPUBLIC OF CHINA": "CN",
  "HONG KONG": "HK",
  "TAIWAN": "TW",
  "MACAU": "MO", "MACAO": "MO",
  "JAPAN": "JP",
  "SOUTH KOREA": "KR", "KOREA": "KR", "REPUBLIC OF KOREA": "KR",
  "SINGAPORE": "SG",
  "INDIA": "IN",
  "THAILAND": "TH",
  "AUSTRALIA": "AU",
  "NEW ZEALAND": "NZ",
  "UNITED ARAB EMIRATES": "AE", "UAE": "AE",
  "SAUDI ARABIA": "SA",
  "SOUTH AFRICA": "ZA",
});

export function normalizeTerritory(value) {
  const s = strip(value);
  if (!s) return null;
  if (/^[A-Z]{2}$/.test(s)) return s;                 // already a code (UK stays UK — provider translate owns aliasing)
  if (s in TERRITORY_TO_CODE) return TERRITORY_TO_CODE[s];
  return null;
}
