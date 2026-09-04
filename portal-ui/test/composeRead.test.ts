// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// composeRead.test.ts — what a read is allowed to do to a draft.
//
// The rule every test here defends is FILL, NEVER CLEAR. Someone types three names, pastes a brief
// that mentions one, presses Read this — and must not find two names gone. There is no undo on this
// screen, so a form filler that deletes work is worse than no form filler at all.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { resolveRead, resolveTerritory, applyRead, appliedNotes, EMPTY_READ, type ReadTarget } from '../src/contract/composeRead.ts'
import { EMPTY_DRAFT } from '../src/contract/composerProduct.ts'

const EMPTY_TARGET: ReadTarget = {
  draft: EMPTY_DRAFT, names: '', classes: null, goods: '', ref: '', deadline: '',
}

const read = (patch: Partial<typeof EMPTY_READ>) => ({ ...EMPTY_READ, ...patch })

// ── vocabulary ─────────────────────────────────────────────────────────────────────────────────────
test('resolveTerritory: tolerant of case and punctuation, never fuzzy', () => {
  assert.equal(resolveTerritory('United States'), 'United States')
  assert.equal(resolveTerritory('united states'), 'United States')
  assert.equal(resolveTerritory('african regional (aripo)'), 'African Regional (ARIPO)')
  // Not talked into Germany. A territory the user did not choose and did not see chosen is a
  // territory they pay to search.
  assert.equal(resolveTerritory('Bavaria'), null)
  assert.equal(resolveTerritory('US'), null, 'an alias is for the TYPEAHEAD; the model was given the full list')
})

test('resolveRead: what cannot be placed is reported, not swallowed', () => {
  const { read: r, dropped } = resolveRead(read({ territories: ['France', 'Bavaria', 'Atlantis'] }))
  assert.deepEqual(r.territories, ['France'])
  assert.deepEqual(dropped, ['Bavaria', 'Atlantis'], 'the screen owns up to its own limits')
})

test('resolveRead: Worldwide is the EMPTY list, and loses to a specific country', () => {
  assert.deepEqual(resolveRead(read({ territories: ['Worldwide'] })).read.territories, [])
  assert.deepEqual(resolveRead(read({ territories: ['Worldwide', 'France'] })).read.territories, ['France'],
    'hedging resolves to the specific claim — the broad one is what empty already means')
  // …and the same two cases, now carrying the answer to the question the empty list cannot answer:
  // "the brief said everywhere" and "the brief said nothing" are both [], and they mean opposite
  // things to a draft that already names France. THE HEDGE RULE IS UNCHANGED — only a lone claim counts.
  assert.equal(resolveRead(read({ territories: ['Worldwide'] })).worldwide, true)
  assert.equal(resolveRead(read({ territories: ['Worldwide', 'France'] })).worldwide, false, 'a hedge is not a claim')
  assert.equal(resolveRead(read({ territories: [] })).worldwide, false, 'and silence is not one either')
  assert.equal(resolveRead(read({ territories: ['France'] })).worldwide, false)
})

test('resolveRead: a worldwide claim survives the model naming something unplaceable beside it', () => {
  // Nothing this composer offers is left, so worldwide IS the surviving claim — and Bavaria is still
  // owned up to rather than swallowed. Both halves matter: one decides the scope, one is the receipt.
  const r = resolveRead(read({ territories: ['Worldwide', 'Bavaria'] }))
  assert.equal(r.worldwide, true)
  assert.deepEqual(r.read.territories, [])
  assert.deepEqual(r.dropped, ['Bavaria'])
})

test('resolveRead: classes outside 1..45 and duplicate territories cannot survive', () => {
  const { read: r } = resolveRead(read({ classes: [9, 9, 46, 0], territories: ['France', 'france'] }))
  assert.deepEqual(r.classes, [9])
  assert.deepEqual(r.territories, ['France'])
})

// ── fill, never clear ──────────────────────────────────────────────────────────────────────────────
test('applyRead: a silent field leaves the user’s own work exactly where it was', () => {
  const typed: ReadTarget = { ...EMPTY_TARGET, names: 'LUMEN\nLUMENA\nLUMINA', goods: 'candles', ref: 'M-1', deadline: '2026-09-01' }
  const after = applyRead(typed, EMPTY_READ)
  assert.equal(after.names, 'LUMEN\nLUMENA\nLUMINA', 'THE regression this file exists for')
  assert.equal(after.goods, 'candles')
  assert.equal(after.ref, 'M-1')
  assert.equal(after.deadline, '2026-09-01')
})

