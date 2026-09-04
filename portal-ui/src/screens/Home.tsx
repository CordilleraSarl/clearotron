// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Home — what is in flight, what is waiting, and the way out of both.
//
// ONE JOB: within about two seconds, know whether the thing you are waiting on is moving, stuck, or
// ready. Then get out of the way.
//
// ── WHAT THE PREVIOUS ATTEMPT GOT WRONG, SO IT IS NOT REPEATED ───────────────────────────────────
// It buried in-flight work under a long list of brand owners; picking one made that work vanish with no
// way back; and it re-listed finished runs at lower fidelity than Clearances, whose grouping, threading,
// families, filters and sort it could not match. Three rules fall out of that, and each is a defect if
// it goes missing:
//
//   1. ACCOUNT-SCOPED, NEVER OWNER-SCOPED. Every brand owner this account holds, always, with the owner
//      as a label on the row. The sidebar switcher does not reach this screen — it sits above the line
//      in nav.config for exactly that reason — so nothing here can be emptied by a filter choice.
//   2. NO FINISHED LIST. One line, then a link INTO Clearances. A lower-fidelity copy of a screen that
//      already does the job well loses to it, and teaches people not to go there.
//   3. NO ROLE SPLIT. There is no staff Home and no client Home. What differs is how many brand owners
//      someone holds, and quantity is a rendering decision.
//
// There is no ETA and no percent-complete anywhere on this page: nothing in the system measures or
// predicts run duration, and the stepper is deliberately lossy. The one real clock is a provider cap's
// own reset time, which is why it is the only thing here that ever states a time.

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Run, StopOutcome } from '../contract/api.ts'
import type { Row } from '../contract/grouping.ts'
import type { Tone } from '../contract/tone.ts'
import { api, saveFailureText } from '../contract/api.ts'
import { displayName } from '../contract/reads.ts'
import { toneColor } from '../contract/tone.ts'
import {
  recentlyFinished, inFlight, acknowledged, active, waiting, runProductLabel, cardReason, limitLine, moveBefore, pips, slotNote,
} from '../contract/home.ts'
import { Icon } from '../components/Icon.tsx'
import { useLoad, usePoll } from '../state/useApi.ts'
import type { ShellContext } from '../shell/AppShell.tsx'
import { readableFailure } from '../contract/failure.ts'

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

export function Home({ ctx }: { readonly ctx: ShellContext }) {
  // ONE REQUEST, WHOEVER IS ASKING. Staff get every account, a client gets its own, and the request is
  // identical — so this screen never branches on role, and cannot grow a staff layout by accident.
  const { result, reload } = useLoad(() => api.runsMine(), [])
  // THE ALLOWANCE IS PER BRAND OWNER, AND THIS SCREEN SPANS THEM ALL.
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

  const runs: readonly Run[] = result?.kind === 'ok' ? result.value : []
  const rows = useMemo(() => inFlight(runs), [runs])
  // — what this reader has put down. A COUNT, not a silent disappearance: acknowledging must not
  // be the same act as forgetting, so the number is on screen and one click opens the list.
  const acked = useMemo(() => acknowledged(runs), [runs])
  const [showAcked, setShowAcked] = useState(false)
  const cards = useMemo(() => active(rows), [rows])
  const queue = useMemo(() => waiting(rows), [rows])
  // Routed through grouping.ts — the SAME function Clearances renders — so the two screens cannot
  // disagree about what finished most recently or what it came back as.
  const done = useMemo(() => recentlyFinished(runs, undefined, 1), [runs])
  const lastDone = useMemo(() => (done.length ? lastFinishedOf(done[0]!) : null), [done])

  usePoll(reload, {
    active: runs.some((r) => !TERMINAL.has(r.state)),
    rateLimited: result?.kind === 'rateLimited',
  })

  // Three answers, not two. Conflating "not replied yet" with "the request failed" is how a page shows
  // a permanent empty state on a transient fault and says nothing at all about it.
  const answer: 'loading' | 'ok' | 'error' = !result ? 'loading' : result.kind === 'ok' ? 'ok' : 'error'

  return (
    <div className="screen home2">
      <InFlightBand
        count={cards.length + queue.length}
        note={slotNote(null, ctx.me.concurrentRuns)}
        onNew={() => ctx.go('/portal/new')}
      />

      {answer === 'error' ? (
        <p className="home2-notice">
          {result?.kind === 'rateLimited'
            ? 'Too many requests just now. The portal is pacing itself; this will refresh on its own.'
            : 'This did not load. Nothing is wrong with your runs — the list will try again.'}
        </p>
      ) : null}

      {cards.length ? (
        <div className="home2-cards">
          {cards.map((r) => (
            <Card key={r.runId} run={r} ctx={ctx} onChanged={reload} />
          ))}
        </div>
      ) : null}

      {queue.length ? <Queue rows={queue} ctx={ctx} onChanged={reload} /> : null}

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
                  <span className="home2-acked-state">{r.state === 'failed' ? 'Not finished' : 'Stopped'}</span>
                  <AckUndo run={r} onChanged={reload} />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {lastDone ? <LastFinished row={lastDone} ctx={ctx} /> : null}

      {answer === 'ok' && !cards.length && !queue.length && !lastDone ? (
        <FirstRun onNew={() => ctx.go('/portal/new')} />
      ) : null}

      {usageRes?.kind === 'ok' ? (
        <p className="home2-limits mono">{limitLine(usageRes.value.today, usageRes.value.dailyRuns)}</p>
      ) : null}
    </div>
  )
}

