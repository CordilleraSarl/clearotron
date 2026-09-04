// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Two claims the screens make about money and about privacy, pinned as text.
//
// WHY THIS IS A SOURCE-TEXT TEST AND NOT A RENDER TEST, stated up front so nobody replaces it with a
// weaker thing thinking they are modernising it. This package runs `node --test` over `.test.ts` with
// Node's built-in type stripping (see package.json) and carries no jsdom and no React test renderer.
// Node cannot import `.tsx` at all — it has no JSX transform, and the import fails with "Unknown file
// extension .tsx" — so a test in this runner cannot mount either screen. The choices were: add a DOM
// toolchain to assert on two paragraphs, extract the copy into a `.ts` module purely so a test could
// reach it, or read the source. no-danger.test.ts already established the third for the same reason,
// and this file follows it.
//
// The limits of that are real and worth naming rather than papering over: these assertions prove a
// string is present in a file and that a branch exists in it. They do not prove the string reaches the
// screen, and a determined refactor could satisfy every one of them while rendering nothing. What they
// DO catch is the regression each fix was for — someone re-widening the blur claim, or someone deleting
// the failure branch as dead code because the happy path never reaches it. Both are edits a reviewer
// makes in good faith, and both are silent.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PRODUCT_IDS } from '../../driver/products.mjs'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')

const PREFERENCES = read('../src/screens/Preferences.tsx')
const NEW_CLEARANCE = read('../src/screens/NewClearance.tsx')
const RESULT = read('../src/screens/Result.tsx')
const PEOPLE_ACCESS = read('../src/screens/PeopleAccess.tsx')
const PROFILE = read('../src/screens/Profile.tsx')
const PROJECTS = read('../src/screens/Projects.tsx')
const SAVED_SEARCHES = read('../src/screens/SavedSearches.tsx')

// Everything below the header comment. Both screens carry long WHY comments that quote the very copy
// they are explaining — the header of Preferences.tsx says the words "on a report" while telling you
// the claim was wrong — so a naive search over the whole file matches the explanation and passes on a
// screen that still lies to the user. The prose has to be tested separately from the commentary.
const body = (src: string) =>
  src
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
    .join('\n')

// ── the screen-share blur ────────────────────────────────────────────────────────────────────────

test('Preferences does not claim a per-name blur INSIDE a report', () => {
  // History, because the wording still matters after the mechanism changed. The old sentence read "in
  // the lists, on a report, and here" and meant the names within the document — which was never
  // possible: the frame is sandboxed without allow-same-origin (Result.tsx), so the document has a null
  // origin, no rule here applies inside it, and the report renderer emits no `data-anon` of its own.
  //
  // A report IS covered now, but only as a whole, by blurring its container. "On a report" would still
  // describe the thing that cannot be done, so it stays out.
  const prose = body(PREFERENCES)
  assert.doesNotMatch(
    prose,
    /on a report/,
    'a report blurs whole or not at all — the screen must not imply the names inside it blur individually',
  )
})

test('THE BLUR CLAIM IS BACKED BY THE MARKUP THAT IMPLEMENTS IT', () => {
  // This is the test that matters, and the one the original pair was missing.
  //
  // The defect was never really the wording — it was that the wording was free to say anything, because
  // nothing tied it to the code. First the screen claimed a coverage it did not have; the fix could
  // just as easily have been a second claim with the same problem. So the promise is asserted TOGETHER
  // WITH the one line of markup that makes it true: the `data-anon` tag on the report frame's
  // container, which is what a CSS filter needs an ancestor to carry.
  //
  // Delete that attribute and this fails, even though Preferences.tsx still reads perfectly.
  assert.match(
    body(RESULT),
    /<div data-anon="mark"[^>]*>\s*$/m,
    'the report frame container is tagged — without this the blur stops at the frame edge',
  )
  assert.match(body(PREFERENCES), /and the report itself/, 'and the screen promises exactly that coverage')
})

test('Preferences warns that a report blurs WHOLE, which is not what a reader would guess', () => {
  const prose = body(PREFERENCES)

  // A report cannot be blurred name-by-name: null origin, no per-name markup, nothing this page can
  // tag. It goes grey entirely. Someone expecting only the names to soften will read a working control
  // as a broken one and switch it off — at which point the feature has failed in the exact situation it
  // exists for. So the surprising part is stated, not buried.
  assert.match(prose, /blurs completely|blurs all of it/i, 'the whole-document behaviour is disclosed')
  assert.match(prose, /deliberate/i, 'and named as a choice, so it does not read as a fault')

  // What is covered is still claimed plainly, because it is true and it is why the feature exists.
  assert.match(prose, /blurs every brand name, mark and brand owner/, 'the promise is still made')
})

test('Preferences keeps the report boundary factual rather than apologetic', () => {
  // A banner that apologised for how the report rendered was deleted. The same reasoning applies to
  // this paragraph: a client is being told a fact about where a tool stops, not receiving a regret.
  const prose = body(PREFERENCES)
  assert.doesNotMatch(prose, /\bsorry\b|\bunfortunately\b|\bapolog/i, 'state the boundary, do not apologise for it')
})

// ── the composer with no depth options ───────────────────────────────────────────────────────────

test('NewClearance answers a refused searches call instead of drawing a dead form', () => {
  // The defect: `levels` fell back to `[]` on any non-ok result, so How deep? rendered as an empty box
  // with no options and no explanation. The guard has to key off the RESULT KIND — an ok response that
  // genuinely carries zero levels is a different state and must not be reported as a failure.
  assert.match(
    NEW_CLEARANCE,
    /searches\.kind !== 'ok'/,
    'the failure branch is entered on a non-ok result, not on an empty level list',
  )
  assert.match(NEW_CLEARANCE, /function OptionsUnavailable/, 'and there is something to render when it is')

  // A first load with nothing back yet is not a failure; it is also not a form. Without this the empty
  // How deep? box flashes on every load, which is the failure state's own appearance.
  assert.match(NEW_CLEARANCE, /if \(!searches\) return/, 'loading is distinguished from failing')
})

