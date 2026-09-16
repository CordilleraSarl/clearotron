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
import { newestFirst, displayName } from './reads.ts'
import { readableFailure } from './failure.ts'
// The quote bounds, through the portal's mirror of the engine's effort model. Imported rather than
// restated: `effortModelParity.test.ts` pins that mirror to `driver/effort-model.mjs`, and a second copy
// of the numbers here would be outside the pin — right on the day it was typed, silently wrong after.
import { quoteBoundsFor } from './composerProduct.ts'
import { runKey } from './genericKey.ts'

/**
 * Card order in the live band, and it is not a sort the user can change.
 *
 * OWNED BY `inFlight` ALONE. `failed` is still listed because `RANK` is a lookup with a fallback and a
 * state missing from it sorts last — but no failure reaches this function any more, so the entry is a
 * floor rather than a rule. The order failures are shown in belongs to `recentFailures`, which is
 * newest-first for a different reason: that list is history, and history reads by date.
 */
const RANK: Record<string, number> = { failed: 0, running: 1, paused: 2, queued: 3 }

/**
 * The two states a run ends in when it did not deliver, and the two `ACKNOWLEDGEABLE` names in
 * driver/portal-acks.mjs. One set, used by both functions below, so the live band and the failures list
 * cannot disagree about what counts as stopped.
 */
const STOPPED: ReadonlySet<Run['state']> = new Set<Run['state']>(['failed', 'cancelled'])

/**
 * How long a stopped run stays on the dashboard, acknowledged or not.
 *
 * A dismissal is per reader (driver/portal-acks.mjs: one file per viewer, by design, so a staff member
 * tidying their own screen cannot hide a client's run). The consequence is that nothing a previous
 * reader did helps the next one: without an age limit the list is unbounded, and a person signing in
 * for the first time meets every failure the deployment has ever had — which is what happened on
 * production. A week is long enough that a failure cannot be missed over a weekend and short enough
 * that the list stays a list.
 */
export const FAILURE_WINDOW_DAYS = 7

/**
 * When a run happened, as a number, or null when nothing on it can be read as a time.
 *
 * `issuedAt` first because it is the precise stamp the band already tie-breaks on; `date` is day
 * precision and is the fallback. NULL IS NOT ZERO, and that distinction is the whole function: a run
 * with no readable stamp must not compare as 1970 and silently drop out of every list. The callers
 * below treat null as "show it", which is the same direction `asRunState` takes for a state it does not
 * recognise and `readStamps` takes for a token it cannot parse — when we cannot tell, the reader sees it.
 */
const whenOf = (r: Run): number | null => {
  for (const raw of [r.issuedAt, r.date]) {
    if (!raw) continue
    const t = new Date(raw).getTime()
    if (!Number.isNaN(t)) return t
  }
  return null
}

/** Inside the window, or unreadable — never silently absent. */
const withinWindow = (r: Run, now: number, days: number): boolean => {
  const at = whenOf(r)
  return at === null || now - at <= days * 24 * 60 * 60 * 1000
}

/**
 * Newest first, and a run we cannot date sorts FIRST rather than last.
 *
 * ONE RULE, STATED ONCE, BECAUSE THE TWO HALVES DISAGREED. `withinWindow` keeps an undateable run on the
 * grounds that "we cannot tell how old it is" must not hide it — and `newestFirst` then sorted it to the
 * bottom of the list, which is where a reader stops looking. Kept by one rule and buried by the other is
 * not a decision; it is two rules that were never read together.
 *
 * So the same reasoning decides both: not knowing when something failed is a reason to put it in front
 * of somebody, not behind everything. It is also the rarer case by far, so the cost of being wrong is a
 * recent-looking row at the top rather than a failure nobody sees.
 */
const failuresNewestFirst = (a: Run, b: Run): number => {
  const at = whenOf(a), bt = whenOf(b)
  if (at === null && bt === null) return 0
  if (at === null) return -1
  if (bt === null) return 1
  return newestFirst(a, b)
}

export type InFlight = readonly Run[]

