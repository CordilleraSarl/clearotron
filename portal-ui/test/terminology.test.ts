// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — the terminology map is enforced, not decorative.
//
// THE FAILURE THIS EXISTS FOR is the one the issue predicts for its own deliverable: "a sweep that
// shortens strings without settling the vocabulary leaves the product saying 'search', 'clearance' and
// 'search type' interchangeably, and the next sweep starts over." A map in a document decays silently.
// This reads the RETIRED column out of TERMINOLOGY.md, so the document IS the rule — edit the table and
// the suite enforces the edit.
//
// WHY THIS DOES NOT USE `uiStrings`, which was written for the same issue. That extractor is
// deliberately conservative: it drops every string carrying code punctuation, so `Saved searches{' '}`
// — the exact site this guard was written to catch — is not in its corpus at all. A guard built on it
// would be right about the rule and narrow about the population, which is the defect class this repo
// keeps re-finding. So the corpus here is comment-stripped SOURCE, wide on purpose.
//
// It costs no false positives because **every retired spelling contains a space and identifiers do
// not**: `savedSearch`, `SavedSearchRow`, `api.savedSearches` and `savedSearches.ts` cannot match. That
// is what makes the wider corpus safe, and it is a property of the table — a future retired term
// written without a space would break it, which the arms below check for rather than assume.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { FILES, readSrc, stripComments, uiStrings } from './uiStrings.ts'

/**
 * Files OUTSIDE `portal-ui/src` that assert on the product's rendered text, and therefore carry the
 * vocabulary as surely as the screens do.
 *
 * `composer-render-check.mjs:304` read `/saved searches/i.test(txt())` against the live DOM — a
 * fourteenth site, found only because CI's browser check went red on the rename. A guard scoped to
 * `src/` would have reported clean and let that break the build. Population, again.
 */
const OUTSIDE_SRC = [
  '../../scripts/composer-render-check.mjs',
  '../../scripts/home-render-check.mjs',
  '../../scripts/portal-lifecycle-check.mjs',
]

/**
 * WHITESPACE ONLY BETWEEN THE WORDS — the separator is `\s+`, never `[\s-]+`, and that is a decision
 * rather than an oversight. `saved-search` is a LIVE WIRE VALUE: `driver/enqueue-schema.mjs`'s
 * `GEOGRAPHY_ORIGINS` freezes it as a geography origin and `driver/pipeline.mjs` writes it into a job.
 * A guard that matched hyphenated forms would be one population-widening away from demanding a protocol
 * change to satisfy a copy rule, which is not a trade this map is entitled to make.
 */
const WORD_SEPARATOR = '\\s+'

const MAP = readFileSync(fileURLToPath(new URL('../TERMINOLOGY.md', import.meta.url)), 'utf8')

/**
 * The SETTLED rows, parsed out of the map's own tables. A row reads:
 *   | **Retired** | Saved search / saved searches |
 * Everything under "## OPEN" is excluded by construction — those are flagged for a ruling and this
 * guard must not enforce a term nobody has ruled on.
 */
