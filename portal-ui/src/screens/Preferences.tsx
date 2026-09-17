// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Your preferences — the two settings that belong to this browser, and the identity that does not.
//
// The page is deliberately small, and most of the thinking in it is about what NOT to put here.
//
// IDENTITY IS READ-ONLY. Who you are signed in as, and what that sign-in may do, are answers from the
// server. There is no edit control because there is nothing here that could honour one. What the page
// can do is name the route to someone who can: the installation's administrator contact, when the
// installation names one, is a link; when it names none the words stay plain rather than pointing nowhere.
// The way out is the portal's own sign-out route, the same one AppShell's account menu links to.
//
// THEME HAS EXACTLY ONE SOURCE OF TRUTH, and it is not React. It is the `data-theme` attribute on the
// document element, mirrored into localStorage under 'cordillera-theme' so the pre-paint script in
// index.html can restore it before first paint. AppShell keeps a useState copy of it to drive the icon in
// the top bar, but that copy is a render cache, not the truth — so this screen writes the attribute and
// the key, exactly as AppShell's own toggle does, and deliberately does not reach into AppShell's state.
// The controls below are ABSOLUTE (a Light button and a Dark button) rather than one relative toggle: a
// relative toggle would have to compute "the other one" from a local copy that can go stale if the user
// hits the top-bar control while this page is open, and the visible symptom of that is a click that
// appears to do nothing.
//
// THE SCREEN-SHARE BLUR IS THE OTHER WAY ROUND, and for that same reason. Its control is one relative
// toggle, the eye button, and this page shows the same button the top bar carries. So both are bound to
// ONE state, AppShell's, handed to screens on the shell context: a second copy here would disagree with
// the top bar's after one press of either, and the next press would be the dead click described above.
// AppShell remembers the choice in this browser (state/blurChoice.ts).
//
// WHAT THE BLUR COVERS is one CSS rule in base.css, `html.anon-on [data-anon='mark']`, so it reaches the
// elements this app renders and tags: the lists, this page, and the mark and company printed above a
// report. A report is an iframe with a null origin, where no rule of this document applies and no
// per-name markup exists, so Result.tsx tags the frame's CONTAINER and the whole report blurs instead.
// The sentence on the page says exactly that — every mark and company on screen, and an open report
// whole — because a reader who expects only names to blur and sees a report go grey would otherwise read
// a working control as a broken one.

import type { CSSProperties } from 'react'
import { useState } from 'react'
import { Icon } from '../components/Icon.tsx'
import type { ShellContext } from '../shell/AppShell.tsx'
import { permissionsPhrase, accessChips } from '../shell/accessWords.ts'
import { PageHeader } from '../components/PageHeader.tsx'

type Theme = 'light' | 'dark'

