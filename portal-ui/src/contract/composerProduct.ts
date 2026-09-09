// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The composer's draft: WHICH PRODUCT, and WHERE.
//
// This module exists for the same reason as compose.ts: the test runner can load `.ts` but not `.tsx`,
// so anything left inside the component is anything that cannot be tested. What is in here decides which
// PRODUCT a user is buying and what it will cost them, which is the last thing that should rest on
// having been eyeballed once in a browser.
//
// ── WHAT THIS REPLACED, AND WHY NONE OF IT SURVIVES ─────────────────────────────────────────────────
//
// There were LEVERS: four booleans and a list of eight script chips, from which the screen DERIVED a
// registry level and sent that. It could not name what it was selling. Its own footer had to invent
// labels for "distinctions the registry has no word for" — "Deep dive — United States", "Full clearance"
// — and the comment saying so was accurate: `clearotron` was three different products depending on where it
// pointed, and the wire carried only `clearotron`.
//
// So the levers are gone, and so is everything built on them:
//
//   TEMPLATES / matchTemplate / templateDiff — three hand-written bundles that prefilled levers so the
//     screen could offer the thing the registry could not name. The four products ARE that list now, and
//     they come off the wire. (The MCP menu deleted its identical three for the identical reason.)
//   SCRIPT_LANES — eight chips, five of them `live: false`, each carrying the territories it routes on.
//     The offering has ONE native-language toggle; which lanes fire is the engine's decision, made from
//     the territories in scope, and it always was.
//   levelDelta — priced a LEVER MOVE. There are no levers, and "what would the other one cost" is a
//     column in the comparison table, which every product already publishes (baseTurnaround, maxNames).
//   the case-law lever — case law is what a Full country search IS. Not a toggle, not a flag.
//
// ── THE ONE RULE THAT SHAPES WHAT IS LEFT ───────────────────────────────────────────────────────────
//
// GEOGRAPHY FOLLOWS THE PRODUCT AND IS CONSTRAINED BY IT. Worldwide is not a choice on a Global
// preliminary search — it IS a Global preliminary search. So the Where control is not one control that
// sometimes refuses: it is a different control per product, and each says at the control what it accepts.
// Nothing is greyed out without the reason beside it.

import type { Product } from './api.ts'

/** What the requester has composed. Three fields, and two of them are the geography. */
export type Draft = {
  /** A product key from the OFFERING the server sent. Null until one is picked — nothing is default. */
  readonly product: string | null
  /**
   * The territories, as the requester named them. EMPTY means worldwide — and which of those two a
   * request is, is `geographyFor` below, because "everywhere" and "I said nothing" are different
   * searches and the wire has to carry which.
   */
  readonly territories: readonly string[]
  /** The one toggle in the offering. Only meaningful where the product offers it. */
  readonly nativeLanguage: boolean
}

export const EMPTY_DRAFT: Draft = { product: null, territories: [], nativeLanguage: false }

// ── the territory vocabulary ────────────────────────────────────────────────────────────────────────
//
// CLOSED, and split by TIER, because the offering's rules are about tiers: a region is not a country, and
// "a Full country search reads exactly one country" is unenforceable against a flat list. The server's
// own tier table (driver/territory-tiers.mjs) is the authority; this is the subset the picker offers, and
// productMatrix.test.ts checks every entry of it against that table.

/** Supranational filing systems: one entry, many countries. NEVER a country. */
export const REGIONS: readonly string[] = ['European Union', 'Benelux', 'African Regional (ARIPO)']

export const COUNTRIES: readonly string[] = [
  'United States', 'United Kingdom', 'Ireland', 'France', 'Germany', 'Spain', 'Italy', 'Netherlands',
  'Switzerland', 'Austria', 'Sweden', 'Norway', 'Poland', 'Bulgaria', 'Greece', 'Turkey', 'Canada',
  'Mexico', 'Brazil', 'Argentina', 'China', 'Hong Kong', 'Taiwan', 'Macau', 'Japan', 'South Korea',
  'Singapore', 'India', 'Thailand', 'Australia', 'New Zealand', 'United Arab Emirates', 'Saudi Arabia',
  'South Africa',
]

const ALIASES: Readonly<Record<string, readonly string[]>> = {
  'European Union': ['eu', 'europe'],
  'United States': ['us', 'usa', 'america'],
  'United Kingdom': ['uk', 'britain', 'gb', 'england'],
}

export type Tier = 'region' | 'country'

/** What kind of place this entry names, or null for one the picker does not offer. */
export function tierOf(name: string): Tier | null {
  if (REGIONS.includes(name)) return 'region'
  if (COUNTRIES.includes(name)) return 'country'
  return null
}

/**
 * ── — WHAT THE PRODUCT ACCEPTS, before the register is consulted ────────────
 *
 * A Full country search reads exactly one COUNTRY, so its picker offers countries and no regions. That
 * is the product's own shape and it is a real wall: a region cannot be sent to a search that reads one
 * country, so the requester never types one and the refusal never has to happen.
 *
 * SPLIT OUT FROM `vocabularyFor`, which now answers a different and narrower question — what the wired
 * register can REACH inside this vocabulary. The two were one function, and that is what made the
 * country picker silently drop territories: a place the register does not reach was simply absent, and
 * a reader cannot tell an unsupported territory from one they failed to find.
 */
export function offerableFor(product: Product | null): readonly string[] {
  if (!product) return []
  return product.geography === 'exactly one country' ? COUNTRIES : [...REGIONS, ...COUNTRIES]
}

/**
 * Does the wired register reach this territory? (.)
 *
 * THE THREE STATES ARE THE WHOLE POINT and they are the same three `vocabularyFor` keeps apart: `null`
 * is a register that declares no restriction, `undefined` is a server that did not say, and only an
 * array narrows. Both of the first two answer TRUE — an unknown coverage must never mark a territory
 * as unreachable, which would put a caveat on every country of a production deployment.
 */
export function reachesTerritory(name: string, covered?: readonly string[] | null): boolean {
  if (!Array.isArray(covered)) return true
  return covered.includes(name)
}

