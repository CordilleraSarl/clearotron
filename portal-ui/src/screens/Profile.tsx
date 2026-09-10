// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Profile — how a company's clearances are scoped, rated and delivered.
//
// This screen writes to the file the engine loads at the start of every run. A profile that fails
// validation does not fail politely: it takes that account's searches down until someone fixes it by
// hand. So the save is two steps, and the first one is the server running the SAME validators the
// engine runs at load time. "Check" is not a nicety here — it is the thing standing between a typo and
// an account that cannot search.
//
// The other rule that shapes this file is that the draft is SEEDED FROM THE SERVER and edited in place.
// A form that renders nine fields and posts nine fields will erase the tenth the day the engine grows
// one. See contract/profileFields.ts — the reasoning is there and the behaviour is pinned by tests.

import { useEffect, useMemo, useState } from 'react'
import { api, isOk, notCommitted } from '../contract/api.ts'
import type { ProfileConfig } from '../contract/api.ts'
import { PROFILE_FIELDS, FIELD_GROUPS, boxValue, applyField, stripCodeOwned, visibleReadOnlyFields } from '../contract/profileFields.ts'
import { Field } from '../components/ProfileField.tsx'
import type { FieldSpec } from '../contract/profileFields.ts'
import { Icon } from '../components/Icon.tsx'
import { ContextPackEditor } from '../components/ContextPackEditor.tsx'
import { useLoad } from '../state/useApi.ts'
import { useUnsaved } from '../state/useUnsaved.ts'
import type { ShellContext } from '../shell/AppShell.tsx'
import { CompanyGate } from '../shell/CompanyPicker.tsx'
import { canManage } from '../shell/permissions.ts'

type Saved = { readonly at: number; readonly sha: string | null }

