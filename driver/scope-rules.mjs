// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// scope-rules.mjs — the (PRODUCT × scope) COMBINATION rules, in one place every door reads, and the
// fold of every check that needs the RESOLVED product (checkResolvedProduct, at the foot of this file).
//
// The product says "which machinery runs" (search-policy.mjs, over products.mjs) and scope says "where
// is it aimed" (effective-scope.mjs). Some PAIRS of those answers are incoherent, and until now nothing
// server-side said so: a native-language deepening ordered over MCP with an empty or worldwide scope
// passed every gate and ran ZERO lanes in silence — billed for the deepening, delivered without it
// (decideJxLanes simply finds no adapter jurisdiction and skips; checkScopeAgainstPolicy early-returns
// for clearance pipelines). The ruling existed only in the portal's TypeScript, which is not a wall: it
// is one of the FOUR doors.
//
// No env, no switch names, no I/O of its own — these sentences reach client assistants and client
// browsers, and "add one of China (CN) …" is actionable in a way that naming an internal variable never
// is. Untrusted territory tokens are echoed JSON-stringified, the rule resolveSearchPolicy already
// states (search-policy.mjs, review 2026-07-17): these messages ride .failed.reason files, outbox
// packets and log lines, so a newline-bearing entry must never inject rows into them.
//
// WHICH SCOPE THIS MEASURES: `resolveEffectiveScope` — the SAME ladder both previews already report
// from (this request → the saved search's scope → the project/account defaults). An earlier draft of
// this module measured `scopeJurisdictions(job, profile)` instead, on the grounds that a recipe's saved
// scope is display-only at runtime. That is one ruler too many: plan_run returns, in ONE response
// object, "territories: China (from the saved search)" and — from the other ruler — a blocker saying
// the scope contains no routing territory. Two ladders that must agree forever is the shape this
// codebase already rejected for validateJob (correction, 2026-07-27).
//
// The two rulers now agree at runtime as well: `foldRecipeScope` (pipeline.mjs, audit N3) writes the
// same ladder into the job on every pass, so what decideJxLanes reads IS what this module measures. The
// one thing left that can empty a deepening is the account's own lane configuration, and that is a
// WARNING here rather than a refusal — see the jx block below.

import { decideJxLanes, JURISDICTION_ADAPTERS } from "./jx-lanes.mjs";
import { policyFor, checkMarkBudget, checkScopeAgainstPolicy } from "./search-policy.mjs";
import { resolveEffectiveScope } from "./effective-scope.mjs";
import { TERRITORY_TO_CODE, normalizeTerritory } from "../providers/_shared/territory-codes.mjs";
import { partitionTerritories } from "./territory-tiers.mjs";
import { checkProductScope, checkNativeLanguage, quoteTerritory } from "./products.mjs";
import { BRAND } from "../shared/brand.mjs";   // — the operator name in a rendered warning, from the tenant seam

// The routing territories, named the way a requester names them. Built by REVERSE lookup of the shared
// vocabulary rather than typed out here: a second spelling of "Hong Kong" that drifts from the bridge
// would tell someone to send a value the bridge rejects. First key per code wins, which is why the
// vocabulary lists the canonical name first ("MACAU" before "MACAO", "SOUTH KOREA" before "KOREA"). A
// code with no display name falls back to itself — and the unit test refuses that outcome, so a new
// adapter jurisdiction cannot ship with an unspeakable name.
const TITLE = (s) => String(s).split(" ").map((w) => w.slice(0, 1) + w.slice(1).toLowerCase()).join(" ");
export const ROUTING_NAMES = Object.freeze(Object.fromEntries((() => {
  const firstName = new Map();
  for (const [name, code] of Object.entries(TERRITORY_TO_CODE)) if (code && !firstName.has(code)) firstName.set(code, name);
  return Object.keys(JURISDICTION_ADAPTERS).map((code) => [code, firstName.has(code) ? TITLE(firstName.get(code)) : code]);
})()));

// "China (CN), Hong Kong (HK), …" — adapter-table order, so the list reads as the capability table it is.
const ROUTING_LIST = Object.entries(ROUTING_NAMES).map(([code, name]) => `${name} (${code})`).join(", ");

// A requester-supplied token, quoted the way resolveSearchPolicy quotes a selector — clamped as well as
// quoted, and defined in products.mjs because that module writes every other client sentence about scope.
// One clamp, one injection test over both sentences; a local copy here would be the half nobody checks.
const echo = quoteTerritory;

