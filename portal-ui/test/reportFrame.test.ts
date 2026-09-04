// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The trust boundary around the report frame.
//
// The embedded report is the one thing on this page the portal does not control: it is a frozen,
// model-adjacent document running its own scripts. It is sandboxed without allow-same-origin, so it
// cannot reach the portal — except through the one door deliberately left open, which is postMessage.
// These tests are that door.
//
// Written as breaches, in the same idiom as driver/test/portal-report.test.mjs: each one names something
// that must not be able to move the layout, and asserts it cannot.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FRAME_TAG,
  MAX_FRAME,
  MIN_FRAME,
  frameCommand,
  readFrameHeight,
  readFrameScroll,
} from '../src/contract/reportFrame.ts'

const height = (h: unknown) => ({ source: FRAME_TAG, type: 'height', height: h })

test('a well-formed height from the frame is accepted', () => {
  assert.equal(readFrameHeight(height(4200), true), 4200)
})

test('A MESSAGE FROM ANYWHERE ELSE IS IGNORED, however well-formed', () => {
  // The whole point. Another frame, an extension, an embedded ad — anything on the page can postMessage
  // to this window, and a byte-perfect message is exactly what a hostile one would look like. Only the
  // caller can tell us it came from OUR frame, and if it did not, nothing else about it matters.
  assert.equal(readFrameHeight(height(4200), false), null)
})

test('a non-numeric height is rejected rather than coerced', () => {
  // Number('') is 0 and Number(' 12 ') is 12. Coercion would let an empty or padded value through as a
  // plausible number, and a frame given height 0 is indistinguishable from a report that failed to load.
  for (const bad of ['4200', '', ' 12 ', null, undefined, true, {}, [], () => 1]) {
    assert.equal(readFrameHeight(height(bad), true), null, `${String(bad)} was rejected`)
  }
})

test('NaN and Infinity are rejected — a layout fed either of them collapses', () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.equal(readFrameHeight(height(bad), true), null, `${String(bad)} was rejected`)
  }
})

test('a message that is not ours is ignored even from our own frame', () => {
  // The report is a document with its own scripts; it may well talk to itself, and a stray message with
  // the wrong tag or type must not be read as a measurement.
  assert.equal(readFrameHeight({ source: 'something-else', type: 'height', height: 900 }, true), null)
  assert.equal(readFrameHeight({ source: FRAME_TAG, type: 'command', height: 900 }, true), null)
  assert.equal(readFrameHeight({ height: 900 }, true), null)
})

test('a non-object payload never throws', () => {
  // postMessage carries anything structured-cloneable. This runs on every message the window receives,
  // so it has to survive the whole space without an exception reaching the listener.
  for (const bad of [null, undefined, 'height', 42, true, Symbol.iterator ? [] : []]) {
    assert.doesNotThrow(() => readFrameHeight(bad, true))
    assert.equal(readFrameHeight(bad, true), null)
  }
})

test('absurd heights are CLAMPED, not rejected', () => {
  // A runaway number is more likely a broken document than a hostile one, and refusing to resize at all
  // would leave the reader with a frame stuck at its first-paint guess. Clamping keeps the report
  // readable either way.
  assert.equal(readFrameHeight(height(10), true), MIN_FRAME, 'a collapsed document still gets a usable frame')
  assert.equal(readFrameHeight(height(1e12), true), MAX_FRAME, 'and a runaway one cannot blow up the layout')
  assert.equal(readFrameHeight(height(-5000), true), MIN_FRAME, 'including a negative one')
})

test('the command shape is closed and carries no secret', () => {
  // targetOrigin has to be '*' because a null origin cannot be addressed, so every command is readable by
  // whatever the frame contains. That is acceptable only while the payload stays a verb.
  const cmd = frameCommand('openAll', true)
  assert.deepEqual(cmd, { source: FRAME_TAG, type: 'command', command: 'openAll', value: true })
  assert.deepEqual(Object.keys(cmd).sort(), ['command', 'source', 'type', 'value'])
})

test('a command is never mistaken for a height', () => {
  // Both directions share one channel and one tag; only `type` separates them. If that ever stopped being
  // true, the portal would resize itself every time it sent a command.
  assert.equal(readFrameHeight(frameCommand('exportPDF'), true), null)
})

// ── B2 (2026-07-30): the scroll delegation — same trust boundary, same idiom ───────────────────────

const scroll = (top: unknown) => ({ source: FRAME_TAG, type: 'scrollTo', top })

test('a well-formed scroll offset from the frame is accepted', () => {
  assert.equal(readFrameScroll(scroll(3616), true), 3616)
})

test('A SCROLL FROM ANYWHERE ELSE IS IGNORED — a hostile page must not be able to drive the scrollbar', () => {
  assert.equal(readFrameScroll(scroll(3616), false), null)
})

test('a scroll offset that is not a finite number is rejected, never coerced', () => {
  for (const bad of ['3616', ' 12 ', '', NaN, Infinity, -Infinity, null, undefined, {}, []]) {
    assert.equal(readFrameScroll(scroll(bad), true), null, `${String(bad)} was rejected`)
  }
})

test('a scroll offset is clamped to sane bounds — a hostile document cannot fling the page', () => {
  assert.equal(readFrameScroll(scroll(-50), true), 0)
  assert.equal(readFrameScroll(scroll(9_999_999), true), MAX_FRAME)
})

test('a scroll message with the wrong tag or type is not ours', () => {
  assert.equal(readFrameScroll({ source: 'something-else', type: 'scrollTo', top: 10 }, true), null)
  assert.equal(readFrameScroll({ source: FRAME_TAG, type: 'height', top: 10 }, true), null)
})

// ── feedback — THE SECTION THAT WAS HERE IS DELETED (, owner ruling 2026-08-20) ──────────
//
// It tested `readFrameFeedback` and `frameFeedbackResult`: the validator a flag crossed on its way out
// of the null-origin frame, plus 's markIndex arms. Both exports are gone, because
// `portal-service.mjs` no longer injects the control that raised the message and the owner asked for
// the UI options removed rather than hidden.
//
// The CAPTURE is disabled, not deleted, and it is still tested — on the driver side, where it lives:
// `driver/test/portal-service.test.mjs` drives the retained resolver through a test-only seam, and
// `driver/test/report-feedback-is-switched-off.test.mjs` asserts the endpoint refuses. Nothing about
// this page can reach either any more, which is why nothing here tests them.
//
// `git show <this commit>^:portal-ui/test/reportFrame.test.ts` if the control ever comes back.
