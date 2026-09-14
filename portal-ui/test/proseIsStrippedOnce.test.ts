// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// ONE ANSWER TO "WHAT DOES THIS SCREEN SAY", AND NO EIGHTH COPY OF IT.
//
// Seven test files each built their own comment stripper. Six missed a JSX comment — `{/*` is not `/*`,
// and the lines beneath it open with ordinary words — so 187 spans and nearly twelve thousand words of
// commentary reached assertions about what a client can read. One arm counted a NOTE about a button as
// a button and went green the day the button it was counting went away. The seventh copy had drifted
// the other way, stripping block spans the others did not and omitting an opener the others had.
// Nobody chose either difference; they are what seven copies become.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { prose } from './support/prose.ts'

const DIR = fileURLToPath(new URL('.', import.meta.url))
const TESTS = readdirSync(DIR).filter((f) => f.endsWith('.test.ts')).map((f) => join(DIR, f))

test('the population is every test file, and it is plausibly large', () => {
  // A FLOOR, because everything below is an absence and an absence over an empty list is a pass.
  assert.ok(TESTS.length >= 40, `the walk found ${TESTS.length} test files, which is not this suite`)
})

test('NO TEST FILE BUILDS ITS OWN COMMENT STRIPPER — there is one, and it is imported', () => {
  const offenders = TESTS
    .filter((f) => !f.endsWith('proseIsStrippedOnce.test.ts'))
    .filter((f) => /filter\(\([^)]*\) => !\/\^\\s\*\(\\\/\\\//.test(readFileSync(f, 'utf8')))
    .map((f) => f.slice(DIR.length))
  assert.deepEqual(offenders, [], 'a test file is stripping comments itself instead of importing the one helper')

  // AND THE HELPER IS ACTUALLY USED, so the rule above cannot be satisfied by deleting the stripping.
  // THIS FILE IS NOT ONE OF THE CALLERS. Counting it made the floor one too high to mean anything:
  // eight files import the helper, seven of them to strip a screen and this one to drive it, so a
  // caller dropping out still cleared a threshold of seven. A plant removing one did not red.
  const users = TESTS
    .filter((f) => !f.endsWith('proseIsStrippedOnce.test.ts'))
    .filter((f) => /from '\.\/support\/prose\.ts'/.test(readFileSync(f, 'utf8')))
  assert.ok(users.length >= 7, `only ${users.length} test file(s) import it — the callers have drifted away again`)
})

test('THE HELPER REACHES A JSX COMMENT, which is the half six of the seven copies missed', () => {
  // Driven, not read. A guard that checked the helper's source for a regex would pass on a regex that
  // matched nothing, which is the failure this whole issue is about one level down.
  const src = [
    'const a = 1',
    '{/* a note about a button',
    '    that runs across lines and opens with ordinary words */}',
    '<button>All Clearances</button>',
    '/* a block span */',
    'const b = 2 /* an inline span */ + 3',
    '// a line comment',
  ].join('\n')
  const out = prose(src)
  assert.match(out, /<button>All Clearances<\/button>/, 'the helper ate the markup as well')
  assert.doesNotMatch(out, /a note about a button/, 'the JSX comment survived')
  assert.doesNotMatch(out, /ordinary words/, "the JSX comment's later lines survived — a line filter alone does this")
  assert.doesNotMatch(out, /a block span/, 'a block comment survived')
  // THE CASE ONLY THE BLOCK REPLACE COVERS. A span that opens mid-line is reached by neither the JSX
  // pattern nor the line filter, and without it this arm had no way to tell whether that replace was
  // doing anything — removing it left every assertion here green.
  assert.doesNotMatch(out, /an inline span/, 'an inline block comment survived')
  assert.match(out, /const b = 2\s*\+ 3/, 'the inline strip took the code around it')
  assert.doesNotMatch(out, /a line comment/, 'a line comment survived')
  // AND THE JSX SPAN TOOK ITS BRACES WITH IT. Without the first replace the block span still removes
  // the words — `{/* … */}` contains `/* … */` — and leaves `{}` behind: a token the source did not
  // have, in a string other arms then read structurally. This is what makes that line load-bearing
  // rather than decorative, and removing it reds here.
  assert.doesNotMatch(out, /\{\s*\}/, 'a stripped JSX comment left its braces behind')
  assert.match(out, /const a = 1/, 'the helper removed code that was not a comment')
})
