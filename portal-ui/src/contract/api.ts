// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The only file in the portal permitted to call fetch().
//
// Everything the browser learns about the world decodes through here into a `Result<T>`, and the shape
// of that union is doing real work:
//
//   • There is NO `forbidden` member. Not "we do not render it" — it does not exist, so a component
//     physically cannot display "forbidden" or "you do not have access to run X". The engine's rule is
//     404-never-403 for anything tenant-scoped, because a 403 confirms a run exists. Encoding that as an
//     absent union member means the rule cannot be broken by a well-meaning error screen.
//
//   • 422 has TWO shapes and they mean different things. With `classify` it is the engine asking the user
//     a question (`clarify`). Without it, it is portal-service's own mark-batch dedupe rejecting a batch
//     whose names collide after kebab-casing (`collision`). Rendering one as the other tells a user to
//     answer a question that was never asked.
//
//   • `gate` carries a message that is rendered VERBATIM. The seven confirmation-gate strings are written
//     to be read by a human ("the request changed after confirmation — review the plan again and
//     re-confirm"). Paraphrasing them in the UI is how a precise instruction becomes a vague one.

import type { Tone, Band } from './tone.ts'
import { asTone } from './tone.ts'
import type { BriefRead } from './composeRead.ts'

export type Result<T> =
  | { kind: 'ok'; value: T }
  /** 422 WITH a classify block — the engine needs an answer before it can plan. */
  | { kind: 'clarify'; questions: string[] }
  /** 400 — the request is malformed or fails validation. */
  | { kind: 'reject'; errors: string[] }
  /** 422 with NO classify — mark-batch names collide after kebab-casing. */
  | { kind: 'collision'; errors: string[] }
  /** 409 from the confirmation gate. `message` is one of seven strings; render it as-is. */
  | { kind: 'gate'; message: string }
  /** 409 from recipe-service via the proxy — an optimistic-concurrency version conflict on save. */
  | { kind: 'conflict'; message: string }
  /**
   * 401 — the session has gone..
   *
   * NOT a tenancy answer, which is why it is its own kind rather than joining the shapes the shell
   * deliberately makes indistinguishable. Naming it leaks nothing: an unauthenticated caller learns only
   * that they are unauthenticated, which they already know. Without it a 401 fell through `decodeStatus`
   * to `upstream`, and the shell told a signed-out reader "You are signed in, but this address has not
   * been enrolled" — false, on the first screen they meet, and it sends them to ask for an account they
   * already have instead of to the sign-in page.
   */
  | { kind: 'signedOut' }
  /** The signed-in identity has several accounts and the route needs to know which one. */
  | { kind: 'pickAccount' }
  /** Signed in, but granted nothing. Not the same as `notFound`. */
  | { kind: 'noAccess' }
  /** 404. Covers "does not exist" AND "not yours" — deliberately indistinguishable. */
  | { kind: 'notFound' }
  | { kind: 'rateLimited' }
  | { kind: 'tooLarge' }
  /**
   * The settings surface could not be CONSTRUCTED on this deployment — not a permission answer and not
   * a missing resource. Distinct from `notFound` on purpose: 404 covers "yours or
   * not, we will not say", and rendering this as that told an account owner the settings were "not
   * available to you" when the deployment had simply not been pointed at its own store. Nothing here is
   * tenant-scoped, so it leaks nothing the 404 rule protects.
   */
  | { kind: 'surfaceUnavailable' }
  /** The request never completed, or the server broke. Retryable. */
  | { kind: 'upstream'; message: string }

/**
 * What a Stop press resolved to.
 *
 * `mode` is the stop that is actually in progress, not the one the button offered. `note` is the
 * driver's own sentence about it and is rendered as-is: it names the step, says what was kept and what
 * was lost, and paraphrasing it here would be a second author for one fact.
 */
export type StopOutcome = {
  readonly action: string | null
  readonly mode: 'immediate' | 'boundary'
  readonly note: string | null
}

export const isOk = <T>(r: Result<T>): r is { kind: 'ok'; value: T } => r.kind === 'ok'

/**
 * — WHY A SAVE DID NOT SAVE, in words the person who clicked can act on.
 *
 * Three call sites on the Clearances screen discarded the whole result and alerted a fixed sentence:
 *
 *     if (r.kind !== 'ok') { window.alert('That change could not be saved.'); return }
 *
 * The owner hit exactly that on production, on a run they were trying to clear away, and had
 * already closed once on the same symptom. It could not be triaged from either end: the client threw
 * the reason away and the portal logged nothing per request, so a failed retire produced no reason on
 * the screen and no record on the box.
 *
 * EVERY BRANCH RETURNS SOMETHING SAYABLE, and that is the point rather than completeness for its own
 * sake: the union has eleven members, a `default` would swallow the next one added, and the failure
 * this replaces was precisely a message that told the reader nothing. The fallback is used only for
 * `ok`, which no caller should be asking about.
 *
 * It is deliberately NOT a toast/format decision — it returns text, so each caller keeps whatever
 * surface it already uses.
 */
export function saveFailureText<T>(r: Result<T>, fallback = 'That change could not be saved.'): string {
  switch (r.kind) {
    case 'ok': return fallback
    case 'reject': case 'collision': return r.errors.join('\n') || fallback
    case 'clarify': return r.questions.join('\n') || fallback
    case 'gate': case 'conflict': case 'upstream': return r.message || fallback
    // A 404 here covers "does not exist" AND "not yours", deliberately indistinguishable — so the
    // sentence must not claim which, while still telling the reader that reloading is the next move.
    case 'notFound': return 'That run is no longer here — someone may have changed it. Reload the page.'
    case 'rateLimited': return 'Too many requests just now. Wait a moment and try again.'
    case 'tooLarge': return 'That request was too large for the server to accept.'
    case 'noAccess': return 'You are signed in, but this account has not been granted access to that.'
    // Deliberately says the deployment, not the reader. Nothing they can do to their own account fixes it.
    case 'surfaceUnavailable': return 'The settings surface is not configured on this deployment, so nothing could be read or saved. This is a server setting, not your access — an administrator needs to fix it.'
    case 'pickAccount': return 'That identity has more than one account — choose one and try again.'
    //. Says what happened and what fixes it, and does NOT say the change failed:
    // it never reached the server, so nothing was half-done and re-doing it after signing in is safe.
    case 'signedOut': return 'Your session has ended, so nothing was changed. Sign in again and repeat that — it is safe to.'
  }
}

/**
 * A save that LANDED but was not committed.
 *
 * THE FIELD HAD NEVER HAD A READER. `profile-service` and `recipe-service` have returned `commitError`
 * on a 200 from every save route for months, carrying a carefully written sentence — and
 * `grep -rn commitError portal-ui/src` returned nothing. The response is a 200, `isOk()` is true, and
 * every save site branched only on `!isOk(r)`, so a write that never reached the store's git rendered
 * as a clean success. The owner created a project, saw it succeed, and it was not durable.
 *
 * NOT AN ERROR, and that is why it cannot be folded into the `Result` union's failure members. The
 * change IS live — it is on disk and the engine will read it. What it is not is DURABLE: nothing
 * committed it, so a store sync can lose it and the residue blocks the next one. Rendering it as "that
 * could not be saved" would be a different lie in the opposite direction.
 *
 * One derivation, because there are seven save sites across four screens and a sentence copied seven
 * times is seven chances to drift.
 */
export function notCommitted(r: Result<Record<string, unknown>>): string | null {
  if (!isOk(r)) return null
  const detail = asString(r.value['commitError'])
  if (!detail || !detail.trim()) return null
  return 'Saved, and live — but it was not committed to the store, so it can be lost. '
    + 'Tell an administrator before relying on it.'
}

// ── wire shapes ──────────────────────────────────────────────────────────────────────────────────────

export type Role = 'staff' | 'client'

export type Me = {
  readonly role: Role
  readonly email: string
  /**
   * The accounts this identity is granted, NAMED.
   *
   * Empty for staff — and empty does not mean "none". The wire sends `"*"` for an identity granted
   * everything (portal-access.mjs), which is not a list and cannot be turned into one client-side: the
   * set of accounts is the roster, and the roster is its own staff-only endpoint. Decoding `"*"` to `[]`
   * without saying so is how a staff sidebar ends up rendering "no brand owners".
   */
  readonly accounts: readonly string[]
  /** True when the wire said `"*"`. Ask /portal/admin/roster for the actual list. */
  readonly allAccounts: boolean
  /** — whether Stop can work on this deployment; reason is staff-only wording. */
  readonly stopControl: { readonly available: boolean; readonly reason: string | null }
  /**
   * The DISPLAY name of each granted account, keyed by account key.
   *
   * The key is a slug ("vantor"); the name is what the brand owner is actually called ("Ion
   * Partners"). Empty for an `allAccounts` identity — those read names off the roster instead, which
   * is staff-gated for a reason. Empty is also what a degraded server sends, so a missing entry means
   * "no name available" and the caller falls back to the key; it never means the account is unnamed.
   */
  readonly accountNames: Readonly<Record<string, string>>
  /**
   * How many runs this deployment executes at once — ONE GLOBAL CAP, never per brand owner.
   *
   * Null when the server does not send it (an older portal-service), and the caller must then say
   * nothing rather than assume a number: a stated cap that is wrong over-promises throughput, which is
   * the one direction that matters for a line a lawyer might repeat to a client.
   */
  readonly concurrentRuns: number | null
  /**
   * WHICH MODE THIS INSTALL IS IN, as far as starting a NEW search goes.
   *
   *   'demo'             nothing to spawn. The example report, its audit trail and the MCP connection
   *                      all work; a new run cannot start. A product state, not a broken install.
   *   'engine-unproven'  a binary resolves. Whether it is signed in is unknown and only a probe turn
   *                      can know, so the button stays live and a refusal is still possible.
   *   null               THIS CANNOT ANSWER — no snapshot has been written, or it predates engine
   *                      reporting. Treated exactly as unproven by every caller: leave the button
   *                      alone. Rendering null as demo would tell a first-time visitor their install
   *                      is limited when what happened is that nobody wrote a snapshot yet.
   *
   * There is no 'engine-ready' here on purpose. That value exists, and only a completed probe turn
   * produces it; the portal never spends one, so it must never imply it.
   */
  readonly engineMode: 'demo' | 'engine-unproven' | null
  /**
   * WHO OPERATES THIS DEPLOYMENT — the `CLEAROTRON_BRAND_NAME` seam, read, never restated.
   *
   * The staff role label is "<operator> staff", and it used to be that name as a literal in
   * three screens. That is one deployment's identity shipped as the product's: a fork running this
   * portal would tell its own users they are staff of a company they have never heard of.
   *
   * Empty string when the server does not send it (an older portal-service), and the caller then says
   * "Staff" unqualified rather than guessing a name — an unqualified role is merely less specific, a
   * wrong operator name is a false statement about who holds the data.
   */
  readonly brand: string
}

/**
 * THE STAFF ROLE LABEL — "<operator> staff", from the brand seam, in one place.
 *
 * It was a hardcoded operator name in three screens and a test. One deployment's identity written
 * as the product's: every fork of this portal would have told its own users they were staff of a Swiss
 * firm they have nothing to do with. Centralised because four copies of a string is how three of them
 * end up stale, and because the degraded case has to be decided once — with no brand from the server
 * the label is a bare "Staff", which is less specific rather than untrue.
 */
export const staffLabel = (brand: string): string => (brand ? `${brand} staff` : 'Staff')

