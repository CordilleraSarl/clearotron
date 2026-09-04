// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// What each of the four searches includes, as a table.
//
// The composer asks the requester to PICK ONE (NewClearance.tsx), which is the whole of — it used
// to derive a level from levers and could not name what it had derived. Picking needs comparing, and
// this is what makes the four comparable in one glance: what gets searched, where it looks, how deep it
// reads, how many names, how long.
//
// ── DERIVED FROM THE FETCHED PAYLOAD, NEVER FROM A LIST WRITTEN HERE ────────────────────────────────
//
// Every cell is read off `api.searches().products` — the server's own description of what it will run:
// `pipeline`, the `components` it carries, `geography`, `caseLaw`, `nativeLanguage`, `maxNames`,
// `baseTurnaround`. A table of prose written here would be a second answer to a question the server
// already answers, and it would go stale the first time a component moved — silently, and on the one
// screen that spends money.
//
// So a product this deployment cannot run still gets a column (with its own note beside the table), a
// product added to the offering appears here with no edit, and the words below describe the machinery
// rather than naming it: `jxLanes` is not what a client calls the native-language investigation.
//
// This is a `.ts` module and not markup for the reason compose.ts and composerProduct.ts are: the test
// runner can load `.ts` and not `.tsx`, so product logic in a component is product logic nothing checks.

import type { Product } from './api.ts'

export type MatrixColumn = {
  readonly key: string
  /** What this search is CALLED — the header leads with it. Never the key. */
  readonly name: string
  /** The same name, carried for an older bundle that reads `name || stageLabel`. */
  readonly stageLabel: string
  /** The one the requester has picked. Exactly one column, or none. */
  readonly current: boolean
  readonly available: boolean
  /** The server's own sentence for why not. Null when available — it never names an internal switch. */
  readonly unavailableNote: string | null
}

/**
 * ONE marker vocabulary, and the reason it exists.
 *
 * Three rows said no in three different words — "Not searched", "Not included", "Not available" — and
 * they were three genuinely different claims wearing three accidental phrasings, with nothing on screen
 * explaining the difference. A reader could only tell they meant different things by guessing.
 *
 *   full     the axis runs, in its deepest form on this depth
 *   partial  the axis runs, at a shallower reach than its deepest form
 *   optional the axis EXISTS here and a lever on THIS depth adds it — the sharpest line in the table.
 *            Case law on a prelim is still a prelim, so it is an option WITHIN this column. A script
 *            lane moves you to prelim-jx, a DIFFERENT column, so it is never `optional`; it is what the
 *            delta view is for. The matrix answers "what does each depth do"; the delta view answers
 *            "what would moving between them cost".
 *   absent   the axis does not exist here. No lever on this depth reaches it, at any price.
 *
 * "Not available" is RETIRED. It read as a claim about `Product.available` — whether this
 * deployment offers the depth at all — when it was a claim about the pipeline.
 *
 * NO COLLISION WITH THE ENGINE'S `COVERAGE_STATUSES` (confirmed-clean / coverage-limited / deferred,
 * driver/coverage-ledger.mjs). That is a post-run register-axis AUDIT state — what a completed sweep
 * was able to certify. This is a pre-run MENU. Different question, different subject, and a reader who
 * saw "Partly" here and "coverage-limited" on their report would reasonably think one caused the other,
 * so the words are kept clear of each other and a test asserts it.
 */
export type Marker = 'full' | 'partial' | 'optional' | 'absent'

export const MARKERS: Readonly<Record<Marker, { readonly glyph: string; readonly name: string }>> = {
  full: { glyph: '●', name: 'Included' },
  partial: { glyph: '◐', name: 'Partly' },
  optional: { glyph: '+', name: 'Optional' },
  absent: { glyph: '○', name: 'Not on this depth' },
}

export const LEGEND: readonly { readonly glyph: string; readonly name: string }[] =
  (Object.keys(MARKERS) as Marker[]).map((k) => MARKERS[k])

