// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// products.mjs — THE OFFERING. Which of the four products a request is, and what that product carries.
//
// Owner ruling, 2026-08-06. There are four products and a client buys one of them:
//
//   Knockout search              worldwide or a chosen set; up to 8 names; no case law; no native language
//   Global preliminary search    WORLDWIDE, nothing else; no case law; no native language
//   Multi-country focus search   a REGION, or 2..N countries; never worldwide, never exactly one;
//                                no case law; native language OFFERED (the only toggle in the offering)
//   Full country search          EXACTLY ONE COUNTRY; case law YES — only here; native language automatic
//
// ── THE NAME IS DERIVED, NEVER STORED ───────────────────────────────────────────────────────────────
//
// The product is a PURE FUNCTION of pipeline + scope and nothing else. The NAME is never stored: not a
// column in the queue, not a key in the run's frozen sidecars, never a cached string a report reads back.
// A stored name is a second answer to a question the run already answers, and the two disagree the first
// time a scope resolves differently from the way a door previewed it — which is exactly how a request
// that bought "everywhere" ran seven territories and said so nowhere.
//
// A JOB DOES CARRY `product`, AND THAT IS NOT THE SAME THING. It is the ORDER — which of the four the
// requester chose — and it is the only way a door can catch a request whose geography contradicts what it
// asked for (`checkProductScope`). The order is checked against the derivation at every door; nothing
// downstream reads it as the answer.
//
// So: give this module the pipeline and the scope, and it says what the thing IS. Publish asks the
// same question of the same module about a finished run and gets the same answer. That identity is the
// whole design; it is lost the moment anyone caches the result.
//
// ── WHAT "SCOPE" MEANS HERE, AND THE ONE WAY TO GET IT WRONG ────────────────────────────────────────
//
// `territories` is the RESOLVED scope — what will actually be searched, after resolveEffectiveScope has
// walked the request → saved search → project → account ladder. It is NOT `job.jurisdictions`.
//
// An empty list means NO TERRITORIAL RESTRICTION SURVIVED THE LADDER, and that is a worldwide search:
// register-plan.mjs treats emptiness as unrestricted and sweeps everywhere. Handing this module a raw
// `job.jurisdictions` that happens to be empty would name a Global preliminary search for a request that
// silently narrows to an account's seven default territories — the report would carry a product name for
// work that did not happen. resolveEffectiveScope first, always.
//
// ── PURE (no node imports, no env, no I/O) ──────────────────────────────────────────────────────────
//
// territory-tiers.mjs is the only dependency. In particular NOT search-policy.mjs, which reads the
// filesystem and which profiles.mjs already imports — the arrow runs the other way. This module states
// WHAT each product is; search-policy states what it RUNS, and imports this to do it.

import { territoryTier, territoryKey } from "./territory-tiers.mjs";

/**
 * THE CLOSED REFUSAL VOCABULARY. Every refusal this module can produce, and there are no others.
 *
 * A door quotes `message` and joins on `reason`. Free strings are what let the portal, the MCP door and
 * the runner refuse the same request in three different sentences, so that a requester who moved between
 * them was told three different things about one rule. The message is written HERE, once, for all three.
 */
export const REFUSAL_REASONS = Object.freeze({
  /** the product accepts no worldwide scope (Multi-country focus, Full country) */
  WORLDWIDE_NOT_OFFERED: "worldwide-not-offered",
  /** the product is worldwide and accepts no narrowing at all (Global preliminary) */
  NARROWING_NOT_OFFERED: "narrowing-not-offered",
  /** a regional filing system named where exactly one country is required */
  REGION_NOT_A_COUNTRY: "region-not-a-country",
  /** more than one country where exactly one is required */
  TOO_MANY_COUNTRIES: "too-many-countries",
  /** one country where a region or two-or-more is required */
  NOT_ENOUGH_COUNTRIES: "not-enough-countries",
  /** an entry that names neither a country nor a region this engine knows */
  TERRITORY_NOT_RECOGNIZED: "territory-not-recognized",
  /** case law asked for at a product that does not carry it */
  CASE_LAW_NOT_OFFERED: "case-law-not-offered",
  /** the native-language investigation asked for at a product that does not offer it */
  NATIVE_LANGUAGE_NOT_OFFERED: "native-language-not-offered",
  /** `nativeLanguage: false` — a suppression asked for on a toggle that only ever added */
  NATIVE_LANGUAGE_NOT_A_SUPPRESSION: "native-language-not-a-suppression",
  /** `searchLevel` — the retired depth selector, sent on a wire that no longer has one */
  SEARCH_LEVEL_RETIRED: "search-level-retired",
});

