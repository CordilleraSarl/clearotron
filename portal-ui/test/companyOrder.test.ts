// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The rail's switcher, the pick panel and the chips offer companies in ONE order, under ONE grouping.
//
// THE DEFECT THIS EXISTS FOR. The panel lifted Generic to the front — it is the default, and a default
// that sorts alphabetically among the companies is a default nobody finds — while the switcher sorted
// every key by display name, so one install read two ways on adjacent controls. All three now take their
// rows from `pickerGroups`, so agreement is by construction; what is asserted here is the rule itself,
// for every shape an installation can be in, including the two-organisation shapes the tree adds.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pickerGroups, pickerRows, GENERIC_KEY } from '../src/shell/companyRows.ts'
import type { Organisation, Run } from '../src/contract/api.ts'
import { genericFor, isGenericKey, orgOfGeneric, wireAccount, runKey } from '../src/contract/genericKey.ts'
import { ownerSummaries, runsFor } from '../src/contract/home.ts'

const NAMES: Record<string, string> = {
  generic: 'Generic default',
  acme: 'Acme Ltd',
  zephyr: 'Zephyr Holdings',
  brightwater: 'Brightwater',
  harbour: 'Harbour Ltd',
}
const name = (k: string | null) => (k === null ? 'All companies' : NAMES[k] ?? k)
const noFacts = () => undefined

const ALDER: Organisation = { key: 'alder', name: 'Alder Group' }
const BIRCH: Organisation = { key: 'birch', name: 'Birch & Co' }
const orgMap = (m: Record<string, string>) => (k: string) => m[k] ?? null

test('GENERIC LEADS ITS GROUP, and the companies after it stay in name order', () => {
  const one = [ALDER]
  const inAlder = orgMap({ generic: 'alder', acme: 'alder', zephyr: 'alder', brightwater: 'alder' })
  for (const keys of [['acme', 'generic', 'zephyr'], ['generic', 'acme'], ['zephyr', 'brightwater', 'generic', 'acme']]) {
    const rows = pickerRows(keys, inAlder, one, name, noFacts)
    assert.equal(rows[0]?.key, GENERIC_KEY, `[${keys.join(', ')}] — the default is the first thing offered`)
    const rest = rows.slice(1).map((r) => r.name)
    assert.deepEqual(rest, [...rest].sort((a, b) => a.localeCompare(b)), 'putting Generic first does not scramble the rest')
  }
  // The floor: an order with no Generic in it must not invent one.
  assert.deepEqual(pickerRows(['acme', 'zephyr'], inAlder, one, name, noFacts).map((r) => r.key), ['acme', 'zephyr'])
})

test('GENERIC IS OFFERED TO WHOEVER CAN SEE ITS ORGANISATION — there is no role left to withhold it by', () => {
  // It used to be withheld from every non-staff reader. Under the tree it belongs to its organisation,
  // and the only thing that decides whether a person is offered it is whether the server put it in
  // their list. So the row is present whenever the key is, and carries the tag that marks it.
  const rows = pickerRows(['acme', 'generic'], orgMap({ acme: 'alder', generic: 'alder' }), [ALDER], name, noFacts)
  const generic = rows.find((r) => r.key === GENERIC_KEY)
  assert.ok(generic, 'offered')
  assert.equal(generic.generic, true, 'and marked, so the Default tag is drawn from one flag')
  assert.equal(rows.filter((r) => r.generic).length, 1, 'only Generic is marked')
})

test('HEADINGS ONLY FOR A PERSON WHO CAN SEE MORE THAN ONE ORGANISATION', () => {
  // A person who can see two organisations, sent Generic and one company from the first of them.
  const wideKeys = ['harbour', 'generic']
  const wide = pickerGroups(wideKeys, orgMap({ harbour: 'alder', generic: 'alder' }), [ALDER, BIRCH], name, noFacts)
  assert.equal(wide.headings, true, 'two organisations visible — the headings are shown')
  assert.deepEqual(wide.groups.map((g) => g.org?.name), ['Alder Group'],
    'an organisation holding no row the person was sent draws no empty heading')

  // A person with access to one company never meets a heading, however their company is filed.
  const single = pickerGroups(['harbour'], orgMap({ harbour: 'alder' }), [ALDER], name, noFacts)
  assert.equal(single.headings, false, 'one organisation visible — no heading, ever')
  assert.deepEqual(single.groups.flatMap((g) => g.rows.map((r) => r.key)), ['harbour'], 'and the row is still there')

  // The switch keys on the organisations VISIBLE, not on how many groups happen to hold rows: a person
  // who can see two organisations but was sent companies from one still reads which one it is.
  assert.equal(pickerGroups(['acme'], orgMap({ acme: 'birch' }), [ALDER, BIRCH], name, noFacts).headings, true)
})

