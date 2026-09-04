// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './tokens.css'
import './base.css'
import { AppShell, type ShellContext } from './shell/AppShell.tsx'
import { Home } from './screens/Home.tsx'
import { Clearances } from './screens/Clearances.tsx'
import { Result } from './screens/Result.tsx'
import { NewClearance } from './screens/NewClearance.tsx'
import { SavedSearches } from './screens/SavedSearches.tsx'
import { Preferences } from './screens/Preferences.tsx'
import { UseYourAI } from './screens/UseYourAI.tsx'
import { Profile } from './screens/Profile.tsx'
import { Projects } from './screens/Projects.tsx'
import { GlobalConfig } from './screens/GlobalConfig.tsx'
import { PeopleAccess } from './screens/PeopleAccess.tsx'
import { About } from './screens/About.tsx'
import { resultRoute } from './nav/nav.config.ts'
import type { ScreenId } from './nav/nav.config.ts'

/**
 * A screen that exists in the navigation but has not been built yet.
 *
 * It says so plainly rather than showing an empty page with a title. A blank screen is indistinguishable
 * from a broken one, and someone will file it as a bug; this cannot be mistaken for either. Each of these
 * is replaced by the real screen in the phase named on it.
 */
function NotYet({ title, phase, what }: { readonly title: string; readonly phase: string; readonly what: string }) {
  return (
    <div className="screen">
      <div className="eyebrow">{title}</div>
      <h1 style={{ fontSize: 25, margin: '4px 0 10px', color: 'var(--text-strong)' }}>{title}</h1>
      <div className="notice quiet">
        <p style={{ margin: 0, color: 'var(--text-muted)' }}>{what}</p>
        <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--text-faint)' }}>
          Being built — {phase}.
        </p>
      </div>
    </div>
  )
}

/**
 * THE BRAND OWNER AND THE VISIT ARE PART OF A SCREEN'S IDENTITY, SO THEY ARE PART OF THE KEY.
 *
 * Every account-scoped screen re-fetched on an owner change and none of them reset their own state, so
 * the data swapped underneath a form that did not. The worst of it was the composer: a clearance drafted
 * for Aurora Interactive survived a switch to Zephyr Beverages while the context card, the project list and the allowance
 * all changed around it — and the project key in that draft usually did not exist under the new owner.
 * Brand profile was quieter and worse: when the new owner's payload landed, the seeding effect wrote it
 * straight over unsaved edits with nothing said. Brand projects kept the expanded project key and asked
 * for it under the wrong owner, which answers "That project is not available" — a failure caused
 * entirely by the switch.
 *
 * Keying is the React-native answer and it fixes the class, not the four instances: a different owner is
 * a different mount, so every `useState` in the subtree starts fresh. Four `useEffect(() => reset(),
 * [account])` blocks would have to be right in four places and remembered in every screen added after.
 *
 * Screens absent from this list are deployment- or browser-scoped, not account-scoped: Use your AI is a
 * per-identity door, Preferences is this browser, and the two admin screens are firm-wide.
 *
 * `visit` carries the other half: pressing a nav item for the screen you are already standing on. That
 * did nothing at all — the URL was identical, so the router bailed and the composer kept showing
 * "Clearance started" until you went somewhere else and came back. Same key, same mechanism, and it
 * works for every screen instead of only the one that was reported.
 */
const ownerKey = (ctx: ShellContext) => `${ctx.owner ?? '*'}#${ctx.visit}`

