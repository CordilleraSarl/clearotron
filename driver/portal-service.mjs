#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// portal-service.mjs — the unified client+staff portal.
// ONE address, ONE login: CF Access proves WHO (edge), portal-access.mjs decides WHAT THEY SEE
// (inner roster/chokepoint — THE boundary, fail-closed). Loopback-only, the recipe-service skeleton.
//
// Surfaces (all under /portal):
//   GET  /portal[/...]               — the React app (portal-ui/dist), served by portal-static.mjs
//                                      ABOVE the rate limiter; client-side routing owns the sub-paths.
//   GET  /portal/health              — liveness (no auth)
//   GET  /portal/login               —, LOCAL MODE ONLY: the sign-in form, server-rendered here
//   POST /portal/login                 rather than in the SPA (CI greps the built bundle for internal
//   POST /portal/logout                variable names, and a login screen has to explain configuration).
//                                      Absent on a Cloudflare-fronted instance, where the edge is the door.
//   GET  /portal/api/me              — { email, permissions, access, organisations, accounts, … }
//   GET  /portal/api/searches[?account=] — registry levels + the account's saved searches
//   POST /portal/api/run/plan        — the CONFIRMATION GATE: validate + resolve + honest summary +
//                                      short-TTL HMAC confirmationToken. Nothing spends yet.
//   POST /portal/api/run             — verify the token ⇒ trigger via the injected `trigger` (live: the
//                                      MCP HTTP face with an ops token that is verb-scoped to start_run
//                                      AND, since 2026-07-20, account-capped — so a confused deputy is
//                                      bounded twice: by the principal check in this file, and by the
//                                      token itself. Neither is assumed; opsTokenPosture() below reads
//                                      the live token and states the real posture at every boot.
//   GET  /portal/api/runs[?account=] — account-filtered runs (live workspace + delivered pool).
//   GET  /portal/report/<runId>/     — the CLIENT report, ownership-checked; foreign runs 404 (never
//                                      403 — existence must not leak).
//   GET  /portal/admin/roster        — staff-only proof surface (clients get 404).
//
// HARD RULES: the account for every scoped route comes from assertPrincipal (never the raw query for
// clients); job identity fields (profileKey, forwarder, forwarderEmail) are SERVER-stamped from the
// verified principal — a body cannot supply them; report/email identity derives from the REGISTRY
// (stageLabel), never a client's recipe label; every trigger is audited (JSONL) with the human email.
import "../shared/env-local.mjs";   // — FIRST: applies the CLEAROTRON_* translation before any module-top
// capture evaluates. Reads no `.env` here — that load is gated on isCliEntry(argv[1]).
import { existsSync, readdirSync } from "node:fs";
import { hostname as osHostname, homedir } from "node:os";   // — the address a refusal page names when nothing else identifies this instance

// The port this service listens on when nobody says otherwise. Declared here rather than at the
// listener, because the refusal page names the address too and it is composed on IMPORT-side code: the
// listener's own constants live inside the entry-point branch and do not exist when another module
// calls in. One definition, two readers, no second literal to drift.
const PORTAL_PORT_DEFAULT = 18802;
import { storeInRepo, storeOutsideRepoMessage, makeCommittableAudit, resolveStoreRepoRoot, makeStoreCommit } from "../shared/store-in-repo.mjs";   //,
import { customerStoreDir, customerStoreLine } from "../shared/customer-store.mjs";   // — one store for the surface and the runs
import { bareInvocation, browserCommand, invocationPrefix, npxVersionOf } from "../shared/invocation.mjs";   // — and why this one surface is by NAME
import { channelOf, channelPackage, ownVersion } from "../shared/permanent-install.mjs";   // — which release channel this install came from

/**
 * The ops credential for one trigger call: the boot token's cap, re-taken against the roster now.
 *
 * Separated from the call site and exported because the service's `trigger` is injected in tests, so
 * logic left inside it can only ever be asserted by reading the source — and the case that matters is
 * the one where something fails.
 *
 * BOTH FALLBACKS HAND BACK THE BOOT TOKEN, never an uncapped one. An empty roster is the single case
 * the boot mint reads as "do not cap", so re-deriving it here would turn an unreadable store into a
 * token good for every account. A mint that throws — an unset secret — lands the same way. The failure
 * direction is the whole point: a stale cap refuses the newest company, which is the bug being fixed;
 * a widened cap admits every company, which is a larger and quieter one.
 */
export function opsTokenFor({ bootToken, roster, mint }) {
  if (!Array.isArray(roster) || !roster.length) return bootToken;
  try {
    return mint({ scope: "ops", sub: "portal", verbs: ["start_run", "stop_run"],
      accounts: roster, ttlSec: 300 });
  } catch (e) {
    // THE FALLBACK DIRECTION IS RIGHT AND ITS SILENCE WAS NOT. Handing back the boot credential is
    // correct — it is narrower than the one that failed to mint, never wider — but a bare catch here
    // restores the exact refusal this lane exists to remove, for a company created after boot, with
    // nothing anywhere naming the cause. An unset signing secret and an unreadable store both land here
    // and both look like the feature simply not working.
    console.error(`[portal] could not re-mint the engine credential (${String(e?.message ?? e)}) — `
      + `falling back to the one minted at boot, which does not cover companies created since`);
    return bootToken;
  }
}

// — the portal became an ISSUANCE PATH here, deliberately and by ruling.
// A comment further down this file said "the portal cannot mint from here … this process deliberately
// holds no engine/MCP secrets — issuance is one path on purpose". MEASURED 2026-08-31: that wall is not
// built. `bin/start.mjs` generates TRADEMARK_MCP_TOKEN_SECRET into `~/.env`, the portal unit loads
// `EnvironmentFile=%h/.env`, and `childEnv` passes the same value to the portal child — so this process
// has held the signing secret on both start paths for as long as both have existed. The comment has been
// corrected in place rather than left to be trusted.
import { mintToken, loadGrants, addressesInGrants } from "../shared/scope.mjs";
import { withCompany } from "../shared/grants-edit.mjs";
import { resolvePort } from "../shared/listen.mjs";   // — the port SOURCE, decided once
import { fileURLToPath } from "node:url";

// The daily allowance and the ledger read moved to usage-ledger.mjs (2026-07-27) — a pure leaf the MCP
// preview can import without pulling this HTTP service into a tool call. RE-EXPORTED rather than
// re-declared: one number, one count, and every existing importer of this module keeps working.
export { DEFAULT_CLIENT_DAILY_RUNS, accountUsage };

/**
 * What a requester is told when the day's allowance is gone.
 *
 * ONE SENTENCE, TWO PLACES. The server refuses with it and the screen warns with it, and a reader who
 * meets both must not meet two different sentences about the same fact. The browser cannot import this
 * module, so the portal composes its own copy and `portal-ui/test/allowanceParity.test.ts` pins the two
 * together — the same arrangement the effort model already has.
 *
 * NAMED, NOT ADDRESSED. It read "ask your <name> contact", which puts a possessive and a noun around a
 * name that is already the answer: on a deployment that has configured no brand the portal's fallback is
 * the words "the operator", and the sentence rendered "ask your the operator contact to run this one for
 * you". The line beside it on the same screen had always said "ask <name>", and that is the one the
 * approved design draws.
 */
export const allowanceExhaustedLine = (cap, who) =>
  `You have used all ${cap} of this account's searches for today. `
  + `The allowance resets at midnight UTC — or ask ${who} to run this one for you.`;

// One sentence, two places (the capability payload and the route that refuses). Never names the
// missing credential: this reaches a client screen, and our plumbing is not their business.
//
// "YET" WENT. It promised a toggle somebody had forgotten, and the owner read it
// that way while composing a live matter — the truth was a billing posture the feature could not run
// under, which no client can act on either. The operator's answer is the boot log, which now names the
// engine condition; this string stays the client's, and says only what a client can do about it.
// This install's own root, resolved from THIS MODULE rather than from cwd — the service is started by
// systemd from a working directory nobody chose, so a relative path here reads a file that may not exist.
// `HERE` further down is function-scoped and not reachable from the route table.
const INSTALL_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const READ_OFF_NOTE = "Reading a brief is not available on this instance — set the search up below.";
import { dirname, join, resolve as pathResolve } from "node:path";
import { makePrincipal, genericOrgOf, principalView, seesEverything, PortalDeny } from "./portal-access.mjs";
// — the THIRD identity source (after the CF Access edge and, until, the deleted bypass). It
// decides nothing about access: it turns a passphrase into an email string, which then goes through
// makePrincipal and assertPrincipal exactly as a Cloudflare-verified address does.
import { readLocalCredential, establishCredential, checkPassphrase, mintSession, verifySession,
  makeAttemptLimiter, credentialPathFor,
  localCredentialHandoff, firstRunCredentialLines, passphraseResetCommand, signInResetCommand } from "./portal-local-auth.mjs";   
import { loadRecipes, PRODUCT_POLICIES, gateResolvedPolicy, productAvailability, UNAVAILABLE_NOTE } from "./search-policy.mjs";
import { PLAN_MAX_NAME_LENGTH } from "./register-plan.mjs";   // — the budget the screen states
import { productRows } from "./product-rows.mjs";
import { resolveEffectiveScope } from "./effective-scope.mjs";
import { readFlagSnapshot, builtFor, registerCanCountFor, registerTerritoriesFor, registerLabelFor, caseLawReadyFor } from "./flag-snapshot.mjs";
import { isDemo, demoPostureLine } from "./demo-posture.mjs";   
import { orderTimeRefusal } from "./run-requirements.mjs";   // the runner's own test for "can this install run a search"
import { runTables } from "./order-tables.mjs";               // …asked of the runner's own tables, so the two cannot disagree
import { howItRuns } from "./how-it-runs.mjs";   // …and the remedy, for how this portal runs
import { triggerCapGap, triggerCapWarning } from "./trigger-cap.mjs";   // F51 — one answer, three surfaces
import { makeUpstream } from "./portal-upstream.mjs";
import { flagView } from "./portal-config-view.mjs";
import { livePosture } from "./flag-snapshot.mjs";   // — for the capture-vs-box comparison only, never for a value
import { DEFAULT_CLIENT_DAILY_RUNS, accountUsage } from "./usage-ledger.mjs";
import { SOURCE_REPO } from "../shared/product-identity.mjs";   // AGPL §13 — one answer, three surfaces
import { engineCommit } from "./engine-build.mjs";                  // — the SAME stamp pool meta records
// — siblings, on their own line: the guard pins the line above and its subject is the JOIN
// (this endpoint and pool meta stamp the same function), not the import list. Kept separate so that
// pin keeps reading the shape it was written against.
import { engineCommitDate, engineProvenance } from "./engine-build.mjs";
import { classifySkillsStore } from "./skills-store-provenance.mjs";
import { makeStaticHandler, reportCsp, docCsp } from "./portal-static.mjs";
import { crossSiteReason, bodyNotJson } from "./portal-request-origin.mjs";
import { bundleVerdict, healthUi } from "../shared/bundle-freshness.mjs";   // one definition of a usable bundle, shared with `doctor`
import { adminRoutes } from "./portal-routes/admin.mjs";   // the route groups the dispatcher below asks in turn
import { composeRoutes } from "./portal-routes/compose.mjs";
import { configRoutes } from "./portal-routes/config.mjs";
import { connectRoutes } from "./portal-routes/connect.mjs";
import { feedbackRoutes } from "./portal-routes/feedback.mjs";
import { meRoutes } from "./portal-routes/me.mjs";
import { queueRoutes } from "./portal-routes/queue.mjs";
import { reportRoutes } from "./portal-routes/report.mjs";
import { runRoutes } from "./portal-routes/run.mjs";
import { runsRoutes } from "./portal-routes/runs.mjs";
import { usageRoutes } from "./portal-routes/usage.mjs";
import { MAX_BRIEF, makeReadBudget } from "./compose-read.mjs";
import { BRAND, ORGANISATION_NAME, PALETTE, FAVICON_LINK, bracketMark, DOOR_ROOT, DOOR_ROOT_DARK, DOOR_THEME_INIT } from "../shared/brand.mjs";
import { TEXT_FONT_STYLE } from "../shared/brand-fonts.mjs";   // the text face, carried in the page rather than fetched
import { envFrom, pinEnv } from "../shared/env-aliases.mjs";   // — a refusal names the name in force
import { accessAudience, audienceLabel } from "../shared/access-audience.mjs";   // — F54; jose-free on purpose
import { isEntrypoint } from "../shared/is-entrypoint.mjs";   // — one entry-point test, all spellings
import { deploymentBox } from "../shared/deployment-box.mjs";   // — the box names itself; one rule
import { jobHashOf, mintConfirmation, verifyConfirmation } from "./portal-confirmation.mjs";
import { concurrentRunsCap, resolveRunAccount, scanAccountRuns, scanAllRuns } from "./portal-runs.mjs";
export { jobHashOf, mintConfirmation, verifyConfirmation, concurrentRunsCap, resolveRunAccount, scanAccountRuns, scanAllRuns };
// This install's release channel, `beta` or `latest`, read once off its own version. /me carries it.
const INSTALL_CHANNEL = channelOf(ownVersion());

/**
 * The operator's line when the brief reader cannot be built: why, and the check to run, ON THIS CHANNEL.
 * `npx clearotron doctor` fetches the stable, which on a beta reads the beta's install with the other code.
 */
export function briefReadingOffLine(reason, pkg = channelPackage()) {
  return `brief reading OFF — ${reason}. Describe-it stays disabled; \`npx ${pkg} doctor\` reports the engine's auth state.`;
}

// The offering the portal menus build from — product-rows.mjs's row, unchanged.
//
// This used to derive the row inline, and so did recipe-service and the ops-MCP, and the comment here
// said the three could not drift because all of them were "pure derivations of the registry". That held
// while every field was a copy. It stopped holding when a row had to carry a COMPUTED turnaround and a
// client-facing NAME, so the derivation is one function now and this is a call to it.
const registryProducts = productRows;

// The client-facing wording for an unavailable level MOVED to search-policy.mjs (2026-07-27) and is
// imported above, unchanged. It lived here while the browser was the only client-facing surface; the MCP
// preview is a second one, and a client's assistant must read the same sentence a client's browser does.
// The rule it encodes is unmoved: the engine hands over a CAUSE, never a sentence, so no CLEAROTRON_* name
// can reach either surface. (CI greps the built bundle for `CLEAROTRON_` as the backstop.)

// (`truthyFlag` lived here to test a kill switch's value. The switches were retired 2026-07-27 and no
// gate on this path reads an environment variable any more.)

// ── the routing core (injected IO — unit-tests offline) ────────────────────────────────────────────
/**
 * THE FIRST PATH SEGMENTS THE AUTHENTICATED SERVICE OWNS UNDER /portal.
 *
 * ONE DECLARATION, HERE, BESIDE THE ROUTER. It used to be a second list living in portal-static.mjs,
 * where the static handler decides what to decline — and the two could disagree silently. When they did,
 * the failure was not an error: the caller got the app shell where it expected JSON, **and the route's
 * authorization check never ran at all**. `admin` was missed exactly that way, and the SPA answered the
 * staff roster route with the app shell.
 *
 * So the static handler imports this rather than restating it. The router is the half that cannot lie
 * about what it serves, and a list generated from it cannot fall behind it.
 *
 * `health`, `login` and `logout` are here even though they are NOT registered in `route()` — all three
 * are answered in `makeHttpHandler` before identity is resolved, and each only for one method. Their
 * entries are therefore load-bearing for the OTHER methods: a HEAD probe of /portal/health, or a GET of
 * /portal/logout, falls past its branch into the static handler, where this is what declines it. A test
 * that derived this set from `route()` alone would flag all three as stale and be wrong; it unions the
 * pre-identity paths in from the handler's own source and says why.
 *
 * — `login`/`logout` are RESERVED, not conditional. They are server routes only when the local
 * identity provider is running (PORTAL_AUTH_MODE=local); on a Cloudflare-fronted instance nothing
 * answers them. Listing them unconditionally means /portal/login is one address with one meaning on
 * every deployment — it 404s where there is no local provider instead of quietly rendering the SPA
 * shell, which is the answer that would let a future SPA screen claim the name out from under the
 * server route.
 *
 * CLOSED IN BOTH DIRECTIONS, asserted in portal-static.test.mjs against the router's own source: a
 * route registered without an entry here fails, and an entry naming a route that no longer exists fails
 * too. That is the closed-by-default the issue asks for — over the REGISTERED ROUTE SET, not over
 * arbitrary paths. An unknown path still renders the SPA, which is what makes client deep links work.
 */
// `connect-help` joined 2026-08-31. A head missing from this list is SWALLOWED by
// the static handler: the caller gets the app shell and the route's authorization check never runs —
// which for a route serving a document is a silent 200 of the wrong thing. The bijection arm caught it,
// and that is exactly what it is for.
// `sign-out` joins them for the reason the comment above gives: a head the server answers but does not
// RESERVE falls into the static handler and returns the app shell with a 200, which for a route whose
// whole job is to end a session is the worst possible silent success ( — F47).
export { SERVER_ROUTE_HEADS } from "./portal-static.mjs";

/**
 * THE PORTAL'S HALF OF THE DECLARED-FIELD PARTITION (enqueue-schema DECLARED_JOB_FIELDS).
 *
 * `jobFor` below is an allow-list, and an allow-list drops in silence whatever it does not name. This is
 * the same list said out loud, plus a REASON for every declared field it deliberately leaves behind, and
 * doors-agree.test.mjs asserts the two halves together are exactly the declared set. A field declared
 * tomorrow fails the suite until somebody decides which half it belongs in — which is the one moment the
 * decision is cheap, and the mechanism that `deliveryRoute` slipped past for want of.
 *
 * NOT A RUNTIME GATE. See the note on DECLARED_JOB_FIELDS: refusing every non-carried field at runtime
 * would answer with the wrong remedy at the doors whose wire vocabulary differs from the job's.
 *
 * `carries` means THE FIELD REACHES THE STORED JOB — copied from the body, or stamped by the door from
 * something it trusts more. `id`, `profileKey`, `forwarder`, `forwarderEmail` and `clientPrincipal` are
 * the stamped five, listed below in `stamped`: they come from the door or the verified principal and a
 * body value for them is ignored on purpose. That is the tenancy wall, and it is why a client cannot
 * file against another brand owner by editing a request. Every OTHER carried field is the requester's,
 * verbatim, for validateJob to rule on.
 *
 * — `carries` IS NOW MEASURED, and it was prose until it was.
 *
 * `msgId` and `conversationId` sat in this list while `jobFor` hardcoded both to null and the trigger
 * hop stripped them off again. The totality test beside it could not see that: it asks whether every
 * declared field is classified, which a declared-and-nulled field satisfies perfectly. So the sentence
 * above asserted a behaviour and the test next to it checked a different one — the same shape as
 * "an invitation nothing honours", one level up.
 *
 * `stamped` exists so the new guard can be DERIVED rather than hand-listed. It splits `carries` into the
 * fields whose value is the requester's — driven with a distinctive value, and required to arrive — and
 * the fields whose value is the door's, where the body's value must be IGNORED. A hand-kept list of what
 * to check is the defect the totality test was written to end; portal-carries.test.mjs reads these two
 * arrays and fails on a carried field it has no probe for.
 */
export const PORTAL_JOB_FIELDS = Object.freeze({
  carries: Object.freeze([
    "id", "profileKey", "forwarder", "forwarderEmail",
    "markName", "marks", "classes", "goods", "ref", "projectKey",
    // which organisation's Generic, resolved by jobFor from the verified principal — see `stamped`
    "tenant",
    "jurisdictions", "platforms", "geography",
    "product", "recipeKey", "nativeLanguage", "caseLaw", "searchLevel", "deliveryRoute",
    "upfrontInstructions", "commercialFlexibility", "priorUse", "campaignShape", "deadline",
    // stamped by the ROUTE rather than copied by jobFor, and on the stored job all the same:
    // `clientPrincipal` from the verified principal's role. It can only ever ADD a cap to the run that
    // carries it, so reading it off the body would let a caller decline its own allowance.
    "clientPrincipal",
  ]),
  // The subset of `carries` whose value is the DOOR's, not the requester's. A body value for one of
  // these is ignored on purpose, so the guard drives them with a lie and requires the lie to lose.
  stamped: Object.freeze(["id", "profileKey", "forwarder", "forwarderEmail", "clientPrincipal", "tenant"]),
  notCarried: Object.freeze({
    // — A CLIENT MAY NEVER DECLARE A RUN A DEMO. The banner it produces says the report
    // is fiction, and a field the requester controls that can mark their own report fiction — or, arriving
    // absent, mark a demo account's report real — puts the truth of the deliverable in the request. Same
    // precedent as the fixtures flag one issue over: operator doors declare it, the client door does not.
    demoRun: "the client door never declares a run a demo — the banner asserts the report is fiction, and "
      + "that is the deployment's statement about the account, not the requester's about their own report",
    registerFixtures: "a run that reads canned register payloads instead of calling a register. A CLIENT may "
      + "never ask for that: the result would be fiction wearing a real report's clothes, which is the failure "
      + "the demo marker exists to prevent one level up. Refused by omission here, and only ever set by a job "
      + "file somebody wrote deliberately.",
    promptParts: "the requester's declaration that the prose rides as SIDECAR files (<base>.brief.md, …), "
      + "which exists because the hand-emitting email-loop agent can only `write` files. The portal composer "
      + "sends structured fields and writes no sidecars, so a job it built is never in that shape — carrying "
      + "the flag would have it claim an intake it did not use, and the door's own check would then look for "
      + "files nobody wrote.",
    msgId: "the email door's message id. This door has no message: the composer IS the request, and there "
      + "is no thread to thread it into. It was declared carried and reached the job as a hardcoded null "
      + "that the trigger hop then stripped, which is a declaration measuring nothing.",
    conversationId: "the email door's thread id, and the portal has no thread. Same story as `msgId`: "
      + "declared carried, written null, stripped again. A reply lands in the portal, not in a mailbox.",
    customer: "the APPLICANT, and the account already resolved it — see the jobFor header. Letting a body "
      + "re-state it would let a client widen or silence their own self-exclusion set, which is a "
      + "rating-authority change wearing a scope field's clothes.",
    forwarderDomain: "domain-based customer resolution is what the tenancy wall replaces here: the account "
      + "comes from the verified principal, never from a string the body chose.",
    provider: "which register vendor answers is a deployment fact, not a client's to pick.",
    name: "the pre-markName spelling of the search subject. The composer sends markName/marks[]; carrying a "
      + "second name field would give one door two answers to 'what is being cleared'.",
    use: "the pre-goods spelling of the same field. Same reason as `name`.",
    tmp: "the pre-ref spelling of the reference number. Same reason as `name`.",
    brief: "the intake CONFIRMATION brief — written by the email door's own gate, quoting what was agreed "
      + "back to the requester. The portal has no such gate: its composer IS the agreement.",
    rawRequest: "the verbatim forwarded email. There is no forwarded email on this door.",
    deliverableSpec: "template/format asks are staff-curated on the profile, not per-request from a client.",
    customerUnknown: "arms candidate-self classification, and only the intake AI can honestly say the "
      + "applicant was neither stated nor implied. On this door the account states it.",
    parentRunId: "escalation lineage. The composer has no '＋ Another read' control yet (contract/reads.ts), "
      + "so nothing on this screen can honestly name a parent run.",
    dupOverride: "force-running past matter dedup is a confirmed staff override, never a field a client body "
      + "can set for itself.",
    enqueuedAt: "stamped by the queue writer at the far end of `trigger`, from the clock, not the body.",
    enqueuedVia: "which door queued it. A door that let a body name another door would erase its own trail.",
    enqueuedBy: "the verified token sub, stamped server-side (red-team #4). A caller-supplied one is "
      + "attribution a caller wrote about themselves.",
  }),
});

