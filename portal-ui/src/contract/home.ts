// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Home: what the page says about itself, computed from the rows it is about to draw.
//
// THE SENTENCE IS DERIVED, NOT WRITTEN. It is the largest text on the screen and the first thing read,
// so the one thing it must never do is disagree with the cards underneath it. Deriving it from the same
// array the cards render makes that impossible by construction rather than by care.
//
// Everything here is pure so it can be tested without a DOM — this runner cannot mount a .tsx, and a
// screen whose only logic lives inline is a screen whose logic is only ever checked by looking at it.

import type { Run } from './api.ts'
import type { Families, Row } from './grouping.ts'
import { NO_FAMILIES, marksOf, rowsOf } from './grouping.ts'
import { newestFirst } from './reads.ts'
import { readableFailure } from './failure.ts'

/** Card order is fixed and is not a sort the user can change. A failure never sinks below live work. */
const RANK: Record<string, number> = { failed: 0, running: 1, paused: 2, queued: 3 }

export type InFlight = readonly Run[]

/**
 * The rows Home puts in its "In flight" band, in the order it puts them.
 *
 * `delivered` is not in flight; everything else is, including `failed` — a run that stopped is the thing
 * the person most needs to see, and dropping it here is how a failure becomes a silence.
 *
 * — …WHICH IS TRUE UNTIL THE PERSON HAS SEEN IT. A failed run is neither in flight nor waiting and
 * had no way out, so the band filled with dead runs and stopped showing the live ones. `acked` is the
 * viewer's own dismissal, stamped per request by the service from that reader's file: nothing about the
 * run changes, it is untouched in Clearances, and another reader's dashboard still shows it.
 *
 * The filter is HERE rather than in the screen because `acknowledged` below must be its exact
 * complement — the count that says how many were put down is the only thing standing between
 * "acknowledged" and "forgotten", and two independent filters would drift.
 */
export function inFlight(runs: readonly Run[]): InFlight {
  return runs
    .filter((r) => r.state !== 'delivered' && !r.acked)
    .slice()
    .sort((a, b) => (RANK[a.state] ?? 9) - (RANK[b.state] ?? 9))
}

/**
 * — the runs this viewer has put down: the exact complement of what `inFlight` dropped.
 *
 * A count with a way to look, never a silent disappearance. Same order as the band they left, so a
 * reader who opens it recognises the list rather than meeting a new one.
 */
export function acknowledged(runs: readonly Run[]): readonly Run[] {
  return runs
    .filter((r) => r.state !== 'delivered' && r.acked)
    .slice()
    .sort((a, b) => (RANK[a.state] ?? 9) - (RANK[b.state] ?? 9))
}

/** Every finished run, newest first. The count Home reports, and the pool the tail is drawn from. */
export function finished(runs: readonly Run[]): readonly Run[] {
  return runs
    .filter((r) => r.state === 'delivered')
    .slice()
    .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')))
}

/**
 * The finished tail, AS ROWS — the same names and the same families Clearances draws.
 *
 * THIS IS WHY IT GOES THROUGH grouping.ts RATHER THAN SLICING RUNS. Home showing three runs while
 * Clearances shows the same work as one family row, or as one name with three reads, is two screens
 * disagreeing about what happened — and the grouping is a commercial judgment someone asserted by hand,
 * so the version that ignores it is simply the wrong one. Routing both screens through one tested
 * function makes agreement structural instead of something to remember.
 *
 * Filtered to delivered BEFORE grouping, deliberately: this block answers "what landed", so a name with
 * a finished read and a newer running one belongs here at its finished read. What is in flight is
 * reported by the block above it, and reporting it twice is the duplication this rebuild removed.
 */
