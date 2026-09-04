// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// THE PARITY PIN between the browser's block grammar and the engine's.
//
// `shared/summary-blocks.mjs` is the definition; `src/contract/summaryBlocks.ts` is a mirror, because the
// portal bundle does not import from the driver tree. A mirror with no pin is two implementations that
// drift silently — every copy still parses something, so nothing fails. This file is the join: it feeds
// BOTH the same inputs and compares block-for-block.
//
// The cases are chosen to discriminate, not to pass. Each one is a shape that a plausible re-write of
// either side gets wrong: depth other than two, the `*` bullet spelling, a bullet interrupting prose, a
// heading with no blank line before it, leading whitespace, and the H1 that must NOT be read as a block.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSummaryBlocks, SUMMARY_BLOCK_LINE } from '../src/contract/summaryBlocks.ts'
import {
  parseSummaryBlocks as enginePar,
  SUMMARY_BLOCK_LINE as engineLine,
} from '../../shared/summary-blocks.mjs'

const CASES: readonly (readonly [string, string])[] = [
  ['plain prose, wrapped', 'CORAL FREEZE rates Medium.\nThe field is crowded.'],
  ['h2 then bullets', '## CORAL FREEZE — Medium\n- crowded field\n- no dominant enforcer'],
  ['h3 and h4, deeper than the common case', '### Register\nOne identical filing.\n#### Common law\nTwo sellers.'],
  ['star bullets, the other spelling', '* first point\n* second point'],
  ['a bullet interrupting prose', 'Opening line.\n- a point\nClosing line.'],
  ['leading whitespace on both markers', '  ## Indented heading\n   - indented bullet'],
  ['an H1 — parsed like any heading; the ban on writing one lives elsewhere', '# Not a sub-header\ntrailing prose'],
  ['empty', ''],
  ['bullet-looking prose that is not a bullet', 'a-b-c is not a bullet\n-nospace is not one either'],
]

test('the browser grammar and the engine grammar agree block-for-block', () => {
  for (const [name, input] of CASES) {
    assert.deepEqual(
      JSON.parse(JSON.stringify(parseSummaryBlocks(input))),
      JSON.parse(JSON.stringify(enginePar(input))),
      `block parse drifted between portal-ui and shared/ on: ${name}`,
    )
  }
})

test('the browser and the engine agree on what opens a block', () => {
  for (const [name, input] of CASES) {
    assert.equal(
      new RegExp(SUMMARY_BLOCK_LINE.source, SUMMARY_BLOCK_LINE.flags).test(input),
      new RegExp(engineLine.source, engineLine.flags).test(input),
      `SUMMARY_BLOCK_LINE drifted between portal-ui and shared/ on: ${name}`,
    )
  }
  // The pin that makes the two above mean something: the regex must actually DISCRIMINATE, or a rule
  // matching everything (or nothing) would satisfy every case-by-case comparison above.
  assert.equal(SUMMARY_BLOCK_LINE.test('## a heading'), true)
  assert.equal(SUMMARY_BLOCK_LINE.test('- a bullet'), true)
  assert.equal(SUMMARY_BLOCK_LINE.test('ordinary prose'), false)
  assert.equal(SUMMARY_BLOCK_LINE.test('# an H1 is parsed, and refused by the validator instead'), true)
})

test('every heading depth PARSES, so no surface can render a hash as text', () => {
  // This arm replaced its own opposite. The grammar used to refuse `#{1}`, on the reasoning that an H1
  // is not a block — and the consequence was that an H1 fell through to the prose branch and reached a
  // client page as the literal characters `# Documents`. Refusing to parse a shape does not stop it
  // arriving; it stops it being handled. The rule that an H1 must never be WRITTEN is the validator's
  // (SUMMARY_SECTION_BREAK_RE) and the doctrine's, and batchSummaryOf terminates before one gets here.
  for (const depth of [1, 2, 3, 4, 5, 6]) {
    const blocks = parseSummaryBlocks(`${'#'.repeat(depth)} A heading`)
    assert.equal(blocks.length, 1, `depth ${depth} did not parse to one block`)
    assert.equal(blocks[0]?.kind, 'heading', `depth ${depth} fell through to prose and would render a literal #`)
    assert.equal((blocks[0] as { level: number }).level, depth)
  }
})
