// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The two permissions: every combination driven, the words they print in, and the one control that asks.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { canManage, canRun } from '../src/shell/permissions.ts'
import { permissionsPhrase, accessChips } from '../src/shell/accessWords.ts'
import type { Permissions } from '../src/contract/api.ts'

// EVERY combination of the two switches, written out. A permission test that exercises one person is a
// claim about that person and says nothing about the distinction it is named for — so the list is
// exhaustive, and the floor below fails if it is ever narrowed.
const EVERY: readonly Permissions[] = [
  { run: false, manage: false },
  { run: true, manage: false },
  { run: false, manage: true },
  { run: true, manage: true },
]

test('EACH PERMISSION IS ANSWERED BY ITS OWN SWITCH, for every combination, and by nothing else', () => {
  assert.equal(new Set(EVERY.map((p) => `${p.run}${p.manage}`)).size, 4, 'all four combinations, once each')
  for (const permissions of EVERY) {
    assert.equal(canRun({ permissions }), permissions.run, `run on ${JSON.stringify(permissions)}`)
    assert.equal(canManage({ permissions }), permissions.manage, `manage on ${JSON.stringify(permissions)}`)
  }
  // Both functions DISCRIMINATE, and on DIFFERENT switches. An implementation reading one switch for
  // both questions passes every single assertion for the two diagonal people; it cannot pass this.
  const split = EVERY.find((p) => p.run !== p.manage) as Permissions
  assert.notEqual(canRun({ permissions: split }), canManage({ permissions: split }),
    'the two questions are answered separately — Manage is not a rank above Run')
})

test('THE WORDS: what a person may do, never a role noun, and "none" is the view-only person', () => {
  assert.equal(permissionsPhrase({ run: true, manage: true }), 'Runs clearances · Manages')
  assert.equal(permissionsPhrase({ run: true, manage: false }), 'Runs clearances')
  assert.equal(permissionsPhrase({ run: false, manage: true }), 'Manages')
  // Both off is somebody who reads every report inside their access. "None" would read as a revoked
  // account to the person it describes.
  assert.equal(permissionsPhrase({ run: false, manage: false }), 'View reports')
  for (const p of EVERY) {
    assert.doesNotMatch(permissionsPhrase(p), /staff|client|admin|viewer/i, 'no role noun is ever printed')
  }
})

test('THE ACCESS CHIPS: the root reads "Everything" and leads; a single company reads last', () => {
  const chips = accessChips([
    { kind: 'company', key: 'harbour', name: 'Harbour Ltd' },
    { kind: 'organisation', key: 'birch', name: 'Birch & Co' },
  ])
  assert.deepEqual(chips.map((c) => c.label), ['Birch & Co', 'Harbour Ltd'], 'organisations before single companies')
  assert.deepEqual(chips.map((c) => c.top), [false, false])

  const root = accessChips([{ kind: 'everything', key: '*', name: 'ignored' }])
  assert.deepEqual(root.map((c) => [c.label, c.top]), [['Everything', true]],
    'the root is named by the product, never by whatever the wire put in its name field')
  // Keys are unique across kinds, so an organisation and a company that share a key cannot collide as
  // React keys and drop a chip.
  const same = accessChips([{ kind: 'organisation', key: 'acme', name: 'Acme' }, { kind: 'company', key: 'acme', name: 'Acme Ltd' }])
  assert.equal(new Set(same.map((c) => c.key)).size, 2)
})

test('THE CREATE CONTROL ASKS THE PERMISSION, never a role word', () => {
  // The rule being kept is that there is ONE derivation of Manage. The way that rule dies is a screen
  // deciding for itself at the point of the control, which is how the same person comes to be offered a
  // control on one screen and refused it on the next.
  const src = readFileSync(new URL('../src/shell/CompanyPicker.tsx', import.meta.url), 'utf8')
  const body = src
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
    .join('\n')

  // FLOOR FIRST. Every assertion after this one is about the content of a particular line; if the file
  // moved or the control was renamed, they would all pass against text that no longer contains it.
  assert.match(body, /onAdd=\{/, 'the create control is still wired here — if not, this file moved')
  assert.ok(body.length > 2000, 'the whole file was read, not a truncated or empty one')

  const controlLine = body.split('\n').find((l) => l.includes('onAdd={'))
  assert.ok(controlLine, 'the control has a wiring line')
  assert.match(controlLine, /canManage\(/, 'the control is gated on the permission')
  assert.doesNotMatch(controlLine, /\brole\b|staff/, 'and on nothing that re-derives it from a role word')
})
