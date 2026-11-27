// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Does an order's RECEIPT render each state it can be in, from its own address?
//
//   node scripts/order-receipt-render-check.mjs [--shots <dir>]
//
// The receipt follows an accepted order by the reference Start returned (portal-ui/src/screens/OrderReceipt.tsx). The
// reading behind it is driven in portal-ui's tests; that suite has no DOM, so this serves the REAL built bundle to a REAL
// browser against a stub of the order lookup, opens /portal/orders/<reference>?account=<company> once per state, and
// reads what the page says:
//   waiting       the queued wording, until a start or a refusal is confirmed
//   started       "Order started", with the way to the clearance
//   refused       "Order did not start", the reference on its own line, and each kind's sentence
//   unchecked     a look that failed after one that answered: the last state stays, with the retry line
//   missing       a reference this reader may not see reads as an address nobody serves
// And Clearances: an order being checked and one refused before any run are rows of their own, and the refused one's row
// opens its receipt.
// With --shots, each state is also captured at 1280 px in both themes, for a reader to compare with the design.
//
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
if (!existsSync(join(DIST, 'index.html'))) { console.error('order-receipt-render-check: no built bundle — run `npm run build:ui` first'); process.exit(2) }
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' }

const REF = 'ORDER-7@0123456789ab'
const ME = { permissions: { run: true, manage: false }, email: 'demo@example.test', accounts: ['coastline'], allAccounts: false,
  access: [{ kind: 'company', key: 'coastline', name: 'Coastline', org: 'coastline-org' }], organisations: [{ key: 'coastline-org', name: 'Coastline' }],
  accountOrgs: { coastline: 'coastline-org' } }

/** What the order lookup answers, by look: each state is a list, the last entry repeating. */
let answers = []
let looks = 0
const ORDERS = [
  { reference: REF, state: 'refused', reasonKind: 'run-cap', account: 'coastline', markName: 'PREVENA', updatedAt: '2026-11-27T09:14:00Z' },
  { reference: 'ORDER-8@0123456789ab', state: 'checking', reasonKind: null, account: 'coastline', markName: 'TALLOWMERE', updatedAt: '2026-11-27T09:20:00Z' },
]
const receipt = (b) => ({ status: 200, body: { reference: REF, terminal: false, runId: null, reason: null, reasonKind: null, updatedAt: '2026-11-27T09:14:00Z', ...b } })

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const path = url.pathname
  const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
  if (path === '/portal/api/me') return json(200, ME)
  if (path === '/portal/api/runs') return json(200, { account: '*', runs: [], orders: ORDERS })
  if (path.startsWith('/portal/api/orders/')) {
    const a = answers[Math.min(looks, answers.length - 1)]
    looks++
    return json(a.status, a.body)
  }
  if (path.startsWith('/portal/api/')) return json(200, {})
  const file = path.startsWith('/portal') && !path.includes('.') ? '/index.html' : path.replace(/^\/portal/, '')
  const full = join(DIST, file)
  if (!existsSync(full)) { res.writeHead(404); res.end('no'); return }
  res.writeHead(200, { 'content-type': MIME[extname(full)] ?? 'application/octet-stream' })
  res.end(readFileSync(full))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`

const { profile: userDir, env: chromeEnv } = browserRun('order-receipt-check-')
const chrome = spawn('google-chrome', ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--user-data-dir=${userDir}`, '--window-size=1280,900', '--remote-debugging-port=0', 'about:blank'],
{ stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: chromeEnv })
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

/** Open the receipt address on a fresh look count, and wait until the page says `until`. */
async function open(state, until, waitMs = 8000) {
  answers = state
  looks = 0
  await cdp('Page.navigate', { url: `${origin}/portal/orders/${encodeURIComponent(REF)}?account=coastline` })
  const t0 = Date.now()
  let t = ''
  while (Date.now() - t0 < waitMs) { t = await text(); if (until.test(t)) return t; await sleep(200) }
  return t
}

