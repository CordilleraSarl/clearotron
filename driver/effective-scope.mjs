// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// effective-scope.mjs — WHERE a search would actually point, resolved once for every door.
//
// Depth answers "which machinery runs" (search-policy.mjs). This answers "where is it aimed", which is
// the other half of what a requester is agreeing to when they confirm a run. Two vocabularies because
// the product name is a pure function of the pair (`productFor`), resolved against the same layers —
// and a preview that resolved them differently from the run would be worse than no preview at all.
//
// WHY THIS IS A MODULE AND NOT A FUNCTION IN plan.mjs, WHERE IT STARTED: the MCP preview (plan_run) and
// the portal's own /run/plan gate both have to tell a human what will be searched before they spend. The
// portal previously told them only the depth, mark count and turnaround — so a composer could offer a
// territory picker and then confirm a summary that never mentioned territories. Fixing that by copying
// the resolution into portal-service would create two ladders that must agree forever. This is the same
// move the codebase already made for validateJob: ONE implementation, every door calls it.
//
// THE LADDER, per field, first hit wins:
//
//   job field  >  saved search's scope  >  project overlay  >  customer profile  >  Generic default
//
// with ONE thing ABOVE the ladder for territories: a request whose geography stamp says `worldwide`
// short-circuits the whole thing. Worldwide is not a value the lower rungs can improve on — it is the
// absence of any restriction, and a default territory list "filling it in" is a narrower search than
// the one that was bought. That was not expressible before the stamp: the worldwide tokens were struck
// off the list at the door and left a job byte-identical to one that never mentioned geography.
//
// with ONE exception: `platforms` UNIONS across every layer instead of replacing. A client's marketplace
// list is a mandate, and no lower layer has standing to withdraw one — a project overlay that silently
// dropped four storefronts is a real defect in this codebase's history. `withRunPlatforms` owns that
// union so the rule has one implementation too.
//
// The project overlay is not consulted here directly: `resolveEffectiveProfile` has already folded it
// into the profile handed in, and stamped `profile.origins` with which layer won. This module reads
// those origins rather than re-deriving them, so it cannot disagree about which layer supplied a value.

import { withRunPlatforms, derivedFloor } from "./profiles.mjs";
import { recognizedTerritories } from "./territory-tiers.mjs";   // — a staff free-text field must not reach a prompt unchecked

/**
 * Human-readable provenance, shown to clients.
 *
 * The account line names the FIELD as well as the layer ("the account's default territories", not "the
 * account's default"), because these appear one per row in a summary someone is about to approve and a
 * bare layer name reads as boilerplate. The others are unambiguous without it.
 */
const FROM = {
  request: "this request",
  savedSearch: "the saved search",
  project: "this project",
  account: (noun) => `the account's default ${noun}`,
  none: "not set anywhere",
};

const nonEmpty = (a) => Array.isArray(a) && a.length > 0;

/**
 * `job.jurisdictions` as an ARRAY, whatever shape it arrived in.
 *
 * A bare string is coerced at the door (enqueue-schema), but a raw queue file written by anything else
 * reaches the engine unconverted, and the two consumers that mattered disagreed about it in silence:
 * stages.mjs accepted a bare string, jx-lanes.mjs tested Array.isArray and fell through to the account's
 * defaults. One shape here as well, so the ladder cannot be the third opinion.
 */
export const jobJurisdictions = (job) =>
  Array.isArray(job?.jurisdictions) ? job.jurisdictions : (job?.jurisdictions ? [job.jurisdictions] : []);

/**
 * THE TERRITORY LADDER — the ONE answer to "where would this search actually point".
 *
 * Extracted from resolveEffectiveScope so that the three consumers which cannot call the full resolver
 * read the SAME rungs. They did not: `registerJurisdictions` (pipeline.mjs) and `scopeTerritories`
 * (stages.mjs) both re-implemented "instructed, else the account's defaults" by hand, and neither had
 * ever heard of the geography stamp. So a request stamped `mode: "worldwide"` — admitted as worldwide by
 * every door, priced as worldwide, named a Global preliminary search on the document — reached the
 * register plan and NARROWED to the account's seven default territories, and the marketplace-risk
 * directive framed those same seven. That is the exact incident the stamp was minted to end, surviving
 * one layer below the doors that now honour it.
 *
 *   geography.mode "worldwide"  →  [] — no territorial restriction, and no lower rung may add one.
 *                                  Emptiness IS worldwide downstream: register-plan.mjs sweeps
 *                                  unrestricted and products.mjs names it a Global preliminary search.
 *   the request's own list      →  as written
 *   the saved search's scope    →  as written (null at the callers that run after foldRecipeScope, which
 *                                  has already written it into the job)
 *   the account/project default →  as written
 *   nothing                     →  []
 *
 * @returns {{jurisdictions, from, geographyMode}} — `from` is the client-facing provenance sentence.
 */
