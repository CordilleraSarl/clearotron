// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Making a company — the page an outside user looked for, did not find, and worked around with an LLM.
//
// ONE PAGE, NOT A DIALOGUE, and only the name is required. Everything else has a default, and the screen
// says on itself what that default is; a person setting up their own company should be able to type a
// name and be searching, while a firm onboarding a client can fill in the rest in the same place.
//
// IT RENDERS THE PROFILE EDITOR'S OWN FIELD SPECS. Same labels, same order, same parsing, same notices,
// through the same `Field` — so what you fill in here and what you change afterwards cannot describe the
// company differently. Two forms agreeing by inspection is the thing this family exists to stop.
//
// THE BODY IS BUILT BY OMISSION. Untouched fields contribute no key at all, which is not the same as
// contributing an empty one: `platforms: []` reads on the wire exactly like "no marketplaces stated",
// and the company then silently takes the house list while the screen showed an empty box. `typeField`
// keeps that true by construction — a box nobody touched is not in `edits` and never reaches the draft.
import { useEffect, useMemo, useState } from 'react'
import { api, isOk } from '../contract/api.ts'
import type { CreatedCompany, Result } from '../contract/api.ts'
import { PROFILE_FIELDS, FIELD_GROUPS, boxValue, typeField } from '../contract/profileFields.ts'
import type { FieldSpec, FormEdit } from '../contract/profileFields.ts'
import { Field } from '../components/ProfileField.tsx'
import { useUnsaved } from '../state/useUnsaved.ts'
import type { ShellContext } from '../shell/AppShell.tsx'
import { companyKeyFrom } from '../contract/companyKey.ts'
import { handOff } from '../contract/companyCreated.ts'

/**
 * What a person may state when making a company.
 *
 * A SUBSET OF THE PROFILE'S FIELDS, and the omissions are each a decision. Risk appetite is prose that
 * flavours emphasis and decides nothing, and it reads as a question about the company rather than about
 * this moment — it lives on the profile. Default search depth needs the product list fetched to render
 * anything but a read-only box. And the risk framework is never typed: it is shown, below, with the one
 * link that tells somebody their own is possible.
 */
const CREATE_FIELDS: readonly string[] = [
  'name',
  'matchDomains',
  'selfExclusionOwners',
  'industry',
  'defaultClasses',
  'defaultJurisdictions',
  'platforms',
]

const specs = (): readonly FieldSpec[] => PROFILE_FIELDS.filter((f) => CREATE_FIELDS.includes(f.key))

export function NewCompany({ ctx }: { readonly ctx: ShellContext }) {
  const [state, setState] = useState<FormEdit>({ draft: {}, edits: {} })
  const [keyEdited, setKeyEdited] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result<CreatedCompany> | null>(null)

  const typedName = String(state.edits['name'] ?? '').trim()
  // The key follows the name until somebody says otherwise, and then it stops following — a key that
  // kept re-deriving would silently overwrite what they had just typed on their next keystroke in the
  // name box.
  const derivedKey = useMemo(() => companyKeyFrom(typedName), [typedName])
  const key = keyEdited ?? derivedKey

  const dirty = Boolean(typedName) || Object.keys(state.edits).length > 0
  useUnsaved(dirty && !result)

  // The house default, said as a fact rather than copied into the form. Pre-filling the marketplace box
  // with the general list and posting it back would turn a DEFAULT into a snapshot: the company would
  // hold its own copy of whatever the house list was on the day it was made, and would not follow it
  // afterwards. The engine resolves the default at write time and the receipt names what it resolved.
  const houseMarketplaces = ctx.factsFor('generic')?.platformCount ?? null

  // Create states its unmet condition BESIDE the button, never after it. A button that looks available
  // and then refuses is the shape this whole family is removing.
  const unmet = !typedName ? 'Needs a name.' : !key ? 'Needs a key — type one below.' : null

  async function create() {
    if (unmet || busy) return
    setBusy(true)
    // Only what was actually filled in, plus the key when it was chosen rather than derived — the
    // server derives the same key from the same rule when none is sent.
    const body: Record<string, unknown> = { ...state.draft }
    if (keyEdited) body['key'] = keyEdited
    const r = await api.createCompany(body)
    setBusy(false)
    setResult(r)
  }

  // LEAVING HAPPENS AFTER THE RENDER THAT MAKES THIS PAGE CLEAN, and that is the whole reason this is an
  // effect rather than three more lines inside `create`.
  //
  // The unsaved-changes guard reads its flag through a ref written during render, and it is asked at the
  // moment of navigation. Calling `go` straight after `setResult` asks it before React has re-rendered,
  // so it still holds the value from before the create — and somebody who had just successfully made a
  // company would be asked whether they want to discard it. That is the exact defect the guard's own
  // file describes: a warning that fires on saved work teaches people to click through every warning,
  // including the true one.
  useEffect(() => {
    if (!result || !isOk(result)) return
    handOff(result.value)
    // The shell fetched the company list once when it mounted and does not poll. Without this the
    // company is selected, the rail shows its slug instead of its name, and the picker does not list
    // the thing that was just made.
    ctx.refreshCompanies()
    ctx.setOwner(result.value.key)
    ctx.go('/portal/new')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result])

  const rejected = result && !isOk(result) && result.kind === 'reject' ? result.errors : null
  const otherFailure = result && !isOk(result) && result.kind !== 'reject' ? result : null

  return (
    <div className="screen">
      <div className="eyebrow">Company</div>
      <div className="measure">
        <h1 style={{ fontSize: 27, margin: '0 0 4px', color: 'var(--text-strong)' }}>New company</h1>
        <p style={{ margin: '0 0 18px', color: 'var(--text-muted)', fontSize: 14.5 }}>
          The business whose names you are checking. Only the name is needed; everything else has a
          default you can change later.
        </p>

        {rejected ? (
          <div className="empty" style={{ textAlign: 'left', marginBottom: 18 }} role="alert">
            <p style={{ fontWeight: 700, color: 'var(--text-strong)' }}>Nothing was created.</p>
            {rejected.map((e, i) => (
              <p key={i} style={{ color: 'var(--tone-high)' }}>{e}</p>
            ))}
          </div>
        ) : null}
        {otherFailure ? (
          <div className="empty" style={{ textAlign: 'left', marginBottom: 18 }} role="alert">
            <p style={{ fontWeight: 700, color: 'var(--text-strong)' }}>{failureTitle(otherFailure.kind)}</p>
          </div>
        ) : null}

        {FIELD_GROUPS.map((group) => {
          const rows = specs().filter((f) => f.group === group.id)
          if (!rows.length) return null
          return (
            <section key={group.id} style={{ marginTop: 26 }}>
              <h2 style={{ fontSize: 15, margin: 0, color: 'var(--text-strong)' }}>{group.label}</h2>
              {rows.map((spec) => (
                <div key={spec.key}>
                  <Field
                    spec={spec}
                    value={boxValue(state, spec)}
                    choices={null}
                    onChange={(v) => setState((s) => typeField(s, spec, v))}
                  />
                  {spec.key === 'name' ? <KeyLine value={key} onChange={setKeyEdited} /> : null}
                  {spec.key === 'platforms' && !boxValue(state, spec).trim() ? (
                    <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 5 }}>
                      {houseMarketplaces === null
                        ? 'Left empty, this company searches the same marketplaces as the general default.'
                        : `Left empty, this company searches the same ${houseMarketplaces} marketplaces as the general default.`}
                    </p>
                  ) : null}
                </div>
              ))}
            </section>
          )
        })}

        <Rating />

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '28px 0 40px' }}>
          <button
            type="button"
            className="start-pill"
            disabled={Boolean(unmet) || busy}
            onClick={() => void create()}
            style={{ flex: 'none' }}
          >
            {busy ? 'Creating…' : 'Create'}
          </button>
          {unmet ? <span style={{ color: 'var(--text-muted)', fontSize: 13.5 }}>{unmet}</span> : null}
        </div>
      </div>
    </div>
  )
}

