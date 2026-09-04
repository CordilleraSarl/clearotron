// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// lib/plan.mjs — plan_run: what WOULD happen, for free.
//
// An agent asked to "clear NOVAPULSE" can already call start_run. What it could not do is find out what
// that would mean before spending: which depth resolves, from where, which territories and marketplaces
// actually get searched, and whether the account is near a cap. Without that, the only way to answer "is
// this what you want?" is to run the search and find out — which is the expensive way to learn that the
// customer's default was a Depth 1 when the requester meant a full preliminary.
//
// So this resolves the whole picture and returns it, and writes NOTHING. No queue file, no run dir, no
// ledger row. It is the same shape the portal's /run/plan step shows a human before they confirm; the
// difference is that an agent relays it in conversation instead of rendering it.
//
// ── WHY IT MINTS NO TOKEN ───────────────────────────────────────────────────────────────────────────
//
// The portal's plan step hands back a one-shot HMAC confirmationToken and its /run door consumes it. It
// would be natural to mirror that here and make start_run require one — and it would break the live
// spend path: verifyConfirmation CONSUMES the jti before the portal calls trigger(), and trigger() calls
// start_run WITHOUT a token, so a start_run that verified tokens would reject the portal's own already
// spent one. start_run therefore stays as it is, and the wall against an accidental expensive run is the
// runner's admission caps (runCaps), which every door passes through — including email intake, which has
// no plan step at all and never will.
//
// This is advice, in other words, not a gate. It is honest about that.

import { validateJob, wantsPortalRoute, PORTAL_ROUTE_UNAVAILABLE } from "../../driver/enqueue-schema.mjs";
import { resolveEffectiveProfile, recipeProseGuard } from "../../driver/profiles.mjs";
import { gateCause, UNAVAILABLE_NOTE, coverageDisclosure, policyFor, loadRecipes, countJobMarks } from "../../driver/search-policy.mjs";
import { productRow, baseTurnaroundFor } from "../../driver/product-rows.mjs";
import { resolveRequest } from "../../driver/resolve-request.mjs";
import { readFlagSnapshot, builtFor, registerCanCountFor, registerTerritoriesFor } from "../../driver/flag-snapshot.mjs";
import { gateResolvedRequest } from "../../driver/door-gates.mjs";   // the resolved-product checks every door runs
import { quoteForJob } from "../../driver/run-quote.mjs";
import { accountUsage, DEFAULT_CLIENT_DAILY_RUNS } from "../../driver/usage-ledger.mjs";
import { config } from "./driver.mjs";
import { buildJob, assertScopedProfileKey } from "./ops.mjs";
import { BRAND } from "../../shared/brand.mjs";   // — the operator name in the allowance note, from the tenant seam

// The verbatim legal caveat every plan carries. NOT paraphrasable: it states what a common-law-first
// screen can and cannot tell you, and softening it would misrepresent the product to the person deciding
// whether to buy it.
export const PLAN_CAVEAT = "Ratings reflect our common law assessment. Register analysis may adjust ratings in either direction.";

// THE INVERTED CAVEAT WENT WITH THE LEVEL (, 2026-08-06). A second caveat existed for one reason:
// register-only ran the halves the other way round, so "ratings reflect our common law assessment" would
// have described an assessment that never ran. That level is retired and no resolution reaches this file
// without one — a plan describes a run that WOULD start, and none of them can be register-only — so
// `caveatFor` had exactly one answer left and is gone rather than kept as a branch that reads as a
// choice. Every plan carries PLAN_CAVEAT. (The run that already happened still says its own basis: that
// sentence lives on riskStatement, off the run's frozen policy, not here.)

// The resolver's origin tokens, in words a requester can act on. Keyed off resolveSearchPolicy's own
// `origins.level` so the plan can never disagree with the resolution about which layer won. An unknown
// token falls through to the Generic default, which is what an unresolved chain actually lands on.
const PRODUCT_ORIGIN = {
  "job.recipeKey": "the saved search you named",
  "job.product": "this request",
  "project.defaultProduct": "this project's default",
  "profile.defaultProduct": "the account's default",
  // Not a "house default" any more: nothing picks a product when nobody named one — the resolved
  // TERRITORIES name it, which is a real answer about this request rather than a fallback.
  "the-scope": "the territories this search resolves to (nobody named a product)",
};

