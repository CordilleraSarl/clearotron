// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Navigation is DATA, not JSX.
//
// This is the seam that decides whether the next surface is an extension or a rewrite. A new one must
// land as entries in this array plus screens, with no edit to the sidebar, the drawer, the breadcrumb,
// the active-state logic or the mobile layout.
//
// A sidebar written as JSX with `{role === 'staff' && <NavItem …/>}` cannot do that: every new surface
// touches the shell, and role logic ends up smeared across markup. Here, role gating is one field.

import type { Role } from '../contract/api.ts'

/**
 * Screen ids, and why the dots are where they are.
 *
 * Active-state highlighting is a DOT-PREFIX match (`current === id || current.startsWith(id + '.')`,
 * AppShell). That makes an id's dot structure a behavioural claim, not a naming convention: any entry
 * whose id is a dot-prefix of the current screen lights up.
 *
 * The old scheme filed the brand-owner screens under `settings.*` alongside `settings` itself, so
 * standing on `settings.profile` highlighted the Settings parent — a top-level item claiming to be the
 * page you are on when it is not. The three brand screens are therefore `brand.*` and DELIBERATELY have
 * NO `brand` parent entry: nothing can be a dot-prefix of them, so nothing can falsely highlight. If a
 * `brand` parent is ever added, that guarantee is gone and the bug returns — a test pins this.
 *
 * `admin.*` keeps its dots because there IS an `admin` parent, and highlighting it while on one of its
 * children is exactly right.
 */
export type ScreenId =
  | 'home'
  | 'clearances'
  | 'new'
  | 'ai'
  | 'result'
  | 'preferences'
  | 'about'
  // brand-owner screens — no `brand` parent exists, on purpose (see above)
  | 'brand.profile'
  | 'brand.projects'
  | 'brand.searches'
  // staff administration — dot-scoped under a real parent that SHOULD highlight for them
  | 'admin'
  | 'admin.access'
  | 'admin.config'

export type NavEntry = {
  readonly id: ScreenId
  readonly label: string
  /** URL path under /portal. The SPA reads window.location, so these are real, linkable URLs. */
  readonly path: string
  /** Lucide icon name. Resolved by the shell — this file stays free of imports it does not need. */
  readonly icon: string
  /** Omitted ⇒ visible to everyone. Present ⇒ only these roles see it, and only these roles route to it. */
  readonly roles?: readonly Role[]
  /** Sub-entries revealed when the parent is active. */
  readonly children?: readonly NavEntry[]
  /**
 * A heading above a group of children — the staff-only divider.
 *
 * It read as the operator's own name until. NAV is static module data and the brand seam is a
 * runtime value off /portal/api/me, so the choice was to thread runtime state into a constant or to
 * drop the name. Dropped: the divider sits above staff-only screens and is read by staff, so the
 * operator's name on it was decoration, and decoration is a poor reason to make static data dynamic.
 */
  readonly groupLabel?: string
  /** Routable, but not listed in the sidebar. For screens reached from a row or a link. */
  readonly hidden?: boolean
  /**
   * WHAT THE BRAND OWNER SWITCHER REACHES.
   *
   * `'account'` — the screen spans everything the account holds and IGNORES the switcher.
   * `'owner'`   — the screen is about one brand owner, and the switcher chooses which.
   *
   * This is the field that makes the switcher's scope visible instead of mysterious. The sidebar draws
   * the switcher as the header of the `owner` group, so what it governs is everything printed beneath
   * it — above the line you review across everything, below it you configure and start work for one
   * owner. The top bar reads the same field: it names the scope you are in, the account or the owner.
   *
   * It is NOT a role test. Both groups are identical for everyone who signs in; what differs is how
   * many brand owners they hold, and quantity is a rendering decision, never a layout.
   */
  readonly scope?: 'account' | 'owner'
}

