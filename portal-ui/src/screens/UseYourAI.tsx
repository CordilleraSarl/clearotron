// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Use your own AI — one question, one list, one panel that never moves.
//
// ── WHAT WAS WRONG, AND THREE OF THE FIVE WERE MEASURED ──────────────────────────────────────────
//
// Owner, reviewing the live page: *"Claude desktop, cowork and claude and code? wtf??? you know its
// just ONE APP on a laptop which has cowork and code in it and claude is what its called and there is
// no such thing as desktop. Its also just a garbage design - new links open and move shit around. the
// 'copied text' is not obvious still - muted colours. And who is going to read THREE PARAGRAPHS OF
// TEXT... someone opens it, they want a SIMPLE way to triage wtf with terminology they need."*
//
// The first three were measured by running `connectOffers()` with exactly what
// `driver/portal-service.mjs` hands a hosted client — `stdioRoutes: {}` plus a resolved public address:
//
//   1. A HEALTHY HOSTED INSTALL TOLD A PAYING CLIENT THE SOFTWARE WAS BROKEN, THREE TIMES. The stdio
//      rows resolve `served: false` carrying "this copy of the software is incomplete… whoever installed
//      it will need to install it again." Nothing is incomplete. Those strings are the OPERATOR's case,
//      correct for somebody whose disk route is genuinely missing, reused for a reader who simply has no
//      shell. A lawyer opened this page and read that their software needed reinstalling. That was the
//      highest-value defect in the issue and it is the one this file's structure retires.
//   2. Eight buttons were eight labels on ONE action — every served row on a wired client resolves to
//      the same route, the same address and the same press, differing only in where the result is pasted.
//   3. The `other` row told a client to run a local command, and `command` is null for a client.
//
// ── THE FIX IS STRUCTURAL, WHICH IS WHY A RESTYLE WAS REJECTED ───────────────────────────────────
//
// Single-select plus a reserved slot IS the mechanism. One panel at a time, in a fixed position, so
// nothing above it moves on any press. Accordions cannot deliver that — any per-row expansion moves
// every row beneath it, which is what the owner met as "new links open and move shit around" — so they
// are gone rather than tuned.
//
// THE PAGE ASKS AS MANY QUESTIONS AS THE DEPLOYMENT LEAVES OPEN, never a fixed number:
//
//   hosted client   one route served     NO question    destination list, one press
//   staff, wired    both routes served   ONE question   where does your assistant run?
//   staff, local    one route served     NO question    destination list, command route
//   nothing served  —                    NO question    one deployment-level sentence, no control
//
// Grouping is by the offer's own `route`, which is already on the wire. THIS SCREEN HOLDS NO CLIENT
// TABLE AND NO GROUPING TABLE. A static grouping here would be a second author for one fact — the drift
// `shared/connect-clients.mjs` documents twice and `connect-clients-are-data` refuses. A grep for a
// client id in a conditional on this file is a defect, not a shortcut.
//
// ── AN UNSERVED ROW DOES NOT RENDER FOR A CLIENT AT ALL ──────────────────────────────────────────
//
// Owner ruling: not as a button, not as a sentence. That is what retires defect 1 — the operator-shaped
// wording stays correct for an operator, and a client never reaches it because a client never sees the
// row. The one honest deployment-level absence survives: when nothing at all is served, the page says so
// once, in words, and offers no control. An absence that names nobody reads as breakage.

import { useEffect, useRef, useState } from 'react'
import type { ShellContext } from '../shell/AppShell.tsx'
import { api } from '../contract/api.ts'
import type { McpAccess, ConnectOffer } from '../contract/api.ts'

/** What the connected assistant can do. His words, four bullets, no jargon. Unchanged, per the brief. */
const WHAT_YOU_CAN_DO = [
  'Start a clearance and triage what comes back',
  'Watch it run, and add context while it is still early',
  'Interrogate the reasoning — not just the findings, the thinking behind them',
  'Ask what-if: why a finding was rated as it was, what changes if the goods narrow',
]

/** How long the pressed row keeps saying it copied. Long enough to be seen, short enough not to stick. */
const COPIED_MS = 2600

