// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// register-coverage.mjs — what the WIRED register can actually be asked for, in the vocabularies the
// doors already speak: composer display names, and the four products.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────
//
// What a register covers was a deployment fact that reached no door. A client picked territories and
// products the wired register cannot serve, paid, and found out in the delivered report's coverage
// section. `resolveRegions` already computed the answer correctly — at compile time, inside the
// pipeline, after the money button.
//
// On the free tier that is not an edge case, it is the normal state: an EUIPO-only instance can
// honestly sell two of four products, with the US index three.
//
// ── WHY THE ANSWER CANNOT BE COMPUTED FROM `covered` ALONE ──────────────────────────────────────────
//
// `capabilities.offices.covered` is in each provider's OWN vocabulary — that is what `offices.vocabulary`
// declares. euipo and uspto-local hold ISO codes, clarivate holds compumark registration-office codes,
// and signa holds lowercase Signa keys. So `territoryTier(office)` is meaningless over a raw covered
// set, and "does this register reach Germany" is only answerable by running the provider's own
// `translate` — a FUNCTION, which no JSON snapshot can carry.
//
// Hence the split, and it is the whole design:
//
//   · the office vocabulary never leaves this module. Everything downstream — snapshot, wire, UI —
//     speaks COMPOSER DISPLAY NAMES, which are provider-independent and tierable.
//   · a caller that has capabilities (the flag-snapshot writer, which runs in the engine environment)
//     computes the display-name set once. A caller that has only the snapshot (portal-service, the MCP
//     door, dev-portal) reads that set and never re-derives it.
//
// ── AND WHY IT DELEGATES TO resolveRegions RATHER THAN RE-IMPLEMENTING IT ───────────────────────────
//
// Five vocabularies sit between a display name and a covered office: display → `normalizeTerritory` →
// `canonicalJurisdictionCode` → `offices.translate` → `covered.has`. `register-plan.mjs:206-216` records
// the copper-bastion incident from re-implementing that chain — the composer submitted display names,
// corsearch's ISO-passthrough translate sent them to the wire verbatim, the vendor answered 500 rather
// than 400, and recovery burned its park budget re-sending a query that could never succeed.
//
// So this asks `resolveRegions` one name at a time and reads whether the name came back deferred. It is
// 37 calls once per snapshot, and it CANNOT drift from what the pipeline will do, because it is the same
// function the pipeline calls.
// ── IMPORT WEIGHT IS PART OF THE DESIGN ─────────────────────────────────────────────────────────────
//
// search-policy.mjs imports this file, and its own header calls itself "a leaf that every consumer in
// the engine imports (and profiles.mjs imports it, so a cycle is one careless import away)". So the
// STATIC graph here stays as light as products.mjs's own: compose-read.mjs imports only products.mjs
// and has no top-level statements; territory-tiers.mjs is pure by declaration.
//
// register-plan.mjs is the heavy one, and only `coveredTerritoryNames` needs it — a function called
// once per snapshot, by a writer that is already async. So that import is DYNAMIC, and search-policy
// never pulls the plan layer in to answer a question about a product menu.
import { PROMPT_TERRITORIES } from "./compose-read.mjs";
import { territoryTier } from "./territory-tiers.mjs";

/**
 * The composer display names this register can actually search.
 *
 * @returns `null`   — NO declared restriction. The provider is a global aggregator with no enumerable
 *                     covered set (corsearch declares exactly this). Every territory stays offerable.
 *                     NEVER an empty array, and never expanded into "all the names we happen to know":
 *                     an enumeration would silently drop any territory added to the composer later.
 *          `[...]`  — the names it reaches, in PROMPT_TERRITORIES order.
 *
 * An empty array is a legitimate return only for a provider that declares `covered: []`, which no
 * provider does and which `register-capabilities.test.mjs` forbids — see coveredTerritoryNames's own
 * test. It is not the shape "unknown" takes; unknown is the caller omitting the field entirely.
 */
export async function coveredTerritoryNames(capabilities, names = PROMPT_TERRITORIES) {
  if (!Array.isArray(capabilities?.offices?.covered)) return null;
  const { resolveRegions } = await import("./register-plan.mjs");
  return Object.freeze(names.filter((name) => {
    const { regions, deferred } = resolveRegions([name], capabilities);
    return deferred.length === 0 && regions.length > 0;
  }));
}

