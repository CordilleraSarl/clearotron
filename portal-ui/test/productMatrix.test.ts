// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// productMatrix.test.ts — the four searches side by side, and where every word in it comes from.
//
// The table's whole claim is that it describes what the ENGINE will run, not what somebody once typed
// into a component. So the fixture is the offering as `PRODUCT_POLICIES` + `products.mjs` actually
// define it, shaped the way portal-service puts it on the wire, and CHECKED against the engine rather
// than copied. An invented fixture here would certify whatever the code happens to do.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Product } from '../src/contract/api.ts'
import { productMatrix, MARKERS, LEGEND } from '../src/contract/productMatrix.ts'
import { product as level, PRODUCTS, assertMatchesRegistry } from './products.fixture.ts'

// The fixture moved to products.fixture.ts and is now CHECKED against driver/level-rows.mjs rather than
// claiming in a comment to match it. See that file for why.

const cellsOf = (label: string, levels: readonly Product[] = PRODUCTS) => {
  const hit = productMatrix(levels).rows.find((r) => r.label === label)
  assert.ok(hit, `no row called ${label}`)
  return hit.cells
}
/** The row's TEXT, so every copy assertion below reads as it always did. */
const rowFor = (label: string, levels: readonly Product[] = PRODUCTS) => cellsOf(label, levels).map((c) => c.text)
/** The row's MARKERS, in the columns' order. */
const markersFor = (label: string, levels: readonly Product[] = PRODUCTS) => cellsOf(label, levels).map((c) => c.marker)

// ── the fixture is the engine's own answer, not a copy of it ────────────────────────────────────────

test('the product fixture matches what the engine actually emits', () => {
  // Everything below asserts cell TEXT for a given menu. That is only worth anything if the menu is the
  // one the engine ships — otherwise these tests describe a product nobody sells. This is the assertion
  // the old hand-copied fixture only claimed in a comment.
  assertMatchesRegistry()
})

// ── every cell, for the shipped menu ────────────────────────────────────────────────────────────────

test('the register row separates a SEARCH from a COUNT', () => {
  // Depth 2 fetches no records and reads none — it answers "how many are there". Calling that
  // "searched" beside a clearance's enumeration would sell the count as the sweep.
  // ONE knockout now, and it carries the counts — so the first column reads the count rather than
  // "not searched", which was the plain screen's answer before the two became one product.
  assert.deepEqual(rowFor('Trademark registers'), [
    'Filing counts only', 'Searched', 'Searched', 'Searched',
  ])
})

test('the marketplace row never reads a knockout as marketplace-free', () => {
  // The 2026-07-21 off-by-one, restated as a row: a knockout IS the marketplace product, and what it
  // lacks is the grid's structure. Since retired the one level that genuinely did not sweep, every
  // orderable depth carries this row — which is the point: the marketplace half is the floor.
  assert.deepEqual(rowFor('Marketplace & common-law'), [
    'One broad sweep per name',
    'Full grid — every shop, term by term',
    'Full grid — every shop, term by term',
    'Full grid — every shop, term by term',
  ])
})

test('the native-language row has THREE states, because the offering has three', () => {
  // Every clearance already searches the mark in the scripts its territories register marks in. What
  // the investigation buys is
  // native registers and native marketplaces — and whether you choose it, get it automatically, or
  // cannot buy it at all is exactly what distinguishes three of these four.
  assert.deepEqual(rowFor('Native language'), [
    'Not included',
    'Transliteration only (the scripts its territories register in)',
    'Optional — the one thing on this list you choose',
    'Runs automatically — native registers and shops in that country’s language',
  ])
})

test('the case-law row says WHICH search carries it, and never that it is optional', () => {
  // It used to read "Optional — one country per deep dive" on every clearance, which was the truth
  // about a LEVER. Case law is a PRODUCT: on one of these four the answer is "this is the search that
  // carries it", and on the other three it is "not sold here" — a different sentence from "you did not
  // tick it", and the difference is the whole ruling.
  assert.deepEqual(rowFor('Case law'), [
    'Not part of this search', 'Not part of this search', 'Not part of this search',
    'The case-law and opposition reading — this is the search that carries it',
  ])
  assert.deepEqual(rowFor('Where it looks'), [
    'worldwide, or any set of territories', 'worldwide, and nothing else',
    'a region, or two or more countries', 'exactly one country',
  ])
})

test('names and turnaround are quoted from the payload — the OFFERING’s figure, never a second one', () => {
  // 8, not 20. The soft cap went with the second number: a warning at 15 under a refusal at 8 is a
  // branch that can never fire, and a table that printed both was printing the one nothing enforced.
  assert.deepEqual(rowFor('Names per search'), ['8', '1', '1', '1'])
  // ASCENDING, which is the point of the ordering: a menu that is not in effort order is not a menu.
  // Every clearance reads the same since — one ruled range, the lane adders having been refuted
  // by the delivered walls. A knockout is still a different size of job, which is the separation this
  // row exists to show.
  assert.deepEqual(rowFor('Turnaround'),
    ['from 5–10 min', 'from 1.5–2.5 hours', 'from 1.5–2.5 hours', 'from 1.5–2.5 hours'])
})

