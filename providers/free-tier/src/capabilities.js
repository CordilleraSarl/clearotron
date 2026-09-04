// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── free-tier: EUIPO + the local US index, composed into ONE register ───────────────────────────────
//
//. Every other provider in this repo is a single vendor, and the doctrine at driver.config.mjs is
// explicit that only one runs at a time: "the single paid vendor — ONE at a time, NEVER both … There is
// no fallback/secondary register."
//
// That is right for paid vendors and IMPOSSIBLE for free ones. EUIPO covers the EU and nothing else;
// the local index covers the US and nothing else. A free-tier clearance that reaches both territories
// needs both sources serving one matter — so precedence applies BETWEEN tiers, never within one:
//
//   Tier 1  a paid vendor      corsearch | clarivate | signa — if configured it IS the register, alone.
//   Tier 2  the free tier      euipo + uspto-local, composed here into one synthetic provider.
//   None                       register-dependent work refuses BY NAME.
//
// FAN-OUT LIVES BELOW THE PROVIDER SEAM. The driver still sees exactly one provider: one plan, one `qid`
// namespace, one coverage skeleton, one ledger. Nothing above this file learns that two sources exist.
//
// ── THE CONTRACT IS DERIVED, AND POINTWISE-WEAKEST ──────────────────────────────────────────────────
//
// Not hand-written. A hand-copied capability set is a second copy of a fact that already exists, and it
// goes stale silently — the failure this whole phase was built to kill. So every field below is computed
// from the members, and the rule is always the WEAKEST member, never the strongest:
//
//   offices.covered      UNION           — the one field where composing genuinely adds reach
//   maxOrWidth           MIN             — 25, the US index's bound. Planning to EUIPO's 50 would emit
//                                          queries the index rejects, on a plan the driver believes.
//   predicates           INTERSECTION    — a predicate ANY member lacks is null here
//   countProbe           weakest of the two probe modes
//   nativeScriptIndex    true only if EVERY member says true; an undeclared member makes it undeclared
//   oppositions etc.     AND
//   kernel bounds        MIN
//
// Weakest-member costs nothing to disclose, because every step after it already exists: an
// intersected-away predicate stamps `unsupported` → the executor emits `error:true` + `deferred:true` →
// joinPlanToBands puts it in the `deferred` bucket → a disclosed coverage row on the face of the report.
// Taking the STRONGEST member instead would plan a query one source cannot run and call the result a
// clean — doctrine rule 2, exactly.
//
// ── WHY MEMBERSHIP IS STATIC, AND WHERE CONFIGURATION IS ANSWERED INSTEAD ───────────────────────────
//
// `covered` is ["EU","US"] always — it is NOT narrowed to whichever member happens to be credentialed.
// A capability contract is a frozen, dependency-free declaration of what a source CAN do. Making it read
// the environment would make the same provider answer differently on two boxes, and
// register-capabilities.mjs imports it statically at module load.
//
// The question that DOES depend on the box — which offices this deployment can reach right now — is
// answered in driver/register-availability.mjs, and the answer rides the plan as a disclosed
// `deferred_coverage` row. It is deliberately not answered here, and `covered` is deliberately not
// narrowed there either: 's admission gate reads this field to decide which territories a client may
// ORDER, so narrowing it to the configured half would refuse a US-only matter at the door instead of
// disclosing its US gap ('s ruling is that such a matter must START and disclose).
//
// ── THE "NO SHAPE FOR HALF OF THIS RAN" RULE IS UNCHANGED — IT MOVED THE SPLIT, NOT REPEALED IT ──────
//
// This file used to require BOTH members' credentials before any free-tier run, and the argument was
// sound: joinPlanToBands has exactly three outcomes per `qid` — executed, missing, deferred — and NO
// shape for "half of this ran". With one `qid` per entry (which the execution-receipt shape requires),
// an EU+US entry whose US half refuses must defer WHOLE, taking its EU coverage with it.
//
// That invariant still holds and is still load-bearing. What changed is WHERE the two offices
// part company: the unreachable office is split off at PLAN COMPILE, so every `qid` that reaches the
// executor is already single-office and no entry is ever half-run. The EU entry executes, the US entry
// is a disclosed deferral, and the composite never has to describe a half-searched band.
//
// Move that split any later — into the executor, or into a merge that returns EU rows and flags the
// band incomplete — and the original failure comes straight back. The rule that reads "refuse rather
// than half-run" is the reason the split is early, not an argument against splitting.
//
// What preflight still requires is the EU half (driver.config.mjs credEnv/credEnvAlso). A free tier with
// NO configured member is not a degraded free tier, it is an unconfigured one, and it refuses by name.
//
// ── DISJOINTNESS IS ENFORCED, BUT NOT HERE ──────────────────────────────────────────────────────────
//
// Members must cover disjoint offices, so `record_id` (`/mark/<office>/<provider-id>`) never has to
// match across sources and there is nothing to de-duplicate. That is checked in core.js and pinned by a
// test — deliberately NOT thrown from this module, because register-capabilities.mjs imports it at load
// and a throw here would take down every consumer, including the ones that never touch the free tier.
//
// NOTE ON MADRID, because it looks like a de-duplication case and is not: one WIPO base can appear as an
// EU designation and as a US §66(a) extension. Under the Madrid Protocol each designation confers, in
// its own Contracting Party, protection equivalent to a national registration — examined there,
// refusable there, opposable there, and independent of the basic mark after five years. Those are two
// rights in two territories as a matter of law. A clearance shows BOTH and must never merge them.

