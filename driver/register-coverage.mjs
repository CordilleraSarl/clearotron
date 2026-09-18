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
import { territoryTier, territoryKey } from "./territory-tiers.mjs";

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

// ── the REQUEST half ────────────────────────────────────────────────────────────────────────────────
//
// The product half above asks whether a PRODUCT can be ordered at all. This asks whether THIS request's
// territories can be searched. Two questions, two rulings, deliberately not folded together:
//
//   · the PRODUCT-level refusal was retired on 2026-08-31 and stays retired — a worldwide search is
//     orderable on a partial register and the gap is DISCLOSED in the report.
//     `coverage-is-disclosed-never-refused.test.mjs` pins that, and this function must never make it red.
//   · the REQUEST-level refusal was ruled on 2026-09-17: a requester who NAMES a territory the wired
//     register cannot search is told so BEFORE the run. That gap is not disclosable — there is no result
//     to caveat, only a territory the client asked about and would never hear another word on.
//
// AN EMPTY LIST IS THE "NAMES NO TERRITORY" STATE, BY CONSTRUCTION, and that is why no mode string is
// read here. `effective-scope.mjs`'s ladder answers `[]` for a worldwide stamp — worldwide accepts no
// narrowing, so the account's defaults are not consulted — and `[]` again when no layer set a territory.
// So "a search that names no territory always runs" falls out of the empty set passing. A saved account
// default that DID reach the ladder is in the list and is judged with the rest, which is the ruling of
// 2026-09-17 on that question: a default counts as named once it reaches the engine.
//
// AND A NAME THE SNAPSHOT CANNOT SPEAK TO FAILS OPEN. `registerTerritories` is scoped to the composer's
// 37 display names. The other doors are not: `normalizeTerritory` passes any two-letter token through, so
// the CLI and start_run can name `VN`, which is inside clarivate's own 186-office enum and outside those
// 37. A bare membership test would refuse a search this engine runs today. Only a territory the
// snapshot's vocabulary can SPEAK TO is judged, and everything else is the pipeline's to defer as now.

/** Composer display name for a canonical key, so a refusal says "China" whether the requester wrote
 *  "China", "cn" or "CN". Built per call from the same list the covered set is scoped to. */
function displayByKey(all) {
  const out = new Map();
  for (const name of all) out.set(territoryKey(name), name);
  return out;
}

/**
 * The territories this request NAMES that the wired register cannot search, as composer display names.
 *
 * @param territories        the resolved territories — `effective-scope.mjs`'s ladder answer
 * @param registerTerritories what `coveredTerritoryNames` returned: `[...]`, `null` (no declared
 *                            restriction) or `undefined` (the snapshot does not say)
 * @returns `[]` — nothing to refuse, INCLUDING on `null` and `undefined`, which fail open exactly as
 *          they do at every other layer. Never treat an empty return as "the check did not run".
 *
 * Both sides are compared through `territoryKey`, which is the identity function this tree already has
 * for "what makes two spellings the same place" — it folds EM/EUTM/EUIPO to EU and UK to GB. That fold
 * is the whole of requirement 2: an EU-covering register refusing a request that names "European Union"
 * was the defect measured on 2026-09-17, and it cannot recur while both sides go through one authority.
 */
