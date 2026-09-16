// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The search New clearance recommends for what was entered — and why it cannot disagree with the engine.
//
// The rule for places is the ENGINE's: `productFor` in driver/products.mjs resolves a set of territories to
// one of the searches, and the browser cannot import it. So the browser restates it, and this file drives
// both over the same lists. A form that tagged one search while the engine resolved the same places to
// another would be recommending a refusal — and nothing on either side would say so.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recommendSearch, REGIONS, COUNTRIES } from '../src/contract/composerProduct.ts'
import { productFor } from '../../driver/products.mjs'
import { PRODUCTS, assertMatchesRegistry } from './products.fixture.ts'

test('the fixture is the engine\'s offering, so the parity below is measured against the real rows', () => {
  assertMatchesRegistry()
})

test('THE PLACES HALF IS THE ENGINE\'S RULE — every shape of territory list resolves to the same search', () => {
  // The population is built to cover every branch of the rule, and it is COUNTED before it is trusted:
  // a list that silently came out empty would make every assertion below a pass over nothing.
  const lists: string[][] = [
    [],
    ...COUNTRIES.slice(0, 5).map((c) => [c]),
    ...REGIONS.map((r) => [r]),
    ['France', 'Germany'],
    ['European Union', 'Switzerland'],
    ['European Union', 'Benelux'],
    ['United States', 'China', 'Japan'],
    ['Benelux', 'France', 'Germany', 'Italy'],
  ]
  assert.ok(lists.length >= 12, `the parity population is too thin to mean anything: ${lists.length}`)
  const tried = new Set<string>()
  for (const territories of lists) {
    const engine = productFor({ pipeline: 'clearance', territories })
    const browser = recommendSearch(PRODUCTS, 1, territories)?.product.key ?? null
    assert.equal(browser, engine, `${JSON.stringify(territories)}: the form recommends ${browser}, the engine resolves ${engine}`)
    tried.add(String(engine))
  }
  // …and the population reached all three clearance outcomes, so no branch went unmeasured.
  assert.deepEqual([...tried].sort(), ['full-country-search', 'global-preliminary-search', 'multi-country-focus-search'])
})

test('an untouched form recommends nothing, so nothing is preselected', () => {
  assert.equal(recommendSearch(PRODUCTS, 0, []), null,
    '"for what you entered" is a claim about input, and an empty form has none')
  // A name alone IS input: it fits the worldwide search, which is what the engine resolves no places to.
  assert.equal(recommendSearch(PRODUCTS, 1, [])?.product.key, 'global-preliminary-search')
  // A place alone is input too.
  assert.equal(recommendSearch(PRODUCTS, 0, ['France'])?.product.key, 'full-country-search')
})

test('several names fit the search that reads the most of them', () => {
  const r = recommendSearch(PRODUCTS, 3, ['France'])
  assert.equal(r?.product.key, 'knockout-search', 'a clearance reads one name; three fit the knockout')
  assert.equal(r?.reason, 'because you entered 3 names')
})

test('the reason is the design\'s sentence, and it counts what was named', () => {
  const reason = (t: string[]) => recommendSearch(PRODUCTS, 1, t)?.reason
  assert.equal(reason(['European Union', 'Switzerland']), 'because you named a region and a country')
  assert.equal(reason(['France']), 'because you named a country')
  assert.equal(reason(['France', 'Germany']), 'because you named 2 countries')
  assert.equal(reason(['European Union']), 'because you named a region')
  assert.equal(reason(['European Union', 'Benelux', 'France']), 'because you named 2 regions and a country')
  assert.equal(reason([]), 'because you named no country or region')
})

test('a search this deployment cannot run is never recommended', () => {
  const off = PRODUCTS.map((p) => (p.key === 'multi-country-focus-search' ? { ...p, available: false } : p))
  assert.equal(recommendSearch(off, 1, ['European Union', 'Switzerland']), null,
    'recommending a search whose row says it is not available here would preselect a dead control')
})
