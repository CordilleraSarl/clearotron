// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// What a row on Clearances says and offers, driven over synthetic threads.
//
// The screen renders these answers and has no DOM harness, so this is where the rules are held. The
// browser check (scripts/clearances-render-check.mjs) reads the same states off a real page; this file
// drives every branch, including the ones the check's fixture does not reach.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { marksOf, rowsOf, nameCount } from '../src/contract/grouping.ts'
import type { FamilyGroup, MarkGroup } from '../src/contract/grouping.ts'
import type { Run } from '../src/contract/api.ts'
import type { Band } from '../src/contract/tone.ts'
import {
  GROUP_RISK_LINE,
  STOPPED_LINE,
  groupStatus,
  hasReport,
  nameActions,
  namesLabel,
  reportLine,
  searchesLabel,
  shownBand,
  shownReport,
  statusCount,
} from '../src/contract/nameRow.ts'

const LADDER: readonly Band[] = [
  { label: 'Severe', tone: 'severe' },
  { label: 'Medium', tone: 'medium' },
  { label: 'Manageable', tone: 'low' },
]

const run = (over: Partial<Run> & { runId: string }): Run => ({
  account: 'aurora',
  title: 'AQUAPLUS',
  markName: 'AQUAPLUS',
  product: null,
  stageLabel: null,
  kind: 'clearance',
  state: 'delivered',
  date: '2026-09-01',
  issuedAt: null,
  band: 'Manageable',
  tone: 'low',
  bands: LADDER,
  marks: [],
  reportSchema: null,
  held: false,
  report: 'report.html',
  reports: [],
  step: null,
  stepN: null,
  stepTotal: null,
  reason: null,
  failedStage: null,
  ...over,
} as Run)

const one = (runs: readonly Run[]): MarkGroup => {
  const marks = marksOf(runs)
  assert.equal(marks.length, 1, 'premise: the fixture is one name')
  return marks[0]!
}

// A name re-read: a search waiting for a slot above two finished ones.
const REREAD = [
  run({ runId: 'q', date: '2026-09-16', issuedAt: '2026-09-16T08:00:00Z', state: 'queued', band: null, tone: null, report: null }),
  run({ runId: 'r2', date: '2026-09-02', issuedAt: '2026-09-02T15:00:00Z', band: 'Medium', tone: 'medium' }),
  run({ runId: 'r1', date: '2026-08-21', issuedAt: '2026-08-21T10:00:00Z', band: 'Severe', tone: 'severe' }),
]

test('a report is a run-level document OR a batch\'s per-name reports — a batch is not unopenable', () => {
  assert.equal(hasReport(run({ runId: 'a' })), true)
  assert.equal(hasReport(run({ runId: 'b', report: null, reports: [{ mark: 'X', slug: 'x', path: 'report-x.html' }] })), true,
    'a batch carries no run-level link by design; its per-name reports are still something to open')
  assert.equal(hasReport(run({ runId: 'c', report: null })), false)
})

test('WHILE A SEARCH IS UNDER WAY the row shows the latest report, dated — never a blank, never unlabelled', () => {
  const mark = one(REREAD)
  assert.equal(mark.current.runId, 'q', 'premise: the newest read is the queued one')
  assert.equal(shownReport(mark)?.runId, 'r2', 'the band comes from the newest DELIVERED read')
  assert.deepEqual(mark.reportBands, ['Medium'])
  assert.equal(reportLine(mark), 'latest report · 2026-09-02', 'and the line beneath says which report it is')
  assert.equal(statusCount(mark), '1 search', 'the status counts the search under way: "Queued · 1 search"')
  // `band` still speaks for the newest read, which has none — the field the rest of the product reads
  // for "where the name stands now" is unchanged.
  assert.equal(mark.band, null)
})

