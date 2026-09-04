// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The lockup is the company's own logo, not a lookalike.
//
// Source-text, for the reason screenCopy.test.ts sets out: this runner cannot mount a `.tsx`. What it
// CAN prove is what the lockup says — the wordmark's type, the brand token rather than a hex literal,
// and the two claims it must NOT make: the retired flag and the old brand in an accessible name.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')

// Comments stripped before asserting on rendered content, the same reason screenCopy.test.ts does it:
// this component's header explains the tagline is absent BY NAMING IT, so a whole-file search finds the
// explanation and fails a component that is doing exactly the right thing.
const body = (src: string) =>
  src.split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n')

// THE RIDGE ARM WAS HERE AND WENT WITH THE MARK. It proved the generated module carried the
// vendored SVG unmodified — a real property of a chain that no longer exists, because nothing this
// product renders draws the ridge. `one-bracket-geometry.test.mjs` holds the assertion that matters
// now: no surface carries the ridge viewBox at all.

test('the lockup drops the flag and the tagline', () => {
  const logo = body(read('../src/components/Logo.tsx'))
  // THE ASSERTION IS INVERTED FROM WHAT IT WAS, and that inversion is the point. The Swiss
  // red said "Cordillera, the Swiss company"; the product this portal now fronts is an open-source
  // tool called Clearotron, and the flag makes a claim about it that is no longer true. Pinned as an
  // ABSENCE so a well-meaning restore of the old lockup fails here rather than shipping.
  assert.ok(!logo.includes('#DA291C'), 'the flag is gone — this is not a Swiss firm\'s internal tool')
  assert.ok(!logo.includes('IP Law'), 'the tagline is not rendered in the rail')
})

test('the wordmark is set to the website header, not by eye', () => {
  const logo = read('../src/components/Logo.tsx')
  // These three are the site's lockup type, and they are what makes it read as the same brand rather
  // than as the same word.
  assert.match(logo, /fontSize: 15/)
  assert.match(logo, /fontWeight: 500/)
  assert.match(logo, /letterSpacing: '\.02em'/)
})

test('the mark uses the brand token rather than a hex literal', () => {
  const logo = read('../src/components/Logo.tsx')
  // — THIS PINNED `var(--crimson)`, AND THAT NAME RESOLVES TO NOTHING HERE. The intent below is
  // right and unchanged; the name was wrong. `--crimson` is the BRAND's name for the colour and it is
  // defined in the report stylesheets, but the portal bundles only tokens.css and base.css, and in the
  // portal's vocabulary the brand crimson is `--accent` — shared/portal-tokens.mjs builds it that way:
  //     ["--accent", L("--crimson"), L("--crimson"), "brand --crimson; a FILL, so it does not lighten in dark"]
  // So the lockup's centre bar was rendering with NO FILL, and this test was green the whole time,
  // because it asserted the presence of a string rather than that the string resolves. index.html's
  // own favicon hard-codes #860F09 for that same bar, which is what --accent holds.
  assert.match(logo, /var\(--accent\)/, 'so a brand colour change reaches the lockup like every other surface')
  assert.ok(!/var\(--crimson\)/.test(logo), 'the portal has no --crimson; that name is the report stylesheets\' vocabulary')
  assert.ok(!/#860F09/i.test(logo), 'still a token, not the hex literal it stands for')
})

test('the accessible name of the lockup is the wordmark, not the old brand', () => {
  // THE VISIBLE WORDMARK AND ITS ACCESSIBLE NAME ARE TWO SEPARATE STRINGS, and only one of them was
  // changed by the lockup work. The rail's home button wraps <Logo/> and carries its own aria-label,
  // so a screen reader kept announcing the old brand while every sighted user saw the new one. That
  // is the failure mode worth pinning: it is invisible in a screenshot, invisible in review, and it
  // is the exact claim exists to stop the portal making.
  const shell = read('../src/shell/AppShell.tsx')
  const labels = [...shell.matchAll(/aria-label=[{"'`]([^"'`}]*)/g)].map((m) => m[1])

  assert.ok(labels.length > 0, 'the shell still labels its landmarks — an empty match would pass vacuously')
  for (const l of labels) {
    assert.ok(!/Cordillera/.test(l), `an accessible name still announces the old brand: ${l}`)
  }
  assert.match(shell, /aria-label=\{`\$\{WORDMARK\}/, 'and it reads the wordmark rather than repeating it')
})