/**
 * The rows Home puts in its "In flight" band, in the order it puts them.
 *
 * WHAT IS ACTUALLY HAPPENING, and nothing else. `delivered` is not in flight; neither is a run that
 * stopped. A failure used to live here on the reasoning that a failure which vanishes is a silence —
 * right about the danger, wrong about the place. It made an ordinary screen depend on a per-reader
 * dismissal: the band filled with dead runs, and because a dismissal is one person's, every colleague
 * and every new client met the same wall and had to clear it again. Failures now have their own list
 * below, `recentFailures`, which is bounded by age so nobody has to clear anything for this screen to
 * be right. The silence the old comment feared is prevented by `sentence`, which reads BOTH lists.
 *
 * DEFINED BY EXCLUSION, NEVER BY A LIST OF LIVE STATES. `asRunState` in ./api.ts maps every state it
 * does not recognise to `running` on purpose, so that an unknown state is shown rather than hidden. An
 * allowlist here would invert that the first time the engine gains a park state, and invert it silently.
 *
 * `acked` is no longer consulted, and that is not a dropped filter: a dismissal is keyed on (runId,
 * state) and only `failed` and `cancelled` may be dismissed at all, so no run this function returns can
 * carry one.
 */
export function inFlight(runs: readonly Run[]): InFlight {
  return runs
    .filter((r) => r.state !== 'delivered' && !STOPPED.has(r.state))
    .slice()
    .sort((a, b) => (RANK[a.state] ?? 9) - (RANK[b.state] ?? 9))
}

/**
 * The stopped runs still worth a reader's attention: recent, and not yet put down by this reader.
 *
 * Newest first — this is history, and the question is "what went wrong lately", so the most recent
 * answer is the one at the top. Outside the window a run leaves whether or not anyone acknowledged it,
 * which is what keeps the list from becoming the second wall.
 *
 * `now` is a parameter rather than a call to `Date.now()` so this stays pure and the window is testable
 * without waiting a week.
 */
export function recentFailures(
  runs: readonly Run[],
  { now = Date.now(), days = FAILURE_WINDOW_DAYS }: { now?: number; days?: number } = {},
): readonly Run[] {
  return runs
    .filter((r) => STOPPED.has(r.state) && !r.acked && withinWindow(r, now, days))
    .slice()
    .sort(failuresNewestFirst)
}

/**
 * — the runs this viewer has put down: the exact complement of what `recentFailures` shows.
 *
 * A count with a way to look, never a silent disappearance. The two functions partition one population —
 * stopped runs inside the window — so a run that leaves one appears in the other, and the number on
 * screen is what stands between "acknowledged" and "forgotten". They take the same window for the same
 * reason: a dismissal that outlived the run it dismissed would inflate that count for ever.
 */
export function acknowledged(
  runs: readonly Run[],
  { now = Date.now(), days = FAILURE_WINDOW_DAYS }: { now?: number; days?: number } = {},
): readonly Run[] {
  return runs
    .filter((r) => STOPPED.has(r.state) && r.acked === true && withinWindow(r, now, days))
    .slice()
    .sort(failuresNewestFirst)
}

/**
 * WHICH READ THIS IS — the stamp a card shows, and only when a card would otherwise be a twin.
 *
 * Two failed reads of one mark for one owner drew byte-identical cards: depth, state, mark, owner,
 * step and failure sentence, and nothing saying which read it was. A person acknowledged the first,
 * met the second, read it as the first coming back, pressed the button three times and reported it
 * broken. It was working every time. A card that cannot say which read it is turns "the second
 * attempt failed too" into "the dismiss button does not work".
 *
 * THE RULE IS THE ONE `issuedAt` ALREADY STATES, not a second one invented here: the date is what a
 * reader sees, and the time appears only when two reads share a day and would otherwise be
 * indistinguishable. So this returns, per run:
 *
 *   · null   — nothing else in this list could be confused with it, so the card says no more than today
 *   · a date — a twin exists, and the day tells them apart
 *   · a date and a time — the day ties too, which is exactly the case that produced the report
 *
 * Twins are judged on what the card DRAWS — the mark as displayed, the owner, the project — because
 * that is what a reader compares. Two runs differing only in `runId` are twins to the eye however
 * different they are underneath, which is the whole defect.
 *
 * The id is deliberately not the answer. It is long, it is not a name, and the question a reader is
 * actually asking is "is this the one I just put down".
 */
