// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The screen a person meets when no company is chosen yet.
//
// ── WHAT WAS HERE BEFORE ────────────────────────────────────────────────────────────────────────────
//
// Four screens refused to render and printed a notice: "Choose a company first. Pick one at the top
// left." It named a concept it did not explain, pointed away from itself at a control that is not on
// screen when the rail is collapsed, and offered nothing to do. An outside user read it, did not know
// what a company was or where "top left" was, gave up, and edited the configuration files instead.
//
// So the page does the work itself: it lists what there is to pick, each entry carrying enough to tell
// it from the next, and it carries the way to make a new one.
//
// ── ONE COMPONENT, FOUR SCREENS ─────────────────────────────────────────────────────────────────────
//
// The sentence it replaces was written out four times, which is how four copies came to be wrong
// together. Only the heading and its one line differ per screen, and they are passed in; everything
// below is identical by construction rather than by discipline. A fifth screen inherits the fix.

import { Icon } from '../components/Icon.tsx'
import type { CompanyFacts } from '../contract/companyFacts.ts'
import type { Role } from '../contract/api.ts'
import { pickerRows, GENERIC_KEY, type CompanyRow } from './companyRows.ts'
import { canManage } from './permissions.ts'

export { pickerRows, GENERIC_KEY }

/**
 * One company, as a card.
 *
 * THE WHOLE CARD IS THE CONTROL. A button inside a row that is already a button gives a reader two
 * targets for one decision and a keyboard user two stops; the arrow is decoration and says so.
 */
function CompanyCard({ row, onPick }: { readonly row: CompanyRow; readonly onPick: () => void }) {
  return (
    <button
      type="button"
      className={row.generic ? 'entry-card pick-generic' : 'entry-card'}
      onClick={onPick}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 16, padding: '15px 17px' }}
    >
      <span style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
        <span className="entry-title" style={{ display: 'block', marginBottom: 2 }}>{row.name}</span>
        {/* One line, clipped rather than wrapped: a stored industry is free prose and can run to a
            paragraph, and a card that grows to fit one company stops being scannable against the next. */}
        <span
          className="entry-body"
          style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {row.line}
        </span>
      </span>
      <span aria-hidden="true" style={{ flex: 'none', color: 'var(--text-faint)', display: 'inline-flex' }}>
        <Icon name="arrow-right" size={17} />
      </span>
    </button>
  )
}

export function CompanyPicker({
  eyebrow,
  heading,
  line,
  keys,
  companyName,
  factsFor,
  role,
  onPick,
  onAdd,
}: {
  readonly eyebrow: string
  readonly heading: string
  /** What picking a company gets you, on THIS screen. One line; the panel explains nothing else. */
  readonly line: string
  readonly keys: readonly string[]
  readonly companyName: (key: string | null) => string
  readonly factsFor: (key: string) => CompanyFacts | undefined
  readonly role: Role
  readonly onPick: (key: string) => void
  /** Absent ⇒ no create control. Someone without Manage never gets one. */
  readonly onAdd?: (() => void) | undefined
}) {
  const rows = pickerRows(keys, companyName, factsFor, role)

  return (
    <div className="screen">
      <div className="eyebrow">{eyebrow}</div>
      <div className="measure">
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20, margin: '4px 0 18px' }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: 27, margin: '0 0 4px', color: 'var(--text-strong)' }}>{heading}</h1>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 14.5 }}>{line}</p>
          </div>
          {onAdd ? (
            <button
              type="button"
              className="start-pill"
              onClick={onAdd}
              style={{ flex: 'none', borderColor: 'var(--accent-ink)', color: 'var(--text-accent)', fontWeight: 700 }}
            >
              + New company
            </button>
          ) : null}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map((r) => (
            <CompanyCard key={r.key} row={r} onPick={() => onPick(r.key)} />
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * The panel, wired to the shell — the form every screen actually uses.
 *
 * Everything except the two strings comes off the context, so a screen cannot pass a different company
 * list, a different name resolver or a different role test than the rail is using. That is the whole
 * reason the four call sites are one line each: the last version of this was a paragraph of JSX
 * repeated four times, and all four copies were wrong together.
 *
 * `+ New company` is shown to people who may MANAGE — add companies, add people, change settings —
 * and opens the create screen, which is level 2 and lands with it. The control asks the permission
 * rather than the role word: the role is what the wire happens to carry today, the permission is
 * what the product means. `shell/permissions.ts` holds the one derivation.
 */
export function CompanyGate({
  ctx,
  eyebrow,
  heading,
  line,
}: {
  readonly ctx: {
    readonly me: { readonly role: Role }
    readonly ownerKeys: readonly string[]
    readonly ownerName: (key: string | null) => string
    readonly factsFor: (key: string) => CompanyFacts | undefined
    readonly setOwner: (owner: string | null) => void
    readonly go: (path: string) => void
  }
  readonly eyebrow: string
  readonly heading: string
  readonly line: string
}) {
  return (
    <CompanyPicker
      eyebrow={eyebrow}
      heading={heading}
      line={line}
      keys={ctx.ownerKeys}
      companyName={ctx.ownerName}
      factsFor={ctx.factsFor}
      role={ctx.me.role}
      onPick={(key) => ctx.setOwner(key)}
      onAdd={canManage(ctx.me) ? () => ctx.go(NEW_COMPANY_PATH) : undefined}
    />
  )
}

/**
 * Where the create screen lives. Level 2 registers it; this is the one place naming the path, so the
 * two halves cannot disagree about it.
 *
 * The route stays in the existing `/portal/brand/*` family deliberately: the rename this change makes
 * is to what a READER sees, and screen ids and routes are explicitly not part of it.
 */
export const NEW_COMPANY_PATH = '/portal/brand/new'
