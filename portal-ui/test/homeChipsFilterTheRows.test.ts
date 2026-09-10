// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — THE COMPANY CHIPS ON HOME FILTER THE ROWS.
//
// Found by the owner on the test box: choosing a company on Home changed nothing. Not merely equal
// counts — the SAME marks stayed on screen under every selection, one company's mark still listed while
// another was chosen. The chips set the shared value and nothing read it.
//
// The rail line is NAVIGATION — dashboard versus working on one company — and not a statement about what
// the filter reaches. Reading it as the filter's boundary is what left the control decorative.
//
// THE TRAP THIS FILE EXISTS FOR is the poll. `usePoll` is armed from whether any run is still going, and
// arming it from the filtered set stops the page refreshing the moment somebody picks a company that
// happens to be idle — while another company's run is live and moving. The screen sits still and looks
// finished. Displayed rows are scoped; the decision to keep looking is not. That is one line apart in
// the source and silent if it goes wrong, so it is pinned here.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')
const HOME = read('../src/screens/Home.tsx')
const NAV = read('../src/nav/nav.config.ts')

test('Home scopes its rows to the selected company', () => {
  // THROUGH runsFor, which compares by runKey. An organisation's Generic is the owner key
  // `generic:<org>` while its runs carry the wire account `generic`, so a bare comparison of the run's
  // account with the owner keeps nothing under a picked Generic. What runsFor keeps — for a company, for
  // a Generic, and for All companies — is driven in companyOrder.test.ts; this holds Home to calling it
  // over the unfiltered set with the picked owner.
  assert.match(HOME, /runsFor\(allRuns, ctx\.owner\)/,
    'Home no longer filters its rows by the selected company — the chips are decorative again')
  assert.doesNotMatch(HOME, /r\.account === ctx\.owner/,
    "Home compares a run's wire account with the owner again, which drops every Generic run under a picked Generic")
})

test('the poll is armed from the UNFILTERED set', () => {
  // The half that fails silently. A filtered poll looks correct on a busy company and wrong on a quiet
  // one, which is the state nobody tests by hand.
  assert.match(HOME, /active: allRuns\.some\(\(r\) => !TERMINAL\.has\(r\.state\)\)/,
    'the poll is armed from the filtered rows — selecting an idle company now stops the page refreshing '
    + 'while another company is still running')
  assert.doesNotMatch(HOME, /active: runs\.some/,
    'the poll reads the scoped set again')
})

test('the rail line is documented as navigation, not as the filter boundary', () => {
  // The comment is what sent the last reader the wrong way, and it is corrected in the same change as
  // the behaviour rather than left to contradict it.
  assert.match(NAV, /THE LINE IS NAVIGATION/,
    'the nav table no longer says the line is navigation, so the next reader can conclude Home ignores the filter again')
  assert.doesNotMatch(NAV, /Above the line you REVIEW ACROSS EVERYTHING/,
    'the superseded reading is back in the table')
})