test('a payload that states no turnaround leaves a mark, never a blank', () => {
  // A blank cell reads as "nothing" — which is a claim about the product rather than about the payload.
  assert.deepEqual(rowFor('Turnaround', [level({ baseTurnaround: null })]), ['—'])
})

// ── the columns ─────────────────────────────────────────────────────────────────────────────────────

test('columns are ordered LIGHT TO HEAVY, labelled as the server labels them', () => {
  // Not the payload's own order: the registry once listed levels as they were BUILT, so the lightest
  // clearance sat last and the header row read 0, 0.5, 1, 1.5, 1 — the shallowest clearance after the
  // deepest, under a number that looked like a mistake.
  //
  // THE LADDER SKIPS DEPTH 3, and that is the truth rather than a gap to close: retired that rung
  // and the survivors keep the numbers they were sold under.
  const { columns } = productMatrix(PRODUCTS)
  assert.deepEqual(columns.map((c) => c.name),
    ['Knockout search', 'Global preliminary search', 'Multi-country focus search', 'Full country search'])
  const hours = columns.map((c) => PRODUCTS.find((l) => l.key === c.key)!.baseTurnaroundHours!)
  assert.deepEqual(hours, [...hours].sort((a, b) => a - b), 'columns must ascend by effort')
  assert.deepEqual(columns.map((c) => c.key),
    ['knockout-search', 'global-preliminary-search', 'multi-country-focus-search', 'full-country-search'],
    'the key rides along as a React key, never as copy')
  // The two lighter clearances are both 1.5h, so the sort must be STABLE or they swap between runs.
  assert.deepEqual(columns.slice(1, 3).map((c) => c.key),
    ['global-preliminary-search', 'multi-country-focus-search'], 'ties keep offering order')
})

test('a level switched off KEEPS its column and carries the server’s own sentence', () => {
  // A client cannot ask for what they cannot see. Dropping the column would hide a product that exists
  // and is simply off here — the same rule the level list itself follows.
  const off = PRODUCTS.map((l) => (l.key === 'full-country-search'
    ? level({ ...l, available: false, unavailableNote: 'Local-language deep dives are not switched on here yet.' })
    : l))
  const { columns } = productMatrix(off)
  assert.equal(columns.length, 4)
  const jx = columns.find((c) => c.key === 'full-country-search')!
  assert.equal(jx.available, false)
  assert.match(jx.unavailableNote ?? '', /not switched on here/)
  for (const c of columns.filter((x) => x.key !== 'full-country-search')) {
    assert.equal(c.unavailableNote, null, 'an available level never carries a reason it is not')
  }
})

test('an available level with a stale note still reports no reason', () => {
  const { columns } = productMatrix([level({ available: true, unavailableNote: 'left over from a refusal' })])
  assert.equal(columns[0]?.unavailableNote, null)
})

// ── degradation, and what must never leak ───────────────────────────────────────────────────────────

test('an empty payload produces an empty table rather than throwing', () => {
  // The composer whose depth menu came back thin still has a form to fill in. Every row survives with
  // no cells, so the caller renders nothing rather than crashing the one screen that spends money.
  const m = productMatrix([])
  assert.deepEqual(m.columns, [])
  assert.equal(m.rows.length, 7)
  for (const r of m.rows) assert.deepEqual(r.cells, [])
})

test('nothing in the table names a component, a level key or a variable', () => {
  // This is client-facing copy on the screen that spends money. `jxLanes` is machinery; a client calls
  // it a native-script deep dive, and the house rule is that no engine vocabulary reaches their eyes.
  const words = productMatrix(PRODUCTS).rows.flatMap((r) => [r.label, ...r.cells.map((c) => c.text)]).join(' | ')
  for (const leak of [
    /jxLanes|commonLawGrid|registerProbe/,
    /prelim-jx|knockout-register|prelim-register-only/,
    /[A-Z][A-Z0-9]*_[A-Z0-9_]+/,
    /\.mjs\b/,
  ]) {
    assert.doesNotMatch(words, leak, `the matrix must not carry ${String(leak)}`)
  }
  // …and no money. Cost is five dots in the footer and never a figure — there is no price model, and a
  // number on a client's screen would be a quote.
  assert.doesNotMatch(words, /[$€£]|\b(?:USD|EUR|CHF|GBP)\b|\bcosts?\b/i)
})

test('every cell is a sentence a reader can act on — no empties, no bare booleans', () => {
  for (const r of productMatrix(PRODUCTS).rows) {
    assert.ok(r.label.trim().length > 0, 'every row is labelled')
    assert.equal(r.cells.length, PRODUCTS.length, `${r.label} answers for every column`)
    for (const c of r.cells) {
      assert.ok(c.text.trim().length > 0, `${r.label} left a blank cell`)
      // A cell cannot carry a marker and a different glyph: both come from MARKERS, off one lookup.
      if (c.marker) {
        assert.equal(c.glyph, MARKERS[c.marker].glyph, `${r.label}: glyph does not match its marker`)
        assert.equal(c.srLabel, MARKERS[c.marker].name, `${r.label}: the spoken label does not match its marker`)
      } else {
        assert.equal(c.glyph, '', `${r.label}: a glyph with no marker behind it`)
        assert.equal(c.srLabel, '')
      }
    }
  }
})


