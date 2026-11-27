// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// AN ORDER IS FOLLOWED FROM START TO ITS RUN, OR TO ITS REFUSAL.
//
// The queued screen used to say "waiting for a slot" and nothing more. An order the worker refused before any run had no
// row anywhere, and the person who pressed Start never learned of it. The receipt screen now follows the order by the
// reference Start returned. These arms hold the reading it rests on:
//   - each receipt state gives one view, and a refusal keeps its reference and its kind;
//   - a look that fails keeps the last view, marked unchecked, and never becomes a refusal or a missing order;
//   - `notFound` is the one answer that says there is no order here this reader may see;
//   - the screen keeps looking until the order has a run or has ended;
//   - the address that reopens a receipt reads back to the same reference and company.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decodeReceipt, decodePreRunOrder, viewOf, nextView, keepsLooking, FIRST_VIEW, receiptPath, receiptRoute, type ReceiptView } from '../src/contract/orderReceipt.ts'

const receipt = (b: Record<string, unknown>) => {
  const r = decodeReceipt({ reference: 'ORDER-1@0123456789ab', terminal: false, runId: null, updatedAt: '2026-11-27T00:00:00Z', ...b })
  assert.ok(r, `undecodable: ${JSON.stringify(b)}`)
  return r
}
const ok = (b: Record<string, unknown>) => ({ kind: 'ok' as const, value: receipt(b) })

test('each state the server names gives one view', () => {
  assert.deepEqual(viewOf(receipt({ state: 'waiting' })), { kind: 'waiting', unchecked: false })
  assert.deepEqual(viewOf(receipt({ state: 'checking' })), { kind: 'checking', unchecked: false })
  assert.deepEqual(viewOf(receipt({ state: 'running', runId: 'tmp1-quiet-heron' })), { kind: 'started', runId: 'tmp1-quiet-heron', unchecked: false })
  assert.deepEqual(viewOf(receipt({ state: 'resumable', runId: 'tmp1-quiet-heron' })), { kind: 'started', runId: 'tmp1-quiet-heron', unchecked: false })
  assert.deepEqual(viewOf(receipt({ state: 'delivered', terminal: true, runId: 'tmp1-quiet-heron' })),
    { kind: 'ended', runId: 'tmp1-quiet-heron', state: 'delivered', unchecked: false })
})

test('a refusal before any run keeps its reference and its kind; a kind this build does not know is other', () => {
  assert.deepEqual(viewOf(receipt({ state: 'refused', terminal: true, reasonKind: 'run-cap' })),
    { kind: 'refused', reference: 'ORDER-1@0123456789ab', reasonKind: 'run-cap', unchecked: false })
  assert.equal((viewOf(receipt({ state: 'refused', terminal: true, reasonKind: 'a-kind-from-later' })) as { reasonKind: string }).reasonKind, 'other')
  assert.equal((viewOf(receipt({ state: 'refused', terminal: true })) as { reasonKind: string }).reasonKind, 'other')
  assert.equal(receipt({ state: 'waiting', reasonKind: 'run-cap' }).reasonKind, null, 'only a refusal carries a kind')
})

test('a look that fails keeps the last view, unchecked, and is never a refusal or a missing order', () => {
  const waiting: ReceiptView = { kind: 'waiting', unchecked: false }
  for (const failed of [
    { kind: 'upstream' as const, message: 'The portal could not be reached.' },
    { kind: 'rateLimited' as const },
    { kind: 'noAccess' as const },
    { kind: 'ok' as const, value: null },
  ]) {
    const v = nextView(waiting, failed)
    assert.deepEqual(v, { kind: 'waiting', unchecked: true }, `after ${failed.kind}`)
    assert.ok(keepsLooking(v), 'a failed look always looks again')
  }
  const refused = nextView(FIRST_VIEW, ok({ state: 'refused', terminal: true, reasonKind: 'details' }))
  assert.equal(nextView(refused, { kind: 'upstream', message: 'x' }).kind, 'refused', 'a refusal already seen stays one')
})

test('notFound is the one answer that says there is no order here this reader may see', () => {
  assert.deepEqual(nextView(FIRST_VIEW, { kind: 'notFound' }), { kind: 'missing', unchecked: false })
})

test('the screen keeps looking while the order waits or is checked, and stops once it has a run or has ended', () => {
  let v = FIRST_VIEW
  assert.ok(keepsLooking(v))
  v = nextView(v, ok({ state: 'checking' }))
  assert.ok(keepsLooking(v))
  v = nextView(v, ok({ state: 'running', runId: 'tmp1-quiet-heron' }))
  assert.deepEqual(v, { kind: 'started', runId: 'tmp1-quiet-heron', unchecked: false })
  assert.equal(keepsLooking(v), false, 'once it has a run, the run is followed from its own screen')
  assert.equal(keepsLooking(nextView(FIRST_VIEW, ok({ state: 'refused', terminal: true }))), false)
  assert.equal(keepsLooking(nextView(FIRST_VIEW, { kind: 'notFound' })), false)
})

test('the address that reopens a receipt reads back to the same reference and company', () => {
  const path = receiptPath('ORDER-1@0123456789ab', 'demo-brand-owner')
  const [pathname, search] = path.split('?')
  assert.deepEqual(receiptRoute(pathname ?? '', `?${search ?? ''}`), { reference: 'ORDER-1@0123456789ab', account: 'demo-brand-owner' })
  assert.deepEqual(receiptRoute('/portal/orders', ''), { reference: null, account: null })
  assert.deepEqual(receiptRoute('/portal/orders/%E0%A4%A', '?account=x'), { reference: null, account: 'x' }, 'a malformed address names nothing')
})

test('the runs list carries only the orders a row is drawn for: being checked, or refused before any run', () => {
  assert.deepEqual(decodePreRunOrder({ reference: 'R@1', state: 'refused', reasonKind: 'policy', account: 'generic', organisation: 'orgx', markName: 'M', updatedAt: 'x' }),
    { reference: 'R@1', state: 'refused', reasonKind: 'policy', account: 'generic', organisation: 'orgx', markName: 'M', updatedAt: 'x' })
  assert.equal(decodePreRunOrder({ reference: 'R@1', state: 'checking', reasonKind: 'policy', account: 'a' })?.reasonKind, null, 'a kind only on a refusal')
  assert.equal(decodePreRunOrder({ reference: 'R@1', state: 'refused', account: 'a' })?.reasonKind, 'other')
  for (const odd of [null, {}, { reference: 'R@1', state: 'waiting', account: 'a' }, { reference: 'R@1', state: 'refused' }])
    assert.equal(decodePreRunOrder(odd), null, JSON.stringify(odd))
})
