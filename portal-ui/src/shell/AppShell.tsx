// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The persistent shell: sidebar, top bar, and the one place a screen is chosen.
//
// Two nouns are kept rigidly apart here, because the design pack is emphatic about it and because
// conflating them is how a filter turns into a security boundary in someone's head:
//
//   ACCOUNT     — who you signed in as (the tenant). Fixed identity. Never switchable in the app.
//   COMPANY — the client a clearance is FOR. A work filter, switchable, purely presentational.
//
// The server enforces the account; the company switcher only narrows what is already permitted.

import { useCallback, useEffect, useState } from 'react'
// React 19's @types/react removed the GLOBAL `JSX` namespace — it lives under `React.JSX` now. Importing
// the type is better than reaching for the namespace either way: it says where the type comes from, and
// it does not depend on a global that a future types major can move again.
import type { ReactElement } from 'react'
import type { Me, Organisation } from '../contract/api.ts'
import { api, onSessionEnded } from '../contract/api.ts'
import { navGroupsFor, avatarMenuFor, scopeOf, screenForPath, HOME, type NavEntry, type ScreenId } from '../nav/nav.config.ts'
import { Icon } from '../components/Icon.tsx'
import { Logo, WORDMARK } from '../components/Logo.tsx'
import { useLoad } from '../state/useApi.ts'
import { confirmDiscard, attachBeforeUnload } from '../state/guard.ts'
import { ALL_OWNERS, ownerNameMap, ownerNameFrom } from '../contract/ownerNames.ts'
import { pickerGroups, type CompanyGroup, type CompanyRow } from './companyRows.ts'
import { permissionsPhrase } from './accessWords.ts'
import { GENERIC_ACCOUNT, genericFor, isGenericKey, orgOfGeneric } from '../contract/genericKey.ts'
import { companyFactsMap, type CompanyFacts } from '../contract/companyFacts.ts'
import type { RosterCompany } from '../contract/api.ts'

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
  /** The company in view, or null for "All companies". Only a person who can see several companies. */
  readonly owner: string | null
  /**
   * Set the company in view — the same value the sidebar switcher sets.
   *
   * Exposed so a screen can offer the choice where the decision is being made (New clearance opens with
   * "who is this for"), without a second source of truth: this narrows what is already permitted and is
   * never a request field. The server stamps identity from the verified sign-in, and a body that named
   * an owner would be a tenancy hole, not a convenience.
   */
  readonly setOwner: (owner: string | null) => void
  /**
   * Ask for the company list again.
   *
   * The roster is fetched once when the shell mounts and does not poll, which is right for a list that
   * changes when somebody makes it change and never on its own. It made exactly one screen impossible:
   * creating a company and then selecting it, because the shell's list would not contain the key the
   * create had just written. The company would be selected, the rail would show its slug rather than its
   * name, and the picker would not list it at all — a finished feature that looks broken on the one path
   * it exists for.
   *
   * A screen that CHANGES the list calls this. Nothing polls it.
   */
  readonly refreshCompanies: () => void
  /**
   * A company's DISPLAY NAME, from its account key. The one resolver in the app.
   *
   * The portal is keyed by slug and read by people: `vantor` is a route parameter, "Vantor Labs"
   * is the client. Before this existed only the sidebar switcher resolved a name, and only for staff
   * (it read the staff-only roster) — so the same company read "Foxglade Interactive" in the rail and
   * "foxglade" in the heading beside it, and a client, who had no name source at all, saw the slug
   * everywhere. Two sources, two answers, one entity.
   *
   * Falls back to the key, never to a blank: a name we do not have is a cosmetic gap, an empty label
   * where a company should be is a broken screen. `null` is the "All companies" view.
   *
   * NEVER use the result as a value. Requests, `<option value>` and grouping keys stay keyed by key.
   */
  readonly ownerName: (key: string | null) => string
  /**
   * Every company this identity may act for, keyed.
   *
   * Resolved HERE because the shell already holds both sources — the roster it fetched for the
   * switcher, and a client's own grants off `me` — so a screen that needs the list costs no request.
   * Home needs it and cannot derive it from the run list: a company with no clearances yet has no
   * run to be derived from, and a set-up-but-unused owner vanishing from the list is precisely the one
   * a person is most likely to be looking for.
   */
  readonly ownerKeys: readonly string[]
  /**
   * Which organisation a company belongs to — its key, or null when the server did not say.
   *
   * A company sits in exactly one organisation; that constraint is the server's. Resolved here from the
   * same two sources as the names — a person's own grants off `me`, the roster for someone who can see
   * the whole install — so the switcher, the pick panel and the chips group the same company under the
   * same heading.
   */
  readonly orgOf: (key: string) => string | null
  /**
   * The organisations this person can SEE, in the server's order. More than one is what turns the
   * switcher's group headings on and the top bar's organisation label off.
   */
  readonly organisations: readonly Organisation[]
  /**
   * The three facts about a company — what it sells, how many marketplaces, which territories.
   *
   * `undefined` for a company we hold no facts about, which the pick panel renders as a company with a
   * name and no line under it. That is the fresh-install case and a newly created company, not an error.
   */
  readonly factsFor: (key: string) => CompanyFacts | undefined
  readonly go: (path: string, opts?: { replace?: boolean }) => void
  /**
   * Bumped when someone navigates to the screen they are already on.
   *
   * Folded into the screen key, so "New clearance" pressed from a finished clearance is a fresh mount
   * rather than a no-op. A counter rather than a callback because the shell cannot know what any given
   * screen would need to reset, and should not have to.
   */
  readonly visit: number
  /**
   * Whether the sidebar is collapsed to icons right now.
   *
   * Screens need it for one reason: several of them tell a reader with no company selected to pick
   * one "at the top left", and with the sidebar collapsed there is no top left — an outside user read
   * that sentence, found nothing where it pointed, and stopped. A sentence about WHERE a control is has
   * to know whether that control is on screen, and only the shell knows.
   *
   * It is not a general licence for screens to lay themselves out around the chrome. This is the shell
   * answering a question about the shell, which a screen cannot answer and must not guess.
   */
  readonly sidebarCollapsed: boolean
}

