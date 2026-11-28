#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Can someone who curates Clearances retire an order refused before any run, and find it again under Retired?
//   node scripts/retire-order-render-check.mjs [--shots <dir>]
// The refused order's row in Clearances carries the row menu a search row has, with one item, "Retire this order…".
// It opens the confirm dialog in the order's own words, and confirming sends the order's reference to the retire
// action. The Retired tab then lists the order, with Restore. The portal-ui suite has no DOM, so this serves the REAL
// built bundle to a REAL browser against a stub of the portal's answers, and reads what the page says.
// With --shots, the menu, the dialog and the Retired tab are captured at 1280 px in both themes.
// MUST NOT run as a user with a virtual-memory ulimit (`ulimit -v`) — Chrome dumps core under one.
import { createServer } from 'node:http'
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { reapOnExit } from '../shared/reap-on-exit.mjs'   // — a detached group dies with this script
import { browserRun } from '../shared/browser-temp-root.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = join(HERE, '..', 'portal-ui', 'dist')
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null
if (!existsSync(join(DIST, 'index.html'))) { console.error('retire-order-render-check: no built bundle — run `npm run build:ui` first'); process.exit(2) }
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' }

const REF = 'ORDER-7@0123456789ab'
// Someone who curates the list: sees every company and may manage.
const ME = { permissions: { run: true, manage: true }, email: 'staff@example.test', accounts: '*',
  access: [{ kind: 'company', key: 'coastline', name: 'Coastline', org: 'coastline-org' }], organisations: [{ key: 'coastline-org', name: 'Coastline' }],
  accountOrgs: { coastline: 'coastline-org' } }
const ORDER = { reference: REF, state: 'refused', reasonKind: 'run-cap', account: 'coastline', markName: 'PREVENA', updatedAt: '2026-11-27T09:14:00Z' }
const DELIVERED = { account: 'coastline', kind: 'clearance', state: 'delivered', band: 'Manageable', tone: 'low',
  bands: [{ label: 'Severe', tone: 'severe' }, { label: 'Manageable', tone: 'low' }], marks: [], reportSchema: 2, held: false, report: 'report.html',
  step: null, stepN: null, stepTotal: null, reason: null, failedStage: null, pausedKind: null, resetsAt: null, startedAt: null, queuePos: null,
  projectKey: null, projectName: null, markName: 'HARBOURLIGHT', title: 'HARBOURLIGHT', date: '2026-11-27', issuedAt: '2026-11-27T09:17:00Z',
  product: 'global-preliminary-search', productName: null, runId: 'between-1' }

