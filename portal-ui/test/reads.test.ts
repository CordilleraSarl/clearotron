// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The Reads strip's grouping.
//
// The strip is best-effort by necessity — parentRunId is populated on zero real runs, so the only link
// between two reads of one mark is the mark string. These tests pin the two properties that decide
// whether "best-effort" is honest or dangerous: it may show FEWER reads than exist, and it must never
// show a read belonging to somebody else.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { markKey, readsFor, hasThread, displayName, readLabel, inSentence } from '../src/contract/reads.ts'
import { marksOf } from '../src/contract/grouping.ts'
import type { Run } from '../src/contract/api.ts'

const run = (over: Partial<Run> & { runId: string }): Run => ({
  runId: over.runId,
  account: 'aurora',
  title: 'AQUAPLUS',
  kind: 'clearance',
  state: 'delivered',
  date: '2026-07-01',
  issuedAt: null,
  band: null,
  tone: null,
  bands: [],
  marks: [],
  reportSchema: null,
  held: false,
  report: null,
  step: null,
  stepN: null,
  stepTotal: null,
  reason: null,
  failedStage: null,
  ...over,
})

test('case and surrounding whitespace group; internal spacing does NOT', () => {
  assert.equal(markKey('AQUAPLUS'), markKey('AquaPlus'))
  assert.equal(markKey('  AQUAPLUS  '), markKey('aquaplus'))
  // Deliberate. Collapsing internal whitespace would merge two DIFFERENT marks that a lawyer may be
  // clearing separately, and merging two marks is a worse failure than splitting one.
  assert.notEqual(markKey('AQUA PLUS'), markKey('AQUAPLUS'))
})

test('a thread never crosses brand owners, even on an identical mark', () => {
  // Two clients clearing the same word at the same time is ordinary, not exotic. The server already
  // scopes what it returns; this is the second wall.
  const mine = run({ runId: 'a', account: 'aurora', title: 'NOVAPULSE' })
  const theirs = run({ runId: 'b', account: 'zephyr', title: 'NOVAPULSE' })
  const reads = readsFor([mine, theirs], mine)
  assert.deepEqual(reads.map((r) => r.runId), ['a'])
})

test('reads on the same mark come back newest first, including the current one', () => {
  const older = run({ runId: 'old', date: '2026-06-01' })
  const newer = run({ runId: 'new', date: '2026-07-01' })
  const other = run({ runId: 'other', title: 'DIFFERENT' })
  const reads = readsFor([older, newer, other], older)
  assert.deepEqual(reads.map((r) => r.runId), ['new', 'old'])
})

test('one read is not a thread, so the strip does not render', () => {
  const only = run({ runId: 'solo' })
  assert.equal(hasThread(readsFor([only], only)), false)
  const second = run({ runId: 'second', date: '2026-07-02' })
  assert.equal(hasThread(readsFor([only, second], only)), true)
})

test('a split thread shows fewer reads — never a wrong one', () => {
  // This is the failure mode we accept: a model writing the mark with a space produces two threads
  // instead of one. What it must never do is put an unrelated run into the strip.
  const a = run({ runId: 'a', title: 'AQUA PLUS' })
  const b = run({ runId: 'b', title: 'AQUAPLUS' })
  assert.deepEqual(readsFor([a, b], a).map((r) => r.runId), ['a'], 'split, not merged')
  assert.deepEqual(readsFor([a, b], b).map((r) => r.runId), ['b'])
})

// ── the mark vs the report's headline ────────────────────────────────────────────────────────────────

test('THE DISPLAY NAME IS THE MARK, NOT THE REPORT HEADLINE', () => {
  // A real delivered run. `meta.title` is model-authored front matter and reads as a whole sentence;
  // `markName` is what the user typed. Showing title put that sentence in the Name column and in the
  // page header above a report that says it again, larger, immediately below.
  assert.equal(
    displayName({ markName: 'AquaPlus', title: 'AquaPlus — US Preliminary Trademark Clearance', marks: [] }),
    'AquaPlus',
  )
})

test('a run with no markName falls back to its title rather than rendering blank', () => {
  // Three of the five pool runs predate the field and keep their title until re-rendered.
  assert.equal(displayName({ markName: null, title: 'ARBORA', marks: [] }), 'ARBORA')
  assert.equal(displayName({ markName: '   ', title: 'ARBORA', marks: [] }), 'ARBORA', 'whitespace is not a name')
})

// ──: the Name column holds a MARK, on every row shape ──────────────────────────────────────────

