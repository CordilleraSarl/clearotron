// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Ask AI — one press opens the reader's own assistant with the question typed in.
//
// WHAT THESE ARMS ARE FOR. The owner watched a lawyer press this button, read what opened, dismiss it,
// and go to Claude to type a question by hand. The control handed over two monospace strings with a Copy
// link each and said nothing about which one was needed. So the things worth holding are: the question
// reads like something a person would type, the control is not offered to a reader who cannot use it,
// and a reader whose state we could not measure is not told a fact about themselves.
//
// THIS FILE USED TO BE A PARITY TEST. The delivered report composed the same sentence, and the arm read
// it back off the rendered HTML so the two surfaces could not drift. The report's band came out under
// the owner's 2026-09-15 ruling, so there is one definition and nothing left to hold in step — and an
// arm reading a band that is no longer rendered would have gone green on an empty string forever.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  askAiPrompt, askAiOffer, readableDate, ASSISTANTS, AI_SETUP_PATH, AI_SETUP_FROM_REPORT, ASK_AI_QUESTIONS, ASK_AI_OPENS,
  askAiQuestion, askAiHeading, headingText, issuedOn, openLabel, reportPhrase, rememberReport, rememberedReport,
  reachedFromReport, withAskOpen, asksOpen, withoutAskOpen, findingAsked,
} from '../src/contract/askAi.ts'
import type { ReportStore } from '../src/contract/askAi.ts'

const WIRED = { url: 'https://mcp.example.test/mcp', enabled: true, aiConnected: true }
const RUN = { markName: 'ACME', date: '2026-09-14', kind: 'clearance' as const }
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
/** The control's own file — the whole of it, since the component is the file. */
const CONTROL = read('../src/components/AskAi.tsx')
const SCREEN = read('../src/screens/Result.tsx')

test('the question is a sentence a person could have typed: the mark, the date, no run code', () => {
  // The owner's own example, 2026-09-15. Every part of it is load-bearing: the run code is gone because
  // it read as something meant for a machine, and the date is in because it is what tells two reads of
  // the same mark apart — which is the one thing the assistant has to get right.
  assert.equal(askAiPrompt('ACME', '2026-09-14'), 'Brief me on the ACME clearance from 14 September.')

  // THE RUN CODE IS THE REGRESSION TO CATCH, so say so rather than only asserting the whole string. A
  // future edit that appends "(run noref4d19…)" would fail the equality above with a message about a
  // sentence; this one fails with a message about the thing that was ruled out.
  for (const runId of ['noref000001-acme-2026-09-14-amber-harbour', 'tmp4-aurora-batch']) {
    assert.ok(!askAiPrompt('ACME', '2026-09-14').includes(runId), 'no run identifier in the visible question')
  }
})

test('a knockout batch is named the way its own screens name it', () => {
  assert.equal(askAiPrompt('ACME', '2026-09-14', 'knockout-batch'),
    'Brief me on the ACME knockout search from 14 September.')
})

test('a date it cannot read is left out rather than guessed', () => {
  // A WRONG DATE IS WORSE THAN NO DATE, because this sentence sits one line under a header that prints
  // the right one. Null, empty, a timestamp, a locale spelling — none of those is `YYYY-MM-DD`.
  assert.equal(askAiPrompt('ACME', null), 'Brief me on the ACME clearance.')
  for (const bad of ['', '14/09/2026', '2026-09-14T10:00:00Z', 'yesterday', '2026-9-4', '2026-13-01', '2026-09-00']) {
    assert.equal(readableDate(bad), null, `${JSON.stringify(bad)} is not a date this may print`)
  }
  assert.equal(readableDate('2026-01-01'), '1 January', 'and a date it CAN read still reads')
})

