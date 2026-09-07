// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The Status column says what happened, and says nothing about where.
//
// The string this replaces was rendered verbatim on the page a client or a partner lands on:
//
//   Stopped at common-law-half:b. invalid_file:prelim-search/tmpe2er1-vibrante-frostplum/
//   2026-08-02-fixture/common-law-findings.half-b.md:connotation_undisposed:VIBRANTE …
//
// So these are written as breaches: each names something that must not be able to reach a rendered
// status, and asserts it cannot.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { readableFailure, STAGE_PHRASE } from '../src/contract/failure.ts'

// The string measured on the test instance, 2026-08-02, with its run codename replaced by `fixture` —
// no-client-identifiers.test.mjs refuses a real generator codename in the repo, and caught this one.
// Every SHAPE that matters is intact: the temp dir, the path, the file name, the error enum, the inner
// reason token and the trailing search queries. Not an invention: a mapping written against a made-up
// failure certifies the mapping rather than the fix.
const REAL_STAGE = 'common-law-half:b'
const REAL_REASON =
  'invalid_file:prelim-search/tmpe2er1-vibrante-frostplum/2026-08-02-fixture/common-law-findings.half-b.md:connotation_undisposed:VIBRANTE FROSTPLUM urban dictionary,FROSTPLUM meaning slang,FR'

test('the measured failure reads as a status a lawyer can act on', () => {
  const f = readableFailure(REAL_STAGE, REAL_REASON)
  assert.equal(f.headline, 'Not finished — stopped during the common-law search. It cannot be resumed from here.')
  assert.equal(f.detail, 'A step produced a result that did not pass its own checks.')
  assert.equal(f.raw, REAL_REASON, 'the engine\'s own words survive, for the disclosure — never paraphrased')
})

test('NO PATH, TEMP DIR, RUN SLUG, STAGE ID, FILE NAME OR ERROR ENUM reaches a rendered line', () => {
  // The rule from the issue, stated as a property over the whole cell rather than the one observed row.
  const cases: [string | null, string | null][] = [
    [REAL_STAGE, REAL_REASON],
    ['register-unit:primary-sweep', 'timeout'],
    ['synthesis', 'nonzero_exit_137'],
    ['report-card:4', 'missing_file:_driver/senior-rights.json'],
    ['register-digest', 'unparseable_json'],
    ['common-law', 'lane_wedge'],
    ['frame-diff', 'status_429'],
    ['notify', 'embedded_fallback'],
    // an unrecognised token carrying a path — the case a narrow mapping would leak
    ['synthesis', 'coverage_ledger_unparseable:prelim-search/tmpxx-mark/2026-08-02-fixture/grid.json'],
    [null, 'invalid_file:a/b.md:x'],
  ]
  for (const [stage, reason] of cases) {
    const f = readableFailure(stage, reason)
    const rendered = `${f.headline} ${f.detail ?? ''}`
    assert.doesNotMatch(rendered, /[/\\]/, `a path reached the status: ${rendered}`)
    assert.doesNotMatch(rendered, /\.(md|json|html|jsonl|xlsx)\b/, `a file name reached the status: ${rendered}`)
    assert.doesNotMatch(rendered, /\btmp[a-z0-9]/i, `a temp directory reached the status: ${rendered}`)
    assert.doesNotMatch(rendered, /invalid_file|missing_file|unparseable_json|lane_wedge|nonzero_exit|embedded_fallback|status_\d/, `an error enum reached the status: ${rendered}`)
    assert.doesNotMatch(rendered, /common-law-half|register-unit|report-card|frame-diff|register-digest|narrative-refutation/, `a stage id reached the status: ${rendered}`)
    assert.doesNotMatch(rendered, /:/, `a colon-joined internal token reached the status: ${rendered}`)
  }
})

test('NOTHING IS TRUNCATED — the issue rejects an ellipsis, which hides the problem rather than fixing it', () => {
  const f = readableFailure(REAL_STAGE, REAL_REASON)
  assert.doesNotMatch(f.headline, /…|\.\.\./)
  assert.doesNotMatch(f.detail ?? '', /…|\.\.\./)
  assert.equal(f.raw, REAL_REASON, 'and the raw value is kept WHOLE for the disclosure')
})

