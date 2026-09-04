// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The unsaved-changes guard.
//
// The registry is a plain module, so unlike most of this suite these are real behavioural tests rather
// than source greps — `guard.ts` deliberately holds no React so it can be exercised directly. The two
// screen-side halves (the shell's two exits, and each screen passing its own `dirty`) are greps at the
// bottom, because those DO live in .tsx that this runner cannot mount.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerGuard, hasUnsaved, confirmDiscard, attachBeforeUnload } from '../src/state/guard.ts'

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')

test('nothing registered means nothing to lose', () => {
  assert.equal(hasUnsaved(), false)
})

test('a registered source is asked LIVE, not snapshotted at registration', () => {
  // The screens register once and then change on every keystroke. A registry that captured the value
  // instead of the function would answer with whatever was true the moment the screen mounted — always
  // "clean", which is silently no guard at all.
  let dirty = false
  const off = registerGuard(() => dirty)
  assert.equal(hasUnsaved(), false)
  dirty = true
  assert.equal(hasUnsaved(), true)
  off()
  assert.equal(hasUnsaved(), false, 'unregistering removes exactly that source')
})

test('any one dirty source is enough, and unmounting one does not clear another', () => {
  const offA = registerGuard(() => false)
  const offB = registerGuard(() => true)
  assert.equal(hasUnsaved(), true)
  offA()
  assert.equal(hasUnsaved(), true, 'B still holds work')
  offB()
  assert.equal(hasUnsaved(), false)
})

test('a checker that throws counts as dirty — an unanswerable question must not cost someone their work', () => {
  const off = registerGuard(() => {
    throw new Error('mid-render')
  })
  assert.equal(hasUnsaved(), true)
  off()
})

test('confirmDiscard does not prompt when there is nothing to lose', () => {
  let asked = 0
  const g = globalThis as unknown as { window?: unknown }
  const prior = g.window
  g.window = { confirm: () => { asked++; return false } }
  try {
    assert.equal(confirmDiscard(), true, 'a clean page leaves without a dialog')
    assert.equal(asked, 0)
    const off = registerGuard(() => true)
    assert.equal(confirmDiscard(), false, 'and honours a refusal when there IS something to lose')
    assert.equal(asked, 1)
    off()
  } finally {
    if (prior === undefined) delete g.window
    else g.window = prior
  }
})

test('beforeunload only objects when there is unsaved work', () => {
  const g = globalThis as unknown as { window?: unknown }
  const prior = g.window
  const handlers: Record<string, (e: unknown) => void> = {}
  g.window = {
    addEventListener: (n: string, fn: (e: unknown) => void) => { handlers[n] = fn },
    removeEventListener: (n: string) => { delete handlers[n] },
  }
  try {
    const detach = attachBeforeUnload()
    const fire = () => {
      let prevented = false
      handlers['beforeunload']?.({ preventDefault: () => { prevented = true }, returnValue: undefined })
      return prevented
    }
    assert.equal(fire(), false, 'a clean page reloads without a browser prompt')
    const off = registerGuard(() => true)
    assert.equal(fire(), true)
    off()
    detach()
    assert.equal(handlers['beforeunload'], undefined, 'detach removes the listener')
  } finally {
    if (prior === undefined) delete g.window
    else g.window = prior
  }
})

test('BOTH shell exits are guarded — the brand switcher is not a navigation', () => {
  // The reported bug was the switcher, not the menu. Guarding `go` alone would have left it wide open,
  // and it is the exit that looks least like leaving a page.
  const shell = src('shell/AppShell.tsx')
  assert.match(shell, /if \(!opts\?\.replace && !confirmDiscard\(/, 'in-app navigation asks first')
  assert.match(shell, /const setOwnerGuarded[\s\S]{0,200}confirmDiscard\('Switch brand owner\?'\)/,
    'and so does switching brand owner')
  assert.match(shell, /onChange=\{setOwnerGuarded\}/, 'the switcher is wired to the guarded setter')
  assert.match(shell, /setOwner: setOwnerGuarded/, 'and so is the copy handed to screens')
  assert.match(shell, /attachBeforeUnload\(\)/, 'reload, close and the Access logout link are covered')
})

test('a replace navigation does NOT prompt — those are the app correcting its own URL', () => {
  const shell = src('shell/AppShell.tsx')
  assert.match(shell, /!opts\?\.replace &&/, 'the exemption is on replace, not on everything')
})

test('every screen with an editable form registers, and reuses its own Save flag', () => {
  for (const [file, flag] of [
    ['screens/Profile.tsx', 'dirty'],
    ['screens/Projects.tsx', 'dirty'],
    ['screens/NewClearance.tsx', 'composerDirty'],
  ] as const) {
    const s = src(file)
    assert.match(s, new RegExp(`useUnsaved\\(${flag}\\)`), `${file} registers ${flag}`)
  }
  // Read-only screens must NOT register: a guard on a page with nothing to lose is a dialog that
  // teaches people to dismiss dialogs.
  for (const file of ['screens/GlobalConfig.tsx', 'screens/PeopleAccess.tsx', 'screens/Preferences.tsx',
    'screens/SavedSearches.tsx', 'screens/Clearances.tsx', 'screens/Result.tsx', 'screens/UseYourAI.tsx']) {
    assert.doesNotMatch(src(file), /useUnsaved\(/, `${file} has nothing to lose and must not prompt`)
  }
})

test('the composer stands down once the run is submitted', () => {
  // Otherwise "Start another" and "View in Clearances" would both prompt about a draft that has already
  // been sent — the one moment on that screen when there is genuinely nothing left to lose.
  assert.match(src('screens/NewClearance.tsx'), /submitted == null &&\s*JSON\.stringify\(draft\)/)
})

test('useLoad clears on a DEPS change and keeps data across a reload', () => {
  // Two failures, one line apart in the source, and they pull in opposite directions.
  //
  // Not clearing on a deps change is the reported bug: switch brand owner and the previous owner's data
  // stays fully painted for the whole in-flight window, because every screen gates on `result` and not
  // on `loading`. Clearing on EVERY run would be worse — `nonce` drives the 5-second poll, so every list
  // in the app would blank itself twice a minute. The fix has to tell those two apart.
  const s = src('state/useApi.ts')
  assert.match(s, /const depsKey = JSON\.stringify\(deps\)/, 'deps are compared by value, not by identity')
  assert.match(s, /seenKey\.current !== null && seenKey\.current !== depsKey\) setResult\(null\)/,
    'a different question clears the old answer')
  assert.match(s, /\}, \[depsKey, nonce\]\)/, 'and a reload re-runs without clearing')
})