test('the date is formatted from the parts, so it does not move a day west of Greenwich', () => {
  // `new Date('2026-09-14')` is UTC midnight and prints as the 13th in any negative offset. The report's
  // header, one line above, would still say the 14th. Asserted by running the arm in a zone that would
  // expose it rather than by reading the source for the absence of a call.
  const before = process.env['TZ']
  try {
    process.env['TZ'] = 'Pacific/Honolulu'      // UTC-10
    assert.equal(readableDate('2026-09-14'), '14 September')
    process.env['TZ'] = 'Pacific/Kiritimati'    // UTC+14
    assert.equal(readableDate('2026-09-14'), '14 September')
  } finally {
    if (before === undefined) delete process.env['TZ']; else process.env['TZ'] = before
  }
})

test('a mark the run never recorded still yields a sentence', () => {
  // Runs delivered before publish started copying `markName` carry null. The fallback is the one the
  // rest of the shell uses, and the point is that it never produces "the  clearance".
  assert.equal(askAiPrompt(null, '2026-09-14'), 'Brief me on the this mark clearance from 14 September.')
  assert.equal(askAiPrompt('   ', null), 'Brief me on the this mark clearance.')
})

test('THE BUTTON IS NOT DRAWN WHERE IT COULD DO NOTHING', () => {
  // A panel explaining that there is nothing to connect to was turned down by the owner: a button that
  // can do nothing is not drawn. The three ways an installation has nothing:
  assert.equal(askAiOffer(RUN, null).drawn, false, 'the route has not answered yet')
  assert.equal(askAiOffer(RUN, { url: null, enabled: true, aiConnected: null }).drawn, false, 'no connector wired')
  assert.equal(askAiOffer(RUN, { url: 'https://x/mcp', enabled: false, aiConnected: null }).drawn, false,
    'disabled means disabled')

  // And the two ways it has something. The local route counts: that is the whole of a laptop install.
  assert.equal(askAiOffer(RUN, WIRED).drawn, true, 'a published client door')
  assert.equal(askAiOffer(RUN, { url: null, enabled: false, stdio: { command: 'x' }, aiConnected: null }).drawn, true,
    'a local route and no published door is a laptop install, which is the case this used to strand')
})

test('COULD-NOT-MEASURE IS NOT "NEVER CONNECTED", and both draw the connect panel', () => {
  // The difference matters even though the two render the same, because the reason they render the same
  // is a decision about POLARITY and not an accident: offering the questions to a reader with no
  // assistant opens a chat that cannot see the report, which is the dead end this control exists to end.
  // A null must never harden into a stored `false` somewhere upstream on the strength of them looking alike.
  assert.equal(askAiOffer(RUN, { ...WIRED, aiConnected: true }).connected, true)
  assert.equal(askAiOffer(RUN, { ...WIRED, aiConnected: false }).connected, false)
  assert.equal(askAiOffer(RUN, { ...WIRED, aiConnected: null }).connected, false, 'no log to read draws the panel')
  assert.equal(askAiOffer(RUN, { url: WIRED.url, enabled: true }).connected, false,
    'a server too old to send the field draws the panel too')
})

test('both links carry the question and go to the two assistants the owner checked', () => {
  // He opened both by hand on 2026-09-15: each opens a new chat with the text typed in and not sent.
  // A floor first, so a future edit that empties the table fails here rather than rendering no button.
  //
  // NAMES, NOT BUTTON LABELS. The table used to hold "Ask Claude" and "Ask ChatGPT" because each was a
  // menu item; the connected panel now has one button, "Open in …", composed from the name. What this
  // arm holds is unchanged: two checked assistants, and a link for each that carries the question.
  assert.equal(ASSISTANTS.length, 2, 'two assistants are checked')
  assert.deepEqual(ASSISTANTS.map((a) => a.name), ['Claude', 'ChatGPT'])

  const q = askAiPrompt('ACME', '2026-09-14')
  const hrefs = ASSISTANTS.map((a) => a.href(q))
  assert.equal(hrefs[0], `https://claude.ai/new?q=${encodeURIComponent(q)}`)
  assert.equal(hrefs[1], `https://chatgpt.com/?q=${encodeURIComponent(q)}`)
  for (const href of hrefs) {
    assert.ok(href.includes(encodeURIComponent('Brief me on the ACME clearance')), 'the question travels')
    assert.ok(!/ /.test(href), 'and it is encoded, so the link is not cut at the first space')
  }
})

