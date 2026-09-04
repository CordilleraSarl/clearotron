// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The two width caps, and which of them is allowed to move.
//
// SOURCE-TEXT, for the reason screenCopy.test.ts sets out at length: this package runs `node --test`
// with type stripping and no jsdom, so a `.tsx` screen cannot be mounted here and a rendered width
// cannot be measured. These assertions prove the MECHANISM is in one place and that the load-bearing
// cap is still present. They cannot prove a pixel.
//
// What they catch is exactly the two edits a reviewer makes in good faith:
//   · restating an inline reading measure on a new screen, re-scattering the thing that was gathered
//   · "simplifying" away the 1120px cap, which has already been done once and reverted
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')
const BASE = read('../src/base.css')

const screensDir = fileURLToPath(new URL('../src/screens', import.meta.url))
const screens = readdirSync(screensDir)
  .filter((f) => f.endsWith('.tsx'))
  .map((f) => [f, readFileSync(`${screensDir}/${f}`, 'utf8')] as const)

test('the reading measure has ONE home — no screen restates it inline', () => {
  // The values this replaced: 760 on four containers, 720 on four, 780 on one, across eight files,
  // with GlobalConfig disagreeing with itself between its two branches. A new screen that hardcodes
  // one of them is re-creating that state, so the numbers themselves are what is banned.
  //
  // Scoped to the reading measure only. Decorative caps inside a screen — a 460px prose column, a
  // 520px notice — are a different intent and stay inline; they are not in this set.
  // Matched on the CONTAINER SHAPE, not on the numbers alone: a bare wrapper whose only style is a
  // reading-measure width. A decorative cap inside a screen — a notice at `className="notice quiet"
  // style={{ marginTop: 22, maxWidth: 720 }}` — carries other styles, is a different intent, and stays
  // legal. Banning the values outright would have flagged that notice and taught the next person that
  // the rule is arbitrary.
  const banned = /<div style=\{\{ maxWidth: (?:720|760|780) \}\}>/
  for (const [name, src] of screens) {
    assert.ok(!banned.test(src), `${name} restates a reading measure inline — use className="measure" (override --screen-measure if it genuinely differs)`)
  }
})

test('the measure is a token with a default, so a deviation is greppable', () => {
  assert.match(BASE, /--screen-measure:\s*760px/, 'the default measure is declared once')
  assert.match(BASE, /\.measure\s*\{[^}]*max-width:\s*var\(--screen-measure\)/, 'the class reads the token')
  // max-width and NOTHING else. These containers are deliberately left-aligned inside the centred
  // .screen column; adding margin or padding to the class would shift every one of them.
  const rule = BASE.match(/\.measure\s*\{([^}]*)\}/)?.[1] ?? ''
  const props = rule.split(';').map((s) => s.split(':')[0]?.trim()).filter(Boolean)
  assert.deepEqual(props, ['max-width'], '.measure must set max-width only')
})

test('THE 1120px SCREEN CAP IS LOAD-BEARING AND STAYS', () => {
  // Removed once, on 2026-07-20, on the reasoning that "a report is not prose, let the tables
  // breathe". Reverted the same hour: the delivered report caps ITSELF at 1120px, so uncapping the
  // frame widened no table — it only pushed the border out past the document and left the report
  // stranded inside it. The next person to have that idea should fail a test, not ship it.
  assert.match(BASE, /\.screen\s*\{[^}]*max-width:\s*1120px/, 'the screen frame cap must not be removed')
  assert.notEqual(
    BASE.match(/--screen-measure:\s*(\d+)px/)?.[1], '1120',
    'the two caps are separate on purpose — the frame is pinned to the report, the measure is typographic',
  )
})

// ──: the read rows are IN the grid, not positioned to look like it ─────────────────────────────
//
// SOURCE-TEXT, with the same limit as everything else in this file: it can prove the mechanism is
// present and cannot prove a pixel. The pixels are measured by scripts/clearances-render-check.mjs,
// which drives a real browser in CI — this exists so a `.tsx` refactor that quietly reinstates the
// spanning panel fails here in a second rather than four minutes later in Chrome.

