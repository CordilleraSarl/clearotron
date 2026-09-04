// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Editing a brand owner's configuration.
//
// Two of these pin defects that have already happened here: a form that drops a field it did not render,
// and a project overlay that silently revoked a marketplace its customer mandated.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PROFILE_FIELDS, PROJECT_EDITABLE, projectFields, CODE_OWNED, FIELD_GROUPS, choiceLabel,
  parseLines, parseNumbers, toInput, applyField, mergePlatforms, revokedPlatforms, stripCodeOwned,
  PATH_FIELDS, visibleReadOnlyFields, fieldInput, isSet, rootKey,
  fieldNotices, rejectedNumbers, chosenEntries, toggleEntry, CLEARED_LABEL,
} from '../src/contract/profileFields.ts'

const spec = (key: string) => {
  const f = PROFILE_FIELDS.find((x) => x.key === key)
  assert.ok(f, `${key} is a rendered field`)
  return f
}

test('OMISSION IS NOT CONSENT: a key the page never rendered survives an edit', () => {
  // The bug this pins: a form that POSTs only the fields it has inputs for erases everything else the
  // day the engine grows a field. The draft is seeded from the server's object and edited in place.
  const fromServer = {
    name: 'Aurora',
    somethingAddedLaterByTheEngine: { deep: ['value'] },
    delivery: { template: 'standard' },
  }
  const after = applyField(fromServer, spec('name'), 'Aurora Interactive')
  assert.equal(after.name, 'Aurora Interactive')
  assert.deepEqual(after.somethingAddedLaterByTheEngine, { deep: ['value'] }, 'untouched, not dropped')
  assert.deepEqual(after.delivery, { template: 'standard' })
})

test('clearing a field DELETES the key — absent and empty mean different things', () => {
  const after = applyField({ platforms: ['amazon'], name: 'Aurora' }, spec('platforms'), '   ')
  assert.ok(!('platforms' in after), 'an emptied box is not an instruction to search no marketplaces')
  assert.equal(after.name, 'Aurora')
})

test('applyField never mutates the draft it was given', () => {
  const draft = { name: 'Aurora' }
  applyField(draft, spec('name'), 'Changed')
  assert.deepEqual(draft, { name: 'Aurora' })
})

test('list fields preserve order and case — a marketplace name is not ours to normalise', () => {
  assert.deepEqual(parseLines('Amazon\neBay\n\n  Etsy  \n'), ['Amazon', 'eBay', 'Etsy'])
  assert.deepEqual(parseLines('   '), [])
})

test('classes drop out-of-range values and collapse duplicates', () => {
  assert.deepEqual(parseNumbers('9, 42, 9'), [9, 42])
  assert.deepEqual(parseNumbers('0, 46, nine'), [])
})

test('toInput round-trips through the editing box without mangling', () => {
  const f = spec('platforms')
  const value = ['Amazon', 'eBay']
  assert.deepEqual(applyField({}, f, toInput(value, f.kind)).platforms, value)
  // An object with no dedicated input renders as JSON rather than "[object Object]".
  assert.match(toInput({ template: 'x' }, 'text'), /template/)
  assert.equal(toInput(null, 'lines'), '')
})

// ── the floor ───────────────────────────────────────────────────────────────────────────────────────

test('PLATFORMS IS A FLOOR: a project adds and can never revoke', () => {
  const customer = ['Amazon', 'eBay']
  const project = ['Etsy']
  assert.deepEqual(mergePlatforms(customer, project), ['Amazon', 'eBay', 'Etsy'])
  // The documented defect: an overlay that omits one of the customer's marketplaces.
  assert.deepEqual(revokedPlatforms(customer, ['Amazon']), ['eBay'],
    'the one that would be lost is NAMED, so the user can act on it')
  assert.deepEqual(revokedPlatforms(customer, ['Amazon', 'eBay', 'Etsy']), [])
})

test('the floor is case-insensitive, and the CUSTOMER’s spelling wins', () => {
  assert.deepEqual(mergePlatforms(['Amazon'], ['amazon', 'Etsy']), ['Amazon', 'Etsy'],
    'one canonical spelling, chosen at the level that mandated it')
  assert.deepEqual(revokedPlatforms(['Amazon'], ['AMAZON']), [], 'a case difference is not a revocation')
})

