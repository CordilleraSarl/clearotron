// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// registerCoverage.test.ts —, the browser half.
//
// The composer offers only territories the wired register can search. The whole risk is in the THREE
// states of one field, and the issue names the exact line that gets it wrong:
//
//     new Set(covered ?? [])
//
// which offers ZERO territories on the production deployment, because its provider declares
// `covered: null` — no restriction — on purpose. `null` and `undefined` must both offer everything;
// only an array narrows.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { vocabularyFor, offerableFor, territoryMatches, addTerritory, reachesTerritory, EMPTY_DRAFT, REGIONS, COUNTRIES } from '../src/contract/composerProduct.ts'
import type { Product } from '../src/contract/api.ts'

const product = (geography: string): Product => ({
  key: 'k', name: 'n', stageLabel: 's', pipeline: 'clearance', components: [],
  geography, caseLaw: false, nativeLanguage: 'absent', maxNames: 1,
  baseTurnaround: null, baseTurnaroundHours: null, orderable: true, available: true, unavailableNote: null,
} as unknown as Product)

const MULTI = product('a region, or two or more countries')
const FULL = product('exactly one country')

// ── the three states ────────────────────────────────────────────────────────────────────────────────

test('UNDEFINED offers everything — an older server must not empty the picker', () => {
  assert.deepEqual([...vocabularyFor(MULTI, undefined)], [...REGIONS, ...COUNTRIES])
  assert.deepEqual([...vocabularyFor(MULTI)], [...REGIONS, ...COUNTRIES], 'and so does omitting the argument')
})

test('NULL offers everything — it means the register declares no restriction', () => {
  // THE NAMED TRAP. `covered ?? []` would make this case offer nothing, on the deployment that is
  // actually in production. Asserted as a count so a partial narrowing fails too, not just an empty one.
  const v = vocabularyFor(MULTI, null)
  assert.equal(v.length, REGIONS.length + COUNTRIES.length)
  assert.ok(v.includes('Germany') && v.includes('European Union'))
})

test('an ARRAY is the only thing that narrows, and it narrows to exactly itself', () => {
  assert.deepEqual([...vocabularyFor(MULTI, ['European Union'])], ['European Union'])
  assert.deepEqual([...vocabularyFor(MULTI, ['European Union', 'United States'])], ['European Union', 'United States'])
})

test('an EMPTY array offers nothing, which is what an empty coverage claim means', () => {
  assert.deepEqual([...vocabularyFor(MULTI, [])], [])
})

// ── coverage composes with the product's own vocabulary, it does not replace it ─────────────────────

test('a one-country product still refuses a region, even when the register covers it', () => {
  // Two independent narrowings, and both apply. The EU is covered by the register AND is a region, so a
  // Full country search still may not be pointed at it — the register reaching a place does not make it
  // the right KIND of place.
  assert.deepEqual([...vocabularyFor(FULL, ['European Union', 'United States'])], ['United States'])
})

test('no product picked ⇒ nothing to point anywhere, whatever the register covers', () => {
  assert.deepEqual([...vocabularyFor(null, ['European Union'])], [])
})

// ── — THE TWO CALL SITES THAT USED TO NARROW, AND NO LONGER MAY ─────────────
//
// removed a territory the register could not reach from both the suggestions and the add path. The
// owner met the result on his own install: "we have the same issue in the country filters — nothing
// tells the user what its limited to, or why." An absent entry teaches a reader nothing, because they
// cannot tell an unsupported territory from one they mistyped.
//
// The ruling on the product rows applies here, and the issue makes the consistency BINDING: the two
// controls sit on one screen and must not disagree about how coverage is handled. Products are now
// disclosed rather than refused, so territories are too — offered, selectable, marked at the control,
// and disclosed in the report as deferred coverage rather than searched.
//
// THE FIRST ARM OF EACH IS THE BEHAVIOUR AS IT SHIPPED, planted so this is a measured reversal rather
// than a test rewritten to match whatever the code now does.

test('2075 suggestions OFFER a territory the register cannot reach, and say so', () => {
  // As it shipped: 'Germany' matches, is in the product's vocabulary, and coverage removed it.
  const asItShipped = (covered: readonly string[] | null | undefined) =>
    [...territoryMatches('germ', [], MULTI, 8)].filter((n) => !Array.isArray(covered) || covered.includes(n))
  assert.deepEqual(asItShipped(['European Union']), [], 'the plant no longer reproduces the old behaviour')

  assert.deepEqual([...territoryMatches('germ', [], MULTI, 8, ['European Union'])], ['Germany'],
    'a territory outside coverage is still absent from the picker — the reader cannot tell it from a typo')
  assert.deepEqual([...territoryMatches('germ', [], MULTI, 8)], ['Germany'], 'and an older server still offers it')
  assert.deepEqual([...territoryMatches('germ', [], MULTI, 8, null)], ['Germany'], 'unrestricted: offered')

  // THE PRODUCT'S OWN SHAPE IS STILL A WALL, and that is the distinction this change turns on: a
  // one-country search cannot be SENT a region, whatever the register covers. Coverage is disclosed;
  // an unsendable request is still refused.
  assert.deepEqual([...territoryMatches('euro', [], FULL, 8, null)], [],
    'a region is being offered on a search that reads one country')
})

