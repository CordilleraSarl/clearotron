// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Use your own AI — two questions, then one panel of steps that never moves.
//
// ── WHAT THIS REBUILD ANSWERS ────────────────────────────────────────────────────────────────────
//
// Observed by the owner on a hosted install: he did not see the small where-toggle, pressed Claude, was
// handed the on-this-computer block, and concluded the page could never work from his laptop. Nothing
// said the toggle changed the steps below it. The approved design answers that with two things this
// file is built around:
//
//   1. THE WHERE-CHOICE IS THE FIRST THING, AND IT IS BIG. Two cards, the same size before and after a
//      pick, and nothing below them until one is picked — so nobody reaches an app's steps without
//      having said where Clearotron is.
//   2. PRESSING AN APP SHOWS ITS STEPS; IT COPIES NOTHING. Step 1 is always the copy, with its own
//      button, so the reader sees what they are about to take before they take it.
//
// ── NOTHING ON THE PAGE MOVES WHEN A ROW OR A COPY BUTTON IS PRESSED ─────────────────────────────
//
// The owner met the page before last as "new links open and move shit around". The steps panel sits
// beside the list and holds ONE height per card — the tallest any app's steps reach, with every copy
// done — measured from a hidden copy of every panel rather than guessed, so switching apps or pressing
// Copy changes nothing around it. Any per-row expansion would move every row beneath it, so there is
// none.
//
// ── THIS SCREEN HOLDS NO CLIENT TABLE ────────────────────────────────────────────────────────────
//
// Every row, every step and every string a reader copies is resolved server-side through
// `shared/connect-clients.mjs`, and arrives here as data. Grouping is by the offer's own `route`. A
// static table here would be a second author for one fact — the drift that file documents and
// `connect-clients-are-data` refuses. A client id in a conditional on this file is a defect.
//
// AN UNSERVED ROW DOES NOT RENDER FOR A CLIENT AT ALL. On a hosted install the disk routes resolve
// unserved carrying "this copy of the software is incomplete… install it again" — the OPERATOR's case,
// which a lawyer once read as their software being broken. Filtering to served offers before anything
// reasons about routes is what keeps that wording off a reader's page.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ShellContext } from '../shell/AppShell.tsx'
import { api } from '../contract/api.ts'
import type { McpAccess, ConnectOffer, ConnectCopy } from '../contract/api.ts'
import { Icon } from '../components/Icon.tsx'

/** What the connected assistant can do. His words, four bullets, no jargon. Unchanged, per the brief. */
const WHAT_YOU_CAN_DO = [
  'Start a clearance and triage what comes back',
  'Watch it run, and add context while it is still early',
  'Interrogate the reasoning — not just the findings, the thinking behind them',
  'Ask what-if: why a finding was rated as it was, what changes if the goods narrow',
]

/** How long a pressed Copy keeps saying it copied. Long enough to be seen, short enough not to stick. */
const COPIED_MS = 2600

/**
 * THE TWO PLACES, in the reader's words, keyed by the offer's `route`. Two, never three: a third to
 * accommodate one vendor would be sorting by vendor again.
 */
const PLACES = ['disk', 'public-http'] as const
const WHERE: Record<(typeof PLACES)[number], { readonly label: string; readonly icon: string }> = {
  disk: { label: 'Clearotron is installed on this machine (laptop/desktop)', icon: 'laptop' },
  'public-http': { label: 'Clearotron is running elsewhere (e.g. Cloud/Server)', icon: 'server' },
}

/**
 * The owner-dictated help link. Its text names the document by what a person searching for it would
 * type, which is why it is the one place on the arriving page the six mechanism words may appear — the
 * browser check exempts exactly this string and nothing else.
 */
const HELP_URL = 'https://github.com/CordilleraSarl/clearotron/blob/main/mcp-server/CONNECT.md'
const HELP_LINK_TEXT = 'GitHub MCP Connector Documentation'

// A REFUSAL IS A VALUE, NEVER A SWALLOWED EXCEPTION. The one-time reveal below is reachable only if a
// blocked clipboard comes back as `false`; a bare `catch {}` here would tell a reader we had copied
// something we had not, and the credential would then be nowhere at all.
async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true }
  catch { return false }
}

