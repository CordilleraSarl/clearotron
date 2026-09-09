// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The browser's territory codes and the engine's are ONE list, and this is what makes that true.
//
// The same pin as effortModelParity, for the same reason. A mirrored constant is a copy, and a copy
// drifts silently: the browser goes on accepting a code the engine stopped recognising, the person is
// told their entry is fine, and the entry is dropped before the prompt — which is the defect this pin
// exists to stop, arriving through the fix for it.
//
// It reads the driver module rather than restating its contents, so this file cannot be "repaired" by
// pasting the new list into both sides — the only way to make it pass is to make them agree.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  KNOWN_JURISDICTION_CODES,
  JURISDICTION_CODE_FOLD,
  canonicalJurisdictionCode,
  isKnownJurisdictionCode,
  isTerritoryEntry,
} from '../src/contract/composerProduct.ts'

// @ts-expect-error — the driver is plain .mjs with no types; this test is the seam between the two.
import * as engine from '../../driver/jurisdiction-codes.mjs'

test('THE BROWSER HOLDS EXACTLY THE ENGINE’S CODES — every one, and no others', () => {
  const mine = [...KNOWN_JURISDICTION_CODES].sort()
  const theirs = [...(engine.KNOWN_JURISDICTION_CODES as Set<string>)].sort()

  // The floor. A mirror that read as empty would satisfy every set comparison below against an engine
  // module that also failed to load — two empty lists agree perfectly.
  assert.ok(theirs.length > 200, 'the engine module loaded and holds a real list')
  assert.ok(mine.length > 200, 'the mirror is populated')

  // MEMBERS, not counts. Two lists of 262 can differ by one code in each direction and agree on length,
  // which is the one way this could be wrong and look right.
  const missing = theirs.filter((c) => !KNOWN_JURISDICTION_CODES.has(c))
  const extra = mine.filter((c) => !(engine.KNOWN_JURISDICTION_CODES as Set<string>).has(c))
  assert.deepEqual(missing, [], 'codes the engine knows and the browser would refuse')
  assert.deepEqual(extra, [], 'codes the browser accepts and the engine would drop before the prompt')
})

test('THE FOLD AGREES — a habit resolves to the same office on both sides', () => {
  assert.deepEqual(
    JURISDICTION_CODE_FOLD,
    engine.JURISDICTION_CODE_FOLD,
    'UK/GB and the EUIPO spellings fold identically, or one side stores what the other cannot find',
  )

  // Driven, not asserted: every alias through both implementations, plus a code that is NOT an alias so
  // an implementation that folded everything to one value could not pass.
  for (const alias of [...Object.keys(JURISDICTION_CODE_FOLD), 'FR', 'JP']) {
    assert.equal(
      canonicalJurisdictionCode(alias),
      engine.canonicalJurisdictionCode(alias),
      `${alias} canonicalises the same way in the browser and the engine`,
    )
  }
})

test('THE PREDICATE AGREES ON THE CASES THAT CAUSED THE DEFECT', () => {
  // `USFrance` is the tracker's own example: uppercased and stored by the engine, dropped before the
  // prompt, never mentioned to anybody. `XQ` is the shape the browser used to wave through — two
  // letters, and no office anywhere.
  for (const entry of ['US', 'us', 'UK', 'GB', 'EU', 'EM', 'XQ', 'QQ', 'USFrance', 'Narnia', '', 'F']) {
    assert.equal(
      isKnownJurisdictionCode(entry),
      engine.isKnownJurisdictionCode(entry),
      `${JSON.stringify(entry)} is judged the same on both sides`,
    )
  }

  // Both directions represented, so an always-true or always-false predicate cannot pass this.
  assert.equal(isKnownJurisdictionCode('FR'), true)
  assert.equal(isKnownJurisdictionCode('XQ'), false)
})

test('THE STORED-DEFAULTS FIELD REFUSES WHAT THE ENGINE CANNOT SEARCH', () => {
  // The field's own predicate — the point of entry, which is where a stored default has to be refused.
  assert.equal(isTerritoryEntry('United States'), true, 'a name this build lists')
  assert.equal(isTerritoryEntry('US'), true, 'the code the staff editor tells people to type')
  assert.equal(isTerritoryEntry('EU'), true, 'the EUIPO, which the display-name check used to flag')

  assert.equal(isTerritoryEntry('XQ'), false, 'two letters is no longer a licence')
  assert.equal(isTerritoryEntry('USFrance'), false, "the tracker's own example")
  assert.equal(isTerritoryEntry('Narnia'), false, 'not a place the engine can search')
})
