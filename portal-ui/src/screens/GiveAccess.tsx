// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Give someone access to Clearotron — the form People opens.
//
// Three questions: who, what they may do, and what they can see. Saving is all it takes. Clearotron issues
// no passwords and no browser tokens: the login system in front of the install proves the address, and
// this decides what that address can see. It writes the same grants file the command line writes.
//
// THE ACCESS LIST OFFERS ONLY WHAT THE ADDER CAN SEE, because a point outside it is one the server refuses:
// someone managing one organisation cannot give anybody another. An organisation is offered whole only to
// an adder who holds it whole; a company is offered to anyone who can see it.
//
// The sentence under the form says, before anything is saved, what the new person will and will not see.
// It is the adder's check on their own choices, so it is built from what the form holds.

import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { api, isOk, saveFailureText } from '../contract/api.ts'
import type { Permissions, Person, Result } from '../contract/api.ts'
import { useLoad } from '../state/useApi.ts'
import { useUnsaved } from '../state/useUnsaved.ts'
import type { ShellContext } from '../shell/AppShell.tsx'
import { accessSentence, permissionsPhrase } from '../shell/accessWords.ts'
import { isGenericKey } from '../contract/genericKey.ts'
import { PEOPLE } from '../nav/nav.config.ts'
import { LOGIN_IN_FRONT_DOC } from './PeopleAccess.tsx'

type Chosen = { readonly everything: boolean; readonly orgs: ReadonlySet<string>; readonly companies: ReadonlySet<string> }
const NOTHING: Chosen = { everything: false, orgs: new Set(), companies: new Set() }

// One address, as a sign-in would present it. The server checks it again; this only keeps Save from
// offering to write something that could never sign in — a list, a name, a blank.
const oneAddress = (s: string): boolean => /^[^\s@,;<>]+@[^\s@,;<>]+$/.test(s)

