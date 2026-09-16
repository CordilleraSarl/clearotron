// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Reading a saved search.
//
// Nothing here decides what gets billed — this screen cannot spend. What it decides is what a client is
// told a saved search IS, and the failure mode is quieter than a bug: a raw config key printed as though
// it were a product name, a version claimed that was never assigned, or a saved search silently shown as
// fine when the level underneath it has been switched off.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { statusFor, isUsable, displayLabel, versionLabel, sortSavedSearches, permittedSearchesLine } from '../src/contract/savedSearches.ts'
import type { SavedSearch } from '../src/contract/savedSearches.ts'
import type { Product } from '../src/contract/api.ts'

const lvl = (key: string, over: Partial<Product> = {}): Product => ({
  key,
  name: `Name of ${key}`,
  stage: `Stage of ${key}`,
  stageLabel: key,
  pipeline: 'clearance',
  components: [],
  maxMarks: 1,
  warnMarks: null,
  baseTurnaround: null, baseTurnaroundHours: null,
  available: true,
  unavailableNote: null,
  ...over,
})

const saved = (over: Partial<SavedSearch> = {}): SavedSearch => ({
  slug: 'launch-check',
  label: 'Launch check',
  base: 'clearotron',
  version: 3,
  ...over,
})

test('a saved search reports the base level’s STAGE label, never the stored base key', () => {
  // The report-identity rule: the stage label is the only name for this thing a client has ever been
  // shown. `base` is an internal selector that happens to read like a word.
  const levels = [lvl('clearotron', { stageLabel: 'Depth 4 — preliminary clearance' })]
  const s = statusFor(saved({ base: 'clearotron' }), levels)
  assert.equal(s.kind, 'ready')
  assert.equal(s.kind === 'ready' ? s.stageLabel : null, 'Depth 4 — preliminary clearance')
})

test('an unavailable base level is reported as unavailable, carrying the server’s own note', () => {
  // Verbatim, and from the server: it is written for a client to read and never names an internal switch.
  // Rewording it here would be the browser inventing a reason it does not have.
  const levels = [lvl('knockout', { stageLabel: 'Knockout batch', available: false, unavailableNote: 'Not switched on for this account yet.' })]
  const s = statusFor(saved({ base: 'knockout' }), levels)
  assert.equal(s.kind, 'unavailable')
  assert.equal(s.kind === 'unavailable' ? s.stageLabel : null, 'Knockout batch')
  assert.equal(s.kind === 'unavailable' ? s.note : null, 'Not switched on for this account yet.')
})

test('an unavailable level with no note stays null rather than acquiring a made-up reason', () => {
  const levels = [lvl('knockout', { available: false, unavailableNote: null })]
  const s = statusFor(saved({ base: 'knockout' }), levels)
  assert.equal(s.kind, 'unavailable')
  assert.equal(s.kind === 'unavailable' ? s.note : 'invented', null)
})

test('a base that has drifted past the registry is its OWN state — the key never leaks as a label', () => {
  // Stored recipe config can outlive a level. The one-line fallback (`level?.stageLabel ?? recipe.base`)
  // fires only in this branch, which means the only time it would ever print the raw key is the one time
  // nothing has vetted that key as fit to show a client.
  const s = statusFor(saved({ base: 'prelim-jx-legacy' }), [lvl('clearotron')])
  assert.equal(s.kind, 'unknownBase')
  assert.equal(JSON.stringify(s).includes('prelim-jx-legacy'), false, 'the stored base key is not carried into the display state')
})

test('an empty registry makes every saved search unknown-base rather than ready by default', () => {
  // The opposite of the level list's own degradation rule, and deliberately so. A missing `available`
  // flag reads as available because an older server must not grey out the whole menu; a base that
  // resolves to NOTHING is a different fact, and guessing "fine" there would show a client a saved
  // search built on a level this deployment has no record of.
  assert.equal(statusFor(saved(), []).kind, 'unknownBase')
})

test('usable means the base level resolves AND is switched on — nothing weaker', () => {
  assert.equal(isUsable({ kind: 'ready', stageLabel: 'Depth 4' }), true)
  assert.equal(isUsable({ kind: 'unavailable', stageLabel: 'Depth 4', note: null }), false)
  assert.equal(isUsable({ kind: 'unknownBase' }), false)
})

test('a blank label falls back to a placeholder, never to the stored slug', () => {
  // The slug is the key half of `account/slug`. Substituting it for a missing label is how a key ends up
  // in front of a client through the back door.
  assert.equal(displayLabel(saved({ label: 'Launch check' })), 'Launch check')
  assert.equal(displayLabel(saved({ label: '   ' })), 'Untitled template')
  assert.equal(displayLabel(saved({ label: '', slug: 'launch-check' })), 'Untitled template')
})

test('a version is shown only when one was actually assigned — no defaulting to v1', () => {
  // The engine reads an absent version as 1 for hashing, but that is a way of comparing two copies of a
  // record, not a claim about its history. "v1" on screen makes never-versioned and first-version
  // indistinguishable, which is the exact distinction this column exists to make.
  assert.equal(versionLabel(saved({ version: 3 })), 'v3')
  assert.equal(versionLabel(saved({ version: 1 })), 'v1')
  assert.equal(versionLabel(saved({ version: null })), null)
})

test('the list sorts by label, case-insensitively, and does NOT float the broken ones', () => {
  // Sorting by status moves a saved search away from where its owner looks for it by name, on a
  // condition that changes under them without anything they did. Every row states its own status.
  const rows = [
    saved({ slug: 'z', label: 'zeta check', base: 'gone' }),
    saved({ slug: 'a', label: 'Alpha check' }),
    saved({ slug: 'm', label: 'moon check' }),
  ]
  assert.deepEqual(sortSavedSearches(rows).map((r) => r.slug), ['a', 'm', 'z'])
})

