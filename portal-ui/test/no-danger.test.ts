// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The XSS class stays closed.
//
// The old POC page built its rows by concatenating unescaped upstream values — mark names, meta titles,
// recipe labels — into innerHTML. Deleting it closed the instance. What keeps the CLASS closed is that
// React escapes by default, and the only way back in is `dangerouslySetInnerHTML`.
//
// The plan names `react/no-danger: error` as the mechanism. That rule does not exist here — there is no
// eslint anywhere in this repository — and it was described in an earlier commit message as though it
// did, which is worse than the gap itself: a control that is only claimed is a control nobody checks.
//
// Adding a lint toolchain to enforce one rule is not proportionate, so the rule is enforced here, in
// the test runner the repo already uses. If eslint arrives later this test can go; until then it is
// what makes the claim true.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url))

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })

test('no source file reaches for dangerouslySetInnerHTML', () => {
  const offenders = walk(at('../src'))
    .filter((f) => /\.tsx?$/.test(f))
    .filter((f) => readFileSync(f, 'utf8').includes('dangerouslySetInnerHTML'))

  assert.deepEqual(
    offenders,
    [],
    'React escapes by default; this is the one way around it, and the portal renders mark names and '
      + 'recipe labels that users and stored config control',
  )
})

// There is deliberately NO equivalent check over the built bundle, and the reason is worth recording so
// nobody adds one back thinking it was an oversight.
//
// React's own runtime reads `props.dangerouslySetInnerHTML` to implement the feature, and vite emits a
// single chunk with React inlined — so the string is always present in dist/, roughly ten times, from
// the library rather than from us. A grep over the bundle therefore cannot distinguish "the mechanism
// exists" from "we used it", and any filter clever enough to try would be the kind that quietly stops
// matching after a React upgrade and reports success forever.
//
// The source check above is the real control. A bundle check would only be possible with React split
// into its own chunk, which is a build change to serve a test — not worth it.

test('and the app talks to its own origin only', () => {
  // The contract layer is the single permitted caller of fetch. A component reaching past it would
  // route around the Result union — which is where the 404-never-403 rule and the two-shaped 422 live.
  const callers = walk(at('../src'))
    .filter((f) => /\.tsx?$/.test(f))
    .filter((f) => /\bfetch\s*\(/.test(readFileSync(f, 'utf8')))
    .map((f) => f.slice(at('../src').length))

  assert.deepEqual(callers, ['/contract/api.ts'], 'only contract/api.ts may call fetch')

  // …and it must never be pointed at another host.
  const api = readFileSync(at('../src/contract/api.ts'), 'utf8')
  assert.doesNotMatch(api, /fetch\(\s*['"`]https?:/, 'every request is same-origin and path-relative')
})
