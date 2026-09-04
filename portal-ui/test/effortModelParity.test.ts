// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The effort model exists twice — in the browser (composerProduct.ts, where the bar is drawn) and on the
// server (driver/effort-model.mjs, where a plan door quotes and the runner stamps). This test is the
// reason that is safe: it pins them together across a matrix of machinery shapes, so the number a user
// was shown when they pressed the button is provably the number the run was admitted under.
//
// If this fails, do NOT "fix" one side to match. Decide which is right, change that one deliberately,
// bump UNITS_VERSION in driver/effort-model.mjs, and update the other. A silent divergence here is a
// user being quoted one search and charged for another.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as ui from '../src/contract/composerProduct.ts'
import * as srv from '../../driver/effort-model.mjs'
import { MARKETPLACE_DENSITIES } from '../../driver/profiles.mjs'
import type { Machinery } from '../src/contract/composerProduct.ts'

// EVERY SHAPE THE FOUR PRODUCTS CAN PRODUCE, plus the two impossible ones that must still agree. The
// list used to be lever combinations, half of which named no product at all ("empty", "register-only");
// it is machinery now, which is what both implementations actually take.
const LEVER_SETS: ReadonlyArray<readonly [string, Machinery]> = [
  ['knockout', { pipeline: 'knockout', caseLaw: false, nativeLanguage: false, registerCounts: false, territories: [] }],
  ['knockout+counts', { pipeline: 'knockout', caseLaw: false, nativeLanguage: false, registerCounts: true, territories: [] }],
  ['knockout+territories', { pipeline: 'knockout', caseLaw: false, nativeLanguage: false, registerCounts: true, territories: ['France', 'Germany'] }],
  ['global preliminary', { pipeline: 'clearance', caseLaw: false, nativeLanguage: false, registerCounts: false, territories: [] }],
  ['multi-country', { pipeline: 'clearance', caseLaw: false, nativeLanguage: false, registerCounts: false, territories: ['France', 'Germany'] }],
  ['multi-country+native', { pipeline: 'clearance', caseLaw: false, nativeLanguage: true, registerCounts: false, territories: ['China', 'Japan'] }],
  ['full country', { pipeline: 'clearance', caseLaw: true, nativeLanguage: true, registerCounts: false, territories: ['United States'] }],
  ['clearance+1territory, no extras', { pipeline: 'clearance', caseLaw: false, nativeLanguage: false, registerCounts: false, territories: ['United States'] }],
  // Shapes no product produces, and both sides must still answer identically: a knockout carrying a
  // clearance's axes. `nativeActive`/`caseLawActive` drop them on both sides, and a divergence here is
  // exactly the class of bug that only shows on a request nobody meant to compose.
  ['knockout+strayNative', { pipeline: 'knockout', caseLaw: false, nativeLanguage: true, registerCounts: false, territories: [] }],
  ['knockout+strayCaseLaw', { pipeline: 'knockout', caseLaw: true, nativeLanguage: false, registerCounts: false, territories: [] }],
]

const NAMES = [1, 2, 7, 20]
const CLASSES = [0, 1, 3, 9]
const PLATFORMS = [0, 1, 7, 13]
// DERIVED from the validator's own list, never restated beside it.
//
// The set was hand-written as [null, 'sparse', 'high', 'HIGH'] and omitted `'dense'` — the only value
// besides `'sparse'` a profile may legally hold — for the whole life.
//
// BE PRECISE ABOUT WHAT THAT DID AND DID NOT CAUSE, because the obvious reading is wrong and I measured
// it before writing this line. Adding `'dense'` to this population would NOT have caught 2008: both
// twins keyed on `'high'`, so they agreed with each other on every input including `'dense'`, and this
// file stays green on the defect with the corrected population in place — driven, both twins reverted,
// 7/7 pass. A parity test proves the twins MATCH. Nothing here can prove either matches the run, at any
// population. What catches 2008 is a different file:
// driver/test/the-effort-model-predicts-the-run-it-quotes.test.mjs.
//
// What deriving the list buys is the NEXT density. A third value added to the validator is exercised
// here without anyone remembering to come and add it, and a twin that has not learned it fails on the
// commit that introduces it rather than months later.
//
// The refused spellings stay in the list. They are no longer expected to select anything, and the twins
// must still answer identically on them — a value that reaches here is a value some caller passed.
const DENSITIES: ReadonlyArray<string | null> = [null, ...MARKETPLACE_DENSITIES, 'high', 'HIGH']

test('effort model: server port is numerically identical to the browser model', () => {
  let checked = 0
  for (const [label, levers] of LEVER_SETS) {
    for (const names of NAMES) {
      for (const classes of CLASSES) {
        for (const platforms of PLATFORMS) {
          for (const density of DENSITIES) {
            const i = { levers, names, classes, platforms, density }
            const where = `${label} names=${names} classes=${classes} platforms=${platforms} density=${density}`
            assert.equal(srv.deriveMode(levers), ui.deriveMode(levers), `mode: ${where}`)
            assert.equal(srv.effortRaw(i), ui.effortRaw(i), `effortRaw: ${where}`)
            assert.equal(srv.effortUnits(i), ui.effortUnits(i), `effortUnits: ${where}`)
            assert.equal(srv.costBand(i), ui.costBand(i), `costBand: ${where}`)
            assert.equal(srv.runCount(i), ui.runCount(i), `runCount: ${where}`)
            assert.equal(srv.turnaroundHours(i), ui.turnaroundHours(i), `turnaroundHours: ${where}`)
            assert.equal(srv.turnaround(i), ui.turnaround(i), `turnaround: ${where}`)
            checked++
          }
        }
      }
    }
  }
  assert.ok(checked >= 700, `matrix should be broad, only checked ${checked}`)
})