/**
 * Stamped on an error whose outcome row has already been filed. `route()` journals a throw and then
 * rethrows it, and makeHttpHandler's outer catch journals what it catches — without this the one crash
 * would file two rows and the log would over-count the thing it exists to count. A Symbol rather than a
 * property name so it cannot collide with a field any error type already carries.
 */
const AUDITED = Symbol("portal.outcome-audited");
const alreadyFiled = (e) => !!(e && typeof e === "object" && e[AUDITED]);

/**
 * — what a door refusal is allowed to SAY. Code-owned, closed set, keyed on the status.
 *
 * The alternative is journalling the thrown message, and that message comes from `verify()` — a
 * third-party JWT check on the Cloudflare deployments — which is free to put a claim, a subject or a
 * token fragment in it. This log is republished through /portal/admin/observed, so an unfiltered
 * message would turn a refusal into a disclosure surface, which the issue rules out in terms.
 *
 * The status is the fact a security review actually asks for and it is already a closed set. An
 * unmapped one falls back to a constant rather than to the message.
 */
const DENIAL_REASON = Object.freeze({
  401: "not authenticated",
  403: "not authorised for this account",
  404: "no such surface for this principal",
  429: "rate limited",
});

/**
 * WHAT A REFUSED CLIENT IS TOLD — a closed set, keyed on the status, never the error's message. The message
 * can come out of a third-party token check with a claim value, an address or a fragment of the rejected
 * token in it, and some of our own refusals put the caller's address in theirs. A 401 keeps the words the
 * browser contract already decodes ("not signed in"); every other status says the journal's code-owned
 * reason. The message itself is still journalled nowhere a client reads. PURE.
 */
export const refusalWords = (status) => (status === 401 ? "not signed in" : DENIAL_REASON[status] ?? "refused at the door");

/**
 * — THE ROW A REFUSAL FILES. One shape, one sink, whichever side of `route` decided the answer.
 *
 * The portal used to journal an admin write only when it SUCCEEDED, so every refusal — a client's 404
 * on a staff surface, a malformed runId's 400, an unauthenticated POST's 401 — left no trace anywhere.
 * "Nothing happened" and "someone was turned away" were the same empty log, which is the one pair a
 * journal exists to tell apart.
 *
 * WHAT GOES IN: the method, the path, the resolved address if there is one, the status, a short reason.
 *
 * WHAT NEVER GOES IN, and the reason this is a function rather than an object literal at five call
 * sites: the body, the query string, any header, the session cookie, the passphrase. This log is read
 * back by /portal/admin/observed and is a different disclosure surface from the request that produced
 * it — a row carrying a credential would be worse than the missing row this issue is about. The
 * PATHNAME is passed here, never `req.url`, because the latter carries the query string.
 *
 * `by` is OMITTED, not nulled, when identity did not resolve: observedView keys people on that field
 * and skips a row without one, so an unauthenticated caller stays a refusal with no person attached
 * rather than becoming a person named "null".
 */
/**
 * — IS THIS ONE OF THE ADMIN WRITE PATHS? The scope line of the whole change.
 *
 * The issue's Out of scope is binding and specific: *"Per-request access logging for the whole portal.
 * This is about the admin WRITE paths, which are few, staff-only and already have a sink."* So the
 * outcome log is not a request log, and this predicate is what keeps it from becoming one.
 *
 * THE THREE THE ISSUE NAMES — retire/restore, grouping, feedback:
 *   POST /portal/admin/retired     run-retire / run-restore
 *   POST /portal/admin/families    family-group / family-ungroup
 *   POST /portal/api/feedback      report-feedback
 *
 * WRITTEN AS "POST UNDER /portal/admin/", NOT AS THREE LITERAL PATHS. Every GET under that prefix is a
 * read (config, access, roster, observed) and every POST is a write, so the prefix rule admits exactly
 * the writes and admits the NEXT one automatically. Three literals would have to be edited by whoever
 * adds the fourth admin control, which is the same "a call site gets forgotten" failure this issue was
 * filed about, moved one file over.
 *
 * `/portal/api/feedback` is the one write outside the prefix and is therefore named. It is a client
 * surface rather than a staff one, and it is in scope because the issue listed it.
 *
 * IT STAYS NAMED THOUGH THE ENDPOINT IS RETIRED. What it files changed — a refusal row rather
 * than a success row — and that is the reason to keep it, not a reason to drop it: an attempt to reach a
 * switched-off capture endpoint is the one thing about this path still worth recording. Dropping the
 * entry would make those attempts the silent absence the whole predicate exists to prevent.
 *
 * Exported so the scope can be asserted rather than described — the test pins both directions, and the
 * direction that matters is the one that must NOT file (a client 404 on /portal/api/runs).
 */
/**
 * Is the per-finding flag capture switched on? ( — no, and the owner ruled it off on 2026-08-20.)
 *
 * A SOURCE CONSTANT, NEVER AN ENVIRONMENT VARIABLE. Nothing at runtime can change it: there is no
 * deployment of this code where the capture endpoint answers, and no box where an operator can turn it
 * back on without a commit. That distinction is the whole point — this launch has just retired four
 * environment switches under ADR-0002, and minting a dark one to disable a feature would be that defect
 * reborn one file over.
 *
 * It is the DEFAULT of `makePortalService`'s `feedbackCapture` seam rather than a direct read in the
 * handler, so the retained resolver can still be driven by a test. Nothing but a test passes it.
 *
 * The capture path it gates is intact: `feedback-store.mjs`, `feedback-issues.mjs`, `feedback-mint.mjs`,
 * `scripts/feedback-mint.mjs` and their suites are untouched and still green. Re-enabling is this
 * constant, the `feedback: true` argument at the serve call site, and reverting the portal-ui half.
 */
const FEEDBACK_CAPTURE = false;

/**
 * The POSTs that COMPUTE an answer and change nothing — the only exceptions to the rule below.
 *
 * Both read a request and hand back a draft or a price; neither writes a file, mints a token, moves a
 * run or spends anything. They are also the two POSTs a composing reader hits repeatedly while typing,
 * so they are where a refusal row would actually accumulate.
 *
 * NAMED HERE, so adding one is a visible edit to a list with a rule written above it. Everything else
 * under the two prefixes is covered by construction, which is what keeps this from becoming the
 * hand-kept list of "the ones we remembered".
 */
const NON_MUTATING_POSTS = Object.freeze(["/portal/api/compose/read", "/portal/api/run/plan"]);

/**
 * Does a refusal on this route owe the audit log a line?
 *
 * ── WIDENS the ANSWER, and the reason is on that issue ─────────────────
 *
 * scoped this to `/portal/admin/*` plus the one named client write, on the reasoning that the
 * other write routes "already file a richer row" of their own. Measured, that is true of their
 * OUTCOMES and false of their REFUSALS: `stop`, `queue-cancel` and `trigger` audit after the lane
 * answers, so every refusal BEFORE that — an unresolvable id, a wrong state, a missing account — files
 * nothing. `/portal/api/ack` files nothing at all, in either direction, and it is the route whose UI
 * message is the least informative: the owner pressed Acknowledge, was told "That could not be saved
 * just now", and the one surface that would have said why was silent for that route.
 *
 * So the rule is now the PREFIX, not a list: a POST under `/portal/api` or `/portal/admin` is a write
 * unless it is named above. A route added later is covered without anybody remembering to add it,
 * which is the half of the shape that kept failing.
 *
 * STILL REFUSALS ONLY, and the cost argument is why that half is unchanged: `/portal/admin/observed`
 * reads this log back through a fixed 256 KiB tail, so every row a success files is span that panel can
 * no longer see. The routes that file a rich success row keep filing it and nothing duplicates it.
 *
 * The credential-carrying POSTs — `/portal/login`, `/portal/logout` — are outside both prefixes and stay
 * outside this, as they were.
 */
/**
 * ── — WHAT A FULL COUNTRY SEARCH WILL NOT CONTAIN ON THIS BOX ───────────────
 *
 * Said at the point of choosing, which is the whole issue: the disclosure in the delivered report is the
 * product working correctly — no report claims "no adverse case law" off a sweep that never dispatched —
 * and the defect is that the disclosure was the FIRST mention, after two and a half hours and real
 * spend.
 *
 * NAMES NO VENDOR AND NO VARIABLE. This is a client-facing string on a client-facing screen, and the
 * enrolment is an operator's job on the box, not a client's. It says what the reader gets instead, which
 * is the one thing they can weigh before ordering.
 */
const CASE_LAW_DARK_NOTE = "This deployment has no case-law source set up, so the case-law and opposition "
  + "reading will not run. The search still runs and the report states the gap rather than reporting no "
  + "adverse case law — but it will not tell you what the courts have decided.";

export function isAdminWrite(method, path) {
  if (String(method ?? "").toUpperCase() !== "POST") return false;
  // The pathname only; a caller that passes a full URL would otherwise match on a query string.
  const p = String(path ?? "").split("?")[0];
  if (NON_MUTATING_POSTS.includes(p)) return false;
  return p === "/portal/api" || p.startsWith("/portal/api/")
    || p === "/portal/admin" || p.startsWith("/portal/admin/");
}

function outcomeRow({ event = "request-refused", method, path, email = null, status, reason = null }) {
  const row = {
    event,
    method: String(method ?? "").toUpperCase().slice(0, 10),
    path: String(path ?? "").slice(0, 200),
    status,
  };
  if (email) row.by = String(email).slice(0, 200);
  if (reason) row.reason = String(reason).slice(0, 200);
  return row;
}

/**
 * Revoking the connector keys a removed person holds — composed here, exported so it can be driven.
 *
 * It is the portal's half of an act `clearotron disconnect` also performs, through the same module, so
 * one author decides what revoking means. What differs is WHERE each runs, and the difference decides
 * what each may do: `disconnect` runs on the box beside the door, and this runs in a web request in a
 * different service with a different environment.
 */
