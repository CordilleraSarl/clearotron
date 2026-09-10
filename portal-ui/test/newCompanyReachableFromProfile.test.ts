// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — MAKING A COMPANY IS REACHABLE ONCE ONE IS SELECTED.
//
// Found by the owner on the test box. `+ New company` lived on the pick panel and nowhere else, and
// choosing a company is precisely what hides that panel — so the person doing the work had no route to a
// second company and nothing on screen saying where one was.
//
// NOT THE RAIL, and that was decided rather than skipped: a staff-only rail entry breaks the rule that
// staff and clients see the same page shape, which is why staff administration was moved out of the rail
// in the first place. The switcher's own action row is the owner's preferred placement and lands with the
// switcher rebuild.
//
// This suite has no renderer and reads source, as its own files say. It pins the GATE and the
// DESTINATION — the two things that must not drift from the pick panel's control — rather than the
// markup around them.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')
const PROFILE = read('../src/screens/Profile.tsx')
const PICKER = read('../src/shell/CompanyPicker.tsx')

test('the Company profile screen offers a route to making a company', () => {
  assert.match(PROFILE, /\+ New company/,
    'the profile screen offers no way to make a company, so a selected company again hides the only route')
  assert.match(PROFILE, /ctx\.go\(NEW_COMPANY_PATH\)/,
    'the control does not go to the shared path constant — a second spelling of the destination is a second thing to keep in step')
})

test('it is gated by the same predicate as the pick panel, not a second one', () => {
  // THE HAZARD IS DRIFT, not absence. Two controls that create the same thing behind two different role
  // tests is how one of them ends up offered to somebody the other refuses.
  assert.match(PROFILE, /canManage\(ctx\.me\)/,
    'the profile control is not Manage-gated — it may be offered to somebody who cannot create')
  assert.match(PICKER, /canManage\(ctx\.me\)/,
    'the pick panel stopped using canManage, so the two controls now answer to different rules')

  // Both import the gate rather than re-deriving it. A role comparison written out here would pass this
  // file and diverge the day the access model converts the field.
  assert.match(PROFILE, /import \{ canManage \} from '\.\.\/shell\/permissions\.ts'/,
    'the profile screen derives its own permission instead of importing the one definition')
  assert.doesNotMatch(PROFILE, /me\.role === 'staff' \?[^\n]*New company/,
    'the control is gated on a role string rather than on the permission — that is the check the access model converts')
})

test('the destination is declared once and shared', () => {
  assert.match(PICKER, /export const NEW_COMPANY_PATH = '\/portal\/brand\/new'/,
    'the shared path constant is gone — each caller now spells the route itself')
})