/**
 * "This depth cannot run here" — in words a REQUESTER can act on, never the engine's own sentence.
 *
 * gateResolvedPolicy writes for staff, the runner's clarify path and the logs. plan_run's blockers are
 * relayed straight into a conversation with a client, so the engine hands over a CAUSE (gateCause) and
 * the wording is composed HERE, from the SAME sentences the portal renders (UNAVAILABLE_NOTE) with the
 * same stage-label composition — one product, one answer, whichever door asked.
 *
 * That split was originally about keeping an environment variable's NAME away from a client's assistant
 * ("CLEAROTRON_JX_LANES is off" teaches an agent nothing it can act on). The switches are retired now, so
 * there is no name left to leak — but the split still earns its keep: an unbuilt component and an
 * unresolvable depth need different sentences, and only this side knows how to say either to a client.
 *
 * The stage LABEL, never the internal level key: it is the only name for this thing a requester has
 * ever been shown (the report-identity rule the portal's own gate follows).
 */
function unavailableNoteFor(gate) {
  if (!gate) return null;
  // The `recipes-disabled` arm went with CLEAROTRON_RECIPES_MODE (2026-07-27): a saved search is honoured
  // wherever it resolves, so there is no state left for it to describe.
  if (gate.cause === "unresolved")
    return "That search could not be resolved — name a product, or omit it to run the account's default.";
  return `${gate.stageLabel ?? "That search"} is unavailable. ${UNAVAILABLE_NOTE[gate.cause]}`;
}

/**
 * What this account has already spent against today's allowance — ADVICE, beside the blockers.
 *
 * The runner's runCaps remain the wall: they cover every door, including email intake, which has no
 * plan step and never will. What this adds is that an agent stops telling a requester "this will run"
 * about a request admission is going to refuse — the free preview's whole job. It reads the SAME ledger
 * the wall reads (usage-ledger.mjs), so the number here and the number that refuses cannot disagree by
 * anything but a concurrent run.
 *
 * An UNREADABLE profile gets no check at all, and that is deliberate rather than lazy: inventing a limit
 * we could not read would block a client whose profile may say something larger. The portal's own
 * pre-check made the same call for the same reason. `generic` is exempt because it is the neutral
 * profile a request with no account runs under, not an account with an allowance.
 *
 * AN UNREADABLE LEDGER IS A THIRD STATE, and it may not borrow either of the other two. `null`
 * here already means "no allowance applies" — `generic`, no profile, nothing to count against — and an
 * agent handed that about a real capped account is told it is uncapped. Returning the counts as zeros is
 * worse still: `exhausted` becomes a BLOCKING sentence on no evidence in one direction, and a promised
 * fresh day on no evidence in the other. So blind returns a block that says `complete: false`, carries
 * NULL where a count would be, keeps the limit (the limit is real and was read from the profile), and is
 * never `exhausted` — the wall is the control and a preview must degrade, not refuse.
 */
function allowanceFor(profile, { scope, now = Date.now() } = {}) {
  if (!profile?.key || profile.key === "generic") return null;
  const caps = profile.runCaps ?? null;
  const dailyRuns = Number.isInteger(caps?.dailyRuns) ? caps.dailyRuns : DEFAULT_CLIENT_DAILY_RUNS;
  let usage;
  // The queue dirs the runner drains — the ledger sits beside each of them (usage-ledger.mjs).
  try { usage = accountUsage({ queueDirs: config.queueDirs, account: profile.key, now }); }
  catch { usage = null; }   // a ledger read must never take the preview down
  const shared = {
    dailyRunsEffective: dailyRuns,
    monthlyRuns: caps?.monthlyRuns ?? null,
    maxQueued: caps?.maxQueued ?? null,
    // Only a CLIENT principal is capped — the same positive-only rule the runner applies (checkRunCaps
    // bites jobs stamped clientPrincipal:true, and only the account door stamps them). Staff previewing
    // for this customer see the counts and are not blocked by them.
    capped: scope?.kind === "account",
  };
  if (!usage?.complete) {
    return { ...shared, complete: false, today: null, thisMonth: null, queued: null, exhausted: false };
  }
  // Named, not spread: `basis` is an operator's diagnosis of our deployment and has no business
  // travelling into an answer a client's assistant reads out.
  return {
    ...shared,
    complete: true,
    today: usage.today, thisMonth: usage.thisMonth, queued: usage.queued,
    exhausted: scope?.kind === "account" && usage.today >= dailyRuns,
  };
}

