// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A table that continues past the wrapper's right edge shows that it does — and the two ways of asking
// for a scrollbar must never meet.
//
// base.css already argued half of this beside `.table-wrap`: a table a reader drags sideways is readable,
// one printed through itself is not. The other half is that a reader has to be able to SEE that it drags.
// Ruled 2026-09-17: a scrollbar, always visible, no text.
//
// WHAT THIS ARM IS ACTUALLY FOR. Setting the standard `scrollbar-width` on `.table-wrap` beside the
// `::-webkit-scrollbar` pseudo-elements makes the engine take the standard path and IGNORE them, and on
// the engine these pages render in that path draws an overlay bar with no layout height at all. Measured
// at 400px on the built stylesheet, reading the height the bar takes out of the wrapper: both together
// 0px, pseudo-elements alone 9px, standard alone 0px.
//
// So the tidy-up that merges the two blocks back into one rule deletes the scrollbar and leaves every
// other check green. Nothing about reading the file tells you that, which is why it is pinned here and
// not left to the comment.
//
// BREAK MATRIX:
//   · the pseudo-elements are there              → break: drop them, arm 1 red
//   · the bar has a height to be seen by         → break: height 0, arm 2 red
//   · `.table-wrap` itself carries NEITHER       → break: add scrollbar-width to it, arm 3 red
//   · the support block carries them instead     → break: delete the block, arm 4 red
//   · the thumb is a token, not a fixed colour   → break: hard-code it, arm 5 red
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')
const css = readFileSync(join(SRC, 'base.css'), 'utf8')

/** The body of the FIRST rule with this exact selector, or null. */
const ruleFor = (selector: string): string | null => {
  const re = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`)
  return (css.match(re) || [])[1] ?? null
}

test('the table wrapper draws a scrollbar, and the two scrollbar instructions never meet', () => {
  const bar = ruleFor('.table-wrap::-webkit-scrollbar')
  assert.ok(bar, 'the wrapper draws no scrollbar rule at all')
  assert.match(bar, /height:\s*[1-9]/, 'the scrollbar has no height, so there is nothing for a reader to see')
  assert.match(bar, /-webkit-appearance:\s*none/,
    'without this the platform draws an overlay bar that appears only once a scroll is already under way')

  const thumb = ruleFor('.table-wrap::-webkit-scrollbar-thumb')
  assert.ok(thumb, 'the scrollbar has no thumb rule')
  assert.match(thumb, /var\(--/, 'the thumb carries a fixed colour, which reads on one ground and vanishes on the other')

  // THE ONE THAT SURVIVES A SCREENSHOT. A reviewer looking at the page cannot see this, and the repair
  // that causes it looks like adding a fallback.
  const own = ruleFor('.table-wrap')
  assert.ok(own, '.table-wrap has no rule of its own')
  assert.doesNotMatch(own, /scrollbar-width|scrollbar-color/,
    'the standard property sits on .table-wrap beside the pseudo-elements, which makes the engine ignore them and draw nothing')

  // …AND THE ENGINES WITHOUT THE PSEUDO-ELEMENTS STILL GET ONE.
  const supports = css.slice(css.indexOf('@supports not selector(::-webkit-scrollbar)'))
  assert.ok(css.includes('@supports not selector(::-webkit-scrollbar)'),
    'nothing carries the standard instruction to the engines that take it')
  assert.match(supports.slice(0, 220), /scrollbar-width/, 'the support block does not carry the property it exists for')
  assert.match(supports.slice(0, 220), /var\(--/, 'the support block hard-codes a colour')
})
