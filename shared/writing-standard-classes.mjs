// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// WHAT A CUSTOMER SURFACE MUST NOT ACQUIRE, AS ONE TABLE.
//
// `scripts/writing-standard-check.mjs` refuses these in a diff, so a change cannot add one. The floor
// beside `driver/test/fixtures/writing-standard-backlog.json` counts what is already here, so the
// standing population can only fall. Two readers, one table — the same arrangement
// `shared/reference-guard-classes.mjs` uses, and for the same reason: a class the diff guard refuses and
// the census does not count is a class whose number nobody can act on.
//
// The standard these hold is `docs/writing-standard.md`, and the prose rules under it are
// `docs/writing-rules.md`. This file enforces the part a machine can judge. Tone is not here and cannot
// be: no word list catches a sentence that explains what the reader can already see. That stays with the
// review step in CONTRIBUTING.md.
//
// ── THE SITE RULE IS THE WHOLE DESIGN, AND IT IS THE TABLE'S OWN WORDS ──────────────────────────
//
// `engineering-identifier` matches "in text that reaches report output". That clause is not decoration,
// and dropping it was measured rather than argued: read as a plain path rule over `docs/**` it fires
// 1,995 times on backticked identifiers and 1,198 times on capitalised ones, across 50 files — almost
// every one of them a file path or an environment variable named correctly in developer documentation,
// which is what that documentation is for. A guard that fires on correct prose is one whose next reader
// deletes it from the workflow.
//
// So the site is where the text is PRINTED, not where the file lives:
//
//   in a renderer — the literal chunks of its string literals. Not a comment, not an identifier in
//   code, and not the expression inside an interpolation. `${STOP_VAR[i]}` is a variable reference in a
//   style attribute; the reader never sees those characters.
//
//   in rendered output — every line, because the file IS what the reader was given.
//
// ── WHY THIS CLASS HAS ALMOST NO POPULATION IN RENDERER SOURCE, WHICH IS NOT A FAULT ────────────
//
// Measured on this tree: applying the site rule to `driver/publish/**` leaves nothing. That is the
// design, not a hole in the check. No engineering identifier is hard-coded in either renderer — the
// connection codes, the slice and routing identifiers and the tool narration all arrive in the engine's
// own text and pass through untouched. A check reading only renderer source sees none of them, which is
// why rendered output is a scanned path and not an afterthought.
//
// SAID HERE SO AN EMPTY RESULT IS NOT READ AS A PASS. This class is prospective: it stops a new
// identifier being written INTO a renderer's printed text. What arrives at runtime in the engine's
// prose is outside any diff guard, and the review step is what covers it.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { saysSomethingNew } from './says-something-new.mjs'

// ── THE TWO EXEMPT PATHS ────────────────────────────────────────────────────────────────────────
//
// QUOTING A BAD LINE IS STILL WRITING IT, so there is no exemption for backticks and no exemption for a
// span. Two documents cannot avoid quoting what they forbid: the writing standard, whose before-and-after
// pairs ARE the banned sentences, and the enforcement note, whose table shows the identifier shapes. Both
// are exempt from every class by this list and are reviewed by hand.
//
// That is a hole, so it is written down rather than hidden inside a pattern. Two paths, listed. A third is
// a change somebody has to argue for.
//
// THE SECOND PATH NAMES A DOCUMENT THIS REPOSITORY DOES NOT SHIP. The enforcement note specifies the check
// and stays with the design record. The exemption is a rule about a path, not a read of a file, so it costs
// nothing and it is here because the day that note is vendored in is not the day to rediscover why it
// refuses its own table.
export const EXEMPT_PATHS = [
  'docs/writing-standard.md',
  'docs/enforcement.md',
]

export const isExempt = (path) => EXEMPT_PATHS.includes(path)

// ── WHERE EACH CLASS LOOKS ──────────────────────────────────────────────────────────────────────

const RENDERER = (p) => /^driver\/publish\/.*\.(mjs|css)$/.test(p)
/** Rendered output committed to the tree: what a reader was actually given. */
const RENDERED = (p) => /^mcp-server\/test\/fixtures\/.*\.(md|html)$/.test(p) && !/README\.md$/.test(p)
const SCREEN = (p) => /^portal-ui\/src\/.*\.tsx?$/.test(p)