test('THE FOUR QUESTIONS: the rows are the design\'s words, the first is selected, and the button names its assistant', () => {
  assert.deepEqual(ASK_AI_QUESTIONS.map((q) => q.label), [
    'Brief me on this clearance',
    'Explain the main risks',
    'What needs further investigation?',
    'How would narrower goods change the assessment?',
  ])
  // THE FIRST ROW IS THE QUESTION THE CONTROL ALWAYS ASKED, so a reader who presses straight through gets
  // what they got before there was a choice.
  assert.equal(askAiQuestion(0, RUN), askAiPrompt(RUN.markName, RUN.date, RUN.kind))
  assert.match(CONTROL, /const \[picked, setPicked\] = useState\(0\)/, 'the panel does not open on the first question')
  // ONE BUTTON, AND IT SAYS WHERE IT GOES. Claude, because the product cannot tell which app a reader
  // connected — see ASK_AI_OPENS for why, and for the open decision.
  assert.equal(openLabel(ASK_AI_OPENS), 'Open in Claude')
  assert.match(CONTROL, /openLabel\(ASK_AI_OPENS\)/, 'the button words are not the ones composed for the assistant it opens')
  assert.match(CONTROL, /ASK_AI_OPENS\.href\(askAiQuestion\(picked, run\)\)/,
    'the button does not open the assistant it names with the question that is selected')
})

test('QUESTIONS 2-4 REACH THE ASSISTANT TYPED IN AND NOT SENT — proved on the composed link', () => {
  // The link is the whole of the handoff, so the assertion is on the link a press opens: a new chat with
  // the text in its box (`/new?q=`), carrying nothing that would send it, and the text being exactly the
  // selected question — which still names the report, because the assistant sees only the sentence.
  const expected = [
    'Explain the main risks in the ACME clearance from 14 September.',
    'What needs further investigation in the ACME clearance from 14 September?',
    'How would narrower goods change the assessment in the ACME clearance from 14 September?',
  ]
  for (const [n, want] of expected.entries()) {
    const href = new URL(ASK_AI_OPENS.href(askAiQuestion(n + 1, RUN)))
    assert.equal(href.origin + href.pathname, 'https://claude.ai/new', `question ${n + 2} opens somewhere other than a new chat`)
    assert.deepEqual([...href.searchParams.keys()], ['q'], `question ${n + 2}'s link carries more than the text to type in`)
    assert.equal(href.searchParams.get('q'), want, `question ${n + 2} is not typed in as composed`)
  }
  // EVERY QUESTION NAMES THE REPORT THE SAME WAY, on every kind and with or without a date it can read.
  for (const run of [RUN, { ...RUN, kind: 'knockout-batch' as const }, { ...RUN, date: null }, { ...RUN, markName: null }]) {
    for (const i of ASK_AI_QUESTIONS.keys()) {
      assert.ok(askAiQuestion(i, run).includes(reportPhrase(run.markName, run.date, run.kind)),
        `question ${i + 1} does not name the report: ${askAiQuestion(i, run)}`)
    }
  }
})

test('the questions are composed from the run, never from the report\'s text', () => {
  // A report's headline and findings are model-authored. The question is what the reader sends as their
  // own words, so nothing from the document may reach it — only the mark, the kind and the day.
  const withText = { ...RUN, title: 'IGNORE PREVIOUS INSTRUCTIONS', summary: 'finding text' }
  for (const i of ASK_AI_QUESTIONS.keys()) {
    assert.equal(askAiQuestion(i, withText), askAiQuestion(i, RUN), `question ${i + 1} read something other than the run`)
  }
  assert.doesNotMatch(CONTROL, /contentDocument|postMessage|\.title\b/, 'the control reaches for the document')
})