/** The three states of the native-language investigation. `offered` is the ONLY toggle in the offering. */
export const NATIVE_LANGUAGE_MODES = Object.freeze(["absent", "offered", "automatic"]);

// ── The offering itself ─────────────────────────────────────────────────────────────────────────────
//
// `id` is the machine key and `name` is the only string a client ever sees. The id is the name lowercased
// and hyphen-joined, and a unit test pins that: it guarantees no id can ever appear inside its own
// product's prose, so the leak-scans that refuse an internal key on a client surface can scan for the
// literal ids without matching the words we mean to say.
//
// `maxNames` is the offering's figure and it is THE WALL: checkMarkBudget (search-policy.mjs) reads it
// from here, every menu and every schema description computes its own copy from it, and there is no
// second number anywhere to disagree with it.
const SPECS = [
  {
    id: "knockout-search", name: "Knockout search", pipeline: "knockout",
    geography: "worldwide, or any set of territories",
    caseLaw: false, nativeLanguage: "absent", maxNames: 8,
  },
  {
    id: "global-preliminary-search", name: "Global preliminary search", pipeline: "clearance",
    geography: "worldwide, and nothing else",
    caseLaw: false, nativeLanguage: "absent", maxNames: 1,
  },
  {
    id: "multi-country-focus-search", name: "Multi-country focus search", pipeline: "clearance",
    geography: "a region, or two or more countries",
    caseLaw: false, nativeLanguage: "offered", maxNames: 1,
  },
  {
    id: "full-country-search", name: "Full country search", pipeline: "clearance",
    geography: "exactly one country",
    caseLaw: true, nativeLanguage: "automatic", maxNames: 1,
  },
];

/** The four products, in offering order — lightest first, which is the order a menu reads down. */
export const PRODUCTS = Object.freeze(SPECS.map((s) => Object.freeze(s)));
/** Just the ids, for a closed-set assertion and for the leak-scans. */
export const PRODUCT_IDS = Object.freeze(PRODUCTS.map((p) => p.id));

const BY_ID = new Map(PRODUCTS.map((p) => [p.id, p]));
const KNOCKOUT = BY_ID.get("knockout-search");
const GLOBAL = BY_ID.get("global-preliminary-search");
const MULTI = BY_ID.get("multi-country-focus-search");
const FULL = BY_ID.get("full-country-search");

/** The product's own row, or null for an id this build does not know. Frozen — callers read, never write. */
export function productSpec(id) {
  return BY_ID.get(String(id ?? "").trim().toLowerCase()) ?? null;
}

/** The client-facing NAME, or null. The one string that may be printed; never print an id. */
export function productName(id) {
  return productSpec(id)?.name ?? null;
}

/**
 * THE SENTENCE FOR A `product` TOKEN THE OFFERING DOES NOT LIST. One string, every door.
 *
 * There were three copies: `enqueue.mjs main()` (its own lead-in `--product "x"`, and no remedy clause),
 * `enqueue-schema.mjs` (the one with the clause) and `resolveSearchPolicy`'s explicit arm (no clause).
 * Which sentence a requester read depended on which door caught the typo, and only one of the three told
 * them the field is optional — the single clause that turns the refusal into a working request.
 *
 * The other two "names no search we offer" sentences in resolveSearchPolicy are deliberately NOT this
 * one and must not be folded in: the profile-default arm is a STAFF config error ("fix the <customer>
 * profile") and the retired arm is a different reason. Same words, three audiences, is how the first
 * copy of this sentence got made.
 *
 * The token is JSON-stringified and CLAMPED, the quoteTerritory discipline exactly: this sentence rides
 * .failed.reason files, outbox packets and log lines, and validateJob puts no length bound on `product`.
 */
