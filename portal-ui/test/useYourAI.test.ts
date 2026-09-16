// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The Use-your-AI page, after the ruthless cut.
//
// REPLACES `assistants.test.ts` and `assistantsDerived.test.ts`, whose subject — a client table and an
// offered/withheld derivation living in the browser — was DELETED, not moved. Those files asserted real
// properties and the properties survive; they are asserted where the behaviour now is:
//
//   · "every absence is NAMED with its reason"        → driver/test/connect-clients-are-data.test.mjs
//   · "no assistant is handed a door it cannot walk"  → same file, the per-host-shape arm
//   · the report-recipe PARITY                        → re-pointed below, page half moved to CONNECT.md
//   · "every allowance sentence is off the page"      → carried forward below, still a page property
//
// The one arm deliberately NOT carried is "the Connect buttons are DISABLED when nothing is wired". The
// ruling replaced that behaviour: a button that cannot work is not rendered as a button at all.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { connectionPill, continueOffer, foldsSteps, watchForConnected } from '../src/contract/connectYourAi.ts'

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const SCREEN = read('../src/screens/UseYourAI.tsx')

/**
 * The page's source with its prose removed — the code a reader could end up seeing the output of.
 */
function code(src: string): string {
  const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, ' ')
  return noBlocks.split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n')
}

/**
 * WHAT A READER ACTUALLY SEES: JSX text and the string literals that become it.
 *
 * NOT every line of code, which is what this arm checked first — and it failed on `revealed.address`, a
 * property name no reader ever reads. A guard that cannot tell an identifier from a sentence forces the
 * next person to rename a variable to satisfy it, which teaches them the rule is arbitrary. Attribute
 * values (`style`, `className`, `href`) are stripped for the same reason: `--text-muted` is not prose.
 */
function readerText(src: string): string {
  let c = code(src)
  c = c.replace(/style=\{\{[\s\S]*?\}\}/g, ' ')          // style objects are not prose
  c = c.replace(/\b(className|href|rel|target|type|key)=(\{[^}]*\}|"[^"]*"|'[^']*')/g, ' ')
  // PROSE PASSED AS A PROP IS STILL PROSE. The page's own title and standfirst moved into
  // `<PageHeader title="…" lede="…" />`, and a double-quoted attribute is neither a JSX text node nor a
  // quoted string this extractor collected — so the heading vanished from its view and, with it, every
  // word of the standfirst. The floor below caught that, which is the whole reason it is there: without
  // it this arm would have gone on reporting six words absent from text it could no longer see.
  c = c.replace(/\b(title|lede|label|hint|note|placeholder)="([^"]*)"/g, ' >$2< ')
  // An interpolation is an EXPRESSION, not prose: `${r.value.address}` puts a property name inside a
  // template literal, and reading that as something the reader sees would force a rename to satisfy a
  // rule about English. The surrounding text is prose and is still checked.
  c = c.replace(/\$\{[^}]*\}/g, ' ')
  const out: string[] = []
  for (const m of c.matchAll(/>([^<>{}]+)</g)) out.push(m[1])                    // JSX text nodes
  for (const m of c.matchAll(/'([^'\n]{4,})'|`([^`\n]{4,})`/g)) out.push(m[1] ?? m[2] ?? '')
  return out.join('\n')
}

test('NOTHING TECHNICAL REACHES THE READER — the six words that may not appear, in any state', () => {
  // Owner, 2026-08-31: "there is NO PLACE for ANYTHING technical on there." The page this replaced said
  // "address" 47 times and "key" 31. A reader connecting their own assistant is not choosing a
  // transport or a scope, and every one of those words asked them to understand something the product
  // should be deciding for them.
  // NO EXEMPTION FOR THE HELP LINK ANY MORE. Its text used to be "GitHub MCP Connector Documentation",
  // allowed the words by its exact value; the design replaced it with a "Setup guide" button, which needs
  // none. The one exemption left is the guide's address, an href held in a constant that no reader reads
  // as text (`href=` itself is already stripped above; the constant it points at is not).
  const URL_ = 'https://github.com/CordilleraSarl/clearotron/blob/main/mcp-server/CONNECT.md'
  assert.ok(SCREEN.includes(`const HELP_URL = '${URL_}'`), 'the guide\'s address moved — the exemption below is now exempting nothing')
  const text = readerText(SCREEN).split('\n').filter((l) => l !== URL_).join('\n')
  // THE FLOOR IS THE PAGE'S OWN TITLE, whatever it is called: without it every absence below is an absence
  // over text the extractor never saw.
  assert.ok(text.includes('Connect your AI'), 'the extractor found no page text — it is asserting nothing')
  // AND THE STANDFIRST, SEPARATELY. The lede became a JSX fragment (`lede={<>…</>}`) so it can carry the
  // Optional tag, and the `lede="…"` rule above no longer reaches it; it is read today only as a text node
  // inside the fragment. The title is still a quoted attribute, so the floor above would stay green if the
  // lede slipped into a form this extractor cannot read, and every word of it would go unchecked.
  assert.ok(text.includes('Run and interrogate clearances'), 'the extractor no longer sees the standfirst — its words go unchecked')
  for (const word of ['MCP', 'connector', 'token', 'scope', 'address', 'key']) {
    const hits = text.split('\n').filter((l) => new RegExp(`\\b${word}\\b`, 'i').test(l))
    assert.deepEqual(hits, [], `the reader can see the word "${word}"`)
  }
})

