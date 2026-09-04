// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The Export menu offers what the document has, and nothing else.
//
// THE DEFECT. The menu was a fixed list of five rows, drawn for every run with no
// check of any kind. Four of them send bridge commands into the framed document, and the knockout
// template defined none of those commands — so on every knockout ever published all four failed with
// "this report has no exportPDF", and the footer described a tick control that exists nowhere on the
// page. The one row that worked was the audit download, because it is a plain link to a route.
//
// The repair is not a table of kinds. The document announces which commands it defines and the menu is
// composed from that: a kind is a second list that has to be updated whenever a renderer gains or loses
// a control, and nothing fails when it is not — which is how this shipped in the first place.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFrameControls, exportMenu, exportAffordance, FRAME_TAG } from '../src/contract/reportFrame.ts'
import type { FrameCommand, ExportItem } from '../src/contract/reportFrame.ts'

const labels = (rows: readonly ExportItem[]) =>
  rows.filter((r): r is Extract<ExportItem, { kind: 'command' }> => r.kind === 'command').map((r) => r.label)
const kinds = (rows: readonly ExportItem[]) => rows.map((r) => r.kind)

const CLEARANCE: readonly FrameCommand[] = ['exportPDF', 'pickAll', 'openAll']
const KNOCKOUT: readonly FrameCommand[] = ['exportPDF', 'openAll']

// ── reading the announcement ─────────────────────────────────────────────────────────────────────────

test('a document announcing its commands is read; anything else is not', () => {
  const msg = (commands: unknown) => ({ source: FRAME_TAG, type: 'controls', commands })
  assert.deepEqual(readFrameControls(msg(['exportPDF', 'openAll']), true), ['exportPDF', 'openAll'])
  // A message from a frame that is not the one we are showing is not ours, whatever it says. Identity,
  // not origin — a null-origin frame reports its origin as the string "null".
  assert.equal(readFrameControls(msg(['exportPDF']), false), null)
  assert.equal(readFrameControls({ source: 'somebody-else', type: 'controls', commands: [] }, true), null)
  assert.equal(readFrameControls({ source: FRAME_TAG, type: 'height', height: 900 }, true), null)
  assert.equal(readFrameControls(null, true), null)
})

test('NOT ANNOUNCED and ANNOUNCED NOTHING are different answers', () => {
  // The distinction the menu is gated on. `null` is "we have not heard from this document yet", which
  // is unknown; `[]` is "this document has no controls", which is a fact about the report. Collapsing
  // them would either hide a working menu forever or draw one for a document that cannot answer it.
  assert.equal(readFrameControls({ source: FRAME_TAG, type: 'controls' }, true), null, 'no list at all = unknown')
  assert.deepEqual(readFrameControls({ source: FRAME_TAG, type: 'controls', commands: [] }, true), [],
    'an empty list is an answer, not an absence')
})

test('a name outside the vocabulary is dropped rather than carried', () => {
  // The command surface is closed at the bridge, so a name outside it could only ever produce a menu
  // item that cannot work — which is this defect, arriving from the other direction.
  assert.deepEqual(
    readFrameControls({ source: FRAME_TAG, type: 'controls', commands: ['exportPDF', 'rm -rf', 'openAll'] }, true),
    ['exportPDF', 'openAll'],
  )
})

// ── composing the menu ───────────────────────────────────────────────────────────────────────────────

test('the full report keeps every row it has always had', () => {
  assert.deepEqual(labels(exportMenu(CLEARANCE)), [
    'Export PDF (ticked findings)', 'Select all findings', 'Select none', 'Expand all', 'Collapse all',
  ])
  assert.ok(kinds(exportMenu(CLEARANCE)).includes('note'), 'and the footer explaining the ticks')
})

