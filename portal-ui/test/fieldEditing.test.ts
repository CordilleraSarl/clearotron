// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// fieldEditing.test.ts —. The list fields, typed the way a person types them.
//
// WHY THIS FILE EXISTS AND WHAT IT ADMITS. This page shipped with the portal suite green at 491 arms and
// failed the owner's use inside thirty seconds: he typed "US" then a space then "France" and the box
// showed, and accepted, the single chip "USFrance". Every arm here tests the CONTRACT — what a parser
// returns for a whole string — and no arm typed. A field is not used by handing it a finished string; it
// is used one character at a time, and the defect lived entirely in what happens between characters.
//
// This package cannot mount the screens: `node --test` with Node's type stripping has no JSX transform
// and no DOM, so `.tsx` cannot be imported at all (screenCopy.test.ts sets out the same limit). So the
// seam is the honest answer rather than the fallback — `typeField` and `boxValue` ARE the transition the
// screen runs on every keystroke, and the loop below is a controlled input's semantics exactly: show a
// value, let the user append at the caret, hand the whole box contents back. What is NOT proved here is
// the wiring — that Profile.tsx and Projects.tsx call these and not the old round trip. profileScreens
// .test.ts pins that separately, and it is named there as a source assertion so nobody mistakes it for
// this.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  PROFILE_FIELDS, boxValue, typeField, fieldInput, applyField, fieldNotices,
  type FormEdit, type FieldSpec,
} from '../src/contract/profileFields.ts'

const spec = (key: string): FieldSpec => {
  const f = PROFILE_FIELDS.find((x) => x.key === key)
  assert.ok(f, `${key} is a rendered field`)
  return f
}

const EMPTY: FormEdit = { draft: {}, edits: {} }

/** Type `text` one character at a time, as a controlled input receives it. */
function type(spec: FieldSpec, text: string, from: FormEdit = EMPTY): FormEdit {
  let state = from
  for (const ch of text) state = typeField(state, spec, boxValue(state, spec) + ch)
  return state
}

/**
 * The SAME keystrokes through the round trip the screens used to do — box value re-derived from the
 * parsed draft every time. Kept, and asserted on, so this file proves it can SEE the defect it was
 * written for: an arm that only ever runs the fixed path is green whether or not it tests anything.
 */
function typeThroughTheOldRoundTrip(spec: FieldSpec, text: string): string {
  let draft: Record<string, unknown> = {}
  let shown = ''
  for (const ch of text) {
    draft = applyField(draft, spec, shown + ch)
    shown = fieldInput(draft, spec)
  }
  return shown
}

test('1996: the defect, reproduced — the old round trip eats the space as it is typed', () => {
  assert.equal(typeThroughTheOldRoundTrip(spec('defaultJurisdictions'), 'US France'), 'USFrance',
    "the owner's screen: a trimmed re-render drops the space, so the next character lands against the last word")
  assert.equal(typeThroughTheOldRoundTrip(spec('platforms'), 'amazon.com\nwalmart.com'), 'amazon.comwalmart.com',
    'and the newline the hint promises is dropped as an empty entry, so Enter does nothing')
  // EVERY space, not just one: a space is always trailing at the instant it is typed, so the trim on the
  // next re-render takes it. Measured, not predicted — this arm was first written expecting one loss.
  assert.equal(typeThroughTheOldRoundTrip(spec('riskAppetite'), 'Be cautious. Lead with risk.'),
    'Becautious.Leadwithrisk.', 'prose is trimmed too, so it cannot hold a space the user just typed')
})

test('1996: a space survives being typed, on every list field', () => {
  for (const key of ['defaultJurisdictions', 'platforms', 'selfExclusionOwners', 'matchDomains']) {
    const s = type(spec(key), 'US France')
    assert.equal(boxValue(s, spec(key)), 'US France', `${key}: the box shows what was typed`)
  }
  const s = type(spec('defaultJurisdictions'), 'US France')
  assert.deepEqual(s.draft.defaultJurisdictions, ['US France'],
    'and it parses as ONE entry — a space is not a separator, which is the picker\'s job to fix, not the box\'s')
})

test('1996: a newline survives, and separates — the hint stops being a false promise', () => {
  const s = type(spec('platforms'), 'amazon.com\nwalmart.com')
  assert.equal(boxValue(s, spec('platforms')), 'amazon.com\nwalmart.com', 'the box holds both lines')
  assert.deepEqual(s.draft.platforms, ['amazon.com', 'walmart.com'], 'and stores two marketplaces')
})

