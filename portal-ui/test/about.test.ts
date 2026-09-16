// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// About: a readable source link, the build it is pinned to one row above it, and the rest of the source
// offer still on the page.
//
// The link's words depend on the address the server states, so they are DRIVEN through the helper the
// screen calls, forks included. The order of the rows and what each links to are read from the source,
// commentary stripped, because this runner cannot mount a `.tsx`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { repositoryName } from '../src/contract/repositoryName.ts'
import { prose } from './support/prose.ts'

const ABOUT = prose(readFileSync(new URL('../src/screens/About.tsx', import.meta.url), 'utf8')).replace(/\s+/g, ' ')
/** The branch that renders the answer, not the failure or the wait. */
const ANSWER = ABOUT.slice(ABOUT.indexOf('const shortSha'))

test('the source link reads as the repository, and a fork\'s page names the fork', () => {
  assert.equal(repositoryName('https://github.com/CordilleraSarl/Clearotron'), 'CordilleraSarl/Clearotron')
  assert.equal(repositoryName('https://github.com/SomeFirm/clearotron-fork/'), 'SomeFirm/clearotron-fork')
  assert.equal(repositoryName('not an address'), 'not an address', 'an address that does not parse must still say something')
})

test('the Source row links the words to this build\'s address, with the build identifier one row above it', () => {
  assert.ok(ANSWER.length > 500, 'the answer branch could not be isolated, so nothing below reads it')
  assert.match(ANSWER, /<a className="about-link" href=\{info\.sourceUrl\} rel="noreferrer"> \{repositoryName\(info\.sourceRepo\)\} ↗ <\/a>/,
    'the Source row no longer reads as the repository, or no longer goes to the address pinned to this build')
  assert.doesNotMatch(ANSWER, />\{info\.sourceUrl\}</, 'the Source row prints the whole address again')
  const build = ANSWER.indexOf('<dt>Build</dt>')
  const source = ANSWER.indexOf('<dt>Source</dt>')
  assert.ok(build >= 0 && source > build, 'the build identifier is no longer the row above the source link')
  assert.match(ANSWER.slice(build, source), /className="mono"[^>]*>\{shortSha\}/, 'the build identifier is not in mono')
})

test('the rest of the source offer is still there, in order', () => {
  const rows = [...ANSWER.matchAll(/<dt>([^<]+)<\/dt>/g)].map((m) => m[1])
  assert.deepEqual(rows, ['Product', 'Version', 'Build', 'Source', 'Licence', 'Copyright', 'Model access', 'Trade marks'])
  assert.match(ANSWER, /<a className="pill" href=\{LICENCE_URL\} rel="noreferrer">Full text<\/a>/, 'the licence lost its full text')
  // The trade-mark notice keeps the words TRADEMARKS.md exists to state; the shipped-bundle check reads them.
  assert.match(ANSWER, /are trade marks of Cordillera Sàrl\. The licence above covers the software; it does not grant any right in the name or the mark\./)
  assert.match(ANSWER, /this licence grants nothing over any of them\./, 'the model-access sentence lost its licence clause')
  const pills = [...ANSWER.slice(ANSWER.indexOf('about-docs')).matchAll(/<a className="pill"[^>]*>([^<]+)<\/a>/g)].map((m) => m[1])
  assert.deepEqual(pills, ['Notices', 'Trademarks', 'Contributing', 'Security', 'Code of conduct', 'GitHub', 'clearotron.ai'])
})
