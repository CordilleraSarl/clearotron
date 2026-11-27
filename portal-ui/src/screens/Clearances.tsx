// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Clearances — every name in clearance, with its current standing.
//
// ROWS ARE NAMES, NOT RUNS. The list used to render one row per run, which is the shape the data arrives
// in and the wrong shape to read: a mark cleared three times was three unrelated rows saying nearly the
// same thing, and this page's own copy — "Open a row to see each read on that name" — described a thread
// that did not exist. Expanding a single clearance said "One read on this name."
//
// The grouping itself lives in contract/grouping.ts, where it can be tested; this screen renders it. Two
// of its rules are easy to mistake for bugs on sight, so they are worth repeating here: a MARK row shows
// its LATEST read (a deeper read supersedes the screen that preceded it), while a FAMILY row shows the
// WORST of its marks (different names, none superseding any other).
//
// Three rules from the plan land here, and each one is a defect if it goes missing:
//
//   1. Bands render from `tone` and sort by the run's OWN ladder. A house-default customer sees four
//      stops with their own words, and "Moderate" sorts between "Elevated" and "Clear" rather than
//      falling to the bottom as an unrecognised label.
//   2. A knockout batch reads "N names, worst: <band>" — because a batch has one report but many
//      answers, and the worst one is the only single number that means anything.
//   3. FAILED RUNS ARE VISIBLE, with the reason. A run that silently disappears from the list is worse
//      than one that says it stopped: the user goes on believing it is still going.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Result, Run } from '../contract/api.ts'
import { api, saveFailureText, lastSeenOrders } from '../contract/api.ts'
import { receiptPath, type PreRunOrder } from '../contract/orderReceipt.ts'
import { bandRank } from '../contract/tone.ts'
import { displayName, newestFirst, readLabel, readLabelParts, readTime, sameDateAsAnother } from '../contract/reads.ts'
import { marksOf, nameCount, rowsOf, NO_FAMILIES } from '../contract/grouping.ts'
import type { Families, MarkGroup, Row } from '../contract/grouping.ts'
import { BOARD_SHARES_FROM, clearancesColumns, pageWindow } from '../contract/listView.ts'
import {
  familyLine,
  hasReport,
  nameActions,
  namesLabel,
  reportLineParts,
  searchesLabel,
  shownBand,
  shownReport,
  statusCount,
} from '../contract/nameRow.ts'
import { RiskDot, StatusCell } from '../components/RiskDot.tsx'
import { PinnedScrollbar } from '../components/PinnedScrollbar.tsx'
import { Icon } from '../components/Icon.tsx'
import { useLoad, usePoll } from '../state/useApi.ts'
import type { ShellContext } from '../shell/AppShell.tsx'
import { canManage, canRun } from '../shell/permissions.ts'
import { runKey } from '../contract/genericKey.ts'
import { PageHeader } from '../components/PageHeader.tsx'
import { allowanceLine } from '../contract/allowance.ts'
import { runProductLabel } from '../contract/home.ts'
import { AskAi } from '../components/AskAi.tsx'
import { askAiOffer } from '../contract/askAi.ts'
import { SEARCH_LEVELS, atLevel, type LevelFilter } from '../contract/levelTags.ts'

// criterion 5 — 'failed' is a tab, not a member of the other three. The owner's ruling was
// "Failed runs on clearance screen - no", and a tab is how a screen says no to something without
// making it unfindable: this file's own rule two comments down is that a run which silently
// disappears from the list is worse than one that says it stopped.
type Filter = 'all' | 'progress' | 'finished' | 'failed' | 'retired'
/** A change to the shared list, asked in a dialog: what it says, what it does, and what to say once done. */
type Ask = {
  readonly title: string
  readonly body: string
  readonly confirm: string
  /** The accessible name of the control that asked, which takes focus back when the dialog closes. */
  readonly returnTo: string
  readonly act: () => Promise<Result<unknown>>
  readonly done: string
  readonly after: () => void
}
/** How the list is ordered, from the Filters panel: newest activity first, by name, or worst risk first. */
type SortBy = 'activity' | 'name' | 'risk'
// Terminal = nothing more will happen to it, NOT "it succeeded". A stopped run belongs here for the
// same reason a failed one does: leaving it out of the set would keep it under "In progress" forever
// and keep the list polling for a run that is never coming back.
const TERMINAL = new Set<Run['state']>(['delivered', 'failed', 'cancelled'])

// How many rows render at once.
//
// There were ~70 runs on the day this was added and the number only goes up — one per search, forever,
// and nothing ever leaves the list. Every row carries an expandable panel and a status cell that
// re-renders on each poll, so an unbounded table means the poll cost grows with the customer's history.
//
// 50 is a page that fills a screen without filling a scrollback. It is not tuned; if it ever needs to
// be, the number is here rather than spread through the render.
const PAGE = 50

/**
 * Whether to group by company. ON by default — grouped is right for the common case, which is
 * a person working one client's book.
 *
 * localStorage with a try/catch, which is the only persistence pattern this SPA has (Preferences.tsx
 * does the same for the theme). There is no server-side per-user preference store, and inventing one for
 * a view toggle would be a larger change than the toggle. It throws outright in a sandboxed context, so
 * a preference that cannot be remembered still has to apply rather than take the page down on its way.
 */
const GROUP_PREF_KEY = 'cordillera-clearances-group-by-owner'

function readGroupPref(): boolean {
  try {
    return localStorage.getItem(GROUP_PREF_KEY) !== 'off'
  } catch {
    return true
  }
}

function writeGroupPref(on: boolean): void {
  try {
    localStorage.setItem(GROUP_PREF_KEY, on ? 'on' : 'off')
  } catch {
    /* private mode, or a sandboxed frame — the toggle still applies for this page's lifetime */
  }
}

