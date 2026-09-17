// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The picker beside a list box — the owner's ask, answered per field rather than uniformly.
//
// TWO KINDS, AND THE ASYMMETRY IS THE POINT. `classes` is exclusive: Nice classes are 1–45 and nothing
// else, so a picker that offers only those removes nothing. `territories` is assistive: the
// engine deliberately carries a territory name it does not recognise (`scope-rules.mjs` keeps an unknown
// name's uppercased original; `products.mjs` clamps rather than refuses), so a picker that only permitted
// its own vocabulary would narrow what a client can express — on the setting that applies precisely when
// a request does NOT name territories. The box therefore stays free text and the picker only suggests.
// The full reasoning is on the issue; do not tighten the second one without the owner's word.
//
// IT EDITS THE RAW TEXT, never the draft. `toggleEntry` hands back a string and the screen feeds it to
// the same `onChange` the textarea uses, so `applyField` stays the one write path and the field notices
// keep reporting on exactly the text the user is looking at.
import { useId, useRef, useState } from 'react'
import { REGIONS, COUNTRIES, matchTerritoriesIn } from '../contract/composerProduct.ts'
import { chosenEntries, toggleEntry } from '../contract/profileFields.ts'
import type { FieldSpec } from '../contract/profileFields.ts'
import { classLabel, classMatches, isClassNumber } from '../contract/niceClasses.ts'
import { Icon } from './Icon.tsx'

/** No product context on a profile default, so the whole vocabulary — both tiers. */
const TERRITORIES: readonly string[] = [...REGIONS, ...COUNTRIES]

/** A territory the finder suggests. Chosen ones are chips of the same kind as the chosen classes. */
const suggestionStyle: React.CSSProperties = {
  cursor: 'pointer', fontSize: 12, padding: '2px 8px', borderRadius: 999,
  border: '1px solid var(--border-hairline)', background: 'var(--surface-raised)', color: 'var(--text-muted)',
}

export function FieldPicker({
  spec, value, onChange,
}: {
  readonly spec: FieldSpec
  /** The raw box text — the picker's chosen state is read from it, never held beside it. */
  readonly value: string
  readonly onChange: (next: string) => void
}) {
  const [query, setQuery] = useState('')
  const addId = useId()
  const addBox = useRef<HTMLInputElement | null>(null)
  if (!spec.picker) return null
  const chosen = chosenEntries(spec, value)
  const toggle = (e: string) => onChange(toggleEntry(spec, value, e))

  // THE SAME SEARCH BOX AS NEW CLEARANCE: the chosen classes as chips that say what each class IS, and a
  // box that finds one by number or by word. It replaced a grid of 45 bare numbers, which asked a reader
  // to already know that 32 is drinks — the question the hint's examples exist to answer. Still
  // exclusive (nothing outside 1–45 can be offered), and still one write path: a pick toggles the raw
  // text through `toggleEntry`, exactly as a press on the old grid did.
  if (spec.picker === 'classes') {
    const numbers = chosen.map(Number).filter(isClassNumber)
    const matches = classMatches(query, numbers)
    const add = (n: number) => { toggle(String(n)); setQuery('') }
    return (
      <div className="class-picker">
        {numbers.length ? (
          <div className="chip-row">
            {numbers.map((n) => (
              <span key={n} className="chip chip-own">
                {classLabel(n)}
                <button type="button" className="chip-x" aria-label={`Remove class ${n}`} onClick={() => toggle(String(n))}>
                  <Icon name="x" size={13} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        {/* A press on the words focuses THIS box. The project form draws the picker inside the <label> of
            its own box of numbers, and a label sends a press on any text inside it to that box instead. */}
        <div className="profile-field" onClick={(e) => { if (e.target !== addBox.current) { e.preventDefault(); addBox.current?.focus() } }}>
          <span className="profile-field-label" id={`${addId}-label`}>Add a class</span>
          <span className="profile-field-hint" id={`${addId}-hint`}>Type a number or a word, for example 25 or clothing</span>
          <div className="class-picker-box">
            <input
              ref={addBox}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              // Enter takes the first match, so a class typed by number never needs the mouse.
              onKeyDown={(e) => { if (e.key === 'Enter' && matches[0] !== undefined) { e.preventDefault(); add(matches[0]) } }}
              autoComplete="off"
              aria-labelledby={`${addId}-label`}
              aria-describedby={`${addId}-hint`}
              className="ctx-input"
            />
            {matches.length ? (
              <div className="typeahead">
                {matches.map((n) => (
                  <button key={n} type="button" onClick={() => add(n)}>{classLabel(n)}</button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
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
            <button key={t} type="button" onClick={() => { toggle(t); setQuery('') }} style={suggestionStyle}>
              + {t}
            </button>
          ))}
        </div>
      ) : null}
      {/* WHAT THE BOX HOLDS, including entries this vocabulary does not know — shown so an unrecognised
          territory is visibly kept rather than looking dropped because no chip lit up. */}
      {chosen.length ? (
        <div className="chip-row" style={{ marginTop: 8 }}>
          {chosen.map((t) => (
            <span key={t} className="chip chip-own">
              {t}
              <button type="button" className="chip-x" onClick={() => toggle(t)} aria-label={`Remove ${t}`}>
                <Icon name="x" size={13} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}
