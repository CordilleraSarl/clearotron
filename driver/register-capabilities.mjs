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
// The capabilities.js files are dependency-free (no node imports, no HTTP), and so is the rest of what the providers'
// index imports, so importing it here costs nothing and keeps the offline test fleet offline.

import { byRegister } from "../providers/registers.mjs";   // every register provider, named once

// The providers are listed once, in providers/registers.mjs; free-tier's contract is the only one derived rather than
// declared (pointwise-weakest across euipo and uspto-local), and the shape test sweeps it like the others.
export const PROVIDER_CAPABILITIES = Object.freeze(byRegister("capabilities"));

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