export function Profile({ ctx }: { readonly ctx: ShellContext }) {
  const account = ctx.owner
  const needsOwner = ctx.me.allAccounts && account === null

  const { result, reload } = useLoad(() => api.profile(account), [account])
  const loaded: ProfileConfig | null = result?.kind === 'ok' ? result.value : null

  // The search-depth menu, from the engine's own registry rather than a list copied into the bundle.
  // A second call on this screen, but a one-shot load rather than a poll, so it costs one request
  // against the 120/min per-email budget and not a stream of them.
  const { result: searchesResult } = useLoad(() => api.searches(account), [account])
  const productChoices: readonly { value: string; label: string }[] | null =
    searchesResult == null
      ? null                                     // still loading — not the same as "there are none"
      : searchesResult.kind === 'ok'
        ? searchesResult.value.products.map((l) => ({
            value: l.key,
            // Availability is a runtime fact the portal is TOLD, not one it can compute. A level that
            // is not built can still be chosen as a default; it clarifies at admission. Saying so on
            // the option is better than hiding it and leaving the account's real default unexplained.
            // Name first, stage after a middot — never a second em dash, because the unavailable arm
            // already uses one. The stage stays: this is the one control where the reader is picking a
            // position on the ladder, and no effort meter is on screen to carry that instead.
            label: l.available
              ? `${l.name || l.stageLabel} · ${l.stageLabel}`
              : `${l.name || l.stageLabel} · ${l.stageLabel} — not available yet`,
          }))
        : []                                     // failed — Field falls back to showing the value as text

  const [draft, setDraft] = useState<Record<string, unknown> | null>(null)
  // The context pack is NOT a profile field — it is a sibling `<key>.context.md` the engine reads
  // separately — so it gets its own state rather than a row in PROFILE_FIELDS. It rode along as an
  // unrendered round-trip until now: loaded, posted straight back, never shown.
  const [pack, setPack] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<{ readonly title: string; readonly lines: readonly string[] } | null>(null)
  // THE RAW TEXT OF EVERY TOUCHED FIELD, and it is not a duplicate of `draft`.
  // Deriving a box's value from the parsed draft made every keystroke a parse-then-format round trip,
  // and both halves trim: the space in "US France" was eaten as it was typed and the owner's screen
  // showed "USFrance". See FormEdit in the contract for the whole reasoning.
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [checked, setChecked] = useState(false)
  const [saved, setSaved] = useState<Saved | null>(null)

  // Seed once per load. Re-seeding on every render would throw away what the user is typing; not
  // re-seeding after a save would leave the page showing a draft the server may have normalised.
  useEffect(() => {
    if (loaded) {
      setDraft(loaded.profile)
      setPack(loaded.contextPack)
      // Per LOAD, not per session: after a save the boxes must show what the server holds — which it may
      // have normalised — rather than the keystrokes that got there.
      setEdits({})
    }
  }, [loaded])

  // Either half can be the change. Saving posts both, so a pack-only edit has to arm the buttons too —
  // otherwise the box accepts typing and the Save stays greyed out with nothing explaining why.
  const dirty = useMemo(
    () =>
      loaded != null &&
      ((draft != null && JSON.stringify(draft) !== JSON.stringify(loaded.profile)) ||
        (pack != null && pack !== loaded.contextPack)),
    [draft, pack, loaded],
  )

  // The same flag that enables Save is the flag the shell asks before letting anyone leave — including
  // by switching company, which is not a navigation and used to discard edits silently.
  useUnsaved(dirty)

  // needsOwner covers staff (allAccounts, owner not yet chosen); pickAccount covers a CLIENT whose
  // grant spans several companies — the server refuses an ownerless read with pickAccount, and
  // showing that as "could not be loaded" reads as a fault that retrying never fixes (C7's fix
  // covered the four other account-scoped screens; this one was missed).
  if (needsOwner || result?.kind === 'pickAccount') {
    return <CompanyGate ctx={ctx} eyebrow="Company" heading="Profile" line="Pick a company to see its profile." />
  }
  if (result && result.kind !== 'ok') return <Unavailable kind={result.kind} />
  if (!loaded || !draft || pack == null) return <div className="screen" />

  // Any edit invalidates the check. A green tick describing a body that has since changed is worse than
  // no tick: it is a claim about something that no longer exists.
  const touch = () => {
    setChecked(false)
    setProblem(null)
    setSaved(null)
  }

  const edit = (spec: FieldSpec, raw: string) => {
    setDraft((d) => applyField(d ?? {}, spec, raw))
    setEdits((e) => ({ ...e, [spec.key]: raw }))
    touch()
  }

  const editPack = (raw: string) => {
    setPack(raw)
    touch()
  }

  const send = async (action: 'validate' | 'save') => {
    setBusy(true)
    setProblem(null)
    const r = await api.saveProfile(account, action, {
      profile: stripCodeOwned(draft),
      contextPack: pack,
    })
    setBusy(false)
    if (!isOk(r)) {
      setChecked(false)
      setProblem(explain(r))
      return
    }
    if (action === 'validate') {
      setChecked(true)
      return
    }
    setChecked(false)
      // — A SAVE THAT DID NOT COMMIT IS NOT A CLEAN SUCCESS. The server has returned
      // `commitError` on a 200 from every save route for months and nothing here read it, so a write
      // that never reached the store's git rendered as a plain success. The change IS live, so this is
      // a warning rather than a failure — saying "could not be saved" would be the opposite lie.
    const uncommitted = notCommitted(r)
    if (uncommitted) setProblem({ title: 'Saved, but not committed', lines: [uncommitted] })
    setSaved({ at: Date.now(), sha: typeof r.value['sha'] === 'string' ? (r.value['sha'] as string) : null })
    reload()
  }

  return (
    <div className="screen">
      <div className="measure">
        {/* The framework leads the EDITABLE page, under the scope notice above it.
            It is the one thing here nobody can edit and the one thing that decides what every clearance
            for this account COMES OUT AS — doc 50's rule that a company's own framework rates its
            matters. Sitting last, under the editable fields, it read as an appendix to the settings
            rather than as the authority the settings operate under. The notice now precedes it because
            a sentence about what saving does is useless read after the saving; the framework still
            leads everything a person can change. */}
        {/* AT THE TOP, above the framework block ( item 1). It sat last, under the
            fields, where a sentence about what saving does is read after the saving. The owner's
            "changes need the CLI" wording is NOT used here: he ruled option (a) on 2026-08-26 — the
            editor stays, so the page must say what is true of it. The CLI gap he was actually pointing
            at is creating a company, which this page has never done and which is filed separately. */}
        <div className="notice quiet" style={{ margin: '0 0 18px' }}>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>
            These settings scope every clearance for this company. Changes are checked against the
            same rules the search engine applies when it starts a run, and each save is recorded against
            your sign-in.
          </p>
        </div>

        <FrameworkBlock readOnly={loaded.readOnly} framework={loaded.framework} staff={canManage(ctx.me)} />

        {/* Grouped by iteration over FIELD_GROUPS rather than as two hardcoded blocks, so a new field
            joins a group by declaring one, and a new group needs no markup here at all. */}
        {FIELD_GROUPS.map((group) => {
          const specs = PROFILE_FIELDS.filter((s) => s.group === group.id)
          if (!specs.length) return null
          return (
            <div key={group.id} style={{ marginTop: 26 }}>
              <div className="eyebrow">{group.label}</div>
              {specs.map((spec) => (
                <Field
                  key={spec.key}
                  spec={spec}
                  value={boxValue({ draft, edits }, spec)}
                  choices={spec.key === 'defaultProduct' ? productChoices : (spec.choices ?? null)}
                  onChange={(v) => edit(spec, v)}
                />
              ))}
              {/* Coverage is derived from the marketplaces and density in THIS group, so it reads as a
                  consequence of the boxes above it rather than as a stray statistic. */}
              {group.id === 'defaults' ? <UnsearchableTerritories derived={loaded.derived} /> : null}
              {group.id === 'defaults' ? <CoverageNote derived={loaded.derived} /> : null}
            </div>
          )
        })}

        <ContextPackEditor
          value={pack}
          onChange={editPack}
          title="Background &amp; standing concerns"
          hint="Useful background about this company — competitors to watch, recurring concerns, lessons from past matters. Every clearance reads it before it writes. Facts and concerns, not rules: it shapes what a report emphasises, never what a finding is rated."
        />

        {problem ? (
          <div className="notice" style={{ borderColor: 'var(--tone-high)', marginTop: 18 }}>
            <b>{problem.title}</b>
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: 'var(--text-muted)' }}>
              {problem.lines.map((l, i) => <li key={i} style={{ marginBottom: 3 }}>{l}</li>)}
            </ul>
          </div>
        ) : null}

        {saved ? (
          <div className="notice" style={{ borderColor: 'var(--tone-minimal)', marginTop: 18 }}>
            <b>Saved</b>
            <p style={{ margin: '6px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>
              Recorded against your sign-in{saved.sha ? <> · <span className="mono">{saved.sha.slice(0, 8)}</span></> : null}.
            </p>
          </div>
        ) : null}

        <div style={{ marginTop: 22, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="pill"
            disabled={busy || !dirty}
            onClick={() => send('validate')}
            style={{ padding: '9px 16px', cursor: busy || !dirty ? 'not-allowed' : 'pointer', opacity: busy || !dirty ? 0.5 : 1 }}
          >
            {busy ? 'Checking…' : 'Check'}
          </button>
          <button
            type="button"
            className="pill"
            disabled={busy || !dirty || !checked}
            onClick={() => send('save')}
            style={{
              padding: '9px 16px',
              cursor: busy || !dirty || !checked ? 'not-allowed' : 'pointer',
              opacity: busy || !dirty || !checked ? 0.5 : 1,
              background: 'var(--accent-wash)',
              borderColor: 'var(--accent)',
              color: 'var(--text-accent)',
            }}
          >
            Save
          </button>
        {/* THE REASON WAS ALREADY HERE AND IT DID NOT LAND. An outside user hit the disabled Save and
            wrote that they could not click save and found it frustrating — with this sentence already
            on screen beside the button, in muted twelve-point, in the same treatment as the state that
            reports nothing is wrong.

            So this is not a missing string, it is a blocking condition dressed as an aside. Only one of
            the three states stops the reader: nothing edited is not a problem, and checked-and-ready is
            good news. Dirty-and-unchecked is the one where the button they are reaching for will not
            respond, and it is the one that now carries weight and colour. The other two stay quiet,
            because making all three loud is the same as making none of them loud.

            Verb first, too. "Check first" describes the situation; "Press Check" is the thing to do, and
            the control it names is the one sitting immediately to the left. */}
          <span
            style={
              dirty && !checked
                ? { fontSize: 13, color: 'var(--tone-medium)', fontWeight: 600 }
                : { fontSize: 12.5, color: 'var(--text-muted)' }
            }
          >
            {!dirty
              ? 'No changes.'
              : checked
                ? 'Checked — safe to save.'
                : 'Press Check before saving. A profile the engine cannot read stops this account searching.'}
          </span>
        </div>
      </div>
    </div>
  )
}

/**
 * What the marketplaces and density above actually buy, in the engine's own numbers.
 *
 * Derived and never stored — profile-service computes it at view time. It is the one place this page
 * states the CONSEQUENCE of a setting rather than its value, which is why it belongs directly under the
 * settings it is computed from rather than in a panel of its own.
 */
/**
 * Stored default territories the engine cannot search, named.
 *
 * The field accepts these no longer — but a profile written before it did still holds them, and the box
 * shows them back exactly as they were typed. So the screen read as though the setting were in force
 * while the engine ignored it, and the only way to find out was to read the prompt of a finished run.
 *
 * It NAMES the entries rather than counting them: the whole difficulty is that one of six is misspelled
 * and nothing says which one.
 */
function UnsearchableTerritories({ derived }: { readonly derived: Record<string, unknown> | null }) {
  const bad = derived?.['unrecognizedTerritories']
  if (!Array.isArray(bad) || bad.length === 0) return null
  const named = bad.filter((t): t is string => typeof t === 'string')
  if (!named.length) return null
  return (
    <p style={{ margin: '10px 0 0', fontSize: 12.5, color: 'var(--tone-high)', fontWeight: 600 }} role="status">
      Not searched: {named.join(', ')}.{' '}
      {named.length === 1 ? 'That is not a territory' : 'Those are not territories'} the engine can
      search, so it is stored and does nothing. Replace it from the list below, or remove it.
    </p>
  )
}

function CoverageNote({ derived }: { readonly derived: Record<string, unknown> | null }) {
  const batch = derived?.['batchSize']
  const cells = derived?.['minCellsPerVariant']
  if (typeof batch !== 'number' || typeof cells !== 'number') return null
  return (
    <p style={{ margin: '14px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>
      Calculated from the marketplaces and density above: about <b>{batch}</b> search variant
      {batch === 1 ? '' : 's'} per pass across <b>{cells}</b> sources.
    </p>
  )
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)
const arr = (v: unknown): readonly unknown[] => (Array.isArray(v) ? v : [])
const rec = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null

/** Band tone → the shared palette. An unknown tone renders neutral rather than guessing a colour. */
const TONE: Record<string, string> = {
  severe: 'var(--tone-severe)',
  high: 'var(--tone-high)',
  medium: 'var(--tone-medium)',
  low: 'var(--tone-low)',
  minimal: 'var(--tone-minimal)',
}

/**
 * One band, in the framework's own colour.
 *
 * No margin of its own: the ladder spaces its pills with `gap`, and inside a meanings row the pill is a
 * GRID CELL whose column sets its position. A margin here would fight both and reintroduce the ragged
 * edge the grid exists to remove.
 */
function BandPill({ label, tone }: { readonly label: string; readonly tone: unknown }) {
  return (
    <span
      className="pill"
      style={{
        padding: '2px 10px',
        borderRadius: 999,
        background: TONE[String(tone)] ?? 'var(--text-muted)',
        borderColor: 'transparent',
        color: '#fff',
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  )
}

/**
 * How this account is rated, and what it may run.
 *
 * Doc 50's rule is that a company's OWN framework rates their matters, falling back to the house one
 * — so the first thing this block does is say which, unmistakably. Everything under it is the framework
 * describing itself: the ladder in its own order and vocabulary, what each band MEANS in the deck's own
 * words, the axes it reasons on, the entity it voices the client side as. That presentation existed on
 * the old staff editor page and was lost in the React rebuild, which kept only the title.
 *
 * All of it is read-only, and rendered as TEXT rather than as disabled inputs. A greyed-out input invites
 * someone to try, and implies the page could write it if only it were enabled. It cannot: a framework is
 * selected in code under review, and the server strips these fields from every write.
 *
 * Role only decides the PATHS now (`skills/prelim-search/risk-framework-<customer>.md`), and it decides them
 * upstream in portal-upstream.frameworkView — by the time this renders, a client's payload no longer
 * carries them. visibleReadOnlyFields stays as the second wall, not the only one.
 */
function FrameworkBlock({
  readOnly,
  framework,
  staff,
}: {
  readonly readOnly: Record<string, unknown>
  readonly framework: Record<string, unknown> | null
  readonly staff: boolean
}) {
  const entries = visibleReadOnlyFields(readOnly, staff)
  const fw = framework ?? {}
  const manifest = rec(fw['manifest'])
  const title = str(manifest?.['title'])
  const custom = fw['custom'] === true
  const bands = arr(manifest?.['bands'])
  const meanings = arr(fw['bandMeanings'])
  const structure = rec(manifest?.['structure'])
  const axes = arr(structure?.['axes']).map(String).filter(Boolean)
  const entity = str(manifest?.['entity_label'])
  const displayNote = str(structure?.['display_note'])
  const examples = fw['hasWorkedExamples'] === true
  const toneOf = (band: string): unknown =>
    rec(bands.find((b) => rec(b)?.['label'] === band))?.['tone']

  if (!entries.length && !title && !examples && !framework) return null

  return (
    <div className="notice quiet" style={{ marginBottom: 8 }}>
      <div className="fw-sectionh">Risk framework in force</div>

      {/* Which framework is in force, stated so it cannot be misread as one shared method for everyone.
          Boxed rather than run into the prose: for most people opening this page, "which framework rates
          my matters" IS the question, and it should not need finding.

          THREE states, not two. The first cut of this had `custom && title ? custom : house`, which
          collapsed "no custom framework on file" together with "a custom framework IS on file and its
          manifest would not load" — and answered both with "House default". So a customer's page told a
          lawyer their client was rated under the firm's house framework when the profile says otherwise.
          A settings page may render nothing it cannot substantiate; it may never substitute a confident
          wrong answer for a missing one. `custom` comes from the profile (frameworkPath is set) and
          `title` from the manifest, so the two disagreeing is exactly the loadable/not-loadable split. */}
      <div
        className="fw-ro"
        style={custom && !title ? { borderColor: 'var(--tone-high)' } : undefined}
      >
        {custom && title ? (
          <>
            <b>
              Custom framework: <span data-anon="mark">{title}</span>
            </b>{' '}
            — this company&rsquo;s own framework rates every matter for it, in its own words.
          </>
        ) : custom ? (
          <>
            <b style={{ color: 'var(--tone-high)' }}>This account&rsquo;s framework could not be read.</b>{' '}
            A custom framework is on file for this company, so its matters are <b>not</b> rated
            under the Generic default — but its definitions are unavailable, so the bands cannot be shown
            here. This needs an administrator to look at it.
          </>
        ) : (
          <>
            <b>Generic default</b> — no custom framework is on file for this company; its matters
            are rated under the generic framework.
          </>
        )}
      </div>

      {/* THE ROW NEEDS TO SAY WHAT IT IS A ROW OF. Unlabelled, four coloured pills under a heading
          reading "Risk framework in force" are four things under a heading about frameworks, and an
          outside user read them exactly that way: "how do I have FOUR risk frameworks live at the same
          time?" He had one. Four words fix it, and they have to name the framework's OWNERSHIP of the
          scale — "its ratings", not "ratings" — because the sentence directly above names the framework
          and the ambiguity is whether these belong to it or sit beside it. */}
      {bands.length ? (
        <>
          <div className="fw-ladder-label">Its ratings, strongest concern first:</div>
          <div className="fw-ladder">
            {bands.map((b, i) => {
              const band = rec(b)
              const label = str(band?.['label'])
              return label ? <BandPill key={i} label={label} tone={band?.['tone']} /> : null
            })}
          </div>
        </>
      ) : null}

      {/* The decks are Privileged & Confidential, so every line lifted from one is data-anon="mark" —
          the demo privacy blur has to cover it, exactly as it did on the old page. */}
      {meanings.length ? (
        <>
          <div className="fw-bmh">What the bands mean</div>
          {meanings.map((m, i) => {
            const row = rec(m)
            const band = str(row?.['band'])
            const meaning = str(row?.['meaning'])
            if (!band || !meaning) return null
            const response = str(row?.['response'])
            /* THE WHOLE BAND, NOT ONLY ITS COST. A bands-shaped deck states each
               band in rungs — legal position, practical position, consequences — and this box used to
               show the last one alone. The reviewing lawyer read it and concluded the legal assessment
               had been deleted from her framework; it had not, the screen was showing a third of it.
               `rungs` carries them in the DECK'S OWN ORDER with the deck's own labels, so nothing here
               decides which rungs exist or what they may be called. A matrix deck has no rungs and
               takes the single-line branch below, unchanged. */
            const rungs = Array.isArray(row?.['rungs'])
              ? (row['rungs'] as unknown[]).map(rec).filter((r): r is Record<string, unknown> => r !== null)
              : []
            return (
              <div key={i} className="fw-bmrow">
                <BandPill label={band} tone={toneOf(band)} />
                {rungs.length ? (
                  /* Every lifted line is data-anon="mark" — the decks are Privileged & Confidential and
                     the demo blur has to cover the label as well as the prose, or a rung name survives
                     a blur that hides its text. */
                  <div className="fw-bmrungs">
                    {rungs.map((r, j) => {
                      const label = str(r['label'])
                      const text = str(r['text'])
                      if (!label || !text) return null
                      return (
                        <div key={j} className="fw-bmrung" data-anon="mark">
                          <span className="fw-bmrunglbl">{label}</span>
                          <span className="fw-bmtxt">{text}</span>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <span className="fw-bmtxt" data-anon="mark">
                    {meaning}
                    {response ? <i className="fw-bmresp"> — {response}</i> : null}
                  </span>
                )}
              </div>
            )
          })}
        </>
      ) : null}

      {axes.length ? (
        <div className="fw-meta" style={{ marginTop: 14 }}>
          Rated on: <b>{axes.join(' × ')}</b>
        </div>
      ) : null}
      {entity ? (
        <div className="fw-meta">
          Entity in prose: <b data-anon="mark">{entity}</b>
          {structure?.['kind'] === 'matrix' ? (
            <> · matrix-shaped{displayNote ? ` — ${displayNote}` : ''}</>
          ) : null}
        </div>
      ) : null}
      {/* The Source-deck row is GONE. Its comment claimed clients never receive
          the field; the owner then met "…pptx (Privileged & Confidential)…" on his own install's
          generic page — the strip covered one branch and this row rendered the other. frameworkView
          now withholds source_deck from EVERY role, so this screen has nothing to render; provenance
          stays in the manifest on disk, the repo/audit side. */}
      {/* The rest of what Cordillera owns on this account. Kept in the same block rather than stranded
          at the foot of the page: "how you are rated" and "what you may run" are one answer, and the
          note about how they change belongs with all of them, not only with the framework. */}
      {examples || entries.length ? (
        <div style={{ marginTop: 20, borderTop: '1px solid var(--border-hairline)', paddingTop: 14 }}>
          {examples ? <Row label="Worked examples" value="Used when rating this account" /> : null}
          {entries.map((k) => (
            <Row key={k} label={LABELS[k] ?? k} value={render(readOnly[k])} />
          ))}
        </div>
      ) : null}

      {/* The "Set for you, not from here" footer is DELETED ( item 2). The owner pasted
          it followed by an empty string. The block above already reads as unchangeable — every row is
          text, none is a control — so the paragraph explained a thing the page had already shown. The
          framework block it closed stays exactly as it was. */}
    </div>
  )
}

const LABELS: Record<string, string> = {
  frameworkPath: 'Rating framework',
  workedExamplesPath: 'Worked examples',
  allowedRecipes: 'Permitted searches',
  jxPolicy: 'Jurisdiction policy',
  runCaps: 'Run limits',
}

const render = (v: unknown): string => {
  if (v == null) return '—'
  if (Array.isArray(v)) return v.length ? v.map(String).join(', ') : '—'
  if (typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>).map(([k, val]) => `${k}: ${String(val)}`).join(' · ')
  }
  return String(v)
}

function Row({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div style={{ display: 'flex', gap: 14, padding: '5px 0', fontSize: 13, alignItems: 'baseline' }}>
      <span style={{ color: 'var(--text-muted)', minWidth: 150 }}>{label}</span>
      <span style={{ color: 'var(--text-strong)', wordBreak: 'break-word' }}>{value}</span>
    </div>
  )
}

function Unavailable({ kind }: { readonly kind: string }) {
  return (
    <div className="screen">
      <div className="empty">
        <Icon name="alert" size={20} />
        <p>
          {kind === 'surfaceUnavailable'
            // — the deployment, not the reader. This used to fall through to the
            // not-available sentence, which told an account owner they lacked access to their own
            // settings while the real cause sat in a boot log.
            ? 'The settings surface is not configured on this deployment. This is a server setting, not your access — an administrator needs to point it at the customer store.'
            : kind === 'notFound'
              ? 'These settings are not available to you.'
              : 'The settings could not be loaded just now.'}
        </p>
      </div>
    </div>
  )
}

/** Map a failure onto words. The engine's validator messages are written for a human and pass through. */
function explain(r: { kind: string; errors?: readonly string[]; questions?: readonly string[]; message?: string }) {
  switch (r.kind) {
    case 'reject':
    case 'collision':
      return { title: 'That cannot be saved as written', lines: r.errors ?? ['The change was refused.'] }
    case 'clarify':
      return { title: 'Something needs answering first', lines: r.questions ?? [] }
    case 'conflict':
      return { title: 'Someone else changed this first', lines: [r.message ?? 'Reload and reapply your change.'] }
    case 'notFound':
      return { title: 'That is not available to you', lines: ['Check which company is selected.'] }
    // SPLIT FROM `notFound`. They are different answers and only one of them has
    // anything to do with the selector. `notFound` may well BE the wrong company, so that advice is
    // right there. `noAccess` is the door refusing the identity itself — reachable only for door checks,
    // never for anything tenant-scoped — and telling that person to check the selector sends them to the
    // one thing that is not wrong. Someone who signs in successfully and can do nothing should be told
    // why on the page, not in a boot log nobody reads.
    //
    // The words are the ones portal-service already logs at boot: on no staff domain, in no grants row.
    // Nothing here is tenant-scoped, so it leaks nothing the 404-never-403 rule protects — it is a fact
    // about the caller's own identity, and it is the only fact that helps them.
    case 'noAccess':
      return {
        title: 'This address has no access yet',
        lines: ['You are signed in, but this address is on no staff domain and in no grants row, so every page refuses it. Selecting a different company cannot change that — an administrator needs to add it to one.'],
      }
    case 'surfaceUnavailable':
      return {
        title: 'The settings surface is not configured here',
        lines: ['Nothing was written. This is a server setting on this deployment, not your access — an administrator needs to point it at the customer store.'],
      }
    case 'rateLimited':
      return { title: 'Too many requests just now', lines: ['Wait a moment and try again.'] }
    default:
      return { title: 'The change was not saved', lines: [r.message ?? 'Nothing was written. Try again shortly.'] }
  }
}

