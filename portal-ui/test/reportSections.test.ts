// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The report's section breadcrumb, announced by the document and drawn by the shell.
//
// THE DEFECT (owner, 2026-09-18). The renderers draw a breadcrumb inside the report's own sticky header,
// and `portal-report.mjs` strips that header on the way into the frame because the portal draws its own.
// The breadcrumb was left behind: it landed as the first element of the served document, over the
// confidentiality line, and it could not pin — the frame is sized to its content, so a `position:sticky`
// bar inside it has no scrollport to stick to. It scrolled away at the first paragraph, which is what the
// owner meant by "as a breadcrumb it's useless".
//
// The repair is the same shape as the Export menu's: the document announces what it holds, the shell
// draws it in `.report-head`, where it stays on top. This file is the trust boundary for that
// announcement, plus the two properties of the header that a reader would notice if they regressed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readFrameSections, readFrameControls, readFrameTheme, frameCommand, sectionsReached, FRAME_TAG, MAX_SECTIONS, MAX_SECTION_LABEL } from '../src/contract/reportFrame.ts'

const msg = (sections: unknown) => ({ source: FRAME_TAG, type: 'sections', sections })

test('a document announcing its sections is read; anything else is not', () => {
  assert.deepEqual(
    readFrameSections(msg([{ id: 'summary', label: 'Summary' }, { id: 'findings', label: 'Findings' }]), true),
    [{ id: 'summary', label: 'Summary' }, { id: 'findings', label: 'Findings' }],
  )
  assert.equal(readFrameSections(msg([]), true)?.length, 0, 'announced nothing is a fact, not a refusal')
  assert.equal(readFrameSections(msg([{ id: 'a', label: 'A' }]), false), null, 'a different frame is not ours')
  assert.equal(readFrameSections({ source: 'someone-else', type: 'sections', sections: [] }, true), null)
  assert.equal(readFrameSections({ source: FRAME_TAG, type: 'height', height: 10 }, true), null)
  assert.equal(readFrameSections(msg('summary,findings'), true), null, 'a string is not a list')
  assert.equal(readFrameSections(null, true), null)
})

test('an entry the shell could not draw is dropped rather than drawn empty', () => {
  const got = readFrameSections(msg([
    { id: 'summary', label: 'Summary' },
    { id: 'blank', label: '   ' },
    { id: '', label: 'Nowhere' },
    { id: 'numbered', label: 7 },
    'findings',
    null,
  ]), true)
  assert.deepEqual(got, [{ id: 'summary', label: 'Summary' }], 'only the entry that names a place and a word')
})

test('a header is a header: labels are trimmed and the list is capped', () => {
  const many = Array.from({ length: MAX_SECTIONS + 6 }, (_, i) => ({ id: `s${i}`, label: `Section ${i}` }))
  assert.equal(readFrameSections(msg(many), true)?.length, MAX_SECTIONS)
  const long = readFrameSections(msg([{ id: 's', label: 'x'.repeat(MAX_SECTION_LABEL + 40) }]), true)
  assert.equal(long?.[0]?.label.length, MAX_SECTION_LABEL)
})

test('a breadcrumb press is a command with an id, not a boolean', () => {
  assert.deepEqual(frameCommand('section', 'findings'),
    { source: FRAME_TAG, type: 'command', command: 'section', value: 'findings' })
  // And it is NOT a menu verb: `exportMenu` and `readFrameControls` are closed over `FrameCommand`, so a
  // document that announced "section" among its controls could not put a row in the Export menu.
  assert.deepEqual(readFrameControls({ source: FRAME_TAG, type: 'controls', commands: ['section'] }, true), [])
})

// ── what the screen does with it ─────────────────────────────────────────────────────────────────────
//
// Read off the source, as the other screen tests here do: Node cannot import a `.tsx` and this repo
// carries no DOM renderer. The claim is narrow and worth pinning anyway, because it is the half the
// owner actually sees — both steering controls in the pinned header rather than under it.
const RESULT = readFileSync(new URL('../src/screens/Result.tsx', import.meta.url), 'utf8')

test('the Reads strip and the breadcrumb are both inside the pinned header', () => {
  const head = RESULT.indexOf('<div className="report-head">')
  const nav = RESULT.indexOf('<div className="report-nav">')
  const frame = RESULT.indexOf('<ReportFrame')
  assert.ok(head >= 0 && nav >= 0 && frame >= 0)
  assert.ok(nav > head && nav < frame, 'the merged row sits inside the header, above the document')
  assert.ok(RESULT.indexOf('hasThread(reads)') > head, 'the Reads strip moved into the header with it')
  assert.match(RESULT, /frame\.send\('section', sec\.id\)/, 'a press asks the document where that section is')
})

test('a breadcrumb with one entry is not drawn — it matches the renderer, which emits none', () => {
  assert.match(RESULT, /\(frame\.sections\?\.length \?\? 0\) > 1/,
    'the shell draws the breadcrumb only above one section, as sectionStrip() emits it only above one')
})

// ── the theme, the shell's second verb (owner ruling, 2026-09-18: the embedded report follows the portal) ──

