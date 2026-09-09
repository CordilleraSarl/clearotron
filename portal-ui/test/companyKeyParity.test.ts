// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The key the create form SHOWS and the key the server FILES are one key.
//
// The form prints the key under the name before anything is written, and the key becomes a filename and
// the value every search files against — wrong once is wrong for good. A preview that disagrees with the
// server is worse than no preview: the person reads one value, confirms it, and the company exists under
// another, with nothing anywhere reporting a difference.
//
// It reads the driver's own function rather than restating its rule, so the two cannot be made to agree
// by pasting the same wrong rule into both.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { companyKeyFrom } from '../src/contract/companyKey.ts'

// @ts-expect-error — the driver is plain .mjs with no types; this test is the seam between the two.
import { companyKeyFrom as engineKeyFrom } from '../../driver/company-bundle.mjs'

// Ordinary names, the accented case the obvious implementation gets wrong, the punctuation-only case
// that must yield NOTHING rather than an invented key, and the length cap.
const NAMES = [
  'Acme Ltd',
  'Acme',
  'ACME  LTD.',
  'Zürich Präzision',            // NFKD splits the umlaut; a naive slug files this as "zu-rich"
  'Ångström Systems',
  'Œuvre & Co',
  'Saint-Étienne Textiles',
  '  leading and trailing  ',
  '...',                          // no key can be made — the form must ask rather than invent one
  '---',
  '',
  '123',
  'A'.repeat(60),                 // the cap, and no trailing hyphen after slicing
  'A very long company name that runs past the limit for sure',
  'Ünïcödé Ltd',
  'Smith, Jones & Co',
]

test('THE PREVIEW AND THE SERVER DERIVE THE SAME KEY, for every shape that has ever been wrong', () => {
  // The floor: an implementation that returned '' for everything would satisfy a loop of equality
  // assertions perfectly, and so would one that threw the list away.
  const derived = NAMES.map((n) => companyKeyFrom(n))
  assert.equal(derived.length, NAMES.length)
  assert.ok(derived.filter(Boolean).length >= 12, 'most of these names DO produce a key')

  for (const name of NAMES) {
    assert.equal(
      companyKeyFrom(name),
      engineKeyFrom(name),
      `${JSON.stringify(name)} files under the same key in the browser and on the server`,
    )
  }
})

test('THE ACCENTED CASE, named — the one a hand-written slug gets wrong and nobody notices', () => {
  // Spelled out rather than left inside the loop above, because the loop passes for two implementations
  // that are both wrong in the same way, and this is the specific defect the mirror exists to prevent.
  assert.equal(companyKeyFrom('Zürich Präzision'), 'zurich-prazision')
  assert.notEqual(companyKeyFrom('Zürich Präzision'), 'zu-rich-pra-zision')
})

test('A NAME THAT YIELDS NO KEY YIELDS NOTHING, so the form can ask instead of inventing one', () => {
  for (const junk of ['...', '---', '', '   ', '!!!']) {
    assert.equal(companyKeyFrom(junk), '', `${JSON.stringify(junk)} produces no key`)
    assert.equal(engineKeyFrom(junk), '', 'and the server agrees')
  }
})

test('THE KEY FITS WHAT THE VALIDATOR ACCEPTS — lowercase, digits and hyphens, never trailing', () => {
  for (const name of NAMES) {
    const k = companyKeyFrom(name)
    if (!k) continue
    assert.match(k, /^[a-z0-9][a-z0-9-]*$/, `${JSON.stringify(name)} → ${k} is a legal key`)
    assert.doesNotMatch(k, /-$/, 'a slice must not leave a trailing hyphen')
    assert.ok(k.length <= 39, `${k} is within the validator's length`)
  }
})
