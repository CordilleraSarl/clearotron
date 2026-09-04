// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// register-unreachable.mjs — the ONE binding of register-availability.mjs to this deployment's env.
//
// answered "which offices can this box reach" and needed the same answer in a second and a
// third place (Depth 2's count and record lanes, which compile no plan). The answer itself is pure and
// lives in register-availability.mjs. What is NOT pure is the member→variable lookup: it reads
// PROVIDERS and missingCredentials, which read the environment.
//
// THIS FILE EXISTS SO THERE IS EXACTLY ONE OF THOSE BINDINGS. It was private to pipeline.mjs, and that
// module's own comment names the failure a second copy creates: "a second copy here is how a planner
// and a preflight come to disagree about which variable matters — the half-check class of defect that
// and both had to fix." Three lanes now split offices; three copies of the lookup would be
// three chances to disagree about what "configured" means, and they would disagree silently, because
// every one of them returns a plausible list.
//
// The member→variable mapping is READ OFF THE MEMBER'S OWN ADAPTER (`PROVIDERS[memberId]`), through the
// same `missingCredentials` predicate preflight uses — euipo and uspto-local are selectable providers
// in their own right, so their requirements are already declared once.
//
// NEVER-KILL. Every failure path yields `[]`, which is "nothing is unreachable" — the answer that
// leaves the caller's behaviour exactly as it was before this file existed. An unknown member id yields
// no entry rather than a fabricated unavailability, because inventing one would defer coverage the box
// actually has. This improves a lane's honesty; it never turns one off.

import { PROVIDERS, activeProvider, missingCredentials } from "./driver.config.mjs";
import { capabilitiesFor } from "./register-capabilities.mjs";
import { unavailableOffices } from "./register-availability.mjs";

/** The ACTIVE provider's contract, or null. Never throws — an unwired provider is not this file's error. */
export function registerCapabilities() {
  try { return capabilitiesFor(activeProvider().id); } catch { return null; }
}

/**
 * The covered offices this DEPLOYMENT cannot reach, because a composed provider's member is not
 * configured here. `[{ office, memberId, missing[] }]`, deterministic order.
 *
 * Empty for every single-source provider and for a fully wired composite, so every consumer's output
 * is byte-identical on those.
 *
 * @param capabilities  defaults to the active provider's. Passed explicitly by callers that already
 *        hold it, so the contract a lane refuses against is the same object it planned against.
 */
export function registerUnavailableOffices(capabilities = undefined) {
  try {
    return unavailableOffices(capabilities === undefined ? registerCapabilities() : capabilities, {
      requirementsFor: (memberId) => {
        const adapter = PROVIDERS[memberId];
        if (!adapter) return null;
        return { offices: capabilitiesFor(memberId)?.offices?.covered ?? [], missing: missingCredentials(adapter) };
      },
    });
  } catch { return []; }
}
