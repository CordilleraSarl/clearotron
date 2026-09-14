// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  inFlight, acknowledged, finished, recentlyFinished, recentProjects, ownerSummaries, ownerNote,
  sentence, openingLine, count, slotNote, elapsed, pips, projectNote,
  active, waiting, runProductLabel, cardReason, limitLine, moveBefore, readStamps,
} from '../src/contract/home.ts'
import type { Run } from '../src/contract/api.ts'

const run = (over: Partial<Run>): Run => ({
  runId: over.runId ?? 'r1', account: 'zephyr', title: 'X', markName: 'X',
  projectKey: null, projectName: null,
  product: null, stageLabel: null, kind: 'clearance', state: 'running', date: '2026-07-27', issuedAt: null,
  band: null, tone: null, bands: [], marks: [], reportSchema: null, held: false, report: null,
  step: null, stepN: null, stepTotal: null, reason: null, failedStage: null,
  pausedKind: null, resetsAt: null, startedAt: null, queuePos: null, acked: false, ...over,
})

test('the in-flight band keeps failures and puts them first', () => {
  // A run that stopped is the one thing on this page that needs a decision. Sorting it below live work,
  // or filtering it out with the delivered rows, is how a failure becomes a silence.
  const rows = inFlight([
    run({ runId: 'a', state: 'queued' }),
    run({ runId: 'b', state: 'delivered' }),
    run({ runId: 'c', state: 'failed' }),
    run({ runId: 'd', state: 'running' }),
    run({ runId: 'e', state: 'paused' }),
  ])
  assert.deepEqual(rows.map((r) => r.runId), ['c', 'd', 'e', 'a'])
  assert.ok(!rows.some((r) => r.state === 'delivered'), 'delivered is not in flight')
})

test('an acknowledged run leaves the band, and `acknowledged` is the exact complement', () => {
  // The band filled with dead runs and stopped showing live work, which is the one thing it is for. The
  // two functions must partition the not-delivered rows between them: anything that vanishes from one
  // has to appear in the other, or "acknowledged" is just "forgotten" with a nicer word on it.
  const rows = [
    run({ runId: 'a', state: 'failed', acked: true }),
    run({ runId: 'b', state: 'failed' }),
    run({ runId: 'c', state: 'running' }),
    run({ runId: 'd', state: 'cancelled', acked: true }),
    run({ runId: 'e', state: 'delivered', acked: true }),
  ]
  assert.deepEqual(inFlight(rows).map((r) => r.runId), ['b', 'c'], 'the band keeps the live work and the unseen failure')
  assert.deepEqual(acknowledged(rows).map((r) => r.runId), ['a', 'd'], 'and the count holds exactly what left it')
  const band = new Set(inFlight(rows).map((r) => r.runId))
  const put = new Set(acknowledged(rows).map((r) => r.runId))
  const notDelivered = rows.filter((r) => r.state !== 'delivered').map((r) => r.runId)
  assert.equal(band.size + put.size, notDelivered.length, 'every not-delivered run is in exactly one of them')
  assert.ok(notDelivered.every((id) => band.has(id) !== put.has(id)), 'and never in both')
  // A DELIVERED run is not "acknowledged" — it never reached the band, so it has nothing to leave.
  assert.ok(!acknowledged(rows).some((r) => r.state === 'delivered'))
})

test('a cancelled run reaches a CARD, which is where the acknowledge lives', () => {
  // THE CONTROL THAT CANNOT BE REACHED. The issue names two states, `failed` and `cancelled`, and the
  // card renders the button for both — but the button is only on rows `active()` returns, and `RANK`
  // above lists four states without `cancelled`. If `active()` were an allowlist rather than "not
  // queued", half the feature would be unreachable and every other test here would still pass. That is
  // exactly: a complete capability with no way in.
  const rows = inFlight([run({ runId: 'a', state: 'cancelled' }), run({ runId: 'b', state: 'queued' })])
  assert.deepEqual(active(rows).map((r) => r.runId), ['a'], 'a cancelled run is a card, not a queue row')
  assert.deepEqual(waiting(rows).map((r) => r.runId), ['b'])
})

test('finished is every delivered run, newest first — the count Home reports', () => {
  const rows = finished([
    run({ runId: 'a', state: 'delivered', date: '2026-07-20' }),
    run({ runId: 'b', state: 'delivered', date: '2026-07-25' }),
    run({ runId: 'c', state: 'delivered', date: '2026-07-22' }),
    run({ runId: 'd', state: 'delivered', date: '2026-07-01' }),
    run({ runId: 'e', state: 'running' }),
  ])
  assert.deepEqual(rows.map((r) => r.runId), ['b', 'c', 'a', 'd'])
})

test('THE FINISHED TAIL IS ROWS, so Home and Clearances cannot disagree about what happened', () => {
  // Three reads of ONE name is one row on Clearances — the name, at its latest read. Home slicing runs
  // would have shown the same name three times and called it three clearances. Both screens now go
  // through grouping.ts, so agreement is structural rather than something to remember.
  const rows = recentlyFinished([
    run({ runId: 'x1', markName: 'AQUAPLUS', state: 'delivered', date: '2026-07-20' }),
    run({ runId: 'x2', markName: 'AQUAPLUS', state: 'delivered', date: '2026-07-25' }),
    run({ runId: 'x3', markName: 'AQUAPLUS', state: 'delivered', date: '2026-07-22' }),
    run({ runId: 'y1', markName: 'ARBORA', state: 'delivered', date: '2026-07-24' }),
  ])
  assert.deepEqual(rows.map((r) => r.name), ['AQUAPLUS', 'ARBORA'], 'one row per NAME, newest first')
  assert.equal(rows[0]!.kind === 'mark' ? rows[0]!.current.runId : null, 'x2', 'the row speaks for its LATEST read')
})

