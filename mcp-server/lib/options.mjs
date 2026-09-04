// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// lib/options.mjs — describe_options: the MENU, for an agent that has to present real choices.
//
// THE GAP THIS CLOSES. A client opening the portal's composer is handed a whole option space before
// they compose anything: three named templates, every depth with its stage label, its mark budget and
// its turnaround, an availability note when one is switched off, and blockers that explain themselves.
// An external assistant driving the SAME product over MCP got five bare enum strings on a `searchLevel`
// field and had to guess the rest — including `profileKey`, which an accounts-scoped session is REQUIRED
// to pass and could not discover, because list_profiles enumerates the firm's customer roster and is
// staff-only by design. The result was an agent that either guessed, or asked its user a question the
// user could not answer either.
//
// So this answers, in one free call: what depths exist and which are actually available here, the three
// the four products a client asks for by name, the combination rules the servers enforce, and WHO the caller is —
// their account key, their projects, their saved searches, and what is left of today's allowance.
//
// TWO DISCIPLINES RUN THROUGH IT.
//
// 1. NOTHING STAFF-FACING LEAVES. Availability is expressed ONLY through the prose split: the engine
//    hands over a cause (gateCause/productAvailability) and UNAVAILABLE_NOTE holds the only two sentences
//    a client-facing surface may render. No kill-switch name, no env var, no module path, and no caught
//    error message (an fs error carries a path, and a path is exactly the shape the leak scan refuses).
//    describe-options.test.mjs greps the whole serialized response for both shapes.
//
// 2. IT DOES NOT INVENT A SECOND MENU, and it no longer needs a mirror to avoid one. There used to be
//    three hand-written "bundles" here, kept in step by eye with the portal composer's three TEMPLATES —
//    same names, same taglines — because a client who sees "Full deep dive" in the browser and hears
//    something different from their assistant has been given two products. Two hand-written lists that
//    must agree forever is the shape this codebase keeps having to repair; the offering (driver/
//    products.mjs) is now the list, both surfaces read it, and there is nothing left to mirror. Every
//    figure below — the geography a product accepts, the name count — is COMPUTED from that one row.
//
// It is a DESCRIPTION and never an order: plan_run is still the free preview of a specific request, and
// start_run is still the only thing that spends.

import { ORDERABLE_PRODUCTS, PRODUCT_POLICIES, productAvailability, gateCause, UNAVAILABLE_NOTE, coverageDisclosure, loadRecipes } from "../../driver/search-policy.mjs";
import { productRow } from "../../driver/product-rows.mjs";
import { PRODUCTS, productName } from "../../driver/products.mjs";
import { readFlagSnapshot, builtFor, registerCanCountFor, registerTerritoriesFor } from "../../driver/flag-snapshot.mjs";
import { ROUTING_NAMES } from "../../driver/scope-rules.mjs";
import { loadProfiles, loadProjects, recipeProseGuard } from "../../driver/profiles.mjs";
import { accountUsage, DEFAULT_CLIENT_DAILY_RUNS } from "../../driver/usage-ledger.mjs";
import { config } from "./driver.mjs";
import { BRAND } from "../../shared/brand.mjs";   // — the operator name in the allowance notes, from the tenant seam

// What each product IS, in the words a requester uses. The registry knows its components; a client does
// not, and must not have to: `jxLanes`, `commonLawGrid` and `registerProbe` are the machinery's names for
// itself (search-policy.mjs is explicit that they are named for the machinery precisely so nobody reads
// them as the product). A fixed map keyed by the closed offering, so a product that ships without a
// headline is caught by the completeness test rather than shipping as a bare key.
//
// WHAT IS NOT HERE: the geography each product accepts, and how many names it reads. Both come off the
// offering row (products.mjs) and are rendered below, because both are figures a wall enforces — and a
// sentence here saying "up to 20 names" beside a wall that refuses at 8 is precisely what this build
// deleted from the composer's own template list.
const HEADLINE = {
  "knockout-search": "A fast marketplace and common-law sweep across many names at once, with live filing counts per name — the obvious blockers, without a full register read.",
  "global-preliminary-search": "The standard read everywhere: trademark registers and the live marketplace, worldwide, one name.",
  "multi-country-focus-search": "The standard read, narrowed to a region or a named set of countries. The only search that offers the native-language investigation as a choice.",
  "full-country-search": "The deepest read, on ONE country: registers, marketplace, the case-law and opposition reading, and the native language of that country automatically.",
};

