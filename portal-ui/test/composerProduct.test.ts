// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// composerProduct.test.ts — WHICH PRODUCT the composer is buying, and where it points.
//
// This replaced the levers test, and what it stopped pinning is as important as what it pins. There is
// no `deriveMode`, no `deriveLevelKey`, no `tierLabel`, no template matcher and no script-lane routing,
// because none of those exist: the requester picks one of four products off the wire, and the geography
// control is a different control per product rather than one control that sometimes refuses.
//
// The rules below are the OFFERING's, mirrored (driver/products.mjs is the wall). What this file has to
// hold is that the mirror never OFFERS a shape the wall refuses — which is the failure mode a composer
// has: enforcement without an invitation, and its inverse.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  EMPTY_DRAFT, REGIONS, COUNTRIES, tierOf, vocabularyFor, territoryMatches, addTerritory,
  removeTerritory, geographyFor, geographyNote, nativeLanguageControl, toggleNativeLanguage,
  chooseProduct, blockers, nameBudget, machineryFor, composeSaved, draftFromSaved, inherited,
  missingPieces,
  MAX_TERRITORIES, checksSummary, runsNote, turnaround, effortUnits,
  isTerritoryEntry, isKnownTerritory, ALL_TERRITORIES } from '../src/contract/composerProduct.ts'
import type { Draft } from '../src/contract/composerProduct.ts'
import { PRODUCTS, assertMatchesRegistry } from './products.fixture.ts'

test('the fixture IS the engine offering — every field, re-derived rather than copied', () => {
  assertMatchesRegistry()
})

const KNOCKOUT = PRODUCTS[0]!
const GLOBAL = PRODUCTS[1]!
const MULTI = PRODUCTS[2]!
const FULL = PRODUCTS[3]!

const draft = (over: Partial<Draft> = {}): Draft => ({ ...EMPTY_DRAFT, ...over })

// ── the territory vocabulary is TIERED, because the offering's rules are ─────────────────────────────

test('a region is not a country, and the picker knows the difference', () => {
  assert.equal(tierOf('European Union'), 'region')
  assert.equal(tierOf('France'), 'country')
  assert.equal(tierOf('Bavaria'), null, 'a place the picker does not offer is neither')
  assert.equal(tierOf('Worldwide'), null, 'worldwide is a MODE, and is not in the vocabulary at all')
  assert.ok(!REGIONS.includes('Worldwide'), 'the one entry that used to make emptiness ambiguous is gone')
  assert.ok(REGIONS.every((r) => tierOf(r) === 'region'))
  assert.ok(COUNTRIES.every((c) => tierOf(c) === 'country'))
})

test('a Full country search is offered NO regions — the control fits the product', () => {
  // The point is that the refusal never has to happen. A picker that offered "European Union" here and
  // then refused it would be enforcement with an invitation in front of it.
  assert.ok(!vocabularyFor(FULL).includes('European Union'))
  assert.ok(vocabularyFor(FULL).includes('France'))
  assert.ok(vocabularyFor(MULTI).includes('European Union'))
  assert.deepEqual(vocabularyFor(null), [], 'no product picked ⇒ nothing to point anywhere')
  assert.deepEqual([...territoryMatches('euro', [], FULL)], [], 'and the typeahead does not offer one either')
  assert.deepEqual([...territoryMatches('euro', [], MULTI)], ['European Union'])
})

test('the typeahead matches whole words and aliases, never a bare substring', () => {
  // A naive contains-match turns "in" into India, China, Singapore and Argentina at once.
  assert.deepEqual([...territoryMatches('in', [], MULTI)], ['India'])
  assert.deepEqual([...territoryMatches('usa', [], MULTI)], ['United States'])
  assert.deepEqual([...territoryMatches('aripo', [], MULTI)], ['African Regional (ARIPO)'])
  assert.deepEqual([...territoryMatches('france', ['France'], MULTI)], [], 'already chosen ⇒ not offered again')
  assert.deepEqual([...territoryMatches('  ', [], MULTI)], [])
})