test('a family on Clearances is a family on Home', () => {
  // A family is a commercial judgment somebody asserted by hand — it is not derivable, so the screen
  // that ignores it is simply the wrong one.
  const families = { of: { a1: 'fam1', b1: 'fam1' }, names: { fam1: 'Hydra line' } }
  const rows = recentlyFinished(
    [
      run({ runId: 'a1', markName: 'AQUAPLUS', state: 'delivered', date: '2026-07-25' }),
      run({ runId: 'b1', markName: 'AQUAMAX', state: 'delivered', date: '2026-07-24' }),
    ],
    families,
  )
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.name, 'Hydra line')
  assert.equal(rows[0]!.kind, 'family')
})

test('the tail shows what LANDED, never what is still running', () => {
  const rows = recentlyFinished([
    run({ runId: 'live', markName: 'AXIS', state: 'running', date: '2026-07-27' }),
    run({ runId: 'done', markName: 'AXIS', state: 'delivered', date: '2026-07-20' }),
  ])
  // One row, at its DELIVERED read — the in-flight one is reported by the block above, and reporting it
  // twice is the duplication this rebuild removed.
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.kind === 'mark' ? rows[0]!.current.runId : null, 'done')
})

test('RECENT MEANS LAST RUN AGAINST, and a project nothing ran under is absent', () => {
  // Not last EDITED. A project's file timestamp moves when someone tweaks its overlay, which is
  // housekeeping — the question is "what was I working on", and the evidence for that is a clearance.
  const rows = recentProjects([
    run({ runId: '1', projectKey: 'spring', projectName: 'Spring launch', state: 'delivered', date: '2026-07-10' }),
    run({ runId: '2', projectKey: 'spring', projectName: 'Spring launch', state: 'delivered', date: '2026-07-25' }),
    run({ runId: '3', projectKey: 'eu', projectName: 'EU expansion', state: 'delivered', date: '2026-07-22' }),
    run({ runId: '4', projectKey: null, state: 'delivered', date: '2026-07-27' }),
  ])
  assert.deepEqual(rows.map((p) => p.key), ['spring', 'eu'], 'newest use first; no project ⇒ no row')
  assert.equal(rows[0]!.runs, 2, 'reads under it, which is what a person recognises from the invoice')
  assert.equal(rows[0]!.date, '2026-07-25')
})

test('two companies can hold the same project key without merging', () => {
  const rows = recentProjects([
    run({ runId: '1', account: 'zephyr', projectKey: 'launch', projectName: 'Launch', date: '2026-07-25', state: 'delivered' }),
    run({ runId: '2', account: 'aurora', projectKey: 'launch', projectName: 'Launch', date: '2026-07-24', state: 'delivered' }),
  ])
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map((p) => p.account), ['zephyr', 'aurora'])
})

test('a project whose only run is QUEUED still has a name to show', () => {
  // The job carries the key; the engine resolves the name at start. Taking the first value found rather
  // than the first non-empty one rendered a blank row for a project that had just been started.
  const [only] = recentProjects([run({ projectKey: 'spring', projectName: null, state: 'queued', date: '2026-07-27' })])
  assert.equal(only!.name, 'spring', 'falls back to the key, never to a blank')
  assert.equal(only!.live, true)
  assert.equal(projectNote(only!), 'One clearance · one still going')
})

test('row notes are capitalised — they are cells, not clauses', () => {
  // "one clearance" sitting beside "One in flight" in the next block reads as a rendering fault.
  const [p] = recentProjects([
    run({ runId: '1', projectKey: 'eu', projectName: 'EU expansion', state: 'delivered', date: '2026-07-22' }),
    run({ runId: '2', projectKey: 'eu', projectName: 'EU expansion', state: 'delivered', date: '2026-07-20' }),
  ])
  assert.equal(projectNote(p!), 'Two clearances')
})

test('COMPANIES COME FROM THE ROSTER, not from the runs', () => {
  // An owner set up and never used has no run to be derived from — and is exactly the one somebody is
  // most likely to be hunting for. Deriving the list from activity would hide it.
  const names: Record<string, string> = { zephyr: 'Zephyr Beverages', aurora: 'Aurora Interactive', quiet: 'Quiet Co' }
  const rows = ownerSummaries(
    ['zephyr', 'aurora', 'quiet'],
    [
      run({ runId: '1', account: 'zephyr', state: 'delivered', date: '2026-07-20' }),
      run({ runId: '2', account: 'aurora', state: 'running', date: '2026-07-27' }),
    ],
    (k) => names[k] ?? k,
  )
  assert.deepEqual(rows.map((o) => o.key), ['aurora', 'zephyr', 'quiet'], 'live first, then most recent, then name')
  assert.equal(rows[2]!.finished, 0)
  assert.equal(ownerNote(rows[2]!), 'Nothing yet', 'never "0 clearances" — a zero beside a client reads as a fault')
  assert.equal(ownerNote(rows[0]!), 'One in flight')
  assert.equal(ownerNote(rows[1]!), 'one clearance')
})

test('THE SENTENCE CANNOT CONTRADICT THE CARDS — it is computed from the same rows', () => {
  // The largest text on the page and the first thing read. Written by hand it would drift from the cards
  // the first time a state was added; derived, it cannot.
  assert.equal(sentence(inFlight([])), 'Nothing running.')
  assert.equal(sentence(inFlight([run({ state: 'running' })])), 'One running.')
  assert.equal(
    sentence(inFlight([
      run({ runId: '1', state: 'running' }),
      run({ runId: '2', state: 'paused' }),
      run({ runId: '3', state: 'queued' }),
      run({ runId: '4', state: 'queued' }),
    ])),
    'One running, one paused, two waiting.',
  )
})

test('a failure leads the sentence, and keeps the rest of the picture beside it', () => {
  assert.equal(
    sentence(inFlight([run({ runId: '1', state: 'failed' }), run({ runId: '2', state: 'running' })])),
    'One search stopped · one running.',
  )
  assert.equal(sentence(inFlight([run({ state: 'failed' })])), 'One search stopped.')
})

