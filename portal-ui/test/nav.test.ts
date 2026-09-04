// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Routing is role-gated data, and several properties matter enough to pin.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { navFor, navGroupsFor, avatarMenuFor, screenForPath, NAV, HOME, type NavEntry } from '../src/nav/nav.config.ts'

test('a screen reached from a row still resolves, even though the sidebar never lists it', () => {
  // The Clearances list links to /portal/result/<runId>. If that resolves to null the user is told
  // "That page does not exist." after clicking Open the report — a dead link inside the product.
  assert.equal(screenForPath('/portal/result/some-run-id', 'client')?.id, 'result')
  assert.equal(screenForPath('/portal/result', 'staff')?.id, 'result')

  // …and it is still absent from the navigation, because it is not a place you go from a menu.
  const ids = navFor('client').map((e) => e.id)
  assert.equal(ids.includes('result'), false)
  // The sidebar order IS this array's order, so asserting it is asserting the deliverable.
  //
  // The order now encodes THE LINE: everything the brand-owner switcher does NOT reach comes first
  // (Home, Clearances, Use your AI), then everything it does (New clearance and the brand screens).
  // The switcher is drawn between them, so what it governs is exactly what is printed beneath it.
  // Admin is no longer here at all — it moved to the avatar menu, where it belongs to the person
  // rather than to either scope.
  assert.deepEqual(ids, ['home', 'clearances', 'ai', 'new', 'brand.profile', 'brand.projects', 'brand.searches'])
})

test('THE LINE: every sidebar entry declares which side of the switcher it is on', () => {
  // A screen with no `scope` sorts into `account` — the safe default, because a screen wrongly claimed
  // by the switcher silently narrows what someone sees, while one wrongly left out merely ignores it.
  // But nothing in the shipped nav should be relying on that default: an undeclared entry is one nobody
  // has decided about.
  for (const e of navFor('client')) {
    assert.ok(e.scope === 'account' || e.scope === 'owner', `${e.id} does not say which side of the switcher it is on`)
  }
  const g = navGroupsFor('client')
  assert.deepEqual(g.account.map((e) => e.id), ['home', 'clearances', 'ai'], 'reviewed across everything')
  assert.deepEqual(g.owner.map((e) => e.id), ['new', 'brand.profile', 'brand.projects', 'brand.searches'], 'one owner at a time')
  // Staff differ only in QUANTITY of brand owners, never in the shape of the page.
  assert.deepEqual(navGroupsFor('staff').account.map((e) => e.id), g.account.map((e) => e.id))
  assert.deepEqual(navGroupsFor('staff').owner.map((e) => e.id), g.owner.map((e) => e.id))
})

test('a staff-only path is indistinguishable, to a client, from a made-up one', () => {
  assert.equal(screenForPath('/portal/admin/config', 'staff')?.id, 'admin.config')

  // For a client, a real-but-forbidden staff path answers exactly what a path that was never a path at
  // all answers. Returning null for one and a screen for the other would make the router an oracle for
  // which staff surfaces exist. With the Admin PARENT staff-gated too, that shared answer is now `null`
  // rather than "the parent screen" — the property is the sameness, not which value it settles on.
  assert.equal(screenForPath('/portal/admin/config', 'client'), null)
  assert.deepEqual(
    screenForPath('/portal/admin/config', 'client'),
    screenForPath('/portal/admin/not-a-real-screen', 'client'),
  )
  assert.equal(screenForPath('/portal/nonsense', 'client'), null)
})

test('a client sees no admin surface anywhere, and admin left the sidebar for the avatar menu', () => {
  // The refusal is unchanged and is still the boundary: a client cannot ROUTE to an admin screen.
  assert.equal(screenForPath('/portal/admin/access', 'client'), null)
  assert.equal(screenForPath('/portal/admin', 'client'), null)
  assert.equal(navFor('client').some((e) => e.id.startsWith('admin')), false)

  // What changed is where staff reach it from. NOBODY has it in the sidebar now — it belongs to the
  // person rather than to either scope, and in the sidebar it would have had to sit on one side of the
  // brand-owner switcher, claiming to be account-scoped or owner-scoped when it is neither.
  assert.equal(navFor('staff').some((e) => e.id.startsWith('admin')), false, 'not in the staff sidebar either')
  assert.deepEqual(avatarMenuFor('staff').map((e) => e.id), ['preferences', 'admin.access', 'admin.config', 'about'])
  // …and the role gate still lives in the DATA, so a client's menu is simply shorter.
  // About rides here for EVERY role — it is the AGPL §13 source offer, owed to whoever is
  // using the service, so it is the one entry in this menu that is not about administering anything.
  assert.deepEqual(avatarMenuFor('client').map((e) => e.id), ['preferences', 'about'])
})

