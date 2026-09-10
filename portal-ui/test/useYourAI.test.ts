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

test('AN UNSERVED ROW DOES NOT RENDER FOR A CLIENT AT ALL — not a button, not a sentence', () => {
  // THIS ARM USED TO REQUIRE THE SENTENCE. It asserted that an unavailable assistant rendered as prose
  // with a reason and a remedy, which was right until the owner ruled otherwise:
  // an unserved row does not render for a client at all.
  //
  // The measurement behind that ruling is why it matters. On a HEALTHY hosted install the three stdio
  // rows resolve `served: false` carrying "this copy of the software is incomplete… whoever installed it
  // will need to install it again". Those strings are the OPERATOR's case — correct for somebody whose
  // disk route is genuinely missing — reused for a reader who simply has no shell. So the sentence this
  // arm used to require was itself the defect: a lawyer opened the page and read that their software
  // needed reinstalling.
  //
  // The wording stays correct where it is true, and a client never reaches it because a client never
  // sees the row.
  const c = code(SCREEN)
  assert.match(c, /\.filter\(\(o\)\s*=>\s*o\.served\)/,
    'the page no longer filters to served offers, so an unserved row can reach the reader');
  // Filtered BEFORE anything reasons about routes or selection, so no later branch can render one by
  // accident. Both derivations must sit downstream of the filter.
  const servedAt = c.indexOf('.filter((o) => o.served)')
  for (const later of ['const routes', 'const here']) {
    assert.ok(c.indexOf(later) > servedAt,
      `${later} is derived before unserved rows are removed — it can still see them`)
  }
  assert.ok(!/offer\.reason|offer\.fix/.test(c),
    'the operator-shaped reason/fix wording is being rendered again on a surface a client reads')
})

test('THE ONE HONEST UNAVAILABLE SURVIVES — a deployment that serves nothing says so, and names who can fix it', () => {
  // The ruling removed the PER-ROW absence, not the deployment-level one. An absence that names nobody
  // reads as breakage, so this sentence is kept and it is about the installation rather than the reader.
  // WHITESPACE-NORMALISED, because JSX wraps prose across source lines and a reader sees one sentence.
  // Matching the raw file would pin the line breaks rather than the copy, and would fail the next time
  // somebody reflowed a paragraph without changing a word of it.
  const prose = SCREEN.replace(/\s+/g, ' ')
  assert.match(prose, /Not available on this installation yet/)
  assert.match(prose, /Whoever installed it can put it online/,
    'the unavailable state does not say who can change it')
  assert.match(code(SCREEN), /!served\.length/, 'the deployment-level absence is not gated on serving nothing')
})

test('NOTHING IS EXPANDED ON ARRIVAL — and the mechanism is single-select, not an accordion', () => {
  // "A reader who lands on the page sees the list, never a wall of accordions." The rebuild changed HOW
  // that is guaranteed: there is no per-row open state at all now, so nothing can start open. The old
  // spelling of this arm looked for `useState(false)`, which pinned the accordion it was written against.
  const c = code(SCREEN)
  assert.ok(!/useState\(true\)/.test(c), 'something on this page starts open')
  assert.ok(!/aria-expanded/.test(c),
    'a per-row expansion is back — single-select plus a reserved slot is the mechanism, and accordions '
    + 'were removed rather than tuned because any per-row expansion moves every row beneath it')
  // Nothing is picked until a press: the slot renders its empty line, not a panel.
  assert.match(c, /useState<string \| null>\(null\)/, 'the selection does not start empty')
  // And what opens is the panel for ONE destination, in a slot that reserves its own height.
  assert.match(SCREEN, /ai-slot/, 'the reserved slot is gone, so a selection can move the page')
})

test('THE PANEL CANNOT PUSH THE PAGE — the slot reserves height whether or not anything is in it', () => {
  // The owner met this as "new links open and move shit around". A restyle was explicitly rejected: the
  // reserved slot is the mechanism, and it lives in CSS, so asserting the markup alone would pass over a
  // stylesheet that stopped reserving anything.
  const css = readFileSync(new URL('../src/base.css', import.meta.url), 'utf8')
  const slot = css.slice(css.indexOf('.ai-slot {'), css.indexOf('}', css.indexOf('.ai-slot {')))
  // A POSITIVE height. `\d+px` matches `0px`, so the first spelling of this passed a slot that reserved
  // nothing — found by planting min-height:0 and watching both this arm and the browser battery stay
  // green. The number is what makes "reserved" mean anything.
  const px = Number(slot.match(/min-height:\s*(\d+)px/)?.[1] ?? 0)
  assert.ok(px >= 120,
    `the slot reserves ${px}px, which is not enough to hold a panel — selecting a destination then grows `
    + 'the page under the reader, which is the reflow this redesign removes')
})