// ARRAY ORDER IS SIDEBAR ORDER — AppShell maps this straight into the nav list.
//
// ── THE LINE, AND WHY IT IS WHERE IT IS ──────────────────────────────────────────────────────────
// Everything with `scope: 'account'` comes first, then the brand-owner switcher, then everything with
// `scope: 'owner'`. Above the line you REVIEW ACROSS EVERYTHING; below it you CONFIGURE AND START WORK
// FOR ONE OWNER. The switcher stops being a filter of unknown reach and becomes the label on the group
// it governs.
//
// Clearances is above the line, with brand owner as one more filter inside it. It is where Home hands
// off ("All clearances →") and Home is account-wide, so an owner-scoped Clearances would break that
// handoff at the seam — and a multi-brand user would have no single archive. It is also already the
// screen built for slicing: filter, sort, search, paging, families. One more filter costs it nothing;
// a second place to be confused about scope costs plenty.
export const NAV: readonly NavEntry[] = [
  // Home leads: it is where the portal opens and it answers "what is happening with my work" before
  // anything is clicked. Clearances stays, as the archive it always was.
  { id: 'home', label: 'Home', path: '/portal/home', icon: 'panel-left', scope: 'account' },
  { id: 'clearances', label: 'Clearances', path: '/portal/clearances', icon: 'layers', scope: 'account' },
  // The engine being model-agnostic and reachable over MCP is a selling point, not a settings detail —
  // and the connector is issued per identity, not per brand owner, so it belongs above the line.
  { id: 'ai', label: 'Use your AI', path: '/portal/ai', icon: 'sparkles', scope: 'account' },

  // ── below the switcher: one brand owner at a time ─────────────────────────────────────────────
  // New clearance leads the group because it is the one ACTION here, and it is owner-specific by
  // nature: a run is started for exactly one brand owner, under that owner's framework and defaults.
  { id: 'new', label: 'New clearance', path: '/portal/new', icon: 'plus-circle', scope: 'owner' },
  // Reached from a row, never from the sidebar — but it must still RESOLVE, or "Open the report" leads
  // to "That page does not exist." `hidden` keeps it out of the nav while keeping it routable; a screen
  // you can navigate to and a screen you can see in a menu are different questions.
  { id: 'result', label: 'Clearance', path: '/portal/result', icon: 'layers', hidden: true },
  // About — the AGPL §13 source offer. `hidden`, and reached from the AVATAR MENU, which
  // renders on every screen: §13 wants the offer available wherever the user is, and the sidebar is
  // the WORK lane. A sidebar item would rank a licence notice above "New clearance" in the visual
  // hierarchy, which is not what it is for. `hidden` is what keeps it routable — routing is derived
  // from this array, so an entry removed to tidy the sidebar turns the menu link into a dead one.
  { id: 'about', label: 'About', path: '/portal/about', icon: 'info', hidden: true },

  // The brand owner's own configuration. Flat by design: there is no `brand` parent entry, so none of
  // these can be falsely highlighted by a dot-prefix match.
  { id: 'brand.profile', label: 'Brand profile', path: '/portal/brand/profile', icon: 'user', scope: 'owner' },
  { id: 'brand.projects', label: 'Brand projects', path: '/portal/brand/projects', icon: 'folder', scope: 'owner' },
  { id: 'brand.searches', label: 'Custom searches', path: '/portal/brand/searches', icon: 'bookmark', scope: 'owner' },

  // Staff administration, now reached from the AVATAR MENU rather than the sidebar — it is rare, it is
  // not part of the work lane, and it belongs to the person rather than to either scope. `hidden`, not
  // deleted: routing is DERIVED from this array, so removing the entries would not tidy the sidebar, it
  // would turn the avatar menu's links into dead ones. The staff role gate stays exactly as it was.
  {
    id: 'admin',
    label: 'Admin settings',
    path: '/portal/admin',
    icon: 'settings',
    roles: ['staff'],
    hidden: true,
    children: [
      { id: 'admin.access', label: 'People & access', path: '/portal/admin/access', icon: 'users', roles: ['staff'], groupLabel: 'Staff' },
      { id: 'admin.config', label: 'Global config', path: '/portal/admin/config', icon: 'server', roles: ['staff'] },
    ],
  },

  // Reached from the avatar menu only — hence `hidden`, not deleted. Routing is DERIVED from this array,
  // so removing the entry would not "take it out of the sidebar", it would turn the avatar menu's link
  // into a dead one. TOP-LEVEL and role-less on purpose: as a child of `admin` (which is staff-gated) it
  // would stop routing for every client, which is precisely who needs it most.
  { id: 'preferences', label: 'Your preferences', path: '/portal/preferences', icon: 'sliders', hidden: true },
]

const visible = (e: NavEntry, role: Role): boolean => !e.roles || e.roles.includes(role)

