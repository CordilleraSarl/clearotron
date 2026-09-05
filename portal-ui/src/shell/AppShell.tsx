// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The persistent shell: sidebar, top bar, and the one place a screen is chosen.
//
// Two nouns are kept rigidly apart here, because the design pack is emphatic about it and because
// conflating them is how a filter turns into a security boundary in someone's head:
//
//   ACCOUNT     — who you signed in as (the tenant). Fixed identity. Never switchable in the app.
//   BRAND OWNER — the client a clearance is FOR. A work filter, switchable, purely presentational.
//
// The server enforces the account; the brand-owner switcher only narrows what is already permitted.

import { useCallback, useEffect, useState } from 'react'
// React 19's @types/react removed the GLOBAL `JSX` namespace — it lives under `React.JSX` now. Importing
// the type is better than reaching for the namespace either way: it says where the type comes from, and
// it does not depend on a global that a future types major can move again.
import type { ReactElement } from 'react'
import type { Me, Role } from '../contract/api.ts'
import { api, staffLabel, onSessionEnded } from '../contract/api.ts'
import { navGroupsFor, avatarMenuFor, scopeOf, screenForPath, HOME, type NavEntry, type ScreenId } from '../nav/nav.config.ts'
import { Icon } from '../components/Icon.tsx'
import { Logo, WORDMARK } from '../components/Logo.tsx'
import { useLoad } from '../state/useApi.ts'
import { confirmDiscard, attachBeforeUnload } from '../state/guard.ts'
import { ALL_OWNERS, ownerNameMap, ownerNameFrom, sortOwners } from '../contract/ownerNames.ts'

const MOBILE = '(max-width: 899px)'

