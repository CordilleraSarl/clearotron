// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Home — what is in flight, what is waiting, and the way out of both.
//
// ONE JOB: within about two seconds, know whether the thing you are waiting on is moving, stuck, or
// ready. Then get out of the way.
//
// ── WHAT THE PREVIOUS ATTEMPT GOT WRONG, SO IT IS NOT REPEATED ───────────────────────────────────
// It buried in-flight work under a long list of companies; picking one made that work vanish with no
// way back; and it re-listed finished runs at lower fidelity than Clearances, whose grouping, threading,
// families, filters and sort it could not match. Three rules fall out of that, and each is a defect if
// it goes missing:
//
//   1. ACCOUNT-SCOPED, NEVER OWNER-SCOPED. Every company this account holds, always, with the owner
//      as a label on the row. The sidebar switcher does not reach this screen — it sits above the line
//      in nav.config for exactly that reason — so nothing here can be emptied by a filter choice.
//   2. NO FINISHED LIST. One line, then a link INTO Clearances. A lower-fidelity copy of a screen that
//      already does the job well loses to it, and teaches people not to go there.
//   3. NO ROLE SPLIT. There is no staff Home and no client Home. What differs is how many companies
//      someone holds, and quantity is a rendering decision.
//
// There is no ETA and no percent-complete anywhere on this page: nothing in the system measures or
// predicts run duration, and the stepper is deliberately lossy. The one real clock is a provider cap's
// own reset time, which is why it is the only thing here that ever states a time.
//
// A QUOTE IS NOT AN ETA, and the line between them is the whole of that rule rather than an exception
// to it. A running card carries the standing quote for its own pipeline — "usually 1.5 to 2.5 h" — which
// is a LOOKUP against the effort model's frozen table and says the same thing on the first minute as on
// the last. Nothing is computed from the run, nothing counts down, and past the upper bound the quote is
// replaced by "taking longer than usual" rather than revised: a revised figure is a prediction, and the
// engine has nothing to predict from.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CompanyChips } from '../shell/CompanyChips.tsx'
import type { Run, StopOutcome } from '../contract/api.ts'
import type { Row } from '../contract/grouping.ts'
import type { Tone } from '../contract/tone.ts'
import { api, saveFailureText } from '../contract/api.ts'
import { displayName } from '../contract/reads.ts'
import { toneColor } from '../contract/tone.ts'
import {
  recentlyFinished, finished, inFlight, recentFailures, acknowledged, active, waiting, runProductLabel, cardReason, limitLine, moveBefore, pips, slotNote, runsFor, readStamps, inFlightBreakdown, expectation,
} from '../contract/home.ts'
import { Icon } from '../components/Icon.tsx'
import { PageHeader } from '../components/PageHeader.tsx'
import { useLoad, usePoll } from '../state/useApi.ts'
import type { ShellContext } from '../shell/AppShell.tsx'
import { readableFailure } from '../contract/failure.ts'
import { canRun } from '../shell/permissions.ts'
import { runKey } from '../contract/genericKey.ts'

const TERMINAL = new Set<Run['state']>(['delivered', 'failed', 'cancelled'])

/** What the one finished line needs, from either kind of row grouping.ts can hand back. */
type Finished = {
  readonly name: string
  readonly band: string | null
  readonly tone: Tone | null
  readonly account: string
  readonly date: string | null
  readonly runId: string
}

/**
 * Flatten a grouped row to the one line Home shows.
 *
 * A FAMILY row has no single read behind it — it is several marks, and its band is the WORST of them
 * rather than the latest of anything. So the line borrows the family's own band (which is the fact that
 * matters about a family) but links to its newest mark's newest read, because a link has to go
 * somewhere real. Returns null only if a family somehow holds no marks, which grouping.ts does not
 * produce — the guard is there so a future change cannot turn that into a crash on the landing screen.
 */
function lastFinishedOf(row: Row): Finished | null {
  if (row.kind === 'mark') {
    return { name: row.name, band: row.band, tone: row.tone, account: row.account, date: row.date, runId: row.current.runId }
  }
  const newest = row.marks[0]
  if (!newest) return null
  return { name: row.name, band: row.band, tone: row.tone, account: row.account, date: row.date, runId: newest.current.runId }
}

/** Where a band stops being cards and becomes rows. A reading, not a ruling — see the call site. */
const COMPACT_FROM = 5

