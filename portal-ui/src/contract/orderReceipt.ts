// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// orderReceipt.ts — following an accepted order from Start to its run, or to its refusal, by the reference Start returned.
//
// The server answers one order at a time, inside the reader's own visibility (driver/portal-routes/queue.mjs, from
// driver/order-receipt.mjs). Another company's order and an order nobody holds are one answer, `notFound`, and nothing
// here can tell them apart. That is the point.
//
// A LOOKUP THAT FAILS IS NOT AN ANSWER. A queue that would not open, a portal pacing requests, a network that dropped
// the call: each leaves the screen on what it last knew, marked as not checked just now, and the next look tries again.
// None of them turns into a refusal or into "no such order", which would tell a person their clearance is gone while it
// waits for a slot.

import type { Result } from './api.ts'

/** The states a receipt can be in, as the server names them. */
export type ReceiptState = 'waiting' | 'checking' | 'running' | 'resumable' | 'refused' | 'failed' | 'delivered' | 'cancelled'

/** Which check refused an order before any run, as the runner recorded it. `other` is every refusal without a kind. */
export type RefusalKind = 'run-cap' | 'details' | 'policy' | 'setup' | 'duplicate' | 'other'

export type OrderReceipt = {
  readonly reference: string
  readonly state: ReceiptState
  readonly terminal: boolean
  /** The run this order became, once it has one. */
  readonly runId: string | null
  /** Set on a refused order only. */
  readonly reasonKind: RefusalKind | null
  readonly updatedAt: string | null
}

const STATES: readonly ReceiptState[] = ['waiting', 'checking', 'running', 'resumable', 'refused', 'failed', 'delivered', 'cancelled']
const KINDS: readonly RefusalKind[] = ['run-cap', 'details', 'policy', 'setup', 'duplicate', 'other']
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

/** The server's answer, read defensively: a state this build does not know is not guessed at. */
export function decodeReceipt(b: Record<string, unknown>): OrderReceipt | null {
  const state = STATES.find((s) => s === b['state']) ?? null
  const reference = str(b['reference'])
  if (!state || !reference) return null
  const kind = KINDS.find((k) => k === b['reasonKind']) ?? (state === 'refused' ? 'other' : null)
  return { reference, state, terminal: b['terminal'] === true, runId: str(b['runId']), reasonKind: state === 'refused' ? kind : null,
    updatedAt: str(b['updatedAt']) }
}

/**
 * What the screen shows.
 *
 *   waiting    accepted, waiting for a slot
 *   checking   a worker took it and is checking it; nothing has started
 *   started    it has a run: the run's screen is where it is followed from here
 *   refused    refused before any run; the reference stays, with the kind of refusal
 *   ended      it had a run, and that run has ended (delivered, failed or cancelled): the run's screen says how
 *   missing    no order by this reference that this reader may see
 *
 * `unchecked` is true when the last look failed: the state is what the look before it found.
 */
export type ReceiptView =
  | { readonly kind: 'waiting'; readonly unchecked: boolean }
  | { readonly kind: 'checking'; readonly unchecked: boolean }
  | { readonly kind: 'started'; readonly runId: string; readonly unchecked: boolean }
  | { readonly kind: 'refused'; readonly reference: string; readonly reasonKind: RefusalKind; readonly unchecked: boolean }
  | { readonly kind: 'ended'; readonly runId: string | null; readonly state: ReceiptState; readonly unchecked: boolean }
  | { readonly kind: 'missing'; readonly unchecked: boolean }

/** The view before any look has answered: the order was accepted, so it is waiting. */
export const FIRST_VIEW: ReceiptView = { kind: 'waiting', unchecked: false }

/** The view one receipt gives. PURE. */
export function viewOf(r: OrderReceipt): ReceiptView {
  switch (r.state) {
    case 'waiting': return { kind: 'waiting', unchecked: false }
    case 'checking': return { kind: 'checking', unchecked: false }
    case 'running':
    case 'resumable':
      return r.runId ? { kind: 'started', runId: r.runId, unchecked: false } : { kind: 'checking', unchecked: false }
    case 'refused': return { kind: 'refused', reference: r.reference, reasonKind: r.reasonKind ?? 'other', unchecked: false }
    case 'failed':
    case 'delivered':
    case 'cancelled':
      return { kind: 'ended', runId: r.runId, state: r.state, unchecked: false }
  }
}

/**
 * The next view, from the last one and one look's result. PURE.
 *
 * Only two answers change what the screen says: a receipt, and `notFound`. Every other result is a look that failed,
 * and it keeps the last view, marked unchecked.
 */
export function nextView(prev: ReceiptView, look: Result<OrderReceipt | null>): ReceiptView {
  if (look.kind === 'ok') return look.value ? viewOf(look.value) : { ...prev, unchecked: true }
  if (look.kind === 'notFound') return { kind: 'missing', unchecked: false }
  return { ...prev, unchecked: true }
}

/** Whether the screen keeps looking: until the order has a run or has ended. A failed look always looks again. */
export const keepsLooking = (v: ReceiptView): boolean =>
  v.unchecked || v.kind === 'waiting' || v.kind === 'checking'

/** How long between looks, in milliseconds: often while it waits, less often after a failed look. */
export const lookAfterMs = (v: ReceiptView): number => (v.unchecked ? 15_000 : 5_000)

/** The address that reopens one order's receipt for one company. The server checks the reader may see it. */
export function receiptPath(reference: string, account: string): string {
  return `/portal/orders/${encodeURIComponent(reference)}?account=${encodeURIComponent(account)}`
}

/** The reference and company a receipt address names, or nulls when it names none. PURE. */
export function receiptRoute(pathname: string, search: string): { reference: string | null; account: string | null } {
  const m = /^\/portal\/orders\/([^/]+)\/?$/.exec(pathname)
  let reference: string | null = null
  try { reference = m?.[1] ? decodeURIComponent(m[1]) : null } catch { reference = null }
  const account = new URLSearchParams(search).get('account')
  return { reference, account: account || null }
}

/**
 * An order the portal's Start accepted that has no run yet, as the runs list carries it beside its runs: being checked,
 * or refused before any run. A waiting order is its queued row and an order with a run is its run's row, so neither is
 * one of these.
 */
export type PreRunOrder = {
  readonly reference: string
  readonly state: 'checking' | 'refused'
  readonly reasonKind: RefusalKind | null
  readonly account: string
  readonly organisation: string | null
  readonly markName: string | null
  /** Every name the order carries, for the name search: a batch is found by any of them. */
  readonly marks: readonly string[]
  /** The search ordered, for the level filter. */
  readonly product: string | null
  readonly updatedAt: string | null
}

/** One of the runs list's `orders`, or null when it is not one this build can show. PURE. */
export function decodePreRunOrder(v: unknown): PreRunOrder | null {
  if (!v || typeof v !== 'object') return null
  const b = v as Record<string, unknown>
  const reference = str(b['reference'])
  const account = str(b['account'])
  const state = b['state'] === 'checking' || b['state'] === 'refused' ? b['state'] : null
  if (!reference || !account || !state) return null
  const kind = KINDS.find((k) => k === b['reasonKind']) ?? (state === 'refused' ? 'other' : null)
  return { reference, state, reasonKind: state === 'refused' ? kind : null, account, organisation: str(b['organisation']),
    markName: str(b['markName']),
    marks: Array.isArray(b['marks']) ? b['marks'].filter((m): m is string => typeof m === 'string' && m.length > 0) : [],
    product: str(b['product']), updatedAt: str(b['updatedAt']) }
}