/**
 * THE OPERATOR'S NAME, FOR PROSE. Same seam as `staffLabel`, different job: that one builds a
 * role label, this one drops the name into a sentence ("ask X to enrol it").
 *
 * The degraded case is why it exists rather than each screen writing `me.brand || something`. With no
 * brand from the server the honest sentence names the ROLE, not a blank — "ask the operator" is still
 * an instruction a reader can act on, whereas "ask  to enrol it" reads as a bug and tells them nothing.
 * Screens outside a `ShellContext` (the not-enrolled notice, the field pickers) have no brand to read at
 * all and are worded without a name instead of calling this with an empty string.
 */
export const operatorName = (brand: string, opts?: { readonly lead?: boolean }): string =>
  brand || (opts?.lead ? 'The operator' : 'the operator')

export type RunState = 'queued' | 'running' | 'paused' | 'delivered' | 'failed' | 'cancelled'

/**
 * One row on the Clearances list.
 *
 * `band` is the label as the customer's own framework words it; `tone` is what the UI colours and sorts
 * by. Both come from the server — the UI never derives one from the other, because the mapping is
 * framework-scoped and the server is the only side that knows the framework.
 */
export type Run = {
  readonly runId: string
  /** The brand owner this run belongs to. Always present, so a row never has to infer it. */
  readonly account: string
  /**
   * The report's own headline — model-authored front matter, NOT the mark.
   *
   * A delivered run carries titles as varied as "ARBORA" and "AquaPlus — US Preliminary Trademark
   * Clearance". Use it only as a fallback for `markName`; never as a name to group by or to head a row.
   */
  readonly title: string
  /**
   * The mark as the user typed it, when the run carries it.
   *
   * Null for runs delivered before publish started copying it out of status.json — those fall back to
   * `title` and read verbosely until they are re-rendered. Prefer `displayName()` over reaching for
   * either of these directly.
   */
  readonly markName: string | null
  /**
   * The project (engagement) this run was rated under, and what that project is called.
   *
   * NULL MEANS "WE DO NOT KNOW", NOT "NO PROJECT", and the difference is load-bearing. Every run
   * delivered before the publish stamp carries neither field whether or not it had a project, so a
   * screen that renders null as "No project" would be asserting something about history it cannot see.
   * Render the project when there is one; render nothing when there is not.
   *
   * `projectName` is null on a QUEUED run even when the key is set — the name is resolved by the engine
   * at start and this job has not started. Fall back to the key rather than dropping the project.
   */
  readonly projectKey: string | null
  readonly projectName: string | null
  /** The registry key of the read's depth ("prelim"), or null on runs older than the level registry. */
  readonly product: string | null
  /**
   * The FROZEN display face stamped on the run at publish ("Depth 4" on anything sold under the retired
   * ladder). Null on a run older than the level registry.
   *
   * LAST RESORT ONLY, and one call site: `readLabel` reaches it when `productName` is null, which
   * happens for exactly one class of run — one whose level the registry has FORGOTTEN, where both
   * fields resolve through the same `policyFor` miss. There the stamp is the last thing anyone recorded
   * about that search and is better than a blank. Anywhere else it is a rung on a ladder the offering
   * no longer has: this comment used to say the field never reaches a client's screen, and it was
   * wrong — the browser's own product→name mapping missed every retired row and printed this instead.
   */
  readonly stageLabel: string | null
  /**
   * THE PRODUCT'S CLIENT-FACING NAME — what a card and a queue row call this search.
   *
   * Resolved server-side by the ONE resolver the delivered report's masthead uses
   * (search-policy.mjs reportIdentityFor → `.identity`), so a run's card and its own report cannot
   * disagree about what was bought. The browser used to map `product` → label itself; that table drifted
   * and rendered a blank chip for every product this build offers.
   *
   * Null on a level the registry has forgotten, and on a run older than the level registry: the chip
   * shows nothing rather than guessing a search the run may not have been.
   */
  readonly productName: string | null
  readonly kind: 'clearance' | 'knockout-batch'
  readonly state: RunState
  readonly date: string | null
  /**
   * WHEN THIS READ FINISHED, to the second — the ordering key.
   *
   * `date` is DAY precision and always was: it is parsed out of the run directory name. Two reads of one
   * mark delivered on the same day therefore tie, and which one a list spoke for was decided by
   * `readdirSync` order rather than by recency.
   *
   * Delivered ⇒ `meta.issuedAt`. Live ⇒ the last progress write. Queued ⇒ when it was queued. Null on a
   * run published before the field existed, which is why every consumer falls back to `date` rather than
   * treating a missing timestamp as "oldest".
   *
   * NOT a display value on its own. `date` is what a reader sees; this decides order, and only shows as
   * a time when two reads share a day and would otherwise be indistinguishable.
   */
  readonly issuedAt: string | null
  /** The band label. Opaque to the UI: display it, never branch on it. */
  readonly band: string | null
  readonly tone: Tone | null
  /** The customer's ladder for this run — the source of stop count, labels and sort order. */
  readonly bands: readonly Band[]
  /** Knockout batches carry a per-name summary. Empty for a single-mark clearance. */
  readonly marks: readonly { readonly name: string; readonly band: string | null; readonly tone: Tone | null }[]
  /** Present ⇒ the run can render natively. Absent ⇒ legacy, and it takes the iframe path. */
  readonly reportSchema: number | null
  /**
   * The client gate: a finished report a lawyer has not released yet.
   *
   * RETIRED 2026-07-28 and always false: it carried the client gate's "held" state, and that gate had
   * no key — nothing could release a held report. Kept on the type so an older build keeps parsing.
   * Historic note: reported separately from `report` because they answer different questions. A held run is LISTED
   * for a client with no link — a row that explains itself beats a row that vanishes — while staff get
   * both the flag and the link, since they are the ones doing the releasing.
   */
  readonly held: boolean
  readonly report: string | null
  /**
   * ONE REPORT PER MARK. A knockout is the one product sold over several names, and it now
   * publishes one document per name. `report` is the RUN-LEVEL link and is null for a batch — there is
   * no run-level document — while this carries one entry per name.
   *
   * A single-document run carries both, pointing at the same place, so a reader that only knows
   * `report` sees no change. A reader that only knows `report` on a BATCH sees null, which is the
   * honest answer: linking the first of eight names as "the report" is what this replaced.
   *
   * `path` is the DOCUMENT — the frozen file, the same kind of URL as `report` above, and what the
   * screen puts in its frame. `slug` is that document's name within the run, and it is what a client
   * builds its own route from: /portal/result/<runId>/<slug> opens this document inside the shell.
   * Null on a single-document run, which has one document and nothing to pick between.
   */
  readonly reports: readonly {
    readonly mark: string | null
    readonly slug: string | null
    readonly path: string
  }[]
  // live-run fields
  readonly step: string | null
  readonly stepN: number | null
  readonly stepTotal: number | null
  /** A stop has been asked for and the step in flight is finishing. Beside a
   *  non-terminal state this is the screen's "Stopping…"; the terminal replaces it. */
  readonly stopRequestedAt: string | null
  /** Why a run stopped. A failed run with no reason on screen is a run the user has to ask about. */
  readonly reason: string | null
  readonly failedStage: string | null
  /**
   *  — the engine's OPEN-SET payload for a failure (a validator reason, a query list), kept apart
   * from `reason` all the way from the throw site so a renderer can show the sentence and hide this.
   * Null on every failure that carries none, and on every run that has not failed.
   */
  readonly reasonDetail: string | null
  /**
   *  — THIS reader has acknowledged this run, in the state it is in now.
   *
   * Stamped per request by the service from the viewer's own file, never stored on the run: another
   * reader's dashboard is unaffected, and a run that leaves the state it was dismissed in comes back.
   * False on every run nobody has put down, which is almost all of them.
   */
  readonly acked: boolean
  /**
   * WHY it is paused, because the pauses say different things to the person waiting.
   *
   * 'rate-limit' is a provider cap: it carries `resetsAt`, resumes itself, and nothing is wrong.
   * 'recovering' is the engine retrying after a failure, on a backoff rather than to a stated time —
   * so it has no clock, and the UI must not imply one.
   * 'operator' is the system itself restarting (a deploy, a runner stop) with the run in flight —
   * the run resumes on its own on the next runner pass; no clock, and still nothing to do.
   */
  readonly pausedKind: 'rate-limit' | 'recovering' | 'operator' | null
  /** When a rate-limit pause resumes. The only ETA this system actually possesses. */
  readonly resetsAt: string | null
  /** When the run began, for elapsed. Never used to compute a finish time — none is knowable. */
  readonly startedAt: string | null
  /**
   * Where this job sits in the line for a run slot: 1-based, dense, and only ever set on a `queued`
   * row. Null on everything else — a run that has started is not in a queue.
   *
   * This is a POSITION, NOT AN ETA. It says what runs before this does, and nothing whatsoever about
   * when: run durations are neither measured nor predicted anywhere in this system.
   *
   * Dense over the rows the caller can SEE, not the raw index in the runner's lane — an ordinal that
   * counted other tenants' queued work would publish how much of it there is.
   */
  readonly queuePos: number | null
}

/**
 * ONE OF THE FOUR SEARCHES WE OFFER, as the wire carries it.
 *
 * It replaced `Product`, and the difference is the whole: a level was a rung on an internal
 * depth ladder ("Depth 4") whose display face the client never recognised, and one rung named three
 * different products depending on where it pointed. Every field below is the SERVER'S answer about what
 * it will run — nothing on this screen is hand-typed from it, so a tagline can never promise a figure a
 * wall does not enforce.
 */
export type Product = {
  /** The machine key. NEVER printed — `name` is the only string a client sees. */
  readonly key: string
  /** What this search is CALLED. The same string printed at the top of every delivered document. */
  readonly name: string
  /** The same name again: the registry's display face, which IS the product's name now. */
  readonly stageLabel: string
  readonly pipeline: string
  readonly components: readonly string[]
  /** The geography this search ACCEPTS, in the offering's own words. The Where panel states it. */
  readonly geography: string
  /** Whether the case-law and opposition reading is part of it. Not a flag anybody can set. */
  readonly caseLaw: boolean
  /** 'absent' | 'offered' (the one toggle in the offering) | 'automatic'. */
  readonly nativeLanguage: string
  /** How many names it reads in one search. THE limit; the server refuses over it, never truncates. */
  readonly maxNames: number
  /**
   * What this search takes with NOTHING added — one name, no optional increment.
   *
   * Replaced `turnaroundHint` (retired 2026-07-29), which said "under an hour" or "same day" and so gave
   * a one-hour register read and a two-hour clearance the same answer — while the composer's own footer,
   * on the same screen, computed "~1.5 hours" from the effort model and visibly disagreed with it. This
   * comes off that same model (driver/product-rows.mjs), so the two cannot say different things.
   */
  readonly baseTurnaround: string | null
  readonly baseTurnaroundHours: number | null
  /** Whether this row may be ORDERED. A retired row is nameable (an archived run) and not orderable. */
  readonly orderable: boolean
  /**
   * Whether this search can be picked on this deployment right now.
   *
   * Defaults to TRUE when the field is absent. That is not laziness — it mirrors the server's
   * degradation rule (a missing flag snapshot reads as available), so an older server that does not
   * send the field yet offers everything rather than greying out the whole menu.
   */
  readonly available: boolean
  /** Why not, in words a client can read. Null when available. Never names an internal switch. */
  readonly unavailableNote: string | null
  /**
   * ──  — WHAT THIS DEPLOYMENT'S REGISTER REACHES ────────────────────────────
   *
   * A SIBLING of `unavailableNote`, and the two are never both set. That one explains a control the
   * reader cannot use; this one qualifies one they can. A worldwide search on a register that reaches
   * part of the world used to be REMOVED — the owner met it as a button that "doesnt appear disabled,
   * no message etc — but i cant select it". It is orderable now, and this says what the register does
   * reach and what will be disclosed as deferred coverage instead of searched.
   *
   * Composed by the server, not here, for the reason the unavailable sentences are: two copies of a
   * client-facing sentence drift, and the browser is not the only surface that shows it.
   */
  readonly coverageNote: string | null
  /**
   *  — a capability THIS product declares it needs and this deployment does not
   * have. Null on every deployment that has it, and on every server that cannot say.
   *
   * A third sibling of `unavailableNote` and `coverageNote`, and the three answer different questions:
   * this control cannot be used / it can, and here is what the register will not reach / it can, and
   * here is what the report will not contain. The product stays orderable — the search runs and the
   * report discloses the gap — so this is never a refusal.
   */
  readonly capabilityNote: string | null
}

