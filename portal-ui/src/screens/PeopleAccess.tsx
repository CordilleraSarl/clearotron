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
// passwords: the organisation's sign-in service in front of the install proves the address. So a person
// also has to be admitted THERE — this page sees only the half that lives here, and the form that adds
// them says so rather than implying it holds the whole picture.

import { Fragment } from 'react'
import type { CSSProperties } from 'react'
import { api, isOk } from '../contract/api.ts'
import type { ObservedView, Person } from '../contract/api.ts'
import { Icon } from '../components/Icon.tsx'
import { useLoad } from '../state/useApi.ts'
import type { ShellContext } from '../shell/AppShell.tsx'
import { permissionsPhrase, accessChips, PERMISSIONS_KEY } from '../shell/accessWords.ts'
import { ADD_PERSON, MODIFY_PERSON } from '../nav/nav.config.ts'
import { PageHeader } from '../components/PageHeader.tsx'

/**
 * Where putting a login system in front is explained — the way out of an install that signs in one person.
 *
 * Built from the source repository the server states, as About's and the company form's links are, and
 * never written into the bundle: the bundle names the firm only in its declared places, the source offer
 * and the trademark notice, and a fork's People page would otherwise point at someone else's repository.
 */
export const loginInFrontDoc = (sourceRepo: string): string =>
  `${sourceRepo}/blob/main/docs/PORTAL.md#putting-your-own-login-provider-in-front`

/** The server's stated source repository, or null while it loads or when the server states none. */
export function useSourceRepo(): string | null {
  const { result } = useLoad(() => api.about(), [])
  return result && isOk(result) && result.value.sourceRepo ? result.value.sourceRepo : null
}

export function PeopleAccess({ ctx }: { readonly ctx: ShellContext }) {
  const { result } = useLoad(() => api.adminAccess(), [])
  const repo = useSourceRepo()
  // A SECOND, INDEPENDENT load. Deliberately not folded into the gate below: the activity feed is an
  // extra, and a page whose job is explaining access must not go blank because an optional log could
  // not be read. ASKED ONLY BY SOMEONE WHO SEES EVERYTHING, the one reader the server serves it to:
  // People is Manage's, the activity log is the installation's, and a manager of one organisation used
  // to fire a 404 here on every visit. Anyone else gets the not-found the panel renders as nothing.
  const seesAll = ctx.me.allAccounts
  const { result: observed } = useLoad<ObservedView>(
    () => (seesAll ? api.adminObserved() : Promise.resolve({ kind: 'notFound' as const })),
    [seesAll],
  )

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

  return (
    <div className="screen">
      <div className="measure" style={{ '--screen-measure': '900px' } as CSSProperties}>
        {/* NO LEDE. The columns and the key under them say who can do what; a sentence above the list
            announcing that it will was the page describing itself. */}
        <PageHeader
          title="People"
          // DISABLED, NOT HIDDEN, where the install cannot hold a second person — and the notice below
          // says why. A button that vanished would leave a reader looking for it; one that is visibly
          // off, beside the sentence explaining it, answers the question before it is asked.
          actions={
            <button type="button" className="btn-primary" disabled={!v.canAdd} onClick={() => ctx.go(ADD_PERSON.path)}>
              + Add a person
            </button>
          }
        />

        {v.localSignIn ? (
          <div className="notice quiet" style={{ marginBottom: 14 }}>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-muted)' }}>
              <b style={{ color: 'var(--text-strong)' }}>This Clearotron signs in one person: you.</b> To add
              people, put it behind a login system such as your company single sign-on.{' '}
              {repo ? <a href={loginInFrontDoc(repo)} target="_blank" rel="noreferrer">How to set that up</a> : null}
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
                {/* No heading. The column holds one control per row and a word above it would be
                    labelling a button that already says what it does. */}
                <th aria-label="Change or remove" />
              </tr>
            </thead>
            <tbody>
              {v.people.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ color: 'var(--text-muted)' }}>Nobody has been given access yet.</td>
                </tr>
              ) : (
                v.people.map((p) => (
                  <Row key={p.email} person={p} you={p.email.toLowerCase() === ctx.me.email.toLowerCase()}
                    canModify={!v.localSignIn}
                    onModify={() => ctx.go(`${MODIFY_PERSON.path}?email=${encodeURIComponent(p.email)}`)} />
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* WHAT THE COLUMN'S WORDS MEAN, under the column that prints them — said once for the page rather
            than once per row, and scoped the way the permissions are: to the companies a person can see. */}
        <dl className="perm-key">
          {PERMISSIONS_KEY.map((k) => (
            <Fragment key={k.term}>
              <dt>{k.term}</dt>
              <dd>{k.means}</dd>
            </Fragment>
          ))}
        </dl>

        {v.grantsFile ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 12.5, marginTop: 14 }}>
            Recorded in <b className="mono">{v.grantsFile.name}</b>, which{' '}
            <b className="mono">clearotron grant</b> edits too. Last changed{' '}
            {new Date(v.grantsFile.modifiedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}.
          </p>
        ) : null}

        <Observed result={observed} ownerName={ctx.ownerName} />
      </div>
    </div>
  )
}

