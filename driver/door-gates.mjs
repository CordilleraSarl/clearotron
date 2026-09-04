// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// door-gates.mjs — WHAT EVERY INTAKE DOOR RUNS AFTER validateJob. One function, every door.
//
// ── WHY THIS MODULE EXISTS ──────────────────────────────────────────────────────────────────────────
//
// validateJob is the one thing the portal, start_run, the CLI and the dev cockpit all call, and it can
// only judge what the REQUEST STATES. Everything that depends on WHICH PRODUCT THIS ACTUALLY IS —
// the name count, the scope-vs-machinery fit, the (product × scope) combination rules, whether this
// deployment can run the machinery at all — needs the account's profile and the saved-search store
// resolved first. That resolution lived at some doors and not others:
//
//     check                      portal  start_run  CLI  dev cockpit  plan_run  runner
//     validateJob                  y        y        y        y          y        y
//     availability gate            y        —        —        —          y        y
//     deliveryRoute "portal"       —        —        —        —          y        y
//     resolved mark budget         —        —        —        —          y        y
//     resolved scope-fit           —        —        —        —          y        y
//     combination rules            y        —        —        —          y        y
//
// Every dash is a request one door queued and another refused hours later at claim, in different words.
// This module is that table collapsed to one row.
//
// ── FAIL-OPEN IS THE DOOR'S RULE, AND ONLY THE DOOR'S ────────────────────────────────────────────────
//
// A profile store this process cannot read, or a recipe file that will not parse, must NOT stop somebody
// starting a search: these gates exist to say the answer EARLIER, never instead of the wall. So an
// errored resolution yields no errors here and the runner's admission gate — which does not fail open,
// and clarifies loudly — still decides. That asymmetry is deliberate and is why `resolveRequest` itself
// stays fail-open-free: the wall and the doors want opposite things from the same failure.
//
// ── WHAT IS DELIBERATELY NOT FOLDED IN ──────────────────────────────────────────────────────────────
//
// The client-facing wording of an unavailable product. `gateResolvedPolicy` names the machinery, for
// staff and for logs ("the native-language investigation ships in a later release"); the portal and
// plan_run instead take a CAUSE (`gateCause`) and write their own sentence, so no CLEAROTRON_* name and no
// internal key can reach a browser. Both answers are null-equivalent by construction and
// search-policy.test.mjs pins that over the whole matrix. The two client surfaces therefore run their
// own availability check BEFORE this and never reach the branch below.

import { resolveEffectiveProfile, recipeProseGuard, platformEntryErrors } from "./profiles.mjs";
import { wantsPortalRoute, PORTAL_ROUTE_UNAVAILABLE } from "./enqueue-schema.mjs";
import { gateResolvedPolicy, loadRecipes } from "./search-policy.mjs";
import { readFlagSnapshot, registerTerritoriesFor } from "./flag-snapshot.mjs";
import { config } from "./driver.config.mjs";
import { resolveRequest } from "./resolve-request.mjs";
import { checkResolvedProduct } from "./scope-rules.mjs";

/**
 * Resolve a prospective request the way a DOOR must: product + scope, or nulls.
 *
 * The portal has had exactly this function inline since the plan gate was written; start_run, the CLI
 * and the dev cockpit had nothing. One copy now, so "which product is this" cannot be answered four
 * different ways depending on who asked.
 *
 * `readable` says whether the profile store answered at all — the input `checkClearanceScopeRules`
 * needs to tell "this account has no default territories" apart from "we could not read the account".
 */
/** The wired register's covered territories, read once per gate call. Never throws: a door that cannot
 *  read the snapshot must still open. */
function snapshotTerritories() {
  try { return registerTerritoriesFor(readFlagSnapshot(config.poolRootOrNull)); } catch { return undefined; }
}