/**
 * WHICH TERRITORIES THIS PRODUCT MAY BE POINTED AT — the vocabulary the picker offers, per product.
 *
 * A Full country search reads exactly one COUNTRY, so its picker offers countries and no regions. That
 * is the difference between a control that refuses and a control that fits: the requester never types a
 * region into a search that cannot take one, so the refusal never has to happen. The panel says why
 * (`geographyNote`), so nothing is missing without a reason.
 */
export function vocabularyFor(
  product: Product | null, covered?: readonly string[] | null,
): readonly string[] {
  if (!product) return []
  // — AND what the wired register can actually reach. Same argument as the product rule above, one
  // level down.
  //
  // ── — THIS IS NO LONGER THE PICKER'S VOCABULARY ──────────────────────────
  //
  // It was, and a territory outside coverage was therefore silently absent from the composer. Coverage
  // is disclosed rather than refused now, so the picker offers `offerableFor` and MARKS what this
  // returns. What this function answers is still a real and needed question — what does the wired
  // register reach, inside this product's vocabulary — and the screen asks it to state that reach in
  // one line. Scoped to the product, which is why `registerTerritories.length` is the wrong figure for
  // that sentence: a Full country search can name no regions, so a region the register covers is not
  // one of "the territories you can name here".
  //
  // THREE INPUTS, and only ONE narrows — the rule now lives once, in `reachesTerritory`. `null` is a
  // register that declares no restriction and `undefined` is a server that did not say; both reach
  // everything, and a `covered ?? []` anywhere on this path offers NOTHING on the production
  // deployment, whose provider declares null on purpose.
  return offerableFor(product).filter((n) => reachesTerritory(n, covered))
}

/**
 * Territory suggestions for what was typed, within THIS product's vocabulary.
 *
 * Matches on WHOLE WORDS and aliases, never on a bare substring: a naive contains-match turns "in" into
 * India, China, Singapore and Argentina at once, which is a menu that hides the country you wanted.
 */
export function territoryMatches(
  query: string, chosen: readonly string[], product: Product | null, limit = 8,
  // ── — KEPT IN THE SIGNATURE, AND IT NO LONGER NARROWS ─────────────────────
  //
  // It did, and the owner met the result: "we have the same issue in the country filters — nothing
  // tells the user what its limited to, or why." A territory the register cannot reach was simply
  // absent from the suggestions, which teaches a reader nothing — they cannot tell an unsupported
  // territory from one they mistyped.
  //
  // The ruling on the product rows applies here, and the issue makes the consistency binding: the two
  // controls sit on one screen and must not disagree about how coverage is handled. So the territory is
  // OFFERED, selectable, with the reason at the control — the caller marks it with `reachesTerritory`.
  // The parameter stays so the argument at every call site keeps compiling and keeps meaning something;
  // dropping it would silently un-thread coverage from the one screen that has to show it.
  _covered?: readonly string[] | null,
): readonly string[] {
  return matchTerritoriesIn(offerableFor(product), query, chosen, limit)
}

/**
 * The same match, over a vocabulary the caller names.
 *
 * Split out for the brand-profile pickers, which have NO product to scope by — a
 * profile default is not a request. The alternative was passing a fabricated product to reach the
 * matching rule, which is a cast that keeps compiling and stops meaning anything the day `Product`
 * changes shape; and the alternative to THAT was a second copy of the word-and-alias rule, which is the
 * thing this file already refuses to do with territory names. One matcher, two vocabularies.
 *
 * Case-insensitive on `chosen` so a hand-typed spelling still suppresses its own suggestion.
 */