export function recentlyFinished(runs: readonly Run[], families: Families = NO_FAMILIES, limit = 3): readonly Row[] {
  const rows = rowsOf(marksOf(runs.filter((r) => r.state === 'delivered'), families), families)
  // ORDERED BY `issuedAt`, NOT `date`. `date` is day precision, so two runs delivered on the
  // same day tie, `Array.prototype.sort` is stable, and the card then showed whichever row the grouping
  // happened to yield first — the owner saw a run 38 minutes older than the one he had just finished.
  // `newestFirst` is the comparator the reads strip and the mark threads already sort by, so all three
  // agree about what is most recent by construction rather than by three copies of one expression.
  return [...rows].sort(newestFirst).slice(0, limit)
}

/**
 * One project (engagement), and when it was last worked on.
 *
 * RECENT MEANS LAST RUN AGAINST, not last edited. A project's file timestamp moves when someone tweaks
 * its overlay, which is housekeeping; the question this answers is "what was I working on", and the
 * evidence for that is a clearance. A project nothing has run under is therefore absent rather than
 * listed at the bottom — the block is called pick up where you left off, and you did not leave off there.
 */
export type ProjectUse = {
  readonly key: string
  readonly account: string
  /** The project's own name where a run recorded one; the key where none did. Never blank. */
  readonly name: string
  readonly date: string | null
  /** Reads run under it. "Three clearances" on the row. */
  readonly runs: number
  /** Something under it is still going, so the row says so rather than reading as history. */
  readonly live: boolean
}

const IN_FLIGHT = new Set<Run['state']>(['running', 'paused', 'queued'])

export function recentProjects(runs: readonly Run[], limit = 4): readonly ProjectUse[] {
  const byKey = new Map<string, Run[]>()
  for (const r of runs) {
    if (!r.projectKey) continue
    // Account AND project. Project keys are slugs scoped to a customer, so two brand owners can each
    // hold a "launch" — the same reason marksOf keys on the account.
    // The separator is the \u0000 ESCAPE, never the literal byte: a raw NUL in the source made
    // grep/ugrep classify this file as binary and silently skip it (2026-07-29 build note). The
    // runtime string is unchanged - U+0000 still cannot occur in an account or project slug.
    const id = `${r.account}\u0000${r.projectKey}`
    const bucket = byKey.get(id)
    if (bucket) bucket.push(r)
    else byKey.set(id, [r])
  }

  const out: ProjectUse[] = []
  for (const bucket of byKey.values()) {
    const reads = [...bucket].sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')))
    const head = reads[0]!
    out.push({
      key: head.projectKey!,
      account: head.account,
      // The NEWEST recorded name wins, and the key is the floor. A queued run carries the key with no
      // name (the engine resolves it at start), so a project whose only activity is queued would render
      // blank if this took the first value it found rather than the first non-empty one.
      name: reads.find((r) => r.projectName)?.projectName ?? head.projectKey!,
      date: head.date,
      runs: reads.length,
      live: reads.some((r) => IN_FLIGHT.has(r.state)),
    })
  }
  return out
    .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')) || a.name.localeCompare(b.name))
    .slice(0, limit)
}

/** One brand owner, with enough beside it to say whether it wants attention. */
export type OwnerSummary = {
  readonly key: string
  readonly name: string
  readonly live: number
  readonly finished: number
  readonly date: string | null
}

/**
 * The brand owners this identity may act for.
 *
 * KEYS COME FROM THE SHELL, NOT FROM THE RUNS. An owner that has been set up and never used has no run
 * to be derived from, and that is exactly the owner someone is most likely to be hunting for — deriving
 * the list from activity would hide it. Runs only decorate the entries.
 *
 * Ordered by what needs a person: live work first, then most recent activity, then name. A brand owner
 * with something running is never below one that has been quiet for a month.
 */
export function ownerSummaries(
  keys: readonly string[],
  runs: readonly Run[],
  nameOf: (key: string) => string,
): readonly OwnerSummary[] {
  return keys
    .map((key) => {
      const mine = runs.filter((r) => r.account === key)
      return {
        key,
        name: nameOf(key),
        live: mine.filter((r) => IN_FLIGHT.has(r.state)).length,
        finished: mine.filter((r) => r.state === 'delivered').length,
        date: mine.map((r) => r.date).reduce<string | null>((a, b) => (String(b ?? '') > String(a ?? '') ? b : a), null),
      }
    })
    .sort(
      (a, b) =>
        (b.live > 0 ? 1 : 0) - (a.live > 0 ? 1 : 0) ||
        String(b.date ?? '').localeCompare(String(a.date ?? '')) ||
        a.name.localeCompare(b.name),
    )
}