export function makeConnectorKeyRevoker({ env = process.env, home = null } = {}) {
  return async ({ email, grants: g }) => {
    const { recordedKeysFor, disablePlan, applyDisablePlan, denylistPathFor } = await import("../shared/client-door.mjs");
    const { homedir } = await import("node:os");
    const { existsSync, mkdirSync, writeFileSync, appendFileSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const base = home ?? homedir();
    const recorded = recordedKeysFor(g, email);
    const plan = disablePlan({ env, unitDir: join(base, ".config", "systemd", "user"), exists: existsSync,
      identity: email, recorded, denylistPath: denylistPathFor(env, base), home: base });
    if (!plan.possible) return { grants: g, revoked: 0, jtis: [], lateArm: false, says: plan.says };
    if (plan.lateArm) return { grants: g, revoked: 0, jtis: plan.jtis, lateArm: true, says: plan.says ?? [] };
    // THE RECORD IS NEVER STRUCK FROM HERE, and the ledger step is dropped rather than no-opped.
    //
    // `disablePlan` decides `lateArm` from the environment it is handed, and the environment this
    // process has is the PORTAL's. The connector is a different unit with its own `EnvironmentFile`, so
    // a box where the portal names a revocation list and the door was started without one reads as
    // `lateArm: false` here — and the plan would then write the list AND strike the record, for a key
    // that still works. A record removed while its key works is the only trace of that key, gone: the
    // failure `client-door.mjs` states its ordering rule to prevent.
    //
    // So this process does the half it can vouch for. Writing the list is safe in both configurations —
    // it is the right act where the door reads it and a file nobody opens where it does not. Leaving the
    // record is safe in both too: `connectKeyReport` already judges a record valid, expired or revoked,
    // so a record of a revoked key is an accurate one, and `clearotron doctor` is where an operator sees
    // which. `clearotron disconnect` runs on the box, beside the door, and still strikes.
    //
    // The seam THROWS rather than doing nothing, so that a future change putting the ledger step back
    // fails here instead of quietly striking again.
    const revokeOnly = { ...plan, steps: plan.steps.filter((step) => step.id === "revoke") };
    applyDisablePlan(revokeOnly, {
      appendDenylist: (path, jtis) => {
        mkdirSync(dirname(path), { recursive: true });
        if (!existsSync(path)) writeFileSync(path, "# Revoked key ids, one jti per line. Read on every key check.\n", { mode: 0o600 });
        appendFileSync(path, jtis.map((j) => `${j}\n`).join(""));
      },
      strikeRecords: () => {
        throw new Error("the portal must not strike a key record: it cannot see the connector's environment, "
          + "so it cannot know whether the revocation list it just wrote is the one that door loaded");
      },
    });
    return { grants: g, revoked: plan.jtis.length, jtis: plan.jtis, lateArm: false, recordKept: true };
  };
}

// WHICH REFUSAL A PERSON IS SHOWN when this install cannot run a search: the person who sees everything, the one the
// Installation settings page is for and so the one who runs the install, is shown what is missing and the command
// that sets it; everyone else is shown the client sentence, which names neither.
const refusalFor = (principal, refusal) => (seesEverything(principal) && refusal.installer) || refusal.client;

/**
 * The portal's own question about an order: the runner's (`orderTimeRefusal`), with the remedy the person who runs
 * the install is shown read from how THIS portal runs (driver/how-it-runs.mjs): the configuration it actually uses,
 * and how it is reloaded. Every input is a parameter, so a test plants a machine, an environment, a command line
 * and a cgroup of its own; each one left out is this process's own.
 */
export function portalOrderRefusal({ env = process.env, tables = {}, argv, home = homedir(), repoRoot = INSTALL_ROOT, cgroup, readFile, exists, read, template } = {}) {
  return orderTimeRefusal(env, tables, {
    howFor: (missing) => howItRuns({ missing, env, argv, home, repoRoot, cgroup, readFile, exists, read, template }) });
}

export function makePortalService({
  poolRoot, workspaceRoot, recipesDir = undefined, secret,
  grants = null,
  // WHETHER THIS INSTALL SIGNS PEOPLE IN LOCALLY — one address and one passphrase, which cannot hold a
  // second person. The People page reads it to disable Add and say why. Injected, like every fact about
  // the process, because this constructor is pure over its inputs.
  localSignIn = false,
  // How the People page and company creation write the grants file. INJECTED so the service stays pure
  // over its inputs and an arm can watch the write; boot hands it an atomic write to
  // CLEAROTRON_ACCESS_FILE. Null means this service cannot write the file, and the routes that would
  // need to say so rather than pretend.
  writeGrants = null,
  // Revoking the connector keys a removed person holds. INJECTED for the reason `writeGrants` is: this
  // constructor stays pure over its inputs, an arm can watch the revocation without a denylist file on
  // disk, and boot is where the paths live. It takes the grants object the removal produced and returns
  // it with the struck records gone, so one write lands both facts.
  //
  // Null means this service cannot revoke, and the answer SAYS so — a removal that quietly left a live
  // key would be the exact failure the page's own sentence promises against.
  revokeConnectorKeys = null,
  // The queue directories the RUNNER drains — the same list it hands checkRunCaps. The allowance counter
  // and the quota pre-check read their ledger beside these, so they count what the wall counts (:
  // they used to reconstruct a workspace-relative path that resolved to nothing once the queue moved out
  // of the workspace, and reported 0 for every account forever).
  //
  // A FUNCTION, not an array: the set is a `config` getter that rescans the disk, and a portal that
  // resolved it once at construction would miss a workspace created after boot. Injected rather than
  // read here because this module must not import driver.config at module scope.
  //
  // The default returns NOTHING, and that is the honest default rather than a convenient one: a service
  // built without this wiring reports `complete: false` — "I could not count" — instead of a zero that
  // reads as "no runs today".
  queueDirs = () => [],
  trigger = async () => { throw new Error("no trigger wired (PORTAL_MCP_URL/PORTAL_OPS_TOKEN unset)"); },
  // Stopping is its own seam, not a parameter on `trigger`. `trigger` is THE SPEND PATH — the one
  // function guarded by the confirmation token, the quota and the audit trail — and widening it into a
  // general "call any verb" helper would make every one of those guards look optional at the call site.
  // Stop spends nothing and confirms nothing; it deserves a door of its own.
  stopRun = async () => { throw new Error("no stop lane wired (PORTAL_MCP_URL/PORTAL_OPS_TOKEN unset)"); },
  // ── — WHAT THE STOP CONTROL MAY HONESTLY OFFER ─────────────────────────────
  //
  // The boot log has said for days that this instance's ops token cannot stop_run, and every Stop
  // press failed as an upstream refusal a user cannot read. A control the deployment cannot serve must
  // not render as available: the bootstrap reads the LIVE token's posture and passes the verdict here;
  // /me carries it; the button disables itself with the reason. Default available — a fixture-built
  // service has a working seam-injected stop lane, and this seam is about the DEPLOYED token.
  stopControl = { available: true, reason: null },
  // ── — THIS PORTAL, RUN AS A DEMO ───────────────────────────────────────
  //
  // `clearotron demo` brings up THIS service rather than the dev cockpit, so its Start control is the
  // real one and would reach a door with no credentials behind it. In demo mode every product reports
  // unavailable with the reason at the control, and the order path refuses with the same sentence —
  // one fact, two surfaces, which is why it is a `cause` in search-policy.mjs and not a flag in the
  // screen. Injected rather than read from env HERE so a fixture can drive both directions; the
  // bootstrap below is the only place that reads the environment for it, and `bin/start.mjs` is the
  // only thing that sets it.
  demo = false,
  // — CAN THIS INSTALL RUN A SEARCH? The runner's own question (`orderTimeRefusal`, asked of order-tables.mjs),
  // injected for the reason `demo` is: the bootstrap below is the only place that reads the environment for it,
  // and a fixture can drive both answers. The default refuses nothing, which is every fixture that does not ask.
  orderRefusal = async () => null,
  audit = () => {},
  // The audit log's PATH, for the one surface that reads it back rather than writing to it
  // (/portal/admin/observed). Separate from `audit` above because that is a sink and this is a source,
  // and injected rather than read from env here so a test can point it at a fixture. Null ⇒ the
  // observed panel reports itself unavailable, which is a supported state rather than a failure.
  auditPath = null,
  // Diagnostics only (the report-embed nav strip reports what it did). Never a request path.
  auditLog = () => {},
  // — IS THE PER-FINDING FLAG CAPTURE ON? It is not, and `FEEDBACK_CAPTURE` is why (see above).
  //
  // A SEAM SO THE RETAINED PATH STAYS TESTED, which is the whole difference between disabled and
  // rotting. The resolver below carries the two-lane shape and the disposition read; the owner
  // ruled disable rather than delete, and code nothing can execute is code nobody can prove still works.
  // The eleven route tests in portal-service.test.mjs pass `feedbackCapture: true` and keep exercising it.
  //
  // THE BOOTSTRAP DOES NOT PASS IT, and that is asserted rather than trusted
  // (report-feedback-is-switched-off.test.mjs). No environment variable reaches this and no config file
  // names it: turning capture back on is a commit, on any box, which is the bar the owner set.
  feedbackCapture = FEEDBACK_CAPTURE,
  loadRecipesImpl = (o) => loadRecipes({ ...(recipesDir ? { dir: recipesDir } : {}), force: true, ...o }),
  // `readFlags` lived here until 2026-07-27, feeding the three admission kill switches from the snapshot
  // because this process deliberately has no engine environment. The switches are retired, so there is
  // nothing left to feed: availability now depends only on the build map below, which every service can
  // read the same way.
  //
  // The build map. `built.registerProbe` depends on which register the deployment wired (a provider that
  // cannot count cannot run Depth 2) and this process has no engine environment to work that out from,
  // so it is read from the snapshot. Re-read per call rather than captured at construction: re-running
  // the snapshot writer should take effect without a portal restart, and a map captured once at boot
  // would go stale in exactly the situation someone is actively trying to fix. Missing snapshot ⇒ the
  // module's own BUILT, i.e. degrade to available.
  readBuilt = () => builtFor(readFlagSnapshot(poolRoot)),
  readCanCount = () => registerCanCountFor(readFlagSnapshot(poolRoot)),
  // — which composer territories the wired register reaches. Same injection as readCanCount and
  // read from the same snapshot, because the portal has no engine environment and cannot work it out.
  // THREE answers survive the read: null (unrestricted), an array, or undefined (the snapshot does not
  // say — fail open). registerTerritoriesFor is what keeps them apart.
  readTerritories = () => registerTerritoriesFor(readFlagSnapshot(poolRoot)),
  // What to CALL the wired register on screen. Beside `readTerritories` and injected for the same
  // reason: the covered set says a territory cannot be searched, and this says by what — the screen
  // cannot name the register from the key without printing an engine identifier at a client.
  readRegisterLabel = () => registerLabelFor(readFlagSnapshot(poolRoot)),
  // — whether this deployment has a case-law source enrolled at all. Same
  // injection and same snapshot as the two above, and the same tri-state: null is "the snapshot does not
  // say", which must not render as a warning on a working box.
  readCaseLaw = () => caseLawReadyFor(readFlagSnapshot(poolRoot)),
  // The config surface (Profile, Projects). Injected so tests drive it offline; live it is a
  // profile-service constructed IN-PROCESS — see portal-upstream.mjs for why it is not an HTTP hop.
  // Null ⇒ the routes answer 404, which is the correct behaviour for an instance without it wired:
  // indistinguishable from a build where the surface does not exist.
  upstream = null,
  // Reading a pasted brief into a filled-in composer (driver/compose-read.mjs). NULL is the normal
  // state on a box that was never given a model credential, and it is a SUPPORTED state, not a fault:
  // /portal/api/searches then reports `read.available: false`, the composer keeps its Read-this button
  // disabled with the sentence it already ships, and every other part of the screen works as before.
  //
  // Fail-DARK here, unlike the flag snapshot's fail-available. The two are opposite for the same
  // reason: an unknown level might be runnable and the gate is the real wall, whereas a missing
  // credential is a known, local, certain fact — an enabled button over it would 500 on every press.
  composeRead = null,
  // Per-person hourly budget for the button above. Injected so a test can exhaust it in three presses.
  readBudget = makeReadBudget(),
  // The customer roster, as a map of key → profile. TWO routes need it and for the same reason — the
  // account picker and /portal/api/me's name map both turn a slug into what the client is called — so
  // it is one injected reader rather than two inline dynamic imports that could drift apart.
  //
  // Injected mainly so a test does not depend on CLEAROTRON_CUSTOMERS_DIR: unset, `loadProfiles` falls back
  // to the repo's own driver/profiles, so a test asserting a name would be asserting a fixture that
  // ships for other reasons and can be renamed by someone who never runs this file.
  loadProfilesImpl = async () => (await import("./profiles.mjs")).loadProfiles({ force: true }),
} = {}) {
  if (!secret) throw new Error("portal-service: a confirmation secret is required (PORTAL_SECRET)");
  // grants may be a VALUE (tests) or a FUNCTION re-read per request (live: enrolment lands without a
  // restart; an unreadable grants file is a hard 500, never a fallback — review 2026-07-18)
  const grantsNow = () => (typeof grants === "function" ? grants() : grants);
  // one-shot confirmation jtis (in-memory: ONE portal process per instance — documented POC bound)
  const usedJtis = new Map();
  const sweepJtis = (now = Date.now()) => { for (const [k, exp] of usedJtis) if (exp < now) usedJtis.delete(k); };

  const searchesFor = (account, principal) => {
    // A SAVED-SEARCH STORE THAT CANNOT BE READ COSTS THE SAVED SEARCHES, NOT THE MENU. Every product is
    // still offered; the list comes back empty with a sentence saying why, and only a person who sees
    // everything is shown the store's own error, which names a server path.
    let recipes = new Map(), recipesNote = null;
    try { recipes = loadRecipesImpl({}); }
    catch (e) {
      const cause = seesEverything(principal) ? ` (${String(e?.message ?? e).split("\n")[0].slice(0, 300)})` : "";
      recipesNote = `Saved searches could not be read on this installation, so none are listed${cause}.`;
    }
    const built = readBuilt();
    const canCount = readCanCount();
    const territories = readTerritories();
    const registerLabel = readRegisterLabel();
    const caseLawReady = readCaseLaw();
    return {
      // Every product is LISTED whatever its state. A product that vanishes when unavailable leaves a
      // client with no way to know it exists and no reason to ask for it; one shown greyed WITH THE
      // REASON AT THE CONTROL is an invitation. The gate is the wall, not this list.
      products: registryProducts().map((l) => {
        const cause = productAvailability(PRODUCT_POLICIES[l.key], {
          built, registerCanCount: canCount, registerTerritories: territories, geography: l.geography, demo,
        });
        // ── — COVERAGE RIDES BESIDE AVAILABILITY, NOT INSIDE IT ───────────
        //
        // The owner, on his own install with a partial register: "i cannot press the button for Global
        // clearotron search. Why. it doesnt appear disabled, no message etc — but i cant select it." The
        // product is orderable now (ruling on that issue), and what the register does not reach
        // is a SENTENCE on a live row rather than the reason a dead one cannot be pressed.
        //
        // A SEPARATE FIELD, because the two say opposite things to the screen: `unavailableNote`
        // explains a control that cannot be used, `coverageNote` qualifies one that can. Folding this
        // into the first would make every caller of `productAvailability` — the portal, the MCP door,
        // the dev cockpit — read a disclosure as a refusal, which is the behaviour the ruling removes.
        // ── THE PRODUCT ROWS CARRY NO COVERAGE SENTENCE ───────────────────────────────────────────
        //
        // This row printed a four-line paragraph — what the wired register reaches, of how many places
        // this search can name, and that the rest would be disclosed in the report as deferred coverage
        // rather than reported as clear. The owner met it on a running install and ruled it out on
        // 2026-09-18: it is on no board, and it describes the behaviour that naming an unreachable
        // territory no longer has. A named territory the register cannot reach is now refused at the
        // door, in one sentence naming the territory — so a paragraph promising to defer it instead
        // tells the reader the opposite of what the engine will do.
        //
        // NOTHING REPLACES IT, AND NO OTHER ROW GETS ONE. What a worldwide search on a partial register
        // actually reached belongs in the report that describes the search that ran, not in the form
        // that orders it.
        //
        // THE SENTENCE STILL EXISTS, one surface later, and deliberately: the review step before the
        // spend still states what is being bought. That is a different question asked at a different
        // moment — this row is "which search", that screen is "this is what you are committing to" —
        // and it was a separate ruling. `coverageDisclosure` keeps composing it for that caller.
        // ── — THE PRODUCT DECLARES WHAT IT NEEDS, so the row can say so ─────
        //
        // The owner ordered the one product carrying `caseLaw: true` and first heard of the lane in the
        // finished report, two and a half hours and real spend later. This screen already reads the
        // declaration — it renders "Reasoned against the case law and oppositions of that country" from
        // the same field — so it had the product's requirement and lacked only the deployment's answer.
        //
        // KEYED ON THE DECLARATION, never on a product id: a product that starts needing case law gets
        // this warning the day it declares it, and one that stops needing it loses the warning the same
        // day. That is the class instruction on the issue — derive it from what the product declares,
        // not from the hand-kept list of the two capabilities somebody remembered.
        //
        // ONLY ON AN EXPLICIT `false`. A snapshot that does not say is not evidence of a dark lane, and
        // a warning on every deployment whose writer has not run since is worse than the silence it
        // replaces.
        return { ...l, available: cause === null, unavailableNote: cause ? UNAVAILABLE_NOTE[cause] : null,
          coverageNote: null,
          capabilityNote: l.caseLaw && caseLawReady === false ? CASE_LAW_DARK_NOTE : null };
      }),
      // ── the TERRITORY affordance ─────────────────────────────────────────────────────────────
      //
      // The composer's Where field offers places this register cannot search. Sending the covered set
      // down lets it offer only what can be ordered — the same move as `available` on the product row,
      // one field lower.
      //
      // DISPLAY NAMES, computed server-side, because five vocabularies sit between a name on the form
      // and an office code (display → normalizeTerritory → canonicalJurisdictionCode → offices.translate
      // → covered.has) and resolveRegions() in register-plan.mjs records what re-implementing that chain cost.
      //
      // THE FIELD IS OMITTED, not nulled, when the snapshot does not say. `null` is a real answer here
      // ("no declared restriction") and the browser must be able to tell it from "this deployment has
      // not told me", which fails open. A `covered ?? []` anywhere on this path offers zero territories
      // on a production box.
      ...(territories === undefined ? {} : { territories }),
      // THE REGISTER'S NAME, sent whenever there is one. The covered set alone lets the screen mark a
      // territory as unreachable; it cannot say by WHAT, and the sentence the door refuses with names
      // the register ("China is not available with Signa, the register configured here"). A screen that
      // marked a chip without naming the register would be a second, vaguer wording for one fact.
      //
      // OMITTED, never nulled, exactly as `territories` above: absent means this deployment did not say,
      // and the screen must then mark the territory without naming a register rather than invent one.
      // It is the register's own display label, never the provider key — the key is an engine
      // identifier and has no place on a client's screen.
      ...(registerLabel ? { registerLabel } : {}),
      // `base` and `nativeLanguage` ride the LIST row, not just the record: the composer has to say what
      // geography a saved search accepts while the row is being clicked, and fetching the record per
      // selection would put that answer one round trip behind the Review button. Only `true` travels for
      // the toggle, exactly as at the recipe door.
      recipes: [...recipes.entries()]
        .filter(([k, r]) => k.startsWith(`${account}/`) && !r.archived)
        .map(([k, r]) => ({ slug: k.split("/")[1], label: r.label, base: r.base, version: r.version ?? null, nativeLanguage: r.nativeLanguage === true })),
      recipesNote,
      // ── — THE MARK-NAME BUDGET, SENT RATHER THAN DUPLICATED ──────────────
      //
      // The owner typed a product description into the mark-name field and the product accepted it,
      // priced it, ran it, and built the run's identity from it. The intake refuses that now — one rule
      // at every door — but a refusal a reader meets AFTER confirming is a round trip they should not
      // have paid for, so the screen has to know the same number.
      //
      // SENT, not hardcoded in the client, for the reason `read.maxBrief` beside it is sent: two copies
      // of a budget drift, and the one that drifts is the one nobody runs. `PLAN_MAX_NAME_LENGTH` is
      // the product's existing answer and stays the only one.
      maxMarkName: PLAN_MAX_NAME_LENGTH,
      // Whether the Describe-it half of the composer can actually read. Rides the capability payload
      // the composer already fetches rather than getting its own probe: one round trip decides what the
      // whole screen offers, and a second one would be a second thing to go stale.
      read: {
        available: Boolean(composeRead),
        maxBrief: MAX_BRIEF,
        // Never names the missing variable. This is a client-facing string on a client-facing screen,
        // and "ANTHROPIC_API_KEY is unset" tells a client about our plumbing to no purpose.
        note: composeRead ? null : READ_OFF_NOTE,
      },
    };
  };

  // assemble the SERVER-stamped candidate job for plan/run (identity fields never from the body)
  //
  // THE SPLIT THIS FUNCTION ENFORCES: identity is stamped, everything else is carried.
  //
  // `profileKey`, `forwarder` and `forwarderEmail` come from the verified principal and are never read
  // off the body — that is the tenancy wall, and it is the reason a client cannot file a clearance
  // against another brand owner by editing a request. Every OTHER field below is the user's to set, and
  // is passed through VERBATIM for `validateJob` to rule on. This function deliberately owns no
  // vocabulary of its own: shape, caps, dedupe and normalisation live in the one validator all three
  // doors share, so the portal cannot drift from the CLI or the MCP face.
  //
  // `customer` is NOT carried, and its absence is the considered answer rather than an oversight. It
  // names the APPLICANT for the self-exclusion check — the rule that stops a client's own filings being
  // reported back as conflicts. On this door the applicant is already known: the account resolved it,
  // and the profile behind it is staff-curated. Letting a body re-state it would let a client widen or
  // silence their own exclusion, which is a rating-authority change wearing a scope field's clothes.
  const jobFor = ({ principal, account, tenant = null, body }) => {
    const marks = Array.isArray(body.marks)
      ? body.marks.map((m) => (typeof m === "string" ? { name: m } : m)).filter((m) => m?.name && String(m.name).trim())
      : undefined;
    const text = (v, max) => (v != null && String(v).trim() ? String(v).slice(0, max) : undefined);
    const job = {
      id: `portal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      profileKey: account,
      // WHICH ORGANISATION'S GENERIC — the pair's other half, on a Generic run only, and resolved from the
      // principal rather than read off the body: `genericOrgOf` has already refused an organisation this
      // person does not see. Absent means filed under none, which only a person who sees everything can
      // order (portal-access.mjs).
      ...(account === "generic" && genericOrgOf(principal, tenant) != null ? { tenant: genericOrgOf(principal, tenant) } : {}),
      forwarder: "portal", forwarderEmail: principal.email,
      markName: body.markName != null ? String(body.markName) : marks?.[0]?.name,
      marks, classes: Array.isArray(body.classes) ? body.classes.map(Number).filter(Number.isFinite) : undefined,
      goods: text(body.goods, 2000),
      ...(body.product ? { product: String(body.product) } : {}),
      ...(body.recipeKey ? { recipeKey: String(body.recipeKey) } : {}),
      // spec 62 — the engagement this clearance belongs to. validateJob checks it names a real project
      // UNDER the resolved customer and clarifies otherwise, so a stale selection cannot silently fall
      // back to the customer profile on a paid run.
      ref: text(body.ref, 200),
      projectKey: text(body.projectKey, 64),
      // per-run SCOPE — where the machinery points, as against product/recipeKey which choose WHICH
      // machinery runs. jurisdictions REPLACE the account's territories; platforms are ADDED to its
      // marketplaces and can never remove one (the floor rule).
      jurisdictions: Array.isArray(body.jurisdictions) ? body.jurisdictions.map(String) : undefined,
      platforms: Array.isArray(body.platforms) ? body.platforms.map(String) : undefined,
      // THE GEOGRAPHY STAMP, carried from the composer rather than inferred here. "worldwide" is a
      // positive instruction that the account's own territories may not narrow, and it is byte-identical
      // to silence without this field — which is how a screen promised "everywhere" and ran seven
      // countries. Validated against the territory list by validateJob, never silently reconciled.
      // THE MODE ONLY. `origin` is WHICH LAYER supplied the territories, and validateJob derives it from
      // the mode at the one door all four share ("account-default" for that mode, "request" otherwise).
      // Stamping "request" here regardless made this the one door that recorded the requester as having
      // named territories they explicitly deferred to the account for — a provenance claim about a
      // person who never made it, and a stored request that differed from the other doors' byte for byte.
      ...(body.geography && typeof body.geography === "object" && !Array.isArray(body.geography)
        ? { geography: { mode: String(body.geography.mode ?? "") } } : {}),
      // The one toggle in the offering, carried STRAIGHT THROUGH — `false` included. The composer only
      // ever sends `true`, and the old rule here ("only true is forwarded") was written from that: an
      // explicit false implies a suppression that does not exist, so it was dropped. But dropping it is
      // the accept-and-drop shape on the sibling of the field two lines below, which this same door
      // carries verbatim for exactly that reason. A hand-rolled POST sending `false` believed it had
      // switched the investigation off; validateJob now refuses it, in products.mjs's own words.
      ...("nativeLanguage" in body && body.nativeLanguage != null ? { nativeLanguage: body.nativeLanguage } : {}),
      // `deliveryRoute` IS CARRIED, and its absence here was THE defect of this round.
      //
      // It is a DECLARED job field with a refusal sentence of its own (enqueue-schema PORTAL_ROUTE_-
      // UNAVAILABLE), refused by name at start_run, the CLI, plan_run and the runner's wall. This door
      // did not name it, so `deliveryRoute: "portal"` was gone before validateJob or the door gates could
      // see it: /plan returned 200, /run returned 200, `trigger` was handed a job with no deliveryRoute
      // key at all, and the run WENT OUT BY EMAIL with nothing said. The guarantee: a portal request
      // must never silently go out by email.
      //
      // Carried rather than judged here: this function owns no vocabulary (see the header), so the value
      // travels verbatim and the one sentence every other door quotes does the refusing.
      ...(body.deliveryRoute != null && String(body.deliveryRoute).trim() ? { deliveryRoute: String(body.deliveryRoute) } : {}),
      // `caseLaw` is carried STRAIGHT THROUGH so validateJob can refuse it — this door deliberately owns
      // no vocabulary of its own (see the header above). Dropping it here instead would make the portal
      // the one door that accepts the field and silently ignores it, which is both halves of the defect
      // at once: a requester told nothing, and three doors answering one question differently.
      ...("caseLaw" in body && body.caseLaw != null ? { caseLaw: body.caseLaw } : {}),
      // Copied on PRESENCE, null included — validateJob refuses the key itself, and a door that
      // dropped it would leave the requester believing their depth selector was honoured.
      ...("searchLevel" in body ? { searchLevel: body.searchLevel } : {}),
      // advice posture — what the searcher needs to know to weigh a hit, not what to search.
      upfrontInstructions: text(body.upfrontInstructions, 4000),
      commercialFlexibility: text(body.commercialFlexibility, 2000),
      priorUse: text(body.priorUse, 2000),
      // P2-C (Round-2 §8a): campaign-shape FACTS (house-brand attachment / duration / scale, verbatim from
      // the client) — recorded at intake so the matter frame never has to invent the launch shape.
      campaignShape: text(body.campaignShape, 2000),
      deadline: text(body.deadline, 40),
      // — `msgId: null, conversationId: null` used to sit here. They are the email door's fields;
      // this door has no message and no thread, so writing a constant and stripping it at the trigger
      // hop was two operations that cancelled out while the declaration above claimed they were carried.
      // They are in `notCarried` now, with the reason.
    };
    for (const k of Object.keys(job)) if (job[k] === undefined) delete job[k];
    return job;
  };
  const selectorOf = (body) => (body.recipeKey ? `recipe:${body.recipeKey}` : `product:${body.product || "the account's default"}`);

  // ── The engine program, read once, for every surface that reports it ───────────────────────────
  //
  // WHY /me NEEDS THIS AT ALL. The settings page can ask `/portal/admin/config`, which already computes
  // the live-versus-capture comparison. New clearance cannot: that route is staff-only, and the reader
  // who gets stuck here is as often a client. A screen that asked it would get a 404 and fall back to
  // the generic advice — which is the exact defect this exists to end, delivered to the exact reader
  // who reported it.
  //
  // WHAT IT COSTS ON A NORMAL PAGE VIEW: NOTHING, and that is structural rather than a promise. The
  // question only has a wrong answer in one state — the capture says there is no engine program — so
  // the live reading is taken only in that state. An install with a working engine never reaches the
  // probe, and /me is the hottest endpoint in the portal.
  //
  // AND IT IS THE SAME MECHANISM THE SETTINGS PAGE USES, deliberately: `flagView` with a live posture,
  // and the same `engine program` row out of `lastRun.disagrees`. Two surfaces answering this question
  // by two routes is how they came to contradict each other in the first place.
  //
  // NOT CACHED, AND THAT IS THE POINT OF THE CHANGE. A held reading was written first and removed: it
  // would have meant a reader who restarted the engine service went on being told to restart it for
  // as long as the window lasted — the staleness this whole change exists to end, in miniature, in
  // the one place a reader is standing when they act on it. Measured in testing, 2026-09-08: 0.28ms
  // for a reading taken cold with the imports warm, and a 0.29ms median over 50 requests in the state
  // that takes one on every request, against 0.04ms in the state that takes none. It is taken only
  // where a search is already refusing, so there is nothing here worth trading a wrong answer for.
  async function engineProgramDisputed(mode) {
    // NOT DEMO, NOTHING TO DISPUTE. The capture already sees the program, so the only disagreement
    // left is the mirror — this box cannot see what the engine could — and that one does not change
    // what this screen says: the screen is not refusing a search in that state.
    if (mode !== "demo") return false;
    try {
      const live = await livePosture();
      // `disagrees` is [] on agreement, rows on disagreement, and null when there is no capture to
      // compare against — three facts, and only the middle one is this. A null must not read as false.
      const rows = flagView(poolRoot, { live }).lastRun?.disagrees;
      return Array.isArray(rows) ? rows.some((d) => d.what === "engine program") : null;
    } catch {
      // COULD NOT LOOK, AND IT SAYS SO. Null travels to the screen as "unknown" and the screen prints
      // the general advice, which is what it printed before this existed.
      return null;
    }
  }

  // THE ROUTE GROUPS (portal-routes/). Each group is handed two objects: what this service holds (`svc`), with the module's
  // own constants a group prints or answers with, and what the request carries (`request`). A group answers a request it serves and returns undefined for any other, and the dispatcher asks the
  // groups in the order its routes have always been matched, so a request is answered by the route that answered it before.
  const svc = { poolRoot, workspaceRoot, secret, grants, localSignIn, writeGrants, revokeConnectorKeys, queueDirs, trigger,
    stopRun, stopControl, demo, orderRefusal, audit, auditPath, auditLog, feedbackCapture, readBuilt, readCanCount,
    readTerritories, upstream, composeRead, readBudget, loadProfilesImpl, usedJtis, sweepJtis, searchesFor, jobFor, selectorOf,
    engineProgramDisputed, INSTALL_ROOT, INSTALL_CHANNEL, READ_OFF_NOTE, refusalFor, allowanceExhaustedLine };

  async function route(method, path, identity, body = {}, query = {}) {
    const grantsHere = grantsNow();
    const principal = makePrincipal({ email: identity?.email, grants: grantsHere });
    const parts = path.replace(/\/+$/, "").split("/").filter(Boolean);   // ["portal", ...]
    if (parts[0] !== "portal") return { status: 404, json: { error: "not_found" } };
    const request = { method, path, parts, identity, principal, grantsHere, body, query };   // what a route group reads of the request
    try {
      { const answer = await meRoutes(svc, request); if (answer !== undefined) return answer; }   // portal-routes/me.mjs
      { const answer = await composeRoutes(svc, request); if (answer !== undefined) return answer; }   // portal-routes/compose.mjs
      { const answer = await runRoutes(svc, request); if (answer !== undefined) return answer; }   // portal-routes/run.mjs
      { const answer = await queueRoutes(svc, request); if (answer !== undefined) return answer; }   // portal-routes/queue.mjs
      { const answer = await configRoutes(svc, request); if (answer !== undefined) return answer; }   // portal-routes/config.mjs
      { const answer = await usageRoutes(svc, request); if (answer !== undefined) return answer; }   // portal-routes/usage.mjs
      { const answer = await connectRoutes(svc, request); if (answer !== undefined) return answer; }   // portal-routes/connect.mjs
      { const answer = await runsRoutes(svc, request); if (answer !== undefined) return answer; }   // portal-routes/runs.mjs
      { const answer = await reportRoutes(svc, request); if (answer !== undefined) return answer; }   // portal-routes/report.mjs
      { const answer = await feedbackRoutes(svc, request); if (answer !== undefined) return answer; }   // portal-routes/feedback.mjs
      { const answer = await adminRoutes(svc, request); if (answer !== undefined) return answer; }   // portal-routes/admin.mjs
      // GET /portal and every client-routed path below it are served by portal-static.mjs, ABOVE the
      // rate limiter and before this router ever sees them. Reaching here means a path the SPA handler
      // deliberately declined (an unknown /portal/api/* or /portal/report/* shape), which is a 404.
      return { status: 404, json: { error: "not_found" } };
    } catch (e) {
      if (e instanceof PortalDeny) return { status: e.status, json: { error: e.status === 404 ? "not_found" : e.message } };
      throw e;
    }
  }

  // ── — EVERY ADMIN WRITE FILES ITS OUTCOME, NOT ONLY ITS SUCCESS ──────────────────────────────
  //
  // Wrapped around route rather than added at each refusal site, because a call site demonstrably gets
  // forgotten — this issue is the evidence, filed against three writes that each remembered the success
  // line and none of the refusals.
  //
  // SCOPED TO THE ADMIN WRITE PATHS, which is the issue's binding Out of scope: "Per-request access
  // logging for the whole portal … This is about the admin WRITE paths, which are few, staff-only and
  // already have a sink." The first cut of this change wrapped EVERY route and filed a row for every
  // non-2xx anywhere — a client's 404 on /portal/api/runs, a malformed query on /portal/report/* — and
  // that is per-request access logging with a narrower name. isAdminWrite is the whole difference.
  //
  // It also costs something real. /portal/admin/observed reads this log back through a fixed 256 KiB
  // tail, so every row a poll files is span that panel can no longer see. The signal this issue wants
  // ("who tried and was refused") is worth that; a 404 on a static asset is not.
  //
  // FAILURES ONLY. The three write routes already file a richer row on success — the account, the
  // actor, the run count, which a generic row cannot know — so an unconditional row would duplicate
  // every one of them.
  //
  // A THROW IS NOT A REFUSAL, so it gets its own event. route() converts PortalDeny to a status and
  // rethrows everything else — anything arriving here is a bug on its way to becoming a 500, and it is
  // the outcome most worth having a line for. Scoped the same way: a crash in a read is the log's
  // business only if the log is a request log, which this one is not.
  async function routeAudited(method, path, identity, body = {}, query = {}) {
    const audited = isAdminWrite(method, path);
    let r;
    try {
      r = await route(method, path, identity, body, query);
    } catch (e) {
      if (audited) {
        audit(outcomeRow({ event: "request-error", method, path, email: identity?.email, status: 500,
          reason: e?.message ?? String(e) }));
        // A frozen or primitive throw cannot be stamped; a duplicate row beats swallowing the throw.
        try { if (e && typeof e === "object") e[AUDITED] = true; } catch { /* see above */ }
      }
      throw e;
    }
    if (audited && Number.isInteger(r?.status) && r.status >= 400)
      audit(outcomeRow({ method, path, email: identity?.email, status: r.status, reason: r.json?.error }));
    return r;
  }

  // `audit` LEAVES WITH `route`, and that is half the fix rather than a convenience.
  //
  // The bug report's own repro — an unauthenticated POST to /portal/admin/retired, answered 401, journal
  // unchanged — never reaches route() at all: makeHttpHandler resolves identity first and throws before
  // it calls this service. The sink is a closure parameter, so that function had no way to reach it and
  // no amount of wrapping route() would have closed the case the issue was filed about. Returning it is
  // what lets the door journal its own refusals into the same log, in the same shape.
  return { route: routeAudited, audit };
}

// The POC one-page UI that used to live here is gone. It built its rows with innerHTML string
// concatenation from upstream values — mark names, `meta.title`, `meta.matter`, recipe labels, stage
// labels, warnings — none of them escaped. Any of those is attacker-influenced: a mark name is typed by
// a user and a recipe label is stored config.
//
// It is not replaced by an escaped version. React escapes by default and `react/no-danger` is an error,
// so the whole class closes structurally rather than one sink at a time. The bundle is served by
// driver/portal-static.mjs.

/**
 * What the ops token this instance was handed actually CLAIMS. DECODED, NOT VERIFIED.
 *
 * This exists because a comment in this file used to assert a control that was not there. It described
 * the trigger lane as running on an "ACCOUNTS-SCOPED ops token — the confused-deputy blast radius is the
 * granted accounts", and the token deployed against it carries no `accounts` claim at all. shared/scope.mjs
 * authorize() only caps start_run `if (Array.isArray(scope?.accounts))`, and resolveScope defaults a
 * missing claim to accounts:"*" as first-party trust — so the described cap was never applied. A comment
 * asserting a wall that is not built is worse than no comment: it is the reason nobody goes to look.
 *
 * CORRECTED 2026-08-31, and the correction is this paragraph's own subject. This
 * used to read "the portal cannot mint itself a capped token from here … this process deliberately holds
 * no engine/MCP secrets — issuance is one path on purpose". **That wall was not built.** `bin/start.mjs`
 * generates TRADEMARK_MCP_TOKEN_SECRET into `~/.env`; the portal unit loads `EnvironmentFile=%h/.env`;
 * and `childEnv` hands the same value to the portal child. This process has held the signing secret on
 * both start paths for as long as both have existed, and four lines above, this very comment warns that
 * "a comment asserting a wall that is not built is worse than no comment: it is the reason nobody goes
 * to look". Nobody went to look, for the same reason.
 *
 * The portal is now an issuance path ON PURPOSE — `/portal/api/connect-key`, ruling 2026-08-31 —
 * minting an account key for the CALLER and for nobody else. What it still cannot do is mint for another
 * identity: `sub` comes from the authenticated principal and never from the request. What it CAN also do
 * is read the credential it was
 * configured with and say out loud what that credential permits, which turns the claim from an assertion
 * in a comment into a line an operator sees at every boot.
 *
 * Decoded, not verified, and the distinction matters: verification needs the signing secret this process
 * does not have. That is fine for this purpose — the question is "what was I configured with", not "is
 * this caller who they say they are", and a forged claim here would only mislead the operator reading
 * their own boot log. The MCP face verifies for real, on every call, and its answer is the one that binds.
 * The claim-shape tests below (non-empty array of non-empty strings) are copied from verifyToken() so
 * this cannot report a cap the enforcing side will discard.
 *
 * The cap was applied on 2026-07-20 (mint with `--accounts <keys>`, redeploy PORTAL_OPS_TOKEN), so the
 * boot line now names the accounts rather than warning. This function does NOT hardcode that: it reads
 * whatever token the process was given and reports what it finds, because the posture is a property of
 * the deployment and a comment asserting it would be the exact thing this replaced.
 */
// ── THE BUNDLE VERDICT, READ FROM DISK AND HELD BRIEFLY ──────────────────────────────────────────────
//
// `/portal/health` is polled — by the operator, by the units, by whatever watches the box — and the
// verdict walks two directory trees and asks git two questions. Recomputing that per request would make
// a health check the most expensive route the portal serves.
//
// HELD FOR TEN SECONDS, WHICH IS SHORT ENOUGH TO BE HONEST. The state it reports changes when somebody
// pulls or rebuilds — a human act, minutes apart — so a ten-second-old answer is never the difference
// between an operator seeing this and not. A cache for the life of the process would be: the portal
// keeps running across a pull, which is exactly the case this exists to catch.
const BUNDLE_TTL_MS = 10_000;
let bundleCache = { at: 0, verdict: null, present: null };

export function bundleFreshnessCached(present, { now = Date.now(), ttl = BUNDLE_TTL_MS, repo = INSTALL_ROOT } = {}) {
  // The presence half is the SERVICE's own answer and is not cached here: it is cheap, it is what
  // /portal actually does, and a stale "present" would be the one lie this endpoint cannot afford.
  if (bundleCache.verdict !== null && bundleCache.present === present && now - bundleCache.at < ttl) return bundleCache.verdict;
  const verdict = bundleVerdict({
    repo,
    distDir: pathResolve(repo, "portal-ui", "dist"),
    srcDir: pathResolve(repo, "portal-ui", "src"),
    present,
  });
  bundleCache = { at: now, verdict, present };
  return verdict;
}

/**
 * How to re-mint the trigger token WITH an accounts cap, and without changing anything else about it.
 *
 * ── THE RE-MINT COMMAND ──────────────────────────────────────────────────────────────────────────
 *
 * This used to be a fixed string in the warning itself: `--sub portal --verbs start_run,stop_run`. An
 * operator whose token carries a third verb, or a different subject, was told to re-mint as something
 * NARROWER than what they already had — and the only symptom is the verb they silently lost failing
 * later as an upstream refusal, which reads as an engine fault. The advice is "add an accounts cap",
 * so nothing else about the token may move because a reader followed it.
 *
 * `shared/trigger-lane.mjs` and the stop_run warning one branch below both already derive their flags
 * from the token in hand. This was the last site in that family still printing a constant.
 *
 * AN UNREADABLE PAYLOAD GETS NO COMMAND. `opsTokenPosture` answers `readable: false` with every claim
 * null, and that lands here because `accountCapped` is false when nothing could be read. A command
 * composed from those nulls would be a guess presented as an instruction — and it is exactly the case
 * where following it destroys a token nobody could inspect.
 */
export function accountCapAdvice(posture) {
  if (!posture?.readable) {
    return "Its payload could not be read, so the command to re-mint it cannot be composed here — read "
      + "the token's own claims first, then re-mint with the same `--sub` and `--verbs`, plus "
      + "`--accounts <keys>`.";
  }
  return "Re-mint with `mcp-server/mint-token.mjs --scope ops"
    + `${posture.sub ? ` --sub ${posture.sub}` : ""}`
    // A FULL-OPS TOKEN (`verbs: null`) IS RE-ISSUED WITH THE PORTAL'S OWN VERBS. It used to get no
    // `--verbs` at all, so as not to narrow it; mint-token now refuses an ops token that names none, so that
    // command would fail, and re-issuing verb-less tokens with verbs is the point. The portal calls these two.
    + ` --verbs ${(posture.verbs ?? ["start_run", "stop_run"]).join(",")}`
    + " --accounts <keys>` to make it two walls.";
}

export function opsTokenPosture(token, { now = Date.now() } = {}) {
  const none = { readable: false, scope: null, sub: null, verbs: null, accounts: null, accountCapped: false,
    expiresAt: null, daysLeft: null, expired: false, implausibleExp: false };
  const parts = String(token ?? "").split(".");
  if (parts.length !== 3 || parts[0] !== "v1" || !parts[1]) return none;
  let p;
  try { p = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")); } catch { return none; }
  if (!p || typeof p !== "object" || Array.isArray(p)) return none;
  const listOf = (v) => (Array.isArray(v) && v.length && v.every((s) => typeof s === "string" && s) ? v : null);
  const accounts = listOf(p.accounts);
  // The expiry is read for one reason: this credential is minted with a multi-month TTL and nothing
  // anywhere counts it down. When it lapses, every Start stops working — and the failure arrives as an
  // upstream refusal, which reads like an engine fault rather than an expired key card. A silent
  // deadline on the only credential in the spend path is worth surfacing at every boot.
  //
  // THE VALUE IS BOUNDED BEFORE IT IS FORMATTED, and that is not fussiness. `new Date(x).toISOString()`
  // throws RangeError beyond ±8.64e15 ms, this function is called from the BOOTSTRAP with no try/catch
  // around it, and its whole contract is decoding an UNVERIFIED, FORGEABLE payload. So an `exp` of
  // 1.79e15 — or a token minted in milliseconds by mistake — would stop the portal starting at all.
  // A credential whose expiry cannot be read must degrade to "unknown, and say so loudly"; it must
  // never be able to take down the service that reads it. Caught by adversarial review, after a first
  // pass that probed odd values but none large enough to leave the representable range.
  const EXP_MIN = 946_684_800;     // 2000-01-01 — before this, not a real issuance
  const EXP_MAX = 4_102_444_800;   // 2100-01-01 — after this, the units are wrong, not the date
  const rawExp = Number.isFinite(p.exp) ? p.exp : null;
  const expSec = rawExp !== null && rawExp >= EXP_MIN && rawExp <= EXP_MAX ? rawExp : null;
  const exp = expSec === null ? null : expSec * 1000;
  // Distinguishes "no exp claim" from "an exp claim that makes no sense". The second is a broken
  // credential and deserves a warning; the first is merely unknown.
  const implausibleExp = rawExp !== null && expSec === null;
  return {
    readable: true,
    scope: typeof p.scope === "string" ? p.scope : null,
    sub: typeof p.sub === "string" && p.sub ? p.sub : null,
    verbs: listOf(p.verbs),
    accounts,
    expiresAt: exp === null ? null : new Date(exp).toISOString(),
    daysLeft: exp === null ? null : Math.floor((exp - now) / 86_400_000),
    expired: exp === null ? false : exp <= now,
    implausibleExp,
    // The ONLY thing a caller should branch on. `null` accounts is not "no accounts" — it is "every
    // account", which is the inversion that made the old comment readable as reassuring.
    accountCapped: accounts !== null,
  };
}

// ──: WHICH DOCTRINE IS BEING SERVED, beside which engine is serving it ───────────────────────
//
// The engine's commit is cached for the life of the process and that is correct — engine-build.mjs
// says why: code cannot change under a running process without a restart. THE DOCTRINE STORE CAN. A
// config deploy re-renders the overlay in place and the portal keeps running, so a cached store sha
// would answer with the doctrine that was there when the process booted, which is precisely the
// stale-confirmation failure this whole endpoint exists to remove.
//
// So it is re-read, with a short TTL. The TTL is not a performance nicety — it is the bound on how
// wrong this field is allowed to be, and thirty seconds is short against a deploy cadence measured in
// hours. `classifySkillsStore` is the same function the run door calls, not a second copy of
// the git logic: two answers about one store that could drift apart would be worse than none.
//
// Best-effort, always. A health probe that 500s because git is slow has turned a diagnostic into an
// outage — the whole point is that it answers from any account, at any time, without a grant.
const STORE_TTL_MS = 30_000;
/**
 * The skills overlay this portal resolves frameworks through, decided once at boot, and the one line
 * that says what was decided.
 *
 * DERIVED MEANS "IF THERE IS ONE". When the operator set nothing, PROFILE_REPO_ROOT names the config
 * store and the store's layout puts instruction overrides in its `skills` folder. A folder that is
 * absent or empty overrides nothing, which is the state setup leaves on purpose: it keeps
 * CLEAROTRON_INSTRUCTIONS_DIR unset so the product's own instructions are used. Pinning the folder anyway
 * made every framework read throw `skills_overlay_unreadable`, so the company profile answered 500 on
 * a store with no `skills` folder, and the boot told a fresh install its frameworks might be synthetic.
 * Pinned to an EMPTY folder inside the store's repository, the doctrine-store verdict read "blocked",
 * because the checkout tracks no file under it. Unset reads "pass". Both measured, 2026-09-10.
 *
 * A folder that EXISTS AND CANNOT BE READ is still pinned, so every read of it keeps refusing by name
 * rather than falling back, and a WARNING says why. An overlay the OPERATOR set is theirs: nothing here
 * changes it, and the warning for one this process cannot see is unchanged.
 *
 * `posture` is the demo's own sentence. In a demo it stands wherever this would otherwise say more.
 */
export function skillsOverlayAtBoot({ explicit = null, profileRepoRoot = null, readdir = readdirSync, exists = existsSync, posture = null } = {}) {
  const synthetic = "customer risk frameworks will resolve to this repo's demo fixtures and the Brand profile page will "
    + "show either \"could not be read\" or a SYNTHETIC framework as though it were the customer's own. "
    + "Set CLEAROTRON_INSTRUCTIONS_DIR (or PROFILE_REPO_ROOT) to the config store.";
  if (explicit) return { pin: null, line: exists(explicit) ? null : (posture || `WARNING: skills overlay unreadable (${explicit}) — ${synthetic}`) };
  if (!profileRepoRoot) return { pin: null, line: posture || `WARNING: skills overlay unset — ${synthetic}` };
  const dir = join(profileRepoRoot, "skills");
  const nothing = (how) => posture || (`skills overlay: ${dir} ${how}, so this install overrides nothing and the product's own `
    + "instruction files are used. To override one, put the file there, commit it, set CLEAROTRON_INSTRUCTIONS_DIR to that folder, and restart.");
  let entries;
  try { entries = readdir(dir); }
  catch (e) {
    if (e?.code === "ENOENT") return { pin: null, line: nothing("does not exist") };
    return { pin: dir, line: posture || (`WARNING: skills overlay ${dir} exists and cannot be read (${e?.code ?? String(e?.message ?? e)}) — `
      + "every instruction read will refuse by name rather than fall back. Make the folder readable by this process, or remove it if this install overrides nothing.") };
  }
  if (!entries.length) return { pin: null, line: nothing("is empty") };
  return { pin: dir, line: `skills overlay derived from PROFILE_REPO_ROOT: ${dir}` };
}

let storeCache = { at: 0, value: null };
function doctrineStore(now = Date.now) {
  const t = now();
  if (storeCache.value && t - storeCache.at < STORE_TTL_MS) return storeCache.value;
  let value;
  try {
    // `envFrom(process.env, …)` and NOT `config.skillsOverlayDir`, which is the same value: this
    // module must not import driver.config at module scope (see the queueDirs note above), and
    // driver.config.mjs's getter resolves the same name the same way — so this reads the source
    // rather than approximating it. The first draft here did reference `config`, which is not in scope
    // at module level; the ReferenceError landed in the catch below and came back as "unreadable",
    // which is exactly the kind of plausible wrong answer this endpoint exists to stop producing.
    const s = classifySkillsStore(envFrom(process.env, "CLEAROTRON_INSTRUCTIONS_DIR") || null,
      { mainBranch: process.env.CLEAROTRON_SKILLS_STORE_MAIN_BRANCH });
    value = { head: s.head ?? null, situation: s.situation, outcome: s.outcome };
  } catch (e) {
    // NOT `{head: null}` alone. A null head with no reason reads as "no store", which is a legal and
    // healthy state (`no-overlay`); this is a different thing and has to say so.
    //
    // THE ERROR'S OWN WORDS GO TO THE SERVICE LOG, NOT THE WIRE. This answer is served by the health
    // route, and an error message can carry the store's filesystem path. `unreadable` says what the
    // caller needs; the operator reads why in the log.
    console.error(`[portal] the instructions store could not be read: ${String(e?.message ?? e).slice(0, 200)}`);
    value = { head: null, situation: "unreadable", outcome: "blocked" };
  }
  storeCache = { at: t, value };
  return value;
}

/** Test seam: forget the cached store answer. */
export function resetDoctrineStoreCache() { storeCache = { at: 0, value: null }; }

// ── HTTP plumbing + bootstrap (recipe-service pattern; html-aware send) ────────────────────────────
async function readJsonBody(req, limitBytes = 131072) {
  return await new Promise((resolve, reject) => {
    let len = 0; const chunks = [];
    req.on("data", (c) => { len += c.length; if (len > limitBytes) { reject(new Error("body_too_large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { const s = Buffer.concat(chunks).toString("utf8").trim(); if (!s) return resolve({}); try { resolve(JSON.parse(s)); } catch { reject(new Error("body_unparseable")); } });
    req.on("error", reject);
  });
}

/**
 * The instance a refusal page names: its organisation when one is configured, otherwise the host of the
 * sign-in service it sends people to (the OIDC issuer, or the Access team's own domain, derived as the
 * verifier derives it), and failing both the address this process is answering on.
 *
 * NEVER NULL, AND THAT IS THE CHANGE. It used to return null with neither configured, and a page that
 * says nothing about which instance it is defeats the whole point of the sentence — the reader who met
 * this through a forwarded port could not tell somebody else's refusal from their own, which is the
 * defect the line exists for. The unconfigured instance is the one most likely to be reached by
 * accident, so it is the last case that should stay silent.
 *
 * THE HOSTNAME IS THE LAST RESORT, not the first, and the note that used to say "never by this
 * server's own hostname" was right about the order and wrong about the floor. An organisation name and
 * a sign-in service are public by nature and mean something to a reader; a machine name is neither, and
 * it is disclosed only where the alternative is a page that identifies nothing at all — an instance
 * with no organisation and no sign-in service, which is a local one whose reader is the person running
 * it. Read from the environment at call time.
 */
function instanceIdentity(env = process.env) {
  if (ORGANISATION_NAME) return `This is ${ORGANISATION_NAME}'s ${BRAND.name} portal`;
  const issuer = String(env.PORTAL_OIDC_ISSUER ?? "").trim();
  const team = String(env.CF_ACCESS_TEAM ?? "").trim();
  let host = null;
  try { host = issuer ? new URL(issuer).host : null; } catch { host = null; }
  if (!host && team) host = `${team}.cloudflareaccess.com`;
  if (host) return `This ${BRAND.name} portal signs people in through ${host}`;
  // The address this process answers on: what a reader can compare against the one they typed. The port
  // is the half that matters where a forward is in play, since the machine name will often be the same.
  const port = String(env.PORTAL_SERVICE_PORT ?? "").trim() || String(PORTAL_PORT_DEFAULT);
  const machine = (() => { try { return osHostname(); } catch { return ""; } })();
  const at = [machine, port].filter(Boolean).join(":");
  return at ? `This ${BRAND.name} portal is the one running on ${at}` : `This is a ${BRAND.name} portal`;
}

/**
 * The sign-in refusal page.
 *
 * A person refused at the door is the ONE case where a JSON body is actively harmful: they cannot read
 * it, cannot act on it, and — worst — cannot get out. Cloudflare Access holds the session, so the only
 * way to try a different address is its logout endpoint, and a raw error dump gives no route to it.
 * Someone signed in on the wrong account is then simply stuck, with a stack of technical text and no
 * door. That is what shipped, and it is why this exists.
 *
 * Deliberately self-contained: no bundle, no fonts, no network. This page has to render when the rest
 * of the portal will not.
 *
 * left this alone, deliberately. Its /cdn-cgi/access/logout button is Cloudflare's endpoint and
 * would be a 404 on a local install — but a local install never renders this page: an unauthenticated
 * BROWSER is redirected to /portal/login before any refusal is raised (see makeHttpHandler), and the
 * only callers that reach the AuthError branch below are the ones asking for JSON. Parameterising the
 * button would have been a branch nothing can take.
 */
export function denialPage(status, message) {
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // WHICH INSTANCE THIS IS. Reached through a forwarded port, this page read as a local demo refusing its own
  // user (measured 2026-09-11, a VS Code Remote-SSH forward on WSL); named, a person can tell it is not
  // theirs. Named by the organisation when one is set, otherwise by the sign-in service the browser is sent
  // to, which is public by nature: never by this server's own hostname. No advice about ports: the people
  // who normally see this page are a hosted instance's own clients, with nothing local to move.
  const who = instanceIdentity();
  // The upstream message names the address and the reason. That is useful to the person reading it and
  // to whoever they forward it to — but it is a DIAGNOSTIC, so it sits below the fold of the sentence
  // that actually tells them what to do.
  const title = status === 403 ? "This address is not enrolled" : "You are not signed in";
  const body = status === 403
    ? `You reached ${BRAND.name}, but this address has not been given access to the portal. If you expected it to work, ask ${BRAND.name} to enrol it — or sign in with a different address.`
    : "Your session could not be verified. Signing in again usually fixes it.";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${esc(title)} — ${esc(BRAND.name)}</title>
${FAVICON_LINK}
${DOOR_THEME_INIT}
${TEXT_FONT_STYLE}
<style>
  ${DOOR_ROOT}
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         font:16px/1.55 var(--font); background:var(--cream); color:var(--ink); padding:24px; }
  .card { max-width:520px; background:var(--card); border:1px solid var(--line);
          border-radius:14px; padding:30px 32px; }
  .lockup { display:inline-flex; align-items:center; gap:10px; white-space:nowrap; margin-bottom:22px; }
  .mark { color:var(--ink); display:block; }
  .word { font-family:var(--mono); font-size:15px; font-weight:500; letter-spacing:.02em;
          line-height:1; color:var(--ink); }
  h1 { font-size:21px; margin:0 0 10px; font-weight:700; }
  p { margin:0 0 14px; color:var(--muted); }
  .row { display:flex; gap:10px; flex-wrap:wrap; margin-top:20px; }
  a.btn { display:inline-block; padding:9px 16px; border-radius:9px; text-decoration:none;
          border:1px solid var(--line-strong); color:var(--ink); font-size:14px; font-family:var(--font); }
  a.primary { background:var(--accent-fill); color:var(--accent-ink); border-color:var(--accent-fill); }
  code { display:block; margin-top:22px; padding:10px 12px; background:var(--code-bg);
         border-radius:8px; font:12px/1.5 var(--mono); color:var(--muted); word-break:break-all; }
  ${DOOR_ROOT_DARK}
</style></head><body><div class="card">
<span class="lockup"><span class="mark">${bracketMark(20, "currentColor", PALETTE.crimson)}</span><span class="word">${esc(BRAND.name.toLowerCase())}</span></span>
<h1>${esc(title)}</h1>
<p>${esc(body)}</p>
<div class="row">
  <a class="btn primary" href="/portal/sign-out">Sign in as someone else</a>
  <a class="btn" href="/portal">Try again</a>
</div>
${who ? `<p style="margin-top:20px;font-size:14px">${esc(who)}.</p>` : ""}
<code>${esc(message)}</code>
</div></body></html>`;
}

// ──: THE LOCAL SIGN-IN DOOR ───────────────────────────────────────────────────────────────────
//
// SERVER-RENDERED, NOT A SPA SCREEN, and that is a hard constraint rather than a preference. CI greps
// the BUILT portal-ui bundle for `(CLEAROTRON|PORTAL|CF_ACCESS|MCP)_[A-Z_]+` and fails on a match, because
// no client-facing surface may name an internal switch. A login screen inside the SPA would want to
// explain which value to set when nobody is configured, and the first honest sentence it wrote would
// red the build. Here the same explanation is a line in the operator's terminal, where diagnostics
// belong, and the browser sees only what a person can act on.
//
// The page's own copy therefore NAMES NO VARIABLE. "The passphrase was printed in the terminal" is the
// whole of what a person needs; which file it was written to is the operator's business, and the
// operator is reading stderr.
//
// Self-contained for the same reason denialPage is: it has to render before the caller has an identity,
// which is exactly when the bundle may not be reachable.
const escHtml = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/**
 * loginPage({ email, error, signedIn }) — one field, because there is one user.
 *
 * The address is DISPLAYED, never asked for. Asking would invite the answer "which address works?",
 * which is a question this page must not be able to answer: a wrong passphrase and a wrong address get
 * the same sentence and the same status, so the form is not an oracle for either.
 */
// ── part 3 — THE LOGIN PAGE IS THE FACE OF THE PRODUCT ─────────────────────────────────────────
//
// This page hardcoded its own palette (`#f5f0e8`, `#fffdf9`, `#2c2a26`…), a system font stack, no mark
// and no wordmark, while `shared/brand.mjs` has exported all four for every other surface. It is the
// first thing a client sees and the only page they see before signing in.
//
// The lockup is the PROJECT lockup — bracket mark + wordmark — transcribed from the same rule
// `portal-ui/src/components/Logo.tsx` renders in React: mono family, weight 500, .02em tracking,
// nowrap, and NOT uppercased, because the brand string is lowercase deliberately and a text-transform
// would silently override it. The bracket geometry is not re-drawn here: `bracketMark()` is the one
// copy, and `driver/test/one-bracket-geometry.test.mjs` already binds it to portal-ui's.
//
// EVERY COLOUR ON THIS PAGE COMES FROM brand.mjs BY NAME, in BOTH schemes ( closed the half
// left open). The page declares no palette of its own: `DOOR_ROOT` and `DOOR_ROOT_DARK` are the door
// family's two blocks, shared with the refusal page above, and every value the dark scheme changes is a
// TOKEN — so there is no scoped override here that could restyle a selector the light block never
// mentioned. A colour literal reappearing in this function is what
// `driver/test/door-pages-take-their-colours-from-brand.test.mjs` fails on.
//
// The dark ground moved with that change: the block this page used to carry had guessed #17150f/#ece5d8,
// and brand pack §01 fixes dark at #0f0e0c near-black + #f0e8d8 parchment. The pack wins.
// ── THE PLAIN LINE LEADS; THE ADMINISTRATOR'S TWO LINES STEP BACK INTO A FOLD ────────────────────────
//
// A person arriving here needs the field, the button, and one fact: this install has one user, and which
// address that is. The owner's words, 2026-09-19: "Clearotron portal, as <address>." read as "you are
// <address>", and a person who found `key issue` first minted a key and could not get in.
// The reset command and the way to add people are an administrator's business, so they sit in a closed
// "Administrator help" fold, word for word as they were, with the same link People gives to putting a
// login system in front. A `<details>` needs no script, which this door must render without.
//
// The reset command can be long — a pinned version, a base directory — so it wraps inside the card at the
// card's own width rather than pushing past its edge.
export const LOGIN_IN_FRONT_DOC = `${SOURCE_REPO}/blob/main/docs/PORTAL.md#putting-your-own-login-provider-in-front`;

export function loginPage({ email, error = null, signedIn = false, discarded = false, resetCommand = null }) {
  const reset = resetCommand || `${bareInvocation("passphrase")} --reset`;
  const title = signedIn ? "Signed in" : "Sign in";
  const lockup = `<span class="lockup"><span class="mark">${bracketMark(20, "currentColor", PALETTE.crimson)}</span>`
    + `<span class="word">${escHtml(BRAND.name.toLowerCase())}</span></span>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${escHtml(title)} — ${escHtml(BRAND.name)}</title>
${FAVICON_LINK}
${DOOR_THEME_INIT}
${TEXT_FONT_STYLE}
<style>
  ${DOOR_ROOT}
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         font:16px/1.55 var(--font); background:var(--cream); color:var(--ink); padding:24px; }
  .card { max-width:420px; width:100%; background:var(--card); border:1px solid var(--line);
          border-radius:14px; padding:30px 32px; }
  .lockup { display:inline-flex; align-items:center; gap:10px; white-space:nowrap; margin-bottom:22px; }
  .mark { color:var(--ink); display:block; }
  .word { font-family:var(--mono); font-size:15px; font-weight:500; letter-spacing:.02em;
          line-height:1; color:var(--ink); }
  h1 { font-size:21px; margin:0 0 10px; font-weight:700; }
  p { margin:0 0 14px; color:var(--muted); }
  .who { font-weight:600; color:var(--ink); }
  a { color:var(--link); }
  label { display:block; font-size:13px; color:var(--muted); margin:18px 0 6px; }
  input { width:100%; box-sizing:border-box; padding:10px 12px; border:1px solid var(--line-strong);
          border-radius:9px; background:var(--card); color:var(--ink); font:15px/1.4 var(--mono); }
  button { margin-top:18px; padding:9px 16px; border-radius:9px; border:1px solid var(--accent-fill);
           background:var(--accent-fill); color:var(--accent-ink); font-size:14px; font-family:var(--font);
           font-weight:500; cursor:pointer; }
  .err { margin:16px 0 0; padding:10px 12px; border-radius:8px; background:var(--err-bg);
         border:1px solid var(--err-line); color:var(--err-ink); font-size:14px; }
  .hint { margin-top:18px; font-size:13px; }
  code { font-family:var(--mono); font-size:12.5px; background:var(--code-bg);
         padding:1px 5px; border-radius:4px; overflow-wrap:anywhere; }
  .fold { margin-top:18px; padding-top:14px; border-top:1px solid var(--line); }
  .fold > summary { display:inline-flex; align-items:center; gap:6px; list-style:none; cursor:pointer;
                    font-size:13px; color:var(--link); }
  .fold > summary::-webkit-details-marker { display:none; }
  .fold .chev { flex:none; color:var(--muted); }
  .fold[open] > summary .chev { transform:rotate(90deg); }
  .fold .hint { margin:14px 0 0; }
  ${DOOR_ROOT_DARK}
</style></head><body><div class="card">
${lockup}
<h1>${escHtml(title)}</h1>
${signedIn
    ? `<p>You are signed in as <span class="who">${escHtml(email)}</span>.</p>
<div><a href="/portal">Go to the portal</a></div>
<form method="post" action="/portal/logout"><button type="submit">Sign out</button></form>`
    : `<p>This ${escHtml(BRAND.name)} has one user: <b class="who">${escHtml(email)}</b>. Enter its passphrase.</p>
${discarded ? `<p class="hint">Your earlier sign-in has expired. Sign in again.</p>` : ""}
${error ? `<p class="err">${escHtml(error)}</p>` : ""}
<form method="post" action="/portal/login">
  <label for="passphrase">Passphrase</label>
  <input id="passphrase" name="passphrase" type="password" autocomplete="new-password" autofocus>
  <button type="submit">Sign in</button>
</form>
<details class="fold"><summary><span>Administrator help</span><svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m9 18 6-6-6-6"/></svg></summary>
<p class="hint">The passphrase was printed once when this ${escHtml(BRAND.name)} first started. Lost it? Run
<code>${escHtml(reset)}</code> on the machine running this portal. It prints a new one, once, for the same user.</p>
<p class="hint">A key from <code>${escHtml(bareInvocation("key"))} issue</code> is for an AI assistant, not for this page.</p>
<p class="hint">To add people, put it behind a login system such as your company single sign-on. <a href="${escHtml(LOGIN_IN_FRONT_DOC)}" target="_blank" rel="noreferrer">How to set that up</a></p>
</details>`}
</div></body></html>`;
}
// THE FIELD DOES NOT INVITE THE BROWSER'S SAVED PASSWORDS. Every local install and demo answers on
// 127.0.0.1, so a browser that saved one install's passphrase fills it into the next install's page, and
// the person is told a passphrase they never typed is wrong (read from the handler, 2026-09-11: the POST
// compares only what the browser sent). `new-password` is the value browsers honour on a password field;
// `off` is ignored there. The refusal says to check the field, for a browser that fills it regardless.
const WRONG_PASSPHRASE = "That passphrase is not correct. If your browser filled the field in, clear it and type the passphrase yourself.";

// The cookie the local session rides in. HttpOnly (no script needs it and nothing in the SPA reads it),
// SameSite=Strict (there is no cross-site flow to preserve — every portal navigation is same-origin),
// Path=/ so a report under /portal/report/… carries it too.
const SESSION_COOKIE = "portal_session";

/**
 * The first cookie parser in this file, and deliberately small: there is no dependency to add for one
 * name, and a general-purpose parser would be more code than the thing it parses.
 *
 * FIRST WINS on a duplicate name, which is what a browser sends for the most specific path and what
 * every server-side parser in wide use does. The alternative — last wins — is the shape cookie-shadowing
 * attacks are written against.
 *
 * The decode is guarded: `decodeURIComponent` throws on a malformed escape like `%zz`, and a cookie
 * header is attacker-controlled on any request. An unparseable value falls back to its raw text, which
 * then simply fails signature verification. A 500 on a bad cookie would be a way to take the portal's
 * error rate up from an unauthenticated socket.
 */
function parseCookies(header) {
  const out = Object.create(null);
  for (const part of String(header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k || k in out) continue;
    const raw = part.slice(i + 1).trim();
    try { out[k] = decodeURIComponent(raw); } catch { out[k] = raw; }
  }
  return out;
}

/**
 * `Secure` ONLY when this request actually arrived over TLS.
 *
 * The failure this avoids is specific and total: a laptop user on http://127.0.0.1 handed a Secure
 * cookie gets a browser that stores it and never sends it back, so every sign-in succeeds and every
 * subsequent request is anonymous — a login loop with no error message anywhere.
 *
 * `x-forwarded-proto` is read even though it is a client-settable header, and that is safe HERE because
 * of the direction it can move the decision: a forged `https` can only ADD the attribute, i.e. make the
 * browser refuse to send its own cookie over plaintext. That is a self-inflicted denial, never an
 * escalation, and it is the only reading of a forwarded header that does not require trusting the peer.
 */
const requestIsTls = (req) => {
  if (req.socket?.encrypted) return true;
  const proto = String(req.headers?.["x-forwarded-proto"] ?? "").split(",")[0].trim().toLowerCase();
  return proto === "https";
};

const setSessionCookie = (token, { secure, maxAgeSec }) =>
  `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}${secure ? "; Secure" : ""}`;
const clearSessionCookie = ({ secure }) =>
  `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? "; Secure" : ""}`;
/** A fixed destination, never one taken from the request — see the `redirect` note in the login branch. */
const redirectToLogin = (res) => {
  res.writeHead(302, { location: "/portal/login", "cache-control": "no-store", "content-length": 0 });
  return res.end();
};

/**
 * The refusal shape the outer catch already dispatches on: `name === "AuthError"` plus an integer
 * `status` (mcp-server/lib/cf-access.mjs). A local instance's "you are not signed in" must arrive at
 * the SAME door page and the SAME JSON body a Cloudflare refusal arrives at — one refusal, one
 * behaviour, whichever identity source is running.
 *
 * Declared here rather than imported from cf-access.mjs on purpose: that module statically imports
 * `jose`, and a laptop install has no reason to load a JWT library it will never call.
 */
class LocalAuthError extends Error {
  constructor(status, message) { super(message); this.name = "AuthError"; this.status = status; }
}

/**
 * The signed-in address carried by this request's cookie, or null.
 *
 * The check against the CONFIGURED address is deliberate and is the second wall. A session is only ever
 * minted for the one local user, so a valid signature naming somebody else means either the operator
 * changed who that user is, or the token came from another install that shares the secret. In both
 * cases the right answer is "sign in again", not "resolve this name through the roster and see what it
 * gets" — which is what accepting the token's own `sub` would do.
 */
/** Whether this request carries a session cookie at all, readable or not. */
const hasSessionCookie = (req) => !!parseCookies(req.headers?.cookie)[SESSION_COOKIE];

function localSessionIdentity(req, localAuth) {
  const token = parseCookies(req.headers?.cookie)[SESSION_COOKIE];
  if (!token) return null;
  const s = verifySession({ token, secret: localAuth.secret });
  if (!s || s.email !== localAuth.email) return null;
  return { email: s.email };
}

/** The login form's body: url-encoded, small, and never JSON. 8 KiB is a passphrase with room to spare. */
async function readFormBody(req, limitBytes = 8192) {
  return await new Promise((resolve, reject) => {
    let len = 0; const chunks = [];
    req.on("data", (c) => { len += c.length; if (len > limitBytes) { reject(new Error("body_too_large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(new URLSearchParams(Buffer.concat(chunks).toString("utf8"))));
    req.on("error", reject);
  });
}

// The brief reader's model when PORTAL_READ_MODEL is unset: a TIER, like every stage's. An exact id goes to
// the program as that model — past a cloud's ANTHROPIC_DEFAULT_SONNET_MODEL — and codex maps tiers only.
export const PORTAL_READ_MODEL_DEFAULT = "sonnet";

export function makeHttpHandler({ verify, limiter, service, log = () => {}, devIdentity = null, localAuth = null, static: staticHandler = null,
  // item 1 — PASSED IN, because this handler is its own function and the bootstrap that reads
  // the environment is another. The default is the Cloudflare Access header, so a caller that does
  // not pass one behaves exactly as before. Already lowercased by the caller; lowercased again here
  // because a default is not a promise about what a future caller hands over.
  authHeader = "cf-access-jwt-assertion" }) {
  const AUTH_HEADER = String(authHeader || "cf-access-jwt-assertion").trim().toLowerCase();
  // — A HANDLER WITH NO IDENTITY SOURCE REFUSES TO EXIST.
  //
  // This used to fall back to `{ email: "dev@local" }` when both `verify` and `devIdentity` were null,
  // which meant a construction mistake did not fail: it admitted every caller under one synthetic
  // address, and (with a grants row for it, or a staff domain matching its domain) served them real
  // customer data. Nothing threw, nothing logged, and the boot line said "AUTH OFF (dev)" on a service
  // nobody had asked to run in dev.
  //
  // Same posture and almost the same sentence as mcp-server/lib/http-handler.mjs, which has refused to
  // build an unauthenticated handler since it was written. `devIdentity` survives as a constructor
  // parameter because IN-PROCESS TESTS need to inject an identity without a socket or a JWT — that is
  // an explicit ask of — but it is now a thing a caller must PASS, never a thing it can get by
  // omission.
  if (!verify && !localAuth && !devIdentity)
    throw new Error("makeHttpHandler: an identity source is required — pass `verify` (the Cloudflare Access edge), `localAuth` (the local sign-in) or `devIdentity` (an injected identity, tests only). Refusing to build a handler that would admit every caller (fail-closed).");
  // `extra` exists so a response can carry a CSP. Before this the content-type was hardcoded and there
  // was no way to attach one — which is why the portal shipped without a policy rather than with a
  // permissive one.
  // ── EVERY JSON RESPONSE SAYS HOW IT MAY BE CACHED, because leaving it unsaid is the defect ────────
  //
  // This writer used to send `content-type` and `content-length` and nothing else — no `Cache-Control`,
  // no `Vary`, no validator — so what a browser did with a signed-in response carrying another
  // company's material was the browser's decision and not ours. With no `Last-Modified` to work from a
  // heuristic cache may well store nothing; the defect is not a demonstrated leak, it is that the answer
  // was never stated for a response behind a session.
  //
  // THE ARGUMENT WAS ALREADY MADE HERE, FOR ONE ROUTE. `/portal/api/connect-key` has always set
  // `no-store` because "a credential sitting in a proxy or a disk cache is the 'outlives the moment'
  // failure ... arriving by a route the page cannot see". An access list is not a credential and has the
  // same property, so the rule belongs to the class rather than to the one response that carried a
  // token.
  //
  // `Vary: Accept` IS NOT ABOUT PRIVACY. `/portal/admin/*` is one address served two ways: the app
  // fetches JSON there, and a browser navigation gets the app document instead (portal-static.mjs
  // decides on `Accept`, above this router). Nothing told a cache those were different responses, so a
  // stored JSON body could answer a later navigation and render raw data in a window — with this server
  // never asked, which is why the negotiation above could not save it.
  //
  // A ROUTE'S OWN HEADERS STILL WIN. `extra` is spread last, so connect-key keeps its stricter set
  // (`no-cache, must-revalidate, private` and the HTTP/1.0 `pragma`) rather than being flattened to this
  // default. The arm below pins that, because a default that quietly relaxed a stricter route would be
  // this change making things worse while reading as an improvement.
  const send = (res, status, obj, extra = {}) => {
    const b = JSON.stringify(obj);
    res.writeHead(status, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(b),
      "cache-control": "no-store",
      "vary": "accept",
      ...extra,
    });
    res.end(b);
  };
  return async function handler(req, res) {
    // — THE REFUSALS THIS FUNCTION DECIDES ITSELF, which until now were the silent ones.
    //
    // Identity is resolved HERE, before service.route() is ever called, so a request that fails the
    // door never reached the sink inside the service. That is the bug report's own measurement: an
    // unauthenticated POST to /portal/admin/retired answered 401 while the journal stayed at 300 lines.
    // The service hands its sink out with its router precisely so this door can file into the same log.
    //
    // PATHNAME ONLY. `req.url` carries the query string and this row must not; parsed defensively
    // because the outer catch can run before `url` was successfully built.
    const pathOnly = (u) => { try { return new URL(String(u ?? ""), "http://localhost").pathname; } catch { return ""; } };
    // SAME SCOPE AS THE ROUTER'S (the Out of scope). Without this the door files a row for every
    // 302 to the login page and every rate-limited poll of /portal/api/runs — which is per-request
    // access logging arriving through the other entrance, and the first cut of this change did exactly
    // that. Computed once so a redirect and a 500 on the same request cannot disagree about it.
    const auditedPath = isAdminWrite(req.method, pathOnly(req.url));
    // `?.` — a service built by something other than makePortalService has no sink, and a journal that
    // is not there must never turn a 401 into a 500. Wrapped because the sink is best-effort by
    // contract (it appends to a file): the refusal is the answer, the row is the record of it.
    const journal = (status, reason, email = null) => {
      if (!auditedPath) return;
      try {
        service?.audit?.(outcomeRow({ method: req.method, path: pathOnly(req.url), status, email, reason }));
      } catch { /* best-effort, exactly like the sink itself */ }
    };
    // Hoisted out of the try so the 500 row below can name the actor. A crash on an admin write with no
    // "who" is a row that raises a question it cannot answer.
    let identity = null;
    try {
      const url = new URL(req.url, "http://localhost");
      if (req.method === "GET" && url.pathname === "/portal/health") {
        // — WHICH BUILD IS ANSWERING. Before this, confirming that a merge had reached test was
        // done by inference — merge ancestry plus the deploy timer's schedule — because no account
        // outside the pool's group could read a run's meta.json, and nothing served the commit. An
        // inferred deploy confirmation is the same shape as an unread absence: it is right until the
        // timer skips a beat, and nothing says which time you are looking at.
        //
        // `engineCommit()` is imported, not re-derived. It is the exact function publish/index.mjs
        // stamps into pool meta.json, so this endpoint and a new round's meta cannot disagree —
        // recomputing it here would build the drift the issue is about. Null off a git checkout, and
        // that is a real answer rather than a failure: a provenance stamp never breaks a health probe.
        //
        // ──: HOW OLD, WHICH LINE, AND WHICH BOX ──────────────────────────────────────────────
        //
        // The sha alone made every instance look alike. Production answering `ok:true` on a release 101
        // commits behind main is CORRECT — prod ships when the owner asks — and it reads identically to
        // a deploy that stopped. A reader had to already know to check ancestry, which is the check a
        // green tick talks people out of running.
        //
        // `engineCommitAt` is the number that cannot be misread, and it is deliberately NOT the
        // distance from `main` the issue suggested — see engine-build.mjs, where the measurement that
        // ruled that out is written down.
        //
        // `engineState` rides beside `engineBranch` because the branch alone collapses two states: a
        // pinned release runs detached and reports a null branch, and so does a probe that could not
        // reach git at all. Carrying the value without its discriminator is this repo's most expensive
        // recurring defect; `clean`/`dirty`/`blocked` is what separates them, and `dirty` additionally
        // catches the hand-patched checkout the deploy skill warns about.
        //
        // `box` is the EXISTING `CLEAROTRON_BOX` name (governance §5.1), not a new one — the deployment
        // already declares itself for `live-surface-check`'s unit inventory, and a second identity
        // would be a second thing to set and to get wrong. Imported rather than re-derived, and read
        // at request time rather than captured at module scope: portal-service sits outside
        // CLI_ENTRIES and applies the alias translation in its own body, so an import-time capture
        // freezes a pre-translation environment.
        //
        // Null when unset or unrecognised, which is an absence and reads as one. No inference from the
        // account or the path: a guessed box is worse than an unknown one, because it answers wrongly
        // instead of leaving the question open.
        // ── IS THE BUNDLE THE ONE ITS SOURCES WOULD BUILD? ──────────────────────────────────────────
        //
        // `ui` had two states, present and absent, and no third for *present and older than the sources
        // it was built from*. On the source route `git pull` can never update `portal-ui/dist` — it is
        // not tracked — so a pull that changes `portal-ui/src` leaves the built bundle behind, the
        // portal serves the previous screen, and this endpoint answered `built`, `ok: true` over the
        // exact tree `clearotron doctor` refuses at rc 1. The operator ran the documented upgrade, it
        // exited 0, nothing warned, and both surfaces they could check disagreed without saying so.
        //
        // The verdict comes from the SAME predicate doctor uses, so the two cannot drift apart again.
        // `present()` is still the service's own answer to the presence half and is passed in rather
        // than recomputed, so this cannot disagree with what /portal actually serves.
        const bundle = staticHandler ? healthUi(bundleFreshnessCached(staticHandler.present())) : { ui: "unwired", ok: true };
        return send(res, 200, {
          ok: bundle.ok,
          ui: bundle.ui,
          box: deploymentBox(),
          engineCommit: engineCommit(),
          engineCommitAt: engineCommitDate(),
          engineBranch: engineProvenance().engineBranch,
          engineState: engineProvenance().outcome,
          store: doctrineStore(),
        });
      }

      // ── A STATE CHANGE FROM ANOTHER SITE IS REFUSED BEFORE ANYTHING ELSE LOOKS AT IT ────────────────
      //
      // Before identity, so the sign-in and sign-out forms are covered as well as the API: a page elsewhere
      // that signs a browser in to an account of its choosing is the same attack as one that acts under the
      // browser's own session. The rule and why it compares hosts is in portal-request-origin.mjs.
      const crossSite = crossSiteReason(req);
      if (crossSite) {
        log(`refused a ${req.method} to ${url.pathname} from another site: ${crossSite}`);
        journal(403, "cross-site request");
        return send(res, 403, { error: "cross_site" });
      }

      // ──: THE LOCAL SIGN-IN DOOR — before identity, because it is how identity is obtained ─────
      //
      // Mounted only when the local identity provider is running. On a Cloudflare-fronted instance
      // `localAuth` is null, these paths are answered by nothing here, and the edge is still the only
      // way in — this branch cannot become a second door on a deployment that did not ask for one.
      // ── THE FRONTED HALF OF THE SAME ROUTE ( — F47) ────────────────────────
      //
      // With no local provider the session belongs to Cloudflare Access and its endpoint is the only
      // thing that can end it, so this hands the browser there. Emitters link to ONE path in both modes
      // and none has to know which it is running in — three of them assumed fronted, which is the bug.
      //
      // WRITTEN INLINE, and that is not laziness. The `redirect` helper below is declared INSIDE the
      // local-auth block, so calling it from here threw ReferenceError and this route answered 500 —
      // worse than the dead link it replaced, because a dead link looks like a dead link and a 500
      // looks like the server broke. Found by `npm run lint:driver`, which says it in one line
      // (`'redirect' is not defined`), and by driving the route rather than reading it (review, 2026-08).
      // Hoisting that helper would move it away from the comment explaining its own no-`?next=` rule,
      // so the four lines live here instead.
      if (!localAuth && url.pathname === "/portal/sign-out") {
        res.writeHead(302, { location: "/cdn-cgi/access/logout", "cache-control": "no-store", "content-length": 0 });
        return res.end();
      }

      if (localAuth && (url.pathname === "/portal/login" || url.pathname === "/portal/logout" || url.pathname === "/portal/sign-out")) {
        const secure = requestIsTls(req);
        const page = (status, body, extra = {}) => {
          res.writeHead(status, {
            "content-type": "text/html; charset=utf-8", "content-length": Buffer.byteLength(body),
            "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra,
          });
          return res.end(body);
        };
        // NO `?next=` PARAMETER, ever. A post-login destination taken from the request is the
        // open-redirect class in its entirety, and there is exactly one place to land here.
        const redirect = (to, extra = {}) => {
          res.writeHead(302, { location: to, "cache-control": "no-store", "content-length": 0, ...extra });
          return res.end();
        };
        // A SESSION COOKIE THIS PORTAL CANNOT READ IS CLEARED, AND SAID. Cookies ignore ports, so a browser
        // that visited another Clearotron on this address (an earlier demo, another instance) brings that
        // cookie here, where it verifies as nothing. Cleared, the next sign-in starts clean; and the page
        // says an old session was set aside, rather than leave a person to guess what changed.
        const who = localSessionIdentity(req, localAuth);
        const stale = !who && hasSessionCookie(req);
        const setAside = stale ? { "set-cookie": clearSessionCookie({ secure }) } : {};
        if (url.pathname === "/portal/login" && req.method === "GET")
          return page(200, loginPage({ email: localAuth.email, resetCommand: localAuth.resetCommand, signedIn: !!who, discarded: stale }), setAside);
        if (url.pathname === "/portal/login" && req.method === "POST") {
          // Keyed on the peer address, counted by localAuth.attempts (portal-local-auth.mjs:
          // makeAttemptLimiter — a fixed window, NOT the 120/min token bucket the API routes share).
          // On a loopback install every attempt keys to 127.0.0.1, so the window is global; that is the
          // right answer for one user on one machine and is written down in the limiter's own comment.
          if (!localAuth.attempts.take(req.socket?.remoteAddress ?? "unknown"))
            return page(429, loginPage({ email: localAuth.email, resetCommand: localAuth.resetCommand, error: "Too many attempts. Wait a few minutes and try again." }));
          let form;
          // A form that could not be read says nothing about the passphrase, so it is not answered as one.
          try { form = await readFormBody(req); } catch { return page(400, loginPage({ email: localAuth.email, resetCommand: localAuth.resetCommand, error: "The sign-in form could not be read. Reload this page and try again." }), setAside); }
          let record;
          try {
            record = localAuth.credential();
          } catch (e) {
            // A credential file that has gone corrupt since boot. The operator gets the reason on
            // stderr; the browser gets a sentence with no filesystem in it.
            log(`local sign-in unavailable: ${String(e?.message ?? e)}`);
            return page(500, loginPage({ email: localAuth.email, resetCommand: localAuth.resetCommand, error: "Sign-in is not available. The terminal that started the portal says why." }));
          }
          // A REFUSAL FOR ANY REASON BUT THE PASSPHRASE SAYS ITS REASON. "That passphrase is not correct."
          // sent a person to reset a passphrase that was never wrong. An install with no credential has no
          // passphrase to be right or wrong about, so saying so gives a caller nothing to guess against.
          if (!record) {
            log("local sign-in attempted but no credential is configured — stop the portal and start it again to mint one");
            return page(401, loginPage({ email: localAuth.email, resetCommand: localAuth.resetCommand, error: "No passphrase is set for this install yet. Stop the portal and start it again to create one." }), setAside);
          }
          // ONE SENTENCE FOR A WRONG PASSPHRASE, and nothing more specific: which half of a credential was
          // right is exactly what an unauthenticated caller must not learn.
          if (!checkPassphrase(record, form.get("passphrase") ?? ""))
            return page(401, loginPage({ email: localAuth.email, resetCommand: localAuth.resetCommand, error: WRONG_PASSPHRASE }), setAside);
          const token = mintSession({ email: localAuth.email, secret: localAuth.secret, ttlSec: localAuth.ttlSec });
          return redirect("/portal", { "set-cookie": setSessionCookie(token, { secure, maxAgeSec: localAuth.ttlSec }) });
        }
        if (url.pathname === "/portal/logout" && req.method === "POST")
          return redirect("/portal/login", { "set-cookie": clearSessionCookie({ secure }) });
        // ── SIGN-OUT, RESOLVED PER MODE, IN ONE PLACE ( — F47) ────────────
        //
        // Three emitters linked unconditionally to /cdn-cgi/access/logout — two screens and this
        // service's own error page. That is Cloudflare's endpoint and it is correct on a fronted
        // deployment; on LOCAL sign-in, which is what `clearotron start` gives every fresh install,
        // there is no Cloudflare and the browser got `{"error":"not_found"}` as a raw JSON blob. So on
        // every fresh install you could sign in and could not sign out — and on a shared or borrowed
        // machine ending your session is the one control a person expects to work.
        //
        // A GET, because the emitters are links a browser follows. It ends the LOCAL session, which is
        // the session that actually exists in this mode; the fronted branch below never reaches here.
        if (url.pathname === "/portal/sign-out")
          return redirect("/portal/login", { "set-cookie": clearSessionCookie({ secure }) });
        return send(res, 404, { error: "not_found" });
      }

      if (verify) {
        identity = await verify(req.headers[AUTH_HEADER]);
      } else if (localAuth) {
        identity = localSessionIdentity(req, localAuth);
        if (!identity) {
          // A BROWSER gets the door it can use; everything else gets the refusal it can parse. The same
          // Accept-based rule the AuthError branch below already applies, moved one step earlier so a
          // person who typed the address lands on the form rather than on a page ABOUT the form.
          // Journaled as well as the throw below: a browser is bounced to the form with a 302 and never
          // raises an AuthError, so this is the SAME refusal as the 401 and would otherwise be the one
          // shape of it that still left no line.
          if (String(req.headers.accept ?? "").includes("text/html")) {
            journal(302, "not signed in");
            return redirectToLogin(res);
          }
          // Identical in shape and status to what the CF edge throws for a missing JWT, so the SPA's
          // fetches and every API client see one refusal regardless of which door the instance runs.
          throw new LocalAuthError(401, "not signed in");
        }
      } else {
        identity = devIdentity;
      }

      // The SPA document and its assets are served here — after identity, BEFORE the limiter. They are
      // static, identical for everyone and cheap; the limiter exists to bound run triggering and status
      // polling. Sharing one 120/min budget between polling and page assets means a reload during an
      // active run can 429 a JS chunk, and a 429 on a chunk does not surface as an error — it surfaces
      // as a half-mounted app.
      if (staticHandler && staticHandler(req, res, url.pathname)) return;

      if (limiter && !limiter.take(identity.email)) {
        journal(429, "rate_limited", identity?.email);
        return send(res, 429, { error: "rate_limited" });
      }
      // A BODY THAT DOES NOT SAY IT IS JSON IS NOT READ AS JSON. A form post is the one body another site
      // can send without asking first; the portal's own pages always declare JSON when they send a body.
      if (bodyNotJson(req)) {
        journal(415, "body is not JSON", identity?.email);
        return send(res, 415, { error: "unsupported_media_type" });
      }
      // A FIXED reason, not `e.message`. The parser's message is about the bytes it was given, and this
      // row must not become a place a caller can write into by sending a body that fails to parse.
      let body;
      try { body = await readJsonBody(req); }
      catch { journal(400, "unreadable body", identity?.email); return send(res, 400, { error: "unreadable body" }); }   // the parser's own message describes the bytes it was sent, and a response is not where a parse error is read back
      const query = Object.fromEntries(url.searchParams.entries());
      const r = await service.route(req.method, url.pathname, identity, body, query);
      // A PLAIN DOCUMENT this server renders itself. Escaped into a `<pre>`, so nothing in the file can
      // become markup — the document is a tracked repository file today, and "it is ours" is exactly the
      // assumption that makes an escaping bug permanent.
      if (r.doc != null) {
        const esc = String(r.doc).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
        const body = `<!doctype html><meta charset="utf-8"><title>Set it up by hand</title>`
          + `<style>body{margin:0;padding:28px;font:14px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;`
          + `background:#fff;color:#111}pre{white-space:pre-wrap;word-wrap:break-word;margin:0}`
          + `@media(prefers-color-scheme:dark){body{background:#111;color:#eee}}</style><pre>${esc}</pre>`;
        res.writeHead(r.status, {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": docCsp(),
          "content-length": Buffer.byteLength(body),
          "x-content-type-options": "nosniff",
        });
        return res.end(body);
      }
      if (r.html != null) {
        // Reports only. A delivered report needs its own policy: `frame-ancestors 'self'` (the Result
        // screen embeds it) and inline script/style (the frozen renderer emits a self-contained file).
        // The SPA's stricter policy would make the browser refuse to frame it at all.
        res.writeHead(r.status, {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": reportCsp(),
          "x-content-type-options": "nosniff",
        });
        return res.end(r.html);
      }
      // A FILE. The audit workbook is the only one, and it needs a third response shape because the two
      // above are both text: JSON.stringify on a Buffer produces `{"type":"Buffer","data":[...]}`, which
      // downloads as a corrupt spreadsheet rather than failing loudly.
      //
      // `content-disposition: attachment` with a server-chosen filename, and nosniff, so nothing here is
      // ever rendered in the browser as a document — the name comes from the run's own metadata, never
      // from the request.
      if (r.file != null) {
        res.writeHead(r.status, {
          "content-type": r.file.contentType,
          "content-disposition": `attachment; filename="${r.file.filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
          "content-length": r.file.body.length,
          "x-content-type-options": "nosniff",
        });
        return res.end(r.file.body);
      }
      // `r.headers` exists for ONE reason: a response carrying a credential must not be cached.
      // Without it the only way to say `no-store` was to add a fourth response shape.
      return send(res, r.status, r.json, r.headers ?? {});
    } catch (e) {
      if (e && e.name === "AuthError" && Number.isInteger(e.status)) {
        // THE ROW THE ISSUE WAS FILED ABOUT. Both doors throw this shape — the Cloudflare edge's verify
        // and the local sign-in's LocalAuthError — so one line here covers a refused write on either
        // deployment. Before the Accept split below, because a refusal is one event however it renders.
        // A FIXED VOCABULARY, NEVER `e.message` (the third criterion: "a refusal must not become a
        // new disclosure surface"). This message comes out of `verify()` — the Cloudflare edge's JWT
        // check, a third-party library on some deployments — and nothing constrains what it puts in
        // there: a claim value, a subject, a fragment of the token it just rejected. The row is read
        // back by /portal/admin/observed, so free text from an auth library would be republished to
        // every member of staff. The status is the fact worth keeping and it is already a closed set.
        if (!alreadyFiled(e)) journal(e.status, DENIAL_REASON[e.status] ?? "refused at the door", identity?.email);
        // A BROWSER gets a page it can act on; an API client keeps the JSON it can parse. Deciding by
        // Accept rather than by path means the SPA's own fetches still see a clean error shape while the
        // person who typed the address gets a door.
        const wantsHtml = String(req.headers.accept ?? "").includes("text/html");
        if (wantsHtml) {
          const html = denialPage(e.status, refusalWords(e.status));
          res.writeHead(e.status, { "content-type": "text/html; charset=utf-8", "content-length": Buffer.byteLength(html), "x-content-type-options": "nosniff" });
          return res.end(html);
        }
        return send(res, e.status, { error: refusalWords(e.status) });
      }
      log(`500 ${String(e?.message || e)}`);
      if (!alreadyFiled(e)) journal(500, e?.message ?? String(e), identity?.email);
      return send(res, 500, { error: "internal" });
    }
  };
}

const isMain = isEntrypoint(import.meta.url);
if (isMain) {
  // — TRANSLATE THE ENV NAMES BEFORE ANY VALUE IS READ, and this is NOT `env-local`.
  //
  // THE PRODUCTION EDGE THIS CLOSES: this service reads env names directly. INSTALL.md documents the
  // CLEAROTRON_* rename, so an operator who follows it renames the values in their unit and the portal
  // stops seeing ANY of them — and the mandatory-roster guard then refuses to start. Fail-closed,
  // correctly, on a machine that was configured correctly. Measured on the test box: the portal died on
  // exactly this. The reads this file OWNS now go through `envFrom`, which resolves either spelling on
  // its own; this pass stays because it covers the names read elsewhere, by modules this one calls.
  //
  // — AND THE CALL THAT USED TO SIT HERE FIXED THE FACT BUT NOT THE WHEN. It has moved to a
  // side-effecting `import "../shared/env-local.mjs"` at the TOP of this file. The reasoning it carried
  // is kept, because it was right about the ruling and wrong about only one thing:
  //
  //   It argued `applyEnvAliases` AND NOT `import "../shared/env-local.mjs"`, on the ground that
  //   "`env-local` READS `<repo>/.env`" and this service is deliberately off CLI_ENTRIES — "every value
  //   arrives named" — so a dotfile read would reverse that ruling.
  //
  // THE RULING IS RIGHT AND IS UNCHANGED. The premise is not: `env-local` reads `<repo>/.env` only when
  // `isCliEntry(process.argv[1])` says the running entry is on CLI_ENTRIES, while the
  // `applyEnvAliases()` at the bottom of that module is UNCONDITIONAL. This service is not on that list,
  // so importing it buys the translation and no dotfile. Measured, with the gate shown able to say yes:
  // a `.env` present and readable, `loaded → null`, `isCliEntry(driver/runner.mjs) → true`,
  // `isCliEntry(this entry) → false`, and the dotfile value never reaching a read.
  //
  // WHY THE POSITION MATTERED. A body call runs after every static import has already been evaluated,
  // and this service statically reaches `driver.config.mjs` (which captures `REGISTER_PROVIDER` at
  // module top) and `profiles.mjs` (which captures the store directory). On a host configured with the
  // new names only, both captures ran before the translation: `REGISTER_PROVIDER` was null — which makes
  // a run refuse by name — and the profile store fell back to the bundled default. The fact was fixed
  // and the ordering was not, so the same production edge described above stayed open.
  //
  // DO NOT PUT THIS SERVICE ON CLI_ENTRIES to "make the import consistent". That is the change the
  // paragraph above refuses, and env-local-does-not-read-a-dotfile-here.test.mjs fails if it happens.
  const HERE = dirname(fileURLToPath(import.meta.url));
  const log = (...a) => process.stderr.write(`[portal-service] ${a.join(" ")}\n`);
  // — resolved through the shared helper so the SOURCE travels with the number. "18802" and
// "18802 because nobody said otherwise" are different addresses to an operator, and only the
// second one is a guess at which instance this is.
const PORT_CHOICE = resolvePort({ value: process.env.PORTAL_SERVICE_PORT, name: "PORTAL_SERVICE_PORT", fallback: PORTAL_PORT_DEFAULT });
const PORT = PORT_CHOICE.port;
  const HOST = process.env.PORTAL_SERVICE_HOST || "127.0.0.1";
  // ──: THE IDENTITY SOURCE IS A MODE, AND IT IS NAMED, NOT INFERRED ─────────────────────────
  //
  // Two modes, both of which PROVE who the caller is:
  //
  //   cf-access (the default)  the Cloudflare Access edge — every hosted deployment, unchanged.
  //   local                    one address, one passphrase, a signed session cookie — one person on
  //                            one machine, which is the whole of what  asks for.
  //
  // There is no third mode and there is no longer a bypass. `PORTAL_AUTH_DISABLED` / `PORTAL_DEV` /
  // `PORTAL_DEV_EMAIL` are DELETED: they did not authenticate anybody, they skipped the question and
  // handed every caller one synthetic address, and they existed because there was no way for a single
  // person to log in. There is now.
  //
  // ── WHY LOCAL MODE MUST BE ASKED FOR BY NAME ─────────────────────────────────────────────────────
  //
  // The tempting rule is "no CF variables and a loopback host ⇒ local". It is rejected, on two measured
  // facts:
  //
  //   1. LOOPBACK DOES NOT DISCRIMINATE A LAPTOP FROM PRODUCTION. The test box and the production
  //      portal both bind 127.0.0.1 and are reached through a Cloudflare tunnel. `PORTAL_SERVICE_HOST`
  //      is unset on both, so it defaults to 127.0.0.1 on both. A rule keyed on loopback would be
  //      keyed on something every real deployment also satisfies.
  //   2. IT WOULD CONVERT A FAIL-CLOSED REFUSAL INTO A SILENT DOWNGRADE. Today a deployment that loses
  //      CF_ACCESS_TEAM or CLEAROTRON_OIDC_AUDIENCE REFUSES TO START and says so. Under the inferred rule the same
  //      accident starts a portal in local mode instead — reachable through the tunnel with a
  //      passphrase nobody has ever seen printed, and looking healthy. A missing value must never be
  //      able to choose a mode.
  //
  // So: unset means cf-access, exactly as before, including every fail-closed exit below. Local mode is
  // one explicit word, and an unrecognised word is fatal rather than quietly treated as the default.
  //
  // item 1 — `cf-access` NORMALISES TO `auth-proxy` HERE, at the read, and not as an alias row.
  // `shared/env-aliases.mjs` maps variable NAMES; `currentName`/`spellingsOf` are name-keyed and there is
  // no value-alias mechanism to reach for. The old word keeps working forever and means the same thing —
  // production deliberately leaves the variable unset, so no box changes on this rename.
  const AUTH_MODE_SET = (process.env.PORTAL_AUTH_MODE || "").trim().toLowerCase();
  const AUTH_MODE = AUTH_MODE_SET === "cf-access" ? "auth-proxy" : AUTH_MODE_SET;
  const LOCAL_MODE = AUTH_MODE === "local";
  const TEAM = process.env.CF_ACCESS_TEAM || "";
  // — F54. A deployment runs one Access application per audience; jose has
  // always accepted a list. `accessAudience` keeps a STRING for 0 or 1 so the `!AUD` guard below
  // stays fail-closed — an empty array would be truthy and open it.
  const AUD = accessAudience(envFrom(process.env, "CLEAROTRON_OIDC_AUDIENCE"));
  // item 1 — THE SAME FOUR VALUES THE STAFF MCP FACE ALREADY READS, under portal-side names
  // (OIDC_ISSUER declared in http-server.mjs, and the three read beside it). `makeAccessVerifier` has
  // always accepted them; the portal simply
  // never passed them, which is how one product shipped a provider-agnostic API face and a
  // Cloudflare-only web portal. Unset ⇒ the CF Access shapes derived from CF_ACCESS_TEAM, exactly as
  // before.
  const OIDC_ISSUER = process.env.PORTAL_OIDC_ISSUER || "";
  const JWKS_URL = process.env.PORTAL_JWKS_URL || "";
  const EMAIL_CLAIM = process.env.PORTAL_EMAIL_CLAIM || "email";
  // LOWERCASED, and this is load-bearing rather than tidy: Node lowercases incoming header names, so a
  // configured `Cf-Access-Jwt-Assertion` read verbatim yields `undefined` on every request and refuses
  // every correctly authenticated user — a blanket 401 with a valid token in hand. The MCP face already
  // does this (`:95`); a test covers it.
  const AUTH_HEADER = (process.env.PORTAL_AUTH_HEADER || "cf-access-jwt-assertion").trim().toLowerCase();
  // NO example.com default (review 2026-07-18 — the MCP face deliberately removed it: a forgotten env
  // silently denies every real identity at the edge while looking configured). Auth ON requires the
  // explicit domain list, which for THIS portal must include the CLIENT domains too (edge admission)
  // — enrolment is two-sided: the CF edge list AND the grants file (docs/PORTAL.md).
  const DOMAINS = (process.env.MCP_ALLOWED_EMAIL_DOMAINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  // Individually named addresses, for people whose email domain cannot be admitted wholesale.
  const EMAILS = (process.env.MCP_ALLOWED_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

  let verify = null;
  const LOCAL_USER = (process.env.PORTAL_LOCAL_USER || "").trim().toLowerCase();
  if (LOCAL_MODE) {
    // Validated here, before anything else is read, so the mode's own mistakes are the first thing the
    // operator sees. The credential itself is established further down, AFTER the secret and the roster
    // guards — a boot that is going to refuse for a missing grants file must not write a passphrase
    // first and tell somebody to keep it.
    if (!LOCAL_USER) {
      log("FATAL: PORTAL_AUTH_MODE=local names no user — set PORTAL_LOCAL_USER to the one email address that signs in here, and give that same address an entry in the grants file (" + "CLEAROTRON_ACCESS_FILE" + "). Refusing to start.");
      process.exit(1);
    }
    if (!LOCAL_USER.includes("@") || LOCAL_USER.indexOf("@") !== LOCAL_USER.lastIndexOf("@")) {
      log(`FATAL: PORTAL_LOCAL_USER="${LOCAL_USER}" is not a single email address — portal-access.mjs refuses a multi-@ identity outright, so this would sign in and then be denied at the door. Refusing to start.`);
      process.exit(1);
    }
    // LOOPBACK ONLY, and this one IS fatal rather than a warning. Local mode carries a passphrase in a
    // form POST and a session in a cookie; off loopback, without TLS, both are on the wire in clear, and
    // the cookie cannot even be marked Secure because the browser would then stop sending it. The
    // remedy is not a wider bind — it is to keep this on loopback and put a TLS-terminating proxy in
    // front of it, which is also what every Cloudflare-fronted instance already does.
    if (!LOOPBACK.has(HOST)) {
      log(`FATAL: PORTAL_AUTH_MODE=local with PORTAL_SERVICE_HOST=${HOST} would carry a passphrase and a session cookie over plaintext to another machine. Bind loopback and put a TLS-terminating proxy in front if it must be reachable. Refusing to start.`);
      process.exit(1);
    }
    log(`auth ON — local sign-in, one user (${LOCAL_USER}), loopback only`);
  } else if (AUTH_MODE && AUTH_MODE !== "auth-proxy") {
    // An unrecognised mode is FATAL, never a silent fall-through to the default. A typo
    // ("PORTAL_AUTH_MODE=Local " is fine — trimmed and lowercased above; "loca1" is not) must not be
    // able to select an identity source nobody chose.
    log(`FATAL: PORTAL_AUTH_MODE="${AUTH_MODE_SET}" is not a mode this service has. Use "local" (one passphrase, loopback) or "auth-proxy" (any login system in front that authenticates in the browser and forwards a verifiable JWT — Cloudflare Access is one instance of this, and "cf-access" is still accepted and means the same thing; also the default when unset). Refusing to start.`);
    process.exit(1);
  } else if ((!TEAM && !OIDC_ISSUER) || !AUD) {
    // item 1 — an audience, plus EITHER a Cloudflare team OR an issuer. A deployment with an Entra
    // issuer and no Cloudflare team could not start at all before this; missing BOTH is still fatal, and
    // that is the half that must not soften.
    log(`FATAL: auth enabled but CLEAROTRON_OIDC_AUDIENCE plus CF_ACCESS_TEAM or PORTAL_OIDC_ISSUER are missing — refusing to start (fail-closed).`); process.exit(1);
  } else if (!DOMAINS.length && !EMAILS.length) {
    log("FATAL: auth enabled but neither MCP_ALLOWED_EMAIL_DOMAINS nor MCP_ALLOWED_EMAILS is set — no default (fail-closed)."); process.exit(1);
  } else {
    const { makeAccessVerifier } = await import("../mcp-server/lib/cf-access.mjs");
    // BOTH gates, because this portal's population is two different shapes.
    //
    // Staff arrive on ONE corporate domain, so a domain rule is right for them. Clients arrive on
    // whatever address their business uses — and increasingly on consumer domains. Admitting a whole
    // consumer domain at the edge to enrol one person would put every gmail.com address on Earth
    // through the door, leaving the grants file as the only thing between them and a 403. That is one
    // wall where there should be two, so individual addresses are named instead.
    // UNION, not intersection. The default combines the two lists with AND — correct for narrowing
    // within one domain, and catastrophic here: staff would fail the email list while clients failed the
    // domain list, refusing everyone. That is not hypothetical; it happened in production and locked out
    // every identity including the one the domain rule exists for.
    // AND THE PEOPLE ADDED SINCE THIS LINE RAN. The two lists above are the environment's, read once —
    // they mirror a sign-in configuration that lives off this box, and they are the fail-closed floor.
    // The guest list is this deployment's own, written by the People page, and it is asked at verify
    // time so somebody added on the page can sign in without a restart. It can only ADD.
    verify = makeAccessVerifier({ team: TEAM, aud: AUD, allowedDomains: DOMAINS, allowedEmails: EMAILS, identityMode: "union",
      allowedNow: () => addressesInGrants(),
      issuer: OIDC_ISSUER || undefined, jwksUrl: JWKS_URL || undefined, emailClaim: EMAIL_CLAIM });
    // THE BANNER NAMES THE HEADER AND THE CLAIM, because a mis-set header is otherwise indistinguishable
    // from a blanket 401 — the operator reads it here instead of discovering it as "nobody can log in".
    log(`auth ON — issuer=${OIDC_ISSUER || `CF Access team=${TEAM}`} aud=${audienceLabel(AUD)} claim=${EMAIL_CLAIM} header=${AUTH_HEADER} domains=[${DOMAINS.join(", ")}] emails=[${EMAILS.length}]`);
  }

  // — THE `dev-secret-not-for-prod` FALLBACK IS DELETED. A shipped default signing key is the
  // exact shape this issue exists to remove: it turned a missing required value into a working service
  // signing with a secret that is in the source tree, and the only thing standing between that and
  // production was one environment variable being read correctly. It is required in both modes now, and
  // it signs BOTH token families — the confirmation tokens (unprefixed) and, since, the local
  // session cookies (prefixed with `portal-session.v1|`; see portal-local-auth.mjs for why one secret
  // with a domain separator is preferred to two secrets).
  const secret = process.env.PORTAL_SECRET || "";
  if (!secret) { log("FATAL: PORTAL_SECRET is required (it signs the confirmation tokens and, in local mode, the session cookie) — refusing to start."); process.exit(1); }
  const { loadGrants } = await import("../shared/scope.mjs");
  // ── the roster is MANDATORY ────────────────────────────────────────────────────────────────────
  //
  // Mirrors the guard on the MCP face (mcp-server/http-server.mjs, the CLEAROTRON_ACCESS_FILE check in the
  // auth-disabled branch), for the same reason and with the same fail-closed posture — but WIDER, and
  // the difference is the point.
  //
  // shared/scope.mjs, first line of accountsForEmail: `if (!grants) return "*"`. With CLEAROTRON_ACCESS_FILE
  // unset, that flat view answers "every customer" for every identity. The portal no longer reads it that
  // way — `makePrincipal` resolves nobody without a grants file — but other readers of the same function
  // did, and a portal running with no file would be an install nobody can enter and nothing explains.
  // Before the access model this was a silent read-all across the whole book of business, and the guard
  // is kept for the reason it was written: the absence of the one file that decides must stop the start.
  //
  // UNCONDITIONAL, unlike the MCP's. There the guard sits inside the auth-disabled branch, because with
  // auth ON a caller has proven a firm email domain and read-all is what firm staff are supposed to
  // have. That reasoning does not transfer: this portal admits CLIENTS at the edge on purpose
  // (MCP_ALLOWED_EMAILS names individual customer addresses — see the DOMAINS/EMAILS union above), so
  // "auth is ON" says nothing whatever about whether the caller may see everything. In both modes the
  // grants file is the only thing that decides, so in both modes it is required.
  //
  // An empty roster is a legitimate answer: a file containing only {"tenants":{}} admits nobody yet, which
  // is where a fresh instance starts before setup writes its first person. What is not
  // legitimate is having no file, because that is indistinguishable from "not configured yet" and means
  // the opposite of what it looks like.
  if (!envFrom(process.env, "CLEAROTRON_ACCESS_FILE")) {
    // — THE REFUSAL NAMES THE CURRENT SPELLING. The lookup is fine and that was verified rather
    // than assumed: `shared/env-local.mjs` runs `applyEnvAliases()` at module load, so a reader who set
    // the current name has it back-filled onto the retired key before this line runs. What was wrong is
    // that the refusal quoted the RETIRED name whichever one they set — sending an operator to a
    // variable they never touched, at the one moment the service refuses to start.
    log(`FATAL: CLEAROTRON_ACCESS_FILE is unset — refusing to start (fail-closed). Without it shared/scope.mjs accountsForEmail() returns "*" for every identity, so any admitted client reads EVERY customer's runs, reports and configuration, silently. Point it at a grants file, even one containing only {"tenants":{}}.`);
    process.exit(1);
  }
  // per-REQUEST loader (review 2026-07-18): enrolment lands without a restart; an unreadable grants
  // file at boot is FATAL, and one that turns unreadable later is a hard 500 per request (loadGrants
  // throws when set-but-unreadable), never a silent fallback.
  try { loadGrants({}); } catch (e) { log(`FATAL: grants file unreadable: ${e.message}`); process.exit(1); }
  const grants = () => loadGrants({});
  // How the People page and company creation write the grants file: atomically, so the per-request
  // reader sees the old file or the new one and never half of either.
  const writeGrants = async (g) => {
    const { atomicWrite } = await import("./progress.mjs");
    atomicWrite(envFrom(process.env, "CLEAROTRON_ACCESS_FILE"), `${JSON.stringify(g, null, 2)}\n`);
  };

  // Revoking a removed person's connector keys, from the same module `clearotron disconnect` revokes
  // through — one author for what revoking means, and one place the ordering rule lives: the id reaches
  // the denylist before its record is struck, because a record removed first leaves a live key with no
  // trace it ever existed.
  //
  // IT NEVER NAMES THE LIST IN `.env`. `applyDisablePlan` will do that when a plan is `lateArm` — the
  // door was started without a revocation list, so the running process never loaded one — and that step
  // belongs to an operator at a terminal, not to a web request rewriting the install's environment. So
  // a lateArm plan is NOT applied: nothing is written, and the answer says the keys stay live until they
  // expire. Striking the records instead would delete the only record of a working key.
  const revokeConnectorKeys = makeConnectorKeyRevoker({ env: process.env });

  const { config } = await import("./driver.config.mjs");
  const { appendFileSync: append } = await import("node:fs");
  const auditPath = process.env.PORTAL_AUDIT || join(HERE, "..", "portal-audit.log");
  const audit = (rec) => { try { append(auditPath, JSON.stringify({ at: new Date().toISOString(), ...rec }) + "\n"); } catch { /* best-effort */ } };
  // — SAY WHERE THE RECORD IS, IN THE PLACE PEOPLE LOOK FOR IT.
  //
  // Every mutating admin request is already recorded: the route files its own row on success
  // (`run-retire`, `run-restore`, `family-group`, `trigger`, `stop`, …), `routeAudited` files one for
  // any 4xx, and the door files one for a refusal it decides itself. The gap the owner hit was
  // not that nothing was written — it was that all of it goes to THIS FILE, and the box's journal, which
  // is what an operator reads, never mentioned the file existed.
  //
  // So triage of "I clicked Retire and it errored" looked at 17 lines of startup banner and concluded
  // the request never arrived. its own triage recorded that same absence as its central lead and
  // called it "the first thing to explain" — there was nothing to explain, and a second investigation
  // spent itself on the same non-signal.
  //
  // One line, at startup, naming the path. NOT a second per-request log into the journal: every one of
  // those rows would duplicate a row this file already has, and `/portal/admin/observed` reads this log
  // back through a fixed 256 KiB tail, so a duplicate is span that panel can no longer see.
  log(`audit log: ${auditPath} — every admin write, refusal and 500 lands here (PORTAL_AUDIT overrides). `
    + "The journal carries startup and fatals only; a save that a client reported as failed is answerable from that file, not from here.");

  // live trigger: the MCP HTTP face with an ops token (never a direct queue write). The face serves ONLY /mcp
  // (Streamable-HTTP JSON-RPC: initialize → tools/call — review 2026-07-18: the old bare-REST
  // /tools/start_run hit a route that exists nowhere), so this client speaks real MCP; the wire shape
  // is pinned by driver/test/portal-mcp-client.test.mjs, which drives the real client against a face
  // that enforces the real path contract.
  //
  // PORTAL_MCP_URL is an ORIGIN — "http://127.0.0.1:18790", NOT ".../mcp". The client appends /mcp
  // itself, so a value carrying it produces /mcp/mcp and 404s on the first press. Pinned by that test.
  const MCP_URL = process.env.PORTAL_MCP_URL || "";
  const OPS_TOKEN = process.env.PORTAL_OPS_TOKEN || "";
  // WHAT THE TRIGGER LANE IS ACTUALLY CAPPED TO — printed rather than assumed.
  //
  // History, because the shape of the mistake is worth keeping. This file's header once ASSERTED the
  // token was accounts-scoped while the deployed token carried no `accounts` claim at all — and
  // shared/scope.mjs treats an absent claim as accounts:"*" (resolveScope, first-party trust), so
  // authorize()'s start_run cap never engaged. The comment described a wall that did not exist.
  //
  // Both walls exist now (capped 2026-07-20): the principal check in route() stamps profileKey from the
  // VERIFIED account and a body cannot supply it, AND the token names the accounts it may start. What
  // stays true regardless is that NOTHING HERE ASSERTS IT — the posture is read from the live token on
  // every boot, so a deployment that loses the cap says so rather than inheriting this paragraph's word
  // for it.
  //
  // WARNING, not FATAL, and the line between them is deliberate. Every other refusal-to-start in this
  // bootstrap fires on a MISSING config value whose absence widens access at runtime (no grants file ⇒
  // read-all; no CLEAROTRON_OIDC_AUDIENCE ⇒ unverified identity). An uncapped token is not that shape: the
  // credential is present and the instance works, and refusing to boot over a defence-in-depth cap would
  // turn a degraded posture into an outage. Promoting it to fatal is defensible now that production is
  // capped; it is left as a warning until a second deployment has been through a full re-mint cycle,
  // because the failure it would cause lands on whoever forgets, at the worst moment.
  // ── THE LINE SAYS WHETHER THE LANE IS WIRED, NOT ONLY WHAT THE TOKEN IS ──────
  //
  // The owner submitted a clearance and got a 502 on a box where this line had been printing happily
  // for as long as the lane had been dead. It fired on OPS_TOKEN alone and described the token's
  // posture in detail, so a reader scanning the journal for "trigger lane" found a confident sentence
  // about a lane that could not carry a request — PORTAL_MCP_URL had never been set there, because
  // `clearotron start` is the only thing that derives it and that box launches its door directly.
  //
  // A LANE NEEDS BOTH HALVES, so the line names both and leads with the missing one. The token half is
  // still described exactly as before — it is genuinely useful and none of it was wrong. What was wrong
  // was printing it under a heading that implies the other half.
  const posture = opsTokenPosture(OPS_TOKEN);
  const laneWired = !!String(MCP_URL ?? "").trim() && !!OPS_TOKEN;
  if (!laneWired) {
    const missing = [!String(MCP_URL ?? "").trim() && "PORTAL_MCP_URL", !OPS_TOKEN && "PORTAL_OPS_TOKEN"].filter(Boolean);
    log(`trigger lane: NOT WIRED — ${missing.join(" and ")} unset. The portal starts and serves, its health `
      + "endpoint answers, and the Start button returns 502 because there is nothing behind it. "
      + "`clearotron start` derives PORTAL_MCP_URL from its resolved ports; a box that launches this "
      + "service directly must set it to the engine door's own ORIGIN (no /mcp — the client appends it).");
  }
  // ── AND WHETHER THE DOOR WILL TAKE IT ────────────────────────────────────────────────────────────
  //
  // Every line in this block describes the PORTAL'S HALF — the token, its verbs, its accounts, its
  // expiry — and not one of them asks whether the door it is pointed at will accept a caller shaped
  // like this one. That gap is what the outage was made of. The engine interface was switched to
  // `cf-access` at 09:59Z so a desktop assistant could reach it; the portal's last successful start_run
  // was 09:10Z; every Start after that was a 401 upstream and a 502 to the client. The portal logged
  // `trigger lane: ops token sub=portal …` and the interface logged `auth ON — issuer=CF Access`. Both
  // sentences were true, neither was the one the operator needed, and the owner found it by submitting
  // a clearance.
  //
  // The probe is UNAUTHENTICATED and costs one request at boot: what challenge does this door answer
  // with? A door fronted by a browser sign-in cannot be reached by anything holding an access key, and
  // that is knowable without presenting one.
  //
  // ONE AUTHORITY, NOT A SECOND OPINION. `triggerLaneVerdict` already reads this exact pair for
  // `doctor`; a judgement written here would be a second reader of the same facts, and the two would
  // drift. This asks the same function and prints what it says.
  if (laneWired) {
    try {
      const { triggerLaneVerdict, HOSTED, BOOT_PROBE_HEADER } = await import("../shared/trigger-lane.mjs");
      let probe = null;
      try {
        // NAMED AS THE PROBE, so the door does not log this expected 401 as a rejection on every start.
        const res = await fetch(new URL("/mcp", MCP_URL), { method: "GET", redirect: "manual",
          headers: { [BOOT_PROBE_HEADER]: "1" }, signal: AbortSignal.timeout(2500) });
        // THE BODY IS READ BECAUSE THE HEADER DOES NOT SEPARATE THE TWO DOORS. A proxy-fronted door and
        // a key door both refuse with 401 and no `www-authenticate`; each names the credential it wants
        // in the body, and that is the only thing on the wire that tells them apart. Bounded and
        // best-effort: a door that sends nothing readable leaves this null and the verdict reports
        // rather than judges.
        let body = null;
        if (res.status === 401) { try { body = (await res.text()).slice(0, 400); } catch { body = null; } }
        probe = { ok: res.status < 500, status: res.status, error: null,
          challenge: res.headers.get("www-authenticate"), body };
      } catch (e) { probe = { ok: false, status: null, error: String(e?.cause?.code ?? e?.name ?? e?.message ?? e) }; }
      // `verbs` IS DELIBERATELY NOT PASSED. That check short-circuits ahead of the probe, so handing it
      // in would answer a question about the TOKEN where a question about the DOOR was asked — and the
      // block below already reports the verbs, with the re-mint command. One question per line.
      const lane = triggerLaneVerdict({ url: MCP_URL, hasToken: true, verbs: null,
        posture: HOSTED, probe, invoke: "npx " });
      // ── THE SAME ANSWER MEANS OPPOSITE THINGS TO TWO CALLERS ─────────────────────────────────────
      //
      // `triggerLaneVerdict` is shared with `doctor`, and its `pass` was written for the question "can
      // an assistant follow this challenge". A `401` with `Bearer realm="OAuth"` is a pass to that
      // question and is the shape that CAUSED this outage: the door was moved to a proxy identity, and
      // this portal holds an access key rather than a proxy identity. Printing that verdict here would
      // put a confident tick on the exact configuration the incident was made of.
      //
      // So the two unambiguous states pass straight through, and the ambiguous one is REPORTED rather
      // than judged — with the mechanism, so a reader knows what to look at. Claiming more than was
      // measured is how a check starts refusing deployments that work.
      if (lane.state === "fail") log(`WARNING: trigger lane — ${lane.message}`);
      // NOT `WARNING:`. A connection nothing answered at boot is a startup race far
      // more often than an outage — the units carry no ordering, so the portal routinely binds first —
      // and the old text stated an outage in the present tense with a 502 attached to it. It printed on
      // every reboot, on boxes that were fine. Reserving `WARNING:` for what did answer wrongly is what
      // keeps the word meaning something on the day the lane is genuinely down.
      else if (lane.state === "unsettled" || lane.state === "unprobed") log(`trigger lane: ${lane.message}`);
      else if (probe?.challenge && /bearer/i.test(probe.challenge)) {
        log(`trigger lane: the engine door answered ${probe.status} with an OAuth challenge, so an identity `
          + "proxy is in front of it. This portal presents an ACCESS KEY, not a proxy identity, and whether "
          + "that key is honoured behind such a door is not readable from here — it is the shape that took "
          + "the Start button down once, silently, while every other check passed. Submit one clearance "
          + "after any change to the door's auth mode, and read the door's own `auth ON` line.");
      } else log("trigger lane: the engine door takes an access key, and this portal holds one.");
    } catch (e) {
      // The probe is a diagnostic. It must never be the reason a portal does not come up.
      log(`trigger lane: could not check whether the engine door accepts this portal (${e.message}) — not a verdict either way.`);
    }
  }

  // ── A RETIRED SETTING STILL SET IS SAID HERE, BESIDE THE OTHER GAPS ─────────────────────────────────
  //
  // Who may use the portal used to follow PORTAL_STAFF_DOMAINS: everyone at a listed email domain was
  // staff. That rule is deleted and nothing configures from the setting, so a deployment that still sets
  // it starts normally and admits nobody by domain — and the setting is the first place an operator looks
  // when people cannot sign in. Named in this table and looked up, never read as a setting, because it
  // decides nothing any more.
  const RETIRED_PORTAL_SETTINGS = {
    PORTAL_STAFF_DOMAINS: "who may use the portal is each person's own entry in the grants file "
      + "(CLEAROTRON_ACCESS_FILE), with \"everything\": true under \"people\" for anyone who should see every "
      + "company. No email domain admits anyone.",
  };
  for (const [name, now] of Object.entries(RETIRED_PORTAL_SETTINGS)) {
    if (process.env[name]) log(`WARNING: ${name} is set and ignored — ${now}`);
  }

  if (OPS_TOKEN) {
    const expiry = posture.expiresAt ? ` expires=${posture.expiresAt.slice(0, 10)} (${posture.daysLeft}d)` : " expires=UNKNOWN";
    // PREFIXED WHEN THE LANE IS DEAD, so this line cannot be read on its own as evidence of a working
    // lane — a journal is skimmed by grepping one phrase, and the phrase people grep is this one.
    log(`trigger lane${laneWired ? "" : " (NOT WIRED — see above)"}: ops token sub=${posture.sub ?? "-"} verbs=${posture.verbs?.join(",") ?? "(full ops)"} accounts=${posture.accounts?.join(",") ?? "UNCAPPED (every account)"}${expiry}${posture.readable ? "" : " — token payload unreadable, posture unknown"}`);
    if (!posture.accountCapped) {
      // ── THE PRINTED COMMAND IS DERIVED FROM THE TOKEN IN HAND ──────────────────────────────────────
      //
      // It used to be a fixed string: `--sub portal --verbs start_run,stop_run`. An operator whose
      // token carries a third verb, or a different subject, is told to re-mint as something NARROWER
      // than what they have — and the only symptom is the verb they silently lost failing later as an
      // upstream refusal, which reads as an engine fault. The advice here is "add an accounts cap",
      // and nothing else about the token should move because the reader followed it.
      //
      // The warning one branch below already derives its flag this way. This is the same pattern, and
      // copying it is the whole change.
      //
      // AN UNREADABLE PAYLOAD PRINTS NO COMMAND AT ALL. `opsTokenPosture` answers `readable: false`
      // with every claim null — which lands here, because `accountCapped` is false when nothing could
      // be read. A command composed from those nulls would be a guess presented as an instruction, and
      // it is exactly the case where following it destroys a token nobody could inspect.
      log("WARNING: the trigger ops token carries no `accounts` claim, so it is NOT account-capped — "
        + "the only thing bounding a trigger to one customer is this portal's own principal check. "
        + accountCapAdvice(posture));
    }
    // The token is VERB-scoped, so a portal minted before Stop existed can start runs and cannot stop
    // them — and that refusal arrives from upstream looking like an engine fault. Name it here, at boot,
    // where it is one line in the journal instead of a mystery at the moment someone needs to stop a run.
    if (Array.isArray(posture.verbs) && !posture.verbs.includes("stop_run"))
      log(`WARNING: the ops token's verbs are [${posture.verbs.join(", ")}] — it CANNOT stop_run, so every Stop and every queued-job Cancel will fail as an upstream refusal. Re-mint with \`--verbs ${[...new Set([...posture.verbs, "stop_run"])].join(",")}\`.`);
    // The deadline nobody was counting. When this lapses every Start fails as an upstream refusal,
    // which reads as an engine fault; 21 days is enough notice to re-mint without hurrying.
    if (posture.implausibleExp)
      log("WARNING: the trigger ops token carries an `exp` outside any plausible range — it cannot be counted down, and the token may have been minted in the wrong units. Treat its expiry as unknown and re-mint.");
    else if (posture.expired)
      log(`WARNING: the trigger ops token EXPIRED on ${posture.expiresAt.slice(0, 10)} — starting a run will fail until it is re-minted.`);
    else if (posture.daysLeft !== null && posture.daysLeft <= 21)
      log(`WARNING: the trigger ops token expires in ${posture.daysLeft} day(s) (${posture.expiresAt.slice(0, 10)}) — re-mint before it lapses or every Start will fail.`);

    // ACCOUNT-CAPPING HAS A COST, AND THIS IS IT.
    //
    // A capped token names the accounts that existed when it was minted. Enrol a new customer and
    // their runs fail at the engine door with a refusal that names the token, not the enrolment — and
    // nothing connects the two. That is precisely the shape this portal keeps getting caught by: a
    // control that is correct, and a second place that had to be updated with it and was not.
    //
    // So the roster is compared against the cap at every boot. The check costs one directory read and
    // turns a future silent breakage into a line that says exactly which key is missing and why.
    if (posture.accountCapped) {
      try {
        // Same call the /portal/admin/roster route makes, deliberately: loadProfiles defaults to the
        // directory named by CLEAROTRON_CUSTOMERS_DIR, resolved at MODULE LOAD. Since
        // the settings surface reads that same variable — at CALL time — so the two now name one store
        // rather than two. They can still disagree if the variable is set after profiles.mjs loads, and
        // `doctor` reports that rather than leaving it to be discovered by a client.
        const { loadProfiles } = await import("./profiles.mjs");
        const roster = [...loadProfiles({ force: true }).values()].map((p) => p.key);
        // F51 — ONE COMPUTATION, asked here and by the surfaces a person is
        // actually looking at (`brandowner add`, `doctor`). This check was right and landed in a log
        // nobody reads; moving the answer into a shared function is what let the other two ask it
        // without a second opinion about what "uncovered" means.
        const { uncovered, union } = triggerCapGap({ accounts: posture.accounts, roster });
        if (uncovered.length) {
          // The suggested command is the UNION of the current cap and the roster, never the roster
          // alone. If this ever reads a directory that is not the configured one — an unset
          // CLEAROTRON_CUSTOMERS_DIR falls back to the bundled demo fixtures rather than failing — then
          // "--accounts <roster>" would be an instruction to STRIP every real customer from the token.
          // A warning that can talk someone into breaking production is worse than no warning; a union
          // is wrong in the harmless direction by construction.
          log(`WARNING: ${triggerCapWarning({ uncovered, union })}`);
        }
      } catch (e) {
        log(`trigger lane: could not read the roster to check the token's account cap (${e?.message ?? e}) — cap not verified against enrolment`);
      }
    }
  }
  const { mcpToolCall } = await import("./portal-mcp-client.mjs");
  // ── the trigger credential is stamped WHEN A SEARCH STARTS, not when the portal booted ────────────
  //
  // `bin/start.mjs` mints PORTAL_OPS_TOKEN capped to the roster as it stood at boot. That cap is a real
  // second wall and it stays. What was wrong is its AGE: a company created afterwards is not in it, so
  // the portal offered the clearance and the engine door refused it —
  //
  //     FORBIDDEN (start_run): your grant [generic] does not include account "<key>"
  //
  // — which is the first thing a person meets after being told to set a company up. `brandowner add`
  // detects it and prints NOT YET STARTABLE with a remedy, deliberately reporting rather than
  // re-minting, because a create COMMAND holding the signing secret would be a larger surprise than the
  // bug. That boundary is about the command, and it is untouched: this process is not a create command,
  // it already holds the secret, and it already mints account credentials with it for the connector.
  //
  // So the cap is re-taken against the roster as it stands, for the length of one call.
  //
  // FALLS BACK TO THE BOOT TOKEN, never to an uncapped one. If the secret is unreadable or the store
  // cannot be listed, this returns exactly what it returned before — a stale cap that refuses a new
  // company at the door — rather than widening the wall to get the call through. The failure direction
  // matters more than the feature: "the newest company cannot search yet" is the bug being fixed, and
  // "any account can be started" is not a worse version of it, it is a different and larger one.
  const currentOpsToken = async () => {
    let roster = [];
    try {
      const { loadProfiles } = await import("./profiles.mjs");
      roster = [...loadProfiles({ force: true }).keys()];
    } catch (e) {
      // Same rule one layer out: the roster could not be read at all, so there is nothing to re-mint
      // against. Narrow and said out loud, rather than narrow and silent.
      console.error(`[portal] could not read the company roster to re-mint the engine credential `
        + `(${String(e?.message ?? e)}) — falling back to the credential minted at boot`);
      return OPS_TOKEN;
    }
    return opsTokenFor({ bootToken: OPS_TOKEN, roster, mint: mintToken });
  };
  const trigger = async (args) => {
    if (!MCP_URL || !OPS_TOKEN) throw new Error("PORTAL_MCP_URL / PORTAL_OPS_TOKEN unset — the trigger lane is not wired on this instance");
    return mcpToolCall({ url: MCP_URL, token: await currentOpsToken(), tool: "start_run", args });
  };
  const stopRun = async (args) => {
    if (!MCP_URL || !OPS_TOKEN) throw new Error("PORTAL_MCP_URL / PORTAL_OPS_TOKEN unset — the stop lane is not wired on this instance");
    return mcpToolCall({ url: MCP_URL, token: await currentOpsToken(), tool: "stop_run", args });
  };

  // The config surface. profile-service is constructed IN-PROCESS rather than called over HTTP: it
  // re-verifies a Cloudflare Access JWT on every request and the portal has no way to mint one. Calling
  // its router directly runs the SAME validators and the same git-commit path, with the portal's own
  // verified identity handed in as the author — one less hop, and no second auth domain to misconfigure.
  //
  // git commits land as the signed-in human, exactly as they do from the standalone editor.
  const upstream = await (async () => {
    try {
      const { makeProfileService } = await import("./profile-service.mjs");
      const { execFileSync } = await import("node:child_process");
      // — THE SAME STORE THE RUNS READ. This was `process.env.PROFILE_DIR ||
      // join(HERE, "profiles")`, and nothing set PROFILE_DIR, so every brand owner added the
      // documented way met "These settings are not available to you" while their clearance ran fine.
      const store = customerStoreDir({ bundledDir: join(HERE, "profiles") });
      const profileDir = store.dir;
      // Criterion 2 of — SAY WHICH STORE, the way `saved searches ON — store=…` does.
      // Logged HERE, before the containment guard below can throw, because a reader whose settings
      // surface went down needs the store it was ATTEMPTED against; the catch's "config surface
      // unavailable" alone sent the last reader to /proc to find out.
      log(customerStoreLine("settings surface", store));
      const repoRoot = process.env.PROFILE_REPO_ROOT || join(HERE, "..");
      const auditPath = process.env.PROFILE_AUDIT || join(profileDir, "_audit.log");
      // ── — A STORE THIS PROCESS COULD NEVER COMMIT TAKES THE CONFIG SURFACE DOWN, NOT THE PORTAL ──
      //
      // A save writes the file and then `git add`s it. Rooted at a repository that does not contain the
      // store, git refuses AFTER the write — the profile is live, the audit row records commit:null, the
      // orphan is untracked forever, and the next store sync refuses on the dirty tree. Measured on the
      // test box: 19 hours of blocked deploys from one save.
      //
      // THROWN, NOT FATAL, and that is this file's own ruling one screen down: "a settings surface that
      // cannot start must not take the whole portal down — clearances and reports are the load-bearing
      // product." The catch below turns this into a logged reason and a 404 on the config routes. A portal
      // that refused to boot would trade a broken editor for an outage.
      {
        const reach = storeInRepo(profileDir, repoRoot);
        if (!reach.ok)
          throw new Error(storeOutsideRepoMessage({ storeVar: "CLEAROTRON_CUSTOMERS_DIR", storeDir: reach.store, repoVar: "PROFILE_REPO_ROOT", repoRoot: reach.repo }));
      }

      // ── THE SKILLS OVERLAY, DERIVED RATHER THAN SEPARATELY CONFIGURED ────────────────────────────
      //
      // Constructing profile-service in-process means THIS process resolves a customer's risk-framework
      // files. It does that through `config.resolveSkillPath`, which reads the instructions dir — a knob
      // the portal's unit never set, because nothing about "run the portal" suggests you are also
      // configuring the engine's compute-skills tree.
      //
      // The result was not a failure. It was worse. With the overlay unset, resolveSkillPath falls back
      // to the PRODUCT REPO's own driver/skills — where the customer frameworks either do not exist
      // (a config-store-only customer → the page's fail-loud "could not be read" card) or exist as the SYNTHETIC
      // DEMO fixtures the repository carries for the suite (a framework titled "… risk framework
      // (synthetic demo)", source_deck "content invented"). The second case renders with a title, a band
      // ladder and band meanings, and is indistinguishable on screen from the client's real framework.
      // A lawyer read invented risk definitions as their client's own for as long as this was live.
      //
      // Two knobs that must agree, set in two places, where disagreement is silent and looks correct, is
      // the defect. PROFILE_REPO_ROOT already names the config store; the skills tree is its `skills/`
      // child by the store's own layout. So derive it here rather than asking a deployment to say the
      // same thing twice.
      //
      // SCOPED DELIBERATELY TO THIS BOOTSTRAP. `config.skillsOverlayDir` is shared with the engine, and
      // profile-service's own unit sets the instructions dir correctly — neither should learn a fallback
      // from the portal's mistake. Setting the env var (rather than threading a value) is what the
      // getter reads, and this process never runs the engine.
      //
      // DERIVED ONLY WHEN THE STORE HOLDS AN OVERRIDE, and said in one line either way: the rule and its
      // measurements are at `skillsOverlayAtBoot`. One directory read, once, at boot, mirroring the
      // roster-vs-ops-token boot check below.
      //
      // — SAME FACT, DIFFERENT READER. In a demo there is no customer whose framework could be shown
      // wrongly: the demo's company is marked demo data and rates under the framework shipped for it.
      // Naming two environment variables and a config store at a first-time visitor tells them the thing
      // they just started is broken, and this output is what gets captured for the website.
      // So the demo's posture line stands wherever a warning would.
      const overlayAtBoot = skillsOverlayAtBoot({
        explicit: envFrom(process.env, "CLEAROTRON_INSTRUCTIONS_DIR"),
        profileRepoRoot: process.env.PROFILE_REPO_ROOT || null,
        posture: demoPostureLine(process.env),
      });
      // `pinEnv`, not a bare assignment. This write lands at RUNTIME, long after `applyEnvAliases`
      // back-filled the spellings at load, so assigning one name reaches only the readers already
      // converted. `pinEnv` writes every spelling, which is what keeps a half-converted tree honest.
      if (overlayAtBoot.pin) pinEnv(process.env, "CLEAROTRON_INSTRUCTIONS_DIR", overlayAtBoot.pin);
      if (overlayAtBoot.line) log(overlayAtBoot.line);
      // — SAY IT WHEN IT HAPPENS. The core catches this and reports `commitError` on the response and
      // in the audit row, both read by whoever made the save and nobody else. A failed commit leaves a
      // permanent sync blocker, so the service journal needs it too: the boot check above removes the
      // CONFIGURATION cause, not index.lock contention, a detached HEAD, a hook, or a full disk.
      // — the shared committer; see shared/store-in-repo.mjs for why nothing un-stages.
      const committing = (root, what) => makeStoreCommit({ repoRoot: root, log, what });
      const gitCommit = committing(repoRoot, "profile");
      // — returns the path when it is committable, so the save stages the row with the change.
      const profAudit = makeCommittableAudit({ auditPath, repoRoot });
      // readLayered —: this construction serves the DEPLOYMENT, whose store the
      // engine reads overlay-over-base with `generic` falling through. Reading the store dir alone
      // here 500'd every Profiles screen on the empty store the wizard creates, while every clearance
      // ran fine — the two surfaces answered from different views of the same configuration.
      const profiles = makeProfileService({ profileDir, readLayered: true, gitCommit, audit: profAudit });

      // Saved searches ride the SAME in-process trick, and the same reasoning: recipe-service also
      // re-verifies a Cloudflare Access JWT the portal cannot mint, so its router is called directly.
      //
      // THE TENANCY NOTE THAT MATTERS: recipe-service's own routes take the customer as a PATH SEGMENT
      // and gate it only against the roster — an existence check, not an ownership one. It was built as
      // a staff tool behind CF Access, where that was sufficient. It is not sufficient here. The wrapper
      // in portal-upstream is what makes it client-safe: every saved-search route builds its path from
      // the account `resolveAccount` returned, so a caller's own words never reach the customer segment.
      // That is why these routes are mounted through `makeUpstream` and not proxied directly.
      //
      // NAMED, NEVER GUESSED: with CLEAROTRON_RECIPES_DIR unset there is no store, so `callRecipes` stays
      // null and every saved-search route answers 404. The alternative — falling back to the in-repo
      // driver/recipes/ — would write a real customer's search into the source tree's synthetic demo
      // directory. The engine refuses that fallback for the same reason; so does this.
      const recipesDir = process.env.CLEAROTRON_RECIPES_DIR || "";
      let callRecipes = null;
      // WHY THE FEATURE IS OFF, kept rather than only logged. The boot log already carried the exact
      // diagnosis and the screen carried "try again shortly" — a permanent, already-understood
      // configuration state rendered as a transient fault, with advice that can never work. The reason
      // travels with the refusal now so the surface can say what the log knows.
      let recipesOff = null;
      // — the recipe store's own reachability, decided BEFORE the branch so an unreachable one turns
      // saved searches off rather than throwing. A throw here would land in the catch below and take the
      // PROFILE surface down with it, and the two stores are configured independently: `recipeRepoRoot`
      // falls back to the profile repo root, so a correct profile setup can carry an incorrect recipe one.
      // — THE SAME RESOLVER THE STANDALONE SERVICE USES. This door and that one disagreed, and the
      // disagreement was invisible because each was correct on its own terms. `repoRoot` here is already
      // the profile root, so this door's ANSWER is unchanged — what changes is that the answer now comes
      // from one place, and a future edit to the order moves both doors together.
      const recipeResolved = resolveStoreRepoRoot({ names: ["RECIPE_REPO_ROOT", "PROFILE_REPO_ROOT"], fallback: repoRoot });
      const recipeReach = recipesDir ? storeInRepo(recipesDir, recipeResolved.root) : null;
      if (recipesDir && !recipeReach.ok) {
        log(`saved searches OFF — ${storeOutsideRepoMessage({ storeVar: "CLEAROTRON_RECIPES_DIR", storeDir: recipeReach.store, repoVar: "RECIPE_REPO_ROOT", repoRoot: recipeReach.repo })} `
          + `The repo root came from ${recipeResolved.from} (tried ${recipeResolved.tried.join(", ")} in that order). `
          + "Routes answer 404 rather than accepting a save that would orphan its file.");
        recipesOff = { code: "store_outside_repo", detail: storeOutsideRepoMessage({ storeVar: "CLEAROTRON_RECIPES_DIR", storeDir: recipeReach.store, repoVar: "RECIPE_REPO_ROOT", repoRoot: recipeReach.repo }) };
      } else if (recipesDir) {
        const { makeRecipeService } = await import("./recipe-service.mjs");
        const recipeRepoRoot = recipeResolved.root;
        const recipeAuditPath = process.env.RECIPE_AUDIT || join(recipesDir, "_audit.log");
        const recipeCommit = committing(recipeRepoRoot, "saved-search");
        // — same, against the RECIPE repo root, which may differ from the profile one.
        const recAudit = makeCommittableAudit({ auditPath: recipeAuditPath, repoRoot: recipeRepoRoot });
        const recipes = makeRecipeService({ recipesDir, profileDir, readLayered: true, gitCommit: recipeCommit, audit: recAudit });
        callRecipes = (method, path, body, identity) => recipes.route(method, path, { email: identity?.email }, body ?? {});
        log(`saved searches ON — store=${recipesDir} repo=${recipeRepoRoot}`);
      } else {
        log("saved searches OFF — CLEAROTRON_RECIPES_DIR unset, so /portal/api/config/searches answers 404");
        recipesOff = { code: "not_configured", detail: "CLEAROTRON_RECIPES_DIR is not set on this deployment, so there is no store for saved searches." };
      }

      return makeUpstream({
        callUpstream: (method, path, body, identity) => profiles.route(method, path, { email: identity?.email }, body ?? {}),
        callRecipes,
        recipesOff,
        // A company created from the portal is filed under its organisation in the same breath, so the
        // person who made it can use it: access is decided by the grants file, and the create writes only
        // the company's own file, which decides nothing about who sees it.
        fileCompany: async ({ tenant, account }) => writeGrants(withCompany(loadGrants({}), { tenant, account })),
      });
    } catch (e) {
      // A settings surface that cannot start must not take the whole portal down — clearances and
      // reports are the load-bearing product. The routes answer 404 and the reason is logged once.
      log(`config surface unavailable: ${String(e?.message ?? e)}`);
      return null;
    }
  })();

  // The brief reader, if this box was given a model credential.
  //
  // WHY THE UNIT MUST NAME IT. trademark-portal.service carries NO EnvironmentFile — deliberately, so
  // that sourcing the shared .env cannot drag CLEAROTRON_OIDC_AUDIENCE in and make this service trust the wrong
  // Cloudflare application. The rule the unit writes down is "every value arrives named", and this is
  // a named value: a drop-in with ANTHROPIC_API_KEY, nothing else. Absent, the feature stays dark and
  // the rest of the portal is untouched — which is why it is safe to ship this before the key lands.
  const composeRead = await (async () => {
    // THROUGH THE ENGINE DOOR. This used to read a raw ANTHROPIC_API_KEY and build
    // its own SDK client, which made the button impossible to switch on precisely where the product
    // recommends: `driver/engine/anthropic-agent.mjs` DELETES that key on a subscription box to force
    // one billing mode, and this required it. The owner hit it composing a live matter and was told the
    // feature was "not switched on here yet", which reads as a toggle nobody flipped rather than a thing
    // that cannot be flipped without changing how the box is billed.
    //
    // Supplying the key would have been worse than the bug: metered API spend beside subscription stages
    // on one box is the mix the owner's "one LLM provider only ever, API or auth, no mix" ruling ended.
    // Going through `runTurn` means the reader is on whatever the engine is already authenticated as,
    // so it works on a subscription box, works on a codex box, and adds no credential.
    //
    // NOT IN A DEMO. The reader is a model turn on whatever engine this machine is signed in to, so in a
    // demo it was the one button that spent on the visitor's own account. The composer shows the note it
    // shows wherever reading is off, and the form is filled in by hand.
    if (isDemo(process.env)) {
      log("brief reading OFF — this is the demo, and the demo makes no model call.");
      return null;
    }
    try {
      const { makeJxTurnRunner } = await import("./engine/jx-turn.mjs");
      const { makeComposeReader } = await import("./compose-read.mjs");
      // SONNET, THINKING OFF — the owner's ruling for this reader, and NOT the jx lanes' haiku/low. The
      // two are parameters on the shared runner for exactly this reason: `compose-read.mjs` records that
      // Haiku 4.5 refuses a thinking block outright (400), so inheriting the jx constants here would
      // have been a failure on every press.
      const model = process.env.PORTAL_READ_MODEL || PORTAL_READ_MODEL_DEFAULT;
      const runner = await makeJxTurnRunner({ model, thinking: "off", lane: "the brief reader" });
      if (runner?.error) {
        // NAMES THE CONDITION, on the operator's surface. The client-facing note stays client-facing;
        // this is the line whose absence made a billing posture look like a forgotten switch.
        log(briefReadingOffLine(runner.error));
        return null;
      }
      log(`brief reading ON — engine=${runner.engine} billing=${runner.authMode} model=${model}`);
      // The check a failed read points at, as a reader types it, with no path of this machine in it.
      return makeComposeReader({ turn: runner.turn, checkCommand: browserCommand("doctor --probe-engine") });
    } catch (e) {
      // A missing dependency or a bad key shape must not stop the portal booting: everything else on
      // this service is the load-bearing product, and the composer degrades to exactly what it did
      // before this feature existed.
      log(`brief reading OFF — ${String(e?.message ?? e)}`);
      return null;
    }
  })();

  // — the control's honesty is decided by the LIVE token, read once at boot. The
  // warning above already prints the remedy for operators; this is the half a user meets.
  const stopControl = !OPS_TOKEN || !MCP_URL
    ? { available: false, reason: "the stop lane is not wired on this instance (PORTAL_MCP_URL / PORTAL_OPS_TOKEN unset)" }
    : (Array.isArray(posture.verbs) && !posture.verbs.includes("stop_run"))
      ? { available: false, reason: `the ops token's verbs are [${posture.verbs.join(", ")}] — it cannot stop_run; re-mint with stop_run included` }
      : { available: true, reason: null };
  const service = makePortalService({ poolRoot: config.poolRoot, workspaceRoot: config.workspaceRoot,
    // Re-read per request (a getter that rescans), so a workspace created after boot is counted.
    queueDirs: () => config.queueDirs,
    secret, grants, localSignIn: LOCAL_MODE, writeGrants, revokeConnectorKeys, trigger, stopRun, audit, auditPath, upstream, composeRead, stopControl,
    // — the ONLY place the environment is read for this. `bin/start.mjs` is the
    // only thing that sets it, and it sets it explicitly rather than passing the operator's inherited
    // environment through, so a stray `.env` can neither put a live install into demo mode nor take a
    // demo out of one. Anything but the literal "1" is not a demo.
    demo: isDemo(process.env),   // — one name, shared with the MCP door
    // The runner's own order-time test, asked of the runner's own tables: the portal refuses what the runner would.
    orderRefusal: async () => portalOrderRefusal({ tables: await runTables() }) });
  const { RateLimiter } = await import("../mcp-server/lib/ratelimit.mjs");
  const limiter = new RateLimiter({ perMinute: Number(process.env.PORTAL_RATE_PER_MIN || 120) });
  const { createServer } = await import("node:http");

  // ──: the local identity provider, wired last ──────────────────────────────────────────────
  //
  // LAST on purpose. Establishing a credential prints a passphrase and tells somebody to keep it, and a
  // boot that is going to refuse for a missing roster or an unreadable grants file must refuse BEFORE
  // it does that — a passphrase printed by a process that then exits 1 is a passphrase somebody saves
  // for a portal that never ran.
  const localAuth = await (async () => {
    if (!LOCAL_MODE) return null;
    // — ONE DEFINITION, in portal-local-auth.mjs. The `passphrase` verb resets this same file;
    // resolving it twice is how a reset mints a credential the portal never reads.
    const credentialPath = credentialPathFor();
    let record;
    try {
      record = readLocalCredential(credentialPath);
    } catch (e) {
      // A credential file that exists and cannot be read is NOT "no user configured". Treating it as
      // one would mint a fresh passphrase over the working credential and lock out whoever holds it,
      // which is why readLocalCredential throws rather than returning null — and why this exits
      // instead of catching on.
      log(`FATAL: ${String(e?.message ?? e)} — refusing to start.`);
      process.exit(1);
    }
    if (!record) {
      // FIRST RUN. The one and only place a passphrase is ever printed; nothing logs it again, and the
      // record on disk is a scrypt digest, so this line is the only copy that will ever exist.
      // — decided BEFORE the mint, so an undeliverable credential is never
      // created. localCredentialHandoff carries the reasoning.
      // NAMES THE CREDENTIAL WHEN IT IS NOT WHERE THE VERB LOOKS BY DEFAULT — the demo keeps its own
      // inside its base, and this line used to send a reader to a command that exits 1 saying no
      // credential exists while theirs sits there being read.
      const resetCommand = passphraseResetCommand({ prefix: invocationPrefix(), credentialPath });
      const handoff = localCredentialHandoff({ isTTY: !!process.stderr.isTTY, resetCommand });
      if (handoff.refusal) {
        log(`FATAL: ${handoff.refusal}`);
        process.exit(1);
      }
      let established;
      try {
        // ── THE SUPERVISOR MAY HAND ONE DOWN ( — F10) ──────────────────────
        //
        // On a first FOREGROUND start the supervisor mints, so its closing summary can print the value
        // beside the address instead of telling the reader to scroll back into eleven lines of startup
        // log for the one value in this product that cannot be read back. Absent — every background
        // start, every restart — this mints its own exactly as before.
        //
        // NEVER PERSISTED. It reaches this process through the spawn call alone and is deliberately not
        // part of the composed portal environment, because that composition is also what gets written to
        // the units' env file. An arm holds that line: the whole design says the passphrase is stored
        // only as a digest, and a plaintext copy in an env file would make that sentence false.
        established = establishCredential({
          path: credentialPath, email: LOCAL_USER,
          passphrase: String(process.env.PORTAL_LOCAL_PASSPHRASE ?? "").trim() || null,
        });
      } catch (e) {
        log(`FATAL: could not write the local credential to ${credentialPath} (${String(e?.message ?? e)}) — refusing to start.`);
        process.exit(1);
      }
      // The secret is handed to the composer ONLY on the branch that prints it. Passing it on the other
      // branch is the wiring mistake the arm plants for, and it would not be visible in the output.
      for (const line of firstRunCredentialLines({
        handoff, credentialPath, email: LOCAL_USER, resetCommand,
        handedDown: Boolean(String(process.env.PORTAL_LOCAL_PASSPHRASE ?? "").trim()),
        passphrase: handoff.printPassphrase ? established.passphrase : null,
      })) log(line);
      record = readLocalCredential(credentialPath);
    } else {
      // The credential names the address it was minted for. If the configured user has changed since,
      // the passphrase on disk belongs to somebody else's sign-in — say so rather than answering every
      // attempt with "that passphrase is not correct" and leaving the operator to guess why.
      if (record.email !== LOCAL_USER) {
        log(`FATAL: the credential at ${credentialPath} was created for ${record.email}, but PORTAL_LOCAL_USER is ${LOCAL_USER}. Point PORTAL_LOCAL_CREDENTIAL at a different file (a new passphrase will be created for the new address) or set PORTAL_LOCAL_USER back. Refusing to start.`);
        process.exit(1);
      }
      log(`local sign-in: credential for ${LOCAL_USER} read from ${credentialPath}`);
    }
    // The roster still decides. A local sign-in produces an email and nothing else; if that address is
    // in neither the grants file nor a staff domain, makePrincipal returns null and the door 403s —
    // exactly as it would for a Cloudflare-verified stranger. Warned at boot because the symptom
    // otherwise arrives as "I signed in and got refused", which reads as a broken login.
    try {
      if (!makePrincipal({ email: LOCAL_USER, grants: grants() }))
        log(`WARNING: ${LOCAL_USER} can sign in but holds no portal access — it has no entry in the grants file (CLEAROTRON_ACCESS_FILE), so every page will refuse it at the door. Give it one.`);
    } catch (e) {
      // A WARNING must never be the thing that takes the service down. The grants file was already
      // read successfully by the mandatory guard above; anything that fails here is a race with
      // something rewriting it, and the per-request loader will report it honestly on the first
      // request that needs it.
      log(`local sign-in: could not check ${LOCAL_USER} against the roster (${String(e?.message ?? e)}) — enrolment not verified at boot`);
    }
    const TTL_SEC = 60 * 60 * 12;
    return {
      email: LOCAL_USER,
      secret,
      ttlSec: TTL_SEC,
      // Re-read per request, the same idiom the grants file uses: replacing the credential file takes
      // effect without a restart, and a file that goes corrupt later is a refusal with a reason rather
      // than a stale copy held in memory.
      credential: () => readLocalCredential(credentialPath),
      attempts: makeAttemptLimiter({ max: 10, windowMs: 5 * 60 * 1000 }),
      // The sign-in page's recovery line. It resets the file this portal reads, and names no path on this
      // machine, because the page is read before anyone has signed in (signInResetCommand says how).
      resetCommand: signInResetCommand({ credentialPath, npxVersion: npxVersionOf() }),
    };
  })();

  // portal-ui/dist is NOT tracked (`git ls-files portal-ui/dist` is empty), and this comment used to
  // say the opposite — the 503's whole justification rested on it. What a missing bundle means depends
  // on the route: on a PACKAGED install the bundle ships inside the tarball, so absent means a broken
  // package; on a SOURCE checkout it has simply never been built, which is the ordinary first-run
  // state and why the message names the build command. The freshness verdict twenty lines below
  // has always had this right.
  //
  // Not fatal on purpose: the API is independently useful (the MCP face, the connector, a debugging
  // curl), and taking the whole service down over a UI asset would turn a cosmetic failure into an
  // outage. It is loud instead — 503 with the reason, and `ui` on /portal/health.
  const distDir = pathResolve(HERE, "..", "portal-ui", "dist");
  const staticHandler = makeStaticHandler({ distDir });
  if (!staticHandler.present()) log(`WARNING: no UI bundle at ${distDir} — /portal will answer 503 until it is restored`);
  // No `devIdentity` here, and there is no environment variable that can supply one. It survives on
  // makeHttpHandler purely so an in-process test can inject an identity without a socket; the deployed
  // service has exactly two identity sources and both of them prove something.
  //: the bind failure is the helper's, not this block's. It does NOT retry — a portal that quietly
  // moved off PORTAL_SERVICE_PORT would leave the tunnel in front of it pointing at the old address.
  const { listenOrDie } = await import("../shared/listen.mjs");
  listenOrDie(createServer(makeHttpHandler({ verify, limiter, service, log, localAuth, static: staticHandler, authHeader: AUTH_HEADER })), {
    port: PORT, host: HOST, what: "the portal service", portVar: "PORTAL_SERVICE_PORT", portSource: PORT_CHOICE.source, log,
    // "AUTH OFF (dev)" is gone with the switch that produced it: this line now names WHICH door is
    // open, and there is no longer a third state where none is.
    onReady: ({ port: bound }) => log(`listening on http://${HOST}:${bound}/portal — pool=${config.poolRoot} ui=${staticHandler.present() ? "built" : "MISSING"} auth ON (${verify ? "CF Access" : "local sign-in"})`),
  });
}