test('one country REPLACES on a Full country search; it stacks everywhere else', () => {
  const one = addTerritory(draft({ product: FULL.key }), 'France', FULL)
  assert.deepEqual([...one.territories], ['France'])
  const two = addTerritory(one, 'Germany', FULL)
  assert.deepEqual([...two.territories], ['Germany'],
    'the second replaces the first — there is no state where the screen holds two and has to explain it')
  const multi = addTerritory(addTerritory(draft({ product: MULTI.key }), 'France', MULTI), 'Germany', MULTI)
  assert.deepEqual([...multi.territories], ['France', 'Germany'])
  assert.deepEqual([...addTerritory(multi, 'Nowhere', MULTI).territories], ['France', 'Germany'],
    'a name outside the vocabulary is not added')
  assert.deepEqual([...removeTerritory(multi, 'France').territories], ['Germany'])
})

// ── the geography STAMP: everywhere and silence are different searches ───────────────────────────────

test('the draft states its geography MODE — an empty list is worldwide, not silence', () => {
  assert.deepEqual(geographyFor(draft()), { mode: 'worldwide', territories: [] })
  assert.deepEqual(geographyFor(draft({ territories: ['France'] })), { mode: 'named', territories: ['France'] })
})

// ── the product decides the controls, and each says WHY at the control ───────────────────────────────

test('every product states the geography it accepts, at the control', () => {
  for (const p of PRODUCTS) {
    const note = geographyNote(p)
    assert.ok(note && note.length > 20, `${p.key}: says nothing about what it accepts`)
  }
  assert.match(geographyNote(GLOBAL)!, /not narrowed/i)
  assert.match(geographyNote(FULL)!, /Regions are not offered here/i)
  assert.match(geographyNote(MULTI)!, /One country on its own is a Full country search/i)
  assert.equal(geographyNote(null), null)
})

test('the native-language investigation is a toggle on exactly one product, automatic on one, absent on two', () => {
  assert.equal(nativeLanguageControl(MULTI), 'toggle')
  assert.equal(nativeLanguageControl(FULL), 'automatic')
  assert.equal(nativeLanguageControl(KNOCKOUT), 'none')
  assert.equal(nativeLanguageControl(GLOBAL), 'none')
  assert.equal(nativeLanguageControl(null), 'none')
  // And it cannot be SET where it is not a choice — a flag nobody can see is one that gets sent.
  assert.equal(toggleNativeLanguage(draft(), FULL).nativeLanguage, false)
  assert.equal(toggleNativeLanguage(draft(), KNOCKOUT).nativeLanguage, false)
  assert.equal(toggleNativeLanguage(draft(), MULTI).nativeLanguage, true)
})

test('switching product DROPS what the new one cannot hold — never leaves it set but hidden', () => {
  const rich = draft({ product: MULTI.key, territories: ['European Union', 'France'], nativeLanguage: true })
  // to a worldwide-only search: no territories at all
  assert.deepEqual(chooseProduct(rich, GLOBAL), { product: GLOBAL.key, territories: [], nativeLanguage: false })
  // to a one-country search: the first COUNTRY survives, the region does not
  assert.deepEqual(chooseProduct(rich, FULL), { product: FULL.key, territories: ['France'], nativeLanguage: false })
  // to a knockout: territories are legal, the toggle is not
  assert.deepEqual(chooseProduct(rich, KNOCKOUT),
    { product: KNOCKOUT.key, territories: ['European Union', 'France'], nativeLanguage: false })
  // and back to the one that offers it — the toggle does not come back on by itself
  assert.equal(chooseProduct(chooseProduct(rich, GLOBAL), MULTI).nativeLanguage, false)
})

// ── blockers: the mirror of the engine's own rules ───────────────────────────────────────────────────

test('nothing picked is its own blocker, and it names the choice rather than a missing field', () => {
  const out = blockers(draft(), null, 1)
  assert.equal(out.length, 1)
  assert.match(out[0]!, /Pick a search above/)
})