test('THE PAGE DERIVES NOTHING — it holds no client table and no offered/withheld logic', () => {
  // The defect this closed: the browser held its own table on its own axis, and it disagreed with the
  // server's about whether Codex needs an address. Two tables partitioning the same clients cannot be
  // kept in step by hand — that is what the deleted `assistantsFor`/`addressFor` proved.
  for (const gone of ['assistantsFor', 'addressFor', 'signInSentence', 'contract/assistants']) {
    assert.ok(!SCREEN.includes(gone), `the page still reaches for ${gone}, which was deleted`)
  }
  // And it must not grow a replacement: no literal client name anywhere in the page's code.
  const c = code(SCREEN)
  for (const id of ['claude-code', 'codex', 'claude-desktop', 'cowork', 'chatgpt', 'perplexity']) {
    assert.ok(!c.includes(id), `the page names the client "${id}" — adding an assistant is a server-side row`)
  }
})

test('AN UNSERVED ROW DOES NOT RENDER FOR A CLIENT AT ALL — not a button, not a sentence', () => {
  // THIS ARM USED TO REQUIRE THE SENTENCE. It asserted that an unavailable assistant rendered as prose
  // with a reason and a remedy, which was right until the owner ruled otherwise:
  // an unserved row does not render for a client at all.
  //
  // The measurement behind that ruling is why it matters. On a HEALTHY hosted install the three stdio
  // rows resolve `served: false` carrying "this copy of the software is incomplete… whoever installed it
  // will need to install it again". Those strings are the OPERATOR's case — correct for somebody whose
  // disk route is genuinely missing — reused for a reader who simply has no shell. So the sentence this
  // arm used to require was itself the defect: a lawyer opened the page and read that their software
  // needed reinstalling.
  //
  // The wording stays correct where it is true, and a client never reaches it because a client never
  // sees the row.
  const c = code(SCREEN)
  assert.match(c, /\.filter\(\(o\)\s*=>\s*o\.served\)/,
    'the page no longer filters to served offers, so an unserved row can reach the reader');
  // Filtered BEFORE anything reasons about routes or selection, so no later branch can render one by
  // accident. Both derivations must sit downstream of the filter.
  const servedAt = c.indexOf('.filter((o) => o.served)')
  for (const later of ['const routes', 'const here']) {
    assert.ok(c.indexOf(later) > servedAt,
      `${later} is derived before unserved rows are removed — it can still see them`)
  }
  assert.ok(!/offer\.reason|offer\.fix/.test(c),
    'the operator-shaped reason/fix wording is being rendered again on a surface a client reads')
})

test('THE ONE HONEST UNAVAILABLE SURVIVES — a deployment that serves nothing says so, and names who can fix it', () => {
  // The ruling removed the PER-ROW absence, not the deployment-level one. An absence that names nobody
  // reads as breakage, so this sentence is kept and it is about the installation rather than the reader.
  // WHITESPACE-NORMALISED, because JSX wraps prose across source lines and a reader sees one sentence.
  // Matching the raw file would pin the line breaks rather than the copy, and would fail the next time
  // somebody reflowed a paragraph without changing a word of it.
  const prose = SCREEN.replace(/\s+/g, ' ')
  assert.match(prose, /Not available on this installation yet/)
  assert.match(prose, /Whoever installed it can put it online/,
    'the unavailable state does not say who can change it')
  assert.match(code(SCREEN), /!served\.length/, 'the deployment-level absence is not gated on serving nothing')
})

