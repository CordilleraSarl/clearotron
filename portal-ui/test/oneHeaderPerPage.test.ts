// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// ONE HEADER LINE PER PAGE, AND ONE AUTHOR OF IT.
//
// Owner, on production: "We have double headers on each page, stupid." Ten screens opened with an
// uppercase eyebrow over a heading — People over People, Custom searches over Custom searches, Home
// over Now — which is a header and its echo. Each screen also wrote its own `fontSize: 27` inline, and
// two had already drifted to different margins by the time anybody counted.
//
// THIS IS A CORPUS GUARD, SO IT DISCOVERS ITS OWN POPULATION. A list of screen names here would pass
// the day somebody adds the eleventh screen with a hand-written pair, which is exactly how the first
// ten came to exist.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : (e.name.endsWith('.tsx') ? [join(dir, e.name)] : []))

const FILES = walk(SRC).filter((f) => !f.endsWith('components/PageHeader.tsx'))
const rel = (f: string) => f.slice(SRC.length)
const read = (f: string) => readFileSync(f, 'utf8')

test('the population is the whole tree, and it is plausibly large', () => {
  // A FLOOR FIRST. Everything below is an absence, and an absence over an empty list reads exactly like
  // an absence over the real one. The walker returning nothing — a moved directory, a renamed
  // extension — would certify the entire rule.
  assert.ok(FILES.length >= 20, `the screen walk found ${FILES.length} files, which is not this tree`)
  assert.ok(FILES.some((f) => rel(f) === 'screens/Home.tsx'), 'the walk missed Home — it is not reading src/')
})

test('NO SCREEN OPENS WITH AN EYEBROW OVER A HEADING — that pair is the double header', () => {
  // Read as text, and deliberately over a WINDOW rather than adjacent lines: the pair on the new
  // clearance screen had a component and a four-line note between the two, and an adjacency check
  // would have called that screen clean while a reader saw the same two lines stacked.
  const offenders: string[] = []
  for (const f of FILES) {
    const lines = read(f).split('\n')
    let eyebrow = -99
    lines.forEach((l, i) => {
      if (/className="eyebrow"/.test(l)) eyebrow = i
      if (/<h1\b/.test(l) && i - eyebrow <= 8) offenders.push(`${rel(f)}:${i + 1} (eyebrow at ${eyebrow + 1})`)
    })
  }
  assert.deepEqual(offenders, [], 'a screen carries an eyebrow above a heading again')
})

test('THE EYEBROW CLASS STILL LABELS SECTIONS, and that is not a regression', () => {
  // The class was not deleted, and this says so on purpose: it labels a group of fields, a stop
  // control, a set of reads — which is what it was for before it became a second heading. An arm that
  // only forbade the pair could be "satisfied" by deleting the class everywhere, which would strip
  // those labels off half the product; this is the floor under that.
  const survivors = FILES.filter((f) => /className="eyebrow"/.test(read(f)))
  assert.ok(survivors.length >= 4,
    `only ${survivors.length} file(s) still label a section — the class has been swept rather than demoted`)
})

test('EVERY PAGE HEADER GOES THROUGH THE ONE COMPONENT, never a hand-styled heading', () => {
  // The rule that keeps the sizes from drifting again. Not "no h1 anywhere": an empty state, a session
  // notice and a run's own mark are headings inside a page rather than the page's name, and they are
  // sized for where they sit. What may not come back is a screen composing the PAGE's header itself,
  // and the tell for that is the 27px the ten copies all carried.
  const handRolled = FILES.filter((f) => /<h1[^>]*fontSize: 27/.test(read(f))).map(rel)
  assert.deepEqual(handRolled, [], 'a screen is writing the page header itself again')

  const users = FILES.filter((f) => /<PageHeader\b/.test(read(f))).map(rel)
  assert.ok(users.length >= 10,
    `only ${users.length} screen(s) use the shared header — the others are composing their own`)
  assert.ok(users.includes('screens/Home.tsx') && users.includes('screens/Clearances.tsx'),
    'the two screens the owner named are not both on the shared header')
})