test('the staff sentence NEVER says "no in flight"', () => {
  // What the staff view opened to: "32 stopped · no in flight, five companies." — a sentence that leads with a
  // number nobody can act on and then says nothing is happening. `count(0)` is the word "no", so the
  // multi-owner branch composed it happily. (The 32 were dead letters and are gone at the source; this
  // pins the sentence so the construction cannot come back with any data.)
  const stopped = inFlight([
    run({ runId: '1', account: 'zephyr', state: 'failed' }),
    run({ runId: '2', account: 'aurora', state: 'failed' }),
  ])
  const line = sentence(stopped, { owners: 5 })
  assert.doesNotMatch(line, /no in flight/)
  assert.equal(line, 'Two stopped, nothing running.')
})

test('the staff view counts companies, not names', () => {
  const rows = inFlight([
    run({ runId: '1', account: 'zephyr', state: 'running' }),
    run({ runId: '2', account: 'aurora', state: 'running' }),
    run({ runId: '3', account: 'aurora', state: 'queued' }),
  ])
  assert.equal(sentence(rows, { owners: 3 }), 'Three in flight, three companies.')
})

test('a brand-new account and a quiet one say different things', () => {
  // "Nothing has run yet" is an invitation; "Nothing running" is reassurance. Collapsing them would
  // greet a new client with a status report about work they have never commissioned.
  assert.equal(openingLine(inFlight([]), false), 'Nothing has run yet.')
  assert.equal(openingLine(inFlight([]), true), 'Nothing running.')
})

test('AND "WE HAVE NOT BEEN TOLD" IS A THIRD THING, not the empty one', () => {
  // A client holding several companies cannot ask for all of them — the server answers 404 to anyone
  // but staff — so until they pick, there are no runs and both sentences above are lies. A firm with a
  // decade of history opened the page and read "Nothing has run yet."
  assert.equal(openingLine(inFlight([]), false, false), 'Pick a company to see its work.')
  assert.equal(openingLine(inFlight([]), true, true), 'Nothing running.', 'and a known-quiet account still reads as quiet')
})

test('counts spell out to seven, then go numeric', () => {
  assert.equal(count(0), 'no')
  assert.equal(count(1), 'one')
  assert.equal(count(7), 'seven')
  assert.equal(count(8), '8')
})

test('THE SLOT NOTE SAYS "ACROSS ALL COMPANIES" — the design said per-owner and that is false', () => {
  // CLEAROTRON_MAX_CONCURRENT_RUNS is one global cap over one lock directory, with the per-agent tag
  // deliberately omitted: two owners each running one search fill the whole deployment. Said per-owner
  // it over-promises throughput, which is the wrong direction for a line a lawyer repeats to a client.
  assert.match(slotNote(1, 2)!, /across all companies/)
  assert.doesNotMatch(slotNote(1, 2)!, /per company/)
  assert.equal(slotNote(1, 2), '1 of 2 running · two runs at once, across all companies')
  assert.equal(slotNote(null, null), null, 'no cap known ⇒ no claim made')
})

test('PIPS COME FROM THE RUN, never from a constant', () => {
  // Nine is right for a preliminary and a deep dive. A knockout has five, or six with the register
  // probe — and the engine's own comment warns a hardcoded count "would silently mislabel every screen
  // the client watches".
  assert.deepEqual(pips(2, 9), { total: 9, filled: 2 })
  assert.deepEqual(pips(4, 5), { total: 5, filled: 4 })
  assert.deepEqual(pips(1, 6), { total: 6, filled: 1 })
  assert.equal(pips(null, null), null, 'a queued run has no steps and gets no empty row of pips')
  assert.deepEqual(pips(99, 9), { total: 9, filled: 9 }, 'never overflows its own ladder')
  assert.deepEqual(pips(null, 9), { total: 9, filled: 0 })
})

test('elapsed is coarse, and never a countdown', () => {
  const t0 = Date.parse('2026-07-27T10:00:00Z')
  assert.equal(elapsed(new Date(t0).toISOString(), t0 + 30_000), 'just started')
  assert.equal(elapsed(new Date(t0).toISOString(), t0 + 12 * 60_000), '12 min so far')
  assert.equal(elapsed(new Date(t0).toISOString(), t0 + 95 * 60_000), '1h 35m so far')
  assert.equal(elapsed(null), null)
  assert.equal(elapsed('not a date'), null, 'an unparseable stamp says nothing rather than "NaN"')
})

/**
 * The screen's PROSE, with commentary stripped.
 *
 * The same technique screenCopy.test.ts uses, and for the same reason: these assertions are about what
 * reaches a client's eyes, and a comment explaining why the screen refuses to show an ETA would
 * otherwise fail a test that forbids the word "ETA".
 *
 * A JSX COMMENT IS COMMENTARY TOO, and the line filter alone did not reach one: `{/*` is not `/*`, and
 * the lines under it open with ordinary words. So a note explaining why a button exists counted as a
 * second button, and the arm that counts the routes into the archive passed on its own prose after the
 * second route was removed. The span goes first, then the line filter.
 */
const body = (src: string) =>
  src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n')

const home = body(readFileSync(new URL('../src/screens/Home.tsx', import.meta.url), 'utf8'))
// Read for the one-spelling arm below: the rail is where the label is DECIDED, and the screen is where
// a reader lands. Both are read rather than quoted, so a rename is checked instead of duplicated.
const NAV_CONFIG = readFileSync(new URL('../src/nav/nav.config.ts', import.meta.url), 'utf8')
const CLEARANCES = readFileSync(new URL('../src/screens/Clearances.tsx', import.meta.url), 'utf8')

