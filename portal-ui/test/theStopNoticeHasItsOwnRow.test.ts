// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — THE STOP NOTICE IS A PARAGRAPH, SO IT GETS A ROW.
//
// Found by the owner on a real knockout. The notice rendered as a flex item inside `home2-card-foot`,
// which is a row of short things — the elapsed line and one button — so a sentence of this length
// squeezed "1 min so far" into a two-character column and the card read as garbled.
//
// WHAT THESE ARMS PIN, and why not the CSS alone. A width rule would be undone by the next person who
// puts the notice back in the row, and the styling would look right in isolation while the card was
// wrong. The structural fact is the one that holds: the notice is NOT inside the foot.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SRC = readFileSync(fileURLToPath(new URL('../src/screens/Home.tsx', import.meta.url)), 'utf8')
const CSS = readFileSync(fileURLToPath(new URL('../src/base.css', import.meta.url)), 'utf8')

test('the stop notice renders outside the card foot, not as one of its columns', () => {
  const foot = SRC.indexOf('className="home2-card-foot"')
  const notice = SRC.indexOf('className="home2-stop-note"')
  assert.ok(foot > 0 && notice > 0, 'the card foot or the stop notice is gone from this screen entirely')

  // The foot's own closing tag, found by walking from the foot rather than by matching a `</div>`
  // anywhere: this file has hundreds. The notice must sit after it.
  const footClose = SRC.indexOf('\n        </div>\n', foot)
  assert.ok(footClose > foot, 'could not find where the card foot closes')
  assert.ok(notice > footClose,
    'the stop notice is inside the card foot again — it is a flex item beside the elapsed line, which is the defect')
})

test('the notice is a block with its own spacing, not an inline member of a row', () => {
  const rule = /\.home2-stop-note\s*\{([^}]*)\}/.exec(CSS)
  assert.ok(rule, 'the stop notice has no styling of its own')
  assert.match(rule[1], /margin-top/, 'the notice sits flush against the row above it')
  assert.match(rule[1], /line-height/, 'a wrapped paragraph with no line-height is the same crowding one level down')
})

test('the old class is gone from every surface, not just from this screen', () => {
  // A rename that leaves the old selector in the stylesheet is the state where a reader repairing
  // this later finds two rules and picks the wrong one.
  assert.doesNotMatch(SRC, /home2-stopping/, 'the screen still names the old class')
  assert.doesNotMatch(CSS, /\.home2-stopping\b/, 'the stylesheet still carries a rule for the old class')
})

test('"Stop now" does not promise the step has ended', () => {
  // Ruling 142, and the same shape it was written for: a control whose copy states an outcome the
  // mechanism cannot guarantee. The dialog offers the mode; it must not assert the result.
  const opt = /Stop now<\/b>\s*<span>([\s\S]*?)<\/span>/.exec(SRC)
  assert.ok(opt, 'the Stop now option is gone from the dialog')
  assert.doesNotMatch(opt[1], /The run\s+is over in seconds\./,
    'the dialog states the run is over in seconds, which is the promise the mechanism cannot keep')
  assert.match(opt[1], /next step/,
    'the dialog does not tell the reader what happens when the step will not take the stop')
})