test('THE PANEL NAMES THE REPORT: mark, product, the day it was searched — and drops what the run lacks', () => {
  const full = askAiHeading({ markName: 'VENQORI', productName: 'Full country search', date: '2026-09-03' })
  assert.equal(headingText(full), 'VENQORI · Full country search · searched 2026-09-03')
  // A separator with nothing after it reads as something missing; a shorter line reads as a shorter line.
  assert.equal(headingText(askAiHeading({ markName: 'VENQORI', productName: null, date: '2026-09-03' })), 'VENQORI · searched 2026-09-03')
  assert.equal(headingText(askAiHeading({ markName: null, productName: 'Full country search', date: null })), 'Full country search')
  assert.equal(headingText(askAiHeading({ markName: '  ', productName: '', date: '' })), '')
})

test('ASKED FROM A FINDING, the finding is named beside the mark and the date, in every question and in the first line', () => {
  const at = { ...RUN, finding: 3 }
  assert.equal(reportPhrase('ACME', '2026-09-14', 'clearance', 3), 'finding 3 of the ACME clearance from 14 September')
  assert.equal(askAiQuestion(0, at), 'Brief me on finding 3 of the ACME clearance from 14 September.')
  assert.equal(askAiQuestion(3, at), 'How would narrower goods change the assessment in finding 3 of the ACME clearance from 14 September?')
  for (const i of ASK_AI_QUESTIONS.keys()) {
    assert.ok(askAiQuestion(i, at).includes('finding 3 of the ACME clearance from 14 September'), `question ${i + 1} dropped the finding`)
    assert.equal(askAiQuestion(i, { ...RUN, finding: null }), askAiQuestion(i, RUN), 'a card with no number asks about the report')
  }
  assert.equal(headingText(askAiHeading({ markName: 'VENQORI', productName: 'Full country search', date: '2026-09-03', finding: 3 })),
    'VENQORI · finding 3 · Full country search · searched 2026-09-03')
  assert.equal(headingText(askAiHeading({ markName: 'VENQORI', productName: 'Full country search', date: '2026-09-03', finding: null })),
    'VENQORI · Full country search · searched 2026-09-03')
})

test('A KNOCKOUT NUMBERS EACH NAME FROM 1, so a number names a finding only where the name is certain', () => {
  const press = { ordinal: 2, markIndex: 1, nonce: 1 }
  assert.deepEqual(findingAsked(press, 'clearance', null), { ordinal: 2, markName: null, nonce: 1 })
  assert.deepEqual(findingAsked(press, 'knockout-batch', 'AQUAMAX'), { ordinal: 2, markName: 'AQUAMAX', nonce: 1 },
    'one name\'s own document: every finding in it is that name\'s')
  assert.deepEqual(findingAsked(press, 'knockout-batch', null), { ordinal: null, markName: null, nonce: 1 },
    'a whole batch: the number alone is several findings, so the press asks about the report')
  assert.equal(findingAsked(null, 'clearance', null), null)
})