export function GiveAccess({ ctx }: { readonly ctx: ShellContext }) {
  // Whether this install can take another person at all. A reader who types this page's address on an
  // install that signs in one person meets the same explanation People gives, not a form that fails.
  const { result: view } = useLoad(() => api.adminAccess(), [])

  const [email, setEmail] = useState('')
  const [permissions, setPermissions] = useState<Permissions>({ run: true, manage: false })
  const [chosen, setChosen] = useState<Chosen>(NOTHING)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result<Person> | null>(null)

  const saved = result !== null && isOk(result)
  const dirty = email.trim() !== '' || chosen.everything || chosen.orgs.size > 0 || chosen.companies.size > 0
  useUnsaved(dirty && !saved)

  // THE SWITCHES COME BACK FROM THE ANSWER. They belong to the person, not to a point: when the address
  // already had access somewhere the adder cannot see, the points were added and the switches stayed as
  // they were. Leaving for People would hide that; the page stays and says it instead.
  const kept = saved && isOk(result)
    && (result.value.permissions.run !== permissions.run || result.value.permissions.manage !== permissions.manage)
  // Leaving happens after the render that makes this page clean, for the reason NewCompany gives: the
  // unsaved-changes guard reads its flag through a ref written during render.
  useEffect(() => {
    if (saved && !kept) ctx.go(PEOPLE.path)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved, kept])

  if (view && isOk(view) && !view.value.canAdd) {
    return (
      <div className="screen">
        <div className="eyebrow">People</div>
        <div className="measure" style={{ '--screen-measure': '640px' } as CSSProperties}>
          <h1 style={{ fontSize: 27, margin: '4px 0 12px', color: 'var(--text-strong)' }}>Give someone access to Clearotron</h1>
          <div className="notice quiet">
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-muted)' }}>
              <b style={{ color: 'var(--text-strong)' }}>This Clearotron signs in one person: you.</b> To add
              people, put it behind a login system such as your company single sign-on.{' '}
              <a href={LOGIN_IN_FRONT_DOC} target="_blank" rel="noreferrer">How to set that up</a>
            </p>
          </div>
        </div>
      </div>
    )
  }

  const holdsEverything = ctx.me.access.some((a) => a.kind === 'everything')
  const wholeOrgs = new Set(ctx.me.genericOrgs)
  const orgName = (key: string): string => ctx.organisations.find((o) => o.key === key)?.name ?? key
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
  // A company is covered when it was picked, or when its organisation — or everything — was.
  const covered = (company: string): boolean =>
    chosen.everything || chosen.companies.has(company) || chosen.orgs.has(ctx.orgOf(company) ?? '')
  const soloCompanies = [...chosen.companies].filter((k) => !chosen.orgs.has(ctx.orgOf(k) ?? ''))

  const addr = email.trim().toLowerCase()
  const access = chosen.everything
    ? [{ kind: 'everything' as const }]
    : [
        ...[...chosen.orgs].map((key) => ({ kind: 'organisation' as const, key })),
        ...soloCompanies.map((key) => ({ kind: 'company' as const, key })),
      ]
  const canSave = oneAddress(addr) && access.length > 0 && !busy && !saved

  const sentence = accessSentence({
    who: addr,
    permissions,
    everything: chosen.everything,
    organisations: [...chosen.orgs].map(orgName),
    companies: soloCompanies.map((k) => ({ name: ctx.ownerName(k), organisation: orgName(ctx.orgOf(k) ?? '') })),
  })

  const save = async () => {
    setBusy(true)
    setResult(null)
    try {
      setResult(await api.addPerson({ email: addr, permissions, access }))
    } finally {
      setBusy(false)
    }
  }

  const failure = result && !isOk(result)
    ? result.kind === 'notFound'
      ? 'You can only give access to what you have access to yourself. Nothing was saved.'
      : result.kind === 'reject'
        ? result.errors.join(' ')
        : saveFailureText(result, 'That could not be saved. Nothing was changed.')
    : null

  return (
    <div className="screen">
      <div className="eyebrow">People</div>
      <div className="measure" style={{ '--screen-measure': '640px' } as CSSProperties}>
        <h1 style={{ fontSize: 27, margin: '4px 0 4px', color: 'var(--text-strong)' }}>Give someone access to Clearotron</h1>
        <p style={{ margin: '0 0 22px', color: 'var(--text-muted)', fontSize: 14.5 }}>
          Enter their email, choose what they can see and do, then save. They sign in the same way you do.
        </p>

        <label className="field-label" htmlFor="give-access-email">Email</label>
        <input
          id="give-access-email"
          className="ctx-input"
          type="email"
          autoComplete="off"
          value={email}
          disabled={saved}
          onChange={(e) => setEmail(e.target.value)}
          style={{ marginBottom: 22 }}
          data-anon="mark"
        />

        <div className="field-label">Permissions</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 6 }}>
          <Lever on={permissions.run} title="Run clearances" line="Start and stop clearances on the companies they can see."
            disabled={saved} onToggle={() => setPermissions((p) => ({ ...p, run: !p.run }))} />
          <Lever on={permissions.manage} title="Manage" line="Add companies, add people and change settings for the companies they can see."
            disabled={saved} onToggle={() => setPermissions((p) => ({ ...p, manage: !p.manage }))} />
        </div>
        <p style={{ margin: '0 0 22px', fontSize: 12.5, color: 'var(--text-faint)' }}>
          Everyone can view reports for the companies they can see. Leave both off for a view-only person.
        </p>

        <div className="field-label">Access to</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
          {holdsEverything ? (
            <AttachRow on={chosen.everything} name="Everything on this Clearotron" line="all organisations and companies, including ones added later"
              disabled={saved} onToggle={() => setChosen((c) => ({ ...c, everything: !c.everything }))} />
          ) : null}
          {tree.map((t) => (
            <div key={t.org.key} style={{ display: 'contents' }}>
              {t.whole ? (
                <AttachRow on={chosen.everything || chosen.orgs.has(t.org.key)} implied={chosen.everything} name={t.org.name}
                  line="every company in it, including ones added later" disabled={saved}
                  onToggle={() => setChosen((c) => ({ ...c, orgs: toggle(c.orgs, t.org.key) }))} />
              ) : null}
              {t.companies.map((k) => (
                <AttachRow key={k} sub={t.whole} on={covered(k)} implied={chosen.everything || chosen.orgs.has(t.org.key)}
                  name={ctx.ownerName(k)} line={t.whole ? 'company' : `company in ${t.org.name}`} disabled={saved}
                  onToggle={() => setChosen((c) => ({ ...c, companies: toggle(c.companies, k) }))} />
              ))}
            </div>
          ))}
        </div>
        <p style={{ margin: '0 0 22px', fontSize: 12.5, color: 'var(--text-faint)' }}>
          You can only give access to what you have access to yourself.
        </p>

        <div className="notice quiet" style={{ marginBottom: 18 }}>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-muted)' }} data-anon="mark">{sentence}</p>
        </div>

        {failure ? (
          <div className="notice" style={{ borderColor: 'var(--tone-high)', marginBottom: 14 }}>
            <p style={{ margin: 0, fontSize: 13.5 }}>{failure}</p>
          </div>
        ) : null}

        {kept && isOk(result) ? (
          <div className="notice" style={{ borderColor: 'var(--tone-medium)', marginBottom: 14 }}>
            <p style={{ margin: 0, fontSize: 13.5 }}>
              <b data-anon="mark">{result.value.email}</b> already had access elsewhere, so their permissions
              stay as they were: {permissionsPhrase(result.value.permissions)}. The access you chose was added.
            </p>
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {kept ? (
            <button type="button" className="btn-primary" onClick={() => ctx.go(PEOPLE.path)}>Back to People</button>
          ) : (
            <>
              <button type="button" className="btn-primary" disabled={!canSave} onClick={() => void save()}>
                {busy ? 'Saving…' : 'Save'}
              </button>
              <button type="button" className="btn-ghost" onClick={() => ctx.go(PEOPLE.path)}>Cancel</button>
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
 * One point on the tree the new person could be given.
 *
 * `implied` is a row covered by a wider choice above it — everything, or its whole organisation. It is
 * drawn on and cannot be unticked on its own, because unticking a company inside a chosen organisation
 * would claim a narrowing the grant does not make.
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