/**
 * WHERE a search would actually point, as the server resolved it.
 *
 * Every field carries its own provenance, because "the territories you named" and "your account's
 * default territories" look identical in a summary and mean very different things to whoever is
 * approving the spend. `null` means the server could not resolve a scope — the review step renders
 * nothing rather than guessing, since this is a description shown beside the gates, not a gate.
 */
export type ResolvedScope = {
  readonly jurisdictions: readonly string[]
  readonly jurisdictionsFrom: string
  readonly classes: readonly number[]
  readonly classesFrom: string
  readonly platforms: readonly string[]
  /** What THIS request added, as against what the account already mandated. */
  readonly platformsAdded: readonly string[]
  readonly platformsFrom: string
  /** How many grid cells each variant costs. The part a requester cannot infer from their own request. */
  readonly gridCellsPerVariant: number | null
}

/** What `/plan` answers: the honest summary of what pressing Start would do. Nothing has run. */
export type Plan = {
  readonly account: string
  /** The resolved product's client-facing name. Leads the review headline; see Product.name. */
  readonly name: string
  /** The same name again, kept for an older bundle that reads `name || stageLabel`. */
  readonly stageLabel: string
  readonly marks: number
  readonly turnaround: string | null
  readonly warnings: readonly string[]
  /** Rendered verbatim — it is a legal qualification, not UI copy to paraphrase. */
  readonly caveat: string
  readonly confirmationToken: string
  readonly note: string
  readonly scope: ResolvedScope | null
  /**
   *  — the coverage limit at the moment money is committed.
   *
   * Null on every request where the register reaches everything a reader can name, which is the normal
   * state. Non-null means this search will be ordered over territories the wired register does not
   * reach: `reached` and `missing` are composer display names, and `note` is the server's sentence.
   */
  readonly coverage: { readonly reached: readonly string[]; readonly missing: readonly string[]; readonly note: string } | null
  /**
   * How much work this is, quoted by the SERVER from the resolved policy.
   *
   * The composer computes its own bar while the levers move (composerLevers.ts) because that has to be
   * instant; this is the authoritative figure, and it can differ where a lever does not survive the wire
   * — three script lanes and one both arrive as `prelim-jx`, and which lanes actually run is decided
   * server-side from the jurisdictions. At REVIEW the server's number wins, which is what that step is
   * for. `driver/effort-model.mjs` and `composerLevers.ts` are pinned together by
   * `test/effortModelParity.test.ts`, so the two can only differ where the INPUTS differ, never the math.
   *
   * `units` is 1–10 RELATIVE TO THIS ACCOUNT's own lightest and deepest search — never comparable across
   * accounts, never a billing quantity. null when the server could not size the request.
   */
  readonly effort: PlanEffort | null
}

export type PlanEffort = {
  /** Which weight set produced these numbers — a quote is only interpretable against its version. */
  readonly unitsVersion: number
  readonly units: number
  readonly costBand: number
  /** The absolute figure. Comparable across accounts, unlike `units`. */
  readonly raw: number
  readonly searches: number
  readonly turnaround: string
  readonly turnaroundHours: number
}

/**
 * A saved search, in full — the editable record, as against the `Searches['recipes']` row which is the
 * list view and carries only enough to draw a line in a table.
 *
 * `scope` is what makes this a saved SEARCH rather than a saved depth: "Zephyr Beverages knockouts — US focus"
 * is a label over base `knockout` plus scope `{jurisdictions:["US"]}`.
 */
export type SavedSearchDetail = {
  readonly slug: string
  readonly recipe: Record<string, unknown>
  /** The content hash the run freezes against, so editing mid-run is provably irrelevant to that run. */
  readonly sha: string
}

/**
 * What every LIST of saved searches carries, whichever endpoint listed it.
 *
 * Two endpoints list them — the config screen's own (`SavedSearchRow`, with the retired flag and the
 * timestamp a table needs) and the composer's menu (`Searches['recipes']`, with what a gate needs). Naming the overlap is what lets `sortSavedSearches` and `displayLabel` be written once
 * against the thin shape and still hand a caller its own richer row back.
 */
export type SavedSearchListing = {
  readonly slug: string
  readonly label: string
  readonly base: string
  readonly version: number | null
}

/** One row of the account's saved searches, as the config endpoint lists them. */
export type SavedSearchRow = SavedSearchListing & {
  readonly archived: boolean
  readonly updatedAt: string | null
}

/**
 * What an account has spent against its allowance.
 *
 * Caps are NULLABLE and null means "we cannot tell you your limit" — never zero, never unlimited.
 * `capped` is false for staff, who are deliberately not bound by a client's daily allowance.
 */
export type Usage = {
  readonly account: string
  readonly today: number
  readonly thisMonth: number
  readonly queued: number
  readonly dailyRuns: number | null
  readonly monthlyRuns: number | null
  readonly maxQueued: number | null
  readonly capped: boolean
}

/**
 * Connection details for the MCP connector.
 *
 * There is no credential here, and that is the design rather than an omission: client MCP access is the
 * caller's own Cloudflare Access login plus the grants entry that already governs this portal. `url` is
 * null when the deployment has no client MCP wired — never a placeholder host.
 */
/**
 * The AGPL §13 source offer, as the SERVER reports it.
 *
 * `commit` is nullable and the UI must not paper over a null. §13 obliges an operator running a
 * MODIFIED version to offer THAT version's source; a bare repository link presented as if it were the
 * running source is the failure this type exists to make visible. When commit is null, `sourceUrl`
 * falls back to the bare repo AND commit stays null, so the screen can say which it is.
 *
 * Nothing here is derived in the browser. The bundle cannot know its own commit — portal-ui/dist is
 * committed and CI fails when dist and source disagree, so a build-time define is circular.
 */
export type About = {
  readonly name: string
  readonly version: string | null
  readonly commit: string | null
  readonly sourceRepo: string
  readonly sourceUrl: string
  readonly license: string | null
  readonly copyright: string
}

export type McpAccess = {
  readonly url: string | null
  /** The API-key door — a DIFFERENT host, for assistants that cannot do a browser sign-in. */
  readonly keyUrl: string | null
  readonly email: string | null
  readonly enabled: boolean
  /**
   * The local stdio route, or null.
   *
   * Present for STAFF only, and composed SERVER-SIDE — the browser cannot know the install's own path,
   * which is what stops the three surfaces that state this route from drifting apart. Null for a hosted
   * client, who has no checkout to spawn a server from and for whom the command would be a false offer.
   */
  readonly stdio: { readonly command: string; readonly note: string; readonly verify: string } | null
  /**
   * Every assistant, ALREADY RESOLVED against this deployment.
   *
   * The browser used to hold its own client table and derive offered-versus-withheld from `url`,
   * `keyUrl` and `enabled`. Two tables on two different axes drifted before either shipped: the page
   * said Codex needs a key address, which is null on a local install, so it named a one-line command in
   * its own instructions and rendered none. The resolution now happens once, server-side, through
   * `shared/connect-clients.mjs`, and this is the answer.
   *
   * NO CREDENTIAL IS IN THIS TYPE, and its absence is deliberate rather than an oversight. The server's
   * `key` field is a MARKER — the string "issued" or "on-demand" — never a token, and it is not carried
   * here at all so that no render path can reach one by accident. This page's own rule is that a key is
   * never shown on it, because several colleagues load it under their own logins and one person's
   * credential would become everyone's. Whether a press may ever mint one is an open ruling; until it is
   * answered, the field does not exist on this side of the wire.
   */
  readonly offers: readonly ConnectOffer[]
}

/** One assistant's answer: what it needs, or why this deployment cannot serve it. */
export type ConnectOffer = {
  readonly id: string
  readonly name: string
  /** False ⇒ NOT A BUTTON. `reason` and `fix` are then both present, because an absence with no reason reads as breakage. */
  readonly served: boolean
  readonly route: string | null
  /**
   * The path a user of THAT vendor actually takes — "Settings → Connectors → Add custom connector".
   *: the page leads with this and demotes the command behind a fold. Resolved
   * server-side because the step that names an address must name the one this deployment resolved.
   */
  readonly steps: readonly string[]
  /**
   * A page a press can open so the reader lands in their assistant with the connector in front of them.
   *  settled 8. Null for every vendor today — the mechanism is built and the
   * table is deliberately empty, because a launch URL nobody has driven is a button that looks like it
   * works and does not.
   */
  readonly launch: { readonly url: string } | null
  /** A command or a config block to hand over — never contains a credential. */
  readonly command: string | null
  readonly address: string | null
  readonly note: string | null
  readonly reason: string | null
  readonly fix: string | null
  /** How this host takes the local route: a shell command, or a config block and where it goes. */
  readonly stdio: { readonly kind: string; readonly where: string | null; readonly after: string | null } | null
  /** True when connecting would turn something on that is off by default. */
  readonly opensADoor: boolean
}

/** What `/run` answers. `queued` is a promise to try, never a promise to finish. */
export type Accepted = {
  readonly id: string
  /**
   *  — the finished run a DEMO order resolved to, or null on every real order.
   *
   * Non-null means nothing was dispatched: no engine turn, no register call, no queue entry, no run
   * directory. The composer opens that report instead of saying a clearance has started, because the
   * ruling is explicit that the demo must "never pretend the run is new" — the report is dated as it is
   * and says on its own face that it is an example.
   */
  readonly landedOn: string | null
}

/**
 * The editable half of a brand owner's configuration.
 *
 * Deliberately loose (`Record<string, unknown>`) rather than a field-by-field type. The authoritative
 * key list lives in the engine (`KNOWN_PROFILE_KEYS`), the server strips what the UI may not send, and
 * a second hand-maintained list here would be a third place to forget a field. The screen renders the
 * keys it knows how to render and leaves the rest untouched — round-tripping an unknown field unchanged
 * is correct; silently dropping it because the UI had no input for it is the 2026-07-04 bug class.
 */
export type ProfileConfig = {
  readonly account: string
  readonly profile: Record<string, unknown>
  /**
   * The five fields the UI must never write: which framework RATES this client's matters, its worked
   * examples, the recipes they may run, the jurisdiction posture, the run caps. Shown badged and
   * read-only. The server strips them from every write, so this is display, not a soft control.
   */
  readonly readOnly: Record<string, unknown>
  readonly contextPack: string
  readonly framework: Record<string, unknown> | null
  readonly derived: Record<string, unknown> | null
}