test('applyRead: classes EXTEND the draft rather than replacing it', () => {
  // Same rule as adding a class by hand: the inherited classes are the owner's floor, not a suggestion.
  const after = applyRead({ ...EMPTY_TARGET, classes: [25] }, read({ classes: [32, 25] }))
  assert.deepEqual(after.classes, [25, 32], 'existing first, new appended, no duplicate')
})

test('applyRead: a ghost class list stays a ghost when the brief adds nothing to it', () => {
  // null means "use the brand owner's own" — the composer sends no `classes` at all and the server's
  // precedence ladder resolves it. A read that mentions no goods must not turn that into [].
  assert.equal(applyRead(EMPTY_TARGET, EMPTY_READ, [5, 32]).classes, null)
  // Nor may a read that names only what the owner already carries. Nothing on screen changed, and
  // freezing today's profile into the request would mean a class added to the brand owner tomorrow
  // silently does not apply to a search composed today.
  assert.equal(applyRead(EMPTY_TARGET, read({ classes: [32] }), [5, 32]).classes, null)
})

test('applyRead: materialising a ghost starts from the OWNER’S classes, never from empty', () => {
  // Caught in a real browser, not here: the read named class 32, the owner carried 5 and 32, and the
  // form came back with 32 alone. Class 5 was not refused or reported — the chip simply stopped being
  // there, and the search would have run narrower than the account is set up for.
  assert.deepEqual(applyRead(EMPTY_TARGET, read({ classes: [9] }), [5, 32]).classes, [5, 32, 9])
  // An explicit list the user already edited wins over the inherited one — they have overridden it.
  assert.deepEqual(applyRead({ ...EMPTY_TARGET, classes: [25] }, read({ classes: [9] }), [5, 32]).classes, [25, 9])
})

test('appliedNotes: a class the owner already carried is not reported as something the brief added', () => {
  const after = applyRead(EMPTY_TARGET, read({ classes: [32, 9] }), [5, 32])
  assert.deepEqual(appliedNotes(EMPTY_TARGET, after, [5, 32]), ['Class 9 · Electrical & software'],
    'a receipt for work that did not happen is worse than no receipt')
})

test('applyRead: territories extend', () => {
  const withOne: ReadTarget = { ...EMPTY_TARGET, draft: { ...EMPTY_DRAFT, territories: ['France'] } }
  const after = applyRead(withOne, read({ territories: ['Germany'] }))
  assert.deepEqual([...after.draft.territories], ['France', 'Germany'])
})

test('applyRead: a named PRODUCT is overwritten; SILENCE leaves the choice alone', () => {
  // The brief is usually explicit about which search it wants ("just the obvious blockers"), and the
  // screen states the product it lands on, so the change is never silent. A brief that says nothing
  // must not pick one: null is silence, and silence is neither "the cheapest" nor "the deepest".
  assert.equal(applyRead(EMPTY_TARGET, read({ product: 'knockout-search' })).draft.product, 'knockout-search')
  const already: ReadTarget = { ...EMPTY_TARGET, draft: { ...EMPTY_DRAFT, product: 'full-country-search' } }
  assert.equal(applyRead(already, read({ product: null })).draft.product, 'full-country-search')
})

// ── the ONE deliberate exception ────────────────────────────────────────────────────────────────────
//
// A brief that says "worldwide" over a draft holding France used to be dropped on the floor: worldwide
// is the empty list, the reader could not express it, and applyRead had no path to []. Silent, with no
// line in the receipt to notice. It is the only instruction allowed to remove something the user chose,
// and everything below is the fence around it.

test('applyRead: an explicit worldwide claim CLEARS the territories — the exception, stated', () => {
  const withFrance: ReadTarget = { ...EMPTY_TARGET, draft: { ...EMPTY_DRAFT, territories: ['France', 'Germany'] } }
  const after = applyRead(withFrance, read({ territories: [] }), [], { worldwide: true })
  assert.deepEqual([...after.draft.territories], [], 'everywhere is spelled as no chips at all')
})

test('applyRead: model SILENCE still never clears — fill-never-clear is the rule, not the exception', () => {
  const withFrance: ReadTarget = { ...EMPTY_TARGET, draft: { ...EMPTY_DRAFT, territories: ['France'] } }
  // No flag at all — the shape every other caller uses.
  assert.deepEqual([...applyRead(withFrance, EMPTY_READ).draft.territories], ['France'])
  // …and an explicit false, which is what a hedged "everywhere, France" resolves to.
  assert.deepEqual([...applyRead(withFrance, EMPTY_READ, [], { worldwide: false }).draft.territories], ['France'])
})

