// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE CLEARANCES LIST SAYS WHICH KIND OF SEARCH STANDS BEHIND A NAME, AND FILTERS BY IT.
//
// A knockout and a global preliminary search used to look the same on the list: one row per name, with
// nothing on it saying which search produced the risk beside it, and no way to ask for every knockout. Each
// row now carries a tag per kind of search behind it ("KO", "Prelim", "Multi", "Full"), and a filter beside
// the status filter narrows to one kind.
//
// Two rules are easy to break and each is a defect on sight. The tags are the REGISTRY's, read from the file
// minted from it, so the page cannot show a tag its report does not carry. And a level narrows the SEARCHES,
// not the names: under KO, a name with a knockout and a later full country search must show the knockout's
// result, never the full search's risk beside a KO filter.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import LEVEL_TAGS from '../../shared/search-level-tags.json' with { type: 'json' }
import { SEARCH_LEVELS, atLevel, levelOf, levelsOf } from '../src/contract/levelTags.ts'
import { marksOf, NO_FAMILIES } from '../src/contract/grouping.ts'
import type { Run } from '../src/contract/api.ts'

const run = (over: Partial<Run> & { runId: string }): Run => ({
  account: 'demo-brand-owner',
  title: 'AquaPlus',
  markName: 'AquaPlus',
  product: null,
  stageLabel: null,
  kind: 'clearance',
  state: 'delivered',
  date: '2026-07-01',
  issuedAt: null,
  band: null,
  tone: null,
  bands: [],
  marks: [],
  reportSchema: null,
  held: false,
  report: null,
  step: null,
  stepN: null,
  stepTotal: null,
  reason: null,
  failedStage: null,
  ...over,
})

test('the four tags, their full names and their order are the registry file, read as it is', () => {
  assert.deepEqual(SEARCH_LEVELS, LEVEL_TAGS.levels, 'the page keeps a list of its own again')
  assert.deepEqual(SEARCH_LEVELS.map((l) => l.tag), ['KO', 'Prelim', 'Multi', 'Full'])
  assert.deepEqual(SEARCH_LEVELS.map((l) => l.name),
    ['Knockout search', 'Global preliminary search', 'Multi-country focus search', 'Full country search'])
})

test('a tag follows the product the search ran as; a retired or missing product has none', () => {
  assert.equal(levelOf({ product: 'knockout-search' })?.tag, 'KO')
  assert.equal(levelOf({ product: 'full-country-search' })?.name, 'Full country search')
  assert.equal(levelOf({ product: 'clearance' }), null, 'a retired product is given a tag it never had')
  assert.equal(levelOf({ product: null }), null)
})

test('a row shows each kind of search once, in the registry order, whatever order they ran in', () => {
  const tags = levelsOf([
    { product: 'full-country-search' },
    { product: 'knockout-search' },
    { product: 'knockout-search' },
    { product: 'clearance' },
  ]).map((l) => l.tag)
  assert.deepEqual(tags, ['KO', 'Full'], 'two knockouts show KO once, the retired search shows nothing, and KO leads')
  assert.deepEqual(levelsOf([{ product: 'clearance' }, { product: null }]), [], 'searches with no tag show no tag line')
})

test('under All every search is kept; under a level only its own, and a retired one only under All', () => {
  assert.equal(atLevel({ product: 'clearance' }, 'all'), true)
  assert.equal(atLevel({ product: 'knockout-search' }, 'knockout-search'), true)
  assert.equal(atLevel({ product: 'full-country-search' }, 'knockout-search'), false)
  for (const l of SEARCH_LEVELS) assert.equal(atLevel({ product: 'clearance' }, l.product), false, `a retired search shows under ${l.tag}`)
})

test('under KO a name keeps only its knockout: the row shows the knockout, not the later full search', () => {
  const runs = [
    run({ runId: 'ko', product: 'knockout-search', date: '2026-09-29', band: 'High' }),
    run({ runId: 'full', product: 'full-country-search', date: '2026-10-14', band: 'Manageable' }),
    run({ runId: 'other', title: 'Other', markName: 'Other', product: 'global-preliminary-search', date: '2026-10-01' }),
  ]
  const all = marksOf(runs, NO_FAMILIES)
  const both = all.find((m) => m.reads.some((r) => r.runId === 'ko'))
  assert.equal(both?.current.runId, 'full', 'under All the name speaks for its latest search')
  assert.deepEqual(levelsOf(both?.reads ?? []).map((l) => l.tag), ['KO', 'Full'])

  const ko = marksOf(runs.filter((r) => atLevel(r, 'knockout-search')), NO_FAMILIES)
  assert.equal(ko.length, 1, 'a name with no knockout stays on the list under KO')
  assert.equal(ko[0]?.current.runId, 'ko', 'under KO the row speaks for a search that is not a knockout')
  assert.equal(ko[0]?.current.band, 'High')
  assert.deepEqual(levelsOf(ko[0]?.reads ?? []).map((l) => l.tag), ['KO'], 'under KO the row still tags the full search')
})