import { CAPABILITIES as EUIPO } from "../../euipo/src/capabilities.js";
import { CAPABILITIES as USPTO_LOCAL } from "../../uspto-local/src/capabilities.js";

/**
 * The members, in a fixed order. Order is not precedence — they are office-disjoint, so exactly one
 * member serves any given office — but it makes every derived list deterministic.
 */
export const FREE_TIER_MEMBERS = Object.freeze([EUIPO, USPTO_LOCAL]);
export const FREE_TIER_MEMBER_IDS = Object.freeze(FREE_TIER_MEMBERS.map((m) => m.id));

const members = FREE_TIER_MEMBERS;

// ── the derivation primitives ───────────────────────────────────────────────────────────────────────

/** AND across members. One member that cannot do it means the composite cannot promise it. */
const every = (pick) => members.every((m) => pick(m) === true);

/** MIN across members, ignoring nulls; null when every member declares null (= no bound). */
const minOrNull = (pick) => {
  const vals = members.map(pick).filter((v) => typeof v === "number" && Number.isFinite(v));
  return vals.length ? Math.min(...vals) : null;
};

/** MIN across members where every member must declare a number (the kernel bounds). */
const min = (pick) => Math.min(...members.map(pick).filter((v) => typeof v === "number"));

/**
 * A closed vocabulary where one value is strictly weaker than the others. `order` is weakest-first, so
 * the composite takes the earliest value any member declares.
 */
const weakest = (pick, order) => {
  const vals = members.map(pick);
  for (const candidate of order) if (vals.includes(candidate)) return candidate;
  // Every member agrees on something outside the ordering — take it rather than inventing a value.
  return vals[0];
};

/**
 * The TRI-STATE fields (nativeScriptIndex). true only when EVERY member declares true; null when any
 * member is undeclared; false otherwise. An undeclared member cannot be rounded to `false`: false says
 * "we probed, and it does not" and null says "nobody probed", and only one of those is honest.
 */
const triState = (pick) => deriveTriState(members, pick);

// ── offices ─────────────────────────────────────────────────────────────────────────────────────────

const FREE_TIER_OFFICES = Object.freeze([...new Set(members.flatMap((m) => m.offices.covered ?? []))]);

// The SUPERSET vocabulary: euipo speaks iso-3166-plus-eu (it has to — "EU" is not an ISO country) and
// the index speaks iso-3166. plus-eu contains iso-3166, so it names both members' inputs honestly.
const FREE_TIER_VOCABULARY = members.some((m) => m.offices.vocabulary === "iso-3166-plus-eu")
  ? "iso-3166-plus-eu" : members[0].offices.vocabulary;

/**
 * Translate through whichever member claims the code. resolveRegions calls this BEFORE the membership
 * check, so a code no member claims returns null and becomes a disclosed deferred jurisdiction — never a
 * filter quietly dropped.
 *
 * Members are office-disjoint, so at most one ever answers and the first-wins scan has no ambiguity to
 * resolve. (`ownerOf` in core.js relies on the same property to route.)
 */
