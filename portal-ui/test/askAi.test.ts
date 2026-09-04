// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Ask AI — the control the shell strips from every client report and never put back.
//
// THE DEFECT. The full clearance report carries an "Ask your AI about this run"
// band: a copy-question button, the connector address, the setup recipes. `prepareReportForEmbed` strips
// it from every client-facing framed report because the band names the STAFF host — and unlike the
// report's Export menu, which the shell strips and then reproduces in its own header, nothing
// reproduced this one. The knockout renderer never had a band at all.
//
// So no client, on any run kind, could reach an Ask-AI control anywhere in the portal. The owner
// reported it missing; it was missing by construction, which is why no test caught it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { askAiPrompt, askAiOffer } from '../src/contract/askAi.ts'
// @ts-expect-error — the driver is plain .mjs with no types; this is a parity read, not an API.
import { renderHtml } from '../../driver/publish/render.mjs'
// @ts-expect-error — same.
import { parseReport } from '../../driver/publish/parse.mjs'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const WIRED = { url: 'https://mcp.example.test/mcp', enabled: true }

/** The sentence a DELIVERED report offers, read off the button a reader actually copies from. */
function promptInReport(runId: string): string {
  const md = [
    '---', 'type: prelim-clearance', `matter: ${runId}`, 'title: MOONBERRY',
    'overall_label: MEDIUM', 'overall_badge: l3', 'overall_caption: medium overall.',
    'classes: 5 · 42', 'jurisdiction: worldwide', 'run: 2026-08-26', '---', '',
    '# Marks', '## Beta Inc', '- one: A senior register mark on the filed goods.', '',
  ].join('\n')
  const dir = mkdtempSync(join(process.env['TMPDIR'] ?? tmpdir(), 'askai-'))
  const path = join(dir, 'f.report.md')
  writeFileSync(path, md)
  const html: string = renderHtml(parseReport(path), [], [], { runId, mcpUrl: 'https://staff.invalid/mcp' })
  return /class="[^"]*\baskai-copy\b[^"]*"[^>]*data-copy="([^"]*)"/.exec(html)?.[1] ?? ''
}

test('PARITY: the shell asks the same question the delivered report asks', () => {
  // One rule, two surfaces. A reader who copies the sentence off the shell and a reader who copies it out
  // of a delivered document are asking the same question about the same run.
  //
  // READ OFF THE RENDERED REPORT, not off a shared helper — and that is a deliberate choice, not the
  // lazy one. `render.mjs` is BYTE-FROZEN at a content hash with a documented break checklist, because
  // it renders documents that are re-rendered after delivery; exporting a function from it to import
  // here would have moved that hash for a test's convenience. Reading the attribute a reader actually
  // copies from is also the stronger claim: it tests the artifact rather than a helper the artifact
  // happens to call today.
  for (const runId of ['tmp1-aurora-run', 'tmp4-aurora-batch']) {
    const inReport = promptInReport(runId)
    assert.ok(inReport, `the report offers a copyable question for ${runId}`)
    assert.equal(askAiPrompt(runId, 'MOONBERRY'), inReport,
      `the shell and the delivered report disagree about what to ask for ${runId}`)
  }
})

test('the question names the run, so an assistant is asked about THIS one', () => {
  assert.equal(askAiOffer('tmp4-aurora-batch', 'IRONWHISK', WIRED).question,
    'Brief me on trademark clearance run tmp4-aurora-batch.')
})

test('THE ADDRESS IS THE CLIENT DOOR, and a missing one is an answer', () => {
  // The band is stripped from client reports precisely because it names the staff host. A control the
  // shell draws itself that re-introduced that host would defeat the strip rather than complete it — so
  // the address comes from the client-connector API, and null renders as a sentence rather than a host
  // that will not connect.
  assert.equal(askAiOffer('r1', 'M', WIRED).address, 'https://mcp.example.test/mcp')
  assert.equal(askAiOffer('r1', 'M', null).address, null, 'no answer yet is not an address')
  assert.equal(askAiOffer('r1', 'M', { url: null, enabled: true }).address, null, 'no connector wired')
  assert.equal(askAiOffer('r1', 'M', { url: 'https://x/mcp', enabled: false }).address, null,
    'disabled means disabled — a url that is not offered is not shown')
})

test('the question survives a deployment with no connector', () => {
  // It is the sentence to say once there IS one, and it costs nothing to show. Blanking the whole
  // control on a null address would leave the reader with the same nothing they had before.
  const offer = askAiOffer('tmp9', 'LUMEN', null)
  assert.match(offer.question, /Brief me on trademark clearance run tmp9\./)
  assert.equal(offer.instructionsPath, '/portal/ai', 'and a way to the setup instructions')
})

test('THE CLASS: the control is drawn for every run kind, not gated on the framed document', () => {
  // Export can only offer what the document defines — that is. This offers nothing of
  // the document: the question comes from the run and the address from the deployment. Asserted on the
  // screen's source because the gate is a render decision, and the arm that would have caught the
  // original defect is exactly "is there a control here at all".
  const screen = readFileSync(fileURLToPath(new URL('../src/screens/Result.tsx', import.meta.url)), 'utf8')
  assert.match(screen, /<AskAiMenu runId=\{run\.runId\}/, 'the shell draws one')
  // Not inside the `run.report ?` branch that gates Export: a batch has no run-level document and would
  // lose the control exactly where the reader most needs it.
  const header = /<span style=\{\{ flex: 1 \}\} \/>([\s\S]*?)<\/div>/.exec(screen)?.[1] ?? ''
  assert.match(header, /<AskAiMenu/, 'in the master header')

  // NOT BEHIND ANY GATE, not merely not behind one SPELLING of one. The previous form of this arm read
  // `doesNotMatch(header, /run\.report \? <AskAiMenu/)`, and a plant plainly gating the control —
  // `{run.report && <AskAiMenu …/>}` — compiled, shipped the defect, and left the suite 459/459 green.
  // An arm whose message names a class has to be able to fail for the class. What a gate looks like in
  // JSX is a conditional immediately before the element, whatever operator spells it.
  const before = header.slice(0, header.indexOf('<AskAiMenu'))
  const lastOpen = before.lastIndexOf('{')
  const expr = lastOpen === -1 ? '' : before.slice(lastOpen)
  assert.doesNotMatch(expr, /\?|&&|\|\|/,
    `the control is drawn unconditionally; found a conditional immediately before it: ${JSON.stringify(expr.slice(-60))}`)
})