test('the composer failure says nothing was started and nothing was charged', () => {
  // This is the only screen in the portal that can spend money, and it broke on the request that draws
  // it. A user cannot tell from a broken screen whether it broke before or after a run began, so the
  // answer is given rather than left to be inferred. Same fact, same words portal-service uses on the
  // run door's own 502.
  assert.match(
    NEW_CLEARANCE,
    /[Nn]othing has been started and nothing has been charged/,
    'the money question is answered outright on the screen that can spend',
  )

  // Both branches of the failure say it — a rate limit is still a user staring at a clearance screen
  // that will not open, and "try again in a minute" alone does not tell them their account is untouched.
  const started = NEW_CLEARANCE.match(/[Nn]othing has been started and nothing has been charged/g) ?? []
  assert.ok(started.length >= 2, 'the rate-limited branch says it too, not just the general failure')

  assert.match(NEW_CLEARANCE, />\s*Try again\s*</, 'and there is a retry, since this screen does not poll')
  assert.match(NEW_CLEARANCE, /onRetry=\{retrySearches\}/, 'wired to the loader rather than decorative')
})

test('the composer failure names no internal cause and echoes no server string', () => {
  const fn = NEW_CLEARANCE.slice(NEW_CLEARANCE.indexOf('function OptionsUnavailable'))
  const prose = fn.slice(0, fn.indexOf('\n/**', 1))

  // `explain` renders r.message for the plan and run calls because portal-service authors those
  // strings for a client. The `upstream` shape on the searches call can instead be minted in the
  // browser from a failed fetch, where the message is the browser's own ("Failed to fetch"). Echoing it
  // here puts unreviewed, internal-sounding text on a client's screen.
  assert.doesNotMatch(prose, /\{\s*(r|result|searches)\.message\s*\}/, 'no server or browser string is echoed')

  // The house rule for client-facing copy: no env vars, no paths, no service or engine names.
  for (const leak of [/[A-Z][A-Z0-9]*_[A-Z0-9_]+/, /portal-service|profile-service|recipe-service/i, /\.mjs\b/, /\/portal\/api\//]) {
    assert.doesNotMatch(prose, leak, `client copy must not carry ${String(leak)}`)
  }
})

// ── the composer coherence pass · the blocker, the explanation, the matrix ───────────────────────
//
// JSX WRAPS ITS PROSE ACROSS LINES, so a sentence pinned with literal spaces would be a test about
// where the formatter broke the line. `flat` normalises whitespace first; the words are what is pinned.

const flat = (src: string) => src.replace(/\s+/g, ' ')

test('the picker states, AT each row, what that search accepts and what it costs to pick it', () => {
  // The badge and the "Modified from …" line went with the templates. They existed because the screen
  // could not name what the levers had produced, so it had to explain how you got there instead. It
  // names the product now, and every figure beside it is the SERVER'S — a tagline reading "up to 20
  // names" over an eight-name wall is what this row used to carry.
  const prose = flat(body(NEW_CLEARANCE))
  assert.match(prose, /\{levels\.map\(\(t\) => \( <PickRow/, 'the picker is built from the fetched offering')
  assert.match(prose, /up to \$\{t\.maxNames\} name/, 'the name count is the server’s figure')
  assert.match(prose, /\$\{t\.geography\}/, 'and so is the geography it accepts')
  assert.doesNotMatch(prose, /TEMPLATES|matchTemplate|templateDiff|badge-custom/, 'the templates are gone, not hidden')
})

test('an unavailable search is not silently greyed — the reason rides IN the row', () => {
  // The house rule: nothing greyed out without the reason visible at the control. A disabled row with
  // no sentence cannot be told from a bug, and a row that vanishes leaves a client unable to ask for a
  // product that exists.
  const prose = flat(body(NEW_CLEARANCE))
  assert.match(prose, /unavailableNote=\{t\.available \? null : \(t\.unavailableNote/, 'passed per row')
  const src = body(NEW_CLEARANCE)
  const start = src.indexOf('function PickRow')
  const end = src.indexOf('\n}', src.indexOf('return (', start))
  const fn = flat(src.slice(start, end))
  assert.match(fn, /Not available here<\/b> — \{unavailableNote\}/, 'and rendered inside the row itself')
  assert.match(fn, /disabled=\{off\}/, 'the control is genuinely dead, not merely styled dead')

  // ── — AND IT IS LEGIBLE. ────────────────────────────────────────────────
  //
  // The rule above held and the reason was still invisible: it rendered at `--text-faint`, the faintest
  // token in the palette, under a description already in `--text-muted`, on a disabled row. The owner
  // looked straight at it and reported no message — "yea totally invisible". A reason nobody can read
  // is the state the rule was written to prevent, so the arm now measures the rendering as well as the
  // presence.
  assert.doesNotMatch(fn, /text-faint[^}]*\}\}>\s*\n?\s*(<b>)?Not available here/,
    'the unavailable reason is back in the faintest token on the page')
  assert.match(fn, /className="pick-row-why"/, 'the reason lost its own class, so its contrast is unpinned')

  // The disabled row must LOOK disabled. `pick-row-off` was applied by this component with no rule
  // anywhere in the stylesheet, so a dead row rendered identically to a live one.
  const css = readFileSync(new URL('../src/base.css', import.meta.url), 'utf8')
  assert.match(css, /\.pick-row-off\s*\{/, 'the disabled row has no style of its own — it looks pickable')
  assert.match(css, /\.pick-row-why\s*\{/, 'the reason has no style of its own')
  // NOT by opacity: it composites through to the children and would wash out the sentence this whole
  // arm is about. Every other disabled control on this page is dimmed that way, which is the mistake
  // that is easy to make here.
  const offBlock = css.slice(css.indexOf('.pick-row-off {'), css.indexOf('}', css.indexOf('.pick-row-off {')))
  assert.doesNotMatch(offBlock, /opacity/, 'the row is dimmed by opacity, which dims the reason with it')
})

test('2075 a product the register cannot fully reach is ORDERABLE, with the limit at the control', () => {
  // The owner's ruling: coverage is disclosed, never refused. "A user could still run global and just
  // be aware of the limitations — I prefer that than switch it off." So the row carries a second kind of
  // sentence, and the two are never both set: one explains a dead control, the other qualifies a live
  // one. Rendering them the same way is what made the first invisible.
  const src = body(NEW_CLEARANCE)
  const start = src.indexOf('function PickRow')
  const fn = flat(src.slice(start, src.indexOf('\n}', src.indexOf('return (', start))))
  assert.match(fn, /!off && coverageNote/, 'the coverage note renders on a row that cannot be picked, or not at all')
  assert.match(fn, /className="pick-row-coverage"/)
  assert.match(flat(src), /coverageNote=\{t\.available \? t\.coverageNote : null\}/,
    'the note is not passed per row from the server payload')
})

test('the comparison is offered, inside the collapsible this screen already has', () => {
  // Picking one of four needs comparing four. The delta view that used to sit here priced a LEVER MOVE
  // and there are no levers; what a client asks is "am I buying the right one", which is a table.
  const prose = flat(body(NEW_CLEARANCE))
  assert.match(prose, /<Details summary="Detailed search comparison table for information">/)
  assert.match(prose, /<ProductMatrix products=\{levels\} currentKey=\{activeBase\} \/>/,
    'fed the fetched payload, and told which one is picked')
  assert.doesNotMatch(prose, /DeltaView|levelDelta/, 'the lever-move pricer is deleted, not left unrendered')
})

/** LevelMatrix's own markup. Bounded by the Details component that follows it — an unfound index would
 *  yield an empty slice, and every assertion below would pass on nothing at all. */
const productMatrixFn = () => {
  const src = body(NEW_CLEARANCE)
  const start = src.indexOf('function ProductMatrix')
  const end = src.indexOf('function Details', start)
  assert.ok(start > 0 && end > start, 'ProductMatrix is bounded by the Details component that follows it')
  return src.slice(start, end)
}

test('the matrix reuses the shipped design system and introduces no new vocabulary', () => {
  // Strictly the existing table, the existing hint, existing tokens. A new class here is a visual
  // decision taken in a component instead of in the design system.
  const fn = productMatrixFn()
  assert.match(fn, /className="table-wrap"/, 'the wrapper that scrolls a wide table instead of the page')
  assert.match(fn, /<table className="data">/)
  assert.match(fn, /className="section-hint"/, 'the unavailable note is the screen’s own quiet line')
  assert.doesNotMatch(fn, /className="(?!table-wrap|data|section-hint)/, 'no class this screen did not already have')
})

test('the matrix puts no engine vocabulary and no money on a client’s screen', () => {
  const fn = productMatrixFn()
  // THE PRODUCT IDS ARE DERIVED, not hand-listed. A regex naming today's internal keys keeps passing
  // while a new one walks straight through — which is exactly how the old scan (`prelim-jx|
  // knockout-register|…`) would have behaved the day those keys stopped existing.
  for (const leak of [
    /jxLanes|commonLawGrid|registerProbe/,
    new RegExp(PRODUCT_IDS.join('|')),
    /prelim-jx|knockout-register|prelim-register-only|Depth \d/,
    /[A-Z][A-Z0-9]*_[A-Z0-9_]+/,
    /[$€£]/,
  ]) {
    assert.doesNotMatch(fn, leak, `the matrix must not carry ${String(leak)}`)
  }
})

test('nothing is left set-but-hidden — switching product DROPS what the new one cannot hold', () => {
  // There used to be two "set aside" notes on this screen, for a case-law lever and for script chips
  // that survived in the draft while the levers said they could not run. Both existed because state
  // outlived the control that showed it. `chooseProduct` drops it instead, which is the only version of
  // this that cannot be got wrong: a field nobody can see is a field that gets sent.
  const prose = flat(body(NEW_CLEARANCE))
  assert.match(prose, /chooseProduct\(draft\.pick, t\)/, 'every product change goes through the drop')
  assert.doesNotMatch(prose, /set aside/, 'and there is no hidden-but-set state left to explain')
})

test('Save is offered only for a draft that can actually run', () => {
  // `composeSaved` returns null for levers that name no level, and this is the gate in front of
  // it: the button is not rendered while blockers() has anything to say. Pinned because the two halves
  // are in different files — a gate that quietly stopped reading `stops` would put a Save control on a
  // draft the same screen is refusing, and only the contract's null would catch it, one layer too late.
  assert.match(flat(body(NEW_CLEARANCE)), /canSave=\{!draft\.savedSearch && !stops\.length\}/)
})

test('there is no case-law control at all, because case law is not a setting', () => {
  // The lever used to render on every clearance while the comparison table beside it printed "Not
  // available" in the knockout column, and `bodyFor` sent `caseLaw: true` anyway — three answers to one
  // question. Case law is what a Full country search IS, so the screen STATES it and offers nothing to
  // press, and the request cannot carry a flag the engine now refuses outright.
  const prose = flat(body(NEW_CLEARANCE))
  assert.doesNotMatch(prose, /<Lever label="Case law"/, 'no control')
  assert.match(prose, /Case law and oppositions — \$\{activeLevel\?\.caseLaw \? 'part of this search'/,
    'stated from the product row, so it can never disagree with what runs')
  // §B — and the MARKER comes off the same field as the sentence. A tick over
  // "not part of this search" is a worse defect than no tick at all, so the boolean is the one input.
  assert.match(prose, /in: Boolean\(activeLevel\?\.caseLaw\)/,
    'the tick/cross is set beside the sentence rather than derived from the same field')
  const start = NEW_CLEARANCE.indexOf('const bodyFor')
  const end = NEW_CLEARANCE.indexOf('const explain', start)
  assert.ok(start > 0 && end > start, 'bodyFor is bounded by the explain helper that follows it')
  assert.doesNotMatch(flat(NEW_CLEARANCE.slice(start, end)), /caseLaw/, 'and nothing about it reaches the wire')
})

test('the ONE toggle in the offering is drawn only where it is a choice', () => {
  // Three states, three treatments: a switch where it is offered, a SENTENCE where it is automatic, and
  // nothing at all where it is not sold — never a greyed switch, which invites a click and answers
  // nothing. And only the first sends anything.
  const prose = flat(body(NEW_CLEARANCE))
  assert.match(prose, /\{nativeControl === 'toggle' \? \(/)
  assert.match(prose, /label="Native-language investigation"/)
  assert.match(prose, /: nativeControl === 'automatic' \? \(/)
  assert.match(prose, /searched automatically — it is part of this search, not something to switch on/)
  const start = NEW_CLEARANCE.indexOf('const bodyFor')
  const end = NEW_CLEARANCE.indexOf('const explain', start)
  assert.match(flat(NEW_CLEARANCE.slice(start, end)),
    /!draft\.savedSearch && nativeControl === 'toggle' && draft\.pick\.nativeLanguage \? \{ nativeLanguage: true \}/)
})

test('the wire STATES its geography mode — everywhere and silence are different searches', () => {
  const start = NEW_CLEARANCE.indexOf('const bodyFor')
  const end = NEW_CLEARANCE.indexOf('const explain', start)
  const fn = flat(NEW_CLEARANCE.slice(start, end))
  assert.match(fn, /geography: \{ mode: geographyFor\(draft\.pick\)\.mode \}/,
    'without it, a screen promising worldwide runs the account’s own territories and nothing disagrees')
})

test('the saved-search notice does not claim to fix the scope, because it does not', () => {
  // A recipe stores a scope, so the notice said it decided "where it points" — but the saved
  // territories do not steer the run (driver/jx-lanes.mjs scopes off the request and the account's own
  // defaults). The sentence invited an empty Where and then the one-country blocker sent the user
  // looking for a control the notice had told them not to touch.
  const prose = flat(body(NEW_CLEARANCE))
  assert.match(prose, /This custom search carries its own set-up/)
  assert.doesNotMatch(prose, /how deep the search goes and where it points/, 'the claim is gone')
  assert.match(prose, /Where, below, is still yours to set — the custom search does not fix it/)
})

test('the gates read the request that will be SENT, not the levers behind the notice', () => {
  const prose = flat(body(NEW_CLEARANCE))
  // …and the NAME COUNT is one of those gates now. It used to be a local `overBudget` beside this call,
  // so "may this run?" was answered in two places and levelDelta reproduced it in a third. One
  // predicate (nameBudget), read by blockers here and by the NameWall that offers the way out.
  assert.match(prose, /blockers\(draft\.pick, activeLevel, names\.length\)/,
    'measured against the product that will RUN — a saved search carries its own')
  assert.match(prose, /nameBudget\(activeLevel, names\.length\)/, 'the wall reads the same predicate the gate does')
  assert.doesNotMatch(prose, /names\.length > activeLevel\.maxNames/, 'no second answer to the budget question')
})

test('the DescribeIt comment no longer claims the brief travels with the request', () => {
  // ASSERTED AGAINST THE FULL SOURCE, COMMENTS INCLUDED — the opposite of every other test in this
  // file, and deliberately, because here the defect WAS a comment. `bodyFor` has never sent
  // `draft.brief`; a header saying it rides along as the user's instructions taught every later reader
  // something false about the one screen that can spend money.
  assert.doesNotMatch(NEW_CLEARANCE, /(?:rides|travels) with the request/i, 'the false claim is gone')
  // The word "instructions" is legitimate here — `upfrontInstructions` carries the "Anything we should
  // know?" box, a field the user fills in deliberately — so the pin is on the CLAIM, not the word.
  assert.match(NEW_CLEARANCE, /upfrontInstructions/, 'the field that DOES travel is untouched')

  // And the claim is pinned together with the code that makes it true, the same way the blur promise
  // is: sending the brief is a product-owner decision, deliberately not taken, so bodyFor must not grow it.
  const start = NEW_CLEARANCE.indexOf('const bodyFor')
  const end = NEW_CLEARANCE.indexOf('const explain', start)
  assert.ok(start > 0 && end > start, 'bodyFor is bounded by the explain helper that follows it')
  assert.doesNotMatch(NEW_CLEARANCE.slice(start, end), /draft\.brief/, 'the brief still does not travel')
  assert.match(NEW_CLEARANCE, /owner decision, and it is\s*\*?\s*deliberately not taken/, 'and the comment says whose decision that is')
})

// ── People & access · what the screen claims about roles ─────────────────────────────────────────

test('the access screen names both real roles, from the brand seam', () => {
  // WHAT THIS NO LONGER REQUIRES, and it is a real loss rather than a tidy-up.
  // The page used to disown "operator" and "reader" by name — vestigial roles designed as per-user
  // roles inside a tenant and never built, which no code path reads. The owner's copy pass removed that
  // footnote, so a staff member who has heard the pair named is no longer told on the screen which of
  // the two is true. Flagged on the issue; his wording is the acceptance and it ships.
  //
  // What still holds is the half that is about the roles that DO exist, and it is asserted below.
  const prose = body(PEOPLE_ACCESS)
  // TWO ASSERTIONS, because the positive one is weak on its own: this file reads SOURCE TEXT, so
  // matching the helper call passes as long as the call exists anywhere. The property actually
  // buys is the ABSENCE of the hardcoded operator name, so that is asserted directly beside it.
  assert.match(prose, /staffLabel\(/, 'the staff role is named FROM THE BRAND SEAM')
  assert.doesNotMatch(prose, /Cordillera/,
    'and never as a literal — a fork must not tell its users they are staff of a firm they have never heard of')
  assert.match(prose, /Client/, 'the client role is named')
})

test('the screen does not claim anyone can change access from the browser', () => {
  // The page is read-only by a deliberate decision, not an unfinished one. Copy that implied a control
  // exists would send a reader hunting for it.
  const prose = body(PEOPLE_ACCESS)
  // — the owner's wording, which says this more plainly than "a production change"
  // did. The property is unchanged and still asserted: the page must not imply a control it does not
  // have. It also NAMES the command now, so a reader sent to a CLI is not sent to an unnamed one.
  assert.match(prose, /not currently configurable via the UI/, 'the page says the control is not here')
  assert.match(prose, /clearotron grant/, 'and names the command that does it, rather than "use the CLI"')
})

test('the activity panel says absence is not evidence of missing access', () => {
  // The failure this guards is someone reading a short "Seen recently" list as an access roster and
  // concluding a colleague has been locked out.
  const prose = body(PEOPLE_ACCESS)
  assert.match(prose, /still has access/, 'the disclaimer is present in the rendered copy')
  assert.ok(prose.includes('!v.available'), 'and the unavailable branch exists rather than being dead-coded away')
})

// ── the brand profile, after the rebuild dropped most of it ─────────────────────────────────────────
//
// The React rebuild condensed the brand-profile page down to its editable fields plus a single row
// naming the rating framework. Four things the old staff editor rendered went missing: which framework
// is IN FORCE and its band ladder, what those bands MEAN, the context pack, and the derived coverage
// figure. Three of the four were still arriving in the payload and simply not being drawn.
//
// Same source-text caveat as the tests above: these prove the branch exists in the file, not that it
// paints. What they catch is the regression that already happened once — a rewrite that keeps the data
// flowing and quietly stops rendering it.

test('the framework block still renders the whole method, not just its title', () => {
  const fn = frameworkBlock()
  for (const [claim, re] of [
    ['custom vs house is stated', /Custom framework:|House default/],
    ['the band ladder is drawn', /bands\.map/],
    ['band meanings are drawn', /bandMeanings|meanings\.map/],
    ['the axes it rates on', /axes\.join/],
    ['the entity it speaks as', /entity_label/],
    ['the deck of record', /source_deck/],
  ] as const) {
    assert.match(fn, re, `${claim} — the rebuild lost this once already`)
  }
})

test('deck-derived prose is marked for the demo privacy blur', () => {
  // The risk-framework decks are Privileged & Confidential. The old page wrapped every line lifted from
  // one in data-anon="mark" so the demo blur covered it; a restoration that forgets this shows a client's
  // deck prose to a pitch audience.
  const fn = frameworkBlock()
  const meanings = fn.slice(fn.indexOf('What the bands mean'))
  assert.match(meanings, /data-anon="mark"/, 'band meanings are blurred in demo mode')
  // The Source-deck row is GONE: frameworkView withholds source_deck from every
  // role, so there is no deck name left to blur — and this arm now REFUSES its return: a restored row
  // would re-render provenance on a client-facing surface.
  assert.equal(fn.indexOf('Source deck'), -1, 'the provenance row must not return to this page')
})

test('the context pack is EDITABLE at BOTH levels, not merely round-tripped', () => {
  // It rode along as `contextPack: loaded.contextPack` — loaded, posted straight back, never shown.
  // Nothing was lost on disk, which is exactly why it went unnoticed. The save must send the state the
  // user can actually type into.
  //
  // The PROJECT level had the same defect and kept it a release longer: the pre-React portal had a
  // "Project background & concerns" field, the rebuild dropped the control and kept the pass-through, and
  // the one project in production ended up with doctrine the engine reads and nobody could edit.
  assert.match(PROFILE, /<ContextPackEditor/, 'the brand owner has the editor')
  assert.match(PROFILE, /contextPack:\s*pack\b/, 'and its save sends the edited value')
  assert.doesNotMatch(PROFILE, /contextPack:\s*loaded\.contextPack/, 'not the untouched loaded copy')
  assert.match(PROFILE, /pack !== loaded\.contextPack/, 'a pack edit counts as dirty')

  assert.match(PROJECTS, /<ContextPackEditor/, 'and so does the project')
  assert.match(PROJECTS, /contextPack:\s*pack \?\? detail\.contextPack/, 'its saves send the edited value')
  assert.doesNotMatch(PROJECTS, /contextPack:\s*detail\.contextPack,/, 'no path posts the untouched copy')
  assert.match(PROJECTS, /pack !== detail\.contextPack/, 'a pack-only edit arms Save')
  // Archiving posts the whole pending draft, so it must carry the pack too or it silently reverts it.
  assert.match(PROJECTS, /archived: !isArchived[\s\S]{0,400}contextPack:\s*pack \?\?/,
    'archiving does not discard an unsaved pack edit')
})

test('ONE context-pack editor, shared — the two levels cannot describe the same field differently', () => {
  // Two hand-rolled copies would be two places to fix the character budget and two chances to explain the
  // same field in different words on adjacent screens.
  const shared = read('../src/components/ContextPackEditor.tsx')
  assert.match(shared, /CHAR_MAX = 8000/, 'the engine budget lives in one place')
  assert.doesNotMatch(PROFILE, /8000/, 'and neither screen restates it')
  assert.doesNotMatch(PROJECTS, /8000/)
  // The project pack REPLACES the owner's rather than adding to it. Saying "as well as" would be wrong.
  // Re-pointed by 's copy pass: the SENTENCE changed, the fact it guards did not, and
  // the fact is the reason the arm exists. Matched on both halves rather than on one phrase, so a
  // future shortening cannot drop the "not added to it" clause and stay green.
  assert.match(PROJECTS, /Replaces the brand owner's background when set/)
  assert.match(PROJECTS, /it is not added to it/)
})

test('the coverage figure is drawn from `derived`, which was parsed and then ignored', () => {
  assert.match(PROFILE, /<CoverageNote\s+derived=\{loaded\.derived\}/)
  assert.match(PROFILE, /batchSize/)
})

test('both editors treat prose as multi-line — one screen learning it is not enough', () => {
  // riskAppetite is project-editable, so it renders on Projects.tsx too. If only Profile.tsx branches on
  // `prose`, the same paragraph is a textarea on one page and a one-line input on the other.
  for (const [name, src] of [['Profile', PROFILE], ['Projects', PROJECTS]] as const) {
    assert.match(src, /spec\.kind === 'lines' \|\| spec\.kind === 'prose'/, `${name}.tsx renders prose multi-line`)
  }
})

// ── the framework block's LAYOUT, not just its fields ───────────────────────────────────────────────
//
// The first restoration put every field back and still came out unrecognisable, because it rebuilt the
// DATA and dropped the DESIGN: a flex row instead of the aligned grid, faint grey instead of the accent
// section headers, bare text instead of the boxed statement. Fields alone are not the deliverable, so
// the layout gets pinned the same way the copy does — including in base.css, since a class name in the
// TSX proves nothing if the rule behind it is missing.

const BASE_CSS = read('../src/base.css')

/** Just FrameworkBlock's own body. Slicing to end-of-file would drag in Row and Field, which legitimately
 *  use flex, and a `doesNotMatch` over that slice fails on someone else's markup. */
const frameworkBlock = () => {
  const start = PROFILE.indexOf('function FrameworkBlock')
  const end = PROFILE.indexOf('const LABELS', start)
  assert.ok(start > 0 && end > start, 'FrameworkBlock is bounded by the LABELS map that follows it')
  return PROFILE.slice(start, end)
}

test('the band meanings are an ALIGNED GRID, never a flex row', () => {
  const fn = frameworkBlock()
  assert.match(fn, /className="fw-bmrow"/, 'each meaning row uses the grid class')
  // The regression, precisely: a flex row lets every pill size itself, so four bands produce four
  // different left edges for the prose and the ladder reads as a bullet list.
  assert.doesNotMatch(
    fn.slice(fn.indexOf('What the bands mean')),
    /display: 'flex'/,
    'the meanings must not be laid out with flex — that is the ragged version',
  )
  const rule = BASE_CSS.slice(BASE_CSS.indexOf('.fw-bmrow {'))
  assert.match(rule, /display:\s*grid/, '.fw-bmrow is a grid')
  assert.match(rule, /grid-template-columns:\s*104px 1fr/, 'with a fixed pill column and a text column')
})

test('the framework headers carry the accent, not the faint eyebrow', () => {
  const fn = frameworkBlock()
  assert.match(fn, /className="fw-sectionh"/, 'the block header is a section header')
  assert.match(fn, /className="fw-bmh"/, '"What the bands mean" has its own header')
  // The framework decides how every matter for this account is rated. Styling it as 9.5px --text-faint
  // is what made it read as a footnote.
  assert.doesNotMatch(fn, /className="eyebrow"/, 'the faint eyebrow is not used inside this block')
  for (const cls of ['.fw-sectionh {', '.fw-bmh {']) {
    const rule = BASE_CSS.slice(BASE_CSS.indexOf(cls))
    assert.match(rule.slice(0, 260), /color:\s*var\(--text-accent\)/, `${cls} is accent-coloured`)
    assert.match(rule.slice(0, 260), /text-transform:\s*uppercase/, `${cls} is uppercase`)
  }
})

test('which framework is in force is BOXED, not run into the prose', () => {
  const fn = frameworkBlock()
  assert.match(fn, /className="fw-ro"/)
  const rule = BASE_CSS.slice(BASE_CSS.indexOf('.fw-ro {'), BASE_CSS.indexOf('.fw-ro b'))
  assert.match(rule, /background:\s*var\(--surface-sunken\)/, 'filled')
  assert.match(rule, /border:\s*1px solid var\(--border-hairline\)/, 'and bordered')
})

test('the framework block LEADS the page — it is not an appendix to the settings', () => {
  // The framework is prominent, not an afterthought. Position is the claim here, so position is what
  // is asserted: the block must render before the editable field groups, not after them.
  const block = PROFILE.indexOf('<FrameworkBlock')
  const fields = PROFILE.indexOf('FIELD_GROUPS.map')
  const pack = PROFILE.indexOf('<ContextPack')
  assert.ok(block > 0 && fields > 0 && pack > 0, 'all three sections render')
  assert.ok(block < fields, 'the framework comes before the editable fields')
  assert.ok(block < pack, 'and before the context pack')
  assert.equal(PROFILE.split('<FrameworkBlock').length - 1, 1, 'rendered exactly once, not moved by duplication')
})

test('the band pill carries no margin of its own — the grid places it', () => {
  // A margin on the pill fights both the ladder's `gap` and the grid cell, and reintroduces exactly the
  // misalignment the grid exists to remove.
  const fn = PROFILE.slice(PROFILE.indexOf('function BandPill'), PROFILE.indexOf('function FrameworkBlock'))
  assert.doesNotMatch(fn, /margin:/, 'BandPill sets no margin')
  assert.match(fn, /whiteSpace: 'nowrap'/, 'and never wraps mid-label inside its column')
})

test('a custom framework that will not load is NEVER reported as the house default', () => {
  // The defect: `custom && title ? custom : house` collapsed two different states into one answer.
  // Aurora Interactive has frameworkPath set (custom === true) but its manifest lives in the config store, which
  // profile-service could not reach — so title was null and the page told a lawyer their client was
  // rated under Cordillera's house framework. A settings page may render nothing it cannot
  // substantiate; it may never substitute a confident wrong answer for a missing one.
  const fn = frameworkBlock()
  const box = fn.slice(fn.indexOf('className="fw-ro"'), fn.indexOf('fw-ladder'))
  assert.match(box, /custom && title \?/, 'the loaded case is the first branch')
  assert.match(box, /\) : custom \?/, 'and "custom but unreadable" is its OWN branch, not the house fallback')
  assert.match(box, /could not be read/i, 'which says so plainly')
  assert.match(box, /not<\/b> rated\s*\n?\s*under the Generic default|not.{0,40}rated under the Generic/is,
    'and explicitly denies the generic default rather than implying it (term ruled, tracker issue 1990)')
  // Ordering matters: if the house branch came first it would swallow the unreadable case again.
  // The marker for the fallback branch is its heading, which the 1990 sweep renamed. indexOf returns -1
  // for a string that is not there, and `x < -1` is false — so this assertion fails LOUDLY on a rename
  // rather than passing on a branch it can no longer find.
  const fallbackAt = box.indexOf('Generic default')
  assert.ok(fallbackAt > 0, 'the generic-default branch is present under its ruled name')
  assert.ok(box.indexOf(') : custom ?') < fallbackAt, 'the fail-loud branch precedes the generic branch')
})

// ── promises that changed, and must not drift back ──────────────────────────────────────────────────

test('Projects no longer says Cordillera sets them up, because the screen now does', () => {
  // The copy was true while the screen had no create control: it told a client who to ask. With New
  // project on the screen (and on the empty state, which is where a first project is actually made),
  // the same sentence sends them away from the button they are looking at.
  assert.doesNotMatch(body(PROJECTS), /Cordillera sets projects up/i)
  assert.match(body(PROJECTS), /New project/, 'the create control is on the screen')
  // Bounded by the row list that follows the empty branch. NOT by the first `projects.map(` in the
  // file — that one is the `taken={…}` prop above, so slicing to it yields an empty string and the
  // assertion below passes on nothing at all.
  const emptyAt = PROJECTS.indexOf('No projects for this brand owner')
  const listAt = PROJECTS.indexOf('{projects.map(', emptyAt)
  assert.ok(emptyAt > 0 && listAt > emptyAt, 'the empty branch is bounded by the row list that follows it')
  const empty = PROJECTS.slice(emptyAt, listAt)
  assert.match(empty, /New project/, 'and on the empty state, not only above a list that is not there')
})

test('archiving is not described as one-way, now that the row it hides comes back', () => {
  // The warning was honest while a client's archived projects were filtered out of their own list. Both
  // halves of that are gone — the list carries Archive / Bring back, and portal-upstream no longer
  // filters by role. A warning kept past the condition it described is worse than no warning.
  assert.doesNotMatch(body(PROJECTS), /you will not be able to restore it yourself/i)
  assert.doesNotMatch(body(PROJECTS), /Ask Cordillera if you need it back/i)
  assert.match(body(PROJECTS), /Bring back/, 'the control that makes it reversible is on the row')
})

test('Custom searches sends people to the composer and never grows a second editor', () => {
  // The screen used to carry its own depth picker and scope fields — a duplicate of New clearance that
  // stopped receiving the design work New clearance got, which is how "Create one" came to open a page
  // that looked a year older than the rest of the product. One place builds a search.
  assert.match(body(SAVED_SEARCHES), /go\('\/portal\/new'\)/, 'New custom search goes to the composer')
  assert.match(body(SAVED_SEARCHES), /Save as search/, 'and says where the Save control is when you get there')
  for (const gone of ['How deep should it search?', 'Where should it search?', 'Which classes?', 'localProblems', 'toRecipe']) {
    assert.equal(body(SAVED_SEARCHES).includes(gone), false, `the editor's ${gone} must not come back here`)
  }
})

test('Custom searches offers retire AND the way back from it', () => {
  // Retiring lived inside the retired editor, and the list was drawn from the composer's menu, which
  // filters archived rows out server-side. So retiring one made it vanish with no control left to
  // restore it. Both halves are asserted: the right list, and both directions of the control.
  assert.match(body(SAVED_SEARCHES), /api\.savedSearches\(account\)/, 'the config list, which carries `archived`')
  assert.match(body(SAVED_SEARCHES), /Retire/, )
  assert.match(body(SAVED_SEARCHES), /Bring back/)
  assert.match(body(SAVED_SEARCHES), /archived: retired/, 'and it sends the flag explicitly, in both directions')
})

test('no screen prints an account key where a brand owner belongs', () => {
  // The key is a slug ("vantor"); the brand owner is a name ("Vantor Labs"). Every label goes
  // through ctx.ownerName, so a client and a staff member read the same words — which is the whole
  // point, and the kind of thing that reads fine in a screenshot taken from one login.
  const CLEARANCES = read('../src/screens/Clearances.tsx')
  for (const [name, src] of [['Clearances', CLEARANCES], ['Result', RESULT], ['NewClearance', NEW_CLEARANCE]] as const) {
    assert.match(body(src), /ownerName\(/, `${name}.tsx resolves the owner's name`)
  }
  // The raw forms, specifically. `{r.account}` and `{run.account}` in JSX are the exact expressions that
  // put a slug on screen, and they are what a well-meaning refactor reintroduces.
  assert.doesNotMatch(body(CLEARANCES), /\{r\.account\}/)
  assert.doesNotMatch(body(RESULT), /\{run\.account\}/)
})

// ── the interface leads with the NAME ────────────────────────────────────────────────────────────────

test('the review modal leads with the product NAME, not a stage number', () => {
  // THE site this rule exists for: the last thing read before money is spent used to be the bare
  // string "Depth 4", which names our own pricing ladder — and collides with the Depth 4 / Stage 2
  // vocabulary the legal reasoning already uses for something else entirely.
  const prose = flat(body(NEW_CLEARANCE))
  assert.match(prose, /<h2[^>]*>\s*\{plan\.name \|\| plan\.stageLabel\}/,
    'the headline is the name, degrading to the label for an older server')
  assert.match(prose, /\{plan\.stageLabel\}/, 'the rung still rides beside it — the numbering is not retired')
})

test('the review modal shows the effort meter, where the stage number used to be the only scale', () => {
  // `plan.effort` was already on the wire and this step rendered only its turnaround, so the one figure
  // that says how big a search is sat unread at the moment of deciding.
  const prose = flat(body(NEW_CLEARANCE))
  assert.match(prose, /<Row label="Effort">/)
  assert.match(prose, /plan\.effort!\.units/, 'the same 10-bar meter the composer footer draws')
  assert.match(prose, /plan\.effort!\.costBand/, 'and the same 5-dot cost band')
})

test('the matrix header leads with the product’s NAME', () => {
  const fn = productMatrixFn()
  assert.match(fn, /\{c\.name\}/, 'the column head is the name — the same string the report prints')
})

test('#761 the result screen says WHICH PRODUCT is open, and never hardcodes one', () => {
  // A reader holding two finished reads had nothing on this screen telling them apart: the header line
  // was mark · owner · date · band, and the frame's accessible name was a hardcoded product word applied
  // to every run, so a knockout announced itself as a clearance.
  const prose = flat(body(RESULT))
  assert.match(prose, /runProductLabel\(run\.productName, run\.marks\.length\)/,
    'the wire’s resolved name, through the SAME composer the list rows use')
  // THE ACCEPTANCE GREP. A product name hardcoded in the browser is exactly what deleted, and the
  // frame title was the last one left. Checked over the raw source, comments included — a literal that
  // survives in a comment is a literal the next person copies back onto the page.
  assert.doesNotMatch(RESULT, /Clearance report —/, 'no hardcoded product word anywhere in this file')
  // NEVER the rung. On a retired row `stageLabel` is "Depth 2", which is the one thing forbids on a
  // client surface — and it is the tempting fallback for a null product.
  assert.doesNotMatch(prose, /stageLabel/, 'a Depth rung is not a product name')
})

test('no client-facing surface renders a rung as its only label', () => {
  // The regression this guards: eight sites printed the ladder number ALONE. Under Depth 1-5 there is
  // one label field, so the rule is simply that a name is rendered wherever it is — never the rung by
  // itself. Checked by requiring the name beside it in each screen that shows one.
  for (const src of [NEW_CLEARANCE, SAVED_SEARCHES, PROFILE]) {
    const prose = flat(body(src))
    if (!/stageLabel/.test(prose)) continue
    assert.match(prose, /\.name\b/, 'a rung is rendered with no product name anywhere on the screen')
  }
})

// ── marketplaces: why the list cannot be cut, said where the list is ─────────────────────────────────

test('the marketplaces column says what the shops are and where they come from', () => {
  // REWRITTEN TO THE OWNER'S COPY, and two of the four things this used to require
  // are genuinely gone from the screen. Recorded here rather than quietly dropped, because a guard that
  // is relaxed without saying what it stopped covering is how a rule dies:
  //
  //   • "each one you add is another pass per name" — what adding a shop COSTS. Nothing on the screen
  //     says it now. The effort footer still moves (see the arm below), so the cost is visible as a
  //     number and no longer as a sentence.
  //   • "Classes work the other way — they narrow" — the asymmetry with the removable class chips 16px
  //     to the left, which the old comment called "the actual complaint". Nothing says it now.
  //
  // Flagged on the issue. His wording is the acceptance and it ships; what it drops is his to decide.
  const prose = flat(body(NEW_CLEARANCE))
  assert.match(prose, /forced deep dive inherited from Brand Owner and\s+then Project configuration/,
    'says what the shops are and that they are inherited rather than chosen here')
  assert.match(prose, /common law sweeps everything it can find on the\s+open web/,
    'and that the open web is swept anyway, so a reader knows what the list ADDS')
  assert.doesNotMatch(prose, /Always searched — a floor you add to, never remove/,
    'the 11px footnote it replaced is still gone')
})

test('the add control sits beside the chips, and the collapsible no longer hides it', () => {
  const prose = flat(body(NEW_CLEARANCE))
  assert.match(prose, /<Details summary="References and dates \(optional\)">/,
    'the marketplaces field moved out of the three-unrelated-fields collapsible')
  assert.doesNotMatch(prose, /<Details summary="Extra marketplaces/)
  assert.match(prose, /Add more for this search/)
  assert.match(prose, /ctx\.go\('\/portal\/brand\/profile'\)/, 'and the floor is editable in one click')
})

test('extra marketplaces are counted into the effort input, not just sent on the wire', () => {
  // Promoting the control without this would make it a control that changes the search and reports
  // nothing: the engine runs a grid column per extra shop while the footer sits still.
  const prose = flat(body(NEW_CLEARANCE))
  assert.match(prose, /platforms: marketplacesApply \? own\.platforms\.length \+ parseList\(draft\.platforms\)\.length : 0/)
})

// ── the two ways in: which pills are the offering and which are the account's own ────────────────

test("#1435 a saved search on the entry fork sits under its OWN heading, not under the products'", () => {
  // THE DEFECT. The four products and the account's saved searches rendered as one flat row of pills
  // under one heading — "Or start from one of the four searches" — so the heading's own count was wrong
  // for every account that had saved anything, and a customer could not tell which pills were the
  // offering. The one thing separating them was a dashed border, and a border style is not a label: it
  // carries no meaning to somebody who has not been told the convention.
  //
  // WHAT THIS PROVES AND WHAT IT DOES NOT, per this file's header: it proves the heading string is in
  // the source and that the saved pills sit behind a length branch. It does not prove either reaches
  // the browser — `composer-render-check.mjs` is what draws this screen for real, and its
  // `startPills >= 3` is a floor over `.start-pill` that a regrouping like this one leaves intact.
  const prose = flat(body(NEW_CLEARANCE))

  // "Custom searches", not "Saved searches" — 's terminology map settles that noun on the product's
  // own navigation label, and this heading landed carrying the retired one. The criterion states
  // is "a tag, a label, or its own group under its own heading", which is noun-agnostic.
  assert.match(prose, /Custom searches\{' '\}[\s\S]*?· start from one you built/,
    'the saved group has a heading of its own — the acceptance criterion is a LABEL, not a border style')

  // The products heading keeps its count, and it is now true of the group it labels: PRODUCT_IDS is the
  // offering, and only those pills sit under it. Imported rather than hand-typed so a fifth product
  // fails this arm instead of quietly making the heading lie again.
  assert.equal(PRODUCT_IDS.length, 4,
    'the entry-fork heading says "four" — if the offering stops being four, that heading is wrong again')
  assert.match(prose, /Or start from one of the four searches/)

  // NO EMPTY GROUP. An account with nothing saved must see the four products and no orphan heading
  // under them. The branch opens before the saved pills are mapped; that ordering is the checkable part.
  const guard = prose.indexOf('savedSearches.length ?')
  const savedPill = prose.indexOf('start-pill start-pill-saved')
  assert.ok(guard !== -1, 'the saved group is behind a length check')
  assert.ok(savedPill !== -1, 'and there are still saved pills for it to guard')
  assert.ok(guard < savedPill,
    'the length branch opens BEFORE the saved pills — an account with none of them gets no heading')
})

// ── — A DEMO ORDER LANDS ON A REPORT, and the SERVER says so ────────────────
//
// Owner ruling 2026-08-31, revising his own ruling of an hour earlier: pressing New clearance in a demo
// walks the real flow "and then lands on one of the four preloaded finished runs". The greyed control
// that shipped implemented the ruling he replaced.
test('2015 the demo landing is decided by the server, and never claims a run started', () => {
  const src = body(NEW_CLEARANCE)

  // THE SERVER'S ANSWER, not the client's idea of whether it is in a demo. A browser that inferred it
  // would open a report instead of starting a clearance the day the inference went wrong, on the one
  // screen that spends money.
  assert.match(flat(src), /if \(r\.value\.landedOn\) \{/,
    'the composer does not read the landing off the response')
  assert.doesNotMatch(src, /me\.demo|isDemo|PORTAL_DEMO/,
    'the screen decides demo-ness for itself, which is a client inference on the spend path')

  // AND IT DOES NOT SAY THE RUN IS NEW. `Submitted` is the "your clearance has started" panel; the
  // landing must not pass through it.
  const landed = flat(src).slice(flat(src).indexOf('if (r.value.landedOn) {'))
  const untilElse = landed.slice(0, landed.indexOf('setSubmitted'))
  assert.ok(untilElse.length > 20 && untilElse.length < 400, 'the landing branch slice has broken, not the tree')
  assert.doesNotMatch(untilElse, /setSubmitted/, 'a demo order reports itself as a started clearance')
  assert.match(untilElse, /ctx\.go\(`\/portal\/result\//, 'the landing does not open the report it resolved to')
})
