// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Every `var(--x)` this UI reads must be a property some stylesheet defines —.
//
// A MISSING CUSTOM PROPERTY IS AN ERROR NOWHERE. Not at build, not in the type system, not at run time.
// The declaration is simply dropped and the element inherits, so it renders slightly wrong and only to
// someone who already knew what it should look like. Four screens shipped that way, and the example
// worth keeping is GlobalConfig's stale-snapshot warning — "this snapshot is more than a day old" — which
// rendered in the same colour as the body text around it. The one notice on the page whose job was to be
// noticed was the one with no colour.
//
// THE NAMES CAME FROM THE BRAND, NOT THE STYLESHEET, which is why the mistake looked right when it was
// written. tokens.css annotates its own scale: `--tone-minimal: /* brand --clear */` and
// `--tone-medium: /* brand --med */`. Somebody reading the brand vocabulary wrote `--tone-clear` and
// `--tone-med`, and three of the five tones happen to share both names, so only the two that differ
// broke. `--crimson` is the same shape one palette over: `--accent: /* brand --crimson; a FILL */`.
//
// This guard found two the issue had not: `--crimson` in the logo and `--text-secondary` in base.css.
// That is the argument for owning the CLASS rather than the three sites.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TONES } from '../src/contract/tone.ts'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (/\.(tsx?|css)$/.test(e)) out.push(p)
  }
  return out
}

const FILES = walk(SRC)
const READ = /var\(\s*(--[A-Za-z0-9_-]+)/g
// A definition is `--x:` at the start of a declaration. The leading-boundary group keeps `--x` inside a
// `var(--x, fallback)` from reading as one.
const DEFINE = /(?:^|[;{\s])(--[A-Za-z0-9_-]+)\s*:/gm
// A name assembled at run time — `var(--tone-${r.tone})`. The static prefix is not a property name and
// must not be reported as a missing one; it is counted and asserted separately below, because an
// exemption nobody can see is how the next hole gets in.
const INTERPOLATED = /var\(\s*--[A-Za-z0-9_-]*\$\{/

const defined = new Set<string>()
for (const f of FILES) {
  for (const m of readFileSync(f, 'utf8').matchAll(DEFINE)) defined.add(m[1])
}

test('#1459 every custom property the UI reads is defined somewhere in src/', () => {
  const missing: string[] = []
  for (const f of FILES) {
    const text = readFileSync(f, 'utf8')
    text.split('\n').forEach((line, i) => {
      if (INTERPOLATED.test(line)) return
      for (const m of line.matchAll(READ)) {
        if (!defined.has(m[1])) missing.push(`${relative(SRC, f)}:${i + 1}  ${m[1]}`)
      }
    })
  }
  assert.deepEqual(missing, [],
    `these render with no value at all — an undefined custom property is dropped silently:\n  ${missing.join('\n  ')}`)
})

test('#1459 the guard can see a missing property — it is not vacuously green', () => {
  // A ZERO IS EVIDENCE ONLY IF THE INSTRUMENT CAN SHOW NON-ZERO. Both halves are exercised on the same
  // synthetic input, so a future edit that breaks the reader (a changed regex, a narrowed walk) fails
  // here rather than turning the arm above into a green that means nothing.
  const defs = new Set<string>()
  for (const m of ':root { --real: #fff; --other: 1px }'.matchAll(DEFINE)) defs.add(m[1])
  assert.deepEqual([...defs].sort(), ['--other', '--real'])

  const reads = [...'color: var(--real); border: var(--ghost)'.matchAll(READ)].map((m) => m[1])
  assert.deepEqual(reads, ['--real', '--ghost'])
  assert.deepEqual(reads.filter((v) => !defs.has(v)), ['--ghost'], 'the guard cannot see an undefined property')
})

test('#1459 the run-time-assembled names RESOLVE — the hole is closed, not counted', () => {
  // `var(--tone-${tone})` cannot be read statically, and a guard that merely skips it leaves the whole
  // tone palette outside its reach — which is most of the colour in this UI. But the names are not
  // arbitrary: `TONES` is a five-entry const tuple and `toneChip` widens only the three in CHIP_TONES.
  // So every name this module can possibly build is enumerable, and each one is checked here.
  assert.equal(INTERPOLATED.test('background: `var(--tone-${r.tone})`'), true)
  assert.equal(INTERPOLATED.test("color: 'var(--tone-high)'"), false, 'a static name must NOT be skipped')

  const missing: string[] = []
  for (const tone of TONES) {
    if (!defined.has(`--tone-${tone}`)) missing.push(`--tone-${tone}`)
  }
  // toneChip's soft/text pair, for the three tones the brand system actually gives one. `low` and
  // `severe` deliberately have none and fall back to the base tone at low alpha, so demanding a pair
  // for them would fail on a decision rather than on a defect.
  for (const tone of ['minimal', 'medium', 'high']) {
    for (const suffix of ['soft', 'tx']) {
      if (!defined.has(`--tone-${tone}-${suffix}`)) missing.push(`--tone-${tone}-${suffix}`)
    }
  }
  assert.deepEqual(missing, [], `a tone name this UI builds at run time resolves to nothing: ${missing.join(', ')}`)

  // And the pair really is withheld for the other two, so the exemption above describes the code
  // rather than excusing whatever the code happens to do.
  for (const tone of ['low', 'severe']) {
    assert.equal(defined.has(`--tone-${tone}-soft`), false,
      `--tone-${tone}-soft now exists — toneChip's CHIP_TONES set should widen to include it`)
  }
})

test('#1459 the tone scale is exactly the five the brand defines, in both themes', () => {
  // The pin that stops the original mistake recurring: the names that broke were brand names for tones
  // whose CSS names differ. If the scale gains or renames a step, this fails and whoever does it has to
  // look at the brand-vs-token mapping rather than discover it from a colourless notice.
  const tokens = readFileSync(join(SRC, 'tokens.css'), 'utf8')
  const tones = [...tokens.matchAll(/(--tone-[a-z]+)\s*:/g)].map((m) => m[1])
  const distinct = [...new Set(tones)].sort()
  assert.deepEqual(distinct, ['--tone-high', '--tone-low', '--tone-medium', '--tone-minimal', '--tone-severe'])
  assert.equal(tones.length, distinct.length * 2, 'every tone must be defined in BOTH the light and dark blocks')
  for (const dead of ['--tone-clear', '--tone-med']) {
    assert.equal(tokens.includes(`${dead}:`), false,
      `${dead} is a BRAND name, not a token name — defining it would add a sixth step to a five-step scale`)
  }
})
