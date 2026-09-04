// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — the terminology map is enforced, not decorative.
//
// THE FAILURE THIS EXISTS FOR is the one the issue predicts for its own deliverable: "a sweep that
// shortens strings without settling the vocabulary leaves the product saying 'search', 'clearance' and
// 'search type' interchangeably, and the next sweep starts over." A map in a document decays silently.
// This reads the RETIRED column out of TERMINOLOGY.md, so the document IS the rule — edit the table and
// the suite enforces the edit.
//
// WHY THIS DOES NOT USE `uiStrings`, which was written for the same issue. That extractor is
// deliberately conservative: it drops every string carrying code punctuation, so `Saved searches{' '}`
// — the exact site this guard was written to catch — is not in its corpus at all. A guard built on it
// would be right about the rule and narrow about the population, which is the defect class this repo
// keeps re-finding. So the corpus here is comment-stripped SOURCE, wide on purpose.
//
// It costs no false positives because **every retired spelling contains a space and identifiers do
// not**: `savedSearch`, `SavedSearchRow`, `api.savedSearches` and `savedSearches.ts` cannot match. That
// is what makes the wider corpus safe, and it is a property of the table — a future retired term
// written without a space would break it, which the arms below check for rather than assume.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { FILES, readSrc, stripComments, uiStrings } from './uiStrings.ts'

/**
 * Files OUTSIDE `portal-ui/src` that assert on the product's rendered text, and therefore carry the
 * vocabulary as surely as the screens do.
 *
 * `composer-render-check.mjs:304` read `/saved searches/i.test(txt())` against the live DOM — a
 * fourteenth site, found only because CI's browser check went red on the rename. A guard scoped to
 * `src/` would have reported clean and let that break the build. Population, again.
 */
const OUTSIDE_SRC = [
  '../../scripts/composer-render-check.mjs',
  '../../scripts/home-render-check.mjs',
  '../../scripts/portal-lifecycle-check.mjs',
]

/**
 * WHITESPACE ONLY BETWEEN THE WORDS — the separator is `\s+`, never `[\s-]+`, and that is a decision
 * rather than an oversight. `saved-search` is a LIVE WIRE VALUE: `driver/enqueue-schema.mjs`'s
 * `GEOGRAPHY_ORIGINS` freezes it as a geography origin and `driver/pipeline.mjs` writes it into a job.
 * A guard that matched hyphenated forms would be one population-widening away from demanding a protocol
 * change to satisfy a copy rule, which is not a trade this map is entitled to make.
 */
const WORD_SEPARATOR = '\\s+'

const MAP = readFileSync(fileURLToPath(new URL('../TERMINOLOGY.md', import.meta.url)), 'utf8')

/**
 * The SETTLED rows, parsed out of the map's own tables. A row reads:
 *   | **Retired** | Saved search / saved searches |
 * Everything under "## OPEN" is excluded by construction — those are flagged for a ruling and this
 * guard must not enforce a term nobody has ruled on.
 */
function settledRetirements(): string[] {
  const settled = MAP.split(/^## /m).find((s) => s.startsWith('SETTLED')) ?? ''
  const out: string[] = []
  for (const m of settled.matchAll(/\|\s*\*\*Retired\*\*\s*\|([^|]+)\|/g)) {
    for (const term of m[1].split('/')) {
      const t = term.trim()
      if (t) out.push(t)
    }
  }
  return out
}

const RETIRED = settledRetirements()

test('#1441 the map has settled rows, and the guard actually read them', () => {
  // An empty parse would make every arm below assert nothing while reporting green — the vacuous pass
  // this repo has a whole census about. The parse is checked before it is trusted.
  assert.ok(RETIRED.length > 0,
    'no retired term parsed out of TERMINOLOGY.md — either the map lost its SETTLED section or the '
    + 'table shape changed and this guard is now enforcing nothing while reporting green')
  assert.ok(RETIRED.includes('Saved search'),
    `the Custom search row is the one settled ruling; parsed instead: ${JSON.stringify(RETIRED)}`)
})

test('#1441 every retired spelling carries a space, which is what makes the wide corpus safe', () => {
  // The guard scans SOURCE, not just prose. That is only safe while no retired term can collide with an
  // identifier — and identifiers have no spaces. A future single-word retirement must not be added to
  // the table without changing the corpus, so this fails rather than silently flagging `savedSearch`.
  for (const t of RETIRED) {
    assert.match(t, / /,
      `"${t}" has no space, so it would match identifiers as well as prose. Either give the row a `
      + 'multi-word spelling, or narrow this guard to the uiStrings corpus for that row.')
  }
})

test('#1441 no retired term appears in a user-visible string', () => {
  const offences: string[] = []
  for (const f of [...FILES, ...OUTSIDE_SRC]) {
    const src = stripComments(readSrc(f))
    for (const t of RETIRED) {
      // WHOLE-FILE, AND WHITESPACE-FLEXIBLE BETWEEN THE WORDS. A line-by-line pass cannot see a
      // thirteenth site that was live in this tree: JSX prose wraps, and NewClearance.tsx carried
      // "…yours to set — the saved" / "search does not fix it" across two source lines. No single line
      // held the phrase, so nothing matched, and this guard reported GREEN over a real instance. It was
      // found by an unrelated test failing on the same rename. `\s+` between the words is what closes it.
      //
      // CASE-INSENSITIVE: a term is retired in every casing. Matching the table's literal spelling is
      // how the first draft found 5 of the 12 sites it should have — the row read "Saved search / saved
      // searches", a capitalised singular beside a lowercase plural, so `Retire this saved search`
      // walked through as well.
      const pattern = t.trim().split(/\s+/)
        .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(WORD_SEPARATOR)
      for (const m of src.matchAll(new RegExp(pattern, 'gi'))) {
        const line = src.slice(0, m.index).split('\n').length
        offences.push(`${f}:${line}  ${m[0].replace(/\s+/g, ' ')}`)
      }
    }
  }
  assert.deepEqual(offences, [],
    `${offences.length} site(s) use a term TERMINOLOGY.md retires:\n  ${offences.join('\n  ')}\n\n`
    + 'The product must say one word for one concept. Either use the canonical term, or — if this site '
    + 'is genuinely a different concept — change the map, which is what this guard reads.')
})

test('#1441 a canonical term that nothing uses is dead weight, and the map must not carry one', () => {
  // The mirror of the arm above. A row retiring a word nobody says, in favour of a word nobody says,
  // passes forever and teaches the next reader that the vocabulary is settled when it is not.
  const corpus = FILES.flatMap((f) => uiStrings(f)).join('\n')
  assert.match(corpus, /Custom search/,
    'TERMINOLOGY.md declares "Custom search" canonical, and no user-visible string uses it — so either '
    + 'the ruling never landed in the UI, or the extractor stopped seeing it')
})
