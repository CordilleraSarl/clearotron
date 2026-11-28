// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// OrderReceipt.tsx — an accepted order, followed by the reference Start returned, until it has a run or is refused.
//
// THE SAME RECEIPT FROM START AND FROM CLEARANCES. New clearance shows it the moment Start is accepted, and the address
// /portal/orders/<reference>?account=<company> reopens it later, from the Clearances row or a link the person kept. Both
// are this one panel, so the two can never tell one order two ways.
//
// WHAT IT SAYS COMES FROM THE SERVER'S RECEIPT, read by contract/orderReceipt.ts. A look that fails keeps what the last
// one confirmed, says it could not check just now, and looks again; it never turns into a refusal or a missing order.
// The reason as the worker wrote it is the operator's, and the server does not send it here: a refusal arrives as its
// kind, and each kind has its sentence below.

import { useEffect, useRef, useState } from 'react'
import { api } from '../contract/api.ts'
import { FIRST_VIEW, nextView, keepsLooking, lookAfterMs, receiptRoute, type ReceiptView, type RefusalKind } from '../contract/orderReceipt.ts'
import { resultPath, HOME } from '../nav/nav.config.ts'
import { PageHeader } from '../components/PageHeader.tsx'
import type { ShellContext } from '../shell/AppShell.tsx'
import { seesEverything } from '../shell/permissions.ts'

/** The sentence a refusal of each kind gets. `other` has none of its own: the help line is the whole answer. */
function refusalSentence(kind: RefusalKind): string | null {
  switch (kind) {
    case 'run-cap': return 'Your company has reached its search limit.'
    case 'details': return 'More information is needed before this search can start.'
    case 'policy': return 'This search falls outside the rules set for your company.'
    case 'setup': return 'This installation needs attention before the search can start.'
    case 'duplicate': return 'This order was flagged as a duplicate.'
    case 'other': return null
  }
}

/** Whether a refusal of this kind also tells the person who can help: a diagnosis that is staff's, or none at all. */
const needsHelpLine = (kind: RefusalKind): boolean => kind === 'setup' || kind === 'other'

/** Follow one order until it has a run or has ended, looking again while it waits and after any look that fails. */
function useReceipt(reference: string, account: string): ReceiptView {
  const [view, setView] = useState<ReceiptView>(FIRST_VIEW)
  const viewRef = useRef<ReceiptView>(FIRST_VIEW)
  useEffect(() => {
    let live = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const look = async () => {
      const r = await api.orderReceipt(reference, account)
      if (!live) return
      const next = nextView(viewRef.current, r)
      viewRef.current = next
      setView(next)
      if (keepsLooking(next)) timer = setTimeout(() => { void look() }, lookAfterMs(next))
    }
    void look()
    return () => { live = false; if (timer) clearTimeout(timer) }
  }, [reference, account])
  return view
}

/**
 * The receipt panel. `name` and `duration` are known when it opens from Start; reopened from an address, neither is,
 * and the waiting state says only what the receipt confirms.
 */