/**
 * THE TWO PLACES AN ASSISTANT CAN RUN, in the reader's terms rather than the product's.
 *
 * Keyed by the offer's `route`, which the resolver already decided. TWO, never three — the owner ruled
 * two, and a third group added to accommodate a vendor would be sorting by vendor again, which is the
 * shape this page was rebuilt to remove.
 */
const WHERE: Record<string, string> = {
  disk: 'On this computer',
  'public-http': 'Somewhere else',
}

/**
 * `either` IS NOT A THIRD PLACE, AND MUST NOT BECOME A THIRD SEGMENT.
 *
 * The generic row — an assistant we do not have a table entry for — resolves `route: "either"` because
 * it can take a command OR an address. That is a statement about what it ACCEPTS, not about where it
 * runs, and the reader's question is where it runs.
 *
 * Treating it as its own route produced a defect a reader meets rather than an arm: on a staff deck it
 * rendered a SECOND segment also labelled "On this computer", because `either` was mapped to the same
 * words as `disk`. The question was answered twice, identically, and pressing the wrong one silently
 * changed what got copied. Found by role-e2e driving the staff decks.
 *
 * A distinct label would be the wrong fix — the owner ruled TWO groups and a third to accommodate one
 * row is sorting by vendor again. So an `either` offer belongs to BOTH groups: whichever place the
 * reader says their assistant runs, this row can serve it.
 */
const EITHER = 'either'
const placesOf = (offers: readonly ConnectOffer[]): readonly string[] => {
  const named = [...new Set(offers.map((o) => o.route ?? 'public-http'))].filter((r) => r !== EITHER)
  // Only generic rows served: it can go either way, so ask nothing and lead with the route that needs
  // nothing. Asking a question whose two answers offer the identical row is worse than not asking.
  return named.length ? named : (offers.length ? ['disk'] : [])
}
const servesPlace = (o: ConnectOffer, place: string): boolean => {
  const r = o.route ?? 'public-http'
  return r === place || r === EITHER
}

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

/**
 * One destination row. THE PRESSED CONTROL IS THE CONFIRMATION — the owner reported the previous
 * feedback as "not obvious still - muted colours", so this is a state change on the thing he pressed.
 *
 * THE LABEL'S SLOT IS RESERVED IN EVERY ROW, ALWAYS, not only while copied. Swapping "Paste it into
 * Claude" for "✓ Copied" at natural width would resize the row and shift its neighbours — the reflow
 * this rebuild exists to end, arriving through the fix for it. Both labels are always laid out; one is
 * hidden.
 */
function Destination({
  offer, selected, copied, onPick,
}: {
  readonly offer: ConnectOffer
  readonly selected: boolean
  readonly copied: boolean
  readonly onPick: () => void
}) {
  return (
    <button
      type="button"
      className="ai-dest"
      // ONE SOURCE for the state a check reads and the state the CSS paints, so a green assertion and a
      // green-looking row cannot disagree with each other.
      // THE ID, ON THE ELEMENT. One product can legitimately appear under one name on two routes, so a
      // name is not an identifier here and anything selecting by one picks whichever came first.
      data-id={offer.id}
      data-selected={selected ? '' : undefined}
      data-copied={copied ? '' : undefined}
      aria-pressed={selected}
      onClick={onPick}
    >
      <span className="ai-dest-name">
        {offer.name}
        {offer.sub ? <span className="ai-dest-sub">{offer.sub}</span> : null}
      </span>
      <span className="ai-dest-say">
        <span className="ai-dest-idle">Paste it into {offer.name}</span>
        <span className="ai-dest-done">✓ Copied</span>
      </span>
    </button>
  )
}

