// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Your preferences — the two settings that belong to this browser, and the identity that does not.
//
// The page is deliberately small, and most of the thinking in it is about what NOT to put here.
//
// IDENTITY IS READ-ONLY. Who you are signed in as, and whether that identity is operator staff or a
// client, are answers from the server. There is no edit control because there is nothing here that could
// honour one: the session is Cloudflare Access's, not the portal's, which is also why the way out is
// Access's logout endpoint rather than a button this app could implement. AppShell's account menu already
// links there; this page uses the same destination rather than inventing a second sign-out path.
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
// THE SCREEN-SHARE BLUR IS EXPLAINED, NOT DUPLICATED. It already has a control — the eye button in the
// top bar — and it is held in AppShell's own state, which is what drives the `anon-on` class. A second
// control here could set that class directly, but AppShell's state would not know it had changed, so the
// next press of the top-bar button would toggle its state from off to on and re-apply a class that was
// already applied: a dead click, and the user would reasonably conclude the feature is broken. One
// control and an explanation beats two controls that disagree.
//
// WHAT THE BLUR COVERS IS A SMALLER SET THAN THIS PAGE USED TO CLAIM, and the correction is the reason
// this section is worded the way it is. The whole mechanism is one CSS rule in base.css —
// `html.anon-on [data-anon='mark']` — so it reaches exactly those elements that THIS app renders and
// tags. That is the lists, this page, and the mark and brand owner printed above a report (Result.tsx
// tags `run.title` and `run.account`). It is not the report itself. The report is an iframe sandboxed
// deliberately WITHOUT allow-same-origin, which gives the embedded document a null origin: no rule in
// this document's stylesheet applies inside it, and no script here could reach in to add one. Nor does
// the document arrive pre-tagged — the report renderer (driver/portal-report.mjs) emits no `data-anon`
// anywhere, so there would be nothing for such a rule to match even if it could cross.
//
// The previous copy said the blur covered "a report", and that is the worst shape a false claim can
// take on this particular page: it is read once, believed, and then relied on by someone putting a
// client's marks on a projector. base.css's own comment makes the same mistake ("one keystroke blurs
// the portal and an embedded report identically") — it is describing shared/anon-overlay.mjs, which
// masks the INTERNAL archive and profile pages, not a portal report.
//
// That was fixed rather than documented. Result.tsx now tags the frame's CONTAINER, and a CSS filter on
// an ancestor rasterises the frame along with it, so the blur does reach the report after all. The
// trade is that the WHOLE document blurs rather than the names inside it — the report has no per-name
// markup and the null origin means none can be added — and for a screen-share that is the safer
// direction. The copy below says exactly that, because a reader who expects only names to blur and
// sees the page go grey would otherwise think it had broken.

