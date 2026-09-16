// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// One field, rendered one way, wherever a profile field is edited.
//
// It was written twice — once on the profile screen and once on the project overlay — and creating a
// company would have made three. The issue this serves asks for the create form and the edit form to
// carry the same labels in the same order so the two cannot drift apart, and two renderers agreeing by
// inspection is not the same promise as one renderer. This is the same lesson the pick panel learned:
// the sentence that was wrong on four screens at once was wrong four times because it was written four
// times.
//
// The project overlay still has its own copy. It renders a DIFFERENT field set with an inherited-value
// state this one has no notion of, so folding it in is its own change rather than a rider on this one.
import type React from 'react'
import { CLEARED_LABEL, choiceLabel, fieldNotices, fieldTag } from '../contract/profileFields.ts'
import type { FieldSpec } from '../contract/profileFields.ts'
import { FieldNotices } from './FieldNotices.tsx'
import { FieldPicker } from './FieldPicker.tsx'

/**
 * "Required" or "Optional" beside a label, or nothing. Filled for the one kind a form cannot do without,
 * quiet for the other, so the eye finds the required field without reading every tag.
 */
export function FieldTag({ tag }: { readonly tag: 'Required' | 'Optional' | null }) {
  if (!tag) return null
  return <span className={tag === 'Required' ? 'field-tag field-tag-required' : 'field-tag'}>{tag}</span>
}

export function Field({
  spec,
  value,
  choices,
  onChange,
}: {
  readonly spec: FieldSpec
  readonly value: string
  /** null while the options are still loading, or if loading them failed. */
  readonly choices: readonly { readonly value: string; readonly label: string }[] | null
  readonly onChange: (v: string) => void
}) {
  const picker = spec.kind === 'choice' || spec.kind === 'boolean'
  // A paragraph gets a taller box than a list does. Both are textareas; only `lines` parses to an array.
  const multi = spec.kind === 'lines' || spec.kind === 'prose'
  // CLASSES ARE ADDED THROUGH THE SEARCH BOX AND SHOWN AS CHIPS, with no text box of numbers beside them.
  // The field is then NOT a <label>: a label forwards a press on its own text to the first control inside
  // it, and with no box that control is the first chip's remove button — so reading the field's name with
  // the mouse would have deleted a class.
  const classes = spec.picker === 'classes'
  const Wrapper = classes ? 'div' : 'label'
  return (
    <Wrapper className="profile-field">
      <span className="profile-field-label">
        {spec.label}
        <FieldTag tag={fieldTag(spec)} />
      </span>
      {spec.hint ? <span className="profile-field-hint">{spec.hint}</span> : <span className="profile-field-gap" />}
      {classes ? null : picker && choices?.length ? (
        <select value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
          {/* The cleared state is a real, choosable option, not the absence of a choice. Picking it
              sends "" — which the server reads as "unset this back to the Generic default" — rather than
              omitting the key, which it would read as "leave whatever is on disk alone". */}
          <option value="">{spec.clearedLabel ?? CLEARED_LABEL}</option>
          {choices.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      ) : picker ? (
        // Options unavailable: show what is set, as text. An empty dropdown would invite a person to
        // open it, find nothing, and conclude the setting is broken — and if they did manage to pick
        // the blank, they would clear a setting they only came to read. Same reasoning as the
        // NewClearance failure branch.
        //
        // What is NOT printed here is the raw stored value. For defaultProduct that is a registry
        // key (`prelim-jx`, `knockout-register`) whose display face is `stageLabel` — and this screen
        // is client-reachable, so the key is internal vocabulary leaking to a client. The labels
        // arrive over the wire with the options, so on the degraded path there is nothing to resolve
        // it against; say a value is set and say why its name is missing.
        <div style={{ ...inputStyle, color: value ? 'var(--text-strong)' : 'var(--text-muted)' }}>
          {value
            ? choiceLabel(spec, value) ?? 'Set — the options could not be loaded just now'
            : (spec.clearedLabel ?? CLEARED_LABEL)}
        </div>
      ) : multi ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={spec.kind === 'prose' ? 5 : 3} style={inputStyle} />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle} />
      )}
      {/* Derived from the RAW box contents, not from the saved draft: the point is the gap between what
          was typed and what will be stored, and after applyField that gap no longer exists to report. */}
      <FieldNotices notices={fieldNotices(spec, value)} />
      {/* The picker edits the same raw text the box does, so there is one write path and the notices
          above keep describing exactly what is in the box. */}
      <FieldPicker spec={spec} value={value} onChange={onChange} />
    </Wrapper>
  )
}

export const inputStyle: React.CSSProperties = {
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
