// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The allowance refusal exists twice — on the server, which refuses the request, and in the browser,
// which warns before one is made. A reader can meet both in the same minute, and two sentences about one
// fact is the thing this pins shut. The browser cannot import the server module at runtime, so the copy
// is deliberate and this is what makes it safe: the same arrangement effortModelParity.test.ts holds for
// the effort model.
//
// If this fails, do NOT edit one side to match. Decide which sentence is right, change that one, and
// carry it across.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allowanceLine } from '../src/contract/allowance.ts'
import { allowanceExhaustedLine } from '../../driver/portal-service.mjs'

const spent = (cap: number) => ({ account: 'a', today: cap, thisMonth: cap, queued: 0,
  dailyRuns: cap, monthlyRuns: null, maxQueued: null, capped: true })

test('the screen warns in the sentence the server refuses with', () => {
  // A configured brand and no brand at all: the second is the deployment the defect lived on, because
  // the portal's fallback for an unset brand is the WORDS "the operator" rather than an empty string.
  for (const [label, brand, who] of [
    ['a configured brand', 'Northwind Group', 'Northwind Group'],
    ['no brand configured', '', 'the operator'],
  ] as const) {
    for (const cap of [1, 3, 20]) {
      assert.equal(allowanceLine(spent(cap), brand), allowanceExhaustedLine(cap, who),
        `${label}, ${cap} a day: the screen and the server tell one reader two different things`)
    }
  }
})

test('the sentence addresses the operator by name, never around it', () => {
  const unset = allowanceLine(spent(3), '')
  // THE DEFECT ITSELF, spelled out: with no brand configured the wrapper produced "ask your the operator
  // contact". A reader meets this on the one screen where they have already been refused.
  assert.ok(!/your the operator/.test(unset), `the refusal reads: ${JSON.stringify(unset)}`)
  assert.ok(!/\byour\b/.test(unset), `nothing is addressed as the reader's own here: ${JSON.stringify(unset)}`)
  assert.match(unset, /ask the operator to run this one for you\.$/)
  assert.match(allowanceLine(spent(3), 'Northwind Group'), /ask Northwind Group to run this one for you\.$/)

  // AND THE LINE BESIDE IT IS UNCHANGED. The five-or-fewer warning already had this shape and the
  // approved design keeps it; a fix that moved both would have been a change nobody asked for.
  const warn = allowanceLine({ ...spent(3), today: 1 }, 'Northwind Group')
  assert.match(String(warn), /^2 searches left today\. The allowance resets at midnight UTC, or ask Northwind Group to run one for you\.$/)
})