test('an overlay that sets no platforms at all revokes nothing — it inherits', () => {
  // Distinct from setting an EMPTY list. Not overlaying the field means "use the customer's".
  assert.deepEqual(revokedPlatforms(['Amazon'], undefined), [])
  // …whereas an explicitly empty list would drop both, and is reported as such.
  assert.deepEqual(revokedPlatforms(['Amazon', 'eBay'], []), ['Amazon', 'eBay'])
})

// ── what a project may touch at all ─────────────────────────────────────────────────────────────────

test('a project cannot reach identity or rating authority', () => {
  for (const forbidden of ['name', 'matchDomains', 'selfExclusionOwners', 'frameworkPath', 'workedExamplesPath']) {
    assert.equal(PROJECT_EDITABLE.has(forbidden), false, `${forbidden} is whole-customer`)
  }
  const offered = projectFields().map((f) => f.key)
  assert.ok(!offered.includes('name'), 'the project form does not even render identity')
  assert.ok(offered.includes('platforms'))
})

test('the code-owned fields are stripped before sending', () => {
  const draft = { name: 'Aurora', frameworkPath: 'evil.md', runCaps: { perMonth: 99999 }, allowedRecipes: ['*'] }
  const sent = stripCodeOwned(draft)
  for (const f of CODE_OWNED) assert.equal(sent[f], undefined, `${f} must not be sent`)
  assert.equal(sent.name, 'Aurora')
  assert.equal(draft.frameworkPath, 'evil.md', 'and the caller’s draft is not mutated')
})

test('no code-owned field is offered as an editable row', () => {
  // A row here would render an input for something the server silently discards — a control that lies.
  for (const f of PROFILE_FIELDS) {
    assert.ok(!CODE_OWNED.includes(f.key as never), `${f.key} must not be editable`)
  }
})

// ── what a CLIENT may read back ────────────────────────────────────────────────────────────────────

test('A CLIENT IS NEVER SHOWN AN ENGINE PATH', () => {
  // The real values, from a live profile: the framework path carries the internal directory layout,
  // the naming convention, and the customer key inside the filename — which together let a reader
  // guess where another client's framework lives.
  const readOnly = {
    frameworkPath: 'skills/prelim-search/risk-framework-aurora.md',
    workedExamplesPath: 'skills/prelim-search/worked-examples-aurora.md',
    allowedRecipes: ['prelim'],
    runCaps: { perMonth: 4 },
  }
  const shown = visibleReadOnlyFields(readOnly, false)
  assert.ok(!shown.includes('frameworkPath'))
  assert.ok(!shown.includes('workedExamplesPath'))

  // and the settings that are genuinely theirs still appear — this is a redaction, not a blanking
  assert.ok(shown.includes('allowedRecipes'))
  assert.ok(shown.includes('runCaps'))
})

test('staff keep the paths, because they are the ones who open the file', () => {
  const readOnly = { frameworkPath: 'skills/prelim-search/risk-framework-aurora.md', runCaps: {} }
  assert.deepEqual(visibleReadOnlyFields(readOnly, true), ['frameworkPath', 'runCaps'])
})

test('a field that is absent is not rendered empty for anyone', () => {
  assert.deepEqual(visibleReadOnlyFields({}, true), [])
  assert.deepEqual(visibleReadOnlyFields({}, false), [])
})

// ── the three-way: preserve / set / clear ───────────────────────────────────────────────────────────

test('defaultProduct CLEARS to "" rather than deleting its key', () => {
  // The three states the server reads (driver/profile-service.mjs normalizeProduct):
  //   key absent ⇒ preserve whatever is on disk · "" ⇒ unset to the house default · a value ⇒ set.
  // Deleting the key on clear would therefore mean "leave it alone" — the opposite of the user's act,
  // and invisible: the page would show an empty box over a depth that was still in force.
  const f = spec('defaultProduct')

  const untouched = applyField({ name: 'Aurora', defaultProduct: 'prelim' }, spec('name'), 'A')
  assert.equal(untouched.defaultProduct, 'prelim', 'preserve: an unrelated edit does not disturb it')

  const set = applyField({ name: 'Aurora' }, f, 'prelim-jx')
  assert.equal(set.defaultProduct, 'prelim-jx')

  const cleared = applyField({ name: 'Aurora', defaultProduct: 'prelim' }, f, '')
  assert.ok('defaultProduct' in cleared, 'the key must SURVIVE the clear, carrying the sentinel')
  assert.equal(cleared.defaultProduct, '')
})

