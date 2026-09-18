// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The sticky bar summarises places as codes — "EU, CH" — and the codes are the ENGINE's.
//
// `TERRITORY_CODES` restates `territoryKey` from driver/territory-tiers.mjs, because this bundle cannot
// import the engine. This file asks the engine for every place the picker offers and fails on the first
// that differs, and on any place the picker offers that the table does not carry.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TERRITORY_CODES, territoryCode, territoryKeyOf, JURISDICTION_CODE_FOLD, ALL_TERRITORIES } from '../src/contract/composerProduct.ts'
import { territoryKey } from '../../driver/territory-tiers.mjs'

test('every place the picker offers has the engine\'s own code, and the table carries nothing else', () => {
  assert.ok(ALL_TERRITORIES.length >= 30, `the vocabulary is implausibly small: ${ALL_TERRITORIES.length}`)
  for (const name of ALL_TERRITORIES) {
    assert.equal(TERRITORY_CODES[name], territoryKey(name), `${name}: the bar would say ${TERRITORY_CODES[name]}, the engine says ${territoryKey(name)}`)
  }
  assert.deepEqual(Object.keys(TERRITORY_CODES).sort(), [...ALL_TERRITORIES].sort(),
    'the code table and the picker\'s vocabulary list different places')
})

test('a place the table does not know is shown as itself, never as a blank', () => {
  assert.equal(territoryCode('European Union'), 'EU')
  assert.equal(territoryCode('Atlantis'), 'Atlantis')
})

test('the key a place is compared by is the engine\'s own, whether it arrives as a name or a code', () => {
  // A register's coverage and a company's own territories meet on this key, so it must be the one the
  // engine resolves both to — or a place the engine searches is drawn as one it does not.
  const inputs = [...ALL_TERRITORIES, ...Object.values(TERRITORY_CODES), ...Object.keys(JURISDICTION_CODE_FOLD),
    ...ALL_TERRITORIES.map((n) => n.toLowerCase()), 'uk', ' us ']
  for (const x of inputs) assert.equal(territoryKeyOf(x), territoryKey(x), `${JSON.stringify(x)}: the portal keys it ${territoryKeyOf(x)}, the engine ${territoryKey(x)}`)
})