export function OrderReceiptPanel({ reference, account, name, duration, go, onAnother }: {
  readonly reference: string
  readonly account: string
  /** The name that was queued, as the reader typed it, when the panel opens from Start. */
  readonly name: string | null
  /** The quote for its pipeline, as the footer showed it at the moment of starting. */
  readonly duration: string | null
  readonly go: (p: string) => void
  /** Start another clearance, offered only where the panel opens from Start. */
  readonly onAnother?: () => void
}) {
  const view = useReceipt(reference, account)

  // ONLY PROMISE A RETRY WHILE THE SCREEN RETRIES. Every unchecked view keeps looking (keepsLooking), so the line and
  // the next look always arrive together. The view beside it is the last one a look confirmed. No time is shown: a
  // bare clock says nothing of what it is the time of (design, 2026-11-27).
  const unchecked = view.unchecked ? (
    <p style={{ margin: '10px 0 0', color: 'var(--text-muted)' }} role="status">
      We couldn’t check this order just now. We’ll try again.
    </p>
  ) : null

  if (view.kind === 'missing') {
    // THE SAME ANSWER AS AN ADDRESS NOBODY SERVES. Another company's order and an order nobody holds are one 404, and
    // this is the shell's own sentence for a page that is not there, so the two read alike here as well.
    return (
      <div className="screen">
        <div className="empty">
          <p>That page does not exist.</p>
          <button type="button" className="nav-item" style={{ width: 'auto', margin: '0 auto' }} onClick={() => go(HOME.path)}>
            Back to {HOME.label}
          </button>
        </div>
      </div>
    )
  }

  if (view.kind === 'started' || (view.kind === 'ended' && view.runId)) {
    const runId = view.kind === 'started' ? view.runId : (view.runId as string)
    return (
      <div className="screen">
        <PageHeader title="Order started" />
        <div className="notice prose">
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="btn-primary" onClick={() => go(resultPath(runId))}>View clearance</button>
            {onAnother ? <button type="button" className="btn-ghost" onClick={onAnother}>Start another</button> : null}
          </div>
          {unchecked}
        </div>
      </div>
    )
  }

  if (view.kind === 'refused' || view.kind === 'ended') {
    const kind: RefusalKind | null = view.kind === 'refused' ? view.reasonKind : null
    const sentence = kind ? refusalSentence(kind) : null
    return (
      <div className="screen">
        <PageHeader title="Order did not start" />
        <div className="notice prose">
          {sentence ? <p style={{ margin: 0 }}>{sentence}</p> : null}
          {kind && needsHelpLine(kind) ? <p style={{ margin: sentence ? '8px 0 0' : 0 }}>Contact your administrator and give them this order reference.</p> : null}
          <p style={{ margin: '10px 0 0', color: 'var(--text-muted)' }}>
            Order reference: <span data-anon="reference" style={{ fontFamily: 'var(--font-mono)' }}>{reference}</span>
          </p>
          <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
            <button type="button" className="btn-primary" onClick={() => go('/portal/clearances')}>View in Clearances</button>
            {onAnother ? <button type="button" className="btn-ghost" onClick={onAnother}>Start another</button> : null}
          </div>
          {unchecked}
        </div>
      </div>
    )
  }

  // WAITING, OR BEING CHECKED: the existing wording, until the receipt confirms a start or a refusal. "Queued", not
  // "started": it has not started, and nothing here says anyone will be told when it finishes.
  return (
    <div className="screen">
      <PageHeader title="Clearance queued" />
      <div className="notice prose">
        {name && duration ? (
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>
            <span data-anon="mark">{name}</span> is waiting for a slot. It runs {duration} once it starts.
          </p>
        ) : null}
        <div style={{ marginTop: name && duration ? 14 : 0, display: 'flex', gap: 10 }}>
          <button type="button" className="btn-primary" onClick={() => go('/portal/clearances')}>View in Clearances</button>
          {onAnother ? <button type="button" className="btn-ghost" onClick={onAnother}>Start another</button> : null}
        </div>
        {unchecked}
      </div>
    </div>
  )
}

/** The receipt reopened from its address: /portal/orders/<reference>?account=<company>. */
export function OrderReceipt({ ctx }: { readonly ctx: ShellContext }) {
  const { reference, account } = receiptRoute(window.location.pathname, window.location.search)
  // Someone who sees everything is answered for any order, so a link naming no company still opens for them.
  const company = account ?? ctx.owner ?? (seesEverything(ctx.me) ? '' : null)
  if (!reference || company === null) {
    return (
      <div className="screen">
        <div className="empty">
          <p>That page does not exist.</p>
          <button type="button" className="nav-item" style={{ width: 'auto', margin: '0 auto' }} onClick={() => ctx.go(HOME.path)}>
            Back to {HOME.label}
          </button>
        </div>
      </div>
    )
  }
  return <OrderReceiptPanel reference={reference} account={company} name={null} duration={null} go={ctx.go} />
}
