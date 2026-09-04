// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The top bar: what it says, and what it must never stop saying.
//
// Source-text assertions rather than a rendered DOM — this runner cannot mount a .tsx, and the two facts
// under test are both "is this string in the markup at all", which text can answer honestly.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

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

test('ACCOUNT SURVIVES, LABELLED, in the identity corner', () => {
  // The brand owner moving into the title makes the label on the right matter MORE, not less: two bold
  // names on one bar, one of them a switchable work filter and the other fixed identity, is precisely
  // the conflation the shell's own header warns about. Deleting the label to reduce clutter would be
  // the wrong economy.
  const corner = body.slice(body.indexOf('marginLeft:'))
  assert.match(corner, /className="eyebrow">Account</)
  // — a staff identity is labelled with the OPERATOR, read from the brand seam. It used to be the
  // string literal 'Cordillera', so every fork of this portal labelled its own staff with a Swiss firm's
  // name. Pinned as a source assertion because the failure it guards is silent: a literal put back here
  // renders correctly on the deployment that wrote it and wrongly on every other one.
  assert.match(body, /const accountName = role === 'staff' \? \(me\.brand \|\| null\)/)
  assert.doesNotMatch(body, /role === 'staff' \? '[A-Z]/,
    'the staff label is the brand seam, never a hardcoded operator name')
})

test('ACCOUNT IS RENDERED ONLY WHERE THERE IS A TRUE ANSWER', () => {
  // It used to print `accounts[0]` for any client — right for one grant, and false for a firm holding
  // three, where it picked one of their CLIENTS at random and labelled it their identity. Invisible
  // while the brand owner lived in a rail select; unmissable with the two at either end of one bar.
  assert.match(body, /me\.accounts\.length === 1 \? ownerName\(me\.accounts\[0\]!\) : null/)
  assert.match(body, /!mobile && accountName \?/, 'no answer ⇒ no block, never a placeholder dash')
  assert.doesNotMatch(body, /: '—'/, 'and never a placeholder dash where a name belongs')
})

test('the brand owner is printed ONCE, not three times', () => {
  // The rail carried a static copy of the name for single-owner identities, justified in its own comment
  // by "previously they saw no brand owner anywhere on the page". It is the page title now, so a client
  // was reading their own name in the rail, the title and the Account corner on one screen — and a label
  // repeated three times stops being read anywhere.
  //
  // This survived the switcher moving into the sidebar as the header of the group it governs: with one
  // brand owner there is nothing to switch AND nothing to disambiguate, so the header is absent
  // entirely rather than printing the name a third time.
  assert.match(body, /multiOwner \? \([\s\S]{0,400}BrandOwnerSwitcher[\s\S]{0,200}\) : null/,
    'the group header holds a SWITCHER when there is something to switch, and nothing when there is not')
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

test('the owner keys a screen may offer come from the shell, resolved once', () => {
  // Home needs brand owners that have NO runs, so it cannot derive the list from the run list. Passing
  // the roster the shell already fetched beats a second fetch of the same thing.
  assert.match(body, /readonly ownerKeys: readonly string\[\]/)
  assert.match(body, /ownerName, ownerKeys, go, visit/)
})