test('#274: a batch already delivered derives its name from marks[], not from its run-type title', () => {
  // THE ROW THIS FIXES ON SCREEN TODAY. A knockout batch published before wrote no `markName` at
  // all, and its meta.json is frozen — so without deriving here, every existing batch would keep reading
  // "Knockout review — 1 marks" until it was re-run. Measured on the test instance 2026-08-04: all four
  // seeded rows carry markName: null and that exact title.
  const batch = { markName: null, title: 'Knockout review — 1 marks', marks: [{ name: 'E2E FALLBACK PROBE', band: null, tone: null }] }
  assert.equal(displayName(batch), 'E2E FALLBACK PROBE')
})

test('#274: several marks are the first plus a count — one rule, not a special case for group rows', () => {
  const many = {
    markName: null,
    title: 'Knockout review — 3 marks',
    marks: [{ name: 'VENZY', band: null, tone: null }, { name: 'ARBORA', band: null, tone: null }, { name: 'ION', band: null, tone: null }],
  }
  assert.equal(displayName(many), 'VENZY +2 more')
})

test('#274: markName WINS over marks[] — the publisher\'s own answer beats a derivation', () => {
  const both = { markName: 'VENZY', title: 'Knockout review — 2 marks', marks: [{ name: 'SOMETHING ELSE', band: null, tone: null }] }
  assert.equal(displayName(both), 'VENZY')
})

test('#274: NO Name cell contains a run type where a mark is available anywhere', () => {
  // The acceptance criterion, stated as the property. Every shape the wire can produce, checked against
  // the one string the column must never hold.
  const shapes = [
    { markName: 'VENZY', title: 'Knockout review — 1 marks', marks: [] },
    { markName: null, title: 'Knockout review — 1 marks', marks: [{ name: 'VENZY', band: null, tone: null }] },
    { markName: null, title: 'Knockout review — 2 marks', marks: [{ name: 'VENZY', band: null, tone: null }, { name: 'ION', band: null, tone: null }] },
  ]
  for (const r of shapes) assert.doesNotMatch(displayName(r), /Knockout review|marks$/, JSON.stringify(r))
})

test('#274: a record carrying NO mark anywhere gets its title — never an invented placeholder', () => {
  // The issue rules this explicitly: a genuinely nameless clearance is a data question, and a
  // placeholder is how a data question stops being visible.
  assert.equal(displayName({ markName: null, title: 'Knockout review — 0 marks', marks: [] }), 'Knockout review — 0 marks')
  const blank = { markName: null, title: 'ARBORA', marks: [{ name: '  ', band: null, tone: null }] }
  assert.equal(displayName(blank), 'ARBORA', 'a blank name in marks[] is not a name either')
})

test('reads thread on the MARK, so a run whose headline differs still joins its thread', () => {
  // The failure this prevents: two reads of AquaPlus whose model-authored titles differ by a word would
  // have split into two threads, and the user would see two rows for one name.
  const a = run({ runId: 'a', markName: 'AquaPlus', title: 'AquaPlus — US Preliminary Trademark Clearance' })
  const b = run({ runId: 'b', markName: 'AquaPlus', title: 'AquaPlus — knockout screen', date: '2026-06-01' })
  assert.equal(readsFor([a, b], a).length, 2)
})

// ── the pill names the PRODUCT, and reads it off the row ─────────────────────────────────────────────

test('#463: a read pill names the product from the wire, and a rung on the same row never wins', () => {
  // THE DEFECT THIS PINS. readLabel used to join `run.product` against the COMPOSER'S MENU, which holds
  // orderable products only, so every archived run missed and fell through to `stageLabel` — a Depth
  // number, rendered at a client on Clearances and on the Result screen's reads strip, for the same run
  // whose card on Home and whose report masthead both named the product.
  //
  // Every case below carries a DEPTH STRING on the row, exactly as the wire sends it for a retired row.
  // If the pill ever prints one, the mapping is back.
  const retired = { runId: 'r1', product: 'knockout', productName: 'Knockout review', stageLabel: 'Depth 1', date: '2026-08-07' } as never
  assert.equal(readLabel(retired), 'Knockout review · 2026-08-07')
  const orderable = { runId: 'r2', product: 'global-preliminary-search', productName: 'Global preliminary search', stageLabel: 'Global preliminary search', date: '2026-07-19' } as never
  assert.equal(readLabel(orderable), 'Global preliminary search · 2026-07-19')
  // A QUEUED run: no frozen stamp yet, and the name resolved from the ordered product.
  const queued = { runId: 'r3', product: 'knockout-search', productName: 'Knockout search', stageLabel: null, date: '2026-08-07' } as never
  assert.equal(readLabel(queued), 'Knockout search · 2026-08-07')
})