test('applyRead: a named territory beside the flag WINS — the clear only happens with nothing to add', () => {
  // resolveRead never produces this pair (a hedge resolves the flag to false), so it is belt and
  // braces: even given both, the specific claim is the one that reaches the form.
  const withFrance: ReadTarget = { ...EMPTY_TARGET, draft: { ...EMPTY_DRAFT, territories: ['France'] } }
  const after = applyRead(withFrance, read({ territories: ['Japan'] }), [], { worldwide: true })
  assert.deepEqual([...after.draft.territories], ['France', 'Japan'])
})

test('appliedNotes: the clear is a RECEIPT LINE — a scope that changed silently is the whole defect', () => {
  const withFrance: ReadTarget = { ...EMPTY_TARGET, draft: { ...EMPTY_DRAFT, territories: ['France'] } }
  const after = applyRead(withFrance, read({ names: ['LUMEN'] }), [], { worldwide: true })
  assert.deepEqual(appliedNotes(withFrance, after), [
    'LUMEN — the mark',
    'Worldwide — the named territories were cleared',
  ])
})

test('appliedNotes: worldwide over a draft that was ALREADY worldwide says nothing', () => {
  // Same rule as the product line: a receipt reports what moved. The draft has no chips before or
  // after, so there is nothing to report — and "nothing applied" is a state the screen words itself.
  const after = applyRead(EMPTY_TARGET, EMPTY_READ, [], { worldwide: true })
  assert.deepEqual([...after.draft.territories], [])
  assert.deepEqual(appliedNotes(EMPTY_TARGET, after), [])
})

test('applyRead: the native-language investigation is never turned on by a read', () => {
  // It is the most expensive thing on the screen, and on the one product that offers it as a choice,
  // choosing is the client's. A read cannot switch it on, and it does not switch one off either.
  assert.equal(applyRead(EMPTY_TARGET, read({ names: ['X'] })).draft.nativeLanguage, false)
  const asked: ReadTarget = { ...EMPTY_TARGET, draft: { ...EMPTY_DRAFT, nativeLanguage: true } }
  assert.equal(applyRead(asked, read({ names: ['X'] })).draft.nativeLanguage, true)
})

// ── the receipt ────────────────────────────────────────────────────────────────────────────────────
const MENU = [
  { key: 'knockout-search', name: 'Knockout search' },
  { key: 'full-country-search', name: 'Full country search' },
] as unknown as Parameters<typeof appliedNotes>[3]

test('appliedNotes: every line is a fact about the screen, derived from the diff', () => {
  const before = EMPTY_TARGET
  const after = applyRead(before, read({
    names: ['AQUAPLUS'], classes: [32], goods: 'energy drinks', territories: ['United States'],
    product: 'knockout-search', deadline: '2026-07-24',
  }))
  const notes = appliedNotes(before, after, [], MENU)
  assert.deepEqual(notes, [
    'AQUAPLUS — the mark',
    'Class 32 · Non-alcoholic drinks',
    'Goods — energy drinks',
    'United States',
    'Knockout search',
    'Deadline 2026-07-24',
  ])
})

test('appliedNotes: the product line appears only when the product MOVED, and is NAMED BY THE OFFERING', () => {
  const before = EMPTY_TARGET
  const same = applyRead(before, read({ names: ['X'] }))
  assert.deepEqual(appliedNotes(before, same, [], MENU), ['X — the mark'],
    'a product line beside an unchanged choice is noise')
  const moved = applyRead(before, read({ product: 'full-country-search' }))
  assert.deepEqual(appliedNotes(before, moved, [], MENU), ['Full country search'],
    'the OFFERING supplies the words — a second description here is a second thing that can drift')
  // A key this bundle has not been told about degrades to the key rather than to an invented sentence:
  // an older server naming a product the browser does not carry must not be described from thin air.
  const unknown = applyRead(before, read({ product: 'something-else' }))
  assert.deepEqual(appliedNotes(before, unknown, [], MENU), ['something-else'])
})

test('appliedNotes: nothing applied ⇒ no lines (the screen says so in its own words)', () => {
  assert.deepEqual(appliedNotes(EMPTY_TARGET, applyRead(EMPTY_TARGET, EMPTY_READ)), [])
})

test('appliedNotes: several names are counted and listed', () => {
  const after = applyRead(EMPTY_TARGET, read({ names: ['LUMEN', 'LUMENA'] }))
  assert.deepEqual(appliedNotes(EMPTY_TARGET, after), ['2 names — LUMEN, LUMENA'])
})