test('GROUPS FOLLOW THE ORDER THE SERVER LISTS ORGANISATIONS IN — never re-sorted by name here', () => {
  // The server lists the organisation a person was given whole before one where they hold a single company.
  // Alphabetical order would agree by accident for these two names, so the arm uses both orders.
  const orgOf = orgMap({ generic: 'birch', harbour: 'alder' })
  for (const order of [[BIRCH, ALDER], [ALDER, BIRCH]]) {
    const g = pickerGroups(['harbour', 'generic'], orgOf, order, name, noFacts)
    assert.deepEqual(g.groups.map((x) => x.org?.key), order.map((o) => o.key), `server order ${order.map((o) => o.key).join(', ')} kept`)
  }
})

test('A COMPANY THE SERVER PLACED NOWHERE STILL GETS A ROW — under no heading, never under a guess', () => {
  const g = pickerGroups(['acme', 'zephyr', 'orphan'], orgMap({ acme: 'alder', zephyr: 'nowhere-listed' }),
    [ALDER, BIRCH], name, noFacts)
  const last = g.groups[g.groups.length - 1]
  assert.equal(last?.org, null, 'the unplaced rows sit in a trailing group with no organisation')
  assert.deepEqual(last?.rows.map((r) => r.key), ['orphan', 'zephyr'],
    'both the unstated company and the one placed in an organisation nobody listed')
  // The floor: every key handed in comes out exactly once. Dropping a row makes a company unselectable.
  const out = g.groups.flatMap((x) => x.rows.map((r) => r.key)).sort()
  assert.deepEqual(out, ['acme', 'orphan', 'zephyr'])
})

test('ONE GENERIC PER ORGANISATION, each leading its own group under the key that names it', () => {
  const orgOf = (k: string) => orgOfGeneric(k) ?? ({ harbour: 'alder', acme: 'birch' } as Record<string, string>)[k] ?? null
  const g = pickerGroups(['harbour', genericFor('alder'), 'acme', genericFor('birch')], orgOf, [ALDER, BIRCH], name, noFacts)
  assert.deepEqual(g.groups.map((x) => x.rows.map((r) => r.key)),
    [[genericFor('alder'), 'harbour'], [genericFor('birch'), 'acme']])
  for (const grp of g.groups) assert.equal(grp.rows[0]?.generic, true, `${grp.org?.name}: its own Generic leads, tagged`)
  // Two rows, not one: neither organisation's Generic stands in for the other's.
  assert.equal(new Set(g.groups.flatMap((x) => x.rows.filter((r) => r.generic).map((r) => r.key))).size, 2)
})

test('THE GENERIC KEY names its organisation, and only wireAccount turns it into the pair', () => {
  assert.deepEqual(wireAccount(genericFor('alder')), { account: 'generic', tenant: 'alder' })
  assert.deepEqual(wireAccount('generic'), { account: 'generic' }, 'the bare key a run row carries goes out as it is')
  assert.deepEqual(wireAccount('coastline'), { account: 'coastline' })
  assert.equal(isGenericKey('generic'), true)
  assert.equal(isGenericKey(genericFor('alder')), true)
  assert.equal(isGenericKey('generically'), false, 'a company whose key merely starts with the word is a company')
  assert.equal(orgOfGeneric('generic'), null)
  assert.equal(orgOfGeneric('coastline'), null)
  assert.equal(orgOfGeneric(genericFor('alder')), 'alder')
})

