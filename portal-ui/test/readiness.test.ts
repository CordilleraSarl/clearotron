// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// readiness.test.ts — the primary action is never off without a sentence saying why.
//
// ── WHY THIS FILE EXISTS, AND WHY IT DRIVES RATHER THAN READS ───────────────────────────────────────
//
// An outside user with a name typed and no goods met a greyed Start button with nothing anywhere on the
// page saying which field would ungrey it, and stopped using the product. The fix put a sentence behind
// every condition. What it did NOT do was hold the two together: readiness was a chain of `&&` terms in
// the screen and the reason was a chain of `??` fallbacks 800 lines below, and the tests covering it
// matched SOURCE TEXT — a regex on `const ready = !gaps.length &&`. Adding a seventh term to the
// boolean and forgetting the seventh sentence left every one of those tests green while the original
// defect returned.
//
// So the property this file holds is the one that carries the harm, and it holds it by DRIVING the
// function over every combination of its conditions rather than by reading the file it lives in:
//
//     ready === (blockedBy === null),  and blockedBy is a non-blank sentence whenever ready is false.
//
// A future condition added to `readiness()` without a sentence fails here. A sentence deleted fails
// here. Neither is visible to a regex over the screen.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readiness } from '../src/contract/composerProduct.ts'

/** Every condition, with an input that turns it on. The names are the ones the screen uses. */
const CONDITIONS = {
  nameStops: { nameStops: ['“AQUAPLUS for energy…” is 210 characters. A mark name may be at most 80.'] },
  gaps: { gaps: ['Add the brand name you want cleared, in Names above.'] },
  stops: { stops: ['A Full country search reads one country. Name it in Where.'] },
  budget: { budget: { allowed: 1, over: 3 } },
  exhausted: { exhausted: true },
  noProduct: { hasProduct: false },
} as const

const CLEAR = {
  gaps: [] as readonly string[],
  stops: [] as readonly string[],
  nameStops: [] as readonly string[],
  budget: null,
  exhausted: false,
  hasProduct: true,
}

test('nothing in the way: ready, and no sentence to show', () => {
  const r = readiness(CLEAR)
  assert.equal(r.ready, true)
  assert.equal(r.blockedBy, null, 'a ready screen is offering a reason it is not ready')
})

test('each condition alone blocks, and says something a reader can act on', () => {
  for (const [name, on] of Object.entries(CONDITIONS)) {
    const r = readiness({ ...CLEAR, ...on })
    assert.equal(r.ready, false, `${name} does not block the action`)
    assert.equal(typeof r.blockedBy, 'string', `${name} blocks the action and says nothing`)
    assert.ok((r.blockedBy ?? '').trim().length > 0, `${name} blocks the action with a blank sentence`)
  }
})

// THE TEST THE NAME PROMISES. Every test above covers one member of the class; this one covers the class,
// because "every way of being not-ready has a sentence" is a claim about all 64 combinations and an
// example proves none of them. It is also what a new condition walks into: add one to `readiness()`
// and this fails until it carries a sentence.
test('over EVERY combination of conditions: ready is exactly having no reason', () => {
  const keys = Object.keys(CONDITIONS) as (keyof typeof CONDITIONS)[]
  let blockedSeen = 0
  for (let mask = 0; mask < (1 << keys.length); mask += 1) {
    const on = keys.filter((_, i) => mask & (1 << i))
    const input = on.reduce((acc, k) => ({ ...acc, ...CONDITIONS[k] }), CLEAR)
    const r = readiness(input)
    const label = on.length ? on.join('+') : 'nothing'
    assert.equal(r.ready, on.length === 0, `${label}: readiness disagrees with its own conditions`)
    if (r.ready) {
      assert.equal(r.blockedBy, null, `${label}: ready and blocked at the same time`)
      continue
    }
    blockedSeen += 1
    assert.equal(typeof r.blockedBy, 'string', `${label}: the action is off with no reason at all`)
    assert.ok((r.blockedBy ?? '').trim().length > 0, `${label}: the action is off under a blank sentence`)
  }
  assert.equal(blockedSeen, (1 << keys.length) - 1, 'the sweep did not drive every blocked combination')
})

// A LIST THAT IS NON-EMPTY AND SAYS NOTHING still blocks. This is the defensive case the function was
// written around: `blockedBy` falls through to the next sentence rather than to null, so an empty
// string arriving from one of the list helpers cannot re-open the button. Driven, because the whole
// point is that the code path is not otherwise reachable from the screen.
test('a blank sentence blocks anyway, and borrows a sentence that is not blank', () => {
  const r = readiness({ ...CLEAR, gaps: [''], exhausted: true })
  assert.equal(r.ready, false, 'a blank gap re-opened the primary action')
  assert.equal(r.blockedBy, 'No searches left on today’s allowance.')

  const only = readiness({ ...CLEAR, gaps: [''] })
  assert.equal(only.ready, false, 'a blank gap re-opened the primary action')
  assert.ok((only.blockedBy ?? '').trim().length > 0, 'the reader is shown a blank explanation')
})

// ORDER IS THE COPY DECISION, not an implementation detail: the footer shows ONE sentence, and it must
// be the one the reader fixes first. Names they typed, then pieces the form wants, then the search.
test('the first reason is the most structural one', () => {
  const all = readiness({
    ...CLEAR,
    ...CONDITIONS.nameStops, ...CONDITIONS.gaps, ...CONDITIONS.stops,
    ...CONDITIONS.budget, ...CONDITIONS.exhausted, ...CONDITIONS.noProduct,
  })
  assert.equal(all.blockedBy, CONDITIONS.nameStops.nameStops[0])

  const noNames = readiness({ ...CLEAR, ...CONDITIONS.gaps, ...CONDITIONS.stops })
  assert.equal(noNames.blockedBy, CONDITIONS.gaps.gaps[0])

  const search = readiness({ ...CLEAR, ...CONDITIONS.stops, ...CONDITIONS.exhausted })
  assert.equal(search.blockedBy, CONDITIONS.stops.stops[0])
})

// The budget sentence carries BOTH figures and agrees with itself on the plural, because it is the one
// reason in the chain composed here rather than handed in as prose.
test('the name budget says how many the search reads and how many are typed', () => {
  const one = readiness({ ...CLEAR, budget: { allowed: 1, over: 3 } })
  assert.equal(one.blockedBy, 'This search reads 1 name at a time, and you have 4.')
  const many = readiness({ ...CLEAR, budget: { allowed: 8, over: 2 } })
  assert.equal(many.blockedBy, 'This search reads 8 names at a time, and you have 10.')
})
