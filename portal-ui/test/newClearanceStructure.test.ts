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
  // ── WHAT THIS ARM CAN AND CANNOT KNOW ─────────────────────────────────
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

// ── an install that is configured must offer a way to start ─────────────────────────────────────────
//
// An outside user installed the product, configured it — sign-in, engine, register, common-law
// research and case-law lookup all reporting configured — opened this screen, found no control that
// promised to run anything, and stopped using it. What was there was a primary action labelled "Review
// clearance", greyed out because the form was missing a piece nothing on the page named, beside a
// "Save as search" button that gave no sign of having worked.
//
// SOURCE-LEVEL, for the reason the head of this file gives: this runner has no JSX transform and cannot
// mount the screen. These hold that each part is present and wired; that they LOOK right is a person in
// front of the screen, and the walkthrough is recorded on the issue.

test('the primary action on the search screen is a verb that promises a search', () => {
  const src = code(SRC)
  // "Review clearance" reads as inspecting a clearance that already exists. It was the only action on
  // the screen that started anything, and the reader who needed it did not recognise it as one.
  assert.doesNotMatch(flat(src), /'Review clearance'/,
    'the primary action went back to a label that does not say a search will run')
  assert.match(flat(src), /'Start a search'/, 'the search screen has no action labelled with a verb')
  // AND IT IS THE PRIMARY ONE, not a link somewhere. The complaint was that the only thing offered was
  // the ghost-styled Save button.
  assert.match(flat(src), /className="btn-primary" disabled=\{!ready \|\| busy\} onClick=\{onReview\}/,
    'the start action is no longer the footer primary button')
  // The confirmation step is deliberately kept — it carries the coverage, the effort and the legal
  // caveat, which are read before anything is spent. So the button must say that is what comes next.
  assert.match(flat(src), /before anything runs/,
    'nothing tells the reader the button opens a confirmation rather than spending immediately')
  assert.match(flat(src), /'Start clearance'/, 'the confirmation lost the button that actually starts')
})

