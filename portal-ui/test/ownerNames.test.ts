// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The bug this module exists to end: one company, two names, depending on who signed in.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ALL_OWNERS, ownerNameMap, ownerNameFrom, sortOwners } from '../src/contract/ownerNames.ts'
import { switcherKeys } from '../src/shell/companyRows.ts'
import { genericFor } from '../src/contract/genericKey.ts'

test('a client and a staff member read the same company the same way', () => {
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
  // A company whose profile carries no name, a stale key, a degraded server that sent {} — all
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
  // it would render a company as nothing at all, which is the one output worse than the slug.
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
  // exists, has runs, and cannot be picked. DRIVEN, now that the rule is `switcherKeys`.
  const everything = { allAccounts: true, accounts: [], genericOrgs: [] }
  assert.deepEqual(switcherKeys(everything, [{ key: 'nameless' }, { key: 'vantor', name: 'Vantor Labs' }]), ['nameless', 'vantor'])
  // AND THE SHELL ASKS IT, with the roster, at its one call site. Only the wiring is pinned as text,
  // since AppShell cannot be mounted here.
  const shell = readFileSync(new URL('../src/shell/AppShell.tsx', import.meta.url), 'utf8')
  assert.equal(shell.match(/switcherKeys\(/g)?.length, 1, 'the shell must build its list in exactly one place')
  assert.match(shell, /switcherKeys\(me, rosterResult\?\.kind === 'ok' \? rosterResult\.value : null\)/)
  assert.doesNotMatch(shell, /Object\.keys\(names\)/, 'the menu must not be derived from the name map')
})

test('the switcher offers one Generic per organisation, and never the roster\'s own', () => {
  // The roster's `generic` names the house account, not an organisation's: offering it would send a
  // request the door has to guess the organisation for. Each organisation's Generic comes from the
  // server's `genericOrgs`, and only from there.
  const roster = [{ key: 'generic' }, { key: 'demo-brand-owner' }]
  assert.deepEqual(switcherKeys({ allAccounts: true, accounts: [], genericOrgs: ['demo-org'] }, roster),
    ['demo-brand-owner', genericFor('demo-org')])
  assert.deepEqual(switcherKeys({ allAccounts: true, accounts: [], genericOrgs: ['a', 'b'] }, roster),
    ['demo-brand-owner', genericFor('a'), genericFor('b')])
  // NO ORGANISATION, NO GENERIC: the 0.3.0-beta.1 demo's shape, whose switcher offered the company alone.
  assert.deepEqual(switcherKeys({ allAccounts: true, accounts: [], genericOrgs: [] }, roster), ['demo-brand-owner'])
  // Before the roster arrives, a person who sees everything is offered their Generics and nothing invented.
  assert.deepEqual(switcherKeys({ allAccounts: true, accounts: [], genericOrgs: ['a'] }, null), [genericFor('a')])
})

test('a person who does not see everything is offered their own companies, whatever the roster holds', () => {
  const mine = { allAccounts: false, accounts: ['vantor', 'generic'], genericOrgs: ['acme'] }
  assert.deepEqual(switcherKeys(mine, [{ key: 'vantor' }, { key: 'someone-else' }]), ['vantor', genericFor('acme')])
})