export type MatrixCell = {
  /** Null on the quantity rows — a marker on a number means nothing. */
  readonly marker: Marker | null
  /** From MARKERS, so a cell cannot carry one marker and a different glyph. '' when marker is null. */
  readonly glyph: string
  /** The marker's word, for a reader who cannot see the glyph. '' when marker is null. */
  readonly srLabel: string
  /** The sentence fragment. Never a blank — see UNSTATED. */
  readonly text: string
}

export type MatrixRow = {
  readonly label: string
  /** One per column, in the columns' order. Always a fragment, never a blank. */
  readonly cells: readonly MatrixCell[]
}

export type ProductMatrix = {
  readonly columns: readonly MatrixColumn[]
  readonly rows: readonly MatrixRow[]
}

const has = (level: Product, component: string): boolean => level.components.includes(component)
const isClearance = (level: Product): boolean => level.pipeline === 'clearance'

/** Not stated by the payload. A cell is never empty — a blank reads as "nothing", which is a claim. */
const UNSTATED = '—'

/**
 * The rows, in the order the reader's own question runs: what gets searched, then how deep, then how
 * much of it fits in one search.
 *
 * The register row leads because the registers lever is the one that picks the product — the same
 * asymmetry `deriveMode` is built around, restated where a client can see the consequence.
 */
type RowSpec = { readonly label: string; readonly cell: (l: Product) => MatrixCell }

const cell = (marker: Marker | null, text: string): MatrixCell => ({
  marker,
  glyph: marker ? MARKERS[marker].glyph : '',
  srLabel: marker ? MARKERS[marker].name : '',
  text,
})

const ROWS: readonly RowSpec[] = [
  {
    label: 'Trademark registers',
    // A quick screen's register axis is a COUNT (Stage 0.5) and not a search: it fetches no records
    // and reads none. Calling both "searched" would sell the count as the sweep.
    cell: (l) => (isClearance(l)
      ? cell('full', 'Searched')
      : has(l, 'registerProbe') ? cell('partial', 'Filing counts only') : cell('absent', 'Not searched')),
  },
  {
    label: 'Marketplace & common-law',
    // A knockout IS the marketplace product — what it lacks is the grid's structure, not the coverage.
    // The `absent` arm is unreachable from today's payload: the one clearance that dropped the grid was
    // retired and the menu is built from the orderable registry. It stays because this table
    // renders whatever the server sends, and inventing coverage for a level it does not recognise is the
    // one thing a coverage table must never do.
    //
    // THE KNOCKOUT CELL IS `full`, AND A REVIEWER WILL WANT `partial`. It must not be. Reading
    // `commonLawGrid: false` on a knockout as "does not search marketplaces" is precisely the
    // 2026-07-21 composer off-by-one that routed 20-name knockout requests into one-name clearances at
    // roughly twenty times the cost. `partial` would re-encode that bug as a glyph. The structural
    // difference between a sweep and a grid lives in the TEXT, which is where it belongs.
    cell: (l) => (l.pipeline === 'knockout'
      ? cell('full', 'One broad sweep per name')
      : has(l, 'commonLawGrid')
        ? cell('full', 'Full grid — every shop, term by term')
        : cell('absent', 'Not searched')),
  },
  {
    label: 'Native language',
    // Transliteration is standard on every clearance and is not the toggle. What the investigation buys
    // is the native marketplaces and native registers, so a clearance without it is `partial` (the mark
    // IS searched in the scripts its territories register in) and never `absent`. THREE states,
    // because the offering has three: automatic here, a choice there, not sold at all on the other two.
    cell: (l) => (l.nativeLanguage === 'automatic'
      ? cell('full', 'Runs automatically — native registers and shops in that country’s language')
      : l.nativeLanguage === 'offered'
        ? cell('optional', 'Optional — the one thing on this list you choose')
        : isClearance(l)
          ? cell('partial', 'Transliteration only (the scripts its territories register in)')
          : cell('absent', 'Not included')),
  },
  {
    label: 'Case law',
    // `full` or `absent`, and NEVER `optional`. It used to read "Optional — one country per deep dive"
    // on every clearance, which was the truth about a LEVER: case law was a flag you added. It is a
    // PRODUCT now, so on the one search that carries it the answer is "yes, that is what this is", and
    // everywhere else it is "not sold here" — which is a different sentence from "you did not tick it".
    cell: (l) => (l.caseLaw
      ? cell('full', 'The case-law and opposition reading — this is the search that carries it')
      : cell('absent', 'Not part of this search')),
  },
  {
    label: 'Where it looks',
    // STRAIGHT FROM THE OFFERING. The geography is the other half of what distinguishes these four, and
    // a table that compared machinery while staying silent about where each one points was comparing
    // half the product. No marker: it is a statement, not a coverage claim.
    cell: (l) => cell(null, l.geography || UNSTATED),
  },
  {
    label: 'Names per search',
    // No marker: a marker on a quantity means nothing, and a glyph column that is sometimes a claim and
    // sometimes decoration is worse than no glyph at all. The figure is the SERVER'S, so this cell can
    // never promise a count the wall does not enforce.
    cell: (l) => cell(null, String(l.maxNames)),
  },
  {
    label: 'Turnaround',
    // "from", because this is the product's FLOOR and not a quote: a single-territory dig and a native
    // lane each add to it, and a bare figure here would read as the whole answer. The composer's footer
    // carries the computed one for the search actually being built.
    cell: (l) => cell(null, l.baseTurnaround ? `from ${l.baseTurnaround}` : UNSTATED),
  },
]