test('labels are not unique, so the slug breaks ties and the order stops shuffling', () => {
  // Only the slug is a key. Two saved searches really can share a label, and without a tiebreak the
  // list would reorder itself between renders for no reason a user could see.
  const rows = [saved({ slug: 'later', label: 'Launch check' }), saved({ slug: 'earlier', label: 'Launch check' })]
  assert.deepEqual(sortSavedSearches(rows).map((r) => r.slug), ['earlier', 'later'])
})

test('sorting copies rather than reordering the caller’s array in place', () => {
  const rows = [saved({ slug: 'b', label: 'Beta' }), saved({ slug: 'a', label: 'Alpha' })]
  sortSavedSearches(rows)
  assert.deepEqual(rows.map((r) => r.slug), ['b', 'a'], 'the decoded response is not the sort’s scratch space')
})


test('a status leads with the level NAME and carries its stage beside it', () => {
  // Ruling 2026-07-20: the interface leads with the NAME of a search and carries the stage
  // beside it. This row is a comparison of the products a client has configured, so it keeps both.
  const ready = statusFor(saved({ base: 'clearotron' }), [lvl('clearotron')])
  assert.equal(ready.kind, 'ready')
  assert.equal(ready.kind === 'ready' && ready.name, 'Name of clearotron')
  // stageLabel survives as the degradation fallback, never as the thing rendered first.
  assert.equal(ready.kind === 'ready' && ready.stageLabel, 'clearotron')
})

test('an unavailable status is named too — a client cannot act on a number', () => {
  const s = statusFor(saved({ base: 'clearotron' }), [lvl('clearotron', { available: false, unavailableNote: 'Not part of the current release.' })])
  assert.equal(s.kind, 'unavailable')
  assert.equal(s.kind === 'unavailable' && s.name, 'Name of clearotron')
  assert.equal(s.kind === 'unavailable' && s.note, 'Not part of the current release.')
})

test('an older server that sends no name degrades to the label, never to a blank', () => {
  // The wire rule everywhere: `name || stageLabel`. A blank product name on a screen that spends money
  // is worse than an out-of-date one.
  const s = statusFor(saved({ base: 'clearotron' }), [lvl('clearotron', { name: '', stage: '' })])
  assert.equal(s.kind === 'ready' && s.name, 'clearotron')
})

// ── Permitted searches, on Profile ──────────────────────────────────────────────────────────────────

const LISTING = [
  saved({ slug: 'launch-screen', label: 'Launch screen' }),
  saved({ slug: 'eu-shelf-refresh', label: 'EU shelf refresh' }),
  saved({ slug: 'unnamed-one', label: '   ' }),
]
const REGISTRY = [lvl('global-preliminary-search', { name: 'Global preliminary search' })]

test('PERMITTED SEARCHES reads in the names Search templates prints, in the order they are stored', () => {
  // The row printed the stored keys — "launch-screen, eu-shelf-refresh" — which a reader meets nowhere
  // else. Resolved through the same listing Search templates draws, it says what that page says.
  assert.equal(permittedSearchesLine(['launch-screen', 'eu-shelf-refresh'], 'northwind', LISTING, REGISTRY),
    'Launch screen, EU shelf refresh')
  // A product key is named by the registry, and a company-qualified key by its own company's template.
  assert.equal(permittedSearchesLine(['global-preliminary-search', 'northwind/eu-shelf-refresh'], 'northwind', LISTING, REGISTRY),
    'Global preliminary search, EU shelf refresh')
  // One template reached two ways is one name, not two.
  assert.equal(permittedSearchesLine(['launch-screen', 'northwind/launch-screen'], 'northwind', LISTING, REGISTRY), 'Launch screen')
  // A blank label reads as the listing's placeholder, never as its slug — the same rule the list keeps.
  assert.equal(permittedSearchesLine(['unnamed-one'], 'northwind', LISTING, REGISTRY), 'Untitled template')
})

test('an entry nothing names is COUNTED, and its key is never printed', () => {
  // Made after the profile, or another company's: either way the key is the thing that must not reach a
  // reader. Another company's slug must not borrow this company's template of the same name, either.
  const line = permittedSearchesLine(['launch-screen', 'not-made-yet', 'othercorp/launch-screen'], 'northwind', LISTING, REGISTRY)
  assert.equal(line, 'Launch screen, and 2 searches not on Search templates')
  for (const key of ['not-made-yet', 'othercorp', 'launch-screen']) assert.ok(!line.includes(key), `the key ${key} reached the row`)
  assert.equal(permittedSearchesLine(['not-made-yet'], 'northwind', LISTING, REGISTRY), '1 search not on Search templates')
})

test('a listing that could not be read is not reported as templates that do not exist', () => {
  // THE CONTROL for the count above: null means nobody saw the list, and "not on Search templates" would
  // be a claim about a page the screen never read. Product keys still resolve from the registry.
  assert.equal(permittedSearchesLine(['global-preliminary-search', 'launch-screen'], 'northwind', null, REGISTRY),
    'Global preliminary search, and 1 search that could not be named just now')
})

test('no permitted searches on file reads as a dash, not as an empty row', () => {
  assert.equal(permittedSearchesLine(undefined, 'northwind', LISTING, REGISTRY), '—')
  assert.equal(permittedSearchesLine([], 'northwind', LISTING, REGISTRY), '—')
})