test('account-scoped screens are keyed on the brand owner', () => {
  // The other half of the same bug: the fetch swapped, the local state did not. Keying resets every
  // useState in the subtree, which fixes the class rather than four instances of it.
  const m = src('main.tsx')
  assert.match(m, /const ownerKey = \(ctx: ShellContext\) => `\$\{ctx\.owner \?\? '\*'\}#\$\{ctx\.visit\}`/)
  for (const screen of ['Clearances', 'Profile', 'Projects', 'SavedSearches']) {
    assert.match(m, new RegExp(`<${screen}\\s+key=\\{ownerKey\\(ctx\\)\\}`), `${screen} is keyed on the owner`)
  }
  assert.match(m, /key=\{`\$\{ownerKey\(ctx\)\}::\$\{new URLSearchParams/,
    'the composer keys on owner AND the edited search — both change its identity')
  // Deployment- and browser-scoped screens must NOT be keyed: remounting them on a brand switch would
  // throw away state that has nothing to do with the brand owner.
  for (const screen of ['UseYourAI', 'Preferences', 'GlobalConfig', 'PeopleAccess']) {
    assert.doesNotMatch(m, new RegExp(`<${screen}\\s+key=`), `${screen} is not account-scoped`)
  }
})

test('Result is keyed on the RUN, because it is not account-scoped', () => {
  // RESULT USED TO BE IN THE LIST ABOVE, and that was the bug rather than the fix.
  //
  // It fetched `api.runs(ctx.owner ?? …)` and looked the run up in whatever came back, so selecting a
  // brand owner could make an OPEN report vanish — a `generic` run is in no account-scoped answer, and
  // the switcher is not a statement about which report you are reading. It now asks `runsMine()`, the
  // same question Clearances asks, so the list and the screen can no longer disagree about what exists.
  //
  // Once the data stopped depending on the owner, keying on it was left over: it remounted an open
  // report on every switcher touch, throwing away the measured frame height and reloading the document
  // for nothing. The run id is the identity that matters — moving between reads of a mark SHOULD
  // remount, so the frame re-measures instead of inheriting the previous document's height.
  //
  // #1921 — AND ON THE MARK, when the URL names one. The identity is the DOCUMENT being read, and a
  // knockout's names are several documents under one run id: without the slug in the key, moving from
  // one name to the next reconciles in place and the new document inherits the height measured for the
  // old one. Same rule as the sentence above, applied to the second argument the route now takes.
  const m = src('main.tsx')
  assert.match(m, /<Result\s+key=\{`\$\{runId\}\/\$\{markSlug \?\? ''\}#\$\{ctx\.visit\}`\}/,
    'keyed on the run and the mark, plus the visit counter')
  assert.doesNotMatch(m, /<Result\s+key=\{ownerKey\(ctx\)\}/, 'and NOT on the brand owner')
  // The fetch is the other half of the same rule — a Result that went back to an account-scoped read
  // would re-open the gap even with the key fixed.
  assert.match(src('screens/Result.tsx'), /useLoad\(\(\) => api\.runsMine\(\), \[\]\)/,
    'Result resolves a run from every account the identity holds, never from the selected owner')
})

test('going to the screen you are already on is a real reset', () => {
  // "New clearance" pressed from a finished clearance did nothing: the URL was byte-identical, so the
  // router bailed out of setLoc, and the composer's key was '' before and '' after. The user sat on
  // "Clearance started" until they navigated away and back. A visit counter folded into the key makes
  // the repeat a distinct mount, for every screen rather than only the one that was reported.
  const shell = src('shell/AppShell.tsx')
  assert.match(shell, /if \(next === loc && !opts\?\.replace\) setVisit\(\(n\) => n \+ 1\)/,
    'only a REPEAT bumps it — bumping on every navigation would remount screens for nothing')
  assert.match(shell, /readonly visit: number/, 'and it reaches the screens through the shell context')
  assert.match(src('main.tsx'), /#\$\{ctx\.visit\}/, 'folded into the key')
})
