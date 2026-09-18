// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The Clearances list decisions.
//
// Both of these fail silently and convincingly when they are wrong: an off-by-one page window renders
// the wrong fifty rows without looking wrong, and a missing owner tag makes two clients' identically
// named marks read as one mark listed twice. Neither has a visual tell, which is why they are pure
// functions with tests rather than expressions inside a component.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ambiguousTitles, clearancesColumns, normaliseTitle, pageWindow } from '../src/contract/listView.ts'

const rows = (n: number) => Array.from({ length: n }, (_, i) => i)

test('a page window shows the rows it says it shows', () => {
  // The header reads "1–50 of 73". If the range and the contents ever disagree, the number a user
  // trusts is the one that is wrong.
  const p = pageWindow(rows(73), 0, 50)
  assert.equal(p.pageCount, 2)
  assert.equal(p.visible.length, 50)
  assert.equal(p.visible[0], 0)
  assert.equal(p.visible.at(-1), 49)
  assert.equal(p.from, 1)
  assert.equal(p.to, 50)
})

test('the last page is short, and says so', () => {
  const p = pageWindow(rows(73), 1, 50)
  assert.equal(p.visible.length, 23)
  assert.equal(p.visible[0], 50)
  assert.equal(p.from, 51)
  assert.equal(p.to, 73, 'not 100 — the range is clamped to what exists')
})

test('AN OUT-OF-RANGE PAGE CLAMPS instead of rendering nothing', () => {
  // The real sequence: sitting on page 3, type into the filter, list drops to 12 rows. Without
  // clamping the table empties, with no error and no way back — the user did nothing wrong, so the
  // view has to absorb it.
  const p = pageWindow(rows(12), 3, 50)
  assert.equal(p.current, 0)
  assert.equal(p.visible.length, 12)
  assert.equal(p.pageCount, 1)
})

test('an empty list is one page, numbered from zero', () => {
  // `from` of 1 on an empty list would render "1–0 of 0".
  const p = pageWindow([], 0, 50)
  assert.equal(p.pageCount, 1)
  assert.equal(p.from, 0)
  assert.equal(p.to, 0)
  assert.deepEqual(p.visible, [])
})

test('a nonsense page number does not produce a nonsense window', () => {
  for (const bad of [-1, Number.NaN, 1.7]) {
    const p = pageWindow(rows(73), bad, 50)
    assert.ok(p.current >= 0 && p.current < p.pageCount, `page ${bad} clamps into range`)
    assert.ok(p.visible.length > 0)
  }
})

test('an exact multiple does not leave a trailing empty page', () => {
  const p = pageWindow(rows(100), 0, 50)
  assert.equal(p.pageCount, 2, 'not 3')
})

test('THE AQUAPLUS CASE: one name under two owners is flagged', () => {
  // The live example. Two AquaPlus clearances exist, one for zephyr and one for generic, and on
  // screen they read as the same mark twice.
  const a = ambiguousTitles([
    { title: 'AquaPlus', account: 'zephyr' },
    { title: 'AquaPlus', account: 'generic' },
    { title: 'Drivers Haven', account: 'aurora' },
  ])
  assert.ok(a.has('aquaplus'), 'the shared name is ambiguous')
  assert.ok(!a.has('drivers haven'), 'a name only one owner uses is not')
})

test('the same name twice for the SAME owner is not ambiguous', () => {
  // A customer re-running their own mark is ordinary. Tagging those rows with the owner they obviously
  // belong to would be the noise that stops the real tag being noticed.
  const a = ambiguousTitles([
    { title: 'AquaPlus', account: 'zephyr' },
    { title: 'AquaPlus', account: 'zephyr' },
  ])
  assert.equal(a.size, 0)
})

test('case and stray space do not hide a collision', () => {
  // "AQUAPLUS " and "AquaPlus" are one name to everyone except a string comparison.
  const a = ambiguousTitles([
    { title: 'AQUAPLUS ', account: 'zephyr' },
    { title: ' aquaplus', account: 'petcary' },
  ])
  assert.ok(a.has('aquaplus'), 'still caught — this is the direction that leaks confusion')
})

test('normaliseTitle is the one comparison key', () => {
  assert.equal(normaliseTitle('  AquaPlus '), 'aquaplus')
  assert.equal(normaliseTitle('Drivers Haven'), 'drivers haven')
})

test('an empty list has no ambiguity', () => {
  assert.equal(ambiguousTitles([]).size, 0)
})

// ── the Clearances columns ─────────────────────────────────────────────────────────────────────────────

test('the column shares sum to 100 in EVERY mode — a table wider than its wrapper scrolls', () => {
  // The four modes are the two switches the screen has: a reader who may curate gets the checkbox column,
  // and turning grouping off adds the company column. Each is a different set of shares.
  for (const pick of [true, false]) {
    for (const owner of [true, false]) {
      const cols = clearancesColumns({ pick, owner })
      const sum = cols.reduce((n, c) => n + c.share, 0)
      assert.equal(sum, 100, `pick=${pick} owner=${owner}: shares sum to ${sum}`)
      assert.ok(cols.every((c) => c.share > 0), `pick=${pick} owner=${owner}: a column was squeezed to nothing: ${JSON.stringify(cols)}`)
      assert.deepEqual(cols.map((c) => c.key), [
        'twisty', ...(pick ? ['pick'] : []), 'name', ...(owner ? ['company'] : []), 'status', 'risk', 'updated', 'actions',
      ], 'the order is the header\'s order, with the actions column last')
    }
  }
})

test('the actions column is wide enough for "Open latest report" in every mode, and wider with the row menu', () => {
  // A share, not pixels — the browser check measures the pixels. What is held here is the ordering: the
  // curator's column carries one more control than the reader's, so it must not be the narrower one.
  const share = (pick: boolean) => clearancesColumns({ pick, owner: false }).find((c) => c.key === 'actions')!.share
  assert.ok(share(true) > share(false))
  assert.ok(share(false) >= 20, `the reader's actions column is ${share(false)}%`)
})

test('where the board\'s shares hold, the columns are the board\'s — and they still sum to 100 in every mode', () => {
  for (const pick of [false, true]) {
    for (const owner of [false, true]) {
      const cols = clearancesColumns({ pick, owner }, { wide: true })
      assert.equal(cols.reduce((n, c) => n + c.share, 0), 100, `wide pick=${pick} owner=${owner}`)
      assert.ok(cols.every((c) => c.share > 0), `wide pick=${pick} owner=${owner}: a column was squeezed to nothing`)
    }
  }
  // The approved board, grouped, for someone who may curate: 4 · 3 · 30 · 16 · 12 · 10 · 25.
  assert.deepEqual(clearancesColumns({ pick: true, owner: false }, { wide: true }).map((c) => c.share), [4, 3, 30, 16, 12, 10, 25])
})