/**
 * What a reader whose session has gone is told — ONE panel, whether the session was already gone when
 * they arrived or ended while they were working.
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

  // SWITCHING COMPANY IS NOT A NAVIGATION, WHICH IS WHY IT NEEDED ITS OWN GUARD.
  //
  // It is a <select> in the sidebar, so it never touches `go` — and it is the exit the owner actually
  // hit: editing one company's Brand profile, switch to another, and every edit is gone with nothing said.
  // The wording names the switch rather than a page, because from the user's side nothing "left".
  const setOwnerGuarded = useCallback((next: string | null) => {
    if (!confirmDiscard('Switch company?')) return
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
  // `owner` starts null, meaning "no particular company", and for staff that is the real state they
  // begin in. For a client with exactly one grant it never was: there is no second world to be looking
  // at, and nothing renders a switcher for them. But every screen reads `ctx.owner` to decide what to
  // CALL the company, so a permanent null had them all falling back to "no owner in view" — which
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

  // The roster, fetched HERE rather than inside the switcher, because names are needed by every screen
  // and not only by the control that picks one. Asked only by a person whose grant is the whole install —
  // the one person who holds no named company list of their own. Everyone else carries their companies,
  // names and organisations on `me`, and asking would spend one of their 120/min on a request that adds
  // nothing.
  const readsRoster = meResult?.kind === 'ok' && meResult.value.allAccounts
  const { result: rosterResult, reload: reloadRoster } = useLoad(
    () => (readsRoster ? api.roster() : Promise.resolve({ kind: 'ok' as const, value: [] as readonly RosterCompany[] })),
    [readsRoster],
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
  const groups = navGroupsFor(me)
  const entry = screenForPath(path, me) ?? (path === '/portal' || path === '/portal/' ? HOME : null)

  // ONE name map, from both sources, resolved once. A client's own grants carry names on `me`; staff
  // reach every customer and take theirs from the roster. Neither source is per-screen, so neither is
  // consulted per-screen. While the roster is still in flight a staff member reads the key for a frame,
  // which is the same fallback a missing name gets — never a blank where a company should be.
  const names = ownerNameMap(me.accountNames, rosterResult?.kind === 'ok' ? rosterResult.value : [])
  // One organisation's Generic is called what Generic is called; the key only says which one.
  const ownerName = (key: string | null): string =>
    ownerNameFrom(names, key !== null && isGenericKey(key) ? GENERIC_ACCOUNT : key)

  // The same two sources and the same precedence, for the three facts that tell one company from
  // another in the pick panel. Parallel to the name map rather than folded into it: a company with no
  // facts is a company, a company with no name is a broken row.
  const facts = companyFactsMap(me.accountFacts, rosterResult?.kind === 'ok' ? rosterResult.value : [])
  const factsFor = (key: string): CompanyFacts | undefined => facts[isGenericKey(key) ? GENERIC_ACCOUNT : key]

  // WHICH owners are offered is a separate question from what they are CALLED, and it is answered from
  // the roster's own key list — not from the keys of the name map. An account whose profile carries no
  // name contributes no entry to that map, and deriving the menu from it would make such an account
  // silently unselectable: a customer that exists, has runs, and cannot be picked.
  const companyKeys: readonly string[] =
    me.allAccounts
      ? (rosterResult?.kind === 'ok' ? rosterResult.value.map((c) => c.key) : [])
      : me.accounts

  // GENERIC, ONE PER ORGANISATION, FROM ONE LIST. The server's `genericOrgs` is the whole answer to which
  // Generics this person is offered; the roster's own `generic` entry is dropped here, because it names
  // the house account and not any organisation's, and offering it would send a request the door has to
  // guess the organisation for. Each is held as one key naming its organisation — contract/genericKey.ts
  // is where that key is built, read, and split back into the pair the door takes.
  const ownerKeys: readonly string[] = [
    ...companyKeys.filter((k) => !isGenericKey(k)),
    ...me.genericOrgs.map(genericFor),
  ]

  // Which organisation each of those companies sits in — the person's own grants first, the roster for
  // someone who can see the whole install. A company neither source places reads null and is grouped
  // under no heading: visibly unplaced, never filed under a guess.
  const rosterOrgs: Readonly<Record<string, string>> = Object.fromEntries(
    (rosterResult?.kind === 'ok' ? rosterResult.value : []).flatMap((c) => (c.org ? [[c.key, c.org]] : [])),
  )
  const orgOf = (key: string): string | null => orgOfGeneric(key) ?? me.accountOrgs[key] ?? rosterOrgs[key] ?? null
  const organisations = me.organisations

  // NOBODY IS ASKED TO CHOOSE BETWEEN ONE THING AND ITSELF.
  //
  // This asked the wrong question for a long time. It keyed on how many companies the LOGIN was granted,
  // so it fired for a client holding one and never for the person running the install — who holds all of
  // them, and was therefore asked to pick from a list of one on every screen of a one-company install.
  //
  // Asked of the company list itself, it is right for both: a client with one grant has one, and a fresh
  // install has one because Generic ships with every install and is a company like any other. While the
  // roster is still in flight the list is empty and nothing is auto-selected, which is the same one-frame
  // tolerance the name resolution already carries.
  const sole = ownerKeys.length === 1 ? ownerKeys[0] ?? null : null

  // What every screen means by "the company in view": the switcher's choice, or the only one there is.
  const ownerInView = owner ?? sole

  const body = entry
    ? render(entry.id, { me, owner: ownerInView, setOwner: setOwnerGuarded, refreshCompanies: reloadRoster,
        ownerName, ownerKeys, orgOf, organisations, factsFor, go, visit, sidebarCollapsed: collapsed })
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
  // when their grant actually covers more than one company.

  // WHO YOU SIGNED IN AS — where the portal actually knows. Staff are the operator, read from the brand
  // seam rather than written here (: the literal was one deployment's firm name, shipped to every
  // fork); a client with exactly one grant is that company. A client with several is a firm whose own
  // name this portal has never been told, and naming one of their clients instead would be worse than
  // staying quiet. Null ⇒ the block is not rendered at all; see the identity corner below — so a staff
  // identity on a deployment that sent no brand renders nothing here rather than an empty label.
  // THE ORGANISATION, FOR EVERYONE. One slot, one meaning.
  //
  // It used to render the organisation for staff and the COMPANY for a client holding one grant — one
  // label over two different nouns, so it was true for staff and false for the commonest client case.
  // The company is already named in the rail and in the page heading; a client loses nothing here, and
  // the dual meaning goes with it.
  //
  // Null ⇒ the block is not rendered at all, so an install that was sent no organisation name shows
  // nothing rather than an empty label.
  //
  // AND ONLY FOR A PERSON WHO CAN SEE EXACTLY ONE. Somebody who can see two organisations is inside
  // neither of them in particular, and naming one would tell them the screen is scoped to it when it is
  // not. So the slot has two cases and the second is empty: one organisation, its name; several, nothing.
  // It never shows a company and it is never a control — there is no organisation switcher.
  //
  // Read off `organisations`, which the server resolves, and never off the brand setting. The brand is
  // one name for the whole install; on a hosted install holding unrelated organisations it would print
  // the operator's name over a customer's screens.
  const accountName = organisations.length === 1 ? (organisations[0]?.name || null) : null
  const grouped = pickerGroups(ownerKeys, orgOf, organisations, ownerName, factsFor)

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

          {/* COMPANY LIVES HERE, in the rail, above the navigation it filters.
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
            only way to know whether picking a company changed a screen was to pick one and watch.
            Drawn as the HEADER OF THE GROUP IT GOVERNS, its reach is simply visible: everything printed
            beneath it is about one company, everything above spans the account.

            The split is read off each entry's `scope`, never off role. Both groups are identical for
            everyone who signs in — what differs is how many companies they hold, and quantity is a
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
                // THE SWITCHER ALWAYS RENDERS. It used to appear only for an identity holding more than
                // one company, which meant a fresh install had no control at all and one materialised
                // later, when a second company was added — and a control that appears by itself reads as
                // a bug rather than as a simplification.
                //
                // There is also never nothing to list: Generic ships with every install and is a company
                // like any other, so the empty state this condition was protecting against cannot occur.
                // With exactly one company the switcher opens on it, and nobody is asked to choose
                // between one thing and itself.
                <div style={{ marginBottom: 10 }}>
                  <div className="eyebrow">Company</div>
                  <BrandOwnerSwitcher grouped={grouped} value={ownerInView} onChange={setOwnerGuarded} />
                </div>
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
              an owner-scoped screen names the company, an account-scoped one names the account.
              THAT IT VARIES IS THE POINT. Home and Clearances span everything the account holds and
              deliberately ignore the switcher, so naming one company over them would be actively
              misleading — it would assert a filter that is not being applied. Below the line the title
              and the switcher agree, because there the switcher is what chose it.
              AND ON AN ACCOUNT-SCOPED SCREEN IT SAYS NOTHING. It used to say `accountName`, which was
              the COMPANY for a client holding one grant — so the bar named a company over Home, which
              spans all of them. With that slot now carrying the ORGANISATION for everyone, repeating it
              here would print one name twice on one bar, which is how a label stops being read.
              Screens keep their own heading in the body, so nothing is lost to a screen reader. */}
          <h1 data-anon="mark">
            {!entry ? 'Not found' : scopeOf(entry.id) === 'owner' ? ownerName(ownerInView) : ''}
          </h1>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, position: 'relative' }}>
            {/* ACCOUNT — who you signed in as. It belongs up here, at the far right beside the avatar,
                because that is the identity corner: it is not selectable, it never changes while you
                are signed in, and putting it next to the person's own initials says "this is you"
                without a sentence. It used to sit in the rail directly above the company control,
                where two adjacent bold values under two 9.5px labels invited exactly the conflation
                the header of this file warns about.
                The label stays. Different regions already separate the two nouns, but a bare bold word
                beside an avatar could still be read as a company by someone who has not been told.

                RENDERED ONLY WHEN THERE IS A TRUE ANSWER. This used to print `accounts[0]` for any
                client, which is right for the ordinary case — one grant, and the account IS the brand
                owner — and false for a firm holding three: it picked one of their CLIENTS at random and
                labelled it their identity. Invisible while the company lived in a select in the
                rail; unmissable now that the two sit at either end of one bar. A firm's own name is not
                a fact this portal holds, so the honest move is to say nothing and let the avatar menu
                (which carries the signed-in address) answer "who am I". */}
            {!mobile && accountName ? (
              <div style={{ textAlign: 'right', marginRight: 8, minWidth: 0 }}>
                <div className="eyebrow">Organisation</div>
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
              aria-label="Settings and about"
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
                  {/* What this person may DO, in the words People prints — never a role noun. It sits
                      beside the address because it answers a question about the person, not about
                      any company they hold. */}
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                    {permissionsPhrase(me.permissions)}
                  </div>
                </div>
                {/* The only door to Preferences: it is a hidden entry in nav.config, kept routable
                    precisely so this link resolves. "Profile" was dropped from the label — with Brand
                    profile now a top-level screen of its own, promising one here would send a person
                    looking for their brand's settings to the wrong page. */}
                {/* PREFERENCES AND ADMIN LIVE HERE, and they are MAPPED FROM DATA, not written out.
                    Admin moved off the sidebar because it belongs to the PERSON rather than to either
                    scope — in the sidebar it would have had to sit on one side of the company
                    switcher, claiming to be account-scoped or owner-scoped when it is neither.
                    Rendering the list rather than guarding literals with a permission test is this
                    file's own rule (nav.config's header): a JSX guard puts the gate back in markup, and
                    the source scan that checks every navigation target resolves cannot see one — it
                    would read a manage-only path as a dead link, and be right to. Someone without
                    Manage simply gets a shorter list, with no such path anywhere in the shell. */}
                {avatarMenuFor(me).map((e) => (
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
 * Which company's world you are looking at.
 *
 * It knows nothing about who is signed in, and that is the point of this shape. It is handed the rows
 * the pick panel draws — grouped, ordered and tagged by ONE function — so its labels, its order and its
 * headings cannot drift from the panel beside it.
 *
 * GROUP HEADINGS ARE `<optgroup>`s, and they appear only for a person who can see more than one
 * organisation. The control stays a native select: it is the most load-bearing piece of context on the
 * page, and a native control is the one every keyboard, screen reader and phone already knows how to
 * open. The Default tag is drawn on the pick panel's card, where there is markup to draw it with; an
 * option can only hold text, and Generic's name already says "default".
 */
function BrandOwnerSwitcher({
  grouped,
  value,
  onChange,
}: {
  readonly grouped: { readonly headings: boolean; readonly groups: readonly CompanyGroup[] }
  readonly value: string | null
  readonly onChange: (v: string | null) => void
}) {
  const option = (r: CompanyRow) => (
    <option key={r.key} value={r.key}>
      {r.name}
    </option>
  )

  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      aria-label="Company"
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
      {grouped.groups.map((g) =>
        grouped.headings && g.org ? (
          <optgroup key={g.org.key} label={g.org.name}>
            {g.rows.map(option)}
          </optgroup>
        ) : (
          g.rows.map(option)
        ),
      )}
    </select>
  )
}

const initials = (email: string): string => {
  const name = email.split('@')[0] ?? ''
  const parts = name.split(/[._-]+/).filter(Boolean)
  const letters = parts.length >= 2 ? `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}` : name.slice(0, 2)
  return letters.toUpperCase()
}