export function matchTerritoriesIn(
  vocabulary: readonly string[], query: string, chosen: readonly string[], limit = 8,
): readonly string[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const taken = new Set(chosen.map((c) => c.trim().toLowerCase()))
  const hit = (name: string): boolean => {
    const lower = name.toLowerCase()
    if (lower.startsWith(q)) return true
    if (lower.split(/[\s(/]+/).some((w) => w.startsWith(q))) return true
    return (ALIASES[name] ?? []).some((a) => a.startsWith(q))
  }
  return vocabulary.filter((n) => !taken.has(n.toLowerCase()) && hit(n)).slice(0, limit)
}

/**
 * Adding a territory.
 *
 * "Worldwide" IS NOT AN ENTRY and never was — it is the empty list, and the engine's own door clears the
 * token if one arrives. What is new is that emptiness is no longer AMBIGUOUS: `geographyFor` below turns
 * it into a stated mode, so "everywhere" and "whatever the account says" stop being the same bytes.
 *
 * A Full country search takes ONE country, so a second REPLACES the first rather than being appended and
 * then refused. That is the control fitting the product: there is no state in which the screen holds two
 * and has to explain that it cannot send them.
 */
export function addTerritory(
  d: Draft, name: string, product: Product | null, _covered?: readonly string[] | null,
): Draft {
  // — the wall is the PRODUCT's vocabulary, not the register's coverage. A
  // territory outside coverage is orderable and disclosed, exactly as the product rows now are; a
  // region on a one-country search is still refused, because that one cannot be sent at all.
  if (!offerableFor(product).includes(name)) return d
  if (d.territories.includes(name)) return d
  if (product?.geography === 'exactly one country') return { ...d, territories: [name] }
  return { ...d, territories: [...d.territories, name] }
}

export function removeTerritory(d: Draft, name: string): Draft {
  return { ...d, territories: d.territories.filter((t) => t !== name) }
}

// ── what the wire carries ───────────────────────────────────────────────────────────────────────────

export type Geography = { readonly mode: 'worldwide' | 'named'; readonly territories: readonly string[] }

/**
 * The geography STAMP for this draft, stated rather than implied.
 *
 * The composer knows something the wire could not carry until now: an empty territory list on THIS
 * screen means the requester asked for everywhere, not that they said nothing. Sending the list alone
 * made those byte-identical, and an account with seven default territories then ran seven — a search
 * that was sold as worldwide.
 */
export function geographyFor(d: Draft): Geography {
  return d.territories.length
    ? { mode: 'named', territories: [...d.territories] }
    : { mode: 'worldwide', territories: [] }
}

/**
 * Whether the native-language investigation is a CONTROL on this product, a statement, or absent.
 *
 * Three answers because the offering has three: it is the one toggle on a Multi-country focus search, it
 * runs automatically on a Full country search (so the screen states it and offers nothing to press), and
 * it is not part of the other two (so there is nothing to show at all — never a greyed switch, which
 * invites a click and answers nothing).
 */
export function nativeLanguageControl(product: Product | null): 'toggle' | 'automatic' | 'none' {
  if (product?.nativeLanguage === 'offered') return 'toggle'
  if (product?.nativeLanguage === 'automatic') return 'automatic'
  return 'none'
}

/** The toggle, where there is one. A product that does not offer it cannot be left holding a set flag. */
export function toggleNativeLanguage(d: Draft, product: Product | null): Draft {
  if (nativeLanguageControl(product) !== 'toggle') return d
  return { ...d, nativeLanguage: !d.nativeLanguage }
}

/**
 * Switching product. The draft is CARRIED where the new product can hold it and DROPPED where it cannot,
 * and never left set-but-hidden.
 *
 * A hidden-but-set field is the state this screen was rebuilt to end: it is sent, it is priced, it is
 * saved, and nobody can see it. So a native-language toggle does not survive a move to a product that
 * does not offer one, and territories do not survive a move to a product that cannot point at them.
 */
export function chooseProduct(d: Draft, product: Product | null): Draft {
  const territories = product?.geography === 'worldwide, and nothing else'
    ? []
    : product?.geography === 'exactly one country'
      ? d.territories.filter((t) => tierOf(t) === 'country').slice(0, 1)
      : d.territories
  return {
    product: product?.key ?? null,
    territories,
    nativeLanguage: nativeLanguageControl(product) === 'toggle' ? d.nativeLanguage : false,
  }
}

/** What the Where panel says about the geography this product accepts — AT the control, always. */
export function geographyNote(product: Product | null): string | null {
  if (!product) return null
  switch (product.geography) {
    case 'worldwide, and nothing else':
      return 'Worldwide. This search is not narrowed — that is what it is. To search particular places, pick a different search above.'
    case 'exactly one country':
      return 'One country. Regions are not offered here: the case-law and opposition reading is per-country practice, and there is no such thing as one region’s precedent.'
    case 'a region, or two or more countries':
      return 'A region, or two or more countries. One country on its own is a Full country search — pick that one instead.'
    default:
      return 'Worldwide, or any set of territories you name.'
  }
}

// ── everything standing between this draft and a run ────────────────────────────────────────────────

/**
 * More names than the product reads — the ONE predicate for that question.
 *
 * Returns the numbers rather than a boolean because the screen offers a way OUT (screen them all on a
 * knockout instead), and it needs both figures to say so. `maxNames` is the server's own, off the row it
 * sent: a hand-typed figure beside a wall that refuses at a different one is exactly what shipped before
 * — a template row reading "up to 20 names" over an eight-name limit.
 */
export function nameBudget(
  product: Product | null, names: number,
): { readonly allowed: number; readonly over: number } | null {
  if (!product || names <= product.maxNames) return null
  return { allowed: product.maxNames, over: names - product.maxNames }
}

/**
 * The pieces the form has not been given yet, in plain sentences.
 *
 * ── WHY THIS IS A SEPARATE LIST FROM blockers() ─────────────────────────────────────────────────────
 *
 * `blockers()` is about the SEARCH — the wrong product for the geography, too many names, a territory
 * cap. Everything in it is a reason the search on screen could not run as described, and the composer
 * gates saving on it, because a saved search that cannot run is worth nothing to whoever opens it next.
 *
 * This list is about the FORM. A name, and something saying what the name is for. They are not reasons
 * a search is wrong; they are pieces nobody has typed yet, and a half-filled form is a perfectly good
 * thing to save and come back to. Merging the two lists would take saving away from someone who has
 * picked their levers and wants to keep them.
 *
 * ── AND IT EXISTS BECAUSE THE PREDICATE HAD NO SENTENCES ────────────────────────────────────────────
 *
 * The screen computed this condition as one boolean, fed it into `ready`, and rendered nothing. Every
 * other term in `ready` has a sentence somewhere on the page; this one had none, so the primary action
 * was greyed out with nothing anywhere saying which field would ungrey it. An outside user with one
 * name typed and no goods read that as a screen with no way to start a search and stopped using the
 * product. The sentences ARE the predicate now — the screen asks whether this list is empty rather
 * than re-deriving the condition — so the reason cannot go missing again without the check going with
 * it.
 *
 * @param names    the mark names on the form
 * @param classes  the Nice classes resolved for this draft, from wherever they came
 * @param goods    the free-text goods and services description
 */
export function missingPieces(
  names: readonly string[], classes: readonly number[], goods: string,
): readonly string[] {
  const out: string[] = []
  if (!names.length) {
    out.push('Add the brand name you want cleared, in Names above.')
    // ONE AT A TIME, most structural first. With no name at all, telling someone their goods are also
    // missing is two chores where the first one may fill in the second — the brief reader takes a
    // sentence and fills both.
    return out
  }
  // EITHER, never both. This mirrors what the request schema accepts: classes or a description, and
  // demanding the classes be retyped when the company's own are already on the card is the kind of
  // busywork that makes a form feel broken.
  if (!classes.length && !goods.trim()) {
    out.push('Say what the name is used for — pick classes, or describe the goods and services. Either one is enough.')
  }
  return out
}

/**
 * Everything standing between this draft and a run, in plain sentences.
 *
 * Deliberately NOT a boolean. Each of these is a different thing to fix, and a disabled button with no
 * reason is the failure this screen was rebuilt to end. Ordered most-structural first.
 *
 * These MIRROR the server's rules (driver/products.mjs) and are not the wall — the wall is at every door,
 * in one module, and this exists so a requester meets the rule while composing rather than at the button
 * that spends. Where the two could ever disagree, the server decides.
 */
export function blockers(d: Draft, product: Product | null, names = 0): readonly string[] {
  const out: string[] = []
  if (!product) {
    out.push('Pick a search above. The four differ in where they look and how deep they read.')
    return out
  }
  const budget = nameBudget(product, names)
  if (budget) {
    out.push(budget.allowed === 1
      ? `A ${product.name} reads one name at a time, and you have ${budget.allowed + budget.over}.`
      : `A ${product.name} reads ${budget.allowed} names at a time, and you have ${budget.allowed + budget.over}.`)
  }
  const named = d.territories
  const countries = named.filter((t) => tierOf(t) === 'country')
  const regions = named.filter((t) => tierOf(t) === 'region')
  switch (product.geography) {
    case 'worldwide, and nothing else':
      // Unreachable from this screen — the panel offers no picker at all for this product — and kept
      // because a draft can arrive here from the brief reader, which fills territories from prose.
      if (named.length) out.push(`A ${product.name} is worldwide and is not narrowed. Remove the territories, or pick a Multi-country focus search to read them.`)
      break
    case 'a region, or two or more countries':
      if (!named.length) out.push(`A ${product.name} reads a region, or two or more countries. Name them in Where — or pick a Global preliminary search to read the whole world.`)
      else if (named.length === 1 && countries.length === 1) out.push(`A ${product.name} reads a region, or two or more countries. Add another country or name a region — or pick a Full country search to read ${countries[0]} on its own.`)
      break
    case 'exactly one country':
      if (!named.length) out.push(`A ${product.name} reads one country. Name it in Where.`)
      else if (regions.length) out.push(`A ${product.name} reads one country, and ${regions[0]} is a region. Name one of its countries instead.`)
      break
    default:
      break
  }
  if (named.length > MAX_TERRITORIES)
    out.push(`That is ${named.length} territories — a search takes at most ${MAX_TERRITORIES}. Remove some.`)
  if (!product.available) out.push(product.unavailableNote || 'That search is not available just now.')
  return out
}

// ── readiness, and the sentence that goes with it ───────────────────────────────────────────────────
//
// ONE FUNCTION, because they are one fact. The screen used to compute `ready` as a chain of six `&&`
// terms in the JSX and the reason as a separate chain of `??` fallbacks 800 lines further down, and
// nothing tied the two together. Adding a seventh term to the boolean and forgetting the seventh
// sentence was a one-line edit that greyed the primary action out in silence — which is the defect
// this screen was rebuilt to end, returning wearing the fix.
//
// So `ready` and `blockedBy` are derived from the SAME ordered list, and the relation is not a
// convention anybody has to remember:
//
//     ready === (blockedBy === null)
//
// Every condition carries its sentence at the same site. A new term is added to `CHAIN` or it does not
// affect readiness at all, and the compiler asks for the sentence.
//
// TOTAL BY CONSTRUCTION. `blockedBy` is never null and never blank while `ready` is false: the last
// entry is a sentence with no condition of its own to fail, and a condition whose sentence came back
// empty falls through to it rather than to nothing. That last case is defensive rather than live —
// `blockers()` already answers when no product is picked — and it is what stops a future empty string
// in one of the lists from reaching a reader as a blank explanation under a dead button.

export type Readiness = {
  /** Whether the search on screen can be started. */
  readonly ready: boolean
  /** The first reason it cannot, as one sentence. Non-empty whenever `ready` is false; null when it is true. */
  readonly blockedBy: string | null
}

/**
 * Whether this draft can be started, and the first reason it cannot.
 *
 * Ordered the way the notices on the page are ordered, because the footer shows one sentence and the
 * reader fixes them from the top: the names they typed, then the pieces the form still wants, then the
 * search itself, then the allowances.
 *
 * @param i.gaps       missingPieces() — what the form has not been given
 * @param i.stops      blockers() — why the search as described could not run
 * @param i.nameStops  the mark names the server's own length limit refuses
 * @param i.budget     nameBudget() — more names than this product reads, with both figures
 * @param i.exhausted  today's allowance is spent
 * @param i.hasProduct a product is picked at all
 */
export function readiness(i: {
  readonly gaps: readonly string[]
  readonly stops: readonly string[]
  readonly nameStops: readonly string[]
  readonly budget: { readonly allowed: number; readonly over: number } | null
  readonly exhausted: boolean
  readonly hasProduct: boolean
}): Readiness {
  const NOTHING_PICKED = 'Pick one of the searches above to begin.'
  const chain: readonly (readonly [boolean, string])[] = [
    [i.nameStops.length > 0, i.nameStops[0] ?? ''],
    [i.gaps.length > 0, i.gaps[0] ?? ''],
    [i.stops.length > 0, i.stops[0] ?? ''],
    [i.budget != null, i.budget
      ? `This search reads ${i.budget.allowed} name${i.budget.allowed === 1 ? '' : 's'} at a time, and you have ${i.budget.allowed + i.budget.over}.`
      : ''],
    [i.exhausted, 'No searches left on today’s allowance.'],
    [!i.hasProduct, NOTHING_PICKED],
  ]
  const blocking = chain.filter(([when]) => when)
  if (!blocking.length) return { ready: true, blockedBy: null }
  const said = blocking.map(([, sentence]) => sentence).find((s) => s.trim().length > 0)
  return { ready: false, blockedBy: said ?? NOTHING_PICKED }
}

/**
 * The most territories one search may carry.
 *
 * A MIRROR of `MAX_JURISDICTIONS` in driver/enqueue-schema.mjs — the server's own cap, and the one that
 * actually refuses. Kept here so the screen can say so while the list is being built rather than at the
 * plan gate, which is after the composing is done.
 */
/**
 * The whole territory vocabulary, in one place.
 *
 * `[...REGIONS, ...COUNTRIES]` was being recomposed at three call sites — the composer's own reader, the
 * field picker, and now the profile field's validator. Three copies of one list is three chances for a
 * screen to suggest a territory another screen then flags as unknown.
 */
export const ALL_TERRITORIES: readonly string[] = [...REGIONS, ...COUNTRIES]

/**
 * The engine's territory-code universe, mirrored.
 *
 * A VERBATIM mirror of `driver/jurisdiction-codes.mjs`, kept honest the way the effort model above is
 * kept honest: `portal-ui/test/territoryCodeParity.test.ts` reads the driver module and fails the moment
 * the two disagree. Mirrored rather than fetched because a field refuses as you type, and a refusal that
 * needs a round trip is a refusal that does not happen.
 *
 * WHY THE SHAPE CHECK WAS NOT ENOUGH. `isTerritoryCode` accepted any two letters, on the reasoning that
 * a code is something "the engine resolves and this vocabulary does not list". The engine does not
 * resolve any two letters: it holds 262 codes and treats everything else as unknown. So `XQ` was
 * accepted here, stored, carried, and then dropped before the prompt — with nothing said at any point.
 * That is the whole of tracker issue 417 in one predicate.
 */
export const JURISDICTION_CODE_FOLD: Readonly<Record<string, string>> = Object.freeze({
  UK: "GB",
  EM: "EU",
  EUTM: "EU",
  EUIPO: "EU",
})

export const KNOWN_JURISDICTION_CODES: ReadonlySet<string> = Object.freeze(new Set([
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AP", "AQ", "AR", "AS", "AT", "AU", "AW", "AX",
  "AZ", "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ", "BR",
  "BS", "BT", "BV", "BW", "BX", "BY", "BZ", "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK", "CL",
  "CM", "CN", "CO", "CR", "CU", "CV", "CW", "CX", "CY", "CZ", "DE", "DJ", "DK", "DM", "DO", "DZ",
  "EA", "EC", "EE", "EG", "EH", "ER", "ES", "ET", "EU", "FI", "FJ", "FK", "FM", "FO", "FR", "GA",
  "GB", "GD", "GE", "GF", "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GS", "GT", "GU",
  "GW", "GY", "HK", "HM", "HN", "HR", "HT", "HU", "IB", "ID", "IE", "IL", "IM", "IN", "IO", "IQ",
  "IR", "IS", "IT", "JE", "JM", "JO", "JP", "KE", "KG", "KH", "KI", "KM", "KN", "KP", "KR", "KW",
  "KY", "KZ", "LA", "LB", "LC", "LI", "LK", "LR", "LS", "LT", "LU", "LV", "LY", "MA", "MC", "MD",
  "ME", "MF", "MG", "MH", "MK", "ML", "MM", "MN", "MO", "MP", "MQ", "MR", "MS", "MT", "MU", "MV",
  "MW", "MX", "MY", "MZ", "NA", "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR", "NU", "NZ",
  "OA", "OM", "PA", "PE", "PF", "PG", "PH", "PK", "PL", "PM", "PN", "PR", "PS", "PT", "PW", "PY",
  "QA", "RE", "RO", "RS", "RU", "RW", "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI", "SJ", "SK",
  "SL", "SM", "SN", "SO", "SR", "SS", "ST", "SV", "SX", "SY", "SZ", "TC", "TD", "TF", "TG", "TH",
  "TJ", "TK", "TL", "TM", "TN", "TO", "TR", "TT", "TV", "TW", "TZ", "UA", "UG", "UM", "US", "UY",
  "UZ", "VA", "VC", "VE", "VG", "VI", "VN", "VU", "WF", "WO", "WS", "XA", "XG", "XK", "XS", "XW",
  "YE", "YT", "ZA", "ZM", "ZW", "ZZ",
])) as ReadonlySet<string>

/** A code as the engine records it: uppercased, and the habits folded onto the office they name. */
export const canonicalJurisdictionCode = (code: string): string => {
  const c = String(code ?? '').trim().toUpperCase()
  if (!c) return ''
  return JURISDICTION_CODE_FOLD[c] ?? c
}

/** Is this token, after the canonical fold, inside the engine's known universe? */
export const isKnownJurisdictionCode = (code: string): boolean => {
  const c = canonicalJurisdictionCode(code)
  return Boolean(c) && KNOWN_JURISDICTION_CODES.has(c)
}

/** Whether a typed entry is a territory this product's vocabulary knows. Case- and space-insensitive,
 *  because the box is free text and "  united states " is the same answer as "United States". */
export const isKnownTerritory = (entry: string): boolean => {
  const e = String(entry).trim().toLowerCase()
  return e.length > 0 && ALL_TERRITORIES.some((t) => t.toLowerCase() === e)
}

/**
 * A two-letter territory CODE, which the engine resolves and this vocabulary does not list.
 *
 * ONE STORED FIELD WAS DESCRIBED THREE WAYS. The staff editor tells an operator to type
 * "US, EU, UK"; the portal checked those against display names and flagged all three as unknown; and
 * the engine validates nothing and normalises whatever arrives. So a user who followed one editor's
 * instruction was told by the other that they were wrong, which is what an outside user asked about.
 *
 * WHY A SHAPE AND NOT A TABLE. The driver holds the real list, and mirroring it into the browser would
 * put a second copy of ~250 codes here with a parity test to keep them in step — the effort model's
 * arrangement, taken on for a field that flags and never refuses. This check is assistive by design, so
 * the honest rule is the one the engine actually applies: a two-letter code is carried and resolved,
 * including one this build does not recognise. A wrong code is not silently accepted as correct; it is
 * accepted as typed, which is what the engine does with it, and the hint says so.
 *
 * NOT a vocabulary change to the picker or to the composer's territory list, both of which stay
 * name-shaped: a picker offering names beside a box that only accepted codes would be two controls
 * disagreeing under one label, which is this defect in the other direction.
 */
export const isTerritoryCode = (entry: string): boolean => isKnownJurisdictionCode(String(entry).trim())

/**
 * What the stored-defaults jurisdictions field accepts: a territory this build names, or a code the
 * engine actually holds.
 *
 * ITS ONE CONSUMER IS THE STORED ACCOUNT DEFAULT (`profileFields.ts`), and that is deliberate. What a
 * REQUEST may name is a separate and more tolerant question — tracker issue 417 is explicit that the
 * request path's tolerance is a client-outcome decision and stays as it is. A stored default is the
 * opposite case: nobody is watching when it fails, so it is refused where it is typed.
 */
export const isTerritoryEntry = (entry: string): boolean => isKnownTerritory(entry) || isTerritoryCode(entry)

export const MAX_TERRITORIES = 20

// ── the effort model ────────────────────────────────────────────────────────────────────────────────
//
// A VERBATIM mirror of driver/effort-model.mjs. Every weight, every rounding, every clamp is identical,
// and portal-ui/test/effortModelParity.test.ts pins the two together across a matrix of shapes. That test
// is the point: the moment they disagree, the number a user was shown when they pressed the button is not
// the number the run was admitted under.
//
// It takes MACHINERY, not the draft. The draft says "Multi-country focus search over France and Germany
// with the native language"; this prices a clearance pipeline, no case law, one lane, two territories.
// The split is what lets the browser and the server compute the same figure from different starting
// points — the browser from the product row it fetched, the server from the policy it resolved.

export type Machinery = {
  readonly pipeline: 'knockout' | 'clearance'
  readonly caseLaw: boolean
  readonly nativeLanguage: boolean
  readonly registerCounts: boolean
  readonly territories: readonly string[]
}

/** The draft, as machinery. Every fact comes off the product row the server sent. */
export function machineryFor(d: Draft, product: Product | null): Machinery {
  const knockout = product?.pipeline === 'knockout'
  return {
    pipeline: knockout ? 'knockout' : 'clearance',
    caseLaw: product?.caseLaw === true,
    // What the SCREEN can know. Whether a lane actually fires is decided server-side from the
    // territories, and the review step quotes the server's figure — which is what that step is for.
    nativeLanguage: product?.nativeLanguage === 'automatic'
      || (product?.nativeLanguage === 'offered' && d.nativeLanguage),
    registerCounts: knockout && (product?.components ?? []).includes('registerProbe'),
    territories: [...d.territories],
  }
}

export type EffortInput = {
  readonly levers: Machinery
  readonly names: number
  readonly classes: number
  readonly platforms: number
  /** The account's `marketplaceDensity`. 'dense' halves the grid budget six-fold — see gridBudget. */
  readonly density: string | null
}

/** The grid-cell budgets, restated from profiles.mjs. The server twin restates them too; the guard is
 *  behavioural, not shared code — this file cannot import from driver/ (separate self-contained bundle). */
export const SAFE_GRID_CELLS = 98
export const DENSE_GRID_CELLS = 16

/** checksPerName = the owner's marketplaces + 1. The +1 is the general web (profiles.mjs derivedFloor). */
export const checksPerName = (platforms: number): number => Math.max(1, platforms + 1)

/**
 * profiles.mjs — SAFE_GRID_CELLS 98, DENSE_GRID_CELLS 16.
 *
 * KEYED ON `'dense'`, STRICTLY, matching `gridCellBudget` on the server. It keyed on `'high'` until
 *: that word was the staff editor's LABEL for the `dense` option and is a value the
 * profile validator refuses, so this branch was dead for every profile that can exist.
 *
 * Do not restore the `.trim().toLowerCase()`. It made this accept strings the run side rejects, which is
 * a divergence wearing the costume of leniency.
 */
export const gridBudget = (density: string | null): number =>
  density === 'dense' ? DENSE_GRID_CELLS : SAFE_GRID_CELLS

/**
 * derivedBatchSize — how many variants ride ONE grid call.
 *
 * The count the old model missed entirely, and the difference between two owners whose shop counts look
 * comparable: 7 shops sparse is 12 variants per call, 13 shops dense is 1. Density is not cosmetic — it
 * exists because a dense profile once truncated a coverage ledger mid-JSON.
 */
export const batchSize = (platforms: number, density: string | null): number =>
  Math.max(1, Math.floor(gridBudget(density) / checksPerName(platforms)))

export const deriveMode = (m: Machinery): 'knockout' | 'clearance' => m.pipeline

/** A native-language lane only counts on a clearance — a knockout has no such axis at all. */
export const nativeActive = (m: Machinery): boolean => m.pipeline === 'clearance' && m.nativeLanguage
/** Register counts only count on a knockout — a clearance reads the registers properly. */
export const countsActive = (m: Machinery): boolean => m.pipeline === 'knockout' && m.registerCounts
/** Case law only counts on a clearance — the knockout pipeline carries no case-law stage. */
export const caseLawActive = (m: Machinery): boolean => m.pipeline === 'clearance' && m.caseLaw

/** Nominal variant count. Transliteration is standard, so the base already carries the script renderings. */
export const variantCount = (m: Machinery): number => 20 + (nativeActive(m) ? 6 : 0)

export const gridCalls = (i: EffortInput): number =>
  Math.ceil(variantCount(i.levers) / batchSize(i.platforms, i.density))

/** Searches: a knockout carries the whole batch in ONE; a clearance is one name per search. */
export const runCount = (i: EffortInput): number =>
  i.levers.pipeline === 'knockout' ? 1 : Math.max(1, i.names)

/**
 * The weights. Placeholders, and pinned against the server port weight by weight.
 *
 * `scriptNext` went with the eight-lane picker: the offering has ONE native-language toggle, so there is
 * no second lane to charge for and a weight that can never apply is a weight nobody can check.
 */
export const W = {
  gridPerCheck: 1.1,
  gridPerCall: 0.8,
  registerBase: 14,
  registerPerClass: 2,
  caseLaw: 6,
  script: 8,
  oneTerritory: 9,
  knockoutBase: 1,
  knockoutPerName: 0.4,
  countPerName: 0.5,
} as const

export function effortRaw(i: EffortInput): number {
  const names = Math.max(1, i.names)
  if (i.levers.pipeline === 'knockout')
    return W.knockoutBase + names * (W.knockoutPerName + (countsActive(i.levers) ? W.countPerName : 0))
  // The marketplace / common-law half is in every clearance — there is no product without it.
  let e = checksPerName(i.platforms) * W.gridPerCheck + gridCalls(i) * W.gridPerCall
  e += W.registerBase + Math.max(i.classes, 1) * W.registerPerClass
  if (caseLawActive(i.levers)) e += W.caseLaw
  if (nativeActive(i.levers)) e += W.script
  if (i.levers.territories.length === 1) e += W.oneTerritory
  return e * runCount(i)
}

/**
 * ── WHAT THE 1–10 BAR MEANS ─────────────────────────────────────────────────────────────────────────
 *
 * How deep this search is FOR THIS COMPANY: 1 is the lightest thing we run for them, 10 the deepest
 * they can buy. Not an absolute quantity of work — which is what it was, and it did not work, because a
 * constant divisor let the OWNER'S PROFILE dominate: an owner with 13 shops on a dense grid saturated at
 * 10 whatever they pressed.
 *
 * The floor is a Knockout search of one name; the ceiling is a Full country search with everything it
 * carries. Both are real products a client can order, which is what the old endpoints were not.
 */
export const effortFloor = (i: EffortInput): number =>
  effortRaw({
    ...i,
    names: 1,
    levers: { pipeline: 'knockout', caseLaw: false, nativeLanguage: false, registerCounts: true, territories: [] },
  })

export const effortCeiling = (i: EffortInput): number =>
  effortRaw({
    ...i,
    names: 1,
    levers: { pipeline: 'clearance', caseLaw: true, nativeLanguage: true, registerCounts: false, territories: ['United States'] },
  })

export function effortUnits(i: EffortInput): number {
  const raw = effortRaw(i)
  if (raw <= 0) return 1
  const span = effortCeiling(i) - effortFloor(i)
  // A degenerate span cannot happen with these weights, and a bar that divided by zero would render as
  // NaN dots on the one screen that spends money. 1 is the honest answer when there is no range.
  if (!(span > 0)) return 1
  return Math.max(1, Math.min(10, Math.round(1 + 9 * ((raw - effortFloor(i)) / span))))
}

/** Five dots. Deliberately not a currency figure — no price model exists. */
export const costBand = (i: EffortInput): number => Math.max(1, Math.min(5, Math.ceil(effortUnits(i) / 2)))

// ── turnaround ──────────────────────────────────────────────────────────────────────────────────────
//
// NO ARITHMETIC LIVES IN THIS SECTION. The quote is a table lookup — owner ruling 2026-08-26, recorded
// in full at `turnaroundBounds` in driver/effort-model.mjs. The run-slot cap used to be copied here as
// a `CONCURRENCY` constant and multiplied in; it was a fourth copy of a default an operator can change
// without a deploy, so it disagreed with the deployment by construction.
//
// THE QUOTED BOUNDS — the browser's half of one ruled table (owner ruling 2026-08-23).
//
// This mirrors `TURNAROUND_QUOTE` in driver/effort-model.mjs and `effortModelParity.test.ts` pins the two
// together, which is what makes two copies safe: the number a user was shown when they pressed the button
// is provably the number the run was admitted under.
//
// What it replaced: a base plus one adder per lane. Eight delivered runs refuted it — the run carrying
// every lane came in SHORTER than five carrying fewer, and the base sat below every observed wall. The
// adders were manufacturing variation the wall does not have.
export const TURNAROUND_QUOTE = {
  clearance: { lowHours: 1.5, highHours: 2.5 },
  // — 5-10 minutes, a range. Mirrors the server; the parity test pins both.
  knockout: { lowHours: 5 / 60, highHours: 10 / 60 },
} as const

export const quoteBoundsFor = (m: Machinery): { lowHours: number; highHours: number } =>
  m.pipeline === 'knockout' ? TURNAROUND_QUOTE.knockout : TURNAROUND_QUOTE.clearance

/** The ruled range, and nothing is done to it. Mirrors the server; the parity test pins both. */
export const turnaroundBounds = (i: EffortInput): { lowHours: number; highHours: number } =>
  ({ ...quoteBoundsFor(i.levers) })

/** The single figure, deliberately the UPPER bound — see the server-side note. */
export const turnaroundHours = (i: EffortInput): number => turnaroundBounds(i).highHours

const fmtHours = (h: number): string => (h % 1 ? h.toFixed(1) : String(h))

export function turnaround(i: EffortInput): string {
  const { lowHours, highHours } = turnaroundBounds(i)
  // — a sub-hour RANGE renders as one. This printed the high bound alone, which
  // would have rendered the new 5-10 quote as "~10 min" with nothing looking wrong.
  if (highHours < 1) {
    const lo = Math.round(lowHours * 60), hi = Math.round(highHours * 60)
    return lo === hi ? `~${hi} min` : `${lo}–${hi} min`
  }
  if (lowHours === highHours) return `~${fmtHours(highHours)} ${highHours === 1 ? 'hour' : 'hours'}`
  return `${fmtHours(lowHours)}–${fmtHours(highHours)} hours`
}

/** What the footer says a search costs per name. A knockout is one broad sweep, not a grid. */
export function checksSummary(i: EffortInput): string {
  if (i.levers.pipeline === 'knockout')
    return countsActive(i.levers)
      ? '1 broad sweep per name · web + marketplaces · register filing counts'
      : '1 broad sweep per name · web + marketplaces'
  return `${checksPerName(i.platforms)} checks per name`
}

/**
 * The honest note about running N searches.
 *
 * UNREACHABLE TODAY and deliberately kept. Every clearance takes one name and the composer says so
 * rather than fanning out, so `runCount` is 1 on every request this screen can send. Family searching
 * (three names, three searches, three reports) is its own design track, and when it lands this is the
 * sentence it needs, already written and already tested.
 *
 * TOOK THE WAVE CLAUSE OUT OF IT — the note used to end "and only 2 run at a time, so 3 waves",
 * which put the run-slot cap in front of a client as a fact about their search. It was the same copied
 * constant the turnaround quote was multiplying by, so it could say "2" to a client on a deployment
 * running 1 or 3. What remains is what this screen can actually stand behind: how many searches, and
 * that the work scales with them. The queue's shape is not the client's business and was never
 * measured against a delivered multi-run job, because there has never been one.
 */
export function runsNote(i: EffortInput): string {
  const runs = runCount(i)
  if (runs < 2) return ''
  return `Runs as ${runs} separate searches — ${runs}× the work.`
}

// ── saving a draft as a saved search ────────────────────────────────────────────────────────────────

/**
 * The composed draft as a saved search, for the footer's Save.
 *
 * SCOPE, NOT GHOSTS. The composer leaves a field empty to mean "use the company's own", and the
 * server's precedence ladder resolves it per run. A saved search that baked today's resolved classes in
 * would freeze that answer: change the owner's defaults next month and every saved search would quietly
 * keep searching last month's. So only what the user EXPLICITLY set travels.
 *
 * NULL when no product is chosen — the second wall behind the screen's own (Save is offered only while
 * `blockers()` is empty). This used to read `?? 'clearotron'`, which was a silent product substitution the
 * moment one lever combination stopped resolving.
 */
export function composeSaved({
  label, draft, classes, platforms, notes, prior,
}: {
  readonly label: string
  readonly draft: Draft
  readonly classes: readonly number[]
  readonly platforms: readonly string[]
  readonly notes?: string
  /**
   * The record being OVERWRITTEN, when this save updates an existing saved search. A save replaces the
   * file, so anything absent from what is composed here is destroyed — fine for a create, wrong for an
   * update, because the composer cannot express everything a recipe may hold (`extras`, `notes`,
   * `archived`, components it does not own). Omit for a create.
   */
  readonly prior?: Readonly<Record<string, unknown>>
}): Record<string, unknown> | null {
  if (!draft.product) return null
  const carried: Record<string, unknown> = { ...(prior ?? {}) }
  // Server-owned stamps are re-derived from disk on every write (recipe-service), so sending them back
  // is at best noise. Dropped here so this function's output reads as "what the user chose".
  for (const k of ['version', 'createdBy', 'createdAt', 'updatedBy', 'updatedAt']) delete carried[k]
  // The composer owns NO components now: the product decides its own machinery, and `jxLanes` in
  // particular is the product's answer rather than a component a saved search may set (the engine
  // refuses one). A stale pair from a previous save is cleared so a saved search cannot keep buying a
  // component its own product no longer names.
  const priorComponents = carried['components']
  const components: Record<string, boolean> = {
    ...(typeof priorComponents === 'object' && priorComponents !== null && !Array.isArray(priorComponents)
      ? priorComponents as Record<string, boolean> : {}),
  }
  delete components['jxLanes']
  delete components['registerProbe']
  const out: Record<string, unknown> = {
    ...carried,
    label: label.trim(),
    base: draft.product,
    components,
    scope: {
      jurisdictions: [...draft.territories],
      platforms: [...platforms],
      classes: [...classes],
    },
    nativeLanguage: draft.nativeLanguage,
  }
  // `caseLaw` is NOT written, and a prior one is dropped: the engine refuses to save it (it is what a
  // Full country search IS) and would refuse this whole record if it rode along.
  delete out['caseLaw']
  // A CREATE states it, an UPDATE inherits it. Stating it on an update is what would un-retire a retired
  // search behind the user's back.
  if (prior === undefined) out['archived'] = false
  if (notes !== undefined) {
    if (notes.trim()) out['notes'] = notes.trim()
    else delete out['notes']
  }
  return out
}

/**
 * A saved search, back as a draft — the inverse of `composeSaved`, and the reason the standalone editor
 * could be retired rather than kept alongside the composer.
 *
 * Returns NULL for a record the composer cannot express: a base that names a product the offering no
 * longer lists. Opening such a record in a form that silently resolved it to the nearest thing it CAN say
 * would rewrite what the client bought the next time Save was pressed. A row that cannot be edited says
 * so instead.
 */
export function draftFromSaved(
  recipe: Readonly<Record<string, unknown>>, products: readonly Product[],
): Draft | null {
  const base = typeof recipe['base'] === 'string' ? recipe['base'] : ''
  const product = products.find((p) => p.key === base) ?? null
  if (!product) return null
  const scope = (typeof recipe['scope'] === 'object' && recipe['scope'] !== null && !Array.isArray(recipe['scope'])
    ? recipe['scope'] as Record<string, unknown>
    : {})
  const territories = Array.isArray(scope['jurisdictions'])
    ? (scope['jurisdictions'] as unknown[]).filter((j): j is string => typeof j === 'string')
    : []
  return chooseProduct({
    product: base,
    territories,
    nativeLanguage: recipe['nativeLanguage'] === true,
  }, product)
}

// ── what the company already has ────────────────────────────────────────────────────────────────
//
// The context card shows the classes and the marketplaces this search will use BEFORE anything is typed,
// each tagged with where it came from. That is not decoration: selecting a project narrows the classes,
// and a client who discovers that at the review step has been surprised by their own configuration.
//
// The server owns the real precedence ladder (effective-scope.mjs) and the review step quotes ITS answer,
// never this one.

export type Inherited = {
  readonly classes: readonly number[]
  readonly classesFrom: string
  /**
   * The company's own territories, and where they came from.
   *
   * Absent from this contract until, which is why the composer could say "Worldwide" over an empty
   * territory list while the engine resolved that same emptiness to the account's `defaultJurisdictions`.
   */
  readonly territories: readonly string[]
  readonly territoriesFrom: string
  readonly platforms: readonly string[]
  readonly density: string | null
}

const numbers = (v: unknown): readonly number[] =>
  Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number') : []
const strings = (v: unknown): readonly string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []

export function inherited({
  profile, projectEffective, projectOrigins, ownerLabel, projectLabel,
}: {
  readonly profile: Record<string, unknown> | null
  readonly projectEffective: Record<string, unknown> | null
  readonly projectOrigins: Record<string, unknown> | null
  readonly ownerLabel: string
  readonly projectLabel: string | null
}): Inherited {
  const source = projectEffective ?? profile ?? {}
  const fromProject = projectOrigins?.['defaultClasses'] === 'project'
  return {
    classes: [...numbers(source['defaultClasses'])].sort((a, b) => a - b),
    classesFrom: fromProject && projectLabel ? `from ${projectLabel}` : `from ${ownerLabel}`,
    territories: strings(source['defaultJurisdictions']),
    territoriesFrom: projectOrigins?.['defaultJurisdictions'] === 'project' && projectLabel
      ? `from ${projectLabel}` : `from ${ownerLabel}`,
    platforms: strings(source['platforms']),
    density: typeof source['marketplaceDensity'] === 'string' ? source['marketplaceDensity'] : null,
  }
}