/**
 * The territories this run resolves to, canonicalized the way the lane adapters key them.
 *
 * Region CODES through the shared vocabulary — the portal composer submits "China" and the adapter table
 * keys on CN — with unknown names keeping their uppercased original, which is scopeJurisdictions' own
 * convention (jx-lanes.mjs) applied to the ladder instead of to job||profile.
 *
 * The worldwide/global/all tokens are DROPPED rather than uppercased. They are a mode, not a territory,
 * and counting one as a territory is exactly what let a worldwide deep dive read as "one country".
 * validateJob clears them off a job at the door, but the ladder's other two rungs — a saved search's
 * scope and an account's default territories — never pass through validateJob at all, and
 * `defaultJurisdictions` is a free-text lines field in the staff profile editor (review 2026-07-27).
 * Which entries those are is territory-tiers.mjs's answer, so this module and the door cannot disagree
 * about what "worldwide" is spelled like.
 */
const canonicalize = (list) => [...new Set(partitionTerritories(list).named.map((x) => {
  const code = normalizeTerritory(x);
  return code || String(x).trim().toUpperCase();
}).filter(Boolean))];

/**
 * The clearance combination rules for one prospective run.
 *
 * @param job      the validated job (normalized: validateJob has already cleared the worldwide tokens)
 * @param profile  the EFFECTIVE profile, for its default territories — the scope a request that names
 *                 none actually runs at, which is the scope these rules must judge
 * @param resolved the resolved search policy (components/pipeline/caseLaw/stageLabel/recipeScope)
 * @param profileReadable false when profile resolution ERRORED — as against a request that legitimately
 *                 has no profile at all, whose empty scope IS the scope it would run at
 * @returns {{errors: string[], warnings: string[]}} — the checkScopeAgainstPolicy shape, so every door
 *          folds it exactly the way it already folds the budget and scope-fit checks
 */
