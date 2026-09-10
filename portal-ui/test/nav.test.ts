// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Routing is permission-gated data, and several properties matter enough to pin.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { navFor, navGroupsFor, avatarMenuFor, screenForPath, NAV, HOME, type NavEntry, type Viewer } from '../src/nav/nav.config.ts'

// Three people, and together they cover both switches: the manager, the person who runs clearances, and
// the view-only person. A reader used to be one of two role words; now a reader is what they may do.
const MANAGER: Viewer = { permissions: { run: true, manage: true } }
const RUNNER: Viewer = { permissions: { run: true, manage: false } }
const READER: Viewer = { permissions: { run: false, manage: false } }

test('a screen reached from a row still resolves, even though the sidebar never lists it', () => {
  // The Clearances list links to /portal/result/<runId>. If that resolves to null the user is told
  // "That page does not exist." after clicking Open the report — a dead link inside the product.
  assert.equal(screenForPath('/portal/result/some-run-id', RUNNER)?.id, 'result')
  assert.equal(screenForPath('/portal/result', MANAGER)?.id, 'result')

  // …and it is still absent from the navigation, because it is not a place you go from a menu.
  const ids = navFor(RUNNER).map((e) => e.id)
  assert.equal(ids.includes('result'), false)
  // The sidebar order IS this array's order, so asserting it is asserting the deliverable.
  //
  // The order encodes THE LINE: everything the company switcher does NOT reach comes first (Home, Use
  // your AI), then everything it does. The switcher is drawn between them, so what it governs is
  // exactly what is printed beneath it. Admin is no longer here at all — it moved to the avatar menu,
  // where it belongs to the person rather than to either scope.
  //
  // CLEARANCES SITS BELOW THE LINE. It always filtered its rows by the switcher's value; it merely sat
  // above the line while doing so, which is the disagreement this order corrects.
  assert.deepEqual(ids, ['home', 'ai', 'new', 'clearances', 'brand.profile', 'brand.projects', 'brand.searches'])
})

test('THE LINE: every sidebar entry declares which side of the switcher it is on', () => {
  // A screen with no `scope` sorts into `account` — the safe default, because a screen wrongly claimed
  // by the switcher silently narrows what someone sees, while one wrongly left out merely ignores it.
  // But nothing in the shipped nav should be relying on that default: an undeclared entry is one nobody
  // has decided about.
  for (const e of navFor(RUNNER)) {
    assert.ok(e.scope === 'account' || e.scope === 'owner', `${e.id} does not say which side of the switcher it is on`)
  }
  const g = navGroupsFor(RUNNER)
  assert.deepEqual(g.account.map((e) => e.id), ['home', 'ai'], 'reviewed across everything')
  assert.deepEqual(g.owner.map((e) => e.id), ['new', 'clearances', 'brand.profile', 'brand.projects', 'brand.searches'], 'one company at a time')
  // WHAT DIFFERS BETWEEN PEOPLE IS EXACTLY THE TWO SWITCHES, and each one moves one entry. Manage puts
  // People in the rail above the line; Run is what puts New clearance below it — absent for a person
  // without it, never present and refusing. Nothing else about the page changes shape.
  assert.deepEqual(navGroupsFor(MANAGER).account.map((e) => e.id), ['home', 'ai', 'people'], 'People is in the rail for a manager')
  assert.deepEqual(navGroupsFor(MANAGER).owner.map((e) => e.id), g.owner.map((e) => e.id))
  assert.deepEqual(navGroupsFor(READER).account.map((e) => e.id), ['home', 'ai'])
  assert.deepEqual(navGroupsFor(READER).owner.map((e) => e.id), ['clearances', 'brand.profile', 'brand.projects', 'brand.searches'],
    'no New clearance for a person who cannot start one')
})

test('a manage-only path is indistinguishable, to someone without Manage, from a made-up one', () => {
  assert.equal(screenForPath('/portal/admin/config', MANAGER)?.id, 'admin.config')

  // For a client, a real-but-forbidden staff path answers exactly what a path that was never a path at
  // all answers. Returning null for one and a screen for the other would make the router an oracle for
  // which staff surfaces exist. With the Admin PARENT staff-gated too, that shared answer is now `null`
  // rather than "the parent screen" — the property is the sameness, not which value it settles on.
  assert.equal(screenForPath('/portal/admin/config', RUNNER), null)
  assert.deepEqual(
    screenForPath('/portal/admin/config', RUNNER),
    screenForPath('/portal/admin/not-a-real-screen', RUNNER),
  )
  assert.equal(screenForPath('/portal/nonsense', RUNNER), null)
})

