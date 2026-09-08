// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// engineState.test.ts — the two screens are driven from ONE reading, because agreeing is the property.
//
// ── WHAT THIS HOLDS, AND WHY IT IS ONE FILE ─────────────────────────────────────────────────────────
//
// The configuration page said the engine was fine while the search screen refused to start a search, on
// the same install at the same moment. Both were right about their own question. The reader was not
// going to get out of that, and gave up on a working product.
//
// So the property is not "each screen is correct". It is that the two AGREE, and a test that builds one
// fixture for the row and another for the notice cannot see a disagreement — it would have passed on the
// day the defect shipped. Every arm below derives both answers from a SINGLE reading object, the shape
// the server sends, so a change that moves one screen and not the other fails here.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { engineRowFaults, engineNotice, type EngineFacts } from '../src/contract/engineState.ts'

/**
 * ONE reading, as the server reports it: what the box can see now, and what the engine recorded when it
 * last started. Both screens are answered from this and from nothing else.
 */
type Reading = {
  readonly engine: EngineFacts
  /** Derived server-side from the capture. 'demo' is the state in which a search refuses. */
  readonly engineMode: 'demo' | 'engine-unproven' | null
  readonly engineProgramDisputed: boolean | null
}

const ANTHROPIC: EngineFacts = {
  id: 'anthropic-agent', known: true, binaryPresent: true,
  billing: { apiBilled: false, missing: [] },
  program: 'claude', install: 'npm install -g @anthropic-ai/claude-code',
}

/** Both screens, from one reading. The only place either answer is produced in this file. */
const surfaces = (r: Reading, { canOpenSettings = true } = {}) => ({
  row: engineRowFaults(r.engine, { programDisputed: r.engineProgramDisputed === true }),
  notice: engineNotice({ programDisputed: r.engineProgramDisputed, canOpenSettings }),
})

test('one reading, no engine program anywhere: the row is not green and names both words, and the notice takes the demo branch', () => {
  // THE FIXTURE IS SHARED ON PURPOSE. This is criterion 4 of the issue — the two screens agree — and two
  // fixtures cannot express agreement between them, only correctness of each.
  const reading: Reading = {
    engine: { ...ANTHROPIC, binaryPresent: false },
    engineMode: 'demo',
    engineProgramDisputed: false,
  }
  const { row, notice } = surfaces(reading)

  assert.ok(row.length > 0, 'the configuration row is green while no engine program can be found')
  const sentence = row.join(' ')
  assert.match(sentence, /\bclaude\b/, 'the row does not name the program the reader has to install')
  assert.match(sentence, /npm install -g @anthropic-ai\/claude-code/, 'the row does not name the install command')
  assert.match(sentence, /restart/i, 'the row does not say a restart is what makes the install visible')

  assert.equal(notice.state, 'absent', 'the search screen offered the restart remedy to a machine with no program')
  assert.ok(notice.namesSetupCommand, 'the notice drops the setup command in the state that needs it')
  assert.match(notice.after, /restart/i, 'the notice does not say the reading was taken at startup')
})

test('one reading, program on the box and the engine blind to it: both screens name THAT state and neither offers the install advice', () => {
  const reading: Reading = {
    // The live posture can see it; the engine could not when it started, which is what `demo` records.
    engine: { ...ANTHROPIC, binaryPresent: true },
    engineMode: 'demo',
    engineProgramDisputed: true,
  }
  const { row, notice } = surfaces(reading)

  assert.ok(row.length > 0, 'the row is green while a new search will refuse')
  assert.match(row.join(' '), /could not find it when it last started/,
    'the row does not name the disagreement, which is the only place the two readings meet')

  assert.equal(notice.state, 'disputed')
  assert.equal(notice.namesSetupCommand, false,
    'the setup wizard does not touch a running service PATH — naming it here is advice that cannot work')
  assert.match(notice.before, /Restart the engine service/,
    'the notice does not give the remedy that applies')

  // THE TWO SCREENS SAY THE SAME THING. Not the same words by copy — the same remedy, checked as a
  // property, because this pair is exactly where they contradicted each other.
  for (const surface of [row.join(' '), notice.headline + ' ' + notice.before]) {
    assert.match(surface, /restart/i, 'one of the two screens does not name the restart')
  }
})

test('one reading, a working engine: neither screen says anything is wrong', () => {
  const { row, notice } = surfaces({ engine: ANTHROPIC, engineMode: 'engine-unproven', engineProgramDisputed: false })
  assert.deepEqual(row, [], `a healthy engine produced faults: ${JSON.stringify(row)}`)
  // The notice is not rendered at all in this state; the screen keys that off engineMode, not off this
  // function. Asserted anyway: if it ever IS asked, it must not invent the disputed remedy.
  assert.equal(notice.state, 'absent')
})

test('a reading that could not be checked takes the general advice, never the restart remedy', () => {
  // COULD NOT LOOK IS NOT NO DISAGREEMENT. Collapsing null into false prints the missing-program remedy
  // at a reader whose program is present — the original defect arriving by another road.
  const { row, notice } = surfaces({
    engine: { ...ANTHROPIC, binaryPresent: false }, engineMode: 'demo', engineProgramDisputed: null,
  })
  assert.equal(notice.state, 'absent')
  assert.ok(notice.namesSetupCommand)
  assert.ok(!row.join(' ').includes('could not find it when it last started'),
    'an unchecked reading was rendered as a confirmed disagreement')
})