/**
 * One project in the list.
 *
 * `archived` reaches CLIENTS as always-false: the tenancy wall filters archived projects out of a
 * client's list entirely, so a client never sees the flag set. Staff get the real value and the screen
 * greys those rows. Nothing is deleted either way — archive is a save with a flag.
 */
export type ProjectSummary = { readonly key: string; readonly name: string; readonly archived: boolean }

/**
 * One engine feature switch, as staff see it.
 *
 * `effect` is the field that stops this screen lying. `clarify` means the switch being off refuses the
 * request and tells the user; `silent-output-change` means the OUTPUT differs and nobody is told. The
 * second kind is the dangerous kind, and a screen that rendered them identically would be most
 * reassuring about exactly the flags most able to change a report unnoticed.
 */
export type Flag = {
  readonly name: string
  readonly on: boolean
  /** Explicitly set, versus never configured. They behave alike and read very differently. */
  readonly configured: boolean
  readonly effect: string
  /** Whether the admission gate actually consults this one. */
  readonly killSwitch: boolean
}

/**
 * Which engine runs the searches, and who is billed for them.
 *
 * `apiBilled` is the field to believe, not `mode`. They come apart in exactly one state and it is the
 * one worth showing: the engine is set to bill an API key that is not set, so `mode` says `api-key`
 * while the bill would fall on the subscription. The driver refuses a run in that state; this page is
 * how someone finds out before they start one. `billing.missing` names the variable to set.
 */
export type EngineState = {
  readonly id: string
  /** The vendor's name. Null ⇒ this build does not ship the engine the environment names — see `known`. */
  readonly vendor: string | null
  readonly known: boolean
  readonly billing: {
    readonly mode: string
    readonly apiBilled: boolean
    readonly missing: readonly string[]
  }
  /** Whether the binary every stage spawns can actually be found and executed. */
  readonly binaryPresent: boolean
}

/**
 * One provider a search depends on, and whether this instance can reach it.
 *
 * A provider that is NOT configured is a row with `configured: false`, never an omitted row — a page
 * listing two providers is indistinguishable from a page listing a complete set of two, so an absence
 * would be invisible at the one surface whose job is to show it. `missing` names the variables to set,
 * in this release's spelling. Never a value.
 */
export type ProviderState = {
  readonly key: string
  readonly label: string
  /** The selected provider's id, or null when none is selected — a fresh install's register row. */
  readonly provider: string | null
  readonly providerLabel: string | null
  /** False ⇒ the environment names a provider this build does not ship. A typo, not an unmade choice. */
  readonly known: boolean
  readonly configured: boolean
  readonly missing: readonly string[]
  /**
   *  — what to DO about this row, when "set these variables" is not the answer.
   *
   * A case-law source is enrolled by a one-time OAuth sign-in, so it has no credential to be missing and
   * the composed "Set X and Y" sentence would name nothing. A capability the build does not ship has no
   * remedy at all, and says so. Null ⇒ the row's own `missing` list is the whole answer, as before.
   */
  readonly remedy: string | null
}

/**
 * The portal's own door — the ONE row on the config page that is not snapshot-derived.
 *
 * `PORTAL_AUTH_MODE` is read by the portal service itself, so the portal is authoritative for it and
 * serves it live. Every other field on `FlagView` is the engine's answer, written to a snapshot; this
 * one is this service's answer about itself, and the screen labels the difference because the page's
 * standing notice claims everything on it was written by the engine.
 *
 * Never carries the audience, a secret, the token header's contents, or local mode's single address.
 */
export type AuthState = {
  /** The effective mode. Reported verbatim — never a pinned string, so 's rename needs no edit. */
  readonly mode: string
  /** What was explicitly configured. Null ⇒ nobody set it and the service's default applies. */
  readonly declared: string | null
  readonly shape: 'fronted' | 'local' | 'unrecognised'
  /** The configured issuer, or null. Never the audience. */
  readonly issuer: string | null
  /** Names the variable to set. A real state, never an omitted row — same rule as the providers. */
  readonly missing: readonly string[]
}

export type Disagreement = {
  readonly what: string
  readonly capture: string | null
  readonly live: string | null
  readonly effect: string | null
}

export type LastRun = {
  readonly capturedAt: string | null
  readonly disagrees: readonly Disagreement[] | null
}

export type FlagView = {
  /** False ⇒ no snapshot. NOT the same as "everything off", and never rendered as such. */
  readonly available: boolean
  readonly note: string | null
  /**
   * WHICH READING THIS PAGE IS SHOWING. `live` is the deployment's own configuration, read at request
   * time, and is the answer (owner ruling 2026-09-05). `capture` means the service could not derive a
   * live posture and this is what the last run recorded — said out loud, because presenting an old
   * reading as current fact without naming it is the defect that ruling was made about.
   */
  readonly source: 'live' | 'capture' | null
  /**
   * What the LAST RUN saw, and where it disagrees with the live reading above. Secondary by design.
   * `disagrees` is `[]` when the last run ran under this same configuration, rows when it did not, and
   * `null` when nothing was compared — three facts, and the page must not render the third as the first.
   * `lastRun` itself is null when no run has ever recorded a capture here.
   */
  readonly lastRun: LastRun | null
  readonly built: Record<string, unknown> | null
  readonly flags: readonly Flag[]
  /**
   * Null ⇒ THE SNAPSHOT DOES NOT SAY — it was written before the engine recorded this, which is every
   * snapshot on every box until that deployment's driver next drains. It does NOT mean "nothing is
   * configured": an unconfigured instance sends rows, each saying so. Rendering null as an empty list
   * would tell a staff member the opposite of the truth, so the screen states this case in words.
   */
  readonly engine: EngineState | null
  readonly providers: readonly ProviderState[] | null
  /**
   * Null ⇒ this build's portal did not send it. Distinct from every other null here: those mean "an
   * older SNAPSHOT did not record it", this means an older PORTAL did not serve it. Both are "cannot
   * tell", neither is "no auth", and the screen says so in words rather than rendering a blank row.
   */
  readonly auth: AuthState | null
}

export type Person = {
  readonly email: string
  readonly tenant: string
  readonly accounts: readonly string[]
  /** Accounts granted that this person's own tenant does not hold. A typo; fails as a silent 404. */
  readonly dangling: readonly string[]
  readonly wildcard: boolean
}

export type AccessView = {
  readonly note: string
  readonly staffDomains: readonly string[]
  readonly unknownAccounts: readonly string[]
  readonly people: readonly Person[]
  /** Where access is actually changed. Null when the file could not be stat'd — never a guess. */
  readonly grantsFile: { readonly name: string; readonly modifiedAt: string } | null
}

/** One identity seen in the activity log. NOT an access record — see ObservedView. */
export type ObservedPerson = {
  readonly email: string
  readonly events: Readonly<Record<string, number>>
  readonly accounts: readonly string[]
  readonly firstSeen: string | null
  readonly lastSeen: string | null
  readonly count: number
}

/**
 * Who has actually USED this instance lately.
 *
 * The access list can only ever show CLIENTS, because staff are admitted by an email-domain rule and
 * have no per-person record to list. This is the other direction, and it is what puts a colleague's
 * name on the screen at all.
 *
 * `available: false` is a normal state, not an error: the log may be missing, unreadable or not
 * configured, and the panel says so while the rest of the page carries on.
 */
export type ObservedView = {
  readonly available: boolean
  /** True when only the tail of a long log was read. */
  readonly truncated: boolean
  readonly note: string | null
  readonly people: readonly ObservedPerson[]
}

/**
 * One project overlay, beside what it inherits.
 *
 * `overlay` is what this project actually sets; `inherited` is the customer's value; `effective` is the
 * merge the engine would use; `origins` says which level each effective value came from. All four are
 * needed to render honestly — showing only `effective` would make an inherited value look like a
 * project decision, and showing only `overlay` would leave most fields looking empty.
 */
export type ProjectDetail = {
  readonly customer: string
  readonly customerName: string
  readonly project: string
  readonly overlay: Record<string, unknown>
  readonly contextPack: string
  readonly inherited: Record<string, unknown>
  readonly effective: Record<string, unknown>
  readonly origins: Record<string, unknown>
  readonly derived: Record<string, unknown> | null
}

/**
 * Whether this deployment can read a pasted brief into the form.
 *
 * Rides the capability payload the composer already fetches. Fails DARK — absent ⇒ unavailable —
 * which is the opposite of `Product.available` above and deliberately so: a level's real wall is
 * the plan gate, so guessing available costs a clear error message at worst, whereas an enabled Read
 * button with nothing behind it fails on the press, after the user has typed their brief.
 */
export type ReadCapability = {
  readonly available: boolean
  readonly maxBrief: number
  /** Why not, in words a client can read. Never names a credential or a variable. Null when available. */
  readonly note: string | null
}

export type Searches = {
  readonly account: string
  readonly products: readonly Product[]
  /**
   * The saved searches this account may run — the LIST view, enough to draw a row and to gate it.
   *
   * `base` names the PRODUCT the saved search runs, and `nativeLanguage` whether it bought the one
   * toggle. Both are on the row because the composer has to say what geography a saved search accepts
   * while the row is being chosen, not after: a recipe is selected with a click and the next thing on
   * screen is a live Review button. Absent ⇒ false, which fails OPEN — the same direction `available`
   * fails. This gate is invitation control; the engine's own door is the wall.
   */
  readonly recipes: readonly (SavedSearchListing & { readonly nativeLanguage: boolean })[]
  /**
   * The longest a mark NAME may be, from the server.
   *
   * Sent rather than known here, for the reason `read.maxBrief` is: the intake refuses on this number
   * at every door, and a second copy in the client is the one that drifts. Absent ⇒ null, and the
   * screen then states no limit and lets the server refuse — the honest reading of a server that does
   * not send it, and the same fail-open direction the product list takes.
   */
  readonly maxMarkName: number | null
  readonly read: ReadCapability
  /**
   * Which territories the register wired to THIS deployment can actually search, as composer
   * display names. THREE states, and collapsing any two is the bug this field exists to avoid:
   *
   *   `null`      — the register declares NO restriction. Offer every territory.
   *   `[...]`     — exactly these. Anything else is searched by no register.
   *   `undefined` — the server did not say. FAIL OPEN and offer everything, exactly as `available` does.
   *
   * The trap has a name and it is `covered ?? []`, which turns both "unrestricted" and "did not say"
   * into "nothing" and offers a client ZERO territories on a production deployment — where the wired
   * provider is a global aggregator that declares `null` on purpose.
   *
   * Computed SERVER-SIDE and sent as display names. Five vocabularies sit between a name on this form
   * and an office code, and the office half is a per-provider FUNCTION that cannot ride JSON — so this
   * is not a list the browser could rebuild even if it wanted to.
   */
  readonly registerTerritories?: readonly string[] | null
}

// ── decoding ─────────────────────────────────────────────────────────────────────────────────────────

const asString = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const asNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const asArray = (v: unknown): readonly unknown[] => (Array.isArray(v) ? v : [])
/** A plain object, or an empty one. Arrays are NOT objects here — an array where a map was expected is a bug, not data. */
const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

const asBands = (v: unknown): readonly Band[] => {
  const out: Band[] = []
  for (const raw of asArray(v)) {
    if (typeof raw !== 'object' || raw === null) continue
    const r = raw as Record<string, unknown>
    const label = asString(r['label'])
    const tone = asTone(r['tone'])
    // A rung with no label or an unrecognised tone is dropped rather than guessed. A ladder is a legal
    // artefact; a fabricated rung on it would be worse than a short ladder.
    if (label && tone) out.push({ label, tone })
  }
  return out
}