test('without Manage there is no admin surface and no People; with it, People is in the rail and admin in the avatar menu', () => {
  // The refusal is unchanged and is still the boundary: without Manage nobody can ROUTE to these.
  assert.equal(screenForPath('/portal/people', RUNNER), null)
  assert.equal(screenForPath('/portal/people', READER), null)
  assert.equal(screenForPath('/portal/people', MANAGER)?.id, 'people')
  assert.equal(navFor(MANAGER).some((e) => e.id === 'people'), true, 'People is a rail entry, not a menu item')
  assert.equal(navFor(RUNNER).some((e) => e.id === 'people'), false)
  assert.equal(screenForPath('/portal/admin', RUNNER), null)
  assert.equal(navFor(RUNNER).some((e) => e.id.startsWith('admin')), false)

  // What changed is where staff reach it from. NOBODY has it in the sidebar now — it belongs to the
  // person rather than to either scope, and in the sidebar it would have had to sit on one side of the
  // company switcher, claiming to be account-scoped or owner-scoped when it is neither.
  assert.equal(navFor(MANAGER).some((e) => e.id.startsWith('admin')), false, 'not in the staff sidebar either')
  assert.deepEqual(avatarMenuFor(MANAGER).map((e) => e.id), ['preferences', 'admin.config', 'about'],
    'People left the avatar menu for the rail')
  // …and the role gate still lives in the DATA, so a client's menu is simply shorter.
  // About rides here for EVERY role — it is the AGPL §13 source offer, owed to whoever is
  // using the service, so it is the one entry in this menu that is not about administering anything.
  assert.deepEqual(avatarMenuFor(RUNNER).map((e) => e.id), ['preferences', 'about'])
})

test('standing on Brand profile highlights nothing else', () => {
  // The bug this rename exists to prevent: `settings.profile` under a `settings` parent meant the
  // dot-prefix active rule lit up Settings whenever you were on Profile. The expression below is
  // AppShell's, copied verbatim so it cannot drift away from what the sidebar actually does.
  const active = (id: string, current: string) => current === id || current.startsWith(id + '.')
  for (const current of ['brand.profile', 'brand.projects', 'brand.searches']) {
    const lit = navFor(MANAGER).filter((e) => active(e.id, current)).map((e) => e.id)
    assert.deepEqual(lit, [current], `${current} must highlight only itself`)
  }
  // …and the structural reason it holds: nothing is named `brand`, so nothing is a prefix of them.
  const walk = (es: readonly { id: string; children?: readonly never[] }[]): string[] =>
    es.flatMap((e) => [e.id, ...(e.children ? walk(e.children) : [])])
  assert.equal(walk(NAV as never).includes('brand'), false, 'a `brand` parent would re-introduce the false highlight')
})

test('preferences stays routable for everyone while leaving the sidebar', () => {
  assert.equal(screenForPath('/portal/preferences', RUNNER)?.id, 'preferences')
  assert.equal(screenForPath('/portal/preferences', MANAGER)?.id, 'preferences')
  assert.equal(navFor(RUNNER).some((e) => e.id === 'preferences'), false)

  // Its only door is the avatar menu. That door used to be a written-out `go('/portal/preferences')`
  // pinned here as text; the menu is now MAPPED FROM DATA (so no staff-only path is written into the
  // shell — see the admin test), which means the guarantee moves from "the literal is present" to
  // "the entry is in the menu for everyone" and the shell renders the menu at all.
  assert.ok(avatarMenuFor(RUNNER).some((e) => e.id === 'preferences'), 'a client can reach preferences')
  assert.ok(avatarMenuFor(MANAGER).some((e) => e.id === 'preferences'), 'so can staff')
  const shell = readFileSync(new URL('../src/shell/AppShell.tsx', import.meta.url), 'utf8')
  assert.match(shell, /avatarMenuFor\(me\)\.map/, 'and the shell actually renders that menu')
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

  const listed = navFor(MANAGER, fixture)
  assert.deepEqual(listed[0]?.children?.map((c) => c.id), ['p.shown'], 'the hidden child is not listed')

  // The asymmetry that makes `hidden` a menu concern rather than a boundary: it still resolves.
  assert.equal(screenForPath('/portal/p/h', MANAGER, fixture)?.id, 'p.hidden', 'but it is still routable')

  // A hidden TOP-LEVEL entry stays filtered too — the fix must not have traded one level for the other.
  const topHidden = [{ id: 'q', label: 'Q', path: '/portal/q', icon: 'x', hidden: true }] as unknown as readonly NavEntry[]
  assert.deepEqual(navFor(MANAGER, topHidden), [], 'a hidden top-level entry is still absent')
  assert.equal(screenForPath('/portal/q', MANAGER, topHidden)?.id, 'q', 'and still routable')
})

test('the old settings paths do not resolve, so they land on not-found rather than a blank screen', () => {
  // AppShell renders "That page does not exist." for a null entry. These bookmarks are now dead links
  // by design; what must not happen is a match that renders an empty shell.
  for (const p of ['/portal/settings', '/portal/settings/profile', '/portal/settings/preferences', '/portal/settings/config']) {
    assert.equal(screenForPath(p, MANAGER), null, `${p} must not resolve`)
    assert.equal(screenForPath(p, RUNNER), null, `${p} must not resolve`)
  }
})

test('longest match wins, so a sub-screen does not resolve to its parent', () => {
  assert.equal(screenForPath('/portal/brand/profile', RUNNER)?.id, 'brand.profile')
  assert.equal(screenForPath('/portal/admin/config', MANAGER)?.id, 'admin.config')
  assert.equal(screenForPath('/portal/admin', MANAGER)?.id, 'admin')
  assert.equal(screenForPath('/portal/admin/', MANAGER)?.id, 'admin')
})