/**
 * — WHAT THE ACCOUNT'S DEFAULT TERRITORIES MAY SAY TO THE MATTER FRAME.
 *
 * Returns 0 or 1 prompt lines, spread into the frame's message by stages.mjs.
 *
 * THE RULE IS THE LADDER'S RULE, which is why it lives beside the ladder rather than in the prompt: a
 * default FILLS AN ABSENT SCOPE and never widens a stated one. `resolveTerritories` below has always
 * honoured that. The matter-frame prompt did not — it announced the defaults unconditionally, so an
 * order over Japan under a project defaulting to JP,KR put both in the frame, fourteen lines after the
 * frame said "Instructed territories (AUTHORITATIVE scope — do NOT widen)". A later stage then asks for
 * a UNION of the coverage ledger against that list. The model complied: seven Korean records retrieved
 * and completed Korean coverage claimed six times, on a Full country search ordered over one country.
 *
 * There are TWO channels from an order to the engine — this ladder, which is walled by
 * checkProductScope at every door, and the prompt, which was not. The run was validated as JP and
 * executed as JP+KR, and no gate was wrong.
 *
 * ASKED THROUGH `jobJurisdictions`, the shared shape rule that exists BECAUSE stages.mjs once took a
 * bare string where jx-lanes.mjs tested Array.isArray and fell through to the defaults. A stated scope
 * of ANY shape suppresses this line.
 *
 * VOCABULARY-CHECKED, because `defaultJurisdictions` is free text in the staff profile editor,
 * validated as an array and nothing more, and this is the path by which it reaches a client-facing
 * prompt. Unrecognized entries are DROPPED rather than refused — see recognizedTerritories for why a
 * staff typo must not become an outage — and an all-garbage list yields no line at all rather than a
 * sentence with nothing in it.
 *
 * IT LIVES HERE, not inline in the prompt, for a second and duller reason worth writing down: stages.mjs
 * carries thirty-odd line-number citations from other files, so inserting explanation into it silently
 * repoints all of them. Keeping the reasoning where the rule lives costs that file no lines.
 */
export function defaultJurisdictionsLine(job, profile) {
  if (jobJurisdictions(job).length) return [];
  const { kept } = recognizedTerritories(profile ? profile.defaultJurisdictions ?? [] : []);
  return kept.length
    ? [`Customer-default jurisdictions that materially matter (the request names none — apply these): ${kept.join(", ")}.`]
    : [];
}

export function resolveTerritories(job = {}, profile = null, saved = null) {
  const mode = job?.geography?.mode ?? null;
  const accountFrom = profile?.origins?.defaultJurisdictions === "project" ? FROM.project : FROM.account("territories");
  const named = jobJurisdictions(job);
  if (mode === "worldwide") {
    // WORLDWIDE WINS, ahead of every other rung. A worldwide search accepts no narrowing, so the
    // account's default territories are not consulted — they are not a fallback here, they are a
    // contradiction. Before the stamp existed this request was indistinguishable from silence and fell
    // through to those very defaults: an account with seven of them bought "everywhere" and ran seven.
    return { jurisdictions: [], from: FROM.request, geographyMode: "worldwide" };
  }
  if (nonEmpty(named)) {
    // WHO put these here is the stamp's answer, not "they are present, so the requester sent them".
    // job.jurisdictions is written to after the door: foldRecipeScope (pipeline.mjs) copies a saved
    // search's territories into it. Under an "account-default" stamp the requester named none, so a
    // populated list is that copy — attributing it to "this request" is a claim about a person who never
    // made it. An unstamped job has no such evidence either way, and presence is all there has ever been.
    return { jurisdictions: named, from: mode === "account-default" ? FROM.savedSearch : FROM.request, geographyMode: mode ?? "unrecorded" };
  }
  if (nonEmpty(saved?.jurisdictions)) return { jurisdictions: saved.jurisdictions, from: FROM.savedSearch, geographyMode: mode ?? "unrecorded" };
  if (nonEmpty(profile?.defaultJurisdictions)) return { jurisdictions: profile.defaultJurisdictions, from: accountFrom, geographyMode: mode ?? "unrecorded" };
  return { jurisdictions: [], from: FROM.none, geographyMode: mode ?? "unrecorded" };
}