test('THE ISSUE DAY IS THE ONE THE REPORT PRINTS — Zurich, whatever zone the reader is in', () => {
  // The report's Issued stamp is composed at publish in Europe/Zurich. A UTC slice of `issuedAt` names the
  // day before for anything issued after 22:00 in summer, in a header directly above the document. Run in
  // zones on both sides of the date line, because a formatter that fell back to the reader's zone would
  // pass in one of them.
  const before = process.env['TZ']
  try {
    for (const tz of ['UTC', 'Pacific/Honolulu', 'Pacific/Kiritimati']) {
      process.env['TZ'] = tz
      assert.equal(issuedOn({ state: 'delivered', issuedAt: '2026-09-03T22:30:00.000Z' }), '2026-09-04', `${tz}: late summer evening`)
      assert.equal(issuedOn({ state: 'delivered', issuedAt: '2026-09-03T21:59:00.000Z' }), '2026-09-03', `${tz}: before Zurich midnight`)
      assert.equal(issuedOn({ state: 'delivered', issuedAt: '2026-01-15T23:30:00.000Z' }), '2026-01-16', `${tz}: winter, one hour ahead`)
    }
  } finally {
    if (before === undefined) delete process.env['TZ']; else process.env['TZ'] = before
  }
  // ONLY A DELIVERED READ WAS ISSUED, and a stamp that cannot be read is left out rather than guessed.
  assert.equal(issuedOn({ state: 'running', issuedAt: '2026-09-03T10:00:00.000Z' }), null, 'a live run\'s last write is not an issue date')
  for (const bad of [null, '', 'yesterday', '03/09/2026', '2026-09-99T00:00:00Z']) {
    assert.equal(issuedOn({ state: 'delivered', issuedAt: bad }), null, `${JSON.stringify(bad)} is not a stamp this may print`)
  }
  // And the header labels both dates, each by what it is.
  assert.match(SCREEN, /· searched <span className="mono">\{run\.date\}<\/span>/, 'the searched date is not labelled')
  assert.match(SCREEN, /· issued <span className="mono">\{issued\}<\/span>/, 'the issue date is not labelled')
  assert.match(SCREEN, /const issued = issuedOn\(run\)/, 'the header does not read the issue day through the one reader of it')
})

/** A browser's storage, in memory, for the arms below. */
function memoryStore(): { store: ReportStore; items: Map<string, string> } {
  const items = new Map<string, string>()
  return { items, store: () => ({ getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => { items.set(k, v) } }) }
}

test('"SET IT UP" LEAVES A NOTE OF THE REPORT, and the note reads back', () => {
  const { store } = memoryStore()
  assert.equal(rememberedReport(store), null, 'a browser that was never told anything remembers nothing')
  assert.equal(rememberReport({ runId: 'run-1', markSlug: null, mark: 'VENQORI' }, store), true)
  assert.deepEqual(rememberedReport(store), { runId: 'run-1', markSlug: null, mark: 'VENQORI' })
  assert.equal(rememberReport({ runId: 'run-2', markSlug: 'venqori', mark: null }, store), true)
  assert.deepEqual(rememberedReport(store), { runId: 'run-2', markSlug: 'venqori', mark: null }, 'the latest report is the one remembered')

  // THE CONTROL WRITES IT BEFORE IT LEAVES, and leaves for the page by the named constant.
  const setUp = CONTROL.slice(CONTROL.indexOf('const setUp = () => {'), CONTROL.indexOf('\n  }', CONTROL.indexOf('const setUp = () => {')))
  assert.ok(setUp.length > 40, 'the Set it up handler moved — this arm would be reading nothing')
  assert.ok(setUp.indexOf('rememberReport(') >= 0 && setUp.indexOf('rememberReport(') < setUp.indexOf('go(AI_SETUP_FROM_REPORT)'),
    'Set it up does not remember the report before it goes to the page')
  assert.match(CONTROL, /onClick=\{setUp\}/, 'the Set it up button does not run the handler that leaves the note')
})

