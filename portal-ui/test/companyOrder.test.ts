// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The rail's switcher and the pick panel offer companies in ONE order.
//
// THE DEFECT THIS EXISTS FOR. The panel and the chips lift Generic to the front — it is the default, and a
// default that sorts alphabetically among the companies is a default nobody finds. The switcher sorted
// every key by display name. On the ordinary early installation — the house account plus one company
// called "Acme Ltd" — the rail read *All companies, Acme Ltd, Generic default* while the panel beside it
// read *Generic default, Acme Ltd*. Two controls, one installation, two answers to the same question.
//
// Neither implementation was wrong on its own, which is why nothing caught it: each file was correct and
// the disagreement lived between them. This is the one place both are in scope.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { orderedCompanyKeys, pickerRows, GENERIC_KEY } from '../src/shell/companyRows.ts'

const NAMES: Record<string, string> = {
  generic: 'Generic default',
  acme: 'Acme Ltd',
  zephyr: 'Zephyr Holdings',
  brightwater: 'Brightwater',
}
const name = (k: string | null) => (k === null ? 'All companies' : NAMES[k] ?? k)
const noFacts = () => undefined

/** What the panel actually offers, in the order it offers it. */
const panelOrder = (keys: readonly string[], role: 'staff' | 'client') =>
  pickerRows(keys, name, noFacts, role).map((r) => r.key)

test('THE SWITCHER AND THE PANEL AGREE, on every shape an installation can be in', () => {
  // The two-key case is the one that was wrong in the product, and it is the commonest early state. The
  // others are here so a fix that only special-cased two keys could not pass.
  const shapes: readonly (readonly string[])[] = [
    ['generic', 'acme'],
    ['acme', 'generic'],
    ['generic'],
    ['generic', 'zephyr', 'acme', 'brightwater'],
    ['acme', 'zephyr'],
  ]

  for (const keys of shapes) {
    for (const role of ['staff', 'client'] as const) {
      assert.deepEqual(
        orderedCompanyKeys(keys, name, role),
        panelOrder(keys, role),
        `${role} on [${keys.join(', ')}] — the rail and the panel offer the same order`,
      )
    }
  }
})

test('GENERIC IS FIRST WHERE IT IS OFFERED AT ALL', () => {
  // The rule the shared order exists to keep, stated once so the agreement above cannot be satisfied by
  // both controls being wrong in the same way.
  const keys = ['acme', 'generic', 'zephyr']
  assert.equal(orderedCompanyKeys(keys, name, 'staff')[0], GENERIC_KEY,
    'the default is the first thing offered, not the seventh letter of the alphabet')

  // And the companies after it are still in name order — putting Generic first must not scramble the rest.
  assert.deepEqual(orderedCompanyKeys(keys, name, 'staff').slice(1), ['acme', 'zephyr'])
})

test('GENERIC IS OFFERED TO NOBODY WHO MAY NOT USE IT', () => {
  // The other direction, and the one that matters for a customer's own user: the engine refuses the house
  // account to them at several routes, so offering it would be a menu entry that always fails.
  const keys = ['acme', 'generic']
  const forClient = orderedCompanyKeys(keys, name, 'client')
  assert.ok(!forClient.includes(GENERIC_KEY), 'not offered')
  assert.deepEqual(forClient, ['acme'], 'and the rest is unaffected')

  // The floor: an implementation returning nothing at all would satisfy the line above.
  assert.ok(orderedCompanyKeys(keys, name, 'staff').length > forClient.length,
    'the staff list really is the longer one — the client list is filtered, not empty')
})
