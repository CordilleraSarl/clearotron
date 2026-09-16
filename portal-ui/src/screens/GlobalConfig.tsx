// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Installation settings — what this deployment searches with, and what it cannot search with. Read by
// someone who sees the whole installation, and read-only.
//
// It answers three questions without anyone opening a terminal: how people sign in, which engine is
// running the searches and who is billed for them, and which providers are wired up. That also makes it
// the page most able to do harm by being wrong: an answer here is BELIEVED, and a confident wrong answer
// sends someone to go switch on something already running, or to stop looking for a cause they have
// already found.
//
// Two things protect it. Every row is served by the process that is authoritative for it, and since the
// owner's 2026-09-05 ruling that is this deployment READ LIVE — the page shows current configuration,
// always, and what the last run recorded is a secondary row whose job is to name any field it disagrees
// with. (It reads live because the portal shares the engine's environment: one configuration per server
// box, ruling 2026-08-26.) And every "I cannot tell" is said in words rather than rendered as an empty
// list — see the notices below, which are the whole design.
//
// THREE SECTIONS, AND SIGN-IN LEADS. Sign-in is the portal's own door, and the rows below it describe the
// engine's configuration; the page names which reading it is showing rather than leaving a reader to
// assume, because presenting an old reading as current fact is the defect the 2026-09-05 ruling was about.
// Under Engine sits the engine's own web search, a capability of the engine rather than a provider. Under
// Providers each category is a heading with its sources beneath it, so no row repeats its category.
//
// ── WHAT THIS PAGE DELIBERATELY DOES NOT SHOW ───────────────────────────────────────────────────────
//
// Administrator detail. A row needing action says what it needs in a few words and offers the setup
// guide; the variable names, credential paths and README steps an administrator fixes it with live in that
// guide and in the doctor's output, never on this page, which is read in screen shares. Every row's words
// are decided in contract/installationSettings.ts, which copies no server remedy onto the page.
//
// It also used to list internal switch names with on / switched off / never set. Every one of those
// switches is now deleted, and the listing was the wrong shape before it was empty. The snapshot still
// CARRIES the flag fields — `flagsDeclared` and `postureDelta` are what make the next flag declare itself —
// so this is a change to what is rendered, not to what is recorded.
//
// Read-only on purpose. Flipping a switch from a browser would be a production change with no review
// and no record; these move in configuration management, where they are seen.

import type { CSSProperties, ReactNode } from 'react'
import { api, isOk } from '../contract/api.ts'
import { engineRow } from '../contract/engineState.ts'
import type { EngineState, FlagView } from '../contract/api.ts'
import {
  engineCapabilityRows, providerCategories, setupGuideUrl, signInRow, type SetupGuide,
} from '../contract/installationSettings.ts'
import { Icon } from '../components/Icon.tsx'
import { PageHeader } from '../components/PageHeader.tsx'
import { useLoad } from '../state/useApi.ts'
import type { ShellContext } from '../shell/AppShell.tsx'

const TITLE = 'Installation settings'