/**
 * The nav tree as one role sees it. Hidden entries are absent, not disabled.
 *
 * `hidden` applies at BOTH levels. It used to be filtered on top-level entries only, so a hidden child
 * would have been listed in the sidebar anyway — a latent bug that had never fired because no child was
 * hidden yet. It fires the moment one is, and "routable but unlisted" is a shape this file promises.
 *
 * `entries` exists so that clause can be TESTED. Nothing in NAV is a hidden child today, so a test over
 * the real array asserts `undefined !== true` and passes just as happily with the child filter deleted —
 * which is exactly what it did before this parameter existed. Production callers pass one argument.
 */
export function navFor(role: Role, entries: readonly NavEntry[] = NAV): readonly NavEntry[] {
  return entries.filter((e) => visible(e, role) && !e.hidden).map((e) =>
    e.children ? { ...e, children: e.children.filter((c) => visible(c, role) && !c.hidden) } : e,
  )
}

/**
 * The sidebar in two groups, with the brand-owner switcher belonging between them.
 *
 * The split is read off `scope`, never off role and never off a hardcoded id list — so adding a screen
 * puts it on the correct side of the switcher by declaring one field, and cannot put it on the wrong
 * side by being inserted at the wrong index. An entry with no `scope` sorts into `account`: the safe
 * default is "the switcher does not reach this", because a screen wrongly claimed by the switcher
 * silently narrows what someone sees, while one wrongly left out merely ignores it.
 */
export function navGroupsFor(role: Role, entries: readonly NavEntry[] = NAV): {
  readonly account: readonly NavEntry[]
  readonly owner: readonly NavEntry[]
} {
  const visibleEntries = navFor(role, entries)
  return {
    account: visibleEntries.filter((e) => (e.scope ?? 'account') === 'account'),
    owner: visibleEntries.filter((e) => e.scope === 'owner'),
  }
}

/**
 * What the screen you are on is scoped to — which is what the top bar names.
 *
 * An unknown or unscoped screen reads `'account'`, matching navGroupsFor's default: the title then
 * names the account, which is true of every signed-in identity, rather than naming a brand owner the
 * screen may not be showing.
 */
export function scopeOf(id: string | null, entries: readonly NavEntry[] = NAV): 'account' | 'owner' {
  if (!id) return 'account'
  const hit = flatten(entries).find((e) => e.id === id)
  return hit?.scope === 'owner' ? 'owner' : 'account'
}

/**
 * Everything routable for a role, including entries the sidebar does not list.
 *
 * Role-filtered but NOT hidden-filtered, and the asymmetry with navFor is the entire point: `hidden`
 * answers "does this appear in a menu", `roles` answers "may this person reach it at all". Only the
 * second is a boundary.
 */
function routableFor(role: Role, entries: readonly NavEntry[] = NAV): readonly NavEntry[] {
  return entries.filter((e) => visible(e, role)).map((e) =>
    e.children ? { ...e, children: e.children.filter((c) => visible(c, role)) } : e,
  )
}

const flatten = (entries: readonly NavEntry[]): NavEntry[] =>
  entries.flatMap((e) => [e, ...(e.children ? flatten(e.children) : [])])

/**
 * What the avatar menu offers: the things that belong to the PERSON rather than to either scope.
 *
 * Derived from NAV and role-filtered HERE, in the data, for the reason this file opens with: a menu
 * written as `{role === 'staff' && <button …/>}` puts role logic back into markup, and the source scan
 * that checks every navigation target resolves cannot see a JSX guard — it would read a staff-only path
 * as a dead link for clients and be right to. Mapping over a filtered list means a client's menu simply
 * has fewer entries, with no literal in the shell to mislead anyone.
 *
 * Preferences and the admin screens are both `hidden` in NAV: unlisted in the sidebar, still routable,
 * and reached from here.
 */
export function avatarMenuFor(role: Role, entries: readonly NavEntry[] = NAV): readonly NavEntry[] {
  const all = flatten(routableFor(role, entries))
  const pick = (id: string) => all.find((e) => e.id === id)
  // About is LAST and is visible to every role, unlike the three above it. It is the AGPL §13 source
  // offer, which is owed to whoever is using the service — so it is the one entry here that is
  // not about administering anything. The avatar menu is the right home for it precisely because this
  // file's rule holds: it renders on every screen already, it is mapped from data, and adding the entry
  // costs the shell nothing. A sidebar item would have ranked a licence notice above "New clearance"
  // in the work lane, which is not what it is for.
  return [pick('preferences'), pick('admin.access'), pick('admin.config'), pick('about')]
    .filter((e): e is NavEntry => !!e)
}