test('THE COPIED LABEL COSTS ZERO LAYOUT — both labels occupy one reserved cell, in every row', () => {
  // Swapping "Paste it into Claude" for "✓ Copied" at natural width would resize the pressed row and
  // shift its neighbours — the same reflow, arriving through the fix for it.
  const css = readFileSync(new URL('../src/base.css', import.meta.url), 'utf8')
  const say = css.slice(css.indexOf('.ai-dest-say {'), css.indexOf('.ai-slot {'))
  assert.match(say, /display:\s*grid/, 'the two labels no longer share one grid cell')
  assert.match(say, /grid-area:\s*1 \/ 1/, 'the labels are not stacked in the same cell')
  assert.match(say, /visibility:\s*hidden/,
    'a label is being removed from the layout rather than hidden, which resizes the cell')
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
  // THE ANCHOR STOPS AT THE LABEL'S FIRST WORDS, not at its closing quote. A later change put a
  // dated stamp inside that label — `Set up Claude <span…>· ✓ Checked 4 September 2026</span>` — and the
  // old anchor required the quote immediately after "Claude", so it matched nothing and this arm failed
  // with "the report no longer carries its own set-up block" on a report that very much did. A slice
  // that reads -1 or empty is a could-not-look, and the assert below is what turns it into one rather
  // than letting the parity pass over an empty string.
  const band = /steps\('Set up Claude[\s\S]*?steps\('Set up ChatGPT'[^\n]*/.exec(read('../../driver/publish/render.mjs'))?.[0] ?? ''
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

  // TWO SETTERS MAY SEE IT NOW, AND THE SECOND ONE IS A DELIBERATE, BOUNDED EXCEPTION.
  //
  // `Revealed` is the clipboard-refused path and is unchanged. `Landed` is the panel line proving the
  // press worked — "On your clipboard now" — and the brief specifies it MASKED (`v1.••••`). That is
  // three characters of the credential in the DOM, which is more than zero, so it is pinned rather than
  // waved through: the value must pass through `mask()`, and `mask()` must be lossy.
  assert.deepEqual([...withKey].sort(), ['Landed', 'Revealed'],
    'a credential reaches state somewhere other than the masked panel line and the refused-clipboard reveal')
  const landed = press.match(/setLanded\(([^;]*)\)/)?.[1] ?? ''
  if (/\bkey\b/.test(landed)) {
    assert.match(landed, /mask\(/,
      'the panel line is handed a raw credential — it must go through mask(), which is what keeps the '
      + 'proof-of-copy from being the secret itself')
  }

  // And the reveal says it is a one-time thing, because it is: nothing stores it.
  assert.match(SCREEN, /will not be shown again/, 'the degraded reveal does not say it is one-time')
})

test('mask() is LOSSY — the proof-of-copy cannot be read back as the credential', () => {
  // The arm above allows a masked credential into the DOM. That allowance is only safe if the mask
  // actually destroys the value, so this drives it rather than reading it: a long secret must come back
  // shorter than it went in, and must not contain its own tail.
  const m = SCREEN.match(/const mask = \(key: string\): string => \(([^\n]*)\)/)
  assert.ok(m, 'mask() is gone or has changed shape — the allowance above is now unguarded')
  const mask = new Function('key', `return (${m![1]})`) as (k: string) => string
  const secret = 'v1.abcdefghijklmnopqrstuvwxyz0123456789'
  const out = mask(secret)
  assert.ok(out.length < secret.length, `mask() did not shorten the credential: ${out}`)
  assert.ok(!out.includes(secret.slice(6)), `mask() leaked the tail of the credential: ${out}`)
  assert.ok(out.includes('••••'), `mask() does not visibly mask: ${out}`)
})

test('the copy helper reports a REFUSAL, so a blocked clipboard is not read as success', () => {
  // "Clipboard blocked → only then a one-time reveal." That branch is only reachable if the write's
  // failure is a value rather than a swallowed exception — a `catch {}` here would mean the page told a
  // reader it had copied something it had not, and the credential would be nowhere at all.
  const helper = SCREEN.slice(SCREEN.indexOf('async function copy('))
  assert.match(helper, /return true/, 'the copy helper never reports success')
  assert.match(helper, /catch \{ return false \}/, 'a refused clipboard is swallowed rather than reported')
})

test('EVERY ROW COMPOSES A SENTENCE THAT READS — the generic one carries its own, as data', async () => {
  // Owner's ruling 2026-09-06 (option B). Approved copy line 8 is `Paste it into
  // {assistant}`, and it reads for every proper noun — "Paste it into Claude", "Paste it into ChatGPT",
  // "Paste it into Perplexity" — and not for the one row a reader reaches when their assistant is not
  // listed: "Paste it into Another agent" is not English. Option A (rename the row) was rejected because
  // it edits a line he approved to repair a line he did not.
  //
  // THE EXCEPTION IS DATA, NOT A BRANCH, and that was not my first cut. Keying the screen on
  // `offer.id === 'other'` is what I wrote, and `driver/test/connect-clients-are-data.test.mjs` refused
  // it — correctly: no surface may branch on a client's identity, because a branch in a screen drifts
  // from the table silently and both keep rendering while the reader follows whichever one is wrong. The
  // sentence lives on the row now, so a fifth client needing its own line is a row edit.
  //
  // DRIVEN AGAINST THE REAL TABLE, not a fixture and not the three names the defect was found on.
  // `mask()` above establishes the technique: lift the expression out of the page's source and run it,
  // so what is measured is the page's own rule rather than a second copy of it in this file.
  const m = SCREEN.match(/const pasteLine = \(offer: ConnectOffer\): string =>\n\s*([^\n]*)/)
  assert.ok(m, 'pasteLine() is gone or has changed shape — the sentence has no single author any more')
  const pasteLine = new Function('offer', `return (${m![1]})`) as (o: { name: string; pasteAs?: string }) => string

  const { CONNECT_CLIENTS } = await import('../../shared/connect-clients.mjs')
  assert.ok(CONNECT_CLIENTS.length >= 4, 'the client table is too small for this arm to prove anything')

  // THE WHOLE CLASS, one row at a time — the arm that would have caught the defect, because the two
  // instruments that missed it both ask whether the right row rendered and neither asks whether the
  // sentence reads.
  let carriedOwn = 0
  for (const c of CONNECT_CLIENTS) {
    const line = pasteLine(c as { name: string; pasteAs?: string })
    assert.ok(line.trim().length > 0, `${c.id} composes no sentence at all`)
    if (c.pasteAs) { assert.equal(line, c.pasteAs, `${c.id} carries its own sentence and the page ignored it`); carriedOwn++ }
    else assert.ok(line === `Paste it into ${c.name}`, `${c.id} lost the approved sentence: ${line}`)
  }
  assert.ok(carriedOwn >= 1,
    'no row carries its own paste sentence — the branch this arm exists for would pass over nothing')

  // THE ROW THE DEFECT WAS ABOUT, by its own vocabulary rather than by its id. `accepts: "either"` is
  // what makes a row generic in this table, so a fifth generic row is judged here too and not silently
  // exempted for not being called "other".
  const generic = CONNECT_CLIENTS.find((c: { accepts: string }) => c.accepts === 'either')
  assert.ok(generic, 'no generic row exists — the assertion below would pass over nothing')
  assert.equal(pasteLine(generic as { name: string; pasteAs?: string }),
    'Paste it wherever your assistant takes it.', 'the generic row no longer carries the approved sentence')
  assert.ok(!pasteLine(generic as { name: string; pasteAs?: string }).includes(`into ${generic.name}`),
    'the generic row still composes the ungrammatical sentence')

  // NO IDENTITY IN THE SCREEN. Driven with a plant: a row with no sentence of its own composes the
  // default whatever it is called, so a future edit that keys on a name fails here rather than in a
  // browser.
  assert.equal(pasteLine({ name: 'Something Else' }), 'Paste it into Something Else',
    'pasteLine() branches on something other than the row carrying its own sentence')
  // AGAINST THE CODE, NOT THE FILE. `code()` strips comments, and the comment above `pasteLine` QUOTES
  // the branch it replaced so the next reader knows why it is not there — a whole-file match reads that
  // sentence as the defect. An arm that cannot tell an explanation from the thing it explains forces the
  // next person to delete the explanation to go green, which is how a file loses its reasons.
  assert.doesNotMatch(code(SCREEN), /offer\.id === '[a-z]+'/,
    'the screen branches on a client id — connect-clients-are-data.test.mjs refuses this, and it is right')

  // ONE AUTHOR, TWO SLOTS. The row label and the panel heading render the same sentence and each had its
  // own copy before this. Two copies of a sentence is how one of them gets fixed.
  assert.ok(!/Paste it into \{offer\.name\}/.test(SCREEN),
    'a slot still interpolates the name directly instead of calling pasteLine()')
  assert.equal((SCREEN.match(/pasteLine\(offer\)/g) ?? []).length, 2,
    'the two slots no longer both route through pasteLine()')
})