export function checkClearanceScopeRules({ job = null, profile = null, resolved = null, profileReadable = true } = {}) {
  const errors = [], warnings = [];
  // TWO READINGS OF ONE LADDER, and the split is the point. `named` is the resolved scope AS THE
  // REQUESTER (or their account, or their saved search) WROTE IT; `scope` is the same list canonicalized
  // to the codes the lane adapters key on.
  //
  // Everything a CLIENT reads quotes `named`. This module was the one caller that discarded the
  // originals, so the wall refused a two-country Full country search naming "GB", "FR" while the door
  // refused the identical request naming "United Kingdom", "France" — products.mjs:141 states exactly
  // that failure ("a refusal that quotes \"EU\" at someone who typed \"European Union\" sends them
  // hunting for a value they never used") and territory-tiers.mjs restates it for partitionTerritories.
  // The COUNT is the same either way: canonicalize dedups on code and products.mjs `tally` dedups on
  // territoryKey, which is the same identity.
  //
  // `scope` survives for the ONE consumer that needs codes — the JURISDICTION_ADAPTERS lookup and
  // decideJxLanes below, which are keyed by region code and cannot read "United Kingdom".
  const named = resolveEffectiveScope(job ?? {}, profile, resolved).jurisdictions ?? [];
  const scope = canonicalize(named);
  // Nothing measurable: with no readable profile the account's default territories are unknown, so "this
  // request resolves to no territory" would be a claim about a scope nobody saw. But when the request —
  // or the saved search it names — DOES name territories, the profile is irrelevant to the count and the
  // rules still bite. Skipping them there is how a roster-blind deployment (profile_key_unknown → the
  // fail-open to prelim) would admit a three-country deep dive at the wall itself (review 2026-07-27).
  if (!profileReadable && !scope.length) return { errors, warnings };
  // Quoted AS WRITTEN, worldwide tokens dropped (a mode is not a place — territory-tiers.mjs answers
  // which entries those are, so this module and the door cannot disagree about the spelling of
  // "worldwide"). The code list is what routes; the written list is what a person is shown.
  const where = scope.length ? partitionTerritories(named).named.map(echo).join(", ") : "worldwide";
  const label = resolved?.stageLabel ? `${resolved.stageLabel} ` : "";

  // ── THE NATIVE-LANGUAGE INVESTIGATION AGAINST THE PRODUCT THAT WILL ACTUALLY RUN ──────────────────
  //
  // `nativeLanguage: true` is the offering's ONE toggle and it belongs to ONE product. validateJob
  // refuses it — but only when the request SPELLS OUT a product, because that is all a door can see.
  // Omit `product` and the identical request was accepted, priced as nothing, and dropped: the resolver
  // reports `nativeRequested: true` with `components.jxLanes: false`, the routing rule below is gated on
  // the component and stays silent, and no lane ever runs. Same hole through the recipe arm (a saved
  // `nativeLanguage: true` over a knockout base) and through any account whose defaultProduct does not
  // carry it.
  //
  // That is the shape products.mjs:293 refuses `caseLaw` for in as many words — "a flag accepted and
  // dropped is the worst available shape: whoever sent it believes they bought the deep reading, and
  // nothing anywhere disagrees" — and it was this build's own doctrine broken by this build's own code.
  //
  // GATED ON `resolved.nativeRequested`, which is where the resolver already records WHO asked (the job
  // field OR the saved search's own copy), so the recipe arm is covered by construction rather than by a
  // second read of the recipe here. Same sentence as the door's, from the same module.
  if (resolved?.product && resolved?.nativeRequested === true) {
    const verdict = checkNativeLanguage({ product: resolved.product });
    if (!verdict.ok) errors.push(verdict.message);
  }

  // ── the native-language ROUTING rule: an investigation that routes on territory needs one ─────────
  // Without this the run is not wrong, it is EMPTY: the lane table is keyed by region, nothing matches,
  // and the half that was paid for quietly does not happen.
  //
  // GATED ON `nativeRequested`, NOT ON THE COMPONENT. On a Full country search the investigation is
  // AUTOMATIC — the client did not ask for it and is not charged a toggle for it — so a country with no
  // adapter has simply nothing to route, and refusing the request would be refusing a shape we chose for
  // them. On a Multi-country focus search it is the one toggle in the offering, somebody ticked it, and
  // an empty lane is a thing they bought and will not get. Same component, two different facts about who
  // asked; the resolver records which (search-policy.mjs).
  if (resolved?.components?.jxLanes && resolved?.nativeRequested === true) {
    if (!scope.some((j) => JURISDICTION_ADAPTERS[j])) {
      errors.push(`the ${label}native-script deepening routes on territory, and this request's scope (${where}) contains none of its routing territories — add one of ${ROUTING_LIST} to jurisdictions (e.g. ["China"]), or run the standard preliminary without the deepening`);
    } else if (!Object.keys(decideJxLanes({ job: { ...(job ?? {}), jurisdictions: scope }, profile, searchPolicy: resolved }).lanes ?? {}).length) {
      // The scope routes and the machinery STILL decides no lane. Asked of decideJxLanes itself rather
      // than re-derived from the adapter table, because the table is only half its decision: a lane the
      // account set to "off" in its jxPolicy is skipped, and adapter-table membership cannot see that —
      // the run is priced and labelled Depth 5 and no deepening happens, the failure this module exists
      // to stop, reached from the other side.
      //
      // Asked about the LADDER's scope, which is the scope the run will have: foldRecipeScope writes the
      // saved search's territories into the job before decideJxLanes ever reads it, so a recipe-scoped
      // request is not the cause here and must not be told to "name the territory on the request".
      //
      // A WARNING, not a refusal: the remedy belongs to the account's configuration, not the requester's
      // request, and "add one of China (CN) …" would be wrong advice for a territory already in scope.
      warnings.push(`the ${label}native-script deepening has no lane to run for this request — its routing territories are in scope (${where}), but this account has that deepening switched off for them. Ask ${BRAND.name} to turn it back on, or run the standard preliminary without it`);
    }
  }

  // ── THE PRODUCT AGAINST THE SCOPE IT WILL ACTUALLY RUN AT ─────────────────────────────────────────
  //
  // validateJob already judges this against what the REQUEST states, at the door every caller shares.
  // What it cannot see is the scope that only exists once the account's (or the saved search's) own
  // territories are folded in — and that is the scope the run will have. An account holding seven default
  // territories turns a request that named none into a Multi-country focus search; an account holding
  // exactly one turns it into a Full country search, case law and all, out of an empty field. Neither is
  // a narrower reading of what was asked for: they are different products.
  //
  // SO THE SAME MODULE ANSWERS TWICE, on two different scopes, in the SAME sentence. Somebody refused
  // here reads what somebody refused at the door reads, which is the parity this build exists to
  // establish — and the message names the product to order instead, computed from this very scope.
  //
  // WHAT WENT, AND WHY IT HAD TO: the rule here was `caseLaw && scope.length !== 1`, a proxy for "one
  // country" that was wrong three ways. `["European Union"]` canonicalizes to `["EU"]` — one entry,
  // twenty-seven countries — and waved a regional deep dive straight through. normalizeTerritory passes
  // ANY two-letter input through uppercased, so a typo'd `"QQ"` counted as a country that names nowhere.
  // And it exempted the knockout pipeline, on the grounds that the lever was never read there. Case law
  // is not a lever any more, so there is nothing left to key a special case on: the product states the
  // geography it accepts, and this asks whether the run has it.
  //
  // decideCaseLaw's OTHER arm is untouched — a run whose own reading turns up an opposition or a
  // precedent still grounds the stage mid-flight, unordered and unblocked. This judges what was BOUGHT.
  //
  // FED THE LIST AS WRITTEN, never the canonicalized one — see the two-readings note at the top. The
  // wall and the door now quote the same territories back at the same requester.
  if (resolved?.product) {
    const verdict = checkProductScope({ product: resolved.product, territories: named });
    if (!verdict.ok) errors.push(verdict.message);
  }

  return { errors, warnings };
}