test('1996: prose keeps a trailing space, so a sentence can be typed', () => {
  const s = type(spec('riskAppetite'), 'Be cautious. Lead with risk.')
  assert.equal(boxValue(s, spec('riskAppetite')), 'Be cautious. Lead with risk.')
  assert.equal(s.draft.riskAppetite, 'Be cautious. Lead with risk.')
})

test('1996: a comma inside one entry is not a separator on a field that did not opt in', () => {
  const s = type(spec('selfExclusionOwners'), 'Smith, Jones & Co')
  assert.equal(boxValue(s, spec('selfExclusionOwners')), 'Smith, Jones & Co')
  assert.deepEqual(s.draft.selfExclusionOwners, ['Smith, Jones & Co'],
    'one trading name, not two — the case FieldSpec.commaSeparated exists for')
})

test('1996: paste — one change carrying the whole string, not a keystroke', () => {
  const s = typeField(EMPTY, spec('defaultJurisdictions'), 'US, France, Germany')
  assert.equal(boxValue(s, spec('defaultJurisdictions')), 'US, France, Germany', 'the pasted text stays as pasted')
  assert.deepEqual(s.draft.defaultJurisdictions, ['US', 'France', 'Germany'])
})

test('1996: the notices see the RAW text again, which is what makes Check able to say anything', () => {
  // fieldNotices' own header says it reports on the raw text "because the whole question is what the gap
  // between them was". Fed a re-derived value there is no gap by construction — the reason a garbage
  // entry still reported OK.
  const dom = spec('matchDomains')
  const typed = type(dom, 'acme.example not a domain')
  const notices = fieldNotices(dom, boxValue(typed, dom))
  assert.equal(notices.length, 1, 'the malformed entry is reported')
  assert.equal(notices[0]!.tone, 'check')
  assert.match(notices[0]!.message, /not a domain/, 'and it names what to look at')

  // Through the old round trip the same typing produced a different string, so the notice described
  // something the user had not typed.
  assert.notEqual(typeThroughTheOldRoundTrip(dom, 'acme.example not a domain'), 'acme.example not a domain')

  const juris = spec('defaultJurisdictions')
  const pasted = typeField(EMPTY, juris, 'US, France')
  assert.match(fieldNotices(juris, boxValue(pasted, juris))[0]!.message, /2 separate entries/,
    'and a reshape is reported against what was actually typed')
})

test('1996: an untouched field renders from the draft, and a reseed drops what was typed', () => {
  const loaded: FormEdit = { draft: { platforms: ['amazon.com'] }, edits: {} }
  assert.equal(boxValue(loaded, spec('platforms')), 'amazon.com', 'untouched fields show the stored value')

  const typed = type(spec('platforms'), '\nwalmart.com', loaded)
  assert.equal(boxValue(typed, spec('platforms')), 'amazon.com\nwalmart.com')

  const reseeded: FormEdit = { draft: typed.draft, edits: {} }
  assert.equal(boxValue(reseeded, spec('platforms')), 'amazon.com\nwalmart.com',
    'after a save the box renders the stored value again, not the keystrokes')
})

// ── the wiring, as a SOURCE assertion ────────────────────────────────────────────────────────────────
// Weaker than everything above and deliberately so: this proves a string is in a file, not that a screen
// renders. It exists because the seam is only worth having if the screens use it, and no test in this
// runner can mount a `.tsx`. What it catches is the edit a reviewer makes in good faith — restoring
// `fieldInput(draft, spec)` as the box value because it looks like the simpler expression.
const screen = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../src/screens/${name}`, import.meta.url)), 'utf8')

test('1996: both forms render the editable box from what was typed, and reseed on load', () => {
  for (const name of ['Profile.tsx', 'Projects.tsx']) {
    const src = screen(name)
    assert.match(src, /value=\{boxValue\(\{ draft, edits \}, spec\)\}/,
      `${name}: the box renders from the typed text`)
    assert.doesNotMatch(src, /value=\{fieldInput\(draft, spec\)\}/,
      `${name}: the parse-then-format round trip is what ate the owner's spaces`)
    assert.match(src, /setEdits\(\(e\) => \(\{ \.\.\.e, \[spec\.key\]: raw \}\)\)/,
      `${name}: every edit keeps the raw text`)
    assert.match(src, /setEdits\(\{\}\)/, `${name}: a reseed drops it, so a saved form shows the server's values`)
  }
  // Projects renders the INHERITED value beside the box, and that one is not editable — it must keep
  // deriving from the customer's stored profile.
  assert.match(screen('Projects.tsx'), /inherited=\{fieldInput\(detail\.inherited, spec\)\}/,
    'the inherited column still renders the stored value it describes')
})