// ── the product half ────────────────────────────────────────────────────────────────────────────────
//
// Keyed on the `geography` requirement from products.mjs, VERBATIM, because that string is the product's
// own statement of what it needs and duplicating it as a second predicate is how the two drift. The set
// is closed and `register-coverage.test.mjs` asserts the bijection against PRODUCTS, so a product added
// with a new geography phrase fails a test rather than defaulting to offerable.
//
// Each rule reads the covered DISPLAY NAMES through `territoryTier`, which is where the EU trap lives:
// `["European Union"]` is ONE entry and it is a REGION, not a country. territory-tiers.mjs:4-8 already
// records the incident from counting it as one country — a full deep dive over a 27-state region passed
// the one-country rule unchallenged.
const GEOGRAPHY_RULES = Object.freeze({
  // Any set of territories will do, so anything the register reaches is enough.
  "worldwide, or any set of territories": (t) => t.length > 0,
  // Worldwide AND NOTHING ELSE — the client cannot narrow this one, so the register must reach
  // everywhere the client could have asked about.
  //
  // THE OBVIOUS READING, AND IT IS A JUDGEMENT THE ISSUE DID NOT RULE ON. gives one case: an
  // EUIPO-only register, where "one office is not worldwide". It does not say where the line falls for
  // a register covering many.
  //
  // `covered: null` alone would have been the tidy rule and it is WRONG, because it contradicts shipped
  // behaviour: register-plan.mjs already rules that on an enumerable provider a worldwide matter sweeps
  // EVERY office it covers ("the RegistrationOfficeCode enum is the vendor's entire coverage, the spec
  // sets no maxItems"), and clarivate runs exactly that today. Refusing to OFFER what the pipeline
  // already runs would be a regression dressed as a fix.
  //
  // So the line is the composer's own vocabulary: a worldwide search is offerable when the register
  // reaches every territory a client can name on the form. That is not proof of global coverage — the
  // form lists 37 places and the world has more — but it is the only universe in which the offer and
  // the request are expressed, and it refuses the case the issue actually names.
  "worldwide, and nothing else": (t, all) => all.every((n) => t.includes(n)),
  // A region, or two or more countries.
  "a region, or two or more countries": (t) =>
    t.some((n) => territoryTier(n) === "region") || t.filter((n) => territoryTier(n) === "country").length >= 2,
  // Exactly one country — so the register must hold at least one COUNTRY. An EU-only register does not:
  // the EU is a region, and an EU trade mark is not a substitute for a national DPMA/INPI/BOIP right.
  "exactly one country": (t) => t.some((n) => territoryTier(n) === "country"),
});

/** The geography phrases this module knows how to rule on. Exported for the closed-set assertion. */
export const KNOWN_GEOGRAPHIES = Object.freeze(Object.keys(GEOGRAPHY_RULES));

/**
 * Why this product cannot be ordered against the wired register — as a CAUSE, never a sentence.
 * `search-policy.mjs UNAVAILABLE_NOTE` owns the words, exactly as it does for `register-cannot-count`.
 *
 * @param geography  the product's own `geography` string from products.mjs
 * @param territories what `coveredTerritoryNames` returned, or `undefined` when it is not known
 * @returns null — orderable, OR the register's coverage is unrestricted or unknown
 *
 * FAILS OPEN on `null` (unrestricted) and on `undefined` (a snapshot written before this shipped, or a
 * provider whose capabilities threw). An older deployment must keep offering what it always offered;
 * refusing on absence would grey out all four products on every box whose snapshot predates this file,
 * and that reads to a client as an outage.
 */
/**
 * ── D6 — THE TERRITORIES THIS PRODUCT CAN BE POINTED AT ─────────────────────
 *
 * The universe a coverage sentence must count against, and it is the PRODUCT's rather than the form's.
 * A Full country search reads exactly one COUNTRY and offers no regions, so "the register reaches 3 of
 * 37" would be counting a denominator that product cannot use — and on that product the interesting
 * fact is precisely whether the register reaches any COUNTRY at all, which is what its rule tests.
 *
 * MIRRORS `offerableFor` in the browser's composerProduct.ts, which decides the same thing for the
 * picker. The two are the same question asked on two sides of the wire, and a coverage sentence that
 * counted a different set from the one the picker offers would be a third answer.
 */
export function offerableTerritories(geography, all = PROMPT_TERRITORIES) {
  return geography === "exactly one country" ? all.filter((n) => territoryTier(n) === "country") : all;
}

export function registerCoverageCause(geography, territories, all = PROMPT_TERRITORIES) {
  if (territories === null || territories === undefined) return null;
  const rule = GEOGRAPHY_RULES[geography];
  // An unknown geography phrase is offerable. The closed-set test is the wall — a runtime refusal here
  // would turn "somebody added a product" into an outage on that product, which is worse than the test
  // that already catches it before it ships.
  if (!rule) return null;
  if (rule(territories, all)) return null;
  return geography === "worldwide, and nothing else" ? "register-not-worldwide" : "register-coverage";
}
