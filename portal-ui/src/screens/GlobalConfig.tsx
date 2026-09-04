// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Global config — what this deployment searches with, and what it cannot search with. Staff only, read-only.
//
// It answers three questions without anyone opening a terminal: how people sign in, which engine is
// running the searches and who is billed for them, and which providers are wired up. That also makes it
// the page most able to do harm by being wrong: an answer here is BELIEVED, and a confident wrong answer
// sends someone to go switch on something already running, or to stop looking for a cause they have
// already found.
//
// Two things protect it. Every row is served by the process that is authoritative for it — the engine's
// settings from a snapshot that engine writes, and the portal's own door read live by the portal, which
// is the one row this page reads from its own environment (, ruled 2026-08-21). And every "I cannot
// tell" is said in words rather than rendered as an empty list — see the notices below, which are the
// whole design.
//
// THE TWO SOURCES ARE VISIBLY SEPARATE, which is why Sign-in sits ABOVE the notice rather than under it.
// That notice says everything on the page was written by the search engine; it is now scoped to what
// follows it, because it would be false about the sign-in row and this page cannot afford a sentence
// that is nearly true.
//
// ── WHAT THIS PAGE DELIBERATELY DOES NOT SHOW ───────────────────────────────────────────────
//
// It used to list internal switch names with on / switched off / never set, in three sections, and
// explain each section at length. Every one of those switches is now deleted ( item 8), but the
// listing was the wrong shape before it was empty: a person opens this page to ask what the instance is
// running, and a register of machinery answered a question nobody had. The snapshot still CARRIES the
// flag fields and must keep doing so — `flagsDeclared` and `postureDelta` are what make the next flag
// declare itself — so this is a change to what is rendered, not to what is recorded.
//
// Read-only on purpose. Flipping a switch from a browser would be a production change with no review
// and no record; these move in configuration management, where they are seen.

import type { CSSProperties } from 'react'
import { api } from '../contract/api.ts'
import type { AuthState, EngineState, FlagView, ProviderState } from '../contract/api.ts'
import { Icon } from '../components/Icon.tsx'
import { useLoad } from '../state/useApi.ts'
import type { ShellContext } from '../shell/AppShell.tsx'