const asRunState = (v: unknown): RunState => {
  switch (v) {
    case 'queued':
    case 'running':
    case 'paused':
    case 'delivered':
    case 'failed':
    // Stopped by someone, on purpose. Terminal and distinct from 'failed': nothing went wrong, and a
    // row that said it did would be telling the person who pressed Stop that their search broke.
    case 'cancelled':
      return v
    // The engine's own park vocabulary. The server maps these to 'paused' before they reach here, so
    // this is the belt: a deployment mid-upgrade, where an older portal-service is still forwarding the
    // raw state, must not render a five-hour pause as "Running".
    case 'postponed':
    case 'recovering':
    case 'parked-for-human':
      return 'paused'
    default:
      // Unknown states are treated as in-flight, never as finished. Showing a run as Finished when it is
      // not is the one direction of this error that matters: it invites someone to go read a report that
      // does not exist yet.
      return 'running'
  }
}


/** A YYYY-MM-DD embedded in a run id — the publish stamp, which is authoritative when meta has none. */
const dateFromRunId = (runId: string): string | null => {
  const m = /(\d{4}-\d{2}-\d{2})/.exec(runId)
  return m?.[1] ?? null
}

/**
 * The date to show. Falls back to the run id's stamp when the metadata's is missing or a placeholder.
 * Returns null rather than guessing when neither is available — a row with no date is honest; a row
 * with a plausible wrong one is not.
 */
export const usableDate = (metaDate: string | null, runId: string): string | null => {
  if (metaDate && /^\d{4}-\d{2}-\d{2}/.test(metaDate)) return metaDate
  return dateFromRunId(runId)
}

const decodeRun = (raw: unknown): Run | null => {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const runId = asString(r['runId'])
  if (!runId) return null
  const bands = asBands(r['bands'])
  return {
    runId,
    account: asString(r['account']) ?? '',
    title: asString(r['title']) ?? runId,
    markName: asString(r['markName']),
    projectKey: asString(r['projectKey']),
    projectName: asString(r['projectName']),
    product: asString(r['product']),
    stageLabel: asString(r['stageLabel']),
    productName: asString(r['productName']),
    kind: r['kind'] === 'knockout-batch' ? 'knockout-batch' : 'clearance',
    state: asRunState(r['state']),
    pausedKind: r['pausedKind'] === 'rate-limit' || r['pausedKind'] === 'recovering' || r['pausedKind'] === 'operator' ? r['pausedKind'] : null,
    resetsAt: asString(r['resetsAt']),
    startedAt: asString(r['startedAt']),
    // A run whose metadata carries no usable date still HAS one: the pool directory is stamped with it
    // at publish. One live run reads literally "undated", and repeating that back is useless to someone
    // scanning a list — while inventing today's date would be worse, so the fallback only ever reads a
    // date that is already part of the run's own identity.
    date: usableDate(asString(r['date']), runId),
    // No fallback and no repair: a missing ordering key must read as MISSING, so a consumer falls back
    // to `date` deliberately rather than being handed a fabricated instant that sorts wrong.
    issuedAt: asString(r['issuedAt']),
    band: asString(r['band']) ?? asString(r['overall']),
    tone: asTone(r['tone']),
    bands,
    marks: asArray(r['marks'])
      .map((m) => {
        if (typeof m !== 'object' || m === null) return null
        const mm = m as Record<string, unknown>
        const name = asString(mm['name'])
        return name ? { name, band: asString(mm['band']), tone: asTone(mm['tone']) } : null
      })
      .filter((m): m is { name: string; band: string | null; tone: Tone | null } => m !== null),
    reportSchema: asNumber(r['reportSchema']),
    held: r['held'] === true,
    report: asString(r['report']),
    reports: Array.isArray(r['reports'])
      ? (r['reports'] as unknown[]).flatMap((x) => {
          const row = x as Record<string, unknown>
          const path = asString(row['path'])
          return path ? [{ mark: asString(row['mark']), slug: asString(row['slug']), path }] : []
        })
      : [],
    step: asString(r['step']),
    stopRequestedAt: asString(r['stopRequestedAt']),
    stepN: asNumber(r['stepN']),
    stepTotal: asNumber(r['stepTotal']),
    reason: asString(r['reason']),
    failedStage: asString(r['failedStage']),
    reasonDetail: asString(r['reasonDetail']),
    acked: r['acked'] === true,
    // Only a queued row has a place in line. Pinning it to the state here means a stale or
    // mis-stamped position can never survive onto a running card as a phantom ordinal.
    queuePos: asRunState(r['state']) === 'queued' ? asNumber(r['queuePos']) : null,
  }
}

/** Pull the human-readable errors out of a body without ever inventing one. */
const errorsOf = (body: Record<string, unknown>): string[] => {
  const list = asArray(body['errors']).filter((e): e is string => typeof e === 'string')
  if (list.length) return list
  const one = asString(body['error'])
  return one ? [one] : ['The request could not be completed.']
}

/**
 * Map an HTTP response onto the union. This is the whole 404-never-403 rule in one switch: 403 and 404
 * both land on `notFound`/`noAccess` and neither produces anything a component could render as
 * "forbidden".
 */
function decodeStatus<T>(status: number, body: Record<string, unknown>): Result<T> | null {
  switch (status) {
    case 400: {
      // portal-service answers 400 when a staff identity has not said who they are acting for. That is a
      // UI state (show the account picker), not an error to print at someone.
      const msg = asString(body['error']) ?? ''
      if (/name an account/i.test(msg)) return { kind: 'pickAccount' }
      return { kind: 'reject', errors: errorsOf(body) }
    }
    case 401:
      // — the session is gone or was never established. Every other status here
      // describes something about the REQUEST; this one describes the caller, and the only useful thing
      // a screen can do with it is send the reader to sign in.
      return { kind: 'signedOut' }
    case 403:
      // Reachable only for door checks — a signed-in identity with no grants at all. Anything
      // tenant-scoped answers 404 instead, and that asymmetry is deliberate.
      return { kind: 'noAccess' }
    case 404:
      // — one 404 is NOT a tenancy answer. The config surface failing to construct on
      // this deployment is the same answer for every admitted identity, so naming it separates no account
      // from any other and the 404-never-403 rule is untouched. Everything else here stays deliberately
      // indistinguishable.
      if (asString(body['error']) === 'config_surface_unavailable') return { kind: 'surfaceUnavailable' }
      return { kind: 'notFound' }
    case 409: {
      // ── READ BOTH SPELLINGS (tracker issue 94, finding F14) ────────────────────────────────────────
      //
      // The server writes a refusal under `error` in most places and under `errors[]` in others, and
      // this branch read only the singular — so the one 409 a first-time visitor is most likely to meet,
      // the demo being asked for a search it carries no report for, arrived as "This action could not be
      // completed." The server had written three sentences explaining exactly where they were and what
      // to pick instead, and the screen threw them away. `errorsOf` is the reader every other branch
      // here already uses; its own fallback is the last resort rather than the first.
      const msg = errorsOf(body)[0] ?? 'This action could not be completed.'
      return /version|conflict/i.test(msg) && !/confirmation|plan again|re-confirm/i.test(msg)
        ? { kind: 'conflict', message: msg }
        : { kind: 'gate', message: msg }
    }
    case 413:
      return { kind: 'tooLarge' }
    case 422: {
      const classify = body['classify']
      if (classify != null) {
        const questions = asArray((classify as Record<string, unknown>)['questions'])
          .filter((q): q is string => typeof q === 'string')
        return { kind: 'clarify', questions: questions.length ? questions : errorsOf(body) }
      }
      return { kind: 'collision', errors: errorsOf(body) }
    }
    case 429:
      return { kind: 'rateLimited' }
    default:
      if (status >= 500) return { kind: 'upstream', message: asString(body['error']) ?? `Server error (${status}).` }
      return null
  }
}

/**
 * ── — A SESSION THAT ENDS MID-VISIT ────────────────────────────────────────
 *
 * `AppShell` loads `me` once, with empty deps, and never asks again. So it decides `signedOut` at MOUNT
 * and only there: a reader whose session goes while they are working meets whatever the screen they are
 * on says about its own failed load — "The settings could not be loaded just now" — which is never a
 * spinner and never the words "sign in" either. asked for the redirect to live
 * in one place rather than per screen; the shell was the right place for the first-load path and cannot
 * see this one.
 *
 * THIS IS THAT ONE PLACE, and it is here rather than in `useLoad` because `useLoad` is not the only
 * caller: every save, every admin action and every poll goes through `call`, and a session can end on
 * any of them. A hook can only see the loads that use it.
 *
 * ONE SUBSCRIBER, deliberately. The shell is the only thing that can answer a gone session — it owns
 * the whole tree, and two subscribers would mean two answers to one event. Registering a second
 * replaces the first, which is what a remount must do.
 *
 * IT DOES NOT NAVIGATE. Sending the browser somewhere from inside the fetch layer would discard an
 * unsaved form the moment a poll came back 401, and the reader would never see what happened. It
 * announces; the shell decides what to render.
 */
let sessionEndedSubscriber: (() => void) | null = null

export function onSessionEnded(fn: () => void): () => void {
  sessionEndedSubscriber = fn
  return () => {
    if (sessionEndedSubscriber === fn) sessionEndedSubscriber = null
  }
}

async function call<T>(path: string, decode: (body: Record<string, unknown>) => T, init?: RequestInit): Promise<Result<T>> {
  let res: Response
  try {
    res = await fetch(path, {
      credentials: 'same-origin',
      ...init,
      headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers },
    })
  } catch (e) {
    // Offline, DNS, a dropped tunnel. Distinct from a 5xx: nothing reached the server, so a retry is
    // free of side effects.
    return { kind: 'upstream', message: e instanceof Error ? e.message : 'The portal could not be reached.' }
  }

  let body: Record<string, unknown> = {}
  try {
    const text = await res.text()
    if (text) body = JSON.parse(text) as Record<string, unknown>
  } catch {
    if (res.ok) return { kind: 'upstream', message: 'The server sent a response the portal could not read.' }
  }

  const mapped = decodeStatus<T>(res.status, body)
  // Announced from the ONE place every request already funnels through, so it covers a load, a save, a
  // poll and an admin action alike — and the result is still returned unchanged, because the caller that
  // asked still has a branch to render and must not be left holding a promise that never resolves.
  if (mapped?.kind === 'signedOut') sessionEndedSubscriber?.()
  if (mapped) return mapped
  if (!res.ok) return { kind: 'upstream', message: asString(body['error']) ?? `Unexpected response (${res.status}).` }
  return { kind: 'ok', value: decode(body) }
}

const accountQuery = (account: string | null) => (account ? `?account=${encodeURIComponent(account)}` : '')

/**
 * The read capability, defaulting to UNAVAILABLE.
 *
 * A server that predates this field sends nothing, and the honest reading of nothing is "this portal
 * cannot read a brief" — which is exactly true of that server. See the type's note for why this one
 * field fails dark where the level menu fails available.
 */
const decodeReadCapability = (v: unknown): ReadCapability => {
  const r = asRecord(v)
  return {
    available: r['available'] === true,
    maxBrief: asNumber(r['maxBrief']) ?? 12000,
    note: asString(r['note']),
  }
}

/**
 * The read itself.
 *
 * Totally defensive: every field falls back to its empty value rather than throwing, because a brief
 * that half-read still leaves the user better off than an error where their paragraph used to be. The
 * The PRODUCT falls back to null rather than to a guess: a dropped field must never quietly buy someone
 * a different search, in either direction.
 */