test('THE DEFECT: a knockout is offered only what a knockout can do', () => {
  const rows = exportMenu(KNOCKOUT)
  assert.deepEqual(labels(rows), ['Export PDF', 'Expand all', 'Collapse all'])
  // The two rows that used to fail on every knockout ever published.
  assert.equal(labels(rows).includes('Select all findings'), false, 'no tick control it does not have')
  assert.equal(labels(rows).includes('Select none'), false)
  // THE LABEL FOLLOWS THE VERBS. "(ticked findings)" names the tick filter, and there is none here.
  assert.equal(labels(rows).includes('Export PDF (ticked findings)'), false)
  // …and the footer describing the ticks goes with them, rather than telling a reader to tick something
  // that appears nowhere on their page.
  assert.equal(kinds(rows).includes('note'), false, 'no footer about ticks that do not exist')
})

test('the audit download is always there, because it is not a command', () => {
  // It is a plain link to a route the service serves, so it never depended on what the renderer defines
  // — the one row that worked on a knockout before this change, and it must not become conditional now.
  for (const offered of [CLEARANCE, KNOCKOUT, [] as readonly FrameCommand[], ['openAll'] as readonly FrameCommand[]]) {
    assert.equal(kinds(exportMenu(offered)).filter((k) => k === 'download').length, 1,
      `the download row survives ${JSON.stringify(offered)}`)
  }
})

test('a document with no commands composes no commands', () => {
  const rows = exportMenu([])
  assert.deepEqual(labels(rows), [])
  assert.deepEqual(kinds(rows), ['download'], 'the download alone — which the screen draws as a button')
})

test('a document that announces nothing still reaches the workbook', () => {
  // THE ARM ABOVE PASSED WHILE THE PRODUCT LOST THE FILE. `exportMenu` kept returning the download row;
  // the screen gated the whole menu on the announced verbs one layer up, so a document announcing none
  // drew nothing at all — and the report's own .xlsx link is stripped on the way into the frame, so the
  // shell's link is the only route there is. The population that hits it is every knockout published
  // before this change, which is the population this issue is about.
  assert.equal(exportAffordance([]), 'download', 'announced nothing: a button, not nothing')
  assert.equal(exportAffordance(null), 'download', 'not announced yet: a button, not nothing')
})

test('THE CLASS: no announce state can withhold the workbook', () => {
  // Over every state the frame can be in, not the two that exist today: never announced, plus each of
  // the eight subsets it can announce.
  const ALL: readonly FrameCommand[] = ['exportPDF', 'pickAll', 'openAll']
  const states: readonly (readonly FrameCommand[] | null)[] = [
    null, ...Array.from({ length: 8 }, (_, mask) => ALL.filter((_c, i) => (mask >> i) & 1)),
  ]
  for (const state of states) {
    const rows = exportMenu(state ?? [])
    assert.equal(rows.filter((r) => r.kind === 'download').length, 1,
      `exactly one download row for ${JSON.stringify(state)}`)
    // The affordance and the rows have to agree, or the screen draws a menu with nothing in it or a
    // button while commands are waiting to be offered.
    assert.equal(exportAffordance(state) === 'menu', rows.some((r) => r.kind === 'command'),
      `affordance matches the composed rows for ${JSON.stringify(state)}`)
  }
})

test('THE CLASS: every row that sends a command is one the document announced', () => {
  // The property, over every subset rather than the two shapes that exist today. A row that sends a
  // command the document did not announce is the defect, whatever combination produced it.
  const ALL: readonly FrameCommand[] = ['exportPDF', 'pickAll', 'openAll']
  for (let mask = 0; mask < 8; mask += 1) {
    const offered = ALL.filter((_, i) => (mask >> i) & 1)
    for (const row of exportMenu(offered)) {
      if (row.kind !== 'command') continue
      assert.ok(offered.includes(row.command),
        `offered=${JSON.stringify(offered)} drew "${row.label}", which sends ${row.command}`)
    }
    // And a separator never trails or leads: a rule that is easy to break when rows become conditional.
    const ks = kinds(exportMenu(offered))
    assert.notEqual(ks[ks.length - 1], 'separator', `offered=${JSON.stringify(offered)} ends on a divider`)
    assert.notEqual(ks[0], 'separator', `offered=${JSON.stringify(offered)} opens on a divider`)
  }
})
