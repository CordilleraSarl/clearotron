// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// register-reach.mjs — what the run's register service reaches, against the markets the order is for. PURE.
//
// A worldwide order's coverage line read "registers: worldwide (Signa)" while the service searches 15 offices, and
// whether a market outside them was named anywhere depended on what the writer chose to write: on three deliveries
// of one order, Vietnam was named on none. The line now states the reach and names the markets outside it, and code
// writes a "Not searched" row for each of those markets (owner, 2026-11-18).
//
// THE REACH IS THE SERVICE'S OWN CONTRACT: the covered office list its capabilities declare, which is the list it
// searches, and a market is outside it when the contract cannot translate it to an office. The coverage line and
// the rows both read this one answer, so they cannot disagree. A service that declares no office list (Corsearch)
// has no reach to state, and the answer is null.
import { capabilitiesFor } from "./register-capabilities.mjs";
import { territoryKey } from "./territory-tiers.mjs";

/**
 * `{ service, offices, uncovered }` for a provider and the order's markets, or null when the provider declares no
 * office list. `uncovered` keeps the markets' own order, folded to the territory vocabulary's codes, once each.
 */
export function registerReach(providerId, markets = []) {
  if (!providerId) return null;
  let caps;
  try { caps = capabilitiesFor(providerId); } catch { return null; }
  const offices = caps?.offices;
  if (!Array.isArray(offices?.covered) || !offices.covered.length || typeof offices.translate !== "function") return null;
  const seen = new Set();
  const uncovered = [];
  for (const m of Array.isArray(markets) ? markets : []) {
    const code = territoryKey(m);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    if (offices.translate(code) == null) uncovered.push(code);
  }
  return { service: caps.label ?? providerId, offices: offices.covered.length, uncovered };
}

/** The reason a code-written "Not searched" row gives, in the words approved for it (owner, 2026-11-18). */
export const NOT_COVERED_REASON = "the register service does not cover this office";
