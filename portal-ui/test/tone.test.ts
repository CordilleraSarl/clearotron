// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The band-ladder contract.
//
// This is the pin for the rule that a component may key colour, order and gauge position off `tone`
// and off the run's own ladder — never off a band LABEL. The prototype shipped a five-entry label map
// ({Low, Manageable, Medium, High, Very high}); these tests are written so that map would fail them.
//
// THE LADDERS BELOW ARE COPIED FROM REAL MANIFESTS, and that matters. An earlier version of this file
// invented fixtures ordered safest-first, which is the intuitive reading and the wrong one — the
// manifests are MOST-SEVERE-FIRST (`render.mjs:96`, `:114`). The implementation was written against
// the same wrong assumption, so the tests passed while worstBand returned the SAFEST band in a batch.
// Fixtures that agree with the code they test prove nothing; these agree with the engine.
//
// Run by node's built-in runner with type stripping (Node 22). No test framework, matching the driver.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TONES, asTone, toneColor, toneChip, bandRank, bandPosition, worstBand, type Band } from '../src/contract/tone.ts'

// house-triage, verbatim from risk-framework-triage.manifest.json. Worst FIRST.
const TRIAGE: Band[] = [
  { label: 'Very High', tone: 'severe' },
  { label: 'High', tone: 'high' },
  { label: 'Medium', tone: 'medium' },
  { label: 'Manageable', tone: 'low' },
  { label: 'Low', tone: 'minimal' },
]

// A four-stop ladder that says "Moderate" in the middle — the shape a house-default customer has.
const HOUSE: Band[] = [
  { label: 'Blocking', tone: 'severe' },
  { label: 'Elevated', tone: 'high' },
  { label: 'Moderate', tone: 'medium' },
  { label: 'Clear', tone: 'minimal' },
]

// A six-stop bespoke ladder, to prove nothing assumes five.
const BESPOKE: Band[] = [
  { label: 'Fatal', tone: 'severe' },
  { label: 'Serious', tone: 'high' },
  { label: 'Real', tone: 'medium' },
  { label: 'Some', tone: 'low' },
  { label: 'Slight', tone: 'minimal' },
  { label: 'None', tone: 'minimal' },
]

test('index 0 is the MOST SEVERE band — the manifest order, not the intuitive one', () => {
  // Stated at render.mjs:96 ("manifest index (0 = worst)") and :114 ("manifest is most-severe-first").
  // If this ever inverts, every function in tone.ts is wrong in the dangerous direction.
  for (const ladder of [TRIAGE, HOUSE, BESPOKE]) {
    assert.equal(ladder[0]!.tone, 'severe', 'the first rung is the worst one')
    assert.equal(ladder[ladder.length - 1]!.tone, 'minimal', 'the last rung is the safest one')
    assert.equal(bandRank(ladder, ladder[0]!.label), 0, 'rank 0 is the worst, so ascending sort is worst-first')
  }
})

test('colour comes from the tone, so the same label can be two different colours', () => {
  const houseModerate = HOUSE.find((b) => b.label === 'Moderate')!
  // A customer whose ladder uses "Moderate" for its worst rung — the same word, the opposite meaning.
  const inverted: Band[] = [{ label: 'Moderate', tone: 'severe' }, { label: 'Fine', tone: 'minimal' }]
  assert.notEqual(
    toneColor(houseModerate.tone),
    toneColor(inverted[0]!.tone),
    '"Moderate" is medium in one framework and severe in another — a label-keyed map cannot express that',
  )
  assert.equal(toneColor('medium'), 'var(--tone-medium)')
})

test('every tone resolves, and nothing outside the vocabulary does', () => {
  for (const t of TONES) assert.match(toneColor(t), /^var\(--tone-[a-z]+\)$/)
  assert.equal(asTone('medium'), 'medium')
  // The wire is untrusted. An unrecognised value is null — never coerced to a neighbouring tone,
  // because a fabricated risk colour on a legal document is worse than an uncoloured one.
  for (const junk of ['Medium', 'MEDIUM', 'moderate', '', null, 42, {}]) assert.equal(asTone(junk), null)
})

