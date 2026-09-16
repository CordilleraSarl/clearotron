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
//
// PROFILE NO LONGER HAS TWO BUTTONS. Its Save runs the dry run and then the write in one press, so its
// half of this file drives that order through a fake server instead of reading a branch of the screen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { checkThenSave } from '../src/contract/checkThenSave.ts'
import type { Result } from '../src/contract/api.ts'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

/** The body of the `action === 'validate'` branch, up to the `setChecked(true)` that ends it. */
function validateBranch(file: string): string {
  const src = readFileSync(join(SRC, 'screens', file), 'utf8')
  const from = src.indexOf("if (action === 'validate')")
  assert.ok(from > 0, `${file} no longer has a validate branch — this arm is measuring nothing`)
  const to = src.indexOf('setChecked(true)', from)
  assert.ok(to > from, `${file}'s validate branch no longer sets the checked state — read it again before trusting this`)
  return src.slice(from, to)
}

// The project editor still checks and saves as two presses, so its branch is still read as text.
test('Projects.tsx: the dry run\'s own verdict is read before the form is called checked', () => {
  const branch = validateBranch('Projects.tsx')
  assert.match(branch, /\berrors\b/,
    'Projects.tsx calls the form checked without reading the errors the dry run returned — a refusal that '
    + 'answers 200 would pass Check and fail Save, which is the defect this arm exists for')
  assert.match(branch, /\bok\b/,
    'Projects.tsx does not consult the dry run\'s own ok flag, so it is trusting the status code to answer a '
    + 'question about the profile')
  assert.match(branch, /setChecked\(false\)/,
    'Projects.tsx never un-checks the form on a refused dry run, so a second Save could follow a failed Check')
})

// PROFILE CHECKS AND SAVES IN ONE PRESS, and the order lives in contract/checkThenSave.ts — so the rule is
// DRIVEN there rather than read as text. A fake server answers each step and records what reached it.
type Answer = Result<Record<string, unknown>>
const server = (answers: { validate: Answer; save?: Answer }) => {
  const asked: string[] = []
  const post = async (action: 'validate' | 'save'): Promise<Answer> => {
    asked.push(action)
    return action === 'validate' ? answers.validate : (answers.save ?? { kind: 'ok', value: { ok: true } })
  }
  return { asked, post }
}

test('Profile: a dry run answering 200 with a refusal never reaches the write, and carries its reasons', async () => {
  const s = server({ validate: { kind: 'ok', value: { ok: false, errors: ['defaultJurisdictions: XX is not a territory'] } } })
  const out = await checkThenSave(s.post)
  assert.deepEqual(s.asked, ['validate'], 'the write was sent after the dry run refused it')
  assert.equal(out.kind, 'refused')
  assert.deepEqual(out.kind === 'refused' ? out.errors : null, ['defaultJurisdictions: XX is not a territory'])

  // Each half of the verdict is enough on its own: ok:false with no reasons, and reasons with no flag.
  for (const value of [{ ok: false }, { errors: ['name: required'] }]) {
    const t = server({ validate: { kind: 'ok', value } })
    assert.equal((await checkThenSave(t.post)).kind, 'refused', `${JSON.stringify(value)} was read as accepted`)
    assert.deepEqual(t.asked, ['validate'])
  }
})

test('Profile: a dry run that fails as a request never reaches the write either', async () => {
  const s = server({ validate: { kind: 'rateLimited' } as Answer })
  const out = await checkThenSave(s.post)
  assert.deepEqual(s.asked, ['validate'])
  assert.equal(out.kind, 'failed')
})

test('Profile: a clean dry run is followed by the write, and the write\'s own answer is the outcome', async () => {
  // THE CONTROL: without it, a checkThenSave that never wrote at all would pass both arms above.
  const s = server({ validate: { kind: 'ok', value: { ok: true, errors: [] } }, save: { kind: 'ok', value: { sha: 'abc123' } } })
  const out = await checkThenSave(s.post)
  assert.deepEqual(s.asked, ['validate', 'save'])
  assert.equal(out.kind, 'saved')
  assert.equal(out.kind === 'saved' ? out.result.value['sha'] : null, 'abc123')

  const refusedWrite = server({ validate: { kind: 'ok', value: { ok: true } }, save: { kind: 'reject', errors: ['no'] } })
  assert.equal((await checkThenSave(refusedWrite.post)).kind, 'failed', 'a write the server refused was reported as saved')
})

test('both screens read the verdict the same way, because it is one server behaviour', () => {
  // Not a style point. These two call the same endpoint shape and get the same 200-with-a-verdict, so a
  // repair applied to one and not the other leaves the identical defect live on the other screen — which
  // is how it survived the first time. Profile reads it through the contract driven above; the project
  // editor reads it in its own branch.
  const profile = readFileSync(join(SRC, 'screens', 'Profile.tsx'), 'utf8')
  assert.match(profile, /checkThenSave\(\(action\) => api\.saveProfile\(account, action, body\)\)/,
    'Profile no longer saves through checkThenSave, so the arms above describe a path it does not take')
  const contract = readFileSync(join(SRC, 'contract', 'checkThenSave.ts'), 'utf8')
  for (const [name, text] of [['checkThenSave.ts', contract], ['Projects.tsx', validateBranch('Projects.tsx')]] as const)
    assert.match(text, /errors/, `${name} diverged from the other screen's reading of the same answer`)
})