test('defaultProduct does not hardcode its options — they come from the engine registry', () => {
  // A literal list here would drift the first time a level is added to driver/search-policy.mjs, and
  // drift silently: the dropdown would simply not offer the new depth.
  assert.equal(spec('defaultProduct').choices, undefined)
})

test('the project form withholds defaultProduct, because its clear state cannot be expressed', () => {
  // PROJECT_EDITABLE contains it — the ENGINE accepts it in an overlay. The UI still withholds it: the
  // overlay save path preserves on omit and rejects "" outright, so a project control could set an
  // override and never remove one. A one-way switch is worse than no switch.
  assert.equal(PROJECT_EDITABLE.has('defaultProduct'), true, 'the engine does accept it')
  assert.equal(
    projectFields().some((f) => f.key === 'defaultProduct'), false,
    'but the overlay save path has no "" ⇒ clear branch, so the control could only ever be turned on',
  )
})

test('THE PROJECT FORM OFFERS NO delivery SUB-KEY, because a partial overlay destroys the rest', () => {
  // The engine replaces `delivery` WHOLESALE on merge (driver/profiles.mjs), and the project editor
  // seeds its draft from the SPARSE overlay. So a project-level control over one sub-key would write
  // {delivery:{privileged:false}} and silently drop the customer's email format, style and template —
  // while this very form went on rendering "Inherited — table".
  //
  // Asserted over rootKey rather than over the two names, so a third delivery sub-key added later is
  // caught by this test instead of shipping the bug again.
  assert.equal(PROJECT_EDITABLE.has('delivery'), true, 'the engine does accept delivery in an overlay')
  for (const f of PROFILE_FIELDS) {
    if (rootKey(f) === 'delivery') {
      assert.equal(f.customerOnly, true, `${f.key} must be customerOnly until the draft seeds from the MERGED profile`)
    }
  }
  assert.equal(
    projectFields().some((f) => rootKey(f) === 'delivery'), false,
    'no delivery control may reach the project form',
  )
})

// ── delivery: a nested value, and a real boolean ────────────────────────────────────────────────────

test('a nested delivery write SPREADS the object rather than replacing it', () => {
  // OMISSION IS NOT CONSENT, one level down. This page renders neither `style` nor `template`; a write
  // that assigned { email } over `delivery` would delete both without anyone noticing.
  // Driven through `delivery.privileged`: `delivery.email` was the vehicle until
  // removed that control, and the MECHANIC it proves is the nested write, not which sub-key rides it.
  const fromServer = { name: 'Aurora', delivery: { style: 'Plain and short.', template: 'standard' } }
  const after = applyField(fromServer, spec('delivery.privileged'), 'yes')
  assert.deepEqual(after.delivery, { style: 'Plain and short.', template: 'standard', privileged: true })
  assert.deepEqual(fromServer.delivery, { style: 'Plain and short.', template: 'standard' }, 'and no mutation')
})

test('clearing a nested field removes the sub-key, and prunes the container only when it empties', () => {
  const withSibling = applyField({ delivery: { privileged: true, style: 'x' } }, spec('delivery.privileged'), '')
  assert.deepEqual(withSibling.delivery, { style: 'x' }, 'a sibling the page never rendered is untouched')

  const lastOne = applyField({ name: 'Aurora', delivery: { privileged: true } }, spec('delivery.privileged'), '')
  assert.ok(!('delivery' in lastOne), 'delivery: {} would validate, but it is a gratuitous diff in a git-tracked file')
  assert.equal(lastOne.name, 'Aurora')
})

test('delivery.privileged is a BOOLEAN on the wire, not the string the dropdown speaks', () => {
  // The engine rejects the string: "delivery.privileged must be a boolean" (driver/profiles.mjs). A
  // control that sent "yes" would 400 on every single save.
  const f = spec('delivery.privileged')
  // The PARSE is unchanged and is this arm's subject: 'yes' still maps to a real boolean, so nothing
  // that reaches applyField by any route sends the string the engine rejects.
  assert.equal((applyField({}, f, 'yes').delivery as Record<string, unknown>).privileged, true)
  assert.equal((applyField({}, f, 'no').delivery as Record<string, unknown>).privileged, false)
  // …and back into the box. `true` no longer renders as 'yes': it is retired, the engine deletes it, and
  // 's interim removed the option, so it folds to the cleared state — which is what it
  // MEANS. Driven separately in that issue's own arms; asserted here so the round trip is not read as
  // symmetric when it deliberately is not.
  assert.equal(fieldInput({ delivery: { privileged: true } }, f), '')
  assert.equal(fieldInput({ delivery: { privileged: false } }, f), 'no')
  assert.equal(fieldInput({}, f), '')
})

