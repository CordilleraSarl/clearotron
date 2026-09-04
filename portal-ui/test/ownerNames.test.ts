// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The bug this module exists to end: one brand owner, two names, depending on who signed in.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ALL_OWNERS, ownerNameMap, ownerNameFrom, sortOwners } from '../src/contract/ownerNames.ts'

test('a client and a staff member read the same brand owner the same way', () => {
  // The client's own grants, named by /portal/api/me…
  const asClient = ownerNameMap({ 'vantor': 'Vantor Labs' }, [])
  // …and the staff view of the same customer, named by the roster.
  const asStaff = ownerNameMap({}, [{ key: 'vantor', name: 'Vantor Labs' }, { key: 'aurora', name: 'Aurora Interactive' }])

  assert.equal(ownerNameFrom(asClient, 'vantor'), 'Vantor Labs')
  assert.equal(ownerNameFrom(asStaff, 'vantor'), 'Vantor Labs')
  assert.equal(
    ownerNameFrom(asClient, 'vantor'),
    ownerNameFrom(asStaff, 'vantor'),
    'the whole point: the label cannot depend on the login',
  )
})

test('an unknown key reads as itself, and nothing ever renders blank', () => {
  const names = ownerNameMap({ aurora: 'Aurora Interactive' }, [])
  // A brand owner whose profile carries no name, a stale key, a degraded server that sent {} — all
  // the same answer, and it is always something a person can act on.
  assert.equal(ownerNameFrom(names, 'zephyr'), 'zephyr')
  assert.equal(ownerNameFrom({}, 'zephyr'), 'zephyr')
  assert.equal(ownerNameFrom(names, null), ALL_OWNERS)
  for (const k of ['zephyr', 'aurora', null]) assert.notEqual(ownerNameFrom(names, k), '')
})

test('a de-slugged key is never invented', () => {
  // "vantor" → "Vantor Labs" is a guess, and it is a guess about a client's own name. The
  // profile store knows the answer; when it has not said, the key is shown as it is.
  assert.equal(ownerNameFrom({}, 'vantor'), 'vantor')
  assert.equal(ownerNameFrom({}, 'lumenwake'), 'lumenwake')
})

test('an empty name is a miss, not a name', () => {
  // Both sources can carry one — a profile with `"name": ""`, or a roster row built from it. Storing
  // it would render a brand owner as nothing at all, which is the one output worse than the slug.
  const names = ownerNameMap({ aurora: '' }, [{ key: 'zephyr', name: '' }])
  assert.deepEqual(names, {})
  assert.equal(ownerNameFrom(names, 'aurora'), 'aurora')
})

test('the roster wins where both sources answer, which is only ever for staff', () => {
  const names = ownerNameMap({ aurora: 'stale' }, [{ key: 'aurora', name: 'Aurora Interactive' }])
  assert.equal(ownerNameFrom(names, 'aurora'), 'Aurora Interactive')
})

test('the switcher is ordered by what is read, not by what is stored', () => {
  const names = ownerNameMap({}, [
    { key: 'vantor', name: 'Vantor Labs' },
    { key: 'aurora', name: 'Zephyr Beverages' },   // deliberately at odds with its key
    { key: 'zephyr', name: 'Aurora Interactive' },
  ])
  assert.deepEqual(
    sortOwners(names, ['vantor', 'aurora', 'zephyr']).map((o) => o.name),
    ['Aurora Interactive', 'Vantor Labs', 'Zephyr Beverages'],
  )
  // The KEY is what every request is keyed by and it rides along untouched — sorting must never be a
  // step that quietly renames anything.
  // `aurora` is named "Zephyr Beverages" here, so it sorts LAST — by its name, carrying its own key.
  assert.deepEqual(sortOwners(names, ['vantor', 'aurora']).map((o) => o.key), ['vantor', 'aurora'])
})

test('a nameless account is still offered in the switcher', () => {
  // The menu comes from the roster's KEYS, never from the keys of the name map. Deriving it from the
  // map would make an account whose profile has no name silently unselectable — a customer that
  // exists, has runs, and cannot be picked. Pinned as text, since AppShell cannot be mounted here.
  const shell = readFileSync(new URL('../src/shell/AppShell.tsx', import.meta.url), 'utf8')
  assert.match(shell, /rosterResult\?\.kind === 'ok' \? rosterResult\.value\.map\(\(c\) => c\.key\)/)
  assert.doesNotMatch(shell, /Object\.keys\(names\)/, 'the menu must not be derived from the name map')
})
