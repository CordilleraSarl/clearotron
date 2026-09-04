// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Width is a zone-type decision made in the layout module, once.
//
// Owner, reviewing his own screens: "we INCONSISTENTLY use screen width … consistency is important."
// The sweep found seventeen inline maxWidth literals across seven screens in nine values — each its
// author's guess, which is how the inconsistency shipped. The vocabulary lives in base.css
// (.prose, .fld-narrow/.fld-medium/.fld-wide, .measure, .screen); a screen COMPOSES it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const dir = (rel: string) => fileURLToPath(new URL(rel, import.meta.url))

test('2086: NO screen states a width literal of its own — the module is the one author', () => {
  const screens = readdirSync(dir('../src/screens')).filter((f) => f.endsWith('.tsx'))
  assert.ok(screens.length >= 10, `only ${screens.length} screens found — the walker broke, not the tree`)
  const offenders: string[] = []
  for (const f of screens) {
    const src = readFileSync(dir(`../src/screens/${f}`), 'utf8')
    // Code only: a comment RECORDING that a literal was removed must not read as one returning.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n')
      .map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n')
    for (const m of code.matchAll(/max-?[Ww]idth/g)) { void m; offenders.push(f) }
  }
  assert.deepEqual([...new Set(offenders)], [],
    'a screen re-grew its own width literal — width is a zone decision; add or reuse a class in base.css')
})

test('2086: the vocabulary the screens compose actually exists in the module', () => {
  // Anti-vacuity: the arm above would also pass on a tree where the classes were deleted and every
  // screen simply lost its cap — full-width prose everywhere, silently.
  const css = readFileSync(dir('../src/base.css'), 'utf8')
  for (const cls of ['.prose', '.fld-narrow', '.fld-medium', '.fld-wide', '.measure']) {
    assert.ok(css.includes(`${cls} `) || css.includes(`${cls},`) || css.includes(`${cls}{`) || css.includes(`${cls} {`),
      `${cls} is gone from base.css — the vocabulary the screens compose no longer exists`)
  }
})