test('a nested field reports set/inherited by its PATH, not by a key that never exists', () => {
  // `'delivery.email' in draft` is false for every draft ever written, so a key-based check would make
  // the project form's pill say "Inherited" over a value the project had just set.
  const f = spec('delivery.privileged')
  assert.equal(isSet({ delivery: { privileged: false } }, f), true, 'false is SET — it is a real instruction')
  assert.equal(isSet({ delivery: { style: 'x' } }, f), false)
  assert.equal(isSet({}, f), false)
  assert.equal(rootKey(f), 'delivery', 'and it is `delivery` that PROJECT_EDITABLE is asked about')
})

test('choiceLabel returns null rather than the raw value, so no caller can print a registry key', () => {
  // The whole reason this returns null instead of `?? value`: defaultProduct's stored values are
  // registry keys and driver/search-policy.mjs reserves display to stageLabel. A helper that fell back
  // to the raw value would make the leak the DEFAULT behaviour at every call site.
  // The positive case moved off marketplaceDensity when that control was removed; delivery.privileged is
  // now the field carrying static choices, and the assertion is the same one.
  assert.equal(choiceLabel(spec('delivery.privileged'), 'no'), 'No marking')
  assert.equal(choiceLabel(spec('delivery.privileged'), 'nonsense'), null, 'an unknown value has no label')
  assert.equal(
    choiceLabel(spec('defaultProduct'), 'prelim-jx'), null,
    'the level spec carries no static choices, so the internal key resolves to nothing to print',
  )
})

// ── grouping ────────────────────────────────────────────────────────────────────────────────────────

test('every field belongs to a declared group, so none can vanish from a grouped render', () => {
  // Profile.tsx renders by iterating FIELD_GROUPS and filtering. A spec whose group is not in the list
  // would be silently dropped from the page while remaining perfectly valid TypeScript-adjacent data.
  const known = new Set(FIELD_GROUPS.map((g) => g.id))
  for (const f of PROFILE_FIELDS) assert.ok(known.has(f.group), `${f.key} is in an unrendered group`)
  for (const g of FIELD_GROUPS) {
    assert.ok(PROFILE_FIELDS.some((f) => f.group === g.id), `the ${g.id} heading would render over nothing`)
  }
})

test('EVERY path field is covered, not just the two known today', () => {
  // The guard that survives the next engine change: any code-owned field whose name ends in Path must
  // be on the redaction list. A sixth field called `overridesPath` would otherwise ship to clients.
  for (const field of CODE_OWNED) {
    if (field.endsWith('Path')) {
      assert.ok(PATH_FIELDS.has(field), `${field} looks like a path but is not redacted for clients`)
    }
  }
})

// ── prose ───────────────────────────────────────────────────────────────────────────────────────────

test('a prose field stores a STRING, and a paragraph break does not shred it into a list', () => {
  // The defect this pins is the one `prose` exists to prevent. `lines` is the only other multi-line
  // control and it parses to an ARRAY; reusing it for risk appetite would turn one paragraph into one
  // array element per line the first time a user pressed Return, and the engine's validator wants prose.
  const s = spec('riskAppetite')
  assert.equal(s.kind, 'prose', 'risk appetite is a paragraph, not a one-line input')

  const written = applyField({}, s, 'Deliberate and long-horizon.\n\nPrefer thoroughness over speed.')
  assert.equal(typeof written['riskAppetite'], 'string', 'a string, never an array')
  assert.equal(written['riskAppetite'], 'Deliberate and long-horizon.\n\nPrefer thoroughness over speed.',
    'the internal paragraph break survives — only the ends are trimmed')
})