import type { CSSProperties } from 'react'
import { useState } from 'react'
import { Icon } from '../components/Icon.tsx'
import type { ShellContext } from '../shell/AppShell.tsx'
import { staffLabel, operatorName } from '../contract/api.ts'

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

  const role = ctx.me.role === 'staff' ? staffLabel(ctx.me.brand) : 'Client'

  return (
    <div className="screen">
      <div className="eyebrow">Settings</div>
      <h1 style={{ fontSize: 27, margin: '4px 0 6px', color: 'var(--text-strong)' }}>Your preferences</h1>
      <p className="prose" style={{ margin: 0, color: 'var(--text-muted)' }}>
        Who you are signed in as, and how the portal looks on this computer.
      </p>

      <div className="measure" style={{ '--screen-measure': '720px' } as CSSProperties}>
        <Section title="Your sign-in" hint={`Held by ${operatorName(ctx.me.brand)}. Nothing here can be changed from this page.`}>
          <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 18px', fontSize: 14 }}>
            <dt style={{ color: 'var(--text-muted)' }}>Address</dt>
            <dd style={{ margin: 0, color: 'var(--text-strong)', wordBreak: 'break-all' }} data-anon="mark">
              {ctx.me.email || '—'}
            </dd>
            <dt style={{ color: 'var(--text-muted)' }}>Role</dt>
            <dd style={{ margin: 0, color: 'var(--text-strong)' }}>{role}</dd>
            {/*
              Brand owners are listed only when the server actually sent a list. A staff identity is
              granted everything, which arrives as a wildcard rather than as names — the roster is its
              own endpoint — so rendering a count or a list for staff here would mean inventing one.
              Saying what is true and stopping is the whole rule.
            */}
            <dt style={{ color: 'var(--text-muted)' }}>Brand owners</dt>
            <dd style={{ margin: 0, color: 'var(--text-strong)' }}>
              {ctx.me.allAccounts ? (
                `Every brand owner ${operatorName(ctx.me.brand)} holds`
              ) : ctx.me.accounts.length ? (
                <span data-anon="mark">{ctx.me.accounts.join(', ')}</span>
              ) : (
                <span style={{ color: 'var(--text-muted)' }}>None recorded against this address.</span>
              )}
            </dd>
          </dl>

          <p style={{ margin: '14px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
            To change the address, the role or the brand owners on it, ask {operatorName(ctx.me.brand)} —
            enrolment is done for you, not from this page.
          </p>
          {/* — F47. The portal resolves sign-out per auth mode; linking to
              Cloudflare's endpoint directly returned raw JSON on every local-sign-in install. */}
          <a className="pill" href="/portal/sign-out" style={{ display: 'inline-block', marginTop: 12, textDecoration: 'none' }}>
            Log out
          </a>
        </Section>

        <Section title="Appearance" hint="Applies straight away, and is remembered in this browser.">
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <ThemeOption label="Light" value="light" current={theme} onPick={applyTheme} />
            <ThemeOption label="Dark" value="dark" current={theme} onPick={applyTheme} />
          </div>
          <p style={{ margin: '12px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
            The same choice is on the top bar, under the circle icon — this page and that button set one
            and the same setting.
          </p>
        </Section>

        <Section title="Blurring names while you share a screen" hint="There is one control for this, and it is on the top bar.">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span
              className="pill"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '4px 11px' }}
            >
              <Icon name="eye" size={15} />
              Top bar
            </span>
            <span style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>
              The eye button, to the left of your initials.
            </span>
          </div>
          <p style={{ margin: '12px 0 0', color: 'var(--text-muted)', fontSize: 13.5 }}>
            Pressing it blurs every brand name, mark and brand owner the portal puts on screen — in the
            lists, on this page, in the heading above a report, and the report itself — so you can put the
            portal on a call or a projector without showing whose names are in clearance. Nothing is
            hidden from you: the text
            is still there and still selectable by the page, it is only blurred on screen. Press the button
            again to bring the names back.
          </p>

          {/*
            Said plainly because the behaviour is not what a reader would guess. A report cannot be
            blurred name-by-name — it is a separate document with a null origin, so nothing in this page
            can tag the names inside it — and the whole document blurs instead. Someone who expected
            only the names to go soft, and sees the entire report go grey, needs to have been told, or
            they will read a working control as a broken one and turn it off.
          */}
          <div className="notice" style={{ marginTop: 14, borderLeftColor: 'var(--tone-medium)' }}>
            <b style={{ color: 'var(--text-strong)' }}>An open report blurs completely</b>
            <p style={{ margin: '6px 0 0', color: 'var(--text-muted)' }}>
              A report is a separate document held inside the page, and it can only be covered whole. With
              a report open, the button blurs all of it rather than just the names in it. That is deliberate
              — it is the safer way round for a screen you are sharing.
            </p>
          </div>

          <p style={{ margin: '10px 0 0', color: 'var(--text-muted)', fontSize: 13.5 }}>
            It starts switched off every time you open the portal, so reloading the page brings the names
            back whether you meant it to or not. Turn it on again before you share.
          </p>
        </Section>

        {/*
          The honesty note. Both settings on this page are held by the browser, and neither is sent to
          Cordillera — so neither one travels. Someone who sets dark mode on their laptop and then opens
          the portal on a phone will find it light, and the only thing worse than that happening is it
          happening to someone who was told these preferences "follow you".
        */}
        <div className="notice quiet" style={{ marginTop: 26 }}>
          <b style={{ color: 'var(--text-strong)' }}>These two settings stay on this computer</b>
          <p style={{ margin: '6px 0 0', color: 'var(--text-muted)' }}>
            {operatorName(ctx.me.brand, { lead: true })} does not store them against your account. The appearance choice is kept by this
            browser, so it holds for this computer and this browser only — sign in somewhere else, or use a
            different browser here, and you will get the light theme again until you set it. The screen-share
            blur is not kept at all: it lasts until you reload or close the page.
          </p>
        </div>
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

function Section({
  title,
  hint,
  children,
}: {
  readonly title: string
  readonly hint?: string
  readonly children: React.ReactNode
}) {
  return (
    <section
      style={{
        marginTop: 22,
        padding: '18px 20px',
        borderRadius: 12,
        border: '1px solid var(--border-hairline)',
        background: 'var(--surface-raised)',
      }}
    >
      <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-strong)', margin: 0 }}>{title}</h2>
      {hint ? <p style={{ margin: '2px 0 14px', fontSize: 13, color: 'var(--text-muted)' }}>{hint}</p> : <div style={{ height: 14 }} />}
      {children}
    </section>
  )
}
