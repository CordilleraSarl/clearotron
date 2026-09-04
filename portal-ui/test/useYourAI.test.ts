// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The Use-your-AI page, after the ruthless cut.
//
// REPLACES `assistants.test.ts` and `assistantsDerived.test.ts`, whose subject — a client table and an
// offered/withheld derivation living in the browser — was DELETED, not moved. Those files asserted real
// properties and the properties survive; they are asserted where the behaviour now is:
//
//   · "every absence is NAMED with its reason"        → driver/test/connect-clients-are-data.test.mjs
//   · "no assistant is handed a door it cannot walk"  → same file, the per-host-shape arm
//   · the report-recipe PARITY                        → re-pointed below, page half moved to CONNECT.md
//   · "every allowance sentence is off the page"      → carried forward below, still a page property
//
// The one arm deliberately NOT carried is "the Connect buttons are DISABLED when nothing is wired". The
// ruling replaced that behaviour: a button that cannot work is not rendered as a button at all.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const SCREEN = read('../src/screens/UseYourAI.tsx')

/**
 * The page's source with its prose removed — the code a reader could end up seeing the output of.
 */
function code(src: string): string {
  const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, ' ')
  return noBlocks.split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n')
}

/**
 * WHAT A READER ACTUALLY SEES: JSX text and the string literals that become it.
 *
 * NOT every line of code, which is what this arm checked first — and it failed on `revealed.address`, a
 * property name no reader ever reads. A guard that cannot tell an identifier from a sentence forces the
 * next person to rename a variable to satisfy it, which teaches them the rule is arbitrary. Attribute
 * values (`style`, `className`, `href`) are stripped for the same reason: `--text-muted` is not prose.
 */
function readerText(src: string): string {
  let c = code(src)
  c = c.replace(/style=\{\{[\s\S]*?\}\}/g, ' ')          // style objects are not prose
  c = c.replace(/\b(className|href|rel|target|type|key)=(\{[^}]*\}|"[^"]*"|'[^']*')/g, ' ')
  // An interpolation is an EXPRESSION, not prose: `${r.value.address}` puts a property name inside a
  // template literal, and reading that as something the reader sees would force a rename to satisfy a
  // rule about English. The surrounding text is prose and is still checked.
  c = c.replace(/\$\{[^}]*\}/g, ' ')
  const out: string[] = []
  for (const m of c.matchAll(/>([^<>{}]+)</g)) out.push(m[1])                    // JSX text nodes
  for (const m of c.matchAll(/'([^'\n]{4,})'|`([^`\n]{4,})`/g)) out.push(m[1] ?? m[2] ?? '')
  return out.join('\n')
}

test('NOTHING TECHNICAL REACHES THE READER — the six words that may not appear, in any state', () => {
  // Owner, 2026-08-31: "there is NO PLACE for ANYTHING technical on there." The page this replaced said
  // "address" 47 times and "key" 31. A reader connecting their own assistant is not choosing a
  // transport or a scope, and every one of those words asked them to understand something the product
  // should be deciding for them.
  const text = readerText(SCREEN)
  assert.ok(text.includes('Use your own AI'), 'the extractor found no page text — it is asserting nothing')
  for (const word of ['MCP', 'connector', 'token', 'scope', 'address', 'key']) {
    const hits = text.split('\n').filter((l) => new RegExp(`\\b${word}\\b`, 'i').test(l))
    assert.deepEqual(hits, [], `the reader can see the word "${word}"`)
  }
})

test('THE PAGE DERIVES NOTHING — it holds no client table and no offered/withheld logic', () => {
  // The defect this closed: the browser held its own table on its own axis, and it disagreed with the
  // server's about whether Codex needs an address. Two tables partitioning the same clients cannot be
  // kept in step by hand — that is what the deleted `assistantsFor`/`addressFor` proved.
  for (const gone of ['assistantsFor', 'addressFor', 'signInSentence', 'contract/assistants']) {
    assert.ok(!SCREEN.includes(gone), `the page still reaches for ${gone}, which was deleted`)
  }
  // And it must not grow a replacement: no literal client name anywhere in the page's code.
  const c = code(SCREEN)
  for (const id of ['claude-code', 'codex', 'claude-desktop', 'cowork', 'chatgpt', 'perplexity']) {
    assert.ok(!c.includes(id), `the page names the client "${id}" — adding an assistant is a server-side row`)
  }
})