test('prose round-trips through the box unchanged', () => {
  // Seed → render → save with no edit must be a no-op. If toInput and applyField disagree about prose,
  // merely OPENING the page and pressing Save would rewrite a git-committed file.
  const s = spec('riskAppetite')
  const stored = 'Conservative.\nLead with a clear go / no-go.'
  const shown = toInput(stored, s.kind)
  assert.equal(shown, stored, 'shown verbatim in the textarea')
  assert.equal(applyField({ riskAppetite: stored }, s, shown)['riskAppetite'], stored, 'and written back identical')
})

test('clearing a prose field removes the key rather than storing an empty string', () => {
  const s = spec('riskAppetite')
  const after = applyField({ riskAppetite: 'something', name: 'Ridgeform' }, s, '   ')
  assert.equal('riskAppetite' in after, false, 'absent and empty mean different things to the validator')
  assert.equal(after['name'], 'Ridgeform', 'and nothing else is disturbed')
})

test('the marketplace listing-size control is gone from every form, and the data is not this page\'s to delete', () => {
  // OWNER RULING 2026-08-29: "if it doesn't actually affect search why is it there — get rid of it
  // completely. there is no such thing as staff only." Removed here AND from the staff editor.
  //
  // The two tests that stood here pinned the control's shape and its hint's wording. They are not
  // "deleted because they failed": the thing they described no longer exists, and what replaces them is
  // the claim that matters now — no form offers it, and no form may destroy the stored value either.
  assert.equal(PROFILE_FIELDS.some((f) => f.key === 'marketplaceDensity'), false, 'no form renders it')
  assert.equal(projectFields().some((f) => f.key === 'marketplaceDensity'), false, 'including the project form')

  // OMISSION IS NOT CONSENT — this file's own rule, at the top. The draft is seeded from the server's
  // object and edited in place, so a field with no control rides along untouched instead of being
  // reconstructed away. `dense` is what keeps a byte-heavy marketplace's output inside the worker
  // channel; a page that quietly dropped it would re-arm a measured truncation incident.
  const draft = { name: 'Bulkmart', platforms: ['amazon.com'], marketplaceDensity: 'dense' }
  assert.equal(stripCodeOwned(draft).marketplaceDensity, 'dense',
    'the page strips a value it no longer shows — the stored setting is the engine\'s, not the form\'s')

  // PROJECT_EDITABLE still names it, and that is correct: that set mirrors what the ENGINE accepts in an
  // overlay, which is a different question from what a form offers.
  assert.equal(PROJECT_EDITABLE.has('marketplaceDensity'), true, 'the engine still accepts it in an overlay')
})

test('the project overlay form offers risk appetite, so the prose control has to work there too', () => {
  // riskAppetite is in PROJECT_EDITABLE, so the kind change lands on Projects.tsx as well as Profile.tsx.
  // If only one of the two screens learned about `prose`, the same field would be a textarea on one page
  // and a one-line input on the other.
  assert.ok(PROJECT_EDITABLE.has('riskAppetite'))
  assert.ok(projectFields().some((f) => f.key === 'riskAppetite' && f.kind === 'prose'))
})

// ── — THE FORM SAYS WHAT IT DID WITH WHAT YOU TYPED ───────────────────────────────
//
// The owner's ask, verbatim: it should be easy to add or remove things and not "wonder should they put
// a comma or new line". The server's whole check was "an array when present", so a nearly-right value
// was accepted and quietly lost — `[99]` saved and held nothing.

test('1943: an out-of-range class is NAMED, not silently dropped', () => {
  const f = spec('defaultClasses')
  // The stored value is unchanged — this is about what the user is TOLD, not a new parse.
  assert.deepEqual(parseNumbers('9, 99, 0, 45'), [9, 45])
  assert.deepEqual(rejectedNumbers('9, 99, 0, 45'), ['99', '0'], 'in the order they were typed')

  const [n, ...rest] = fieldNotices(f, '9, 99, 0, 45')
  assert.equal(rest.length, 0, 'one notice, not one per bad token')
  assert.equal(n!.tone, 'dropped', 'this is the tone that may claim data did not survive')
  assert.match(n!.message, /99/)
  assert.match(n!.message, /0/)
  assert.deepEqual(fieldNotices(f, '9, 45'), [], 'and a clean input says nothing at all')
})

