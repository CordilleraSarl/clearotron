// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// How New clearance says a figure or a list in a sentence.
//
// The quote keeps its dash where it is made — `turnaround` and the engine's twin compose "1.5–2.5 hours",
// and three tests pin that spelling — so the reader's spelling is applied where it is SHOWN. These arms
// hold that the change is lossless and that it reaches the server's own copies of the quote too.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  turnaroundInWords, turnaround, joinAnd, placeInProse, nativeLanguageLine, firstAndMore, TURNAROUND_QUOTE,
} from '../src/contract/composerProduct.ts'
import { PRODUCTS } from './products.fixture.ts'

test('a quoted range reads as a reader says it, and nothing else about it changes', () => {
  assert.equal(turnaroundInWords('1.5–2.5 hours'), '1.5 to 2.5 hours')
  assert.equal(turnaroundInWords('5–10 min'), '5 to 10 min')
  assert.equal(turnaroundInWords('~10 min'), '~10 min', 'a figure with no range comes back as it went in')
  assert.equal(turnaroundInWords('same day'), 'same day')
})

test('the server\'s copies of the quote pass through the same door — no row keeps a dash', () => {
  // DRIVEN over the offering's own rows, which carry the engine's quote, rather than over a literal: a
  // product whose quote grew a different separator would show up here.
  const shown = PRODUCTS.map((p) => p.baseTurnaround).filter((q): q is string => q != null).map(turnaroundInWords)
  assert.ok(shown.length >= 4, `too few quoted rows to mean anything: ${shown.length}`)
  for (const q of shown) assert.doesNotMatch(q, /\d\s*[–-]\s*\d/, `a quote still reads as a range with a dash: ${q}`)
  // …and the browser's own composition, for both pipelines.
  const effort = (pipeline: 'knockout' | 'clearance') => ({
    levers: { pipeline, caseLaw: false, nativeLanguage: false, registerCounts: false, territories: [] },
    names: 1, classes: 1, platforms: 0, density: null,
  })
  assert.equal(turnaroundInWords(turnaround(effort('clearance'))), `${TURNAROUND_QUOTE.clearance.lowHours} to ${TURNAROUND_QUOTE.clearance.highHours} hours`)
  assert.equal(turnaroundInWords(turnaround(effort('knockout'))), '5 to 10 min')
})

test('a list reads as a sentence, and a place takes its article', () => {
  assert.equal(joinAnd([]), '')
  assert.equal(joinAnd(['A']), 'A')
  assert.equal(joinAnd(['A', 'B']), 'A and B')
  assert.equal(joinAnd(['A', 'B', 'C']), 'A, B and C')
  assert.equal(placeInProse('European Union'), 'the European Union')
  assert.equal(placeInProse('Switzerland'), 'Switzerland')
})

test('the Native language row carries on or off and the coverage, and nothing else', () => {
  assert.equal(nativeLanguageLine(true, ['European Union', 'Switzerland']),
    'On · native-language registers and marketplaces for the European Union and Switzerland',
    'the design\'s sentence, character for character')
  assert.equal(nativeLanguageLine(false, ['European Union', 'Switzerland']), 'Off', 'off names no coverage')
  for (const line of [nativeLanguageLine(true, ['France']), nativeLanguageLine(false, [])]) {
    assert.doesNotMatch(line, /hour|min|search(es)?\b/, `the row carries a duration or a count: ${line}`)
  }
})

test('a long list shows three and says how many more', () => {
  const shops = ['amazon.com', 'ebay.com', 'zalando.com', ...Array.from({ length: 10 }, (_, i) => `shop${i}.com`)]
  assert.equal(firstAndMore(shops), 'amazon.com, ebay.com, zalando.com and 10 more')
  assert.equal(firstAndMore(['a.com', 'b.com']), 'a.com and b.com', 'a short list is simply listed')
})