test('the count and the dated line appear TOGETHER, and only when there is something to tell apart', () => {
  // Nothing under way: the name's own state, no line.
  const settled = one([run({ runId: 'a', date: '2026-09-02' }), run({ runId: 'b', date: '2026-08-01' })])
  assert.equal(reportLine(settled), null)
  assert.equal(statusCount(settled), null)
  // Under way, but never delivered: "Running" with its stage, no count, no line — there is no report to
  // tell the search apart from.
  const first = one([run({ runId: 'r', state: 'running', band: null, tone: null, report: null, step: 'Register sweeps' })])
  assert.equal(shownReport(first), null)
  assert.equal(reportLine(first), null)
  assert.equal(statusCount(first), null)
  // Two searches under way above a report: the count says two.
  const two = one([
    run({ runId: 'q2', issuedAt: '2026-09-16T09:00:00Z', state: 'running', band: null, tone: null, report: null }),
    ...REREAD,
  ])
  assert.equal(statusCount(two), '2 searches')
  assert.equal(reportLine(two), 'latest report · 2026-09-02')
})

test('a STOPPED name shows no band, even over an older report — its standing is that it stopped', () => {
  const stopped = one([
    run({ runId: 's', date: '2026-09-16', issuedAt: '2026-09-16T07:00:00Z', state: 'cancelled', band: null, tone: null, report: null }),
    run({ runId: 'r', date: '2026-09-02', issuedAt: '2026-09-02T07:00:00Z', band: 'Medium', tone: 'medium' }),
  ])
  assert.equal(shownReport(stopped), null)
  assert.equal(reportLine(stopped), null)
  assert.equal(stopped.latestReport?.runId, 'r', 'the report still exists — it is in the thread, badged')
})

test('THE BUTTONS: Open and Ask AI on a report, Ask AI alone once stopped, nothing while it first runs', () => {
  const single = nameActions(one([run({ runId: 'a' })]))
  assert.equal(single.open?.label, 'Open')
  assert.equal(single.askAbout?.runId, 'a')

  const threaded = nameActions(one([run({ runId: 'a', date: '2026-09-02' }), run({ runId: 'b', date: '2026-08-01' })]))
  assert.equal(threaded.open?.label, 'Open latest report', 'more than one search: say which one opens')

  const waiting = nameActions(one(REREAD))
  assert.equal(waiting.open?.label, 'Open latest report')
  assert.equal(waiting.open?.read.runId, 'r2', 'Open opens the report the row shows, not the queued search')

  const stopped = nameActions(one([run({ runId: 's', state: 'cancelled', band: null, tone: null, report: null })]))
  assert.equal(stopped.open, null, 'no document to open')
  assert.equal(stopped.askAbout?.runId, 's', 'but its completed work is readable through Ask AI')

  const failed = nameActions(one([run({ runId: 'f', state: 'failed', band: null, tone: null, report: null })]))
  assert.equal(failed.open, null)
  assert.equal(failed.askAbout?.runId, 'f', 'a failure is read the same way as a stop: no document, work to ask about')

  const running = nameActions(one([run({ runId: 'r', state: 'running', band: null, tone: null, report: null })]))
  assert.equal(running.open, null)
  assert.equal(running.askAbout, null, 'nothing to open and nothing yet to ask')

  const queued = nameActions(one([run({ runId: 'q', state: 'queued', band: null, tone: null, report: null })]))
  assert.deepEqual(queued, { open: null, askAbout: null })

  // Delivered, but this view has no file to link: no Open, and the report is still what Ask AI asks about.
  const noFile = nameActions(one([run({ runId: 'n', report: null })]))
  assert.equal(noFile.open, null)
  assert.equal(noFile.askAbout?.runId, 'n')
})