export function unknownProductMessage(token) {
  return `product ${JSON.stringify(String(token ?? "").slice(0, 60))} names no search we offer — one of: ${PRODUCT_IDS.join(", ")} (or omit it for the account's default)`;
}

// ── Territory arithmetic ────────────────────────────────────────────────────────────────────────────

/**
 * Count the scope by TIER, deduped on canonical identity, worldwide tokens dropped.
 *
 * Deduped because a requester who wrote both `"United States"` and `"US"` named one country, and a rule
 * that counted strings would refuse them a Full country search they described correctly. Worldwide tokens
 * dropped because a mode is not a place — counting one as a territory is what let a worldwide deep dive
 * read as "one country" for as long as it did.
 *
 * Entries are kept as the requester WROTE them: a refusal that quotes "EU" at someone who typed
 * "European Union" sends them hunting for a value they never used.
 */
function tally(territories) {
  const seen = new Set();
  const out = { named: [], countries: [], regions: [], unrecognized: [] };
  for (const entry of territories ?? []) {
    const tier = territoryTier(entry);
    if (tier === "worldwide") continue;
    const key = territoryKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    out.named.push(entry);
    if (tier === "region") out.regions.push(entry);
    else if (tier === "country") out.countries.push(entry);
    else out.unrecognized.push(entry);
  }
  return out;
}

/**
 * A requester-supplied territory, quoted for a sentence that rides a log line.
 *
 * JSON-stringified so an interior newline cannot forge a row in a .failed.reason file, an outbox packet
 * or a run log — validateJob only bounds the TRIMMED length, so a newline-bearing entry passes the door.
 * Clamped as well as quoted: an account's `defaultJurisdictions` is a free-text lines field in the staff
 * profile editor and is validated as an array and nothing more, so an oversized entry would otherwise
 * become an oversized refusal.
 *
 * Exported because scope-rules.mjs writes the one remaining client sentence about scope that this module
 * does not (the native-script routing message). Two copies of this clamp is two rulers, and only one of
 * them would be under the injection test.
 */
export function quoteTerritory(value) {
  return JSON.stringify(String(value).slice(0, 40));
}

const listOf = (entries) => entries.map(quoteTerritory).join(", ");

// ── The mapping ─────────────────────────────────────────────────────────────────────────────────────

/**
 * WHICH PRODUCT is this? The pure function the whole build turns on.
 *
 *   knockout pipeline                    → Knockout search
 *   clearance pipeline + worldwide       → Global preliminary search
 *   clearance pipeline + a region        → Multi-country focus search
 *   clearance pipeline + 2..N countries  → Multi-country focus search
 *   clearance pipeline + exactly 1       → Full country search
 *
 * TOTAL over the clearance pipeline: every scope names a product, including scopes no product accepts.
 * A single entry the engine cannot place is a set of one that is not a country, so it derives to
 * Multi-country focus — and `checkProductScope` then refuses it, because a typo names nowhere and no
 * product searches nowhere. Naming first and judging second is deliberate: a refusal that cannot say
 * which product the requester landed on cannot tell them which one to ask for instead.
 *
 * @param pipeline     "knockout" | "clearance" — the resolved pipeline
 * @param territories  the RESOLVED scope (see the header). Empty ⇒ worldwide.
 * @returns a product id, or null when the pipeline is absent or unknown — nothing to name.
 */
export function productFor({ pipeline = null, territories = [] } = {}) {
  const p = String(pipeline ?? "").trim().toLowerCase();
  if (p === "knockout") return KNOCKOUT.id;
  if (p !== "clearance") return null;
  const t = tally(territories);
  if (!t.named.length) return GLOBAL.id;
  if (t.named.length === 1 && t.countries.length === 1) return FULL.id;
  return MULTI.id;
}

const OK = Object.freeze({ ok: true, reason: null, message: null });
const refuse = (reason, message) => ({ ok: false, reason, message });

