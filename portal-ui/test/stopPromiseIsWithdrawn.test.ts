// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — THE STOP DIALOG WITHDRAWS ITS PROMISE ONCE THE RUN CANNOT KEEP IT.
//
// Measured: a stop was pressed, the dialog said "nothing is delivered", and a complete report was
// published a hundred seconds later. The engine half of that is fixed — a stop is now read once more
// immediately before publishing, on both lanes — but a run that has already committed to publishing is
// past its last stoppable point, and the dialog must say so rather than promise the opposite.
//
// WHY THE SCREEN IS TOLD RATHER THAN WORKING IT OUT. The obvious derivation is arithmetic over the step
// number, and it is wrong: "Report & publish" is step 4 of 5 on the knockout lane, not the last, so
// `stepN === stepTotal` names "Sending to you" and would withdraw the promise on the wrong step while
// leaving it on the right one. The lanes write `stoppable: false` at the moment they commit, which is
// where the fact becomes true.
//
// This file carries no jsdom and no renderer, like every other copy check here: it reads the source. It
// pins the BRANCH and the two sentences, not the layout.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')
const HOME = read('../src/screens/Home.tsx')
const API = read('../src/contract/api.ts')

test('the dialog branches on stoppable, and says something different on each side', () => {
  assert.match(HOME, /stoppable\s*\?/, 'the stop dialog no longer branches — one sentence is being shown in both states')

  // The promise, on the side that can keep it.
  assert.match(HOME, /nothing is delivered/,
    'the dialog stopped promising that nothing is delivered, on the side where that is true and worth saying')

  // The withdrawal, on the side that cannot. Pinned by its claim rather than its wording: it must not
  // assert the outcome, and it must say why.
  assert.match(HOME, /may not prevent delivery/,
    'the dialog no longer warns that a stop may not prevent delivery once the run is past that point')
  assert.match(HOME, /already writing its report/,
    'the withdrawal gives no reason, so a reader cannot tell whether it applies to them')
})

test('the dialog is GIVEN the fact rather than deriving it from the step number', () => {
  assert.match(HOME, /stoppable=\{run\.stoppable\}/,
    'the dialog no longer takes stoppable from the row')
  // The derivation that looks right and is not. "Report & publish" is step 4 of 5 on the knockout lane.
  assert.doesNotMatch(HOME, /stepN\s*[=><]==?\s*.*stepTotal/,
    'the screen derives the stoppable point from step arithmetic — that names the wrong step on the knockout lane')
})

test('an absent stoppable field reads as still stoppable, and an explicit false does not', () => {
  // A SOURCE PIN, and the reason is worth stating rather than leaving as a shortcut: `decodeRun` is not
  // exported and nothing in this suite drives it — the row decoder is reached only through the fetch
  // functions. Widening an export purely for a test would change the contract's surface to check it.
  //
  // THE DEFAULT IS THE TRUTHFUL ONE, NOT THE CONVENIENT ONE. Both lanes write the field at the moment
  // they commit to publishing, so its absence means the run has not reached that point. Written as
  // `!== false` for exactly that: `Boolean(r['stoppable'])` would read an absent field as PAST the
  // stoppable point and warn on every ordinary run, and `=== true` would do the same.
  assert.match(API, /stoppable:\s*r\['stoppable'\]\s*!==\s*false/,
    "the row decoder no longer defaults stoppable to true — an absent field now reads as past the "
    + "stoppable point, so every ordinary run would show the warning")
  assert.doesNotMatch(API, /stoppable:\s*r\['stoppable'\]\s*===\s*true/,
    'the decoder requires an explicit true, which makes every older door\'s runs read as unstoppable')
})
