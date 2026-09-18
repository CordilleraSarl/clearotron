// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// report-header-render-check.mjs — the delivered document's own header, measured in a browser.
//
//   node scripts/report-header-render-check.mjs [--keep]
//
// Two properties, both of which a reader met as defects on 2026-09-18 and neither of which any unit test
// can see, because every one of them asserts on the HTML STRING and both of these are layout:
//
//   1. ONE HEADER. The section breadcrumb is a row INSIDE `.rep-stickyhead`, and when the page is
//      scrolled the header is still at the top of the viewport with the breadcrumb inside it. It used to
//      be a sibling pinned at `top:var(--tb-h,52px)` — a variable this product sets nowhere — so it sat
//      at a guessed offset, showed content through the slit between the two bars, and slid under the
//      header whenever the guess was wrong.
//   2. THE BAND PILL CLEARS ITS HEADING. The pill hangs above the ladder and the heading sits above the
//      pill, and at the LEFTMOST band the pill is drawn flush left — directly under "Overall risk". They
//      overlapped, which is what a reader meets on a knockout whose band is the bottom rung.
//
// Driven at every rung of the ladder, not only the one a fixture happens to carry: the overlap is a
// property of the leftmost position, so a check that renders one band proves nothing about the band the
// next report lands on.
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { reapOnExit } from '../shared/reap-on-exit.mjs'
import { browserRun } from '../shared/browser-temp-root.mjs'
import { renderKnockoutHtml } from '../driver/publish/render-knockout.mjs'

const keep = process.argv.includes('--keep')
const WIDTH = 1280

// The ladder the house triage framework ships, so the rungs are the product's own and not invented here.
const FRAMEWORK = {
  framework_key: 'house-triage',
  title: 'House triage',
  bands: [{ label: 'Blocking', tone: 'severe' }, { label: 'Medium', tone: 'medium' },
    { label: 'Manageable', tone: 'low' }, { label: 'Low', tone: 'minimal' }],
}
const BANDS = FRAMEWORK.bands.map((b) => b.label)

// A mark with the STRUCTURE the gauge card needs — a basis and factors are what make `readBlock` draw the
// card at all. The words are fixture words; nothing here is a finding.
const markAt = (band) => ({
  name: 'EXAMPLEMARK',
  rating: band,
  classes: [9],
  basis: 'One identical name in the same trade, and two that contain it.',
  factors: ['An identical name is registered in class 9.', 'The trade is the same.'],
  counterFactors: ['The register counts do not say who is using what.'],
  mitigation: 'A narrower specification would move this.',
  assessment: '## What the screen found\n\nOne identical name.\n\n## What happens next\n\nTake it to clearance.',
  findings: [],
})

const docFor = (band) => renderKnockoutHtml(
  { marks: [markAt(band)], batch: { executiveSummary: 'One name screened.' } },
  FRAMEWORK,
  { runId: 'fixture', overall: band, identity: { identity: 'Knockout search' }, issuedDate: '2026-09-18' },
)

const dir = mkdtempSync(join(tmpdir(), 'report-header-check-'))
for (const band of BANDS) writeFileSync(join(dir, `${band.toLowerCase()}.html`), docFor(band))