function screen(id: ScreenId, ctx: ShellContext) {
  switch (id) {
    case 'home':
      return <Home key={ownerKey(ctx)} ctx={ctx} />
    case 'clearances':
      return <Clearances key={ownerKey(ctx)} ctx={ctx} />
    case 'new':
      // Keyed on the ?search= slug: editing search X, editing search Y, and a fresh composer are
      // three different mounts. Without the key, sidebar "New clearance" from edit mode reconciles
      // in place and the hydrated edit state (heading, levers, open save panel) survives the
      // navigation — a composer that says Edit under a URL that says new.
      return (
        <NewClearance
          key={`${ownerKey(ctx)}::${new URLSearchParams(window.location.search).get('search') ?? ''}`}
          ctx={ctx}
        />
      )
    case 'ai':
      return <UseYourAI ctx={ctx} />
    case 'result': {
      // /portal/result/<runId>             — the run: its own document, or a batch's list of names.
      // /portal/result/<runId>/<markSlug>  — ONE name's document out of a batch, in the shell.
      //
      // The reading of the two is `resultRoute`, in nav.config beside the route it reads — it used to be
      // a `.pop()` here, which no test could reach and which returned the mark slug as the run id the
      // moment the route grew a second argument.
      const { runId, markSlug } = resultRoute(window.location.pathname)
      // A bare /portal/result has no run to show, so it goes back to the list rather than rendering an
      // empty shell. The old `runId === 'result'` half of this test is GONE with the read that needed
      // it: `.pop()` on the bare path returned the screen's own name, so the name had to be excluded —
      // which also refused /portal/result/result, a run legitimately identified as "result".
      if (!runId) {
        // replace, not push: a pushed redirect makes /portal/result a Back-button trap — every
        // Back lands on the bare path, which re-redirects onto a fresh history entry, forever.
        ctx.go('/portal/clearances', { replace: true })
        return <div className="screen" />
      }
      // KEYED ON THE RUN, NOT ON THE BRAND OWNER. Every other screen is owner-scoped and remounts when
      // the switcher moves; this one is not — it shows one identified run, and the switcher has no say
      // in which. Keying it on `ownerKey` remounted an open report every time someone touched the
      // switcher, discarding the measured frame height and reloading the document for no reason. The
      // run id is the identity that actually matters here: moving between reads of the same mark should
      // remount, so the frame re-measures against the new document instead of inheriting a stale height.
      // THE MARK IS PART OF THE KEY, for the reason the run is. Moving between two names of one batch
      // is moving between two documents under one run id, so a key without the slug reconciles in
      // place and the new document inherits the height measured for the old one.
      return (
        <Result key={`${runId}/${markSlug ?? ''}#${ctx.visit}`} ctx={ctx} runId={runId} markSlug={markSlug} />
      )
    }
    case 'brand.profile':
      return <Profile key={ownerKey(ctx)} ctx={ctx} />
    case 'brand.projects':
      return <Projects key={ownerKey(ctx)} ctx={ctx} />
    case 'brand.searches':
      return <SavedSearches key={ownerKey(ctx)} ctx={ctx} />
    case 'preferences':
      return <Preferences ctx={ctx} />
    // No ctx: the source offer is the same for every reader and depends on no account, no owner and
    // no role. Passing one would imply a scope it does not have.
    case 'about':
      return <About />
    // Admin settings has no screen of its own; landing on the parent shows its first child, the way
    // /portal/settings used to fall through to Profile.
    case 'admin':
    case 'admin.access':
      return <PeopleAccess ctx={ctx} />
    case 'admin.config':
      return <GlobalConfig ctx={ctx} />
    default: {
      // A ScreenId with no case above fails to narrow to `never`, so adding one to the union IS a
      // compile error — now. The comment that used to sit here CLAIMED that and was wrong: nothing
      // asserted it, `default` just returned the placeholder below and TypeScript said nothing about
      // the missing case. The placeholder stays as the runtime belt (a bad id from a stale bundle
      // should say so, not paint an empty page); the assertion is the braces.
      const unhandled: never = id
      void unhandled   // `noUnusedLocals` is on — the annotation is the assertion, this read satisfies it
      return <NotYet title="Not built" phase="a later phase" what="This screen has not been built yet." />
    }
  }
}

const root = document.getElementById('root')
if (!root) throw new Error('#root is missing from index.html')

createRoot(root).render(
  <StrictMode>
    <AppShell render={screen} />
  </StrictMode>,
)