test('NOTHING IS EXPANDED ON ARRIVAL — and the mechanism is single-select, not an accordion', () => {
  // "A reader who lands on the page sees the list, never a wall of accordions." The rebuild changed HOW
  // that is guaranteed: there is no per-row open state at all now, so nothing can start open. The old
  // spelling of this arm looked for `useState(false)`, which pinned the accordion it was written against.
  const c = code(SCREEN)
  assert.ok(!/useState\(true\)/.test(c), 'something on this page starts open')
  assert.ok(!/aria-expanded/.test(c),
    'a per-row expansion is back — single-select plus a reserved slot is the mechanism, and accordions '
    + 'were removed rather than tuned because any per-row expansion moves every row beneath it')
  // Nothing is picked until a press: the slot renders its empty line, not a panel.
  assert.match(c, /useState<string \| null>\(null\)/, 'the selection does not start empty')
  // And what opens is the panel for ONE destination, in a slot that reserves its own height.
  assert.match(SCREEN, /ai-slot/, 'the reserved slot is gone, so a selection can move the page')
})

test('THE PANEL CANNOT PUSH THE PAGE — the slot reserves height whether or not anything is in it', () => {
  // The owner met this as "new links open and move shit around". A restyle was explicitly rejected: the
  // reserved slot is the mechanism, and it lives in CSS, so asserting the markup alone would pass over a
  // stylesheet that stopped reserving anything.
  const css = readFileSync(new URL('../src/base.css', import.meta.url), 'utf8')
  const slot = css.slice(css.indexOf('.ai-slot {'), css.indexOf('}', css.indexOf('.ai-slot {')))
  // A POSITIVE height. `\d+px` matches `0px`, so the first spelling of this passed a slot that reserved
  // nothing — found by planting min-height:0 and watching both this arm and the browser battery stay
  // green. The number is what makes "reserved" mean anything.
  const px = Number(slot.match(/min-height:\s*(\d+)px/)?.[1] ?? 0)
  assert.ok(px >= 120,
    `the slot reserves ${px}px, which is not enough to hold a panel — selecting a destination then grows `
    + 'the page under the reader, which is the reflow this redesign removes')
})

// "THE COPIED LABEL COSTS ZERO LAYOUT" LIVED HERE and is retired with the thing it guarded: a row no
// longer copies anything (the approved design, 2026-09-11 — "Pressing a row no longer copies anything"),
// so there is no "✓ Copied" label on a row to swap. The property it protected — a press moves nothing —
// is measured in pixels by `scripts/ai-page-render-check.mjs` on every pick and every Copy press, and the
// panel's reserved height is pinned below.

