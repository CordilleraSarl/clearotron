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
import { FrameworkGuideLink } from '../components/FrameworkGuideLink.tsx'
import type { CreatedCompany, Result } from '../contract/api.ts'
import { PROFILE_FIELDS, FIELD_GROUPS, boxValue, typeField, parseLines } from '../contract/profileFields.ts'
import type { FieldSpec, FormEdit } from '../contract/profileFields.ts'
import { Field } from '../components/ProfileField.tsx'
import { useUnsaved } from '../state/useUnsaved.ts'
import type { ShellContext } from '../shell/AppShell.tsx'
import { companyKeyFrom } from '../contract/companyKey.ts'
import { handOff } from '../contract/companyCreated.ts'
import { canRun } from '../shell/permissions.ts'

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
  // Whether anybody has touched the trading-names box. Until they have, it FOLLOWS the name — and after
  // they have, it stops, the same rule the key follows. A box that kept re-deriving would overwrite what
  // somebody had just typed into it on the next keystroke in the name field.
  const [namesTouched, setNamesTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  // Where a company can be created: the organisations this person holds whole. One is the answer; several
  // is a question the form asks.
  const orgsHeld = ctx.me.genericOrgs
  const [org, setOrg] = useState<string | null>(null)
  const orgChosen = orgsHeld.length === 1 ? (orgsHeld[0] ?? null) : org
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

  // Anything a STRICT field would refuse, found before the post rather than after it. The server refuses
  // the same values on the same path, so this is not the only thing standing between a person and a bad
  // profile — it is the half that stops them pressing a button that cannot work, and says which entry.
  const refusedEntries = specs().flatMap((spec) => {
    if (!spec.item?.strict) return []
    const raw = boxValue(state, spec)
    if (!raw.trim()) return []
    return parseLines(raw, spec.commaSeparated ?? false).filter((e) => !spec.item!.ok(e))
  })

  // Create states its unmet condition BESIDE the button, never after it. A button that looks available
  // and then refuses is the shape this whole family is removing.
  const unmet = !typedName
    ? 'Needs a name.'
    : !key
      ? 'Needs a key — type one below.'
      : !orgChosen
        ? 'Choose the organisation it belongs to.'
      : refusedEntries.length
        ? `${refusedEntries.join(', ')} cannot be searched — fix or remove ${refusedEntries.length === 1 ? 'it' : 'them'}.`
        : null

  async function create() {
    if (unmet || busy) return
    setBusy(true)
    // Only what was actually filled in, plus the key when it was chosen rather than derived — the
    // server derives the same key from the same rule when none is sent.
    const body: Record<string, unknown> = { ...state.draft }
    if (keyEdited) body['key'] = keyEdited
    // THE ORGANISATION IT BELONGS TO. A company sits in exactly one, and the server needs to be told which
    // when the person creating it holds more than one. Sent whenever there is an answer, so the request
    // says what the screen showed.
    if (orgChosen) body['tenant'] = orgChosen
    // What the box was showing is what gets sent. Untouched, it was showing the name, and a box a person
    // read and accepted has to mean the same thing as a box they typed into.
    if (!namesTouched && typedName) body['selfExclusionOwners'] = [typedName]
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
    // Onward to New clearance — for a person who may start one. Manage and Run are separate switches, and
    // someone who may add companies but not run clearances would otherwise land on a page that does not
    // exist for them, straight after doing the one thing they came to do. They land on the new company's
    // profile instead, which is where its setting-up continues.
    ctx.go(canRun(ctx.me) ? '/portal/new' : '/portal/brand/profile')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result])

  const rejected = result && !isOk(result) && result.kind === 'reject' ? result.errors : null
  // The one refusal a person can be walked out of rather than left to re-read: the key is taken, and the
  // company that holds it is one they can open.
  const takenBy = result && !isOk(result) && result.kind === 'reject' && result.detail?.code === 'key_exists'
    ? result.detail.key
    : null
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

        {/* Asked only of a person who holds more than one organisation whole — the only case with a
            choice to make. Everyone else creates the company in the one organisation they hold. */}
        {orgsHeld.length > 1 ? (
          <div style={{ marginBottom: 8 }}>
            <label className="field-label" htmlFor="new-company-organisation">Organisation</label>
            <select
              id="new-company-organisation"
              className="ctx-input"
              value={org ?? ''}
              onChange={(e) => setOrg(e.target.value || null)}
            >
              <option value="">Choose one…</option>
              {orgsHeld.map((k) => (
                <option key={k} value={k}>{ctx.organisations.find((o) => o.key === k)?.name ?? k}</option>
              ))}
            </select>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 5 }}>
              A company belongs to exactly one organisation, and only people with access there can see it.
            </p>
          </div>
        ) : null}

        {rejected ? (
          <div className="empty" style={{ textAlign: 'left', marginBottom: 18 }} role="alert">
            <p style={{ fontWeight: 700, color: 'var(--text-strong)' }}>Nothing was created.</p>
            {rejected.map((e, i) => (
              <p key={i} style={{ color: 'var(--tone-high)' }}>{e}</p>
            ))}
            {takenBy ? (
              <button
                type="button"
                onClick={() => { ctx.setOwner(takenBy); ctx.go('/portal/brand/profile') }}
                style={{
                  background: 'none', border: 'none', padding: 0, font: 'inherit',
                  color: 'var(--text-accent)', cursor: 'pointer', textDecoration: 'underline',
                }}
              >
                Open that company
              </button>
            ) : null}
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
                    // The company's own name IS a trading name, and the reasoning reads that set as the
                    // company's own rights — so a company created without one is checked against itself
                    // and can come back as a conflict with its own mark. It follows the name rather than
                    // being posted invisibly, so somebody can see it and add the brands it trades under.
                    value={spec.key === 'selfExclusionOwners' && !namesTouched
                      ? typedName
                      : boxValue(state, spec)}
                    choices={null}
                    onChange={(v) => {
                      if (spec.key === 'selfExclusionOwners') setNamesTouched(true)
                      setState((st) => typeField(st, spec, v))
                    }}
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
  return (
    <section style={{ marginTop: 26 }}>
      <h2 style={{ fontSize: 15, margin: '0 0 8px', color: 'var(--text-strong)' }}>How matters are rated</h2>
      <div className="empty" style={{ textAlign: 'left' }}>
        <p style={{ margin: 0, color: 'var(--text-strong)' }}>The general risk framework.</p>
        <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>
          Every company starts here, and the receipt says which framework it was given. You can write
          your own rubric and point a company at it.
        </p>
        {/* One definition, shared with the profile screen: new tab, the anchor for the part about
            writing a framework, and a sentence naming the file when the repository cannot be resolved
            rather than nothing at all. */}
        <FrameworkGuideLink />
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