test('the landing screen is chosen by id, not by whichever entry sits first', () => {
  // HOME is now Home, and it also happens to be NAV[0] — so the ORIGINAL form of this test, which
  // asserted the two differ, can no longer be written. That is worth saying rather than deleting: the
  // point was never that they must differ, it was that HOME is looked up by id so a reorder cannot
  // silently re-point /portal. Asserting the lookup itself keeps that guarantee without depending on an
  // arrangement that has now changed twice.
  assert.equal(HOME.id, 'home')
  assert.equal(screenForPath('/portal/home', RUNNER)?.id, 'home', 'and it resolves for a client')
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
  // WHERE each literal was written, so a target that only resolves for staff can be asked whether its
  // call site is gated. Without this the arm has two answers available — pass everything, or carve the
  // path out by name — and neither of them checks the thing that matters to a client.
  const sites = new Map<string, readonly string[]>()
  for (const f of files) {
    const src = readFileSync(new URL(f, dir), 'utf8')
    for (const line of src.split('\n')) {
      for (const m of line.matchAll(/go\((?:\s*)['"`](\/portal[^'"`$]*)/g)) {
        const t = m[1] as string
        sites.set(t, [...(sites.get(t) ?? []), line])
      }
    }
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
    // must resolve — for a person holding both switches, who can reach every screen there is.
    const target = screenForPath(t, MANAGER)
    assert.ok(target, `${t} is navigated to but does not resolve even with both permissions`)
    // A STAFF-ONLY TARGET IS ALLOWED, AND ONLY BEHIND THE ROLE THAT CAN OPEN IT. The rule this arm
    // holds is that no reader meets a link to a page they cannot open — not that no such path may be
    // written. A blocked client on New clearance needs to be sent somewhere; a client cannot read the
    // configuration route at all, so the honest answer is that the link is not drawn for them, and
    // what has to be checked is that it is not drawn for them. Every line writing a staff-only literal
    // carries the role test on the same line, which is exactly the shape a reviewer can see. A carve-out
    // by path name would have asserted nothing about the call site and passed a bare link forever.
    // THE GATE IS READ OFF THE TARGET'S OWN `needs`, not off a list of paths. A literal to a screen that
    // needs Run must sit behind `canRun`, one that needs Manage behind `canManage`: a view-only person
    // shown a New clearance button meets "That page does not exist" as surely as someone without Manage
    // shown a settings link. Deriving the gate from the entry means a newly gated screen is covered by
    // declaring its `needs`, with nothing here to update.
    const needs = target?.needs
    if (needs) {
      const gate = needs === 'run' ? 'canRun' : 'canManage'
      // THE LINE SCAN MUST HAVE FOUND THIS TARGET, or the check below iterates nothing and passes.
      // `targets` is collected over the whole file and `sites` line by line with the same pattern, and
      // `\s*` spans newlines — so a `go(` whose path sits on the next line is in the first set and not
      // the second, the loop runs zero times, and a staff-only link with no gate at all ships green.
      // Driven before this line existed: an ungated call, wrapped across two lines, passed.
      //
      // The failure is silence, so the fix is to refuse it rather than to widen the pattern. Widening
      // would move the blind spot rather than close it; this says "I could not look" in the one place
      // where not looking reads as a pass. Same shape as the `targets.size >= 4` drift guard above.
      const lines = sites.get(t) ?? []
      assert.ok(lines.length,
        `${t} does not resolve for a client, and the line scan found no call site for it — the gate `
        + `check cannot run. The literal is probably wrapped across two lines; put it on one.`)
      for (const line of lines) {
        // THE TARGET MUST SIT IN THE TRUE BRANCH, not merely on a line that mentions the role. The
        // first version of this asserted the line contained `role === 'staff'` anywhere, and
        // `role === 'staff' ? null : go(target)` passed it — the gate inverted, which is the failure
        // this arm is for, arriving in the shape the arm was watching for. Everything between the `?`
        // and the first `:` is the staff branch; a path carries no colon of its own, so that window
        // is exact for these literals.
        //
        // AND IT IS A TEXT HEURISTIC, said plainly: it reads one line, so a gate written across two
        // lines, or in a variable computed above, is invisible to it and reads as ungated. That is
        // the safe direction — it refuses what it cannot see rather than passing it — but it is not
        // a proof that no client can reach the link.
        // EVERY metacharacter in the target is escaped, not only `/` and `.`: a target carrying a query
        // string — `/portal/new?search=` — otherwise reads its `?` as a quantifier and can never match
        // the line it sits on. Invisible until a query-string target was the one needing a gate.
        const trueBranch = new RegExp(`${gate}\\(ctx\\.me\\)\\s*\\?[^:]*${t.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`)
        assert.match(line, trueBranch,
          `${t} needs ${needs} and is not inside the true branch of ${gate}(ctx.me) on the line that `
          + `navigates to it: ${line.trim()}`)
      }
    }
  }
})