test('2075 addTerritory ACCEPTS one outside coverage, and still refuses one the product cannot take', () => {
  const d = EMPTY_DRAFT
  assert.deepEqual(addTerritory(d, 'Germany', MULTI, ['European Union']).territories, ['Germany'],
    'the add path still drops a territory the reader deliberately chose')
  assert.deepEqual(addTerritory(d, 'European Union', MULTI, ['European Union']).territories, ['European Union'])
  assert.deepEqual(addTerritory(d, 'Germany', MULTI, null).territories, ['Germany'], 'unrestricted still adds')
  assert.deepEqual(addTerritory(d, 'Germany', MULTI).territories, ['Germany'], 'and so does an older server')
  // The product's wall, unchanged.
  assert.deepEqual(addTerritory(d, 'European Union', FULL, null).territories, [],
    'a region reached a search that reads exactly one country')
})

test('2075 the mark and the vocabulary are ONE rule, so they cannot disagree', () => {
  // `vocabularyFor` is what the register REACHES inside a product's vocabulary; `reachesTerritory` is
  // the same question about one name. Two copies of the three-state rule would be one edit away from a
  // picker that marks a territory it also offers as unreachable, or the reverse.
  for (const covered of [undefined, null, ['European Union'], [] as string[], [...REGIONS, ...COUNTRIES]]) {
    assert.deepEqual(
      [...vocabularyFor(MULTI, covered)],
      offerableFor(MULTI).filter((n) => reachesTerritory(n, covered)),
      `the two answers disagree for ${JSON.stringify(covered)}`)
  }
  // And the product scope survives the filter: a one-country search offers no region, covered or not.
  assert.equal(vocabularyFor(FULL, null).some((n) => REGIONS.includes(n)), false)
})

test('2075 the mark is derived from the SAME three states the vocabulary is', () => {
  // An unknown coverage must never mark a territory as unreachable: `undefined` is a server that did
  // not say and `null` is a register that declares no restriction, and putting a caveat on every
  // country of a production deployment is the failure mode 's own header is about.
  assert.equal(reachesTerritory('Germany', undefined), true, 'an older server marked every territory deferred')
  assert.equal(reachesTerritory('Germany', null), true, 'an unrestricted register marked every territory deferred')
  assert.equal(reachesTerritory('Germany', ['European Union']), false)
  assert.equal(reachesTerritory('European Union', ['European Union']), true)
  assert.equal(reachesTerritory('Germany', []), false, 'an empty coverage claim reaches nothing')
})

// ── the screen actually passes it ───────────────────────────────────────────────────────────────────

test('NewClearance threads coverage into BOTH the suggestion list and the add path', () => {
  // The contract functions above default to "offer everything" when coverage is not passed — which is
  // right for an older server and wrong for a screen that simply forgot. A screen that never passes the
  // argument therefore behaves EXACTLY as it did before, with no error anywhere: the composer keeps
  // offering territories the register cannot search and every test above still passes.
  //
  // Source-level, because the alternative is rendering the screen, and the defect is not in the render.
  const src = readFileSync(new URL('../src/screens/NewClearance.tsx', import.meta.url), 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
  assert.match(src, /const registerTerritories = /, 'the screen must read the field off the payload')
  assert.match(src, /territoryMatches\([^)]*registerTerritories\)/, 'suggestions must be threaded')
  assert.match(src, /addTerritory\([^)]*registerTerritories\)/, 'and so must the add path')
  // — and the screen must MARK what it no longer hides. A thread that reaches
  // neither the suggestion list nor the chips is the same silence with the argument still passed.
  assert.match(src, /reachesTerritory\(t, registerTerritories\)/,
    'the screen threads coverage and then says nothing about it — which is the defect, not the fix')
  assert.match(src, /reaches\{' '\}\n\s*\{vocabularyFor\(activeLevel, registerTerritories\)\.length\}/,
    'the screen never states, once, what this deployment\'s register reaches')
  // BOTH FIGURES SCOPED TO THE PRODUCT. `registerTerritories.length` is the covered set whole, and a
  // Full country search can name no regions — so a region the register covers is not one of "the
  // territories you can name here", and the sentence would overstate the reach on that product.
  assert.match(src, /\{offerableFor\(activeLevel\)\.length\} territories you can name here/,
    'the denominator is not the vocabulary this product actually offers')
})

// ──, fixed here because a red main blocks every merge ──────────────────────────────────────────

test('Acknowledge is not a Stop button — the two controls do not share a class', () => {
  // scripts/home-render-check.mjs counts `.home2-stop` to assert "Stop appears only where it can do
  // something", and gave the Acknowledge button that class. So every terminal card drew what the
  // check reads as a Stop, and main went red in the browser job — a failure no unit test could see,
  // because both buttons are correct React and the defect is one string.
  //
  // This is the cheap half of that check: the classes are distinct, asserted from source. The browser
  // job still does the real measurement.
  const home = readFileSync(new URL('../src/screens/Home.tsx', import.meta.url), 'utf8')
  const stopButtons = [...home.matchAll(/className="home2-stop"/g)].length
  assert.equal(stopButtons, 1, 'exactly one control may be a home2-stop — the one that stops a live run')
  assert.match(home, /className="home2-ack"/, 'and Acknowledge carries its own')
  // Same styling, so the fix is a class name and not a visual change.
  const css = readFileSync(new URL('../src/base.css', import.meta.url), 'utf8')
  assert.match(css, /\.home2-stop, \.home2-cancel, \.home2-ack \{/)
})