// ── THE PRINTED SITE ────────────────────────────────────────────────────────────────────────────

/**
 * The printed text of one source line: the literal chunks of its string literals, with interpolated
 * expressions dropped and comments contributing nothing.
 *
 * ── PER LINE, DELIBERATELY, AFTER THE CROSS-LINE VERSION WAS MEASURED AND ABANDONED ─────────────
 *
 * A template literal spans lines, so a line in the MIDDLE of one carries no backtick and its markup
 * attributes read as ordinary strings. The obvious repair is to carry quote state across lines — and
 * that was built, run, and thrown away, which is recorded here so nobody rebuilds it.
 *
 * It cannot be done without parsing JavaScript properly, because of REGEX LITERALS. A pattern such as
 * `/\bcan't\b/` contains a quote, and a hand-rolled walker takes it as the start of a string; every
 * line after it in the file then reads as printed text until the next matching quote. Measured on this
 * tree: the standing population went from 22 to 55, two files appeared that print nothing, one renderer
 * went from 4 hits to 28 — AND the knockout's real caveats fell from 6 to 4, because the same desync ran
 * the other way and swallowed them. A guard that gains false hits is annoying; one that silently loses
 * true ones joins the floor's silence, and the floor only falls, so nobody looks again.
 *
 * Telling a regex literal from a division needs the parser's context, and the one parser in this tree is
 * a development dependency — importing it from `shared/`, which ships, would fail at import time on an
 * installed copy.
 *
 * SO THE FAILURE IS BOUNDED INSTEAD OF UNBOUNDED. Read per line, quote state resets every line, and the
 * only thing misread is a mid-template line — whose over-read is an interpolation, which the next rule
 * removes by shape rather than by parsing.
 *
 * @param {string} line
 * @returns {string} the printed chunks, space-joined; empty when the line prints nothing
 */
export function printedText(line) {
  const t = String(line ?? '').trim()
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return ''
  const s = String(line ?? '')
  let out = ''
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (ch === '\\') { i += 2; continue }
    if (ch === '`' || ch === "'" || ch === '"') {
      const q = ch
      i++
      while (i < s.length && s[i] !== q) {
        // AN ESCAPED CHARACTER IS EMITTED, NOT SKIPPED. Skipping it drops the character the reader
        // sees: `store\'s` became "store s", which breaks a caveat match on any sentence with an
        // apostrophe — silently, and in the direction that loses hits. A real escape sequence becomes
        // whitespace, which is what it prints as.
        if (s[i] === '\\') {
          const e = s[i + 1]
          out += (e === 'n' || e === 't' || e === 'r') ? ' ' : (e ?? '')
          i += 2
          continue
        }
        out += s[i]
        i++
      }
      i++
      out += ' '
      continue
    }
    i++
  }
  return out
}

/**
 * Remove any interpolation left in extracted text, by shape.
 *
 * THIS IS WHAT MAKES THE PER-LINE READ SAFE. On a mid-template line the walker has no backtick to tell
 * it where it is, so `style="left:${STOP_LEFT[i]}"` yields `left:${STOP_LEFT[i]}` — and the array name
 * inside it is not something a reader ever sees. A literal `${` does not occur in prose a client reads,
 * so its presence in extracted text means exactly one thing.
 *
 * Braces are counted rather than matched with a regex: `${fn({ a: 1 })}` closes at the second `}`, and a
 * lazy pattern closes at the first, leaving `)}` behind and the name still in the text.
 */
export const withoutInterpolations = (text) => {
  const s = String(text)
  let out = ''
  let i = 0
  while (i < s.length) {
    if (s[i] === '$' && s[i + 1] === '{') {
      let depth = 1
      i += 2
      while (i < s.length && depth > 0) {
        if (s[i] === '{') depth++
        else if (s[i] === '}') depth--
        i++
      }
      out += ' '
      continue
    }
    out += s[i]
    i++
  }
  return out
}

