// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Looking a Nice class up, rather than having to already know it.
//
// The composer took classes as a comma-separated box of numbers, which is a fine input for the person
// who wrote the classification and a bad one for everyone else. What is tested here is the matcher, and
// the failure it exists to avoid is a menu that HIDES the answer: a naive contains-match is why typing
// two letters used to offer six wrong rows first.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NICE_CLASSES, ALL_CLASSES, classLabel, classMatches, isClassNumber } from '../src/contract/niceClasses.ts'

test('all 45 classes are present, numbered 1 to 45, each with a heading', () => {
  assert.equal(ALL_CLASSES.length, 45)
  assert.deepEqual([...ALL_CLASSES].sort((a, b) => a - b), Array.from({ length: 45 }, (_, i) => i + 1))
  for (const n of ALL_CLASSES) assert.ok(NICE_CLASSES[n]!.trim().length > 2, `class ${n} needs a heading`)
})

test('a chip says what the class IS, and an unknown number still renders', () => {
  assert.equal(classLabel(9), '9 · Electrical & software')
  assert.equal(classLabel(32), '32 · Non-alcoholic drinks')
  assert.equal(classLabel(99), '99', 'never hide what the user typed — the message about it names it')
})

test('isClassNumber is the only range check in this stack', () => {
  for (const ok of [1, 9, 45]) assert.equal(isClassNumber(ok), true)
  for (const bad of [0, 46, -3, 9.5, '9', null, undefined, NaN]) assert.equal(isClassNumber(bad), false, String(bad))
})

// ── the matcher ─────────────────────────────────────────────────────────────────────────────────────

test('a number is an exact answer, offered alone', () => {
  assert.deepEqual(classMatches('9', []), [9], 'not 9 buried among 19, 29, 39…')
  assert.deepEqual(classMatches('4', []), [4], 'and not 4 among 14, 24, 34, 40–45')
  assert.deepEqual(classMatches('42', []), [42])
  assert.deepEqual(classMatches('99', []), [], 'a number outside the classification matches nothing')
  assert.deepEqual(classMatches('class 9', []), [9], '"class 9" is how people say it')
})

test('words match whole-word prefixes of the heading, never a bare substring', () => {
  assert.ok(classMatches('cloth', []).includes(25))
  assert.ok(classMatches('financ', []).includes(36))
  assert.ok(classMatches('transp', []).includes(39))
  // The territory field's lesson, applied: "in" as a substring hits Lighting, Building, Clothing,
  // Instruments, Printed… — a menu with the answer hidden in it.
  const noise = classMatches('in', [])
  assert.ok(!noise.includes(11), 'Lighting & heating must not match on a substring')
  assert.ok(!noise.includes(19), 'Building materials must not either')
})

test('the aliases cover the words people actually type', () => {
  for (const [q, n] of [['software', 9], ['app', 9], ['saas', 42], ['retail', 35], ['beer', 32], ['legal', 45], ['restaurant', 43]] as const)
    assert.ok(classMatches(q, []).includes(n), `"${q}" should find class ${n}`)
})

test('classes already chosen are never offered again', () => {
  assert.deepEqual(classMatches('9', [9]), [])
  assert.ok(!classMatches('software', [9]).includes(9))
})

test('an empty query offers nothing, and the list is capped', () => {
  assert.deepEqual(classMatches('', []), [])
  assert.deepEqual(classMatches('   ', []), [])
  assert.ok(classMatches('a', []).length <= 8)
})

test('the headings stay short — this is a chip, not classification advice', () => {
  // A WIPO class heading is a paragraph. One that wrapped would break the single-line chip row the
  // context card is built on, and the goods field is where a real specification goes.
  for (const n of ALL_CLASSES) assert.ok(NICE_CLASSES[n]!.length <= 30, `class ${n} heading is too long for a chip`)
})