test('standing on Brand profile highlights nothing else', () => {
  // The bug this rename exists to prevent: `settings.profile` under a `settings` parent meant the
  // dot-prefix active rule lit up Settings whenever you were on Profile. The expression below is
  // AppShell's, copied verbatim so it cannot drift away from what the sidebar actually does.
  const active = (id: string, current: string) => current === id || current.startsWith(id + '.')
  for (const current of ['brand.profile', 'brand.projects', 'brand.searches']) {
    const lit = navFor('staff').filter((e) => active(e.id, current)).map((e) => e.id)
    assert.deepEqual(lit, [current], `${current} must highlight only itself`)
  }
  // …and the structural reason it holds: nothing is named `brand`, so nothing is a prefix of them.
  const walk = (es: readonly { id: string; children?: readonly never[] }[]): string[] =>
    es.flatMap((e) => [e.id, ...(e.children ? walk(e.children) : [])])
  assert.equal(walk(NAV as never).includes('brand'), false, 'a `brand` parent would re-introduce the false highlight')
})

test('preferences stays routable for everyone while leaving the sidebar', () => {
  assert.equal(screenForPath('/portal/preferences', 'client')?.id, 'preferences')
  assert.equal(screenForPath('/portal/preferences', 'staff')?.id, 'preferences')
  assert.equal(navFor('client').some((e) => e.id === 'preferences'), false)

  // Its only door is the avatar menu. That door used to be a written-out `go('/portal/preferences')`
  // pinned here as text; the menu is now MAPPED FROM DATA (so no staff-only path is written into the
  // shell — see the admin test), which means the guarantee moves from "the literal is present" to
  // "the entry is in the menu for everyone" and the shell renders the menu at all.
  assert.ok(avatarMenuFor('client').some((e) => e.id === 'preferences'), 'a client can reach preferences')
  assert.ok(avatarMenuFor('staff').some((e) => e.id === 'preferences'), 'so can staff')
  const shell = readFileSync(new URL('../src/shell/AppShell.tsx', import.meta.url), 'utf8')
  assert.match(shell, /avatarMenuFor\(role\)\.map/, 'and the shell actually renders that menu')
})

test('navFor drops a hidden child, while screenForPath still finds it', () => {
  // `hidden` used to be honoured on top-level entries only. Nothing was a hidden child at the time, so
  // nothing broke; the filter is fixed here rather than waiting for the first one to appear wrongly.
  //
  // This drives the REAL navFor and the REAL screenForPath through their entries seam. An earlier
  // version of this test re-implemented the filter on a local array and then looped over NAV asserting
  // `c.hidden !== true` — which, with no hidden child in NAV, compared undefined to true twice and
  // passed just as well with the clause deleted. The seam exists precisely so this cannot happen.
  const fixture = [{ id: 'p', label: 'P', path: '/portal/p', icon: 'x', children: [
    { id: 'p.shown', label: 'S', path: '/portal/p/s', icon: 'x' },
    { id: 'p.hidden', label: 'H', path: '/portal/p/h', icon: 'x', hidden: true },
  ] }] as unknown as readonly NavEntry[]

  const listed = navFor('staff', fixture)
  assert.deepEqual(listed[0]?.children?.map((c) => c.id), ['p.shown'], 'the hidden child is not listed')

  // The asymmetry that makes `hidden` a menu concern rather than a boundary: it still resolves.
  assert.equal(screenForPath('/portal/p/h', 'staff', fixture)?.id, 'p.hidden', 'but it is still routable')

  // A hidden TOP-LEVEL entry stays filtered too — the fix must not have traded one level for the other.
  const topHidden = [{ id: 'q', label: 'Q', path: '/portal/q', icon: 'x', hidden: true }] as unknown as readonly NavEntry[]
  assert.deepEqual(navFor('staff', topHidden), [], 'a hidden top-level entry is still absent')
  assert.equal(screenForPath('/portal/q', 'staff', topHidden)?.id, 'q', 'and still routable')
})

test('the old settings paths do not resolve, so they land on not-found rather than a blank screen', () => {
  // AppShell renders "That page does not exist." for a null entry. These bookmarks are now dead links
  // by design; what must not happen is a match that renders an empty shell.
  for (const p of ['/portal/settings', '/portal/settings/profile', '/portal/settings/preferences', '/portal/settings/config']) {
    assert.equal(screenForPath(p, 'staff'), null, `${p} must not resolve`)
    assert.equal(screenForPath(p, 'client'), null, `${p} must not resolve`)
  }
})

