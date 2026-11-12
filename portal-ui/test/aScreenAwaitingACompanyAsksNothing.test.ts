// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A SCREEN WAITING FOR A COMPANY ASKS THE SERVER NOTHING ABOUT ONE.
//
// A person who sees every company opens a company's screen on "All companies", and the screen draws the
// company picker. Each of those screens still sent its company reads with no company named, and the
// server refuses every one of them with a 400. Measured in a browser on a published beta's demo,
// 2026-11-07: New clearance sent four (searches, profile, projects, usage), Profile three, Search
// templates two and Projects one, all answered 400, behind a page that had already said what to do.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { companyRead, mustPickCompany } from '../src/contract/api.ts'
import type { Result } from '../src/contract/api.ts'

test('a read for a company not yet picked is answered here and never sent', async () => {
  let sent = 0
  const read = async (): Promise<Result<string>> => { sent++; return { kind: 'ok', value: 'the company' } }
  assert.deepEqual(await companyRead(true, read), { kind: 'pickAccount' },
    'the answer is the one the server gives an unnamed company, which every one of these screens draws as the picker')
  assert.equal(sent, 0, 'the read went out while the screen was still waiting for a company')

  // THE CONTROL: with a company in view, the read is the read.
  assert.deepEqual(await companyRead(false, read), { kind: 'ok', value: 'the company' })
  assert.equal(sent, 1)
})

test('a login waits for a company unless the server can resolve one for it, as the server decides', () => {
  // The server resolves a read that names no company only for a login holding exactly one. Asked of "sees
  // every company" alone, a client holding several was not waiting: measured in the composer render check,
  // 2026-11-07, New clearance sent its four reads with none named, and the server refuses each.
  const me = (accounts: readonly string[], allAccounts = false) => ({ accounts, allAccounts })
  assert.equal(mustPickCompany(me([], true), null), true, 'a reader who sees every company')
  assert.equal(mustPickCompany(me(['coastline', 'harbourline']), null), true, 'a client holding two companies')
  assert.equal(mustPickCompany(me([]), null), true, 'a login holding no company of its own')
  // THE CONTROLS: one company is resolved by the server, and a company picked is a company named.
  assert.equal(mustPickCompany(me(['coastline']), null), false, 'a client holding one company')
  assert.equal(mustPickCompany(me(['coastline', 'harbourline']), 'harbourline'), false, 'a company picked')
  assert.equal(mustPickCompany(me([], true), 'coastline'), false, 'a company picked by a reader who sees every one')
})

test('every company read on the four company screens waits for the company', () => {
  // The screens are .tsx, which this suite cannot render, so the wiring is read off their source: each
  // company read named here goes through `companyRead`, given the screen's own `needsOwner`.
  const src = (f: string) => readFileSync(new URL(`../src/screens/${f}`, import.meta.url), 'utf8')
  const SCREENS: Readonly<Record<string, number>> = {
    'NewClearance.tsx': 4, 'Profile.tsx': 3, 'SavedSearches.tsx': 2, 'Projects.tsx': 1,
  }
  for (const [file, reads] of Object.entries(SCREENS)) {
    const text = src(file)
    assert.match(text, /const needsOwner = mustPickCompany\(ctx\.me, account\)/,
      `${file} no longer says when it is waiting for a company, so this check reads nothing there`)
    const bare = text.match(/useLoad\(\(\) => api\.(?:searches|profile|projects|usage|savedSearches)\(account\)/g) ?? []
    assert.deepEqual(bare, [], `${file} sends a company read before a company is picked`)
    const waiting = text.match(/useLoad\(\(\) => companyRead\(needsOwner, \(\) => api\.\w+\(account\)\), \[account, needsOwner\]\)/g) ?? []
    assert.equal(waiting.length, reads, `${file} has ${waiting.length} company reads that wait for the company, not ${reads}`)
  }
})