/** A line whose text is aimed at a developer or the operator, not at a client. */
const DIAGNOSTIC_SITE = /\bthrow\b|new Error\(|console\.(?:log|warn|error|info|debug)\(/

/**
 * The lines covered by each diagnostic statement, not just the line its keyword is on.
 *
 * A thrown message is usually several lines of concatenation and the keyword sits on the first, so a
 * per-line test excuses the `throw` and then refuses the sentence it throws. Measured: the operator
 * message naming an unset setting was excused on its own line and refused on the next two. The statement
 * is followed to where its parentheses balance instead.
 */
const diagnosticLines = (raw) => {
  const covered = new Set()
  for (let i = 0; i < raw.length; i++) {
    if (!DIAGNOSTIC_SITE.test(raw[i])) continue
    let depth = 0
    let seen = false
    for (let j = i; j < raw.length; j++) {
      covered.add(j)
      for (const ch of raw[j]) {
        if (ch === '(') { depth++; seen = true }
        else if (ch === ')') depth--
      }
      if (seen && depth <= 0) break
      if (!seen && /;\s*$/.test(raw[j])) break
    }
  }
  return covered
}

/** Strip the spans where text is an address rather than prose. */
const withoutUrls = (t) => String(t).replace(/https?:\/\/\S+/g, ' ').replace(/[a-z]+:\/\/\S+/gi, ' ')

/**
 * Every line's readable site in a file, keyed by line number.
 *
 * In a renderer this is the printed text of its string literals; in committed rendered output it is the
 * line itself, because that file IS what the reader was given.
 */
export function sitesFor(path, text) {
  const map = new Map()
  const raw = String(text).split('\n')
  if (RENDERED(path)) {
    raw.forEach((l, i) => { if (l.trim()) map.set(i + 1, withoutUrls(l)) })
    return map
  }
  if (!RENDERER(path) && !SCREEN(path)) return map
  const diagnostic = diagnosticLines(raw)
  raw.forEach((l, i) => {
    if (diagnostic.has(i)) return
    const site = withoutInterpolations(withoutUrls(printedText(l)))
    if (site.trim()) map.set(i + 1, site)
  })
  return map
}

// ── THE CAVEAT SENTENCES ARE DATA ───────────────────────────────────────────────────────────────
//
// Held in a fixture beside this module rather than spelled here, because a class list that reprints its
// own specimens counts itself — and this module is read by the census that counts them. The fixture is
// the row that matters for this class: most caveats arrive in the engine's text rather than a renderer's
// source, so the sentences are matched wherever they are printed rather than where they were authored.
//
// BESIDE THIS MODULE MEANS IN THIS DIRECTORY, AND THAT IS A PACKAGING CONSTRAINT AS WELL AS A TIDINESS
// ONE. `shared/` ships; `**/fixtures/` is excluded from the published package by `package.json`. A
// top-level read of a fixture under `driver/test/` would resolve here and throw on the installed copy —
// an import-time failure in a module the runtime loads, found by whoever installed it rather than by us.
export const CAVEATS = JSON.parse(readFileSync(
  fileURLToPath(new URL('./writing-standard-caveats.json', import.meta.url)), 'utf8')).sentences

/** Normalised for comparison: a caveat that was re-wrapped or re-spaced is the same caveat. */
const flatten = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()

// ── THE LINE CLASSES ────────────────────────────────────────────────────────────────────────────
//
// Each is `{ id, why, paths, find }`. `find` returns every offending token on the line's SITE, so a
// class cannot be written in a way that reintroduces a comment or an interpolation by accident.
//
// No pattern here carries the `g` flag at rest. A shared `g`-flagged regex carries `lastIndex` between
// calls, so the same instance answers differently on its second use. `every` adds the flag per call.
const every = (re, text) => [...String(text).matchAll(new RegExp(re.source, re.flags.replace('g', '') + 'g'))]

const SCREAMING = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/
const TOOL_NAME = /\b[a-z][a-z0-9]*__[a-z0-9_]+\b/
const BACKTICKED = /`([a-z][a-zA-Z0-9]*(?:[._/-][a-zA-Z0-9]+)+)`/
const BESIDE_SOURCE = /\b(?:adapter|connector|tool server)\b/i

/** @type {{id: string, why: string, paths: (p: string) => boolean, find: (site: string) => string[]}[]} */
export const LINE_CLASSES = [
  {
    id: 'engineering-identifier',
    paths: (p) => RENDERER(p) || RENDERED(p),
    why: 'an engineering identifier in text a client reads. Error codes, source names and internal '
      + 'identifiers are not the reader\'s vocabulary. State the limit and its consequence: '
      + '"Case-law research could not be completed for Japan."',
    find: (site) => [
      ...every(SCREAMING, site).map((m) => m[0]),
      ...every(TOOL_NAME, site).map((m) => m[0]),
      ...every(BACKTICKED, site).map((m) => m[1]),
      ...every(BESIDE_SOURCE, site).map((m) => m[0]),
    ],
  },
  {
    id: 'internal-marker',
    paths: (p) => RENDERER(p) || RENDERED(p),
    why: 'a reviewer-only marker in rendered output. The rule that hides it is declared once, for print '
      + 'only — so the exported file is clean and the browser copy, which is what gets sent on, is not. '
      + 'Mark it where it is built, not where it is displayed.',
    find: (site) => every(
      /class="[^"]*\binternal\b[^"]*"|\breview-note\b|\brv-(?:bar|head|tag|spacer)\b|For the reviewing lawyer|Internal review copy/,
      site).map((m) => m[0]),
  },
  {
    // ── EVALUATED OVER THE FILE, NOT THE LINE, AND THAT IS NOT AN OPTIMISATION ────────────────────
    //
    // A caveat in a renderer is built by concatenation: the knockout's scope block is six source lines
    // of `+ '...'`, and the sentence the standard forbids straddles two of them. Read line by line it
    // matches nothing — the same defect the reference guard records as a citation that wrapped, where
    // four went in, three came out and the count returned to its floor with the fourth still in the
    // tree. Worse than a miscount, because the floor only falls and a silent zero reads as repaired.
    //
    // So `find` is never called for this class. `fileOffences` joins the printed chunks and searches
    // the join, attributing each hit to the line its match begins on.
    id: 'known-caveat',
    paths: (p) => RENDERER(p) || RENDERED(p) || SCREEN(p),
    why: 'a caveat sentence. Say what the search did and what happens next; never define the product by '
      + 'negation, and never hand the reader a limit they cannot act on.',
    find: () => [],
  },
]

/**
 * Every line class this ONE line offends, as `{ id, token, why }`.
 *
 * Reads the line as a one-line file through the same walker `fileOffences` uses, so there is one
 * definition of "what a reader sees". A line taken out of its file cannot know it sits inside a template
 * literal, which is a real limit of asking the question this way: `fileOffences` is the authoritative
 * reading, and this is here for an arm driving a single line.
 *
 * `known-caveat` is not answered here — it is a property of the joined text.
 */
export function offendingClasses(path, line) {
  if (isExempt(path)) return []
  const site = sitesFor(path, String(line ?? '')).get(1)
  if (!site || !site.trim()) return []
  const out = []
  for (const c of LINE_CLASSES) {
    if (!c.paths(path)) continue
    for (const token of c.find(site)) out.push({ id: c.id, token, why: c.why })
  }
  return out
}

/**
 * THE ONE ENTRY POINT. Every offence in one file, as `{ id, token, why, line }`.
 *
 * Three readings, because the classes are three shapes and pretending otherwise is what loses hits: the
 * per-line classes over each line's site; `known-caveat` over the joined printed text, so a sentence
 * built by concatenation across source lines is still one sentence; and the block classes over the whole
 * file, because "this screen writes its own heading" is not a property any line has.
 *
 * @param {string} path repo-relative
 * @param {string} text the file's contents
 */
export function fileOffences(path, text) {
  if (isExempt(path)) return []
  const out = []
  const sites = sitesFor(path, text)

  for (const [line, site] of sites) {
    for (const c of LINE_CLASSES) {
      if (!c.paths(path)) continue
      for (const token of c.find(site)) out.push({ id: c.id, token, why: c.why, line })
    }
  }

  // ── THE JOINED PRINTED TEXT, WITH A MAP BACK TO LINES ──
  //
  // Flattened in step with the map rather than by rewriting the string: collapsing whitespace with a
  // replace would desynchronise the index from the line it came from, and every caveat would then be
  // reported against the wrong line — which reads as a correct finding and sends the reader to the wrong
  // place.
  const caveatClass = LINE_CLASSES.find((c) => c.id === 'known-caveat')
  if (caveatClass.paths(path)) {
    const flat = []
    const flatAt = []
    let lastSpace = true
    for (const [line, site] of sites) {
      for (const raw of site + ' ') {
        const ch = raw.toLowerCase()
        if (/\s/.test(ch)) { if (!lastSpace) { flat.push(' '); flatAt.push(line) } lastSpace = true; continue }
        flat.push(ch); flatAt.push(line); lastSpace = false
      }
    }
    const hay = flat.join('')
    for (const c of CAVEATS) {
      const needle = flatten(c)
      if (!needle) continue
      let from = 0
      for (;;) {
        const idx = hay.indexOf(needle, from)
        if (idx === -1) break
        out.push({ id: 'known-caveat', token: c, why: caveatClass.why, line: flatAt[idx] ?? 1 })
        from = idx + needle.length
      }
    }
  }

  for (const b of blockOffences(path, text)) out.push(b)
  return out
}

// ── THE BLOCK CLASSES ───────────────────────────────────────────────────────────────────────────
//
// TWO CLASSES THAT NO LINE PREDICATE CAN EXPRESS, and the table knew it: "a screen that renders a page
// title without going through PageHeader" is a property of a FILE, and "a lede whose content words are
// all already in its title" needs both lines at once. So these read the file, and the diff decides only
// whether this change is answerable for it.
//
// THE EYEBROW PREDICATES ARE THE ONES THE SUITE ALREADY HOLDS. `portal-ui/test/oneHeaderPerPage.test.ts`
// has enforced both halves of this class as a corpus guard since the double headers were removed. They
// are lifted here and that test imports them, because two definitions of one rule is one definition and
// one imitation of it — and the imitation is whichever the reader did not run. The population floors in
// that test stay there: they are the test's own business, not the class's.

/** A file that draws a screen, read off its markup rather than its directory. */
export const drawsScreen = (src) => /className="screen/.test(src) && !/className="topbar/.test(src)

/**
 * An eyebrow standing above a heading, as `{ line, eyebrow }` pairs.
 *
 * Read over a WINDOW rather than adjacent lines: the pair on one screen had a component and a four-line
 * note between the two, and an adjacency check called that screen clean while a reader saw two stacked
 * lines.
 */
export function eyebrowOverHeading(src) {
  const lines = String(src).split('\n')
  const out = []
  let eyebrow = -99
  lines.forEach((l, i) => {
    if (/className="eyebrow"/.test(l)) eyebrow = i
    if (/<h1\b/.test(l) && i - eyebrow <= 8) out.push({ line: i + 1, eyebrow: eyebrow + 1 })
  })
  return out
}

/**
 * How a screen writes its own page heading instead of opening with the shared component, or null.
 *
 * THE PROPERTY, NOT A FONT SIZE. An earlier cut of this rule matched an `<h1>` carrying the inline style
 * the hand-written headers happened to share; a bare `<h1>About</h1>` passed it, and three of those were
 * live on reachable screens while the arm read green. What may not happen is a screen OPENING with a
 * heading it wrote itself — a heading inside a page, for an empty state or a run's own mark, is sized for
 * where it sits and is not the page naming itself.
 */
const H1_BLOCK = /<h1\b[^>]*>([\s\S]*?)<\/h1>/g

/**
 * Is this heading the page's SUBJECT rather than its name?
 *
 * The carve-out this file's prose has always claimed and its code did not make: "a heading inside a page,
 * for an empty state or a run's own mark, is sized for where it sits and is not the page naming itself."
 * A page's NAME is a literal a reader could find in the rail — About, Profile, Give access. A page's
 * SUBJECT is whatever this run is about, and it arrives interpolated.
 *
 * So strip the JSX expressions and the tags, and ask whether any words are left. Nothing left means the
 * heading was entirely its subject.
 */
const isSubjectHeading = (inner) => {
  const bare = String(inner)
    .replace(/\{(?:[^{}]|\{[^{}]*\})*\}/g, '')   // JSX expressions, one level of nesting
    .replace(/<[^>]*>/g, '')                      // nested tags
  return !/[A-Za-z]{2}/.test(bare)
}

export function writesItsOwnHeader(src) {
  const text = String(src)
  const header = text.indexOf('<PageHeader')
  const h1 = text.indexOf('<h1')
  if (header < 0 && h1 < 0) return null
  if (header < 0) {
    // A screen whose only headings are its subject names nothing, so there is nothing for the shared
    // component to carry. UNKNOWN FIRES: if no `<h1>…</h1>` block can be read at all while the tag is
    // present — an unclosed tag, a generated one — the class stands. A narrowing that cannot see its
    // subject must refuse, or it goes quiet on exactly the file it cannot parse.
    const blocks = [...text.matchAll(H1_BLOCK)]
    if (!blocks.length) return 'writes a heading and never the shared component'
    return blocks.every((m) => isSubjectHeading(m[1]))
      ? null
      : 'writes a heading and never the shared component'
  }
  if (h1 >= 0 && h1 < header) return 'opens with a heading of its own, before the shared component'
  return null
}

/**
 * Every `PageHeader` whose lede restates its title, as `{ line, title, lede }`.
 *
 * ONE DEFINITION OF "SAYS NOTHING NEW", shared with the knockout renderer's caveat filter in
 * `shared/says-something-new.mjs`. The renderer asks it of a caveat against the scope block; this asks it
 * of a lede against its title. Same rule, one function.
 *
 * A lede with no content words at all is not a restatement — it is a lede saying nothing, which is a
 * different fault and not this class's.
 */
export function restatingLede(src) {
  const out = []
  const text = String(src)
  for (const m of text.matchAll(/<PageHeader\b([\s\S]*?)\/?>/g)) {
    const block = m[1]
    const title = /title=(?:"([^"]*)"|\{`([^`]*)`\})/.exec(block)
    const lede = /lede=(?:"([^"]*)"|\{`([^`]*)`\})/.exec(block)
    if (!title || !lede) continue
    const t = title[1] ?? title[2] ?? ''
    const l = lede[1] ?? lede[2] ?? ''
    if (!l.trim()) continue
    if (!saysSomethingNew(l, t)) out.push({ line: text.slice(0, m.index).split('\n').length, title: t, lede: l })
  }
  return out
}

