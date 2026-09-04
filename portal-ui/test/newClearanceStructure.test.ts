// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── §B — the owner's structural review of the New clearance screen ───────────
//
// Section A was fourteen copy replacements and landed in PR 125. This is the other half, and it is
// about SHAPE rather than words: four items, each of them his own sentence.
//
//   · depth markers on the four searches — "a series of bars (like battery bars that show size) or
//     similar … to suggest breadth and depth change"
//   · tick and cross markers on what a search includes — "so in-or-out is visual"
//   · the context box moves up, directly below goods or services, always open — "not hidden under a
//     collapse thing — it's important" — with an explicit worked example and a line about the connector
//   · the comparison table, which "side-scrolls or wraps and looks worse than its content deserves"
//     because the page "is bound to an artificially narrow width"
//
// SOURCE-LEVEL, for the reason registerCoverage.test.ts gives about its own screen arm: rendering the
// screen is not what these defects live in, and a screen that quietly stops passing a prop behaves
// exactly as it did before with no error anywhere. What a browser has to check is how it LOOKS, and
// that door is a person in front of the screen — recorded on the issue, not claimed here.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SRC = readFileSync(new URL('../src/screens/NewClearance.tsx', import.meta.url), 'utf8')
const CSS = readFileSync(new URL('../src/base.css', import.meta.url), 'utf8')
/** Code only: a comment recording a defect must not read as the defect returning. */
const code = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n')
const flat = (s: string) => s.replace(/\s+/g, ' ')