/**
 * The key, under the name that made it.
 *
 * Shown rather than hidden because it becomes a filename and the value every search files against —
 * wrong once is wrong for good — and changeable before Create and never after, which is why it is worth
 * a person's attention now and not later.
 */
function KeyLine({ value, onChange }: { readonly value: string; readonly onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  if (open) {
    return (
      <div style={{ marginTop: 6 }}>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          aria-label="Company key"
          style={{
            width: '100%', padding: '7px 10px', borderRadius: 8, fontSize: 13,
            border: '1px solid var(--border-hairline)', background: 'var(--surface-raised)',
            color: 'var(--text-strong)', fontFamily: 'inherit',
          }}
        />
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 4 }}>
          Lowercase letters, digits and hyphens. This cannot be changed once the company exists.
        </p>
      </div>
    )
  }
  return (
    <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 6 }}>
      {value ? <>Filed as <code>{value}</code>. </> : <>No key can be made from that name yet. </>}
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          background: 'none', border: 'none', padding: 0, font: 'inherit',
          color: 'var(--text-accent)', cursor: 'pointer', textDecoration: 'underline',
        }}
      >
        Change it
      </button>
    </p>
  )
}

/**
 * The rating row — read-only, and the one route from the browser to writing your own rubric.
 *
 * IT IS A REQUIREMENT, NOT DECORATION. Nothing else in the product tells a person their own risk
 * framework is possible, so without this line the capability exists and is undiscoverable. It names the
 * framework in force and carries one link, in the same words as the profile screen.
 *
 * No chooser. A framework decides how every matter for this company is rated, forever, and a dropdown on
 * a create form is not where that is decided — the create path resolves the house default and the strip
 * afterwards says so.
 */
export function Rating() {
  const [repo, setRepo] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void api.about().then((r) => {
      if (live && isOk(r)) setRepo(r.value.sourceRepo)
    })
    return () => { live = false }
  }, [])

  return (
    <section style={{ marginTop: 26 }}>
      <h2 style={{ fontSize: 15, margin: '0 0 8px', color: 'var(--text-strong)' }}>How matters are rated</h2>
      <div className="empty" style={{ textAlign: 'left' }}>
        <p style={{ margin: 0, color: 'var(--text-strong)' }}>The general risk framework.</p>
        <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>
          Every company starts here, and the receipt says which framework it was given. You can write
          your own rubric and point a company at it.
        </p>
        {/* THE REPOSITORY THE SERVER NAMES, never a literal. This portal may be a fork, and a link to
            somebody else's instructions is worse than no link — it sends a person to a document that
            does not describe the product they are running. The About screen resolves it the same way,
            and for the same reason. No link at all until it resolves, rather than a broken one. */}
        {repo ? (
          <a href={`${repo}/blob/main/docs/configuration.md`} rel="noreferrer"
             style={{ fontSize: 13 }}>
            Use your own risk framework
          </a>
        ) : null}
      </div>
    </section>
  )
}

function failureTitle(kind: string): string {
  switch (kind) {
    case 'notFound':
    case 'noAccess':
      return 'Companies cannot be created from here on this installation.'
    case 'signedOut':
      return 'Your session has ended. Sign in and try again.'
    case 'rateLimited':
      return 'Too many requests just now. Wait a moment and try again.'
    default:
      return 'Nothing was created. Try again shortly.'
  }
}
