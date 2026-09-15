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
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  engineRowFaults, engineNotice, engineRow, billingRefusalSentence, type EngineFacts, type BillingRefusal,
} from '../src/contract/engineState.ts'
import { api } from '../src/contract/api.ts'

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

/** A refusal as the driver sends it: subscription, with Microsoft Azure's switch left on. */
const SWITCH_BESIDE_SUBSCRIPTION: BillingRefusal = {
  kind: 'switch-beside-mode', mode: 'subscription', setting: 'CLEAROTRON_AI_BILLING',
  clouds: [{ name: 'Microsoft Azure', setting: 'CLAUDE_CODE_USE_FOUNDRY' }],
  modes: [], gateway: null, engineSetting: null, engineChoice: null,
}

/** Both screens, from one reading. The only place either answer is produced in this file. */
const surfaces = (r: Reading) => ({
  row: engineRowFaults(r.engine, { programDisputed: r.engineProgramDisputed === true }),
  notice: engineNotice({ programDisputed: r.engineProgramDisputed }),
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
  // SETUP INSTALLS THE PROGRAM NOW, so the row names setup, by the one command every install can run: this
  // page cannot know how its reader installed, and `npm run setup` exists only in a source checkout.
  assert.match(sentence, /Run the setup wizard, `npx clearotron install`: it offers to install the program/,
    'the row does not name the setup command that installs the program')
  assert.doesNotMatch(sentence, /npm install -g|re-reads its PATH|where the service can see it|the CLI\b/,
    'the row still gives the hand install, or the restart for PATH, from before setup installed the program')
  // Setup writes Clearotron's settings file, which services in the background do not read, so "asks how it
  // is paid for" is true only on some machines, and it is not this fault.
  assert.doesNotMatch(sentence, /paid for/, 'the missing-program row promises what setup does about payment')
  assert.match(sentence, /restart/i, 'the row does not say a restart is what makes the install visible')
  for (const route of ['packaged', 'checkout'] as const) {
    const one = engineRowFaults({ ...reading.engine, setupRoute: route }).join(' ')
    assert.ok(one.includes('Run the setup wizard, `npx clearotron install`:'), `${route}: ${one}`)
    assert.ok(!one.includes('npm run setup'), `${route}: a command that exists only in a source checkout, on a page any reader may open`)
  }

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

// The link to the configuration page is NOT decided here, and the arm that used to live at this spot
// went with the field it tested. `linksToSettings` always equalled the argument it was handed, so an arm
// over it asserted that an assignment assigns. Who sees that control is decided at the call site, which
// passes no handler to a reader who cannot open the page — held by the navigation arm, which reds on the
// gate omitted, inverted, or written across two lines, and driven in a real browser for both roles.

test('the row is green exactly when it has no fault — the relation, over every combination', () => {
  // The property that stops a condition being added without a sentence, or a sentence without a
  // condition. Driven over the closed set rather than asserted about one case.
  // A refusal reason is one more input to the relation, and the one a green row would hide worst: every
  // search refused under a row that says nothing. A kind this build does not name is in the set on purpose.
  const REASONS: readonly (BillingRefusal | null)[] = [null, SWITCH_BESIDE_SUBSCRIPTION, { ...SWITCH_BESIDE_SUBSCRIPTION, kind: 'a-kind-from-a-later-release' }]
  for (const known of [true, false]) {
    for (const binaryPresent of [true, false]) {
      for (const missing of [[], ['ANTHROPIC_API_KEY']]) {
        for (const reason of REASONS) {
          for (const disputed of [true, false]) {
            const faults = engineRowFaults(
              { ...ANTHROPIC, known, binaryPresent, billing: { apiBilled: missing.length > 0, missing, reason } },
              { programDisputed: disputed })
            const shouldBeClean = known && binaryPresent && missing.length === 0 && reason === null && !disputed
            const at = `known=${known} present=${binaryPresent} missing=${missing.length} reason=${reason?.kind ?? null} disputed=${disputed}`
            assert.equal(faults.length === 0, shouldBeClean, `${at} -> ${JSON.stringify(faults)}`)
            for (const f of faults) assert.ok(f.trim().length > 0, 'a blank fault reached the row')
            // ONE BILLING SENTENCE, NEVER TWO: a missing key is named, and a refusal only where no key is missing.
            const billingSentences = faults.filter((f) => /^Set to bill an API key|^Searches will be refused/.test(f))
            assert.equal(billingSentences.length, missing.length || reason ? 1 : 0, `${at} -> ${JSON.stringify(faults)}`)
          }
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

// ── what pays, and a billing setting that refuses every search ──────────────────────────────────────
//
// DRIVEN FROM THE DRIVER'S OWN INVENTORY, not from a fixture of what it is believed to send. Each state
// below is an environment handed to `engineInventory`, the capture built from it the way the live posture
// is, the config view the route serves, the JSON a browser receives, the portal's own decoder, and the row.
// A field dropped at any of those hops turns a state back into the word or the silence it had before.

/** The config route's answer for one environment, decoded by the portal exactly as the page decodes it. */
async function rowFromEnvironment(env: Record<string, string>, opts: { readonly programDisputed?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'engine-row-'))
  // The driver's configuration module reads its settings when it loads, and its pool default is a real
  // archive, so both are pinned before anything imports it.
  const { pinEnv } = await import('../../shared/env-aliases.mjs')
  pinEnv(process.env, 'CLEAROTRON_REPORTS_DIR', join(root, 'pool'))
  pinEnv(process.env, 'CLEAROTRON_WORK_DIR', join(root, 'work'))
  pinEnv(process.env, 'CLEAROTRON_DATABASE', 'corsearch')
  delete process.env['CLEAROTRON_MCP_URL']
  const { engineInventory } = await import('../../driver/config-inventory.mjs')
  const { buildFlagSnapshot } = await import('../../driver/flag-snapshot.mjs')
  const { flagView } = await import('../../driver/portal-config-view.mjs')
  const live = buildFlagSnapshot({}, { capturedAt: new Date().toISOString(), engine: engineInventory(env), providers: [] })
  const wire = JSON.parse(JSON.stringify(flagView(root, { live }))) as Record<string, any>
  return { wire, row: await decodedRow(wire, opts) }
}

/** The portal's own decoder over one response body, then the row the page draws from it. */
async function decodedRow(wire: unknown, opts: { readonly programDisputed?: boolean } = {}) {
  const original = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify(wire), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch
  try {
    const got = await api.adminConfig()
    assert.equal(got.kind, 'ok', JSON.stringify(got))
    if (got.kind !== 'ok' || !got.value.engine) throw new Error('the config view decoded to no engine')
    return engineRow(got.value.engine, opts)
  } finally {
    globalThis.fetch = original
  }
}

// A program both engines can find, so the only thing each state below changes is how the machine pays.
const HERE = { CLEAROTRON_CLAUDE_PATH: process.execPath, CLEAROTRON_CODEX_PATH: process.execPath, PATH: '' }
const CLAUDE = { ...HERE, CLEAROTRON_AI: 'anthropic-agent' }
const CODEX = { ...HERE, CLEAROTRON_AI: 'openai-agent' }

const BILLING_STATES: readonly { readonly name: string; readonly env: Record<string, string>; readonly state: string; readonly fault: string | null }[] = [
  { name: 'subscription', env: CLAUDE, state: 'Subscription', fault: null },
  { name: 'an API key that is set', env: { ...CLAUDE, CLEAROTRON_AI_BILLING: 'api-key', ANTHROPIC_API_KEY: 'sk-x' }, state: 'API key', fault: null },
  { name: 'an API key that is not set', env: { ...CLAUDE, CLEAROTRON_AI_BILLING: 'api-key' }, state: 'Refused',
    fault: 'Set to bill an API key, and ANTHROPIC_API_KEY is not set — a run is refused rather than billed to the subscription.' },
  { name: 'Google Cloud', env: { ...CLAUDE, CLEAROTRON_AI_BILLING: 'cloud', CLAUDE_CODE_USE_VERTEX: '1' }, state: 'Google Cloud', fault: null },
  { name: 'Microsoft Azure', env: { ...CLAUDE, CLEAROTRON_AI_BILLING: 'cloud', CLAUDE_CODE_USE_FOUNDRY: '1' }, state: 'Microsoft Azure', fault: null },
  { name: 'Amazon Bedrock', env: { ...CLAUDE, CLEAROTRON_AI_BILLING: 'cloud', CLAUDE_CODE_USE_BEDROCK: '1' }, state: 'Amazon Bedrock', fault: null },
  { name: 'a gateway', env: { ...CLAUDE, CLEAROTRON_AI_BILLING: 'cloud', ANTHROPIC_BASE_URL: 'https://gateway.test' }, state: 'Gateway', fault: null },
  { name: 'a cloud switch beside subscription', env: { ...CLAUDE, CLEAROTRON_AI_BILLING: 'subscription', CLAUDE_CODE_USE_FOUNDRY: '1' }, state: 'Refused',
    fault: 'Searches will be refused: payment is set to subscription, but the Microsoft Azure switch (CLAUDE_CODE_USE_FOUNDRY) is also on. '
      + 'Turn CLAUDE_CODE_USE_FOUNDRY off to pay by subscription, or set CLEAROTRON_AI_BILLING to cloud to pay through Microsoft Azure.' },
  { name: 'a cloud switch beside an API key', env: { ...CLAUDE, CLEAROTRON_AI_BILLING: 'api-key', ANTHROPIC_API_KEY: 'sk-x', CLAUDE_CODE_USE_BEDROCK: '1' }, state: 'Refused',
    fault: 'Searches will be refused: payment is set to an API key, but the Amazon Bedrock switch (CLAUDE_CODE_USE_BEDROCK) is also on. '
      + 'Turn CLAUDE_CODE_USE_BEDROCK off to pay with the API key, or set CLEAROTRON_AI_BILLING to cloud to pay through Amazon Bedrock.' },
  // THE BILLING WORD UNSET, the state measured on Foundry: the subscription is the default, not a line in
  // the settings file, and the sentence must not send a reader looking for one.
  { name: 'two cloud switches, the billing word unset', env: { ...CLAUDE, CLAUDE_CODE_USE_VERTEX: '1', CLAUDE_CODE_USE_BEDROCK: '1' }, state: 'Refused',
    fault: 'Searches will be refused: payment is by subscription, the default while CLEAROTRON_AI_BILLING is not set, but the Google Cloud and Amazon Bedrock switches (CLAUDE_CODE_USE_VERTEX and CLAUDE_CODE_USE_BEDROCK) are also on. '
      + 'Turn them off to pay by subscription, or set CLEAROTRON_AI_BILLING to cloud and leave one on.' },
  { name: 'one cloud switch, the billing word unset', env: { ...CLAUDE, CLAUDE_CODE_USE_FOUNDRY: '1' }, state: 'Refused',
    fault: 'Searches will be refused: payment is by subscription, the default while CLEAROTRON_AI_BILLING is not set, but the Microsoft Azure switch (CLAUDE_CODE_USE_FOUNDRY) is also on. '
      + 'Turn CLAUDE_CODE_USE_FOUNDRY off to pay by subscription, or set CLEAROTRON_AI_BILLING to cloud to pay through Microsoft Azure.' },
  { name: 'a cloud account with two clouds on', env: { ...CLAUDE, CLEAROTRON_AI_BILLING: 'cloud', CLAUDE_CODE_USE_VERTEX: '1', CLAUDE_CODE_USE_FOUNDRY: '1' }, state: 'Refused',
    fault: 'Searches will be refused: payment is set to a cloud account, but two clouds are switched on, Google Cloud (CLAUDE_CODE_USE_VERTEX) and Microsoft Azure (CLAUDE_CODE_USE_FOUNDRY). '
      + 'Turn off all but the one you pay through.' },
  { name: 'a cloud account with all three clouds on', env: { ...CLAUDE, CLEAROTRON_AI_BILLING: 'cloud', CLAUDE_CODE_USE_VERTEX: '1', CLAUDE_CODE_USE_FOUNDRY: '1', CLAUDE_CODE_USE_BEDROCK: '1' }, state: 'Refused',
    fault: 'Searches will be refused: payment is set to a cloud account, but three clouds are switched on, Google Cloud (CLAUDE_CODE_USE_VERTEX), Microsoft Azure (CLAUDE_CODE_USE_FOUNDRY) and Amazon Bedrock (CLAUDE_CODE_USE_BEDROCK). '
      + 'Turn off all but the one you pay through.' },
  { name: 'a cloud account with no cloud chosen', env: { ...CLAUDE, CLEAROTRON_AI_BILLING: 'cloud' }, state: 'Refused',
    fault: "Searches will be refused: payment is set to a cloud account, but no cloud is chosen. Turn on your cloud's switch "
      + '(CLAUDE_CODE_USE_VERTEX for Google Cloud, CLAUDE_CODE_USE_FOUNDRY for Microsoft Azure or CLAUDE_CODE_USE_BEDROCK for Amazon Bedrock) '
      + 'with the settings that cloud needs, set ANTHROPIC_BASE_URL for a gateway, or set CLEAROTRON_AI_BILLING to subscription.' },
  { name: 'a payment word Clearotron does not know', env: { ...CLAUDE, CLEAROTRON_AI_BILLING: 'subscriptoin' }, state: 'Refused',
    fault: 'Searches will be refused: CLEAROTRON_AI_BILLING is set to a word Clearotron does not know. Set it to subscription, api-key or cloud.' },
  { name: 'Codex on subscription', env: CODEX, state: 'Subscription', fault: null },
  { name: 'Codex on an API key that is set', env: { ...CODEX, CLEAROTRON_AI_BILLING: 'api-key', CODEX_API_KEY: 'k' }, state: 'API key', fault: null },
  { name: 'Codex on an API key that is not set', env: { ...CODEX, CLEAROTRON_AI_BILLING: 'api-key' }, state: 'Refused',
    fault: 'Set to bill an API key, and CODEX_API_KEY is not set — a run is refused rather than billed to the subscription.' },
  { name: 'Codex on a cloud account', env: { ...CODEX, CLEAROTRON_AI_BILLING: 'cloud', CLAUDE_CODE_USE_FOUNDRY: '1' }, state: 'Refused',
    fault: 'Searches will be refused: payment is set to a cloud account, which pays only for Claude, and this machine runs the Codex engine. '
      + 'Set CLEAROTRON_AI_BILLING to subscription or api-key, or set CLEAROTRON_AI to anthropic-agent to pay for Claude through your cloud.' },
  // THE SECOND WAY OUT ONLY WHERE IT LEADS OUT. With no cloud chosen, or two, the Claude engine would refuse
  // too, so the sentence stops at the one change that works.
  { name: 'Codex on a cloud account with no cloud chosen', env: { ...CODEX, CLEAROTRON_AI_BILLING: 'cloud' }, state: 'Refused',
    fault: 'Searches will be refused: payment is set to a cloud account, which pays only for Claude, and this machine runs the Codex engine. '
      + 'Set CLEAROTRON_AI_BILLING to subscription or api-key.' },
  { name: 'Codex on a cloud account with two clouds on', env: { ...CODEX, CLEAROTRON_AI_BILLING: 'cloud', CLAUDE_CODE_USE_VERTEX: '1', CLAUDE_CODE_USE_BEDROCK: '1' }, state: 'Refused',
    fault: 'Searches will be refused: payment is set to a cloud account, which pays only for Claude, and this machine runs the Codex engine. '
      + 'Set CLEAROTRON_AI_BILLING to subscription or api-key.' },
  { name: 'Codex on a payment word it does not know', env: { ...CODEX, CLEAROTRON_AI_BILLING: 'subscriptoin' }, state: 'Refused',
    fault: 'Searches will be refused: CLEAROTRON_AI_BILLING is set to a word Clearotron does not know. Set it to subscription or api-key.' },
]

test('from the driver to the row: the state word names what pays, and a refused billing setting is red with one sentence', async () => {
  for (const s of BILLING_STATES) {
    const { row } = await rowFromEnvironment(s.env)
    assert.equal(row.state, s.state, `${s.name}: the state word`)
    assert.deepEqual(row.faults, s.fault ? [s.fault] : [], `${s.name}: the row's sentences`)
    assert.equal(row.ok, s.fault === null, `${s.name}: ${s.fault ? 'green while every search is refused' : 'red with nothing wrong'}`)
  }
  // A refusal the driver names by a kind this build does not know is still red, with a sentence.
  assert.equal(billingRefusalSentence({ ...SWITCH_BESIDE_SUBSCRIPTION, kind: 'a-kind-from-a-later-release' }),
    'Searches will be refused over how this machine is set to pay. Check CLEAROTRON_AI_BILLING and the settings beside it.')
})

test('from the driver to the row: a missing program names the setup command every install can run, and a disputed one the setting for its path', async () => {
  // THE PROGRAM IS NAMED BY A PATH THAT DOES NOT EXIST, so it is missing on any machine: a path setting
  // that is set is not second-guessed by a copy setup installed.
  const nowhere = join(mkdtempSync(join(tmpdir(), 'no-program-')), 'not-here')
  for (const [id, setting] of [['anthropic-agent', 'CLEAROTRON_CLAUDE_PATH'], ['openai-agent', 'CLEAROTRON_CODEX_PATH']] as const) {
    const { wire, row } = await rowFromEnvironment({ CLEAROTRON_AI: id, [setting]: nowhere, PATH: '' })
    const route = wire['engine']['setupRoute']
    assert.ok(route === 'packaged' || route === 'checkout', `${id}: the service sent no route word: ${route}`)
    assert.equal(wire['engine']['programSetting'], setting, `${id}: the service names another setting`)
    const text = row.faults.join(' ')
    assert.equal(row.ok, false, `${id}: green with no program`)
    assert.ok(text.includes('Run the setup wizard, `npx clearotron install`:'), `${id}: the row does not name the setup command: ${text}`)
    assert.ok(!text.includes('npm run setup'),
      `${id}: the row names a command that exists only in a source checkout, on a page any reader may open: ${text}`)

    // THE PROGRAM FOUND HERE AND NOT BY THE ENGINE: the row names the setting that holds its full path.
    const disputed = await rowFromEnvironment({ ...HERE, CLEAROTRON_AI: id }, { programDisputed: true })
    const said = disputed.row.faults.join(' ')
    assert.ok(said.includes(`set ${setting} to the program's full path`), `${id}: the disputed row does not name ${setting}: ${said}`)
  }
})

test('a reason of a shape this build cannot read still turns the row red', async () => {
  // Only an absent reason is a green one. A string or a list is a service saying something about a refusal
  // this build cannot read, and drawing that green would hide every search being refused.
  const { wire } = await rowFromEnvironment(CLAUDE)
  for (const odd of ['a sentence', [], 7, true]) {
    const w = structuredClone(wire)
    w['engine']['billing']['reason'] = odd
    const row = await decodedRow(w)
    assert.equal(row.ok, false, `a reason of ${JSON.stringify(odd)} drew a green row`)
    assert.deepEqual(row.faults,
      ['Searches will be refused over how this machine is set to pay. Check the billing setting and the settings beside it.'],
      JSON.stringify(odd))
  }
  // A cloud this build has no name for is dropped by the decoder, and the sentence then names no cloud
  // rather than "the  switches ()".
  const w = structuredClone(wire)
  w['engine']['billing']['reason'] = { ...SWITCH_BESIDE_SUBSCRIPTION, clouds: [{ name: null, setting: 'CLAUDE_CODE_USE_NEWCLOUD' }] }
  assert.deepEqual((await decodedRow(w)).faults,
    ['Searches will be refused over how this machine is set to pay. Check CLEAROTRON_AI_BILLING and the settings beside it.'])
})

test('a refusal sentence names no cloud it was not sent, and prints no code for a mode named like an object key', () => {
  for (const kind of ['switch-beside-mode', 'two-clouds', 'no-cloud']) {
    const said = billingRefusalSentence({ ...SWITCH_BESIDE_SUBSCRIPTION, kind, clouds: [] })
    assert.equal(said, 'Searches will be refused over how this machine is set to pay. Check CLEAROTRON_AI_BILLING and the settings beside it.', kind)
  }
  for (const mode of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    const said = billingRefusalSentence({ ...SWITCH_BESIDE_SUBSCRIPTION, mode })
    assert.doesNotMatch(said, /function|native code|\[object/, `${mode}: ${said}`)
    assert.ok(said.includes(`payment is set to ${mode},`), `${mode}: ${said}`)
  }
})

// The one change an older service's row does see: a key that is not set reads "Refused", not "Subscription",
// beside the sentence saying a run is refused rather than billed to the subscription.
test('an older service, which sends no cloud and no reason, draws the row as before, a missing key reading Refused', async () => {
  const older = (wire: Record<string, any>) => {
    const w = structuredClone(wire)
    for (const k of ['cloud', 'cloudName', 'reason', 'refusal']) delete w['engine']['billing'][k]
    for (const k of ['programSetting', 'setupRoute']) delete w['engine'][k]
    return w
  }
  /** The row as it was drawn before the driver sent any of these fields. */
  const before = (billing: { apiBilled: boolean; missing: string[] }, id: string, vendor: string) => ({
    ok: billing.missing.length === 0, name: vendor, mono: id,
    state: billing.missing.length ? 'Refused' : billing.apiBilled ? 'API key' : 'Subscription',
    faults: billing.missing.length
      ? [`Set to bill an API key, and ${billing.missing.join(' and ')} is not set — a run is refused rather than billed to the subscription.`]
      : [],
  })
  for (const s of BILLING_STATES) {
    const { wire } = await rowFromEnvironment(s.env)
    const e = wire['engine']
    assert.deepEqual(await decodedRow(older(wire)), before(e['billing'], e['id'], e['vendor']), s.name)
  }
})
