// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// People & access — who can sign in, and what they reach. Staff only, read-only.
//
// The reason this page exists is a specific recurring support case: somebody cannot get in, or gets in
// and sees nothing, and finding out why means reading a JSON file on the box.
//
// Enrolment is TWO-SIDED. An email must be admitted by Cloudflare Access at the edge AND granted an
// account here. Either half alone fails in a way that looks like a bug rather than a missing step:
// admitted but ungranted lands on "no clearances are available to you"; granted but not admitted never
// reaches the portal at all. This page can only see the second half, and it says so — a page that
// implied it held the whole picture would send people looking in the wrong place.
//
// Read-only. Granting access from a browser is a production change; it belongs in the grants file where
// it is reviewed and recorded.

import type { CSSProperties } from 'react'
import { api, staffLabel } from '../contract/api.ts'
import type { AccessView, ObservedView, Person } from '../contract/api.ts'
import { Icon } from '../components/Icon.tsx'
import { useLoad } from '../state/useApi.ts'
import type { ShellContext } from '../shell/AppShell.tsx'

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
  const v: AccessView = result.value

  // Problems first. A page that lists forty healthy grants and buries the one typo has answered the
  // question nobody asked.
  const broken = v.people.filter((p) => p.dangling.length > 0)

  return (
    <div className="screen">
      <div className="measure" style={{ '--screen-measure': '780px' } as CSSProperties}>
        <div className="notice quiet" style={{ marginBottom: 18 }}>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>{v.note}</p>
        </div>

        {broken.length ? (
          <div className="notice" style={{ borderColor: 'var(--tone-high)', marginBottom: 18 }}>
            <b>{broken.length === 1 ? 'One grant names an account that does not exist' : `${broken.length} grants name accounts that do not exist`}</b>
            <p style={{ margin: '6px 0 8px', color: 'var(--text-muted)', fontSize: 13 }}>
              Usually a spelling mistake. It fails silently: the person signs in and simply cannot see
              that brand owner, with nothing to explain why.
            </p>
            <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-muted)', fontSize: 13 }}>
              {broken.map((p) => (
                <li key={p.email} style={{ marginBottom: 3 }}>
                  <span data-anon="mark">{p.email}</span> → <b>{p.dangling.join(', ')}</b>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {v.unknownAccounts.length ? (
          <div className="notice" style={{ borderColor: 'var(--tone-medium)', marginBottom: 18 }}>
            <b>Accounts with no brand owner configured</b>
            <p style={{ margin: '6px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>
              Named in the access list but with no profile: <b>{v.unknownAccounts.join(', ')}</b>. Anyone
              granted one of these will sign in and find nothing there.
            </p>
          </div>
        ) : null}

        <Roles brand={ctx.me.brand} />

        <div style={{ fontWeight: 700, color: 'var(--text-strong)', fontSize: 15, marginBottom: 8 }}>
          Who can sign in
        </div>

        {/* GROUPED BY ROLE. The staff rule and the enrolled people were one flat
            list, and the rule sat in it as a row — which answered "why is nobody from my firm here?" but
            left a reader working out which entries were which kind. The headings do that now, and the
            rule keeps its own rank under its own heading rather than being demoted to a footnote. */}
        {v.staffDomains.length ? (
          <>
            <div style={{ fontWeight: 600, color: 'var(--text-muted)', fontSize: 12.5, margin: '10px 0 6px' }}>
              Staff <span style={{ color: 'var(--text-faint)' }}>— a config rule, not a person</span>
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              <StaffRuleRow domains={v.staffDomains} />
            </div>
          </>
        ) : null}

        <div style={{ fontWeight: 600, color: 'var(--text-muted)', fontSize: 12.5, margin: '14px 0 6px' }}>
          Clients
        </div>
        {v.people.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
            No client is enrolled on this instance yet.
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 6 }}>
            {v.people.map((p) => <Row key={p.email} person={p} />)}
          </div>
        )}

        {v.grantsFile ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 12.5, marginTop: 14 }}>
            Access is not currently configurable via the UI. Use the provided CLI —{' '}
            <b className="mono">clearotron grant</b> — which is a back end change. Last changed{' '}
            {new Date(v.grantsFile.modifiedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}.
          </p>
        ) : null}

        <Observed result={observed} />
      </div>
    </div>
  )
}

/**
 * What the two roles actually mean.
 *
 * Every clause here is traceable to portal-access.mjs rather than to an intention. In particular it
 * does NOT claim staff can configure anything: nothing about access is editable from any screen, by
 * anyone, and a page that implied otherwise would send someone looking for a control that is not there.
 */
function Roles({ brand }: { readonly brand: string }) {
  const Role = ({ name, children }: { readonly name: string; readonly children: React.ReactNode }) => (
    <div style={{ marginTop: 8 }}>
      <span style={{ fontWeight: 700, color: 'var(--text-strong)', fontSize: 13.5 }}>{name}</span>
      <span style={{ color: 'var(--text-muted)', fontSize: 13 }}> — {children}</span>
    </div>
  )
  return (
    <div className="notice quiet" style={{ marginBottom: 18 }}>
      <div className="eyebrow">Two roles currently exist</div>
      <Role name={staffLabel(brand)}>capable to see every brand owner.</Role>
      {/* THE NEAREST TRUE FORM. The owner's line read "the brand owners and its
          projects named in their grants", and a grant names ACCOUNTS only — `grant add <email> --tenant
          <name> --accounts <key,key|*>`. A project belongs to a brand owner's configuration, so a client
          reaches one by INHERITANCE and never by being named. Saying otherwise would send someone
          looking for a per-project grant that cannot be written. Flagged on the issue. */}
      <Role name="Clients">
        reaches only the brand owners named in their grants, and those brand owners&rsquo; projects, and
        nothing else. A brand owner they are not granted is not visible.
      </Role>
    </div>
  )
}

/** The staff domain rule, rendered as an entry rather than as a footnote about the entries. */
function StaffRuleRow({ domains }: { readonly domains: readonly string[] }) {
  return (
    <div
      style={{
        padding: '10px 13px',
        borderRadius: 9,
        border: '1px solid var(--border-hairline)',
        background: 'var(--surface-raised)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, color: 'var(--text-strong)', fontSize: 13.5 }}>
          Anyone at <span data-anon="mark">{domains.join(', ')}</span>
        </span>
        <span className="pill" style={{ fontSize: 10.5, padding: '1px 7px' }}>a rule, not a person</span>
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
  const bad = person.dangling.length > 0
  return (
    <div
      style={{
        padding: '10px 13px',
        borderRadius: 9,
        border: `1px solid ${bad ? 'var(--tone-high)' : 'var(--border-hairline)'}`,
        background: 'var(--surface-raised)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, color: 'var(--text-strong)', fontSize: 13.5 }} data-anon="mark">
          {person.email}
        </span>
        <span className="pill" style={{ fontSize: 10.5, padding: '1px 7px' }} data-anon="mark">{person.tenant}</span>
        {person.wildcard ? (
          // Worth surfacing: this grant follows the tenant. Adding a brand owner to that tenant silently
          // widens what this person can see, which is right but should not be a surprise.
          <span className="pill" style={{ fontSize: 10.5, padding: '1px 7px' }}>all of this tenant</span>
        ) : null}
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 4 }}>
        {person.accounts.length ? (
          <>Reaches: <span style={{ color: 'var(--text-strong)' }} data-anon="mark">{person.accounts.join(', ')}</span></>
        ) : (
          'Reaches nothing — signed in, but granted no brand owner.'
        )}
      </div>
    </div>
  )
}