/** The product this scope WOULD be, so a refusal can name the thing to order instead. */
const alternativeTo = (spec, territories) => productSpec(productFor({ pipeline: spec.pipeline, territories }));

/** "is a regional filing system covering many countries, not one country", pluralized. */
const regionClause = (regions) => regions.length === 1
  ? "is a regional filing system covering many countries, not one country"
  : "are regional filing systems covering many countries, not one country";

/**
 * Is this scope LEGAL for this product?
 *
 * Asked when a requester NAMES a product and supplies geography — the two can disagree, and this is the
 * sentence that says how. (`productFor` cannot disagree with itself, so the only refusal it can attract
 * is an unrecognized entry.)
 *
 * @returns {{ok: true, reason: null, message: null}} or {{ok: false, reason, message}} with `reason` from
 *          REFUSAL_REASONS and `message` a complete client-facing sentence. An unknown product is not
 *          judged: refusing a scope for a product nobody named would be a claim about a product that does
 *          not exist, and whether a request names a real product is the door's own check.
 */
export function checkProductScope({ product = null, territories = [] } = {}) {
  const t = tally(territories);

  // FIRST, ALWAYS: an entry that names nowhere. It is not a narrower search, it is a search with a hole
  // in it, and every product refuses it for the same reason in the same words.
  //
  // — AND "ALWAYS" NOW MEANS ALWAYS. This ran AFTER the `if (!spec) return OK`
  // below, so "every product refuses it" was true of every NAMED product and of nothing else: a request
  // that omitted `product` took any territory string at all, and the doors that resolve the product
  // later never re-asked. A vocabulary rule is the one check here that does not depend on which search
  // was bought — the entry names nowhere whatever the product turns out to be — so it is the one check
  // that must not sit behind a product gate.
  if (t.unrecognized.length) {
    return refuse(REFUSAL_REASONS.TERRITORY_NOT_RECOGNIZED,
      `${listOf(t.unrecognized)} names no country or region this engine recognizes — check the spelling, or use the two-letter country code`);
  }

  // Everything below this line IS about which search was bought, so an unnamed product genuinely has
  // nothing to say — the resolved-scope wall asks again once the product is known.
  const spec = productSpec(product);
  if (!spec) return OK;

  if (spec === KNOCKOUT) return OK;                    // worldwide or any chosen set

  if (spec === GLOBAL) {
    if (!t.named.length) return OK;
    const alt = alternativeTo(spec, territories);
    return refuse(REFUSAL_REASONS.NARROWING_NOT_OFFERED,
      `a ${GLOBAL.name} is worldwide and accepts no narrowing — this request names ${listOf(t.named)}. Remove the territories to search worldwide, or order a ${alt.name} over them`);
  }

  if (spec === MULTI) {
    if (!t.named.length) {
      return refuse(REFUSAL_REASONS.WORLDWIDE_NOT_OFFERED,
        `a ${MULTI.name} reads ${MULTI.geography} — this request resolves to no territory (worldwide). Name the region or the countries in jurisdictions, or order a ${GLOBAL.name} to search worldwide`);
    }
    if (t.named.length === 1 && t.countries.length === 1) {
      return refuse(REFUSAL_REASONS.NOT_ENOUGH_COUNTRIES,
        `a ${MULTI.name} reads ${MULTI.geography} — this request names one country (${listOf(t.countries)}). Add another country or name a region, or order a ${FULL.name} over it`);
    }
    return OK;
  }

  // FULL — exactly one country, and a region is not a country
  if (!t.named.length) {
    return refuse(REFUSAL_REASONS.WORLDWIDE_NOT_OFFERED,
      `a ${FULL.name} reads ${FULL.geography} — this request resolves to no territory (worldwide). Name ONE country in jurisdictions (e.g. ["United States"]), or order a ${GLOBAL.name} to search worldwide`);
  }
  if (t.regions.length) {
    return refuse(REFUSAL_REASONS.REGION_NOT_A_COUNTRY,
      `a ${FULL.name} reads ${FULL.geography}, and ${listOf(t.regions)} ${regionClause(t.regions)}. Name one of its countries, or order a ${MULTI.name} over the region`);
  }
  if (t.countries.length > 1) {
    return refuse(REFUSAL_REASONS.TOO_MANY_COUNTRIES,
      `a ${FULL.name} reads ${FULL.geography} — this request names ${t.countries.length} (${listOf(t.countries)}). Keep ONE and run one search per country, or order a ${MULTI.name} over them`);
  }
  return OK;
}