test('each product refuses exactly the geography the offering says it refuses', () => {
  // Global preliminary: worldwide, and nothing else.
  assert.deepEqual([...blockers(draft({ product: GLOBAL.key }), GLOBAL, 1)], [])
  assert.match(blockers(draft({ product: GLOBAL.key, territories: ['France'] }), GLOBAL, 1)[0]!,
    /is worldwide and is not narrowed/)
  // Multi-country focus: a region, or two or more countries. Never worldwide, never exactly one.
  assert.match(blockers(draft({ product: MULTI.key }), MULTI, 1)[0]!, /reads a region, or two or more countries/)
  assert.match(blockers(draft({ product: MULTI.key, territories: ['France'] }), MULTI, 1)[0]!,
    /pick a Full country search to read France/)
  assert.deepEqual([...blockers(draft({ product: MULTI.key, territories: ['European Union'] }), MULTI, 1)], [])
  assert.deepEqual([...blockers(draft({ product: MULTI.key, territories: ['France', 'Germany'] }), MULTI, 1)], [])
  // Full country: exactly one country, and a region is not a country.
  assert.match(blockers(draft({ product: FULL.key }), FULL, 1)[0]!, /reads one country/)
  assert.match(blockers(draft({ product: FULL.key, territories: ['European Union'] }), FULL, 1)[0]!,
    /European Union is a region/)
  assert.deepEqual([...blockers(draft({ product: FULL.key, territories: ['France'] }), FULL, 1)], [])
  // Knockout: worldwide or any set.
  assert.deepEqual([...blockers(draft({ product: KNOCKOUT.key }), KNOCKOUT, 1)], [])
  assert.deepEqual([...blockers(draft({ product: KNOCKOUT.key, territories: ['France'] }), KNOCKOUT, 1)], [])
})

test('the name limit is the SERVER’s figure, and going over is a sentence with the numbers in it', () => {
  assert.equal(nameBudget(KNOCKOUT, 8), null)
  assert.deepEqual(nameBudget(KNOCKOUT, 9), { allowed: 8, over: 1 })
  assert.deepEqual(nameBudget(GLOBAL, 3), { allowed: 1, over: 2 })
  assert.equal(nameBudget(null, 99), null, 'no product ⇒ no limit to be over')
  assert.match(blockers(draft({ product: GLOBAL.key }), GLOBAL, 3)[0]!,
    /reads one name at a time, and you have 3/)
  assert.match(blockers(draft({ product: KNOCKOUT.key }), KNOCKOUT, 9)[0]!,
    /reads 8 names at a time, and you have 9/)
})

test('an unavailable product blocks with the SERVER’s own sentence, never one written here', () => {
  const off = { ...KNOCKOUT, available: false, unavailableNote: 'Not part of the current release.' }
  assert.deepEqual([...blockers(draft({ product: off.key }), off, 1)], ['Not part of the current release.'])
})

test('the territory cap is stated while the list is built, not at the plan gate', () => {
  const many = Array.from({ length: MAX_TERRITORIES + 1 }, (_, i) => COUNTRIES[i]!)
  assert.match(blockers(draft({ product: MULTI.key, territories: many }), MULTI, 1).at(-1)!,
    new RegExp(`at most ${MAX_TERRITORIES}`))
})

// ── the effort model's input comes off the product row, never off a guess ────────────────────────────

test('machineryFor reads the product, so the bar prices what the server will run', () => {
  assert.deepEqual(machineryFor(draft({ product: KNOCKOUT.key }), KNOCKOUT), {
    pipeline: 'knockout', caseLaw: false, nativeLanguage: false, registerCounts: true, territories: [],
  })
  assert.deepEqual(machineryFor(draft({ product: FULL.key, territories: ['France'] }), FULL), {
    pipeline: 'clearance', caseLaw: true, nativeLanguage: true, registerCounts: false, territories: ['France'],
  })
  // the ONE toggle: on the product that offers it, and nowhere else
  assert.equal(machineryFor(draft({ nativeLanguage: true }), MULTI).nativeLanguage, true)
  assert.equal(machineryFor(draft({ nativeLanguage: true }), GLOBAL).nativeLanguage, false)
  assert.equal(machineryFor(draft(), FULL).nativeLanguage, true, 'automatic is not a thing to switch on')
})

test('the footer’s own figures still read, and a clearance is one search', () => {
  const i = { levers: machineryFor(draft({ product: GLOBAL.key }), GLOBAL), names: 1, classes: 2, platforms: 7, density: null }
  assert.equal(turnaround(i), '1.5–2.5 hours')   // — one ruled range for every clearance
  assert.ok(effortUnits(i) >= 1 && effortUnits(i) <= 10)
  assert.match(checksSummary(i), /checks per name/)
  assert.equal(runsNote(i), '', 'one name, one search — nothing to say')
  const ko = { ...i, levers: machineryFor(draft({ product: KNOCKOUT.key }), KNOCKOUT), names: 8 }
  assert.match(checksSummary(ko), /broad sweep per name/)
})

// ── saving, and reading back ─────────────────────────────────────────────────────────────────────────

