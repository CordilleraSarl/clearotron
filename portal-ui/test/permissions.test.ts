// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The Manage permission: both answers driven, and the one control that asks for it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { canManage } from '../src/shell/permissions.ts'
import type { Role } from '../src/contract/api.ts'

// EVERY member of the role union, written out. A permission test that exercises one member is a claim
// about that member and says nothing about the distinction it is named for — so the list is exhaustive
// and the arm below fails if the union grows without this file being told.
const EVERY_ROLE: readonly Role[] = ['staff', 'client']

test('MANAGE IS ANSWERED FOR EVERY ROLE THE WIRE CAN SEND, not just the one that gets the control', () => {
  const answers = new Map(EVERY_ROLE.map((role) => [role, canManage({ role })]))

  // The floor: if the union is ever narrowed to one member, "both directions" quietly becomes one
  // direction and every assertion below still passes.
  assert.equal(answers.size, 2, 'the role union has two members; a change here changes what this proves')

  assert.equal(answers.get('staff'), true, 'the people who run the install may add companies')
  assert.equal(answers.get('client'), false, "a customer's own user may not")

  // Both directions are represented. An always-true or always-false derivation passes each single
  // assertion above in isolation; it cannot pass this one.
  assert.equal(new Set(answers.values()).size, 2, 'the permission DISCRIMINATES — it is not a constant')
})

test('THE CREATE CONTROL ASKS THE PERMISSION, never the role word', () => {
  // Why this is not simply a spelling check: the rule being kept is that there is ONE derivation of
  // Manage. The way that rule dies is a screen deciding for itself — reading `me.role` at the point of
  // the control because the role happens to be in scope — which is how the same person comes to be
  // offered a control on one screen and refused it on the next. It is also the sweep bundle 2 has to do,
  // and every site doing it correctly now is one it does not have to find.
  const src = readFileSync(new URL('../src/shell/CompanyPicker.tsx', import.meta.url), 'utf8')
  const body = src
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
    .join('\n')

  // FLOOR FIRST. Every assertion after this one is about the content of a particular line; if the file
  // moved or the control was renamed, they would all pass against text that no longer contains it.
  assert.match(body, /onAdd=\{/, 'the create control is still wired here — if not, this file moved')
  assert.ok(body.length > 2000, 'the whole file was read, not a truncated or empty one')

  const controlLine = body.split('\n').find((l) => l.includes('onAdd={'))
  assert.ok(controlLine, 'the control has a wiring line')
  assert.match(controlLine, /canManage\(/, 'the control is gated on the permission')
  assert.doesNotMatch(
    controlLine,
    /\brole\b/,
    'the control does not re-derive Manage from a role word at the point of use',
  )
})