export function readStamps(rows: readonly Run[]): ReadonlyMap<string, string | null> {
  const identity = (r: Run) =>
    [displayName(r), runKey(r), r.projectKey ?? r.projectName ?? ""].join("\u0000");
  const groups = new Map<string, Run[]>();
  for (const r of rows) {
    const k = identity(r);
    const g = groups.get(k);
    if (g) g.push(r); else groups.set(k, [r]);
  }

  const out = new Map<string, string | null>();
  for (const g of groups.values()) {
    if (g.length < 2) { for (const r of g) out.set(r.runId, null); continue; }
    // The day ties when another twin shares it — counted within the group, since a date shared with a
    // run a reader cannot see on this screen tells them nothing and costs the band a line.
    const perDay = new Map<string, number>();
    for (const r of g) perDay.set(r.date ?? "", (perDay.get(r.date ?? "") ?? 0) + 1);
    for (const r of g) {
      const day = r.date ?? "";
      const time = clockOf(r.issuedAt);
      // A run with neither a date nor a usable stamp says nothing rather than "Invalid Date" — the
      // band is short and a broken token in it is worse than the ambiguity it was meant to resolve.
      if (!day) { out.set(r.runId, time); continue; }
      out.set(r.runId, (perDay.get(day) ?? 0) > 1 && time ? `${day} ${time}` : day);
    }
  }
  return out;
}

