// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Profile — how a company's clearances are scoped, rated and delivered.
//
// This screen writes to the file the engine loads at the start of every run. A profile that fails
// validation does not fail politely: it takes that company's searches down until someone fixes it by
// hand. So a save is two requests, and the first one is the server running the SAME validators the
// engine runs at load time. The dry run is not a nicety here — it is the thing standing between a typo
// and a company that cannot search — and it runs inside the one Save press (contract/checkThenSave.ts).
//
// The other rule that shapes this file is that the draft is SEEDED FROM THE SERVER and edited in place.
// A form that renders nine fields and posts nine fields will erase the tenth the day the engine grows
// one. See contract/profileFields.ts — the reasoning is there and the behaviour is pinned by tests.

import { Fragment, useEffect, useMemo, useState } from 'react'
import { api, notCommitted } from '../contract/api.ts'
import type { ProfileConfig } from '../contract/api.ts'
import { PROFILE_FIELDS, FIELD_GROUPS, boxValue, applyField, stripCodeOwned, visibleReadOnlyFields, depthChoices, groupTag } from '../contract/profileFields.ts'
import { Field, FieldTag } from '../components/ProfileField.tsx'
import type { FieldSpec } from '../contract/profileFields.ts'
import { checkThenSave } from '../contract/checkThenSave.ts'
import { permittedSearchesLine } from '../contract/savedSearches.ts'
import { Icon } from '../components/Icon.tsx'
import { ContextPackEditor } from '../components/ContextPackEditor.tsx'
import { PageHeader } from '../components/PageHeader.tsx'
import { useLoad } from '../state/useApi.ts'
import { useUnsaved } from '../state/useUnsaved.ts'
import type { ShellContext } from '../shell/AppShell.tsx'
import { CompanyGate } from '../shell/CompanyPicker.tsx'
import { NewCompanyButton } from '../shell/NewCompanyButton.tsx'
import { canManage } from '../shell/permissions.ts'
import { FrameworkGuideLink } from '../components/FrameworkGuideLink.tsx'

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
        // Each search named once; a search that cannot run yet says so on its option. See depthChoices.
        ? depthChoices(searchesResult.value.products)
        : []                                     // failed — Field falls back to showing the value as text

  // THE TEMPLATE LISTING, for one row: Permitted searches names templates the way Search templates does,
  // and this is the read that page draws its rows from. Asked only of a company whose profile HAS the
  // row — most have none, and for them it would be a request that adds nothing to the page.
  const permits = Array.isArray(loaded?.readOnly['allowedRecipes'])
  const { result: templatesResult } = useLoad(
    () => (permits ? api.savedSearches(account) : Promise.resolve({ kind: 'ok' as const, value: [] })),
    [account, permits],
  )
  // Nothing is said about a row until both reads have answered, so it never flashes a count of searches
  // it has not had the chance to name.
  const permitted = loaded == null || templatesResult == null || searchesResult == null
    ? ''
    : permittedSearchesLine(
        loaded.readOnly['allowedRecipes'],
        loaded.account,
        templatesResult.kind === 'ok' ? templatesResult.value : null,
        searchesResult.kind === 'ok' ? searchesResult.value.products : [],
      )

  const [draft, setDraft] = useState<Record<string, unknown> | null>(null)
  // The context pack is NOT a profile field — it is a sibling `<key>.context.md` the engine reads
  // separately — so it gets its own state rather than a row in PROFILE_FIELDS. It rode along as an
  // unrendered round-trip until now: loaded, posted straight back, never shown.
  const [pack, setPack] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Profile writes need Manage. Read once, here, so the fieldset, the framework block and the action bar
  // cannot disagree about whether this person may change anything.
  const mayChange = canManage(ctx.me)
  const [problem, setProblem] = useState<{ readonly title: string; readonly lines: readonly string[] } | null>(null)
  // THE RAW TEXT OF EVERY TOUCHED FIELD, and it is not a duplicate of `draft`.
  // Deriving a box's value from the parsed draft made every keystroke a parse-then-format round trip,
  // and both halves trim: the space in "US France" was eaten as it was typed and the owner's screen
  // showed "USFrance". See FormEdit in the contract for the whole reasoning.
  const [edits, setEdits] = useState<Record<string, string>>({})
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

  // Either half can be the change. Saving posts both, so a pack-only edit has to arm Save too —
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
    return <CompanyGate ctx={ctx} heading="Profile" line="Pick a company to see its profile." />
  }
  if (result && result.kind !== 'ok') return <Unavailable kind={result.kind} />
  if (!loaded || !draft || pack == null) return <div className="screen" />

  // Any edit clears the last outcome. A "Saved" describing a body that has since changed is worse than
  // nothing: it is a claim about something that no longer exists.
  const touch = () => {
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

  // ONE PRESS: the dry run, then the write, and the write only on the dry run's own verdict. The order
  // is checkThenSave's, where it can be driven; this handler says what each outcome looks like.
  const save = async () => {
    setBusy(true)
    setProblem(null)
    const body = { profile: stripCodeOwned(draft), contextPack: pack }
    const outcome = await checkThenSave((action) => api.saveProfile(account, action, body))
    setBusy(false)
    if (outcome.kind === 'refused') {
      const n = outcome.errors.length
      setProblem({
        title: n === 0 ? 'That cannot be saved as written' : n === 1 ? '1 thing to fix before saving:' : `${n} things to fix before saving:`,
        lines: n ? outcome.errors : ['This company’s settings were refused, and no reason came back.'],
      })
      return
    }
    if (outcome.kind === 'failed') {
      setProblem(explain(outcome.result))
      return
    }
    // — A SAVE THAT DID NOT COMMIT IS NOT A CLEAN SUCCESS. The server has returned `commitError` on a 200
    // from every save route for months and nothing here read it, so a write that never reached the
    // store's git rendered as a plain success. The change IS live, so this is a warning rather than a
    // failure — saying "could not be saved" would be the opposite lie.
    const uncommitted = notCommitted(outcome.result)
    if (uncommitted) setProblem({ title: 'Saved, but not committed', lines: [uncommitted] })
    const sha = outcome.result.value['sha']
    setSaved({ at: Date.now(), sha: typeof sha === 'string' ? sha : null })
    reload()
  }

  return (
    <div className="screen">
      <div className="measure">
        {/* `+ New company` sits in the header, where the page's own controls are. It is one shared control
            on all three Company settings pages; NewCompanyButton says why it is here at all. */}
        <PageHeader title="Profile" actions={<NewCompanyButton ctx={ctx} />} />

        <div className="card-stack">
          {/* The framework leads the page. It is the one thing here nobody can edit and the one thing that
              decides what every clearance for this company COMES OUT AS — a company's own framework rates
              its matters. Sitting last, under the editable fields, it read as an appendix to the settings
              rather than as the authority the settings operate under. */}
          <FrameworkBlock
            readOnly={loaded.readOnly}
            framework={loaded.framework}
            everything={ctx.me.allAccounts}
            permitted={permitted}
          />

          {/* ONE WRAPPER DECIDES WHETHER ANY OF THIS CAN BE CHANGED. Profile writes need Manage, and a
              disabled fieldset disables every control inside it natively — the fields, the pickers and the
              background editor — so a person without Manage reads the settings and can type into none of
              them. A per-field flag would be one more thing a new field could forget. A fold still opens
              inside it: a disabled fieldset reaches form controls, and a summary is not one. */}
          <fieldset disabled={!mayChange} className="card-stack profile-cards">
            {/* Grouped by iteration over FIELD_GROUPS rather than as hardcoded blocks, so a new field joins
                a group by declaring one, and a new group needs no markup here at all. */}
            {FIELD_GROUPS.map((group) => {
              const specs = PROFILE_FIELDS.filter((s) => s.group === group.id)
              if (!specs.length) return null
              const fields = specs.map((spec) => (
                <Fragment key={spec.key}>
                  <Field
                    spec={spec}
                    value={boxValue({ draft, edits }, spec)}
                    choices={spec.key === 'defaultProduct' ? productChoices : (spec.choices ?? null)}
                    onChange={(v) => edit(spec, v)}
                  />
                  {/* Beside the field it is about: an entry the engine cannot search, named. */}
                  {spec.key === 'defaultJurisdictions' ? <UnsearchableTerritories derived={loaded.derived} /> : null}
                  {/* THE VARIANT CALCULATION, FOLDED, directly under the depth. It is a consequence of the
                      marketplaces and density above rather than a setting, and open it sat among the
                      fields as one more thing to read before reaching the next. */}
                  {spec.key === 'defaultProduct' && coverageOf(loaded.derived) ? (
                    <details className="fw-fold">
                      <summary className="fold-summary">
                        <span className="fold-title">Search details</span>
                        <Icon name="chevron" size={16} className="fold-chev" />
                      </summary>
                      <div className="fold-body">
                        <CoverageNote derived={loaded.derived} />
                      </div>
                    </details>
                  ) : null}
                </Fragment>
              ))
              // A FOLD NAMES WHAT IT HOLDS on its closed row, in the fields' own labels, so nobody opens
              // it to find out whether the one setting they want is inside.
              return group.fold ? (
                <details key={group.id} className="ctx-card fold-card">
                  <summary className="fold-summary">
                    <span className="fold-title">{group.label}</span>
                    <span className="fold-note">{specs.map((s) => s.label).join(', ')}</span>
                    <Icon name="chevron" size={16} className="fold-chev" />
                  </summary>
                  {fields}
                </details>
              ) : (
                <section key={group.id} className="ctx-card">
                  <div className="eyebrow">
                    {group.label}
                    <FieldTag tag={groupTag(group)} />
                  </div>
                  {fields}
                </section>
              )
            })}

            <ContextPackEditor
              value={pack}
              onChange={editPack}
              title="Background &amp; standing concerns"
              hint="Useful background about this company — competitors to watch, recurring concerns, lessons from past matters. Every clearance reads it before it writes. Facts and concerns, not rules: it shapes what a report emphasises, never what a finding is rated."
              tag="Optional"
              card
            />
          </fieldset>
        </div>

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

        {!mayChange ? (
          <p style={{ marginTop: 22, fontSize: 13, color: 'var(--text-muted)' }}>
            You can read these settings. Changing them needs the Manage permission.
          </p>
        ) : (
          // ONE BUTTON, AND NOTHING BESIDE IT IS A BLOCKING CONDITION. Save used to stay disabled until a
          // separate Check had passed, and an outside user pressing it found a button that would not
          // respond and a line naming another. The check still runs first, inside the one press, so the
          // only states left are nothing to save and something to save — and both are quiet.
          <div className="row-foot">
            <button type="button" className="btn-primary" disabled={busy || !dirty} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <span className="row-foot-note">{dirty ? 'Unsaved changes' : 'No changes'}</span>
          </div>
        )}
      </div>
    </div>
  )
}

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
      search, so it is stored and does nothing. Replace it from the list above, or remove it.
    </p>
  )
}