// THE BUNDLES ARE GONE, and their deletion is the change rather than a tidy-up. They were three
// hand-written shortcuts — `knockout` / `global-prelim` / `deep-dive` — each carrying a `searchLevel`
// plus a `caseLaw` flag, and each naming a product ("Full deep dive") that appeared in no registry, on
// no report and on no wire. That is what a bundle IS when the wire does not carry the product: a second
// menu, invented to say the thing the first menu could not. The wire carries the product now, so the
// menu below IS the offering and there is nothing left for a bundle to add.
//
// One of them also baked `territories: ['United States']` into a deep dive, with a long note explaining
// that a menu read aloud by an assistant must not guess a country. That reasoning was right and is now
// structural: the Full country search states that it reads exactly one country, and a request that names
// none is refused by the same sentence at every door rather than by a note in a menu.

/**
 * The build map this deployment actually has, reconciled against the flag snapshot.
 *
 * NOT the bare BUILT map. BUILT says the machinery EXISTS; it cannot say the wired register will answer
 * a count, and flag-snapshot.mjs reconciles exactly that ("Depth 2 is a count, and not every register
 * provider can count … Left alone, the portal would offer the level from `built` and the engine would
 * refuse it at the lane's preflight"). The portal reads it this way (portal-service.mjs readBuilt); a
 * menu that read the bare map would tell a client's assistant Depth 2 is available while the client's
 * own browser said it is not — the same divergence, re-opened on the surface whose job is to ADVERTISE.
 *
 * readFlagSnapshot degrades to null on a missing or unreadable file, and builtFor(null) is BUILT — the
 * degradation rule, unchanged: unknown availability reads as available and the request falls through to
 * the gate rather than being hidden.
 */
function builtHere() {
  return builtFor(readFlagSnapshot(config.poolRootOrNull));
}

// The combination rules the servers actually enforce, stated so an agent can compose a request that
// passes instead of discovering them one refusal at a time. Wording mirrors driver/scope-rules.mjs and
// driver/enqueue-schema.mjs; the caps are written as prose rather than imported constants, because what
// an agent needs is the sentence, not the number's provenance.
const SCOPE_RULES = {
  jurisdictions: "WHERE the search points, and — for a clearance — WHICH search it is. Names or codes both read (\"United States\" or \"US\"). Max 20 per search. Never send \"Worldwide\" as a list entry: send geography {\"mode\":\"worldwide\"} instead, which is a positive instruction the account's own territories may not narrow. Omitting jurisdictions is NOT the same thing — it means \"whatever the account says\".",
  nativeScript: `The native-language investigation routes on territory: it only fires when the scope names one of ${Object.entries(ROUTING_NAMES).map(([code, name]) => `${name} (${code})`).join(", ")}. It is a choice on a ${productName("multi-country-focus-search")} (send nativeLanguage: true) and automatic on a ${productName("full-country-search")}; ordering it where the scope routes nothing is refused rather than billed for nothing.`,
  caseLaw: `NOT A FIELD. The case-law and opposition reading is what a ${productName("full-country-search")} IS — one country at a time, because precedent, oppositions and registry practice differ per country and a deep dive spread over five is five shallow ones sold as one. Order that product over exactly ONE country; sending caseLaw is refused.`,
  platforms: "Extra marketplaces to sweep, as bare store domains ([\"gnc.com\"]). ADDED to the account's own marketplaces, never a replacement. Max 10. Refused on a quick screen, which has no marketplace grid for a store to be swept in.",
  classes: "Nice classes, whole numbers 1–45 (1–34 goods, 35–45 services). Omit for the account's defaults. classes OR goods — either suffices.",
  marks: `How many names one search reads is the product\'s own figure, and it is on every row below (${PRODUCTS.map((p) => `${p.name}: ${p.maxNames}`).join("; ")}). Over it, the request is refused — never silently truncated.`,
};