export function Home({ ctx }: { readonly ctx: ShellContext }) {
  // ONE REQUEST, WHOEVER IS ASKING. Staff get every account, a client gets its own, and the request is
  // identical — so this screen never branches on role, and cannot grow a staff layout by accident.
  const { result, reload } = useLoad(() => api.runsMine(), [])
  // THE ALLOWANCE IS PER COMPANY, AND THIS SCREEN SPANS THEM ALL.
  //
  // So it is stated only where there IS one owner to state it for: the one selected, or the only one
  // held. A multi-brand account has several daily allowances and no single number, and the line is
  // absent there rather than reading "unavailable" — which claims a fault where there is none, on the
  // very case this rebuild exists for.
  //
  // Resolved WITHOUT the switcher for the single-owner case: Home ignores the switcher by design, and
  // reading `ctx.owner` alone left a client whose owner had never been picked staring at "unavailable".
  const allowanceOwner = ctx.owner ?? (ctx.me.accounts.length === 1 ? ctx.me.accounts[0]! : null)
  const { result: usageRes } = useLoad(
    () => (allowanceOwner ? api.usage(allowanceOwner) : Promise.resolve({ kind: 'pickAccount' as const })),
    [allowanceOwner],
  )

  // THE CHIPS FILTER THE ROWS, per the ruling on the company-setup spec's item 7: the rail line is
  // navigation — dashboard versus working on one company — and not a statement about what the filter
  // reaches. Before this, choosing a company on Home changed nothing at all: the same marks stayed on
  // screen under every selection, and the chips were a control that looked like one.
  //
  // TWO SETS, DELIBERATELY, AND THE POLL KEEPS THE UNFILTERED ONE. `usePoll` is armed from whether any
  // run is still going, and arming it from the FILTERED set would stop the page refreshing the moment
  // somebody selected a company that happens to be idle — while another company's run was live and
  // moving. The screen would sit still and look finished. What is displayed is scoped; what decides
  // whether to keep looking is not.
  const allRuns: readonly Run[] = result?.kind === 'ok' ? result.value : []
  const runs = useMemo(() => runsFor(allRuns, ctx.owner), [allRuns, ctx.owner])
  const rows = useMemo(() => inFlight(runs), [runs])
  // — the runs that stopped recently and this reader has not put down. THEIR OWN SECTION, not the
  // live band: a failure from three days ago is not in flight, and while it sat in the band the screen
  // was only correct once every individual reader had dismissed it by hand. Bounded by age, so the list
  // cannot become the wall it replaced.
  const stopped = useMemo(() => recentFailures(runs), [runs])
  const [showStopped, setShowStopped] = useState(false)
  // — what this reader has put down. A COUNT, not a silent disappearance: acknowledging must not
  // be the same act as forgetting, so the number is on screen and one click opens the list.
  const acked = useMemo(() => acknowledged(runs), [runs])
  const [showAcked, setShowAcked] = useState(false)
  const cards = useMemo(() => active(rows), [rows])
  const queue = useMemo(() => waiting(rows), [rows])
  // WHICH READ EACH CARD IS, and only where two of them could be mistaken for each other. Computed over
  // the whole band — cards and queue together — because a reader compares what is on the screen, not
  // what one component was handed. The acknowledged list is its own population for the same reason: it
  // is opened on its own and its rows are compared with each other.
  const stamps = useMemo(() => readStamps(rows), [rows])
  const stoppedStamps = useMemo(() => readStamps(stopped), [stopped])
  const ackedStamps = useMemo(() => readStamps(acked), [acked])
  // Routed through grouping.ts — the SAME function Clearances renders — so the two screens cannot
  // disagree about what finished most recently or what it came back as.
  // RECENTLY FINISHED, NOT THE LAST ONE. With nothing in flight, Home was a heading over a single
  // finished clearance, which reads as the archive with one row rather than as a summary of it. Three
  // is enough to read as a tail and short enough that nobody mistakes it for the list.
  const done = useMemo(() => recentlyFinished(runs, undefined, 3), [runs])
  const recent = useMemo(() => done.map(lastFinishedOf).filter((r): r is Finished => r !== null), [done])
  const finishedCount = useMemo(() => finished(runs).length, [runs])

  usePoll(reload, {
    // THE UNFILTERED SET, and the comment above the split says why: a quiet company must not stop the
    // page watching a busy one.
    active: allRuns.some((r) => !TERMINAL.has(r.state)),
    rateLimited: result?.kind === 'rateLimited',
  })

  // Three answers, not two. Conflating "not replied yet" with "the request failed" is how a page shows
  // a permanent empty state on a transient fault and says nothing at all about it.
  const answer: 'loading' | 'ok' | 'error' = !result ? 'loading' : result.kind === 'ok' ? 'ok' : 'error'

  return (
    <div className="screen home2">
      {/* HOME SAYS WHICH PAGE IT IS, IN ONE LINE. With nothing in flight this screen was a
          heading-less list of finished clearances — which is what All Clearances is — and a reader
          arriving here asked where their clearances had gone. It said so for a day in two lines,
          "Home" over "Now", which is a header and its echo. The rail's own word, once.
          AND THE PAGE'S CONTROLS SIT ON THE HEADER ROW. Both were inside the in-flight band, which is
          a status line: it goes quiet when nothing is running, and it is the last place a reader looks
          for a button. New clearance is the primary and sits last; the way into the archive is beside
          it, the same secondary button, and nothing is left on the band. */}
      <PageHeader
        title="Home"
        actions={<>
          <button type="button" className="btn-ghost home2-all" onClick={() => ctx.go('/portal/clearances')}>
            <Icon name="layers" />
            <span>Clearances</span>
          </button>
          {/* THE GATE AND THE NAVIGATION ON ONE LINE, which is what nav.test.ts reads: a literal to a
              screen that needs Run must sit behind `canRun` where a reviewer can see the pair. Spread
              over a multi-line ternary the two drift apart in the file and the arm cannot pair them. */}
          {canRun(ctx.me) ? <NewClearanceButton onNew={() => ctx.go('/portal/new')} /> : null}
        </>}
      />
      {/* A BREAKDOWN, NOT A TOTAL. "3" tells a reader how much is on the screen; "2 running · 1 paused"
          tells them whether to wait. The idle sentence keeps the plain "0" beside it, because there is
          nothing to break down and a reader counting nothing does not need it spelled three ways. */}
      <InFlightBand
        breakdown={inFlightBreakdown(rows)}
        note={rows.length === 0
          ? `Nothing running right now.${canRun(ctx.me) ? ' Start one with New clearance.' : ''}`
          : slotNote(null, ctx.me.concurrentRuns)}
      />

      {/* The company filter, directly under the band. Home stays ABOVE the rail's switcher because the
          line is NAVIGATION — it separates "your dashboard" from "working on one company" — rather than
          a statement about what the filter reaches. The chips set the same value the rail sets AND
          filter the rows below them, so the two controls cannot disagree and neither is decorative. */}
      <div style={{ margin: '0 0 18px' }}>
        <CompanyChips ctx={ctx} label="Filter by company" />
      </div>

      {answer === 'error' ? (
        <p className="home2-notice">
          {result?.kind === 'rateLimited'
            ? 'Too many requests just now. The portal is pacing itself; this will refresh on its own.'
            : 'This did not load. Nothing is wrong with your runs — the list will try again.'}
        </p>
      ) : null}

      {/* CARDS UNTIL THE BAND IS TOO LONG TO READ AS CARDS, THEN ROWS. The specification draws two
          boards — two runs as cards, six as rows — and names no number in between; four is where this
          switches, and that is a reading rather than a ruling, called out here so it can be corrected
          cheaply. Both shapes are the same component, so the Stop and its dialog cannot differ. */}
      {cards.length ? (
        <div className={COMPACT_FROM <= cards.length ? 'home2-runrows' : 'home2-cards'}>
          {cards.map((r) => (
            <Card key={r.runId} run={r} ctx={ctx} onChanged={reload} stamp={stamps.get(r.runId) ?? null}
              compact={COMPACT_FROM <= cards.length} />
          ))}
        </div>
      ) : null}

      {queue.length ? <Queue rows={queue} ctx={ctx} onChanged={reload} stamps={stamps} /> : null}

      {/* WHAT STOPPED RECENTLY — a count that is always on screen, over a list that is not.
          The count is the part that must never be silent: it is what tells a reader a search failed
          while they were away, and it is there whether or not anybody has opened the list. The rows
          are folded because they are history and the live work above them is not — and because the
          band being full of them is the defect this section exists to undo. Rendered as CARDS, the
          same component the band uses, so Acknowledge stays exactly where a reader who opens the list
          already expects it. A run older than the window is in neither list and is read in Clearances,
          where nothing ages out. */}
      {stopped.length ? (
        <div className="home2-stopped">
          <button
            type="button"
            className="home2-stopped-toggle"
            aria-expanded={showStopped}
            onClick={() => setShowStopped((v) => !v)}
          >
            {stopped.length} stopped recently{showStopped ? '' : ' — show'}
          </button>
          {showStopped ? (
            <div className="home2-cards">
              {stopped.map((r) => (
                <Card key={r.runId} run={r} ctx={ctx} onChanged={reload} stamp={stoppedStamps.get(r.runId) ?? null} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* — ACKNOWLEDGED, BEHIND A COUNT. The run is unchanged and still in Clearances with its
          status intact; this is one reader's dashboard, and the way back is here rather than somewhere
          else on the site. Rendered only when there is something in it. */}
      {acked.length ? (
        <div className="home2-acked">
          <button
            type="button"
            className="home2-acked-toggle"
            aria-expanded={showAcked}
            onClick={() => setShowAcked((v) => !v)}
          >
            {acked.length} acknowledged{showAcked ? '' : ' — show'}
          </button>
          {showAcked ? (
            <ul className="home2-acked-list">
              {acked.map((r) => (
                <li key={r.runId}>
                  <span data-anon="mark">{displayName(r)}</span>
                  {ackedStamps.get(r.runId) ? (
                    <span className="home2-acked-when">{ackedStamps.get(r.runId)}</span>
                  ) : null}
                  <span className="home2-acked-state">{r.state === 'failed' ? 'Not finished' : 'Stopped'}</span>
                  <AckUndo run={r} onChanged={reload} />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {recent.length ? <RecentlyFinished rows={recent} total={finishedCount} ctx={ctx} /> : null}

      {answer === 'ok' && !cards.length && !queue.length && !recent.length && !stopped.length && !acked.length ? (
        <FirstRun onNew={canRun(ctx.me) ? () => ctx.go('/portal/new') : null} />
      ) : null}

      {usageRes?.kind === 'ok' ? (
        <p className="home2-limits mono">{limitLine(usageRes.value.today, usageRes.value.dailyRuns)}</p>
      ) : null}
    </div>
  )
}

function NewClearanceButton({ onNew }: { readonly onNew: () => void }) {
  // The page's primary action, in its own component so the permission test and the route literal fit on
  // one line at the call site. See the note there.
  return (
    <button type="button" className="home2-new" onClick={onNew}>
      <Icon name="plus-circle" />
      New clearance
    </button>
  )
}

function InFlightBand({
  breakdown,
  note,
}: {
  readonly breakdown: string
  readonly note: string | null
}) {
  // A STATUS LINE, AND NOTHING ELSE ON IT. This carried both of the page's buttons, one of them the
  // primary. They are on the header row now, for two reasons that point the same way: this band goes
  // quiet when nothing is running, which is exactly when a reader most wants "start one" — and a
  // control living inside a status line reads as part of the status rather than as something to press.
  return (
    <div className="home2-band">
      <span className="home2-band-label">In flight</span>
      {/* NOT MONO. A mono total read as a machine's counter; this is a sentence about what is happening,
          sized and coloured like the capacity line it sits opposite. */}
      <span className="home2-band-count">{breakdown}</span>
      <span className="home2-band-rule" />
      <span className="home2-band-note">{note}</span>
    </div>
  )
}

function Card({
  run,
  ctx,
  onChanged,
  stamp,
  compact = false,
}: {
  readonly run: Run
  readonly ctx: ShellContext
  readonly onChanged: () => void
  /** Which read this is — null when nothing on the band could be confused with it. See readStamps. */
  readonly stamp: string | null
  /**
   * Draw as a ROW rather than a card, for a band with too many to read as cards.
   *
   * ONE COMPONENT, TWO LAYOUTS, AND THAT IS THE WHOLE REASON THIS IS A PROP. A separate row component
   * would need its own Stop — and `home2-stop` is counted in a real browser by the render check as "a
   * Stop that can act", with an exact number. Two implementations of that control is how the count
   * stops meaning anything. The state, the handlers and the dialog below are shared; only the markup
   * branches.
   */
  readonly compact?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  // ── — THE CHOICE IS ASKED AT THE PRESS ──────────────────────────────────
  //
  // `asking` opens the question. It is per-card state and does not survive a reload, which is correct
  // rather than a gap: the stopping line below is drawn from the RUN, not from whether this reader was
  // the one who pressed.
  //
  // `took` is what the server said actually HAPPENED, which is not always what was asked: an immediate
  // stop that finds no turn to end is a boundary stop, and only the driver knows which it was. The
  // product's own sentence below is the boundary wording, so rendering it over an immediate stop would
  // state the wrong one — which is why the server's answer still wins where there is one.
  const [asking, setAsking] = useState(false)
  const [took, setTook] = useState<StopOutcome | null>(null)
  const p = pips(run.stepN, run.stepTotal)
  const label = runProductLabel(run.productName, run.marks.length)
  const reason = cardReason(run)
  const canStop = run.state === 'running' || run.state === 'paused'
  // — a requested stop is a state the screen shows. The run still says running,
  // because that is true; stopping is the pair (stopRequestedAt, non-terminal). The button goes with
  // it: a second press achieves nothing and should not be offered.
  const stopping = Boolean(run.stopRequestedAt) && canStop
  // NOT WHILE STOPPING. A run whose stop is taking effect is not going to take "usually 1.5 to 2.5 h";
  // it is going to end. The quote beside that sentence would read as a wait the reader still owes.
  const expect = stopping ? null : expectation(run)
  // — terminal and NOT delivered. A delivered run never reaches this band; a paused or recovering
  // one is a run someone still needs to see, and the issue says so in as many words.
  const canAck = run.state === 'failed' || run.state === 'cancelled'

  const ack = useCallback(async (acknowledged: boolean) => {
    setBusy(true)
    setFailed(null)
    const r = await api.acknowledge({ runId: run.runId, state: run.state, acknowledged })
    setBusy(false)
    if (r.kind !== 'ok') {
      // — THE SERVER'S OWN REASON, not a sentence that replaces it. The server
      // composed "only a failed or cancelled run can be acknowledged", which a reader can act on; this
      // showed "That could not be saved just now. Nothing has changed." instead, which is the message
      // the owner reported. `saveFailureText` is the one place that answer is written, and it already
      // has a branch for every member of the union — including the gone session, which is what a
      // generic fallback most often hides.
      setFailed(saveFailureText(r, 'That could not be saved just now. Nothing has changed.'))
      return
    }
    onChanged()
  }, [run, onChanged])

  // ── — ONE STOP, TWO TRADES, NAMED AT THE PRESS ──────────────────────────
  //
  // This was a `window.confirm` offering yes or no, and the sentence it carried promised the boundary
  // stop because that was the only one there was. The owner met the wait twice and ruled: "a stop is a
  // stop — maybe it should be a 'stop immediately or at next boundary to preserve data' kind of
  // question when you press it."
  //
  // So the press asks the question rather than stating the answer. It cannot be a `confirm`: that has
  // two outcomes and this has three, and the third — leaving it running — must stay the easiest one.
  const stop = useCallback(async (immediate: boolean) => {
    setAsking(false)
    setBusy(true)
    setFailed(null)
    const r = await api.stopRun(run.runId, run.account, { immediate })
    setBusy(false)
    // The server already says something TRUE and role-appropriate here, and the old blanket string
    // threw it away — including the 409 case, where the run had in fact just finished, so "nothing
    // has changed" was the one thing it could not honestly say. It also hid a standing misconfig:
    // an ops token minted without the stop_run verb refuses EVERY press, forever, and the portal
    // logs that on startup with the exact remedy. One generic sentence made a permanent break look
    // like a transient blip, which is how it survived unnoticed.
    if (r.kind !== 'ok') {
      // — through the same one place. The hand-rolled `'message' in r` reached
      // the three members that carry a `message` and dropped the reason on every other: a 400 naming
      // what was wrong with the request, a 404 saying the run had gone, a gone session.
      setFailed(saveFailureText(r, 'It could not be stopped just now. Nothing has changed.'))
    } else {
      // — WHAT HAPPENED, not what was asked.
      setTook(r.value)
    }
    onChanged()
  }, [run, onChanged])

  // THE STOP AND ITS QUESTION, ONCE. Both layouts render this same fragment: `home2-stop` is counted in
  // a real browser as "a Stop that can act", with an exact number, and a second implementation of the
  // control is how that count quietly stops meaning anything.
  const stopControl = (<>
    {canStop && !stopping && canRun(ctx.me) ? (
      ctx.me.stopControl.available ? (
        <button type="button" className="home2-stop" onClick={() => setAsking(true)} disabled={busy}>
          {busy ? 'Stopping…' : 'Stop'}
        </button>
      ) : (
        /* — a button that always fails must not render as available. The
           deployment said at boot its token cannot stop; the control says so here, where the
           press would have happened, instead of failing identically forever. Staff read the
           posture reason; a client reads who to ask. */
        /* Its OWN class, deliberately (the Acknowledge lesson one arm up): home2-stop is counted
           by the browser check as "a Stop that can act", and this control exists precisely
           because this one cannot. */
        <button type="button" className="home2-stop-unavailable" disabled
          title={ctx.me.stopControl.reason ?? 'Stopping is not available on this deployment right now — the operator has been told at boot.'}>
          Stop unavailable
        </button>
      )
    ) : null}
    {/* — the question, at the press. */}
    {asking ? (
      <StopChoice
        name={displayName(run)}
        step={run.step}
        stoppable={run.stoppable}
        onImmediate={() => void stop(true)}
        onBoundary={() => void stop(false)}
        onCancel={() => setAsking(false)}
      />
    ) : null}
  </>)

  // ── THE COMPACT ROW ─────────────────────────────────────────────────────────────────────────────
  //
  // The same grid the queue rows use, so the columns and the narrow-screen rule stay one definition;
  // `home2-runrow` adds only what a running row has that a waiting one does not. The reason is asked
  // for COMPACT, which drops the paused sentence's closing reassurance — a row has no width for it —
  // while keeping the fact a reader needs, which is when the provider resumes.
  if (compact) {
    return (
      <div className="home2-qrow home2-runrow">
        <StateChip state={run.state} stopping={stopping} />
        <span className="home2-qmark" data-anon="mark">{displayName(run)}</span>
        <span className="home2-qowner" data-anon="mark">{ctx.ownerName(runKey(run))}</span>
        <span className="home2-qdepth">{runProductLabel(run.productName, run.marks.length)}</span>
        {run.step ? <span className="home2-qstep">{run.step}</span> : null}
        <span className="home2-qreason">
          {failed ?? cardReason(run, Date.now(), true)}
          {expect ? <span className="home2-expect">{` · ${expect}`}</span> : null}
        </span>
        {stopControl}
      </div>
    )
  }

  return (
    <div className={`home2-card${run.state === 'failed' ? ' failed' : ''}`}>
      <span className={`home2-card-rule ${run.state}`} />
      <div className="home2-card-body">
        <div className="home2-card-head">
          {/* WRAPS, never truncates — the retired preliminaries differ only in their suffix, so an
              ellipsis turns "registers + marketplace" and "registers only" into the same string, and
              they are close to opposite. Archived runs still carry those names. */}
          <span className="home2-depth">{label}</span>
          <StateChip state={run.state} stopping={stopping} />
        </div>

        <div className="home2-card-mark" data-anon="mark">
          {displayName(run)}
        </div>
        <div className="home2-card-owner" data-anon="mark">
          {ctx.ownerName(runKey(run))}
          {run.projectName || run.projectKey ? ` · ${run.projectName ?? run.projectKey}` : ''}
        </div>
        {/* WHICH READ, and only when another card would otherwise be its twin. A single read shows
            nothing here: the band is a short list of short things and the failure sentence below is
            already the long item on it. */}
        {stamp ? <div className="home2-card-when">{stamp}</div> : null}

        {run.step ? <div className="home2-step">{run.step}</div> : null}

        {/* N COMES FROM THE RUN. Nine for a clearance, five or six for a knockout — anything assuming a
            constant mislabels every screen a client watches. */}
        {p ? (
          <div className="home2-pips">
            {Array.from({ length: p.total }, (_, i) => (
              <span key={i} className={`home2-pip${i < p.filled ? ` on ${run.state}` : ''}`} />
            ))}
          </div>
        ) : null}

        <div className="home2-card-foot">
          <span className={`home2-reason ${run.state}`}>{failed ?? reason}</span>
          {/* THE QUOTE FOR THIS PIPELINE, after the elapsed time and quieter than it. A lookup against
              the effort model's frozen table — never computed from this run, and never counted down.
              Absent on a paused card, whose elapsed line is not measuring work, and on a queued one,
              which has not started. Past the upper bound the quote is REPLACED, not revised. */}
          {expect ? <span className="home2-expect">{` · ${expect}`}</span> : null}
          {/* — the engine's own words, for an engineer, behind a disclosure. The card states the
              one fact a reader can act on; this is where the validator reason and the query list live
              now that they are no longer in the sentence. Absent ⇒ no disclosure at all, so a failure
              carrying no payload renders exactly as it did. */}
          {run.state === 'failed' && (run.reasonDetail ?? readableFailure(run.failedStage, run.reason).raw) ? (
            <details className="home2-raw">
              <summary style={{ cursor: 'pointer', color: 'var(--text-faint)', fontSize: 12 }}>Details</summary>
              <pre style={{ whiteSpace: 'pre-wrap', margin: '4px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
                {run.reasonDetail ?? readableFailure(run.failedStage, run.reason).raw}
              </pre>
            </details>
          ) : null}
          {/* Stopping is part of Run clearances. A person without it has no Stop here — not a Stop that
              refuses them, which is the one control this card must never offer. */}
          {stopControl}
          {/* — THE WAY OUT. "Home — what is in flight, what is waiting, and the way out of both."
              A failed run is neither, and it had no way out, so the band filled with dead runs and
              stopped showing the live ones.
              OFFERED ONLY ON A TERMINAL, NON-DELIVERED STATE — never on paused or recovering, which are
              runs somebody still needs to see. No confirm: it changes nothing, for nobody but the
              person clicking, and it is one click to undo from the count below. */}
          {/* ITS OWN CLASS, not home2-stop. It shares the styling and it is NOT the same control: Stop ends
              a live run, Acknowledge dismisses a dead one. scripts/home-render-check.mjs counts
              `.home2-stop` to assert "Stop appears only where it can do something", so borrowing the
              class made that assertion count this button and fail on every terminal card — the check was
              right and the class was wrong.  */}
          {canAck ? (
            <button type="button" className="home2-ack" onClick={() => void ack(true)} disabled={busy}>
              Acknowledge
            </button>
          ) : null}
        </div>
        {/* ── THE STOP NOTICE GETS ITS OWN ROW, and that is a defect fix rather than a preference.
            It used to be a flex item inside `home2-card-foot`, beside the elapsed line — so a
            sentence of this length squeezed "1 min so far" into a column two characters wide and the
            card read as garbled. Found by the owner on a real run. The foot is a row of short things;
            this is a paragraph, and it belongs under them at full width. */}
        {stopping ? (
          /* The wait, named: what is happening and why the reader is still waiting — the answer to
             "why is this taking so long", which they cannot otherwise know. The button is GONE, not
             disabled-and-grey: there is nothing further to press for. */
          <div className="home2-stop-note">
            {/* IT SAYS WHICH STOP IS IN PROGRESS, read off the server's answer to this session's
                press, and the server's own sentence is rendered as-is — it names the step, what was
                kept and what was lost, and a second author for one fact is how the two drift.

                THE FALLBACK IS THE BOUNDARY STOP'S WORDING, and it is the safe one to show without an
                answer in hand. `took` is per-card state and does not survive a reload; a run still
                stopping when a reader comes back has not gone terminal in seconds, whichever mode was
                pressed. */}
            {/* THE SERVER'S ANSWER WINS WHERE THERE IS ONE, because only it can tell an immediate stop
                from a boundary stop, and the sentence below is the boundary wording. `took` is per-card
                state and does not survive a reload — correct rather than a gap: a run still stopping
                when a reader comes back has not gone terminal in seconds.

                THE FALLBACK NO LONGER SAYS "NOTHING WILL BE DELIVERED". That is true and it is the
                wrong thing to leave a reader holding: the finished steps ARE readable through Ask AI,
                and naming only what was lost invites the support question the sentence could have
                answered. */}
            {took?.note
              ? took.note
              : (<>
                  Stopping — letting {run.step ? `${run.step}` : 'the step in flight'} finish. No report
                  will be produced. Completed work stays readable through Ask AI.
                </>)}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** — one click back onto the dashboard. Same route, `acknowledged: false`. */
function AckUndo({ run, onChanged }: { readonly run: Run; readonly onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      className="home2-acked-undo"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        await api.acknowledge({ runId: run.runId, state: run.state, acknowledged: false })
        setBusy(false)
        onChanged()
      }}
    >
      Bring back
    </button>
  )
}

/**
 * ── — "stop immediately or at next boundary to preserve data" ───────────────
 *
 * The owner's own words for the question, after meeting the same wait twice. Stop was a `window.confirm`
 * that promised the boundary stop, because that was the only stop there was; the driver half landed the
 * other one, and this is where a reader chooses between them.
 *
 * ── WHAT EACH OPTION HAD TO SAY, AND WHY IN THIS ORDER ─────────────────────────────────────────────
 *
 * Each names WHAT IT COSTS rather than how it works. "Stop now" costs the step in flight — that is the
 * whole of the trade, and "SIGTERM to the engine child" is not a cost a reader can weigh. "Stop at the
 * next step" costs time, and the honest thing about that time is that it is UNBOUNDED: the owner's own
 * run sat 28 minutes in one step. The old copy said "a reasoning step can take tens of minutes", which
 * reads as an estimate; there is no estimate, and saying so is what makes the other option make sense.
 *
 * THE SAFE ONE IS FIRST and carries the default styling. Stop now loses work, and a control that loses
 * work should not be the one a reader hits by reflex — but it is a real offer, not a hidden one, because
 * the reason the owner asked for it is that his money was burning while he waited.
 *
 * NOT STAFF-ONLY (acceptance 4). The person spending the money is the person who needs the choice, and
 * this card is the client's own dashboard.
 *
 * `home2-stop` IS DELIBERATELY NOT USED on either button. scripts/home-render-check.mjs counts that
 * class to assert "a Stop appears only where it can act", exactly against an expected number — the same
 * check reddened main on by giving Acknowledge that class. Two more of them inside a dialog would
 * break a browser arm that no unit test can see.
 */
function StopChoice({ name, step, stoppable, onImmediate, onBoundary, onCancel }: {
  readonly name: string
  readonly step: string | null
  readonly stoppable: boolean
  readonly onImmediate: () => void
  readonly onBoundary: () => void
  readonly onCancel: () => void
}) {
  // ── A ROW SELECTS; ONLY THE BUTTON STOPS ──────────────────────────────────────────────────────
  //
  // Each option used to BE the button: one click on "Stop now" cut a step off and lost its work. On a
  // control that cannot be undone, the reading and the committing were the same gesture, and a reader
  // who clicked a row to find out what it meant had already chosen. Now the rows are a choice and the
  // button is the act, and the button says which act — so nobody presses "Stop" not knowing which stop.
  //
  // THE SAFER OPTION IS PRESELECTED. Stopping after the step keeps that step's work; the reader has to
  // move off it deliberately to lose anything.
  const [mode, setMode] = useState<'boundary' | 'immediate'>('boundary')

  // Escape closes it, like every other modal here — and it resolves to LEAVING THE RUN ALONE, which is
  // the safe outcome for a dismissal on a control that cannot be undone.
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [onCancel])

  const stepName = step ?? 'The step in flight'
  const label = mode === 'boundary' ? 'Stop after this step' : 'Stop now'

  return (
    <div className="modal-scrim" onClick={onCancel} role="dialog" aria-modal="true" aria-label="Stop this clearance">
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-rule" aria-hidden />
          <span className="eyebrow" style={{ color: 'var(--accent-quiet)' }}>Stop this clearance</span>
          <h2 style={{ margin: '7px 0 3px', fontSize: 19, fontWeight: 700, color: 'var(--text-strong)' }} data-anon="mark">{name}</h2>
          {/* THE PROMISE IS WITHDRAWN WHEN IT CANNOT BE KEPT. A run that has committed to publishing is
              past its last stoppable point, and this line used to tell the reader the opposite -- a
              report was published a hundred seconds after somebody was told nothing would be. The
              product's own sentence below says "produces no report", which is true only while the run
              CAN still be stopped; past that point it would be the same false promise again. So the
              branch stays, and the new wording lives on the side of it where it is true. */}
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>
            {stoppable
              ? <>A stopped search cannot be restarted and produces no report. It stays in Clearances,
                marked stopped. Its finished steps stay readable through Ask AI.</>
              : <>This run is already writing its report, so stopping it may not prevent delivery. What
                has been spent is spent, and it cannot be undone either way.</>}
          </p>
        </div>

        <div className="stop-choice" role="radiogroup" aria-label="How to stop it">
          <label className={`stop-choice-opt${mode === 'boundary' ? ' selected' : ''}`}>
            <input type="radio" name="stop-mode" checked={mode === 'boundary'} onChange={() => setMode('boundary')} />
            <b>Stop after this step</b>
            <span>{stepName} finishes first, so its work is kept. There is no reliable completion estimate for this step.</span>
          </label>
          <label className={`stop-choice-opt stop-choice-now${mode === 'immediate' ? ' selected' : ''}`}>
            <input type="radio" name="stop-mode" checked={mode === 'immediate'} onChange={() => setMode('immediate')} />
            {/* THE SPECIFIED TWO SENTENCES, VERBATIM, AND ONE MORE THAT A STANDING RULE REQUIRES. A control
                on an irreversible act must not state an outcome the mechanism cannot guarantee — and an
                immediate stop CAN fail to take: a step that will not accept it ends at the next step
                instead. "Is cut off" alone would promise the one thing that is not certain. The third
                sentence is the fallback, so the reader is offered the mode without being sold a result.
                (Above the label, not between it and its text: an arm reads the two as adjacent.) */}
            <b>Stop now</b>
            <span>{stepName} is cut off and its work is lost. Everything recorded before it is kept. If it will
              not take the stop, the run stops at the next step instead.</span>
          </label>
        </div>

        <div className="modal-foot">
          {/* THE BUTTON NAMES THE ACT IT PERFORMS. Its words follow the selected row, so a reader never
              presses a generic "Stop" without knowing which of the two they chose. */}
          <button type="button" className="btn-primary" onClick={mode === 'boundary' ? onBoundary : onImmediate}>
            {label}
          </button>
          <button type="button" className="btn-ghost" onClick={onCancel}>Leave it running</button>
        </div>
      </div>
    </div>
  )
}

function StateChip({ state, stopping = false }: { readonly state: Run['state']; readonly stopping?: boolean }) {
  // BOTH PAUSE KINDS SAY "Paused" and differ only in the reason line below, so a third kind of pause
  // drops in without inventing a third state for anyone to learn. "Stopping…" is not a fourth state —
  // it is the (stopRequestedAt, non-terminal) pair worn as a word, and the
  // terminal replaces it the moment the run is actually down.
  const word = stopping ? 'Stopping…'
    : state === 'running' ? 'Running' : state === 'paused' ? 'Paused' : state === 'failed' ? 'Not finished' : 'Stopped'
  return (
    <span className={`home2-chip ${state}`}>
      <span className="home2-dot" />
      {word}
    </span>
  )
}

function Queue({
  rows,
  ctx,
  onChanged,
  stamps,
}: {
  readonly rows: readonly Run[]
  readonly ctx: ShellContext
  readonly onChanged: () => void
  /** Which read each waiting row is, by runId — null for one nothing can be confused with. */
  readonly stamps: ReadonlyMap<string, string | null>
}) {
  const [open, setOpen] = useState(false)
  const [order, setOrder] = useState<readonly string[]>(() => rows.map((r) => r.runId))
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  // Reordering and cancelling are Run clearances. Without it the queue is still shown — what is waiting,
  // in what order — and offers no handle to drag and no Cancel that would only refuse.
  const mayRun = canRun(ctx.me)

  // The server is the source of truth for what is queued. Re-seed whenever the SET of ids changes — a
  // job that started, or one that arrived from the email door, must not leave a stale ordinal on screen.
  const ids = rows.map((r) => r.runId).join(',')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setOrder(rows.map((r) => r.runId)), [ids])

  const byId = new Map(rows.map((r) => [r.runId, r]))
  const shown = order.map((id) => byId.get(id)).filter((r): r is Run => !!r)

  const commit = useCallback(
    async (next: readonly string[]) => {
      setOrder(next)
      const account = shown[0]?.account
      if (!account) return
      await api.reorderQueue(next, account)
      onChanged()
    },
    [shown, onChanged],
  )

  return (
    <div className="home2-queue">
      <button type="button" className="home2-queue-bar" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="home2-queue-ring" />
        <span className="home2-queue-count">
          <strong>{shown.length}</strong> waiting for a slot
        </span>
        <span className="home2-queue-spacer" />
        {mayRun ? <span className="home2-queue-note">Drag to reorder — the top one takes the next free slot</span> : null}
        <span className={`home2-queue-chev${open ? ' open' : ''}`}>
          <Icon name="chevron-right" />
        </span>
      </button>

      {open ? (
        <div className="home2-queue-rows cord-scroll">
          {shown.map((r, i) => (
            <div
              key={r.runId}
              className={`home2-qrow${dragging === r.runId ? ' dragging' : ''}${over === r.runId ? ' target' : ''}`}
              draggable={mayRun}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move'
                setDragging(r.runId)
              }}
              onDragOver={(e) => {
                e.preventDefault()
                setOver(r.runId)
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (dragging && mayRun) void commit(moveBefore(order, dragging, r.runId))
                setDragging(null)
                setOver(null)
              }}
              onDragEnd={() => {
                setDragging(null)
                setOver(null)
              }}
            >
              {mayRun ? (
                <span className="home2-grip">
                  <Icon name="grip-vertical" />
                </span>
              ) : null}
              <span className={`home2-pos mono${i === 0 ? ' first' : ''}`}>{i + 1}</span>
              <span className="home2-qmark" data-anon="mark">
                {displayName(r)}
              </span>
              {/* The stamp rides IN the owner cell rather than in a column of its own: this row is a
                  grid with named columns and a narrow-screen rule that hides two of them, so a new
                  child would have had to be added to both or it would break the layout it was meant
                  to clarify. */}
              <span className="home2-qowner" data-anon="mark">
                {ctx.ownerName(runKey(r))}
                {stamps.get(r.runId) ? ` · ${stamps.get(r.runId)}` : ''}
              </span>
              <span className="home2-qdepth">{runProductLabel(r.productName, r.marks.length)}</span>
              {mayRun ? <CancelButton run={r} onChanged={onChanged} /> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function CancelButton({ run, onChanged }: { readonly run: Run; readonly onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  return (
    <button
      type="button"
      className="home2-cancel"
      disabled={busy}
      title={note ?? undefined}
      onClick={async () => {
        setBusy(true)
        const r = await api.cancelQueued(run.runId, run.account)
        setBusy(false)
        // A LOST RACE IS NOT A FAILURE. The runner claimed it between the click and the request; the job
        // is fine, it is running. And this is never greyed out in advance to avoid the race — a control
        // that was valid when someone reached for it must not be dead by the time they arrive.
        if (r.kind === 'gate') setNote('It started just before this reached us — it is running now.')
        onChanged()
      }}
    >
      {busy ? '…' : 'Cancel'}
    </button>
  )
}

function RecentlyFinished({
  rows,
  total,
  ctx,
}: {
  readonly rows: readonly Finished[]
  readonly total: number
  readonly ctx: ShellContext
}) {
  // A TAIL, AND THEN THE WAY INTO THE ARCHIVE — not a second archive. Everything a finished list would
  // offer (threads, families, filters, sort, paging) already exists on All Clearances and is better
  // there; a worse copy here would teach people not to go. What changed is that one row read as the
  // archive with a single entry, and the way out was a button inside a band a reader does not look at.
  return (
    <>
      <div className="home2-done-band">
        <span className="home2-band-label faint">Recently finished</span>
        <span className="home2-band-rule" />
      </div>
      {rows.map((row) => (
        <div key={row.runId} className="home2-done" onClick={() => ctx.go(`/portal/result/${encodeURIComponent(row.runId)}`)}>
          <span className="home2-done-dot" style={row.tone ? { background: toneColor(row.tone) } : undefined} />
          <span className="home2-done-mark" data-anon="mark">
            {row.name}
          </span>
          {row.band ? <span className="home2-done-verdict">{row.band}</span> : null}
          <span className="home2-done-meta" data-anon="mark">
            · {ctx.ownerName(runKey(row))}
            {row.date ? ` · ${row.date}` : ''}
          </span>
        </div>
      ))}
      {/* A LINE, NOT A SECOND BUTTON. The one button belongs at the top beside New clearance; this says
          how much more there is, which is the question a tail leaves a reader with. */}
      <button type="button" className="home2-see-all" onClick={() => ctx.go('/portal/clearances')}>
        See all {total}
      </button>
    </>
  )
}

function FirstRun({ onNew }: { readonly onNew: (() => void) | null }) {
  // Nothing has run. One sentence and the button — no empty card slots, no zeroes, and no section
  // headings standing over nothing.
  //
  // FOR A PERSON WHO MAY NOT START ONE, a different sentence and no button. Both halves of the first
  // sentence would be false for them — they cannot clear a name, and they cannot stop anything — and a
  // button that leads to a page that does not exist for them is worse than no button.
  if (!onNew) {
    return (
      <div className="home2-firstrun">
        <p>Nothing has been run for the companies you can see yet. Reports appear here as they are delivered.</p>
      </div>
    )
  }
  return (
    <div className="home2-firstrun">
      <p>
        Clear a name against the registers and the live marketplace. What is running shows here, and you
        can stop it from here.
      </p>
      <button type="button" className="home2-new" onClick={onNew}>
        <Icon name="plus-circle" />
        New clearance
      </button>
    </div>
  )
}