test('STORAGE THAT THROWS NEVER STOPS A READER — every read and write is wrapped', () => {
  // In a null-origin context reading `localStorage` at all throws, and some private modes throw on write.
  // A reader on the way to connecting must never meet an exception for a note nobody asked them to keep.
  const noAccess: ReportStore = () => { throw new Error('SecurityError: storage is not available') }
  const refuses: ReportStore = () => ({ getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('quota') } })
  for (const store of [noAccess, refuses]) {
    assert.doesNotThrow(() => rememberReport({ runId: 'run-1', markSlug: null, mark: 'VENQORI' }, store))
    assert.equal(rememberReport({ runId: 'run-1', markSlug: null, mark: 'VENQORI' }, store), false, 'a failed write says so')
    assert.doesNotThrow(() => rememberedReport(store))
    assert.equal(rememberedReport(store), null)
  }
  // No browser at all — the default store reaches for `window`, which is exactly the throw to survive.
  assert.equal(rememberReport({ runId: 'run-1', markSlug: null, mark: null }), false)
  assert.equal(rememberedReport(), null)
  // A value this does not recognise is no way back.
  const { store, items } = memoryStore()
  for (const junk of ['not json', 'null', '[]', '{"runId":""}', '{"runId":7}', '{"mark":"VENQORI"}']) {
    items.set('cordillera-ask-ai-report', junk)
    assert.equal(rememberedReport(store), null, `${junk} read as a report`)
  }
})

test('ONE SIGNAL OPENS THE PANEL ON ARRIVAL, and the report screen takes it out of the address', () => {
  assert.equal(withAskOpen('/portal/result/run-1'), '/portal/result/run-1?ask=open')
  assert.equal(withAskOpen('/portal/result/run-1/venqori'), '/portal/result/run-1/venqori?ask=open')
  assert.equal(asksOpen('?ask=open'), true)
  assert.equal(asksOpen(''), false)
  assert.equal(asksOpen('?ask=closed'), false)
  assert.equal(withoutAskOpen('/portal/result/run-1', '?ask=open'), '/portal/result/run-1')
  assert.equal(withoutAskOpen('/portal/result/run-1', '?x=1&ask=open'), '/portal/result/run-1?x=1')
  // READ ONCE AS THE INITIAL STATE, and removed by a replace: re-reading it every render would close the
  // panel the moment it left the address, and a push would leave Back on an address that opens it again.
  assert.match(SCREEN, /useState\(\(\) => asksOpen\(window\.location\.search\)\)/, 'the screen does not read the signal once, on arrival')
  assert.match(SCREEN, /ctx\.go\(withoutAskOpen\(window\.location\.pathname, window\.location\.search\), \{ replace: true \}\)/,
    'the signal is not taken out of the address by a replace')
  assert.match(SCREEN, /openOnArrival=\{askOnArrival\}/, 'the screen does not hand the signal to the control')
  assert.match(CONTROL, /useState\(openOnArrival\)/, 'the control ignores the signal')
  // The connect page's marker, which the page reads to offer the way back.
  assert.equal(AI_SETUP_FROM_REPORT, `${AI_SETUP_PATH}?from=report`)
  assert.equal(reachedFromReport('?from=report'), true)
  assert.equal(reachedFromReport(''), false)
})