test('A BUTTON THAT CANNOT WORK IS NOT A BUTTON — it is a sentence, with a reason and a remedy', () => {
  // "It reads as unavailable with one plain sentence on why and what would change it, and it does not
  // expand into instructions for a thing that will not work." A disabled button invites a press that
  // teaches nothing; an absence with no reason reads as breakage.
  const unserved = SCREEN.slice(SCREEN.indexOf('if (!offer.served)'), SCREEN.indexOf('One press, and it degrades'))
  assert.ok(unserved.includes('offer.reason'), 'an unavailable assistant does not say why')
  assert.ok(unserved.includes('offer.fix'), 'an unavailable assistant does not say what would change it')
  assert.ok(!unserved.includes('<button'), 'an assistant that cannot work is still rendered as a button')
})

test('NOTHING IS EXPANDED ON ARRIVAL — the expansion opens only when a press cannot finish', () => {
  // "A reader who lands on the page sees four buttons and a list, never a wall of accordions."
  assert.match(SCREEN, /useState\(false\)/, 'the expansion has no closed initial state')
  assert.ok(!/useState\(true\)/.test(SCREEN), 'something on this page starts open')
  // And what opens is the remainder, not the recipe from the beginning.
  assert.ok(!/Settings → Connectors/.test(SCREEN), 'a per-assistant setup recipe crept back onto the page')
})