const _NOTE = "This is the MENU, not an order. Nothing here reserves, spends or starts anything. Pick a product, then call plan_run (free) with the arguments you intend — it resolves the depth, the territories and the marketplaces that would ACTUALLY be searched and reports any blockers. Show that to the requester, and only then call start_run with the SAME arguments.";

/** The offering, in offering order, with each product's availability said the one way a client may hear it. */
function products(built, registerCanCount = null, registerTerritories = undefined) {
  return ORDERABLE_PRODUCTS.map((key) => {
    const p = PRODUCT_POLICIES[key];
    // The FLAGS are read from process.env, which is the right answer here: unlike the portal, the MCP
    // server runs inside the engine's environment (the shipped unit templates carry EnvironmentFile,
    // portal-service.service deliberately does not). The BUILD map is not — see builtHere().
    // — the coverage arm rides the same call. `registerTerritories` comes from the SNAPSHOT rather
    // than from capabilities directly, so this door answers from the same field the portal and the
    // cockpit read; asking capabilitiesFor() here would be a second source of the same truth.
    // FIELDS ARE PICKED, NEVER SPREAD, and that is a test speaking: describe-options.test.mjs asserts
    // this response names no `jxLanes|commonLawGrid|registerProbe`, so `...productRow(key)` would ship
    // `components` and fail CI. `headline` stays beside `name` because they are different registers —
    // `name` is what the thing is called, `headline` is a sentence about it.
    const row = productRow(key);
    // — the coverage arm rides the same call, and takes the geography from the SAME row the
    // response publishes, so the requirement a client is shown is the one that was ruled on.
    // `registerTerritories` comes from the snapshot rather than from capabilities directly, so this door
    // answers from the field the portal and the cockpit read; capabilitiesFor() here would be a second
    // source of one truth.
    const cause = productAvailability(p, {
      built, registerCanCount, registerTerritories, geography: row.geography,
    });
    return {
      key,
      name: row.name,
      headline: HEADLINE[key] ?? null,
      // The offering's own words for what this product accepts, and its own figure for how many names it
      // reads. Both computed, neither typed: an assistant that relays a number a wall does not enforce is
      // the invitation/enforcement mismatch, said out loud to a client.
      geography: row.geography,
      maxNames: row.maxNames,
      caseLaw: row.caseLaw
        ? `The case-law and opposition reading is part of this search. It is not offered on any other, and it is not a flag.`
        : null,
      nativeLanguage: row.nativeLanguage === "automatic"
        ? "The native-language investigation runs automatically."
        : row.nativeLanguage === "offered"
          ? "The native-language investigation is optional here — send nativeLanguage: true. It routes on territory, so the scope must name one it covers."
          : null,
      baseTurnaround: row.baseTurnaround,
      baseTurnaroundHours: row.baseTurnaroundHours,
      available: cause === null,
      // The CAUSE never travels; only its sentence does. This is the structural reason no CLEAROTRON_* name
      // can reach a client's assistant from here.
      unavailableNote: cause ? UNAVAILABLE_NOTE[cause] : null,
      // — the same disclosure the browser gets, on the same product, from the
      // same composer. A worldwide search is orderable on a partial register now; what that register
      // does not reach is a sentence beside a live product rather than the reason a dead one refuses.
      // Two doors, one answer: an assistant driving this must not be able to tell a client something
      // the screen does not say.
      coverageNote: coverageDisclosure(row.geography, registerTerritories)?.note ?? null,
    };
  });
}

/**
 * WHICH account this call is about.
 *
 * An explicit profileKey wins (already grant-checked at the chokepoint). Otherwise a session granted
 * exactly ONE account is answered about that one — the common case, and the whole point: an assistant
 * that must pass profileKey can now learn it without being handed the firm's roster. A session granted
 * several and naming none gets accountsGranted[] instead, which is the same answer in list form.
 *
 * A full-grant ("*") or unscoped session (ops, staff) resolves to nothing without an explicit key: it is
 * not "their" account, and guessing one would be worse than saying nothing.
 */
