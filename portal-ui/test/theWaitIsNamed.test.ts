// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// THE WAIT IS NAMED, NOT LEFT BLANK.
//
// Reported on production, 2026-09-20: the home page and every page that lists clearances showed nothing
// for two to five seconds after the page painted, and the blank read as "nothing loaded". Measured on
// pre-prod the same day: the portal's own work on that path is about 25 ms cold and under 10 ms warm —
// the pool walks in 1 ms, the workspace in 21 ms, the config store answers git in 4 ms. So the wait is
// latency the portal does not control, and what IS the portal's is that it drew nothing while it waited.
//
// TWO PLACES DREW NOTHING, and the second is why the screens' own loading states did not help:
//
//   • AppShell returned an empty <div className="screen" /> until /portal/api/me answered. No screen is
//     mounted during that window, so a screen's own loading state cannot show — the list screen already
//     had one and it never got the chance.
//   • Home computed `answer: 'loading' | 'ok' | 'error'` and branched on 'error' and 'ok' only, so while
//     its own data was in flight it drew the page frame around empty lists.
//
// The wording is the one the product already ships (About: "Loading…"), because a new sentence on a
// client surface is not this change's to write.
//
// Read from the source, commentary stripped, because this runner cannot mount a `.tsx`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { prose } from './support/prose.ts'

const src = (p: string) => prose(readFileSync(new URL(p, import.meta.url), 'utf8')).replace(/\s+/g, ' ')
const SHELL = src('../src/shell/AppShell.tsx')
const HOME = src('../src/screens/Home.tsx')
const ABOUT = src('../src/screens/About.tsx')
const CLEARANCES = src('../src/screens/Clearances.tsx')

test('the shell names the wait instead of drawing an empty frame', () => {
  // THE DEFECT, as the assertion: the frame that waits for /me rendered nothing at all.
  assert.doesNotMatch(SHELL, /if \(!meResult\) return <div className="screen" \/>/,
    'the shell still returns an empty frame while /me is outstanding, which is the blank that was reported')
  assert.match(SHELL, /if \(!meResult\) return <div className="screen">.*Loading….*<\/div>/,
    'the shell does not say it is loading while /me is outstanding')
})

test('the home page says it is loading while its own list is in flight', () => {
  // It already computed the three answers and rendered only two of them.
  assert.match(HOME, /const answer: 'loading' \| 'ok' \| 'error'/,
    'the home page no longer distinguishes the wait from the failure')
  assert.match(HOME, /answer === 'loading' \?/,
    'the home page computes a loading answer and still renders nothing for it')
})

test('the wait is not drawn in the class this page states faults in', () => {
  // MEASURED, NOT ANTICIPATED. The first version of this change put the waiting line in `home2-notice`,
  // which is where Home states a fault and which `scripts/home-render-check.mjs` reads as exactly that.
  // A page with nothing wrong therefore reported a fault, in both themes, in a real browser — the
  // defect this change exists to remove, arriving through the class attribute. The browser check now
  // reads the two separately; this holds the source side of the same line.
  const wait = HOME.slice(HOME.indexOf("answer === 'loading'"))
  const line = wait.slice(0, wait.indexOf(': null}') + 1)
  assert.ok(line.length > 10 && line.length < 200, 'the loading line could not be isolated, so nothing below reads it')
  assert.doesNotMatch(line, /home2-notice/, 'the wait is drawn in the class this page states faults in')
  assert.match(line, /home2-waiting/, 'the wait has no class of its own, so it cannot be told from a fault')
})

test('the wording is one the product already ships, not a new sentence', () => {
  // A new sentence on a client surface is a design decision. This change reuses About's.
  assert.match(ABOUT, /Loading…/, 'the shipped wording this change reuses is gone, so the reuse is no longer a reuse')
  for (const [name, text] of [['the shell', SHELL], ['the home page', HOME]] as const)
    assert.match(text, /Loading…/, `${name} does not use the wording the product already ships`)
})

test('the list screen keeps the loading state it already had', () => {
  // The control on this change: Clearances was never the gap, and must not become one.
  assert.match(CLEARANCES, /if \(!result\) return <Loading \/>/,
    'the clearances list lost the loading state it already had')
  assert.match(CLEARANCES, /Loading your clearances…/,
    'the clearances list no longer names its own wait')
})