/**
 * What landed on the clipboard, with the credential masked.
 *
 * PROOF IT HAPPENED, NOT THE SECRET ITSELF. The reader needs to know the press worked; showing them the
 * credential to prove it would put it in the DOM on the ordinary path, which is the one thing this page
 * has always refused. Enough to recognise, useless to copy.
 */
const mask = (key: string): string => (key.length > 3 ? `${key.slice(0, 3)}••••` : '••••')

type Secret = Extract<ConnectCopy, { kind: 'secret' }>

/** The one substitution this page performs: a value into the slot the server composed around it. */
const fill = (c: Secret, value: string): string => c.template.split(c.slot).join(value)

/**
 * A step's two marks, drawn: `**…**` names a control the reader looks for, a backtick pair a literal
 * they type or read back. Nothing else is interpreted, so a step can never carry markup the page trusts.
 */
function Marked({ text }: { readonly text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter((p) => p !== '')
  return (
    <>
      {parts.map((p, n) =>
        p.length > 4 && p.startsWith('**') && p.endsWith('**') ? <b key={n}>{p.slice(2, -2)}</b>
          : p.length > 2 && p.startsWith('`') && p.endsWith('`') ? <code key={n} className="ai-code">{p.slice(1, -1)}</code>
            : <span key={n}>{p}</span>)}
    </>
  )
}

/** What a press left behind, per step: which step flashed, and what one step's secret put on the clipboard. */
type PressState = {
  readonly copiedAt: number | null
  readonly landedAt: number | null
  readonly landed: string | null
  readonly revealedAt: number | null
  readonly revealed: string | null
}
const AT_REST: PressState = { copiedAt: null, landedAt: null, landed: null, revealedAt: null, revealed: null }

/**
 * One app's steps. `measuring` draws the TALLEST state — every secret already copied — for the hidden
 * copy the slot's height is taken from, and binds nothing.
 */
function StepsPanel({
  offer, measuring = false, state = AT_REST, onBlock, onSecret,
}: {
  readonly offer: ConnectOffer
  readonly measuring?: boolean
  readonly state?: PressState
  readonly onBlock?: (i: number, text: string) => void
  readonly onSecret?: (i: number, c: Secret) => void
}) {
  return (
    <div className="steps-panel" data-for={measuring ? undefined : offer.id}>
      <div className="eyebrow">Steps for</div>
      <h3 className="steps-name">{offer.name}</h3>
      <ol className="steps">
        {offer.steps.map((s, i) => {
          const c = s.copy
          const flashed = !measuring && state.copiedAt === i
          const landed = measuring && c?.kind === 'secret' ? fill(c, mask('')) : state.landedAt === i ? state.landed : null
          return (
            <li key={i}>
              <div>
                <div className="step-text"><Marked text={s.text} /></div>
                {c?.kind === 'block' ? (
                  <div className="codeblock">
                    <pre>{c.text}</pre>
                    <button
                      type="button"
                      className={`btn-ghost${flashed ? ' is-copied' : ''}`}
                      data-step={i}
                      tabIndex={measuring ? -1 : undefined}
                      onClick={() => onBlock?.(i, c.text)}
                    >{flashed ? '✓ Copied' : 'Copy'}</button>
                  </div>
                ) : null}
                {c?.kind === 'secret' ? (
                  <>
                    <div className="secret-btn">
                      <button
                        type="button"
                        className={`btn-primary${flashed ? ' is-copied' : ''}`}
                        data-step={i}
                        tabIndex={measuring ? -1 : undefined}
                        onClick={() => onSecret?.(i, c)}
                      >{flashed ? <><Icon name="check" size={15} />Copied</> : landed ? 'Copy again' : c.label}</button>
                    </div>
                    {landed ? (
                      <div className="landed">
                        <div className="landed-label">On your clipboard now</div>
                        {landed.split('\n').map((line, n) => <div key={n} className="mono">{line}</div>)}
                      </div>
                    ) : null}
                    {!measuring && state.revealedAt === i && state.revealed ? (
                      <div className="landed">
                        <p className="ai-said">
                          Your browser would not let us copy it. Copy this by hand — it is yours,
                          and it will not be shown again.
                        </p>
                        <pre className="ai-pre">{state.revealed}</pre>
                      </div>
                    ) : null}
                  </>
                ) : null}
                {s.hint ? <div className="step-hint"><Marked text={s.hint} /></div> : null}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/** The one honest unavailable, about the DEPLOYMENT rather than the reader, naming who can change it. */
function NotOnline() {
  return (
    <div className="notice ai-none">
      <strong>Not available on this installation yet</strong>
      <p>
        Your AI app reaches Clearotron over the internet, and this installation isn&rsquo;t on the internet
        yet. Whoever installed it can put it online — it takes about a minute and needs no account.
      </p>
    </div>
  )
}

export function UseYourAI({ ctx }: { readonly ctx: ShellContext }) {
  const [access, setAccess] = useState<McpAccess | null>(null)
  const [place, setPlace] = useState<string | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [copiedAt, setCopiedAt] = useState<number | null>(null)
  const [landedAt, setLandedAt] = useState<number | null>(null)
  const [landed, setLanded] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  // THE DEGRADED PATH, AND ONLY IT. A credential reaches the DOM in exactly one world — the browser
  // refused the clipboard — where the alternative is a reader with no way forward at all.
  const [revealedAt, setRevealedAt] = useState<number | null>(null)
  const [revealed, setRevealed] = useState<string | null>(null)
  const [slotHeight, setSlotHeight] = useState(0)
  const timer = useRef<number | null>(null)
  const probe = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    void api.mcpAccess().then((r) => { if (r.kind === 'ok') setAccess(r.value) })
  }, [ctx.owner])

  // The timeout outlives the component if a reader navigates away mid-confirmation.
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])

  const offers: readonly ConnectOffer[] = access?.offers ?? []
  // RULING 3, APPLIED TO THE DATA BEFORE ANYTHING REASONS ABOUT IT. Everything below sees served rows
  // only, so no later branch can render an unserved one by accident.
  const served = offers.filter((o) => o.served)
  const routes = PLACES.filter((p) => served.some((o) => o.route === p))
  // THE CARDS SHOW WHENEVER THIS INSTALL SERVES THE DISK ROUTE — which is to say, to the people who run
  // it. Both cards, always, even with no public address: the approved design puts the "not on the
  // internet yet" notice under the second card, so the person who can fix it learns why, where they
  // would look for it. A client is never handed the disk route, sees no cards, and gets the list.
  const asks = routes.includes('disk')
  const active = asks ? place : (routes[0] ?? null)
  const here = served.filter((o) => active !== null && o.route === active)
  const chosen = here.find((o) => o.id === picked) ?? null

  // THE SLOT'S HEIGHT IS MEASURED, NOT GUESSED: every panel on this card is drawn, hidden, at the slot's
  // own width, and the tallest wins. Re-measured when the width or the fonts change the answer.
  useLayoutEffect(() => {
    const el = probe.current
    if (!el) return
    const measure = () => setSlotHeight(Math.max(0, ...[...el.children].map((c) => (c as HTMLElement).offsetHeight)))
    measure()
    const seen = new ResizeObserver(measure)
    seen.observe(el)
    return () => seen.disconnect()
  }, [active, here.length])

  const settle = () => {
    setCopiedAt(null); setLandedAt(null); setLanded(null); setRevealedAt(null); setRevealed(null); setFailed(null)
  }
  const flash = (i: number) => {
    setCopiedAt(i)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopiedAt(null), COPIED_MS)
  }

  const copyBlock = async (i: number, text: string) => {
    setFailed(null)
    if (!(await copy(text))) {
      setFailed('Your browser would not let us copy it. Select the text above and copy it by hand.')
      return
    }
    flash(i)
  }

  const press = async (i: number, c: Secret) => {
    setFailed(null)
    setRevealedAt(null)
    setRevealed(null)
    // THE CREDENTIAL LIVES IN THIS FUNCTION AND NOWHERE ELSE: minted for the person pressing, put into
    // the line the server composed, handed to the clipboard, dropped when this call returns. Never in
    // state, never a prop, never rendered — except masked, and on the refused-clipboard path below.
    const r = await api.connectKey()
    if (r.kind !== 'ok') {
      setFailed('We could not set this up just now. Try again, or ask us.')
      return
    }
    if (!(await copy(fill(c, r.value.key)))) {
      setRevealedAt(i)
      setRevealed(fill(c, r.value.key))
      return
    }
    setLandedAt(i)
    setLanded(fill(c, mask(r.value.key)))
    flash(i)
  }

  return (
    <div className="screen ai-screen">
      <div className="eyebrow">Use your own AI</div>
      <h1 className="ai-title">Use your own AI</h1>
      <p className="ai-lead">
        Run and interrogate clearances from the assistant you already use — by voice, by email, or just
        by asking.
      </p>

      <section className="ctx-card ai-can">
        <h2>What you can do</h2>
        <ul className="ai-can-list">
          {WHAT_YOU_CAN_DO.map((line) => <li key={line}><Icon name="check" size={15} />{line}</li>)}
        </ul>
        <p className="ai-can-foot">Use the <strong>Ask AI</strong> button on a report.</p>
      </section>

      <section className="ai-connect">
        <h2 className="ai-connect-head">Connect it</h2>

        {!served.length ? <NotOnline /> : (
          <>
            {asks ? (
              <div className="where-grid" role="group" aria-label="Where Clearotron is running">
                {PLACES.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className="where-card"
                    data-place={p}
                    aria-pressed={p === active}
                    onClick={() => { if (p !== active) { setPlace(p); setPicked(null); settle() } }}
                  >
                    <span className={p === active ? 'radio radio-on' : 'radio'} aria-hidden="true" />
                    <Icon name={WHERE[p].icon} size={19} />
                    {WHERE[p].label}
                  </button>
                ))}
              </div>
            ) : null}

            {active === null ? null : !here.length ? <NotOnline /> : (
              <div className="ai-connect-grid">
                <div>
                  <h3 className="section-title">Select AI app</h3>
                  <div className="ai-apps">
                    {here.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        className={`pick-row ai-app${o.id === picked ? ' pick-row-on' : ''}`}
                        // THE ID, ON THE ELEMENT: a name is what a reader sees, not what a check selects by.
                        data-id={o.id}
                        aria-pressed={o.id === picked}
                        onClick={() => { if (o.id !== picked) { setPicked(o.id); settle() } }}
                      >
                        <span className={o.id === picked ? 'radio radio-on' : 'radio'} aria-hidden="true" />
                        <span className="ai-app-label">
                          <span className="ai-app-name">{o.name}</span>
                          {o.sub ? <span className="ai-app-sub">{o.sub}</span> : null}
                        </span>
                        <span className="ai-app-go"><Icon name="chevron" size={16} /></span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* THE RESERVED SLOT, and the hidden copy of every panel its height is taken from. */}
                <div className="ai-slot" aria-live="polite" style={slotHeight ? { minHeight: slotHeight } : undefined}>
                  {chosen ? (
                    <StepsPanel
                      offer={chosen}
                      state={{ copiedAt, landedAt, landed, revealedAt, revealed }}
                      onBlock={(i, text) => void copyBlock(i, text)}
                      onSecret={(i, c) => void press(i, c)}
                    />
                  ) : (
                    <div className="steps-panel steps-panel-empty">
                      <span className="steps-empty"><Icon name="arrow-left" size={16} />Select AI to see instructions</span>
                    </div>
                  )}
                  {failed ? <p className="ai-said ai-failed">{failed}</p> : null}
                  <div className="ai-probe" ref={probe} aria-hidden="true">
                    {here.map((o) => <StepsPanel key={o.id} offer={o} measuring />)}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {/* THE HELP, AS A QUIET NOTICE rather than a fold. It replaced a `<details>` whose link went to a
          portal route serving the same document; the document's public home is one a reader's own AI can
          open too, which is what "point your AI at it" asks for. */}
      <div className="notice quiet ai-help">
        <strong>If it doesn&rsquo;t connect</strong>
        <p>Point your AI at the full technical setup instructions to diagnose.</p>
        <p><a href={HELP_URL} target="_blank" rel="noreferrer">{HELP_LINK_TEXT} ↗</a></p>
      </div>
    </div>
  )
}