let retired = false
const writes = []
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const path = url.pathname
  const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
  if (path === '/portal/api/me') return json(200, ME)
  if (path === '/portal/api/runs') return json(200, { account: '*', runs: [DELIVERED], orders: retired ? [] : [ORDER] })
  if (path === '/portal/admin/retired' && req.method === 'POST') {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => { const b = JSON.parse(body || '{}'); writes.push(b); retired = b.action !== 'restore'; json(200, { retired, runs: 1, archived: retired ? 1 : 0 }) })
    return
  }
  if (path === '/portal/admin/retired') return json(200, { account: '*', runs: [], orders: retired ? [{ ...ORDER, retired: true }] : [] })
  if (path === '/portal/admin/families') return json(200, { families: [] })
  if (path.startsWith('/portal/api/') || path.startsWith('/portal/admin/')) return json(200, {})
  const file = path.startsWith('/portal') && !path.includes('.') ? '/index.html' : path.replace(/^\/portal/, '')
  const full = join(DIST, file)
  if (!existsSync(full)) { res.writeHead(404); res.end('no'); return }
  res.writeHead(200, { 'content-type': MIME[extname(full)] ?? 'application/octet-stream' })
  res.end(readFileSync(full))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`

const { profile: userDir, env: chromeEnv } = browserRun('retire-order-check-')
const chrome = spawn('google-chrome', ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--user-data-dir=${userDir}`, '--window-size=1280,900', '--remote-debugging-port=0', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: chromeEnv })
reapOnExit(chrome)
let said = ''
const wsUrl = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`chrome did not report a devtools endpoint within 60s:\n${said || '(nothing)'}`)), 60000)
  chrome.stderr.setEncoding('utf8')
  chrome.stderr.on('data', (c) => { said += c; const m = said.match(/ws:\/\/[^\s]+/); if (m) { clearTimeout(t); resolve(m[0]) } })
})
const ws = new WebSocket(wsUrl)
let id = 0
const pending = new Map()
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
await new Promise((r) => ws.addEventListener('open', r))
const send = (method, params = {}, sessionId) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })) })
const { result: targets } = await send('Target.getTargets')
const page = targets.targetInfos.find((t) => t.type === 'page')
const { result: sess } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true })
const cdp = (method, params = {}) => send(method, params, sess.sessionId)
const text = async () => (await cdp('Runtime.evaluate', { expression: 'document.querySelector(".screen")?.innerText ?? ""', returnByValue: true })).result?.result?.value ?? ''
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const page_text = async (sel) => (await cdp('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(sel)})?.innerText ?? ""`, returnByValue: true })).result?.result?.value ?? ''
const click = async (expr) => (await cdp('Runtime.evaluate', { expression: `(() => { const el = ${expr}; if (!el) return false; el.click(); return true })()`, returnByValue: true })).result?.result?.value === true
async function until(re, sel = 'body', waitMs = 8000) {
  const t0 = Date.now()
  let t = ''
  while (Date.now() - t0 < waitMs) { t = await page_text(sel); if (re.test(t)) return t; await sleep(200) }
  return t
}
async function capture(name) {
  if (!shots) return
  mkdirSync(shots, { recursive: true })
  for (const theme of ['light', 'dark']) {
    await cdp('Runtime.evaluate', { expression: theme === 'dark' ? "document.documentElement.setAttribute('data-theme','dark')" : "document.documentElement.removeAttribute('data-theme')" })
    await sleep(400)
    const s = await cdp('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(shots, `retire-order-${name}-${theme}.png`), Buffer.from(s.result.data, 'base64'))
  }
  await cdp('Runtime.evaluate', { expression: "document.documentElement.removeAttribute('data-theme')" })
}
const failures = []
const expect = (name, t, ...res) => { for (const re of res) if (!re.test(t)) failures.push(`${name}: the page does not say ${re} — it says ${JSON.stringify(t.slice(0, 400))}`) }

await cdp('Page.enable')
// The viewport is set once, before anything opens: a resize closes an open menu or dialog, so a shot that resized first
// would picture the list without what it was taken for.
await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false })
await cdp('Page.navigate', { url: `${origin}/portal/clearances` })
let t = await until(/Order did not start/)
expect('clearances', t, /PREVENA/, /Order did not start/)
// The refused order's row menu: the row that names PREVENA, its menu button.
const ROW = `[...document.querySelectorAll('tr')].find((r) => /Order did not start/.test(r.innerText) && /PREVENA/.test(r.innerText))`
if (!(await click(`${ROW}?.querySelector('.row-menu-btn')`))) failures.push('the refused order row has no row menu')
t = await until(/Retire this order/)
expect('menu', t, /Retire this order…/)
await capture('menu')
if (!(await click(`[...document.querySelectorAll('[role=menuitem]')].find((b) => /Retire this order/.test(b.innerText))`))) failures.push('no "Retire this order…" item to choose')
t = await until(/Retire this order\?/, '[role=dialog]')
expect('dialog', t, /Retire this order\?/, /The order for PREVENA · 2026-11-27 did not start\./, /It will move to Retired for everyone\./,
  /Its receipt stays at its link\./, /You can restore it there\./, /Retire order/)
await capture('dialog')
if (!(await click(`[...document.querySelectorAll('[role=dialog] button')].find((b) => /^Retire order$/.test(b.innerText.trim()))`))) failures.push('no "Retire order" button')
await sleep(800)
if (!writes.some((w) => w.action === 'retire' && Array.isArray(w.runIds) && w.runIds[0] === REF)) failures.push(`the retire action was not sent the order's reference: ${JSON.stringify(writes)}`)
t = await until(/Moved 1 order to Retired/)
expect('after retire', t, /Moved 1 order to Retired\./)
if (!(await click(`[...document.querySelectorAll('button, [role=tab]')].find((b) => /^Retired/.test(b.innerText.trim()))`))) failures.push('no Retired tab')
t = await until(/Restore/)
expect('retired tab', t, /PREVENA/, /Order did not start/, /Restore/)
await capture('retired')
if (!(await click(`[...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Restore')`))) failures.push('no Restore button')
t = await until(/Restored the order for PREVENA/)
expect('restore', t, /Restored the order for PREVENA\./)
if (!writes.some((w) => w.action === 'restore' && w.runIds?.[0] === REF)) failures.push('restore was not sent the order\'s reference')

ws.close()
server.close()
if (failures.length) { for (const f of failures) console.error(`retire-order-render-check: ${f}`); process.exit(1) }
console.log('retire-order-render-check: the refused order retires from its own row menu, in its own words, and comes back from Retired')
process.exit(0)
