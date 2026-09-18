// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Ask AI — one press opens the reader's own assistant with a question about one report typed in.
//
// THE DEFECT THE OWNER WATCHED. A lawyer pressed this, read a panel holding two monospace strings with a
// link each to take them — a question carrying a full run code, and a connector address — dismissed it,
// and went to Claude to type a question by hand. Nothing said which string was needed or where it went.
// The address is needed once, when an assistant is first connected, and the Connect your AI page hands it
// out with steps per app; on a report it was shown every time, to everybody.
//
// ONE COMPONENT, BECAUSE MORE THAN ONE SCREEN OPENS IT. A report's header carries it and so can a row on a
// list of finished clearances, and a reader must meet the same panel from both. So it holds the whole
// control — the button, both panels, the way past the measurement, and the note "Set it up" leaves — and
// the pure half of it (the questions, the link, the note itself) lives in `contract/askAi.ts`.
//
// THE CALLER LOADS WHAT THIS DEPLOYMENT ANSWERED, ONCE. `access` is a prop and never a request made here: a
// list drawing this on fifty rows would otherwise ask the same question fifty times, and
// `scripts/revisit-render-check.mjs` counts what a screen asks per visit. Null means "not answered yet",
// and nothing is drawn until it has been.
//
// THREE STATES, AND THE THIRD IS THE ONE THAT IS EASY TO GET WRONG.
//   · Connected — a panel naming the report, four questions with the first selected, one button that opens
//     the assistant, and a line saying the question is typed in and not sent.
//   · Never connected — a panel: what to do once, and a way past it for anyone the log has not caught up
//     with. A reader whose connector state could not be measured lands here too, deliberately: see
//     `askAiOffer`. Offering the questions instead would open an assistant that cannot see this report,
//     which is the dead end this control exists to end.
//   · No connector on this installation — nothing is drawn. A button that can do nothing is not a button,
//     and a panel explaining the absence was turned down.
//
// NO ADDRESS HERE, IN ANY STATE. The band is stripped from client reports precisely because it names the
// staff host; a control the shell draws itself that re-introduced an address would defeat that strip
// rather than complete it.

import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { McpAccess } from '../contract/api.ts'
import { Icon } from './Icon.tsx'
import {
  AI_SETUP_FROM_REPORT, ASK_AI_OPENS, ASK_AI_QUESTIONS, askAiHeading, askAiOffer, askAiQuestion, openLabel, rememberReport,
} from '../contract/askAi.ts'
import type { RunKind } from '../contract/askAi.ts'

export type AskAiProps = {
  /** The run the questions are about. With `markSlug`, where "Set it up" leaves a way back to. */
  readonly runId: string
  /** One name out of a batch, when the report open is one name's document. */
  readonly markSlug?: string | null
  readonly markName: string | null
  /** The run's own day, `YYYY-MM-DD` — the date the report was searched. */
  readonly date: string | null
  readonly kind: RunKind
  /** The product as the caller labels it, for the panel's first line. Null leaves it out. */
  readonly productName: string | null
  /** This deployment's answer, loaded once by the caller. Null until it has answered. */
  readonly access: McpAccess | null
  readonly go: (path: string) => void
  /** A quieter button, for a place where the primary action beside it is another button. */
  readonly quiet?: boolean
  /** Open the panel as the control first appears — a reader sent here to ask. */
  readonly openOnArrival?: boolean
  /**
   * Drawn with no button of its own, open from the first frame, for a caller whose own control opens it —
   * the Clearances row menu, whose "Ask AI" entry is where that row's control lives now (owner,
   * 2026-09-18). `onClose` is how that caller learns the panel has gone, so it can stop drawing it.
   */
  readonly hideButton?: boolean
  readonly onClose?: (() => void) | undefined
  /**
   * A press on a finding's own "Ask AI about this finding" inside the report. Each press is a new object
   * (the nonce), so pressing the same finding twice opens the panel twice. `ordinal` is the number the
   * report prints on that card, null for a card that has none; `markName` is the name the finding belongs
   * to when that differs from the run's, as it does for one name of a knockout batch.
   */
  readonly fromFinding?: { readonly ordinal: number | null; readonly markName: string | null; readonly nonce: number } | null
}