/**
 * Resolve the effective scope of a job.
 *
 * @param job      the validated job (jurisdictions/platforms/classes as the requester gave them)
 * @param profile  the EFFECTIVE profile from resolveEffectiveProfile — project already folded in
 * @param resolved the resolved search policy from resolveSearchPolicy — supplies `recipeScope`
 * @returns {{jurisdictions, jurisdictionsFrom, geographyMode, classes, classesFrom, platforms,
 *            platformsAdded, platformsFrom, gridCellsPerVariant}}
 */
export function resolveEffectiveScope(job = {}, profile = null, resolved = null) {
  const saved = resolved?.recipeScope ?? null;
  // Which layer set the territories. The project/account distinction comes from the profile's own
  // origins stamp, so a value that reached the profile via an overlay says "this project" rather than
  // claiming to be an account default — the difference matters to whoever is approving the run.
  const accountClFrom = profile?.origins?.defaultClasses === "project" ? FROM.project : FROM.account("classes");

  // The territories, and the geography STAMP that decides them (enqueue-schema.mjs) — one ladder,
  // above, shared with the freeze, the register plan and the stage prompts. `geographyMode: null` means
  // the job predates the field: a distinct state, NOT a default. It resolves down the ladder exactly as
  // it always did, and says so as "unrecorded" rather than claiming an intent nobody recorded.
  const { jurisdictions, from: jurisdictionsFrom, geographyMode } = resolveTerritories(job, profile, saved);

  let classes, classesFrom;
  if (nonEmpty(job.classes)) { classes = job.classes; classesFrom = FROM.request; }
  else if (nonEmpty(saved?.classes)) { classes = saved.classes; classesFrom = FROM.savedSearch; }
  else if (nonEmpty(profile?.defaultClasses)) { classes = profile.defaultClasses; classesFrom = accountClFrom; }
  else { classes = []; classesFrom = FROM.none; }

  // Platforms UNION rather than replace, and they union in BOTH directions: the saved search's stores are
  // folded in first so a per-run addition sits on top of them, and neither can remove an account's own.
  const base = profile ?? { platforms: [] };
  const { profile: withSaved } = withRunPlatforms(base, saved?.platforms);
  const { profile: widened, added } = withRunPlatforms(withSaved, job.platforms);
  const accountPlatforms = new Set((base.platforms ?? []).map((p) => String(p).trim().toLowerCase()));
  const savedAdded = (withSaved.platforms ?? []).filter((p) => !accountPlatforms.has(String(p).trim().toLowerCase()));

  return {
    jurisdictions, jurisdictionsFrom,
    // The MACHINE-readable half of the same answer, kept apart from `jurisdictionsFrom` on purpose:
    // that string renders verbatim to a client and must stay a sentence about their search, while this
    // is a value a rule switches on. "unrecorded" only ever appears for a job that predates the stamp.
    geographyMode,
    classes, classesFrom,
    platforms: widened.platforms ?? [],
    // What THIS request added, as against what the account already mandated. The composer needs the
    // split to render account marketplaces as fixed: a deselect there is a no-op the union undoes, and
    // a removable-looking chip would be a lie about what the search will sweep.
    platformsAdded: added,
    platformsFromSavedSearch: savedAdded,
    platformsFrom: added.length ? FROM.request : (savedAdded.length ? FROM.savedSearch : FROM.account("marketplaces")),
    // The common-law grid's size follows the platform list, so widening the marketplaces widens the
    // work. Surfaced because it is the part a requester cannot infer from their own request.
    gridCellsPerVariant: profile ? derivedFloor(widened) : null,
  };
}

export { FROM as SCOPE_ORIGINS };
