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
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { askAiPrompt, askAiOffer, readableDate, ASSISTANTS, AI_SETUP_PATH } from '../src/contract/askAi.ts'

const WIRED = { url: 'https://mcp.example.test/mcp', enabled: true, aiConnected: true }
const RUN = { markName: 'ACME', date: '2026-09-14', kind: 'clearance' as const }

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

test('COULD-NOT-MEASURE IS NOT "NEVER CONNECTED", and both draw the panel', () => {
  // The difference matters even though the two render the same, because the reason they render the same
  // is a decision about POLARITY and not an accident: offering the menu to a reader with no assistant
  // opens a chat that cannot see the report, which is the dead end this control exists to end. A null
  // must never harden into a stored `false` somewhere upstream on the strength of them looking alike.
  assert.equal(askAiOffer(RUN, { ...WIRED, aiConnected: true }).connected, true)
  assert.equal(askAiOffer(RUN, { ...WIRED, aiConnected: false }).connected, false)
  assert.equal(askAiOffer(RUN, { ...WIRED, aiConnected: null }).connected, false, 'no log to read draws the panel')
  assert.equal(askAiOffer(RUN, { url: WIRED.url, enabled: true }).connected, false,
    'a server too old to send the field draws the panel too')
})

test('both links carry the question and go to the two assistants the owner checked', () => {
  // He opened both by hand on 2026-09-15: each opens a new chat with the text typed in and not sent.
  // A floor first, so a future edit that empties the list fails here rather than rendering no menu.
  assert.equal(ASSISTANTS.length, 2, 'two assistants are offered')
  assert.deepEqual(ASSISTANTS.map((a) => a.label), ['Ask Claude', 'Ask ChatGPT'])

  const q = askAiPrompt('ACME', '2026-09-14')
  const hrefs = ASSISTANTS.map((a) => a.href(q))
  assert.equal(hrefs[0], `https://claude.ai/new?q=${encodeURIComponent(q)}`)
  assert.equal(hrefs[1], `https://chatgpt.com/?q=${encodeURIComponent(q)}`)
  for (const href of hrefs) {
    assert.ok(href.includes(encodeURIComponent('Brief me on the ACME clearance')), 'the question travels')
    assert.ok(!/ /.test(href), 'and it is encoded, so the link is not cut at the first space')
  }
})

test('NO ADDRESS AND NO COPY LINK REACHES A REPORT, in any state', () => {
  // The band is stripped from client reports precisely because it names the staff host. A control the
  // shell draws itself that put an address back would defeat that strip rather than complete it — and a
  // Copy link is what the owner watched a reader give up on. Read off the screen's source, because the
  // claim is about what is RENDERED and the offer type no longer carries an address to assert about.
  const screen = readFileSync(fileURLToPath(new URL('../src/screens/Result.tsx', import.meta.url)), 'utf8')
  const start = screen.indexOf('function AskAiMenu(')
  const end = screen.indexOf('function ExportMenu(')
  assert.ok(start > 0 && end > start, 'found the control in the screen')
  const control = screen.slice(start, end)
  assert.ok(control.length > 800, 'and it is the whole control, not a stub this arm would pass over')

  assert.doesNotMatch(control, /offer\.address|access\.url|access\?\.url|keyUrl/, 'no address reaches the control')
  assert.doesNotMatch(control, /clipboard|Copy/, 'no copy link, and nothing that would need one')
})

test('THE CLASS: the control is drawn for every run kind, not gated on the framed document', () => {
  // Export can only offer what the document defines. This offers nothing of the document: the question
  // comes from the run. The arm that would have caught the original defect is exactly "is there a
  // control here at all", so it is asserted on the render rather than on the helper.
  const screen = readFileSync(fileURLToPath(new URL('../src/screens/Result.tsx', import.meta.url)), 'utf8')
  assert.match(screen, /<AskAiMenu run=\{run\}/, 'the shell draws one')
  const header = /<span style=\{\{ flex: 1 \}\} \/>([\s\S]*?)<\/div>/.exec(screen)?.[1] ?? ''
  assert.match(header, /<AskAiMenu/, 'in the master header')

  // NOT BEHIND ANY GATE, not merely not behind one SPELLING of one. An earlier form of this arm read
  // `doesNotMatch(header, /run\.report \? <AskAiMenu/)`, and a plant plainly gating the control —
  // `{run.report && <AskAiMenu …/>}` — compiled, shipped the defect, and left the suite green. What a
  // gate looks like in JSX is a conditional immediately before the element, whatever spells it.
  //
  // The control's OWN `if (!offer.drawn) return null` is not that gate and must not be: a batch has no
  // run-level document and would lose the button exactly where the reader most needs it.
  const before = header.slice(0, header.indexOf('<AskAiMenu'))
  const lastOpen = before.lastIndexOf('{')
  const expr = lastOpen === -1 ? '' : before.slice(lastOpen)
  assert.doesNotMatch(expr, /\?|&&|\|\|/,
    `the control is drawn unconditionally; found a conditional immediately before it: ${JSON.stringify(expr.slice(-60))}`)
})

test('the panel and the menu both lead to the one page that sets a connector up', () => {
  assert.equal(AI_SETUP_PATH, '/portal/ai')
  const screen = readFileSync(fileURLToPath(new URL('../src/screens/Result.tsx', import.meta.url)), 'utf8')
  const control = screen.slice(screen.indexOf('function AskAiMenu('), screen.indexOf('function ExportMenu('))
  assert.equal((control.match(/ctx\.go\(AI_SETUP_PATH\)/g) ?? []).length, 2,
    'Set it up (panel) and Connect another AI (menu) — both by the named constant, never a typed path')
})
