// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// onboarding-store.mjs — where an onboarding command may write, and how it refuses.
//
// EXTRACTED FROM bin/brandowner.mjs WHEN THE SECOND CALLER ARRIVED. `project add`
// asks an identical question — same environment variable, same three situations, same consequences — so
// this is shared logic rather than two commands that happen to look alike. Copying it would have been
// exactly the second opinion this codebase keeps paying to remove, and the copy that goes stale is
// always the one guarding the case nobody hits in testing.
//
// It lives in shared/ rather than beside one of its callers because a bin entry importing another bin
// entry is a dependency between two things a user types, and the one that gets deleted first is never
// the one you predict.

import { existsSync } from "node:fs";

/** A refusal is a sentence for the operator, not a stack trace. Every one names what was wrong. */
export class Refusal extends Error {
  constructor(message) { super(message); this.name = "Refusal"; }
}

/**
 * The store an onboarding command may write into, or a refusal naming why there isn't one.
 *
 * THREE OUTCOMES, AND THE TWO REFUSALS NEED DIFFERENT SENTENCES because they need different fixes.
 *
 *   overlay            a store is configured and in force — write there
 *   bundled-fallback   nothing is configured, so records resolve from the demo roster that ships INSIDE
 *                      this checkout. Writing would put a real client next to our fixtures, under
 *                      version control.
 *   env-arrived-late   a store IS configured but was set after the process read it, so the value the
 *                      operator can see in their shell is not the one in force. Writing there produces
 *                      a record this install cannot see.
 *
 * CONFIGURED IS NOT THE SAME AS PRESENT, which is the fourth case and the one that reads as a crash. A
 * typo in the variable is still "overlay" — the value was set before load, which is all the resolution
 * reports. Without the existence check the first thing to touch the directory is the roster read, and
 * that surfaces as `ENOENT: scandir '<path>'`: a stack trace naming a path, with no variable, no cause
 * and no fix. Measured on before this check existed.
 */
export function storeForAdd(resolution, { exists = existsSync } = {}) {
  if (resolution.situation === "overlay") {
    if (!exists(resolution.inForce))
      throw new Refusal(
        `CLEAROTRON_CUSTOMERS_DIR is set to ${resolution.inForce} and there is no such directory. `
        + `Refusing rather than creating it: a store this process cannot see is usually a typo, and `
        + `creating it would give you an empty roster that looks like a working one.`);
    return resolution.inForce;
  }
  if (resolution.situation === "env-arrived-late")
    throw new Refusal(
      `CLEAROTRON_CUSTOMERS_DIR is set to ${resolution.configured} but was not set when this process started, `
      + `so it is NOT the store in force and anything written there would be invisible to this install. `
      + `Export it before the process starts, then run this again.`);
  throw new Refusal(
    `CLEAROTRON_CUSTOMERS_DIR is unset, so brand owners resolve from the demo roster bundled inside this `
    + `checkout (${resolution.store}). Adding to it would put a real client into the shipped demo `
    + `fixtures. Set CLEAROTRON_CUSTOMERS_DIR to this deployment's own store and run this again.`);
}