const decodeRead = (v: unknown): BriefRead => {
  const r = asRecord(v)
  return {
    names: asStrings(r['names']),
    classes: asArray(r['classes']).filter((c): c is number => typeof c === 'number'),
    goods: asString(r['goods']) ?? '',
    territories: asStrings(r['territories']),
    // WORLDWIDE AS A STATED FACT, not as an empty list. A brief that says "everywhere" and a brief that
    // says nothing about geography fill the same empty `territories`, and they are different searches.
    worldwide: r['worldwide'] === true,
    // WHICH PRODUCT the brief describes, when it describes one clearly enough to say. Null is the honest
    // answer otherwise, and the composer then asks — it never picks the deepest, or the cheapest.
    product: asString(r['product']),
    ref: asString(r['ref']) ?? '',
    deadline: asString(r['deadline']) ?? '',
    notes: asStrings(r['notes']),
  }
}

const asStrings = (v: unknown): readonly string[] => asArray(v).filter((x): x is string => typeof x === 'string')

/**
 * The resolved scope block, or null when the server did not send one.
 *
 * Null rather than an empty shape on purpose: an empty scope and an unresolvable one look the same in a
 * `{jurisdictions: []}` object, and the review step must be able to tell "searching nowhere in
 * particular" from "we could not work out where this points" — it says nothing in the second case.
 */
const decodeScope = (v: unknown): ResolvedScope | null => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const r = v as Record<string, unknown>
  return {
    jurisdictions: asStrings(r['jurisdictions']),
    jurisdictionsFrom: asString(r['jurisdictionsFrom']) ?? '',
    classes: asArray(r['classes']).filter((c): c is number => typeof c === 'number'),
    classesFrom: asString(r['classesFrom']) ?? '',
    platforms: asStrings(r['platforms']),
    platformsAdded: asStrings(r['platformsAdded']),
    platformsFrom: asString(r['platformsFrom']) ?? '',
    gridCellsPerVariant: asNumber(r['gridCellsPerVariant']),
  }
}

// null rather than a partial object when the server could not size the request: a bar drawn from
// half-decoded numbers would be indistinguishable from a real one.
const decodeEffort = (v: unknown): PlanEffort | null => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const r = v as Record<string, unknown>
  const units = asNumber(r['units'])
  const version = asNumber(r['unitsVersion'])
  if (units == null || version == null) return null
  return {
    unitsVersion: version,
    units,
    costBand: asNumber(r['costBand']) ?? 1,
    raw: asNumber(r['raw']) ?? 0,
    searches: asNumber(r['searches']) ?? 1,
    turnaround: asString(r['turnaround']) ?? '',
    turnaroundHours: asNumber(r['turnaroundHours']) ?? 0,
  }
}

