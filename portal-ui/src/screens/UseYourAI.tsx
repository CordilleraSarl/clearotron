// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Use your own AI — four buttons, four bullets, and nothing else.
//
// ── THE RULING THIS PAGE IS (owner, 2026-08-31) ──────────────────────────────────────────────────
//
// *"I want the copy and page to be AS SIMPLE AS POSSIBLE. there is NO PLACE for ANYTHING technical on
// there. it should literally be Connect your x buttons - that JUST WORK - or open further help if
// necessary. the SUPER BASIC list of what you can do with it copy that i provided (they are literally
// 4-5 bullet points). and thats basically it. maybe a reference to where to find further info. it
// should be ruthlessly cut."*
//
// The page this replaces was 496 lines and said "address" 47 times, "key" 31, and named the connector
// protocol 12 times. None of those words appear here. That is not a style preference: a reader
// connecting their own assistant is not choosing a transport or a scope, and every one of those words
// was asking them to understand something the product should be deciding for them.
//
// ── WHAT A BUTTON IS ─────────────────────────────────────────────────────────────────────────────
//
// A button is a button. One press, no expansion, nothing revealed. It expands ONLY when the press
// cannot finish on its own, and then it opens with the MINIMUM needed — the one line to run, or the one
// sentence saying what is missing. Never the recipe from the beginning: the per-assistant setup blocks
// this page used to carry were cut, deliberately, and must not creep back in as an accordion.
//
// A BUTTON THAT CANNOT WORK IS NOT SHOWN AS A BUTTON. It reads as unavailable, with one plain sentence
// on why and what would change it. An absence with no reason reads as breakage — that is the defect
// closed on the knockout's Export menu, and the defect this page had for every self-hosted reader.
//
// ── WHERE THE ANSWERS COME FROM ──────────────────────────────────────────────────────────────────
//
// `/portal/api/mcp-access` resolves every assistant server-side through `shared/connect-clients.mjs`
// and hands this page the answers. This screen holds NO client table and derives NOTHING. The version
// before it held its own table on its own axis, and the two drifted before either shipped: this page
// said Codex needs an address that is null on a local install, so it named a one-line command in its
// own instructions and then rendered no command — 's defect, living inside the page
// written to answer it. The install's own filesystem path is not a browser fact, so a derivation that
// needs it cannot live here honestly.

import { useEffect, useState } from 'react'
import type { ShellContext } from '../shell/AppShell.tsx'
import { api } from '../contract/api.ts'
import type { McpAccess, ConnectOffer } from '../contract/api.ts'

/** What the connected assistant can do. His words, four bullets, no jargon. */
const WHAT_YOU_CAN_DO = [
  'Start a clearance and triage what comes back',
  'Watch it run, and add context while it is still early',
  'Interrogate the reasoning — not just the findings, the thinking behind them',
  'Ask what-if: why a finding was rated as it was, what changes if the goods narrow',
]

/**
 * One assistant. A button, or a stated absence — never a silent gap.
 *
 * `open` is the expansion, and it is CLOSED until a press cannot finish. Nothing is expanded on arrival:
 * a reader landing here sees buttons and a list, never a wall of accordions.
 */