/** @type {{id: string, why: string, paths: (p: string) => boolean}[]} */
export const BLOCK_CLASSES = [
  {
    id: 'eyebrow-heading',
    paths: SCREEN,
    why: 'a page names itself once. An eyebrow over a heading is a header and its echo, and a screen '
      + 'writing its own heading drifts from every other screen the day after it is written.',
  },
  {
    id: 'restating-lede',
    paths: SCREEN,
    why: 'a line under the title that says what the title already said. Omit it rather than restate it.',
  },
]

/** Every block-class offence in one file, as `{ id, token, why, line }`. */
export function blockOffences(path, src) {
  if (isExempt(path) || !SCREEN(path)) return []
  const out = []
  const [eyebrowWhy, ledeWhy] = BLOCK_CLASSES.map((c) => c.why)
  if (drawsScreen(src)) {
    const own = writesItsOwnHeader(src)
    if (own) out.push({ id: 'eyebrow-heading', token: own, why: eyebrowWhy, line: 1 })
  }
  for (const e of eyebrowOverHeading(src))
    out.push({ id: 'eyebrow-heading', token: `an eyebrow at line ${e.eyebrow} stands above this heading`, why: eyebrowWhy, line: e.line })
  for (const r of restatingLede(src))
    out.push({ id: 'restating-lede', token: `"${r.lede}" under "${r.title}"`, why: ledeWhy, line: r.line })
  return out
}

// ── THE CENSUS ──────────────────────────────────────────────────────────────────────────────────

export const CLASSES = [...LINE_CLASSES, ...BLOCK_CLASSES]
const COLUMN = new Map(CLASSES.map((c, i) => [c.id, i]))

/**
 * The standing population, per file, as `{ total, files: { path: number[] } }` — one count per class in
 * `CLASSES` order, for every file carrying at least one.
 *
 * A file with no hit is absent rather than zero-filled, so the fixture shrinks as the tree is repaired
 * instead of recording a growing list of clean files.
 *
 * @param {string[]} files repo-relative paths
 * @param {(path: string) => string} read
 */
export function censusOf(files, read) {
  const out = { total: 0, files: {}, exempt: 0 }
  for (const path of files) {
    if (isExempt(path)) { out.exempt++; continue }
    let text
    try { text = read(path) } catch { continue }
    if (text.includes('\0')) continue
    const counts = CLASSES.map(() => 0)
    for (const { id } of fileOffences(path, text)) counts[COLUMN.get(id)]++
    const sum = counts.reduce((a, b) => a + b, 0)
    if (sum) { out.files[path] = counts; out.total += sum }
  }
  return out
}
