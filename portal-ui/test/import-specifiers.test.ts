// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A relative import without a file extension builds and tests DARK.
//
// Vite resolves `./failure` by extension search; `node --test` does not. So an extensionless specifier
// costs nothing at build time, the browser bundle is correct, and the only symptom is that any test file
// whose import graph reaches it fails to LOAD. Node reports that as ONE failing file — the 38 subtests
// inside it are never counted as absent, because they were never collected at all.
//
// That is what happened to `home.test.ts` under 28a4833 (/): merged red, and its whole suite had
// never executed anywhere. The failure was a module-resolution error at the top of a 359-test run, four
// screens above the summary line.
//
// This test is the guard, and it is a SCAN rather than a convention doc, because the convention was
// already unanimous — 14 of 16 imports in src/contract/ carried `.ts` and nothing enforced it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e)
    return statSync(p).isDirectory() ? walk(p) : (/\.(ts|tsx)$/.test(e) ? [p] : [])
  })
}

// `from './x'` / `from '../x/y'` — the specifier, captured. Covers `import`, `import type` and
// `export … from`, since all three resolve through the same loader.
const RELATIVE = /from\s+'(\.\.?\/[^']*)'/g

test('every relative import carries its file extension — an extensionless one tests dark', () => {
  const offenders: string[] = []
  for (const file of walk(SRC)) {
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(RELATIVE)) {
      const spec = m[1]
      if (!/\.(ts|tsx|js|json|css|svg|png)$/.test(spec)) offenders.push(`${file.slice(SRC.length + 1)} → ${spec}`)
    }
  }
  assert.deepEqual(offenders, [],
    'these resolve under Vite and NOT under node --test, so any test reaching them fails to load and its '
    + 'subtests are never collected — the shape that hid a whole suite under 28a4833')
})
