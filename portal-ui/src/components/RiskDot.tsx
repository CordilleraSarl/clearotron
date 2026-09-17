// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The risk dot and its label.
//
// Everything about how this renders comes from `tone`; `label` is text to display and nothing else. The
// component has no map from words to colours, which is what makes it correct for a customer whose
// framework says "Moderate" and for one whose framework says "Medium", without knowing either exists.
//
// A run that has no tone is a run that was not rated against a ladder (every run archived before doc-50).
// It shows its label uncoloured rather than being coloured by a guess.

import type { RunState } from '../contract/api.ts'
import { readableFailure } from '../contract/failure.ts'
import type { Tone } from '../contract/tone.ts'
import { toneColor } from '../contract/tone.ts'
import { STOPPED_LINE } from '../contract/nameRow.ts'

export function RiskDot({ tone, label }: { readonly tone: Tone | null; readonly label: string | null }) {
  if (!label) return <span style={{ color: 'var(--text-faint)' }}>—</span>
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
      <span
        className="dot"
        style={tone ? { background: toneColor(tone) } : { border: '2px solid var(--text-faint)' }}
      />
      <span style={{ fontWeight: 600 }}>{label}</span>
    </span>
  )
}

/**
 * The status of a run in flight.
 *
 * `failed` is a first-class state here, and it carries its reason. A failed run that renders as a blank
 * row, or worse as "Finished", is a run whose owner has to ask somebody what happened — and the reason
 * exists in status.json on every failure path, so there is no excuse for hiding it.
 */
/**
 * "resumes at 14:20" / "resumes tomorrow at 09:05" — a clock, never a countdown.
 *
 * A countdown would have to keep ticking to stay true, and a stale one on a polled list is a lie that
 * looks precise. An unparseable stamp degrades to no time at all rather than to "Invalid Date".
 */
function resumeWording(iso: string): string {
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return 'on its own'
  const time = t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
  const sameDay = t.toDateString() === new Date().toDateString()
  return sameDay ? `at ${time}` : `${t.toLocaleDateString([], { weekday: 'long' })} at ${time}`
}