test('1943: the comma rule is PER FIELD, and the two sides are driven separately', () => {
  // A CLASS ASSERTED ON ONE MEMBER IS UNTESTED. Both sides of the split matter and they differ: a
  // comma in a domain is a separator, a comma in a trading name is part of the name.
  const domains = spec('matchDomains')
  assert.equal(domains.commaSeparated, true)
  assert.deepEqual(parseLines('a.com, b.com', true), ['a.com', 'b.com'])

  const names = spec('selfExclusionOwners')
  assert.notEqual(names.commaSeparated, true, 'a trading name can contain a comma')
  assert.deepEqual(parseLines('Smith, Jones & Co\nAcme', false), ['Smith, Jones & Co', 'Acme'],
    'and splitting it here would turn one entry into two')

  // applyField must take the rule from the SPEC, not from the text — that is the whole point.
  assert.deepEqual(applyField({}, domains, 'a.com, b.com')['matchDomains'], ['a.com', 'b.com'])
  assert.deepEqual(applyField({}, names, 'Smith, Jones & Co')['selfExclusionOwners'], ['Smith, Jones & Co'])
})

test('1943: a reshaped list says so, and a suspect entry says it was still saved', () => {
  const domains = spec('matchDomains')
  const reshaped = fieldNotices(domains, 'a.com, b.com')
  assert.equal(reshaped[0]!.tone, 'reshaped')
  assert.match(reshaped[0]!.message, /2 separate entries/)

  const suspect = fieldNotices(domains, 'example.com\nnot a domain')
  const check = suspect.find((x) => x.tone === 'check')
  assert.ok(check, 'an entry that is not domain-shaped is called out')
  assert.match(check!.message, /Saved, but check/,
    'and it must NOT claim the entry was dropped — parseLines keeps it, and saying otherwise is the lie this closes')
  assert.deepEqual(applyField({}, domains, 'example.com\nnot a domain')['matchDomains'],
    ['example.com', 'not a domain'], 'proving the notice tells the truth about what was stored')
})

test('1943: the dead Report email control is gone, and the stored key still rides along', () => {
  // driver/profiles.mjs refuses any delivery.email but "summary" and normalizeDelivery folds the
  // retired "table" back to it, so both dropdown options composed the same cover note.
  assert.equal(PROFILE_FIELDS.some((f) => f.key === 'delivery.email'), false,
    'a dropdown that cannot change anything is worse than no dropdown')
  // REMOVING THE CONTROL MUST NOT REMOVE THE DATA. This is the file's own seed-and-edit rule, and it is
  // the half that would fail silently: an unrendered key is preserved, never reconstructed.
  const after = applyField({ delivery: { email: 'summary', style: 'x' } }, spec('delivery.privileged'), 'no')
  assert.deepEqual(after.delivery, { email: 'summary', style: 'x', privileged: false })
})

// ── PR 2 — THE TWO PICKERS ARE NOT THE SAME CONTROL ───────────────────────────────

test('1943b: the picker edits the RAW text, so there is one write path and the notices stay true', () => {
  const classes = spec('defaultClasses')
  // A picker with its own write path would be a second way to set the field, and the notices would be
  // reporting on text nobody had typed.
  assert.equal(toggleEntry(classes, '', '9'), '9')
  assert.equal(toggleEntry(classes, '9', '12'), '9, 12')
  assert.equal(toggleEntry(classes, '9, 12', '9'), '12', 'clicking a chosen one removes it')
  assert.equal(toggleEntry(classes, '12, 9', '3'), '3, 9, 12', 'written back sorted, in the field\'s own shape')
  // and what it produces is what the parser reads, or the box and the chips disagree
  assert.deepEqual(parseNumbers(toggleEntry(classes, '9', '12')), [9, 12])
})

test('1943b: chosen state is READ FROM THE BOX, so typing and clicking cannot disagree', () => {
  const jx = spec('defaultJurisdictions')
  assert.deepEqual(chosenEntries(jx, 'France\nSpain'), ['France', 'Spain'])
  // comma-separated too, because this field accepts both and the chips must reflect either
  assert.deepEqual(chosenEntries(jx, 'France, Spain'), ['France', 'Spain'])
  assert.deepEqual(chosenEntries(spec('defaultClasses'), '9, 99, 12'), ['9', '12'],
    'the chips show what will be STORED, not what was typed — 99 is not stored and must not light up')
})