function accountKeyFor(args, scope) {
  const named = args?.profileKey ? String(args.profileKey).trim() : "";
  if (named) return named;
  const acc = scope?.accounts;
  return Array.isArray(acc) && acc.length === 1 ? acc[0] : null;
}

/** The account block: who you are ordering for, and what you may order against it. */
function accountFor(key, { scope, now }) {
  if (!key) return null;
  let profile = null;
  try { profile = loadProfiles().get(key) ?? null; } catch { return null; }   // unreadable roster ⇒ say nothing
  if (!profile || profile.key === "generic") return null;

  let projects = [];
  try {
    for (const [, ov] of loadProjects()) {
      if (ov.archived || ov.customerKey !== key) continue;
      projects.push({ key: ov.projectKey, name: ov.projectName });
    }
    projects.sort((a, b) => a.key.localeCompare(b.key));
  } catch { projects = []; }   // a bad project file must never blank the whole answer

  return {
    profileKey: profile.key,
    name: profile.name ?? null,
    projects,
    defaults: {
      product: profile.defaultProduct ?? null,
      productName: profile.defaultProduct ? (productName(profile.defaultProduct) ?? null) : null,
      jurisdictions: profile.defaultJurisdictions ?? [],
      classes: profile.defaultClasses ?? [],
      // WHAT AN UNSET DEFAULT MEANS, said rather than left as a null an assistant will read as "none".
      // A request that names no product is named by the territories it resolves to, which for an account
      // with default territories is a real, specific product — not an absence.
      note: profile.defaultProduct
        ? null
        : "This account names no default search. A request that names none is whichever search its resolved territories make it — worldwide is a Global preliminary search, one country is a Full country search, anything else is a Multi-country focus search.",
    },
    ...savedSearchesFor(key),
    allowance: allowanceFor(profile, { scope, now }),
  };
}

/**
 * The account's saved searches — recipeKey discovery, the second half of the same dead end.
 *
 * A saved search is named by SLUG in `recipeKey`, and an agent had no way to learn a slug either.
 * Grant-scoped by construction (only this account's directory is read) and archived ones are dropped:
 * this list is what an assistant offers, and a name it can see is a name it can pick.
 *
 * There used to be a probe here for a SHUT saved-search door: CLEAROTRON_RECIPES_MODE could refuse every
 * recipeKey, and offering one that plan_run would then refuse is the invitation/enforcement mismatch this
 * codebase keeps getting bitten by. That switch was retired (2026-07-27) — a saved search is now honoured
 * wherever it resolves — so there is no shut state left to probe, and the invitation cannot disagree with
 * the enforcement because neither consults an environment.
 *
 * An account that simply has no saved searches gets an empty list and no note.
 */
function savedSearchesFor(key) {
  let recipes;
  try { recipes = loadRecipes({ force: true, proseGuard: recipeProseGuard }); } catch { return { savedSearches: [], savedSearchesNote: null }; }
  return {
    savedSearches: [...recipes.entries()]
      .filter(([k, r]) => k.startsWith(`${key}/`) && !r.archived)
      .map(([k, r]) => ({ slug: k.split("/")[1], label: r.label ?? null, product: r.base ?? null, productName: productName(r.base) ?? null }))
      .sort((a, b) => a.slug.localeCompare(b.slug)),
    savedSearchesNote: null,
  };
}

/**
 * What is left of today's allowance — the same ledger the admission wall counts (usage-ledger.mjs).
 *
 * `capped` is the honest half: only a CLIENT principal's runs consume the allowance (the runner bites
 * jobs stamped clientPrincipal:true, and only the account door stamps them), so a staff session reading
 * this sees the counts and is told they do not bind it. A ledger that cannot be read yields no allowance
 * rather than a fabricated one.
 *
 * THAT LAST SENTENCE NOW HAS CODE UNDER IT. The count never threw — a wrong ledger path came back
 * 0 — so this reported "2 of 2 remaining" to every client of a deployment whose queue had moved.
 *
 * `null` was not available as the answer for it. `null` here already means "no allowance applies": staff
 * scope, `generic`, no profile. An assistant reading that cannot tell "you are uncapped" from "we could
 * not count", and the second one is the one where it should stop promising the client a fresh day. So
 * blind gets a BLOCK OF ITS OWN — `complete: false`, every figure null rather than zero, the limit still
 * named because the limit is real, and a sentence, because a sentence is what an assistant relays.
 */