/** The panel. ONE, in a slot with a reserved minimum height, below everything it could otherwise push. */
function Panel({ offer, landed }: { readonly offer: ConnectOffer; readonly landed: string | null }) {
  return (
    <div className="ai-panel" data-for={offer.id}>
      <h3 className="ai-panel-head">Paste it into {offer.name}</h3>
      {landed ? (
        <p className="ai-panel-landed">On your clipboard now: <code className="mono">{landed}</code></p>
      ) : null}
      {offer.steps.length ? (
        <ol className="ai-panel-steps">
          {offer.steps.map((line) => <li key={line}>{line}</li>)}
        </ol>
      ) : null}
      {/* A DRIVEN ROW SAYS WHEN; AN UNDRIVEN ONE SAYS SO IN WORDS AND CARRIES NO DATE. `verifiedOn` rides
          only where the resolver's row has it, so a stamp cannot appear over steps nobody opened. */}
      {offer.verifiedOn ? (
        <p className="ai-panel-stamp">✓ Checked {offer.verifiedOn} — these are the taps this app actually has today.</p>
      ) : (
        <p className="ai-panel-stamp ai-panel-stamp-none">
          These steps name no button we have not opened ourselves. Your app may word them differently.
        </p>
      )}
    </div>
  )
}

export function UseYourAI({ ctx }: { readonly ctx: ShellContext }) {
  const [access, setAccess] = useState<McpAccess | null>(null)
  const [route, setRoute] = useState<string | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [landed, setLanded] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  // THE DEGRADED PATH, AND ONLY IT. A credential reaches the DOM in exactly one world — the browser
  // refused the clipboard — where the alternative is a reader with no way forward at all.
  const [revealed, setRevealed] = useState<{ address: string; key: string } | null>(null)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    void api.mcpAccess().then((r) => { if (r.kind === 'ok') setAccess(r.value) })
  }, [ctx.owner])

  // The timeout outlives the component if a reader navigates away mid-confirmation.
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])

  const offers: readonly ConnectOffer[] = access?.offers ?? []
  // RULING 3, APPLIED TO THE DATA BEFORE ANYTHING REASONS ABOUT IT. Everything below sees served rows
  // only, so no later branch can render an unserved one by accident.
  const served = offers.filter((o) => o.served)
  const routes = placesOf(served)
  // The route that needs nothing leads, where this deployment has it.
  const active = route ?? (routes.includes('disk') ? 'disk' : routes[0] ?? null)
  const here = served.filter((o) => active !== null && servesPlace(o, active))
  const chosen = here.find((o) => o.id === picked) ?? null

  const press = async (offer: ConnectOffer) => {
    setPicked(offer.id)
    setFailed(null)
    setRevealed(null)
    setLanded(null)

    // A local route: the line is a command with no secret in it, so it never needs the server.
    if (offer.command) {
      if (!(await copy(offer.command))) {
        setFailed('Your browser would not let us copy it. The steps below still apply.')
        return
      }
      setLanded(offer.command)
    } else {
      // THE CREDENTIAL LIVES IN THIS FUNCTION AND NOWHERE ELSE: minted for the person pressing, handed
      // to the clipboard, dropped when this call returns. Never in state, never a prop, never rendered —
      // except on the refused-clipboard path below.
      const r = await api.connectKey()
      if (r.kind !== 'ok') {
        setFailed('We could not set this up just now. Try again, or ask us.')
        return
      }
      if (!(await copy(`${r.value.address}\n${r.value.key}`))) {
        setRevealed({ address: r.value.address, key: r.value.key })
        return
      }
      setLanded(`${r.value.address}  ${mask(r.value.key)}`)
    }

    setCopiedId(offer.id)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopiedId(null), COPIED_MS)
  }

  return (
    <div className="screen ai-screen">
      <h1 className="ai-title">Use your own AI</h1>
      <p className="ai-lead">
        Run and interrogate clearances from the assistant you already use — by voice, by email, or just
        by asking.
      </p>

      <section className="ai-can">
        <h2>What you can do</h2>
        <ul>
          {WHAT_YOU_CAN_DO.map((line) => <li key={line}>{line}</li>)}
        </ul>
        {/* THE BOUNDARY PARAGRAPH IS CUT (owner ruling — of the three paragraphs he would not read, it
            was the one he had never approved). Its job, saying what this reaches, survives as the bolded
            half of one sentence. */}
        <p className="ai-can-foot">
          Every report also has an <strong>Ask AI</strong> button that jumps straight to that run.{' '}
          <strong>What you set up here reaches your own clearances and nothing else.</strong>
        </p>
      </section>

      <h2 className="ai-connect-head">Connect it</h2>

      {!served.length ? (
        /* THE ONE HONEST UNAVAILABLE, and it is about the DEPLOYMENT rather than the reader. It names
           who can change it: an absence naming nobody reads as breakage. */
        <p className="ai-none">
          <strong>Not available on this installation yet.</strong> Your assistants reach this service over
          the internet, and this installation is not on the internet. Whoever installed it can put it
          online — it takes about a minute and needs no account.
        </p>
      ) : (
        <>
          {routes.length > 1 ? (
            <div className="ai-where">
              <h3 className="ai-where-q">Where does your assistant run?</h3>
              <div className="ai-seg" role="group" aria-label="Where does your assistant run?">
                {routes.map((r) => (
                  <button
                    key={r}
                    type="button"
                    className="ai-seg-btn"
                    data-on={r === active ? '' : undefined}
                    aria-pressed={r === active}
                    onClick={() => { setRoute(r); setPicked(null); setLanded(null); setRevealed(null); setFailed(null) }}
                  >{WHERE[r] ?? WHERE['public-http']}</button>
                ))}
              </div>
              <p className="ai-where-sub">
                Pick your assistant. We copy the one line it needs — nothing to sign up for, nothing
                opened up.
              </p>
            </div>
          ) : (
            <p className="ai-where-sub">
              Pick where you will paste it. One press copies everything your assistant needs.
            </p>
          )}

          <div className="ai-dests">
            {here.map((o) => (
              <Destination
                key={o.id}
                offer={o}
                selected={o.id === picked}
                copied={o.id === copiedId}
                onPick={() => void press(o)}
              />
            ))}
          </div>

          {/* THE RESERVED SLOT. It holds a minimum height whether or not anything is in it, so picking a
              destination cannot move one pixel above this line. */}
          <div className="ai-slot" aria-live="polite">
            {failed ? <p className="ai-said">{failed}</p> : null}
            {revealed ? (
              <div className="ai-panel">
                <p className="ai-said">
                  Your browser would not let us copy it. Paste these two lines into{' '}
                  {chosen?.name ?? 'your assistant'} — they are yours, and they will not be shown again.
                </p>
                <pre className="ai-pre">{revealed.address}{'\n'}{revealed.key}</pre>
              </div>
            ) : chosen ? (
              <Panel offer={chosen} landed={landed} />
            ) : (
              <p className="ai-slot-empty">
                Pick your assistant and we will copy what it needs, then show you exactly where it goes.
              </p>
            )}
          </div>
        </>
      )}

      {/* KEPT, and a named dependency rather than a leftover: the link serves the engineer and the
          assistant-reading-on-your-behalf case, and the ruling says it does not get cut. A `<details>`
          because nothing may be expanded on arrival — its text stays out of an arriving reader's
          innerText, which is what the browser check reads. */}
      <details className="ai-help">
        <summary>Not connecting, or want to set it up yourself?</summary>
        <div className="ai-help-body">
          <p>
            Press the button for your assistant and it will tell you the next thing to do — usually
            three taps inside that app&rsquo;s own settings. If your assistant is not listed, pick
            <strong> Another agent</strong>: it will give you both of the things any assistant can take.
          </p>
          <p>
            Once it is connected, you do not have to learn anything new. Ask it in your own words —
            <em> &ldquo;start a knockout for our new drinks name across the US&rdquo;</em>, or
            <em> &ldquo;why did you rate that one high?&rdquo;</em> — and it will do the same work you
            would do on these screens.
          </p>
          {/* KEPT VERBATIM. Approved copy line 14 is "the existing fold and its link to the full technical
              instructions, KEPT", and this paragraph is part of that fold. I had dropped it while
              rewriting the page around it — an unsanctioned deletion of client-facing copy, which is the
              exact class of change the sign-off criterion on this issue exists for. Restored to main's
              wording, character for character. */}
          <p>
            If a press does not finish, the most common reason is that your assistant runs somewhere
            this service cannot be reached from. The team who set this up can tell you in a sentence.
          </p>
          <p className="ai-help-doc">
            <a href="/portal/connect-help" target="_blank" rel="noreferrer">The full technical
            instructions</a> — written for an engineer, or for an assistant reading on your behalf.
          </p>
        </div>
      </details>
    </div>
  )
}