function Connect({ offer }: { readonly offer: ConnectOffer }) {
  const [open, setOpen] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  // THE DEGRADED PATH, AND ONLY IT. Holding a credential in state puts it in the DOM, so this is null in
  // every other case and is set only when the browser refused the clipboard outright — at which point
  // the alternative is a reader with no way forward at all.
  const [revealed, setRevealed] = useState<{ address: string; key: string } | null>(null)

  if (!offer.served) {
    // NOT A BUTTON. One sentence on why, one on what would change it, and no control to press — a
    // disabled button invites a reader to press it and learn nothing.
    return (
      <div className="ai-absent-row">
        <strong>{offer.name}</strong>{' — '}
        {offer.reason}. {offer.fix ? `${offer.fix.slice(0, 1).toUpperCase()}${offer.fix.slice(1)}.` : null}
      </div>
    )
  }

  /**
   * One press, and it degrades in the order the owner set (2026-08-31):
   *
   *   1. auto-launch works        → the assistant opens connected. Nothing shown, nothing copied.
   *   2. auto-launch does not     → copy the line, say "copied — paste it into X". No credential on screen.
   *   3. the clipboard is refused → a one-time reveal. "Degraded path, not the design."
   *
   * NO VENDOR HAS A LAUNCHER THIS PRODUCT HAS VERIFIED, so tier 1 never fires today and the code for it
   * is deliberately absent rather than stubbed — inventing a launch URL nobody has driven would be a
   * button that looks like it works and cannot, which is the class this page exists to end.
   */
  const press = async () => {
    // item 3 — A TOGGLE CLOSES. It only ever opened: `setOpen(true)` with no
    // path back, so a second press re-ran the whole thing and left the block exactly as it was. The
    // owner reported it as buttons that "do not collapse again on second click", which is what it is.
    // Closing also drops the degraded reveal, which is the one state that must not survive a press the
    // reader made to put it away.
    if (open) { setOpen(false); setSaid(null); setRevealed(null); return }
    setOpen(true); setSaid(null); setRevealed(null)

    // A local route: the line is a command with no secret in it, so it never needs the server.
    if (offer.command) {
      const ok = await copy(offer.command)
      setSaid(ok ? `Copied. Paste it into ${offer.name}.` : null)
      launchIfOffered(offer)
      return
    }

    // An address route. THE KEY LIVES IN THIS FUNCTION AND NOWHERE ELSE: it is minted for the person
    // pressing, handed to the clipboard, and dropped when this call returns. It is never put in state,
    // never passed as a prop, and never rendered — except on tier 3 below, where the reader has pressed
    // and the browser has refused, and a dead end would be the worse answer.
    const r = await api.connectKey()
    if (r.kind !== 'ok') {
      setSaid('We could not set this up just now. Try again, or ask us.')
      return
    }
    const line = `${r.value.address}\n${r.value.key}`
    if (await copy(line)) { setSaid(`Copied. Paste it into ${offer.name}.`); launchIfOffered(offer) }
    else setRevealed({ address: r.value.address, key: r.value.key })
  }

  return (
    <div className="ai-row">
      {/* item 2 — `className="btn"` MATCHED NOTHING. There is no `.btn` in
          base.css and never was: the app's vocabulary is `.btn-primary` and `.btn-ghost`. So these
          rendered as bare user-agent buttons beside an app styled with neither — which is exactly the
          "no formatting consistent with the rest of the app" the owner reported, and it was one word. */}
      <button type="button" className={open ? 'btn-ghost ai-btn ai-btn-on' : 'btn-ghost ai-btn'}
        aria-expanded={open} onClick={() => void press()}>Connect {offer.name}</button>
      {open ? (
        <div className="ai-open">
          {said ? <p className="ai-said">{said}</p> : null}
          {/* ── item 1 — THE VENDOR'S OWN PATH LEADS ────────────────────────
              The reader was handed a command first, whatever assistant they picked. The owner named the
              reader it fails: "a cowork user will have no idea what to do with it and is irrelevant."
              These steps are the resolver's, not this page's — the same ones the delivered report
              quotes — so the taps named here are the taps that vendor actually has, and the step that
              names an address names the one this deployment resolved rather than one composed here. */}
          {offer.steps.length ? (
            <ol className="ai-steps">
              {offer.steps.map((line) => <li key={line}>{line}</li>)}
            </ol>
          ) : null}
          {/* THE COMMAND IS AN ADVANCED DETAIL NOW, and closed. For Claude Code and Codex CLI the
              reader IS at a terminal and this is their front door, which is why it stays reachable in
              one tap rather than being cut; for everyone else it was noise standing where the answer
              should have been. */}
          {offer.command ? (
            <details className="ai-advanced">
              <summary>{offer.stdio?.kind === 'config'
                ? `Advanced — the block ${offer.name} needs, if you would rather paste it yourself`
                : 'Advanced — the one-line command, if you would rather run it yourself'}</summary>
              <p className="ai-said">
                {offer.stdio?.kind === 'config'
                  ? `${offer.name} needs this in ${offer.stdio.where}.`
                  : 'Run this once on this machine.'}
              </p>
              <pre className="ai-pre">{offer.command}</pre>
              {offer.stdio?.after ? <p className="ai-said">{offer.stdio.after}</p> : null}
            </details>
          ) : null}
          {revealed ? (
            <>
              <p className="ai-said">
                Your browser would not let us copy it. Paste these two lines into {offer.name} — they are
                yours, and they will not be shown again.
              </p>
              <pre className="ai-pre">{revealed.address}{'\n'}{revealed.key}</pre>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Open the vendor's own page, when this row has one somebody has driven.
 *
 * ── settled 8 — A LAUNCH, NOT INSTRUCTIONS ─────────────────────────────────
 *
 * The owner's ask is the "fastest possible way for someone to reach 'chat about my report'", and the
 * ruling's own words are "where a vendor allows launching directly, launch; otherwise the shortest
 * possible paste". This is the first half. The second half is what every row does TODAY, because no
 * vendor in the table carries a launch page yet — see the note above `CONNECT_CLIENTS`.
 *
 * AFTER the copy and never before it. The clipboard write has to happen while the browser still counts
 * this as the user's own gesture; opening a tab first can cost that, and the reader would arrive at
 * their assistant with nothing to paste.
 */
function launchIfOffered(offer: ConnectOffer) {
  if (!offer.launch) return
  window.open(offer.launch.url, '_blank', 'noopener,noreferrer')
}

/** Write to the clipboard, reporting whether it actually happened. A refusal is a real answer here. */
async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true } catch { return false }
}

export function UseYourAI({ ctx }: { readonly ctx: ShellContext }) {
  const [access, setAccess] = useState<McpAccess | null>(null)

  useEffect(() => {
    let live = true
    void api.mcpAccess().then((r) => { if (live && r.kind === 'ok') setAccess(r.value) })
    return () => { live = false }
  }, [ctx.me.email])

  const offers = access?.offers ?? []
  // Buttons first, absences after: a reader scanning for something to press should not read past four
  // explanations of assistants this deployment cannot offer to reach the ones it can.
  // ── settled 6 — THE ROUTE THAT NEEDS NOTHING GOES FIRST ─────────────────
  // "For an assistant that can launch a local process, connecting is one click: no address, no key, no
  // internet, no third party. That is the better answer wherever it applies and it must be offered
  // first." Ordered by what the ROUTE needs, never by a list of names written here.
  const usable = offers.filter((o) => o.served)
    .slice().sort((a, b) => Number(!a.command) - Number(!b.command))
  const absent = offers.filter((o) => !o.served)

  return (
    <div className="screen ai-screen">
      <h1 className="ai-title">Use your own AI</h1>
      <p className="ai-lead">
        Run and interrogate clearances from the assistant you already use — by voice, by email, or just
        by asking.
      </p>

      {/* ── item 6 — THIS IS WHY THE READER IS HERE, so it goes first ────────
          It was the last thing on the page, under every button and every explanation of an assistant
          this deployment cannot serve. The owner: "badly formatted and hidden at the bottom … move it
          to the TOP, above the buttons." A reader deciding whether to set this up at all needs the
          answer before the controls, not after them. */}
      <section className="ai-can">
        <h2>What you can do</h2>
        <ul>
          {WHAT_YOU_CAN_DO.map((line) => <li key={line}>{line}</li>)}
        </ul>
        <p className="ai-can-foot">
          Every report also has an <strong>Ask AI</strong> button that jumps straight to that run.
        </p>
      </section>

      {/* ── — WHICH OF THE TWO WAYS IN THIS IS (owner, 2026-09-03) ───────────
          He was confused by the page himself, which he called the strongest possible fail of the
          lawyer test, and ruled that the distinction be made really clear. Said in the reader's terms
          and not the product's: what they set up here is themselves, with their own reach, and the
          powerful one is somebody else's. None of the six words the 2026-08-31 cut banned appears
          here, and the browser check enforces that on every line an arriving reader sees. */}
      <p className="ai-doors">
        <strong>This is you, with your own reach.</strong> An assistant you set up here can do what you
        can do on these screens — start a clearance for your brands, follow it while it runs, ask about
        your own reports — and nothing beyond that. There is a second, far more powerful way in, for the
        team that runs this service. It is not this one, and nothing on this page opens it.
      </p>

      <h2 className="ai-connect-head">Connect it</h2>
      <div className="ai-buttons">
        {usable.map((o) => <Connect key={o.id} offer={o} />)}
      </div>
      {absent.length ? <div className="ai-absent">{absent.map((o) => <Connect key={o.id} offer={o} />)}</div> : null}

      {/* ── item 7 — THE HELP IS ON THE PAGE, not behind a raw document ──────
          The one link went straight to `/portal/connect-help`, which serves a markdown file as escaped
          text: a reader who followed it got literal `##` in a browser tab. The owner: "is this for AI
          or for a human. if its for human, its fail."

          So the part a person needs is written here, collapsed, and the document keeps its link with
          an honest label — it is a technical reference, and a reader who wants the mechanism is
          entitled to it. A `<details>` and not a panel because nothing may be expanded on arrival;
          its text is out of the arriving reader's innerText for the same reason. */}
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