/**
 * What sits beside a project's name on its row.
 *
 * Reads, not names — "three clearances" under a matter is three searches, which is the number someone
 * recognises from the invoice. Capitalised like every other note on the page: these are cells, not
 * clauses, and a lower-case fragment beside "One in flight" looks like a rendering fault.
 */
export function projectNote(p: ProjectUse): string {
  const n = `${cap(count(p.runs))} clearance${p.runs === 1 ? '' : 's'}`
  return p.live ? `${n} · one still going` : n
}

/**
 * What sits under a brand owner's name on its row.
 *
 * Never a zero. "0 clearances" beside a brand owner reads as a fault; "Nothing yet" reads as a state,
 * and for a newly enrolled client it is the correct and expected one.
 */
export function ownerNote(o: OwnerSummary): string {
  if (o.live) return `${cap(count(o.live))} in flight`
  if (o.finished) return `${count(o.finished)} clearance${o.finished === 1 ? '' : 's'}`
  return 'Nothing yet'
}

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'] as const

/** Counts spell out to seven, then go numeric. Reads as prose at the sizes people actually have. */
export const count = (n: number): string => (n < WORDS.length ? WORDS[n]! : String(n))

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * "One running, one paused, two waiting." — the state of play in one line.
 *
 * A FAILURE LEADS, always, even when other work is live: it is the only clause that needs a decision
 * from the reader. Clauses otherwise run running → paused → waiting, which is the order the cards below
 * are in, so the eye tracks from the sentence to the first card without re-sorting anything.
 *
 * `owners` is passed only for the staff view, where the interesting number is how many clients have work
 * in flight rather than which. A client never sees it — for them there is only ever one.
 */
export function sentence(rows: InFlight, { owners = 0 }: { owners?: number } = {}): string {
  if (!rows.length) return 'Nothing running.'

  const n = (s: string) => rows.filter((r) => r.state === s).length
  const failed = n('failed')

  if (owners > 1) {
    const live = rows.length - failed
    // NEVER "no in flight". `count(0)` is the word "no", so a staff view with only stopped work read
    // "32 stopped · no in flight, five brand owners." — a sentence that leads with a number nobody can
    // act on and then says nothing is happening. When nothing is live, say only what stopped.
    if (!live) return `${cap(count(failed))} stopped, nothing running.`
    const head = `${cap(count(live))} in flight, ${count(owners)} brand owner${owners === 1 ? '' : 's'}`
    return failed ? `${cap(count(failed))} stopped · ${head.toLowerCase()}.` : `${head}.`
  }

  const parts: string[] = []
  const running = n('running')
  const paused = n('paused')
  const waiting = n('queued')
  if (running) parts.push(`${count(running)} running`)
  if (paused) parts.push(`${count(paused)} paused`)
  if (waiting) parts.push(`${count(waiting)} waiting`)

  // A failure leads its own clause and keeps the rest of the picture beside it: "one search stopped" on
  // its own would read as though nothing else were happening.
  if (failed) {
    const head = `${cap(count(failed))} search${failed === 1 ? '' : 'es'} stopped`
    return parts.length ? `${head} · ${parts.join(', ')}.` : `${head}.`
  }
  return `${cap(parts.join(', '))}.`
}

/**
 * The first line on a brand-new account, which is a first impression rather than an empty state.
 *
 * Distinguished from "nothing live right now" because they are different facts and the second one is
 * reassuring where the first is an invitation.
 */
