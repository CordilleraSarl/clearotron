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
// The screens a reader navigates to, plus the one placeholder screen that lives in the entry file. The
// shell is deliberately not here — see the note in the arm that uses this.
const SCREENS = FILES.filter((f) => f.includes('/screens/') || f.endsWith('/main.tsx') || f.endsWith('shell/CompanyPicker.tsx'))
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

test('EVERY ROUTED SCREEN OPENS WITH THE SHARED COMPONENT — the property, not a font size', () => {
  // THE FIRST CUT OF THIS ARM MATCHED A LITERAL: an `<h1>` carrying `fontSize: 27`, which was the
  // inline style the ten hand-written headers happened to share. A bare `<h1>About</h1>` passed it, and
  // so would a 28. Three of those bare ones were live on a screen reachable from the navigation while
  // this arm read green — the repair is the property the rule is actually about.
  //
  // THE PROPERTY: in every file that draws a screen, the FIRST heading-level element is the shared
  // component. Not "no h1 anywhere" — an empty state, a session notice and a run's own mark are
  // headings INSIDE a page rather than the page's name, and they are sized for where they sit. What
  // may not happen is a screen opening with a heading it wrote itself.
  // THE POPULATION IS THE SCREENS, and the shell is not one of them. AppShell's headings are the top
  // bar's nav label and two notices about the whole application — a session that ended, an identity
  // holding nothing — none of which is a page naming itself, and the lifecycle drive reads that top-bar
  // heading by that selector on purpose. Excluded by what it IS rather than by name: it is the file
  // that draws the frame every screen renders inside.
  const offenders: string[] = []
  for (const f of SCREENS) {
    const src = read(f)
    const header = src.indexOf('<PageHeader')
    const h1 = src.indexOf('<h1')
    if (header < 0 && h1 < 0) continue                  // a file that draws no heading at all
    if (header < 0) { offenders.push(`${rel(f)} writes a heading and never the shared component`); continue }
    if (h1 >= 0 && h1 < header) offenders.push(`${rel(f)} opens with a heading of its own, before the shared component`)
  }
  // ONE SCREEN IS OUT, AND NOT BY NAME. The result screen's only heading is the mark a run was ordered
  // for — a value out of the run, marked for the screen-share blur — rather than the page's own name,
  // and the note beside it records why it must not restate the report's headline. Putting the page's
  // name above it is a design decision about the screen a client spends the most time on, and this
  // issue did not ask for one; it is raised rather than taken here.
  //
  // WHAT KEEPS THAT HONEST is asserted, not assumed: that screen may hold exactly one heading and it
  // must render run data. A page-name heading added beside it makes two, and this reds.
  const result = SCREENS.find((f) => rel(f) === 'screens/Result.tsx')
  assert.ok(result, 'the result screen moved — this exemption is describing a file that is not there')
  const resultSrc = read(result)
  const resultH1s = resultSrc.match(/<h1\b/g) ?? []
  assert.equal(resultH1s.length, 1, `the result screen has ${resultH1s.length} headings — one of them is a page name`)
  assert.match(resultSrc, /<h1[^>]*data-anon="mark"/, 'the result screen\'s heading is no longer the run\'s own mark')

  assert.deepEqual(offenders.filter((o) => !o.startsWith('screens/Result.tsx')), [],
    'a screen is writing its own page header again')

  // A RATCHET OVER THE WHOLE POPULATION, because "the FIRST heading is the component" only covers the
  // first render branch. About draws its header in three — the build it could not report, the wait, and
  // the answer — and putting a bare heading back in the third left this arm green, because the first
  // branch still opened correctly. A plant found that; the count is what closes it.
  //
  // THREE HEADINGS REMAIN IN THE SCREENS, and each is a heading INSIDE a page rather than a page naming
  // itself: two empty states on the archive ("No clearances yet", once with a way to start and once
  // without) and the result screen's mark. The number may fall and may not rise. A new screen writing
  // its own page header raises it, wherever in the file it is written.
  const headings = SCREENS.flatMap((f) => (read(f).match(/<h1\b/g) ?? []).map(() => rel(f)))
  assert.ok(headings.length <= 3,
    `${headings.length} hand-written headings in the screens, up from 3 — ${JSON.stringify(headings)}`)

  // AND THE COMPONENT IS ACTUALLY REACHED, so the rule above cannot be met by a file that draws nothing.
  // Counted rather than asserted per name: two files carry two headers, so call sites and files differ
  // and a count of one is a count of neither.
  const users = FILES.filter((f) => /<PageHeader\b/.test(read(f)))
  const sites = FILES.reduce((n, f) => n + (read(f).match(/<PageHeader\b/g) ?? []).length, 0)
  assert.ok(users.length >= 12, `only ${users.length} file(s) use the shared header`)
  assert.ok(sites >= 14, `only ${sites} call site(s) — a screen has stopped drawing its header`)
  assert.ok(users.some((f) => rel(f) === 'screens/Home.tsx') && users.some((f) => rel(f) === 'screens/Clearances.tsx'),
    'the two screens the owner named are not both on the shared header')
})