test('A RUN IS FILED UNDER THE KEY THE SWITCHER HOLDS — its company, or its organisation\'s Generic', () => {
  assert.equal(runKey({ account: 'generic', organisation: 'alder' }), genericFor('alder'))
  assert.equal(runKey({ account: 'harbour', organisation: 'alder' }), 'harbour', 'a company run is its company')
  // Filed before organisations were recorded: unplaced, under the bare key no organisation's Generic claims.
  assert.equal(runKey({ account: 'generic', organisation: null }), 'generic')
  assert.equal(runKey({ account: 'generic' }), 'generic')
})

test("HOME COUNTS EACH ORGANISATION'S GENERIC ON ITS OWN, and a bare comparison would have counted none", () => {
  const runs = [
    { runId: 'a', account: 'generic', organisation: 'alder', state: 'running', date: '2026-09-01' },
    { runId: 'b', account: 'generic', organisation: 'birch', state: 'delivered', date: '2026-09-02' },
    { runId: 'c', account: 'generic', organisation: null, state: 'delivered', date: '2026-08-01' },
  ] as unknown as readonly Run[]
  const byKey = Object.fromEntries(ownerSummaries([genericFor('alder'), genericFor('birch')], runs, (k) => k)
    .map((x) => [x.key, [x.live, x.finished]]))
  assert.deepEqual(byKey, { [genericFor('alder')]: [1, 0], [genericFor('birch')]: [0, 1] },
    'each Generic counts its own organisation\'s runs, and the unplaced one is counted under neither')
})

test("THE CHIPS FILTER THROUGH runKey, so picking an organisation's Generic keeps its runs", () => {
  // Home filters its rows by the picked owner. A bare `run.account === owner` keeps nothing for
  // genericFor('alder'), because Alder's Generic runs carry the wire account `generic`.
  const runs = [
    { runId: 'co', account: 'harbour', organisation: null, state: 'running', date: '2026-09-03' },
    { runId: 'a', account: 'generic', organisation: 'alder', state: 'running', date: '2026-09-01' },
    { runId: 'b', account: 'generic', organisation: 'birch', state: 'delivered', date: '2026-09-02' },
  ] as unknown as readonly Run[]
  const ids = (owner: string | null) => runsFor(runs, owner).map((r) => r.runId)
  assert.deepEqual(ids(genericFor('alder')), ['a'], "Alder's Generic keeps its own run and nothing else")
  assert.deepEqual(ids('harbour'), ['co'], 'a company keeps its own run')
  assert.deepEqual(ids(null), ['co', 'a', 'b'], 'with nothing picked, every run stays')
})

test('THE SWITCHER, THE PANEL AND THE CHIPS take their rows from the one grouping', () => {
  // Agreement is by construction now: pickerGroups groups and orders, and every control that lists
  // companies calls it, so the rail and the panel cannot offer one install in two orders. What can still
  // break that is a call site that stops calling it, so the call sites are held here, read as text
  // because the shell cannot be mounted in this suite (ownerNames.test.ts reads AppShell the same way).
  const src = (f: string) => readFileSync(new URL(`../src/shell/${f}`, import.meta.url), 'utf8')
  for (const [file, fn] of [['AppShell.tsx', 'pickerGroups'], ['CompanyPicker.tsx', 'pickerGroups'], ['CompanyChips.tsx', 'pickerRows']]) {
    assert.equal(src(file).split(`${fn}(`).length - 1, 1, `${file} takes its rows from ${fn}, once`)
  }
  // And the chips' flat list is the panel's groups in the panel's order, on one organisation and on two.
  type In = Parameters<typeof pickerGroups>
  const same = (keys: In[0], orgOf: In[1], orgs: In[2]) =>
    assert.deepEqual(
      pickerRows(keys, orgOf, orgs, name, noFacts).map((r) => r.key),
      pickerGroups(keys, orgOf, orgs, name, noFacts).groups.flatMap((g) => g.rows).map((r) => r.key),
      `the chips and the panel list [${keys.join(', ')}] the same way`,
    )
  same(['zephyr', 'generic', 'acme'], orgMap({ zephyr: 'alder', generic: 'alder', acme: 'alder' }), [ALDER])
  same(['harbour', genericFor('alder'), 'acme', genericFor('birch')], orgMap({ harbour: 'alder', acme: 'birch' }), [ALDER, BIRCH])
})