export const openingLine = (rows: InFlight, anyHistory: boolean, known = true): string =>
  // AND A THIRD THING, WHICH IS NEITHER: we have not been told.
  //
  // A client holding several brand owners cannot ask for "all of them" — the server answers 404 to
  // anyone but staff — so until they pick one there are no runs, and BOTH sentences above are lies. A
  // firm with a decade of history opened this page and read "Nothing has run yet." The honest line is
  // the instruction that unblocks them, which is also the only thing the page can act on.
  !known ? 'Pick a brand owner to see their work.'
    : rows.length ? sentence(rows) : anyHistory ? 'Nothing running.' : 'Nothing has run yet.'

/**
 * "Two run at once, across all brand owners."
 *
 * THE DESIGN SAID "per brand owner" AND THAT IS FALSE. CLEAROTRON_MAX_CONCURRENT_RUNS is a single global cap
 * over one lock directory, with the per-agent tag deliberately omitted — two owners each running one
 * search fill the entire deployment. Told per-owner it over-promises throughput, which is the worst
 * direction for a line a lawyer might repeat to a client.
 */
export const slotNote = (busy: number | null, slots: number | null): string | null => {
  if (slots == null) return null
  // The plural was inverted — it read "Two run at once" and "One runs at once". Invisible in a string
  // test, unmissable the moment the line was drawn in a browser.
  const c = `${count(slots)} run${slots === 1 ? '' : 's'} at once, across all brand owners`
  return busy == null ? cap(c) : `${busy} of ${slots} running · ${c}`
}