function useIsMobile(): boolean {
  const [m, setM] = useState(() => window.matchMedia(MOBILE).matches)
  useEffect(() => {
    const mq = window.matchMedia(MOBILE)
    const on = (e: MediaQueryListEvent) => setM(e.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return m
}

/** Theme, on the same localStorage key every other Cordillera surface uses. */
function useTheme(): [string, () => void] {
  const [theme, setTheme] = useState<string>(() => document.documentElement.getAttribute('data-theme') ?? 'light')
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', next)
    // Wrapped because localStorage throws in a null-origin context, and a theme toggle must never be
    // the thing that breaks a page.
    try {
      localStorage.setItem('cordillera-theme', next)
    } catch {
      /* private mode, or a sandboxed frame */
    }
    setTheme(next)
  }
  return [theme, toggle]
}

/** Client-side routing over real URLs, so every screen is linkable and Back works. */
function usePath(): [string, (p: string, opts?: { replace?: boolean }) => void, number] {
  // State tracks path AND query; the returned path is the pathname alone. Both halves matter:
  // the screen is decided by the pathname (a target carrying ?query must still resolve), but a
  // navigation that changes ONLY the query (edit search X → fresh composer, same /portal/new)
  // must still re-render — a pathname-only state would be unchanged and React would bail out,
  // leaving the old screen instance (and its ?search-keyed mount) on screen under the new URL.
  const [loc, setLoc] = useState(() => window.location.pathname + window.location.search)
  useEffect(() => {
    const on = () => setLoc(window.location.pathname + window.location.search)
    window.addEventListener('popstate', on)
    return () => window.removeEventListener('popstate', on)
  }, [])
  // NAVIGATING TO WHERE YOU ALREADY ARE IS STILL A REQUEST, AND IT HAD NO EFFECT.
  //
  // Press "New clearance" from a submitted clearance and nothing happened: `go` computed a location byte-
  // identical to the current one, React bailed out of `setLoc`, and even had it re-rendered the composer's
  // key was '' before and '' after, so it reconciled in place with `submitted` intact. The user sat on
  // "Clearance started" and had to visit another screen and come back.
  //
  // The earlier fix addressed the sibling case — a query CHANGE (edit search X → fresh composer) — and
  // correctly; it just does not reach a navigation that changes neither path nor query. A monotonic nonce
  // in the state makes "go here again" a distinct render, and it is folded into the screen key below, so
  // this works for every screen rather than only the composer.
  const [visit, setVisit] = useState(0)
  const go = (p: string, opts?: { replace?: boolean }) => {
    // THE GUARD SITS HERE BECAUSE THIS IS THE FUNNEL. Every nav item, every in-screen link and every
    // redirect goes through this one function, so asking here covers the ones nobody has written yet.
    // A `replace` navigation is exempt: those are corrections the app makes to its own URL (the bare
    // /portal/result redirect), never a user leaving a page, and prompting on one would be baffling.
    if (!opts?.replace && !confirmDiscard('Leave this page?')) return
    if (opts?.replace) window.history.replaceState(null, '', p)
    else window.history.pushState(null, '', p)
    const u = new URL(p, window.location.origin)
    const next = u.pathname + u.search
    // Only a REPEAT of the same location needs the nonce. Bumping it on every navigation would remount
    // screens that were going to remount anyway, throwing away scroll position for nothing.
    if (next === loc && !opts?.replace) setVisit((n) => n + 1)
    setLoc(next)
  }
  return [loc.replace(/\?.*$/, ''), go, visit]
}

function NavList({
  entries,
  current,
  go,
  collapsed,
}: {
  readonly entries: readonly NavEntry[]
  readonly current: ScreenId | null
  readonly go: (p: string) => void
  readonly collapsed: boolean
}) {
  return (
    <>
      {entries.map((e) => {
        const active = current === e.id || (current?.startsWith(e.id + '.') ?? false)
        return (
          <div key={e.id}>
            <button
              type="button"
              className={`nav-item${active ? ' active' : ''}`}
              onClick={() => go(e.path)}
              aria-current={active ? 'page' : undefined}
              title={collapsed ? e.label : undefined}
            >
              <Icon name={e.icon} />
              {collapsed ? null : <span>{e.label}</span>}
            </button>
            {/* Sub-items reveal under their parent when it is active, per the design. */}
            {e.children && active && !collapsed ? (
              <div className="nav-sub">
                {e.children.map((c) => (
                  <div key={c.id}>
                    {c.groupLabel ? <div className="eyebrow nav-group">{c.groupLabel}</div> : null}
                    <button
                      type="button"
                      className={`nav-item${current === c.id ? ' active' : ''}`}
                      onClick={() => go(c.path)}
                      aria-current={current === c.id ? 'page' : undefined}
                    >
                      <span>{c.label}</span>
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )
      })}
    </>
  )
}

export type ShellContext = {
  readonly me: Me
  /** The brand owner in view, or null for "All brand owners". Staff and multi-owner accounts only. */
  readonly owner: string | null
  /**
   * Set the brand owner in view — the same value the sidebar switcher sets.
   *
   * Exposed so a screen can offer the choice where the decision is being made (New clearance opens with
   * "who is this for"), without a second source of truth: this narrows what is already permitted and is
   * never a request field. The server stamps identity from the verified sign-in, and a body that named
   * an owner would be a tenancy hole, not a convenience.
   */
  readonly setOwner: (owner: string | null) => void
  /**
   * A brand owner's DISPLAY NAME, from its account key. The one resolver in the app.
   *
   * The portal is keyed by slug and read by people: `vantor` is a route parameter, "Vantor Labs"
   * is the client. Before this existed only the sidebar switcher resolved a name, and only for staff
   * (it read the staff-only roster) — so the same brand owner read "Aurora Interactive" in the rail and
   * "aurora" in the heading beside it, and a client, who had no name source at all, saw the slug
   * everywhere. Two sources, two answers, one entity.
   *
   * Falls back to the key, never to a blank: a name we do not have is a cosmetic gap, an empty label
   * where a brand owner should be is a broken screen. `null` is the "All brand owners" view.
   *
   * NEVER use the result as a value. Requests, `<option value>` and grouping keys stay keyed by key.
   */
  readonly ownerName: (key: string | null) => string
  /**
   * Every brand owner this identity may act for, keyed.
   *
   * Resolved HERE because the shell already holds both sources — the roster it fetched for the
   * switcher, and a client's own grants off `me` — so a screen that needs the list costs no request.
   * Home needs it and cannot derive it from the run list: a brand owner with no clearances yet has no
   * run to be derived from, and a set-up-but-unused owner vanishing from the list is precisely the one
   * a person is most likely to be looking for.
   */
  readonly ownerKeys: readonly string[]
  readonly go: (path: string, opts?: { replace?: boolean }) => void
  /**
   * Bumped when someone navigates to the screen they are already on.
   *
   * Folded into the screen key, so "New clearance" pressed from a finished clearance is a fresh mount
   * rather than a no-op. A counter rather than a callback because the shell cannot know what any given
   * screen would need to reset, and should not have to.
   */
  readonly visit: number
}

/**
 * What a reader whose session has gone is told — ONE panel, whether the session was already gone when
 * they arrived or ended while they were working (tracker issues 2074, 2113).
 *
 * It says nothing was lost, because that is the question a reader actually has and the honest answer:
 * a 401 never reached the server's write path.
 */
function SessionEnded() {
  return (
    <div className="screen">
      <div className="notice">
        <h1 style={{ fontSize: 19, margin: '0 0 8px' }}>Your session has ended</h1>
        <p style={{ margin: '0 0 12px', color: 'var(--text-muted)' }}>
          Nothing is wrong with this install and nothing has been lost — signing in again brings you
          straight back to your clearances.
        </p>
        {/* A real navigation, not a client-side route change: the session cookie is gone, so the
            server has to establish a new one before any screen can load. */}
        <a className="btn-primary" href="/portal" style={{ display: 'inline-block', textDecoration: 'none' }}>
          Sign in again
        </a>
      </div>
    </div>
  )
}

export function AppShell({ render }: { readonly render: (screen: ScreenId, ctx: ShellContext) => ReactElement }) {
  const [path, go, visit] = usePath()
  const [theme, toggleTheme] = useTheme()
  const [collapsed, setCollapsed] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const [anon, setAnon] = useState(false)
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [owner, setOwner] = useState<string | null>(null)

  // SWITCHING BRAND OWNER IS NOT A NAVIGATION, WHICH IS WHY IT NEEDED ITS OWN GUARD.
  //
  // It is a <select> in the sidebar, so it never touches `go` — and it is the exit the owner actually
  // hit: editing Aurora Interactive's Brand profile, switch to Zephyr Beverages, and every edit is gone with nothing said.
  // The wording names the switch rather than a page, because from the user's side nothing "left".
  const setOwnerGuarded = useCallback((next: string | null) => {
    if (!confirmDiscard('Switch brand owner?')) return
    setOwner(next)
  }, [])

  // The browser-level half: reload, closing the tab, and the Cloudflare Access logout link, which is a
  // real <a> and so leaves the document without passing through `go`.
  useEffect(() => attachBeforeUnload(), [])
  const mobile = useIsMobile()

  const { result: meResult, loading } = useLoad(() => api.me(), [])

  // — subscribed for the life of the shell, which is the life of the app. The
  // unsubscribe matters in the test environment and under a remount, where a stale closure holding a
  // dead setState is the way this becomes a warning nobody reads.
  const [sessionEnded, setSessionEnded] = useState(false)
  useEffect(() => onSessionEnded(() => setSessionEnded(true)), [])

  // A SINGLE-OWNER IDENTITY IS ALWAYS IN THAT OWNER'S VIEW.
  //
  // `owner` starts null, meaning "no particular brand owner", and for staff that is the real state they
  // begin in. For a client with exactly one grant it never was: there is no second world to be looking
  // at, and nothing renders a switcher for them. But every screen reads `ctx.owner` to decide what to
  // CALL the brand owner, so a permanent null had them all falling back to "no owner in view" — which
  // is why a client's Clearances page was headed "Clearances" and the composer's context card printed
  // the account slug it had got from the server's echo instead of a name.
  //
  // Resolving it here rather than defending against null on every screen keeps one meaning for one
  // field. It changes nothing about tenancy: the account still travels as a query parameter the server
  // checks against the verified sign-in, and naming your own grant is not a claim taken on trust.
  //
  // DERIVED, NOT SET IN AN EFFECT, and that is not a style preference. An effect that calls setOwner
  // after mount re-renders the whole tree a beat after paint, which re-runs every screen's useLoad with
  // a changed account and refetches. On the Result screen that lands mid-measurement: the report frame
  // remounts while the embed bridge is settling its height, and the frame's slack oscillates between
  // two settled values. It showed up as render-check.mjs failing intermittently at 99px and 14px on
  // alternate runs — a real symptom of a redundant render, caught only because that check drives a
  // real browser.
  const sole = meResult?.kind === 'ok' && !meResult.value.allAccounts && meResult.value.accounts.length === 1
    ? meResult.value.accounts[0] ?? null
    : null

  // The roster, fetched HERE rather than inside the switcher, because names are needed by every screen
  // and not only by the control that picks one. Staff-only by construction: a client gets 404 from this
  // route, so asking would spend one of their 120/min on a refusal — the guard is what keeps this from
  // being a request every client makes on every load.
  const isStaff = meResult?.kind === 'ok' && meResult.value.role === 'staff'
  const { result: rosterResult } = useLoad(
    () => (isStaff ? api.roster() : Promise.resolve({ kind: 'ok' as const, value: [] as readonly { key: string; name: string }[] })),
    [isStaff],
  )

  useEffect(() => {
    document.documentElement.classList.toggle('anon-on', anon)
  }, [anon])

  // Navigating closes the drawer; leaving it open over the new screen reads as a stuck menu.
  useEffect(() => {
    setDrawer(false)
    setAvatarOpen(false)
  }, [path])

  if (loading) return <div className="screen" />

  // ── — A SESSION THAT HAS GONE IS NOT AN ENROLMENT PROBLEM ────────────────
  //
  // Checked BEFORE the funnel below, because the funnel's reasoning does not cover it. That reasoning —
  // every non-ok says the same thing, so "no grants" and "not yours" cannot be told apart — is right for
  // the tenancy shapes and wrong for a 401: an unauthenticated caller learns only that they are
  // unauthenticated, which they already knew, so naming it is an oracle over nothing.
  //
  // What it replaced was not a vague message but a FALSE one. A reader whose session had expired was
  // told "You are signed in, but this address has not been enrolled for any account yet" — on the first
  // screen they meet, sending them to ask for an account they already have. Found by the owner on a
  // fresh install.
  //
  // ── — AND WHENEVER IT ARRIVES, NOT ONLY AT MOUNT ──────────────────────────
  //
  // `me` is loaded once with empty deps, so this branch alone answers only the reader who arrives with
  // no session. A session that ends MID-VISIT lands on some later screen's own load, and that screen
  // renders its own notice — "The settings could not be loaded just now" — which never says "sign in".
  // `sessionEnded` is the same answer for the same fact, announced from the one place every request
  // already funnels through (contract/api.ts), so it covers a load, a poll, a save and an admin action
  // alike. One panel, both paths: a second wording here would be a second answer to one event.
  if (sessionEnded || (meResult && meResult.kind === 'signedOut')) return <SessionEnded />

  if (!meResult || meResult.kind !== 'ok') {
    // Every REMAINING non-ok shape lands here, and every one of them says the same thing. That is on
    // purpose: distinguishing "you have no grants" from "that account is not yours" would be an existence
    // oracle on a page anyone signed in can reach.
    return (
      <div className="screen">
        <div className="notice">
          <h1 style={{ fontSize: 19, margin: '0 0 8px' }}>No clearances are available to you</h1>
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>
            You are signed in, but this address has not been enrolled for any account yet. Enrolment can
            be arranged — it is two-sided, so it needs doing in two places.
          </p>
        </div>
      </div>
    )
  }

  const me: Me = meResult.value
  const role: Role = me.role
  const groups = navGroupsFor(role)
  const entry = screenForPath(path, role) ?? (path === '/portal' || path === '/portal/' ? HOME : null)

  // ONE name map, from both sources, resolved once. A client's own grants carry names on `me`; staff
  // reach every customer and take theirs from the roster. Neither source is per-screen, so neither is
  // consulted per-screen. While the roster is still in flight a staff member reads the key for a frame,
  // which is the same fallback a missing name gets — never a blank where a brand owner should be.
  const names = ownerNameMap(me.accountNames, rosterResult?.kind === 'ok' ? rosterResult.value : [])
  const ownerName = (key: string | null): string => ownerNameFrom(names, key)

  // WHICH owners are offered is a separate question from what they are CALLED, and it is answered from
  // the roster's own key list — not from the keys of the name map. An account whose profile carries no
  // name contributes no entry to that map, and deriving the menu from it would make such an account
  // silently unselectable: a customer that exists, has runs, and cannot be picked.
  const ownerKeys: readonly string[] =
    role === 'staff'
      ? (rosterResult?.kind === 'ok' ? rosterResult.value.map((c) => c.key) : [])
      : me.accounts

  // What every screen means by "the brand owner in view": the switcher's choice, or — for an identity
  // with exactly one grant and therefore no switcher — that one owner.
  const ownerInView = owner ?? sole

  const body = entry
    ? render(entry.id, { me, owner: ownerInView, setOwner: setOwnerGuarded, ownerName, ownerKeys, go, visit })
    : // An unknown path and a staff-only path a client typed both land here, indistinguishably.
      <div className="screen">
        <div className="empty">
          <p>That page does not exist.</p>
          <button type="button" className="nav-item" style={{ width: 'auto', margin: '0 auto' }} onClick={() => go(HOME.path)}>
            Back to {HOME.label}
          </button>
        </div>
      </div>

  // Staff always get the switcher (their reach is the roster, not a named list); a client gets one only
  // when their grant actually covers more than one brand owner.
  const multiOwner = me.allAccounts || me.accounts.length > 1

  // WHO YOU SIGNED IN AS — where the portal actually knows. Staff are the operator, read from the brand
  // seam rather than written here (: the literal was one deployment's firm name, shipped to every
  // fork); a client with exactly one grant is that brand owner. A client with several is a firm whose own
  // name this portal has never been told, and naming one of their clients instead would be worse than
  // staying quiet. Null ⇒ the block is not rendered at all; see the identity corner below — so a staff
  // identity on a deployment that sent no brand renders nothing here rather than an empty label.
  const accountName = role === 'staff' ? (me.brand || null) : (me.accounts.length === 1 ? ownerName(me.accounts[0]!) : null)

  return (
    <div className="app">
      {mobile && drawer ? <button type="button" className="scrim" aria-label="Close menu" onClick={() => setDrawer(false)} /> : null}

      <nav className={`sidebar${collapsed && !mobile ? ' collapsed' : ''}${drawer ? ' open' : ''}`} aria-label="Main">
        <div className="sidebar-head">
          <button
            type="button"
            className="nav-item"
            style={{ padding: '4px 6px' }}
            onClick={() => go(HOME.path)}
            aria-label={`${WORDMARK} — go to ${HOME.label.toLowerCase()}`}
          >
            <Logo markOnly={collapsed && !mobile} />
          </button>

          {/* BRAND OWNER LIVES HERE, in the rail, above the navigation it filters.
              It sat in the top bar briefly and the placement was wrong: up there it read as a sibling
              of the screen title, when what it actually is is the thing every item below it is scoped
              to. Next to the nav, the relationship is the layout. What the top-bar version got right
              was the WEIGHT, and that is kept — it is bold and full-size here, not a 13px form control
              under a 9.5px label.
              ACCOUNT is no longer in this block: it is fixed identity, not a filter, so it moved beside
              the avatar where identity belongs. The two nouns stay rigidly apart (see the header), and
              now they are in different regions entirely, which says it more plainly than a label could. */}
        </div>

        {/* ── THE SIDEBAR, IN TWO GROUPS, WITH THE SWITCHER BETWEEN THEM ────────────────────────────
            The switcher used to float above the whole nav, governing an unstated subset of it — so the
            only way to know whether picking a brand owner changed a screen was to pick one and watch.
            Drawn as the HEADER OF THE GROUP IT GOVERNS, its reach is simply visible: everything printed
            beneath it is about one brand owner, everything above spans the account.

            The split is read off each entry's `scope`, never off role. Both groups are identical for
            everyone who signs in — what differs is how many brand owners they hold, and quantity is a
            rendering decision. */}
        <div className="sidebar-scroll">
          <NavList entries={groups.account} current={entry?.id ?? null} go={go} collapsed={collapsed && !mobile} />

          {groups.owner.length ? (
            <div style={{ marginTop: 18 }}>
              {collapsed && !mobile ? (
                // Collapsed to icons there is no room for a control, and a switcher that silently
                // disappeared would leave the group below it looking unscoped. A rule stands in for it:
                // the boundary survives even when the label cannot.
                <div style={{ height: 1, background: 'var(--border-hairline)', margin: '0 8px 12px' }} />
              ) : (
                // NOTHING AT ALL WHEN THERE IS NOTHING TO SWITCH. A single-owner identity IS its own
                // brand owner, so naming it here would print that name a third time on one screen —
                // rail, title and Account corner — and a label repeated three times stops being read
                // anywhere. It would also label a distinction that does not exist for them: with one
                // owner there is no "which owner", so the group needs no header to disambiguate.
                // Quantity is a rendering decision, never a layout.
                multiOwner ? (
                  <div style={{ marginBottom: 10 }}>
                    <div className="eyebrow">Brand owner</div>
                    <BrandOwnerSwitcher keys={ownerKeys} ownerName={ownerName} value={owner} onChange={setOwnerGuarded} />
                  </div>
                ) : null
              )}
              <NavList entries={groups.owner} current={entry?.id ?? null} go={go} collapsed={collapsed && !mobile} />
            </div>
          ) : null}
        </div>

        {!mobile ? (
          <div className="sidebar-foot">
            <button type="button" className="nav-item" onClick={() => setCollapsed((c) => !c)}>
              <Icon name="panel-left" />
              {collapsed ? null : <span>Collapse</span>}
            </button>
          </div>
        ) : null}
      </nav>

      <div className="main">
        <header className="topbar">
          {mobile ? (
            <button type="button" className="icon-btn" aria-label="Open menu" onClick={() => setDrawer(true)}>
              <Icon name="menu" />
            </button>
          ) : null}
          {/* THE TITLE NAMES THE SCOPE YOU ARE IN, NOT THE SCREEN YOU ARE ON.
              The screen name earned nothing up here — the sidebar already highlights the active item, so
              the top bar spent its largest text repeating it. What it says instead is read off the
              screen's own `scope`, the same field that decides which side of the switcher it sits on:
              an owner-scoped screen names the brand owner, an account-scoped one names the account.
              THAT IT VARIES IS THE POINT. Home and Clearances span everything the account holds and
              deliberately ignore the switcher, so naming one brand owner over them would be actively
              misleading — it would assert a filter that is not being applied. Below the line the title
              and the switcher agree, because there the switcher is what chose it.
              ACCOUNT is untouched at the right, labelled. The two nouns stay rigidly apart (see the
              header of this file); on an account-scoped screen the title and that label are the same
              fact, which is why the label carries the word "Account" and the title does not.
              Screens keep their own heading in the body, so nothing is lost to a screen reader. */}
          <h1 data-anon="mark">
            {!entry ? 'Not found' : scopeOf(entry.id) === 'owner' ? ownerName(ownerInView) : accountName ?? ownerName(ownerInView)}
          </h1>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, position: 'relative' }}>
            {/* ACCOUNT — who you signed in as. It belongs up here, at the far right beside the avatar,
                because that is the identity corner: it is not selectable, it never changes while you
                are signed in, and putting it next to the person's own initials says "this is you"
                without a sentence. It used to sit in the rail directly above the brand-owner control,
                where two adjacent bold values under two 9.5px labels invited exactly the conflation
                the header of this file warns about.
                The label stays. Different regions already separate the two nouns, but a bare bold word
                beside an avatar could still be read as a brand owner by someone who has not been told.

                RENDERED ONLY WHEN THERE IS A TRUE ANSWER. This used to print `accounts[0]` for any
                client, which is right for the ordinary case — one grant, and the account IS the brand
                owner — and false for a firm holding three: it picked one of their CLIENTS at random and
                labelled it their identity. Invisible while the brand owner lived in a select in the
                rail; unmissable now that the two sit at either end of one bar. A firm's own name is not
                a fact this portal holds, so the honest move is to say nothing and let the avatar menu
                (which carries the signed-in address) answer "who am I". */}
            {!mobile && accountName ? (
              <div style={{ textAlign: 'right', marginRight: 8, minWidth: 0 }}>
                <div className="eyebrow">Account</div>
                <div
                  style={{ fontWeight: 700, color: 'var(--text-strong)', fontSize: 14, lineHeight: 1.2, whiteSpace: 'nowrap' }}
                  data-anon="mark"
                >
                  {accountName}
                </div>
              </div>
            ) : null}
            <button
              type="button"
              className="icon-btn"
              aria-pressed={anon}
              aria-label="Blur names for screen sharing"
              title="Blur names for screen sharing"
              onClick={() => setAnon((a) => !a)}
            >
              <Icon name={anon ? 'eye-off' : 'eye'} />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-pressed={theme === 'dark'}
              aria-label="Switch light or dark theme"
              title="Switch light or dark theme"
              onClick={toggleTheme}
            >
              <Icon name="theme" />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-haspopup="menu"
              aria-expanded={avatarOpen}
              aria-label="Account menu"
              style={{ borderRadius: '50%', background: 'var(--surface-float)', border: '1px solid var(--border-hairline)', fontSize: 11, fontWeight: 700 }}
              onClick={() => setAvatarOpen((o) => !o)}
            >
              {initials(me.email)}
            </button>

            {avatarOpen ? (
              <div className="float" role="menu" style={{ position: 'absolute', right: 0, top: 40, width: 240, padding: 6, zIndex: 50 }}>
                <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-hairline)' }}>
                  <div className="eyebrow">Signed in as</div>
                  <div style={{ fontSize: 13, wordBreak: 'break-all' }} data-anon="mark">
                    {me.email}
                  </div>
                  {/* The role moved here with the account. It was a line in the rail; beside an email
                      address it is more use, because "<operator> staff" answers a question about the
                      person rather than about the account they hold. */}
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                    {role === 'staff' ? staffLabel(me.brand) : 'Client'}
                  </div>
                </div>
                {/* The only door to Preferences: it is a hidden entry in nav.config, kept routable
                    precisely so this link resolves. "Profile" was dropped from the label — with Brand
                    profile now a top-level screen of its own, promising one here would send a person
                    looking for their brand's settings to the wrong page. */}
                {/* PREFERENCES AND ADMIN LIVE HERE, and they are MAPPED FROM DATA, not written out.
                    Admin moved off the sidebar because it belongs to the PERSON rather than to either
                    scope — in the sidebar it would have had to sit on one side of the brand-owner
                    switcher, claiming to be account-scoped or owner-scoped when it is neither.
                    Rendering the list rather than guarding literals with `role === 'staff'` is this
                    file's own rule (nav.config's header): a JSX guard puts role logic back in markup,
                    and the source scan that checks every navigation target resolves cannot see one — it
                    would read a staff-only path as a dead link for clients, and be right to. A client
                    simply gets a shorter list, with no staff path anywhere in the shell. */}
                {avatarMenuFor(role).map((e) => (
                  <div key={e.id}>
                    {e.groupLabel ? (
                      <div className="eyebrow nav-group" style={{ padding: '8px 10px 2px' }}>{e.groupLabel}</div>
                    ) : null}
                    <button type="button" className="nav-item" role="menuitem" onClick={() => go(e.path)}>
                      {e.label}
                    </button>
                  </div>
                ))}
                {/* — F47. NOT Cloudflare's endpoint directly: it does not exist
                    on local sign-in, which is what every fresh install runs, and a browser got a raw
                    {"error":"not_found"} instead of signing out. The portal resolves the mode. */}
                <a className="nav-item" role="menuitem" href="/portal/sign-out">
                  Log out
                </a>
              </div>
            ) : null}
          </div>
        </header>

        {body}
      </div>
    </div>
  )
}

/**
 * Which brand owner's world you are looking at.
 *
 * It no longer knows anything about ROLE, and that is the point of this shape. It used to branch —
 * roster names for staff, bare keys for anyone else — which is how one control came to answer the same
 * question two ways depending on who signed in. Now it is handed the keys it may offer and the one
 * resolver every screen uses, so its labels cannot drift from the labels beside it.
 */
function BrandOwnerSwitcher({
  keys,
  ownerName,
  value,
  onChange,
}: {
  readonly keys: readonly string[]
  readonly ownerName: (key: string | null) => string
  readonly value: string | null
  readonly onChange: (v: string | null) => void
}) {
  const options = sortOwners(Object.fromEntries(keys.map((k) => [k, ownerName(k)])), keys)

  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      aria-label="Brand owner"
      style={{
        width: '100%',
        marginTop: 4,
        padding: '6px 9px',
        borderRadius: 8,
        border: '1px solid var(--border-hairline)',
        background: 'var(--surface-raised)',
        // Set at the weight of a heading rather than of a form field. This is the single most
        // load-bearing piece of context on the page — which client's world you are looking at — and at
        // the browser's default select type it read as a filter dropdown somebody had left in the rail.
        fontSize: 15,
        fontWeight: 700,
        color: 'var(--text-strong)',
      }}
    >
      <option value="">{ALL_OWNERS}</option>
      {options.map((o) => (
        <option key={o.key} value={o.key}>
          {o.name}
        </option>
      ))}
    </select>
  )
}

const initials = (email: string): string => {
  const name = email.split('@')[0] ?? ''
  const parts = name.split(/[._-]+/).filter(Boolean)
  const letters = parts.length >= 2 ? `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}` : name.slice(0, 2)
  return letters.toUpperCase()
}