/** Anything that is not the string 'dark' is light. The attribute is DOM state and can hold anything. */
const readTheme = (): Theme => (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light')

export function Preferences({ ctx }: { readonly ctx: ShellContext }) {
  const [theme, setThemeState] = useState<Theme>(readTheme)

  const applyTheme = (next: Theme) => {
    document.documentElement.setAttribute('data-theme', next)
    // Wrapped for the same reason AppShell wraps it: localStorage throws outright in a null-origin or
    // sandboxed context, and a preference that cannot be remembered must still be applied rather than
    // taking the page down on its way.
    try {
      localStorage.setItem('cordillera-theme', next)
    } catch {
      /* private mode, or a sandboxed frame — the theme still applies for this page's lifetime */
    }
    setThemeState(next)
  }

  // An href the server and the decoder have both limited to a mail or web address, or null.
  const contact = ctx.me.administratorContact
  const administrator = contact ? (
    <a
      className="pref-link"
      href={contact}
      // A web address opens beside the portal; a mail address hands over to the mail program and needs no tab.
      {...(/^https?:/i.test(contact) ? { target: '_blank', rel: 'noreferrer' } : {})}
    >
      Clearotron administrator
    </a>
  ) : (
    'Clearotron administrator'
  )

  return (
    <div className="screen">
      {/* "Settings" over "Your preferences" was the same page named twice. The rail says Your
          preferences, so that is the one that stays. */}
      <PageHeader title="Your preferences" />

      <div className="measure pref-cards" style={{ '--screen-measure': '720px' } as CSSProperties}>
        <Section title="Your sign-in">
          <dl className="pref-dl">
            <dt>Address</dt>
            <dd className="pref-address" data-anon="mark">
              {ctx.me.email || '—'}
            </dd>
            {/* What this person may DO, in the words People prints. No role noun: there is none. */}
            <dt>Permissions</dt>
            <dd>{permissionsPhrase(ctx.me.permissions)}</dd>
            {/*
              The points on the tree this person was given, named — the same chips People draws. A
              person given the whole install holds one point, "Everything", which is a stated fact
              rather than a list invented from a wildcard. Empty means the server recorded nothing,
              and it says that rather than rendering a blank.
            */}
            <dt>Access to</dt>
            <dd>
              {ctx.me.access.length ? (
                <span data-anon="mark">{accessChips(ctx.me.access).map((c) => c.label).join(', ')}</span>
              ) : (
                <span className="pref-none">None recorded against this address.</span>
              )}
            </dd>
          </dl>

          <p className="pref-line">
            To change the address, the permissions or the companies on it, contact your {administrator}.
          </p>
          {/* — F47. The portal resolves sign-out per auth mode; linking to
              Cloudflare's endpoint directly returned raw JSON on every local-sign-in install. */}
          <div className="pref-foot">
            <a className="pill" href="/portal/sign-out">
              Log out
            </a>
          </div>
        </Section>

        <Section title="Appearance">
          <div className="pref-themes">
            <ThemeOption label="Light" value="light" current={theme} onPick={applyTheme} />
            <ThemeOption label="Dark" value="dark" current={theme} onPick={applyTheme} />
          </div>
          <p className="pref-line">Also on the top bar, under the circle icon</p>
        </Section>

        <Section title="Blur names while sharing a screen">
          <div className="pref-blur">
            {/* THE TOP BAR'S OWN BUTTON, drawn again: the same class, label and icon, and its pressed state
                read from the one state the top bar reads. No label and no badge — the control is a
                symbol, here as there. */}
            <button
              type="button"
              className="icon-btn"
              aria-pressed={ctx.blurNames}
              aria-label="Blur names for screen sharing"
              title="Blur names for screen sharing"
              onClick={() => ctx.setBlurNames(!ctx.blurNames)}
            >
              <Icon name={ctx.blurNames ? 'eye-off' : 'eye'} />
            </button>
            <span className="pref-blur-line">
              On the top bar. It covers every mark and company on screen, and an open report whole. It stays
              as you left it on this computer.
            </span>
          </div>
        </Section>
      </div>
    </div>
  )
}

/**
 * One theme, pickable by name.
 *
 * Absolute rather than relative — see the header note. `aria-pressed` carries the state rather than colour
 * alone, so the current choice is announced and not merely tinted.
 */
function ThemeOption({
  label,
  value,
  current,
  onPick,
}: {
  readonly label: string
  readonly value: Theme
  readonly current: Theme
  readonly onPick: (v: Theme) => void
}) {
  const on = current === value
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onPick(value)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 9,
        padding: '9px 16px',
        borderRadius: 10,
        border: `1px solid ${on ? 'var(--accent)' : 'var(--border-hairline)'}`,
        background: on ? 'var(--accent-wash)' : 'var(--surface-raised)',
        color: on ? 'var(--text-accent)' : 'var(--text-strong)',
        fontSize: 14,
        fontWeight: on ? 700 : 500,
        cursor: 'pointer',
      }}
    >
      <Icon name="theme" size={16} />
      {label}
      {on ? <Icon name="check" size={15} /> : null}
    </button>
  )
}

function Section({ title, children }: { readonly title: string; readonly children: React.ReactNode }) {
  return (
    <section className="pref-card">
      <h2 className="pref-title">{title}</h2>
      {children}
    </section>
  )
}