export function StatusCell({
  state,
  step,
  reason,
  failedStage,
  pausedKind = null,
  resetsAt = null,
  stopRequestedAt = null,
  detailed = false,
  count = null,
}: {
  readonly state: RunState
  readonly step: string | null
  readonly reason: string | null
  readonly failedStage: string | null
  readonly pausedKind?: 'rate-limit' | 'recovering' | 'operator' | null
  readonly resetsAt?: string | null
  /** A stop has been asked for; the step in flight is finishing. */
  readonly stopRequestedAt?: string | null
  /**
   * Show the engine's own words behind a disclosure. ONE row per clearance carries this — the
   * expanded read, where you are looking at that specific run. The parent row states the status and
   * stops, which is what "the failure description appears once per row, not twice" means.
   */
  readonly detailed?: boolean
  /**
   * How many searches are under way, when the row also shows a completed report: "Queued · 1 search".
   * It tells the search in flight apart from the assessment one cell over. Absent, the word stands alone.
   */
  readonly count?: string | null
}) {
  // ── Stopping… — before the state checks, because it overlays a run that still truthfully says
  // "running" or "paused". The owner pressed Stop, saw the row unchanged, and
  // pressed again. The word is the acknowledgment; the sub names the wait — what is finishing and why
  // it is allowed to — because that is the answer to "why is this taking so long". The terminal
  // replaces the pair the moment the run is actually down.
  if (stopRequestedAt && state !== 'delivered' && state !== 'failed' && state !== 'cancelled') {
    return (
      <span>
        <span className="status">
          <span className="dot" style={{ background: 'var(--text-faint)' }} />
          Stopping…
        </span>
        <span className="sub">
          {step ? `Letting “${step}” finish — a reasoning step can take tens of minutes.` : 'Letting the step in flight finish — a reasoning step can take tens of minutes.'}
          {' '}Nothing further will start.
        </span>
      </span>
    )
  }
  if (state === 'delivered') {
    return (
      <span className="status">
        <span className="dot" style={{ background: 'var(--text-muted)' }} />
        Finished
      </span>
    )
  }

  // Stopped on purpose. It sits between Finished and Not finished and is neither: a muted dot rather
  // than the failure tone, and no reason — there is no fault to report. The line beneath says what the
  // stop leaves: no report, and the finished steps still readable. "Nothing was delivered" was true and
  // left the reader holding only the loss.
  //
  // EVERY DOT IN THIS CELL IS NEUTRAL. The status is carried by its words and the dot's shape — a disc,
  // a ring for queued, a pulse for running — and colour on this list belongs to the Risk column beside it.
  if (state === 'cancelled') {
    return (
      <span>
        <span className="status">
          <span className="dot" style={{ background: 'var(--text-faint)' }} />
          Stopped
        </span>
        <span className="sub">{STOPPED_LINE}</span>
      </span>
    )
  }

  if (state === 'failed') {
    // — a STATUS, not the engine's raw string. This used to render `Stopped at <stage id>. ` plus
    // whatever the pipeline threw, which on a real run was a temp directory, a run slug, a file path, an
    // error enum and three search queries — on the page a client or a partner lands on, twice per row,
    // and sized to hold it at 47% of the table.
    //
    // The engine's own words are not deleted, they are MOVED: `detailed` rows carry a disclosure holding
    // the raw value, so a lawyer can act on the status and an engineer still reaches the detail in one
    // click. Only the read row is `detailed`; the parent row states the status once. That is the issue's
    // "once per row, not twice".
    const f = readableFailure(failedStage, reason)
    return (
      <span>
        <span className="status failed">
          <span className="dot" style={{ background: 'var(--text-muted)' }} />
          {f.headline}
        </span>
        {f.detail ? <span className="sub">{f.detail}</span> : null}
        {detailed && f.raw ? (
          <details className="sub" style={{ marginTop: 2 }}>
            <summary style={{ cursor: 'pointer' }}>Details</summary>
            {/* The engine's own words, never paraphrased — and never on the collapsed row. `pre-wrap`
                with `anywhere`: this string has no spaces for hundreds of characters, and letting it
                run is what forced a horizontal scrollbar on the whole table. */}
            <span className="mono" style={{ display: 'block', marginTop: 4, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 11.5 }}>
              {f.raw}
            </span>
          </details>
        ) : null}
      </span>
    )
  }

  const label = state === 'queued' ? 'Queued' : state === 'paused' ? 'Paused' : 'Running'
  // Three pauses, one word. They differ only in the reason line: a provider cap resumes at a stated
  // time (the only clock this system possesses); a retry backs off on its own; and a system restart
  // (a deploy caught the run mid-flight) resumes on the next pass. None of them needs anything from
  // the person reading this, and the copy must never imply otherwise.
  const detail =
    state === 'paused'
      ? pausedKind === 'recovering'
        ? 'Held after a problem — retrying on its own'
        : pausedKind === 'operator'
          ? 'Paused by a system restart — resumes on its own'
          : resetsAt
            ? `Paused by a provider limit — resumes ${resumeWording(resetsAt)}`
            : 'Paused by a provider limit — resumes on its own'
      // THE STEP, AND NOT A COUNT OF STEPS. This read "Register sweeps · 3 of 9". The approved design
      // draws the step alone, and the count was the part that could not be honest: the denominator is
      // how many steps this run's plan happens to have, so the same search reads 3 of 9 and 3 of 6 on
      // two accounts, and a reader takes it for a fraction of the work done. The run's own step count
      // is still on the wire and Home still draws it as a row of pips, where it is a position and not
      // a proportion.
      : step

  return (
    <span>
      <span className="status">
        <span className={`dot ${state}`} />
        {/* ONE flex item, not three: `.status` is a flex row, and a word, a separator and a count as
            separate items would each wrap on their own — the separator stranded on a line of its own. */}
        {count ? <span>{label} · <span className="status-count">{count}</span></span> : label}
      </span>
      {detail ? <span className="sub">{detail}</span> : null}
    </span>
  )
}
