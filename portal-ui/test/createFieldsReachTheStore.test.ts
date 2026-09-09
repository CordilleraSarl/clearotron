// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Every field the create form offers is a field the wall carries.
//
// THE DEFECT THIS EXISTS FOR, found by driving the form's own field list through the door rather than by
// reading either side. The form offered seven fields; the wall carried five. Trading names, default
// classes and default territories were accepted by the screen, typed in by a person, sent, and dropped
// without a word — which is the exact shape this whole family of work exists to remove, arriving inside
// the fix for it.
//
// Neither list is wrong on its own and neither file can see the other, so nothing was going to catch it:
// the screen renders what it renders, the wall carries what it carries, and the gap between them is
// invisible from either end. This is the only place both are in scope at once.
//
// `key` is on the wall's list and not on the form's, deliberately: it is derived from the name and sent
// separately when somebody changes it, so it is not a field the form renders.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PROFILE_FIELDS } from '../src/contract/profileFields.ts'

// @ts-expect-error — the driver is plain .mjs with no types; this test is the seam between the two.
import { CREATABLE_FIELDS } from '../../driver/portal-upstream.mjs'

/** The form's own list, read out of the screen rather than restated here — a copy would drift the same
 *  way the two originals did. */
function formFields(): readonly string[] {
  const src = readFileSync(new URL('../src/screens/NewCompany.tsx', import.meta.url), 'utf8')
  const block = src.match(/const CREATE_FIELDS: readonly string\[\] = \[([\s\S]*?)\]/)
  assert.ok(block, 'the create screen still declares its field list under that name')
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1] as string)
}

test('EVERY FIELD THE FORM OFFERS IS ONE THE WALL CARRIES', () => {
  const form = formFields()
  const wall = [...(CREATABLE_FIELDS as readonly string[])]

  // The floor. An empty read of either side satisfies a subset check perfectly, and that is exactly how
  // this check would come to pass while the defect was live again.
  assert.ok(form.length >= 5, `the form's list was read: ${form.join(', ')}`)
  assert.ok(wall.length >= 5, `the wall's list was read: ${wall.join(', ')}`)

  const dropped = form.filter((f) => !wall.includes(f))
  assert.deepEqual(dropped, [], 'fields the form accepts and the wall would silently discard')
})

test('EVERY FIELD ON THE FORM IS A REAL PROFILE FIELD, spelled as the profile spells it', () => {
  // The other direction of the same mistake: a field named on the form that the profile has no such key
  // for would render a box that writes nowhere, and would satisfy the check above if somebody added the
  // same wrong spelling to the wall.
  const known = new Set(PROFILE_FIELDS.map((f) => f.key))
  for (const f of formFields()) {
    assert.ok(known.has(f), `${f} is a field the profile contract knows`)
  }
})

test('THE WALL CARRIES NOTHING THE FORM CANNOT SEND, except the derived key', () => {
  // A wall list that grows past the form is not a data-loss bug, but it is a widening of what a browser
  // may state — and the one field that legitimately differs is named here so a second one cannot be
  // added without this failing.
  const form = new Set(formFields())
  const extra = [...(CREATABLE_FIELDS as readonly string[])].filter((f) => !form.has(f) && f !== 'key')
  assert.deepEqual(extra, [], 'the wall accepts a field no form sends — say why here, or remove it')
})

test('THE FRAMEWORK IS NOT SENDABLE FROM A BROWSER, on either list', () => {
  // The one field whose absence is the rule rather than an omission. It is a real input on the create
  // route, so putting it on either list would put a framework chooser one fetch from any browser.
  assert.ok(!formFields().includes('frameworkPath'))
  assert.ok(!(CREATABLE_FIELDS as readonly string[]).includes('frameworkPath'))
})