test('a greyed primary action always has its reason on screen, and at the control', () => {
  const src = code(SRC)
  // ONE PREDICATE. The condition used to be re-derived inline as a boolean beside the sentences that
  // explain the others, and it was the one with no sentences. Asking whether the list is empty is what
  // makes the reason impossible to forget to render.
  assert.match(flat(src), /const gaps = missingPieces\(names, classes, draft\.goods\)/,
    'the form-gap condition is being derived somewhere other than the list of sentences')
  assert.match(flat(src), /const ready = !gaps\.length &&/,
    'readiness stopped being computed from the sentences the reader is shown')
  assert.doesNotMatch(flat(src), /const missing = !names\.length/,
    'the reasonless boolean is back')
  // Rendered as a list on the form …
  assert.match(flat(src), /\{gaps\.map\(/, 'the gap sentences have no render site')
  // … AND at the button. The footer is sticky and the notice is not, so on a long form the greyed
  // button and its explanation are routinely not on screen at the same time. That is the state the
  // reader was in.
  assert.match(flat(src), /blockedBy=\{ready \? null :/, 'the footer is not told why the action is off')
  assert.match(flat(src), /\{blockedBy \?\? /, 'the reason is passed to the footer and never rendered')
})

test('a save says so where the button was pressed', () => {
  const src = code(SRC)
  // The success branch closed the panel and wrote a 12px line into the footer's far LEFT column, under
  // the running total. At the point of interaction the only change was that the control disappeared —
  // reported as "Let's try saving, what happens. ... Nothing!"
  assert.match(flat(src), /setSaveDone\(label\)/, 'a successful save no longer acknowledges itself')
  assert.match(flat(src), /className="save-done" role="status"/,
    'the acknowledgement is not in the action row, or is not announced')
  assert.match(CSS, /\.save-done \{/, 'the acknowledgement has no styles')
  // ── AND IT IS CLEARED BY EVERY WRITE, COUNTED ──────────────────────────────────────────────────
  //
  // A tick beside changed work is a false statement about what is on disk, and a worse defect than the
  // silence it replaced. This was asserted against the `edit` helper alone and that was not enough: the
  // brief reader writes the draft directly, so pressing "Fill it in for me" after a save rewrote the
  // whole form and left the tick standing over it.
  //
  // COUNTED, NOT MATCHED. A second string match would cover the second writer and nothing else, and the
  // defect is that a NEW writer appears. There is one writer now — `writeDraft`, which clears the
  // acknowledgement and is the only caller of the state setter — so the next one is covered because
  // there is nowhere else to write.
  const setters = (flat(src).match(/setDraft\(/g) ?? []).length
  assert.equal(setters, 1,
    `the draft is written from ${setters} place(s). It must be written from exactly one — writeDraft — `
    + 'so that clearing the save acknowledgement cannot be forgotten at a new call site.')
  assert.match(flat(src), /const writeDraft: typeof setDraft = \(next\) => \{ setSaveDone\(null\) setDraft\(next\) \}/,
    'the one writer no longer clears the save acknowledgement')
  // A failed save must not leave an earlier tick standing beside its own error message.
  assert.match(flat(src), /const doSave = async \(\) => \{ .{0,220}setSaveDone\(null\)/,
    'doSave does not clear a previous acknowledgement before it reports')
})

test('the unsaved-changes warning has a baseline to compare against', () => {
  const src = code(SRC)
  // Compared against EMPTY and never reset, so a saved form stayed dirty forever: the user was warned
  // they would lose work that was already on disk, went back, and found it there. guard.test.ts drives
  // the predicate itself; this holds that the screen keeps the baseline and hands it over.
  assert.match(flat(src), /setSavedDraft\(JSON\.stringify\(\{ \.\.\.EMPTY, pick: draft\.pick, classes: draft\.classes, platforms: draft\.platforms, \}\)\)/,
    'the baseline is no longer the projection the save actually wrote')
  // ── AND IT IS NOT THE WHOLE DRAFT ───────────────────────────────────────────────────────────────
  //
  // `composeSaved` carries the levers, classes and marketplaces; `draftFromSaved` restores those and
  // nothing else. Recording the draft whole would mark the mark names and the goods text clean when no
  // file holds them, so somebody who typed twenty names, saved, and left would lose them in silence —
  // the same guard failing in the opposite and worse direction.
  assert.doesNotMatch(flat(src), /setSavedDraft\(JSON\.stringify\(draft\)\)/,
    'the baseline records fields the save does not persist')
  assert.match(flat(src), /saved: savedDraft/, 'the guard is not given the baseline')
  assert.doesNotMatch(flat(src), /submitted == null && JSON\.stringify\(draft\) !== JSON\.stringify\(EMPTY\)/,
    'the baseline-free comparison is back')
})

test('the no-engine notice names a command THIS reader can run', () => {
  const src = code(SRC)
  // `npm run setup` exists only for somebody working in a copy of the source. A reader who installed
  // the package has no npm scripts at all, so the single fix the notice offered was a command that does
  // not exist on their machine — and the notice had no way to tell which of the two they were.
  assert.match(flat(src), /<SetupCommand route=\{setupRoute\} \/>/,
    'the notice went back to a hard-coded command')
  assert.match(flat(src), /route === 'packaged'/, 'the package route has no command')
  assert.match(flat(src), /route === 'checkout'/, 'the source-checkout route has no command')
  assert.match(flat(src), /npx clearotron install/)
  assert.match(flat(src), /npm run setup/)
  // NULL IS ANSWERED BY NAMING BOTH. An older server sends no route, and picking the likelier one there
  // is the same coin flip in a smaller place — the reader cannot tell they were given the wrong one.
  const fn = src.match(/function SetupCommand\([\s\S]*?\n\}/)?.[0] ?? ''
  assert.ok(fn, 'SetupCommand is gone')
  assert.match(fn, /if you installed the package/,
    'the unknown-route branch picks one command instead of naming both')
})