test('Home promises no ETA, no percentage and no price', () => {
  // The three things the data cannot support. Each would look like precision and be invented.
  assert.doesNotMatch(home, /\bETA\b|remaining|% complete|percent/i)
  // A FIGURE, not a bare sigil: `${...}` in a template literal is not a price, and a check that cannot
  // tell those apart gets disabled the first time it cries wolf.
  assert.doesNotMatch(home, /[$€£]\s?\d|\bUSD\b|\bEUR\b|\bCHF\b|\bGBP\b/,
    'cost lives elsewhere in this product and is never a figure')
})

test('Home renders no internal stage numbers to a client', () => {
  // "Stage 1"/"Stage 2" already mean the two halves of the legal reasoning in every report we send, so
  // the pricing axis must not surface here under the same words.
  assert.doesNotMatch(home, /Stage \d/)
})

test('every mark and company on Home is blurrable', () => {
  // The screen-share blur only covers what is tagged. An untagged name is a client name on a projector.
  const marks = home.match(/data-anon="mark"/g) ?? []
  assert.ok(marks.length >= 4, `expected the card mark, the card owner, and both finished-row names — got ${marks.length}`)
  for (const cls of ['home2-card-mark', 'home2-card-owner', 'home2-qmark', 'home2-qowner', 'home2-done-mark']) {
    assert.match(home, new RegExp(`className="${cls}" data-anon="mark"`), `${cls} must be blurrable`)
  }
})