test('THE SLOT IS AS TALL AS ITS TALLEST PANEL — measured from a hidden copy of every panel, not guessed', () => {
  // A fixed minimum reserves some space; only the tallest panel's height reserves enough. So the page
  // draws every panel on the card, hidden, at the slot's width, and takes the largest — and the copy must
  // be stacked in one cell, or it is as tall as all of them together and pads the page below.
  const c = code(SCREEN)
  assert.match(c, /className="ai-probe"[^>]*ref=\{probe\}/, 'the hidden copy the slot is measured from is gone')
  // Every panel, with whatever the page adds under the steps — a line the copy left out is height the slot
  // did not reserve.
  assert.match(c, /here\.map\(\(o\) => <StepsPanel key=\{o\.id\} offer=\{o\}(?: watch=\{watch\})? measuring \/>\)/,
    'the hidden copy does not draw EVERY panel on this card, so the tallest may be missing from it')
  assert.match(c, /offer=\{chosen\}[\s\S]{0,120}watch=\{watch\}/, 'the line under the last step is drawn but not measured, or measured but not drawn')
  assert.match(c, /Math\.max\(0, \.\.\.\[\.\.\.el\.children\]/, 'the slot is not sized to the tallest panel')
  const css = readFileSync(new URL('../src/base.css', import.meta.url), 'utf8')
  const probe = css.slice(css.indexOf('.ai-probe {'), css.indexOf('}', css.indexOf('.ai-probe > *')))
  assert.match(probe, /visibility:\s*hidden/, 'the measuring copy is visible')
  assert.match(probe, /grid-area:\s*1 \/ 1/, 'the measuring copy is not stacked in one cell')
})

test('THE WHERE-CHOICE — the approved labels, and asked of the people it has two answers for', () => {
  const prose = SCREEN.replace(/\s+/g, ' ')
  assert.ok(prose.includes("disk: { label: 'Clearotron is installed on this machine (laptop/desktop)'"))
  assert.ok(prose.includes("'public-http': { label: 'Clearotron is running elsewhere (e.g. Cloud/Server)'"))
  // Nothing shows below the cards until one is picked: the active place starts empty where they show.
  assert.match(code(SCREEN), /const active = asks \? place : \(routes\[0\] \?\? null\)/,
    'with the cards showing, something is picked on the reader\'s behalf')
  assert.match(code(SCREEN), /useState<string \| null>\(null\)/)
})

test('every allowance sentence is still off the page', () => {
  // Carried forward from the deleted assistants.test.ts: "get rid of any other text — limits, caps etc.,
  // all gone". The sweep that closed it found TWO allowance sentences where the issue named one.
  for (const word of ['allowance', 'cap ', 'caps', 'limit', 'quota', 'per month']) {
    assert.ok(!new RegExp(word, 'i').test(readerText(SCREEN)), `an allowance sentence returned: "${word}"`)
  }
})

// THE RECIPE PARITY IS GONE BECAUSE ONE SIDE OF IT IS.
//
// It joined this screen's per-assistant steps to the set-up block inside `render.mjs`'s Ask-AI band, so
// that a reader who set up from a report and a reader who set up from the portal followed the same
// instructions. The owner's 2026-09-15 ruling took the band out of the report: a report no longer
// carries a recipe, an address, or a question, and the only route to a connector is this page.
//
// Its own comment said what to do here — "the report no longer carries its own set-up block — if so,
// this parity is moot and should be deleted". Kept instead, it would have anchored on a pattern that
// matches nothing and failed forever for the wrong reason; loosened to survive, it would have gone green
// over an empty string. What replaces it is not another parity but the absence the ruling created, held
// in driver/test/render-frozen.test.mjs by the content hash itself.

test('THE KEY NEVER REACHES STATE, A PROP OR THE DOM — except the one degraded path', () => {
  // Ruling 2026-08-31: "The page never shows a key, in any state", and the reason that shapes the
  // code — "a rendered key outlives the moment. It's in the DOM, in the screenshot someone takes, in the
  // browser cache, on a screen left open." So the minted value lives in one async function and is
  // dropped when it returns.
  const c = code(SCREEN)
  // FROM the press TO the render that follows it — `indexOf('return (')` alone finds the EARLY
  // return in the not-served branch, which sits above the press and would slice to nothing. The
  // anti-vacuity assert below caught exactly that rather than letting the arm pass over an empty
  // string, which is the whole reason it is there.
  const from = c.indexOf('const press = async')
  const press = c.slice(from, c.indexOf('return (', from))
  assert.ok(press.includes('api.connectKey()'), 'the press does not mint — this arm is asserting nothing')

  // Exactly ONE state setter may ever receive it, and it is the clipboard-refused path.
  const setters = [...press.matchAll(/set([A-Z]\w*)\(/g)].map((m) => m[1])
  const withKey = [...press.matchAll(/set([A-Z]\w*)\(([^)]*)\)/g)]
    .filter((m) => /\bkey\b/.test(m[2] ?? '')).map((m) => m[1])
  assert.ok(setters.length > 0, 'no state is set during a press — the extractor is wrong')

  // TWO SETTERS MAY SEE IT NOW, AND THE SECOND ONE IS A DELIBERATE, BOUNDED EXCEPTION.
  //
  // `Revealed` is the clipboard-refused path and is unchanged. `Landed` is the panel line proving the
  // press worked — "On your clipboard now" — and the brief specifies it MASKED (`v1.••••`). That is
  // three characters of the credential in the DOM, which is more than zero, so it is pinned rather than
  // waved through: the value must pass through `mask()`, and `mask()` must be lossy.
  assert.deepEqual([...withKey].sort(), ['Landed', 'Revealed'],
    'a credential reaches state somewhere other than the masked panel line and the refused-clipboard reveal')
  const landed = press.match(/setLanded\(([^;]*)\)/)?.[1] ?? ''
  if (/\bkey\b/.test(landed)) {
    assert.match(landed, /mask\(/,
      'the panel line is handed a raw credential — it must go through mask(), which is what keeps the '
      + 'proof-of-copy from being the secret itself')
  }

  // And the reveal says it is a one-time thing, because it is: nothing stores it.
  assert.match(SCREEN, /will not be shown again/, 'the degraded reveal does not say it is one-time')
})

test('mask() is LOSSY — the proof-of-copy cannot be read back as the credential', () => {
  // The arm above allows a masked credential into the DOM. That allowance is only safe if the mask
  // actually destroys the value, so this drives it rather than reading it: a long secret must come back
  // shorter than it went in, and must not contain its own tail.
  const m = SCREEN.match(/const mask = \(key: string\): string => \(([^\n]*)\)/)
  assert.ok(m, 'mask() is gone or has changed shape — the allowance above is now unguarded')
  const mask = new Function('key', `return (${m![1]})`) as (k: string) => string
  const secret = 'v1.abcdefghijklmnopqrstuvwxyz0123456789'
  const out = mask(secret)
  assert.ok(out.length < secret.length, `mask() did not shorten the credential: ${out}`)
  assert.ok(!out.includes(secret.slice(6)), `mask() leaked the tail of the credential: ${out}`)
  assert.ok(out.includes('••••'), `mask() does not visibly mask: ${out}`)
})

test('the copy helper reports a REFUSAL, so a blocked clipboard is not read as success', () => {
  // "Clipboard blocked → only then a one-time reveal." That branch is only reachable if the write's
  // failure is a value rather than a swallowed exception — a `catch {}` here would mean the page told a
  // reader it had copied something it had not, and the credential would be nowhere at all.
  const helper = SCREEN.slice(SCREEN.indexOf('async function copy('))
  assert.match(helper, /return true/, 'the copy helper never reports success')
  assert.match(helper, /catch \{ return false \}/, 'a refused clipboard is swallowed rather than reported')
})

// "EVERY ROW COMPOSES A SENTENCE THAT READS" LIVED HERE and is retired with the sentence. It pinned the
// row label and panel heading "Paste it into {name}", and the generic row's own `pasteAs` line under the
// owner's 2026-09-06 ruling (option B). The approved design replaces both slots: a row carries the app's
// name alone, and the panel is headed "Steps for {name}", which reads for every row including "Another
// agent". With no composed sentence left there is nothing for a row to override, so `pasteAs` is gone
// from the table and the wire. What that arm also held — no identity in the screen — is held by
// "THE PAGE DERIVES NOTHING" above and by driver/test/connect-clients-are-data.test.mjs.

// ── WHAT THE PAGE SAYS ABOUT THE CONNECTION ─────────────────────────────────────────────────────────
//
// `aiConnected` is three-valued, and null means the connector's access log could not be read. Every
// sentence the page can say about the connection is decided in `contract/connectYourAi.ts`, so these arms
// hand the decisions the values the wire can carry rather than reading the page for a branch.

test('WITH aiConnected NULL, NO PILL RENDERS AND THE PAGE SAYS NOTHING ABOUT THE CONNECTION', () => {
  // A page that drew "Not connected yet" from null would tell the reader something the product does not
  // know — and so would a line promising the page will say Connected, a fold assuming it, or a way back
  // offered on the strength of it. Undefined is a server too old to send the field, which is the same fact.
  for (const unknown of [null, undefined]) {
    assert.equal(connectionPill(unknown), null, `${unknown}: a pill`)
    assert.equal(watchForConnected(unknown), null, `${unknown}: a line about watching for Connected`)
    assert.equal(foldsSteps(unknown), false, `${unknown}: the steps fold away as though connected`)
    assert.equal(continueOffer({ aiConnected: unknown, fromReport: true, remembered: { runId: 'r', markSlug: null, mark: 'VENQORI' } }), null,
      `${unknown}: a way back offered as though connected`)
  }
  // AND THE PAGE HAS NO OTHER WAY TO SAY IT. The words live in the contract, so the only route to the
  // screen is through the decisions above.
  const c = code(SCREEN)
  assert.doesNotMatch(c, /Not connected yet|'Connected'|>Connected</, 'the page spells a connection state itself')
  assert.match(c, /const pill = connectionPill\(connected\)/)
  assert.match(c, /\{pill \? \(/, 'the pill is drawn whether or not there is one to draw')
  assert.match(c, /const watch = watchForConnected\(connected\)/)
  assert.match(c, /const back = continueOffer\(\{ aiConnected: connected, fromReport, remembered \}\)/)
  assert.match(c, /const connected = access\?\.aiConnected \?\? null/)
})

test('the two states the log CAN answer: the pill, the line under the last step, the fold', () => {
  assert.deepEqual(connectionPill(true), { label: 'Connected', on: true })
  assert.deepEqual(connectionPill(false), { label: 'Not connected yet', on: false })
  // THE LINE UNDER STEP FIVE ONLY WHILE NOT CONNECTED — once connected the pill is already saying it.
  assert.equal(watchForConnected(false), 'This page says **Connected** once your assistant calls Clearotron.')
  assert.equal(watchForConnected(true), null)
  // ONCE CONNECTED THE STEPS FOLD AWAY, and only then.
  assert.equal(foldsSteps(true), true)
  assert.equal(foldsSteps(false), false)
  const c = code(SCREEN)
  assert.match(c, /<summary>\s*<span className="steps-alt-head">Setup steps<\/span>/, 'the connected fold is not titled Setup steps')
  // NEITHER FOLD STARTS OPEN. A fold the page opens on its own is the wall of steps it replaced.
  assert.doesNotMatch(c, /<details[^>]*\bopen\b/, 'a fold is drawn open')
  assert.match(c, /offer\.door === 'sign-in' && offer\.keySteps\?\.length/, 'the key door\'s fold is not drawn beside a sign-in door')
})

test('"CONTINUE WITH …" ONLY FOR A READER WHO CAME FROM A REPORT, IS CONNECTED, AND WHOSE BROWSER REMEMBERS WHICH', () => {
  const remembered = { runId: 'run-1', markSlug: null, mark: 'VENQORI' }
  assert.deepEqual(continueOffer({ aiConnected: true, fromReport: true, remembered }), { label: 'Continue with VENQORI', report: remembered })
  // From the rail there is nothing to go back to; not yet connected, the steps are the point; nothing
  // remembered — storage refused, or a different browser — there is no report to name.
  assert.equal(continueOffer({ aiConnected: true, fromReport: false, remembered }), null, 'offered from the rail')
  assert.equal(continueOffer({ aiConnected: false, fromReport: true, remembered }), null, 'offered before connecting')
  assert.equal(continueOffer({ aiConnected: true, fromReport: true, remembered: null }), null, 'offered with nothing remembered')
  // A report remembered without a mark still has a way back, named plainly.
  assert.equal(continueOffer({ aiConnected: true, fromReport: true, remembered: { ...remembered, mark: null } })?.label, 'Continue with the report')
  // IT GOES BACK TO THAT REPORT WITH ASK AI OPEN — the one signal the report screen reads.
  const c = code(SCREEN)
  assert.match(c, /ctx\.go\(withAskOpen\(resultPath\(back\.report\.runId, back\.report\.markSlug\)\)\)/,
    'Continue does not return to the remembered report with the panel asked open')
  assert.match(SCREEN, /Back to the report you were reading\./)
  // Both facts read once, on arrival: a reload keeps the marker because it lives in the address.
  assert.match(c, /useState\(\(\) => reachedFromReport\(window\.location\.search\)\)/)
  assert.match(c, /useState\(\(\) => rememberedReport\(\)\)/)
})

test('THE HEADLINE LEADS WITH THE BENEFIT, and "Optional" is a quiet tag at its end', () => {
  const prose = SCREEN.replace(/\s+/g, ' ')
  assert.match(prose, /title="Connect your AI"/)
  assert.match(prose, /lede=\{<>Run and interrogate clearances from the assistant you already use\. <span className="lede-opt">Optional<\/span><\/>\}/,
    'the standfirst is not the benefit followed by the Optional tag')
  assert.doesNotMatch(prose, /by voice|by email/, 'the clause about voice and email is back')
  // WHAT YOU CAN DO: four lines, and none of them a claim about an assistant's inner thinking.
  const lines = [...SCREEN.slice(SCREEN.indexOf('const WHAT_YOU_CAN_DO'), SCREEN.indexOf(']', SCREEN.indexOf('const WHAT_YOU_CAN_DO')))
    .matchAll(/'([^']+)'/g)].map((m) => m[1])
  assert.deepEqual(lines, [
    'Start a clearance and triage what comes back',
    'Watch it run, and add context while it is still early',
    'Examine the reasoning and evidence',
    'Ask what-if: why a finding was rated as it was, what changes if the goods narrow',
  ])
  assert.doesNotMatch(readerText(SCREEN), /thinking/i)
})

test('IF IT DOESN\'T CONNECT: the reader gives their AI the setup guide, which opens at its public home', () => {
  const c = code(SCREEN)
  assert.match(SCREEN, /<p>Give your AI the setup guide<\/p>/)
  assert.match(c, /<a className="pill ai-help-guide" href=\{HELP_URL\} target="_blank" rel="noreferrer">Setup guide<\/a>/,
    'the Setup guide button does not open the guide in a new tab')
  assert.match(SCREEN, /<strong>If it doesn&rsquo;t connect<\/strong>/)
})