test('the theme goes in as a command carrying one of the two themes, and is not a menu verb', () => {
  assert.deepEqual(frameCommand('theme', 'dark'), { source: FRAME_TAG, type: 'command', command: 'theme', value: 'dark' })
  assert.deepEqual(readFrameControls({ source: FRAME_TAG, type: 'controls', commands: ['theme'] }, true), [],
    'a document that announced "theme" among its controls could not put a row in the Export menu')
})

test("the document's answer is read back only as one of the two themes, and only from our frame", () => {
  assert.equal(readFrameTheme({ source: FRAME_TAG, type: 'theme', theme: 'dark' }, true), 'dark')
  assert.equal(readFrameTheme({ source: FRAME_TAG, type: 'theme', theme: 'light' }, true), 'light')
  assert.equal(readFrameTheme({ source: FRAME_TAG, type: 'theme', theme: 'sepia' }, true), null, 'a theme neither side draws')
  assert.equal(readFrameTheme({ source: FRAME_TAG, type: 'theme', theme: 'dark' }, false), null, 'another frame')
  assert.equal(readFrameTheme({ source: 'someone-else', type: 'theme', theme: 'dark' }, true), null)
})

test('the Result screen sends the portal theme on every load of the document and on every change', () => {
  assert.match(RESULT, /send\('theme', theme\)/, 'the screen never sends the theme in')
  assert.match(RESULT, /\[theme, hello, send\]/, 'the theme is not re-sent on a change and on each load')
  assert.match(RESULT, /attributeFilter: \['data-theme'\]/, 'the screen does not watch the attribute the portal writes its theme to')
})

// ── PROGRESS THROUGH ONE DOCUMENT (owner, 2026-09-19) ─────────────────────────────────────────────────
//
// The strip showed "Summary" as current whatever was on screen, because only a press could move it. It
// shows how far the reader has got now: every section reached is filled, none at the top, and it un-fills
// the same way on the way back up. The browser half, the page really scrolled at two widths and both themes,
// is scripts/report-sections-render-check.mjs.

test('where each section starts is read from the announcement, and only as a real offset', () => {
  assert.deepEqual(readFrameSections(msg([{ id: 'summary', label: 'Summary', top: 0 }, { id: 'findings', label: 'Findings', top: 812.4 }]), true),
    [{ id: 'summary', label: 'Summary', top: 0 }, { id: 'findings', label: 'Findings', top: 812 }])
  for (const top of [-5, Number.NaN, '40', null, Infinity])
    assert.deepEqual(readFrameSections(msg([{ id: 'a', label: 'A', top }]), true), [{ id: 'a', label: 'A' }], `top ${String(top)} is not an offset`)
})

test('the count follows the reading line down and back up, none at the top and all at the foot', () => {
  const secs = [{ id: 'a', label: 'A', top: 0 }, { id: 'b', label: 'B', top: 900 }, { id: 'c', label: 'C', top: 2000 }, { id: 'd', label: 'D', top: 3100 }]
  const mid = { atTop: false, atFoot: false }
  assert.equal(sectionsReached(secs, 20, { atTop: true, atFoot: false }), 0, 'at the top nothing is reached yet')
  const down = [20, 899, 900, 1500, 2000, 3099, 3100].map((line) => sectionsReached(secs, line, mid))
  assert.deepEqual(down, [1, 1, 2, 2, 3, 3, 4], 'one more at each start, and the one behind between two starts')
  const up = [3100, 2000, 1999, 900, 899, 20].map((line) => sectionsReached(secs, line, mid))
  assert.deepEqual(up, [4, 3, 2, 2, 1, 1], 'and the same way back up')
  assert.equal(sectionsReached(secs, 2500, { atTop: false, atFoot: true }), 4, 'at the foot nothing more can come up, so all are reached')
  assert.equal(sectionsReached([{ id: 'a', label: 'A', top: 0 }, { id: 'b', label: 'B' }, { id: 'c', label: 'C', top: 50 }], 400, mid), 1,
    'a section with no known start ends the count rather than being guessed past')
})

test('the strip marks every reached section and the one in view, and a press still jumps', () => {
  assert.match(RESULT, /data-reached=\{i < reached \? 'true' : undefined\}/, 'every reached section is marked')
  assert.match(RESULT, /aria-current=\{i === reached - 1 \? 'true' : undefined\}/, 'the last reached is the one in view')
  assert.doesNotMatch(RESULT, /atSection/, 'a press alone no longer decides what is marked')
  assert.match(RESULT, /window\.addEventListener\('scroll', later, \{ passive: true \}\)/, 'the strip does not follow the scroll')
})

test('the strip has its own row under the Reads, never beside them', () => {
  const css = readFileSync(new URL('../src/base.css', import.meta.url), 'utf8')
  assert.match(css, /\.report-nav \{[^}]*flex-direction: column/, 'the Reads and the strip share one row again')
  assert.doesNotMatch(RESULT, /report-nav-sep/, 'the divider between two side-by-side halves is back')
  assert.match(css, /\.report-sections \{[^}]*overflow-x: auto/, 'on a narrow screen the strip must scroll sideways, not wrap')
})
