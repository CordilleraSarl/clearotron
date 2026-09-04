// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The four products this engine offers, as the wire carries them — shared by every test that needs the
// menu, and CHECKED against the engine rather than trusted.
//
// This used to be a hand-copied literal inside the matrix test, with a comment claiming it was "verbatim
// from the registry". Nothing verified that. So the whole premise of the comparison table — that every
// cell is derived from the server's own description of what it will run — rested on a copy which could
// quietly stop matching the thing it copied, and the test suite would keep passing while the browser
// rendered a table describing a product the engine no longer offered.
//
// `assertMatchesRegistry` closes that: it re-derives the row from driver/product-rows.mjs (the one
// function the portal, the recipe service and the ops-MCP all emit) and compares field by field. Import
// the fixture, call the guard once per test file.
//
// Named `.fixture.ts` and not `.test.ts` on purpose: portal-ui's runner is `node --test test/*.test.ts`,
// so this file is a module tests import, never a suite that runs itself.

import assert from 'node:assert/strict'
import type { Product } from '../src/contract/api.ts'
import { productRows } from '../../driver/product-rows.mjs'

export const product = (over: Partial<Product> = {}): Product => ({
  key: 'global-preliminary-search', name: 'Global preliminary search',
  stageLabel: 'Global preliminary search', pipeline: 'clearance', components: ['commonLawGrid'],
  geography: 'worldwide, and nothing else', caseLaw: false, nativeLanguage: 'absent', maxNames: 1,
  baseTurnaround: '1.5–2.5 hours', baseTurnaroundHours: 2.5, orderable: true,
  available: true, unavailableNote: null, ...over,
} as Product)

export const PRODUCTS: readonly Product[] = [
  product({
    key: 'knockout-search', name: 'Knockout search', stageLabel: 'Knockout search', pipeline: 'knockout',
    components: ['registerProbe'], geography: 'worldwide, or any set of territories',
    nativeLanguage: 'absent', maxNames: 8, baseTurnaround: '5–10 min', baseTurnaroundHours: 10 / 60,
  }),
  product({}),
  product({
    key: 'multi-country-focus-search', name: 'Multi-country focus search',
    stageLabel: 'Multi-country focus search', geography: 'a region, or two or more countries',
    nativeLanguage: 'offered',
  }),
  product({
    key: 'full-country-search', name: 'Full country search', stageLabel: 'Full country search',
    components: ['jxLanes', 'commonLawGrid'], geography: 'exactly one country',
    caseLaw: true, nativeLanguage: 'automatic',
    baseTurnaround: '1.5–2.5 hours', baseTurnaroundHours: 2.5,
  }),
]

/**
 * The guard. Every field the wire carries is compared against the engine's own row.
 *
 * `available` and `unavailableNote` are deliberately NOT compared: they are deployment state resolved
 * per request from the flag snapshot, not registry facts, and productRows knows nothing about them.
 */
export function assertMatchesRegistry(): void {
  const rows = productRows()
  assert.equal(PRODUCTS.length, rows.length, 'fixture has a different number of products than the offering')
  for (const [i, row] of rows.entries()) {
    const f = PRODUCTS[i]!
    assert.equal(f.key, row.key, `product ${i}: key`)
    assert.equal(f.name, row.name, `${row.key}: name`)
    assert.equal(f.stageLabel, row.stageLabel, `${row.key}: stageLabel`)
    assert.equal(f.pipeline, row.pipeline, `${row.key}: pipeline`)
    assert.deepEqual([...f.components].sort(), [...row.components].sort(), `${row.key}: components`)
    assert.equal(f.geography, row.geography, `${row.key}: geography`)
    assert.equal(f.caseLaw, row.caseLaw, `${row.key}: caseLaw`)
    assert.equal(f.nativeLanguage, row.nativeLanguage, `${row.key}: nativeLanguage`)
    assert.equal(f.maxNames, row.maxNames, `${row.key}: maxNames`)
    assert.equal(f.baseTurnaround, row.baseTurnaround, `${row.key}: baseTurnaround`)
    assert.equal(f.baseTurnaroundHours, row.baseTurnaroundHours, `${row.key}: baseTurnaroundHours`)
    assert.equal(f.orderable, row.orderable, `${row.key}: orderable`)
  }
}
