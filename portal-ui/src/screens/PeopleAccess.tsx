// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// People — who can use this install, what each person may do, and what they can see.
//
// The page's job has not changed: somebody cannot get in, or gets in and sees nothing, and finding out why
// should not mean reading a JSON file on the box. What changed is what a person IS. There are no role
// words: each person has two permissions, Run clearances and Manage, and access to points on the tree —
// the whole install, an organisation, or a company — and sees everything below them.
//
// The list holds the people whose access falls inside the VIEWER's own, and only those points of theirs.
// The server narrows it; this page draws what it is given. Someone managing one organisation sees that
// organisation's people and nothing of what they hold elsewhere.
//
// Adding a person is entering their address and choosing what they may see and do. Clearotron issues no
// passwords: the login system in front of the install proves the address. So a person also has to be
// admitted THERE — this page sees only the half that lives here, and says so rather than implying it
// holds the whole picture.

import type { CSSProperties } from 'react'
import { api } from '../contract/api.ts'
import type { ObservedView, Person } from '../contract/api.ts'
import { Icon } from '../components/Icon.tsx'
import { useLoad } from '../state/useApi.ts'
import type { ShellContext } from '../shell/AppShell.tsx'
import { permissionsPhrase, accessChips } from '../shell/accessWords.ts'
import { ADD_PERSON } from '../nav/nav.config.ts'

/** Where putting a login system in front is explained — the way out of an install that signs in one person. */
export const LOGIN_IN_FRONT_DOC =
  'https://github.com/CordilleraSarl/clearotron/blob/main/docs/PORTAL.md#putting-your-own-login-provider-in-front'

export function PeopleAccess({ ctx }: { readonly ctx: ShellContext }) {
  const { result } = useLoad(() => api.adminAccess(), [])
  // A SECOND, INDEPENDENT load. Deliberately not folded into the gate below: the activity feed is an
  // extra, and a page whose job is explaining access must not go blank because an optional log could
  // not be read.
  const { result: observed } = useLoad(() => api.adminObserved(), [])

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
  const v = result.value

  // Problems first. A page that lists forty healthy people and buries the one typo has answered the
  // question nobody asked.
  const broken = v.people.filter((p) => p.dangling.length > 0)

  // "at <organisation>" for a person who can see exactly one — the same rule the top bar keys on — and
  // "here" otherwise, because a person who sees several organisations is not inside any one of them.
  const where = ctx.organisations.length === 1 ? `at ${ctx.organisations[0]?.name ?? ''}` : 'here'

  return (
    <div className="screen">
      <div className="eyebrow">People</div>
      <div className="measure" style={{ '--screen-measure': '900px' } as CSSProperties}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20, margin: '4px 0 16px' }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: 27, margin: '0 0 4px', color: 'var(--text-strong)' }}>People</h1>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 14.5 }}>
              Who can use Clearotron <span data-anon="mark">{where}</span>, what they can do, and which
              companies they can see.
            </p>
          </div>
          {/* DISABLED, NOT HIDDEN, where the install cannot hold a second person — and the notice below
              says why. A button that vanished would leave a reader looking for it; one that is visibly
              off, beside the sentence explaining it, answers the question before it is asked. */}
          <button type="button" className="btn-primary" style={{ flex: 'none' }} disabled={!v.canAdd} onClick={() => ctx.go(ADD_PERSON.path)}>
            + Add a person
          </button>
        </div>

        {v.localSignIn ? (
          <div className="notice quiet" style={{ marginBottom: 14 }}>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-muted)' }}>
              <b style={{ color: 'var(--text-strong)' }}>This Clearotron signs in one person: you.</b> To add
              people, put it behind a login system such as your company single sign-on.{' '}
              <a href={LOGIN_IN_FRONT_DOC} target="_blank" rel="noreferrer">How to set that up</a>
            </p>
          </div>
        ) : null}

        {broken.length ? (
          <div className="notice" style={{ borderColor: 'var(--tone-high)', marginBottom: 14 }}>
            <b>{broken.length === 1 ? "One person's access names a company that does not exist" : `${broken.length} people's access names companies that do not exist`}</b>
            <p style={{ margin: '6px 0 8px', color: 'var(--text-muted)', fontSize: 13 }}>
              Usually a spelling mistake. It fails silently: the person signs in and simply cannot see
              that company, with nothing to explain why.
            </p>
            <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-muted)', fontSize: 13 }}>
              {broken.map((p) => (
                <li key={p.email} style={{ marginBottom: 3 }}>
                  <span data-anon="mark">{p.email}</span> → <b data-anon="mark">{p.dangling.join(', ')}</b>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {v.unknownAccounts.length ? (
          <div className="notice" style={{ borderColor: 'var(--tone-medium)', marginBottom: 14 }}>
            <b>Companies named in access with nothing set up</b>
            <p style={{ margin: '6px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>
              <b data-anon="mark">{v.unknownAccounts.join(', ')}</b>. Anyone given one of these will sign in
              and find nothing there.
            </p>
          </div>
        ) : null}

        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Person</th>
                <th>Permissions</th>
                <th>Access to</th>
              </tr>
            </thead>
            <tbody>
              {v.people.length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ color: 'var(--text-muted)' }}>Nobody has been given access yet.</td>
                </tr>
              ) : (
                v.people.map((p) => <Row key={p.email} person={p} />)
              )}
            </tbody>
          </table>
        </div>

        {v.grantsFile ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 12.5, marginTop: 14 }}>
            Recorded in <b className="mono">{v.grantsFile.name}</b>, which{' '}
            <b className="mono">clearotron grant</b> edits too. Last changed{' '}
            {new Date(v.grantsFile.modifiedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}.
          </p>
        ) : null}

        <Observed result={observed} />
      </div>
    </div>
  )
}