/**
 * Recent activity.
 *
 * The list above shows the people the access record names. This is what puts a colleague's name on the
 * screen, and it reads the audit log rather than any access record, most recent first.
 *
 * WHAT THE PANEL COUNTS IS SAID IN BOTH STATES: in one line when it is empty, so an empty panel still
 * explains itself, and above the rows when it is not. And it NAMES NO WINDOW: the log is read from its
 * tail by size, so the span it covers is not a length of time, and any number of days would be invented.
 */
function Observed({ result, ownerName }: {
  readonly result: ReturnType<typeof useLoad<ObservedView>>['result']
  /** The shell's one name resolver. The log records a company by its key, and a reader knows it by name. */
  readonly ownerName: ShellContext['ownerName']
}) {
  if (!result) return null
  // A failed FETCH is silent here. The panel is an extra; a red box reporting that an optional feed is
  // missing would be louder than the thing it is reporting.
  if (result.kind !== 'ok') return null
  const v = result.value
  const quiet: CSSProperties = { margin: 0, color: 'var(--text-muted)', fontSize: 12.5 }

  return (
    <div style={{ marginTop: 26 }}>
      <div style={{ fontWeight: 700, color: 'var(--text-strong)', fontSize: 15, marginBottom: 4 }}>
        Recent activity
      </div>

      {!v.available ? (
        <p style={quiet}>{v.note}</p>
      ) : v.people.length === 0 ? (
        <p style={quiet}>Nothing planned, started or saved here yet.</p>
      ) : (
        <div style={{ display: 'grid', gap: 6 }}>
          <p style={{ ...quiet, marginBottom: 4 }}>
            Identities that have planned, started or saved something here, most recent first.
            {v.truncated ? ' Only the most recent activity is read.' : ''}
          </p>
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
                  <span key={a} className="pill" style={{ fontSize: 10.5, padding: '1px 7px' }} data-anon="mark">{ownerName(a)}</span>
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

/**
 * One person.
 *
 * YOUR OWN ROW HAS NO MODIFY AND SAYS `You`. Nobody changes their own permissions — the Add form has
 * always refused to set the adder's own switches, and this refuses the whole act, because a manager who
 * could take their own Manage away can lock the installation's last manager out of it with one press and
 * the way back is a text editor on the box. It also means the last person who can manage everything
 * cannot be removed by accident, which is the rule falling out rather than a second rule.
 */
function Row({ person, you, canModify, onModify }: {
  readonly person: Person
  readonly you: boolean
  /** False where the install signs one person in: the write routes refuse, and the notice above says why. */
  readonly canModify: boolean
  readonly onModify: () => void
}) {
  const chips = accessChips(person.access)
  const viewOnly = !person.permissions.run && !person.permissions.manage
  return (
    <tr>
      <td>
        <span style={{ fontWeight: 700, color: 'var(--text-strong)', wordBreak: 'break-all' }} data-anon="mark">
          {person.email}
        </span>
        {you ? <span className="pill" style={{ fontSize: 10.5, padding: '1px 7px', marginLeft: 7 }}>You</span> : null}
      </td>
      {/* THE OUTCOME, ONE WORD FOR IT. An address on an organisation's access list with nothing set for
          it holds both switches off, and what that gives is what it gives anyone: they view what they
          reach. The row used to name the shape of the file instead, which told the reader how the record
          was written and left them to work out what the person could do. */}
      <td style={{ color: viewOnly ? 'var(--text-muted)' : 'var(--text-strong)' }}>
        {permissionsPhrase(person.permissions)}
      </td>
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
      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
        {/* DISABLED, NOT HIDDEN — the same choice the Add button makes eight lines up, and for the same
            reason: the notice above already explains it, and a control that vanished would leave a
            reader hunting for it. Pressing it on such an install reached a page whose Save and Remove
            both refused, so the answer was three screens away from the question. */}
        {you ? null : (
          <button type="button" className="pill" disabled={!canModify}
            style={{ cursor: canModify ? 'pointer' : 'default', fontSize: 12 }} onClick={onModify}>
            Modify
          </button>
        )}
      </td>
    </tr>
  )
}