test('longest match wins, so a sub-screen does not resolve to its parent', () => {
  assert.equal(screenForPath('/portal/brand/profile', 'client')?.id, 'brand.profile')
  assert.equal(screenForPath('/portal/admin/access', 'staff')?.id, 'admin.access')
  assert.equal(screenForPath('/portal/admin', 'staff')?.id, 'admin')
  assert.equal(screenForPath('/portal/admin/', 'staff')?.id, 'admin')
})

test('the landing screen is chosen by id, not by whichever entry sits first', () => {
  // HOME is now Home, and it also happens to be NAV[0] — so the ORIGINAL form of this test, which
  // asserted the two differ, can no longer be written. That is worth saying rather than deleting: the
  // point was never that they must differ, it was that HOME is looked up by id so a reorder cannot
  // silently re-point /portal. Asserting the lookup itself keeps that guarantee without depending on an
  // arrangement that has now changed twice.
  assert.equal(HOME.id, 'home')
  assert.equal(screenForPath('/portal/home', 'client')?.id, 'home', 'and it resolves for a client')
  assert.ok(NAV.some((e) => e.id === 'home'), 'HOME is a real entry, not a synthesised one')
})

test('every routable entry has a unique id and a path under /portal', () => {
  const walk = (es: readonly { id: string; path: string; children?: readonly never[] }[]): string[] =>
    es.flatMap((e) => [e.id, ...(e.children ? walk(e.children) : [])])
  const ids = walk(NAV as never)
  assert.equal(new Set(ids).size, ids.length, 'duplicate ids would make two screens fight over one route')
  const paths = (function collect(es: readonly { path: string; children?: readonly never[] }[]): string[] {
    return es.flatMap((e) => [e.path, ...(e.children ? collect(e.children) : [])])
  })(NAV as never)
  for (const p of paths) assert.match(p, /^\/portal\//, `${p} must live under the one ingress`)
})

test('every in-app navigation target is a route that resolves', () => {
  // THE BUG THIS EXISTS FOR: the composer's retire control called go('/portal/settings/searches'),
  // a path that stopped being a route when the brand screens moved to the top level. Nothing failed —
  // it silently rendered "That page does not exist." from inside the product. The test above pins the
  // dead paths it knew about; this one pins the direction that actually matters, which is that no
  // screen may point at a path the router cannot answer.
  //
  // Read as TEXT because a node --test runner cannot mount the screens, the same technique the
  // preferences link above uses. A literal is the only form a scan can see, so a computed path would
  // slip past — which is the reason every one of these is written out in full today.
  const dir = new URL('../src/', import.meta.url)
  const files = [
    'main.tsx', 'shell/AppShell.tsx',
    ...['Home', 'Clearances', 'NewClearance', 'Projects', 'Result', 'SavedSearches', 'Profile',
        'Preferences', 'UseYourAI', 'PeopleAccess', 'GlobalConfig'].map((s) => `screens/${s}.tsx`),
  ]
  const targets = new Set<string>()
  for (const f of files) {
    const src = readFileSync(new URL(f, dir), 'utf8')
    // The RAW literal is what gets asserted — query string and all. This test once stripped the `?`
    // itself before asking screenForPath, which let `go('/portal/new?search=x')` dead-end in the app
    // while the test stayed green (found 2026-07-22): go() used to store the full string in router
    // state, and no screen matched a path carrying a query. screenForPath now strips query/hash as
    // the router's own behaviour, so asserting the raw literal proves the real navigation resolves.
    // A template literal contributes the part before its first ${…}, which is enough — the screen is
    // decided by the path, and the path is complete before the first interpolation.
    for (const m of src.matchAll(/go\((?:\s*)['"`](\/portal[^'"`$]*)/g)) targets.add(m[1] as string)
  }
  assert.ok(targets.size >= 4, 'the scan found almost nothing — the pattern has drifted, not the code')
  for (const t of targets) {
    // A run id is appended at runtime, so the bare /portal/result is what the literal carries and what
    // must resolve. Both roles, because a client landing on a staff-only literal is the same dead end.
    assert.ok(screenForPath(t, 'staff'), `${t} is navigated to but does not resolve for staff`)
    assert.ok(screenForPath(t, 'client'), `${t} is navigated to but does not resolve for a client`)
  }
})
