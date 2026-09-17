// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Preferences: the blur a reload keeps, the eye button it shares with the top bar, and the route to an
// administrator.
//
// The blur's memory is DRIVEN: the three stored states and a browser whose localStorage throws are all
// states of data, and a source match could not tell them apart. What is structural — that the shell
// restores and mirrors one state, and that Preferences binds the top bar's own button to it — is read from
// the source, commentary stripped, because this runner cannot mount a `.tsx`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BLUR_KEY, readBlurChoice, writeBlurChoice, type ChoiceStore } from '../src/state/blurChoice.ts'
import { prose } from './support/prose.ts'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const flat = (s: string) => s.replace(/\s+/g, ' ')
const SHELL = flat(prose(read('../src/shell/AppShell.tsx')))
const PREFERENCES = flat(prose(read('../src/screens/Preferences.tsx')))

/** A browser's storage, held in a map, with the map exposed so a test can see what was written. */
function browserStorage(seed: Readonly<Record<string, string>> = {}) {
  const held = new Map(Object.entries(seed))
  const store: ChoiceStore = {
    getItem: (k) => held.get(k) ?? null,
    setItem: (k, v) => { held.set(k, v) },
  }
  return { store: () => store, held }
}

// ── the choice, remembered ─────────────────────────────────────────────────────────────────────────

test('nothing stored starts off, stored off starts off, and stored on starts blurred', () => {
  assert.equal(readBlurChoice(browserStorage().store), false, 'a browser that never chose starts blurred')
  assert.equal(readBlurChoice(browserStorage({ [BLUR_KEY]: 'off' }).store), false)
  assert.equal(readBlurChoice(browserStorage({ [BLUR_KEY]: 'on' }).store), true, 'a blur turned on did not survive the reload')
})

test('turn it on, reload, and it is on; turn it off, reload, and it is off', () => {
  const browser = browserStorage()
  writeBlurChoice(browser.store, true)
  assert.equal(readBlurChoice(browser.store), true, 'the reload during a screen share brought the names back')
  writeBlurChoice(browser.store, false)
  assert.equal(readBlurChoice(browser.store), false)
  assert.deepEqual([...browser.held.keys()], [BLUR_KEY], 'the choice is one key of its own, beside the theme rather than inside it')
})

test('a value this never writes is not taken for "on"', () => {
  // A blur is turned on by a person. A stray `true` from some other script, or a hand-edited value, must
  // not open the page blurred — the reader would think the portal had lost their names.
  for (const stray of ['true', '1', 'ON', 'yes', '']) {
    assert.equal(readBlurChoice(browserStorage({ [BLUR_KEY]: stray }).store), false, `${JSON.stringify(stray)} opened the page blurred`)
  }
})

test('a browser where localStorage throws starts off, and pressing the eye still does not throw', () => {
  // A null-origin or sandboxed document throws on READING the global itself, before any call.
  const refusing = (): ChoiceStore => { throw new DOMException('The operation is insecure.', 'SecurityError') }
  assert.equal(readBlurChoice(refusing), false)
  assert.doesNotThrow(() => writeBlurChoice(refusing, true), 'a refused write took the press down with it')
  // A reachable store that refuses every call: private mode, a full quota.
  const broken: ChoiceStore = {
    getItem: () => { throw new Error('denied') },
    setItem: () => { throw new Error('quota exceeded') },
  }
  assert.equal(readBlurChoice(() => broken), false)
  assert.doesNotThrow(() => writeBlurChoice(() => broken, true))
})

test('THE SHELL RESTORES THE CHOICE, MIRRORS IT, AND HANDS SCREENS THE ONE STATE', () => {
  assert.match(SHELL, /const \[anon, setAnon\] = useState\(\(\) => readBlurChoice\(\(\) => localStorage\)\)/,
    'the blur state no longer starts from what this browser remembered')
  assert.doesNotMatch(SHELL, /const \[anon, setAnon\] = useState\(false\)/, 'the blur is a constant again, so a reload clears it')
  // Written from the effect that applies the class, so whichever button changed the state, storage follows.
  assert.match(SHELL, /classList\.toggle\('anon-on', anon\) writeBlurChoice\(\(\) => localStorage, anon\) \}, \[anon\]\)/,
    'the choice is applied but not mirrored into this browser')
  assert.match(SHELL, /blurNames: anon, setBlurNames: setAnon/, 'screens are not handed the blur state')
})

test('PREFERENCES DRAWS THE TOP BAR\'S EYE BUTTON, bound to the same state, with no label or badge', () => {
  const top = /<button type="button" className="([^"]+)" aria-pressed=\{anon\} aria-label="([^"]+)" title="[^"]+" onClick=\{[^}]+\} > <Icon name=\{anon \? '([^']+)' : '([^']+)'\} \/> <\/button>/.exec(SHELL)
  assert.ok(top, 'the top bar\'s eye button could not be read, so nothing below compares against it')
  const [, cls, label, pressedIcon, icon] = top
  const mine = /<button type="button" className="([^"]+)" aria-pressed=\{ctx\.blurNames\} aria-label="([^"]+)" title="[^"]+" onClick=\{\(\) => ctx\.setBlurNames\(!ctx\.blurNames\)\} > <Icon name=\{ctx\.blurNames \? '([^']+)' : '([^']+)'\} \/> <\/button>/.exec(PREFERENCES)
  assert.ok(mine, 'Preferences no longer draws an eye button bound to the shell\'s blur state — its own copy would disagree after one press')
  assert.deepEqual(mine.slice(1), [cls, label, pressedIcon, icon],
    'the Preferences eye button is not the top bar\'s: a different class, label or icon is a second control, not the same one')
})

test('NO SENTENCE ON PREFERENCES SAYS THE BLUR IS NOT KEPT', () => {
  // The choice is remembered now, so a sentence saying it is not would be false on the one page a reader
  // opens to find out. The notice that said so is gone, and the card's last sentence says what is true.
  assert.doesNotMatch(PREFERENCES, /not kept|starts switched off|until you reload|every time you open|brings the names back|These two settings stay/i)
  assert.match(PREFERENCES, /It stays as you left it on this computer\./, 'the card no longer says the choice is kept')
  assert.match(PREFERENCES, /On the top bar\. It covers every mark and company on screen, and an open report whole\./)
})

// ── the route to an administrator ──────────────────────────────────────────────────────────────────

test('the administrator line names the role, links it only when the installation names a contact', () => {
  assert.match(PREFERENCES,
    /To change the address, the permissions or the companies on it, contact your \{administrator\}\./)
  // Both branches, from the one value the server sent: a link to it, or the same words as plain text.
  assert.match(PREFERENCES, /const contact = ctx\.me\.administratorContact/)
  assert.match(PREFERENCES, /const administrator = contact \? \( <a className="pref-link" href=\{contact\}[^>]*> Clearotron administrator <\/a> \) : \( 'Clearotron administrator' \)/,
    'the words are not a link to the contact when there is one, and plain when there is not')
  // The operator's name is no longer used in this sentence.
  assert.doesNotMatch(PREFERENCES, /operatorName\(/, 'the line names the operator again')
})
