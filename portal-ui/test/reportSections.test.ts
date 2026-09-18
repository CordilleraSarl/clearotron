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
import { readFrameSections, readFrameControls, frameCommand, FRAME_TAG, MAX_SECTIONS, MAX_SECTION_LABEL } from '../src/contract/reportFrame.ts'

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
