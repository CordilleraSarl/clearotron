// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The two permissions: every combination driven, the words they print in, and the one control that asks.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canManage, canRun } from '../src/shell/permissions.ts'
import { permissionsPhrase, accessChips, accessSentence, PERMISSION_LINE, PERMISSIONS_KEY, BOTH_OFF_LINE, REACH_LINE } from '../src/shell/accessWords.ts'
import type { Permissions } from '../src/contract/api.ts'
import { prose } from './support/prose.ts'

// EVERY combination of the two switches, written out. A permission test that exercises one person is a
// claim about that person and says nothing about the distinction it is named for — so the list is
// exhaustive, and the floor below fails if it is ever narrowed.
const EVERY: readonly Permissions[] = [
  { run: false, manage: false },
  { run: true, manage: false },
  { run: false, manage: true },
  { run: true, manage: true },
]

test('EACH PERMISSION IS ANSWERED BY ITS OWN SWITCH, for every combination, and by nothing else', () => {
  assert.equal(new Set(EVERY.map((p) => `${p.run}${p.manage}`)).size, 4, 'all four combinations, once each')
  for (const permissions of EVERY) {
    assert.equal(canRun({ permissions }), permissions.run, `run on ${JSON.stringify(permissions)}`)
    assert.equal(canManage({ permissions }), permissions.manage, `manage on ${JSON.stringify(permissions)}`)
  }
  // Both functions DISCRIMINATE, and on DIFFERENT switches. An implementation reading one switch for
  // both questions passes every single assertion for the two diagonal people; it cannot pass this.
  const split = EVERY.find((p) => p.run !== p.manage) as Permissions
  assert.notEqual(canRun({ permissions: split }), canManage({ permissions: split }),
    'the two questions are answered separately — Manage is not a rank above Run')
})

test('THE WORDS: what a person may do, never a role noun, and "none" is the view-only person', () => {
  assert.equal(permissionsPhrase({ run: true, manage: true }), 'Runs clearances · Manages')
  assert.equal(permissionsPhrase({ run: true, manage: false }), 'Runs clearances')
  assert.equal(permissionsPhrase({ run: false, manage: true }), 'Manages')
  // Both off is somebody who reads every report inside their access. "None" would read as a revoked
  // account to the person it describes.
  assert.equal(permissionsPhrase({ run: false, manage: false }), 'View reports')
  for (const p of EVERY) {
    assert.doesNotMatch(permissionsPhrase(p), /staff|client|admin|viewer/i, 'no role noun is ever printed')
  }
})

test('THE ACCESS CHIPS: the root reads "Everything" and leads; a single company reads last', () => {
  const chips = accessChips([
    { kind: 'company', key: 'harbour', name: 'Harbour Ltd' },
    { kind: 'organisation', key: 'birch', name: 'Birch & Co' },
  ])
  assert.deepEqual(chips.map((c) => c.label), ['Birch & Co', 'Harbour Ltd'], 'organisations before single companies')
  assert.deepEqual(chips.map((c) => c.top), [false, false])

  const root = accessChips([{ kind: 'everything', key: '*', name: 'ignored' }])
  assert.deepEqual(root.map((c) => [c.label, c.top]), [['Everything', true]],
    'the root is named by the product, never by whatever the wire put in its name field')
  // Keys are unique across kinds, so an organisation and a company that share a key cannot collide as
  // React keys and drop a chip.
  const same = accessChips([{ kind: 'organisation', key: 'acme', name: 'Acme' }, { kind: 'company', key: 'acme', name: 'Acme Ltd' }])
  assert.equal(new Set(same.map((c) => c.key)).size, 2)
})

