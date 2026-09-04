// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The copy lint.
//
// Until now there was no length rule and no banlist anywhere in this UI — the only enforced writing rules
// were four ad-hoc regexes on two screens. The firm HAS a voice doctrine (docs/pitch/STYLE-PROSE-GUIDE.md)
// and it was unenforced prose, so nothing stopped "seamless" or a 73-word field hint shipping.
//
// TWO RULES, AND ONLY TWO. A lint that argues about wording gets disabled; one that catches the two
// failures nobody defends — vendor vocabulary, and a paragraph where a sentence was asked for — gets kept.
//
// SCOPED TO WHERE COPY IS AUTHORED CENTRALLY. `profileFields.ts` and `composerProduct.ts` hold the field
// hints and the lever descriptions: the copy a user meets while configuring something, which is exactly
// where over-explaining collects. The screens are ~100 inline strings and are being shortened
// incrementally; the banlist covers them today, the length rule follows them as they land, and that
// staging is deliberate rather than an oversight — a cap that fails a hundred strings on the first run is
// a cap someone deletes.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')
const SRC = new URL('../src/', import.meta.url)

/** Source with comments stripped — a comment explaining a rule must not trip the rule. */
const body = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join('\n')

const screens = readdirSync(fileURLToPath(new URL('screens/', SRC))).filter((f) => f.endsWith('.tsx'))
const contracts = ['profileFields.ts', 'composerProduct.ts', 'home.ts', 'composeRead.ts']

/**
 * The firm's own banlist, from the prose guide.
 *
 * Officialdom for the lawyer's role is the half that matters most here: this product must never say a
 * clearance is "certified" or a name "guaranteed", because that is a claim about the work that the work
 * does not make. The AI-vendor vocabulary is the half that would make a lawyer wince.
 */
const BANNED = [
  // never said about this work
  'certified', 'certify', 'guaranteed', 'guarantee',
  // AI-vendor vocabulary
  'seamless', 'cutting-edge', 'state-of-the-art', 'revolutionary', 'game-changing',
  'next-generation', 'empower', 'unlock', 'supercharge', 'turbocharge', 'AI-powered',
  'holistic', 'synergy', 'robust', 'delve', 'leverage',
  // hype doing the work evidence should do
  'world-class', 'best-in-class', 'unparalleled', 'incredible',
  // filler
  "it's worth noting", 'it is worth noting', 'we believe that',
]

