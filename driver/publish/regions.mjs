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

import { COMMON_LAW, REGION_NAMES, REGION_ALIAS } from "../../shared/jurisdiction-tables.mjs";   // a jurisdiction's tables live in one home
export { COMMON_LAW, REGION_NAMES, REGION_ALIAS };

export const normRegion = (c) => { const u = String(c || '').toUpperCase(); return REGION_ALIAS[u] || u; };

// THE NAME A READER SEES. REGION_NAMES wins; a two-letter country code it lacks takes the name the runtime's own
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