export function GlobalConfig({ ctx }: { readonly ctx: ShellContext }) {
  void ctx
  const { result } = useLoad(() => api.adminConfig(), [])
  // The repository the server names, for the setup guides. Never a literal: this portal may be a fork.
  const { result: about } = useLoad(() => api.about(), [])
  const repo = about && isOk(about) && about.value.sourceRepo ? about.value.sourceRepo : null

  if (result && result.kind !== 'ok') {
    return (
      <div className="screen">
        <PageHeader title={TITLE} />
        <div className="empty">
          <Icon name="alert" size={20} />
          <p>This page is not available.</p>
        </div>
      </div>
    )
  }
  if (!result) return <div className="screen"><PageHeader title={TITLE} /></div>
  const v: FlagView = result.value

  if (!v.available) {
    return (
      <div className="screen">
        <PageHeader title={TITLE} />
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
        <PageHeader title={TITLE} />

        {/* SIGN-IN COMES FIRST, and it is the only row here the PORTAL answers for; everything under it
            is the engine's answer. One row, with the mode and the issuer as its quiet second line. */}
        <Group title="Sign-in">
          <div className="cfg-rows">
            {v.auth ? <Row {...signInRow(v.auth)} repo={repo} /> : <NotServed />}
          </div>
        </Group>

        <Group title="Engine">
          <div className="cfg-rows">
            {v.engine ? (
              <Engine
                engine={v.engine}
                /* THE ROW ANSWERS THE READER'S QUESTION, NOT ITS OWN. This row reports the LIVE posture,
                   and the screen that decides whether a search can start reads the capture instead — so a
                   box where those disagree about the engine program drew a green row here while New
                   clearance replaced its start button with "no search engine is attached". Green on the
                   page an operator checks first is what made that contradiction cost a user. */
                programDisputed={(v.lastRun?.disagrees ?? []).some((d) => d.what === 'engine program')}
              />
            ) : (
              <NotRecorded what="which engine is running" source={v.source} />
            )}
            {engineCapabilityRows(v.providers ?? []).map((r) => <Row key={r.name} {...r} repo={repo} />)}
          </div>
        </Group>

        <Group title="Providers">
          {v.providers === null ? (
            <NotRecorded what="which providers are configured" source={v.source} />
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
            providerCategories(v.providers).map((c) => (
              <div className="cfg-cat" key={c.key}>
                <div className="cfg-sub">{c.label}</div>
                {c.note ? <p className="cfg-cat-note">{c.note}</p> : null}
                <div className="cfg-rows">
                  {c.rows.map((r, i) => <Row key={`${r.name}:${i}`} {...r} repo={repo} />)}
                </div>
              </div>
            ))
          )}
        </Group>

        {/* WHAT THIS PAGE IS SHOWING, AND WHAT THE LAST RUN SAW — ruling 2026-09-05:
            the page shows LIVE configuration, always, and the age banner is retired.

            THE BANNER WENT BECAUSE IT ANSWERED THE WRONG QUESTION. It said "this snapshot is more than a
            day old", which a reader cannot act on, and it fired on age alone — so a box being configured,
            which writes fresh captures and is exactly where the values drift, never triggered it. The
            live incident was caught only because the capture happened to be 26 hours old. An hour earlier
            the same wrong answer would have shown in silence.

            What replaces it says which fields actually differ, at any age, or nothing at all. */}
        {v.source === 'capture' ? (
          <div style={{ marginTop: 20, paddingTop: 12, borderTop: '1px solid var(--border-hairline)' }}>
            <p style={{ margin: 0, color: 'var(--tone-medium)', fontSize: 13 }}>
              This is what the last run recorded, not a live reading of this deployment.
            </p>
          </div>
        ) : null}

        {v.lastRun ? (
          <div style={{ marginTop: 20, paddingTop: 12, borderTop: '1px solid var(--border-hairline)' }}>
            {/* The disagreement is the point, so it leads. The date is context for it and follows. */}
            {v.lastRun.disagrees && v.lastRun.disagrees.length > 0 ? (
              <>
                <p style={{ margin: '0 0 6px', color: 'var(--tone-medium)', fontSize: 13 }}>
                  The last run did not run under this configuration:
                </p>
                <ul style={{ margin: '0 0 8px', paddingLeft: 18, color: 'var(--tone-medium)', fontSize: 13 }}>
                  {v.lastRun.disagrees.map((d) => (
                    <li key={d.what} style={{ marginBottom: 2 }}>
                      {/* Both sides named. "Something differs" sends a reader to ssh; naming the value on
                          each side is a sentence they can act on without leaving the page. */}
                      {d.what}: the last run saw <span className="mono">{d.capture ?? 'nothing'}</span>,
                      {' '}this deployment is configured for <span className="mono">{d.live ?? 'nothing'}</span>.
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {v.lastRun.capturedAt ? (
              <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>
                Last run recorded its configuration at <span className="mono">{v.lastRun.capturedAt}</span>.
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
//
// AND THE REMEDY DEPENDS ON WHICH READING FAILED. Since the page answers LIVE, a
// missing field usually is not an old snapshot at all — it is this deployment's own posture failing to
// derive, and "it will say after the next run" would send a reader to wait for something that will not
// help. The capture wording survives for the branch it is still true of.
const NotRecorded = ({ what, source }: { readonly what: string; readonly source: FlagView['source'] }) => (
  <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '10px 13px' }}>
    {source === 'capture'
      ? <>This capture does not record {what}. It was written by an earlier version of the engine; it will
        say after the next run on this instance.</>
      : <>This deployment did not report {what}. That is a gap in what this service could read just now,
        not a statement that nothing is configured.</>}
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

// THE ROW IS THE SHARED DECISION'S OUTPUT, SPREAD — no second expression for anything it carries.
//
// This used to assemble the row here: a fault list built in place, and `ok={faults.length === 0}` beside
// it. Driving the fault list then proved the list and said nothing about whether this screen asked for
// it, which is the same shape as the defect the issue is about — a row drawn green while the data under
// it said otherwise. Recomputing `ok`, or adding a condition next to it, would have left every test on
// the list green and put the reader back in front of a lying row.
//
// One call site, spread whole, so the row is covered by construction rather than by this file agreeing
// with another one. `engineState.test.ts` holds both the relation and this call site.
function Engine({ engine, programDisputed = false }: { readonly engine: EngineState; readonly programDisputed?: boolean }) {
  return <Row {...engineRow(engine, { programDisputed })} />
}

/**
 * One row: a dot, the name, what it covers, and a state; beneath them the quiet lines and, where the row
 * needs action, what it needs and the setup guide. Every value arrives decided — this draws, and chooses
 * nothing but the colour its `ok` and `off` already name.
 */
function Row({
  ok, off = false, name, mono, state, faults, note = null, detail = null, guide = null, repo = null,
}: {
  readonly ok: boolean
  readonly off?: boolean
  readonly name: string
  readonly mono: string | null
  readonly state: string
  readonly faults: readonly string[]
  readonly note?: string | null
  readonly detail?: string | null
  readonly guide?: SetupGuide | null
  readonly repo?: string | null
}) {
  const tone = ok ? '' : off ? ' off' : ' bad'
  return (
    <div className="cfg-row">
      <div className="cfg-line">
        <span className={`cfg-dot${tone}`} />
        <span className="cfg-name">{name}</span>
        {mono ? <span className="cfg-val">{mono}</span> : null}
        <span className={`cfg-state${tone}`}>{state}</span>
      </div>
      {detail ? <p className="cfg-note mono">{detail}</p> : null}
      {note ? <p className="cfg-note">{note}</p> : null}
      {faults.map((f, i) =>
        guide && i === faults.length - 1 ? (
          <div className="cfg-act" key={f}>
            <p className="cfg-note bad">{f}</p>
            <GuideButton guide={guide} repo={repo} />
          </div>
        ) : (
          <p className="cfg-note bad" key={f}>{f}</p>
        ),
      )}
    </div>
  )
}

/**
 * The setup guide, opened beside the page. Until the server has named its repository there is no address to
 * open, so the button is drawn and inert rather than pointing at somebody else's copy of the product.
 */
function GuideButton({ guide, repo }: { readonly guide: SetupGuide; readonly repo: string | null }) {
  return repo ? (
    <a className="pill" href={setupGuideUrl(repo, guide)} target="_blank" rel="noreferrer">
      Setup guide
    </a>
  ) : (
    <button type="button" className="pill" disabled>
      Setup guide
    </button>
  )
}

function Group({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <div className="cfg-group">
      <div className="eyebrow">{title}</div>
      {children}
    </div>
  )
}
