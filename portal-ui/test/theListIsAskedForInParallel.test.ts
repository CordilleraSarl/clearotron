// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// THE LIST IS ASKED FOR BESIDE THE IDENTITY CALL, NOT AFTER IT.
//
// The shell asks who you are and draws an empty frame until that answers, and no screen is mounted
// behind that frame — so on the two pages that list clearances the list was not REQUESTED until the
// identity call had returned. Two round trips in series, and whatever one costs paid twice.
//
// Measured in a real browser against the built bundle, with the identity call held 400 ms:
//
//   before    0 ms  /portal/api/me        after    0 ms  /portal/api/runs
//           463 ms  /portal/api/runs              21 ms  /portal/api/me
//
// The portal's own work on this path is about 25 ms cold and under 10 ms warm (measured on a copy of
// the production store), so what this removes is a whole round trip, not computation.
//
// THE GATE'S PATHS ARE THE NAV'S OWN, and this arm exists mostly to hold that. The first version read
// `/portal` for the home page. Home is `/portal/home`, so the early request never fired on the page it
// was written for, and only the browser measurement showed it — every unit check passed, because each
// half was right on its own.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { NAV } from '../src/nav/nav.config.ts'
import { prose } from './support/prose.ts'

const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const MAIN = src('../src/main.tsx')
const flat = (es: readonly any[]): readonly any[] => es.flatMap((e) => [e, ...flat(e.children ?? [])])
const pathFor = (id: string) => flat(NAV).find((e) => e.id === id)?.path

test('the early request is gated on the paths the nav actually serves', () => {
  const gate = MAIN.slice(MAIN.indexOf('EARLY_RUNS_PATHS'))
  const list = gate.slice(gate.indexOf('['), gate.indexOf(']') + 1)
  for (const id of ['home', 'clearances']) {
    const p = pathFor(id)
    assert.ok(p, `the nav no longer has a ${id} entry, so this arm cannot check the gate`)
    assert.ok(list.includes(`'${p}'`),
      `the early request is not fired on ${id} (${p}) — the page it exists for would still wait for /me`)
  }
})

test('both screens that list clearances consume the early request rather than adding one', () => {
  // NOT AN EXTRA CALL. The per-identity rate budget is shared across a person's tabs, so a prefetch
  // that the screen did not consume would be paid for on every load of these two pages.
  for (const [name, text] of [
    ['home', prose(src('../src/screens/Home.tsx'))],
    ['clearances', prose(src('../src/screens/Clearances.tsx'))],
  ] as const)
    assert.match(text.replace(/\s+/g, ' '), /useLoad\(\(\) => api\.runsMine\(\), \[\], 'runs:mine'\)/,
      `${name} makes its own list request instead of consuming the one started early`)
})

test('an early answer is claimed once, so a reload never gets a stale one', () => {
  // The other direction, and the one that would be silent: a prefetch handed out twice would serve a
  // poll or a reload an answer from before the shell knew who was signed in.
  const api = prose(src('../src/state/useApi.ts')).replace(/\s+/g, ' ')
  assert.match(api, /startedEarly\.delete\(key\)/, 'the early answer is never removed, so it can be served again')
  assert.match(api, /claimEarly<T>\(early\) \?\? fetcherRef\.current\(\)/,
    'a reload no longer falls through to the fetcher')
})