test('THE CREATE CONTROL ASKS THE PERMISSION, never a role word', () => {
  // The rule being kept is that there is ONE derivation of Manage. The way that rule dies is a screen
  // deciding for itself at the point of the control, which is how the same person comes to be offered a
  // control on one screen and refused it on the next.
  const src = readFileSync(new URL('../src/shell/CompanyPicker.tsx', import.meta.url), 'utf8')
  const body = prose(src)

  // FLOOR FIRST. Every assertion after this one is about the content of a particular line; if the file
  // moved or the control was renamed, they would all pass against text that no longer contains it.
  assert.match(body, /onAdd=\{/, 'the create control is still wired here — if not, this file moved')
  assert.ok(body.length > 2000, 'the whole file was read, not a truncated or empty one')

  const controlLine = body.split('\n').find((l) => l.includes('onAdd={'))
  assert.ok(controlLine, 'the control has a wiring line')
  assert.match(controlLine, /canManage\(/, 'the control is gated on the permission')
  assert.doesNotMatch(controlLine, /\brole\b|staff/, 'and on nothing that re-derives it from a role word')
})

test('THE SENTENCE says what the new person will and will not see, before anything is saved', () => {
  const run = { run: true, manage: false }
  // One organisation whole and one company in another: the case a reader most often gets wrong, because
  // the company's organisation is only PARTLY given.
  assert.equal(
    accessSentence({ who: 'dana@birch.example', permissions: run, everything: false, organisations: ['Birch & Co'],
      companies: [{ name: 'Harbour Ltd', organisation: 'Alder Group' }] }),
    'dana@birch.example will see everything under Birch & Co and under Harbour Ltd, and can run clearances there. '
      + 'They will not see any other Alder Group clearances, and cannot add companies or people.')
  assert.equal(
    accessSentence({ who: 'a@b.test', permissions: { run: true, manage: true }, everything: true, organisations: [], companies: [] }),
    'a@b.test will see everything on this Clearotron, including organisations added later, and can run clearances and add companies and people there.',
    'everything, both switches: nothing to warn about')
  assert.equal(
    accessSentence({ who: 'a@b.test', permissions: { run: false, manage: false }, everything: false, organisations: ['Birch & Co'], companies: [] }),
    'a@b.test will see everything under Birch & Co, and can read every report there. They cannot start clearances or add companies or people.',
    'the view-only person is told what they CAN do first')
  // Nothing chosen: an instruction, not a claim — and the one fact about the choice this page cannot
  // show, that it is also what the person's AI assistant reaches.
  assert.equal(
    accessSentence({ who: ' ', permissions: run, everything: false, organisations: [], companies: [] }),
    'Choose what this person can see. It is what they see here and through their AI.',
    'nothing chosen and no address yet: an instruction, not a claim')
  assert.equal(
    accessSentence({ who: 'dana@birch.example', permissions: run, everything: false, organisations: [], companies: [] }),
    'Choose what dana@birch.example can see. It is what they see here and through their AI.',
    'the instruction names the address once one is typed, and still says what the choice covers')
  assert.match(accessSentence({ who: '', permissions: run, everything: true, organisations: [], companies: [] }),
    /^This person will see everything/, 'the stand-in subject is capitalised where it opens the sentence')
  // A company picked inside an organisation that is ALSO picked whole is not a partial organisation.
  assert.doesNotMatch(
    accessSentence({ who: 'a@b.test', permissions: run, everything: false, organisations: ['Alder Group'],
      companies: [{ name: 'Harbour Ltd', organisation: 'Alder Group' }] }),
    /any other/)
  // Never a pronoun guessed from a name: only "they".
  for (const who of ['dana@birch.example', 'tom@harbour.example', '']) {
    for (const permissions of [run, { run: false, manage: false }]) {
      const s = accessSentence({ who, permissions, everything: false, organisations: [], companies: [{ name: 'Harbour Ltd', organisation: 'Alder Group' }] })
      assert.doesNotMatch(s, /\b(she|he|her|his|him|hers)\b/i, s)
    }
  }
})

test('THE KEY under People explains exactly the words its column prints, in the lines the levers print', () => {
  // The key's terms are the column's own words, asked one switch at a time — so a key cannot explain a
  // word the column never prints, or miss one it does.
  assert.deepEqual(PERMISSIONS_KEY.map((k) => k.term),
    [permissionsPhrase({ run: true, manage: false }), permissionsPhrase({ run: false, manage: true }), permissionsPhrase({ run: false, manage: false })])
  assert.deepEqual(PERMISSIONS_KEY.map((k) => `${k.term} — ${k.means}`), [
    'Runs clearances — Start and stop clearances on the companies they can see.',
    'Manages — Add companies, add people and change settings for the companies they can see.',
    'View reports — Everyone can view reports for the companies they can see.',
  ])
  // ONE AUTHOR for what a permission covers. The line under a lever is the key's sentence, and both say
  // the companies the person can see — never a company list of Manage's own.
  assert.equal(PERMISSION_LINE.run, 'Start and stop clearances on the companies they can see')
  assert.equal(PERMISSION_LINE.manage, 'Add companies, add people and change settings for the companies they can see')
  assert.equal(PERMISSIONS_KEY[0]?.means, `${PERMISSION_LINE.run}.`)
  assert.equal(PERMISSIONS_KEY[1]?.means, `${PERMISSION_LINE.manage}.`)
  for (const k of PERMISSIONS_KEY) assert.match(k.means, / the companies they can see\.$/, `${k.term} is scoped to what the person can see`)

  // Both levers off is named by the word the list prints for it.
  assert.equal(BOTH_OFF_LINE, 'Leave both off for View reports — every report for the companies they can see.')
  assert.ok(BOTH_OFF_LINE.includes(permissionsPhrase({ run: false, manage: false })), 'the both-off line names the list\'s word')
  // Access to a point reaches what is added under it later, and the tree says so.
  assert.equal(REACH_LINE.everything, 'every organisation and company, including ones added later')
  assert.equal(REACH_LINE.organisation, 'every company in it, including ones added later')
})

test('THE RETIRED ACCESS PHRASES appear nowhere in the portal source', () => {
  // A listed address with nothing granted reads "View reports" — what the person can do. Neither the
  // phrase that named the shape of the record instead, "Reach only", nor "No permissions" may come back:
  // not on a screen, not in a tooltip, not in a comment quoting one. Case-insensitive, because a sentence
  // can start either way.
  const root = fileURLToPath(new URL('../src/', import.meta.url))
  const files: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else files.push(full)
    }
  }
  walk(root)
  // FLOOR AND CONTROL. A walk that found nothing, or read nothing, would pass in silence: the tree has
  // dozens of files, and the both-off word itself must be found where it is written.
  assert.ok(files.length >= 40, `expected the portal source to be walked, found ${files.length} files`)
  const texts = files.map((f) => [f, readFileSync(f, 'utf8')] as const)
  assert.ok(texts.some(([f, t]) => f.endsWith('accessWords.ts') && t.includes("'View reports'")), 'the walk reads file contents')
  for (const [f, t] of texts) {
    assert.doesNotMatch(t, /reach\s+only/i, `${f.slice(root.length)} says "Reach only"`)
    assert.doesNotMatch(t, /no\s+permissions/i, `${f.slice(root.length)} says "No permissions"`)
  }
})