test('sorting ascending by rank puts the WORST band first', () => {
  const byRank = (bands: Band[]) =>
    [...bands].map((b) => b.label).sort((a, b) => bandRank(bands, a) - bandRank(bands, b))
  assert.deepEqual(byRank(HOUSE), ['Blocking', 'Elevated', 'Moderate', 'Clear'])
  assert.deepEqual(byRank(TRIAGE), ['Very High', 'High', 'Medium', 'Manageable', 'Low'])
  // "Moderate" lands between Elevated and Clear on the house ladder — not last, as an unrecognised
  // word would, and not first, as an alphabetical sort would.
  assert.equal(bandRank(HOUSE, 'Moderate'), 2)

  // An unknown label sorts last rather than throwing or landing in the middle — a row with a band the
  // ladder does not contain is a data problem, and burying it mid-list hides it.
  assert.equal(bandRank(HOUSE, 'Nonsense'), Number.MAX_SAFE_INTEGER)
  assert.equal(bandRank(HOUSE, null), Number.MAX_SAFE_INTEGER)
  // …including for a run with no ladder at all (pre-doc-50 archives).
  assert.equal(bandRank([], 'Clear'), Number.MAX_SAFE_INTEGER)
})

test('the gauge runs safest-left, which is the REVERSE of the storage order', () => {
  for (const bands of [HOUSE, TRIAGE, BESPOKE]) {
    const worst = bandPosition(bands, bands[0]!.label)!
    const safest = bandPosition(bands, bands[bands.length - 1]!.label)!
    // This is the assertion that catches the inversion: the worst band belongs on the RIGHT, matching
    // the frozen renderer's own reversal at render.mjs:114. Get it backwards and a native report and a
    // legacy report of the same run put the marker on opposite ends of the ramp.
    assert.ok(worst > safest, 'the most severe band sits at the right-hand end of the gauge')
    assert.ok(safest >= 0 && worst <= 100, 'the marker stays on the ramp')
    // strictly monotonic — no two rungs share a position
    const all = bands.map((b) => bandPosition(bands, b.label)!)
    for (let i = 1; i < all.length; i++) assert.ok(all[i]! < all[i - 1]!, `stop ${i} sits left of ${i - 1}`)
  }
  // The prototype hardcoded {10, 32, 54, 76, 94}. On a four-stop ladder those are simply wrong, and on
  // a six-stop one there are not enough of them.
  assert.notDeepEqual(HOUSE.map((b) => bandPosition(HOUSE, b.label)), [10, 32, 54, 76])
  assert.equal(bandPosition(HOUSE, 'Nonsense'), null)
  assert.equal(bandPosition([{ label: 'Only', tone: 'medium' }], 'Only'), 50, 'a one-rung ladder centres')
})

test('worstBand returns the WORST — the line on screen that would otherwise say a batch is fine', () => {
  // If this returns the safest band, a knockout batch containing a Very High name is summarised as
  // "4 names, worst: Low". That is a materially wrong statement on a legal work product, and it is the
  // exact defect an earlier version of this file shipped.
  assert.equal(worstBand(TRIAGE, ['Low', 'Medium', 'Manageable']), 'Medium')
  assert.equal(worstBand(TRIAGE, ['Low', 'Manageable', 'Very High']), 'Very High')
  assert.equal(worstBand(HOUSE, ['Clear', 'Moderate', 'Blocking']), 'Blocking')
  assert.equal(worstBand(HOUSE, ['Blocking', 'Clear']), 'Blocking', 'order of the batch does not matter')

  // A batch where a mark has not been rated: the rated ones still produce an answer, and the unrated
  // one can never BE the answer.
  assert.equal(worstBand(HOUSE, ['Clear', null]), 'Clear')
  assert.equal(worstBand(HOUSE, ['Clear', 'Nonsense']), 'Clear', 'a label off the ladder cannot win')
  assert.equal(worstBand(HOUSE, [null, null]), null, 'nothing rated ⇒ no worst, not a guessed one')
})

test('chips fall back rather than inventing a colour for the two tones that have no pair', () => {
  // minimal / medium / high have real soft+text pairs in brand.mjs.
  for (const t of ['minimal', 'medium', 'high'] as const) {
    assert.equal(toneChip(t).background, `var(--tone-${t}-soft)`)
    assert.equal(toneChip(t).color, `var(--tone-${t}-tx)`)
  }
  // low / severe never had one. They derive from the base rather than gaining two unreviewed hexes on
  // a client surface.
  for (const t of ['low', 'severe'] as const) {
    assert.match(toneChip(t).background, /color-mix/)
    assert.equal(toneChip(t).color, `var(--tone-${t})`)
  }
})