test('Home uses tokens, never a literal colour', () => {
  // The five tone hexes are the LIGHT values, and tokens.css redefines every one of them for dark.
  // Pasted into the screen, the dark theme would render light-mode bands on a dark surface.
  assert.doesNotMatch(home, /#[0-9A-Fa-f]{6}/, 'no hex in the screen')
  assert.match(home, /toneColor\(/, 'tones resolve through the token helper that already flips')
})

test('HOME DOES NOT RE-LIST THE ARCHIVE — it links to the screen that owns it', () => {
  // The first cut of this page WAS a finished-runs list, which is what Clearances is for and does
  // properly, with families and threads. Two screens showing the same work in two shapes is a second
  // answer, not a summary. The tail is short, capped in the contract, and ends in a way out.
  assert.match(home, /recentlyFinished\(/, 'the tail comes from the grouping contract, not from a slice of runs')
  assert.match(home, /All Clearances/)
  assert.doesNotMatch(home, /\.filter\(\(r\) => r\.state === 'delivered'\)/,
    'Home does not re-derive "finished" — that lives in one tested place')
})

test('"NOT REPLIED YET" IS NOT "IT FAILED" — the answer is keyed on what arrived', () => {
  // `result` is null until the first response lands, so a page that reads `kind !== 'ok'` as a fault
  // shows an error on EVERY load; one that reads it as "empty" shows a permanent empty state on a 429
  // and says nothing about why. There is no "pick an owner" answer any more — Home asks for every brand
  // owner the identity holds in one call, so there is nothing left to pick.
  assert.match(home, /!result \? 'loading'/)
  assert.match(home, /result\.kind === 'ok' \? 'ok' : 'error'/)
  assert.match(home, /Too many requests just now/, 'a fault is stated, in the words Clearances uses')
  assert.doesNotMatch(home, /Pick a company/, 'nothing to pick: the request spans every owner held')
})

test('HOME IS ACCOUNT-SCOPED — the company switcher cannot empty it', () => {
  // The previous Home lost every in-flight run the moment an owner was selected, with no way back. The
  // fix is structural rather than careful: one request for everything this identity holds, and no
  // reference to the switcher at all.
  assert.match(home, /api\.runsMine\(\)/)
  assert.doesNotMatch(home, /api\.runs\(/, 'never the owner-scoped or wildcard call')
  assert.doesNotMatch(home, /ctx\.owner \? '\*'/, 'and never the staff wildcard')
})

test('the finished line leads into Clearances, and Home lists nothing else', () => {
  // "Home shows what is happening; the menu gives you the depth" — a summary with no way out is only
  // the first half, and a second, worse archive on the landing screen teaches people not to go to the
  // real one.
  assert.match(home, /All Clearances/)
  assert.match(home, /\/portal\/clearances/)
})

test('ONE BUTTON INTO THE ARCHIVE, ONE SPELLING — the rail, Home and the screen agree', () => {
  // One destination had three presentations: a rail item, a button wearing the rail item's class (grey,
  // flat, and read as scenery), and red text with a different icon and a different capitalisation. A
  // reader who meets three of them does not know they are one place, and the quiet one goes unpressed.
  // Then there were two identical buttons, one at the top and one at the bottom, competing for the same
  // press — so the tail's route is a quiet line now and the button is the one at the top.
  //
  // THE LABEL IS TAKEN FROM THE RAIL, never typed here as a fourth copy — that is the failure this arm
  // is about, one layer up. If the rail is renamed again, every surface below it is checked against the
  // new word rather than against a literal that stopped matching.
  const rail = /label: '([^']+)', path: '\/portal\/clearances'/.exec(NAV_CONFIG)
  assert.ok(rail, 'the rail no longer names the clearances screen — this arm is reading nothing')
  const label = rail[1]
  assert.equal(label, 'All Clearances', 'the rail item is the one spelling everything else follows')

  // ONE button, and it says the rail's word. Counted on the prose rather than the file, because the
  // note explaining why the button is there says the label too, and counting that is how this arm read
  // as green on the day the second button went away.
  assert.equal((home.match(new RegExp(label, 'g')) ?? []).length, 1, 'Home names the archive more than once')
  assert.equal((home.match(/className="btn-ghost home2-all"/g) ?? []).length, 1,
    'the archive button has a twin again — one primary and one secondary per page, not two of one')
  // AND IT IS ON THE HEADER ROW, beside New clearance, not inside the in-flight band. The band is a
  // status line: it goes quiet when nothing is running, which is the moment a reader most wants the
  // button, and a control inside it reads as part of the status rather than as something to press.
  const actions = /actions=\{<>([\s\S]*?)<\/>\}/.exec(home)
  assert.ok(actions, 'Home\'s header carries no actions — the buttons have moved somewhere else again')
  assert.match(actions[1], /home2-all/, 'the archive button is not on the header row')
  assert.match(actions[1], /NewClearanceButton/, 'New clearance is not on the header row beside it')
  // TO THE NEXT TOP-LEVEL DECLARATION, not to the next `\n}`. The first cut ended at `}: {` — the brace
  // closing the parameter list — so the slice was four lines of destructuring and "no button in here"
  // was true of text that could never hold one. A plant putting a button back in the band did not red.
  // Hence the floor: the slice has to be big enough, and has to contain the band's own markup, before
  // any absence is claimed about it.
  const band = /\nfunction InFlightBand\([\s\S]*?\n(?=(?:function |export )|$)/.exec(home)
  assert.ok(band, 'the in-flight band moved — this arm is reading nothing')
  assert.match(band[0], /className="home2-band"/, 'the slice does not reach the band it is named for')
  assert.doesNotMatch(band[0], /<button/, 'a button is back inside the in-flight band')
  assert.doesNotMatch(home, /className="nav-item" onClick={onAll}/, 'a Home button is wearing the rail item\'s clothes again')

  // AND THE TAIL STILL ENDS IN A WAY OUT, as a line rather than a second button: a summary with no
  // route to the whole is the first half of the design only.
  assert.match(home, /className="home2-see-all"/, 'the tail has no way into the archive at all')
  assert.equal((home.match(/\/portal\/clearances'\)/g) ?? []).length, 2, 'the two routes do not both land on the archive')

  // And the screen it leads to says the same word, so a reader who follows it lands somewhere named
  // what they pressed.
  assert.ok(CLEARANCES.includes(`title="${label}"`), 'the screen does not name itself as the rail does')
})

test('THE TAIL IS RECENT WORK AND THEN THE COUNT — not an archive with one row', () => {
  // WITH NOTHING IN FLIGHT this page was a band saying zero and one finished clearance under a heading
  // reading "Last finished", which is All Clearances with everything taken away. The screen now says
  // which page it is, the empty band says what to do, and the tail is a few rows ending in how many
  // there are in total.
  assert.match(home, /recentlyFinished\(runs, undefined, 3\)/, 'the tail is back to a single row, or uncapped')
  assert.match(home, /See all \{total\} finished/, 'the count of everything finished is not offered')
  assert.match(home, /finished\(runs\)\.length/, 'the total is derived somewhere other than the contract')
  assert.match(home, /Recently finished/)
  assert.doesNotMatch(home, /Last finished/, 'the old single-row heading is still on the page')

  // THE HEADING, which is the half a reader uses to tell this page from the archive — ONE line of it.
  // It shipped as an eyebrow reading "Home" over a heading reading "Now": two lines saying one thing,
  // and "Now" saying nothing a reader could act on. The owner's own word is Home, once, through the
  // component every screen's header goes through.
  assert.match(home, /<PageHeader\s+title="Home"/, 'the page does not name itself')
  assert.doesNotMatch(home, /\bNow<\/h1>|>Now</, 'the withdrawn heading is back')
  assert.doesNotMatch(home, /className="eyebrow">Home</, 'the page carries a second header line again')
  assert.doesNotMatch(home, /<h1\b/, 'the screen writes its own heading instead of going through the one component')

  // AND THE EMPTY BAND SAYS WHAT TO DO — but only to somebody who may do it. `slotNote` describes a cap
  // on concurrent runs, which is a sentence about nothing when nothing is running.
  assert.match(home, /Nothing running right now\./)
  assert.match(home, /canRun\(ctx\.me\) \? ' Start one with New clearance\.' : ''/,
    'a person who may not start a clearance is told to start one')
})

test('THERE IS NO ROLE SPLIT ON THIS PAGE', () => {
  // There is no staff-specific page. Staff and clients differ in how many companies they hold, and
  // quantity is a rendering decision — never a layout, and never a branch on role.
  assert.doesNotMatch(home, /role === 'staff'/)
  assert.doesNotMatch(home, /allAccounts/)
})

test('THE QUEUE NOW CLAIMS A POSITION, BECAUSE THERE IS ONE — this assertion is inverted on purpose', () => {
  // WHAT THIS TEST USED TO SAY: "a queued card claims no position", because "there is no order to
  // renumber: the claim loop is an unsorted scan across three queue directories drained concurrently
  // against one pair of slots, and resumed runs are admitted ahead of fresh ones every pass."
  //
  // That was true, and it is not any more. The runner now sorts its scan by a shared order file and
  // claims only what it has free slots for, so the ordinal on screen is the order work actually starts
  // in — proven by a driver test that asserts COMPLETION order, not scan order.
  //
  // The old assertion is kept in words rather than deleted, so the next person to read this knows the
  // ordinal was earned by an engine change and is not decoration that crept back in.
  assert.match(home, /waiting for a slot/i)
  assert.match(home, /home2-pos/, 'the ordinal is rendered')
  assert.match(home, /waiting\(/, 'and the order is seeded from the server, via the tested derivation')
  assert.match(home, /Drag to reorder/)
})


// ── the four regions of the rebuilt Home ─────────────────────────────────────────────────────────

test('cards and the queue are split, and the queue is in the order the runner will admit', () => {
  // Before the admission change this split could not be made honestly: a job waiting for a slot was
  // claimed out of the queue instantly and had no run dir yet, so it appeared in NEITHER list.
  const rows = inFlight([
    run({ runId: 'q2', state: 'queued', queuePos: 2 }),
    run({ runId: 'live', state: 'running' }),
    run({ runId: 'q1', state: 'queued', queuePos: 1 }),
  ])
  assert.deepEqual(active(rows).map((r) => r.runId), ['live'])
  assert.deepEqual(waiting(rows).map((r) => r.runId), ['q1', 'q2'], 'server order, not arrival order')
})

test('a queued run with no position sorts last rather than jumping the line', () => {
  // A run from a server that predates queuePos must not be rendered as "1st".
  const rows = inFlight([
    run({ runId: 'unknown', state: 'queued', queuePos: null }),
    run({ runId: 'known', state: 'queued', queuePos: 3 }),
  ])
  assert.deepEqual(waiting(rows).map((r) => r.runId), ['known', 'unknown'])
})

test('a run card renders the wire\'s product name verbatim — the browser maps nothing', () => {
  // THIS TEST USED TO ITERATE PRODUCT KEYS through a browser-side switch, and that switch is deleted
  //: a second mapping table for a name the server already resolves for the delivered report. The
  // guarantee it carried — "every orderable product names itself, and no stage or depth number reaches a
  // card" — did not disappear with it. It MOVED to the server, and is pinned there by
  // driver/test/portal-run-rows.test.mjs. What is left to check here is that the browser adds nothing.
  //
  // A passthrough test is worth writing precisely because it is the thing that can regress silently: the
  // moment this file starts deciding a label again, the drift is back.
  assert.equal(runProductLabel('Full country search'), 'Full country search')
  assert.equal(runProductLabel('Preliminary clearance'), 'Preliminary clearance', 'a retired run keeps the name it was sold under')

  // Null in, null out — a level the registry has forgotten shows nothing rather than guessing.
  assert.equal(runProductLabel(null), null)
  assert.equal(runProductLabel(null, 8), null, 'a mark count never conjures a label out of no name')
  assert.equal(runProductLabel(''), null)

  // The count rides only where more than one name is possible.
  assert.equal(runProductLabel('Knockout search', 8), 'Knockout search · 8 names')
  assert.equal(runProductLabel('Knockout search', 1), 'Knockout search', 'one name is not "1 names"')
  assert.equal(runProductLabel('Knockout search', 0), 'Knockout search')
  assert.equal(runProductLabel('Global preliminary search', 1), 'Global preliminary search')
})

test('a rate-limit pause states its clock; a recovery pause states none', () => {
  // The provider's own reset time is the ONE ETA this system possesses. A recovery pause backs off on a
  // schedule rather than to a stated time, so promising a clock there would be inventing one.
  const capped = cardReason(run({ state: 'paused', pausedKind: 'rate-limit', resetsAt: '2026-07-28T14:20:00Z' }))
  assert.match(capped!, /14:20 UTC/)
  const recovering = cardReason(run({ state: 'paused', pausedKind: 'recovering' }))
  assert.doesNotMatch(recovering!, /\d\d:\d\d/, 'no clock where there is none')
})

test('an operator pause (system restart) says so, states no clock, and asks nothing of the reader', () => {
  // The engine's parked-for-human reaches the browser as paused + pausedKind operator (the server maps
  // it; the raw value never rides the wire). It resumes on the next runner pass — copy must say that.
  const parked = cardReason(run({ state: 'paused', pausedKind: 'operator' }))
  assert.match(parked!, /restart/i)
  assert.match(parked!, /resumes on its own/)
  assert.doesNotMatch(parked!, /\d\d:\d\d/, 'no clock where there is none')
})

test('a null daily limit means WE COULD NOT READ IT — never "unlimited", never zero', () => {
  // Told as either, the account that is genuinely uncapped and the one whose usage file is unreadable
  // become indistinguishable — and one of those two should stop someone before they spend.
  assert.match(limitLine(1, null), /unavailable|1 run today/)
  assert.doesNotMatch(limitLine(1, null), /unlimited|no daily cap/i)
  assert.match(limitLine(0, 0), /No daily cap/)
  assert.match(limitLine(1, 2), /1 of 2 runs used today/)
  assert.match(limitLine(1, 2), /resets midnight UTC/)
})

test('dragging a row onto another puts it exactly there, and a no-op drag changes nothing', () => {
  assert.deepEqual(moveBefore(['a', 'b', 'c'], 'c', 'a'), ['c', 'a', 'b'])
  assert.deepEqual(moveBefore(['a', 'b', 'c'], 'a', 'c'), ['b', 'c', 'a'])
  // A drag that ends where it started is an ordinary thing for a person to do.
  assert.deepEqual(moveBefore(['a', 'b', 'c'], 'b', 'b'), ['a', 'b', 'c'])
  // And an id that is not in the list is ignored rather than throwing on the landing screen.
  assert.deepEqual(moveBefore(['a', 'b'], 'zz', 'a'), ['a', 'b'])
})

test('the slot note counts in English — "Two runs", never "Two run"', () => {
  // A string test cannot see a rendered line; this one was drawn in a browser before anybody noticed.
  assert.match(slotNote(null, 2)!, /Two runs at once/)
  assert.match(slotNote(null, 1)!, /One run at once/)
  assert.doesNotMatch(slotNote(null, 2)!, /Two run /)
  // …and it is still stated across all companies, never per-owner: the cap is ONE global lock.
  assert.match(slotNote(null, 2)!, /across all companies/)
})


// ── — ORDER IS BY `issuedAt`, AND THE ARMS BELOW ARE SAME-DAY ON PURPOSE ────────────────────────
//
// Every ordering arm above this line uses runs from DIFFERENT DAYS. All of them passed before the fix
// and all of them pass after it, because a day-granularity sort separates different days perfectly well.
// The defect only exists between two runs that share a day, so an arm that never builds that pair
// cannot see it — which is how it shipped, and why these are written the way they are.

test('two reads of one name on the SAME DAY: the newer leads', () => {
  // THIS ARM DOES NOT DISCRIMINATE ON THE FIX, and it is kept anyway. Planted: reverting
  // `recentlyFinished` to the day comparator leaves it GREEN, because a mark's reads are already sorted
  // by `newestFirst` inside grouping.ts and `current` was therefore always the right read. The defect
  // was one level up, between ROWS, which is what the next two arms cover.
  //
  // It stays because it pins the behaviour the card depends on: if the read-level ordering ever
  // regressed, the row-level fix would report the wrong run while every row-level arm stayed green.
  // Recorded explicitly so nobody later reads this arm as the evidence for this change.
  const rows = recentlyFinished([
    run({ runId: 'older', markName: 'VELTHORNE', state: 'delivered', date: '2026-08-26', issuedAt: '2026-08-26T11:00:13.014Z' }),
    run({ runId: 'newer', markName: 'VELTHORNE', state: 'delivered', date: '2026-08-26', issuedAt: '2026-08-26T11:38:11.372Z' }),
  ])
  assert.equal(rows.length, 1, 'one row per name')
  assert.equal(rows[0]!.kind === 'mark' ? rows[0]!.current.runId : null, 'newer',
    'the row must speak for the 11:38 read, not the 11:00 one')
})

test('two NAMES delivered the same day sort newest-first, not arbitrarily', () => {
  // The card itself: limit 1, so the wrong order here is the whole defect the owner saw.
  const rows = recentlyFinished([
    run({ runId: 'a', markName: 'AQUAPLUS', state: 'delivered', date: '2026-08-26', issuedAt: '2026-08-26T09:15:00.000Z' }),
    run({ runId: 'b', markName: 'BORAMEL', state: 'delivered', date: '2026-08-26', issuedAt: '2026-08-26T17:42:00.000Z' }),
  ])
  assert.deepEqual(rows.map((r) => r.name), ['BORAMEL', 'AQUAPLUS'])
  // Fed in the other order too: a stable sort over a tie returns INPUT order, so one direction of this
  // pair passes against the broken comparator by luck. Both directions is the control.
  const flipped = recentlyFinished([
    run({ runId: 'b', markName: 'BORAMEL', state: 'delivered', date: '2026-08-26', issuedAt: '2026-08-26T17:42:00.000Z' }),
    run({ runId: 'a', markName: 'AQUAPLUS', state: 'delivered', date: '2026-08-26', issuedAt: '2026-08-26T09:15:00.000Z' }),
  ])
  assert.deepEqual(flipped.map((r) => r.name), ['BORAMEL', 'AQUAPLUS'], 'same answer whichever order they arrive in')
})

test('a FAMILY carries the precise time of its newest mark', () => {
  // FamilyGroup had `date` and no `issuedAt`, so two families last worked on the same day tied even
  // after the mark-level fix. The family's stamp is the max over its marks, computed beside `date`
  // rather than derived from it.
  const families = { of: { m1: 'fam1', m2: 'fam1' }, names: { fam1: 'Hydra line' } }
  const rows = recentlyFinished(
    [
      run({ runId: 'm1', markName: 'AQUAPLUS', state: 'delivered', date: '2026-08-26', issuedAt: '2026-08-26T08:00:00.000Z' }),
      run({ runId: 'm2', markName: 'AQUAMAX', state: 'delivered', date: '2026-08-26', issuedAt: '2026-08-26T19:30:00.000Z' }),
    ],
    families,
  )
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.issuedAt, '2026-08-26T19:30:00.000Z', 'the family reports its LATEST mark to the second')
})

test('a run with no issuedAt sorts LAST, never first', () => {
  // The fallback direction. An unknown time treated as newest would put every pre-change run at the top of
  // the card permanently — a worse failure than the one being fixed, and the one a naive `??` produces.
  const rows = recentlyFinished([
    run({ runId: 'ancient', markName: 'OLDMARK', state: 'delivered', date: '2026-08-26', issuedAt: null }),
    run({ runId: 'known', markName: 'NEWMARK', state: 'delivered', date: '2026-08-26', issuedAt: '2026-08-26T10:00:00.000Z' }),
  ])
  assert.deepEqual(rows.map((r) => r.name), ['NEWMARK', 'OLDMARK'])
})

test('the Clearances date column orders by the same comparator, both directions', () => {
  // The second screen. Its comparator is inline in the screen and has no DOM harness, so what is asserted
  // here is that the screen imports and uses `newestFirst` rather than a second copy of the expression —
  // which is the property that keeps the two screens agreeing. The comparator's own behaviour is proven
  // by the arms above and by reads.test.ts.
  const src = readFileSync(new URL('../src/screens/Clearances.tsx', import.meta.url), 'utf8')
  assert.match(src, /newestFirst/, 'Clearances must sort through the shared comparator')
  assert.doesNotMatch(src, /String\(a\.date \?\? ''\)\.localeCompare/,
    'the day-granularity comparator must be gone, not merely joined by a better one')
})

// ── — THE QUESTION AT THE PRESS ─────────────────────────────────────────────
//
// Owner, on his second encounter with the same wait: "a stop is a stop — maybe it should be a 'stop
// immediately or at next boundary to preserve data' kind of question when you press it." Stop was a
// `window.confirm` that stated the boundary stop as a fact, because that was the only stop there was.
test('Stop asks the question rather than stating the answer, and names what each costs', () => {
  const css = readFileSync(new URL('../src/base.css', import.meta.url), 'utf8')

  // NOT a confirm. It has two outcomes and this has three, and the third — leaving the run alone —
  // must stay the easiest.
  assert.ok(!/window\.confirm\([^)]*Stop the clearance/.test(home),
    'Stop is back on a two-outcome confirm, so the choice the owner ruled for cannot be offered')
  assert.match(home, /function StopChoice\(/, 'there is no dialog to ask the question in')
  assert.match(home, /onClick=\{\(\) => setAsking\(true\)\}/, 'the Stop button acts instead of asking')

  // BOTH TRADES NAMED, in the reader's terms rather than the machinery's. Each option says what it
  // COSTS: one costs the step in flight, the other costs time — and the honest thing about that time
  // is that it is unbounded, which is what makes the first option make sense.
  const dialog = home.slice(home.indexOf('function StopChoice('), home.indexOf('function StateChip('))
  assert.ok(dialog.length > 800, 'the dialog slice is empty — the arm has broken, not the tree')
  assert.match(dialog, /Stop at the next step/)
  assert.match(dialog, /Stop now/)
  assert.match(dialog, /no deadline/, 'the boundary option does not say the wait is unbounded, which is the whole reason the other one exists')
  assert.match(dialog, /work is lost/, 'the immediate option does not name what it costs')
  assert.match(dialog, /recorded before it is kept/, 'the immediate option does not say what survives')
  assert.match(dialog, /Leave it running/, 'there is no way out of the dialog that changes nothing')
  // Both reach the API, and only one of them asks for the immediate stop.
  assert.match(home, /onImmediate=\{\(\) => void stop\(true\)\}/)
  assert.match(home, /onBoundary=\{\(\) => void stop\(false\)\}/)

  // ── `home2-stop` IS NOT USED INSIDE THE DIALOG ────────────────────────────────────────────────────
  //
  // scripts/home-render-check.mjs counts that class in a real browser and asserts an exact number, to
  // hold "a Stop appears only where it can act". reddened main by giving Acknowledge the class;
  // two more of them inside a dialog is the same defect, and no unit test can see it.
  assert.ok(!/home2-stop/.test(dialog), 'the dialog uses home2-stop, which the browser check counts')
  assert.match(css, /\.stop-choice-opt\s*\{/, 'the options have no style, so they render as bare text')

  // AND THE STOPPING LINE READS THE ANSWER, not the press. An immediate stop that found no turn to end
  // is a boundary stop, and the driver says so.
  // The CONDITION, not the mention. `assert.match(home, /took\?\.note/)` was the first shape of this
  // arm and it passed on `{false ? took?.note : …}` — a plant that disabled the branch entirely while
  // leaving the string in the file. A guard that greps for a name cannot see whether it decides
  // anything.
  assert.match(home, /\{took\?\.note[\s\S]{0,40}\?\s*took\.note/,
    'the stopping line ignores what the server said actually happened')
})

// ── TWO READS OF ONE MARK ARE NOT ONE READ ────────────────────────────────────────────────────────
//
// Two failed reads of the same mark for the same owner drew byte-identical cards: depth, state, mark,
// owner, step and failure sentence, and nothing saying which read it was. A person acknowledged the
// first, met the second, read it as the first coming back, pressed the button three times and reported
// it broken. It had worked every time.
test('two reads of one mark are told apart, and a single read gains nothing', () => {
  const twins = [
    run({ runId: 'a', state: 'failed', date: '2026-09-12', issuedAt: '2026-09-12T09:05:00Z' }),
    run({ runId: 'b', state: 'failed', date: '2026-09-13', issuedAt: '2026-09-13T11:40:00Z' }),
  ]
  const byDay = readStamps(twins)
  assert.notEqual(byDay.get('a'), byDay.get('b'), 'the two cards must not be the same string')
  assert.equal(byDay.get('a'), '2026-09-12', 'a day apart is told apart by the day, which is what a reader sees')

  // CRITERION 3, and it is the half a fix like this usually loses: a lone card says no more than before.
  assert.equal(readStamps([twins[0]!]).get('a'), null, 'one read must not put a date on the band as decoration')

  // A THIRD RUN THAT IS NOT A TWIN STAYS QUIET while the twins speak, so the stamp is a property of the
  // ambiguity and not of the list having more than one row in it.
  const mixed = readStamps([...twins, run({ runId: 'c', markName: 'OTHER', state: 'failed' })])
  assert.equal(mixed.get('c'), null)
  assert.ok(mixed.get('a'))
})

test('two reads on ONE day fall back to the time, which is the case that produced the report', () => {
  // `issuedAt` states this rule itself: the date is what a reader sees, and the time shows only when two
  // reads share a day and would otherwise be indistinguishable. A matter that fails fast is re-submitted
  // the same morning, so the tie is the reported case rather than the exotic one.
  const same = readStamps([
    run({ runId: 'a', state: 'failed', date: '2026-09-14', issuedAt: '2026-09-14T08:10:00Z' }),
    run({ runId: 'b', state: 'failed', date: '2026-09-14', issuedAt: '2026-09-14T13:55:00Z' }),
  ])
  assert.notEqual(same.get('a'), same.get('b'))
  assert.match(String(same.get('a')), /^2026-09-14 \d{2}:\d{2}$/)

  // AN UNUSABLE STAMP DEGRADES TO THE DAY rather than to "Invalid Date": the band is short, and a broken
  // token in it is worse than the ambiguity it was meant to resolve. The twins then read the same, which
  // is honest — there is nothing in the data that tells them apart.
  const broken = readStamps([
    run({ runId: 'a', state: 'failed', date: '2026-09-14', issuedAt: 'not-a-date' }),
    run({ runId: 'b', state: 'failed', date: '2026-09-14', issuedAt: null }),
  ])
  assert.equal(broken.get('a'), '2026-09-14')
  assert.equal(broken.get('b'), '2026-09-14')
})

test('the same mark under two different owners is not a twin', () => {
  // What a reader compares is what the card DRAWS, and the card draws the owner. Two owners clearing the
  // same word are two different questions, and stamping both would put a date on cards nobody could
  // confuse — the decoration criterion 3 refuses.
  const stamps = readStamps([
    run({ runId: 'a', account: 'zephyr', state: 'failed' }),
    run({ runId: 'b', account: 'aurora', state: 'failed' }),
  ])
  assert.equal(stamps.get('a'), null)
  assert.equal(stamps.get('b'), null)
})