test('no banned vocabulary anywhere a user can read', () => {
  const files = [...screens.map((f) => `screens/${f}`), ...contracts.map((f) => `contract/${f}`),
    'shell/AppShell.tsx', 'components/ContextPackEditor.tsx', 'components/RiskDot.tsx']
  const hits: string[] = []
  for (const f of files) {
    const text = body(read(`../src/${f}`))
    for (const word of BANNED) {
      // Word-boundary, case-insensitive. "leverage" the noun is banned as a verb in the guide; the
      // boundary keeps "lever" and "levers" — this product's own vocabulary — entirely clear of it.
      const re = new RegExp(`\\b${word.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i')
      const m = re.exec(text)
      if (m) hits.push(`${f}: "${m[0]}"`)
    }
  }
  assert.deepEqual(hits, [], `banned vocabulary reached the screen:\n  ${hits.join('\n  ')}`)
})

/**
 * Field hints, extracted from the two modules that author them centrally.
 *
 * A `hint:` is the shortest thing on a form and the most over-written: it is where someone explains the
 * mechanism because the label could not. 40 words is generous — the longest that survives is 30 — and it
 * exists to stop the next 73-word paragraph, not to force anything shorter than it needs to be.
 */
const MAX_WORDS = 40

function hintsIn(file: string): { readonly where: string; readonly text: string }[] {
  const out: { where: string; text: string }[] = []
  const src = body(read(`../src/contract/${file}`))
  for (const m of src.matchAll(/(hint|description|tagline):\s*'((?:[^'\\]|\\.)*)'/g)) {
    out.push({ where: `${file}:${m[1]}`, text: m[2]!.replace(/\\'/g, "'") })
  }
  return out
}

test('no field hint runs past 40 words', () => {
  const long: string[] = []
  for (const file of ['profileFields.ts', 'composerProduct.ts']) {
    for (const { where, text } of hintsIn(file)) {
      const words = text.trim().split(/\s+/).filter(Boolean).length
      if (words > MAX_WORDS) long.push(`${where} — ${words} words: "${text.slice(0, 70)}…"`)
    }
  }
  assert.deepEqual(long, [], `a hint grew into a paragraph:\n  ${long.join('\n  ')}`)
})

test('the hint the owner named by hand is short, and keeps the clause that matters', () => {
  const fields = read('../src/contract/profileFields.ts')
  // marketplaceDensity was the other hint pinned here. Its CONTROL was removed from every surface by
  // owner ruling (2026-08-29), so there is no hint left to keep short — the field survives as a stored
  // value with no page behind it, and driver/test/a-removed-control-does-not-delete-the-setting-behind-it
  // is what guards that. Nothing to assert here; this is not an omission.

  // defaultProduct: the availability clause is the only load-bearing part and must survive any cut.
  const depth = /hint: '([^']*settled when the run starts[^']*)'/.exec(fields)
  assert.ok(depth, 'the depth hint still says availability is settled at run time')
  assert.ok(depth![1]!.split(/\s+/).length <= 25)
})

// ── THE RECEIPT CALLS A FIELD WHAT THE FORM CALLS IT ────────────────────────
//
// THE DEFECT THIS CLOSES, which shipped and was caught by eye rather than by a test. The owner's prose
// review renamed a field on the composer — "Needed by" became "Deadline" — and the brief reader's
// receipt, which reports what it filled in, kept saying "Needed by" because it is a different file on a
// different code path that the review did not reach. One screen, two names for one field, and every
// arm on both sides green: each file was internally consistent and nothing compared them.
//
// WHAT THIS DOES NOT DO. It does not require the receipt's word to EQUAL the form's label — "Goods"
// against "Goods or services description (optional)" is a shortening, not a drift, and a lint that
// argues about wording is a lint someone deletes (see the two-rules note at the top of this file). It
// requires the receipt's word to still EXIST on the composer. That is the failure that actually
// happened: a label is renamed, the old word leaves the screen entirely, and the receipt keeps it.
test('every field the brief-read receipt names is a field the composer still calls that', () => {
  const receipt = body(read('../src/contract/composeRead.ts'))
  // The label is what precedes the first interpolation in each receipt line — `Deadline ${after.deadline}`
  // gives "Deadline", `Your reference — ${after.ref}` gives "Your reference" once the seam is trimmed.
  const labels = [...receipt.matchAll(/out\.push\(`([^`$]+)\$\{/g)]
    .map((m) => m[1].replace(/[—·-]\s*$/, '').trim())
    .filter(Boolean)

  // AN EMPTY DERIVATION IS NOT A PASS. If the receipt is ever rewritten in a shape this pattern cannot
  // read, the loop below runs zero times and reports success over nothing.
  assert.ok(labels.length >= 4,
    `the receipt's labels could not be read — found ${labels.length}: ${JSON.stringify(labels)}`)

  const composer = read('../src/screens/NewClearance.tsx')
  for (const label of labels)
    assert.ok(composer.includes(label),
      `the receipt says "${label}" for a field the composer no longer calls that — one screen, two names`)
})

test('the money reassurance is not scattered through the composer', () => {
  // "Nothing is started and nothing is spent" was on the brief reader, which spends nothing and is not a
  // step towards spending — answering a question nobody had asked, in the one word that raises the worry
  // it was trying to settle. That is the defect this guards, and it still holds.
  //
  // THE OTHER HALF OF THIS RULE IS RETIRED WITH THE SENTENCE IT WAS ABOUT. It used
  // to require the reassurance to be PRESENT at the review step — "Check this over — nothing is spent
  // until you confirm." The owner's copy pass replaced that line with "Search configuration", so there
  // is no sentence left to require and asserting one would fail on his own wording.
  //
  // What the dialog DOES is unchanged: it prices the run, quotes how long it takes, and spends nothing
  // until the confirmation. Only the sentence saying so is gone — flagged on the issue, because it was
  // the one place a reader was told, and INSTALL.md and bin/ both cited it as the consent the product
  // obtains. Those describe the behaviour now instead of quoting the line.
  const composer = body(read('../src/screens/NewClearance.tsx'))
  const onScreen = composer.match(/nothing is spent/gi) ?? []
  assert.deepEqual(onScreen, [], 'the phrase is not on any other step — the brief reader least of all')
  // The failure branches are a different sentence and a different fact — the run did not start — and
  // screenCopy.test.ts pins those separately.
})

test('buttons name what the USER is doing', () => {
  // "Read this" named the system's action. The person is handing over a brief and asking for the form to
  // be filled in; the button now says that.
  const composer = body(read('../src/screens/NewClearance.tsx'))
  assert.match(composer, /'Fill it in for me'/)
  assert.doesNotMatch(composer, /'Read this'/)
})
