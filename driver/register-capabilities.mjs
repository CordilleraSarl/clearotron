// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// register-capabilities.mjs — the driver's view of the per-provider CAPABILITY CONTRACT.
//
// ONE tiny resolver: provider id → the frozen CAPABILITIES object declared in
// providers/<id>/src/capabilities.js. It exists so that register-plan.mjs stays PURE and
// PROVIDER-AGNOSTIC (it takes a capabilities object as a parameter and never imports a vendor), while
// the callers that DO know which provider is active have one obvious place to get it.
//
// Like driver.config.mjs's PROVIDERS: an unknown id throws LOUDLY. There is no fallback capability set —
// silently planning against corsearch's abilities while a thinner provider executes is exactly the class
// of defect this whole phase exists to kill.
//
// The three capabilities.js files are dependency-free (no node imports, no HTTP), so importing them here
// costs nothing and keeps the offline test fleet offline.

import { CAPABILITIES as CORSEARCH_CAPABILITIES } from "../providers/corsearch/src/capabilities.js";
import { CAPABILITIES as CLARIVATE_CAPABILITIES } from "../providers/clarivate/src/capabilities.js";
import { CAPABILITIES as SIGNA_CAPABILITIES } from "../providers/signa/src/capabilities.js";
import { CAPABILITIES as EUIPO_CAPABILITIES } from "../providers/euipo/src/capabilities.js";
import { CAPABILITIES as USPTO_LOCAL_CAPABILITIES } from "../providers/uspto-local/src/capabilities.js";
import { CAPABILITIES as FREE_TIER_CAPABILITIES } from "../providers/free-tier/src/capabilities.js";

export const PROVIDER_CAPABILITIES = Object.freeze({
  corsearch: CORSEARCH_CAPABILITIES,
  clarivate: CLARIVATE_CAPABILITIES,
  signa: SIGNA_CAPABILITIES,
  euipo: EUIPO_CAPABILITIES,
  // Quoted: the id carries a hyphen, and it is the id everywhere else too.
  "uspto-local": USPTO_LOCAL_CAPABILITIES,
  // — the only entry that is DERIVED rather than declared: pointwise-weakest across euipo and
  // uspto-local. It is a real contract like any other (frozen, closed vocabularies, explicit nulls) and
  // the shape test sweeps it exactly the same way; what differs is that nobody hand-typed its values,
  // so it cannot fall behind its members.
  "free-tier": FREE_TIER_CAPABILITIES,
});

export function capabilitiesFor(providerId) {
  const id = String(providerId ?? "").toLowerCase();
  const caps = PROVIDER_CAPABILITIES[id];
  if (!caps) {
    throw new Error(`[register-capabilities] unknown register provider "${providerId}". `
      + `Known: ${Object.keys(PROVIDER_CAPABILITIES).join(", ")}. A provider with no declared capability `
      + `contract cannot be planned against — declare providers/<id>/src/capabilities.js first.`);
  }
  return caps;
}

/** The ACTIVE provider's capabilities (driver.config.mjs owns the toggle; this never re-reads the env). */
export async function activeCapabilities() {
  const { REGISTER_PROVIDER } = await import("./driver.config.mjs");
  return capabilitiesFor(REGISTER_PROVIDER);
}
