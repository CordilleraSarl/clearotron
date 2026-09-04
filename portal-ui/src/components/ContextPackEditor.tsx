// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The context pack editor — one control, used at both levels.
//
// A context pack is background a clearance reads before it writes: competitors to watch, recurring
// concerns, lessons from past matters. Facts and concerns, never rules — it shapes what a report
// emphasises and never what a finding is rated, and the engine's validator refuses decision-rule
// phrasing outright.
//
// SHARED BECAUSE THERE ARE TWO OF THEM AND THEY MUST NOT DRIFT. The brand owner has a pack; so does each
// project, and the project's wins outright when present. They are the same field with the same limit and
// the same warning, so a second hand-rolled copy would be two places to fix the character budget and two
// chances to describe the same thing differently to the same person on adjacent screens.

const CHAR_MAX = 8000

export { CHAR_MAX as CONTEXT_PACK_MAX }

export function ContextPackEditor({
  value, onChange, title, hint, rows = 8,
}: {
  readonly value: string
  readonly onChange: (v: string) => void
  readonly title: string
  readonly hint: string
  readonly rows?: number
}) {
  const over = value.length > CHAR_MAX
  return (
    <div style={{ marginTop: 26 }}>
      <div className="eyebrow">{title}</div>
      <label style={{ display: 'block', marginTop: 14 }}>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '2px 0 7px' }}>{hint}</div>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          data-anon="mark"
          className="ctx-input"
          style={{ width: '100%', resize: 'vertical', lineHeight: 1.5 }}
        />
      </label>
      {/* The budget is stated always, not only when it is breached: someone pasting a deck needs to see
          the ceiling coming rather than meet it as a refusal. */}
      <div style={{ marginTop: 6, fontSize: 12, color: over ? 'var(--tone-high)' : 'var(--text-muted)' }}>
        {value.length.toLocaleString()} / {CHAR_MAX.toLocaleString()} characters
        {over ? ' — too long to save. Curate it: a big pack dilutes the priors that matter.' : ''}
      </div>
    </div>
  )
}
