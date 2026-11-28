// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// AN ORDER WITH NO RUN SITS AMONG THE NAMES WHERE ITS TIME PUTS IT.
//
// An order being checked, or refused before any run, is a Clearances row of its own. It was drawn above the list on
// every page, and above the first company's heading when the list was grouped. It now goes where a name's row with the
// same company, name and time would go, and is paged with the names. These arms hold that placing:
//   - newest first, by the order's own time against each name's, so a refusal never sinks below an older report;
//   - the names keep their order among themselves, whatever the reader sorted by;
//   - grouped, an order sits under its own company's heading;
//   - sorted by risk, an order has no band and follows the names of its company that do;
//   - an order is on one page only;
//   - which orders a view lists: the unfiltered view, narrowed by company, level and name like the runs.
// Every name is invented.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withOrders, ordersInView, entryKey, type ListEntry } from '../src/contract/orderRows.ts'
import type { PreRunOrder } from '../src/contract/orderReceipt.ts'
import { pageWindow } from '../src/contract/listView.ts'

type Row = { readonly account: string; readonly name: string; readonly issuedAt: string | null; readonly date: string | null }
const row = (name: string, issuedAt: string | null, account = 'coastline', date: string | null = issuedAt?.slice(0, 10) ?? null): Row =>
  ({ account, name, issuedAt, date })
const order = (markName: string, updatedAt: string, over: Partial<PreRunOrder> = {}): PreRunOrder => ({
  reference: `${markName}@0123456789ab`, state: 'refused', reasonKind: 'other', account: 'coastline', organisation: null, markName,
  marks: [markName], product: 'global-preliminary-search', updatedAt, ...over,
})
const names = (list: readonly ListEntry<Row>[]) => list.map((e) => (e.kind === 'row' ? e.row.name : `order:${e.order.markName}`))

test('newest first: an order goes by its own time among the names, and a refusal never sinks below an older report', () => {
  const rows = [
    row('LIVE', '2026-11-27T08:00:00Z'),           // a search under way: its last progress
    row('DELIVERED', '2026-11-26T10:00:00Z'),      // a delivered report: its issue
    row('OLD', '2026-10-27T10:00:00Z'),            // a report from last month
    row('UNDATED', null, 'coastline', '2026-10-01'),
  ]
  const orders = [order('REFUSED', '2026-11-26T12:00:00Z'), order('CHECKING', '2026-11-27T09:00:00Z', { state: 'checking', reasonKind: null })]
  assert.deepEqual(names(withOrders(rows, orders, { sortBy: 'activity', grouped: false })),
    ['order:CHECKING', 'LIVE', 'order:REFUSED', 'DELIVERED', 'OLD', 'UNDATED'])
})

test('the names keep their order among themselves, whatever the reader sorted by', () => {
  const rows = [row('ALDER', '2026-11-01T00:00:00Z'), row('BIRCH', '2026-11-20T00:00:00Z'), row('CEDAR', '2026-11-10T00:00:00Z')]
  const byName = withOrders(rows, [order('BEECH', '2026-11-27T00:00:00Z')], { sortBy: 'name', grouped: false })
  assert.deepEqual(names(byName), ['ALDER', 'order:BEECH', 'BIRCH', 'CEDAR'])
  assert.deepEqual(names(withOrders(rows, [], { sortBy: 'activity', grouped: false })), ['ALDER', 'BIRCH', 'CEDAR'], 'no orders, nothing moves')
})

test('grouped, an order sits under its own company, never above the first heading', () => {
  const rows = [row('A1', '2026-11-20T00:00:00Z', 'alder'), row('A2', '2026-11-10T00:00:00Z', 'alder'), row('Z1', '2026-11-25T00:00:00Z', 'zephyr')]
  const list = withOrders(rows, [order('ZNEW', '2026-11-27T00:00:00Z', { account: 'zephyr' }), order('AMID', '2026-11-15T00:00:00Z', { account: 'alder' })],
    { sortBy: 'activity', grouped: true })
  assert.deepEqual(names(list), ['A1', 'order:AMID', 'A2', 'order:ZNEW', 'Z1'])
  assert.deepEqual(list.map(entryKey), ['alder', 'alder', 'alder', 'zephyr', 'zephyr'])
  const generic = order('GEN', '2026-11-27T00:00:00Z', { account: 'generic', organisation: 'org-invented' })
  assert.notEqual(entryKey(withOrders([], [generic], { sortBy: 'activity', grouped: true })[0]!), 'generic', 'a Generic order is keyed by its organisation')
})

test('sorted by risk, an order has no band and follows the names of its company that do', () => {
  const rows = [row('HIGH', '2026-11-01T00:00:00Z', 'alder'), row('LOW', '2026-11-02T00:00:00Z', 'alder'), row('Z', '2026-11-03T00:00:00Z', 'zephyr')]
  const orders = [order('OLDER', '2026-11-20T00:00:00Z', { account: 'alder' }), order('NEWER', '2026-11-27T00:00:00Z', { account: 'alder' })]
  assert.deepEqual(names(withOrders(rows, orders, { sortBy: 'risk', grouped: true })), ['HIGH', 'LOW', 'order:NEWER', 'order:OLDER', 'Z'])
})

test('an order is on one page only, and the pages count it', () => {
  const rows = Array.from({ length: 5 }, (_, i) => row(`N${i}`, `2026-11-2${5 - i}T00:00:00Z`))
  const list = withOrders(rows, [order('MID', '2026-11-23T12:00:00Z')], { sortBy: 'activity', grouped: false })
  const pages = [0, 1, 2].map((p) => names(pageWindow(list, p, 2).visible))
  assert.deepEqual(pages, [['N0', 'N1'], ['order:MID', 'N2'], ['N3', 'N4']])
  assert.equal(pageWindow(list, 0, 2).pageCount, 3)
})

test('which orders a view lists: the unfiltered view, by company, level and any of its names', () => {
  const orders = [
    order('PREVENA', '2026-11-27T00:00:00Z'),
    order('KITE', '2026-11-27T00:00:00Z', { account: 'zephyr', product: 'knockout', marks: ['KITE', 'TALLOWMERE'] }),
  ]
  const view = { filter: 'all', owner: null, level: 'all', query: '' }
  assert.equal(ordersInView(orders, view).length, 2)
  for (const f of ['progress', 'finished', 'failed', 'retired']) assert.deepEqual(ordersInView(orders, { ...view, filter: f }), [], f)
  assert.deepEqual(ordersInView(orders, { ...view, owner: 'zephyr' }).map((o) => o.markName), ['KITE'])
  assert.deepEqual(ordersInView(orders, { ...view, level: 'knockout' }).map((o) => o.markName), ['KITE'])
  assert.deepEqual(ordersInView(orders, { ...view, query: 'tallow' }).map((o) => o.markName), ['KITE'], 'a batch is found by any of its names')
})
