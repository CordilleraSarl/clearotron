// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// regions.mjs — the ONE country/jurisdiction naming source for every render surface (spec 49 T0,
// porting the unmerged fix from PR / 65a332cc).
//
// The common-law sentinel is 'C/L', never 'CL' — to a trademark lawyer CL is Chile (ISO 3166), and an
// actual Chilean registration must not collide with the common-law bucket (the latent bug a reviewing
// lawyer hit on a live matter). Every ISO-3166 alpha-2 key in REGION_NAMES must therefore carry its
// country meaning; only non-ISO keys ('C/L', 'WO', 'BX', 'EU', 'XS') may carry a non-country meaning —
// regions.test.mjs guards this.
//
// PURE (no node imports) so tests run offline and any surface (render, email, xlsx) can import it.

export const COMMON_LAW = 'C/L';

export const REGION_NAMES = {
  US: 'United States', EU: 'European Union', UK: 'United Kingdom', CN: 'China', JP: 'Japan',
  KR: 'South Korea', CA: 'Canada', AU: 'Australia', IN: 'India', BR: 'Brazil', RU: 'Russia',
  BX: 'Benelux', CH: 'Switzerland', DE: 'Germany', FR: 'France', ES: 'Spain', IT: 'Italy',
  NL: 'Netherlands', SE: 'Sweden', NO: 'Norway', SG: 'Singapore', WO: 'WIPO (Madrid)',
  TR: 'Turkey', NZ: 'New Zealand', PH: 'Philippines', ID: 'Indonesia', ZA: 'South Africa',
  MX: 'Mexico', TW: 'Taiwan', HK: 'Hong Kong', SA: 'Saudi Arabia', AE: 'United Arab Emirates',
  DK: 'Denmark', FI: 'Finland', PL: 'Poland', PT: 'Portugal', AT: 'Austria', BE: 'Belgium',
  IE: 'Ireland', GR: 'Greece', IL: 'Israel', TK: 'Tokelau',
  // XS is no country: it is the code the US state registers are filed under beside the federal one, read as they are
  // named (owner, 2026-11-18). It printed as "XS".
  XS: 'US state registers',
  // Two regional offices and a user-assigned code, by the names a lawyer knows them (owner, 2026-11-19). They printed
  // as codes in a report's list of places where nothing was found. XA, XG and XW stay as the register records them
  // until the register's own names for them are verified.
  AP: 'ARIPO', OA: 'OAPI', XK: 'Kosovo',
  CL: 'Chile', [COMMON_LAW]: 'Common-law',
};

// doc-55 B — Madrid/WIPO international records surface from corsearch as jurisdiction "INT" (URI
// /mark/int/…); normalize them to the existing WO ('WIPO (Madrid)') so the WIPO international register
// reads consistently everywhere (one recent run showed "WO", another "INT"). NOTE: we do NOT alias "IR"
// — IR is ISO-3166 Iran, not "international registration" (the same CL=Chile collision this file guards
// against). euipo IR-designating-EU records already carry jurisdiction "EU"; corsearch Madrid = "INT".
export const REGION_ALIAS = { GB: 'UK', EM: 'EU', EUTM: 'EU', EUIPO: 'EU', INT: 'WO' };

export const normRegion = (c) => { const u = String(c || '').toUpperCase(); return REGION_ALIAS[u] || u; };

// THE NAME A READER SEES. The table above wins; a two-letter country code it lacks takes the name the runtime's own
// region names give it (Intl.DisplayNames, a global, so this file stays import-free); anything else is printed as
// the code itself, so a new register still surfaces without a change here. 128 of 320 country rows on delivered
// reports printed a bare code (AR, CO, CZ) because the table is hand-kept.
//
// ONLY A REAL COUNTRY CODE IS ASKED. ZZ reads "Unknown Region" and a numeric code "world", and neither may reach a
// page, so the question is put only for two capital letters outside ZZ and the private-use ranges (AA, QM to QZ,
// XA to XZ), and a name that comes back as the code itself (EM) is no name. The runtime's names come from its ICU
// data, so a newer Node can spell one differently; the table is where a spelling is pinned (TR stays Turkey).
const PRIVATE_USE = /^(?:AA|ZZ|Q[M-Z]|X[A-Z])$/;
let displayNames;
function runtimeRegionName(code) {
  if (!/^[A-Z]{2}$/.test(code) || PRIVATE_USE.test(code) || typeof Intl?.DisplayNames !== 'function') return null;
  try {
    displayNames ??= new Intl.DisplayNames(['en'], { type: 'region' });
    const name = displayNames.of(code);
    return name && name !== code ? name : null;
  } catch { return null; }
}
export const regionName = (code) => REGION_NAMES[code] || runtimeRegionName(code) || code;