/**
 * The table, for whatever depths this deployment returned.
 *
 * Total: an empty payload produces empty columns and rows with empty cell lists rather than throwing —
 * a composer whose depth menu came back thin still has a form to fill in, and the caller renders
 * nothing. Columns are ordered by EFFORT (see byEffort), not by the payload's own registry order.
 */
/**
 * LIGHT TO HEAVY, not the registry's own order — a deliberate departure from the payload.
 *
 * The registry once listed levels in the order they were BUILT, so the lightest clearance sat last and
 * the comparison read 0, 0.5, 1, 1.5, 1 — the shallowest clearance after the deepest one, under a number
 * that looked like a mistake. A ladder that is not in ladder order is not a ladder. The registry is in
 * ladder order now and this sort agrees with it; it stays because agreement is not the same as identity.
 *
 * Sorted on the server's own `baseTurnaroundHours` rather than on anything written here, so it stays
 * true if a level's effort changes. Stable, so the two knockouts (both 0.75) keep registry order, and a
 * level that states no turnaround sorts last rather than jumping to the front on a null.
 */
const byEffort = (products: readonly Product[]): readonly Product[] =>
  products.map((l, i) => ({ l, i }))
    .sort((a, b) => (a.l.baseTurnaroundHours ?? Infinity) - (b.l.baseTurnaroundHours ?? Infinity) || a.i - b.i)
    .map((x) => x.l)

/* — `depthRungs` lived here and is DELETED, not left unexported. It derived a
   rung per product for the selector's little bar icons, which the owner ruled out on 2026-09-03; it had
   exactly one caller and no other reason to exist. Kept, it would have been a tested, maintained
   derivation nothing renders — the shape that reads as live code to the next person to change the
   offering. `byEffort` stays: the comparison table's column order is its real consumer. */

export function productMatrix(unordered: readonly Product[], currentKey: string | null = null): ProductMatrix {
  const levels = byEffort(unordered)
  const columns: readonly MatrixColumn[] = levels.map((l) => ({
    key: l.key,
    // `|| stageLabel` is the degradation rule this file already applies to `available`: an older server
    // that sends no name gets the label rather than a blank header.
    name: l.name || l.stageLabel,
    stageLabel: l.stageLabel,
    current: currentKey != null && l.key === currentKey,
    available: l.available,
    unavailableNote: l.available ? null : l.unavailableNote,
  }))
  return {
    columns,
    rows: ROWS.map((r) => ({ label: r.label, cells: levels.map((l) => r.cell(l)) })),
  }
}
