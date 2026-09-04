// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Projects — per-engagement overlays on a brand owner's defaults.
//
// A project is a SPARSE overlay, not a second profile. It re-states the operational knobs a distinct
// engagement legitimately runs differently — its own marketplaces, classes, jurisdictions, delivery,
// depth — and it can never touch the customer's identity or rating authority. A project supplying its
// own `name` would make the self-exclusion check match against the PROJECT's name, quietly disabling
// the customer's own-rights exclusion; a project re-pointing the framework would let one engagement be
// rated by different rules than the client agreed to. Those fields are not rendered here at all.
//
// THE RULE THIS SCREEN EXISTS TO ENFORCE: marketplaces are a FLOOR. A project adds and never revokes.
// An overlay that silently dropped a client-mandated marketplace is a documented defect in this
// codebase, and the failure mode is invisible — a thinner search that nobody asked for and nobody sees.
// So a save that would drop one is REFUSED and the marketplaces are named, rather than being quietly
// merged back in. A silent restore would leave the user believing they removed something they did not.

import { useEffect, useMemo, useState } from 'react'
import { api, isOk, notCommitted, saveFailureText } from '../contract/api.ts'
import type { ProjectDetail, ProjectSummary } from '../contract/api.ts'
import { projectFields, fieldInput, boxValue, isSet, applyField, stripCodeOwned, revokedPlatforms, choiceLabel, fieldNotices } from '../contract/profileFields.ts'
import { FieldNotices } from '../components/FieldNotices.tsx'
import { FieldPicker } from '../components/FieldPicker.tsx'
import type { FieldSpec } from '../contract/profileFields.ts'
import { Icon } from '../components/Icon.tsx'
import { useLoad } from '../state/useApi.ts'
import { useUnsaved } from '../state/useUnsaved.ts'
import { ContextPackEditor } from '../components/ContextPackEditor.tsx'
import type { ShellContext } from '../shell/AppShell.tsx'