/**
 * Seen recently.
 *
 * The list above can only ever show CLIENTS. This is what puts a colleague's name on the screen, and
 * it reads the audit log rather than any access record — so the copy has to be plain that absence
 * means "has not done anything lately", never "has no access".
 */
function Observed({ result }: { readonly result: ReturnType<typeof useLoad<ObservedView>>['result'] }) {
  if (!result) return null
  // A failed FETCH is silent here. The panel is an extra; a red box reporting that an optional feed is
  // missing would be louder than the thing it is reporting.
  if (result.kind !== 'ok') return null
  const v = result.value

  return (
    <div style={{ marginTop: 26 }}>
      <div style={{ fontWeight: 700, color: 'var(--text-strong)', fontSize: 15, marginBottom: 4 }}>
        Seen recently
      </div>
      <p style={{ margin: '0 0 10px', color: 'var(--text-muted)', fontSize: 12.5 }}>
        Identities that have planned, started or saved something here, most recent first.
        {v.truncated ? ' Only the most recent activity is read.' : ''}{' '}
        Somebody absent from this list still has access — they have simply not done anything in the
        window shown.
      </p>

      {!v.available ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 12.5 }}>{v.note}</p>
      ) : v.people.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 12.5 }}>Nothing recorded yet.</p>
      ) : (
        <div style={{ display: 'grid', gap: 6 }}>
          {v.people.map((p) => (
            <div
              key={p.email}
              style={{
                padding: '9px 13px',
                borderRadius: 9,
                border: '1px solid var(--border-hairline)',
                background: 'var(--surface-raised)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, color: 'var(--text-strong)', fontSize: 13.5 }} data-anon="mark">
                  {p.email}
                </span>
                {p.accounts.map((a) => (
                  <span key={a} className="pill" style={{ fontSize: 10.5, padding: '1px 7px' }} data-anon="mark">{a}</span>
                ))}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 4 }}>
                {Object.entries(p.events).map(([e, n]) => `${e} ×${n}`).join(' · ')}
                {p.lastSeen ? ` — last ${new Date(p.lastSeen).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Row({ person }: { readonly person: Person }) {
  const chips = accessChips(person.access)
  const viewOnly = !person.permissions.run && !person.permissions.manage
  return (
    <tr>
      <td>
        <span style={{ fontWeight: 700, color: 'var(--text-strong)', wordBreak: 'break-all' }} data-anon="mark">
          {person.email}
        </span>
      </td>
      <td style={{ color: viewOnly ? 'var(--text-muted)' : 'var(--text-strong)' }}>{permissionsPhrase(person.permissions)}</td>
      <td>
        {chips.length ? (
          <span style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {chips.map((c) => (
              <span key={c.key} className={c.top ? 'chip chip-own' : 'chip'} data-anon={c.top ? undefined : 'mark'}>
                {c.label}
              </span>
            ))}
          </span>
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>Nothing yet — signed in, and given no access.</span>
        )}
      </td>
    </tr>
  )
}