test('ONE DERIVATION: whatever Open opens is what Ask AI asks about and what the Risk cell shows', () => {
  // Over every shape above, at once. If these ever came apart, a reader could open one search's report,
  // ask their assistant about another, and read the band of a third, all from one row.
  const shapes: Run[][] = [
    [run({ runId: 'a' })],
    [run({ runId: 'a', date: '2026-09-02' }), run({ runId: 'b', date: '2026-08-01' })],
    REREAD,
    [run({ runId: 'x', issuedAt: '2026-09-16T09:00:00Z', state: 'running', band: null, tone: null, report: null }), ...REREAD],
    [run({ runId: 's', state: 'cancelled', band: null, tone: null, report: null })],
    [run({ runId: 'r', state: 'running', band: null, tone: null, report: null })],
  ]
  let withOpen = 0
  for (const runs of shapes) {
    const mark = one(runs)
    const { open, askAbout } = nameActions(mark)
    if (!open) continue
    withOpen++
    assert.equal(open.read.runId, shownReport(mark)?.runId, `Open and the Risk cell disagree on ${runs.map((r) => r.runId)}`)
    assert.equal(askAbout?.runId, open.read.runId, `Open and Ask AI disagree on ${runs.map((r) => r.runId)}`)
  }
  assert.ok(withOpen >= 4, `the population reached too few rows with an Open to mean anything: ${withOpen}`)
})

test('the Risk sort orders a waiting name by the band its row shows', () => {
  const mark = one(REREAD)
  assert.equal(shownBand(mark), 'Medium', 'not null, which would sort it with the unrated names below every band')
  const plain = one([run({ runId: 'p', markName: 'PLAIN', title: 'PLAIN', band: 'Severe', tone: 'severe' })])
  assert.equal(shownBand(plain), 'Severe')
})

// ── groups ─────────────────────────────────────────────────────────────────────────────────────────────

const FAM = { of: { q: 'fam', r2: 'fam', r1: 'fam', m1: 'fam' }, names: { fam: 'Aqua line' } }
const family = (runs: readonly Run[]): FamilyGroup => {
  const rows = rowsOf(marksOf(runs, FAM), FAM)
  const fam = rows.find((r) => r.kind === 'family')
  assert.ok(fam && fam.kind === 'family', 'premise: the fixture is a family')
  return fam
}
const AQUAMAX = run({ runId: 'm1', markName: 'AQUAMAX', title: 'AQUAMAX', date: '2026-08-28', band: 'Manageable', tone: 'low' })

test('A GROUP FOLLOWS ITS MEMBERS: "1 search queued" while any name in it has one', () => {
  const fam = family([...REREAD, AQUAMAX])
  assert.deepEqual(groupStatus(fam), { text: '1 search queued', state: 'queued' })
  const running = family([run({ runId: 'q', issuedAt: '2026-09-16T08:00:00Z', state: 'running', band: null, tone: null, report: null }), REREAD[1]!, REREAD[2]!, AQUAMAX])
  assert.deepEqual(groupStatus(running), { text: '1 search running', state: 'running' })
  const settled = family([REREAD[1]!, REREAD[2]!, AQUAMAX])
  assert.equal(groupStatus(settled), null, 'nothing under way: the group states its members\' roll-up as before')
})

test('the group\'s band is the highest across each name\'s LATEST REPORT — a waiting name still counts', () => {
  // AQUAPLUS's newest search has no band; its latest report is Medium. AQUAMAX is Manageable. A roll-up of
  // each name's newest search would say Manageable while AQUAPLUS's own row says Medium one line below.
  const fam = family([...REREAD, AQUAMAX])
  assert.equal(fam.band, 'Medium')
  assert.equal(GROUP_RISK_LINE, 'Highest risk across the latest report for each name.')
})

test('the counts are NAMES: a group of two is two, and the total is the sum of what is listed', () => {
  const rows = rowsOf(marksOf([...REREAD, AQUAMAX, run({ runId: 'solo', markName: 'SOLO', title: 'SOLO' })], FAM), FAM)
  assert.equal(rows.length, 2, 'premise: one group row and one name row')
  assert.equal(nameCount(rows), 3, 'three names, however many rows hold them')
  assert.equal(namesLabel(nameCount(rows)), '3 names')
  assert.equal(namesLabel(1), '1 name')
  assert.equal(searchesLabel(1), '1 search')
  assert.equal(searchesLabel(3), '3 searches')
})

test('the stopped line is the specification\'s sentence', () => {
  assert.equal(STOPPED_LINE, 'No report will be produced. Completed work stays readable through Ask AI.')
})