function settledRetirements(): string[] {
  const settled = MAP.split(/^## /m).find((s) => s.startsWith('SETTLED')) ?? ''
  const out: string[] = []
  for (const m of settled.matchAll(/\|\s*\*\*Retired\*\*\s*\|([^|]+)\|/g)) {
    for (const term of m[1].split('/')) {
      const t = term.trim()
      if (t) out.push(t)
    }
  }
  return out
}

const RETIRED = settledRetirements()

test('the map has settled rows, and the guard actually read them', () => {
  // An empty parse would make every arm below assert nothing while reporting green — the vacuous pass
  // this repo has a whole census about. The parse is checked before it is trusted.
  assert.ok(RETIRED.length > 0,
    'no retired term parsed out of TERMINOLOGY.md — either the map lost its SETTLED section or the '
    + 'table shape changed and this guard is now enforcing nothing while reporting green')
  assert.ok(RETIRED.includes('Saved search') && RETIRED.includes('Custom search'),
    `the Search template row retires both earlier names; parsed instead: ${JSON.stringify(RETIRED)}`)
})

test('every retired spelling carries a space, which is what makes the wide corpus safe', () => {
  // The guard scans SOURCE, not just prose. That is only safe while no retired term can collide with an
  // identifier — and identifiers have no spaces. A future single-word retirement must not be added to
  // the table without changing the corpus, so this fails rather than silently flagging `savedSearch`.
  for (const t of RETIRED) {
    assert.match(t, / /,
      `"${t}" has no space, so it would match identifiers as well as prose. Either give the row a `
      + 'multi-word spelling, or narrow this guard to the uiStrings corpus for that row.')
  }
})

test('no retired term appears in a user-visible string', () => {
  const offences: string[] = []
  for (const f of [...FILES, ...OUTSIDE_SRC]) {
    const src = stripComments(readSrc(f))
    for (const t of RETIRED) {
      // WHOLE-FILE, AND WHITESPACE-FLEXIBLE BETWEEN THE WORDS. A line-by-line pass cannot see a
      // thirteenth site that was live in this tree: JSX prose wraps, and NewClearance.tsx carried
      // "…yours to set — the saved" / "search does not fix it" across two source lines. No single line
      // held the phrase, so nothing matched, and this guard reported GREEN over a real instance. It was
      // found by an unrelated test failing on the same rename. `\s+` between the words is what closes it.
      //
      // CASE-INSENSITIVE: a term is retired in every casing. Matching the table's literal spelling is
      // how the first draft found 5 of the 12 sites it should have — the row read "Saved search / saved
      // searches", a capitalised singular beside a lowercase plural, so `Retire this saved search`
      // walked through as well.
      const pattern = t.trim().split(/\s+/)
        .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(WORD_SEPARATOR)
      for (const m of src.matchAll(new RegExp(pattern, 'gi'))) {
        const line = src.slice(0, m.index).split('\n').length
        offences.push(`${f}:${line}  ${m[0].replace(/\s+/g, ' ')}`)
      }
    }
  }
  assert.deepEqual(offences, [],
    `${offences.length} site(s) use a term TERMINOLOGY.md retires:\n  ${offences.join('\n  ')}\n\n`
    + 'The product must say one word for one concept. Either use the canonical term, or — if this site '
    + 'is genuinely a different concept — change the map, which is what this guard reads.')
})

test('a canonical term that nothing uses is dead weight, and the map must not carry one', () => {
  // The mirror of the arm above. A row retiring a word nobody says, in favour of a word nobody says,
  // passes forever and teaches the next reader that the vocabulary is settled when it is not.
  //
  // READ OFF THE MAP, like the retired column. This named "Custom search" literally, so the day the map
  // moved to a new canonical term it went on asserting the OLD one — a guard pinned to the word it was
  // written for, rather than to the table it exists to enforce.
  const settled = MAP.split(/^## /m).find((s) => s.startsWith('SETTLED')) ?? ''
  const canonical = [...settled.matchAll(/\|\s*\*\*Canonical\*\*\s*\|\s*\*\*([^*]+)\*\*/g)].map((m) => m[1].trim())
  assert.ok(canonical.length > 0, 'no canonical term parsed out of TERMINOLOGY.md — this arm would assert nothing')
  const corpus = FILES.flatMap((f) => uiStrings(f)).join('\n')
  for (const term of canonical) {
    assert.match(corpus, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
      `TERMINOLOGY.md declares "${term}" canonical, and no user-visible string uses it — so either `
      + 'the ruling never landed in the UI, or the extractor stopped seeing it')
  }
})

// ── ORGANISATION AND COMPANY: the two words ────────────────────────────────────────────────────────────
//
// **Organisation** is who owns the installation or the account; **Company** is whose names are cleared.
// Neither word does the other's work, and seven others do neither's: account, customer, client, tenant,
// brand, firm and matter. A reader who meets "customer store" on one screen and "Company" on the next is
// left to work out whether those are one thing — and a company clearing its own names is told, by the
// words, that the product was written for somebody else's.
//
// NOT THE RETIRED COLUMN ABOVE. Those are multi-word spellings scanned over the whole comment-stripped
// source, which is safe only because identifiers carry no spaces. These seven are single words and live
// identifiers — `me.accounts`, `?account=`, the `brand.*` screen ids — so this guard reads RENDERED
// STRINGS only: JSX text, and string or template literals that read as prose. The code keeps its names.
//
// THE EXCEPTIONS ARE LISTED HERE, each with its reason, because a use of one of these words that means
// something else — "the part that matters" — is not a slip, and a guard that could not say so would be
// switched off the first time it fired on one.

const NOT_THESE_WORDS = /\b(accounts?|customers?|clients?|tenants?|brands?|firms?|matters?)\b/i

/** Code, caught between a `>` and a `<` or between two quotes — a generic, an arrow, a prop. Not prose. */
const LOOKS_LIKE_CODE = /=>|={|[;{}]|<\/|\bconst\b|\breturn\b|\?\./

/** Every string a reader can meet in one file, with its line: JSX text, and literals that read as prose. */
function renderedStrings(file: string): { readonly line: number; readonly text: string }[] {
  const src = stripComments(readSrc(file))
  const lineOf = (i: number) => src.slice(0, i).split('\n').length
  const out: { line: number; text: string }[] = []
  for (const m of src.matchAll(/>([^<>{}]+)</g)) {
    // An entity is punctuation a reader sees — `&rsquo;` is an apostrophe — and its semicolon would
    // otherwise read as code and drop the whole sentence from the corpus.
    const text = m[1]!.replace(/&[a-zA-Z]+;/g, '’').replace(/\s+/g, ' ').trim()
    if (/[A-Za-z]{2}/.test(text) && !LOOKS_LIKE_CODE.test(text)) out.push({ line: lineOf(m.index!), text })
  }
  for (const m of src.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
    // A template's placeholders become an ellipsis: the words around them are what a reader sees.
    const text = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\$\{[^}]*\}/g, '…').replace(/\s+/g, ' ').trim()
    if (/ /.test(text) && /[a-z]{2}/.test(text) && !LOOKS_LIKE_CODE.test(text)) out.push({ line: lineOf(m.index!), text })
  }
  return out
}

/**
 * Where one of the seven words stays, and why. Matched on the file and a fragment of the string, never on
 * a line number — a line number goes stale with every edit above it, and an exception that silently
 * stopped matching would turn into an offence nobody could explain.
 */
const ORGANISATION_COMPANY_EXCEPTIONS: readonly { readonly file: string; readonly text: string; readonly why: string }[] = [
  {
    file: 'contract/allowance.ts',
    text: "this account's searches",
    why: 'the engine\'s own refusal sentence, composed by the server from the same two facts; a reader refused '
      + 'by the server and a reader warned by the screen must meet one sentence, so it changes on both sides or neither',
  },
  {
    file: 'contract/engineState.ts',
    text: 'a cloud account',
    why: "a cloud vendor's own account — the arrangement a reader already has with Google, Microsoft or "
      + 'Amazon and pays their model use through. It is one of the three ways the engine is paid for, never '
      + 'the organisation that owns the installation, which is what the word is reserved for here',
  },
  { file: 'components/ContextPackEditor.tsx', text: 'the priors that matter', why: 'the verb — what counts — not a case' },
  { file: 'screens/NewClearance.tsx', text: 'the part that matters', why: 'the verb — what counts — not a case' },
  {
    file: 'contract/failure.ts',
    text: 'while framing the matter',
    why: 'a matter is the clearance being worked on, not an organisation or a company — the same sense as '
      + 'the company settings heading "How matters are rated"',
  },
  {
    file: 'screens/UseYourAI.tsx',
    text: 'needs no account',
    why: 'an account with a service that puts the installation online — a sign-up, not an organisation or a company',
  },
  {
    file: 'contract/profileFields.ts',
    text: 'Law firm options',
    why: 'the specified label of the fold that holds the lawyer-only fields — the vocabulary issue names '
      + 'this exact string as what holds them, so the word is the point rather than a slip; a law firm here '
      + 'is a kind of customer this product serves, not the word for an organisation or a company',
  },
  {
    file: 'contract/profileFields.ts',
    text: 'a matter is read against',
    why: 'a matter is the clearance being worked on, not an organisation or a company — the same sense as '
      + 'the rating card heading "How matters are rated" below',
  },
  {
    file: 'screens/Profile.tsx',
    text: 'lessons from past matters',
    why: 'past matters are past clearances, not organisations or companies — the same sense again, and the '
      + 'sentence is about what earlier work taught, not about whose work it was',
  },
  {
    file: 'screens/NewCompany.tsx',
    text: 'How matters are rated',
    why: 'the specified heading of the rating card; a matter is a clearance, not an organisation or a company',
  },
]

test('the matcher and the corpus are both live before anything is read from them', () => {
  // POSITIVE CONTROLS FIRST. A pattern that matched nothing, or a corpus that came out empty, would make
  // the offence list below an empty array over nothing — green, and blind.
  for (const s of ['the customer store', 'Accounts', 'a client’s', 'this firm', 'Tenant']) {
    assert.match(s, NOT_THESE_WORDS, `the pattern misses "${s}"`)
  }
  for (const s of ['accountable', 'clientele', 'matterhorn', 'firmware', 'brandished']) {
    assert.doesNotMatch(s, NOT_THESE_WORDS, `the pattern fires inside the word "${s}"`)
  }
  const corpus = FILES.flatMap((f) => renderedStrings(f))
  assert.ok(corpus.length > 800, `only ${corpus.length} rendered strings were read — the extractor lost the product`)
  // A sentence carrying an entity is read, not dropped as code.
  assert.ok(corpus.some((s) => s.text.includes('’')), 'no rendered string with an apostrophe entity was read')
  // …and it reads the strings this rule is about.
  assert.ok(corpus.some((s) => /\bOrganisation\b/.test(s.text)), 'no rendered string says Organisation')
  assert.ok(corpus.some((s) => /\bcompan(y|ies)\b/i.test(s.text)), 'no rendered string says company')
})

test('ORGANISATION AND COMPANY are the only words for those two things in anything a reader meets', () => {
  const offences: string[] = []
  const used = new Set<(typeof ORGANISATION_COMPANY_EXCEPTIONS)[number]>()
  for (const file of FILES) {
    for (const s of renderedStrings(file)) {
      if (!NOT_THESE_WORDS.test(s.text)) continue
      const excepted = ORGANISATION_COMPANY_EXCEPTIONS.find((e) => e.file === file && s.text.includes(e.text))
      if (excepted) { used.add(excepted); continue }
      offences.push(`${file}:${s.line}  ${s.text.slice(0, 160)}`)
    }
  }
  assert.deepEqual(offences, [],
    `${offences.length} rendered string(s) use a word the product does not use for an organisation or a company:\n  `
    + `${offences.join('\n  ')}\n\nSay Organisation or Company. If the word means something else here, add an `
    + 'exception above with the reason.')
  // AN EXCEPTION THAT MATCHES NOTHING IS A LIE ABOUT THE TREE. It either names a string that has since been
  // reworded — and should go — or it is misspelled and exempts nothing while reading as a decision.
  const stale = ORGANISATION_COMPANY_EXCEPTIONS.filter((e) => !used.has(e)).map((e) => `${e.file}: "${e.text}"`)
  assert.deepEqual(stale, [], `exceptions that no longer match anything:\n  ${stale.join('\n  ')}`)
})