export function Clearances({ ctx }: { readonly ctx: ShellContext }) {
  // The list's wrapper, read two ways through one callback ref, because the wrapper is not drawn until the
  // list has loaded: its width decides whose column shares it is drawn with — the board's where they hold,
  // the narrow ones below that (contract/listView.ts) — and the element itself is what the scrollbar
  // pinned under it at phone width scrolls (components/PinnedScrollbar.tsx).
  const [tableWidth, setTableWidth] = useState(0)
  const widthWatch = useRef<ResizeObserver | null>(null)
  const namesWrapEl = useRef<HTMLDivElement | null>(null)
  const namesWrap = useCallback((el: HTMLDivElement | null) => {
    namesWrapEl.current = el
    widthWatch.current?.disconnect()
    widthWatch.current = null
    if (!el) return
    widthWatch.current = new ResizeObserver(() => setTableWidth(el.clientWidth))
    widthWatch.current.observe(el)
    setTableWidth(el.clientWidth)
  }, [])
  const [filter, setFilter] = useState<Filter>('all')
  // WHICH KIND OF SEARCH, beside the status filter and on the same terms: it narrows the SEARCHES, so a name
  // with none of that kind drops out and a name that keeps some speaks for those alone (contract/levelTags.ts).
  const [level, setLevel] = useState<LevelFilter>('all')
  const [sortBy, setSortBy] = useState<SortBy>('activity')
  const [filtersOpen, setFiltersOpen] = useState(false)
  // THE GROUPING DIALOG, opened from "Group names", a name's menu or a family's menu: null is closed, and
  // `family` names the family being added to, or null for a new one.
  const [grouping, setGrouping] = useState<{ readonly family: string | null; readonly seed: readonly string[] } | null>(null)
  const openGrouping = (family: string | null, seed: readonly string[] = []) => setGrouping({ family, seed })
  // THE QUESTION BEING ASKED, if one is, and the line that says what the last action did.
  const [ask, setAsk] = useState<Ask | null>(null)
  const [note, setNote] = useState<string | null>(null)
  useEffect(() => {
    if (!note) return
    const t = window.setTimeout(() => setNote(null), 8000)
    return () => window.clearTimeout(t)
  }, [note])
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const [page, setPage] = useState(0)

  // CLEARANCES IS THE ARCHIVE OF EVERYTHING THIS ACCOUNT HOLDS, and the company is a FILTER inside
  // it rather than a scope around it.
  //
  // One request, whoever is asking: `?scope=mine` returns every company the identity holds — all of
  // them for staff, its own for a client — so this screen never asks who is looking. It is above the
  // line in the sidebar for that reason (nav.config), and it is where Home hands off: Home spans the
  // account, so a Clearances that spanned one owner would narrow the list at the very moment someone
  // followed "All clearances" expecting to see more, not less.
  //
  // Deliberately NOT `api.runs('*')` — that wildcard is staff-only and stays that way.
  // `runs:mine` — the request main.tsx started before the shell knew who was signed in. Home makes the
  // identical call, so whichever of the two mounts consumes it; the other asks for itself.
  const { result, reload } = useLoad(() => api.runsMine(), [], 'runs:mine')
  const allRuns: readonly Run[] = result?.kind === 'ok' ? result.value : []
  // THE ORDERS WITH NO RUN YET, from the same answer as the runs (contract/orderReceipt.ts): being checked, or refused
  // before any run. Each opens its receipt, the one its Start showed.
  const allOrders: readonly PreRunOrder[] = result?.kind === 'ok' ? lastSeenOrders() : []

  // THE COMPANY FILTER IS THE SIDEBAR SWITCHER. There is one control, and it is in the nav.
  //
  // This screen used to carry its own <select>, with its own state, next to a sidebar switcher that did
  // nothing here at all — Clearances never read `ctx.owner`, so moving the switcher remounted the screen
  // and re-rendered the identical list. Two controls that look interchangeable, one of them inert, and
  // no way to tell which from looking. Worse, the inert one was not harmless: it is the same switcher
  // that scoped the Result screen, so the only visible effect of touching it was an open report
  // disappearing.
  //
  // Reading `ctx.owner` makes the nav control mean the same thing on every screen — narrow what you are
  // looking at — and leaves exactly one place to change it.
  const ownerFilter = ctx.owner
  const runs: readonly Run[] = useMemo(
    () => (ownerFilter ? allRuns.filter((r) => runKey(r) === ownerFilter) : allRuns),
    [allRuns, ownerFilter],
  )

  // `?owner=` promoted into the shell, once, on arrival — Home deep-links into one owner's work and that
  // link has to keep landing. It sets the SHELL's owner rather than a local filter so the sidebar agrees
  // with the list it produced; a deep link that filtered the table while the switcher still read "All
  // companies" would be the same two-sources-of-truth bug in a new place.
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current) return
    seeded.current = true
    const wanted = new URLSearchParams(window.location.search).get('owner')
    if (wanted && wanted !== ctx.owner) ctx.setOwner(wanted)
  }, [ctx])

  // Families are curation by someone who sees everything, and the route 404s for anyone else by design
  // (see portal-service). So only that reader ASKS: everyone else has no families without a request,
  // where a manager of one organisation used to fire a 404 in the background on every load. Any non-ok
  // answer still means "no families", never "something is wrong".
  const seesAll = ctx.me.allAccounts
  const account = ownerFilter ?? (seesAll ? '*' : (ctx.me.accounts.length === 1 ? ctx.me.accounts[0]! : null))
  const { result: famResult, reload: reloadFamilies } = useLoad<Families>(
    () => (seesAll ? api.families(account) : Promise.resolve({ kind: 'ok' as const, value: NO_FAMILIES })),
    [account, seesAll],
  )
  // NO PRODUCT-MENU FETCH HERE ANY MORE. This screen used to load `api.searches` for one
  // reason — to turn `run.product` into a name for readLabel — and that menu is the ORDERABLE list, so
  // every archived run missed the join and rendered its `stageLabel`, a Depth number, at a client. The
  // name now arrives on the row itself as `productName`, resolved by the same registry the report's
  // masthead prints from, so there is nothing left to join and nothing left to fetch.
  const families: Families = famResult?.kind === 'ok' ? famResult.value : NO_FAMILIES

  // WHETHER THIS READER'S ASSISTANT IS CONNECTED — one answer for the whole table, asked once per visit.
  // Every Ask AI on the list is drawn from it; a control that asked for itself would ask fifty times.
  const { result: aiResult } = useLoad(() => api.mcpAccess(), [])
  const aiAccess = aiResult?.kind === 'ok' ? aiResult.value : null
  // WHICH ROW HAS ITS ASK AI PANEL OPEN, by run. The control is no longer a button in the actions column:
  // it is the row menu's second entry, beside Retire (owner, 2026-09-18), and the panel it opens is the
  // same one the report carries.
  const [askFor, setAskFor] = useState<string | null>(null)

  // Grouping marks into a family and retiring a run are CURATION — changing what the archive says —
  // so they ask Manage, the one permission that changes things for other people, AND that the reader
  // sees everything, because every curation route is an installation route the server serves to no one
  // else. Someone without both reads the same archive and never meets a control that would only refuse them.
  const canGroup = canManage(ctx.me) && seesAll

  // — THE FOLD, AND THE COUNT THAT SAYS IT HAS ANYTHING IN IT.
  //
  // A retired run is gone from every other listing on purpose, so this route is the only way back to
  // one. That is why the count is fetched even when the fold is shut: a control reading "Show retired"
  // with nothing behind it is indistinguishable from one hiding six months of work, and the person who
  // filed something needs to see that it is filed. Staff curation, staff-only upstream — a client's 404
  // decodes to notFound, `retired` stays empty and the control never renders.
  const { result: retiredResult, reload: reloadRetired } = useLoad(
    () => (canGroup ? api.retiredRuns(account) : Promise.resolve({ kind: 'notFound' as const })),
    [account, canGroup],
  )
  const retired: readonly Run[] = retiredResult?.kind === 'ok' ? retiredResult.value : []

  // The comment above is a promise the code has to keep: switching company replaces every row,
  // so a selection made under the previous owner is ticks over rows that no longer exist — the
  // grouping bar shows a stale count and "Group as a family" can only fail.

  usePoll(reload, {
    active: runs.some((r) => !TERMINAL.has(r.state)),
    rateLimited: result?.kind === 'rateLimited',
  })

  // Grouping is a property of the VIEW, not of the data: rows group under a company heading only
  // when several owners are on screen at once. With one owner selected, a heading repeating that
  // owner's name on every group would be noise.
  //
  // Counted off the runs actually held rather than off a roster: an identity granted six companies
  // with work under one of them needs no headings, and the roster cannot tell us that.
  const ownersHeld = useMemo(() => new Set(allRuns.map(runKey)).size, [allRuns])
  // GROUPING IS A TOGGLE, on by default.
  //
  // Name, Status, Risk and Updated are all sortable, and grouping was always applied FIRST with nothing
  // on screen saying so. With four rows, one per owner, that is invisible. With forty across six owners,
  // "sort by Risk" produces six separate risk-ordered lists and reads as a broken sort — and the reason
  // to sort by Risk is to see the worst thing in the book first, which grouping silently prevents.
  //
  // Grouped-by-default is right for the common case, a person working one client's book. The toggle is
  // for the case grouping actively obstructs. Explaining the obstruction with a tooltip was rejected,
  // correctly: it explains rather than removes.
  const [groupByOwner, setGroupByOwner] = useState<boolean>(readGroupPref)
  // The toggle can only matter when there is more than one owner in view and the nav is not already
  // scoped to one — otherwise there is nothing to group.
  const groupable = ownerFilter === null && ownersHeld > 1
  const grouped = groupable && groupByOwner
  // The owner survives the toggle: grouped, the section header carries it; ungrouped, a column does.
  const showOwnerColumn = groupable && !groupByOwner

  // — HOW MANY NAMES ARE BEHIND THE FAILED TAB. Counted off the same `runs` the list is built
  // from and grouped the same way, so the number on the control and the rows behind it cannot disagree.
  // It exists for the reason "Show retired (N)" carries its count: a control with nothing behind
  // it is indistinguishable from one hiding a week of work, and this tab is now the ONLY route to a
  // failed name. Search is deliberately not applied — the count answers "is there anything there", and
  // a count that moved as you typed would answer a different question.
  const failedCount = useMemo(
    () => marksOf(runs, families).filter((m) => m.current.state === 'failed').length,
    [runs, families],
  )

  // FILTER the runs, then GROUP them, then sort the groups, then page.
  //
  // The order is load-bearing. Filtering has to happen on runs, because "In progress" is a property of a
  // read rather than of a name. Grouping has to happen before paging, because a page of 50 must be 50
  // ROWS — paging runs and then grouping them would give pages of wildly different lengths and a pager
  // whose arithmetic disagreed with the screen. And sorting has to happen after grouping, because the
  // thing being ordered is the row: a family's date is its most recent activity anywhere inside it, which
  // no member run carries.
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = runs.filter((r) => {
      // A FAILED RUN WAS REACHABLE FROM NEITHER TAB. "In progress" excluded it (it is terminal) and
      // "Finished" demanded `delivered`, so the only way to find one was to know to press All — while
      // this file's own rule at the top says a run that silently disappears from the list is worse than
      // one that says it stopped. "Finished" therefore became "no longer running", which is what
      // someone scanning for an answer means by it, and the row still said plainly that it did not
      // finish.
      //
      // — THAT ANSWER HAS BEEN OVERRULED, AND ITS REASONING STILL HOLDS. The owner's ruling is
      // "Failed runs on clearance screen - no", so a failed name no longer rides in Finished or in All;
      // the mark-level filter below takes it out of every tab but its own. What does NOT change is why
      // the fix above was made: the answer to "it should not be here" is a tab that holds it, not a
      // disappearance. `TERMINAL` keeps `failed` deliberately — a failed run is still not in progress,
      // and dropping it from the set would put it back under "In progress" forever, which is the older
      // bug this line was written to close.
      if (filter === 'finished' && !TERMINAL.has(r.state)) return false
      if (filter === 'progress' && TERMINAL.has(r.state)) return false
      // A LEVEL IS A PROPERTY OF A SEARCH, like "In progress", so it filters here, before grouping. Under KO,
      // a name with a knockout and a later full country search keeps only the knockout: its row shows the
      // knockout's result and opens the knockout's report, never the other search's risk under a KO filter.
      if (!atLevel(r, level)) return false
      if (q && !displayName(r).toLowerCase().includes(q) && !r.marks.some((m) => m.name.toLowerCase().includes(q))) return false
      return true
    })
    // criterion 5 — FAILED NAMES COME OFF, and this filter is a MARK-level one, which is why it
    // sits here rather than in the run filter above. The comment above says filtering happens on runs
    // because "In progress" is a property of a read; "this name failed" is a property of the NAME, and
    // the owner was objecting to a ROW whose status cell said failed, not to a read buried in a thread.
    //
    // Filtering the reads instead would rewrite history inside every surviving thread and silently
    // promote an older read to `current` — a name would show a green standing it does not have. So the
    // unit is the mark, judged on the read it speaks for.
    //
    // THE COST, NAMED: a name whose latest read failed leaves the default view carrying its earlier
    // good reads with it. That is what the Failed tab is for, and it is why this is a tab rather than
    // a deletion — one click and the whole thread is there, intact.
    //
    // `failed` ONLY, not `cancelled`. The ruling names failed; a cancelled run was stopped by someone
    // on purpose and nobody asked for it to disappear. Over-applying a removal hides things no one
    // chose to hide, which is the harder mistake to notice.
    const marks = marksOf(filtered, families).filter((m) => (filter === 'failed') === (m.current.state === 'failed'))
    return [...rowsOf(marks, families)].sort((a, b) => {
      // Owner leads when grouping, or a heading would reappear every time the sort interleaved two
      // owners' rows. Within a group the chosen order is untouched.
      if (grouped && runKey(a) !== runKey(b)) return runKey(a).localeCompare(runKey(b))
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name)
        case 'risk':
          // Worst first, ranked against each row's own ladder, so two customers' vocabularies interleave
          // correctly instead of sorting alphabetically against each other. By the band each row SHOWS.
          return bandRank(a.bands, shownBand(a)) - bandRank(b.bands, shownBand(b))
        case 'activity':
        default:
          // `date` is day precision, so `newestFirst` orders by the issue time where there is one.
          return newestFirst(a, b)
      }
    })
  }, [runs, filter, level, query, sortBy, grouped, families])

  // Paging and cross-owner disambiguation are decided in contract/listView.ts, where they can be
  // tested — this screen has no DOM harness, so logic left inline here is logic nothing checks.
  const { current, pageCount, visible, from, to } = pageWindow(rows, page, PAGE)
  // ONE ROW PER ORDER, above the runs, on the unfiltered view of its company, and found by its name like any run.
  const orderRows = filter !== 'all' ? [] : allOrders.filter((o) => (!ownerFilter || runKey(o) === ownerFilter)
    && (!query.trim() || (o.markName ?? '').toLowerCase().includes(query.trim().toLowerCase())))
  const resetPage = () => setPage(0)
  // removed the cross-owner disambiguation chip, and with it the only consumer of ambiguousTitles
  // on this screen. The helper stays in contract/listView.ts with its own tests: introduces an
  // UNGROUPED mode where the owner has to appear on every row, and that is where the question of two
  // owners holding one name comes back — as a column, not as a chip on the rows that happen to collide.

  if (result && result.kind === 'pickAccount') {
    return (
      <div className="screen">
        <div className="notice">
          <b>Choose a company</b>
          <p style={{ margin: '6px 0 0', color: 'var(--text-muted)' }}>
            This sign-in covers several companies. Pick one in the sidebar to see its clearances.
          </p>
        </div>
      </div>
    )
  }

  if (result && result.kind !== 'ok') {
    return (
      <div className="screen">
        <div className="notice">
          <b>{result.kind === 'rateLimited' ? 'Too many requests just now' : 'The list could not be loaded'}</b>
          <p style={{ margin: '6px 0 0', color: 'var(--text-muted)' }}>
            {result.kind === 'rateLimited'
              ? 'The portal is pacing requests. This page will retry on its own in a minute.'
              : 'Nothing has been lost — any run in progress is still running. Try again shortly.'}
          </p>
        </div>
      </div>
    )
  }

  // LOADING IS NOT EMPTY.
  //
  // `result` is null until the first response lands, and `runs` defaults to []. Testing the array alone
  // therefore showed a returning customer "No clearances yet" — with a "Start your first clearance"
  // button — for as long as their own history took to arrive. The one moment a customer is most likely
  // to think the product has lost their work is the moment it tells them they have none.
  //
  // So the empty state is claimed only once the server has actually said so.
  if (!result) return <Loading />

  // `allRuns`, NOT `runs`. This tested the FILTERED set, so choosing a company with no clearances
  // replaced the whole screen — chips and status filters with it — and the chips are the only way to
  // change company here. The one state where somebody most wants another company was the state that
  // took the control away, reached by using the feature correctly.
  //
  // The full-screen first-run stays for an account that genuinely has nothing: there is no filter to
  // undo and nothing to keep on screen. An empty FILTER renders inside the list instead, below.
  if (!allRuns.length && !allOrders.length) return <FirstRun onNew={canRun(ctx.me) ? () => ctx.go('/portal/new') : null} />

  // A family is asserted over RUNS, because a mark is a grouping the browser derives rather than
  // anything the pool stores. Ticking a name therefore files every read of it.
  // EVERY NAME ON THE LIST, whatever the tab shows, for the grouping dialog; and each family by its id.
  const allNames = marksOf(runs, families)
  const familyIndex = new Map(allNames.flatMap((m) => (m.familyId
    ? [[m.familyId, { name: families.names[m.familyId] ?? m.familyId, company: runKey(m) }] as const] : [])))
  // ── EVERY CHANGE TO THE SHARED LIST ASKS IN A DIALOG OF ITS OWN (board Clearances, approved 2026-11-25) ──
  // The browser's own confirm box named reads and "Show retired", which this screen no longer has, and it
  // could not say what happens in the product's words. Each question below names what it affects, the
  // answer is one press, and the line under the toolbar says what was done.
  const searchOf = (run: Run) => readLabelParts(run).head ?? readLabel(run)
  const companyOf = (key: string) => ctx.ownerName(key)
  const ungroupFamily = (family: Extract<Row, { kind: 'family' }>) => {
    const runIds = family.marks.flatMap((m) => m.reads.map((r) => r.runId))
    if (!runIds.length) return
    setAsk({
      title: `Ungroup ${family.name}?`,
      body: `Its ${namesLabel(family.marks.length)} and their searches will appear directly under ${companyOf(runKey(family))}.`,
      confirm: 'Ungroup family',
      returnTo: `More actions for ${family.name}`,
      act: () => api.setFamily({ action: 'ungroup', runIds }),
      done: 'Family ungrouped.',
      after: () => reloadFamilies(),
    })
  }
  const removeFromFamily = (mark: MarkGroup, familyName: string) => {
    const runIds = mark.reads.map((r) => r.runId)
    if (!runIds.length) return
    setAsk({
      title: `Remove ${mark.name} from ${familyName}?`,
      body: `The name and its searches will appear directly under ${companyOf(runKey(mark))}.`,
      confirm: 'Remove from family',
      returnTo: `More actions for ${mark.name}`,
      act: () => api.setFamily({ action: 'ungroup', runIds }),
      done: `${mark.name} removed from ${familyName}.`,
      after: () => reloadFamilies(),
    })
  }
  const retireRun = (run: Run, name: string = displayName(run)) => {
    setAsk({
      title: 'Retire this search?',
      body: `${searchOf(run)} for ${name}${run.date ? ` · ${run.date}` : ''} will move to Retired for everyone. Existing report links keep working. You can restore each search there.`,
      confirm: 'Retire search',
      returnTo: `More actions for ${readLabel(run)}`,
      act: () => api.setRetired({ action: 'retire', runIds: [run.runId] }),
      done: 'Moved 1 search to Retired.',
      after: () => { reload(); reloadRetired() },
    })
  }
  const retireMark = (mark: MarkGroup) => {
    const runIds = mark.reads.map((r) => r.runId)
    if (!runIds.length) return
    if (runIds.length === 1) { retireRun(mark.reads[0]!, mark.name); return }
    const n = runIds.length
    const live = mark.reads.some((r) => !TERMINAL.has(r.state))
    setAsk({
      title: `Retire all ${n} searches?`,
      body: `${n} searches under ${mark.name} will move to Retired for everyone. Existing report links keep working. You can restore each search there.${live ? ' A search in progress will continue.' : ''}`,
      confirm: `Retire ${n} searches`,
      returnTo: `More actions for ${mark.name}`,
      act: () => api.setRetired({ action: 'retire', runIds }),
      done: `Moved ${n} searches to Retired.`,
      after: () => { reload(); reloadRetired() },
    })
  }
  const restoreRun = async (run: Run) => {
    const r = await api.setRetired({ action: 'restore', runIds: [run.runId] })
    if (r.kind !== 'ok') { setNote(saveFailureText(r)); return }
    setNote(run.state === 'failed'
      ? `Restored ${searchOf(run)} for ${displayName(run)} to Failed.`
      : `Restored ${searchOf(run)} for ${displayName(run)}.`)
    reload()
    reloadRetired()
  }

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // ASK AI, beside Open on a name with a report, and alone on a stopped one. THE SAME CONTROL THE REPORT
  // CARRIES, given the same four facts the report gives it — the run's mark, date, kind and product label —
  // so a question asked from a name is the question asked from that name's report, word for word. Which
  // read it is about is `nameActions`' answer, the same read Open opens.
  const askAi = (_name: string, read: Run): ReactNode => (askFor !== read.runId ? null : (
    <AskAi
      runId={read.runId}
      markName={read.markName}
      date={read.date}
      kind={read.kind}
      productName={runProductLabel(read.productName, read.marks.length)}
      access={aiAccess}
      go={ctx.go}
      quiet
      hideButton
      openOnArrival
      onClose={() => setAskFor(null)}
    />
  ))

  // The menu's own entry: drawn on the same answer the control itself draws on, so a deployment with no
  // connector offers no entry rather than one that opens nothing.
  const askMenu: AskAiMenu = (read) => ({
    show: askAiOffer({ markName: read.markName, date: read.date, kind: read.kind }, aiAccess).drawn,
    open: () => setAskFor(read.runId),
  })

  // THE NARROWING IN FORCE, each said as a chip that takes it off (board Clearances, approved 2026-11-25).
  // Grouping by company is on by default, so turning it off is the narrowing worth naming.
  const companyKeys = [...new Set(allRuns.map(runKey))].sort((x, y) => ctx.ownerName(x).localeCompare(ctx.ownerName(y)))
  const levelName = SEARCH_LEVELS.find((l) => l.product === level)?.name ?? null
  const activeFilters: readonly { readonly key: string; readonly label: string; readonly clear: () => void }[] = [
    ...(ownerFilter ? [{ key: 'company', label: ctx.ownerName(ownerFilter), clear: () => { ctx.setOwner(null); resetPage() } }] : []),
    ...(level !== 'all' && levelName ? [{ key: 'level', label: levelName, clear: () => { setLevel('all'); resetPage() } }] : []),
    ...(groupable && !groupByOwner ? [{ key: 'combined', label: 'Companies combined', clear: () => { setGroupByOwner(true); writeGroupPref(true); resetPage() } }] : []),
  ]
  // EVERY NAME AGAIN: the company, the search type, the name search and the tab, each back to all.
  const showAllNames = () => { ctx.setOwner(null); setLevel('all'); setQuery(''); setFilter('all'); resetPage() }
  // THE STATUS TABS. Retired is a tab for whoever can retire, with its count; Failed carries its own.
  // The Retired tab follows the same company and search-type narrowing, and the same name search.
  const retiredShown = retired.filter((r) => (!ownerFilter || runKey(r) === ownerFilter) && atLevel(r, level)
    && (!query.trim() || displayName(r).toLowerCase().includes(query.trim().toLowerCase())))
  const tabs: readonly { readonly key: Filter; readonly label: string; readonly count: number }[] = [
    { key: 'all', label: 'All', count: 0 },
    { key: 'progress', label: 'In progress', count: 0 },
    { key: 'finished', label: 'Finished', count: 0 },
    { key: 'failed', label: 'Failed', count: failedCount },
    ...(canGroup ? [{ key: 'retired' as const, label: 'Retired', count: retired.length }] : []),
  ]

  return (
    <div className="screen">
      {/* THE TITLE NAMES THE SCREEN AND COUNTS ITS NAMES; "Group names" sits at its right (board Clearances,
          approved 2026-11-25). The lede names the company in view and the allowance, as before. */}
      <PageHeader
        title={<>Clearances <span className="clr-title-count">{namesLabel(nameCount(rows) + orderRows.length)}</span></>}
        lede={<>
          {/* No separator after the company: the allowance line is a block of its own beneath it, and
              renders nothing at all above five searches left — a trailing "·" would then point at
              nothing on most visits. */}
          {ownerFilter ? <span data-anon="mark">{ctx.ownerName(ownerFilter)}</span> : null}
          <AllowanceLine account={account} brand={ctx.me.brand} />
        </>}
        actions={canGroup ? (
          <button type="button" className="btn-ghost clr-group-btn" onClick={() => openGrouping(null)}>
            <Icon name="layers" size={15} />Group names
          </button>
        ) : null}
      />

      {/* FIND A NAME, AND THE REST OF THE NARROWING BEHIND "Filters": company, search type, sorting and
          grouping by company. What is narrowed is said as chips under the bar, each one removable. The
          company is the sidebar's own value, so the two selections cannot disagree. */}
      <div className="clr-toolbar">
        <label className="clr-find">
          <Icon name="search" size={15} />
          <input
            type="search"
            placeholder="Find a name"
            aria-label="Find a name"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              resetPage()
            }}
          />
        </label>
        <button type="button" className="btn-ghost clr-filters-btn" aria-expanded={filtersOpen} aria-controls="clr-filters"
          onClick={() => setFiltersOpen((v) => !v)}>
          <Icon name="sliders" size={15} />Filters
          {activeFilters.length ? <span className="clr-filters-count">{activeFilters.length}</span> : null}
        </button>
      </div>
      {filtersOpen ? (
        <div className="clr-filters" id="clr-filters">
          {ctx.me.accounts.length > 1 || seesAll ? (
            <label className="clr-filter">
              <span className="field-label">Company</span>
              <select className="ctx-select" value={ownerFilter ?? ''} data-anon="mark"
                onChange={(e) => { ctx.setOwner(e.target.value || null); resetPage() }}>
                <option value="">All companies</option>
                {companyKeys.map((k) => <option key={k} value={k}>{ctx.ownerName(k)}</option>)}
              </select>
            </label>
          ) : null}
          <label className="clr-filter">
            <span className="field-label">Search type</span>
            <select className="ctx-select" value={level} onChange={(e) => { setLevel(e.target.value as LevelFilter); resetPage() }}>
              <option value="all">All search types</option>
              {SEARCH_LEVELS.map((l) => <option key={l.product} value={l.product}>{l.name}</option>)}
            </select>
          </label>
          <label className="clr-filter">
            <span className="field-label">Sort by</span>
            <select className="ctx-select" value={sortBy} onChange={(e) => { setSortBy(e.target.value as SortBy); resetPage() }}>
              <option value="activity">Latest activity</option>
              <option value="name">Name A to Z</option>
              <option value="risk">Highest risk</option>
            </select>
          </label>
          {groupable ? (
            <label className="group-toggle clr-filter-check">
              <input
                type="checkbox"
                className="pickbox"
                checked={groupByOwner}
                onChange={(e) => {
                  setGroupByOwner(e.target.checked)
                  writeGroupPref(e.target.checked)
                  resetPage()
                }}
              />
              Group by company
            </label>
          ) : null}
        </div>
      ) : null}
      {activeFilters.length ? (
        <div className="clr-chips">
          {activeFilters.map((f) => (
            <button key={f.key} type="button" className="chip clr-chip" aria-label={`Remove ${f.label} filter`} onClick={f.clear}>
              <span data-anon={f.key === 'company' ? 'mark' : undefined}>{f.label}</span> <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      ) : null}

      {/* WHAT THE LAST CHANGE DID, said once and then gone. */}
      {note ? <p className="clr-note" role="status" data-anon="mark">{note}</p> : null}
      {ask ? <AskDialog ask={ask} onDone={(n) => { setAsk(null); setNote(n) }} onClose={() => setAsk(null)} /> : null}
      {grouping ? (
        <GroupingDialog
          marks={allNames}
          families={familyIndex}
          initialCompany={grouping.family ? familyIndex.get(grouping.family)?.company ?? companyKeys[0]!
            : grouping.seed.length ? runKey(allNames.find((m) => m.id === grouping.seed[0]) ?? allNames[0]!) : ownerFilter ?? companyKeys[0]!}
          initialFamily={grouping.family}
          seed={grouping.seed}
          companyName={ctx.ownerName}
          onSaved={(n) => { setGrouping(null); setNote(n); reloadFamilies() }}
          onClose={() => setGrouping(null)}
        />
      ) : null}

      {/* THE STATUS TABS, Retired among them: retiring is a state a search is in, so its list is a tab rather
          than a fold under the table. A count is shown where there is one. */}
      <div className="clr-tabs" role="group" aria-label="Show searches by status">
        {tabs.map((t) => (
          <button key={t.key} type="button" className="clr-tab" aria-pressed={filter === t.key}
            onClick={() => { setFilter(t.key); resetPage() }}>
            {t.label}{t.count ? <span className="clr-tab-count">{t.count}</span> : null}
          </button>
        ))}
      </div>
      {filter !== 'retired' ? (<>
      <div className="table-wrap names-wrap" ref={namesWrap}>
        {/* THE GRID IS DECLARED, NOT EMERGENT.
            The table had no `table-layout` and no column widths at all, so every column was sized by
            whatever text happened to be in it — which is why expanding a row could re-flow the parent
            and truncate the `Updated` header to `Upd`. `table-layout: fixed` (in base.css) plus this
            colgroup means the columns are decided once, by the header, and nothing below can move them.
            That is also what lets an expanded read be a real row in the same grid instead of a panel
            positioned to look like one.
            SIZED TO CONTENT, and re-measured rather than guessed — scripts/clearances-render-check.mjs
            reports each column's share in a real browser and fails if the date or an ordinary mark wraps.
            The columns were roughly INVERSE to how much they matter: Status held 47% because it was sized
            for the raw engine string  removed, while the mark wrapped to three lines and a
            ten-character date wrapped to two beside ~300px of empty space.
            Name is the widest of the text columns, which is what the page is about, and the actions
            column is sized for its buttons so Open lines up down the page. The shares, and the reason
            they are all percentages, live in `clearancesColumns` (contract/listView.ts), where a test
            holds them to 100 in every mode. */}
        <table className="data fixed">
          <colgroup>
            {clearancesColumns({ pick: false, owner: showOwnerColumn, updated: false }, { wide: tableWidth >= BOARD_SHARES_FROM }).map((c) => (
              <col key={c.key} style={{ width: `${c.share}%` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th />
              {/* NO HEADER over the disclosure column: each disclosure button is named for its own row
                  ("Expand searches for {name}"), so a header word would add nothing. */}
              <th>Name and searches</th>
              {/* — UNGROUPED, THE OWNER MOVES INTO A COLUMN. The issue rejects an ungrouped mode
                  that drops the company: the information has to survive the toggle. A column rather
                  than a chip, so it is sortable-adjacent, scannable, and in the grid  built. */}
              {showOwnerColumn ? <th>Company</th> : null}
              {/* deleted the Stages column: it spent width on a rung number saying something the
                  page already says in words on every read row, which is the product's own name.
                  then retired the ladder itself — there are FOUR SEARCHES and a client buys one of them
                  — so the column has nothing left to encode. The retired keys survive only in
                  search-policy.mjs RETIRED_POLICIES, which is what lets an archived run re-render under
                  the name it was sold under. */}
              <th>Status</th>
              <th>Risk</th>
              {/* The actions column carries buttons whose own labels say what they do, so its header is
                  for screen readers only. */}
              <th className="col-actions-head">Report and actions</th>
            </tr>
          </thead>
          <tbody>
            {/* THE EMPTY STATE LIVES HERE, in the list, and nowhere else. Everything above it — the
                company chips and the status filters — stays on screen in every state, so the way out of
                an empty view is where it was when you arrived at it. */}
            {orderRows.map((o) => (
              <tr key={`order-${o.reference}`} className="read-row openable" onClick={() => ctx.go(receiptPath(o.reference, runKey(o)))}>
                <td className="clr-td-twisty nest-1" />
                <td className="clr-td-name">
                  <b className="clr-search-name"><span data-anon="mark">{o.markName ?? o.reference}</span></b>
                  {o.updatedAt ? <span className="sub mono" style={{ fontSize: 12.5 }}><span className="nowrap-date">{o.updatedAt.slice(0, 10)}</span></span> : null}
                </td>
                {showOwnerColumn ? <td>{ctx.ownerName(runKey(o))}</td> : null}
                <td className="clr-td-status">{o.state === 'refused' ? 'Order did not start' : 'Waiting to start'}</td>
                <td className="clr-td-risk"><span style={{ color: 'var(--text-faint)' }}>—</span></td>
                <td className="col-actions" />
              </tr>
            ))}
            {!visible.length && !orderRows.length ? (
              <tr>
                <td colSpan={5 + (showOwnerColumn ? 1 : 0)} style={{ padding: '22px 12px', color: 'var(--text-muted)' }}>
                  {/* THE WAY OUT, ON THE EMPTY VIEW ITSELF (board Clearances, approved 2026-11-25). */}
                  <span className="list-empty">
                    No names match this view.{' '}
                    <button type="button" className="linkish clr-show-all" onClick={showAllNames}>Show all names</button>
                  </span>
                </td>
              </tr>
            ) : null}
            {visible.map((r, i) => {
              // A heading row whenever the owner changes. The rows are already sorted, so this needs no
              // separate grouping pass — and it keeps the user's chosen sort intact WITHIN each group
              // rather than silently re-sorting by owner.
              //
              // Compared against the previous VISIBLE row, not the previous row overall: when a group
              // spans a page break, the continuation page must repeat the heading. Otherwise the first
              // rows of page 2 sit under no owner at all, which is precisely the confusion — two brand
              // owners' identically-named marks reading as one — that grouping exists to prevent.
              const before = visible[i - 1]
              const newGroup = grouped && (!before || runKey(r) !== runKey(before))
              return (
                <Fragment key={r.id}>
                  {newGroup ? (
                    // — A SECTION HEADER, not a decorative divider. This was the smallest,
                    // lowest-contrast, most letterspaced type on the page, which read as a rule between
                    // rows rather than as "everything below this belongs to Foxglade Interactive".
                    <tr className="group-head">
                      <td colSpan={5 + (showOwnerColumn ? 1 : 0)}>
                        <span className="owner-name" data-anon="mark">
                          {ctx.ownerName(runKey(r))}
                        </span>
                        <span className="owner-count">
                          {namesLabel(nameCount(rows.filter((x) => runKey(x) === runKey(r))))}
                        </span>
                      </td>
                    </tr>
                  ) : null}
                  {r.kind === 'family' ? (
                    <FamilyRows
                      family={r}
                      isOpen={(id) => open.has(id)}
                      onToggle={toggle}
                      go={ctx.go}
                      showOwner={showOwnerColumn}
                      ownerLabel={ctx.ownerName(runKey(r))}
                      onUngroup={canGroup ? ungroupFamily : undefined}
                      onAddNames={canGroup ? (f) => openGrouping(f.id) : undefined}
                      onGroupWith={canGroup ? (m) => openGrouping(null, [m.id]) : undefined}
                      onRemoveFromFamily={canGroup ? removeFromFamily : undefined}
                      onRetire={canGroup ? retireMark : undefined}
                      onRetireRun={canGroup ? retireRun : undefined}
                      askAi={askAi}
              askMenu={askMenu}
                    />
                  ) : (
                    <MarkRow
                      mark={r}
                      open={open.has(r.id)}
                      onToggle={() => toggle(r.id)}
                      go={ctx.go}
                      showOwner={showOwnerColumn}
                      ownerLabel={ctx.ownerName(runKey(r))}
                      onGroupWith={canGroup ? (m) => openGrouping(null, [m.id]) : undefined}
                      onRetire={canGroup ? retireMark : undefined}
                      onRetireRun={canGroup ? retireRun : undefined}
                      askAi={askAi}
              askMenu={askMenu}
                    />
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      <PinnedScrollbar target={namesWrapEl} />
      </>) : null}

      {/* THE RETIRED TAB: individual searches, each with Restore — a failed one included, which goes back to
          Failed. RUNS, NOT NAMES: this is a recovery list, and showing what would actually be restored beats
          a tidier shape that hides it. The way back from a one-way hide lives on the same page. */}
      {filter === 'retired' ? (
        <div className="table-wrap" style={{ marginTop: 6 }}>
          <table className="data clr-retired-table">
            <thead>
              <tr>
                <th>Name and searches</th>
                <th>Status</th>
                <th aria-label="Report and actions">Report and actions</th>
              </tr>
            </thead>
            <tbody>
              {!retiredShown.length ? (
                <tr><td colSpan={3} style={{ padding: '22px 12px', color: 'var(--text-muted)' }}>
                  <span className="list-empty">No retired searches in this view.</span>
                </td></tr>
              ) : null}
              {retiredShown.map((run) => (
                <tr key={run.runId} className="row">
                  <td className="clr-td-name">
                    <b data-anon="mark" style={{ color: 'var(--text-strong)' }}>{displayName(run)}</b>
                    <div className="sub" style={{ color: 'var(--text-muted)', fontSize: 12.5 }}>
                      {readLabel(run)}
                      {groupable && !grouped ? <> · <span data-anon="mark">{ctx.ownerName(runKey(run))}</span></> : null}
                    </div>
                  </td>
                  <td className="clr-td-status">
                    <StatusCell state={run.state} step={null} reason={run.state === 'failed' ? run.reason : null} failedStage={run.state === 'failed' ? run.failedStage : null} />
                  </td>
                  <td className="col-actions" style={{ textAlign: 'right' }}>
                    <button type="button" className="btn-ghost clr-open" onClick={() => void restoreRun(run)}>Restore</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {pageCount > 1 ? (
        <nav className="pager" aria-label="Pages of clearances">
          {/*
            The range is stated rather than just the page number. "51 to 100 of 73" is impossible, so a
            user who sees a sensible range knows the filter and the page agree — which is the thing that
            goes wrong when a filter narrows the list under a page that has scrolled past its end.
          */}
          <span className="mono" style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            {from}–{to} of {rows.length}
          </span>
          <span style={{ flex: 1 }} />
          <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)}>
            <Icon name="chevron-left" size={14} />
            Previous
          </button>
          <span className="mono" style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            Page {current + 1} of {pageCount}
          </span>
          <button type="button" disabled={current >= pageCount - 1} onClick={() => setPage(current + 1)}>
            Next
            <Icon name="chevron" size={14} />
          </button>
        </nav>
      ) : null}
    </div>
  )
}

function Loading() {
  return (
    <div className="screen">
      <div className="eyebrow">Clearances</div>
      <div className="empty" role="status" aria-live="polite">
        Loading your clearances…
      </div>
    </div>
  )
}

/** The chevron that says a row opens. */
/**
 * The row disclosure.
 *
 * It was a bare `<span aria-hidden="true">` inside a `<tr onClick>` — so the page's primary navigation
 * was silent to a screen reader AND unreachable from a keyboard. Not "the button had no name": there was
 * no button, no `aria-expanded`, and no way to open a row without a mouse at all.
 *
 * It is a real `<button>` now, named for the row it controls and carrying its state. The chevron stays
 * `aria-hidden` — it is decoration beside the name, and announcing "chevron" helps nobody.
 *
 * The NAME is passed in rather than composed here, and the reason is the issue's own instruction: copy
 * the naming pattern that is current when you build, not today's string. A name assembled in this
 * component would be a second convention drifting from the caller's.
 */
function Twisty({ open, label, onToggle }: { readonly open: boolean; readonly label: string; readonly onToggle: () => void }) {
  return (
    <button
      type="button"
      className="twisty"
      aria-expanded={open}
      aria-label={label}
      onClick={(e) => {
        // stopPropagation, or the row's own onClick fires too and the row toggles twice — opening and
        // closing in one click, which looks exactly like a control that does nothing.
        e.stopPropagation()
        onToggle()
      }}
    >
      <span
        style={{ display: 'inline-block', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s var(--ease-out)', color: 'var(--text-faint)' }}
        aria-hidden="true"
      >
        <Icon name="chevron" size={14} />
      </span>
    </button>
  )
}

/** Ask AI for one read, drawn by the screen — which holds the one answer about this reader's assistant. */
type AskAiSlot = (name: string, read: Run) => ReactNode
/** Whether this row offers Ask AI at all, and what its menu entry does. */
type AskAiMenu = (read: Run) => { readonly show: boolean; readonly open: () => void }

/**
 * The row's overflow menu, "···" — where the curation acts live: retire, and ungroup.
 *
 * THEY MOVED HERE FROM THE NAME CELL. Retire and Ungroup were underlined links beside the name, in the
 * line a reader scans for the name, on every row. In the menu they are one press further away and
 * exactly as available — and the menu is drawn only for someone who may curate, so nobody else meets a
 * control that would only refuse them.
 *
 * BOTH HANDLERS ARE STOPPED, ONCE, HERE. The menu sits inside a row that opens a report or its thread on
 * a click, and a press inside it that reached the row would retire a read and then navigate away from
 * the screen that would have shown it worked — for a keyboard user, every time. Stopping the click and
 * the keydown on the wrapper covers the button and every item in the list, rather than asking each item
 * to remember.
 */
function RowMenu({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])
  return (
    <div
      ref={box}
      className="row-menu"
      onClick={(e) => {
        e.stopPropagation()
      }}
      onKeyDown={(e) => {
        e.stopPropagation()
        // Escape is read here rather than on the document: the stop above is what keeps it from getting there.
        if (e.key === 'Escape') setOpen(false)
      }}
    >
      <button
        type="button"
        className="row-menu-btn"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true">···</span>
      </button>
      {open ? (
        <div className="float row-menu-list" role="menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      ) : null}
    </div>
  )
}

function MenuItem({ onSelect, title, children }: {
  readonly onSelect: () => void
  readonly title?: string
  readonly children: ReactNode
}) {
  return (
    <button type="button" role="menuitem" className="nav-item row-menu-item" title={title} onClick={onSelect}>
      {children}
    </button>
  )
}

/**
 * The actions column: Open, Ask AI and the row menu, each in its own track.
 *
 * ONE COLUMN, ONE WIDTH. Every Open on the page — "Open", "Open latest report", a search row's "Open" —
 * sits in the same track at the same width, so the eye runs straight down them. A row with no Open keeps
 * its track empty rather than letting Ask AI slide left into it, which is what makes Ask AI line up too.
 * The browser check measures both, at the widest and the narrowest width it drives.
 */
function RowActions({ open, ask, menu }: {
  /** The report button: its words, where it goes, and the name a screen reader hears for it. */
  readonly open: { readonly label: string; readonly go: () => void; readonly name?: string } | null
  readonly ask: ReactNode
  readonly menu: ReactNode
}) {
  return (
    // THE BOX IS THE CONTAINER the layout asks, so the side-by-side form is chosen by the width this
    // cell actually has rather than by the width of the whole table (see .row-actions-box).
    <div className="row-actions-box">
    <div className="row-actions">
      <span className="row-actions-open">
        {open ? (
          // The visible words lead the screen-reader name, which adds the row's name, search and date
          // (board Clearances, approved 2026-11-25), so "press Open latest report" still finds it.
          <button
            type="button"
            className="row-open"
            aria-label={open.name}
            onClick={(e) => {
              e.stopPropagation()
              open.go()
            }}
          >
            <Icon name="doc" size={14} />{open.label}
          </button>
        ) : null}
      </span>
      {/* Ask AI opens its own panel, so no click inside it may reach the row. Keys are left alone: the
          row answers none, and the panel closes on an Escape it hears on the document. */}
      <span className="row-actions-ask" onClick={(e) => e.stopPropagation()}>
        {ask}
      </span>
      <span className="row-actions-more">{menu}</span>
    </div>
    </div>
  )
}

function FamilyRows({
  family,
  isOpen,
  onToggle,
  go,
  showOwner = false,
  ownerLabel = '',
  onUngroup,
  onAddNames,
  onGroupWith,
  onRemoveFromFamily,
  onRetire,
  onRetireRun,
  askAi,
  askMenu,
}: {
  readonly family: Extract<Row, { kind: 'family' }>
  /** Opens the grouping dialog on this family. Absent ⇒ no control, as for every curation act. */
  readonly onAddNames?: ((family: Extract<Row, { kind: 'family' }>) => void) | undefined
  readonly onGroupWith?: ((mark: MarkGroup) => void) | undefined
  readonly onRemoveFromFamily?: ((mark: MarkGroup, familyName: string) => void) | undefined
  readonly isOpen: (id: string) => boolean
  readonly onToggle: (id: string) => void
  readonly go: (p: string) => void
  /** — ungrouped, the company is a column, so every row shape needs its cell. */
  readonly showOwner?: boolean
  readonly ownerLabel?: string
  /** — absent ⇒ no control, so a read-only caller cannot grow one by accident. Explicitly
      `| undefined` because the project runs exactOptionalPropertyTypes. */
  readonly onUngroup?: ((family: Extract<Row, { kind: 'family' }>) => void) | undefined
  /** — retire reaches the names INSIDE a family too: a family is a grouping of rows, not a
      different kind of thing, and a name you cannot retire because someone grouped it is a control
      that stops working for no reason the user can see. */
  readonly onRetire?: ((mark: MarkGroup) => void) | undefined
  /** — and the per-READ retire reaches inside a family for the same reason: a family is a
      grouping of rows, not a different kind of thing. Passed straight through to each MarkRow. */
  readonly onRetireRun?: ((run: Run) => void) | undefined
  readonly askAi: AskAiSlot
  readonly askMenu: AskAiMenu
}) {
  const open = isOpen(family.id)
  // A GROUP FOLLOWS ITS MEMBERS. When any name in it has a search under way the status says how many,
  // rather than rolling the members' states into one word that hides which of them is moving.
  return (
    <>
      {/* The group expands and opens nothing: a family is several names, with no single report. */}
      <tr className="row" onClick={() => onToggle(family.id)}>
        <td className="clr-td-twisty">
          <Twisty open={open} onToggle={() => onToggle(family.id)} label={`${open ? 'Collapse' : 'Expand'} ${family.name}`} />
        </td>
        {/* A family's own menu adds names or ungroups it; a member leaves through its own row's menu. */}
        <td className="clr-td-name">
          <span className="clr-family-icon" aria-hidden="true"><Icon name="layers" size={14} /></span>
          <b data-anon="mark" style={{ color: 'var(--text-strong)' }}>
            {family.name}
          </b>
          <span className="clr-meta"> · {namesLabel(family.marks.length)}</span>
          {/* What the Risk cell rolls up, said once under the name — "worst" is the one thing about a
              group row that is not obvious from looking at it, and "worst of 2" said it without saying
              worst of WHAT. */}
          <span className="sub">{familyLine(family)}</span>
          {/* NO TAGS ON A GROUP. Tags go under a NAME, and a group is several names: each one inside it carries
              its own when the group is opened, and the risk line stays the last thing in this cell. */}
        </td>
        {/* found this: the family row still carried the Stages cell after deleted that column,
            so it had one cell MORE than the table had columns. The browser check never saw it — the
            fixture had no families — and it only surfaced when the ungrouped mode made a second row
            shape's cell count matter. Removed, and the owner cell added in its place. */}
        {showOwner ? (
          <td data-anon="mark" style={{ color: 'var(--text-muted)' }}>
            {ownerLabel}
          </td>
        ) : null}
        {/* THE FAMILY'S LINE SAYS ITS RISK AND WHAT IS IN PROGRESS, so its Status and Risk cells stay empty
            rather than saying it twice on one row (board Clearances, approved 2026-11-25). */}
        <td className="clr-td-status" />
        <td className="clr-td-risk" />
        <td className="col-actions">
          {/* — UNGROUP LIVES WHERE THE FAMILY IS. The owner asked whether runs could be ungrouped at
              all: the multi-select button renders only once you have ticked a run that is already in a
              family, and nothing said so. The invitation is on the row a person looking to break up a
              family actually looks at, in its menu, and it ungroups the WHOLE family — which is what the
              row is about. Taking one name out stays the multi-select move. */}
          <RowActions
            open={null}
            ask={null}
            menu={onUngroup ? (
              <RowMenu label={`More actions for ${family.name}`}>
                {onAddNames ? <MenuItem onSelect={() => onAddNames(family)}>Add names to this family…</MenuItem> : null}
                <MenuItem onSelect={() => onUngroup(family)}>Ungroup family…</MenuItem>
              </RowMenu>
            ) : null}
          />
        </td>
      </tr>
      {open
        ? family.marks.map((m) => (
            <MarkRow
              key={m.id}
              mark={m}
              open={isOpen(m.id)}
              onToggle={() => onToggle(m.id)}
              go={go}
              indent
              showOwner={showOwner}
              ownerLabel={ownerLabel}
              familyName={family.name}
              onRetire={onRetire}
              onRetireRun={onRetireRun}
              onGroupWith={onGroupWith}
              onRemoveFromFamily={onRemoveFromFamily}
              askAi={askAi}
              askMenu={askMenu}
            />
          ))
        : null}
    </>
  )
}

function MarkRow({
  mark,
  open,
  onToggle,
  go,
  indent = false,
  showOwner = false,
  ownerLabel = '',
  onRetire,
  onRetireRun,
  onGroupWith,
  onRemoveFromFamily,
  familyName = null,
  askAi,
  askMenu,
}: {
  readonly mark: MarkGroup
  /** The family this name sits in, by name, when it sits in one. */
  readonly familyName?: string | null
  readonly onGroupWith?: ((mark: MarkGroup) => void) | undefined
  readonly onRemoveFromFamily?: ((mark: MarkGroup, familyName: string) => void) | undefined
  readonly open: boolean
  readonly onToggle: () => void
  readonly go: (p: string) => void
  /** True when the row sits under a family, which is the only thing that nests it. */
  readonly indent?: boolean
  /** — ungrouped, the company moves from the section header into a column on every row. */
  readonly showOwner?: boolean
  readonly ownerLabel?: string
  /** — absent ⇒ no control, so a client view cannot grow a curation act by accident. Explicitly
      `| undefined` because the project runs exactOptionalPropertyTypes. */
  readonly onRetire?: ((mark: MarkGroup) => void) | undefined
  /** — the per-READ retire, gated by the SAME `canGroup` expression as `onRetire` at the call
      site rather than a second one, so the two curation acts cannot come to differ about who may
      curate. Absent ⇒ no control, exactly as  requires of its group-level sibling. */
  readonly onRetireRun?: ((run: Run) => void) | undefined
  readonly askAi: AskAiSlot
  readonly askMenu: AskAiMenu
}) {
  const run = mark.current
  const threaded = mark.reads.length > 1
  // ONE REPORT, FOUR USES: the bands in the Risk cell, the date under them, what Open opens and what Ask
  // AI asks about all come from `nameRow.ts`, so the four cannot come to describe different searches.
  const report = shownReport(mark)
  const secondLine = reportLineParts(mark)
  const actions = nameActions(mark)
  const target = actions.open
  const openReport = target ? () => go(`/portal/result/${encodeURIComponent(target.read.runId)}`) : null
  // THE EXPAND CONTROL IS ONLY WHERE THERE IS SOMETHING TO EXPAND. A name with one search has no thread,
  // so its row opens its report rather than unfolding a list of one; a name with neither a thread nor a
  // report does nothing on a click, and does not look as if it would.
  const onRow = threaded ? onToggle : openReport

  return (
    <>
      <tr className={onRow ? 'row' : 'row inert'} onClick={onRow ?? undefined}>
        <td className={`clr-td-twisty${indent ? ' nest-1' : ''}`}>
          {/* Named from mark.name, the same source as the row's menu ("More actions for {name}"), so the
              two names cannot drift apart. */}
          {threaded ? <Twisty open={open} onToggle={onToggle} label={`${open ? 'Collapse' : 'Expand'} searches for ${mark.name}`} /> : null}
        </td>
        <td className="clr-td-name">
          <b data-anon="mark" style={{ color: 'var(--text-strong)' }}>
            {mark.name}
          </b>
          {/* deleted `GROUP · N`. On a one-mark batch it announced a group of one, which is not a
              group and tells a reader nothing either way; on a larger batch it restated a count the
              Name cell now carries in words —  made that cell read "VENZY +2 more". */}
          {/* Only when there IS a thread. A "1 search" badge on every single-search name is noise on
              every row, and noise on every row is how the row that needed a badge stops being seen. */}
          {threaded ? <span className="clr-meta"> {searchesLabel(mark.reads.length)}</span> : null}
          {/* IMPROVED SINCE. Outside the Risk cell on purpose — that cell reports what the report found,
              and a second value in it would be the blend this issue is removing. It renders only
              when an earlier read was WORSE than the latest, which is rare: a marker on every row is one
              nobody sees. */}
          {mark.improvedFrom && report ? (
            <span className="pill" style={{ marginLeft: 8 }} title={`An earlier search of this name came back ${mark.improvedFrom}. The row shows where it stands now.`}>
              was {mark.improvedFrom}
            </span>
          ) : null}
          {/* deleted the company chip.
              It only ever rendered when grouping was ON (grouped AND the name ambiguous), which is
              precisely when a section header sits directly above the row already saying the same thing.
              So it was the same string twice on one line — the thing the header was failing to
              communicate, repeated rather than fixed. Making the header read as a header is the fix.
              Grouping OFF is a separate case, and it needs the owner on every row rather than on the ones
              that happen to collide — which is the column below, not a chip. */}
          {/* THE SEARCH THE ROW SPEAKS FOR, in words, under the name (board Clearances). */}
          <span className="sub">{readLabelParts(run).head ?? ''}</span>
        </td>
        {/* — UNGROUPED, THE OWNER LIVES HERE. The information has to survive the toggle, and a
            column survives it in the grid  built rather than as a chip crowding the Name cell. */}
        {showOwner ? (
          <td data-anon="mark" style={{ color: 'var(--text-muted)' }}>
            {ownerLabel}
          </td>
        ) : null}
        <td className="clr-td-status">
          <StatusCell
            state={run.state}
            step={run.step}
            reason={run.reason}
            failedStage={run.failedStage}
            pausedKind={run.pausedKind}
            resetsAt={run.resetsAt}
            stopRequestedAt={run.stopRequestedAt}
            count={statusCount(mark)}
          />
          {/* THE DAY IT FINISHED, under its status, once it has (board Clearances, approved 2026-11-25). */}
          {TERMINAL.has(run.state) && mark.date ? <span className="sub mono nowrap-date">{mark.date}</span> : null}
        </td>
        <td className="clr-td-risk">
          {/* THE BANDS PRESENT, WORST FIRST — not a computed summary. The cell REPORTS what the report
              contains, so a reader can reconstruct it from the cell. One mark has one band.
              AND WHICH REPORT, WHEN IT IS NOT THE NEWEST SEARCH. While a re-read waits or runs, the bands
              are the latest report's and the quiet line beneath dates it, so the search under way and the
              assessment already held are told apart rather than blended. With nothing under way and no
              report — running for the first time, or stopped — an em dash says so. */}
          {report && mark.reportBands.length ? (
            <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {/* "Risk", on a phone only, where the column's heading is not drawn (board Clearances). */}
              <span className="clr-phone-only">Risk</span>
              {mark.reportBands.map((label) => (
                <RiskDot key={label} tone={report.bands.find((b) => b.label === label)?.tone ?? null} label={label} />
              ))}
            </span>
          ) : (
            <span style={{ color: 'var(--text-faint)' }}>—</span>
          )}
          {secondLine ? (
            <span className="sub report-line">
              {secondLine.label}
              {secondLine.date ? <> · <span className="nowrap-date">{secondLine.date}</span></> : null}
            </span>
          ) : null}
        </td>
        <td className="col-actions">
          <RowActions
            open={target && openReport ? {
              label: target.label,
              go: openReport,
              // The button's words, then the row it belongs to: name, search and date (board Clearances).
              name: `${target.label} for ${mark.name}, ${readLabel(target.read).replace(' · ', ', ')}`,
            } : null}
            ask={actions.askAbout ? askAi(mark.name, actions.askAbout) : null}
            menu={onRetire || (actions.askAbout && askMenu(actions.askAbout).show) ? (
              <RowMenu label={`More actions for ${mark.name}`}>
                {/* THE NAME'S MENU (board Clearances, approved 2026-11-25): grouping, the family it sits in,
                    retiring every search with the count said, and the searches folded under it. */}
                {onGroupWith && !familyName ? <MenuItem onSelect={() => onGroupWith(mark)}>Group with other names…</MenuItem> : null}
                {onRemoveFromFamily && familyName ? <MenuItem onSelect={() => onRemoveFromFamily(mark, familyName)}>Remove from family…</MenuItem> : null}
                {onRetire ? (
                  <MenuItem onSelect={() => onRetire(mark)}>
                    {threaded ? `Retire all ${mark.reads.length} searches…` : 'Retire this search…'}
                  </MenuItem>
                ) : null}
                {threaded && !open ? <MenuItem onSelect={onToggle}>{`Show all ${mark.reads.length} searches`}</MenuItem> : null}
                {/* ASK AI, THE ROW'S OWN ENTRY (owner, 2026-09-18), opening the same panel with the same label. */}
                {actions.askAbout && askMenu(actions.askAbout).show ? (
                  <MenuItem onSelect={() => askMenu(actions.askAbout as Run).open()}>Ask AI</MenuItem>
                ) : null}
              </RowMenu>
            ) : null}
          />
        </td>
      </tr>

      {/* THE THREAD. Every search of this name, newest first. Each is a REAL ROW in the parent's grid:
          it was a single <td colSpan> holding its own flex layout, so where its values landed was decided
          by the length of the text beside them rather than by a column. */}
      {open ? mark.reads.map((r) => (
        <ReadRow
          key={r.runId}
          read={r}
          go={go}
          indent={indent}
          showOwner={showOwner}
          latest={r.runId === mark.latestReport?.runId}
          sameDayAsAnother={sameDateAsAnother(mark.reads, r)}
          {...(threaded ? { onRetire: onRetireRun } : {})}
        />
      )) : null}

      {open && run.marks.length > 1 ? (
        <tr>
          <td colSpan={5 + (showOwner ? 1 : 0)} style={{ background: 'var(--surface-sunken)' }}>

            {/* A batch's per-name answers: one read's contents, not a thread, so this one stays a
                spanning cell — the names are not searches and do not belong in the search grid. */}
            <div style={{ display: 'grid', gap: 8, paddingLeft: indent ? 26 : 0 }}>
              {run.marks.map((m) => (
                <div key={m.name} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <b data-anon="mark" style={{ minWidth: 160 }}>
                    {m.name}
                  </b>
                  <RiskDot tone={m.tone} label={m.band} />
                </div>
              ))}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  )
}

/**
 * One search in the thread — a REAL ROW in the parent table's grid.
 *
 * It used to be a <div> inside a spanning cell, laid out with its own flex row. That is the mechanism
 * behind "the column alignment is a mess": nothing in it participated in the column grid, so where a
 * value landed was decided by the length of the text beside it.
 *
 * Now each value sits in the cell of the column it belongs to — Status under Status, Risk under Risk —
 * so the alignment is structural rather than coincidental, and a longer title moves nothing but itself.
 */
function ReadRow({
  read,
  go,
  indent,
  showOwner = false,
  latest = false,
  sameDayAsAnother = false,
  onRetire,
}: {
  readonly read: Run
  readonly go: (p: string) => void
  readonly indent?: boolean
  /** — a spacer under the company column, so a search row still matches the grid when shown. */
  readonly showOwner?: boolean
  /** The newest search that delivered — the report the name row above speaks for, so it is badged. */
  readonly latest?: boolean
  /** Another search of this name finished on the same day — the case a date alone cannot separate. */
  readonly sameDayAsAnother?: boolean
  /** — retire THIS search. Absent ⇒ no control (the rule inherited from the parent's gate). */
  readonly onRetire?: ((run: Run) => void) | undefined
}) {
  // THE OPEN BUTTON IS THE CONTROL. The row used to be the control — a `role="link"` with a faint "Open ›"
  // cue — because the only way in had been a text button at the far right edge that nobody found. A
  // bordered Open in its own column is found; so it is the one named, focusable target, and the row keeps
  // only the mouse's convenience of a click anywhere on it. One tab stop per search, not two.
  //
  // A search with NO report gets NO affordance at all: no button, no pointer, no hover. A dead target is
  // worse than no target, which is why this is a branch rather than a disabled state. — A BATCH HAS
  // REPORTS, JUST NOT ONE OF THEM: see `hasReport`.
  const openable = hasReport(read)
  const open = () => go(`/portal/result/${encodeURIComponent(read.runId)}`)
  const label = readLabelParts(read)

  return (
    <tr className={openable ? 'read-row openable' : 'read-row'} {...(openable ? { onClick: open } : {})}>
      {/* The first column carries the nesting: a rule per level, so containment is visible without
          reading anything. */}
      <td className={`clr-td-twisty ${indent ? 'nest-2' : 'nest-1'}`} />
      <td className="clr-td-name">
        {/* THE SEARCH, THEN ITS DATE beneath it (board Clearances, approved 2026-11-25). */}
        <b className="clr-search-name">{label.head ?? readLabel(read)}</b>
        <span className="sub mono" style={{ fontSize: 12.5 }}>
          {label.head && label.date ? <span className="nowrap-date">{label.date}</span> : null}
          {/* THE ORDERING KEY, SHOWN. A date alone cannot separate two searches of the same day. The time
              appears only when it is needed to tell them apart. UTC, and it says so. */}
          {sameDayAsAnother && readTime(read) ? <span style={{ marginLeft: 6 }}>{readTime(read)} UTC</span> : null}
        </span>
        {/* WHICH ONE IS THE LATEST REPORT. The name row's Risk cell speaks for one search in this list;
            the badge says which, so the rule has a visible key. */}
        {latest ? <span className="pill" style={{ marginLeft: 8 }}>Latest report</span> : null}
        {/* — WHAT THIS SAYS IS NOW WHAT IS TRUE. It used to claim the run was still with a reviewer
            ahead of release — a step nobody performs — on a run that had in fact been delivered. The
            state is: delivered, and this view has no file to link. */}
        {!openable && read.state === 'delivered' ? (
          <span className="sub">Delivered — no report file found for this run.</span>
        ) : null}
      </td>
      {/* — a search belongs to the same owner as its parent row, so the cell is a spacer rather than
          a repetition. It exists because the grid must still line up. */}
      {showOwner ? <td /> : null}
      <td className="clr-td-status">
        {/* THE ONE PLACE the engine's own words are reachable. The parent row states the status; here,
            where the reader is looking at this specific search, a Details disclosure holds the raw value. */}
        <StatusCell
          state={read.state}
          step={read.step}
          reason={read.reason}
          failedStage={read.failedStage}
          stopRequestedAt={read.stopRequestedAt}
          detailed
        />
      </td>
      <td className="clr-td-risk">
        {read.state === 'delivered' && read.band ? (
          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            <span className="clr-phone-only">Risk</span>
            <RiskDot tone={read.tone} label={read.band} />
          </span>
        ) : <span style={{ color: 'var(--text-faint)' }}>—</span>}
      </td>
      {/* A search's date is in its own label, "Product · date", so this cell stays empty rather than
          saying it twice on one line. */}
      <td className="col-actions">
        <RowActions
          open={openable ? { label: 'Open report', go: open, name: `Open report for ${displayName(read)}, ${readLabel(read).replace(' · ', ', ')}` } : null}
          ask={null}
          menu={onRetire ? (
            <RowMenu label={`More actions for ${readLabel(read)}`}>
              <MenuItem onSelect={() => onRetire(read)}>Retire this search…</MenuItem>
            </RowMenu>
          ) : null}
        />
      </td>
    </tr>
  )
}

/**
 * The empty archive. `onNew` is null for a person who may not start a clearance — they get the plain
 * fact and no button, because the page a button would open does not exist for them.
 */
function FirstRun({ onNew }: { readonly onNew: (() => void) | null }) {
  if (!onNew) {
    return (
      <div className="screen">
        <div className="empty">
          <h1 style={{ fontSize: 25, color: 'var(--text-strong)', margin: '0 0 8px' }}>No clearances yet</h1>
          <p className="prose" style={{ margin: '0 auto' }}>
            Reports for the companies you can see will appear here once they are delivered.
          </p>
        </div>
      </div>
    )
  }
  return (
    <div className="screen">
      <div className="empty">
        <h1 style={{ fontSize: 25, color: 'var(--text-strong)', margin: '0 0 8px' }}>No clearances yet</h1>
        <p className="prose" style={{ margin: '0 auto 22px' }}>
          Start with a name and the classes it will trade in. You will see the plan, and what it covers,
          before anything runs.
        </p>
        <button
          type="button"
          className="nav-item active"
          style={{ width: 'auto', margin: '0 auto', justifyContent: 'center' }}
          onClick={onNew}
        >
          Start your first clearance
        </button>
        {/*
          The standing disclaimer is NOT minted here. No canonical wording exists in the repo, it is
          client-facing legal copy, and it has to be signed off rather than drafted by whoever wrote the
          empty state. It lands in P7 with that sign-off. Shipping a placeholder that reads like the real
          thing is how a placeholder becomes the real thing.
        */}
      </div>
    </div>
  )
}

/**
 * The account's daily allowance, as a quiet trailing sentence.
 *
 * Rendered only for principals it actually BINDS. A person with access to everything is uncapped, and
 * telling them "2 of 3 used" would be both wrong and alarming; a null cap means the server could not tell us the limit, which
 * renders as nothing rather than as zero or as unlimited — inventing either would be a claim about
 * someone's commercial terms.
 *
 * Its own fetch rather than a field on the runs call: the number is per-ACCOUNT and cheap, and folding it
 * into the run list would couple a counter to a poll that runs every few seconds.
 */
function AllowanceLine({ account, brand }: { readonly account: string | null; readonly brand: string }) {
  // '*' is the staff "all companies" view. An allowance is per-account, so there is no answer to give
  // — and asking would 400 on every load of the page staff use most. Skipped rather than swallowed.
  const { result } = useLoad(
    () => (account === '*' ? Promise.resolve({ kind: 'pickAccount' as const }) : api.usage(account)),
    [account],
  )
  if (result?.kind !== 'ok') return null
  // COMPOSED IN ONE PLACE FOR BOTH SCREENS. This wrote its own sentence and New clearance wrote
  // another, so one reader could meet "3 of 20 searches used today" here and a different count of the
  // same fact one click away — and neither said what to do about it. The line, its threshold and its
  // exhausted wording now live in `contract/allowance.ts`.
  const line = allowanceLine(result.value, brand)
  if (!line) return null
  return <span style={{ display: 'block', marginTop: 6, fontSize: 13 }}>{line}</span>
}

/**
 * A QUESTION ASKED IN THE PRODUCT'S OWN DIALOG, in place of the browser's confirm box (board Clearances,
 * approved 2026-11-25). Focus moves into it, Escape or Cancel closes it, and focus goes back to the control
 * that asked. A refusal from the server is said inside it, and nothing has changed.
 */
function AskDialog({ ask, onDone, onClose }: {
  readonly ask: Ask
  readonly onDone: (note: string) => void
  readonly onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const card = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    card.current?.querySelector<HTMLElement>('.clr-dialog-confirm')?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.querySelector<HTMLElement>(`button[aria-label="${CSS.escape(ask.returnTo)}"]`)?.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const go = async () => {
    setBusy(true)
    setFailed(null)
    const r = await ask.act()
    setBusy(false)
    if (r.kind !== 'ok') { setFailed(saveFailureText(r)); return }
    ask.after()
    onDone(ask.done)
  }
  return (
    <div className="modal-scrim" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="clr-ask-title">
      <div className="modal-card clr-dialog" ref={card} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2 id="clr-ask-title" className="clr-dialog-title" data-anon="mark">{ask.title}</h2></div>
        <div className="clr-dialog-body">
          <p data-anon="mark">{ask.body}</p>
          {failed ? <p className="callout-accent" role="alert">{failed}</p> : null}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn-primary clr-dialog-confirm" disabled={busy} onClick={() => void go()}>{ask.confirm}</button>
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

/**
 * GROUP NAMES AS A FAMILY, or add names to one (board Clearances, approved 2026-11-25). Names come from one
 * company; each selected name brings its search history. Saving files every search of each name, the same
 * way a family has always been asserted, and a family named like an existing one is chosen from the list.
 */
function GroupingDialog({ marks, families, initialCompany, initialFamily, seed, companyName, onSaved, onClose }: {
  /** Every name on the list, each with its company and family. */
  readonly marks: readonly MarkGroup[]
  /** Each family by its id: its name and company. */
  readonly families: ReadonlyMap<string, { readonly name: string; readonly company: string }>
  readonly initialCompany: string
  /** The family being added to, by id; null to create one. */
  readonly initialFamily: string | null
  /** Names ticked when the dialog opens: the name whose menu asked. */
  readonly seed: readonly string[]
  readonly companyName: (key: string) => string
  readonly onSaved: (note: string) => void
  readonly onClose: () => void
}) {
  const companies = [...new Set(marks.map((m) => runKey(m)))]
  const [company, setCompany] = useState(initialCompany)
  const [target, setTarget] = useState<string>(initialFamily ?? '')
  const [name, setName] = useState('')
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set(seed))
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const card = useRef<HTMLDivElement | null>(null)
  const opener = useRef<Element | null>(document.activeElement)
  const locked = initialFamily !== null || seed.length > 0
  useEffect(() => {
    card.current?.querySelector<HTMLElement>('select:not(:disabled), input:not(:disabled)')?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); (opener.current as HTMLElement | null)?.focus?.() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const here = marks.filter((m) => runKey(m) === company)
  const familiesHere = [...families.entries()].filter(([, f]) => f.company === company)
  const title = initialFamily ? `Add names to ${families.get(initialFamily)?.name ?? ''}` : 'Group names as a family'
  const save = async () => {
    const picked = here.filter((m) => chosen.has(m.id) && (!target || m.familyId !== target))
    const familyName = target ? families.get(target)?.name ?? '' : name.trim()
    const reason = !familyName ? 'Enter a family name.'
      : !target && familiesHere.some(([, f]) => f.name.toLowerCase() === familyName.toLowerCase()) ? 'Choose that existing family from the Family list.'
        : !picked.length || (!target && picked.length < 2) ? (target ? 'Select a name to add.' : 'Select two or more names for a new family.')
          : null
    if (reason) { setProblem(reason); return }
    setBusy(true)
    const r = await api.setFamily({ action: 'group', name: familyName, runIds: picked.flatMap((m) => m.reads.map((x) => x.runId)) })
    setBusy(false)
    if (r.kind !== 'ok') { setProblem(saveFailureText(r)); return }
    onSaved(picked.length === 1 ? `1 name grouped under ${familyName}.` : `${picked.length} names grouped under ${familyName}.`)
  }
  return (
    <div className="modal-scrim" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="clr-group-title">
      <div className="modal-card clr-dialog" ref={card} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2 id="clr-group-title" className="clr-dialog-title" data-anon="mark">{title}</h2></div>
        <div className="clr-dialog-body">
          <label className="clr-field">
            <span className="field-label">Company</span>
            <select className="ctx-select" value={company} disabled={locked} data-anon="mark"
              onChange={(e) => { setCompany(e.target.value); setTarget(''); setChosen(new Set()); setProblem(null) }}>
              {companies.map((k) => <option key={k} value={k}>{companyName(k)}</option>)}
            </select>
          </label>
          <label className="clr-field">
            <span className="field-label">Family</span>
            <select className="ctx-select" value={target} data-anon="mark" onChange={(e) => { setTarget(e.target.value); setProblem(null) }}>
              <option value="">Create a new family</option>
              {familiesHere.map(([id, f]) => <option key={id} value={id}>{f.name}</option>)}
            </select>
          </label>
          {!target ? (
            <label className="clr-field">
              <span className="field-label">Family name</span>
              <input className="ctx-input" type="text" maxLength={60} value={name} data-anon="mark"
                onChange={(e) => { setName(e.target.value); setProblem(null) }} />
            </label>
          ) : null}
          <fieldset className="clr-names">
            <legend className="field-label">Names to group</legend>
            {here.map((m) => {
              const already = Boolean(target) && m.familyId === target
              const inFamily = m.familyId ? families.get(m.familyId)?.name ?? null : null
              return (
                <label key={m.id} className="clr-name-choice">
                  <input type="checkbox" className="pickbox" checked={already || chosen.has(m.id)} disabled={already}
                    onChange={() => { setChosen((prev) => { const next = new Set(prev); if (next.has(m.id)) next.delete(m.id); else next.add(m.id); return next }); setProblem(null) }} />
                  <span data-anon="mark">{m.name}</span>
                  {inFamily ? <span className="clr-quiet" data-anon="mark"> · {inFamily}</span> : null}
                </label>
              )
            })}
          </fieldset>
          <p className="clr-quiet">Each selected name brings its search history.</p>
          {problem ? <p className="callout-accent" role="alert">{problem}</p> : null}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void save()}>Save family</button>
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
