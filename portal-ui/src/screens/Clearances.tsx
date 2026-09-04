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

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { Run } from '../contract/api.ts'
import { api, saveFailureText } from '../contract/api.ts'
import { bandRank } from '../contract/tone.ts'
import { displayName, inSentence, newestFirst, readLabel, readTime } from '../contract/reads.ts'
import { marksOf, rowsOf, NO_FAMILIES } from '../contract/grouping.ts'
import type { Families, MarkGroup, Row } from '../contract/grouping.ts'
import { pageWindow } from '../contract/listView.ts'
import { RiskDot, StatusCell } from '../components/RiskDot.tsx'
import { Icon } from '../components/Icon.tsx'
import { useLoad, usePoll } from '../state/useApi.ts'
import type { ShellContext } from '../shell/AppShell.tsx'

// criterion 5 — 'failed' is a tab, not a member of the other three. The owner's ruling was
// "Failed runs on clearance screen - no", and a tab is how a screen says no to something without
// making it unfindable: this file's own rule two comments down is that a run which silently
// disappears from the list is worse than one that says it stopped.
type Filter = 'all' | 'progress' | 'finished' | 'failed'
type SortKey = 'title' | 'state' | 'risk' | 'date'

// The direction a column takes on its FIRST click. One shared default cannot be right for all of them:
// "newest first" is descending, "worst first" and "A to Z" are ascending. Since bandRank puts the worst
// band at 0 (the manifest order — see contract/tone.ts), a descending first click on Risk would surface
// the UNRATED runs at the top and bury the worst rated one at the bottom, and the user would have to
// click twice to get the thing they asked for.
const FIRST_CLICK_DESC: Record<SortKey, boolean> = {
  date: true,     // newest first
  risk: false,    // worst first
  title: false,   // A to Z
  state: false,
}

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
 * Whether to group by brand owner. ON by default — grouped is right for the common case, which is
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
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'date', desc: true })
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const [page, setPage] = useState(0)

  // CLEARANCES IS THE ARCHIVE OF EVERYTHING THIS ACCOUNT HOLDS, and the brand owner is a FILTER inside
  // it rather than a scope around it.
  //
  // One request, whoever is asking: `?scope=mine` returns every brand owner the identity holds — all of
  // them for staff, its own for a client — so this screen never asks who is looking. It is above the
  // line in the sidebar for that reason (nav.config), and it is where Home hands off: Home spans the
  // account, so a Clearances that spanned one owner would narrow the list at the very moment someone
  // followed "All clearances" expecting to see more, not less.
  //
  // Deliberately NOT `api.runs('*')` — that wildcard is staff-only and stays that way.
  const { result, reload } = useLoad(() => api.runsMine(), [])
  const allRuns: readonly Run[] = result?.kind === 'ok' ? result.value : []

  // THE BRAND OWNER FILTER IS THE SIDEBAR SWITCHER. There is one control, and it is in the nav.
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
    () => (ownerFilter ? allRuns.filter((r) => r.account === ownerFilter) : allRuns),
    [allRuns, ownerFilter],
  )

  // `?owner=` promoted into the shell, once, on arrival — Home deep-links into one owner's work and that
  // link has to keep landing. It sets the SHELL's owner rather than a local filter so the sidebar agrees
  // with the list it produced; a deep link that filtered the table while the switcher still read "All
  // brand owners" would be the same two-sources-of-truth bug in a new place.
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current) return
    seeded.current = true
    const wanted = new URLSearchParams(window.location.search).get('owner')
    if (wanted && wanted !== ctx.owner) ctx.setOwner(wanted)
  }, [ctx])

  // Families are STAFF curation, and this route 404s for a client by design (see portal-service). Any
  // non-ok answer therefore means "no families", never "something is wrong": a client whose Clearances
  // page reported a fault because grouping was unavailable would see an error on every load.
  const account = ownerFilter ?? (ctx.me.allAccounts ? '*' : (ctx.me.accounts.length === 1 ? ctx.me.accounts[0]! : null))
  const { result: famResult, reload: reloadFamilies } = useLoad(() => api.families(account), [account])
  // NO PRODUCT-MENU FETCH HERE ANY MORE. This screen used to load `api.searches` for one
  // reason — to turn `run.product` into a name for readLabel — and that menu is the ORDERABLE list, so
  // every archived run missed the join and rendered its `stageLabel`, a Depth number, at a client. The
  // name now arrives on the row itself as `productName`, resolved by the same registry the report's
  // masthead prints from, so there is nothing left to join and nothing left to fetch.
  const families: Families = famResult?.kind === 'ok' ? famResult.value : NO_FAMILIES

  // Which marks are ticked for grouping. Cleared whenever the grouping changes, so the checkboxes never
  // outlive the rows they referred to.
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const canGroup = ctx.me.role === 'staff'

  // — THE FOLD, AND THE COUNT THAT SAYS IT HAS ANYTHING IN IT.
  //
  // A retired run is gone from every other listing on purpose, so this route is the only way back to
  // one. That is why the count is fetched even when the fold is shut: a control reading "Show retired"
  // with nothing behind it is indistinguishable from one hiding six months of work, and the person who
  // filed something needs to see that it is filed. Staff curation, staff-only upstream — a client's 404
  // decodes to notFound, `retired` stays empty and the control never renders.
  const [showRetired, setShowRetired] = useState(false)
  const { result: retiredResult, reload: reloadRetired } = useLoad(
    () => (canGroup ? api.retiredRuns(account) : Promise.resolve({ kind: 'notFound' as const })),
    [account, canGroup],
  )
  const retired: readonly Run[] = retiredResult?.kind === 'ok' ? retiredResult.value : []

  // The comment above is a promise the code has to keep: switching brand owner replaces every row,
  // so a selection made under the previous owner is ticks over rows that no longer exist — the
  // grouping bar shows a stale count and "Group as a family" can only fail.
  useEffect(() => { setPicked(new Set()) }, [ownerFilter])

  usePoll(reload, {
    active: runs.some((r) => !TERMINAL.has(r.state)),
    rateLimited: result?.kind === 'rateLimited',
  })

  // Grouping is a property of the VIEW, not of the data: rows group under a brand-owner heading only
  // when several owners are on screen at once. With one owner selected, a heading repeating that
  // owner's name on every group would be noise.
  //
  // Counted off the runs actually held rather than off a roster: an identity granted six brand owners
  // with work under one of them needs no headings, and the roster cannot tell us that.
  const ownersHeld = useMemo(() => new Set(allRuns.map((r) => r.account)).size, [allRuns])
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
    const dir = sort.desc ? -1 : 1
    return [...rowsOf(marks, families)].sort((a, b) => {
      // Owner leads when grouping, or a heading would reappear every time the sort interleaved two
      // owners' rows. Within a group the user's chosen sort is untouched.
      if (grouped && a.account !== b.account) return a.account.localeCompare(b.account)
      switch (sort.key) {
        case 'title':
          return dir * a.name.localeCompare(b.name)
        case 'state':
          return dir * a.state.localeCompare(b.state)
        case 'risk':
          // Ranked against each row's own ladder, so two customers' vocabularies interleave correctly
          // instead of sorting alphabetically against each other.
          return dir * (bandRank(a.bands, a.band) - bandRank(b.bands, b.band))
        case 'date':
        default:
          // Same defect as the home card's, same fix: `date` is day precision, so every pair of
          // rows last touched on the same day tied here and the column's order between them was whatever
          // grouping yielded. `newestFirst` is already descending, so the direction is negated rather
          // than multiplied — `dir` is +1 for ASCENDING everywhere else in this switch.
          return -dir * newestFirst(a, b)
      }
    })
  }, [runs, filter, query, sort, grouped, families])

  // Paging and cross-owner disambiguation are decided in contract/listView.ts, where they can be
  // tested — this screen has no DOM harness, so logic left inline here is logic nothing checks.
  const { current, pageCount, visible, from, to } = pageWindow(rows, page, PAGE)
  const resetPage = () => setPage(0)
  // removed the cross-owner disambiguation chip, and with it the only consumer of ambiguousTitles
  // on this screen. The helper stays in contract/listView.ts with its own tests: introduces an
  // UNGROUPED mode where the owner has to appear on every row, and that is where the question of two
  // owners holding one name comes back — as a column, not as a chip on the rows that happen to collide.

  if (result && result.kind === 'pickAccount') {
    return (
      <div className="screen">
        <div className="notice">
          <b>Choose a brand owner</b>
          <p style={{ margin: '6px 0 0', color: 'var(--text-muted)' }}>
            This sign-in covers several brand owners. Pick one in the sidebar to see its clearances.
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

  if (!runs.length) return <FirstRun go={ctx.go} />

  // A family is asserted over RUNS, because a mark is a grouping the browser derives rather than
  // anything the pool stores. Ticking a name therefore files every read of it.
  const allMarks = rows.flatMap((r) => (r.kind === 'family' ? r.marks : [r]))
  const pickedRunIds = () => allMarks.filter((m) => picked.has(m.id)).flatMap((m) => m.reads.map((r) => r.runId))
  // — the family header's own ungroup. A family is asserted over RUNS (see above), so dissolving
  // one files every read of every name in it — the same `setFamily({action:'ungroup'})` the multi-select
  // button calls, over a set the header already knows. It CONFIRMS, because one click here undoes a
  // grouping somebody made deliberately and the multi-select route makes you tick the members first.
  const ungroupFamily = async (family: Extract<Row, { kind: 'family' }>) => {
    const runIds = family.marks.flatMap((m) => m.reads.map((r) => r.runId))
    if (!runIds.length) return
    const n = family.marks.length
    if (!window.confirm(`Ungroup "${inSentence(family.name)}"? The ${n} ${n === 1 ? 'name' : 'names'} stay exactly as they are — only the family goes.`)) return
    const r = await api.setFamily({ action: 'ungroup', runIds })
    if (r.kind !== 'ok') {
      window.alert(saveFailureText(r))
      return
    }
    setPicked(new Set())
    reloadFamilies()
  }
  // — RETIRE, NOT DELETE. The owner asked for a way to get a clearance off this page; the answer is
  // the pool's existing visibility tag, which is reversible by construction — the run, its artifacts and
  // its report link are untouched and `restore` puts the row back exactly as it was. Nothing on this
  // screen deletes anything, and nothing here should ever be able to.
  //
  // A ROW IS A NAME, AND THE TAG IS PER RUN. Retiring the row therefore files every read of that name —
  // the same rule the grouping controls use two functions up, and for the same reason: leaving one read
  // of a retired name on the list is a half-done curation act that reads as a bug.
  //
  // It CONFIRMS, and the confirm says what is NOT lost. "Retire" is unambiguous to us and the person
  // clicking it has just been handed a control they did not have yesterday; the thing they fear is
  // losing the report, so the sentence answers that before it asks.
  const retireMark = async (mark: MarkGroup) => {
    const runIds = mark.reads.map((r) => r.runId)
    if (!runIds.length) return
    const n = runIds.length
    const what = n === 1 ? 'The read stays' : `All ${n} reads stay`
    // — BOUNDED GOING IN. This composed the name whole, and a 200-character
    // one pushed the question mark past a paragraph and buried the sentence that says what is not lost.
    if (!window.confirm(`Retire ${inSentence(mark.name)}? ${what} in the pool and the report links keep working — it comes off this list, and "Show retired" brings it back.`)) return
    const r = await api.setRetired({ action: 'retire', runIds })
    if (r.kind !== 'ok') {
      window.alert(saveFailureText(r))
      return
    }
    reload()
    reloadRetired()
  }
  // — RETIRE ONE READ. The owner's words: "i can only retire ALL runs under that grouped name not
  // individual runs." The transport was never the obstacle — `setRetired` has taken a `runIds` ARRAY in
  // both directions since, and `restoreRun` below has always passed exactly one. What was missing
  // was a place to click: retire was bound to the MarkGroup and its own inverse was bound to the run, so
  // you could retire a name and restore one read of it, which is not a coherent pair. This is the other
  // half of that pair, and it makes the two directions symmetrical for the first time.
  //
  // NAMED FOR THE READ, NOT THE NAME. The confirm quotes `readLabel` — the same string the row shows —
  // because the whole defect is a control acting on more than the row it sits on, and a confirm that
  // said "Retire VENZY?" from a read row would be the identical ambiguity in words.
  const retireRun = async (run: Run) => {
    if (!window.confirm(`Retire this read — ${inSentence(readLabel(run), 80)}? Only this one read comes off the list. Its report link keeps working, the other reads of this name stay where they are, and "Show retired" brings it back.`)) return
    const r = await api.setRetired({ action: 'retire', runIds: [run.runId] })
    if (r.kind !== 'ok') {
      window.alert(saveFailureText(r))
      return
    }
    reload()
    reloadRetired()
  }
  // The way back, and NO confirm on it: restoring is the safe direction, and a control whose inverse
  // interrogates you is one people stop using.
  const restoreRun = async (run: Run) => {
    const r = await api.setRetired({ action: 'restore', runIds: [run.runId] })
    if (r.kind !== 'ok') {
      window.alert(saveFailureText(r))
      return
    }
    reload()
    reloadRetired()
  }

  const pick = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const sortBtn = (key: SortKey, label: string) => (
    <button
      type="button"
      onClick={() => {
        setSort((s) => ({ key, desc: s.key === key ? !s.desc : FIRST_CLICK_DESC[key] }))
        resetPage()
      }}
    >
      {label}
      {sort.key === key ? <span aria-hidden="true">{sort.desc ? '↓' : '↑'}</span> : null}
      <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        {sort.key === key ? (sort.desc ? ', sorted descending' : ', sorted ascending') : ', not sorted'}
      </span>
    </button>
  )

  return (
    <div className="screen">
      <div className="eyebrow">Clearances</div>
      <h1 style={{ fontSize: 27, margin: '4px 0 6px', color: 'var(--text-strong)' }}>
        {ownerFilter ? ctx.ownerName(ownerFilter) : 'Clearances'}
      </h1>
      <p style={{ margin: 0, color: 'var(--text-muted)' }}>
        Every name in clearance and where it stands. Open a row to see each read on that name.
        <AllowanceLine account={account} />
      </p>

      <div className="controls">
        <div className="segmented" role="group" aria-label="Filter by status">
          {(
            [
              ['all', 'All'],
              ['progress', 'In progress'],
              ['finished', 'Finished'],
              // criterion 5 — the failed names' one route in. Labelled with its count for the same
              // reason "Show retired (N)" is, and rendered even at zero: a tab that appears only when
              // something breaks is one nobody knows to look for on the day something does.
              ['failed', failedCount ? `Failed (${failedCount})` : 'Failed'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={filter === k}
              onClick={() => {
                setFilter(k)
                resetPage()
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* NO BRAND-OWNER SELECT HERE. It lived in this toolbar beside an identical sidebar switcher —
            two controls for one decision, and the reader had no way to tell which was live. The nav
            switcher is the one, and it now scopes this list (see ownerFilter above). */}

        {/* — the toggle's state is visible WITHOUT opening a menu, which is why this is a checkbox
            in the toolbar rather than an item in an overflow. It appears only when it can do something:
            one owner in view, or the nav already scoped to one, and there is nothing to group. */}
        {groupable ? (
          <label className="group-toggle">
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
            Group by brand owner
          </label>
        ) : null}
        <span className="mono" style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 13 }}>
          {rows.length} {rows.length === 1 ? 'name' : 'names'}
        </span>
        <input
          className="filter"
          type="search"
          placeholder="Filter by name"
          aria-label="Filter by name"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            resetPage()
          }}
        />
      </div>

      {/* THE FAMILY BAR. Present only for staff, and only once something is ticked — a control that does
          nothing until you have made a selection is better introduced BY the selection.
          — IT OVERLAYS RATHER THAN INSERTS. It used to be a `.notice` in normal flow, above the
          table header, so ticking a box pushed the entire table down and the page jumped under the
          cursor. It is now pinned to the bottom of the viewport: selecting or clearing a row moves
          nothing at all. The issue also rejects reserving space with a permanent empty band, which is
          the other way to stop the jump and leaves a hole on every visit.
          And it is no longer `.notice`. That treatment is not a one-off — it is what the error and
          empty states on this same screen use, which is exactly why it is wrong here: a notice is a
          persistent thing you read, and this is a transient thing you act on. There was no treatment
          for the second kind, so `.selection-bar` is one. */}
      {canGroup && picked.size > 0 ? (
        <div className="selection-bar" role="region" aria-label="Selected names">
          <b>
            {picked.size} {picked.size === 1 ? 'name' : 'names'} selected
          </b>
          {/* ONE WORD: family. The header said "pick", the action says "family", and neither word
              appeared in the other place. The header is gone; this is the only vocabulary left. */}
          <span style={{ flex: 1 }} />
          <button
            type="button"
            className="nav-item"
            style={{ width: 'auto', margin: 0, padding: '6px 11px', border: '1px solid var(--border-hairline)' }}
            onClick={async () => {
              const name = window.prompt('Group these names under which family?')
              if (!name?.trim()) return
              const runIds = pickedRunIds()
              const r = await api.setFamily({ action: 'group', name: name.trim(), runIds })
              if (r.kind !== 'ok') {
                window.alert(saveFailureText(r, 'That grouping could not be saved.'))
                return
              }
              setPicked(new Set())
              reloadFamilies()
            }}
          >
            Group as a family
          </button>
          {/* Only offered when something ticked is actually IN a family. Enforcement without matching
              invitation control is how a dead button ends up on screen — and  is what that cost:
              the owner asked whether ungrouping was possible at all. The invitation now lives on the
              family header (FamilyRows); this stays exactly as it was, for taking ONE name out. */}
          {[...picked].some((id) => rows.flatMap((r) => (r.kind === 'family' ? r.marks : [r])).find((m) => m.id === id)?.familyId) ? (
            <button
              type="button"
              className="nav-item"
              style={{ width: 'auto', margin: 0, padding: '6px 11px', border: '1px solid var(--border-hairline)' }}
              onClick={async () => {
                const r = await api.setFamily({ action: 'ungroup', runIds: pickedRunIds() })
                if (r.kind !== 'ok') {
                  window.alert(saveFailureText(r))
                  return
                }
                setPicked(new Set())
                reloadFamilies()
              }}
            >
              Remove from family
            </button>
          ) : null}
          <button
            type="button"
            className="nav-item"
            style={{ width: 'auto', margin: 0, padding: '6px 11px' }}
            onClick={() => setPicked(new Set())}
          >
            Clear
          </button>
        </div>
      ) : null}

      <div className="table-wrap">
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
            Name is now the widest column, which is what the page is about. Status is sized for the words
            it actually holds — "Finished", "In progress", "Not finished" — and a long stopped-during
            phrase wraps, which is the right failure for the rare row rather than the common one.
            ALL PERCENTAGES, summing to 100. Two px columns among five percentages made the table
            resolve WIDER than its wrapper and overflow by 21px at a 1100px viewport — where the content
            column is only 767px, because the shell's rail takes the rest. The client view omits Pick and
            sums to 95%; the remainder is distributed, which is fine and cannot overflow. */}
        <table className="data fixed">
          <colgroup>
            <col style={{ width: '5%' }} />
            {canGroup ? <col style={{ width: '5%' }} /> : null}
            <col style={{ width: showOwnerColumn ? '26%' : '35%' }} />
            {showOwnerColumn ? <col style={{ width: '16%' }} /> : null}
            <col style={{ width: showOwnerColumn ? '18%' : '25%' }} />
            <col style={{ width: '15%' }} />
            <col style={{ width: '15%' }} />
          </colgroup>
          <thead>
            <tr>
              <th />
              {/* — NO HEADER. `PICK` named nothing a first-time reader could act on, and the
                  feature it belongs to is called `family` everywhere else. The issue rejects renaming
                  it: a checkbox column does not need a label, and a better word would keep a header
                  that earns nothing. The column is named for screen readers on each checkbox instead. */}
              {canGroup ? <th aria-label="Select for grouping" /> : null}
              <th>{sortBtn('title', 'Name')}</th>
              {/* — UNGROUPED, THE OWNER MOVES INTO A COLUMN. The issue rejects an ungrouped mode
                  that drops the brand owner: the information has to survive the toggle. A column rather
                  than a chip, so it is sortable-adjacent, scannable, and in the grid  built. */}
              {showOwnerColumn ? <th>Brand owner</th> : null}
              {/* deleted the Stages column: it spent width on a rung number saying something the
                  page already says in words on every read row, which is the product's own name.
                  then retired the ladder itself — there are FOUR SEARCHES and a client buys one of them
                  — so the column has nothing left to encode. The retired keys survive only in
                  search-policy.mjs RETIRED_POLICIES, which is what lets an archived run re-render under
                  the name it was sold under. */}
              <th>{sortBtn('state', 'Status')}</th>
              <th>{sortBtn('risk', 'Risk')}</th>
              <th>{sortBtn('date', 'Updated')}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => {
              // A heading row whenever the owner changes. The rows are already sorted, so this needs no
              // separate grouping pass — and it keeps the user's chosen sort intact WITHIN each group
              // rather than silently re-sorting by owner.
              //
              // Compared against the previous VISIBLE row, not the previous row overall: when a group
              // spans a page break, the continuation page must repeat the heading. Otherwise the first
              // rows of page 2 sit under no owner at all, which is precisely the confusion — two brand
              // owners' identically-named marks reading as one — that grouping exists to prevent.
              const newGroup = grouped && r.account !== visible[i - 1]?.account
              return (
                <Fragment key={r.id}>
                  {newGroup ? (
                    // — A SECTION HEADER, not a decorative divider. This was the smallest,
                    // lowest-contrast, most letterspaced type on the page, which read as a rule between
                    // rows rather than as "everything below this belongs to Aurora Interactive".
                    <tr className="group-head">
                      <td colSpan={(canGroup ? 6 : 5) + (showOwnerColumn ? 1 : 0)}>
                        <span className="owner-name" data-anon="mark">
                          {ctx.ownerName(r.account)}
                        </span>
                        <span className="owner-count">
                          {rows.filter((x) => x.account === r.account).length} in this view
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
                      picking={canGroup}
                      showOwner={showOwnerColumn}
                      ownerLabel={ctx.ownerName(r.account)}
                      isPicked={(id) => picked.has(id)}
                      onPick={pick}
                      onUngroup={canGroup ? ungroupFamily : undefined}
                      onRetire={canGroup ? retireMark : undefined}
                      onRetireRun={canGroup ? retireRun : undefined}
                    />
                  ) : (
                    <MarkRow
                      mark={r}
                      open={open.has(r.id)}
                      onToggle={() => toggle(r.id)}
                      go={ctx.go}
                      picking={canGroup}
                      showOwner={showOwnerColumn}
                      ownerLabel={ctx.ownerName(r.account)}
                      picked={picked.has(r.id)}
                      onPick={() => pick(r.id)}
                      onRetire={canGroup ? retireMark : undefined}
                      onRetireRun={canGroup ? retireRun : undefined}
                    />
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {!rows.length ? <div className="empty">No names match this view.</div> : null}

      {/* — THE WAY BACK. A one-way hide is how a run gets lost rather than filed, so the control
          and its inverse both live on this page. Rendered only when something IS retired: an empty fold
          on every visit is a permanent question about a state nobody is in.
          RUNS, NOT NAMES. The main table groups reads under a mark because that is how you read a book
          of work; this is a recovery list, the tag is per run, and showing what you would actually be
          restoring beats a tidier shape that hides it. */}
      {canGroup && retired.length ? (
        <div style={{ marginTop: 18 }}>
          <button
            type="button"
            className="linkish"
            style={{ font: 'inherit', fontSize: 13, background: 'none', border: 'none', padding: 0, color: 'var(--text-muted)', cursor: 'pointer', textDecoration: 'underline' }}
            aria-expanded={showRetired}
            onClick={() => setShowRetired((v) => !v)}
          >
            {showRetired ? 'Hide retired' : `Show retired (${retired.length})`}
          </button>
          {showRetired ? (
            <div className="table-wrap" style={{ marginTop: 10 }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Brand owner</th>
                    <th>Updated</th>
                    <th aria-label="Restore" />
                  </tr>
                </thead>
                <tbody>
                  {retired.map((run) => (
                    <tr key={run.runId} className="row">
                      <td>
                        <b data-anon="mark" style={{ color: 'var(--text-strong)' }}>{displayName(run)}</b>
                      </td>
                      <td data-anon="mark" style={{ color: 'var(--text-muted)' }}>{ctx.ownerName(run.account)}</td>
                      <td className="mono" style={{ color: 'var(--text-muted)', fontSize: 13 }}>{run.date ?? ''}</td>
                      <td>
                        <button
                          type="button"
                          className="linkish"
                          style={{ font: 'inherit', fontSize: 12, background: 'none', border: 'none', padding: 0, color: 'var(--text-muted)', cursor: 'pointer', textDecoration: 'underline' }}
                          onClick={() => void restoreRun(run)}
                        >
                          Restore
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
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
 * the naming pattern that is current when you build, not today's string. changed what a row is
 * called and removed the word "grouping" from the checkbox flow, so a name assembled in this
 * component would be a second convention drifting from the first.
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

function FamilyRows({
  family,
  isOpen,
  onToggle,
  go,
  picking,
  showOwner = false,
  ownerLabel = '',
  isPicked,
  onPick,
  onUngroup,
  onRetire,
  onRetireRun,
}: {
  readonly family: Extract<Row, { kind: 'family' }>
  readonly isOpen: (id: string) => boolean
  readonly onToggle: (id: string) => void
  readonly go: (p: string) => void
  readonly picking: boolean
  /** — ungrouped, the brand owner is a column, so every row shape needs its cell. */
  readonly showOwner?: boolean
  readonly ownerLabel?: string
  readonly isPicked: (id: string) => boolean
  readonly onPick: (id: string) => void
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
}) {
  const open = isOpen(family.id)
  return (
    <>
      <tr className="row" onClick={() => onToggle(family.id)}>
        <td>
          <Twisty open={open} onToggle={() => onToggle(family.id)} label={`${open ? 'Collapse' : 'Expand'} ${family.name}`} />
        </td>
        {/* A family has no checkbox of its own: it IS the grouping. Ticking its members is how you take
            them out of it, which is the only move left at this level. */}
        {picking ? <td /> : null}
        <td>
          <b data-anon="mark" style={{ color: 'var(--text-strong)' }}>
            {family.name}
          </b>
          <span className="pill" style={{ marginLeft: 8 }}>
            {family.marks.length} {family.marks.length === 1 ? 'name' : 'names'}
          </span>
          {/* The worst band is stated in words as well as shown, because "worst" is the one thing about a
              family row that is not obvious from looking at it. */}
          {family.band ? <span className="sub">worst of {family.marks.length}: {family.band}</span> : null}
          {/* — UNGROUP LIVES WHERE THE FAMILY IS. The capability was complete and wired, and the
              owner asked whether runs could be ungrouped at all: the multi-select button renders only
              once you have ticked a run that is already in a family, and nothing says so. "Group as a
              family" is always visible, so the screen read as a one-way operation.

              The enforcement is untouched — that button still appears only when the selection can act.
              What is added is the invitation, on the row a person looking to break up a family actually
              looks at. It ungroups the WHOLE family, which is what the header is about; taking one name
              out stays the multi-select move. stopPropagation because the row itself toggles open. */}
          {onUngroup ? (
            <button
              type="button"
              className="linkish"
              style={{ marginLeft: 10, font: 'inherit', fontSize: 12, background: 'none', border: 'none', padding: 0, color: 'var(--text-muted)', cursor: 'pointer', textDecoration: 'underline' }}
              title={`Ungroup ${family.name} — the ${family.marks.length} ${family.marks.length === 1 ? 'name' : 'names'} stay, the family goes`}
              onClick={(e) => {
                e.stopPropagation()
                onUngroup(family)
              }}
            >
              Ungroup
            </button>
          ) : null}
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
        <td>
          <StatusCell state={family.state} step={null} stepN={null} stepTotal={null} reason={null} failedStage={null} />
        </td>
        <td>{family.band ? <RiskDot tone={family.tone} label={family.band} /> : <span style={{ color: 'var(--text-faint)' }}>—</span>}</td>
        <td className="mono" style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          {family.date ?? ''}
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
              picking={picking}
              showOwner={showOwner}
              ownerLabel={ownerLabel}
              picked={isPicked(m.id)}
              onPick={() => onPick(m.id)}
              onRetire={onRetire}
              onRetireRun={onRetireRun}
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
  picking = false,
  showOwner = false,
  ownerLabel = '',
  picked = false,
  onPick,
  onRetire,
  onRetireRun,
}: {
  readonly mark: MarkGroup
  readonly open: boolean
  readonly onToggle: () => void
  readonly go: (p: string) => void
  /** True when the row sits under a family, which is the only thing that indents it. */
  readonly indent?: boolean
  readonly picking?: boolean
  /** — ungrouped, the brand owner moves from the section header into a column on every row. */
  readonly showOwner?: boolean
  readonly ownerLabel?: string
  readonly picked?: boolean
  readonly onPick?: () => void
  /** — absent ⇒ no control, so a client view cannot grow a curation act by accident. Explicitly
      `| undefined` because the project runs exactOptionalPropertyTypes. */
  readonly onRetire?: ((mark: MarkGroup) => void) | undefined
  /** — the per-READ retire, gated by the SAME `canGroup` expression as `onRetire` at the call
      site rather than a second one, so the two curation acts cannot come to differ about who may
      curate. Absent ⇒ no control, exactly as  requires of its group-level sibling. */
  readonly onRetireRun?: ((run: Run) => void) | undefined
}) {
  const run = mark.current
  const threaded = mark.reads.length > 1

  return (
    <>
      <tr className="row" onClick={onToggle}>
        <td style={indent ? { paddingLeft: 26 } : undefined}>
          {/* Named from mark.name — the SAME source the checkbox beside it uses, so the two cannot
              drift.  changed what that name is and  changed the checkbox's wording; a name
              composed independently here would already be a third convention. */}
          <Twisty open={open} onToggle={onToggle} label={`${open ? 'Collapse' : 'Expand'} ${mark.name}`} />
        </td>
        {picking ? (
          // stopPropagation, or ticking a box would also expand the row underneath the cursor.
          <td onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              className="pickbox"
              checked={Boolean(picked)}
              onChange={() => onPick?.()}
              aria-label={`Select ${mark.name} for grouping`}
            />
          </td>
        ) : null}
        <td>
          <b data-anon="mark" style={{ color: 'var(--text-strong)' }}>
            {mark.name}
          </b>
          {/* deleted `GROUP · N`. On a one-mark batch it announced a group of one, which is not a
              group and tells a reader nothing either way; on a larger batch it restated a count the
              Name cell now carries in words —  made that cell read "VENZY +2 more". */}
          {/* Only when there IS a thread. A "1 read" badge on every single-read name is noise on every
              row, and noise on every row is how the row that needed a badge stops being seen. */}
          {threaded ? <span className="pill" style={{ marginLeft: 8 }}>{mark.reads.length} reads</span> : null}
          {/* IMPROVED SINCE. Outside the Risk cell on purpose — that cell reports what this read
              found, and a second value in it would be the blend this issue is removing. It renders only
              when an earlier read was WORSE than the latest, which is rare: a marker on every row is one
              nobody sees. */}
          {mark.improvedFrom ? (
            <span className="pill" style={{ marginLeft: 8 }} title={`An earlier read of this name came back ${mark.improvedFrom}. The row shows where it stands now.`}>
              was {mark.improvedFrom}
            </span>
          ) : null}
          {/* — RETIRE, ON THE ROW. The owner asked for "a way to remove, hide or archive a
              clearance from the Clearances page" and there was none: the sidecar, its reader and its
              semantics were all live, and the only writer was a CLI on the pool host.
              Same treatment as 's Ungroup one row-shape up, deliberately — this screen now has two
              row-level curation acts and they should not look like two different kinds of thing.
              stopPropagation because the row itself toggles open. */}
          {onRetire ? (
            <button
              type="button"
              className="linkish"
              style={{ marginLeft: 10, font: 'inherit', fontSize: 12, background: 'none', border: 'none', padding: 0, color: 'var(--text-muted)', cursor: 'pointer', textDecoration: 'underline' }}
              title={threaded
                ? `Retire all ${mark.reads.length} reads of ${mark.name} — the whole name comes off this list for everyone; the reports and their links stay, and "Show retired" brings it back. To retire ONE read, open the row and use the Retire on that read.`
                : `Retire ${mark.name} — it comes off this list for everyone; the reports and their links stay, and "Show retired" brings it back`}
              onClick={(e) => {
                e.stopPropagation()
                onRetire(mark)
              }}
            >
              {/* — THE LABEL SAYS HOW MANY, once there is more than one. Two controls reading
                  "Retire" on adjacent rows, one taking the whole name and one taking a single read, is
                  the ambiguity this issue opened with ("i can only retire ALL runs under that grouped
                  name") restated as a UI rather than removed. An unthreaded name has exactly one read,
                  so "all 1 reads" would be pedantry and the per-read control is suppressed there — one
                  action, one place to click. */}
              {threaded ? `Retire all ${mark.reads.length}` : 'Retire'}
            </button>
          ) : null}
          {/* deleted the brand-owner chip.
              It only ever rendered when grouping was ON (grouped AND the name ambiguous), which is
              precisely when a section header sits directly above the row already saying the same thing.
              So it was the same string twice on one line — the thing the header was failing to
              communicate, repeated rather than fixed. Making the header read as a header is the fix.
              Grouping OFF is 's case, and it needs the owner on every row rather than on the ones
              that happen to collide — which is the column below, not a chip. */}
        </td>
        {/* — UNGROUPED, THE OWNER LIVES HERE. The information has to survive the toggle, and a
            column survives it in the grid  built rather than as a chip crowding the Name cell. */}
        {showOwner ? (
          <td data-anon="mark" style={{ color: 'var(--text-muted)' }}>
            {ownerLabel}
          </td>
        ) : null}
        <td>
          <StatusCell
            state={run.state}
            step={run.step}
            stepN={run.stepN}
            stepTotal={run.stepTotal}
            reason={run.reason}
            failedStage={run.failedStage}
            pausedKind={run.pausedKind}
            resetsAt={run.resetsAt}
            stopRequestedAt={run.stopRequestedAt}
          />
        </td>
        <td>
          {/* THE BANDS PRESENT, WORST FIRST — not a computed summary.
              This used to show `worstBand(...)` for a batch, a synthesised value that needed the words
              "worst:" beside it to explain what it was, and which disagreed with data two lines below on
              the same row. The cell now REPORTS what the row contains, so a reader can reconstruct the
              row's contents from it. One mark has one band, which is what it already showed.
              Risk only once the latest read has finished: an in-flight re-read has no band, and an
              em-dash says so rather than borrowing the band of the read it is replacing. */}
          {run.state === 'delivered' && mark.rowBands.length ? (
            <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
              {mark.rowBands.map((label) => (
                <RiskDot key={label} tone={run.bands.find((b) => b.label === label)?.tone ?? null} label={label} />
              ))}
            </span>
          ) : (
            <span style={{ color: 'var(--text-faint)' }}>—</span>
          )}
        </td>
        <td className="mono" style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          {mark.date ?? ''}
        </td>
      </tr>

      {/* THE THREAD. Every read of this name, newest first — which is what the page has always said
          this panel would show. Each read is now a REAL ROW in the parent's grid: it was a
          single <td colSpan> holding its own flex layout, so where its values landed was decided by the
          length of the text beside them rather than by a column, and any alignment it showed was
          coincidental. */}
      {open ? mark.reads.map((r) => (
        <ReadRow
          key={r.runId}
          read={r}
          go={go}
          picking={picking}
          indent={indent}
          showOwner={showOwner}
          current={r.runId === mark.current.runId}
          sameDayAsAnother={mark.reads.some((o) => o.runId !== r.runId && o.date === r.date)}
          {...(threaded ? { onRetire: onRetireRun } : {})}
        />
      )) : null}

      {open && run.marks.length > 1 ? (
        <tr>
          <td colSpan={(picking ? 6 : 5) + (showOwner ? 1 : 0)} style={{ background: 'var(--surface-sunken)' }}>

            {/* A batch's per-name answers: one read's contents, not a thread, so this one stays a
                spanning cell — the names are not reads and do not belong in the read grid.
                dropped the "Names in the latest read" heading with the convention it belonged to:
                the Name column now holds the first mark and says how many more, so this is simply the
                rest of them, and a batch of one has nothing left to add. */}
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
 * One read in the thread — a REAL ROW in the parent table's grid.
 *
 * It used to be a <div> inside a spanning cell, laid out with its own flex row. That is the mechanism
 * behind "the column alignment is a mess": nothing in it participated in the column grid, so where a
 * value landed was decided by the length of the text beside it. Lengthening a run title moved every
 * value to its right, and the parent's own columns re-flowed when a row opened.
 *
 * Now each value sits in the cell of the column it belongs to — Status under Status, Risk under Risk,
 * date under Updated — so the alignment is structural rather than coincidental, and a longer title moves
 * nothing but itself.
 */
function ReadRow({
  read,
  go,
  picking,
  indent,
  showOwner = false,
  current = false,
  sameDayAsAnother = false,
  onRetire,
}: {
  readonly read: Run
  readonly go: (p: string) => void
  readonly picking: boolean
  readonly indent?: boolean
  /** — a spacer under the brand-owner column, so a read row still matches the grid when shown. */
  readonly showOwner?: boolean
  /** The read the parent row speaks for. Marked, so the latest-read rule has a visible ordering key. */
  readonly current?: boolean
  /** Another read of this name finished on the same day — the case a date alone cannot separate. */
  readonly sameDayAsAnother?: boolean
  /** — retire THIS read. Absent ⇒ no control ('s rule, inherited from the parent's gate). */
  readonly onRetire?: ((run: Run) => void) | undefined
}) {
  // THE WHOLE ROW OPENS THE REPORT.
  //
  // The only way in was an "Open the report" text button at the far right edge — the furthest point from
  // the run title the reader has just read — on a <tr> with `cursor: auto` and no hover state. People
  // read the title, find nothing to click, and conclude there is no report.
  //
  // A read with NO report gets NO affordance at all: not a pointer, not a hover, not a tab stop. A dead
  // target is worse than no target, which is why this is a branch rather than a disabled state.
  // — A BATCH HAS REPORTS, JUST NOT ONE OF THEM. `read.report` is the RUN-LEVEL link and the
  // service sets it null for a multi-mark batch on purpose: there is no run-level document, and
  // serving mark one of eight as "the report" is the defect removed. But this row used that
  // null as "has no report at all", so every knockout batch listed as unopenable — and printed the
  // fallback below, which told the customer their delivered report was with us for a final read.
  // The Result screen has rendered a batch's per-mark list since. The row just never let
  // anyone reach it.
  const openable = Boolean(read.report) || read.reports.length > 0
  const open = () => go(`/portal/result/${encodeURIComponent(read.runId)}`)

  return (
    <tr
      className={openable ? 'read-row openable' : 'read-row'}
      {...(openable
        ? {
            // A row is not a button, so it has to be told how to behave like one: reachable by Tab,
            // activated by Enter or Space, and named for what it opens rather than "row".
            role: 'link' as const,
            tabIndex: 0,
            'aria-label': `Open the report for ${readLabel(read)}`,
            onClick: open,
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                // Space scrolls the page by default, which on a list of rows is the wrong thing entirely.
                e.preventDefault()
                open()
              }
            },
          }
        : {})}
    >
      {/* The twisty column carries the nesting: one step in from the parent, so containment is visible
          without reading anything. */}
      <td style={{ paddingLeft: indent ? 38 : 26 }} />
      {picking ? <td /> : null}
      <td>
        <span className="mono" style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
          {readLabel(read)}
          {/* THE ORDERING KEY, SHOWN. A date alone cannot separate two reads of the same day —
              which is exactly the House-default row, where two runs 2m08s apart rendered
              byte-identically. The time appears only when it is needed to tell them apart, so the common
              row does not carry a number nobody reads. UTC, and it says so. */}
          {sameDayAsAnother && readTime(read) ? <span style={{ marginLeft: 6 }}>{readTime(read)} UTC</span> : null}
        </span>
        {/* WHICH ONE IS THE CURRENT READ. A latest-read rule with no visible ordering key moves the
            confusion rather than removing it — the issue says point 3 is not separable from points 1
            and 2, and this is that. */}
        {current ? <span className="pill" style={{ marginLeft: 8 }}>current</span> : null}
        {/* — RETIRE, ON THE READ. Same cell, same styling and same shape as the mark-level Retire
            one row up, because 's comment asks for exactly that: this screen has row-level curation
            acts and they should not look like two different kinds of thing. What differs is the WORD it
            acts on, and the confirm says which.

            BOTH HANDLERS ARE STOPPED, not just the click. The row is a `role="link"` with an onClick AND
            an onKeyDown that opens the report on Enter or Space — so a button inside it that stops only
            the pointer would retire the read and then navigate away from the screen that would have
            shown it worked, and a keyboard user would get that every time. This is the one place on the
            screen where a nested control sits inside an activatable row. */}
        {onRetire ? (
          <button
            type="button"
            className="linkish"
            style={{ marginLeft: 10, font: 'inherit', fontSize: 12, background: 'none', border: 'none', padding: 0, color: 'var(--text-muted)', cursor: 'pointer', textDecoration: 'underline' }}
            title={`Retire this read — ${readLabel(read)}. Only this read comes off the list; the other reads of this name stay, the report link keeps working, and "Show retired" brings it back`}
            onClick={(e) => {
              e.stopPropagation()
              onRetire(read)
            }}
            onKeyDown={(e) => e.stopPropagation()}
          >
            Retire
          </button>
        ) : null}
      </td>
      {/* — a read belongs to the same owner as its parent row, so the cell is a spacer rather than
          a repetition. It exists because the grid must still line up: a read row one cell short of its
          columns is the  fault back again, in a mode that did not exist when  landed. */}
      {showOwner ? <td /> : null}
      <td>
        {/* THE ONE PLACE the engine's own words are reachable. The parent row states the
            status; here, where the reader is looking at this specific run, a Details disclosure holds
            the raw value — so a lawyer can act on the status and an engineer still gets the detail in
            one click, once per row rather than twice. */}
        <StatusCell
          state={read.state}
          step={read.step}
          stepN={read.stepN}
          stepTotal={read.stepTotal}
          reason={read.reason}
          failedStage={read.failedStage}
          stopRequestedAt={read.stopRequestedAt}
          detailed
        />
      </td>
      <td>
        {read.state === 'delivered' && read.band ? <RiskDot tone={read.tone} label={read.band} /> : <span style={{ color: 'var(--text-faint)' }}>—</span>}
      </td>
      <td className="mono" style={{ color: 'var(--text-muted)', fontSize: 13 }}>
        {openable ? (
          // Not a button any more: the row IS the control, and a button inside a clickable row is two
          // targets for one action. What is left is a cue that the row leads somewhere — the affordance
          // is on the thing you can click, which is the fix the issue asks for.
          <span className="read-go" aria-hidden="true">
            Open<Icon name="chevron" size={14} />
          </span>
        ) : read.state === 'delivered' ? (
          // — WHAT THIS SAYS IS NOW WHAT IS TRUE. It used to claim the run was still with a reviewer
          // ahead of release — a step nobody performs — on a run that had
          // in fact been delivered. It could not be right in either branch: if the report was there it
          // was a lie about a file the customer could have been reading, and if it was genuinely absent
          // it was a lie about the reason. The state is: delivered, and this view has no file to link.
          <span className="sub" style={{ margin: 0 }}>
            Delivered — no report file found for this run.
          </span>
        ) : null}
      </td>
    </tr>
  )
}

function FirstRun({ go }: { readonly go: (p: string) => void }) {
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
          onClick={() => go('/portal/new')}
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
 * Rendered only for principals it actually BINDS. Staff are uncapped, and telling a staff member "2 of 3
 * used" would be both wrong and alarming; a null cap means the server could not tell us the limit, which
 * renders as nothing rather than as zero or as unlimited — inventing either would be a claim about
 * someone's commercial terms.
 *
 * Its own fetch rather than a field on the runs call: the number is per-ACCOUNT and cheap, and folding it
 * into the run list would couple a counter to a poll that runs every few seconds.
 */
function AllowanceLine({ account }: { readonly account: string | null }) {
  // '*' is the staff "all brand owners" view. An allowance is per-account, so there is no answer to give
  // — and asking would 400 on every load of the page staff use most. Skipped rather than swallowed.
  const { result } = useLoad(
    () => (account === '*' ? Promise.resolve({ kind: 'pickAccount' as const }) : api.usage(account)),
    [account],
  )
  if (result?.kind !== 'ok') return null
  const u = result.value
  if (!u.capped || u.dailyRuns == null) return null
  const left = Math.max(0, u.dailyRuns - u.today)
  return (
    <span style={{ display: 'block', marginTop: 6, fontSize: 13 }}>
      {left === 0
        ? 'You have used all of today’s searches — the allowance resets at midnight UTC.'
        : `${u.today} of ${u.dailyRuns} searches used today.`}
    </span>
  )
}