// ── item 3 — THE CLOSING PRESS SPENDS NOTHING ───────────────────────────────
//
// The toggle is fixed in the screen and nothing pinned it. Worth pinning for a reason the fix's own
// comment does not record: `press()` is also where an ADDRESS row MINTS, so before the fix a second
// press did not merely fail to collapse — it minted again on a press the reader made to put the panel
// AWAY. Re-minting itself is fine (owner ruling, 2026-09-03: a person may hold more than one key), which
// is exactly why this arm is about the CLOSING press and not about minting in general.
//
// Read off the close BRANCH by brace-matching, not by position. A first version of this looked for the
// next `return` after the close and compared it to the mint — green on a close that falls straight
// through, because `press()` has an earlier `return` inside its command branch that sits before the mint.
test('2143: the closing press collapses the row and returns before anything is minted', () => {
  const src = code(SCREEN)
  const press = src.slice(src.indexOf('const press = async ()'), src.indexOf('return (', src.indexOf('const press = async ()')))
  assert.ok(press.length > 100, 'press() was not found — this arm would assert nothing')
  assert.ok(press.includes('connectKey'), 'press() no longer mints — re-point this arm at wherever it does')

  const openAt = press.indexOf('if (open)')
  assert.ok(openAt > -1, 'press() never checks whether the row is already open, so it cannot close')
  const brace = press.indexOf('{', openAt)
  let depth = 0, end = brace
  for (let i = brace; i < press.length; i++) {
    if (press[i] === '{') depth++
    else if (press[i] === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  const closeBranch = press.slice(brace, end + 1)
  assert.ok(closeBranch.includes('setOpen(false)'), 'the close branch was not found — this arm asserts nothing')
  assert.match(closeBranch, /\breturn\b/,
    'the closing press falls through to the mint — putting the panel away spends a key')
})

test('#1938 every allowance sentence is still off the page', () => {
  // Carried forward from the deleted assistants.test.ts: "get rid of any other text — limits, caps etc.,
  // all gone". The sweep that closed it found TWO allowance sentences where the issue named one.
  for (const word of ['allowance', 'cap ', 'caps', 'limit', 'quota', 'per month']) {
    assert.ok(!new RegExp(word, 'i').test(readerText(SCREEN)), `an allowance sentence returned: "${word}"`)
  }
})

test('PARITY: the recipes the delivered report carries are the ones the hand-setup page carries', () => {
  // The page half of this parity MOVED rather than died. It used to join this screen's per-assistant
  // steps to `render.mjs`'s askAi band, so a reader who set up from a report and a reader who set up
  // from the portal followed the same instructions. The ruling took recipes off the page — they are now
  // reached through its one link — so the join is between the REPORT and the HAND-SETUP DOC.
  //
  // Deleting it instead would have been wrong: the report still carries recipes, so a join between two
  // surfaces that must agree still has two sides. Read off each file's source rather than a shared
  // helper, because `render.mjs` is byte-frozen at a content hash and exporting from it to import here
  // would move that hash for a test's convenience.
  const band = /steps\('Set up Claude'[\s\S]*?steps\('Set up ChatGPT'[^\n]*/.exec(read('../../driver/publish/render.mjs'))?.[0] ?? ''
  assert.ok(band, 'the report no longer carries its own set-up block — if so, this parity is moot and should be deleted')
  const doc = read('../../mcp-server/CONNECT.md')
  for (const [who, needle] of [
    ['Claude', 'Settings → Connectors → **Add custom connector**'],
    ['ChatGPT', 'Settings → Connectors → Advanced → **Developer mode**'],
  ] as const) {
    assert.ok(doc.includes(needle), `the hand-setup page no longer opens ${who}'s recipe the way the report does`)
    assert.ok(band.includes(needle.replace(/\*\*/g, '')), `the report's ${who} recipe drifted from the hand-setup page`)
  }
})

test('THE KEY NEVER REACHES STATE, A PROP OR THE DOM — except the one degraded path', () => {
  // Owner ruling 2026-08-31: "The page never shows a key, in any state", and the reason that shapes the
  // code — "a rendered key outlives the moment. It's in the DOM, in the screenshot someone takes, in the
  // browser cache, on a screen left open." So the minted value lives in one async function and is
  // dropped when it returns.
  const c = code(SCREEN)
  // FROM the press TO the render that follows it — `indexOf('return (')` alone finds the EARLY
  // return in the not-served branch, which sits above the press and would slice to nothing. The
  // anti-vacuity assert below caught exactly that rather than letting the arm pass over an empty
  // string, which is the whole reason it is there.
  const from = c.indexOf('const press = async')
  const press = c.slice(from, c.indexOf('return (', from))
  assert.ok(press.includes('api.connectKey()'), 'the press does not mint — this arm is asserting nothing')

  // Exactly ONE state setter may ever receive it, and it is the clipboard-refused path.
  const setters = [...press.matchAll(/set([A-Z]\w*)\(/g)].map((m) => m[1])
  const withKey = [...press.matchAll(/set([A-Z]\w*)\(([^)]*)\)/g)]
    .filter((m) => /\bkey\b/.test(m[2] ?? '')).map((m) => m[1])
  assert.ok(setters.length > 0, 'no state is set during a press — the extractor is wrong')
  assert.deepEqual(withKey, ['Revealed'],
    'a credential reaches state somewhere other than the clipboard-refused reveal')

  // And the reveal says it is a one-time thing, because it is: nothing stores it.
  assert.match(SCREEN, /will not be shown again/, 'the degraded reveal does not say it is one-time')
})

test('the copy helper reports a REFUSAL, so a blocked clipboard is not read as success', () => {
  // "Clipboard blocked → only then a one-time reveal." That branch is only reachable if the write's
  // failure is a value rather than a swallowed exception — a `catch {}` here would mean the page told a
  // reader it had copied something it had not, and the credential would be nowhere at all.
  const helper = SCREEN.slice(SCREEN.indexOf('async function copy('))
  assert.match(helper, /return true/, 'the copy helper never reports success')
  assert.match(helper, /catch \{ return false \}/, 'a refused clipboard is swallowed rather than reported')
})