/**
 * Resolve a URL path to a screen, respecting role.
 *
 * A client who types /portal/admin/config gets `null` — the same as a path that does not exist. The
 * server is the real boundary (that endpoint answers 404 for a client), but the UI must not present a
 * screen it cannot fill, and it must not distinguish "not for you" from "not a thing".
 */
export function screenForPath(path: string, role: Role, entries: readonly NavEntry[] = NAV): NavEntry | null {
  // Query and hash never pick the screen — the path does. Stripping them HERE (not just in the
  // router state) means a target like /portal/new?search=x resolves wherever it is asked about,
  // including from tests that scan the raw navigation literals out of the source.
  const clean = path.replace(/[?#].*$/, '').replace(/\/+$/, '') || '/portal'
  const all = flatten(routableFor(role, entries))
  // Longest match wins, so /portal/admin/config does not resolve to /portal/admin.
  const hits = all.filter((e) => clean === e.path || clean.startsWith(e.path + '/'))
  if (!hits.length) return null
  return hits.reduce((a, b) => (b.path.length > a.path.length ? b : a))
}

/**
 * The screen a bare /portal lands on.
 *
 * Looked up BY ID, never taken as NAV[0]. Where a person lands is a product decision; which item happens
 * to sit at the top of the sidebar is a layout one, and deriving the first from the second means any
 * reordering silently re-points /portal and the sidebar wordmark — and leaves AppShell's not-found
 * button naming one screen while going to another. AppShell prints `HOME.label` on that button, so it
 * follows this lookup rather than the array order.
 */
export const HOME: NavEntry = NAV.find((e) => e.id === 'home') as NavEntry

/**
 * The result screen's own route, so the router can take the arguments off a result URL without holding a
 * second copy of the prefix.
 *
 * /portal/result carries two of them now — the run, and optionally one mark of that run — and
 * the router used to read the LAST path segment. That is the same answer as the first argument only
 * while there is exactly one argument, and it fails silently rather than loudly when a second arrives:
 * the mark slug arrives where the run id belongs, no run matches it, and the screen reports a missing
 * report for a report that is on disk. Reading the tail after this path cannot make that mistake.
 */
export const RESULT: NavEntry = NAV.find((e) => e.id === 'result') as NavEntry

/**
 * The run — and the one name of it — that a result URL names.
 *
 *   /portal/result/<runId>             → { runId, markSlug: null }   the run
 *   /portal/result/<runId>/<markSlug>  → { runId, markSlug }         one name out of a batch
 *
 * Anything else, including the bare route, carries no run and answers `runId: null`. The router turns
 * that into a redirect to the list rather than painting an empty screen.
 *
 * IT LIVES HERE RATHER THAN IN THE ROUTER'S SWITCH ARM so that a URL can be handed to it and the answer
 * asserted. The read this replaced took the path's LAST segment, which is the same answer as the first
 * argument only for as long as the route takes one argument. The two-segment form handed the MARK SLUG
 * over as the run id — no run matched it, and the screen told the reader their report was missing while
 * the document sat on disk. Nothing could reach that read to prove it either way; it was four tokens
 * inside a `case`.
 */
/**
 * The result URL for a run, and optionally for one name of it.
 *
 * The other half of `resultRoute`, and here beside it so the two cannot drift: what this composes, that
 * reads back. Every screen that opens a report goes through it rather than writing the prefix again.
 */
export function resultPath(runId: string, markSlug: string | null = null): string {
  const base = `${RESULT.path}/${encodeURIComponent(runId)}`
  return markSlug === null ? base : `${base}/${encodeURIComponent(markSlug)}`
}

export function resultRoute(pathname: string): { runId: string | null; markSlug: string | null } {
  // Query and hash are not arguments — same rule, and the same reason, as screenForPath above.
  const clean = pathname.replace(/[?#].*$/, '')
  if (!clean.startsWith(RESULT.path + '/')) return { runId: null, markSlug: null }
  const tail = clean.slice(RESULT.path.length + 1).split('/').filter(Boolean)
  const runId = tail[0] ? decode(tail[0]) : null
  return { runId, markSlug: runId !== null && tail[1] ? decode(tail[1]) : null }
}

/**
 * decodeURIComponent, except that a malformed escape returns the segment as typed.
 *
 * `decodeURIComponent('%zz')` THROWS, and this runs inside render: an unescaped percent in a pasted or
 * truncated link would take down the whole screen instead of failing to find a run. The raw segment
 * matches no run either, so the reader gets "we do not have that" — which is the truth about a URL
 * nobody can decode.
 */
function decode(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}
