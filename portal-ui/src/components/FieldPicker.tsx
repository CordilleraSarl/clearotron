// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The picker beside a list box — the owner's ask, answered per field rather than uniformly.
//
// TWO KINDS, AND THE ASYMMETRY IS THE POINT (, PR 2). `classes` is exclusive: Nice
// classes are 1–45 and nothing else, so offering all 45 removes nothing. `territories` is assistive: the
// engine deliberately carries a territory name it does not recognise (`scope-rules.mjs` keeps an unknown
// name's uppercased original; `products.mjs` clamps rather than refuses), so a picker that only permitted
// its own vocabulary would narrow what a client can express — on the setting that applies precisely when
// a request does NOT name territories. The box therefore stays free text and the picker only suggests.
// The full reasoning is on the issue; do not tighten the second one without the owner's word.
//
// IT EDITS THE RAW TEXT, never the draft. `toggleEntry` hands back a string and the screen feeds it to
// the same `onChange` the textarea uses, so `applyField` stays the one write path and the field notices
// keep reporting on exactly the text the user is looking at.
import { useState } from 'react'
import { REGIONS, COUNTRIES, matchTerritoriesIn } from '../contract/composerProduct.ts'
import { chosenEntries, toggleEntry } from '../contract/profileFields.ts'
import type { FieldSpec } from '../contract/profileFields.ts'

const CLASSES = Array.from({ length: 45 }, (_, i) => String(i + 1))
/** No product context on a profile default, so the whole vocabulary — both tiers. */
const TERRITORIES: readonly string[] = [...REGIONS, ...COUNTRIES]

const chipStyle = (on: boolean): React.CSSProperties => ({
  cursor: 'pointer', fontSize: 12, padding: '2px 8px', borderRadius: 999,
  border: `1px solid ${on ? 'var(--accent)' : 'var(--border-hairline)'}`,
  background: on ? 'var(--accent-wash)' : 'var(--surface-raised)',
  color: on ? 'var(--text-accent)' : 'var(--text-muted)',
})

export function FieldPicker({
  spec, value, onChange,
}: {
  readonly spec: FieldSpec
  /** The raw box text — the picker's chosen state is read from it, never held beside it. */
  readonly value: string
  readonly onChange: (next: string) => void
}) {
  const [query, setQuery] = useState('')
  if (!spec.picker) return null
  const chosen = chosenEntries(spec, value)
  const isOn = (e: string) => chosen.some((c) => c.trim().toLowerCase() === e.toLowerCase())
  const toggle = (e: string) => onChange(toggleEntry(spec, value, e))

  if (spec.picker === 'classes') {
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
        {CLASSES.map((c) => (
          <button key={c} type="button" onClick={() => toggle(c)} style={chipStyle(isOn(c))}
            aria-pressed={isOn(c)} aria-label={`Nice class ${c}`}>{c}</button>
        ))}
      </div>
    )
  }

  // Assistive: a search over the vocabulary, and nothing here can remove what the box holds.
  const suggestions = matchTerritoriesIn(TERRITORIES, query, chosen, 8)
  return (
    <div style={{ marginTop: 6 }}>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find a territory to add — or type your own above"
        aria-label="Find a territory"
        style={{
          width: '100%', padding: '6px 9px', borderRadius: 8, fontSize: 13,
          border: '1px solid var(--border-hairline)', background: 'var(--surface-sunken)',
          color: 'var(--text-strong)', fontFamily: 'inherit',
        }}
      />
      {suggestions.length ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
          {suggestions.map((t) => (
            <button key={t} type="button" onClick={() => { toggle(t); setQuery('') }} style={chipStyle(false)}>
              + {t}
            </button>
          ))}
        </div>
      ) : null}
      {/* WHAT THE BOX HOLDS, including entries this vocabulary does not know — shown so an unrecognised
          territory is visibly kept rather than looking dropped because no chip lit up. */}
      {chosen.length ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
          {chosen.map((t) => (
            <button key={t} type="button" onClick={() => toggle(t)} style={chipStyle(true)}
              aria-label={`Remove ${t}`}>{t} ×</button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
