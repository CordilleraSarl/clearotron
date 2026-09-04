// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Family → Mark → Reads.
//
// These use SYNTHETIC threads on purpose, and the reason is worth stating so nobody "fixes" it by
// pointing them at real data. The five runs in the pool are five distinct marks with no repeats and no
// families, so live data exercises exactly none of the behaviour below — a test built from it would pass
// against a function that returned its input unchanged.
//
// The two roll-up rules are the point. They differ, they look inconsistent, and getting either backwards
// misreports risk on the screen a client reads.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { marksOf, rowsOf, runsIn, NO_FAMILIES } from '../src/contract/grouping.ts'
import type { Families } from '../src/contract/grouping.ts'
import type { Run } from '../src/contract/api.ts'
import type { Band } from '../src/contract/tone.ts'

// The house ladder, in the engine's own order: index 0 is the WORST. See contract/tone.ts.
const LADDER: readonly Band[] = [
  { label: 'Very high', tone: 'severe' },
  { label: 'High', tone: 'high' },
  { label: 'Medium', tone: 'medium' },
  { label: 'Manageable', tone: 'low' },
  { label: 'Low', tone: 'minimal' },
]

const run = (over: Partial<Run> & { runId: string }): Run => ({
  account: 'aurora',
  title: 'AquaPlus',
  markName: 'AquaPlus',
  product: null,
  stageLabel: null,
  kind: 'clearance',
  state: 'delivered',
  date: '2026-07-01',
  issuedAt: null,
  band: null,
  tone: null,
  bands: LADDER,
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

// ── marks ────────────────────────────────────────────────────────────────────────────────────────────

test('every read of one name collapses into ONE row', () => {
  // The reported defect: three reads of a mark were three unrelated rows saying nearly the same thing.
  const marks = marksOf([
    run({ runId: 'a', date: '2026-06-30' }),
    run({ runId: 'b', date: '2026-07-11' }),
    run({ runId: 'c', date: '2026-07-19' }),
  ])
  assert.equal(marks.length, 1)
  assert.equal(marks[0]!.reads.length, 3)
  assert.deepEqual(marks[0]!.reads.map((r) => r.runId), ['c', 'b', 'a'], 'newest first')
})

test('THE MARK ROW SHOWS THE LATEST READ, NOT THE WORST', () => {
  // The rule most likely to be got wrong, and the damage is specific: a knockout screen came back High,
  // the preliminary that followed it came back Medium. The deeper read SUPERSEDES the screen. Rolling
  // "worst" up the thread would resurface the superseded High and tell the reader that the analysis they
  // paid for is really the answer it replaced.
  const marks = marksOf([
    run({ runId: 'knockout', date: '2026-06-30', band: 'High', tone: 'high' }),
    run({ runId: 'prelim', date: '2026-07-19', band: 'Medium', tone: 'medium' }),
  ])
  assert.equal(marks[0]!.band, 'Medium', 'the current standing is the latest read')
  assert.equal(marks[0]!.tone, 'medium')
  assert.equal(marks[0]!.current.runId, 'prelim')
  assert.equal(marks[0]!.date, '2026-07-19')
})

test('a mark in flight reports no band rather than its previous one', () => {
  // The inverse of the same rule. A running re-read has no band yet, and borrowing the finished read's
  // band would show a fresh answer that has not been produced.
  const marks = marksOf([
    run({ runId: 'done', date: '2026-07-01', band: 'Medium', tone: 'medium' }),
    run({ runId: 'rerun', date: '2026-07-19', state: 'running', band: null, tone: null }),
  ])
  assert.equal(marks[0]!.band, null)
  assert.equal(marks[0]!.current.state, 'running')
})

test('marks are keyed by ACCOUNT as well as name — one client never sees another’s reads', () => {
  const marks = marksOf([
    run({ runId: 'ours', account: 'aurora' }),
    run({ runId: 'theirs', account: 'borealis' }),
  ])
  assert.equal(marks.length, 2, 'the same word for two brand owners is two marks')
  for (const m of marks) assert.equal(m.reads.length, 1)
})

test('case and surrounding space group; internal spacing does not', () => {
  // Inherited from markKey deliberately: merging two marks is a worse failure than splitting one.
  const same = marksOf([run({ runId: 'a', markName: 'AQUAPLUS' }), run({ runId: 'b', markName: ' AquaPlus ' })])
  assert.equal(same.length, 1, 'AQUAPLUS and AquaPlus are one mark')
  const split = marksOf([run({ runId: 'a', markName: 'AQUAPLUS' }), run({ runId: 'b', markName: 'AQUA PLUS' })])
  assert.equal(split.length, 2, 'AQUA PLUS is a different mark and stays one')
})

test('THE ROW IS NAMED BY THE MARK, NEVER BY THE REPORT’S HEADLINE', () => {
  // A real delivered run: markName "AquaPlus", title "AquaPlus — US Preliminary Trademark Clearance".
  // Naming rows from title is what put a headline in the Name column.
  const marks = marksOf([
    run({ runId: 'a', markName: 'AquaPlus', title: 'AquaPlus — US Preliminary Trademark Clearance' }),
  ])
  assert.equal(marks[0]!.name, 'AquaPlus')
})

test('a run predating markName falls back to its title, and still groups with its own thread', () => {
  // Three of the five pool runs are like this until they are re-rendered. Degrading loudly beats
  // dropping the row.
  const marks = marksOf([
    run({ runId: 'old', markName: null, title: 'ARBORA', date: '2026-06-30' }),
    run({ runId: 'new', markName: 'ARBORA', date: '2026-07-19' }),
  ])
  assert.equal(marks.length, 1, 'the fallback still lands in the same thread')
  assert.equal(marks[0]!.name, 'ARBORA')
})

// deleted the Stages column outright — depth is a one-to-one encoding of the run type (five level
// keys, five depth labels, five product names in DEPTH_POLICIES, verified bijective in both directions),
// so the column said in a number what every read row already says in words. 's rule that the parent
// row shows the LATEST read alone survives it, and is asserted on the cells that remain.

// ── families ─────────────────────────────────────────────────────────────────────────────────────────

const FAM: Families = { of: { plus: 'hydra', max: 'hydra' }, names: { hydra: 'Hydra range' } }

test('a family collects its marks and nothing else', () => {
  const rows = rowsOf(
    marksOf(
      [
        run({ runId: 'plus', markName: 'AquaPlus', band: 'Medium', tone: 'medium' }),
        run({ runId: 'max', markName: 'AquaMax', band: 'High', tone: 'high' }),
        run({ runId: 'other', markName: 'Venzy', band: 'Low', tone: 'minimal' }),
      ],
      FAM,
    ),
    FAM,
  )
  assert.equal(rows.length, 2, 'the family plus the unfamilied mark')
  const fam = rows.find((r) => r.kind === 'family')
  assert.ok(fam && fam.kind === 'family')
  assert.equal(fam.name, 'Hydra range')
  assert.deepEqual(fam.marks.map((m) => m.name).sort(), ['AquaMax', 'AquaPlus'])
})

test('THE FAMILY ROW SHOWS THE WORST OF ITS MARKS — the opposite rule from a mark row', () => {
  // Not inconsistent: down a thread later supersedes earlier, so a mark shows its latest. Across marks
  // nothing supersedes anything — they are different names, all live, and one being High is the fact
  // that matters. Same reasoning as the batch's existing "N names, worst:".
  const rows = rowsOf(
    marksOf(
      [
        run({ runId: 'plus', markName: 'AquaPlus', band: 'Medium', tone: 'medium' }),
        run({ runId: 'max', markName: 'AquaMax', band: 'High', tone: 'high' }),
      ],
      FAM,
    ),
    FAM,
  )
  const fam = rows[0]
  assert.ok(fam && fam.kind === 'family')
  assert.equal(fam.band, 'High', 'a family containing a High mark does not report Medium')
  assert.equal(fam.tone, 'high')
})

test('an unrated mark never becomes the family’s answer', () => {
  // bandRank puts unrated at MAX_SAFE_INTEGER, so it can never win. Pinned because a family whose
  // running member silently became its band would under-report every time someone re-ran a name.
  const rows = rowsOf(
    marksOf(
      [
        run({ runId: 'plus', markName: 'AquaPlus', band: 'High', tone: 'high' }),
        run({ runId: 'max', markName: 'AquaMax', state: 'running', band: null, tone: null }),
      ],
      FAM,
    ),
    FAM,
  )
  const fam = rows[0]
  assert.ok(fam && fam.kind === 'family')
  assert.equal(fam.band, 'High')
})

test('the family date is the most recent activity anywhere inside it', () => {
  const rows = rowsOf(
    marksOf(
      [
        run({ runId: 'plus', markName: 'AquaPlus', date: '2026-07-19' }),
        run({ runId: 'max', markName: 'AquaMax', date: '2026-06-30' }),
      ],
      FAM,
    ),
    FAM,
  )
  assert.equal(rows[0]!.date, '2026-07-19')
})

test('AN UNFAMILIED MARK STAYS TOP-LEVEL — no family of one', () => {
  // Most marks have no family and never will. Wrapping each in a container of one adds a chevron between
  // the reader and the thing they came for.
  const rows = rowsOf(marksOf([run({ runId: 'solo', markName: 'Venzy' })]), NO_FAMILIES)
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.kind, 'mark')
})

test('with no families at all, the view is exactly the mark list', () => {
  const marks = marksOf([run({ runId: 'a', markName: 'Venzy' }), run({ runId: 'b', markName: 'Petcary' })])
  const rows = rowsOf(marks)
  assert.deepEqual(rows.map((r) => r.kind), ['mark', 'mark'])
  assert.deepEqual(rows.map((r) => r.id), marks.map((m) => m.id))
})

test('a family named by nothing falls back to its id rather than rendering blank', () => {
  const orphan: Families = { of: { plus: 'hydra' }, names: {} }
  const rows = rowsOf(marksOf([run({ runId: 'plus' })], orphan), orphan)
  assert.equal(rows[0]!.name, 'hydra')
})

test('rows keep the order their first member arrived in, so the caller’s sort survives', () => {
  // Grouping sits between sorting and paging. If it reordered, the user's chosen sort would be silently
  // overridden and the pager would count a different list than the one on screen.
  const rows = rowsOf(
    marksOf(
      [
        run({ runId: 'other', markName: 'Venzy', date: '2026-07-20' }),
        run({ runId: 'plus', markName: 'AquaPlus', date: '2026-07-19' }),
        run({ runId: 'max', markName: 'AquaMax', date: '2026-06-30' }),
      ],
      FAM,
    ),
    FAM,
  )
  assert.deepEqual(rows.map((r) => r.name), ['Venzy', 'Hydra range'], 'the family lands where its first member was')
})

test('runsIn flattens either kind of row — what a filter counts and a search matches', () => {
  const marks = marksOf(
    [run({ runId: 'plus', markName: 'AquaPlus' }), run({ runId: 'max', markName: 'AquaMax' })],
    FAM,
  )
  const rows = rowsOf(marks, FAM)
  assert.equal(runsIn(rows[0]!).length, 2, 'a family reports every read under it')
  assert.equal(runsIn(marks[0]!).length, 1)
})

test('grouping an empty list is empty, not a phantom row', () => {
  assert.deepEqual(marksOf([]), [])
  assert.deepEqual(rowsOf([]), [])
})

// ──: the parent row is ONE read, and it can be ordered ─────────────────────────────────────────

test('#275/#283: two reads on the same DAY are ordered by their completion timestamp, not by arrival', () => {
  // The measured case. On the test instance, House default carried two runs that differed by 2m08s in
  // issuedAt and in nothing else the page rendered — different runIds, different codenames, different
  // doors (cli/enqueue vs mcp/start_run), even different report bytes. `date` is day precision, so they
  // TIED, and Array.prototype.sort is stable: which one the parent row spoke for was decided by the
  // order readdirSync happened to return.
  const earlier = run({ runId: 'cli', date: '2026-08-04', issuedAt: '2026-08-04T06:54:58.017Z', band: 'Medium' })
  const later = run({ runId: 'mcp', date: '2026-08-04', issuedAt: '2026-08-04T06:57:06.563Z', band: 'Manageable' })
  // Fed in the WRONG order, which is the whole point: arrival order must not decide.
  const marks = marksOf([earlier, later])
  assert.equal(marks[0]!.current.runId, 'mcp', 'the later timestamp is the current read')
  assert.deepEqual(marks[0]!.reads.map((r) => r.runId), ['mcp', 'cli'])
  assert.equal(marks[0]!.band, 'Manageable', "and the row shows THAT read's band")
})

test('#275: a read with NO timestamp falls back to the date, and never sorts as the newest', () => {
  // A run published before issuedAt crossed the wire. Unknown must not read as "most recent".
  const old = run({ runId: 'old', date: '2026-08-01', issuedAt: null, band: 'Very high' })
  const recent = run({ runId: 'new', date: '2026-08-04', issuedAt: '2026-08-04T09:00:00Z', band: 'Manageable' })
  assert.equal(marksOf([old, recent])[0]!.current.runId, 'new')
  assert.equal(marksOf([recent, old])[0]!.current.runId, 'new')
  // Two undated-in-issuedAt reads still order by day rather than collapsing.
  const a = run({ runId: 'a', date: '2026-08-01', issuedAt: null })
  const b = run({ runId: 'b', date: '2026-08-03', issuedAt: null })
  assert.equal(marksOf([a, b])[0]!.current.runId, 'b')
})

test('#275: the Risk cell REPORTS the bands present, worst first — never a synthesised value', () => {
  // The aim: a reader could reconstruct the row's contents from the cell. A computed "worst" cannot pass
  // that, whatever it is called — and it is what needed the word "worst:" beside it to explain itself.
  const single = marksOf([run({ runId: 'a', band: 'Medium', issuedAt: '2026-08-04T09:00:00Z' })])
  assert.deepEqual(single[0]!.rowBands, ['Medium'], 'one mark, one band — what it always showed')

  const batch = marksOf([run({
    runId: 'b', kind: 'knockout-batch', band: 'Manageable', issuedAt: '2026-08-04T09:00:00Z',
    marks: [
      { name: 'ONE', band: 'Manageable', tone: 'low' },
      { name: 'TWO', band: 'Very high', tone: 'severe' },
      { name: 'THREE', band: 'Manageable', tone: 'low' },
    ],
  })])
  assert.deepEqual(batch[0]!.rowBands, ['Very high', 'Manageable'],
    'the bands actually there, worst first, each said once — not the word Manageable twice, and not one word standing for three')
})

test('#275: the parent row shows ONE read per column — no cell joins two values', () => {
  const marks = marksOf([
    run({ runId: 'a', date: '2026-08-01', issuedAt: '2026-08-01T09:00:00Z', stageLabel: 'Depth 1', band: 'Medium' }),
    run({ runId: 'b', date: '2026-08-04', issuedAt: '2026-08-04T09:00:00Z', stageLabel: 'Depth 4', band: 'Manageable' }),
  ])
  const m = marks[0]!
  assert.deepEqual(m.rowBands, ['Manageable'])
  assert.equal(m.date, '2026-08-04')
  assert.equal(m.issuedAt, '2026-08-04T09:00:00Z')
  assert.equal(m.reads.length, 2, 'the count survives — the row still says there are two')
})

test('#275: an earlier read that was WORSE leaves a marker; one that was better or equal leaves none', () => {
  // The one thing a latest-read rule would otherwise hide. It must be rare enough to notice, so the
  // negative cases matter more than the positive one.
  const improved = marksOf([
    run({ runId: 'old', date: '2026-08-01', issuedAt: '2026-08-01T09:00:00Z', band: 'Very high' }),
    run({ runId: 'new', date: '2026-08-04', issuedAt: '2026-08-04T09:00:00Z', band: 'Manageable' }),
  ])
  assert.equal(improved[0]!.improvedFrom, 'Very high')

  const worsened = marksOf([
    run({ runId: 'old', date: '2026-08-01', issuedAt: '2026-08-01T09:00:00Z', band: 'Manageable' }),
    run({ runId: 'new', date: '2026-08-04', issuedAt: '2026-08-04T09:00:00Z', band: 'Very high' }),
  ])
  assert.equal(worsened[0]!.improvedFrom, null, 'a deeper read finding MORE is the ordinary case, not a marker')

  const same = marksOf([
    run({ runId: 'old', date: '2026-08-01', issuedAt: '2026-08-01T09:00:00Z', band: 'Medium' }),
    run({ runId: 'new', date: '2026-08-04', issuedAt: '2026-08-04T09:00:00Z', band: 'Medium' }),
  ])
  assert.equal(same[0]!.improvedFrom, null)

  assert.equal(marksOf([run({ runId: 'only', band: 'Very high', issuedAt: '2026-08-04T09:00:00Z' })])[0]!.improvedFrom, null,
    'a single read has nothing to have improved from')
})

test('#275: a band the ladder does not know sorts LAST rather than first — an unknown is not a worst case', () => {
  // Found while writing the test above, and worth pinning: bandRank returns MAX_SAFE_INTEGER for a label
  // the customer's ladder does not carry, so it sinks. That is the right direction — a word nobody can
  // rank must not be presented as the most severe thing on the row.
  const batch = marksOf([run({
    runId: 'x', kind: 'knockout-batch', band: 'Medium', issuedAt: '2026-08-04T09:00:00Z',
    marks: [
      { name: 'A', band: 'Medium', tone: 'medium' },
      { name: 'B', band: 'Not on this ladder', tone: null },
    ],
  })])
  assert.deepEqual(batch[0]!.rowBands, ['Medium', 'Not on this ladder'])
})
