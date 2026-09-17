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
import { resolveTerritories } from "./effective-scope.mjs";
import { uncoveredTerritories, registerReachRefusal } from "./register-coverage.mjs";
import { readFlagSnapshot, registerTerritoriesFor, registerLabelFor } from "./flag-snapshot.mjs";
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
/** The wired register as a door needs it: what it covers, and what to CALL it in a sentence a client
 *  reads. One read, both answers. Never throws — a door that cannot read the snapshot must still open,
 *  and `territories: undefined` is the fail-open answer every layer below already speaks. */
function snapshotRegister() {
  try {
    const snap = readFlagSnapshot(config.poolRootOrNull);
    return { territories: registerTerritoriesFor(snap), label: registerLabelFor(snap) };
  } catch { return { territories: undefined, label: null }; }
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
  { availability = true, registerTerritories = undefined, registerLabel = undefined } = {}) {
  const out = { errors: [], warnings: [], byCheck: {} };
  // Read at most once per gate call, and not at all when both arms were given their answer — a test
  // driving a Signa-shaped deployment must not need a snapshot on disk to do it.
  let snapshot;
  const register = () => (snapshot ??= snapshotRegister());
  // A resolution that could not be taken is not a refusal — see the fail-open note in the header.
  if (!resolved) return out;
  // A CLARIFY IS RELAYED VERBATIM. It is already an actionable sentence naming the selector that could
  // not be honoured ("product \"clearotron\" names no search we offer — one of: … (or omit it for the
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
    const terr = registerTerritories !== undefined ? registerTerritories : register().territories;
    const gateMsg = gateResolvedPolicy(resolved, { registerTerritories: terr });
    if (gateMsg) { out.errors.push(gateMsg); return out; }
  }
  // ── A TERRITORY THIS REQUEST NAMES THAT THE WIRED REGISTER CANNOT SEARCH ──────────────────────────
  //
  // OUTSIDE the availability block, and that placement is the whole correctness of this arm. The portal
  // and plan_run pass `availability:false` because they word an unavailable PRODUCT in their own words
  // (the header's staff-prose split) — so an arm written inside that block cannot fire at the two doors
  // a client actually orders through, and it would fail to fire SILENTLY, green, on the case the ruling
  // of 2026-09-17 is about. This refusal carries no switch name and no internal key, so unlike the
  // availability twin it is the same sentence on every surface and needs no client-facing rewording.
  //
  // THE TERRITORIES ARE RESOLVED HERE, NOT THREADED IN. `resolveTerritories` is the same ladder
  // effective-scope.mjs runs for the scope a door prints beside this refusal, so the two cannot
  // disagree. Asking each of the six doors to pass its own scope would let one forget the argument and
  // fail open in silence — the exact shape `register-coverage-doors.test.mjs` exists to catch one layer
  // up. One call, in the one gate they all share, covers every door by construction.
  //
  // Fail-open on a throw, the door's rule: an unreadable profile store must not stop somebody searching.
  {
    let named = [];
    try { named = resolveTerritories(job ?? {}, profile, resolved?.recipeScope ?? null).jurisdictions ?? []; } catch { named = []; }
    const terr = registerTerritories !== undefined ? registerTerritories : register().territories;
    const label = registerLabel !== undefined ? registerLabel : register().label;
    const refusal = registerReachRefusal(uncoveredTerritories(named, terr), label);
    if (refusal) { out.errors.push(refusal); return out; }
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

// ── WHY THE CONFIGURED-TO-SEARCH REFUSAL IS NOT ALSO A DOOR GATE ─────────────────────────────────────────
//
// It was, briefly, and it was removed with a measurement rather than an opinion. Adding "is this box
// configured to search at all" here reddened `driver/test/doors-agree.test.mjs` — nineteen arms green
// with it out and six red with it in, including the product-parity arms whose whole subject is that
// every door names the same product for one request. A gate that changes what a door RESOLVES, rather
// than only what it refuses, is not the advisory it was meant to be.
//
// AND THE ANSWER WAS NEVER TRUSTWORTHY FROM HERE. This function runs in whatever process holds the
// door, and one of those is the CLI enqueuer in an OPERATOR'S SHELL — an environment that is not the
// one the units read. So a pass here would have been a pass about the wrong environment, on exactly the
// box that fails: the shape F41 is made of.
//
// The refusal lives at `driver/runner.mjs`'s intake wall, which is in the process that would actually
// dispatch the stage and is still BEFORE any spend — which is what 216 asks for. Saying it earlier at
// the portal's own door is worth doing and is a separate change, because it needs the portal's
// environment answered honestly rather than this process's.
