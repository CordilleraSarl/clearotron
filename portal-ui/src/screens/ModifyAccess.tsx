// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Change what one person can do and see, or take their access away.
//
// THE ADD FORM, FILLED IN — the owner's choice between two designs, and the reason is that adding and
// changing are the same decision made twice. One form means one set of words for what access IS, and the
// alternative (a smaller panel of switches and removable chips, opened from the row) would have been a
// second way to express the same fact, free to drift from the first. It costs one behaviour change,
// stated on the page: unticking a row here TAKES ACCESS AWAY, where unticking on the Add form only ever
// meant "do not give this".
//
// WHAT THE VIEWER CAN SEE BOUNDS EVERYTHING. The list on People holds only the people whose access falls
// inside the viewer's own, and only those points of theirs — so this page may be looking at half of
// somebody. `covered` is the server saying which. Where it is false the permissions are shown and cannot
// be changed, because permissions belong to the person and apply everywhere they have access, including
// where this viewer cannot see; and Remove takes away this viewer's organisations rather than the
// installation, and the button says exactly that.
//
// REMOVE SITS BELOW SAVE AND APART FROM IT, so it is never pressed on the way to saving, and it asks once
// in place — the pill becomes Confirm and Cancel, the way Archive does on Projects — rather than opening
// anything. What the confirmation SAYS is the part worth reading twice: it names what the person loses,
// it says when, and where this installation cannot make "when" true it says that instead of the sentence
// it would rather print.

import { useState } from 'react'
import type { CSSProperties } from 'react'
import { api, isOk, saveFailureText } from '../contract/api.ts'
import type { AccessView, Permissions, Person, Result } from '../contract/api.ts'
import { useLoad } from '../state/useApi.ts'
import { useUnsaved } from '../state/useUnsaved.ts'
import type { ShellContext } from '../shell/AppShell.tsx'
import { accessSentence, permissionsPhrase } from '../shell/accessWords.ts'
import { isGenericKey } from '../contract/genericKey.ts'
import { PEOPLE } from '../nav/nav.config.ts'
import { PageHeader } from '../components/PageHeader.tsx'

/** Which person this page is about. Read once — the address does not change while the page is open. */
const emailInQuery = (): string =>
  (new URLSearchParams(window.location.search).get('email') ?? '').trim().toLowerCase()

type Chosen = { readonly orgs: ReadonlySet<string>; readonly companies: ReadonlySet<string> }

/**
 * What the person holds now, as the two sets this form works in. Built from the row the server sent,
 * which is already narrowed to what the viewer can see — so unticking can only ever take away something
 * the person doing it can see.
 */
const heldBy = (person: Person): Chosen => ({
  orgs: new Set(person.access.filter((a) => a.kind === 'organisation').map((a) => a.key)),
  companies: new Set(person.access.filter((a) => a.kind === 'company').map((a) => a.key)),
})

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean =>
  a.size === b.size && [...a].every((k) => b.has(k))

export function ModifyAccess({ ctx }: { readonly ctx: ShellContext }) {
  const email = emailInQuery()
  const { result: view } = useLoad(() => api.adminAccess(), [])

  if (!view) return <div className="screen" />
  if (!isOk(view)) {
    return (
      <div className="screen">
        <div className="empty"><p>This page is not available.</p></div>
      </div>
    )
  }
  const person = view.value.people.find((p) => p.email.toLowerCase() === email) ?? null
  if (!person) {
    return (
      <div className="screen">
        <div className="measure" style={{ '--screen-measure': '640px' } as CSSProperties}>
          <PageHeader title="Modify access" />
          <div className="notice quiet">
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-muted)' }}>
              Nobody with that address has access you can see. They may have been removed, or their
              access may be somewhere you cannot reach.
            </p>
          </div>
          <div style={{ marginTop: 16 }}>
            <button type="button" className="btn-ghost" onClick={() => ctx.go(PEOPLE.path)}>Back to People</button>
          </div>
        </div>
      </div>
    )
  }
  // KEYED ON THE ADDRESS. A second person opened from People is a different form with different
  // contents, and React would otherwise keep the first one's unsaved state.
  return <Form key={person.email} ctx={ctx} person={person} view={view.value} />
}