test('2144 the selector carries no depth icons, and the tick/cross list still answers in or out', () => {
  const src = code(SRC)
  // ── THE DELETION IS THE REQUIREMENT (owner, 2026-09-03) ──────────────────────────────────────────
  // These four assertions ran the other way until this issue: they REQUIRED the little bars beside each
  // product. The owner ruled them out — "in product selector … we can remove these next to the product
  // description, tiny fixed icons. barely visible" — so the arm is reversed rather than deleted, which
  // is what stops the icons coming back the next time somebody reads 1937 §B and builds it again.
  //
  // The final summary's effort bars are NOT these. They are `.bar`/`.bar-on` and `.dot`/`.dot-on`, and
  // the owner keeps them ("in the summary things rescale and work great") — asserted below, because a
  // deletion that took them with it is the one way this change could do harm.
  assert.doesNotMatch(flat(src), /<DepthBars\b/, 'the depth-bar component is back in the picker')
  assert.doesNotMatch(flat(src), /depthRungs/, 'the rung derivation is back; it had one caller and this was it')
  assert.doesNotMatch(CSS, /\.depth-bar\b/, 'the depth-bar styles are back')

  // ── AND THE CONFIRMATION'S EFFORT BARS SURVIVED, which nothing above asserts ────────────────────
  //
  // 2144 removed ONE of two renders and kept the other: "in the summary things rescale and work great.
  // in product selector … we can remove these next to the product description". Every assertion above is
  // a DELETION check, so a change that took both would pass all of them — and the summary's bars are the
  // half the owner explicitly praised. A deletion guard without a survival guard cannot tell "the right
  // one went" from "both went".
  assert.match(flat(src), /<Row label="Effort">/, 'the confirmation lost its effort line')
  // COUNTED, not merely present. There are TWO ten-segment renders — the composer footer and the
  // confirmation's Effort line — and both are the "summary" the ruling keeps. A `match` for the array
  // passes while one of the two is changed, which is what a plant on the first occurrence proved: the
  // regex found the survivor and reported green. So this counts them.
  const tens = flat(src).match(/\[1, 2, 3, 4, 5, 6, 7, 8, 9, 10\]\.map/g) ?? []
  assert.equal(tens.length, 2,
    `expected both ten-segment effort renders (composer footer + confirmation) and found ${tens.length} — 2144 keeps them exactly as built and deletes only the selector's per-product icons`)
  assert.match(flat(code(SRC)), /className=\{i <= plan\.effort!\.units \? 'bar bar-on' : 'bar'\}/,
    "the SUMMARY's effort bars went with the selector's icons — the owner ruled those stay")

  // The tick/cross list. The glyph and the sentence come off ONE boolean — see screenCopy.test.ts for
  // the case-law half, which is the row that actually varies.
  assert.match(flat(src), /className=\{included \? 'carries-in' : 'carries-out'\}/)
  assert.match(flat(src), /\{included \? '✓' : '✕'\}/, 'the in-or-out answer is not visual')
  assert.match(flat(src), /aria-label=\{`\$\{included \? 'Included' : 'Not included'\}/,
    'a screen reader gets a check mark rather than the claim')
  assert.match(CSS, /\.carries-mark\b/, 'the markers have no style of their own')
  // Colour is a reinforcement, never the only signal: the glyph differs too.
  assert.match(CSS, /\.carries-out \.carries-mark/, 'the two states are indistinguishable in the stylesheet')
})

test('1937 §B the context field is out of the collapsible, above it, and shows an example', () => {
  const src = code(SRC)
  const goods = src.indexOf('Goods or services description (optional)')
  const context = src.indexOf('Any context that might be relevant (optional).')
  const details = src.indexOf('<Details summary="References and dates (optional)">')
  assert.ok(goods > 0 && context > 0 && details > 0, 'one of the three anchors has been renamed — the arm has broken, not the tree')
  assert.ok(goods < context, 'the context field is no longer directly below goods or services')
  assert.ok(context < details, 'the context field is back inside — or below — the collapsible it was pulled out of')

  // ALWAYS OPEN. The field must not be inside any <Details> on this screen: "not hidden under a
  // collapse thing — it's important."
  const detailsBlock = src.slice(details)
  assert.ok(!detailsBlock.includes('Any context that might be relevant'),
    'the context field is back under a collapse')

  // AN EXPLICIT EXAMPLE, labelled as one, naming concrete shapes — a launch page and a post — so a
  // reader can tell they have something to paste. The old placeholder was a well-formed sentence that
  // taught nothing about what KIND of thing belongs here.
  assert.match(flat(src), /placeholder=\{'Example: /, 'the placeholder is not a labelled example')
  assert.match(flat(src), /LinkedIn/, 'the example names no concrete artefact a reader would recognise')
  assert.match(flat(src), /https:\/\/example\.com/, 'the example carries no link, which is the commonest thing to paste')

  // And the separate line about the connector, which is a second way this field gets filled and was
  // said nowhere on the screen.
  assert.match(flat(src), /started by an agent through the connector can reference emails or documents/)

  // What is left in the collapsible is what its summary claims — a reference and a date.
  const inside = src.slice(details, src.indexOf('</Details>', details))
  assert.match(inside, /Your reference/)
  assert.match(inside, /Deadline/)
  assert.equal((inside.match(/<Field /g) ?? []).length, 2,
    'the collapsible holds something other than the reference and the date its summary names')
})

test('1937 §B the comparison table takes the screen measure, without widening the form', () => {
  const src = code(SRC)
  // ── Refs tracker issue 2144 — WHAT THIS ARM CAN AND CANNOT KNOW ─────────────────────────────────
  // It used to open by matching the exact markup of the opt-out, and it passed for the whole time that
  // opt-out was INERT: the class was on an element two levels inside the one carrying the cap, so
  // `max-width: none` could never take effect, and no string in this file can see that. A test that
  // reads markup cannot know what the cascade resolved.
  //
  // So the structural fact — the block is a DIRECT CHILD of `.composer-col`, which is the whole of why
  // the escape works — is asserted where it is observable, in `scripts/composer-render-check.mjs`,
  // against a real browser. What is left here is what this file genuinely knows: the rules exist and
  // say what they must. The markup shape is deliberately NOT asserted; pinning it is what produced
  // confidence about a screen nobody had measured.
  assert.match(flat(src), /<div className="composer-wide">\s*<Details summary="Detailed search comparison table for information">/,
    'the comparison block is not the thing carrying the width opt-out')
  assert.match(CSS, /\.composer-wide\s*\{[^}]*max-width:\s*none/,
    'the escape does not lift the cap, so the class does nothing')
  // THE MEASURE IS ON THE BLOCKS, NOT ON THE COLUMN. Every field line stays exactly as wide as it was;
  // one block opts out by saying so. Widening the page instead would make every field on it harder to
  // read to fix one table.
  assert.match(CSS, /\.composer-col > \*\s*\{[^}]*max-width:\s*720px/,
    'the field blocks lost their measure — every field on the page is now full width')
  assert.doesNotMatch(CSS, /\.composer-col\s*\{[^}]*max-width/,
    'the cap is back on the column itself, so the block inside it cannot escape')

  // ── AND IT IS BOUNDED BY THE PARENT, NEVER BY THE VIEWPORT ────────────────────────────────────────
  //
  // The first attempt capped the block at the screen's own measure — `min(1060px, calc(100vw - 60px))`
  // — and scripts/composer-render-check.mjs measured the page scrolling sideways by 62px in a real
  // browser. The viewport is not the container: the shell's navigation rail takes part of it, and
  // `100vw` includes the scrollbar. Nothing derived from `vw` can be right here, and no unit test on
  // this side could have seen it.
  const block = CSS.slice(CSS.indexOf('.composer-wide {'), CSS.indexOf('}', CSS.indexOf('.composer-wide {')))
  assert.doesNotMatch(block, /vw|vmin|vmax/,
    'the escape is sized from the viewport again — the browser check found that overflows by the width '
    + 'of the navigation rail plus the scrollbar')

  // EXACTLY ONE BLOCK OPTS OUT. The escape is safe because the comparison table is the only thing in
  // this column that is not a form line; put it on a field block and the page grows a horizontal
  // scrollbar with every arm above still green, which is how the 62px got as far as a browser.
  assert.equal((SRC.match(/className="composer-wide"/g) ?? []).length, 1,
    'more than one block escapes the form measure — the exception has become the rule')

  // And the footer is NOT a child of the column, so it did not pick up the cap: its own browser arm
  // asserts a footer spans the column where a panel does not, and a 720px cap would fail it silently
  // on a wider screen.
  const col = SRC.indexOf('<div className="composer-col">')
  assert.ok(col > 0 && SRC.indexOf('<Footer', col) > SRC.indexOf('\n          </div>', col),
    'the footer moved inside the composer column, where the field measure now caps it')
})
