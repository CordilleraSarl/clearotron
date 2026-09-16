// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — MAKING A COMPANY IS REACHABLE ONCE ONE IS SELECTED, from every Company settings page.
//
// Found by the owner on the test box. `+ New company` lived on the pick panel and nowhere else, and
// choosing a company is precisely what hides that panel — so the person doing the work had no route to a
// second company and nothing on screen saying where one was.
//
// NOT THE RAIL, and that was decided rather than skipped: a staff-only rail entry breaks the rule that
// staff and clients see the same page shape, which is why staff administration was moved out of the rail
// in the first place. The switcher's own action row was the owner's preferred placement; it landed on his
// ruling of 2026-09-11 and is pinned at the foot of this file.
//
// This suite has no renderer and reads source, as its own files say. It pins the GATE and the
// DESTINATION — the two things that must not drift from the pick panel's control — rather than the
// markup around them.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { prose } from './support/prose.ts'

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')
const PICKER = read('../src/shell/CompanyPicker.tsx')
const BUTTON = read('../src/shell/NewCompanyButton.tsx')
// ALL THREE COMPANY SETTINGS PAGES, not Profile alone. The route was put on Profile because it is where
// somebody already is; the design puts it on Projects and Search templates too, and a page that lost it
// would be a selected company hiding the route again, one page over.
const PAGES = [['Profile', read('../src/screens/Profile.tsx')], ['Projects', read('../src/screens/Projects.tsx')],
  ['SavedSearches', read('../src/screens/SavedSearches.tsx')]] as const

test('every Company settings page offers a route to making a company', () => {
  for (const [name, src] of PAGES) {
    assert.match(src, /<NewCompanyButton ctx=\{ctx\} \/>/,
      `${name} offers no way to make a company, so a selected company again hides the only route`)
    assert.match(src, /import \{ NewCompanyButton \} from '\.\.\/shell\/NewCompanyButton\.tsx'/,
      `${name} draws its own copy of the control instead of the shared one`)
  }
  assert.match(BUTTON, /\+ New company/, 'the shared control no longer says what it does')
  assert.match(BUTTON, /ctx\.go\(NEW_COMPANY_PATH\)/,
    'the control does not go to the shared path constant — a second spelling of the destination is a second thing to keep in step')
})

test('it is gated by the same predicate as the pick panel, not a second one', () => {
  // THE HAZARD IS DRIFT, not absence. Two controls that create the same thing behind two different role
  // tests is how one of them ends up offered to somebody the other refuses.
  assert.match(BUTTON, /if \(!canManage\(ctx\.me\)\) return null/,
    'the shared control is not Manage-gated — it may be offered to somebody who cannot create')
  assert.match(PICKER, /canManage\(ctx\.me\)/,
    'the pick panel stopped using canManage, so the two controls now answer to different rules')

  // Both import the gate rather than re-deriving it. A role comparison written out here would pass this
  // file and diverge the day the access model converts the field.
  assert.match(BUTTON, /import \{ canManage \} from '\.\/permissions\.ts'/,
    'the shared control derives its own permission instead of importing the one definition')
  // Read off the prose: the pages' comments name the control while explaining where it sits.
  for (const [name, src] of PAGES) {
    assert.doesNotMatch(prose(src), /\+ New company/, `${name} writes a second + New company of its own beside the shared one`)
  }
})

test('the destination is declared once and shared', () => {
  assert.match(PICKER, /export const NEW_COMPANY_PATH = '\/portal\/brand\/new'/,
    'the shared path constant is gone — each caller now spells the route itself')
})

// ── THE SWITCHER, ON THE OWNER'S RULING OF 2026-09-11 ─────────────────────────────────────────────────
//
// "+ New company goes into the company switcher drop-down in the nav bar": the menu a person opens to pick
// a company, so making one is one click from every screen, whether or not a company is selected. The pick
// panel and the Company profile keep theirs. The switcher is a native select, so the action is an option;
// these arms pin what makes an option safe to be an action rather than a company.
const SHELL = read('../src/shell/AppShell.tsx')

test('the company switcher offers + New company, behind the same gate and to the same place', () => {
  assert.match(SHELL, /<option value=\{NEW_COMPANY_OPTION\} data-action="new-company">\+ New company<\/option>/,
    'the switcher offers no way to make a company — the one menu on every screen does not carry it')
  assert.match(SHELL, /onAdd=\{canManage\(me\) \? \(\) => go\(NEW_COMPANY_PATH\) : undefined\}/,
    'the switcher\'s action is not gated by canManage or does not go to the shared path through the guarded go')
  assert.match(SHELL, /import \{ canManage \} from '\.\/permissions\.ts'/, 'the shell derives its own permission')
  assert.match(SHELL, /\{onAdd \? \(\s*<option value=\{NEW_COMPANY_OPTION\}/,
    'the option renders whether or not the person may create — a client would be offered it')
})

test('choosing + New company never switches company', () => {
  // The select is controlled and its change handler is the company switch. If the action's value reached
  // `onChange`, the person would be "in" a company called ":new-company" — every screen keyed on it.
  assert.match(SHELL, /onChange=\{\(e\) => \(e\.target\.value === NEW_COMPANY_OPTION \? onAdd\?\.\(\) : onChange\(e\.target\.value \|\| null\)\)\}/,
    'the action value is not intercepted before the switch')
  // And the value cannot collide with a company: keys are slugs, and a slug has no colon.
  assert.match(SHELL, /const NEW_COMPANY_OPTION = ':new-company'/, 'the action value is no longer outside the key alphabet')
})