// ── Case law ────────────────────────────────────────────────────────────────────────────────────────

/**
 * Case law is a PRODUCT, and there is no longer a request field for it. This is the sentence that says so.
 *
 * The reading that makes a deep dive deep — precedent, oppositions, the registry's own practice — differs
 * per country, so a case-law pass spread over five of them is five shallow ones sold as one deep one, and
 * over a region it is a claim about "the" precedent of twenty-seven member states. One country or nothing,
 * and "one country" is a product with a name.
 *
 * REFUSED RATHER THAN IGNORED, including `caseLaw: false`. A flag accepted and dropped is the worst
 * available shape: whoever sent it believes they bought the deep reading (or switched one off), and
 * nothing anywhere disagrees. It is refused even on the product that DOES carry case law — sending it
 * there is not wrong, it is a request to change something that is not a setting, and answering "that is
 * what this product is" is the only way anybody learns where the reading comes from.
 *
 * WHAT THIS DOES NOT TOUCH: pipeline.mjs's decideCaseLaw has a second arm — a run whose own reading turns
 * up an opposition or a precedent still grounds the stage mid-flight, unordered. This is about what can be
 * ORDERED, because that is what somebody is being sold. The lever was never a suppression and its absence
 * is not one either.
 */
export const CASE_LAW_NOT_A_REQUEST = Object.freeze({
  reason: REFUSAL_REASONS.CASE_LAW_NOT_OFFERED,
  message: `caseLaw is not a request setting — the case-law and opposition reading is what a ${FULL.name} IS, and no other search we offer carries it. Order product "${FULL.id}" over exactly ONE country, and drop caseLaw`,
});

/**
 * `searchLevel` — THE SELECTOR ITSELF, AND THE ONE FIELD DELETED WITHOUT REFUSING.
 *
 * `search-policy.mjs:22` says the wire field is "DELETED — not deprecated, not hidden behind the product
 * name." The code made it deprecated: nothing on any door read it, nothing refused it, and there is no
 * generic unknown-field rejection — so a request naming a depth was accepted, the field dropped, and the
 * run went out at whatever product the SCOPE happened to imply.
 *
 * That is worse than the two toggles this module already refuses. `caseLaw` and `nativeLanguage:false`
 * were additions somebody believed they had bought; `searchLevel` was **how the search was chosen**. A
 * caller sending `searchLevel: "knockout"` with a one-country scope got a Full country search — the most
 * expensive product, silently, on a request that asked for the cheapest.
 *
 * Refused by name rather than mapped to a product, deliberately: a caller still on the old wire has an
 * out-of-date idea of what is on sale, and quietly translating it would hide exactly the change they
 * need to know about.
 */
export const SEARCH_LEVEL_NOT_A_REQUEST = Object.freeze({
  reason: REFUSAL_REASONS.SEARCH_LEVEL_RETIRED,
  message: `searchLevel is not a request setting — the depth ladder was retired and the four searches replaced it. Send product instead, one of: ${PRODUCT_IDS.join(", ")}. Which one you get also depends on the scope you name, so read describe_options before re-sending`,
});

// ── The native-language investigation ───────────────────────────────────────────────────────────────

/**
 * Is the native-language investigation offered, automatic, or absent on this product?
 *
 * `automatic` IS NOT A GUARANTEE THAT A LANE RUNS. The lanes route on jurisdiction
 * (JURISDICTION_ADAPTERS, jx-lanes.mjs), and a Full country search over a country with no adapter has
 * nothing to route. So `automatic` means "the client does not choose it and is not charged a toggle for
 * it", not "a lane exists". Deriving a jx level from this answer alone would build a request that the
 * native-script routing rule in scope-rules.mjs then refuses — a refusal we inflicted on ourselves.
 *
 * @returns {{ok: true, mode}} — `mode` is one of NATIVE_LANGUAGE_MODES, or null for an unknown product —
 *          or {{ok: false, reason, message, mode: "absent"}} when the product does not offer it at all.
 */