test('effort model: the shared sub-calculations agree too (not just the totals)', () => {
  for (const platforms of [0, 1, 7, 13, 40]) {
    for (const density of DENSITIES) {
      assert.equal(srv.checksPerName(platforms), ui.checksPerName(platforms))
      assert.equal(srv.gridBudget(density), ui.gridBudget(density))
      assert.equal(srv.batchSize(platforms, density), ui.batchSize(platforms, density))
    }
  }
  for (const [, levers] of LEVER_SETS) {
    assert.equal(srv.nativeActive(levers), ui.nativeActive(levers))
    assert.equal(srv.caseLawActive(levers), ui.caseLawActive(levers))
    assert.equal(srv.countsActive(levers), ui.countsActive(levers))
    assert.equal(srv.variantCount(levers), ui.variantCount(levers))
    assert.deepEqual(srv.quoteBoundsFor(levers), { ...ui.quoteBoundsFor(levers) })
  }
})

test('effort model: the weight table itself matches, so a re-fit cannot land on one side only', () => {
  // Reaching into W on both sides is deliberate: the totals above would also catch a weight change, but
  // this says WHICH weight moved, and it fails even for a weight no matrix row happens to exercise.
  assert.deepEqual({ ...srv.W }, { ...ui.W as Record<string, number> })
})

test('effort model: quoteEffort carries the version, the absolute raw, and the relative bar', () => {
  const i = { levers: LEVER_SETS[4][1], names: 1, classes: 3, platforms: 7, density: null }
  const q = srv.quoteEffort(i)
  assert.equal(q.unitsVersion, srv.UNITS_VERSION, 'a quote is only interpretable against its version')
  assert.equal(q.units, ui.effortUnits(i))
  assert.equal(q.turnaround, ui.turnaround(i))
  assert.ok(q.raw > 0, 'raw is the absolute figure a price may later be fitted against')
  // `pipeline`, not `mode`: the three-valued lever mode ('no-search') went with the levers, and what a
  // quote states is which of the two orchestration shapes it priced.
  assert.equal(q.pipeline, 'clearance')
  // no currency in the quote — units are not money (owner directive 2026-07-11)
  assert.doesNotMatch(JSON.stringify(q), /usd|price|[$]/i)
})

// — THE RUN-SLOT CAP IS NOT COPIED INTO EITHER HALF OF THE MODEL.
//
// The turnaround quote used to multiply the ruled range by `ceil(runCount / CONCURRENCY)`, with
// `CONCURRENCY` hard-coded to 2 on BOTH sides — a fourth and a fifth copy of a default an operator
// changes in an `.env` with no deploy. The owner ruled the quote is a fixed range with no compute in it
// (2026-08-26), so both copies went. This is what notices if either comes back, and it has to live here
// rather than beside one implementation: a constant restored on one side only is exactly the silent
// divergence this file exists to prevent, and the matrix above would catch the NUMBER while saying
// nothing about the second copy of the cap that produced it.
test('#1894 neither the browser nor the server carries a copy of the run-slot cap', () => {
  const both: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ['browser (composerProduct.ts)', ui as unknown as Record<string, unknown>],
    ['server (effort-model.mjs)', srv as unknown as Record<string, unknown>],
  ]
  for (const [where, mod] of both) {
    const names = Object.keys(mod)
    assert.ok(names.length > 10, `${where}: exported almost nothing — this arm would pass vacuously`)
    for (const dead of ['CONCURRENCY', 'waveCount'])
      assert.ok(!(dead in mod), `${where}: ${dead} is back. The quote is a table lookup since #1894.`)
    const capish = names.filter((n) => /concurren|wave|slot|parallel/i.test(n))
    assert.deepEqual(capish, [], `${where}: these exports look like a re-copied run-slot cap: ${capish.join(', ')}`)
  }
})

// The property the ruling decided, asserted on the browser half too — the driver has the same arm, and
// this screen is where a client reads the number, so the guard belongs on both sides of the parity.
test('#1894 the name count moves neither half of the quote', () => {
  const clearance = LEVER_SETS[4][1]
  const seen = new Set<string>()
  for (const names of [1, 2, 3, 5, 8, 20, 100]) {
    const i = { levers: clearance, names, classes: 3, platforms: 7, density: null }
    assert.equal(ui.runCount(i), names, `the fixture must actually carry ${names} runs`)
    seen.add(`${ui.turnaround(i)}|${ui.turnaroundHours(i)}|${srv.turnaround(i)}|${srv.turnaroundHours(i)}`)
  }
  assert.deepEqual([...seen], ['1.5–2.5 hours|2.5|1.5–2.5 hours|2.5'],
    `a name count moved a quote: ${[...seen].join('  ')}`)
})

// `runsNote` is the one client-facing STRING the cap reached, and took the clause out of it.
// Unreachable today (every clearance is one name), kept for the family-search track, so the guard is
// what stops the queue's shape being told to a client again when that track lands.
test('#1894 the runs note states the searches and not the queue behind them', () => {
  const three = { levers: LEVER_SETS[4][1], names: 3, classes: 3, platforms: 7, density: null }
  const note = ui.runsNote(three)
  assert.equal(note, 'Runs as 3 separate searches — 3× the work.')
  assert.doesNotMatch(note, /wave|at a time|concurren/i, 'the run-slot cap is not a fact about a client’s search')
  assert.equal(ui.runsNote({ ...three, names: 1 }), '', 'one name, one search — nothing to say')
})
