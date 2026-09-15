// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Every field the Person type declares survives the wire.
//
// WHY THIS EXISTS. `Person` declared `listed?: boolean`, the server had always sent it, the People page
// had always read it as `listed === false` to draw "Reach only — no permissions set" — and the decoder
// returned an object literal that never mentioned it. So it was `undefined` on every row, the comparison
// was never true, and a distinction the server goes to real trouble to make had never once reached a
// screen. Nothing failed: an OPTIONAL field makes a missing decode invisible to the compiler, and on
// screen it is identical to a server that did not send it.
//
// The population is derived from the TYPE rather than listed here, so a field added to `Person` and
// forgotten in the decoder fails this the day it is added. The floor is what keeps that honest: a
// regex that stopped matching the type block would find no fields and assert nothing about all of them.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { api, isOk, type Result } from '../src/contract/api.ts'

const SRC = readFileSync(new URL('../src/contract/api.ts', import.meta.url), 'utf8')

/** The field names `export type Person = { … }` declares, optional and required alike. */
const personFields = (): readonly string[] => {
  const start = SRC.indexOf('export type Person = {')
  if (start < 0) return []
  const end = SRC.indexOf('\n}', start)
  if (end < 0) return []
  return [...SRC.slice(start, end).matchAll(/^\s*readonly\s+([A-Za-z_$][\w$]*)\??\s*:/gm)].map((m) => m[1] as string)
}

/** One person on the wire, with every field set to something no default would produce. */
const WIRE = {
  email: 'dana@anthropic.example',
  permissions: { run: true, manage: true },
  access: [{ kind: 'organisation', key: 'anthropic', name: 'Anthropic' }],
  dangling: ['nosuchcompany'],
  listed: false,
  covered: true,
  keys: 2,
}

const withFetch = async <T>(body: unknown, call: () => Promise<Result<T>>): Promise<Result<T>> => {
  const original = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch
  try { return await call() } finally { globalThis.fetch = original }
}

const onePerson = async (person: Record<string, unknown>) => {
  const r = await withFetch({ note: '', unknownAccounts: [], people: [person], grantsFile: null,
    canAdd: true, localSignIn: false, keysRevocable: true }, () => api.adminAccess())
  assert.ok(isOk(r), 'the access view did not decode at all')
  return r.value.people[0] as unknown as Record<string, unknown>
}

test('the field list is read off the type, and it is not empty', () => {
  const fields = personFields()
  // THE FLOOR. Everything below asserts something about each member of this list; a regex that stopped
  // matching would assert all of it about nothing and pass.
  assert.ok(fields.length >= 6, `only ${fields.length} field(s) read off the Person type — the reader is matching nothing`)
  for (const expected of ['email', 'permissions', 'access', 'dangling', 'listed', 'covered', 'keys']) {
    assert.ok(fields.includes(expected), `the reader did not find "${expected}", which the type declares`)
  }
})

test('every declared field arrives, and arrives as what was sent', async () => {
  const got = await onePerson(WIRE)
  const missing = personFields().filter((f) => got[f] === undefined)
  assert.deepEqual(missing, [], `the decoder drops ${missing.join(', ')} — declared on the type, sent by the server, never read`)
  assert.equal(got['email'], 'dana@anthropic.example')
  assert.deepEqual(got['permissions'], { run: true, manage: true })
  assert.equal((got['access'] as unknown[]).length, 1)
  assert.deepEqual(got['dangling'], ['nosuchcompany'])
  assert.equal(got['listed'], false, 'the whole reason this file exists')
  assert.equal(got['covered'], true)
  assert.equal(got['keys'], 2)
})

test('an absent field resolves in the direction that is safe to be wrong about', async () => {
  const { listed: _l, covered: _c, keys: _k, ...bare } = WIRE
  const got = await onePerson(bare)
  // An older server's people all had entries, so `listed` reads as true and the row says what they may
  // do rather than claiming nothing was set.
  assert.equal(got['listed'], true)
  // The other two go the cautious way: a viewer who is not TOLD they can see all of somebody is not
  // allowed to change that person's permissions, and a removal promises less than it might deliver.
  assert.equal(got['covered'], false, 'an unstated `covered` let a narrowed viewer change permissions they cannot see')
  assert.equal(got['keys'], 0)
})

test('a field sent as the wrong shape resolves the same way as one not sent', async () => {
  const got = await onePerson({ ...WIRE, listed: 'no', covered: 'yes', keys: 'two' })
  assert.equal(got['listed'], true)
  assert.equal(got['covered'], false)
  assert.equal(got['keys'], 0)
})