function allowanceFor(profile, { scope, now }) {
  const caps = profile.runCaps ?? null;
  const dailyRuns = Number.isInteger(caps?.dailyRuns) ? caps.dailyRuns : DEFAULT_CLIENT_DAILY_RUNS;
  let usage;
  // The queue dirs the runner drains — the ledger sits beside each of them (usage-ledger.mjs).
  try { usage = accountUsage({ queueDirs: config.queueDirs, account: profile.key, now }); } catch { usage = null; }
  const shared = {
    capped: scope?.kind === "account",
    dailyRuns,
    monthlyRuns: caps?.monthlyRuns ?? null,
    maxQueued: caps?.maxQueued ?? null,
  };
  if (!usage?.complete) {
    return {
      ...shared,
      complete: false,
      usedToday: null, remainingToday: null, usedThisMonth: null, queued: null,
      note: `This account's usage could not be read here, so the figures are absent rather than zero — do not tell the requester how much of today's allowance is left. The allowance itself is real and admission still enforces it; ask your ${BRAND.name} contact for today's count.`,
    };
  }
  return {
    ...shared,
    complete: true,
    usedToday: usage.today,
    remainingToday: Math.max(0, dailyRuns - usage.today),
    usedThisMonth: usage.thisMonth,
    queued: usage.queued,
    note: `The allowance resets at midnight UTC. ${BRAND.name} can run a search for this account when it is spent.`,
  };
}

/**
 * describe_options — the option space, for free.
 *
 * @param args   {profileKey?} — omit it to be answered about the session's own account(s).
 * @param scope  the resolved principal (the grant was already enforced at the chokepoint).
 */
export function describeOptions(args = {}, { scope, now = Date.now() } = {}) {
  // Read ONCE. There is a single menu now — the offering — so there is no second half to disagree with
  // it, which is what the hand-written bundle list was and why it is gone.
  const built = builtHere();
  const key = accountKeyFor(args, scope);
  const account = accountFor(key, { scope, now });
  const granted = scope?.accounts;
  // The profileKey discovery answer: several accounts held, none named. Listing the KEYS (and, where the
  // roster reads, their names) is what turns "an accounts-scoped session must set profileKey explicitly"
  // from a dead end into a question the assistant can put to its user.
  const accountsGranted = !account && Array.isArray(granted) && granted.length
    ? granted.map((k) => {
      let name = null;
      try { name = loadProfiles().get(k)?.name ?? null; } catch { /* roster unreadable ⇒ the key alone */ }
      return { profileKey: k, name };
    })
    : null;

  // ONE READ, and the reason is not tidiness. The snapshot is rewritten by a different process on every
  // restart, so two reads inside one response can straddle that write and produce a reply whose product
  // list was decided by one register and whose territory list by another — internally inconsistent, and
  // in a shape nothing downstream could detect.
  const snapshot = readFlagSnapshot(config.poolRootOrNull);
  const territories = registerTerritoriesFor(snapshot);

  return {
    _note: _NOTE,
    products: products(built, registerCanCountFor(snapshot), territories),
    // What this deployment's register can actually search, in the composer's own display names. Omitted
    // — not nulled — when the snapshot does not say, and `null` when the register declares no
    // restriction: an assistant must be able to tell "everywhere" from "this box has not told me", and
    // both from an enumerated list. Territories outside the list are not refused; they come back as
    // disclosed deferred coverage rows, which is what the engine already does with them.
    ...(territories === undefined ? {} : { registerTerritories: territories }),
    scopeRules: SCOPE_RULES,
    account,
    ...(accountsGranted ? { accountsGranted } : {}),
    ...(account || accountsGranted ? {} : {
      accountNote: "No account resolved for this session. Pass profileKey to be answered about a specific account; omit it on a client connector to be answered about your own.",
    }),
  };
}