test('the row cannot name a program this build does not ship, and says the honest sentence instead', () => {
  const { row } = surfaces({
    engine: { id: 'not-an-engine', known: false, binaryPresent: false,
      billing: { apiBilled: false, missing: [] }, program: null, install: null },
    engineMode: 'demo', engineProgramDisputed: false,
  })
  const sentence = row.join(' ')
  assert.match(sentence, /does not ship an engine called not-an-engine/)
  assert.match(sentence, /The engine program cannot be found or run on this machine\./,
    'the fallback sentence is gone, so a row with no program name says nothing about the program')
  assert.ok(!/null/.test(sentence), 'a missing program name reached the reader as the word null')
})

test('a client is offered no link to a page a client cannot open', () => {
  const staff = engineNotice({ programDisputed: true, canOpenSettings: true })
  const client = engineNotice({ programDisputed: true, canOpenSettings: false })
  assert.equal(staff.linksToSettings, true)
  assert.equal(client.linksToSettings, false,
    'a client following this link lands on "the configuration cannot be read from here", which is worse than no link')
  // Everything else about the two is identical: the remedy does not depend on who is reading.
  assert.equal(staff.state, client.state)
  assert.equal(staff.headline, client.headline)
  assert.equal(staff.before, client.before)
})

test('the row is green exactly when it has no fault — the relation, over every combination', () => {
  // The property that stops a condition being added without a sentence, or a sentence without a
  // condition. Driven over the closed set rather than asserted about one case.
  for (const known of [true, false]) {
    for (const binaryPresent of [true, false]) {
      for (const missing of [[], ['ANTHROPIC_API_KEY']]) {
        for (const disputed of [true, false]) {
          const faults = engineRowFaults(
            { ...ANTHROPIC, known, binaryPresent, billing: { apiBilled: missing.length > 0, missing } },
            { programDisputed: disputed })
          const shouldBeClean = known && binaryPresent && missing.length === 0 && !disputed
          assert.equal(faults.length === 0, shouldBeClean,
            `known=${known} present=${binaryPresent} missing=${missing.length} disputed=${disputed} -> ${JSON.stringify(faults)}`)
          for (const f of faults) assert.ok(f.trim().length > 0, 'a blank fault reached the row')
        }
      }
    }
  }
})

// ── the call site ───────────────────────────────────────────────────────────────────────────────────
//
// Everything above drives the decision. None of it proves the screen ASKS — and a projection that is
// right while its caller is wrong is the same class as the defect this whole issue is about, one level
// up: a row drawn green while the data under it said otherwise.
//
// This suite cannot mount a screen. There is no jsdom, no React test renderer, and Node cannot import a
// `.tsx` at all, so the call site is held by reading the source. SAY WHAT THAT CANNOT SEE: it cannot see
// a screen that imports the function and then ignores what it returns, and it cannot see a runtime
// value. What it can see is the two shapes that would put the reader back in front of a lying row — the
// row assembled from parts, or `ok` derived a second time — and those are the two that a later edit
// reaches for.
//
// The browser arm that would close it properly is a separate check on the configuration page, filed
// rather than bolted on.
test('the configuration screen renders the shared decision whole, and derives no row state of its own', () => {
  const raw = readFileSync(new URL('../src/screens/GlobalConfig.tsx', import.meta.url), 'utf8')
  // COMMENTS ARE NOT CODE, and this arm found that out the hard way: the comment above the call site
  // quotes the old shape it replaced — `ok={faults.length === 0}` — and the negative assertion below
  // matched its own explanation. A guard that reads prose reports the description of a defect as the
  // defect. Stripped rather than reworded, because the next person writing that comment should not have
  // to know this arm exists.
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

  assert.match(src, /<Row \{\.\.\.engineRow\(/,
    'the Engine row is no longer the shared decision spread whole — if it is assembled from parts again, '
    + 'a condition can be added beside `ok` with every test above still green')

  // SCOPED TO THE ENGINE FUNCTION, and the first draft was not — it forbade `ok={faults.length === 0}`
  // across the whole file, which is how the sign-in and provider rows legitimately derive their own
  // state. They are other decisions and this arm has nothing to say about them. A guard whose scope is
  // wider than its subject reports its neighbours as defects.
  const engineFn = src.slice(src.indexOf('function Engine('))
  const engineBody = engineFn.slice(0, engineFn.indexOf('\nfunction '))
  assert.ok(engineBody.length > 0 && engineBody.length < 800,
    'the Engine function could not be isolated, so what follows asserts nothing about it')
  assert.ok(!/ok=\{/.test(engineBody),
    'the Engine row derives its own row state again — that is the second expression this change removed, '
    + 'and it is what let the row be drawn green while the faults under it said otherwise')

  assert.match(src, /from '\.\.\/contract\/engineState\.ts'/,
    'the screen no longer imports the shared decision at all')
})