function Form({ ctx, person, view }: {
  readonly ctx: ShellContext
  readonly person: Person
  readonly view: AccessView
}) {
  const held = heldBy(person)
  const [permissions, setPermissions] = useState<Permissions>(person.permissions)
  const [chosen, setChosen] = useState<Chosen>(held)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [saved, setSaved] = useState<Result<{ readonly switchesApplied: boolean }> | null>(null)
  const [gone, setGone] = useState<Result<{ readonly removed: string; readonly keys: { readonly lateArm: boolean; readonly checked: boolean } }> | null>(null)

  // The whole of this person, or the part of them this viewer can see. Everything conditional on the
  // page is conditional on this one fact.
  const whole = person.covered === true
  const holdsEverything = person.access.some((a) => a.kind === 'everything')

  const orgName = (key: string): string => ctx.organisations.find((o) => o.key === key)?.name ?? key
  const wholeOrgs = new Set(ctx.me.genericOrgs)
  const companiesIn = (org: string): readonly string[] =>
    ctx.ownerKeys.filter((k) => !isGenericKey(k) && ctx.orgOf(k) === org)
  const tree = ctx.organisations
    .map((o) => ({ org: o, whole: wholeOrgs.has(o.key), companies: companiesIn(o.key) }))
    .filter((t) => t.whole || t.companies.length > 0)

  const toggle = (set: ReadonlySet<string>, key: string): ReadonlySet<string> => {
    const next = new Set(set)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  }
  const covered = (company: string): boolean =>
    chosen.companies.has(company) || chosen.orgs.has(ctx.orgOf(company) ?? '')
  const soloCompanies = [...chosen.companies].filter((k) => !chosen.orgs.has(ctx.orgOf(k) ?? ''))

  const dirty = !sameSet(chosen.orgs, held.orgs) || !sameSet(chosen.companies, held.companies)
    || permissions.run !== person.permissions.run || permissions.manage !== person.permissions.manage
  useUnsaved(dirty && saved === null && gone === null)

  const access = [
    ...[...chosen.orgs].map((key) => ({ kind: 'organisation' as const, key })),
    ...soloCompanies.map((key) => ({ kind: 'company' as const, key })),
  ]
  const leftWithNothing = access.length === 0

  // WHAT THEY LOSE, said before anything is saved — the half of the sentence the Add form never needed.
  const losing = [
    ...[...held.orgs].filter((k) => !chosen.orgs.has(k)).map(orgName),
    ...[...held.companies].filter((k) => !covered(k)).map((k) => ctx.ownerName(k)),
  ]
  const sentence = accessSentence({
    who: person.email,
    permissions,
    everything: holdsEverything,
    organisations: [...chosen.orgs].map(orgName),
    companies: soloCompanies.map((k) => ({ name: ctx.ownerName(k), organisation: orgName(ctx.orgOf(k) ?? '') })),
  })

  const save = async () => {
    setBusy(true)
    try { setSaved(await api.changePerson({ email: person.email, permissions, access })) }
    finally { setBusy(false) }
  }
  const remove = async () => {
    setBusy(true)
    try {
      const r = await api.removePerson({ email: person.email })
      setGone(r)
      if (isOk(r)) ctx.go(PEOPLE.path)
    } finally { setBusy(false) }
  }

  const failure = (r: Result<unknown> | null): string | null =>
    r === null || isOk(r) ? null
      : r.kind === 'conflict' ? 'This Clearotron now signs in one person, so nobody else can be changed. Nothing was saved.'
      : r.kind === 'notFound' ? 'That is not access you can change. Nothing was saved.'
      : r.kind === 'reject' ? r.errors.join(' ')
      : saveFailureText(r, 'That could not be saved. Nothing was changed.')
  const problem = failure(saved) ?? failure(gone)

  // WHAT THE READER IS AGREEING TO, in the order they need it: who loses what, when it takes effect, and
  // the one thing this product cannot do for them.
  const loses = person.access.length
    ? person.access.map((a) => (a.kind === 'everything' ? 'everything on this Clearotron' : a.name ?? a.key))
    : []
  // WHAT THIS PAGE CAN VOUCH FOR, AND WHAT IT CANNOT.
  //
  // Taking somebody off the access record ends their assistant's session on its next request, because
  // the connector re-reads that record — so "through their AI" is simply true for the great majority of
  // people, who hold no issued key at all.
  //
  // A key is the part this page cannot promise about. The connector is a separate service with its own
  // environment, and whether it loaded a revocation list is not a question the portal can answer from
  // here: it can say whether a list is named FOR ITSELF, and no more. So a key holder gets one extra
  // sentence either way — naming where to see whether the revocation took, or saying plainly that it
  // cannot — rather than a promise made on a reading of somebody else's environment.
  const holdsKey = (person.keys ?? 0) > 0
  const keyStaysLive = holdsKey && view.keysRevocable !== true
  // A WHOLE EMAIL DOMAIN IS A ROW LIKE ANY OTHER, and it is changed and removed like one — but the
  // confirmation must not read as though one person is losing access. `*@example.com` admits everybody
  // with an address there, and a reader who skims the address sees a person's name shape.
  const domain = person.email.startsWith('*@') ? person.email.slice(2) : null

  return (
    <div className="screen">
      <div className="measure" style={{ '--screen-measure': '640px' } as CSSProperties}>
        <PageHeader
          title="Modify access"
          lede={<b style={{ color: 'var(--text-strong)', wordBreak: 'break-all' }} data-anon="mark">{person.email}</b>}
        />

        <div className="field-label">Permissions</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 6 }}>
          <Lever on={permissions.run} title="Run clearances" line="Start and stop clearances on the companies they can see."
            disabled={!whole || busy} onToggle={() => setPermissions((p) => ({ ...p, run: !p.run }))} />
          <Lever on={permissions.manage} title="Manage" line="Add companies, add people and change settings for the companies they can see."
            disabled={!whole || busy} onToggle={() => setPermissions((p) => ({ ...p, manage: !p.manage }))} />
        </div>
        <p style={{ margin: '0 0 22px', fontSize: 12.5, color: 'var(--text-faint)' }}>
          {whole
            ? 'Everyone can view reports for the companies they can see. Leave both off for a view-only person.'
            : "They have access you can't see, so only someone who can see all of it can change their permissions."}
        </p>

        <div className="field-label">Access to</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
          {holdsEverything ? (
            <AttachRow on name="Everything on this Clearotron" line="all organisations and companies, including ones added later"
              disabled onToggle={() => { /* not this page's to take away — removal is */ }} />
          ) : null}
          {tree.map((t) => (
            <div key={t.org.key} style={{ display: 'contents' }}>
              {t.whole ? (
                <AttachRow on={chosen.orgs.has(t.org.key)} name={t.org.name}
                  line="every company in it, including ones added later" disabled={busy}
                  onToggle={() => setChosen((c) => ({ ...c, orgs: toggle(c.orgs, t.org.key) }))} />
              ) : null}
              {t.companies.map((k) => (
                <AttachRow key={k} sub={t.whole} on={covered(k)} implied={chosen.orgs.has(t.org.key)}
                  name={ctx.ownerName(k)} line={t.whole ? 'company' : `company in ${t.org.name}`} disabled={busy}
                  onToggle={() => setChosen((c) => ({ ...c, companies: toggle(c.companies, k) }))} />
              ))}
            </div>
          ))}
        </div>
        <p style={{ margin: '0 0 22px', fontSize: 12.5, color: 'var(--text-faint)' }}>
          Untick a row to take that access away.
          {whole ? '' : " You are seeing the part of their access you can reach; the rest is not shown and is not changed."}
        </p>

        <div className="notice quiet" style={{ marginBottom: 18 }}>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-muted)' }} data-anon="mark">
            {sentence}
            {losing.length ? <> <b style={{ color: 'var(--text-strong)' }}>They lose {losing.join(', ')}.</b></> : null}
          </p>
        </div>

        {problem ? (
          <div className="notice" style={{ borderColor: 'var(--tone-high)', marginBottom: 14 }}>
            <p style={{ margin: 0, fontSize: 13.5 }}>{problem}</p>
          </div>
        ) : null}

        {saved && isOk(saved) ? (
          <div className="notice" style={{ borderColor: 'var(--tone-medium)', marginBottom: 14 }}>
            <p style={{ margin: 0, fontSize: 13.5 }}>
              Saved. {saved.value.switchesApplied ? permissionsPhrase(permissions) + '.' : (
                <>Their permissions stay as they were: {permissionsPhrase(person.permissions)}. They have access you
                cannot see, and permissions apply everywhere a person has access.</>
              )}
            </p>
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button type="button" className="btn-primary" disabled={!dirty || busy || leftWithNothing} onClick={() => void save()}>
            {busy && !confirming ? 'Saving…' : 'Save changes'}
          </button>
          <button type="button" className="btn-ghost" onClick={() => ctx.go(PEOPLE.path)}>Cancel</button>
          {leftWithNothing ? (
            <span style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>
              Nothing is ticked. Leave them at least one, or remove them below.
            </span>
          ) : null}
        </div>

        {/* APART FROM SAVE, and below it, so it is never on the way to anything else. */}
        <div style={{ marginTop: 34, paddingTop: 18, borderTop: '1px solid var(--border-hairline)',
          display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
          {confirming ? (
            <>
              <div className="notice" style={{ borderColor: 'var(--tone-high)', margin: 0, width: '100%' }}>
                <p style={{ margin: 0, fontSize: 13.5 }}>
                  <b data-anon="mark">{person.email}</b>{' '}
                  {whole ? (
                    <b>loses access to {loses.length ? loses.join(' and ') : 'this Clearotron'} straight away,</b>
                  ) : (
                    <b>loses {loses.join(' and ')} straight away,</b>
                  )}{' '}
                  {keyStaysLive
                    ? 'here. Their AI was issued a key this Clearotron cannot withdraw — it was started without a revocation list — so that key keeps working until it expires. clearotron doctor reports it.'
                    : 'here and through their AI.'}{' '}
                  {holdsKey && !keyStaysLive
                    ? 'Their AI\u2019s key is withdrawn at the same time; clearotron doctor says whether the connector has picked it up. '
                    : ''}
                  {whole
                    ? 'To stop them reaching your sign-in page, take them off your login system too.'
                    : 'They keep the access you cannot see.'}
                  {domain ? <> <b>This takes access away from everyone with an address at <span data-anon="mark">{domain}</span>.</b></> : null}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="pill" style={{ cursor: 'pointer', fontSize: 12, borderColor: 'var(--tone-high)' }}
                  disabled={busy} onClick={() => void remove()}>
                  {busy ? 'Working…' : 'Confirm — remove'}
                </button>
                <button type="button" className="pill" style={{ cursor: 'pointer', fontSize: 12 }} onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <button type="button" className="pill" style={{ cursor: 'pointer', fontSize: 12 }}
                disabled={busy} onClick={() => setConfirming(true)}>
                {whole
                  ? domain ? `Remove everyone at ${domain}` : 'Remove from Clearotron'
                  : `Remove from ${[...held.orgs].map(orgName).join(', ') || 'here'}`}
              </button>
              {whole ? null : (
                <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-faint)' }}>They keep the access you cannot see.</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Lever({ on, title, line, disabled, onToggle }: {
  readonly on: boolean
  readonly title: string
  readonly line: string
  readonly disabled: boolean
  readonly onToggle: () => void
}) {
  return (
    <button type="button" className={on ? 'lever lever-on' : 'lever'} aria-pressed={on} disabled={disabled} onClick={onToggle}>
      <span className={on ? 'lever-box lever-box-on' : 'lever-box'} />
      <span style={{ textAlign: 'left' }}>
        <span style={{ display: 'block', fontWeight: 600, color: 'var(--text-strong)' }}>{title}</span>
        <span style={{ display: 'block', fontSize: 12.5, color: 'var(--text-muted)' }}>{line}</span>
      </span>
    </button>
  )
}

/**
 * One point on the tree. `implied` is a company inside an organisation that is ticked: drawn on and not
 * untickable on its own, because the file cannot express "this organisation except that company" —
 * `"*"` means the organisation including whatever is added to it later, and today's list minus one is a
 * different grant. Untick the organisation instead.
 */
function AttachRow({ on, implied = false, sub = false, name, line, disabled, onToggle }: {
  readonly on: boolean
  readonly implied?: boolean
  readonly sub?: boolean
  readonly name: string
  readonly line: string
  readonly disabled: boolean
  readonly onToggle: () => void
}) {
  return (
    <button
      type="button"
      className={`attach-row${on ? ' on' : ''}${sub ? ' sub' : ''}`}
      aria-pressed={on}
      disabled={disabled || implied}
      onClick={onToggle}
    >
      <span className={on ? 'lever-box lever-box-on' : 'lever-box'} />
      <span style={{ color: 'var(--text-strong)', fontWeight: sub ? 400 : 600 }} data-anon="mark">{name}</span>
      <span className="sub-t">{line}</span>
    </button>
  )
}