export const api = {
  me: (): Promise<Result<Me>> =>
    call('/portal/api/me', (b) => ({
      role: b['role'] === 'staff' ? 'staff' : 'client',
      email: asString(b['email']) ?? '',
      accounts: asArray(b['accounts']).filter((a): a is string => typeof a === 'string'),
      allAccounts: b['accounts'] === '*',
      // Only string→string pairs survive. A malformed entry is dropped rather than rendered, because
      // the fallback (the key) is always correct and "[object Object]" beside a brand owner is not.
      accountNames: Object.fromEntries(
        Object.entries(asRecord(b['accountNames'])).filter(([, v]) => typeof v === 'string' && v),
      ) as Readonly<Record<string, string>>,
      concurrentRuns: asNumber(b['concurrentRuns']),
      // Only the two values a caller may act on survive. Anything else — 'engine-ready' from a future
      // server, a typo, a missing field on an older portal-service — lands as null, which every caller
      // treats as "leave the button alone". Widening this to pass strings through would let an
      // unrecognised value reach a comparison that reads it as demo.
      engineMode: b['engineMode'] === 'demo' ? 'demo' : b['engineMode'] === 'engine-unproven' ? 'engine-unproven' : null,
      brand: typeof b['brand'] === 'string' ? b['brand'] : '',
      // — a control the deployment cannot serve says so instead of always failing.
      // Absent field (an older portal-service) ⇒ available: the button behaves exactly as before.
      stopControl: (() => {
        const c = asRecord(asRecord(b['controls'])['stop'])
        return { available: c['available'] !== false, reason: asString(c['reason']) }
      })(),
    })),

  /**
   * Runs for one brand owner, or for ALL of them.
   *
   * `'*'` is the staff "All brand owners" view and is answered in a single pass over the pool. Asking
   * the browser to fan out across the roster instead would spend a roster-sized slice of the 120/min
   * rate limit on every poll. A client who sends `'*'` gets a 404, the same as any account not theirs.
   */
  runs: (account: string | null): Promise<Result<readonly Run[]>> =>
    call(`/portal/api/runs${accountQuery(account)}`, (b) =>
      asArray(b['runs'])
        .map(decodeRun)
        .filter((r): r is Run => r !== null),
    ),

  /**
   * Runs across every brand owner this identity holds — one call, whoever is asking.
   *
   * Staff get every account; a client gets exactly its own. The REQUEST IS IDENTICAL either way, which
   * is the point: a screen that is account-scoped rather than owner-scoped never has to ask who is
   * looking, and there is no staff layout to diverge from a client one.
   *
   * Deliberately NOT `runs('*')`. The wildcard means one thing — every account in the deployment,
   * staff only — and overloading it would make `'*'` look like a harmless default worth sending
   * everywhere. Two capabilities, two names.
   */
  runsMine: (): Promise<Result<readonly Run[]>> =>
    call('/portal/api/runs?scope=mine', (b) =>
      asArray(b['runs'])
        .map(decodeRun)
        .filter((r): r is Run => r !== null),
    ),

  /**
   *  — THE CROSS-MARK PARAGRAPH for a run published over several names.
   *
   * A knockout over several names has no combined document, so the one piece of prose that reads the
   * names against each other is written to the run's `report.md` and, until this route existed, reached
   * nobody: the published list names the per-mark documents only. Owner ruling 2026-08-26: the grouped
   * page carries it.
   *
   * ITS OWN CALL RATHER THAN A FIELD ON THE RUN, because the run row is what every screen that lists
   * runs already fetches, and none of them render this. It is asked for once, by the one screen that
   * shows it.
   *
   * `notFound` is the ordinary answer and covers every absence at once — a run with one document (its
   * assessment is inside the document the screen frames), a grouped run whose summary was composed
   * empty, and a run that is not the caller's. The screen renders no panel for any of them, which is
   * the honest rendering of "there is none".
   *
   * The paragraphs carry inline markdown. Read them with `inlineSpans` — never as HTML.
   */
  runSummary: (runId: string): Promise<Result<readonly string[]>> =>
    call(`/portal/api/run/${encodeURIComponent(runId)}/summary`, (b) =>
      asArray(b['summary']).filter((p): p is string => typeof p === 'string' && p.trim() !== ''),
    ),

  /**
   *  — put a stopped run down, for this reader only.
   *
   * Not a state change, not a delete, and not 's retire: nothing about the run moves and no other
   * reader is affected. `state` is the state you are dismissing it in — the server keys on it, so a run
   * that leaves that state reappears rather than staying hidden.
   */
  acknowledge: (input: { runId: string; state: Run['state']; acknowledged: boolean }): Promise<Result<unknown>> =>
    call('/portal/api/ack', (b) => b, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /**
   * Stop a run that has already started. Terminal and unrecoverable — partial work is not deliverable.
   *
   * NOT INSTANT, and the copy at the call site must not pretend otherwise: the run ends at its next
   * step boundary, a step already under way finishes, and what it has spent is spent.
   */
  /**
   * ──  — TWO STOPS, AND THE ANSWER SAYS WHICH ONE HAPPENED ──────────────────
   *
   * `immediate` is the reader's answer to the question at the press: end the step in flight, or let it
   * finish. It is sent explicitly on both paths rather than omitted for the default, so a reader who
   * chose the safe one is as legible in the audit row as one who chose the other.
   *
   * `stop.mode` is what ACTUALLY happened, and it is not always what was asked: an immediate stop that
   * finds no turn to end becomes a boundary stop, and the driver reports it as one. The screen must
   * read this rather than the press — presenting a fallback as an immediate stop is the same silence
   * this issue was opened about, one layer along.
   */
  stopRun: (runId: string, account: string, opts: { readonly immediate: boolean }): Promise<Result<StopOutcome>> =>
    call(`/portal/api/run/${encodeURIComponent(runId)}/stop${accountQuery(account)}`, (b) => {
      const st = asRecord(b['stop'])
      return {
        action: asString(b['action']),
        // Absent, or anything but the immediate token, is the boundary stop. An older server sends no
        // `stop` block at all and its behaviour WAS the boundary stop, so that is the honest default.
        mode: asString(st['mode']) === 'immediate' ? 'immediate' as const : 'boundary' as const,
        note: asString(st['note']),
      }
    }, {
      method: 'POST',
      body: JSON.stringify({ immediate: opts.immediate === true }),
    }),

  /**
   * Cancel a job that has not started. Nothing ran, so nothing is charged and no row is left behind.
   *
   * Can lose a race with the runner: a 409 with `action: 'already-claimed'` means it started between
   * the click and the request. That is a race, not an error — re-read the list and it is a running run.
   */
  cancelQueued: (id: string, account: string): Promise<Result<{ readonly action: string | null }>> =>
    call(`/portal/api/queue/${encodeURIComponent(id)}/cancel${accountQuery(account)}`, (b) => ({ action: asString(b['action']) }), {
      method: 'POST',
    }),

  /** Set the order queued jobs are admitted in. Only the caller's own jobs move; nobody else's position changes. */
  reorderQueue: (order: readonly string[], account: string): Promise<Result<{ readonly order: readonly string[] }>> =>
    call(`/portal/api/queue/order${accountQuery(account)}`, (b) => ({ order: asArray(b['order']).filter((s): s is string => typeof s === 'string') }), {
      method: 'POST',
      body: JSON.stringify({ order: [...order] }),
    }),

  searches: (account: string | null): Promise<Result<Searches>> =>
    call(`/portal/api/searches${accountQuery(account)}`, (b) => ({
      account: asString(b['account']) ?? '',
      // — null when the server does not send it. See the type's note.
      maxMarkName: asNumber(b['maxMarkName']),
      products: asArray(b['products']).map((l) => {
        const r = l as Record<string, unknown>
        return {
          key: asString(r['key']) ?? '',
          // Empty rather than null, so a call site can write `p.name || p.stageLabel` and get a string
          // from an older server without a null check at every one of them.
          name: asString(r['name']) ?? '',
          stageLabel: asString(r['stageLabel']) ?? '',
          pipeline: asString(r['pipeline']) ?? '',
          components: asArray(r['components']).filter((c): c is string => typeof c === 'string'),
          geography: asString(r['geography']) ?? '',
          caseLaw: r['caseLaw'] === true,
          nativeLanguage: asString(r['nativeLanguage']) ?? 'absent',
          // The OFFERING'S figure, never a default this file invents. 1 is the safe direction if a server
          // omits it — the screen refuses a batch it could have sent, rather than sending one the wall
          // refuses after the composing is done.
          maxNames: asNumber(r['maxNames']) ?? 1,
          baseTurnaround: asString(r['baseTurnaround']),
          baseTurnaroundHours: asNumber(r['baseTurnaroundHours']),
          orderable: r['orderable'] !== false,
          // Absent ⇒ available. See the field's note: an older server must not grey out the whole menu.
          available: r['available'] !== false,
          unavailableNote: asString(r['unavailableNote']),
          coverageNote: asString(r['coverageNote']),
          capabilityNote: asString(r['capabilityNote']),
        }
      }),
      // Tri-state, decoded in the one order that keeps the three apart: absent stays absent (fail open),
      // an explicit null stays null (unrestricted), and anything else must be an array of strings.
      ...(!('territories' in b)
        ? {}
        : { registerTerritories: b['territories'] === null
          ? null
          : asArray(b['territories']).filter((t): t is string => typeof t === 'string') }),
      recipes: asArray(b['recipes']).map((x) => {
        const r = x as Record<string, unknown>
        return {
          slug: asString(r['slug']) ?? '',
          label: asString(r['label']) ?? '',
          base: asString(r['base']) ?? '',
          version: asNumber(r['version']),
          // Only true means anything, here as at the recipe door: the toggle can add the native-language
          // investigation and can never take one away, so an older server that omits it says "not asked".
          nativeLanguage: r['nativeLanguage'] === true,
        }
      }),
      read: decodeReadCapability(b['read']),
    })),

  /**
   * Read a pasted brief into a filled-in composer. Spends nothing on a search.
   *
   * The odd one out among the POSTs here: it mints no token, queues nothing and cannot start a run —
   * it answers with a draft. Everything it fills in is an ordinary editable field afterwards, and the
   * plan gate and review dialog are still ahead of it, unchanged.
   */
  // `feedback` was here and is retired. The endpoint answers 410, so a client method for
  // it would be a method whose only outcome is a refusal.

  composeRead: (brief: string): Promise<Result<BriefRead>> =>
    call('/portal/api/compose/read', (b) => decodeRead(b['read']), {
      method: 'POST',
      body: JSON.stringify({ brief }),
    }),

  /**
   * Preview what a search WOULD do. Spends nothing.
   *
   * The returned token is one-shot and short-lived, and it is bound to this exact request — changing
   * a class or a word after previewing invalidates it, and `run` will answer 409 rather than quietly
   * running something the user never saw. That is the whole reason this is two calls and not one.
   */
  plan: (account: string | null, body: Readonly<Record<string, unknown>>): Promise<Result<Plan>> =>
    call(
      '/portal/api/run/plan',
      (b) => ({
        account: asString(b['account']) ?? '',
        name: asString(b['name']) ?? '',
        stageLabel: asString(b['stageLabel']) ?? '',
        marks: asNumber(b['marks']) ?? 1,
        turnaround: asString(b['turnaround']),
        warnings: asArray(b['warnings']).filter((w): w is string => typeof w === 'string'),
        caveat: asString(b['caveat']) ?? '',
        confirmationToken: asString(b['confirmationToken']) ?? '',
        note: asString(b['note']) ?? '',
        scope: decodeScope(b['scope']),
        //. Absent on an older server and on every deployment whose register
        // reaches everything a reader can name — both mean "nothing to disclose", which is why the
        // decode is a plain null rather than the tri-state `registerTerritories` needs.
        coverage: (() => {
          const c = b['coverage']
          if (!c || typeof c !== 'object') return null
          const r = c as Record<string, unknown>
          const note = asString(r['note'])
          if (!note) return null
          return {
            reached: asArray(r['reached']).filter((x): x is string => typeof x === 'string'),
            missing: asArray(r['missing']).filter((x): x is string => typeof x === 'string'),
            note,
          }
        })(),
        effort: decodeEffort(b['effort']),
      }),
      { method: 'POST', body: JSON.stringify({ ...body, ...(account ? { account } : {}) }) },
    ),

  /**
   * THE SPEND DOOR. Everything else in this file is free; this one is not — except on a demo, where the
   * server resolves the confirmation to a report that already exists and spends nothing.
   *
   * `landedOn` is how the client learns which happened, and it is the SERVER's answer rather than the
   * client's inference. That matters: a browser that decided for itself that it was in a demo could
   * open a report instead of starting a clearance on a deployment that is not one. Null on every real
   * order, which is every order on every install that is not a demo.
   */
  run: (account: string | null, body: Readonly<Record<string, unknown>>): Promise<Result<Accepted>> =>
    call(
      '/portal/api/run',
      (b) => ({ id: asString(b['id']) ?? '', landedOn: asString(b['landedOn']) }),
      { method: 'POST', body: JSON.stringify({ ...body, ...(account ? { account } : {}) }) },
    ),

  /** The brand owner's configuration. The account is resolved server-side from who you signed in as. */
  profile: (account: string | null): Promise<Result<ProfileConfig>> =>
    call(`/portal/api/config/profile${accountQuery(account)}`, (b) => ({
      account: asString(b['account']) ?? '',
      profile: asRecord(b['profile']),
      readOnly: asRecord(b['readOnly']),
      contextPack: typeof b['contextPack'] === 'string' ? b['contextPack'] : '',
      framework: b['framework'] != null ? asRecord(b['framework']) : null,
      derived: b['derived'] != null ? asRecord(b['derived']) : null,
    })),

  /**
   * Dry-run a profile change, or commit it.
   *
   * `validate` writes nothing and runs the SAME validators the engine runs at load time, so the editor
   * cannot persist a profile the engine would later refuse. Two calls rather than one because a config
   * that fails validation at load time takes the account's searches down with it.
   */
  saveProfile: (
    account: string | null,
    action: 'validate' | 'save',
    body: Readonly<Record<string, unknown>>,
  ): Promise<Result<Record<string, unknown>>> =>
    call(`/portal/api/config/profile/${action}`, (b) => b, {
      method: 'POST',
      body: JSON.stringify({ ...body, ...(account ? { account } : {}) }),
    }),

  projects: (account: string | null): Promise<Result<readonly ProjectSummary[]>> =>
    call(`/portal/api/config/projects${accountQuery(account)}`, (b) =>
      asArray(b['projects']).map((p) => {
        const r = p as Record<string, unknown>
        // Defaults to false when the server omits the key — an absent flag means "not archived", never
        // an unknown state the screen would have to render a third way.
        return { key: asString(r['key']) ?? '', name: asString(r['name']) ?? '', archived: r['archived'] === true }
      }),
    ),

  project: (account: string | null, project: string): Promise<Result<ProjectDetail>> =>
    call(`/portal/api/config/projects/${encodeURIComponent(project)}${accountQuery(account)}`, (b) => ({
      customer: asString(b['customer']) ?? '',
      customerName: asString(b['customerName']) ?? '',
      project: asString(b['project']) ?? '',
      overlay: asRecord(b['overlay']),
      contextPack: typeof b['contextPack'] === 'string' ? b['contextPack'] : '',
      inherited: asRecord(b['inherited']),
      effective: asRecord(b['effective']),
      origins: asRecord(b['origins']),
      derived: b['derived'] != null ? asRecord(b['derived']) : null,
    })),

  saveProject: (
    account: string | null,
    project: string,
    action: 'validate' | 'save',
    body: Readonly<Record<string, unknown>>,
  ): Promise<Result<Record<string, unknown>>> =>
    call(`/portal/api/config/projects/${encodeURIComponent(project)}/${action}`, (b) => b, {
      method: 'POST',
      body: JSON.stringify({ ...body, ...(account ? { account } : {}) }),
    }),

  /**
   * The account's saved searches, in full.
   *
   * Distinct from `api.searches`, which is the composer's MENU and returns the offering plus a thin row
   * per saved search. This is the config surface: enough to edit one.
   */
  savedSearches: (account: string | null): Promise<Result<readonly SavedSearchRow[]>> =>
    call(`/portal/api/config/searches${accountQuery(account)}`, (b) =>
      asArray(b['recipes']).map((r) => {
        const o = r as Record<string, unknown>
        return {
          slug: asString(o['slug']) ?? '',
          label: asString(o['label']) ?? '',
          base: asString(o['base']) ?? '',
          archived: o['archived'] === true,
          version: asNumber(o['version']),
          updatedAt: asString(o['updatedAt']),
        }
      }),
    ),

  savedSearch: (account: string | null, slug: string): Promise<Result<SavedSearchDetail>> =>
    call(`/portal/api/config/searches/${encodeURIComponent(slug)}${accountQuery(account)}`, (b) => ({
      slug: asString(b['slug']) ?? slug,
      recipe: asRecord(b['recipe']),
      sha: asString(b['sha']) ?? '',
    })),

  /**
   * Validate or save a saved search.
   *
   * `expectedVersion` is the optimistic-concurrency handle: naming the version an edit was based on
   * turns a silent last-writer-wins clobber into a 409 the editor can act on. Saved searches are the
   * only config surface that has it, so they are also the only one whose editor must render the
   * `conflict` result kind — the projects editor never can, and its error handler shows why that is
   * easy to miss.
   *
   * Archiving is a save carrying `archived: true`. There is deliberately no delete: a saved search that
   * produced a report is part of how that report came to say what it says.
   */
  saveSavedSearch: (
    account: string | null,
    slug: string,
    action: 'validate' | 'save',
    body: Readonly<{ recipe: Record<string, unknown>; expectedVersion?: number | null }>,
  ): Promise<Result<Record<string, unknown>>> =>
    call(`/portal/api/config/searches/${encodeURIComponent(slug)}/${action}`, (b) => b, {
      method: 'POST',
      body: JSON.stringify({
        recipe: body.recipe,
        ...(body.expectedVersion != null ? { expectedVersion: body.expectedVersion } : {}),
        ...(account ? { account } : {}),
      }),
    }),

  /** What this account has used against its allowance. Caps are nullable — null means "unknown". */
  usage: (account: string | null): Promise<Result<Usage>> =>
    call(`/portal/api/usage${accountQuery(account)}`, (b) => ({
      account: asString(b['account']) ?? '',
      today: asNumber(b['today']) ?? 0,
      thisMonth: asNumber(b['thisMonth']) ?? 0,
      queued: asNumber(b['queued']) ?? 0,
      dailyRuns: asNumber(b['dailyRuns']),
      monthlyRuns: asNumber(b['monthlyRuns']),
      maxQueued: asNumber(b['maxQueued']),
      capped: b['capped'] === true,
    })),

  /**
   * Connection details for driving the engine from your own assistant.
   * `url` is null when this deployment has no client MCP wired — the screen must render its empty
   * state rather than invent a host (see the note atop UseYourAI.tsx).
   */
  // No account parameter, deliberately: the connector address is one host for the deployment and the
  // sign-in identity is the caller's own. Passing an account made the route resolve one it never used,
  // and staff (whose account resolves to null) were told the connector did not exist.
  /** The source offer. Unauthenticated on the server — a licence notice behind a login is not an offer. */
  about: (): Promise<Result<About>> =>
    call('/portal/api/about', (b) => ({
      name: asString(b['name']) ?? 'Clearotron',
      version: asString(b['version']),
      commit: asString(b['commit']),
      sourceRepo: asString(b['sourceRepo']) ?? '',
      sourceUrl: asString(b['sourceUrl']) ?? '',
      license: asString(b['license']),
      copyright: asString(b['copyright']) ?? '',
    })),

  mcpAccess: (): Promise<Result<McpAccess>> =>
    call('/portal/api/mcp-access', (b) => ({
      url: asString(b['url']),
      keyUrl: asString(b['keyUrl']),
      email: asString(b['email']),
      enabled: b['enabled'] === true,
      // — VALIDATED, not spread. A wire field is untrusted input like any other,
      // and a half-formed object here would render a Copy button over an undefined command.
      stdio: (() => {
        const r = b['stdio']
        if (!r || typeof r !== 'object') return null
        const o = r as Record<string, unknown>
        const command = asString(o['command']); const note = asString(o['note']); const verify = asString(o['verify'])
        return command && note && verify ? { command, note, verify } : null
      })(),
      // VALIDATED FIELD BY FIELD, never spread — a wire object is untrusted input, and a half-formed row
      // here would render a button over an undefined command. A row missing its identity is dropped
      // rather than rendered nameless.
      offers: asArray(b['offers']).flatMap((o) => {
        const r = o as Record<string, unknown>
        const id = asString(r['id']); const name = asString(r['name'])
        if (!id || !name) return []
        const st = r['stdio']
        const stdio = st && typeof st === 'object'
          ? (() => {
              const x = st as Record<string, unknown>
              const kind = asString(x['kind'])
              return kind ? { kind, where: asString(x['where']), after: asString(x['after']) } : null
            })()
          : null
        return [{
          id, name,
          // Only strings survive, same rule as `accountNames` above: a malformed entry is dropped rather
          // than rendered, because a step that reads "[object Object]" is worse than one fewer step.
          steps: asArray(r['steps']).filter((x): x is string => typeof x === 'string' && x !== ''),
          // Only an https page survives. A wire value of any other shape is dropped rather than opened:
          // this is the one field on this screen that navigates a reader somewhere.
          launch: (() => {
            const u = asString(asRecord(r['launch'])['url'])
            return u && /^https:\/\//.test(u) ? { url: u } : null
          })(),
          served: r['served'] === true,
          route: asString(r['route']),
          command: asString(r['command']),
          address: asString(r['address']),
          note: asString(r['note']),
          reason: asString(r['reason']),
          fix: asString(r['fix']),
          stdio,
          // The server sends `enables` — an object naming what would be turned on. Reduced to a BOOLEAN
          // here: the page's business is whether a press changes this install's posture, not which
          // setting carries it. A flag name on a client's screen is the kind of repo-side truth that has
          // no reader on that page.
          opensADoor: r['enables'] != null && r['enables'] !== false,
        }]
      }),
    })),

  /**
   * Mint THIS caller's own access, for the clipboard (; owner ruling 2026-08-31).
   *
   * The returned key is handed to the clipboard and MUST NOT reach React state, a prop, or the DOM.
   * *"A rendered key outlives the moment. It's in the DOM, in the screenshot someone takes, in the
   * browser cache, on a screen left open."* The one exception is the degraded path where the browser
   * refuses clipboard access entirely, and that is a one-time reveal the reader asked for by pressing.
   *
   * The server mints for the authenticated caller and ignores anything the request says about identity,
   * so this cannot be used to obtain somebody else's credential.
   */
  connectKey: (): Promise<Result<{ readonly address: string; readonly key: string }>> =>
    call('/portal/api/connect-key', (b) => ({
      address: asString(b['address']) ?? '',
      key: asString(b['key']) ?? '',
    }), { method: 'POST' }),

  /** Staff-only: what this deployment has switched on. Clients get 404. */
  adminConfig: (): Promise<Result<FlagView>> =>
    call('/portal/admin/config', (b) => ({
      available: b['available'] === true,
      note: asString(b['note']),
      source: b['source'] === 'live' ? 'live' : b['source'] === 'capture' ? 'capture' : null,
      // NOT `asRecord`, for the reason the engine/providers pair below already states: a missing
      // `lastRun` means no run has ever recorded a capture on this box, and an empty object would render
      // as a run that recorded nothing. `disagrees` keeps all three of its states across the hop.
      lastRun: b['lastRun'] != null && typeof b['lastRun'] === 'object' && !Array.isArray(b['lastRun'])
        ? (() => {
            const r = b['lastRun'] as Record<string, unknown>
            return {
              capturedAt: asString(r['capturedAt']),
              disagrees: Array.isArray(r['disagrees'])
                ? (r['disagrees'] as unknown[]).map((d) => {
                    const x = d as Record<string, unknown>
                    return {
                      what: asString(x['what']) ?? '',
                      capture: asString(x['capture']),
                      live: asString(x['live']),
                      effect: asString(x['effect']),
                    }
                  })
                : null,
            }
          })()
        : null,
      built: b['built'] != null ? asRecord(b['built']) : null,
      flags: asArray(b['flags']).map((f) => {
        const r = f as Record<string, unknown>
        return {
          name: asString(r['name']) ?? '',
          on: r['on'] === true,
          configured: r['configured'] === true,
          effect: asString(r['effect']) ?? 'unknown',
          killSwitch: r['killSwitch'] === true,
        }
      }),
      // NOT `asArray`/`asRecord` here, deliberately: both collapse a missing value to an empty one, and
      // empty is the answer this pair must never give. `providers: []` reads as "no provider is
      // configured" and `engine: {}` as an engine with no name — where the fact is that an older
      // snapshot did not record either. Guarded on the wire type so null survives the hop.
      engine: b['engine'] != null && typeof b['engine'] === 'object' && !Array.isArray(b['engine'])
        ? (() => {
            const e = asRecord(b['engine'])
            const bill = asRecord(e['billing'])
            return {
              id: asString(e['id']) ?? 'unknown',
              vendor: asString(e['vendor']),
              known: e['known'] === true,
              billing: {
                mode: asString(bill['mode']) ?? 'unknown',
                apiBilled: bill['apiBilled'] === true,
                missing: asStrings(bill['missing']),
              },
              binaryPresent: e['binaryPresent'] === true,
            }
          })()
        : null,
      providers: Array.isArray(b['providers'])
        ? asArray(b['providers']).map((p) => {
            const r = p as Record<string, unknown>
            return {
              key: asString(r['key']) ?? '',
              label: asString(r['label']) ?? '',
              provider: asString(r['provider']),
              providerLabel: asString(r['providerLabel']),
              known: r['known'] === true,
              configured: r['configured'] === true,
              missing: asStrings(r['missing']),
              remedy: asString(r['remedy']),
            }
          })
        : null,
      // Same wire-type guard as `engine` above, for the same reason: `asRecord` collapses a missing
      // value to `{}`, which would decode as a portal with an empty-string mode and no issuer — a
      // confident description of a door nobody configured. Null must survive the hop so the screen can
      // say "this build did not send it" rather than draw a blank row.
      auth: b['auth'] != null && typeof b['auth'] === 'object' && !Array.isArray(b['auth'])
        ? (() => {
            const a = asRecord(b['auth'])
            const shape = asString(a['shape'])
            return {
              mode: asString(a['mode']) ?? 'unknown',
              declared: asString(a['declared']),
              shape: shape === 'local' || shape === 'fronted' ? shape : ('unrecognised' as const),
              issuer: asString(a['issuer']),
              missing: asStrings(a['missing']),
            }
          })()
        : null,
    })),

  /** Staff-only: who is granted what, and where an enrolment is half done. */
  adminAccess: (): Promise<Result<AccessView>> =>
    call('/portal/admin/access', (b) => ({
      note: asString(b['note']) ?? '',
      staffDomains: asArray(b['staffDomains']).filter((s): s is string => typeof s === 'string'),
      unknownAccounts: asArray(b['unknownAccounts']).filter((s): s is string => typeof s === 'string'),
      people: asArray(b['people']).map((p) => {
        const r = p as Record<string, unknown>
        return {
          email: asString(r['email']) ?? '',
          tenant: asString(r['tenant']) ?? '',
          accounts: asArray(r['accounts']).filter((s): s is string => typeof s === 'string'),
          dangling: asArray(r['dangling']).filter((s): s is string => typeof s === 'string'),
          wildcard: r['wildcard'] === true,
        }
      }),
      grantsFile: (() => {
        const g = b['grantsFile'] as Record<string, unknown> | null | undefined
        const name = asString(g?.['name'])
        const modifiedAt = asString(g?.['modifiedAt'])
        // Both halves or nothing. A filename with no date reads as "changed at some unknown time",
        // which is worse on this screen than not claiming to know.
        return name && modifiedAt ? { name, modifiedAt } : null
      })(),
    })),

  /**
   * Staff-only, best-effort. ALWAYS 200 — `available:false` is the shape for "the log could not be
   * read", so this can never blank the access page it sits on.
   */
  adminObserved: (): Promise<Result<ObservedView>> =>
    call('/portal/admin/observed', (b) => ({
      available: b['available'] === true,
      truncated: b['truncated'] === true,
      note: asString(b['note']) ?? null,
      people: asArray(b['people']).map((p) => {
        const r = p as Record<string, unknown>
        const events = r['events']
        return {
          email: asString(r['email']) ?? '',
          events: (events && typeof events === 'object' && !Array.isArray(events)
            ? Object.fromEntries(Object.entries(events as Record<string, unknown>)
                .filter(([, n]) => typeof n === 'number'))
            : {}) as Readonly<Record<string, number>>,
          accounts: asArray(r['accounts']).filter((s): s is string => typeof s === 'string'),
          firstSeen: asString(r['firstSeen']) ?? null,
          lastSeen: asString(r['lastSeen']) ?? null,
          count: typeof r['count'] === 'number' ? r['count'] : 0,
        }
      }),
    })),

  /** Staff-only. Clients get 404, which decodes to `notFound` and is simply not rendered. */
  /**
   * The mark families staff have asserted.
   *
   * Staff-only upstream, and the caller is expected to treat any non-ok answer as "no families" rather
   * than as an error: for a client this route legitimately 404s, and a Clearances page that reported a
   * fault because grouping was unavailable would be broken for every client on every load.
   */
  families: (account: string | null): Promise<Result<{ of: Record<string, string>; names: Record<string, string> }>> =>
    call(`/portal/admin/families${accountQuery(account)}`, (b) => ({
      of: (b['of'] ?? {}) as Record<string, string>,
      names: (b['names'] ?? {}) as Record<string, string>,
    })),

  /** Assert (or dissolve) a family over a set of runs. The server resolves the owner from the runs. */
  setFamily: (input: { action: 'group' | 'ungroup'; name?: string; runIds: readonly string[] }): Promise<Result<unknown>> =>
    call('/portal/admin/families', (b) => b, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /**
   * The runs staff have RETIRED — the fold, and only the fold.
   *
   * Retired runs are gone from every other listing by design, so this is the only way to find one
   * again. Staff-only upstream: like `families`, a client's 404 decodes to `notFound` and the caller
   * treats it as "no retired view", never as a fault.
   */
  retiredRuns: (account: string | null): Promise<Result<readonly Run[]>> =>
    call(`/portal/admin/retired${accountQuery(account)}`, (b) =>
      asArray(b['runs'])
        .map(decodeRun)
        .filter((r): r is Run => r !== null),
    ),

  /**
   * Retire runs, or bring them back. RETIRE, NOT DELETE — this writes one visibility tag and nothing
   * else; the run, its artifacts and its report link are untouched, and `restore` is the exact inverse.
   */
  setRetired: (input: { action: 'retire' | 'restore'; runIds: readonly string[] }): Promise<Result<unknown>> =>
    call('/portal/admin/retired', (b) => b, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  roster: (): Promise<Result<readonly { key: string; name: string }[]>> =>
    call('/portal/admin/roster', (b) =>
      asArray(b['customers']).map((c) => {
        const r = c as Record<string, unknown>
        return { key: asString(r['key']) ?? '', name: asString(r['name']) ?? '' }
      }),
    ),
}