// ── THE RESOLVED-PRODUCT GATE — every check that can only be made once the product is known ──────────
//
// Three checks used to live at three different subsets of the doors (Finding 2's matrix): the mark
// budget and the scope-fit ran at the runner and plan_run only, the combination rules at the runner, the
// portal and plan_run. start_run and the CLI ran none of them. So the same request was queued by one
// door and refused hours later, at claim, by another — and every dash in that matrix was a request
// somebody paid a queue claim and a wait for.
//
// ONE FOLD, and every door calls it. Which door caught a request can no longer change the answer,
// because there is no per-door list to keep in step.
//
// WHAT IS NOT HERE: the availability gate. It judges the DEPLOYMENT ("is this machinery built, can the
// wired register count"), not the request, and it deliberately speaks in two registers — staff prose
// with the machinery named (gateResolvedPolicy, for the runner's clarify path and the logs) and a CAUSE
// the client-facing surfaces word themselves (gateCause/UNAVAILABLE_NOTE). Folding it in here would put
// one of those two on the wrong surface. door-gates.mjs runs it beside this, and search-policy.test.mjs
// already pins the two answers null-equivalent over the whole matrix.
export const RESOLVED_CHECKS = Object.freeze(["mark-budget", "scope-fit", "scope-rules"]);

/**
 * Every rule that needs the RESOLVED product, folded once.
 *
 * @param job      the validated job (validateJob has normalized it)
 * @param profile  the EFFECTIVE profile, or null when resolution could not read one
 * @param resolved resolveSearchPolicy's answer — NOT a `{clarify}` (the caller relays that verbatim)
 * @param profileReadable false when profile resolution ERRORED, as against an account with no profile
 * @returns {{errors: string[], warnings: string[], byCheck: Object}} — `byCheck` is the same errors
 *          split by RESOLVED_CHECKS name, so a parity test can assert per-check coverage without
 *          re-deriving which sentence belongs to which rule.
 */
export function checkResolvedProduct({ job = null, profile = null, resolved = null, profileReadable = true } = {}) {
  const errors = [], warnings = [], byCheck = {};
  if (!resolved || resolved.clarify) return { errors, warnings, byCheck };
  const policy = policyFor(resolved.product);
  const run = {
    // Name count on the RESOLVED product. The clearances say ONE name and always have; an explicit
    // product is budgeted at the door already, a profile-default or scope-derived one only here.
    "mark-budget": () => checkMarkBudget(job, policy),
    // Scope against the machinery: a knockout has no marketplace grid for a named platform to be swept
    // in, so naming one is the accept-and-ignore shape rather than a narrower search.
    "scope-fit": () => checkScopeAgainstPolicy(job, policy),
    // The (product × scope) combination rules, on the scope the run will actually have.
    "scope-rules": () => checkClearanceScopeRules({ job, profile, resolved, profileReadable }),
  };
  for (const name of RESOLVED_CHECKS) {
    const r = run[name]();
    byCheck[name] = r.errors;
    errors.push(...r.errors);
    warnings.push(...r.warnings);
  }
  return { errors, warnings, byCheck };
}