test('a saved search stores the PRODUCT and the one toggle, and never a case-law flag', () => {
  const rec = composeSaved({
    label: 'Quarterly EU screen',
    draft: draft({ product: MULTI.key, territories: ['European Union'], nativeLanguage: true }),
    classes: [9], platforms: ['gnc.com'],
  })!
  assert.equal(rec['base'], MULTI.key)
  assert.equal(rec['nativeLanguage'], true)
  assert.ok(!('caseLaw' in rec), 'the engine refuses a saved caseLaw — writing one would brick the record')
  assert.deepEqual(rec['scope'], { jurisdictions: ['European Union'], platforms: ['gnc.com'], classes: [9] })
  assert.deepEqual(rec['components'], {}, 'the product owns its machinery; a saved search cannot add any')
  assert.equal(rec['archived'], false, 'a CREATE states it')
})

test('an UPDATE carries what the composer cannot express, and drops a stale case-law flag', () => {
  const prior = {
    base: MULTI.key, archived: true, notes: 'quarterly', caseLaw: true,
    extras: { standingInstructions: 'call out Benelux' }, components: { jxLanes: true }, version: 4, createdBy: 'x',
  }
  const rec = composeSaved({
    label: 'Quarterly EU screen',
    draft: draft({ product: MULTI.key, territories: ['European Union'] }),
    classes: [], platforms: [], prior,
  })!
  assert.deepEqual(rec['extras'], { standingInstructions: 'call out Benelux' }, 'carried untouched')
  assert.equal(rec['notes'], 'quarterly')
  assert.equal(rec['archived'], true, 'an UPDATE inherits it — writing false would un-retire it silently')
  assert.ok(!('caseLaw' in rec), 'a stale flag is DROPPED, not carried into a record the engine would refuse')
  assert.deepEqual(rec['components'], {}, 'and a stale jxLanes goes with it — the product decides that now')
  assert.ok(!('version' in rec) && !('createdBy' in rec), 'server-owned stamps are re-derived on write')
})

test('nothing picked saves nothing — composeSaved refuses to choose a product for you', () => {
  assert.equal(composeSaved({ label: 'x', draft: draft(), classes: [], platforms: [] }), null)
})

test('a saved search reads back as a draft — and a product the offering no longer lists does NOT', () => {
  const back = draftFromSaved(
    { base: FULL.key, scope: { jurisdictions: ['France', 'Germany'] }, nativeLanguage: true },
    PRODUCTS,
  )
  // Read back THROUGH the product's own rules: a Full country search holds one country, so the record's
  // second territory does not survive into a form that cannot express it.
  assert.deepEqual(back, { product: FULL.key, territories: ['France'], nativeLanguage: false })
  assert.equal(draftFromSaved({ base: 'prelim-jx', scope: {} }, PRODUCTS), null,
    'a retired level as a base opens READ-ONLY rather than being reshaped into the nearest live product')
  assert.equal(draftFromSaved({}, PRODUCTS), null)
})

// ── what the company already carries ─────────────────────────────────────────────────────────────

test('inherited reads the project overlay when there is one, and says which', () => {
  const own = inherited({
    profile: { defaultClasses: [9, 3], defaultJurisdictions: ['US'], platforms: ['a.com'], marketplaceDensity: 'dense' },
    projectEffective: { defaultClasses: [28], defaultJurisdictions: ['FR'], platforms: [] },
    projectOrigins: { defaultClasses: 'project', defaultJurisdictions: 'project' },
    ownerLabel: 'the company', projectLabel: 'Console line',
  })
  assert.deepEqual([...own.classes], [28])
  assert.equal(own.classesFrom, 'from Console line')
  assert.deepEqual([...own.territories], ['FR'])
  assert.equal(own.territoriesFrom, 'from Console line')
})


// ── the pieces the form has not been given yet ──────────────────────────────────────────────────────
//
// THE DEFECT: this condition existed on the screen as a bare boolean feeding the primary action's
// `disabled`, and rendered nowhere. Every other term in that expression puts a sentence in front of the
// reader; this one greyed the button out in silence. An outside user with a working install, one name
// typed and no goods, read the result as a product with no way to start a search and stopped using it.
//
// The arms below are about the SENTENCES, not the boolean. A version of this that returned true/false
// would satisfy the screen and reproduce the defect exactly.

test('a form with nothing in it asks for the name first, and only the name', () => {
  const out = missingPieces([], [], '')
  assert.equal(out.length, 1, `expected one thing to fix and got ${out.length}: ${JSON.stringify(out)}`)
  assert.match(out[0]!, /name/i)
  // NOT two chores. With no name at all the brief reader can fill both from one sentence, and a list
  // that opens with two demands is the tone this screen was rebuilt to get away from.
  assert.doesNotMatch(out[0]!, /classes/i)
})