/**
 * plan_run — resolve a prospective search and describe it. Spends nothing, writes nothing.
 *
 * Takes the SAME args as start_run. Confirming is a separate, explicit start_run call with the same args.
 */
export function planRun(args = {}, { scope, now = Date.now() } = {}) {
  assertScopedProfileKey(args, scope, "plan_run");
  // The EXACT job start_run would build — not a lookalike assembled here, which could drift from it.
  const job = buildJob(args, { scope });

  // validateJob NORMALIZES in place (jurisdiction dedupe, the bare-string fix, deadline shape), so what
  // is reported below is what the engine would actually receive, not what the caller typed.
  const v = validateJob(job);

  let profile = null, projectKey = null, origins = null;
  // Profile resolution reads the roster off disk; infra trouble must degrade the PREVIEW, never throw —
  // the same fail-open posture validateJob takes for the roster checks.
  try { ({ profile, projectKey, origins } = resolveEffectiveProfile(job)); } catch { /* previewed without it */ }

  let resolved = null, eff = null, unavailable = null, snapshotForCoverage = null;
  try {
    // ONE sequencing of product and scope, shared with the runner's wall and the portal's plan gate
    // (resolve-request.mjs) — a preview that resolved them in a different order is a preview that can
    // name a different product from the one admission will.
    ({ resolved, scope: eff } = resolveRequest(job, {
      profile,
      recipes: job.recipeKey ? loadRecipes({ force: true, proseGuard: recipeProseGuard }) : null,
    }));
    // The clarify string is kept VERBATIM — it is already actionable prose written for the requester
    // ("product \"foo\" names no search we offer — one of: …") and carries no switch name. Everything
    // else goes through the cause→prose map, which is the half that used to leak a CLEAROTRON_* name.
    //
    // `built` reconciled from the flag snapshot, exactly as the portal's gate does (portal-service.mjs
    // readBuilt): BUILT alone says the machinery EXISTS, and cannot say the wired register will answer a
    // count — so a preview reading the bare map would call Depth 2 available on a deployment whose
    // browser calls it unavailable. Same question, same answer, whichever door asked.
    // The snapshot's register.canCount rides ALONGSIDE the build map (audit item 3): builtFor alone
    // folds a can't-count register into registerProbe:false, and gateCause without the distinction
    // answered the retired "Not part of the current release." for a depth no release will ever fix
    // there — while describe_options, fed the same snapshot's canCount, answered the true cause.
    const snapshot = readFlagSnapshot(config.poolRootOrNull);
    // A CLARIFY IS NOT AN AVAILABILITY CAUSE, and it is no longer read as one here: the shared fold
    // below relays it verbatim, so taking it as well produced the same sentence twice in `blockers`.
    // This variable now means exactly what its name says — why this deployment cannot run a product it
    // DID resolve.
    // — coverage rides the SAME snapshot read, for the same reason canCount does. plan_run is a
    // DOOR (doors-agree.test.mjs derives it as one), so a preview that says a product is orderable
    // while describe_options and the portal grey it out is the exact asymmetry that file exists to
    // catch — and the preview is the surface a requester is shown before confirming.
    snapshotForCoverage = snapshot;
    unavailable = resolved?.clarify ? null : unavailableNoteFor(gateCause(resolved, {
      built: builtFor(snapshot), registerCanCount: registerCanCountFor(snapshot),
      registerTerritories: registerTerritoriesFor(snapshot),
    }));
  } catch (e) {
    // THE THROWN ERROR NEVER TRAVELS. loadRecipes walks EVERY customer directory under the recipe store
    // and rethrows the first invalid file's message verbatim — and validateRecipe prefixes every one of
    // those with `recipes/<customerKey>/<slug>.json:` and names the offending component. Relayed as a
    // blocker, that handed a client another customer's account key, that customer's saved-search slug, a
    // config-store path and the engine's own component vocabulary — all for a file they did not write
    // and cannot fix. It is also the one leak neither leak scan could see: it is a `.json` store path,
    // not a module path, and carries no CLEAROTRON_* name.
    //
    // So the requester gets the SAME sentence any unresolvable depth gets (unavailableNoteFor's
    // 'unresolved' arm, which was dead until now), and the real message goes to stderr where the operator
    // who can fix the file will find it. A config error must be loud somewhere; a client is not where.
    process.stderr.write(`[trademark-mcp] plan_run: search-policy resolution errored: ${e?.stack ?? e}\n`);
    unavailable = unavailableNoteFor({ cause: "unresolved" });
  }

  const policy = resolved?.product ? policyFor(resolved.product) : null;
  // EVERY rule that needs the resolved product — the name count, the scope-vs-machinery fit and the
  // (product × scope) combination rules — folded once, in the SAME function the runner's wall, the
  // portal's plan gate, start_run, the CLI and the dev cockpit call. A preview that ran a different
  // subset from admission is a preview that says wouldRun:true about a request admission will clarify.
  // Measured on the SAME ladder the effective scope below is resolved from, so a blocker can never
  // contradict the territories printed beside it.
  //
  // `availability:false` — this door words that refusal itself, from a CAUSE (`unavailable` above), so
  // that no switch name and no internal key reaches a client's assistant; the staff-prose twin belongs
  // to the runner and the logs (door-gates.mjs header).
  //
  // `readable` carries the one thing this door knows and the rules cannot see: whether the profile is
  // null because the roster could not be read (the catch above) or because there is genuinely no
  // account. The runner refuses to claim "resolves to no territory" about defaults it never read, and a
  // preview that refused a request admission would ADMIT is the same dishonesty pointing the other way.
  const gates = gateResolvedRequest({ job, profile, resolved, readable: profile !== null }, { availability: false });

  // ── the effective scope: what would ACTUALLY be searched ────────────────────────────────────────────
  // Resolved ALONGSIDE the product above, not after it: the two decide each other (a saved search brings
  // its own territories; a request that names no product is named by the territories it resolves to), and
  // resolve-request.mjs is the one place that sequencing lives.
  // Stated with its ORIGIN, because "running at your account's default territories" and "running the
  // territories you named" look identical in a result and mean very different things to whoever approves
  // it. A plan that silently presents a default as a choice is how the wrong search gets confirmed.
  //
  // Resolved by the SHARED resolver, not here: the portal's own plan gate has to answer this question
  // too, and two ladders that must agree forever is the shape this codebase already rejected for
  // validateJob. The saved-search layer lives in there as well, so "our usual quarterly screen" resolves
  // its territories identically at both doors.
  if (!eff) eff = { jurisdictions: [], jurisdictionsFrom: "not set anywhere", classes: [], classesFrom: "not set anywhere", platforms: [], platformsAdded: [], platformsFrom: "", gridCellsPerVariant: null };

  const marks = countJobMarks(job);

  // ── how BIG this search is ──────────────────────────────────────────────────────────────────────────
  // The portal drew an effort bar; this door said nothing, so an agent could learn the depth, the scope
  // and the allowance and still have no idea whether it was about to start one search or twenty. Quoted
  // from the RESOLVED policy (the engine's own components), not from what the caller typed, and from the
  // real script-lane decision rather than the browser's guess at it — where the two differ, this is right.
  //
  // Best-effort by contract: a preview that cannot size a search is worth less, but a preview that THROWS
  // is worth nothing. `effort: null` says honestly that we could not size it.
  // `eff` is passed so the scope is not resolved twice; quoteForJob would resolve the same thing itself.
  const effort = quoteForJob({ job, profile, searchPolicy: resolved, scope: eff });
  // The daily allowance, reported for every principal and BLOCKING only for a client account (the one
  // kind the wall actually caps). Advice, not a gate — see allowanceFor.
  const allowance = allowanceFor(profile, { scope, now });
  const quotaBlocker = allowance?.exhausted
    ? `this account has used all ${allowance.dailyRunsEffective} of today's client-started searches — start_run would be refused at admission. The allowance resets at midnight UTC; your ${BRAND.name} contact can run this one today.`
    : null;
  // A WARNING, not a blocker: an unread ledger must not refuse a run, and a field going null is not a
  // fact an assistant reliably relays. The sentence is, and it is the only thing standing between a
  // blind count and "you have 2 searches left today" said out loud to a client. Only for a CLIENT
  // account, because that is the only principal the allowance binds.
  const quotaWarning = allowance && allowance.complete === false && allowance.capped
    ? `this account's usage could not be read, so nothing here says how much of today's allowance of ${allowance.dailyRunsEffective} is left — do not tell the requester a number. The search still runs unless admission refuses it.`
    : null;
  // The unbuilt DELIVERY lane, which the schemas offer by name. deliveryRoute:"portal" passes every shape
  // check (it is a real value of a real field) and the runner then clarifies it at admission — so without
  // this the preview would answer wouldRun:true, blockers:[] about a job that cannot start, on a field
  // plan_run itself invites. Read off `job` (post-buildJob, post-validateJob) with the wall's own
  // predicate and the wall's own sentence, so the two doors cannot drift apart.
  const routeBlocker = wantsPortalRoute(job) ? PORTAL_ROUTE_UNAVAILABLE : null;
  // DEDUPED, and this door is the only one that needs it. The other four SHORT-CIRCUIT — they refuse on
  // validateJob and never reach the resolved-product fold — while a preview's whole job is to list every
  // blocker at once, so it sees both. Some sentences are legitimately produced twice for one request: a
  // spelled-out product's geography is judged by validateJob against what the request STATES and again by
  // the fold against what it RESOLVES TO, and when the two are the same product they are the same
  // sentence. Read aloud to a requester, "this request names 2 countries" twice is a defect; deduping
  // where they are joined keeps every source honest and says it once.
  const blocking = [...new Set([...(v.classify === "reject" || !v.ok ? v.errors : []), ...gates.errors, ...(unavailable ? [unavailable] : []), ...(quotaBlocker ? [quotaBlocker] : []), ...(routeBlocker ? [routeBlocker] : [])])];

  // ONE lookup, and the fields below come off it — the same shape portal-service's plan door was fixed
  // into. productRow computes a turnaround on every call; asking twice for one answer is how two answers
  // eventually appear.
  const resolvedRow = productRow(resolved?.product);
  // ── — AND WHAT THE REGISTER CANNOT REACH, on the door that commits ──────
  //
  // The same argument the coverage arm above makes, one rung further along. A worldwide search is
  // ORDERABLE on a partial register now (owner ruling 2026-08-31), so it stops being a blocker and
  // becomes something a requester has to be TOLD before they confirm. The portal says it twice — at
  // the point of choosing and again in the review step — and `describe_options` says it on the menu.
  // Without it here, an assistant can walk a client through the one door that spends and never
  // mention that most of the world will defer, which is the asymmetry doors-agree.test.mjs exists to
  // catch and the ruling exists to prevent.
  //
  // A WARNING, NEVER A BLOCKER. It rides the same list the allowance advice does, for the same reason:
  // this is a request that WILL run, and putting it in `blockers` would re-refuse the product the
  // ruling just made orderable.
  const coverage = resolved?.clarify || !snapshotForCoverage ? null
    : coverageDisclosure(resolvedRow?.geography ?? null, registerTerritoriesFor(snapshotForCoverage));
  return {
    ok: blocking.length === 0,
    wouldRun: blocking.length === 0,
    // Named plainly: this is a description, and confirming is a separate act.
    _note: blocking.length === 0
      ? "NOTHING HAS BEEN STARTED and nothing has been charged. This is what would run. Show it to the requester, and call start_run with the SAME arguments only once they have confirmed it."
      : "NOTHING HAS BEEN STARTED. This request cannot run as stated — the blockers below are questions to put back to the requester, not failures to retry.",
    blockers: blocking,
    warnings: [...(v.warnings ?? []), ...gates.warnings, ...(quotaWarning ? [quotaWarning] : []),
      ...(coverage ? [coverage.note] : [])],
    caveat: PLAN_CAVEAT,
    search: {
      // The registry's own words for the product — never a recipe's label, which is the client's name for
      // it and must not be able to make a quick screen read as a full search. `name` is
      // what an assistant says out loud; `product` is the id it sends back to start_run.
      name: resolvedRow?.name ?? null,
      product: resolved?.product ?? null,
      pipeline: resolved?.pipeline ?? null,
      components: resolved?.components ?? null,
      savedSearch: resolved?.recipe ? { key: resolved.recipe.key, label: resolved.recipe.label ?? null } : null,
      // The PRODUCT's floor, and only when this call could not compute the real one. `effort.turnaround`
      // below is computed against the actual request (names, lanes, territories) and is always the better
      // answer; this is what a degraded path says instead of nothing.
      turnaround: baseTurnaroundFor(policy).text,
      maxNames: resolvedRow?.maxNames ?? null,
      // The case-law and opposition reading, and the native-language investigation — both the PRODUCT's
      // answer rather than anything the request could have set. The preview used to say nothing about
      // either, so a requester confirming a deep dive was shown a plan indistinguishable from a standard
      // preliminary.
      caseLaw: resolved?.caseLaw === true,
      nativeLanguage: resolved?.nativeLanguage ?? null,
      // WHERE the product came from — an unrequested default is the thing most worth saying out loud,
      // and it comes from the RESOLVER's own origin rather than being re-derived here, so the two can
      // never disagree about which layer won.
      chosenBy: PRODUCT_ORIGIN[resolved?.origins?.level] ?? "the territories this search resolves to",
      // — the reach, as data beside the sentence in `warnings`. Null on every
      // deployment whose register reaches everything a requester can name, which is the normal state.
      // An assistant that wants to list the deferred offices should not have to parse prose for them.
      registerReach: coverage ? { reached: coverage.reached, deferred: coverage.missing } : null,
    },
    subject: {
      marks: (job.marks ?? []).map((m) => m.name),
      markCount: marks,
      classes: eff.classes,
      classesFrom: eff.classesFrom,
      goods: job.goods ?? null,
    },
    scope: {
      jurisdictions: eff.jurisdictions,
      jurisdictionsFrom: eff.jurisdictionsFrom,
      platforms: eff.platforms,
      platformsAdded: eff.platformsAdded,
      platformsFrom: eff.platformsFrom,
      gridCellsPerVariant: eff.gridCellsPerVariant,
    },
    // How much work this is, and how long it takes. `units` is the 1–10 depth bar the composer draws and
    // is RELATIVE TO THIS ACCOUNT's own lightest and deepest search, so it is not comparable between
    // accounts and must never be used as a billing quantity; `raw` is the absolute figure. `unitsVersion`
    // says which weight set produced them, so a later re-fit cannot make this quote unreadable.
    effort,
    account: {
      profileKey: profile?.key ?? null,
      name: profile?.name ?? null,
      projectKey: projectKey ?? null,
      // Rating authority, named but NOT adjustable from here — a search says where to look; the
      // framework and posture that RATE what is found belong to the customer's profile.
      framework: profile?.frameworkPath ? "the account's own risk framework" : "the firm's default risk framework",
      caps: profile?.runCaps ?? null,
      // What is left of today's allowance, counted from the ledger the admission wall counts. null when
      // there is no account to count for (generic) or its profile could not be read — "we cannot tell
      // you your limit" is a different statement from "your limit is 2", and only one of them is honest.
      //
      // `usageComplete` is what separates the two nulls: false ⇒ there IS an account with an
      // allowance and we could not read the ledger, so `usage` and `remainingToday` are absent rather
      // than zero. null ⇒ no allowance applies here at all. Without it both read as "uncapped", and an
      // assistant would promise a client a fresh day on a count nobody took. `dailyRunsEffective` still
      // reports: the limit came off the profile and is a fact even when the spend is not.
      usage: allowance?.complete ? { today: allowance.today, thisMonth: allowance.thisMonth, queued: allowance.queued } : null,
      usageComplete: allowance ? allowance.complete : null,
      dailyRunsEffective: allowance?.dailyRunsEffective ?? null,
      remainingToday: allowance?.complete ? Math.max(0, allowance.dailyRunsEffective - allowance.today) : null,
      allowanceApplies: allowance ? allowance.capped : null,
      origins: origins ?? null,
    },
  };
}
