// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — CHECK AND SAVE CANNOT DISAGREE ABOUT THE SAME VALUE.
//
// Found by driving the screen: a territory the server refuses passed Check and then failed Save. Both
// calls run the SAME validator on the server. They disagree about how they REPORT it — Save answers 400,
// while the dry run answers 200 and carries its verdict in the body as `{ ok: false, errors: [...] }`.
// The screen read the transport and not the verdict, so the step whose whole job is to catch a problem
// before saving reported success while holding the reasons it would fail.
//
// WHY THIS IS PINNED ON THE SOURCE. The branch is three lines inside a screen handler, and the failure
// is invisible in a rendered test: both paths render "checked", one of them wrongly. What must not come
// back is a validate branch that sets the checked state without first consulting the body — so that is
// what this reads.
//
// IF THIS EVER STOPS BEING TRUE, FIND OUT HERE: either the dry run started answering 4xx on a refusal —
// in which case the transport check above is enough and this arm should go — or somebody simplified the
// branch back to trusting the status. The first is a real improvement and the second is the defect
// returning, and they are distinguishable only by looking at what the server now answers.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'screens')

/** The body of the `action === 'validate'` branch, up to the `setChecked(true)` that ends it. */
function validateBranch(file: string): string {
  const src = readFileSync(join(SRC, file), 'utf8')
  const from = src.indexOf("if (action === 'validate')")
  assert.ok(from > 0, `${file} no longer has a validate branch — this arm is measuring nothing`)
  const to = src.indexOf('setChecked(true)', from)
  assert.ok(to > from, `${file}'s validate branch no longer sets the checked state — read it again before trusting this`)
  return src.slice(from, to)
}

for (const file of ['Profile.tsx', 'Projects.tsx']) {
  test(`${file}: the dry run's own verdict is read before the form is called checked`, () => {
    const branch = validateBranch(file)
    assert.match(branch, /\berrors\b/,
      `${file} calls the form checked without reading the errors the dry run returned — a refusal that `
      + 'answers 200 would pass Check and fail Save, which is the defect this arm exists for')
    assert.match(branch, /\bok\b/,
      `${file} does not consult the dry run's own ok flag, so it is trusting the status code to answer a `
      + 'question about the profile')
    assert.match(branch, /setChecked\(false\)/,
      `${file} never un-checks the form on a refused dry run, so a second Save could follow a failed Check`)
  })
}

test('both screens read the verdict the same way, because it is one server behaviour', () => {
  // Not a style point. These two call the same endpoint shape and get the same 200-with-a-verdict, so a
  // repair applied to one and not the other leaves the identical defect live on the other screen — which
  // is how it survived the first time.
  const profile = validateBranch('Profile.tsx')
  const projects = validateBranch('Projects.tsx')
  for (const [name, branch] of [['Profile.tsx', profile], ['Projects.tsx', projects]] as const)
    assert.match(branch, /errors/, `${name} diverged from the other screen's reading of the same answer`)
})