function InFlightBand({
  count,
  note,
  onNew,
}: {
  readonly count: number
  readonly note: string | null
  readonly onNew: () => void
}) {
  // A GRID, not a spacer-and-wrap. The button stays pinned right at every width; a flex-wrap
  // construction drops it onto its own line the moment the note gets long, which is exactly when the
  // row is busiest and the button is most wanted.
  return (
    <div className="home2-band">
      <span className="home2-band-label">In flight</span>
      <span className="home2-band-count mono">{count}</span>
      <span className="home2-band-rule" />
      <span className="home2-band-note">{note}</span>
      <button type="button" className="home2-new" onClick={onNew}>
        <Icon name="plus-circle" />
        New clearance
      </button>
    </div>
  )
}

function Card({
  run,
  ctx,
  onChanged,
}: {
  readonly run: Run
  readonly ctx: ShellContext
  readonly onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  // ── — THE CHOICE IS ASKED AT THE PRESS ──────────────────────────────────
  //
  // `asking` opens the question; `took` is what the server said actually happened, which is not always
  // what was asked. Both are per-card state and neither survives a reload — see the stopping line below
  // for why that is correct rather than a gap.
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
      // — WHAT HAPPENED, not what was asked. An immediate stop that found no
      // turn to end IS a boundary stop and the driver says so; showing "stopping now" over it would be
      // the same silence this issue was opened about, moved one layer along.
      setTook(r.value)
    }
    onChanged()
  }, [run, onChanged])

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
          {ctx.ownerName(run.account)}
          {run.projectName || run.projectKey ? ` · ${run.projectName ?? run.projectKey}` : ''}
        </div>

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
          {canStop && !stopping ? (
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
              onImmediate={() => void stop(true)}
              onBoundary={() => void stop(false)}
              onCancel={() => setAsking(false)}
            />
          ) : null}
          {stopping ? (
            /* The wait, named: what is finishing and why it is allowed to — the
               answer to "why is this taking so long", which the reader cannot otherwise know. The
               button is GONE, not disabled-and-grey: there is nothing further to press for. */
            <div className="home2-stopping">
              {/* ── — IT SAYS WHICH STOP IS IN PROGRESS ────────────────────
                  Read off the server's answer to this session's press, and the server's own sentence
                  is rendered as-is: it names the step, what was kept and what was lost, and a second
                  author for one fact is how the two drift.

                  THE FALLBACK IS NOT A GAP. `took` is per-card state and does not survive a reload —
                  but a run still stopping when a reader comes back IS the boundary stop, by
                  construction: an immediate stop that ended its turn goes terminal in seconds, and one
                  that could not find a turn to end was reported as a boundary stop at the press. So
                  the wording without an answer in hand is the true one. */}
              {took?.note
                ? took.note
                : (<>
                    Stopping — {run.step ? `letting “${run.step}” finish` : 'letting the step in flight finish'}.
                    A reasoning step can take tens of minutes and has no deadline. Nothing further will
                    start, and nothing will be delivered.
                  </>)}
            </div>
          ) : null}
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
function StopChoice({ name, step, onImmediate, onBoundary, onCancel }: {
  readonly name: string
  readonly step: string | null
  readonly onImmediate: () => void
  readonly onBoundary: () => void
  readonly onCancel: () => void
}) {
  // Escape closes it, like every other modal here — and it resolves to LEAVING THE RUN ALONE, which is
  // the safe outcome for a dismissal on a control that cannot be undone.
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [onCancel])

  return (
    <div className="modal-scrim" onClick={onCancel} role="dialog" aria-modal="true" aria-label="Stop this clearance">
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-rule" aria-hidden />
          <span className="eyebrow" style={{ color: 'var(--accent-quiet)' }}>Stop this clearance</span>
          <h2 style={{ margin: '7px 0 3px', fontSize: 19, fontWeight: 700, color: 'var(--text-strong)' }} data-anon="mark">{name}</h2>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>
            Either way it cannot be undone, nothing is delivered, and what has already been spent is
            spent.
          </p>
        </div>

        <div className="stop-choice">
          <button type="button" className="stop-choice-opt" onClick={onBoundary}>
            <b>Stop at the next step</b>
            <span>
              {step ? <>Lets “{step}” finish first, so its work is kept.</> : <>Lets the step in flight finish first, so its work is kept.</>}
              {' '}That step has no deadline — it ends when it ends, and it can be tens of minutes.
            </span>
          </button>
          <button type="button" className="stop-choice-opt stop-choice-now" onClick={onImmediate}>
            <b>Stop now</b>
            <span>
              Ends {step ? <>“{step}”</> : <>the step in flight</>} rather than waiting for it. The run
              is over in seconds. That step&rsquo;s work is lost; everything recorded before it is kept.
            </span>
          </button>
        </div>

        <div className="modal-foot">
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
}: {
  readonly rows: readonly Run[]
  readonly ctx: ShellContext
  readonly onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [order, setOrder] = useState<readonly string[]>(() => rows.map((r) => r.runId))
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)

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
        <span className="home2-queue-note">Drag to reorder — the top one takes the next free slot</span>
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
              draggable
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
                if (dragging) void commit(moveBefore(order, dragging, r.runId))
                setDragging(null)
                setOver(null)
              }}
              onDragEnd={() => {
                setDragging(null)
                setOver(null)
              }}
            >
              <span className="home2-grip">
                <Icon name="grip-vertical" />
              </span>
              <span className={`home2-pos mono${i === 0 ? ' first' : ''}`}>{i + 1}</span>
              <span className="home2-qmark" data-anon="mark">
                {displayName(r)}
              </span>
              <span className="home2-qowner" data-anon="mark">
                {ctx.ownerName(r.account)}
              </span>
              <span className="home2-qdepth">{runProductLabel(r.productName, r.marks.length)}</span>
              <CancelButton run={r} onChanged={onChanged} />
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