test('THE CONTROL ASKS THE DEPLOYMENT NOTHING — its caller asks once and hands the answer over', () => {
  // A list drawing the control on fifty rows would otherwise make fifty identical requests, and the
  // revisit check counts what a screen asks per visit.
  assert.doesNotMatch(CONTROL, /\bapi\.\w+\(|useLoad\(/, 'the control makes a request of its own')
  assert.match(CONTROL, /readonly access: McpAccess \| null/, 'the control no longer takes the answer as a prop')
  assert.equal((SCREEN.match(/api\.mcpAccess\(\)/g) ?? []).length, 1, 'the report screen does not ask exactly once')
  assert.match(SCREEN, /access=\{access\}/, 'the report screen does not hand its answer to the control')
})

test('NO ADDRESS AND NO COPY LINK REACHES A REPORT, in any state', () => {
  // The band is stripped from client reports precisely because it names the staff host. A control the
  // shell draws itself that put an address back would defeat that strip rather than complete it — and a
  // Copy link is what the owner watched a reader give up on. Read off the control's source, because the
  // claim is about what is RENDERED and the offer type no longer carries an address to assert about.
  // THE CONTROL IS ITS OWN FILE NOW, read from its declaration to the end — past the licence header, whose
  // "Copyright" is not a Copy link. The floor is what stops a moved or emptied control passing over nothing.
  const start = CONTROL.indexOf('export function AskAi(')
  assert.ok(start > 0, 'found the control')
  const control = CONTROL.slice(start)
  assert.ok(control.length > 800, 'and it is the whole control, not a stub this arm would pass over')

  assert.doesNotMatch(control, /offer\.address|access\.url|access\?\.url|keyUrl/, 'no address reaches the control')
  assert.doesNotMatch(control, /clipboard|Copy/, 'no copy link, and nothing that would need one')
})

test('THE CLASS: the control is drawn for every run kind, not gated on the framed document', () => {
  // Export can only offer what the document defines. This offers nothing of the document: the question
  // comes from the run. The arm that would have caught the original defect is exactly "is there a
  // control here at all", so it is asserted on the render rather than on the helper.
  assert.match(SCREEN, /<AskAi\s/, 'the shell draws one')
  const header = /<span style=\{\{ flex: 1 \}\} \/>([\s\S]*?)<\/div>/.exec(SCREEN)?.[1] ?? ''
  assert.match(header, /<AskAi\s/, 'in the master header')
  // ASK AI, THEN EXPORT — the order the design gives the two actions.
  assert.ok(header.indexOf('<AskAi') < header.indexOf('<ExportMenu'), 'Ask AI does not come before Export')

  // NOT BEHIND ANY GATE, not merely not behind one SPELLING of one. An earlier form of this arm read
  // `doesNotMatch(header, /run\.report \? <AskAiMenu/)`, and a plant plainly gating the control —
  // `{run.report && <AskAiMenu …/>}` — compiled, shipped the defect, and left the suite green. What a
  // gate looks like in JSX is a conditional immediately before the element, whatever spells it.
  //
  // The control's OWN `if (!offer.drawn) return null` is not that gate and must not be: a batch has no
  // run-level document and would lose the button exactly where the reader most needs it.
  const before = header.slice(0, header.indexOf('<AskAi'))
  const lastOpen = before.lastIndexOf('{')
  const expr = lastOpen === -1 ? '' : before.slice(lastOpen)
  assert.doesNotMatch(expr, /\?|&&|\|\|/,
    `the control is drawn unconditionally; found a conditional immediately before it: ${JSON.stringify(expr.slice(-60))}`)
})

test('the connect panel leads to the one page that sets a connector up, by the named constant', () => {
  // THIS COUNTED TWO ROUTES — Set it up on the panel and "Connect another AI" on the menu. The connected
  // form replaced the menu and that row with it, so one route remains; what the arm holds is the same:
  // the page is reached by the named constant, never by a path typed into the control.
  assert.equal(AI_SETUP_PATH, '/portal/ai')
  assert.equal((CONTROL.match(/go\(AI_SETUP_FROM_REPORT\)/g) ?? []).length, 1, 'Set it up does not go by the named constant')
  assert.doesNotMatch(CONTROL, /'\/portal\/ai/, 'a typed path to the setup page')
})

test('"Ask a follow-up" appears nowhere — Ask AI is the one label for this action', () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|css)$/.test(n) ? [p] : []
  })
  const files = walk(fileURLToPath(new URL('../src', import.meta.url)))
  assert.ok(files.length > 40, `the walk found ${files.length} files, which is not this tree`)
  assert.deepEqual(files.filter((f) => /Ask a follow-up/i.test(readFileSync(f, 'utf8'))), [])
  assert.match(CONTROL, /<span>Ask AI<\/span>/, 'the button no longer says Ask AI')
  assert.doesNotMatch(CONTROL, /aria-label="(?!Ask AI"|Connect your AI first"|What to ask")/, 'the button\'s accessible name differs from its label')
})