test('a level the registry no longer knows keeps its frozen label', () => {
  // The ONE case `stageLabel` still answers: the registry has forgotten the level, so it resolves no
  // name either (the same policyFor miss on both fields), and the stamp is the last thing anyone
  // recorded about that search.
  const run = { runId: 'r1', product: 'retired', productName: null, stageLabel: 'Stage 2 (retired)', date: '2026-01-02' } as never
  assert.equal(readLabel(run), 'Stage 2 (retired) · 2026-01-02')
})

test('a run older than the level registry falls back to its date, never an invented depth', () => {
  const run = { runId: 'runid-abcdef123', product: null, productName: null, stageLabel: null, date: '2025-11-04' } as never
  assert.equal(readLabel(run), '2025-11-04')
  const undated = { runId: 'runid-abcdef123', product: null, productName: null, stageLabel: null, date: null } as never
  assert.equal(readLabel(undated), 'runid-abcdef', 'the id prefix, which at least distinguishes two undated reads')
})

test('#275: readsFor and marksOf order on the SAME key — two surfaces must not disagree about "current"', () => {
  // There were two comparators, both on `date`, in two modules. Fixing one would have left the
  // Clearances list and the Result screen's reads strip disagreeing about which read is current — the
  // defect removes, relocated rather than fixed. There is one now, and this pins that.
  const earlier = run({ runId: 'cli', date: '2026-08-04', issuedAt: '2026-08-04T06:54:58.017Z' })
  const later = run({ runId: 'mcp', date: '2026-08-04', issuedAt: '2026-08-04T06:57:06.563Z' })
  // Fed in the wrong order on purpose: arrival must not decide.
  assert.deepEqual(readsFor([earlier, later], earlier).map((r) => r.runId), ['mcp', 'cli'])
  assert.deepEqual(readsFor([later, earlier], earlier).map((r) => r.runId), ['mcp', 'cli'])
  assert.deepEqual(marksOf([earlier, later])[0]!.reads.map((r) => r.runId), ['mcp', 'cli'])
  // And a read with no timestamp still sorts last rather than first, on both.
  const undated = run({ runId: 'old', date: '2026-08-04', issuedAt: null })
  assert.equal(readsFor([undated, later], later)[0]!.runId, 'mcp')
  assert.equal(marksOf([undated, later])[0]!.current.runId, 'mcp')
})

// ── — A NAME GOING INTO A SENTENCE ──────────────────────────────────────────
//
// The owner's own Retire dialog, with a 200-character name pasted whole into `Retire ${mark.name}?`:
// the question mark landed after a paragraph and the sentence explaining what retiring does — that the
// report links keep working and "Show retired" brings it back — was unreadable at the moment he was
// being asked to confirm.
test('2077 a long name is bounded before it goes into a confirm, and a real mark is untouched', () => {
  const paragraph = 'I have a new product for bouncy bricks made of a composite from recycled material. '
    + 'It makes bricks that can be used to build a house that its bouncy so that it can flex in the wind.'

  const cut = inSentence(paragraph)
  assert.ok(cut.length <= 61, `the bound did not bind: ${cut.length} characters`)
  assert.ok(cut.endsWith('…'), 'a cut that does not say it was cut reads as the whole name')
  assert.ok(paragraph.startsWith(cut.slice(0, -1).trimEnd()),
    'the fragment is not the opening of the name, so a reader cannot tell which record this is')
  // The sentence AFTER the interpolation is the part that has to survive, so this is what the dialog
  // actually composes.
  const dialog = `Retire ${cut}? The read stays in the pool and the report links keep working.`
  assert.ok(dialog.indexOf('?') < 80, 'the question mark still lands after a paragraph')

  // EVERY REAL MARK IS BYTE-IDENTICAL. A bound that shortens the names people actually search would be
  // a worse defect than the one it fixes — the reader would not recognise their own record.
  for (const name of ['AQUAPLUS', 'Zephyr Beverages', 'VENZY', 'Sirène', 'アクアプラス',
    'A NAME OF EXACTLY SIXTY CHARACTERS PADDED OUT TO REACH THE CAP']) {
    if (name.length <= 60) assert.equal(inSentence(name), name, `a real mark was altered: ${name}`)
  }

  // Whitespace is collapsed, because a pasted paragraph carries newlines and a confirm renders them.
  assert.equal(inSentence('AQUA\n  PLUS'), 'AQUA PLUS')
  // A single unbroken token still gets cut rather than swallowing the budget looking for a space.
  assert.equal(inSentence('x'.repeat(200), 10), `${'x'.repeat(10)}…`)
  assert.equal(inSentence('' as unknown as string), '')
})