function LastFinished({
  row,
  ctx,
}: {
  readonly row: Finished
  readonly ctx: ShellContext
}) {
  // ONE LINE, and it links INTO Clearances. Everything a finished list would offer — threads, families,
  // filters, sort, paging — already exists there and is better; a second, worse copy here would only
  // teach people not to go.
  return (
    <>
      <div className="home2-done-band">
        <span className="home2-band-label faint">Last finished</span>
        <span className="home2-band-rule" />
      </div>
      <div className="home2-done" onClick={() => ctx.go(`/portal/result/${encodeURIComponent(row.runId)}`)}>
        <span className="home2-done-dot" style={row.tone ? { background: toneColor(row.tone) } : undefined} />
        <span className="home2-done-mark" data-anon="mark">
          {row.name}
        </span>
        {row.band ? <span className="home2-done-verdict">{row.band}</span> : null}
        <span className="home2-done-meta" data-anon="mark">
          · {ctx.ownerName(row.account)}
          {row.date ? ` · ${row.date}` : ''}
        </span>
        <span className="home2-done-spacer" />
        <button
          type="button"
          className="home2-all"
          onClick={(e) => {
            e.stopPropagation()
            ctx.go('/portal/clearances')
          }}
        >
          All clearances
          <Icon name="arrow-right" />
        </button>
      </div>
    </>
  )
}

function FirstRun({ onNew }: { readonly onNew: () => void }) {
  // Nothing has run. One sentence and the button — no empty card slots, no zeroes, and no section
  // headings standing over nothing.
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