export function Projects({ ctx }: { readonly ctx: ShellContext }) {
  const account = ctx.owner
  const needsOwner = ctx.me.allAccounts && account === null
  // `/portal/brand/projects?project=<key>` opens straight onto one project.
  //
  // Read once as the INITIAL state rather than held as a second source of truth: after that the user's
  // own open/close is the answer, and re-reading the URL would slam a project back open every time they
  // closed it. Home's "pick up where you left off" links here — landing on a list and having to find the
  // row you just clicked is not picking anything up.
  const [open, setOpen] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get('project') || null,
  )
  const [creating, setCreating] = useState(false)
  const [rowBusy, setRowBusy] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [rowProblem, setRowProblem] = useState<string | null>(null)

  const { result, reload } = useLoad(() => api.projects(account), [account])
  const projects: readonly ProjectSummary[] = result?.kind === 'ok' ? result.value : []

  // Same rule as Profile: a multi-account client's ownerless read answers pickAccount, and that is
  // "choose an owner", never "could not be loaded".
  if (needsOwner || result?.kind === 'pickAccount') {
    return (
      <div className="screen">
        <div className="notice">
          <b>Choose a brand owner first</b>
          <p style={{ margin: '6px 0 0', color: 'var(--text-muted)' }}>
            Projects belong to one brand owner. Pick one at the top left.
          </p>
        </div>
      </div>
    )
  }
  if (result && result.kind !== 'ok') {
    return (
      <div className="screen">
        <div className="empty">
          <Icon name="alert" size={20} />
          {/* — "not available to you" was what an account owner saw when the
              deployment had not been pointed at its own store. Three answers, not two. */}
          <p>
            {result.kind === 'surfaceUnavailable'
              ? 'The settings surface is not configured on this deployment. This is a server setting, not your access — an administrator needs to point it at the customer store.'
              : result.kind === 'notFound'
                ? 'Projects are not available to you.'
                : 'Projects could not be loaded just now.'}
          </p>
        </div>
      </div>
    )
  }
  if (!result) return <div className="screen" />

  if (open) return <ProjectEditor account={account} project={open} onBack={() => { setOpen(null); reload() }} />
  if (creating) {
    return <NewProject account={account} taken={projects.map((p) => p.key)}
      onDone={(key) => { setCreating(false); reload(); setOpen(key) }}
      onCancel={() => setCreating(false)} />
  }

  /**
   * Archive, or bring back — from the LIST, without opening the project.
   *
   * The overlay is read back and re-saved whole, one flag flipped. The editor's Save posts the draft it
   * is holding; there is no draft here, and composing a partial one would write a project stripped of
   * every setting this list does not show. The floor guard the editor applies is irrelevant for the
   * same reason: nothing about the marketplaces is being changed.
   */
  const setArchived = async (key: string, archived: boolean) => {
    setRowBusy(key)
    setRowProblem(null)
    const detail = await api.project(account, key)
    if (!isOk(detail)) {
      setRowBusy(null)
      // — the same class as the ack and stop controls: the server composes a
      // reason and the screen replaces it with a sentence of its own. One place answers all of them.
      setRowProblem(saveFailureText(detail, 'That project could not be opened just now. Nothing has been changed.'))
      return
    }
    const r = await api.saveProject(account, key, 'save', {
      // Explicit either way. The server keeps archive state sticky against omission, so only an
      // explicit false brings a project back.
      profile: stripCodeOwned({ ...detail.value.overlay, archived }),
      contextPack: detail.value.contextPack,
    })
    setRowBusy(null)
    setConfirming(null)
    if (!isOk(r)) {
      setRowProblem(saveFailureText(r, `That project could not be ${archived ? 'archived' : 'brought back'}. Nothing has been changed.`))
      return
    }
    // — live but uncommitted is a WARNING, not a failure: the change is on disk.
    const uncommittedRow = notCommitted(r)
    if (uncommittedRow) setRowProblem(uncommittedRow)
    reload()
  }

  return (
    <div className="screen">
      <div className="measure">
        <div className="notice quiet" style={{ marginBottom: 18 }}>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>
            A project runs a distinct engagement with its own defaults — different marketplaces, classes
            or depth — while keeping the brand owner&rsquo;s identity and rating. Anything a project does
            not set is inherited.
          </p>
        </div>

        {rowProblem ? (
          <div className="notice" style={{ borderColor: 'var(--tone-high)', marginBottom: 18 }}>
            <b>{rowProblem}</b>
          </div>
        ) : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
          <button type="button" className="pill" style={{ cursor: 'pointer' }} onClick={() => setCreating(true)}>
            New project
          </button>
        </div>

        {projects.length === 0 ? (
          // "No projects FOR THIS BRAND OWNER", deliberately not "no projects exist" — the phrasing
          // survives from when archived projects were hidden from clients entirely, and it stays right
          // for a different reason now: this list is one brand owner's, not the instance's.
          <div className="empty">
            <p>No projects for this brand owner. Every clearance uses their own defaults.</p>
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Add one when an engagement needs its own marketplaces, classes or depth. Archive it when it
              ends — the reports it produced stay exactly as issued.
            </p>
            <div style={{ marginTop: 12 }}>
              <button type="button" className="pill" style={{ cursor: 'pointer' }} onClick={() => setCreating(true)}>
                New project
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {projects.map((p) => (
              <div
                key={p.key}
                style={{
                  padding: '12px 14px',
                  borderRadius: 10,
                  border: '1px solid var(--border-hairline)',
                  background: 'var(--surface-raised)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  // An archived project is SHOWN, greyed and badged — not hidden. It stays openable so
                  // its settings can be read and so it can be brought back; hiding it is what would make
                  // archiving a one-way door for whoever archived it.
                  opacity: p.archived ? 0.55 : 1,
                }}
              >
                <button
                  type="button"
                  onClick={() => setOpen(p.key)}
                  style={{
                    flex: 1, textAlign: 'left', background: 'none', border: 0, padding: 0,
                    cursor: 'pointer', font: 'inherit', color: 'inherit', minWidth: 0,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontWeight: 700, color: 'var(--text-strong)' }} data-anon="mark">{p.name || p.key}</span>
                    {p.archived ? <span className="pill" style={{ fontSize: 10.5, padding: '1px 7px' }}>Archived</span> : null}
                  </div>
                  <div className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{p.key}</div>
                </button>

                {confirming === p.key ? (
                  <>
                    <button
                      type="button"
                      className="pill"
                      style={{ cursor: 'pointer', fontSize: 12, borderColor: 'var(--tone-high)' }}
                      disabled={rowBusy === p.key}
                      onClick={() => void setArchived(p.key, true)}
                    >
                      {rowBusy === p.key ? 'Working…' : 'Confirm — archive'}
                    </button>
                    <button type="button" className="pill" style={{ cursor: 'pointer', fontSize: 12 }} onClick={() => setConfirming(null)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="pill"
                    style={{ cursor: 'pointer', fontSize: 12 }}
                    disabled={rowBusy === p.key}
                    onClick={() => (p.archived ? void setArchived(p.key, false) : setConfirming(p.key))}
                  >
                    {rowBusy === p.key ? 'Working…' : p.archived ? 'Bring back' : 'Archive'}
                  </button>
                )}
                <Icon name="chevron" size={16} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * A new project: a key and a name, and nothing else.
 *
 * Everything a project CAN set is inherited until it is overridden, so a create form asking for
 * marketplaces and classes would be asking for decisions the engagement has not made yet — and every
 * one of them is editable on the next screen, which this opens straight into.
 *
 * The two fields are not the same kind of thing and the form says so. The KEY is a slug and permanent:
 * it becomes the filename, the resolve key, and the value every run of this project carries, so it
 * cannot be renamed afterwards. The NAME is the display name (`projectName`) and can change any time.
 *
 * WHAT IS NOT HERE, and must never be: `name`. That is the CUSTOMER's legal identity and the anchor for
 * the own-rights self-exclusion check. A project supplying its own would make that check match against
 * the project's name and quietly disable the brand owner's exclusion of their own marks.
 */
function NewProject({
  account, taken, onDone, onCancel,
}: {
  readonly account: string | null
  readonly taken: readonly string[]
  readonly onDone: (key: string) => void
  readonly onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [touchedKey, setTouchedKey] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<readonly string[] | null>(null)

  // The key follows the name until someone edits it, which is what makes the common case one field.
  const slug = (touchedKey ? key : name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 39)

  // Mirrors assertProfileKey server-side: a lowercase slug, 2–39 chars. Said here so the refusal
  // arrives while the field is in focus rather than after a round trip — the server still decides.
  const keyProblem = slug.length < 2
    ? 'The key needs at least two letters or numbers.'
    : taken.includes(slug)
      ? 'This brand owner already has a project with that key.'
      : null

  const create = async () => {
    setBusy(true)
    setProblem(null)
    const body = { profile: { projectName: name.trim() }, contextPack: '' }
    // Check, then write — the same ladder the editor uses, and for the same reason: the server re-runs
    // the engine's own load-time validators, so a project that fails them must never reach disk.
    const check = await api.saveProject(account, slug, 'validate', body)
    if (!isOk(check) || (check.value as { ok?: boolean }).ok === false) {
      setBusy(false)
      const errors = isOk(check)
        ? ((check.value as { errors?: unknown }).errors as string[] | undefined)
        : ('errors' in check && Array.isArray(check.errors) ? check.errors : undefined)
      setProblem(errors?.length ? errors : ['That project could not be created as written.'])
      return
    }
    const r = await api.saveProject(account, slug, 'save', body)
    setBusy(false)
    if (!isOk(r)) {
      setProblem('errors' in r && Array.isArray(r.errors) && r.errors.length ? r.errors : [saveFailureText(r, 'That project could not be created.')])
      return
    }
    // — live but uncommitted is a WARNING, not a failure: the change is on disk.
    const uncommittedNew = notCommitted(r)
    if (uncommittedNew) { setProblem([uncommittedNew]); return }
    onDone(slug)
  }

  return (
    <div className="screen">
      <div className="measure">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <button type="button" className="nav-item" style={{ width: 'auto', padding: '4px 8px', margin: 0 }} onClick={onCancel}>
            <Icon name="chevron-left" size={14} />
            <span>Projects</span>
          </button>
          <span className="crumb">›</span>
          <span className="crumb">New project</span>
        </div>

        <div className="notice quiet" style={{ marginBottom: 18 }}>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>
            Name it — the next screen sets what this engagement runs differently, and anything you leave
            alone is inherited from the brand owner.
          </p>
        </div>

        <label style={{ display: 'block' }}>
          <div style={{ fontWeight: 700, color: 'var(--text-strong)', fontSize: 14 }}>Project name</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '2px 0 7px' }}>
            How it appears when a clearance is set up. Can be changed later.
          </div>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="EU launch 2027" data-anon="mark" style={inputStyle} />
        </label>

        {/* THE KEY IS A FILENAME, AND IT WAS THE SECOND QUESTION WE ASKED A LAWYER.
            It is derived from the name and almost never edited, so it was a required field whose answer
            the form already knew — asking for it up front made a two-field screen out of a one-field
            decision, and "Its key" told nobody anything. It stays available, because it IS permanent and
            someone who cares should be able to set it, but it stops leading. */}
        <details style={{ marginTop: 16 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12.5, color: 'var(--text-muted)' }}>
            Filed as <span className="mono" style={{ color: 'var(--text-body)' }}>{slug || '—'}</span>
          </summary>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '9px 0 7px' }}>
            Reference on every run. Fixed once created.
          </div>
          <input
            value={touchedKey ? key : slug}
            onChange={(e) => { setTouchedKey(true); setKey(e.target.value) }}
            placeholder="eu-launch-2027"
            className="mono"
            aria-label="Project reference"
            style={inputStyle}
          />
          {keyProblem && (name || key) ? (
            <div style={{ fontSize: 12.5, color: 'var(--tone-high)', marginTop: 5 }}>{keyProblem}</div>
          ) : null}
        </details>

        {problem ? (
          <div className="notice" style={{ borderColor: 'var(--tone-high)', marginTop: 18 }}>
            <b>That project could not be created</b>
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: 'var(--text-muted)' }}>
              {problem.map((l, i) => <li key={i} style={{ marginBottom: 3 }}>{l}</li>)}
            </ul>
          </div>
        ) : null}

        <div style={{ marginTop: 22, display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            type="button"
            className="pill"
            disabled={busy || keyProblem !== null || name.trim() === ''}
            onClick={() => void create()}
            style={{
              padding: '9px 16px',
              cursor: busy || keyProblem || !name.trim() ? 'not-allowed' : 'pointer',
              opacity: busy || keyProblem || !name.trim() ? 0.5 : 1,
              background: 'var(--accent-wash)',
              borderColor: 'var(--accent)',
              color: 'var(--text-accent)',
            }}
          >
            {busy ? 'Creating…' : 'Create project'}
          </button>
          <button type="button" className="pill" style={{ padding: '9px 16px', cursor: 'pointer' }} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

function ProjectEditor({
  account,
  project,
  onBack,
}: {
  readonly account: string | null
  readonly project: string
  readonly onBack: () => void
}) {
  const { result, reload } = useLoad(() => api.project(account, project), [account, project])
  const detail: ProjectDetail | null = result?.kind === 'ok' ? result.value : null

  const [draft, setDraft] = useState<Record<string, unknown> | null>(null)
  // THE PROJECT'S OWN BACKGROUND. The pre-React portal had this field ("Project background & concerns")
  // and the rebuild dropped the CONTROL while keeping the value flowing — every save round-tripped
  // detail.contextPack untouched, so the engagement doctrine in the live store could be read by the
  // engine and edited by nobody. Server, API and types were complete the whole time.
  const [pack, setPack] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // The raw text of every touched field — see FormEdit in the contract,: the
  // project form carried the identical defect, because it derives its boxes the identical way.
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [checked, setChecked] = useState(false)
  const [saved, setSaved] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [problem, setProblem] = useState<{ readonly title: string; readonly lines: readonly string[] } | null>(null)

  useEffect(() => {
    if (detail) { setDraft(detail.overlay); setPack(detail.contextPack); setEdits({}) }
  }, [detail])

  const fields = projectFields()

  // The floor check, computed on every keystroke so the refusal is visible BEFORE the user reaches for
  // Save — a validation that only fires on submit teaches people that Save is where errors live.
  const wouldRevoke = useMemo(() => {
    if (!detail || !draft) return []
    const customer = detail.inherited['platforms']
    // Only a project that actually SETS platforms can revoke. Not overlaying the field means "inherit",
    // which is the common case and revokes nothing.
    if (!('platforms' in draft)) return []
    return revokedPlatforms(
      Array.isArray(customer) ? (customer as string[]) : [],
      Array.isArray(draft['platforms']) ? (draft['platforms'] as string[]) : [],
    )
  }, [detail, draft])

  const dirty = useMemo(
    () =>
      draft != null && detail != null &&
      (JSON.stringify(draft) !== JSON.stringify(detail.overlay) ||
        (pack != null && pack !== detail.contextPack)),
    [draft, pack, detail],
  )

  // The same flag that enables Save is the flag the shell asks before letting anyone leave — including
  // by switching brand owner, which is not a navigation and used to discard edits silently.
  useUnsaved(dirty)

  if (result && result.kind !== 'ok') {
    return (
      <div className="screen">
        <div className="empty">
          <p>That project is not available.</p>
          <button type="button" className="nav-item" style={{ width: 'auto', margin: '0 auto' }} onClick={onBack}>
            Back to Projects
          </button>
        </div>
      </div>
    )
  }
  if (!detail || !draft) return <div className="screen" />

  const edit = (spec: FieldSpec, raw: string) => {
    setDraft((d) => applyField(d ?? {}, spec, raw))
    setEdits((e) => ({ ...e, [spec.key]: raw }))
    setChecked(false)
    setProblem(null)
    setSaved(false)
  }

  const send = async (action: 'validate' | 'save') => {
    if (wouldRevoke.length) return   // belt and braces: the button is disabled, and the handler refuses
    setBusy(true)
    setProblem(null)
    const r = await api.saveProject(account, project, action, {
      profile: stripCodeOwned(draft),
      contextPack: pack ?? detail.contextPack,
    })
    setBusy(false)
    if (!isOk(r)) {
      setChecked(false)
      setProblem({
        title: 'That cannot be saved as written',
        // `errors` alone reaches two members of the union and drops the reason on the rest — a 404
        // saying the project has gone, a 409 from the store, a session that ended mid-edit.
        lines: 'errors' in r && Array.isArray(r.errors) && r.errors.length ? r.errors : [saveFailureText(r, 'The change was refused.')],
      })
      return
    }
    if (action === 'validate') { setChecked(true); return }
    setChecked(false)
    // — live but uncommitted is a WARNING, not a failure: the change is on disk.
    const uncommittedEdit = notCommitted(r)
    if (uncommittedEdit) setProblem({ title: 'Saved, but not committed', lines: [uncommittedEdit] })
    setSaved(true)
    reload()
  }

  // Archiving is a SAVE WITH A FLAG — no separate verb, no separate route, the same save the Save button
  // uses with `archived` flipped. Deliberately NOT gated behind `checked`/`dirty`: those gate content
  // edits, and retiring an engagement is not a content edit. The two-press confirm is the guard instead,
  // matching this screen's existing check-then-save rhythm.
  //
  // `archived: false` is sent EXPLICITLY on un-archive, and that matters: the server keeps archive state
  // sticky against omission, so only an explicit false un-archives. The draft carries `archived` only
  // when it is true (the loader omits it otherwise), which is what makes the explicit false meaningful
  // rather than something every partial save would smuggle back in.
  const isArchived = draft?.['archived'] === true
  const toggleArchive = async () => {
    if (!detail || !draft) return
    // The same floor guard `send()` applies. toggleArchive posts the whole pending draft, so without this
    // it would commit marketplace edits the Save button was actively refusing — archiving became a way to
    // slip a revocation past the check.
    if (wouldRevoke.length) return
    setBusy(true)
    setProblem(null)
    const r = await api.saveProject(account, project, 'save', {
      profile: stripCodeOwned({ ...draft, archived: !isArchived }),
      // Archiving must not silently revert an unsaved pack edit, for the same reason it must not commit
      // one the Save button is refusing: it posts the whole pending draft.
      contextPack: pack ?? detail.contextPack,
    })
    setBusy(false)
    setConfirmArchive(false)
    if (!isOk(r)) {
      setProblem({
        title: isArchived ? 'That could not be un-archived' : 'That could not be archived',
        // `errors` alone reaches two members of the union and drops the reason on the rest — a 404
        // saying the project has gone, a 409 from the store, a session that ended mid-edit.
        lines: 'errors' in r && Array.isArray(r.errors) && r.errors.length ? r.errors : [saveFailureText(r, 'The change was refused.')],
      })
      return
    }
    // — live but uncommitted is a WARNING, not a failure: the change is on disk.
    const uncommittedArchive = notCommitted(r)
    if (uncommittedArchive) setProblem({ title: 'Saved, but not committed', lines: [uncommittedArchive] })
    setChecked(false)
    setSaved(true)
    reload()
  }

  return (
    <div className="screen">
      <div className="measure">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <button type="button" className="nav-item" style={{ width: 'auto', padding: '4px 8px', margin: 0 }} onClick={onBack}>
            <Icon name="chevron-left" size={14} />
            <span>Projects</span>
          </button>
          <span className="crumb">›</span>
          <span className="crumb" data-anon="mark">{detail.project}</span>
        </div>

        {isArchived ? (
          <div className="notice" style={{ marginBottom: 18 }}>
            <b>This project is archived</b>
            <p style={{ margin: '6px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>
              It is no longer offered when a new clearance is set up, and the reports it produced are
              unchanged. Its settings can still be edited, and it can be un-archived below.
            </p>
          </div>
        ) : null}

        <div className="notice quiet" style={{ marginBottom: 18 }}>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>
            Anything left blank is inherited from {detail.customerName || detail.customer}. Identity and
            rating stay with the brand owner and are not set here.
          </p>
        </div>

        {/* All three of value / inherited / set go through the path-aware helpers. A key-based `spec.key
            in draft` would answer "false" forever for a nested spec like `delivery.privileged` — the
            overlay holds `delivery`, never a key literally called "delivery.privileged" — so the
            This-project pill would say "Inherited" over a value the project had just set. (The example
            was `delivery.email` until  removed that dead control; the mechanism is
            unchanged, but an example naming a spec that no longer exists sends the next reader looking
            for it.) */}
        {fields.map((spec) => (
          <OverlayField
            key={spec.key}
            spec={spec}
            value={boxValue({ draft, edits }, spec)}
            inherited={fieldInput(detail.inherited, spec)}
            set={isSet(draft, spec)}
            onChange={(v) => edit(spec, v)}
          />
        ))}

        {/* THE PROJECT'S OWN BACKGROUND — restored.
            The pre-React portal had this field and the rebuild dropped the CONTROL while still
            round-tripping the value on every save. So the engagement doctrine sitting in the live config
            store was readable by the engine and editable by nobody: the only project in production has a
            hand-written .context.md that no one could see from this screen.
            The project's pack WINS OUTRIGHT over the brand owner's when set — it does not merge — which
            is why the hint says so rather than leaving someone to find out from a report. */}
        <ContextPackEditor
          value={pack ?? ''}
          onChange={(v) => { setPack(v); setChecked(false); setSaved(false) }}
          title="Project background &amp; concerns"
          hint="What this engagement covers and the concerns particular to it. Replaces the brand owner's background when set — it is not added to it."
          rows={6}
        />




        {wouldRevoke.length ? (
          <div className="notice" style={{ borderColor: 'var(--tone-high)', marginTop: 18 }}>
            <b>This would remove a marketplace the brand owner requires</b>
            <p style={{ margin: '6px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>
              A project can add marketplaces, never drop one. Put {wouldRevoke.length === 1 ? 'this back' : 'these back'} to
              save: <b>{wouldRevoke.join(', ')}</b>, or empty the box to inherit the list unchanged.
            </p>
          </div>
        ) : null}

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
          </div>
        ) : null}

        <div style={{ marginTop: 22, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="pill"
            disabled={busy || !dirty || wouldRevoke.length > 0}
            onClick={() => send('validate')}
            style={{ padding: '9px 16px', cursor: busy || !dirty || wouldRevoke.length ? 'not-allowed' : 'pointer', opacity: busy || !dirty || wouldRevoke.length ? 0.5 : 1 }}
          >
            {busy ? 'Checking…' : 'Check'}
          </button>
          <button
            type="button"
            className="pill"
            disabled={busy || !dirty || !checked || wouldRevoke.length > 0}
            onClick={() => send('save')}
            style={{
              padding: '9px 16px',
              cursor: busy || !dirty || !checked || wouldRevoke.length ? 'not-allowed' : 'pointer',
              opacity: busy || !dirty || !checked || wouldRevoke.length ? 0.5 : 1,
              background: 'var(--accent-wash)',
              borderColor: 'var(--accent)',
              color: 'var(--text-accent)',
            }}
          >
            Save
          </button>
        </div>

        <div style={{ marginTop: 26, paddingTop: 18, borderTop: '1px solid var(--border-hairline)' }}>
          <div style={{ fontWeight: 700, color: 'var(--text-strong)', fontSize: 14 }}>
            {isArchived ? 'Un-archive this project' : 'Archive this project'}
          </div>
          <p className="prose" style={{ margin: '5px 0 10px', color: 'var(--text-muted)', fontSize: 13 }}>
            {isArchived
              ? 'It will be offered again when a new clearance is set up.'
              : 'Nothing is deleted: it stops being offered for new clearances, the reports it already produced are unaffected, and it can be un-archived at any time.'}
          </p>
          <button
            type="button"
            className="pill"
            disabled={busy}
            onClick={() => (confirmArchive ? void toggleArchive() : setConfirmArchive(true))}
            style={{
              padding: '9px 16px',
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.5 : 1,
              ...(confirmArchive ? { borderColor: 'var(--tone-high)', color: 'var(--text-strong)' } : {}),
            }}
          >
            {busy
              ? 'Working…'
              : confirmArchive
                ? (isArchived ? 'Confirm — un-archive' : 'Confirm — archive')
                : (isArchived ? 'Un-archive project' : 'Archive project')}
          </button>
          {confirmArchive && !busy ? (
            <button
              type="button"
              className="pill"
              onClick={() => setConfirmArchive(false)}
              style={{ padding: '9px 16px', marginLeft: 8, cursor: 'pointer' }}
            >
              Cancel
            </button>
          ) : null}
          {/* A client-only warning used to sit here: archiving removed the row from their list AND the
              un-archive control with it, so it had to be disclosed as one-way at the point of action.
              Both halves of that are gone — archived projects are listed for everyone (greyed), and the
              list itself carries Archive / Bring back. The honest sentence is now the same for both
              roles, and it is the one above: nothing is deleted, and it can be un-archived at any time.
              A warning kept past the condition it described is worse than no warning. */}
        </div>
      </div>
    </div>
  )
}

/**
 * A configured value, shortened enough to read as a caption.
 *
 * Not a truncation: cutting a lawyer's stated risk posture mid-clause reads as corruption. Take the
 * first sentence, and say how much is left rather than trailing off — the full text is on the element's
 * title, and the field it belongs to is one screen away.
 */
function summarise(value: string, max = 90): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const stop = flat.slice(0, max).lastIndexOf('. ')
  if (stop > 30) return flat.slice(0, stop + 1)
  const cut = flat.slice(0, max).lastIndexOf(' ')
  return `${flat.slice(0, cut > 30 ? cut : max)}… (${flat.length.toLocaleString()} characters)`
}

/**
 * One overlay field, showing what it would inherit.
 *
 * The inherited value is displayed even when the project overrides it, because "what does this actually
 * search" is the question a person opens this page with, and an override shown without its baseline
 * cannot answer it.
 */
function OverlayField({
  spec,
  value,
  inherited,
  set,
  onChange,
}: {
  readonly spec: FieldSpec
  readonly value: string
  readonly inherited: string
  readonly set: boolean
  readonly onChange: (v: string) => void
}) {
  const picker = spec.kind === 'choice' || spec.kind === 'boolean'
  // `riskAppetite` is project-editable and became `prose`, so this form grows a textarea for it too —
  // the same paragraph, overridden per engagement. Without this it would render as a one-line input here
  // while reading as a textarea on the customer form.
  const multi = spec.kind === 'lines' || spec.kind === 'prose'
  return (
    <label style={{ display: 'block', marginTop: 18 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontWeight: 700, color: 'var(--text-strong)', fontSize: 14 }}>{spec.label}</span>
        <span className="pill" style={{ fontSize: 10.5, padding: '1px 7px' }}>
          {set ? 'This project' : 'Inherited'}
        </span>
      </div>
      {spec.hint ? (
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '2px 0 7px' }}>{spec.hint}</div>
      ) : (
        <div style={{ height: 7 }} />
      )}
      {picker ? (
        // A project overlay's blank is "inherit", which is exactly what clearing the field does here
        // (applyField deletes the sub-key and prunes the container).
        //
        // `marketplaceDensity` reaches this branch — it became a `choice` when the brand-profile
        // restoration turned it from a free-text box into the two-value pick the engine actually
        // enforces, and it is project-editable. (This comment previously said nothing reached here,
        // which was true only while defaultProduct and the delivery sub-keys were the only choices
        // and both were withheld from the project form.)
        //
        // The inherited value is resolved through choiceLabel rather than printed raw, because a stored
        // value is not a display value: the placeholder must read "Inherited — Standard", never
        // "Inherited — sparse".
        <select value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
          <option value="">
            Inherited{inherited ? ` — ${choiceLabel(spec, inherited) ?? inherited}` : ''}
          </option>
          {(spec.choices ?? []).map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      ) : multi ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={spec.kind === 'prose' ? 5 : 3} placeholder={inherited} style={inputStyle} />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={inherited} style={inputStyle} />
      )}
      {/* THE STORED VALUE IS NOT A DISPLAY VALUE, and this line forgot it.
          Fifteen lines above, the placeholder resolves the same value through `choiceLabel` — with a
          comment saying exactly why: it must read "Inherited — Standard", never "Inherited — sparse".
          This line printed it raw, so a choice field showed BOTH on the same control, and a prose field
          dumped the brand owner's entire stored risk appetite — sixty words of configured doctrine — as
          a grey caption under an empty box. That is what "Inherits: Defensibility-first and
          conservative: lead every matter with…" was: not copy anyone wrote, a value nobody clamped.

          A long value is summarised rather than truncated mid-sentence, and the whole of it stays one
          hover away. It is never edited here — this is the BRAND OWNER's setting, seen from a project. */}
      {/* THE SAME NOTICES AS THE BRAND PROFILE PAGE, and this is the half exists to
          catch. Both forms render the same specs, so `99` was dropped in silence on BOTH — a fix written
          into Profile.tsx alone would have left this form doing it, on the page nobody re-checked. Same
          component, same contract function, one behaviour. */}
      <FieldNotices notices={fieldNotices(spec, value)} />
      {/* The picker edits the same raw text the box does, so there is one write path and the notices
          above keep describing exactly what is in the box. */}
      <FieldPicker spec={spec} value={value} onChange={onChange} />
      {!set && inherited ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }} title={inherited}>
          Inherits:{' '}
          <span style={{ color: 'var(--text-strong)' }} data-anon="mark">
            {summarise(choiceLabel(spec, inherited) ?? inherited.split('\n').join(', '))}
          </span>
        </div>
      ) : null}
    </label>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 11px',
  borderRadius: 9,
  border: '1px solid var(--border-hairline)',
  background: 'var(--surface-raised)',
  color: 'var(--text-strong)',
  fontFamily: 'inherit',
  fontSize: 14,
  resize: 'vertical',
}
