// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Installation settings: one heading per provider category, the engine's own web search under Engine, and
// no administrator detail anywhere a reader of the page can see it.
//
// THE FIXTURE IS THE SERVER'S OWN OUTPUT. The rows come from the driver's inventory functions run against
// an environment with nothing configured, and cross the same decoder the page uses. A hand-written row
// would carry whatever detail its author remembered to put in; the inventory carries the detail the
// product actually writes — the variables to set, the file a sign-in writes, the README that explains it —
// so "none of it reaches the page" is asserted against the real thing, and the fixture is first shown to
// carry it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { api, isOk, type ProviderState, type Result } from '../src/contract/api.ts'
import { engineRow, engineRowFaults } from '../src/contract/engineState.ts'
import {
  CASE_LAW_GAP, KEY_NEEDED, SETUP_GUIDES, SIGN_IN_NEEDED, engineCapabilityRows, providerCategories, providerRow,
  setupGuideUrl, signInRow, splitSourceLabel, type SettingsRow,
} from '../src/contract/installationSettings.ts'
import { engineInventory, providerInventory } from '../../driver/config-inventory.mjs'
import { authView } from '../../driver/portal-config-view.mjs'
import { prose } from './support/prose.ts'

/** What a reader could see: a variable's name, a file path outside a web address, a README. */
const VARIABLE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/
const CREDENTIAL_PATH = /(?<![:\w/.])(?:~|\.{1,2})?\/[\w.-]+\/[\w./-]+|\.json\b/
const README = /README|\.md\b/i

const leaks = (text: string): string[] =>
  [VARIABLE, CREDENTIAL_PATH, README].flatMap((re) => { const m = re.exec(text); return m ? [m[0]] : [] })

const withFetch = async <T>(body: unknown, call: () => Promise<Result<T>>): Promise<Result<T>> => {
  const original = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch
  try { return await call() } finally { globalThis.fetch = original }
}

/**
 * The page's data, as the portal serves it, for an installation with nothing configured: no register key,
 * no research or search key, no case-law sign-in, an engine set to bill a key it does not have.
 */
async function servedPage() {
  const creds = mkdtempSync(join(tmpdir(), 'install-settings-creds-'))
  // One source signed in with a file that cannot be used — the state that tempts a page into quoting the file.
  mkdirSync(join(creds, 'legaldatahunter.json'))
  const env = {
    OAUTH_BRIDGE_CREDS_DIR: creds, CLEAROTRON_DATABASE: 'corsearch', CLEAROTRON_AI_BILLING: 'api-key',
    PATH: process.env['PATH'] ?? '', HOME: process.env['HOME'] ?? '',
  }
  const wire = {
    available: true, note: null, source: 'live', lastRun: null, built: null, flags: [],
    engine: { ...engineInventory(env), program: 'claude', install: 'npm install -g @anthropic-ai/claude-code' },
    providers: providerInventory(env),
    auth: authView({ mode: 'auth-proxy', oidcIssuer: 'https://login.example-firm.test/' }),
  }
  const r = await withFetch(wire, () => api.adminConfig())
  assert.ok(isOk(r), 'the served page did not decode')
  if (!isOk(r)) throw new Error('unreachable')
  return { wire, view: r.value }
}

/** Every string the page draws from the contract: headings, names, coverage, states, notes and lines. */
function drawnStrings(view: Awaited<ReturnType<typeof servedPage>>['view']): string[] {
  const rows: SettingsRow[] = []
  if (view.auth) rows.push(signInRow(view.auth))
  const engine = view.engine ? engineRow(view.engine) : null
  rows.push(...engineCapabilityRows(view.providers ?? []))
  const cats = providerCategories(view.providers ?? [])
  for (const c of cats) rows.push(...c.rows)
  return [
    ...(engine ? [engine.name, engine.mono, engine.state, ...engine.faults] : []),
    ...rows.flatMap((r) => [r.name, r.mono ?? '', r.state, ...r.faults, r.note ?? '', r.detail ?? '']),
    ...cats.flatMap((c) => [c.label, c.note ?? '']),
  ].filter(Boolean)
}

// ── acceptance: no variable name, credential path or README reference on the page ───────────────────

test('the served rows carry administrator detail — the fixture is not clean by accident', async () => {
  const { wire } = await servedPage()
  const raw = JSON.stringify(wire)
  // ANTI-VACUITY. The absence asserted below means nothing over rows that never held any detail.
  assert.match(raw, /SERPAPI_API_KEY|PERPLEXITY_API_KEY/, 'no variable name in the served rows')
  assert.match(raw, /oauth-mcp-bridge\/README\.md/, 'no README reference in the served rows')
  assert.match(raw, /courtlistener\.json/, 'no credential path in the served rows')
})

