// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The strip after a company is made: what it says, and the one thing it must never soften.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handOff, takeCreated, createdStrip } from '../src/contract/companyCreated.ts'
import type { CreatedCompany } from '../src/contract/api.ts'

const made = (over: Partial<CreatedCompany> = {}): CreatedCompany => ({
  key: 'acme',
  name: 'Acme Ltd',
  framework: { path: 'skills/prelim-search/risk-framework.md', defaulted: true },
  marketplaces: { count: 6, defaulted: true },
  commitError: null,
  ...over,
})

test('THE STRIP NAMES THE FRAMEWORK AND WHETHER IT WAS CHOSEN', () => {
  // The rating was the whole reason a confirmation page was drawn, so it is the thing the strip cannot
  // lose. Both directions, because a line that always says "default" is not reporting anything.
  assert.match(createdStrip(made()).line, /Acme Ltd added/)
  assert.match(createdStrip(made()).line, /General default rating/)

  const own = createdStrip(made({ framework: { path: 'own/rubric.md', defaulted: false } }))
  assert.doesNotMatch(own.line, /General default/, 'a company with its own framework is not told it defaulted')
  assert.match(own.line, /own rating framework/i)
})

test('THE MARKETPLACE COUNT SAYS WHETHER IT DEFAULTED, both ways', () => {
  assert.match(createdStrip(made()).line, /6 marketplaces by default/)
  assert.match(
    createdStrip(made({ marketplaces: { count: 3, defaulted: false } })).line,
    /3 marketplaces(?! by default)/,
    'a stated list is not described as a default',
  )
})

test('WRITTEN AND RECORDED ARE TWO EVENTS — the company is LIVE, and the strip says so', () => {
  // The failure this guards: reporting a failed commit as a failed create. The company exists and is
  // already governing searches; telling somebody nothing happened is the one wrong answer here.
  const clean = createdStrip(made())
  assert.equal(clean.warning, null, 'nothing to warn about when the commit landed')

  const gap = createdStrip(made({ commitError: 'git push rejected' }))
  assert.ok(gap.warning, 'a failed commit is reported')
  assert.match(gap.warning, /live/, 'it says the company exists')
  assert.match(gap.warning, /search/, 'and that it can be searched under')
  assert.doesNotMatch(gap.warning, /not created|failed to create|nothing was/i,
    'it never reads as though the company was not made')

  // The line itself is unchanged — the company was added, and that is still true.
  assert.equal(gap.line, clean.line)
})

test('THE HAND-OFF IS TAKEN ONCE, so the announcement does not follow somebody around', () => {
  handOff(made())
  const first = takeCreated()
  assert.ok(first, 'the screen that lands gets it')
  assert.equal(first.key, 'acme')

  assert.equal(takeCreated(), null, 'and it is gone — navigating back does not replay it')
})

test('NOTHING PENDING IS NULL, not an invented company', () => {
  takeCreated()
  assert.equal(takeCreated(), null)
})