test('1943b: removal is case-insensitive, so a typed spelling and a picked one are one entry', () => {
  const jx = spec('defaultJurisdictions')
  // Someone types it, then clicks the chip for it. That means OFF, not "now I have two".
  assert.equal(toggleEntry(jx, 'united states', 'United States'), '',
    'a differently-cased duplicate must not survive the toggle')
  assert.equal(toggleEntry(jx, 'France', 'Spain'), 'France\nSpain')
})

test('1943b: the JURISDICTIONS picker is assistive — an unknown territory survives it', () => {
  // THE CLIENT-OUTCOME RULE, pinned. The engine deliberately carries a name it does not recognise:
  // scope-rules.mjs keeps an unknown name's uppercased original and products.mjs clamps rather than
  // refusing. An exclusive picker here would narrow what a client can express on the setting that
  // applies when a request does NOT name territories. If this arm ever needs changing, that is a
  // product decision and it is the owner's.
  const jx = spec('defaultJurisdictions')
  assert.equal(jx.picker, 'territories')
  const withUnknown = toggleEntry(jx, 'France', 'Ruritania')
  assert.match(withUnknown, /Ruritania/, 'a territory outside the vocabulary is added, not refused')
  assert.deepEqual(chosenEntries(jx, withUnknown), ['France', 'Ruritania'], 'and it is shown as chosen')
  assert.deepEqual(applyField({}, jx, withUnknown)['defaultJurisdictions'], ['France', 'Ruritania'],
    'and it reaches the draft — the box is still free text')
})

test('1943b: the CLASSES picker is exclusive, and that asymmetry is declared not accidental', () => {
  const classes = spec('defaultClasses')
  assert.equal(classes.picker, 'classes')
  // Nothing outside 1–45 can be stored, so an exclusive picker removes nothing that existed.
  assert.deepEqual(parseNumbers('0, 46, 99'), [], 'there is no value outside the range to preserve')
  assert.deepEqual(rejectedNumbers('0, 46, 99'), ['0', '46', '99'], 'and the form still says so')
})

// ── (interim) — A CONTROL MUST NOT OFFER A VALUE THE ENGINE DELETES ──────────────

test('1983: the dead "Yes" option is gone, and the field is still THREE-STATE on the wire', () => {
  const f = spec('delivery.privileged')
  assert.equal(f.choices?.some((c) => c.value === 'yes'), false,
    'true is retired — normalizeDelivery deletes it, so the option claimed a distinction the report cannot carry')

  // THE HALF THAT MUST NOT BREAK. false is a real instruction; absent is no opinion. Collapsing
  // them answered both with silence and shipped a clearance with no confidentiality line at all.
  assert.equal((applyField({}, f, 'no').delivery as Record<string, unknown>).privileged, false,
    'false still reaches the profile')
  assert.equal('delivery' in applyField({}, f, ''), false, 'and the cleared state still means absent')
})

test('1983: a profile that ALREADY holds the retired value renders as the house default', () => {
  // NOT HYPOTHETICAL: driver/profiles/aurora.json ships `"privileged": true`. Removing the option
  // without this fold would leave that page holding a value matching no option in its own dropdown.
  const f = spec('delivery.privileged')
  assert.equal(f.retiredValue, 'yes')
  assert.equal(fieldInput({ delivery: { privileged: true } }, f), '',
    'true and absent render identically in the engine, so they must render identically here')
  assert.equal(fieldInput({ delivery: { privileged: false } }, f), 'no', 'and false is untouched')
  assert.equal(fieldInput({}, f), '')

  // The fold is DISPLAY ONLY — it must not rewrite what is stored for a profile nobody edited.
  const untouched = applyField({ delivery: { privileged: true, style: 'x' } }, spec('riskAppetite'), 'Cautious.')
  assert.deepEqual(untouched.delivery, { privileged: true, style: 'x' },
    'editing another field leaves the retired value on disk for the engine to fold, as it always did')
})

// ── (the ruling) + 1990 (the term) — TWO RULINGS, ONE SHARED CONTROL ──────────────
// These two land together on purpose. Every picker renders ONE cleared option, so renaming that shared
// label to the owner's generic term (1990) would have silently overwritten his ruling for the
// confidentiality field (1983) — the cleared state there is not "unset", it is the report carrying its
// marking. `clearedLabel` is what lets both rulings be true at once, and this is the arm that would fail
// if a future sweep collapsed them again.

