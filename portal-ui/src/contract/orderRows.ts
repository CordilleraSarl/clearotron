// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// orderRows.ts — where Clearances puts the orders that have no run yet: among its names, as a name's row would be.
//
// An order being checked, or refused before any run, is one row of its own (contract/orderReceipt.ts decodes it). It is
// not pinned above the list: it takes the place a name's row would take with the same activity, so a refusal from last
// week sits among last week's names (design, 2026-11-27). The list is filtered, grouped, sorted and then paged as one,
// so an order is on one page only and under its own company's heading.
//
// ITS TIME IS ITS LAST CHANGE OF STATE, the time the worker took it or refused it. A name's row is ordered by the same
// kind of time: a delivered report's issue, a live search's last progress, a queued one's queueing. Both are full
// stamps, so `newestFirst` compares them as equals and a refusal never sinks below an older report.
import type { PreRunOrder } from './orderReceipt.ts'
import { runKey } from './genericKey.ts'
import { newestFirst } from './reads.ts'
import { atLevel, type LevelFilter } from './levelTags.ts'

/** One row of the Clearances table: a name or family, or an order with no run. */
export type ListEntry<R> = { readonly kind: 'row'; readonly row: R } | { readonly kind: 'order'; readonly order: PreRunOrder }

/** What a row brings to the ordering. */
type Placed = { readonly account: string; readonly organisation?: string | null; readonly name: string; readonly issuedAt: string | null; readonly date: string | null }

/** How the reader chose to order the list. */
export type ListOrder = { readonly sortBy: 'activity' | 'name' | 'risk'; readonly grouped: boolean }

/** The company an entry belongs to, as the headings and the company filter read it. */
export const entryKey = <R extends Placed>(e: ListEntry<R>): string => runKey(e.kind === 'row' ? e.row : e.order)

/** What an order brings to the ordering: its name, or its reference when it has none, and its own time. */
const placedOf = (o: PreRunOrder): Placed => ({ account: o.account, organisation: o.organisation, name: o.markName ?? o.reference,
  issuedAt: o.updatedAt, date: o.updatedAt ? o.updatedAt.slice(0, 10) : null })

/**
 * The orders a view lists. Only the unfiltered view lists them: an order is neither a search in progress nor a finished
 * one, and it has no level of result. The company filter, the level filter and the name search apply as they do to runs.
 */
export function ordersInView(orders: readonly PreRunOrder[], view: { readonly filter: string; readonly owner: string | null; readonly level: LevelFilter; readonly query: string }): readonly PreRunOrder[] {
  if (view.filter !== 'all') return []
  const q = view.query.trim().toLowerCase()
  return orders.filter((o) => (!view.owner || runKey(o) === view.owner) && atLevel(o, view.level)
    && (!q || (o.markName ?? '').toLowerCase().includes(q) || o.marks.some((m) => m.toLowerCase().includes(q))))
}

/**
 * The rows and the orders as one list, in the reader's order. `rows` arrive already sorted by the screen, and their
 * order among themselves is kept exactly. Each order goes where a name's row with its company, name and time would go:
 * by company first when grouped, then by name, or by time. Under "Risk" an order has no band, so it follows every name
 * of its company that has one. A tie keeps the name's row first.
 */
export function withOrders<R extends Placed>(rows: readonly R[], orders: readonly PreRunOrder[], { sortBy, grouped }: ListOrder): readonly ListEntry<R>[] {
  const before = (a: Placed & { order: boolean }, b: Placed & { order: boolean }): number => {
    if (grouped && runKey(a) !== runKey(b)) return runKey(a).localeCompare(runKey(b))
    if (sortBy === 'name') return a.name.localeCompare(b.name)
    if (sortBy === 'risk') return Number(a.order) - Number(b.order) || (a.order && b.order ? newestFirst(a, b) : 0)
    return newestFirst(a, b)
  }
  const placed = [...orders].map((o) => ({ o, p: { ...placedOf(o), order: true } })).sort((x, y) => before(x.p, y.p))
  const out: ListEntry<R>[] = []
  let j = 0
  for (const row of rows) {
    const p = { account: row.account, organisation: row.organisation ?? null, name: row.name, issuedAt: row.issuedAt, date: row.date, order: false }
    while (j < placed.length && before(placed[j]!.p, p) < 0) out.push({ kind: 'order', order: placed[j++]!.o })
    out.push({ kind: 'row', row })
  }
  while (j < placed.length) out.push({ kind: 'order', order: placed[j++]!.o })
  return out
}
