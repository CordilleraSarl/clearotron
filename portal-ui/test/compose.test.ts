// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Composing a search request.
//
// These functions decide what gets billed: which names are searched, and against which classes. A
// mistake here does not look like a bug — it looks like a finished report that quietly covered less
// than the user asked for.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseNames, parseClasses, resolveProduct, isSendable } from '../src/contract/compose.ts'
import type { Product } from '../src/contract/api.ts'

const lvl = (key: string, over: Partial<Product> = {}): Product => ({
  key,
  stageLabel: key,
  pipeline: 'clearance',
  components: [],
  geography: 'worldwide, and nothing else',
  caseLaw: false, nativeLanguage: 'absent',
  maxNames: 1,
  baseTurnaround: null, baseTurnaroundHours: null, orderable: true,
  available: true,
  unavailableNote: null,
  ...over,
})

test('names split on newlines AND commas, because both are what people type', () => {
  assert.deepEqual(parseNames('AQUAPLUS'), ['AQUAPLUS'])
  assert.deepEqual(parseNames('ALPHA\nBETA\nGAMMA'), ['ALPHA', 'BETA', 'GAMMA'])
  assert.deepEqual(parseNames('ALPHA, BETA,GAMMA'), ['ALPHA', 'BETA', 'GAMMA'])
  assert.deepEqual(parseNames('ALPHA,\n\nBETA,  \n'), ['ALPHA', 'BETA'], 'trailing commas and blank lines are not errors')
  assert.deepEqual(parseNames('   '), [])
})

test('names are NOT deduplicated or case-folded — a near-collision is the server’s to report', () => {
  // The server rejects names that collide after kebab-casing, BY NAME. Merging them here would spend a
  // search on a set the user never asked for and hide why the batch looked wrong.
  assert.deepEqual(parseNames('AquaPlus, AQUAPLUS'), ['AquaPlus', 'AQUAPLUS'])
  assert.deepEqual(parseNames('AQUA PLUS\nAQUAPLUS'), ['AQUA PLUS', 'AQUAPLUS'], 'internal spacing is meaningful')
})

test('classes drop anything outside 1–45 rather than sending it to be rejected', () => {
  assert.deepEqual(parseClasses('9, 42'), [9, 42])
  assert.deepEqual(parseClasses('9 42'), [9, 42])
  assert.deepEqual(parseClasses('0, 46, 99'), [], 'out of range is not a class')
  assert.deepEqual(parseClasses('nine, 9'), [9], 'a word is not a class')
  assert.deepEqual(parseClasses('9.5'), [], 'a fraction is not a class')
  assert.deepEqual(parseClasses(''), [])
})

test('classes collapse duplicates and sort — asking for 9 twice is not asking for more', () => {
  assert.deepEqual(parseClasses('9, 9, 42, 9'), [9, 42])
  assert.deepEqual(parseClasses('42, 9'), [9, 42])
})

test('an unavailable product falls back to the first available one, never to a deeper one', () => {
  // Offering order is lightest first. Guessing UPWARD would silently pick a more expensive search than
  // the user chose — the exact silent substitution the engine's own gate exists to forbid.
  const levels = [
    lvl('knockout-search', { available: false, unavailableNote: 'Not part of the current release.' }),
    lvl('global-preliminary-search'),
    lvl('full-country-search'),
  ]
  assert.equal(resolveProduct(levels, 'knockout-search'), 'global-preliminary-search')
  assert.equal(resolveProduct(levels, 'full-country-search'), 'full-country-search', 'an available choice is left alone')
  assert.equal(resolveProduct(levels, 'nonsense'), 'global-preliminary-search', 'an unknown key resolves rather than sticking')
  // NOTHING PICKED STAYS NOTHING. There is no default search on this screen — a search nobody chose is
  // what the whole build exists to stop — so an absent choice is not something to resolve.
  assert.equal(resolveProduct(levels, null), null)
})

test('with nothing available, resolveProduct says so instead of inventing one', () => {
  const levels = [lvl('knockout-search', { available: false }), lvl('global-preliminary-search', { available: false })]
  assert.equal(resolveProduct(levels, 'global-preliminary-search'), null)
  assert.equal(resolveProduct([], 'global-preliminary-search'), null)
})

test('sendable requires a name, a class, goods, and a level that can actually run', () => {
  const base = { names: ['AQUAPLUS'], classes: [9], goods: 'software', level: lvl('global-preliminary-search') }
  assert.equal(isSendable(base), true)
  assert.equal(isSendable({ ...base, names: [] }), false)
  assert.equal(isSendable({ ...base, classes: [] }), false)
  assert.equal(isSendable({ ...base, goods: '   ' }), false, 'whitespace is not a description')
  assert.equal(isSendable({ ...base, level: null }), false)
  assert.equal(isSendable({ ...base, level: lvl('knockout-search', { available: false }) }), false,
    'an unavailable level can never be sent, whatever else is filled in')
})

test('a batch over the product’s limit is not sendable — the limit is the OFFERING’s, not a constant', () => {
  const five = ['A', 'B', 'C', 'D', 'E']
  assert.equal(isSendable({ names: five, classes: [9], goods: 'software', level: lvl('global-preliminary-search') }), false,
    'a clearance reads one name')
  assert.equal(isSendable({ names: five, classes: [9], goods: 'software', level: lvl('knockout-search', { maxNames: 8, pipeline: 'knockout' }) }), true,
    'a Knockout search reads eight')
})