export function resolveForDoor(job) {
  try {
    const { profile } = resolveEffectiveProfile(job);
    const { resolved, scope } = resolveRequest(job, {
      profile,
      // force:true — the recipe store is written by a LIVE service, so a just-saved search must trigger
      // without a restart. Read only when the job names one (rare, cheap). D1-guarded: a hand-committed
      // recipe cannot smuggle rating prose past this door either.
      recipes: job?.recipeKey ? loadRecipes({ force: true, proseGuard: recipeProseGuard, platformEntryErrors }) : null,
    });
    return { profile, resolved, scope, readable: true };
  } catch {
    return { profile: null, resolved: null, scope: null, readable: false };
  }
}

/**
 * THE GATE over a resolution the caller already has.
 *
 * Split from the resolution because two doors need the resolution for other things — the portal prints
 * the product's NAME, the scope and the effort figure from it, and plan_run returns all three — and
 * resolving twice is how one response comes to describe two different products.
 *
 * @param {{availability?: boolean}} opts — `availability:false` for the client-facing doors, which word
 *        that refusal themselves (see the header) and have already run it.
 * @returns {{errors: string[], warnings: string[], byCheck: Object}} — `errors` non-empty ⇒ refuse,
 *          quoting them verbatim: they are complete client-facing sentences written once, in
 *          products.mjs and search-policy.mjs, for every door.
 */
export function gateResolvedRequest({ job = null, profile = null, resolved = null, readable = true } = {},
  { availability = true, registerTerritories = undefined } = {}) {
  const out = { errors: [], warnings: [], byCheck: {} };
  // A resolution that could not be taken is not a refusal — see the fail-open note in the header.
  if (!resolved) return out;
  // A CLARIFY IS RELAYED VERBATIM. It is already an actionable sentence naming the selector that could
  // not be honoured ("product \"prelim\" names no search we offer — one of: … (or omit it for the
  // account's default)"), and flattening it into a cause would lose the remedy clause.
  if (resolved.clarify) { out.errors.push(resolved.clarify); return out; }
  // deliveryRoute "portal" — DECLARED but not BUILT. It validates shape-wise, has no consumer (the
  // courier would email it anyway) and was refused at the runner's wall and in plan_run only, so
  // start_run, the CLI and the cockpit queued it and the requester found out at claim. Same asymmetry as
  // the rest of this file, on a field the MCP schemas OFFER by name. One sentence, from the module that
  // owns the shape check, at every door. It is NOT an availability arm — it is refused in the same words
  // on every surface, client-facing or not, because it names no machinery and no switch.
  if (wantsPortalRoute(job)) { out.errors.push(PORTAL_ROUTE_UNAVAILABLE); return out; }
  if (availability) {
    // — the coverage arm rides the SAME injection point as the rest of this gate. Read from the
    // snapshot by default (this process may be the CLI or the cockpit, which have no portal to ask) and
    // overridable so a test can drive an EUIPO-only deployment without one on disk.
    //
    // `undefined` is the fail-open answer at every layer below, so an unreadable or absent snapshot
    // leaves this arm silent and the runner's wall still decides — the door rule stated in the header.
    const terr = registerTerritories !== undefined ? registerTerritories : snapshotTerritories();
    const gateMsg = gateResolvedPolicy(resolved, { registerTerritories: terr });
    if (gateMsg) { out.errors.push(gateMsg); return out; }
  }
  const gates = checkResolvedProduct({ job, profile, resolved, profileReadable: profile !== null && readable });
  out.errors.push(...gates.errors);
  out.warnings.push(...gates.warnings);
  out.byCheck = gates.byCheck;
  return out;
}

/** Resolve and gate in one call — for the doors that need nothing from the resolution but its verdict
 *  (start_run, the CLI, the dev cockpit). Returns the resolution too, so a caller that later wants it
 *  never has to take a second one. */
export function doorGates(job, opts = {}) {
  const r = resolveForDoor(job);
  return { ...r, ...gateResolvedRequest({ job, ...r }, opts) };
}