test('THE MAPPING IS NOT SPECIAL-CASED TO ONE ROW: every stage the engine has produces a phrase', () => {
  // The issue: "it should cover the failure modes the pipeline can actually produce, and if you cannot
  // enumerate them from the code, say so rather than special-casing this row."
  //
  // The stages CAN be enumerated. driver/stages.mjs exports STAGES, and STAGE_ORDER ∪
  // STAGE_ORDER_EXCLUDED is asserted to be a closed partition of its keys. This is that bijection again,
  // over the phrase table — so a stage added to the engine without a phrase fails HERE, rather than
  // leaking its id onto a client-facing page.
  //
  // Source-text, because portal-ui cannot import a driver .mjs into its type-stripped test runner.
  const src = readFileSync(fileURLToPath(new URL('../../driver/stages.mjs', import.meta.url)), 'utf8')
  // To the NEXT top-level export, not to the first `\n};` — the stage bodies contain nested objects that
  // close the same way, and a non-greedy match stops at the first of those with no sign it did.
  const from = src.indexOf('export const STAGES = {')
  assert.ok(from >= 0, 'STAGES not found in driver/stages.mjs — this guard needs updating with it')
  const to = src.indexOf('\nexport ', from + 10)
  const block = src.slice(from, to > 0 ? to : undefined)
  // Both key forms: a hyphenated stage needs quotes, a bare word does not, and three of the sixteen
  // are bare. Matching only the quoted form silently found 13 and read as a passing guard.
  //
  // 19 -> 16: the three send stages left with the delivery mode that was their only caller.
  // The floor moves with the population or it stops being a measurement — but note what it is FOR: it
  // catches a truncated PARSE, not a shrinking engine. The bijection below is what catches a stage
  // arriving without a phrase.
  const stages = [...block.matchAll(/^ {2}"?([a-z0-9-]+)"?: \{/gm)].map((m) => m[1])
  assert.ok(stages.length >= 16, `the stage list looks truncated: ${stages.length} found`)

  const phrased = Object.keys(STAGE_PHRASE)
  assert.deepEqual(stages.filter((s) => !phrased.includes(s)), [],
    'a stage the engine can stop in has no reader phrase — its id would render on a client-facing page')
  assert.deepEqual(phrased.filter((p) => !stages.includes(p)), [],
    'a phrase names a stage the engine no longer has — the table has rotted')
})

test('an axis suffix is an internal coordinate and never renders', () => {
  // `common-law-half:b` is a grid half; `report-card:1` is a finding ordinal. Neither is something a
  // reader can act on, and both are stage-id shaped.
  assert.equal(readableFailure('common-law-half:b', null).headline, readableFailure('common-law-half', null).headline)
  assert.equal(readableFailure('report-card:12', null).headline, 'Not finished — stopped while writing the report. It cannot be resumed from here.')
})

test('an unrecognised reason falls back to the engine\'s words ONLY when they are safe to render', () => {
  // A validator added tomorrow mints a token this table has never seen — the inner reason space is open
  // by construction (61 fail() sites in verify.mjs, no central constant). The fallback must not become a
  // hole in the path rule.
  const safe = readableFailure('synthesis', 'the register provider returned no results for three retries')
  assert.equal(safe.detail, 'the register provider returned no results for three retries')

  const unsafe = readableFailure('synthesis', 'weird_new_token:prelim-search/tmpzz/2026-08-02-x/grid.json')
  assert.equal(unsafe.detail, null, 'a path-carrying unknown goes behind the disclosure, not onto the row')
  assert.equal(unsafe.raw, 'weird_new_token:prelim-search/tmpzz/2026-08-02-x/grid.json', 'but is not lost')

  const huge = readableFailure('synthesis', 'x'.repeat(200))
  assert.equal(huge.detail, null, 'and neither does something long enough to size the column')
})

test('no stage and no reason still reads as a status, never as a blank or a crash', () => {
  // The cannot-resume sentence is the part a reader ACTS on, so it survives the case where
  // nothing else is known. A bare 'Not finished' would leave them waiting on a run that is over.
  const BARE = 'Not finished. It cannot be resumed from here.'
  assert.deepEqual(readableFailure(null, null), { headline: BARE, detail: null, raw: null })
  assert.deepEqual(readableFailure(undefined, '   '), { headline: BARE, detail: null, raw: null })
  assert.equal(readableFailure('a-stage-that-does-not-exist', 'timeout').headline, BARE,
    'an unknown stage degrades to the bare status rather than printing its own id')
})