test('1983: the confidentiality options are the ruled PAIR, and neither leans on the other', () => {
  const f = spec('delivery.privileged')
  assert.equal(f.clearedLabel, 'Privileged & Confidential', 'the cleared option names the marking')
  assert.deepEqual(f.choices?.map((c) => c.label), ['No marking'], 'and its removal is named on its own terms')
  assert.equal(f.choices?.length, 1, 'still two live states — the retired `yes` is not offered')

  // The half pins, restated here because this file is where a simplifier would arrive.
  assert.equal((applyField({}, f, 'no').delivery as Record<string, unknown>).privileged, false)
  assert.equal('delivery' in applyField({}, f, ''), false, 'cleared still means absent, and absent means marked')
})

test('1990: the shared cleared label is the owner\'s generic term, and does NOT reach the marking', () => {
  assert.equal(CLEARED_LABEL, 'Generic default')
  assert.notEqual(spec('delivery.privileged').clearedLabel, CLEARED_LABEL,
    'a legal marking must never inherit the generic wording — this is the collision the ruling pair exists past')

  // Every OTHER picker takes the shared label, which is what makes it worth naming once.
  const pickers = PROFILE_FIELDS.filter((f) => f.kind === 'choice' || f.kind === 'boolean')
  const named = pickers.filter((f) => f.clearedLabel !== undefined).map((f) => f.key)
  assert.deepEqual(named, ['delivery.privileged'],
    'exactly one field overrides it; if another needs its own words, that is a copy ruling, not a default')
})


// ── item 7 — "THE CHECK BUTTON APPEARS TO CHECK NOTHING" ──────────────────────────
//
// It checked nothing on the two fields the owner actually tested. `fieldNotices` only emits a `check`
// notice `if (spec.item)`, and neither `defaultJurisdictions` nor `platforms` had an `item` at all — so
// every input, including his own "USFrance", returned an empty array. The mechanism was present and
// unarmed, which is indistinguishable from absent to the person clicking the button.

test('1996: the owner\'s own example is called out — "USFrance" is not silence any more', () => {
  const jur = spec('defaultJurisdictions')
  const notices = fieldNotices(jur, 'USFrance')
  const check = notices.find((x) => x.tone === 'check')
  assert.ok(check, 'the exact string he typed into the live page must produce a notice')
  assert.match(check!.message, /USFrance/, 'and must quote the entry back, so he can see WHICH one')
  assert.match(check!.message, /Saved, but check/,
    'assistive: the ruled design accepts an unknown territory WHILE SAYING SO — this is the saying-so')
})

test('1996: the jurisdictions notice is assistive, never a refusal', () => {
  const jur = spec('defaultJurisdictions')
  // The value is still stored exactly as typed. A validator that dropped it would be the opposite defect,
  // and the engine deliberately carries a territory it does not recognise.
  assert.deepEqual(applyField({}, jur, 'USFrance')['defaultJurisdictions'], ['USFrance'],
    'the notice must describe what was saved, not prevent it')
  assert.equal(fieldNotices(jur, 'European Union').length, 0, 'and a territory it knows says nothing at all')
})

test('1996: a marketplace that the SERVER would refuse is called out here first', () => {
  const plat = spec('platforms')
  const named = fieldNotices(plat, 'Amazon').find((x) => x.tone === 'check')
  assert.ok(named, '"Amazon" is not a bare domain and driver/profiles.mjs refuses it outright')
  assert.match(named!.message, /amazon\.com/, 'and the notice shows the shape that works')

  assert.ok(fieldNotices(plat, 'web').some((x) => x.tone === 'check'),
    '"web" is refused by name server-side — the general-web cell is implicit')
  assert.equal(fieldNotices(plat, 'amazon.com\netsy.com').length, 0, 'two real domains say nothing')
})

test('1996: THE CONTROL — a clean input on every armed field stays silent', () => {
  // Without this, all three arms above pass just as well against a field that shouted at everything,
  // which is a worse page than the silent one: a notice on every entry is a notice nobody reads.
  for (const [key, clean] of [['defaultJurisdictions', 'European Union'], ['platforms', 'amazon.com'],
    ['matchDomains', 'example.com']] as const) {
    assert.deepEqual(fieldNotices(spec(key), clean), [], `${key} must say nothing about a valid entry`)
  }
})