async function capture(name) {
  if (!shots) return
  mkdirSync(shots, { recursive: true })
  // The portal's theme is the attribute its own Theme control sets, not the browser's colour scheme.
  for (const theme of ['light', 'dark']) {
    await cdp('Runtime.evaluate', { expression: theme === 'dark' ? "document.documentElement.setAttribute('data-theme','dark')" : "document.documentElement.removeAttribute('data-theme')" })
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false })
    await sleep(400)
    const s = await cdp('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(shots, `receipt-${name}-${theme}.png`), Buffer.from(s.result.data, 'base64'))
  }
  await cdp('Runtime.evaluate', { expression: "document.documentElement.removeAttribute('data-theme')" })
}

const failures = []
const expect = (name, t, ...res) => { for (const re of res) if (!re.test(t)) failures.push(`${name}: the page does not say ${re} — it says ${JSON.stringify(t.slice(0, 300))}`) }
const never = (name, t, ...res) => { for (const re of res) if (re.test(t)) failures.push(`${name}: the page says ${re}, which it must not`) }

await cdp('Page.enable')
let t = await open([receipt({ state: 'waiting' })], /Clearance queued/)
expect('waiting', t, /Clearance queued/, /View in Clearances/)
never('waiting', t, /did not start|Order started/)
await capture('waiting')

t = await open([receipt({ state: 'running', runId: 'tmp7-coastline-2026-11-27-quiet-heron' })], /Order started/)
expect('started', t, /Order started/, /View clearance/)
await capture('started')

const KINDS = {
  'run-cap': /Your account has reached its search limit\./,
  details: /More information is needed before this search can start\./,
  policy: /This search falls outside the rules set for your account\./,
  setup: /This installation needs attention before the search can start\./,
  duplicate: /This order was flagged as a duplicate\./,
  other: /Contact your administrator and give them this order reference\./,
}
for (const [kind, sentence] of Object.entries(KINDS)) {
  t = await open([receipt({ state: 'refused', terminal: true, reasonKind: kind })], /Order did not start/)
  expect(`refused/${kind}`, t, /Order did not start/, sentence, new RegExp(`Order reference: ${REF.replace(/[.@]/g, '\\$&')}`))
  if (kind === 'setup') expect('refused/setup', t, KINDS.other)
  if (kind === 'run-cap') await capture('refused-run-cap')
  if (kind === 'other') await capture('refused-other')
}

// A look that answered, then one that failed: the confirmed state stays, and the retry line appears.
t = await open([receipt({ state: 'waiting' }), { status: 503, body: { error: 'could_not_look' } }], /couldn’t check/, 12000)
expect('unchecked', t, /Clearance queued/, /We couldn’t check this order just now\. We’ll try again\./)
never('unchecked', t, /did not start|That page does not exist/)
await capture('unchecked')

t = await open([{ status: 404, body: { error: 'not_found' } }], /That page does not exist/)
expect('missing', t, /That page does not exist\./)
never('missing', t, /Order reference|did not start/)

// Clearances: both orders are rows; the refused one opens its receipt.
answers = [receipt({ state: 'refused', terminal: true, reasonKind: 'run-cap' })]
looks = 0
await cdp('Page.navigate', { url: `${origin}/portal/clearances` })
{
  const t0 = Date.now()
  while (Date.now() - t0 < 8000 && !/TALLOWMERE/.test(await text())) await sleep(200)
  t = await text()
  expect('clearances', t, /PREVENA/, /TALLOWMERE/, /Order did not start/, /Waiting to start/, /2 names/)
  await capture('clearances')
  await cdp('Runtime.evaluate', { expression: `[...document.querySelectorAll('tr.read-row')].find((r) => /PREVENA/.test(r.innerText))?.click(); 'ok'` })
  const t1 = Date.now()
  while (Date.now() - t1 < 8000 && !/Order reference/.test(await text())) await sleep(200)
  t = await text()
  expect('clearances → receipt', t, /Order did not start/, /Your account has reached its search limit\./, new RegExp(`Order reference: ${REF.replace(/[.@]/g, '\\$&')}`))
}

ws.close()
server.close()
if (failures.length) { console.error(`order-receipt-render-check: ${failures.length} state(s) wrong:\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log(`order-receipt-render-check: every state rendered as the receipt says it should${shots ? `; pictures in ${shots}` : ''}`)
process.exit(0)
