// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// register-grant-vocabulary.mjs — the one sentence that tells a register seat what its key ALSO carries.
//
// ── WHY THE DRIVER COMPOSES THIS AND THE DOCTRINE DOES NOT ──────────────────────────────────────────
//
// `unit.md` is provider-INDEPENDENT doctrine, and it named three provider-DEPENDENT tools flat:
// "Your register key also carries register_record_fetch, register_image_fetch and register_batch_screen."
// On a signa deployment two thirds of that sentence is false and the seat is told it holds tools its
// grant does not carry; the same shape is 's subject across six
// providers. A dispatch that asserts a capability the active provider lacks is the defect, whatever the
// seat then does with it.
//
// The section's PURPOSE is worth keeping exactly as `unit.md` states it — "a seat told nothing about a
// tool it holds reaches for whatever the doctrine DOES name, and picks wrongly." So this is not a
// deletion: the sentence moves to the one layer that knows which provider is mounted, and it becomes
// true per deployment instead of true for one of them.
//
// DERIVED FROM THE TABLE THAT DOES THE EXCLUDING, so there is no second list of capabilities to keep in
// step — the same rule `providerUnavailableRegisterTools` follows, and asks for by
// name. What stays authored here is the DOCTRINE half: which tools this seat holds and must not call.
// That is a routing decision, not a capability fact, and it does not move when a provider's API does.
import { REGISTER_SERVERS } from "./engine/mcp/gather-config.mjs";
import { requireRegisterProvider } from "./driver.config.mjs";

/**
 * The register tools a unit seat HOLDS and deliberately does not call. Doctrine, not capability: every
 * record `register_enumerate` returns is already whole and already screened, and the frozen plan's
 * entries are fetched by the executor. Named so a seat that holds one does not reach for whatever the
 * doctrine does name and pick wrongly.
 */
export const HELD_BUT_NOT_CALLED = Object.freeze([
  "register_record_fetch", "register_image_fetch", "register_batch_screen",
]);

/**
 * The sentence, or NULL when this deployment cannot be resolved.
 *
 * ✕ NULL IS NOT AN EMPTY SENTENCE, and the difference is the defect this exists to fix. Ask
 * `providerUnavailableRegisterTools` on an unresolved provider and it answers with an empty withheld
 * set — deliberately, as a reporting helper that must never throw. Composed into this sentence, an empty
 * withheld set reads as "your grant carries all of them": 's defect, restored
 * silently, on exactly the `--experiment` single-stage path a diagnosis reaches for. So resolution is
 * asked for HERE, and an unresolved provider omits the sentence rather than composing a false one.
 */
export function grantVocabularySentence(provider = null) {
  let p = provider;
  if (!p) { try { p = requireRegisterProvider(); } catch { return null; } }
  const entry = REGISTER_SERVERS[p];
  if (!entry) return null;
  const served = new Set(entry.tools ?? []);
  const held = HELD_BUT_NOT_CALLED.filter((t) => served.has(t));
  if (!held.length) return null;   // a provider serving none of them is told nothing, not told "none"

  const names = held.map((t) => `\`${t}\``);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  const verb = held.length === 1 ? "carries one tool you do not call" : `carries ${held.length} tools you do not call`;
  // ✕ THIS SENTENCE NAMES NO SWEEP TOOL, DELIBERATELY. It rides the register-unit dispatch, and the
  // SUPPLEMENTAL LANE removes `register_enumerate` — `register-steering.test.mjs` asserts that after the
  // two sanctioned prohibitions are stripped, a lane prompt does not name the removed tool at all. The
  // prose this replaced lived in `unit.md`, a skill read rather than the dispatch, so it could name the
  // tool freely; moving it into the message brought it under that rule. Naming the mechanism instead of
  // the callable keeps ONE sentence for both lanes rather than a lane-conditional pair — the grant is
  // already conditioned on the provider, and conditioning it on the lane as well would be two axes of
  // truth in a sentence whose whole job is to be true.
  return `WHAT ELSE YOUR GRANT CARRIES, AND WHY YOU DO NOT CALL IT. On this deployment your register key `
    + `also ${verb}: ${list}. You do not call them, and that is a routing fact rather than a prohibition `
    + `to work around — every record the register sweep returns is already batch-screened and already `
    + `whole, and the frozen plan's entries are fetched by the executor, not by you. So reaching for one `
    + `of these means the query is wrong, not that a capability is missing: go back to the sweep and fix `
    + `its scope. This list is the tools THIS provider serves; another deployment's differs, and `
    + `\`skills/prelim-register/providers/<name>.md\` is where the provider-specific vocabulary lives.`;
}