const server = createServer((req, res) => {
  const name = decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\//, '')
  try {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(docFor(BANDS.find((b) => b.toLowerCase() === name.replace(/\.html$/, '')) ?? BANDS[0]))
  } catch { res.writeHead(404); res.end('no') }
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`

const { profile, env: chromeEnv, keep: keepRoot } = browserRun('report-header-check-')
if (keep) keepRoot()
const chrome = spawn('google-chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
  `--user-data-dir=${profile}`, `--window-size=${WIDTH},900`, '--remote-debugging-port=0', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'], detached: true, env: chromeEnv })
reapOnExit(chrome)

const wsUrl = await new Promise((resolve, reject) => {
  let devtools = ''
  const t = setTimeout(() => reject(new Error(`chrome reported no devtools endpoint in 60s:\n${devtools || '(nothing)'}`)), 60000)
  chrome.stderr.on('data', (c) => { devtools += c; const m = devtools.match(/ws:\/\/[^\s]+/); if (m) { clearTimeout(t); resolve(m[0]) } })
})
const ws = new WebSocket(wsUrl)
let id = 0
const pending = new Map()
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
await new Promise((r) => ws.addEventListener('open', r))
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const { result: targets } = await send('Target.getTargets')
const page = targets.targetInfos.find((t) => t.type === 'page')
const { result: sess } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true })
const sessionId = sess.sessionId
const cmd = (method, params) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, sessionId, method, params })) })
const value = async (expr) => (await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value ?? null

// MEASURED OFF RECTANGLES, never off a class name: a rule that is present and overridden and a rule that
// works look identical to a selector, and the whole subject here is which one is true.
const PROBE = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  window.scrollTo(0, 0); await sleep(60);
  const head = document.querySelector('.rep-stickyhead');
  const strip = document.querySelector('nav.strip');
  const label = document.querySelector('.ko-gauge .label');
  const pill = document.querySelector('.kpill');
  if (!head || !strip) return { drawn: false, head: !!head, strip: !!strip };
  const r = (el) => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, height: b.height }; };
  const out = {
    drawn: true,
    inside: head.contains(strip),
    labelled: (strip.textContent || '').replace(/\\s+/g, ' ').trim(),
    pill: pill ? r(pill) : null,
    label: label ? r(label) : null,
    pillText: pill ? (pill.textContent || '').trim() : null,
  };
  // Scroll well past the header and read again: what stays is what a reader keeps.
  window.scrollTo(0, 1200); await sleep(120);
  out.scrolled = { head: r(head), strip: r(strip), scrollY: window.scrollY };
  return out;
})()`

const fail = []
const ok = []
for (const band of BANDS) {
  await cmd('Page.navigate', { url: `${origin}/${band.toLowerCase()}.html` })
  await new Promise((r) => setTimeout(r, 700))
  const m = await value(PROBE)
  const where = `band ${band}`
  if (!m || !m.drawn) { fail.push(`${where}: the document drew no header or no breadcrumb (${JSON.stringify(m)})`); continue }

  // 1 — one header
  if (!m.inside) fail.push(`${where}: the breadcrumb is not inside .rep-stickyhead`)
  else ok.push(`${where}: breadcrumb inside the header — "${m.labelled}"`)

  const s = m.scrolled
  if (!(s.scrollY > 300)) fail.push(`${where}: the page did not scroll (scrollY ${s.scrollY}) — the pin was not tested`)
  else if (Math.abs(s.head.top) > 1) fail.push(`${where}: the header did not pin (top ${s.head.top.toFixed(1)} at scrollY ${s.scrollY})`)
  else if (s.strip.top < s.head.top - 1 || s.strip.bottom > s.head.bottom + 1)
    fail.push(`${where}: the breadcrumb left the header under scroll (strip ${s.strip.top.toFixed(1)}–${s.strip.bottom.toFixed(1)}, header ${s.head.top.toFixed(1)}–${s.head.bottom.toFixed(1)})`)
  else ok.push(`${where}: header pinned at 0 with the breadcrumb inside it at scrollY ${s.scrollY}`)

  // 2 — the band pill clears its heading
  if (!m.pill || !m.label) fail.push(`${where}: the band card drew no pill or no heading`)
  else if (m.pill.top < m.label.bottom)
    fail.push(`${where}: the "${m.pillText}" pill overlaps the heading by ${(m.label.bottom - m.pill.top).toFixed(1)}px`)
  else ok.push(`${where}: the "${m.pillText}" pill clears the heading by ${(m.pill.top - m.label.bottom).toFixed(1)}px`)
}

for (const line of ok) console.log(`  ok   ${line}`)
for (const line of fail) console.log(`  FAIL ${line}`)
try { ws.close() } catch { /* the browser is going anyway */ }
try { process.kill(-chrome.pid, 'SIGKILL') } catch { /* already gone */ }
server.close()
if (!keep) rmSync(dir, { recursive: true, force: true })
console.log(fail.length
  ? `\nreport-header-render-check: ${fail.length} measurement(s) failed.`
  : `\nreport-header-render-check: ${ok.length} measurements, all clear.`)
process.exit(fail.length ? 1 : 0)