export function uncoveredTerritories(territories, registerTerritories, all = PROMPT_TERRITORIES) {
  if (registerTerritories === null || registerTerritories === undefined) return [];
  const covered = new Set(registerTerritories.map(territoryKey));
  const display = displayByKey(all);
  const out = [];
  const seen = new Set();
  for (const t of territories ?? []) {
    const key = territoryKey(t);
    // Outside the snapshot's vocabulary ⇒ this register's covered list says nothing about it. Fail open.
    if (!key || !display.has(key) || covered.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(display.get(key));
  }
  return out;
}

// One-line join rather than an import: this module's header makes its static graph part of the design
// ("search-policy.mjs imports this file … a cycle is one careless import away"), and the only other
// spelling of this lives behind scope-facts.mjs, which is not a leaf.
const joinAnd = (parts) => (parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`);

/**
 * The door's sentence for a request naming territories the wired register cannot search — or null.
 *
 * WRITTEN ONCE, FOR EVERY DOOR. Wording approved by the owner on 2026-09-17, including naming the wired
 * register, which the composer's own design note otherwise forbids on screen. The remedy clause is his
 * addition of the same day: a caller with no screen — start_run, the CLI — has to be able to act on this
 * sentence alone, on the next call.
 *
 * IT POINTS BACK RATHER THAN REPEATING. The first draft named the territories twice ("remove China and
 * Japan"); the owner ruled on the plural the same day — "remove them", no need to repeat the countries —
 * and the singular follows the same reason, since it repeated its one country for no better cause. The
 * sentence already names them, so a screenless caller still has every territory it must drop.
 *
 * @param registerLabel the register's display label. Absent on a snapshot written before it was carried,
 *                      and the sentence simply does not name it then rather than naming a key.
 */
export function registerReachRefusal(uncovered, registerLabel = null) {
  if (!uncovered?.length) return null;
  const names = joinAnd(uncovered);
  const register = String(registerLabel ?? "").trim();
  const where = register ? `${register}, the register configured here` : "the register configured here";
  return `${names} ${uncovered.length === 1 ? "is" : "are"} not available with ${where}`
    + ` — remove ${uncovered.length === 1 ? "it" : "them"} to run this search.`;
}

// ── WHAT THE FORM SHOULD OFFER: EVERY PLACE A REGISTER THIS PRODUCT SUPPORTS CAN SEARCH ────────────────
//
// The form offered 37 places with no rule behind them: Bulgaria and Greece, but not Denmark, Portugal,
// Vietnam or Colombia, while a worldwide search on the wider register already swept every one of its 186
// offices. The rule is the registers' own reach: a place is offered when at least one supported register
// provider can search it, decided by the SAME resolution the plan compiler runs (`resolveRegions`, one code
// at a time), so the offer cannot promise a place the compiler would defer everywhere. What THIS install's
// register does not reach is marked per deployment by `coveredTerritoryNames` and the door's refusal — the
// offer is the product's; the marking is the install's.
//
// A provider with no enumerable coverage (a global aggregator declaring `covered: null`) widens nothing:
// "everywhere" is not a list, and letting it in would offer every code the engine holds, including places
// no register answers for.
//
// NAMES ARE NEVER WRITTEN HERE. A place the form already offers keeps its shipped label; any other is named
// by the runtime's standard English region names (CLDR), the same data the territory vocabulary already
// resolves typed names against. A code with neither — the regional systems no label exists for — is left
// out and listed, never given a name composed in code. Provider extension codes (X-, ZZ) are not places.
//
// @returns {Promise<{ offered: {code: string, name: string}[], unnamed: string[] }>}  regions first, then
//          countries by name.
export async function searchableTerritories() {
  const [{ KNOWN_JURISDICTION_CODES, canonicalJurisdictionCode }, { normalizeTerritory }, { PROVIDER_CAPABILITIES }, { resolveRegions }]
    = await Promise.all([import("./jurisdiction-codes.mjs"), import("../providers/_shared/territory-codes.mjs"),
      import("./register-capabilities.mjs"), import("./register-plan.mjs")]);
  const enumerable = Object.values(PROVIDER_CAPABILITIES).filter((caps) => Array.isArray(caps?.offices?.covered));
  const shippedName = new Map(LABELS_OFFERED_BEFORE_THE_RULE.map((n) => [canonicalJurisdictionCode(normalizeTerritory(n) ?? ""), n]));
  let cldr = null;
  try { cldr = new Intl.DisplayNames(["en"], { type: "region" }); } catch { cldr = null; }
  const offered = [], unnamed = [];
  const seen = new Set();
  for (const raw of KNOWN_JURISDICTION_CODES) {
    const code = canonicalJurisdictionCode(raw);
    if (!code || seen.has(code) || /^(X.|ZZ)$/.test(code)) continue;
    seen.add(code);
    const searched = enumerable.some((caps) => {
      const { regions, deferred } = resolveRegions([code], caps);
      return deferred.length === 0 && regions.length > 0;
    });
    if (!searched) continue;
    let name = shippedName.get(code) ?? null;
    if (!name && cldr) { try { const n = cldr.of(code); if (n && n !== code && !/^unknown/i.test(n)) name = n; } catch { /* no name */ } }
    if (!name) { unnamed.push(code); continue; }
    offered.push({ code, name });
  }
  // Regions first, in the order the form already showed them; then countries by name.
  const regional = new Set(["EU", "BX", "AP", "OA", "EA", "WO"]);
  const shippedAt = (t) => { const i = LABELS_OFFERED_BEFORE_THE_RULE.indexOf(t.name); return i < 0 ? Infinity : i; };
  offered.sort((a, b) => (regional.has(b.code) - regional.has(a.code))
    || (regional.has(a.code) ? shippedAt(a) - shippedAt(b) : 0) || a.name.localeCompare(b.name, "en"));
  return { offered, unnamed: unnamed.sort() };
}

// THE 37 LABELS THE FORM CARRIED BEFORE THIS RULE, frozen. They are shipped strings, so each place keeps
// the label a client already reads — "Hong Kong", "Macau", "Turkey", where the runtime's standard names
// differ — and the two regional systems whose only names are these. Frozen HERE rather than read from the
// form's live list, because that list is now minted FROM this function, and a rule that read its own
// output would lose its labels the first time the file was regenerated from scratch.
export const LABELS_OFFERED_BEFORE_THE_RULE = Object.freeze([
  "European Union", "Benelux", "African Regional (ARIPO)",
  "United States", "United Kingdom", "Ireland", "France", "Germany", "Spain", "Italy", "Netherlands",
  "Switzerland", "Austria", "Sweden", "Norway", "Poland", "Bulgaria", "Greece", "Turkey", "Canada",
  "Mexico", "Brazil", "Argentina", "China", "Hong Kong", "Taiwan", "Macau", "Japan", "South Korea",
  "Singapore", "India", "Thailand", "Australia", "New Zealand", "United Arab Emirates", "Saudi Arabia",
  "South Africa",
]);