/**
 * What the marketplaces and density above actually buy, in the engine's own numbers — or null when the
 * server sent none, in which case there is nothing to fold away either.
 *
 * Derived and never stored — profile-service computes it at view time. It is the one place this page
 * states the CONSEQUENCE of a setting rather than its value, which is why it sits with the settings it
 * is computed from rather than in a panel of its own.
 */
function coverageOf(derived: Record<string, unknown> | null): { readonly batch: number; readonly cells: number } | null {
  const batch = derived?.['batchSize']
  const cells = derived?.['minCellsPerVariant']
  return typeof batch === 'number' && typeof cells === 'number' ? { batch, cells } : null
}

function CoverageNote({ derived }: { readonly derived: Record<string, unknown> | null }) {
  const c = coverageOf(derived)
  if (!c) return null
  return (
    <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>
      Calculated from the marketplaces and density above: about <b>{c.batch}</b> search variant
      {c.batch === 1 ? '' : 's'} per pass across <b>{c.cells}</b> sources.
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
 * How this company is rated, and what it may run.
 *
 * A company's OWN framework rates its matters, falling back to the house one — so the first thing this
 * block does is say which, unmistakably. Everything under it is the framework describing itself: the
 * ladder in its own order and vocabulary, what each band MEANS in the deck's own words, the axes it
 * reasons on, the entity it voices the client side as. That presentation existed on the old staff
 * editor page and was lost in the React rebuild, which kept only the title.
 *
 * All of it is read-only, and rendered as TEXT rather than as disabled inputs. A greyed-out input invites
 * someone to try, and implies the page could write it if only it were enabled. It cannot: a framework is
 * selected in code under review, and the server strips these fields from every write.
 *
 * Access to everything decides the PATHS (`skills/prelim-search/risk-framework-<customer>.md`), and it
 * decides them upstream in portal-upstream's getProfile — by the time this renders, anyone else's payload
 * no longer carries them. visibleReadOnlyFields stays as the second wall, on the same rule, not the only one.
 */
function FrameworkBlock({
  readOnly,
  framework,
  everything,
  permitted,
}: {
  readonly readOnly: Record<string, unknown>
  readonly framework: Record<string, unknown> | null
  readonly everything: boolean
  /** The Permitted searches row, already in template names. Empty while the names are being read. */
  readonly permitted: string
}) {
  const entries = visibleReadOnlyFields(readOnly, everything)
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
    <div className="notice quiet fw-card">
      <div className="fw-sectionh">Risk framework in force</div>

      {/* Which framework is in force, stated so it cannot be misread as one shared method for everyone.
          Boxed rather than run into the prose: for most people opening this page, "which framework rates
          my matters" IS the question, and it should not need finding.

          THREE states, not two. The first cut of this had `custom && title ? custom : house`, which
          collapsed "no custom framework on file" together with "a custom framework IS on file and its
          manifest would not load" — and answered both with "House default". So a company's page told a
          lawyer it was rated under the house framework when the profile says otherwise.
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
            <b style={{ color: 'var(--tone-high)' }}>This company&rsquo;s framework could not be read.</b>{' '}
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

      {/* THE BAND-BY-BAND DETAIL IS FOLDED, and nothing in it is lost. The framework in force, its bands
          and the configuration rows below stay in view; what each band means, and the two lines on what
          the framework rates and speaks as, sit behind a closed fold. Open, the table pushed every field a
          person comes here to change most of a screen further down.

          The decks are Privileged & Confidential, so every line lifted from one is data-anon="mark" —
          the demo privacy blur has to cover it, exactly as it did on the old page. */}
      {meanings.length || axes.length || entity ? (
        <details className="fw-fold">
          <summary className="fold-summary">
            <span className="fold-title">What the bands mean</span>
            <Icon name="chevron" size={16} className="fold-chev" />
          </summary>
          <div className="fold-body">
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
          </div>
        </details>
      ) : null}
      {/* The Source-deck row is GONE. Its comment claimed clients never receive
          the field; the owner then met "…pptx (Privileged & Confidential)…" on his own install's
          generic page — the strip covered one branch and this row rendered the other. frameworkView
          now withholds source_deck from EVERY role, so this screen has nothing to render; provenance
          stays in the manifest on disk, the repo/audit side. */}
      {/* The rest of what Cordillera owns on this company. Kept in the same block rather than stranded
          at the foot of the page: "how you are rated" and "what you may run" are one answer, and they
          stay in view when the band detail above is folded. */}
      {examples || entries.length ? (
        <div className="fw-rows">
          {examples ? <Row label="Worked examples" value="Used when rating this company" /> : null}
          {entries.map((k) => (
            <Row key={k} label={LABELS[k] ?? k} value={k === 'allowedRecipes' ? permitted : render(readOnly[k])} />
          ))}
        </div>
      ) : null}

      {/* THE GUIDE, ONCE, ON THE SCREEN WHERE SOMEBODY MEETS THEIR FRAMEWORK. The framework itself is
          read-only here by ruling — expert settings stay on the command line and are SHOWN rather than
          edited — so without this a person can see that a company has a rubric and has no way to learn
          they may write their own. It used to be repeated under every band's meaning, four copies of one
          link; one control at the foot of the card is the same offer. Same component as the create form. */}
      <div className="fw-foot">
        <FrameworkGuideLink pill />
      </div>
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
    <div className="fw-row">
      <span className="fw-row-label">{label}</span>
      <span className="fw-row-value">{value}</span>
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
            ? 'The settings surface is not configured on this deployment. This is a server setting, not your access — an administrator needs to point it at the company store.'
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
    // The words are the door's own: the page it serves an address with no access says the same thing.
    // Nothing here is tenant-scoped, so it leaks nothing the 404-never-403 rule protects — it is a fact
    // about the caller's own identity, and it is the only fact that helps them.
    case 'noAccess':
      return {
        title: 'This address has no access yet',
        lines: ['You are signed in, but this address has not been given access to the portal, so every page refuses it. Selecting a different company cannot change that — someone who can add people here needs to add it.'],
      }
    case 'surfaceUnavailable':
      return {
        title: 'The settings surface is not configured here',
        lines: ['Nothing was written. This is a server setting on this deployment, not your access — an administrator needs to point it at the company store.'],
      }
    case 'rateLimited':
      return { title: 'Too many requests just now', lines: ['Wait a moment and try again.'] }
    default:
      return { title: 'The change was not saved', lines: [r.message ?? 'Nothing was written. Try again shortly.'] }
  }
}