test('a name with nothing said about it asks what it is for, and offers either answer', () => {
  const out = missingPieces(['AQUAPLUS'], [], '')
  assert.equal(out.length, 1)
  // EITHER, never both — the request schema accepts classes or a description, and the screen must not
  // demand more than the door does.
  assert.match(out[0]!, /classes/i)
  assert.match(out[0]!, /goods/i)
  assert.match(out[0]!, /either/i)
})

test('classes alone are enough, and a description alone is enough', () => {
  assert.deepEqual(missingPieces(['AQUAPLUS'], [32], ''), [])
  assert.deepEqual(missingPieces(['AQUAPLUS'], [], 'energy drinks'), [])
  assert.deepEqual(missingPieces(['AQUAPLUS'], [32], 'energy drinks'), [])
})

test('whitespace is not a description', () => {
  // The screen's own predicate trimmed; a rewrite that forgot to would let the primary action light up
  // over a request the door then refuses, which is the round trip this list exists to save.
  assert.equal(missingPieces(['AQUAPLUS'], [], '   \n  ').length, 1)
})

test('every sentence is a fixable instruction, not a statement that something is wrong', () => {
  // ANTI-VACUITY AND TONE IN ONE. These strings are the entire product of this function — a rewrite
  // returning empty strings, or error-shaped ones, would pass every count above.
  for (const s of [...missingPieces([], [], ''), ...missingPieces(['X'], [], '')]) {
    assert.ok(s.length > 20, `too short to instruct anybody: ${JSON.stringify(s)}`)
    assert.doesNotMatch(s, /error|invalid|required|must/i,
      `${JSON.stringify(s)} tells somebody they are wrong. This list is things nobody has typed yet.`)
  }
})

test('nothing here is a reason to refuse a SAVE', () => {
  // The screen gates saving on blockers(), never on this list, and the two must stay different
  // questions: a half-filled form is a perfectly good thing to save and come back to. The user who
  // reported this had saved exactly such a form.
  const gaps = missingPieces([], [], '')
  assert.ok(gaps.length > 0)
  assert.deepEqual(blockers(EMPTY_DRAFT, null, 0).filter((b) => gaps.includes(b)), [],
    'a form gap leaked into blockers(), which would take Save away from a half-filled form')
})

// ── one stored field, one answer (public issue 158) ─────────────────────────────────────────────────
//
// The staff editor tells an operator to type "US, EU, UK". The portal checked those against display
// names and flagged all three as unknown. The engine validates nothing and normalises whatever arrives.
// A user who followed one editor's instruction was told by the other that they were wrong, and asked.
test('the jurisdictions field accepts what BOTH editors tell a reader to type', () => {
  for (const named of ['European Union', 'United States', '  united states ']) {
    assert.ok(isTerritoryEntry(named), `${JSON.stringify(named)} is a territory this build names`)
  }
  for (const code of ['US', 'EU', 'GB', 'ch']) {
    assert.ok(isTerritoryEntry(code), `${code} is what the staff editor instructs, and it was flagged as unknown`)
  }
})

test('a code is a SHAPE, not a licence for anything short', () => {
  // The check stays assistive — it flags and stores rather than refusing — so accepting a two-letter
  // shape it cannot resolve matches what the engine does with one. What it must not do is stop
  // flagging entries that are neither: the owner's own example, typed into the live page, produced no
  // notice at all before this field had a check, and that silence is what this must not return to.
  for (const junk of ['USFrance', 'XXX', 'U', '', '  ', '1', 'United Stat']) {
    assert.equal(isTerritoryEntry(junk), false, `${JSON.stringify(junk)} is neither a named territory nor a code`)
  }
})

test('the picker and the composer keep the name vocabulary they had', () => {
  // NOT A VOCABULARY CHANGE where a client chooses countries. A picker offering names beside a box that
  // accepted only codes would be two controls disagreeing under one label — this defect pointed the
  // other way. Codes are accepted in ADDITION, on the one field whose other editor documents them.
  assert.ok(ALL_TERRITORIES.includes('European Union'), 'the picker vocabulary is still names')
  assert.equal(isKnownTerritory('EU'), false,
    'the NAME check must not start answering for codes — the composer reads it, and its list is names')
})