const CLEARANCES = read('../src/screens/Clearances.tsx')

test('#276: an expanded read is a real <tr>, and the table declares its grid', () => {
  assert.match(CLEARANCES, /function ReadRow\(/, 'the read is its own row component')
  // made the class conditional (an openable row carries `openable` too), so this pins the
  // structural claim — a <tr> carrying read-row — rather than one literal spelling of it.
  assert.match(CLEARANCES, /className=\{openable \? 'read-row openable' : 'read-row'\}/, 'still a <tr> carrying read-row')
  assert.match(CLEARANCES, /<table className="data fixed">/, 'the table opts in to fixed layout')
  assert.match(CLEARANCES, /<colgroup>/, 'and declares its columns once, in the header')
  assert.match(BASE, /table\.data\.fixed\s*\{\s*table-layout:\s*fixed/, 'which base.css has to honour')
})

test('#276: the thread is not rendered inside a spanning cell any more', () => {
  // The fault was ONE `<td colSpan>` holding a flex layout: nothing in it participated in the column
  // grid, so any alignment it showed was coincidental and drifted the moment a title changed length.
  // From the JSX, not the comment above it — that comment DESCRIBES the spanning cell this replaced,
  // so including it would make the assertion fail on its own explanation.
  const thread = CLEARANCES.slice(CLEARANCES.indexOf('{open ? mark.reads.map'), CLEARANCES.indexOf('run.marks.length > 1'))
  assert.doesNotMatch(thread, /colSpan/, 'the reads no longer live in a spanning cell')
  assert.match(thread, /mark\.reads\.map/)
  assert.match(thread, /<ReadRow/)
  // The batch's per-name answers DO keep a spanning cell, deliberately: those are one read's contents,
  // not reads, and they do not belong in the read grid.
  assert.match(CLEARANCES, /run\.marks\.length > 1 \? \(\s*<tr>\s*<td colSpan/, 'the per-name block is the one deliberate exception')
})

test('#276: fixed layout means a cell must WRAP rather than overflow its column', () => {
  // Under `table-layout: fixed` a cell no longer widens for its content, so long unbroken text would
  // spill across the column boundary instead of pushing it — which looks like the alignment bug this
  // issue is closing.
  assert.match(BASE, /table\.data\.fixed td\s*\{[^}]*overflow-wrap:\s*anywhere/)
})

// ──: the row is the control ────────────────────────────────────────────────────────────────────

test('#278: an openable read row is reachable, activatable and named; the button inside it is gone', () => {
  assert.match(CLEARANCES, /const openable = Boolean\(read\.report\)/)
  assert.match(CLEARANCES, /role: 'link' as const/)
  assert.match(CLEARANCES, /tabIndex: 0/, 'reachable by keyboard — a row is not focusable on its own')
  assert.match(CLEARANCES, /e\.key === 'Enter' \|\| e\.key === ' '/, 'activates on Enter or Space')
  assert.match(CLEARANCES, /'aria-label': `Open the report for \$\{readLabel\(read\)\}`/,
    'named for what it opens, not "row"')
  // Two targets for one action is what a button inside a clickable row would be.
  const readRow = CLEARANCES.slice(CLEARANCES.indexOf('function ReadRow'))
  assert.doesNotMatch(readRow, /Open the report\s*\n\s*<Icon/, 'the text button inside the row is gone')
})

test('#278: a read with NO report gets no affordance at all — a dead target is worse than no target', () => {
  // The Zephyr case: not finished, so there is nothing to open. It must not look clickable, must not
  // take a tab stop, and must not hover.
  assert.match(CLEARANCES, /\{\.\.\.\(openable\s*\n?\s*\? \{/, 'every interactive attribute is behind the same guard')
  for (const rule of [/tr\.read-row\.openable > td \{\s*cursor: pointer/, /tr\.read-row\.openable:hover > td/, /tr\.read-row\.openable:focus-visible/]) {
    assert.match(BASE, rule, `the affordance is scoped to .openable: ${rule}`)
  }
  assert.doesNotMatch(BASE, /tr\.read-row > td \{[^}]*cursor: pointer/, 'and never applies to every read row')
})

test('#278: the focus ring is focus-VISIBLE and sits on the row, not on a cell', () => {
  // A keyboard user must see where they are; a mouse user must not get a ring they did not ask for.
  // And an outline per cell would read as six targets rather than one.
  assert.match(BASE, /tr\.read-row\.openable:focus \{\s*outline: none/)
  assert.match(BASE, /tr\.read-row\.openable:focus-visible \{\s*outline: 2px solid var\(--accent\)/)
})

// ──: the grouping reads as grouping ────────────────────────────────────────────────────────────

test('#277: the brand-owner heading is a SECTION HEADER, not the smallest type on the page', () => {
  // It was `.eyebrow`: 9.5px, letterspaced caps, --text-faint. That reads as a rule between rows rather
  // than as "everything below this belongs to Aurora Interactive", which is the whole fault.
  assert.match(CLEARANCES, /className="owner-name"/)
  assert.match(CLEARANCES, /className="owner-count"/)
  assert.doesNotMatch(CLEARANCES.slice(CLEARANCES.indexOf('tr className="group-head"'), CLEARANCES.indexOf('</tr>', CLEARANCES.indexOf('tr className="group-head"'))),
    /eyebrow/, 'the heading no longer borrows the smallest type on the page')
  assert.match(BASE, /tr\.group-head \.owner-name \{[^}]*font-size: 14px/)
  assert.match(BASE, /tr\.group-head \.owner-name \{[^}]*font-weight: 600/)
  assert.match(BASE, /tr\.group-head \.owner-name \{[^}]*color: var\(--text-strong\)/)
  assert.match(BASE, /tr\.group-head \.owner-name \{[^}]*text-transform: none/, 'sentence case, not letterspaced caps')
})

test('#277: a rule spans the table under the heading and its child rows are indented', () => {
  // Containment visible without reading. The indent is on the FIRST cell only — indenting every cell
  // would move the columns and just fixed.
  assert.match(BASE, /tr\.group-head td \{[^}]*border-bottom: 1px solid var\(--border-strong\)/)
  assert.match(BASE, /tr\.group-head ~ tr\.row > td:first-child \{\s*padding-left: 22px/)
})

test('#277: GROUP · N and the brand-owner chip are GONE — removal, not restyling', () => {
  // `GROUP · 1` announced a group of one, which is not a group. And the owner chip only ever rendered
  // when grouping was ON — precisely when a header directly above the row said the same thing — so it
  // was the same string twice on one line.
  assert.doesNotMatch(CLEARANCES, /GROUP · \{/)
  assert.doesNotMatch(CLEARANCES, /owner=\{grouped &&/)
  // The CALL, not the word — the comment above the removal names the helper and says where it went.
  assert.doesNotMatch(CLEARANCES, /ambiguousTitles\(/, 'and its disambiguation machinery is unwired with it')
})

// ──: selection — one vocabulary, in the palette, moving nothing ─────────────────────────────────

test('#282: PICK is gone and NOT renamed — a checkbox column does not need a header', () => {
  // The issue rejects renaming it: a better word would keep a header that earns nothing. The column is
  // named for screen readers instead, on the header cell and on every checkbox.
  assert.doesNotMatch(CLEARANCES, /<span className="eyebrow">Pick<\/span>/)
  assert.doesNotMatch(CLEARANCES, />Pick</)
  assert.match(CLEARANCES, /<th aria-label="Select for grouping" \/>/)
  assert.match(CLEARANCES, /aria-label=\{`Select \$\{mark\.name\} for grouping`\}/)
})

test('#282: ONE WORD for the feature — family, everywhere, with no second term in the flow', () => {
  const bar = CLEARANCES.slice(CLEARANCES.indexOf('className="selection-bar"'), CLEARANCES.indexOf('<div className="table-wrap">'))
  assert.match(bar, /names' : 'name'\} selected|\{picked\.size === 1 \? 'name' : 'names'\} selected/)
  assert.match(bar, /Group as a family/)
  assert.match(bar, /Remove from family/)
  // Over the RENDERED strings, not the source: the comment above the bar quotes the retired word to
  // explain why it is retired, and an assertion that fails on its own explanation is a bad assertion.
  // Comments stripped first: the one above the bar quotes the retired word to explain why it is
  // retired, and an assertion that fails on its own explanation is a bad assertion.
  const code = bar.replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  assert.doesNotMatch(code, /\bpick\b/i, 'the pick vocabulary does not survive into the action')
  assert.match(code, /Group as a family/, 'and family does')
})

test('#282: the bar OVERLAYS — ticking a box must not move the table under the cursor', () => {
  // It was a `.notice` in normal flow above the table header, so selecting a row pushed the entire
  // table down. The issue also rejects reserving space with a permanent empty band, which is the other
  // way to stop the jump and leaves a hole on every visit.
  assert.match(CLEARANCES, /className="selection-bar"/)
  assert.doesNotMatch(CLEARANCES.slice(0, CLEARANCES.indexOf('<div className="table-wrap">')), /className="notice" style=\{\{ display: 'flex'/)
  assert.match(BASE, /\.selection-bar \{[^}]*position: fixed/)
  assert.match(BASE, /\.selection-bar \{[^}]*bottom: 20px/)
})

test('#282: it is NOT .notice — that is the persistent treatment, used by this screen\'s own error state', () => {
  // The red left border was never a one-off; `.notice` is shared. Which is why reusing it here was
  // wrong rather than merely ugly: a notice is a thing you read, a selection bar is a thing you act on.
  assert.match(BASE, /\.notice \{[^}]*border-left: 3px solid var\(--accent\)/, 'the shared treatment still exists for its own users')
  const bar = BASE.slice(BASE.indexOf('.selection-bar {'), BASE.indexOf('}', BASE.indexOf('.selection-bar {')))
  assert.doesNotMatch(bar, /border-left: 3px/, 'and the transient one does not borrow its border')
})

test('#282: the checkbox is in the palette in every state — unchecked, checked, focused, disabled', () => {
  // Browser-default blue was the only blue on a warm and maroon page: the clearest sign on the screen
  // that a control had been dropped in and never dressed.
  assert.match(BASE, /input\[type='checkbox'\]\.pickbox \{[^}]*accent-color: var\(--accent\)/)
  assert.match(BASE, /\.pickbox:focus-visible \{[^}]*outline: 2px solid var\(--accent\)/)
  assert.match(BASE, /\.pickbox:disabled \{[^}]*accent-color: var\(--border-strong\)/)
  assert.doesNotMatch(BASE, /\.pickbox[^{]*\{[^}]*accent-color: var\(--high\)/,
    'never --high: brand.mjs records it was un-aliased from --accent because a High risk dot read as a Start button')
})

// ──: the disclosure is a real control ──────────────────────────────────────────────────────────

test('#284: the disclosure is a <button> with a name and aria-expanded — it was neither', () => {
  // Worse than the issue reports. There was no button: a bare `<span aria-hidden="true">` inside a
  // `<tr onClick>`, so the page's primary navigation was silent to a screen reader AND had no keyboard
  // path at all. Nothing to name, and nothing to press.
  assert.match(CLEARANCES, /<button\s*\n?\s*type="button"\s*\n?\s*className="twisty"/)
  assert.match(CLEARANCES, /aria-expanded=\{open\}/, 'and it tracks the actual state')
  assert.match(CLEARANCES, /aria-label=\{label\}/)
  // The chevron stays hidden: it is decoration beside the name, and announcing "chevron" helps nobody.
  const twisty = CLEARANCES.slice(CLEARANCES.indexOf('function Twisty'), CLEARANCES.indexOf('function FamilyRows'))
  assert.match(twisty, /aria-hidden="true"/)
})

test('#284: the name identifies the ROW it controls, and comes from the row\'s own name source', () => {
  // The issue: copy the naming pattern that is CURRENT when you build, not today's string. changed
  // what a row is called and removed "grouping" from the checkbox wording, so a name composed
  // inside the disclosure would already be a third convention drifting from the other two.
  assert.match(CLEARANCES, /label=\{`\$\{open \? 'Collapse' : 'Expand'\} \$\{mark\.name\}`\}/)
  assert.match(CLEARANCES, /label=\{`\$\{open \? 'Collapse' : 'Expand'\} \$\{family\.name\}`\}/)
  // Same source as the checkbox beside it, so the two cannot drift apart.
  assert.match(CLEARANCES, /aria-label=\{`Select \$\{mark\.name\} for grouping`\}/)
})

test('#284: pressing the button toggles ONCE — the row handler must not fire as well', () => {
  // A button inside a clickable row that does not stop propagation toggles twice: open then closed in
  // one click, which looks exactly like a control that does nothing.
  const twisty = CLEARANCES.slice(CLEARANCES.indexOf('function Twisty'), CLEARANCES.indexOf('function FamilyRows'))
  assert.match(twisty, /e\.stopPropagation\(\)\s*\n\s*onToggle\(\)/)
})

test('#284: the button looks like the span it replaced, and adds one thing — a focus ring', () => {
  assert.match(BASE, /button\.twisty \{[^}]*border: 0/)
  assert.match(BASE, /button\.twisty \{[^}]*background: none/)
  assert.match(BASE, /button\.twisty:focus-visible \{[^}]*outline: 2px solid var\(--accent\)/)
  assert.match(BASE, /button\.twisty:focus \{\s*outline: none/, 'focus-visible only — a mouse user gets no ring')
})

// ──: grouping is a toggle, and the owner survives it ───────────────────────────────────────────

test('#281: grouping is ON by default and the toggle state is visible without opening a menu', () => {
  // Grouped-by-default is right for the common case, a person working one client's book. The toggle is
  // for the case grouping actively obstructs — reading risk across a whole portfolio.
  assert.match(CLEARANCES, /const \[groupByOwner, setGroupByOwner\] = useState<boolean>\(readGroupPref\)/)
  assert.match(CLEARANCES, /return localStorage\.getItem\(GROUP_PREF_KEY\) !== 'off'/, 'absent means ON')
  assert.match(CLEARANCES, /return true\s*\n\s*\}\s*\n\}/, 'and a store that throws still means ON')
  // In the toolbar, not behind a menu: a toggle whose state you have to go looking for explains nothing
  // about why the sort looked wrong.
  assert.match(CLEARANCES, /className="group-toggle"/)
  assert.match(CLEARANCES, /Group by brand owner/)
  assert.match(BASE, /\.group-toggle \{/)
})

test('#281: the toggle only appears when it can do something', () => {
  // One owner in view, or the nav already scoped to one, and there is nothing to group. A control that
  // cannot change anything is the dead-option problem in a new place.
  assert.match(CLEARANCES, /const groupable = ownerFilter === null && ownersHeld > 1/)
  assert.match(CLEARANCES, /const grouped = groupable && groupByOwner/)
  assert.match(CLEARANCES, /\{groupable \? \(\s*\n\s*<label className="group-toggle">/)
})

test('#281: UNGROUPED, the brand owner survives as a column — the issue rejects dropping it', () => {
  assert.match(CLEARANCES, /const showOwnerColumn = groupable && !groupByOwner/)
  assert.match(CLEARANCES, /\{showOwnerColumn \? <th>Brand owner<\/th> : null\}/)
  // Every row SHAPE needs the cell, or the grid built stops lining up: the mark row, the family
  // row, and a spacer on the read row.
  assert.equal((CLEARANCES.match(/\{showOwner \? \(/g) || []).length, 2, 'mark row and family row both carry an owner cell')
  assert.match(CLEARANCES, /\{showOwner \? <td \/> : null\}/, 'and the read row carries a spacer')
})

test('#281: grouping is not silently applied under a sort any more', () => {
  // The fault: sorts only ever ordered rows WITHIN an owner block, and nothing on screen said so. With
  // forty rows across six owners, "sort by Risk" produces six risk-ordered lists and reads as broken.
  assert.match(CLEARANCES, /if \(grouped && a\.account !== b\.account\) return a\.account\.localeCompare\(b\.account\)/,
    'the owner-first sort is still there — but now only when the toggle says so')
})
