// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The engine's prose, read by the portal the way the reports read it — and never as HTML.
//
// put a model-authored assessment paragraph on a client screen for the first time. Two properties
// have to hold at once, and they pull against each other:
//
//   • IT RENDERS LIKE THE REPORT DOES. The model writes markdown because every surface it feeds renders
//     markdown; `render-knockout.mjs` gained its own `inlineMd` after a delivered summary printed
//     "rates **High**" with the asterisks showing. A portal that showed the asterisks would be the same
//     defect on the surface next door.
//   • IT IS NEVER MARKUP. The paragraph is model-authored and arrives over the wire, so an HTML path
//     here is a stored-XSS path onto a client's legal opinion. no-danger.test.ts closes that door for
//     the bundle; this file is why the door does not need to be opened to satisfy the first property.
//
// The parity test below reads the DRIVER's renderer and asserts the two agree. That is the same
// discipline productMatrix.test.ts applies to the product table: two implementations of one rule drift,
// and the drift is invisible until a client is looking at both.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inlineSpans } from '../src/contract/inlineMd.ts'
import type { InlineSpan } from '../src/contract/inlineMd.ts'
// @ts-expect-error — the driver is plain .mjs with no types; this is a parity read, not an API.
import { inlineMd } from '../../driver/publish/render-knockout.mjs'

// The portal's spans, rendered to the DRIVER's markup, so the two can be compared as strings. This is
// the only place in the portal that ever composes HTML, it is in a test, and nothing ships it.
const TAG = { strong: ['<b>', '</b>'], em: ['<i>', '</i>'], code: ['<span class="mono">', '</span>'] } as const
// `esc` in render-knockout.mjs, character for character — INCLUDING the quote, which it escapes
// because it builds attribute-safe HTML. The portal escapes nothing: a span is a text node and a browser
// shows `"` as `"`. Getting this wrong made the parity test report a divergence that was the test's, on
// a sentence containing an ordinary pair of quotation marks.
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const asHtml = (spans: readonly InlineSpan[]) =>
  spans.map((s) => (s.style ? `${TAG[s.style][0]}${esc(s.text)}${TAG[s.style][1]}` : esc(s.text))).join('')

test('the three forms the reports honour are the three forms this reads', () => {
  assert.deepEqual(inlineSpans('IRONWHISK rates **Medium** for 9.'), [
    { text: 'IRONWHISK rates ', style: null },
    { text: 'Medium', style: 'strong' },
    { text: ' for 9.', style: null },
  ])
  assert.deepEqual(inlineSpans('a *b* c'), [
    { text: 'a ', style: null },
    { text: 'b', style: 'em' },
    { text: ' c', style: null },
  ])
  assert.deepEqual(inlineSpans('use `x` here'), [
    { text: 'use ', style: null },
    { text: 'x', style: 'code' },
    { text: ' here', style: null },
  ])
  // Plain prose is one span, not a character-by-character walk.
  assert.deepEqual(inlineSpans('nothing marked up at all'), [{ text: 'nothing marked up at all', style: null }])
})

test('BOLD WINS OVER ITALIC, because the reports resolve it that way', () => {
  // `**Medium**` read as two italics would render the inner word in italics between two stray asterisks.
  // The driver gets this right by replacing bold FIRST; this gets it right by ordering the alternation.
  assert.deepEqual(inlineSpans('**Medium**'), [{ text: 'Medium', style: 'strong' }])
})

test('MARKUP IN THE PROSE IS PROSE — it is never a style, and never a tag', () => {
  // The property that matters most on this surface. The paragraph is model-authored and arrives from
  // the wire; a screen that turned this into elements would be running a stored script inside a client's
  // report. One plain span means React renders one text node, which the browser shows as characters.
  const spans = inlineSpans('<script>alert(1)</script> & <b>bold</b>')
  assert.deepEqual(spans, [{ text: '<script>alert(1)</script> & <b>bold</b>', style: null }])
  assert.equal(spans.every((s) => s.style === null), true, 'no span claims a style it was not given')
  // And nothing in the parser's output is markup: the text is returned exactly as it arrived, so the
  // renderer has nothing to un-escape and no branch that could.
  assert.equal(spans.map((s) => s.text).join(''), '<script>alert(1)</script> & <b>bold</b>')
})

test('an unmatched marker stays visible, because it is somebody’s sentence', () => {
  // Swallowing the character would silently edit a client's document. `2 * 3` is a multiplication.
  assert.deepEqual(inlineSpans('2 * 3 = 6'), [{ text: '2 * 3 = 6', style: null }])
  assert.deepEqual(inlineSpans('an **unterminated run'), [{ text: 'an **unterminated run', style: null }])
  assert.deepEqual(inlineSpans('a `dangling tick'), [{ text: 'a `dangling tick', style: null }])
})

test('the round trip loses nothing: every character comes back', () => {
  // A parser that drops text is the failure nobody notices — a sentence renders, slightly shorter. The
  // markers themselves are consumed by design; everything between them is not.
  for (const s of ['plain', '**a** b *c* d `e` f', 'a**b**c', '<x> & **y**', '']) {
    const joined = inlineSpans(s).map((x) => x.text).join('')
    assert.equal(joined, s.replace(/\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`/g, '$1$2$3'),
      `${JSON.stringify(s)}: only the markers are consumed`)
  }
})

test('PARITY: the portal and the report render the same paragraph the same way', () => {
  // Read off the DRIVER's own renderer, so a change to how reports render inline markdown fails here
  // rather than by a client noticing two surfaces disagree about one sentence.
  const corpus = [
    'IRONWHISK rates **Medium** for Classes 9 and 42.',
    'CLUVENDRA rates Manageable — no exact-name use of the plural compound surfaced.',
    'a *soft* qualification and a `literal` term',
    '**Bold** at the start, and at the end **bold**',
    'a**b**c with no spaces around it',
    '<script>alert(1)</script> & an ampersand',
    '2 * 3 = 6 and an ** unterminated pair',
    'quotes "like this" and an em dash — kept',
    '',
  ]
  for (const s of corpus) {
    assert.equal(asHtml(inlineSpans(s)), inlineMd(s), `the two renderers disagree on ${JSON.stringify(s)}`)
  }
})

test('the ONE divergence is declared, not discovered', () => {
  // Nested emphasis. The report's italic pass runs over a string that already carries the bold pass's
  // tags, so `***x***` becomes italic-bold there; this parser reads one span at a time and cannot cross
  // that boundary, so it gives bold between two literal asterisks.
  //
  // Pinned rather than fixed: the composer does not write nested emphasis, matching it would mean
  // reproducing a string-replacement pipeline whose whole purpose here was to be replaced by something
  // that cannot emit markup, and an undeclared difference is the thing that actually costs a reader.
  // If the composer starts writing it, this test is what says so.
  assert.equal(inlineMd('***x***'), '<i><b>x</b></i>', 'the report nests it')
  assert.deepEqual(inlineSpans('***x***'), [
    { text: '*', style: null },
    { text: 'x', style: 'strong' },
    { text: '*', style: null },
  ], 'the portal does not, and shows the outer markers rather than dropping them')
  assert.notEqual(asHtml(inlineSpans('***x***')), inlineMd('***x***'),
    'this is the divergence — asserted so that closing it fails here and is noticed')
})