export function GlobalConfig({ ctx }: { readonly ctx: ShellContext }) {
  void ctx
  const { result } = useLoad(() => api.adminConfig(), [])

  if (result && result.kind !== 'ok') {
    return (
      <div className="screen">
        <div className="empty">
          <Icon name="alert" size={20} />
          <p>This page is not available.</p>
        </div>
      </div>
    )
  }
  if (!result) return <div className="screen" />
  const v: FlagView = result.value

  if (!v.available) {
    return (
      <div className="screen">
        <div className="measure" style={{ '--screen-measure': '720px' } as CSSProperties}>
          <div className="notice">
            <b>Configuration cannot be read from here</b>
            <p style={{ margin: '6px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>{v.note}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="screen">
      <div className="measure">
        {/* SIGN-IN COMES FIRST, AND ABOVE THE NOTICE, and both of those are the same decision.
            This is the only row here the PORTAL answers for; everything under the notice is the
            engine's answer, read from a snapshot. Placing it below would put it under a sentence
            saying "written by the search engine itself", which would be false about it — on the one
            page whose whole value is that it is believed. So the notice now scopes what FOLLOWS it,
            and this group sits outside that claim.. */}
        <Group title="Sign-in">
          {v.auth ? <Auth auth={v.auth} /> : <NotServed />}
        </Group>

        <Group title="Engine">
          {v.engine ? <Engine engine={v.engine} /> : <NotRecorded what="which engine is running" />}
        </Group>

        <Group title="Providers">
          {v.providers === null ? (
            <NotRecorded what="which providers are configured" />
          ) : v.providers.length === 0 ? (
            // An empty ARRAY is not reachable from the writer — the inventory is built from the driver's
            // tables, which always hold a register row and at least one research and one search adapter.
            // It is stated anyway, because the alternative is a heading with nothing under it, and a
            // heading with nothing under it reads as "no provider is configured" to the one reader this
            // page exists for. An empty group is a sentence this page has not written.
            <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '10px 13px' }}>
              This snapshot lists no provider at all, which should not be possible. Treat the rest of this
              page as suspect and check the engine&rsquo;s last drain.
            </div>
          ) : (
            v.providers.map((p) => <Provider key={`${p.key}:${p.provider ?? 'none'}`} p={p} />)
          )}
        </Group>

        {/* ONE LINE, AT THE BOTTOM ('s sibling,). The paragraph that
            stood at the top explained the plumbing — that this service cannot read the engine's settings
            — which is a fact about our architecture and not one the reader can act on.
            WHAT "UPDATED" MEANS, so nobody re-opens it: `capturedAt` is stamped when the ENGINE writes
            its snapshot (driver/flag-snapshot.mjs, unconditional write, fresh clock every time), and that
            happens at engine start and after every drain — NOT when a setting changes. So it means "this
            page's information was refreshed at", and it moves with every run.
            The stale warning travels WITH it rather than staying at the top: it is the one sentence on
            the page telling a reader the values may be wrong, and it is unreadable separated from the
            timestamp it is about. */}
        {v.capturedAt || v.stale ? (
          <div style={{ marginTop: 20, paddingTop: 12, borderTop: '1px solid var(--border-hairline)' }}>
            {v.capturedAt ? (
              <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>
                Updated <span className="mono">{v.capturedAt}</span>.
              </p>
            ) : null}
            {v.stale ? (
              <p style={{ margin: v.capturedAt ? '6px 0 0' : 0, color: 'var(--tone-medium)', fontSize: 13 }}>
                This snapshot is more than a day old. The values on this page are the last known state
                and may no longer match the engine.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/**
 * THE THIRD STATE, AND THE REASON IT IS A SENTENCE RATHER THAN AN EMPTY LIST.
 *
 * `null` means the snapshot was written before the engine recorded this — which is every snapshot on
 * every deployment until its driver next drains. Rendering it as no rows would say "nothing is
 * configured", the exact inverse of the fact, on the one page whose value is that it is believed. An
 * instance with nothing configured sends rows, each of them saying so.
 */
const NotRecorded = ({ what }: { readonly what: string }) => (
  <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '10px 13px' }}>
    This snapshot does not record {what}. It was written by an earlier version of the engine; it will
    say after the next run on this instance.
  </div>
)

/**
 * THE FOURTH STATE, and it is not the same as NotRecorded above.
 *
 * `NotRecorded` means an older SNAPSHOT did not carry a field. This means an older PORTAL did not serve
 * one — a different process, a different upgrade, a different remedy. Collapsing the two into one
 * sentence would send someone to wait for a drain that will never add it.
 */
const NotServed = () => (
  <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '10px 13px' }}>
    This version of the portal does not report how people sign in. It will say after this service is
    upgraded — a search engine drain will not add it.
  </div>
)

function Auth({ auth }: { readonly auth: AuthState }) {
  // THE MODE AND THE ISSUER, AND NOTHING ELSE. Not the audience, not the secret, not the token header,
  // and not local mode's single address — this page is read over shoulders and in screen shares, and
  // none of those tell a staff member anything they opened it to learn.
  const fronted = auth.shape === 'fronted'
  const name = fronted
    ? 'A login provider in front'
    : auth.shape === 'local'
      ? 'Local sign-in, one address, loopback only'
      : 'Not a sign-in method this service has'

  const faults = [
    ...(auth.missing.length ? [`Set ${auth.missing.join(' and ')}.`] : []),
    // Unreachable from a running portal — portal-service.mjs refuses to start on a mode it does not
    // have — so if a reader ever sees this, the page is being served by something that is not that
    // service, and saying so is more use than a blank row.
    ...(auth.shape === 'unrecognised'
      ? ['This service refuses to start in this mode, so this page should not be reachable. Treat it as suspect.']
      : []),
  ]

  return (
    <>
      <Row
        ok={faults.length === 0}
        name={name}
        mono={auth.mode}
        // "Default" is a fact worth one word: nobody typed this, and an operator who believes they
        // chose it will not go looking for the variable that would change it.
        state={auth.declared === null ? 'Default' : 'Configured'}
        faults={faults}
      />
      {fronted && auth.issuer ? (
        <Row ok name="Issuer" mono={auth.issuer} state="Configured" faults={[]} />
      ) : null}
    </>
  )
}

function Engine({ engine }: { readonly engine: EngineState }) {
  // Believe `apiBilled`, not `mode`. They agree except in one state — the engine is set to bill an API
  // key that is not set — and that is the state worth showing, because the driver refuses a run in it.
  const billed = engine.billing.apiBilled ? 'API key' : 'Subscription'
  const faults = [
    ...(engine.known ? [] : [`This build does not ship an engine called ${engine.id}.`]),
    ...(engine.billing.missing.length
      ? [`Set to bill an API key, and ${engine.billing.missing.join(' and ')} is not set — a run is refused rather than billed to the subscription.`]
      : []),
    ...(engine.binaryPresent ? [] : ['The engine program cannot be found or run on this machine.']),
  ]

  return (
    <Row
      ok={faults.length === 0}
      name={engine.vendor ?? engine.id}
      mono={engine.id}
      state={billed}
      faults={faults}
    />
  )
}

function Provider({ p }: { readonly p: ProviderState }) {
  // A provider with no credential is a ROW SAYING SO, never an omitted row: a page listing two
  // providers is indistinguishable from a page listing a complete set of two.
  // — THE ROW'S OWN REMEDY WINS. "Set X and Y" is the right sentence for a
  // credential and the wrong one for a capability enrolled by a one-time OAuth sign-in, or for one this
  // build does not ship at all: both have an empty `missing` list, and the composed sentence would read
  // "Set ." A row that says what to do is the whole point of this page.
  const faults = p.remedy
    ? [p.remedy]
    : p.configured
      ? []
      : p.provider === null
        ? [`No register is selected. Set ${p.missing.join(' and ')}.`]
        : !p.known
          ? [`This build does not ship a provider called ${p.provider}.`]
          : [`Set ${p.missing.join(' and ')}.`]

  return (
    <Row
      ok={p.configured}
      name={p.label}
      mono={p.providerLabel ?? p.provider ?? null}
      // "Missing" is a claim about a credential nobody set. A capability this build does not ship is not
      // missing from the install, and a lane the engine decides per session is not configured HERE.
      state={p.configured ? 'Configured' : !p.known ? 'Not in this build' : p.missing.length ? 'Missing' : 'Not set up'}
      faults={faults}
    />
  )
}

function Row({
  ok, name, mono, state, faults,
}: {
  readonly ok: boolean
  readonly name: string
  readonly mono: string | null
  readonly state: string
  readonly faults: readonly string[]
}) {
  return (
    <div
      style={{
        padding: '10px 13px',
        borderRadius: 9,
        border: '1px solid var(--border-hairline)',
        background: 'var(--surface-raised)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Dot ok={ok} />
        <span style={{ flex: 1, color: 'var(--text-strong)', fontSize: 13 }}>{name}</span>
        {mono ? (
          <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{mono}</span>
        ) : null}
        <span style={{ fontSize: 12.5, color: ok ? 'var(--text-muted)' : 'var(--tone-high)', minWidth: 86, textAlign: 'right' }}>
          {state}
        </span>
      </div>
      {faults.map((f) => (
        <p key={f} style={{ margin: '6px 0 0 21px', fontSize: 12.5, color: 'var(--tone-high)' }}>{f}</p>
      ))}
    </div>
  )
}

function Group({ title, children }: { readonly title: string; readonly children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 22 }}>
      <div style={{ fontWeight: 700, color: 'var(--text-strong)', fontSize: 15, marginBottom: 8 }}>{title}</div>
      <div style={{ display: 'grid', gap: 6 }}>{children}</div>
    </div>
  )
}

// `--tone-minimal` and `--tone-high`, not `--tone-clear` / `--tone-med`: those two were used here and on
// three other screens and are defined in NO stylesheet, so the dot and the stale notice both rendered
// with no colour at all — the one notice on this page whose job is to be noticed. An undefined custom
// property fails at no build step and in no type, which is why it survived. The other three screens are
// outside this issue.
const Dot = ({ ok }: { readonly ok: boolean }) => (
  <span
    className="dot"
    style={{ background: ok ? 'var(--tone-minimal)' : 'var(--tone-high)', width: 9, height: 9, flex: 'none' }}
  />
)
