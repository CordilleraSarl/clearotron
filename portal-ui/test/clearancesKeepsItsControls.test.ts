// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — FILTERING TO AN EMPTY COMPANY LEAVES THE WAY OUT ON SCREEN.
//
// Found by the owner. Choosing a company with no clearances replaced the whole screen, chips and status
// filters included — and the chips are the only way to change company there. The one state where
// somebody most wants a different company was the state that removed the control, reached by using the
// feature correctly. Same shape as the New company route vanishing the moment a company was selected.
//
// The control on the issue is what makes it a defect rather than a preference: a company that HAS rows
// keeps all seven chips and all five filters on the same click.
//
// WHAT THE FIX TURNS ON, and it is one identifier. The first-run screen tested the FILTERED runs; it must
// test the account's whole set. An account with genuinely nothing still gets the full-screen first run —
// there is no filter to undo — and an empty FILTER renders inside the list instead.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SRC = readFileSync(fileURLToPath(new URL('../src/screens/Clearances.tsx', import.meta.url)), 'utf8')

test('the full-screen first run is keyed off the account, not off the filter', () => {
  assert.match(SRC, /if \(!allRuns\.length\) return <FirstRun/,
    'the first-run screen tests the filtered set again — an empty company replaces the whole page')
  assert.doesNotMatch(SRC, /if \(!runs\.length\) return <FirstRun/,
    'the filtered set is back in the early return, which is the defect exactly')
})

test('the empty state renders inside the list, below the controls', () => {
  const chips = SRC.indexOf('<CompanyChips')
  const filters = SRC.indexOf('aria-label="Filter by status"')
  const empty = SRC.indexOf('No clearances match this view')
  assert.ok(chips > 0 && filters > 0 && empty > 0, 'one of the three is gone from the screen entirely')
  assert.ok(empty > chips, 'the empty state renders before the company chips — it is replacing them again')
  assert.ok(empty > filters, 'the empty state renders before the status filters')
})

test('the empty state names the way out rather than only the absence', () => {
  // A dead end that says "nothing here" and stops is the defect with better manners. It has to say what
  // to do, because the controls that do it are the ones that used to disappear.
  assert.match(SRC, /Pick another company above, or widen the status filter/,
    'the empty state stopped telling the reader how to leave it')
})

test('nothing renders the controls conditionally on there being rows', () => {
  // The regression this invites: somebody hides the chips when the list is empty "to tidy it up", which
  // is the original defect in a smaller costume.
  assert.doesNotMatch(SRC, /visible\.length \? [\s\S]{0,80}CompanyChips/,
    'the company chips are drawn conditionally on rows again')
  assert.doesNotMatch(SRC, /runs\.length \? [\s\S]{0,80}Filter by status/,
    'the status filters are drawn conditionally on rows again')
})