// ── one marker vocabulary, for three claims that used to wear three accidental words ─────────────────

test('the markers are derived from the same predicates the text is', () => {
  assert.deepEqual(markersFor('Trademark registers'), ['partial', 'full', 'full', 'full'])
  assert.deepEqual(markersFor('Native language'), ['absent', 'partial', 'optional', 'full'])
  assert.deepEqual(markersFor('Case law'), ['absent', 'absent', 'absent', 'full'])
})

test('the knockout marketplace cell is FULL, and this is not a typo', () => {
  // Reading `commonLawGrid: false` on a knockout as "does not search marketplaces" is the 2026-07-21
  // composer off-by-one that routed 20-name knockout requests into one-name clearances at roughly
  // twenty times the cost. `partial` here would re-encode that bug as a glyph. A knockout IS the
  // marketplace product; what it lacks is the grid's structure, which the cell TEXT says.
  //
  // NO `absent` CELL SURVIVES in this row: the one level that did not sweep was retired. The
  // matrix keeps the arm for a payload that names one anyway — it renders the server, not the registry.
  assert.deepEqual(markersFor('Marketplace & common-law'), ['full', 'full', 'full', 'full'])
})

test('quantity rows carry no marker — a glyph on a number claims nothing', () => {
  for (const label of ['Names per search', 'Turnaround', 'Where it looks']) {
    assert.deepEqual(markersFor(label), PRODUCTS.map(() => null), `${label} should be unmarked`)
  }
})

test('"Not available" is retired — it was a claim about the wrong thing', () => {
  // It read as a claim about Product.available (does this deployment offer the depth) when it was a
  // claim about the pipeline (does this depth have a case-law stage at all).
  const everything = productMatrix(PRODUCTS).rows.flatMap((r) => r.cells.map((c) => c.text)).join(' | ')
  assert.doesNotMatch(everything, /Not available/)
})

test('the legend explains every glyph drawn, and draws no glyph it cannot explain', () => {
  const used = new Set(productMatrix(PRODUCTS).rows.flatMap((r) => r.cells).filter((c) => c.marker).map((c) => c.glyph))
  const explained = new Set(LEGEND.map((m) => m.glyph))
  for (const g of used) assert.ok(explained.has(g), `${g} is drawn with nothing explaining it`)
  for (const g of explained) assert.ok(used.has(g), `${g} is explained but never drawn`)
})

test('the em dash still means only "not stated", as it does on three other screens', () => {
  // Profile, Preferences and Projects all render '—' for "no value". Giving it a second meaning inside
  // this table would be two claims in one glyph.
  const glyphs = new Set(productMatrix(PRODUCTS).rows.flatMap((r) => r.cells).map((c) => c.glyph))
  assert.ok(!glyphs.has('—'), 'the dash is not a marker')
  assert.deepEqual(rowFor('Turnaround', [level({ baseTurnaround: null })]), ['—'])
})

test('the legend borrows no word from the engine’s coverage-ledger enum', () => {
  // COVERAGE_STATUSES (confirmed-clean / coverage-limited / deferred) is a post-run register-axis AUDIT
  // state. This is a pre-run menu. A reader who saw "Partly" here and "coverage-limited" on their report
  // would reasonably think one caused the other.
  const words = LEGEND.map((m) => m.name).join(' ')
  assert.doesNotMatch(words, /\b(confirmed|clean|limited|deferred)\b/i)
})

test('exactly one column is current, or none — never two', () => {
  const marked = productMatrix(PRODUCTS, 'global-preliminary-search').columns.filter((c) => c.current)
  assert.deepEqual(marked.map((c) => c.key), ['global-preliminary-search'])
  assert.equal(productMatrix(PRODUCTS).columns.filter((c) => c.current).length, 0, 'no key ⇒ no highlight')
  assert.equal(productMatrix(PRODUCTS, 'nope').columns.filter((c) => c.current).length, 0, 'an unknown key highlights nothing')
})


test('no two columns show the SAME ladder label — a comparison needs distinguishable rungs', () => {
  // The bug this exists for: `stage` is the bare position, and TWO levels sit at rung 1 (a clearance,
  // and that same clearance with the marketplace half removed). Rendering the bare position on both
  // made the header row read 0, 0.5, 1, 1.5, 1 — a ladder that looks broken. `stageLabel` carries the
  // qualifier that makes the position true, and it is unique by construction.
  const labels = productMatrix(PRODUCTS).columns.map((c) => c.stageLabel)
  assert.equal(new Set(labels).size, labels.length, `duplicate ladder labels: ${labels.join(' | ')}`)
  // And the bare `stage` genuinely IS ambiguous — which is why it must not be what a comparison shows.
  const bare = productMatrix(PRODUCTS).columns.map((c) => c.stage)
  assert.ok(new Set(bare).size < bare.length, 'if this ever stops being true the split can be revisited')
})