export function nativeLanguageMode(product) {
  return productSpec(product)?.nativeLanguage ?? null;
}

/**
 * `nativeLanguage: false` — the sibling of CASE_LAW_NOT_A_REQUEST, and the same doctrine on the other
 * toggle in the offering.
 *
 * The toggle only ever ADDED. It is absent from a Knockout search and a Global preliminary search, it is
 * the one thing a Multi-country focus search can buy, and it is what a Full country search carries by
 * being one. There has never been a search we offer where sending `false` removed anything — so `false`
 * was a request to switch off a stage that no product runs conditionally, and every door dropped it.
 *
 * That is the accept-and-drop shape, verbatim: the requester believes they suppressed the native-language
 * investigation on a Full country search, is billed for one that ran it anyway, and no field, no preview
 * and no report disagrees. `caseLaw: false` is refused at all five doors in this module's own words; this
 * is the same sentence for the same reason on the field beside it.
 *
 * Refused wherever it appears, including on the product that OFFERS the toggle: `false` there is not
 * "leave it off", it is "take it away", and the honest answer to a request to remove something that is
 * not there is to say so rather than to record a promise nothing keeps. Omitting the field is how you get
 * a search without it.
 */
/**
 * WHERE THE NATIVE-LANGUAGE INVESTIGATION CAN BE BOUGHT, in one sentence, derived from the offering.
 *
 * Exported because two surfaces outside this module have to say it and both used to say something else:
 * the resolution-time recommendation (jx-lanes.mjs zhScopeDepthNotes) and the DELIVERED REPORT's own
 * coverage row (pipeline.mjs scriptScopeDisclosure). Both named `prelim-jx` and `Depth 5` — an internal
 * product key and a rung on a ladder — so the coverage row named a remedy that was a product
 * deleted, quoted at a number that no longer exists, and could not have ordered either.
 *
 * It is a full sentence rather than a fragment so a caller cannot re-frame it into a promise the offering
 * does not make. `offered` and `automatic` are read from the specs, so a product whose mode changes moves
 * this sentence with it.
 */
export const NATIVE_LANGUAGE_REMEDY =
  `The native-language investigation is offered on a ${MULTI.name} and runs automatically on a ${FULL.name}.`;

export const NATIVE_LANGUAGE_NOT_A_SUPPRESSION = Object.freeze({
  reason: REFUSAL_REASONS.NATIVE_LANGUAGE_NOT_A_SUPPRESSION,
  message: `nativeLanguage: false switches nothing off — the native-language investigation is the one thing a ${MULTI.name} can add (send true), it is what a ${FULL.name} carries by being one, and no other search we offer runs it at all. Omit nativeLanguage to search without it`,
});

export function checkNativeLanguage({ product = null } = {}) {
  const spec = productSpec(product);
  if (!spec) return { ...OK, mode: null };
  if (spec.nativeLanguage !== "absent") return { ...OK, mode: spec.nativeLanguage };
  return {
    ...refuse(REFUSAL_REASONS.NATIVE_LANGUAGE_NOT_OFFERED,
      `the native-language investigation is not part of a ${spec.name}. It is offered on a ${MULTI.name} and runs automatically on a ${FULL.name}`),
    mode: "absent",
  };
}

// ── The name-count limit ────────────────────────────────────────────────────────────────────────────

/**
 * How many names this product reads in one search. Eight for a Knockout search; one for every clearance.
 *
 * THE WALL. checkMarkBudget (search-policy.mjs) reads this and nothing else. There used to be a second
 * figure — the level registry's `maxMarks`, 20 for both knockout rows — and the wrong one enforced, so a
 * twelve-name knockout passed every door. The soft cap (`warnMarks: 15`) went with it rather than being
 * renumbered: a warning at 15 under a refusal at 8 is a branch that can never run.
 */
export function maxNamesFor(product) {
  return productSpec(product)?.maxNames ?? null;
}
