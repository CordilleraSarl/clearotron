// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// regions.mjs — the ONE country/jurisdiction naming source for every render surface (spec 49 T0,
// porting the unmerged fix from PR / 65a332cc).
//
// The common-law sentinel is 'C/L', never 'CL' — to a trademark lawyer CL is Chile (ISO 3166), and an
// actual Chilean registration must not collide with the common-law bucket (the latent bug a reviewing
// lawyer hit on a live matter). Every ISO-3166 alpha-2 key in REGION_NAMES must therefore carry its
// country meaning; only non-ISO keys ('C/L', 'WO', 'BX', 'EU') may carry a non-country meaning —
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
  CL: 'Chile', [COMMON_LAW]: 'Common-law',
};

// doc-55 B — Madrid/WIPO international records surface from corsearch as jurisdiction "INT" (URI
// /mark/int/…); normalize them to the existing WO ('WIPO (Madrid)') so the WIPO international register
// reads consistently everywhere (one recent run showed "WO", another "INT"). NOTE: we do NOT alias "IR"
// — IR is ISO-3166 Iran, not "international registration" (the same CL=Chile collision this file guards
// against). euipo IR-designating-EU records already carry jurisdiction "EU"; corsearch Madrid = "INT".
export const REGION_ALIAS = { GB: 'UK', EM: 'EU', EUTM: 'EU', EUIPO: 'EU', INT: 'WO' };

export const normRegion = (c) => { const u = String(c || '').toUpperCase(); return REGION_ALIAS[u] || u; };

// Unknown code ⇒ the raw code doubles as the name, so a new register surfaces without a change here.
export const regionName = (code) => REGION_NAMES[code] || code;
