// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — THE FRAMEWORK GUIDE LINK: NEW TAB, DEEP ANCHOR, AND SOMETHING WHEN IT CANNOT RESOLVE.
//
// The owner found three faults in one link on one walk: it navigated the reader AWAY from the form they
// were filling in, it landed at the top of a long configuration document instead of the part about
// writing a framework, and it rendered NOTHING when the deployment could not name its own repository —
// so the only route to that capability disappeared silently.
//
// The third is the one worth a test. "Render nothing rather than a broken link" is a defensible rule and
// it was the wrong one here: a reader who cannot see the link cannot learn the capability exists. The
// file path is true of every copy of the product, fork or not, so there is always something to say.
//
// The anchor is checked against the GUIDE ITSELF rather than pinned as a string, because a deep link to
// a heading that has been renamed is a dead link that looks alive.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { GUIDE_PATH, GUIDE_ANCHOR } from '../src/contract/frameworkGuide.ts'

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')
const LINK = read('../src/components/FrameworkGuideLink.tsx')
const GUIDE = read(`../../${GUIDE_PATH}`)

test('the anchor resolves to a real heading in the guide', () => {
  // GitHub derives the anchor from the heading text: lowercase, spaces to hyphens, punctuation dropped.
  const headings = [...GUIDE.matchAll(/^#{2,}\s+(.+)$/gm)].map((m) =>
    m[1]!.toLowerCase().replace(/[^a-z0-9 -]/g, '').trim().replace(/\s+/g, '-'))
  assert.ok(headings.length > 5, `only ${headings.length} headings parsed out of the guide — the matcher is not reading it`)
  assert.ok(headings.includes(GUIDE_ANCHOR),
    `the link points at #${GUIDE_ANCHOR} and the guide has no such heading — a dead deep link looks alive`)
})

test('it opens in a new tab, because the reader is mid-task on both screens that show it', () => {
  assert.match(LINK, /target="_blank"/, 'the link navigates the reader away from the form they are filling in')
  assert.match(LINK, /rel="noreferrer"/, 'a new-tab link without rel is the one thing that must not be dropped')
})

test('an unresolved repository still tells the reader where the guide is', () => {
  assert.match(LINK, /if \(!repo\)/, 'the unresolved case is no longer handled')
  assert.doesNotMatch(LINK, /if \(!repo\) return null/,
    'the link renders nothing again when the repository cannot be named — which is how the capability became invisible')
  // PINNED TO THE PROPERTY, NOT THE LITERAL. The first version of this arm looked for the path spelled
  // out in the component, and broke the moment the constant moved to the contract — which is the repair
  // that made it checkable in the first place. What matters is that the fallback names the file, and it
  // does that by rendering the shared constant.
  assert.match(LINK, /\{GUIDE_PATH\}/,
    'the fallback does not name the guide file, so it tells the reader nothing they can act on')
  assert.match(LINK, /GUIDE_PATH, GUIDE_ANCHOR \} from '\.\.\/contract\/frameworkGuide\.ts'/,
    'the component spells the guide location itself again — a second spelling is one the anchor arm cannot check')
})

test('both screens use the one component rather than writing the link out', () => {
  const NEW = read('../src/screens/NewCompany.tsx')
  const PROFILE = read('../src/screens/Profile.tsx')
  for (const [name, src] of [['NewCompany', NEW], ['Profile', PROFILE]] as const) {
    assert.match(src, /<FrameworkGuideLink \/>/, `${name} does not use the shared guide link`)
    assert.doesNotMatch(src, /blob\/main\/docs\/configuration\.md/,
      `${name} spells the guide URL itself again — two spellings drift, and one of them loses the anchor`)
  }
})