function translateFreeTier(code) {
  for (const m of members) {
    const t = typeof m.offices.translate === "function" ? m.offices.translate(code) : null;
    if (t) return t;
  }
  return null;
}

/**
 * LAYER TABLES COMPOSE BY UNION, unlike the predicate contract one section down, and the asymmetry is
 * deliberate.
 *
 * Predicates INTERSECT because a predicate one member lacks would ride under the right tool name and
 * become a silently weaker query. A layer datum is the opposite kind of fact: it records what some
 * reachable register actually returns, and the composite genuinely does reach the union of its members'
 * offices. Members are office-disjoint, so no code is claimed by two tables and there is nothing to
 * reconcile.
 *
 * What does NOT compose is a gap: an absent entry stays absent and therefore stays `unestablished`, so
 * the composite can never inherit coverage neither member established.
 */
function composeLayers() {
  const out = {};
  for (const m of members) {
    for (const [code, entry] of Object.entries(m.offices?.layers ?? {})) {
      out[code] = Object.freeze({ ...(out[code] ?? {}), ...entry });
    }
  }
  return Object.freeze(out);
}

// ── predicates: INTERSECTION ────────────────────────────────────────────────────────────────────────
//
// The predicate contract is a CLOSED key set — every provider declares all seven, as a mode string or an
// explicit null. Union would be the silent-recall-loss version of this: a predicate one member lacks
// would ride under the right tool name and quietly become a weaker query on that source.

const PREDICATE_KEYS = Object.freeze(
  ["exact", "default", "wildcardPrefix", "wildcardSuffix", "wildcardInfix", "phonetic", "owner"]);

/**
 * The predicate intersection, as a PURE function of a member list.
 *
 * Exported and parameterised because the rule is not testable against the members that happen to exist
 * today: euipo and uspto-local both declare `phonetic: null` and both declare everything else, so union
 * and intersection give the identical answer and a test over the real pair pins NOTHING. The break
 * matrix found exactly that — inverting `some` to `every` here reddened no test. A third member with an
 * ability the other lacks is the case that matters, and it can be handed to this directly.
 */
export function derivePredicates(ms) {
  return Object.freeze(Object.fromEntries(PREDICATE_KEYS.map((k) => {
    const modes = ms.map((m) => m.predicates?.[k] ?? null);
    if (modes.some((v) => v === null)) return [k, null];
    // Every member can express it, but they express it DIFFERENTLY — the composite states each, because
    // one vendor's mode string here would be a lie about the sources that do not use it.
    return [k, ms.map((m, i) => `${m.id}: ${modes[i]}`).join(" | ")];
  })));
}

/**
 * The tri-state rule (nativeScriptIndex), pure. true only if EVERY member declares true; null if ANY is
 * undeclared; false otherwise. An undeclared member may not be rounded to `false` — false says "we
 * probed and it does not", null says "nobody probed", and only one of those is honest.
 */
export function deriveTriState(ms, pick) {
  const vals = ms.map(pick);
  if (vals.some((v) => v === null || v === undefined)) return null;
  return vals.every((v) => v === true);
}

/**
 * An optional declared list survives ONLY when every member declares it, and then only as the
 * intersection. A member that never declared the key contributes no empty set: intersecting against an
 * absent key would yield [] — "no value is queryable" — which is a different and false claim from
 * "undeclared".
 */
export function deriveOptionalList(ms, key) {
  // This guard is also what stops the reduce below throwing on a member that never declared the key —
  // and if it were removed, this module would fail AT IMPORT, taking register-capabilities.mjs and every
  // consumer with it. That is deliberate and is NOT the hazard the disjointness check was moved out of
  // capabilities.js to avoid: overlapping offices is a DATA condition a config change can create, so it
  // must not break unrelated consumers, whereas reaching the reduce with an undeclared key can only mean
  // the derivation itself was edited wrongly. A broken derivation should not be shippable, and a loud
  // module-load failure is the strongest available way of saying so.
  if (!ms.every((m) => Array.isArray(m[key]))) return undefined;
  return Object.freeze([...new Set(
    ms.reduce((acc, m) => acc.filter((s) => m[key].includes(s)), [...ms[0][key]]))].sort());
}

const FREE_TIER_PREDICATES = derivePredicates(members);

// ── the contract ────────────────────────────────────────────────────────────────────────────────────