export function AskAi({
  runId, markSlug = null, markName, date, kind, productName, access, go, quiet = false, openOnArrival = false,
  fromFinding = null, hideButton = false, onClose,
}: AskAiProps) {
  const [open, setOpen] = useState(openOnArrival)
  // WHICH FINDING THE PANEL IS ABOUT, if any. Set by a press inside the report and cleared by the header's
  // own button, which is about the whole report — the same panel, reached two ways, never mixing them.
  const [about, setAbout] = useState<{ readonly ordinal: number | null; readonly markName: string | null } | null>(null)
  // Set by "Already connected? Ask anyway", and only for as long as this control is mounted. It is an
  // escape from a measurement that may be behind, not a preference, so nothing is stored.
  const [askAnyway, setAskAnyway] = useState(false)
  const [picked, setPicked] = useState(0)
  const box = useRef<HTMLDivElement | null>(null)
  const rows = useRef<(HTMLButtonElement | null)[]>([])
  const asked = about?.markName ?? markName
  const run = { markName: asked, date, kind, finding: about?.ordinal ?? null }
  const offer = askAiOffer({ markName, date, kind }, access)

  // A PRESS ON A FINDING OPENS THIS PANEL, connected or not — the not-connected form is unchanged — with the
  // first question selected, as the header's button opens it.
  useEffect(() => {
    if (!fromFinding) return
    setAbout({ ordinal: fromFinding.ordinal, markName: fromFinding.markName })
    setPicked(0)
    setOpen(true)
  }, [fromFinding])

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // THE CALLER LEARNS THE PANEL HAS CLOSED, whichever way it closed — outside press, Escape, a question
  // asked, or "Set it up" leaving the screen. Without it a menu that opened this could not be pressed twice.
  useEffect(() => { if (!open && hideButton) onClose?.() }, [open])

  if (!offer.drawn) return null

  const asking = offer.connected || askAnyway
  const heading = askAiHeading({ markName: asked, productName, date, finding: about?.ordinal ?? null })

  // A new tab, and the question is typed in rather than sent — the reader still reads it before it goes.
  const ask = () => {
    setOpen(false)
    window.open(ASK_AI_OPENS.href(askAiQuestion(picked, run)), '_blank', 'noopener,noreferrer')
  }

  // THE NOTE COMES FIRST, THEN THE PAGE. Connect your AI offers the way back only when it finds one, and
  // a note that fails to write costs the reader that button and nothing else.
  const setUp = () => {
    rememberReport({ runId, markSlug, mark: markName?.trim() || null })
    setOpen(false)
    go(AI_SETUP_FROM_REPORT)
  }

  // ARROW KEYS MOVE THE CHOICE, the way a radio group answers them; Tab leaves the group from the choice.
  const onArrow = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = (picked + step + ASK_AI_QUESTIONS.length) % ASK_AI_QUESTIONS.length
    setPicked(next)
    rows.current[next]?.focus()
  }

  const parts = [
    heading.mark ? <span key="mark" data-anon="mark">{heading.mark}</span> : null,
    heading.finding !== null ? <span key="finding">finding {heading.finding}</span> : null,
    heading.product ? <span key="product">{heading.product}</span> : null,
    heading.searched ? <span key="searched" className="ask-ai-when">searched <span className="mono">{heading.searched}</span></span> : null,
  ].filter((p) => p !== null)

  return (
    <div ref={box} className="ask-ai" data-ask-ai={asking ? 'ask' : 'connect'}>
      {hideButton ? null : (
      <button
        type="button"
        className={quiet ? 'btn-ghost ask-ai-btn is-quiet' : 'btn-ghost ask-ai-btn'}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => { setAbout(null); setOpen((v) => !v) }}
      >
        <Icon name="sparkles" size={14} />
        <span>Ask AI</span>
      </button>
      )}
      {open && asking ? (
        <div className="float ask-ai-float ask-ai-panel" role="dialog" aria-label="Ask AI">
          <div className="ask-ai-head">
            {parts.map((p, i) => <span key={i}>{i ? ' · ' : ''}{p}</span>)}
          </div>
          <div className="ask-ai-choices" role="radiogroup" aria-label="What to ask" onKeyDown={onArrow}>
            {ASK_AI_QUESTIONS.map((q, i) => (
              <button
                key={q.label}
                ref={(el) => { rows.current[i] = el }}
                type="button"
                role="radio"
                aria-checked={i === picked}
                tabIndex={i === picked ? 0 : -1}
                className="nav-item ask-ai-choice"
                onClick={() => setPicked(i)}
              >
                <span className={i === picked ? 'radio radio-on' : 'radio'} aria-hidden="true" />
                <span>{q.label}</span>
              </button>
            ))}
          </div>
          <button type="button" className="btn-primary ask-ai-go" onClick={ask}>
            <span>{openLabel(ASK_AI_OPENS)}</span>
            <Icon name="arrow-right" size={14} />
          </button>
          <p className="ask-ai-note">The question is typed into your assistant; press send there.</p>
        </div>
      ) : null}
      {open && !asking ? (
        <div
          className="float ask-ai-float"
          role="dialog"
          aria-label="Connect your AI first"
          style={{ width: 276, padding: 12, display: 'grid', gap: 9 }}
        >
          <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-strong)' }}>Connect your AI first</div>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Connect Claude or ChatGPT once. After that, this button opens it with a question about this report typed in.
          </p>
          <button
            type="button"
            className="btn-primary"
            style={{ fontSize: 13, padding: '6px 11px', justifySelf: 'start', display: 'inline-flex', alignItems: 'center', gap: 6 }}
            onClick={setUp}
          >
            Set it up <Icon name="arrow-right" size={14} />
          </button>
          {/* THE ESCAPE FROM A MEASUREMENT THAT CAN BE BEHIND. "Connected" is read off the tail of the
              connector's access log, so a reader who connected long enough ago to have fallen out of
              that window — or one on an installation whose log could not be read at all — lands here
              wrongly. One press puts them where they should have been, and costs them nothing. */}
          <button type="button" className="link-btn" style={{ fontSize: 12.5, justifySelf: 'start' }} onClick={() => setAskAnyway(true)}>
            Already connected? Ask anyway
          </button>
        </div>
      ) : null}
    </div>
  )
}
