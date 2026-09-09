// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The top bar: what it says, and what it must never stop saying.
//
// Source-text assertions rather than a rendered DOM — this runner cannot mount a .tsx, and the two facts
// under test are both "is this string in the markup at all", which text can answer honestly.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const shell = readFileSync(new URL('../src/shell/AppShell.tsx', import.meta.url), 'utf8')
/** The markup with commentary stripped, so a comment explaining a rule cannot satisfy the rule. */
const body = shell.split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n')

test('THE TOP-BAR TITLE NAMES THE SCOPE YOU ARE IN, not the screen', () => {
  // The screen name earned nothing up there — the sidebar already highlights the active item.
  //
  // It says the BRAND OWNER on an owner-scoped screen and the ACCOUNT on an account-scoped one, and
  // that it varies is the point rather than an inconsistency: Home and Clearances span everything the
  // account holds and deliberately ignore the switcher, so naming one brand owner over them would
  // assert a filter that is not being applied. Read off the screen's own `scope` — the same field that
  // decides which side of the switcher it sits on — so the two can never disagree.
  assert.match(body, /scopeOf\(entry\.id\) === 'owner' \? ownerName\(ownerInView\) : accountName/)
  assert.doesNotMatch(body, /<h1>\{entry\?\.label/, 'the screen label no longer heads the page')
})

test('THE ORGANISATION SURVIVES, LABELLED, in the identity corner', () => {
  // The company moving into the title makes the label on the right matter MORE, not less: two bold names
  // on one bar, one of them a switchable work filter and the other fixed identity, is precisely the
  // conflation the shell's own header warns about. Deleting the label to reduce clutter would be the
  // wrong economy — and with both nouns on screen at once, an unlabelled name is the conflation itself.
  const corner = body.slice(body.indexOf('marginLeft:'))
  assert.match(corner, /className="eyebrow">Organisation</)
  assert.doesNotMatch(corner, /className="eyebrow">Account</, 'the account noun is retired from the bar')
  // — a staff identity is labelled with the OPERATOR, read from the brand seam. It used to be the
  // string literal 'Cordillera', so every fork of this portal labelled its own staff with a Swiss firm's
  // name. Pinned as a source assertion because the failure it guards is silent: a literal put back here
  // renders correctly on the deployment that wrote it and wrongly on every other one.
  assert.match(body, /const accountName = me\.brand \|\| null/)
  assert.doesNotMatch(body, /role === 'staff' \? '[A-Z]/,
    'the operator label is the brand seam, never a hardcoded operator name')
})

test('THE IDENTITY CORNER IS RENDERED ONLY WHERE THERE IS A TRUE ANSWER', () => {
  // It used to print `accounts[0]` for any client — right for one grant, and false for a firm holding
  // three, where it picked one of their CLIENTS at random and labelled it their identity. That whole
  // branch is gone; the slot now carries the organisation and nothing else. What survives is the rule
  // that produced it: an answer we do not have is not rendered.
  assert.match(body, /const accountName = me\.brand \|\| null/)
  assert.match(body, /!mobile && accountName \?/, 'no answer ⇒ no block, never a placeholder dash')
  assert.doesNotMatch(body, /: '—'/, 'and never a placeholder dash where a name belongs')
})

test('ONE SLOT, ONE NOUN: the identity corner can never name a company', () => {
  // A client once read their own name in the rail, in the page title AND in the identity corner on one
  // screen, and a label repeated three times stops being read anywhere. That used to be prevented by
  // hiding the rail switcher when there was only one company to switch between — which the owner then
  // overturned, because a control that materialises when a second company appears reads as a bug.
  //
  // So the guarantee moved to where it is structural rather than conditional: the identity corner
  // resolves the ORGANISATION and has no path to a company name at all. The company is read in two
  // places, the rail and the heading, on every install and for every role.
  //
  // Pinned as the property, not as the old expression: the derivation may be rewritten, but it may not
  // start depending on the company again.
  const derivation = /const accountName = .*/.exec(body)?.[0] ?? ''
  assert.ok(derivation, 'the identity corner resolves its name in one place')
  assert.doesNotMatch(derivation, /ownerName|accounts\[/,
    'the identity corner names the organisation and can reach no company name')
  assert.match(body, /const accountName = me\.brand/, 'and it reads the organisation from the brand seam')
})

test('THE SWITCHER LABELS THE GROUP IT GOVERNS', () => {
  // What the brand-owner control actually reaches used to be unknowable: it floated above the whole
  // nav, and the only way to find out which screens it changed was to pick one and watch. Drawn as the
  // header of the `owner` group, its reach is simply what is printed beneath it.
  //
  // The split is read off each entry's `scope`, never off role and never off a hardcoded id list — so a
  // new screen lands on the correct side by declaring one field, and cannot land on the wrong side by
  // being inserted at the wrong index.
  assert.match(body, /navGroupsFor\(role\)/)
  assert.match(body, /entries=\{groups\.account\}/)
  assert.match(body, /entries=\{groups\.owner\}/)
  assert.doesNotMatch(body, /navFor\(role\)/, 'the sidebar is drawn from the two groups, never as one flat list')
})

test('the avatar menu is MAPPED FROM DATA — no role guard around a staff path in the markup', () => {
  // nav.config's own opening rule: role gating is one field there, never `{role === 'staff' && …}` in
  // the shell. It is also load-bearing for the test that scans every navigation literal and checks it
  // resolves for BOTH roles — that scan cannot see a JSX guard, so a staff-only literal in the markup
  // reads as a dead link for clients, and it would be right to.
  assert.match(body, /avatarMenuFor\(role\)\.map/)
  assert.doesNotMatch(body, /go\('\/portal\/admin/, 'no admin path is written out in the shell')
})

test('the company list a screen may offer comes from the shell, resolved once', () => {
  // Home needs companies that have NO runs, so it cannot derive the list from the run list. Passing the
  // roster the shell already fetched beats a second fetch of the same thing.
  //
  // PINNED TO THE PROPERTY, NOT TO THE ARGUMENT SPELLING. This read `/ownerName, ownerKeys, go, visit/`
  // — a fixed neighbour sequence, which reds on any added context field and says "the spelling moved"
  // while sounding like "a screen started fetching its own list". The repair that turns it green is to
  // paste in the new spelling, which keeps the sentence and drops the guarantee. What actually has to
  // hold is below: the fields are on the context, they reach the one render call, and NO SCREEN FETCHES
  // THE ROSTER FOR ITSELF.
  assert.match(body, /readonly ownerKeys: readonly string\[\]/)
  assert.match(body, /readonly factsFor: \(key: string\) => CompanyFacts \| undefined/)

  const renderCall = /\brender\(entry\.id, \{([\s\S]*?)\}\)/.exec(body)
  assert.ok(renderCall, 'the shell renders the active screen through one call')
  for (const field of ['ownerKeys', 'factsFor', 'ownerName', 'setOwner']) {
    assert.match(renderCall[1]!, new RegExp(`\\b${field}\\b`),
      `${field} reaches every screen through the shell, so no screen resolves it twice`)
  }
})

test('no screen fetches the company roster for itself', () => {
  // The guarantee the test above used to make by accident. A screen that fetched its own roster would
  // hold a second list that drifts from the rail's — the "second piece of state" defect by construction.
  const dir = new URL('../src/screens/', import.meta.url)
  const screens = readdirSync(dir).filter((f) => f.endsWith('.tsx'))

  // A FLOOR ON THE POPULATION FIRST. A glob that matched nothing would pass this test in silence and
  // say nothing about any screen at all.
  assert.ok(screens.length >= 8, `expected the screens directory to be populated, found ${screens.length}`)

  for (const f of screens) {
    assert.doesNotMatch(readFileSync(new URL(f, dir), 'utf8'), /api\.roster\(/,
      `${f} resolves companies through the shell context, never by fetching the roster again`)
  }
})