test('NOTHING THE PAGE DRAWS NAMES A VARIABLE, A CREDENTIAL PATH OR A README', async () => {
  const { view } = await servedPage()
  const drawn = drawnStrings(view)
  assert.ok(drawn.length > 20, `only ${drawn.length} strings were drawn — the page did not render its rows`)
  const found = drawn.flatMap((s) => leaks(s).map((l) => `${JSON.stringify(s)} → ${l}`))
  assert.deepEqual(found, [], 'administrator detail reached the page')
  // The issuer IS on the page, as the sign-in row's quiet line — a web address is not a credential path.
  assert.ok(drawn.includes('auth-proxy · issuer https://login.example-firm.test/'), 'the sign-in detail line is missing')
})

test('the screen draws only what the contract decides — it never reads a row\'s variables or remedy itself', () => {
  const screen = prose(readFileSync(new URL('../src/screens/GlobalConfig.tsx', import.meta.url), 'utf8'))
  assert.doesNotMatch(screen, /\.missing\b/, 'the screen reads the variables a row is missing and can print them')
  assert.doesNotMatch(screen, /\.remedy\b/, 'the screen reads a row\'s remedy, which carries paths and README steps')
  assert.match(screen, /<Row \{\.\.\.signInRow\(/, 'the sign-in row is assembled in the screen again')
  assert.match(screen, /providerCategories\(v\.providers\)/, 'the provider headings are no longer the contract\'s')
})

test('the engine row states a missing key without naming it', () => {
  const faults = engineRowFaults({
    id: 'anthropic-agent', vendor: 'Anthropic', known: true, binaryPresent: false,
    billing: { apiBilled: false, missing: ['ANTHROPIC_API_KEY'] }, program: 'claude', install: 'npm install -g @anthropic-ai/claude-code',
  })
  assert.ok(faults.length >= 2, 'the fixture must fault on both the key and the program')
  assert.deepEqual(faults.flatMap(leaks), [], `the engine row names administrator detail: ${JSON.stringify(faults)}`)
  assert.match(faults.join(' '), /no key is set/, 'the row no longer says the key is missing at all')
})

// ── the layout: three sections, one heading per category ────────────────────────────────────────────

test('Providers: four categories, each named once as a heading and never on a row', async () => {
  const { view } = await servedPage()
  const cats = providerCategories(view.providers ?? [])
  assert.deepEqual(cats.map((c) => c.label),
    ['Trademark register', 'Common-law and marketplace research', 'Open-web search', 'Case law and oppositions'])
  for (const c of cats) {
    for (const r of c.rows) {
      assert.ok(![r.name, r.mono ?? '', r.note ?? ''].some((s) => s.includes(c.label)), `"${c.label}" is repeated on the row ${r.name}`)
    }
  }
  // The engine's own web search is a capability of the engine, not an open-web provider.
  assert.ok(!cats.flatMap((c) => c.rows).some((r) => /web search/i.test(r.name)), 'the engine\'s web search is still listed as a provider')
})

test('Engine: the engine\'s own web search, in the page\'s words', async () => {
  const { view } = await servedPage()
  assert.deepEqual(engineCapabilityRows(view.providers ?? []).map((r) => [r.name, r.mono, r.state, r.note]), [
    ['The engine’s own web search', 'provided by the engine', 'Available', 'The model searches the web itself during a run.'],
  ])
})

test('Sign-in: one row, the state in its own cell, the mode and issuer beneath', async () => {
  const { view } = await servedPage()
  assert.ok(view.auth)
  const r = signInRow(view.auth)
  assert.deepEqual([r.name, r.mono, r.state, r.detail, r.faults.length],
    ['Through your organisation\'s sign-in service', null, 'Configured', 'auth-proxy · issuer https://login.example-firm.test/', 0])
})

test('each row carries a name, what it covers and a state; a row needing action a short note and a guide', async () => {
  const { view } = await servedPage()
  const rows = providerCategories(view.providers ?? []).flatMap((c) => c.rows)
  const at = (name: string) => rows.find((r) => r.name === name)
  assert.deepEqual([at('Corsearch')?.state, at('Corsearch')?.faults, at('Corsearch')?.guide], ['Missing', [KEY_NEEDED], 'register'])
  assert.deepEqual([at('SerpAPI')?.faults, at('SerpAPI')?.guide], [[KEY_NEEDED], 'research'])
  assert.deepEqual([at('CourtListener')?.mono, at('CourtListener')?.state, at('CourtListener')?.faults, at('CourtListener')?.guide],
    ['US federal case law', 'Not set up', [SIGN_IN_NEEDED], 'case-law'])
  // Signed in with a file that cannot be used: the same step again, not "set up" and not an outage.
  assert.deepEqual([at('Legal Data Hunter')?.mono, at('Legal Data Hunter')?.faults],
    ['statutes and case law, 108 countries', [SIGN_IN_NEEDED]])
  assert.deepEqual([at('EUR-Lex')?.mono, at('EUR-Lex')?.state, at('EUR-Lex')?.note, at('EUR-Lex')?.faults],
    ['EU judgments', 'Configured', 'Read by the engine itself', []])
  const boa = at('EUIPO Boards of Appeal')
  assert.deepEqual([boa?.state, boa?.off, boa?.guide], ['Not in this build', true, null], 'a source nobody can switch on offers a guide or reads as a fault')
})

test('what an unset case-law source costs is said once, under the category, and only while one is unset', async () => {
  const { view } = await servedPage()
  const caseLaw = providerCategories(view.providers ?? []).find((c) => c.key === 'caselaw')
  assert.equal(caseLaw?.note, CASE_LAW_GAP)
  assert.ok(!caseLaw?.rows.some((r) => [...r.faults, r.note ?? ''].some((s) => /case-law gap/.test(s))), 'the cost is said on a row as well')
  const allSet = (view.providers ?? []).map((p): ProviderState => (p.enrolment === 'oauth' ? { ...p, configured: true, credential: 'usable' } : p))
  assert.equal(providerCategories(allSet).find((c) => c.key === 'caselaw')?.note, null,
    '"Until these are set up" is shown over sources that are all set up')
})

test('a sign-in that could not be looked at is not called a sign-in to redo', () => {
  const unreadable: ProviderState = {
    key: 'caselaw', label: 'Case law and oppositions', provider: 'courtlistener', providerLabel: 'CourtListener (US federal case law)',
    known: true, configured: false, missing: [], remedy: 'Could not be checked: …', enrolment: 'oauth', credential: 'unreadable',
  }
  const r = providerRow(unreadable)
  assert.deepEqual([r.state, r.faults], ['Unknown', ['Could not be checked']])
})

test('a register nobody chose asks for one, and a name this build does not ship says so', () => {
  const base = { key: 'register', label: 'Trademark register', known: false, configured: false, remedy: null, enrolment: null, credential: null } as const
  const none = providerRow({ ...base, provider: null, providerLabel: null, missing: ['CLEAROTRON_DATABASE'] })
  assert.deepEqual([none.name, none.state, none.faults, none.guide], ['No register selected', 'Missing', ['A register is needed'], 'register'])
  const typo = providerRow({ ...base, provider: 'clarivat', providerLabel: null, missing: [] })
  assert.deepEqual([typo.state, typo.faults], ['Not in this build', ['This build does not ship a provider called clarivat.']])
})

test('a source\'s label splits into its name and what it covers, leaving the web address behind', () => {
  assert.deepEqual(splitSourceLabel('CourtListener (US federal case law)'), { name: 'CourtListener', covers: 'US federal case law' })
  assert.deepEqual(splitSourceLabel('EUR-Lex (EU judgments, https://eur-lex.europa.eu/) — read through the engine\'s own fetch tool'),
    { name: 'EUR-Lex', covers: 'EU judgments' })
  assert.deepEqual(splitSourceLabel('Corsearch'), { name: 'Corsearch', covers: null })
})

// ── the setup guides ───────────────────────────────────────────────────────────────────────────────

test('every setup guide is a document in this repository, and its anchor is a heading in it', () => {
  for (const [guide, { path, anchor }] of Object.entries(SETUP_GUIDES)) {
    const doc = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
    // GitHub derives the anchor from the heading text: lowercase, spaces to hyphens, punctuation dropped.
    const headings = [...doc.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) =>
      (m[1] ?? '').toLowerCase().replace(/[^a-z0-9 -]/g, '').trim().replace(/\s+/g, '-'))
    assert.ok(headings.includes(anchor), `the ${guide} guide points at #${anchor}, and ${path} has no such heading`)
  }
  assert.equal(setupGuideUrl('https://github.com/Example/Fork', 'case-law'),
    'https://github.com/Example/Fork/blob/main/providers/oauth-mcp-bridge/README.md#one-time-setup-per-remote-mcp-server',
    'a guide must open in the repository the server names, so a fork sends its readers to its own instructions')
})