/** "14:20" from a stamp, or null when there is nothing readable in it. 24-hour, as everywhere here. */
function clockOf(iso: string | null): string | null {
  if (!iso) return null;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  return t.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
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
    // Account AND project. Project keys are slugs scoped to a customer, so two companies can each
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

/** One company, with enough beside it to say whether it wants attention. */
export type OwnerSummary = {
  readonly key: string
  readonly name: string
  readonly live: number
  readonly finished: number
  readonly date: string | null
}

/**
 * The companies this identity may act for.
 *
 * KEYS COME FROM THE SHELL, NOT FROM THE RUNS. An owner that has been set up and never used has no run
 * to be derived from, and that is exactly the owner someone is most likely to be hunting for — deriving
 * the list from activity would hide it. Runs only decorate the entries.
 *
 * Ordered by what needs a person: live work first, then most recent activity, then name. A company
 * with something running is never below one that has been quiet for a month.
 */
export function ownerSummaries(
  keys: readonly string[],
  runs: readonly Run[],
  nameOf: (key: string) => string,
): readonly OwnerSummary[] {
  return keys
    .map((key) => {
      const mine = runs.filter((r) => runKey(r) === key)
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
 * The runs one company's view shows, or every run when no company is picked.
 *
 * THROUGH `runKey`, like every other run-to-owner comparison. An organisation's Generic is the owner key
 * `generic:<org>` while its runs carry the wire account `generic` and their organisation, so comparing
 * `run.account` with the owner drops every Generic run the moment somebody picks one.
 */
export function runsFor(runs: readonly Run[], owner: string | null): readonly Run[] {
  return owner ? runs.filter((r) => runKey(r) === owner) : runs
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
 * What sits under a company's name on its row.
 *
 * Never a zero. "0 clearances" beside a company reads as a fault; "Nothing yet" reads as a state,
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
export function sentence(
  rows: InFlight,
  stopped: readonly Run[],
  { owners = 0 }: { owners?: number } = {},
): string {
  // BOTH POPULATIONS, AND NEITHER IS OPTIONAL. The sentence is the largest text on the screen and must
  // not disagree with the cards under it — and since failures moved to their own list, there are two
  // sets of cards. The dangerous half is this one: nothing live and a failure ten minutes old used to
  // read "Nothing running.", which is the silence the band was carrying failures to prevent. A caller
  // that has no failures list says so by passing an empty array; there is no default that lets one
  // forget.
  const failed = stopped.length
  if (!rows.length && !failed) return 'Nothing running.'

  const n = (s: string) => rows.filter((r) => r.state === s).length

  if (owners > 1) {
    // COUNTED FROM `rows`, NOT `rows.length - failed`. That arithmetic was correct only while failures
    // were inside the band; now that they never are, subtracting them would undercount live work by
    // exactly the number of unrelated failures on the page.
    const live = rows.length
    // NEVER "no in flight". `count(0)` is the word "no", so a staff view with only stopped work read
    // "32 stopped · no in flight, five companies." — a sentence that leads with a number nobody can
    // act on and then says nothing is happening. When nothing is live, say only what stopped.
    if (!live) return `${cap(count(failed))} stopped, nothing running.`
    const head = `${cap(count(live))} in flight, ${count(owners)} ${owners === 1 ? 'company' : 'companies'}`
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
export const openingLine = (rows: InFlight, stopped: readonly Run[], anyHistory: boolean, known = true): string =>
  // AND A THIRD THING, WHICH IS NEITHER: we have not been told.
  //
  // A client holding several companies cannot ask for "all of them" — the server answers 404 to
  // anyone but staff — so until they pick one there are no runs, and BOTH sentences above are lies. A
  // firm with a decade of history opened this page and read "Nothing has run yet." The honest line is
  // the instruction that unblocks them, which is also the only thing the page can act on.
  !known ? 'Pick a company to see its work.'
    : rows.length || stopped.length ? sentence(rows, stopped)
      : anyHistory ? 'Nothing running.' : 'Nothing has run yet.'

/**
 * "Two run at once, across all companies."
 *
 * THE DESIGN SAID "per company" AND THAT IS FALSE. CLEAROTRON_MAX_CONCURRENT_RUNS is a single global cap
 * over one lock directory, with the per-agent tag deliberately omitted — two owners each running one
 * search fill the entire deployment. Told per-owner it over-promises throughput, which is the worst
 * direction for a line a lawyer might repeat to a client.
 */
export const slotNote = (busy: number | null, slots: number | null): string | null => {
  if (slots == null) return null
  // The plural was inverted — it read "Two run at once" and "One runs at once". Invisible in a string
  // test, unmissable the moment the line was drawn in a browser.
  const c = `${count(slots)} run${slots === 1 ? '' : 's'} at once, across all companies`
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
/**
 * What is in flight, as a breakdown rather than a total: "2 running · 1 paused · 2 queued".
 *
 * A PART IS OMITTED WHEN ITS NUMBER IS ZERO, in this order, so the line never reads "2 running · 0
 * paused · 0 queued" — three facts where one was wanted. With nothing in flight it returns "0", which is
 * the count the band draws beside its idle sentence.
 *
 * COUNTED BY EXCLUSION FOR RUNNING, deliberately, and it matches `inFlight`'s own rule: `asRunState`
 * maps every state it does not recognise to `running`, so an unknown state is shown rather than hidden.
 * An allowlist here would invert that the first time the engine gains a park state — and invert it
 * silently, by quietly dropping those runs out of the total a reader uses to decide whether to wait.
 */
export function inFlightBreakdown(rows: InFlight): string {
  let running = 0
  let paused = 0
  let queued = 0
  for (const r of rows) {
    if (r.state === 'queued') queued++
    else if (r.state === 'paused') paused++
    else running++
  }
  const parts: string[] = []
  if (running) parts.push(`${running} running`)
  if (paused) parts.push(`${paused} paused`)
  if (queued) parts.push(`${queued} queued`)
  return parts.length ? parts.join(' · ') : '0'
}

/**
 * The quote for this run's own pipeline, as an expectation beside its elapsed time, or null.
 *
 * A LOOKUP AGAINST THE TABLE, NOT AN ESTIMATE. The bounds are `TURNAROUND_QUOTE` in the engine's effort
 * model, mirrored for the portal in `./composerProduct.ts` and pinned to it by a parity arm. Nothing
 * here computes from levers, and nothing predicts what is left: past the upper bound the quote is
 * REPLACED by "taking longer than usual" rather than counted down, because a countdown against a wall
 * the engine does not have is a promise the product cannot keep.
 *
 * NULL FOR A RUN THAT IS NOT RUNNING. A queued run has not started, and a paused one is waiting on a
 * provider rather than working — quoting either would time something that is not happening.
 */
export function expectation(r: Run, now = Date.now()): string | null {
  if (r.state !== 'running' || !r.startedAt) return null
  const bounds = quoteBoundsFor({ pipeline: r.kind === 'knockout-batch' ? 'knockout' : 'clearance' })
  const t = Date.parse(r.startedAt)
  if (Number.isNaN(t)) return null
  const hours = (now - t) / 3_600_000
  if (hours > bounds.highHours) return 'taking longer than usual'
  return bounds.highHours < 1
    ? `usually ${Math.round(bounds.lowHours * 60)} to ${Math.round(bounds.highHours * 60)} min`
    : `usually ${bounds.lowHours} to ${bounds.highHours} h`
}

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
export function cardReason(r: Run, now = Date.now(), compact = false): string | null {
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
      // THE TIME IS THE PROVIDER'S OWN RESET, which is the only clock available: nothing here knows when
      // the work will finish, only when the provider will accept it again. `compact` drops the last
      // clause for the row on a crowded screen, where the reassurance costs a line it does not have.
      if (!Number.isNaN(t)) {
        const at = `Paused by the AI provider's limit. Resumes on its own at ${new Date(t).toISOString().slice(11, 16)} UTC`
        return compact ? `${at}.` : `${at} — nothing to do.`
      }
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