export const CAPABILITIES = Object.freeze({
  id: "free-tier",
  label: "Free tier (EUIPO + USPTO local index)",

  // MEMBERSHIP, declared. A static fact about the provider — which sources it composes — not a
  // fact about any box, so it belongs on the contract like every other field here.
  //
  // driver/register-availability.mjs joins it to each member's own credential declaration to work out
  // which offices this deployment can actually reach. It is the only field a single-source provider
  // does not carry, and absent means "not composed"; the contract shape test pins that THIS provider
  // declares it, so an accidental deletion cannot quietly turn the availability check into a no-op.
  composedOf: FREE_TIER_MEMBER_IDS,

  // Both members page. If a future member were cursor- or single-shot-paged the composite could not
  // promise page semantics, so the ordering runs weakest-first.
  pagination: weakest((m) => m.pagination, ["single-shot", "cursor", "page"]),

  // "none" if ANY member cannot count — a total that silently omits one source's half is worse than no
  // total. Otherwise "cheap" if any member's probe is a BILLABLE page-0 search, because the composite
  // pays the most expensive member's price.
  countProbe: weakest((m) => m.countProbe, ["none", "cheap", "endpoint"]),
  countStatusFilter: weakest((m) => m.countStatusFilter, ["none", "live"]),

  // MIN. Planning to the wider member's bound emits queries the narrower one rejects.
  maxOrWidth: min((m) => m.maxOrWidth),

  classFilter: weakest((m) => m.classFilter, ["fanout", "native"]),
  screenSource: weakest((m) => m.screenSource, ["billed-record-fetch", "bulk-endpoint", "search-row"]),

  // The tightest ceiling any member imposes; null only when no member imposes one.
  resultCeiling: minOrNull((m) => m.resultCeiling),

  predicates: FREE_TIER_PREDICATES,

  offices: Object.freeze({
    vocabulary: FREE_TIER_VOCABULARY,
    translate: translateFreeTier,
    covered: FREE_TIER_OFFICES,
    layers: composeLayers(),
  }),

  ownerTermIntersection: every((m) => m.ownerTermIntersection),
  nativeScriptIndex: triState((m) => m.nativeScriptIndex),
  phonemeExpansion: every((m) => m.phonemeExpansion),
  oppositions: every((m) => m.oppositions),
  hasPublicRecordUrl: every((m) => m.hasPublicRecordUrl),

  // queryableStatuses is declared by EUIPO and NOT by the index. Intersecting an absent key would give
  // [] — "no status is queryable" — which is a different and false claim. So the composite declares it
  // only when every member does; otherwise it is absent, meaning undeclared, exactly as it is on the
  // member that does not declare it.
  ...(deriveOptionalList(members, "queryableStatuses") !== undefined
    ? { queryableStatuses: deriveOptionalList(members, "queryableStatuses") } : {}),

  kernel: Object.freeze({
    countProbe: weakest((m) => m.kernel.countProbe, ["none", "cheap", "endpoint"]),
    screenSource: weakest((m) => m.kernel.screenSource, ["billed-record-fetch", "bulk-endpoint", "search-row"]),
    pageSize: min((m) => m.kernel.pageSize),
    pageGuard: min((m) => m.kernel.pageGuard),
    ceilingDefault: min((m) => m.kernel.ceilingDefault),
    namesChunkDefault: min((m) => m.kernel.namesChunkDefault),
    providerWindow: minOrNull((m) => m.kernel.providerWindow),
  }),
});

/**
 * Which member serves an office code, or null. Exported so core.js routes through the SAME translate
 * the planner used — a second routing table would be a second copy of the office vocabulary, and those
 * two would disagree the first time a member's coverage changed.
 */
export function memberForOffice(code) {
  const want = translateFreeTier(code);
  if (!want) return null;
  for (const m of members) if ((m.offices.covered ?? []).includes(want)) return m;
  return null;
}

/** The offices two members both claim. Empty on a well-formed free tier; core.js refuses if it is not. */
export function overlappingOffices() {
  const seen = new Map();
  const clashes = new Set();
  for (const m of members) {
    for (const office of m.offices.covered ?? []) {
      if (seen.has(office)) clashes.add(office);
      else seen.set(office, m.id);
    }
  }
  return [...clashes].sort();
}
