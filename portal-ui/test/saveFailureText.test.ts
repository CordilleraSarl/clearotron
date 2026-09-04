// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — a save that did not save must say WHY.
//
// The owner hit "That change could not be saved." on production, trying to clear away a run that had
// failed. had already closed once on the same sentence. It survived that closure because neither
// end of the transaction could be read: the client discarded the whole result, and the record on the
// box was in a file nobody had been told about.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { saveFailureText } from '../src/contract/api.ts'
import type { Result } from '../src/contract/api.ts'

const CLEARANCES = new URL('../src/screens/Clearances.tsx', import.meta.url)

test('#1254 the server\'s own words survive to the alert', () => {
  assert.equal(saveFailureText({ kind: 'reject', errors: ['run not in the pool', 'and it is not yours'] }),
    'run not in the pool\nand it is not yours')
  assert.equal(saveFailureText({ kind: 'gate', message: 'confirm this first' }), 'confirm this first')
  assert.equal(saveFailureText({ kind: 'conflict', message: 'someone else saved it' }), 'someone else saved it')
  assert.equal(saveFailureText({ kind: 'upstream', message: 'pool host unreachable' }), 'pool host unreachable')
  assert.equal(saveFailureText({ kind: 'collision', errors: ['two names kebab to the same slug'] }),
    'two names kebab to the same slug')
  assert.equal(saveFailureText({ kind: 'clarify', questions: ['which account?'] }), 'which account?')
})

test('#1254 EVERY non-ok branch says something, and none of them says the old sentence', () => {
  // The union has eleven members. A `default` would swallow the next one added, and the defect being
  // replaced was precisely a message that told the reader nothing — so each branch is named and each
  // is required to produce text a person can act on.
  const all: Result<unknown>[] = [
    { kind: 'reject', errors: [] }, { kind: 'collision', errors: [] }, { kind: 'clarify', questions: [] },
    { kind: 'gate', message: '' }, { kind: 'conflict', message: '' }, { kind: 'upstream', message: '' },
    { kind: 'notFound' }, { kind: 'rateLimited' }, { kind: 'tooLarge' }, { kind: 'noAccess' }, { kind: 'pickAccount' },
  ]
  for (const r of all) {
    const text = saveFailureText(r)
    assert.ok(text.trim().length > 0, `${r.kind} produced an empty alert`)
  }
  // An EMPTY errors/message array falls back rather than alerting a blank box — a server that refuses
  // without saying why still has to produce a sentence.
  assert.equal(saveFailureText({ kind: 'reject', errors: [] }), 'That change could not be saved.')
  assert.equal(saveFailureText({ kind: 'upstream', message: '' }, 'custom'), 'custom')
})

test('#1254 a 404 does not guess which of the two things it means', () => {
  // The contract says a 404 covers "does not exist" AND "not yours", deliberately indistinguishable.
  // A message picking one would be the screen inventing a fact the server refused to state.
  const t = saveFailureText({ kind: 'notFound' })
  assert.match(t, /Reload/)
  assert.ok(!/permission|not yours|deleted/i.test(t), `the 404 message guessed a cause: ${t}`)
})

test('#1254 the Clearances screen no longer throws the reason away', () => {
  const src = readFileSync(CLEARANCES, 'utf8')
  // The exact shape the owner met, three times over. Read from source because the defect is a shape:
  // `r` in scope and discarded reads perfectly well, which is how it survived a closure.
  assert.ok(!src.includes("window.alert('That change could not be saved.')"),
    'a fixed-sentence alert is back on the Clearances screen — the reason is being discarded again')
  assert.match(src, /saveFailureText\(r\)/, 'the retire/restore/ungroup sites stopped reporting the reason')
  // The group-as-a-family site read only `reject` and let the other ten branches fall through to a
  // fixed sentence. One shape on this screen, not two.
  assert.ok(!src.includes("r.kind === 'reject' ? r.errors.join"),
    'the hand-rolled reject-only branch is back — it is the same defect with nine branches instead of ten')
})

// ── — THE POPULATION, not the one screen ────────────────────────────────────
//
// fixed the Clearances screen. In one session on his own install the owner met the same defect on
// three more controls: Stop showed nothing at all, Retire's `unknown run` was swallowed, and Acknowledge
// replaced "only a failed or cancelled run can be acknowledged" — a sentence a reader can act on — with
// "That could not be saved just now. Nothing has changed."
//
// So the arm is over every screen rather than over the one that was reported. It reads source because
// the defect is a SHAPE: a result in scope and discarded compiles and reads perfectly well, which is how
// it survived one closure already.
test('2077 no screen composes its own answer where the server sent one', () => {
  const dir = new URL('../src/screens/', import.meta.url)
  const screens = readdirSync(dir).filter((f) => f.endsWith('.tsx'))
  assert.ok(screens.length >= 9, `only ${screens.length} screens found — the scan has broken, not the tree`)

  for (const file of screens) {
    const src = readFileSync(new URL(file, dir), 'utf8')
    // THE HAND-ROLLED READ OF ONE MEMBER. `'message' in r` reaches the three kinds that carry a message
    // and drops the reason on every other — a 400 naming what was wrong, a 404 saying the run has gone,
    // a session that ended mid-action. Every one of those has a branch in `saveFailureText` already.
    assert.ok(!/\bsetFailed\([^)]*'message' in r/.test(src),
      `${file} reads one member of the union by hand instead of going through saveFailureText`)
    // A fixed sentence is allowed only as the FALLBACK argument, never as the whole answer.
    assert.ok(!/setFailed\('That could not be saved just now/.test(src),
      `${file} shows the sentence the owner reported instead of what the server said`)
  }

  // AND THE TWO CONTROLS THE ISSUE NAMES actually route through it — the negative above passes on a
  // screen that reports nothing at all, which was Stop's behaviour.
  const home = readFileSync(new URL('Home.tsx', dir), 'utf8')
  assert.equal((home.match(/saveFailureText\(r,/g) ?? []).length, 2,
    'Acknowledge and Stop do not both report the server\'s own reason')
})