/** Elapsed, coarse. "just started" under a minute; never a second-by-second clock on a polled list. */
export function elapsed(startedAt: string | null, now = Date.now()): string | null {
  if (!startedAt) return null
  const t = Date.parse(startedAt)
  if (Number.isNaN(t)) return null
  const mins = Math.floor((now - t) / 60_000)
  if (mins < 1) return 'just started'
  if (mins < 60) return `${mins} min so far`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h}h ${m}m so far` : `${h}h so far`
}

/**
 * The stage pips: how many, and how many are filled.
 *
 * N COMES FROM THE RUN, NEVER FROM A CONSTANT. Nine is right for a preliminary and for a deep dive —
 * but a knockout has five, or six when the register probe is on, and the engine's own comment warns
 * that a hardcoded count "would silently mislabel every screen the client watches". A queued run has no
 * steps at all and gets none rather than a row of empties.
 */
export function pips(stepN: number | null, stepTotal: number | null): { total: number; filled: number } | null {
  if (stepTotal == null || !Number.isFinite(stepTotal) || stepTotal < 1) return null
  const total = Math.floor(stepTotal)
  const filled = Math.max(0, Math.min(total, Math.floor(stepN ?? 0)))
  return { total, filled }
}

// ── the four regions of the rebuilt Home ─────────────────────────────────────────────────────────

/**
 * The cards, and the queue, split apart.
 *
 * They are different things and the design draws them differently: a card is work THE SYSTEM IS DOING,
 * a queue row is work it has not started. Before the admission change this split could not be made
 * honestly — a job waiting for a slot was claimed out of the queue immediately and had no run dir yet,
 * so it appeared in neither list. Now what is waiting stays `queued` and stays visible.
 */
export const active = (rows: InFlight): readonly Run[] => rows.filter((r) => r.state !== 'queued')
export const waiting = (rows: InFlight): readonly Run[] =>
  rows.filter((r) => r.state === 'queued').slice().sort((a, b) => (a.queuePos ?? 1e9) - (b.queuePos ?? 1e9))

/**
 * WHAT A SEARCH IS CALLED, on a run card and a queue row — the wire's own `productName`, plus the mark
 * count where more than one name is possible.
 *
 * THIS USED TO BE A SWITCH FROM PRODUCT KEY TO LABEL, and that is the bug exists to kill: a second
 * mapping table, in the browser, for a name the server already resolves for the delivered report. It
 * drifted exactly as a second table does — it listed the five RETIRED depth slugs and NONE of the four
 * products, so every run this build creates fell through to `null` and the card's chip rendered blank,
 * an absence that read as a pass twice over because the comment defended null as correct and the test
 * iterated only the retired keys.
 *
 * `productName` is resolved server-side by the ONE resolver the report masthead uses (reportIdentityFor
 * → `.identity`), so a card and the report it links to cannot say different things. It is null for a
 * level the registry has forgotten, and the chip stays blank rather than guessing.
 *
 * STAGE AND DEPTH NUMBERS NEVER REACH THIS SCREEN, which is why the wire's `stageLabel` is not used
 * here: on a retired row it is "Depth 4", and "Stage 1"/"Stage 2" already mean the two halves of the
 * legal reasoning inside every report sent — a different, wrong meaning arriving where a client reads it.
 *
 * The mark count rides only where more than one name is possible: a knockout. Every clearance reads one
 * name (products.mjs maxNames), so a count there would be noise on every card.
 */
export function runProductLabel(productName: string | null, markCount = 0): string | null {
  if (!productName) return null
  return markCount > 1 ? `${productName} · ${markCount} names` : productName
}

/**
 * The reason line under a card: why this run is where it is.
 *
 * A rate-limit pause has a real clock — the provider's own reset time, the ONE ETA this system
 * possesses — and a recovery pause has none, because it backs off on a schedule rather than to a stated
 * time. A restart pause ('operator') is the system deploying/restarting with the run in flight — it
 * resumes on the next runner pass, and there is nothing for the reader to do. All say "Paused" and
 * differ only here, which is deliberate: a new kind of pause drops in without inventing a new state.
 */
export function cardReason(r: Run, now = Date.now()): string | null {
  // — THE ONE BRANCH THAT HANDED THE ENGINE'S STRING TO A READER. Every other branch here is a
  // written sentence; this one returned `r.reason` and fell back to a good sentence only when the engine
  // had said nothing. So the better the engine's diagnostics got, the worse this card read — a user was
  // shown a stage-internal concept, a validator enum and six raw search queries in four scripts.
  //
  // `contract/failure.ts` was built for exactly this and was imported by ONE component. It maps
  // the failure to a reader-safe headline and keeps the engine's words for the disclosure.
  if (r.state === 'failed') return readableFailure(r.failedStage, r.reason).headline
  if (r.state === 'cancelled') return 'Stopped before it finished. Nothing was delivered.'
  if (r.state === 'paused') {
    if (r.pausedKind === 'rate-limit' && r.resetsAt) {
      const t = Date.parse(r.resetsAt)
      if (!Number.isNaN(t)) return `Provider cap — resumes ${new Date(t).toISOString().slice(11, 16)} UTC`
    }
    if (r.pausedKind === 'recovering') return 'Retrying after a problem'
    if (r.pausedKind === 'operator') return 'Paused by a system restart — resumes on its own'
    return 'Waiting on a provider cap'
  }
  return elapsed(r.startedAt, now)
}

/**
 * The allowance line, and the three things it must never say.
 *
 * A NULL limit means "we could not read it" — never "unlimited" and never zero. Told as either, the one
 * account that is genuinely uncapped and the one whose usage file is unreadable become indistinguishable,
 * and one of those two should stop someone before they spend.
 */
export function limitLine(used: number | null, limit: number | null): string {
  if (limit == null) return used == null ? 'Daily allowance unavailable' : `${used} run${used === 1 ? '' : 's'} today`
  if (limit === 0) return 'No daily cap on this account'
  return `${used ?? 0} of ${limit} run${limit === 1 ? '' : 's'} used today · resets midnight UTC`
}

/**
 * Move `id` to sit where `over` currently is, and hand back the whole order.
 *
 * Pure, because drag-and-drop is the one interaction on this screen that is easy to get subtly wrong and
 * impossible to check by looking. Reordering onto itself, or onto something not in the list, is a no-op
 * rather than a throw — a drag that ends where it started is an ordinary thing for a person to do.
 */
export function moveBefore(order: readonly string[], id: string, over: string): readonly string[] {
  if (id === over) return order
  const from = order.indexOf(id)
  const to = order.indexOf(over)
  if (from < 0 || to < 0) return order
  const next = [...order]
  next.splice(from, 1)
  next.splice(to, 0, id)
  return next
}
