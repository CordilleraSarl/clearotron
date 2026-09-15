#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Ask AI on a report, pressed in a real browser, in the three states a reader actually meets.
//
//   node scripts/ask-ai-render-check.mjs [--keep] [--shots <dir>] [--width 1280]
//
// ── why a browser, and why a separate one ────────────────────────────────────────────────────────────
//
// The owner watched a lawyer press this button and give up on what opened. Nothing in portal-ui can ask
// what a press leaves a reader looking at: `node --test` with type stripping carries no DOM, so the
// source-text arms over Result.tsx can prove a string is in a file and no more. They cannot tell a menu
// that renders from one that renders behind a closed panel, and they cannot tell a link that carries the
// question from one that carries an empty `q=`.
//
// Separate from revisit-render-check.mjs, which drives the same screen: that one counts REQUESTS, and
// opening menus inside its measurement windows would change the number it exists to measure.
//
// ── the three states, and why the third is the one to get wrong ──────────────────────────────────────
//
//   connected        a menu — Ask Claude, Ask ChatGPT, a divider, Connect another AI
//   never connected  a panel — what to do once, Set it up, and "Already connected? Ask anyway"
//   no connector     nothing is drawn. A button that can do nothing is not a button.
//
// The server answers `aiConnected` as true, false, or NULL — null meaning the installation could not be
// asked. A null draws the panel, the same as false, and this check drives it as its own deck rather than
// trusting that they look alike: they render the same by a decision about which way to be wrong, and a
// deck that only ever saw `false` would go green on a build that crashed on null.
//
// MUST NOT run as a user with a virtual-memory ulimit (`ulimit -v`) — Chrome dumps core under one.

import { navigateOrRefuse } from './headless-page.mjs'   // Page.navigate returns an errorText, and nothing read it
import { reapOnExit } from "../shared/reap-on-exit.mjs";   // a detached group dies with this script
import { browserRun } from "../shared/browser-temp-root.mjs";
import { createServer } from 'node:http'
import { readFileSync, existsSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = join(HERE, '..', 'portal-ui', 'dist')
const keep = process.argv.includes('--keep')
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null
const WIDTH = process.argv.includes('--width') ? Number(process.argv[process.argv.indexOf('--width') + 1]) : 1280

if (!existsSync(join(DIST, 'index.html'))) {
  console.error(`no build at ${DIST} — run: npm run build:ui`)
  process.exit(2)
}
if (shotsDir) mkdirSync(shotsDir, { recursive: true })

// ── the fixture ─────────────────────────────────────────────────────────────────────────────────────
//
// One delivered clearance. The mark and the date are what the question is built from, so they are the
// two facts this file cares about — and the date is deliberately one whose ISO spelling and its readable
// form differ in both fields, so a formatter that printed the wrong part could not pass by coincidence.
//
// `productName` is resolved through the same expression portal-service.mjs evaluates, never typed: the
// sibling instruments' rule, and it holds here for the same reason.
const { reportIdentityFor } = await import('../driver/search-policy.mjs')

const KEY = 'acme'
const NAME = 'Acme'
const RUN_ID = 'tmpa-askai-1'
const MARK = 'VENZY'
const ISO_DATE = '2026-09-14'
const READABLE_DATE = '14 September'
const EXPECTED_QUESTION = `Brief me on the ${MARK} clearance from ${READABLE_DATE}.`

const PRODUCT = 'global-preliminary-search'
const RUN = {
  account: KEY, kind: 'clearance', state: 'delivered', band: 'Manageable', tone: 'low',
  bands: [{ label: 'Severe', tone: 'severe' }, { label: 'Medium', tone: 'medium' }, { label: 'Manageable', tone: 'low' }],
  marks: [], reportSchema: 2, held: false, report: `/portal/report/${RUN_ID}/`,
  step: null, stepN: null, stepTotal: null, reason: null, failedStage: null,
  pausedKind: null, resetsAt: null, startedAt: null, queuePos: null,
  projectKey: null, projectName: null, markName: MARK, title: MARK, date: ISO_DATE,
  product: PRODUCT, stageLabel: 'Depth 4', productName: reportIdentityFor(PRODUCT).identity, runId: RUN_ID,
}

// ── the decks ───────────────────────────────────────────────────────────────────────────────────────
//
// Only the mcp-access body varies. Everything else about the screen is held still, so a difference in
// what the button does is a difference in what the deployment answered and nothing else.
const WIRED = { url: 'https://clients-mcp.example/mcp', keyUrl: null, email: 'reader@example-firm.com' }
const DECKS = {
  connected:   { ...WIRED, enabled: true, stdio: null, aiConnected: true },
  neverBefore: { ...WIRED, enabled: true, stdio: null, aiConnected: false },
  cannotTell:  { ...WIRED, enabled: true, stdio: null, aiConnected: null },
  noConnector: { url: null, keyUrl: null, email: 'reader@example-firm.com', enabled: false, stdio: null, aiConnected: null },
  // A laptop install: no published door, but a local route. This reader must be offered the control —
  // it is the case the old panel stranded, because every address it could show was null.
  localOnly:   { url: null, keyUrl: null, email: 'reader@example-firm.com', enabled: false, aiConnected: true,
                 stdio: { command: 'node server.mjs', note: 'from this install', verify: 'it prints ready' } },
}
let deck = 'connected'

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' }
const json = (res, body) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }

const server = createServer((req, res) => {
  const p = new URL(req.url, 'http://localhost').pathname
  if (p === '/portal/api/me') return json(res, { email: 'reader@example-firm.com', permissions: { run: true, manage: false }, access: [{ kind: 'account', account: KEY }], accounts: [KEY], accountNames: { [KEY]: NAME }, allowance: null })
  if (p === '/portal/admin/roster') return json(res, { customers: [{ key: KEY, name: NAME }] })
  if (p === '/portal/admin/families') return json(res, { of: {}, names: {} })
  if (p === '/portal/api/runs') return json(res, { runs: [RUN] })
  if (p === '/portal/api/searches') return json(res, { account: KEY, products: [], recipes: [], read: { available: false, maxBrief: 0, note: null } })
  if (p === '/portal/api/mcp-access') return json(res, { ...DECKS[deck], offers: [] })
  if (/^\/portal\/api\/run\/[^/]+\/summary$/.test(p)) return json(res, { summary: [] })
  // A real document, because a 404 in the frame changes what Result draws around it. Its CONTENT is not
  // this file's subject — render-check.mjs owns the report's own layout.
  if (p.startsWith('/portal/report/')) {
    res.writeHead(200, { 'content-type': 'text/html' })
    return res.end(`<!doctype html><meta charset="utf-8"><title>report</title><body><h1>${MARK}</h1><p>fixture report.</p></body>`)
  }
  const base = p.split('?')[0]
  const file = base === '/' || (base.startsWith('/portal') && !base.includes('.')) ? '/index.html' : base.replace(/^\/portal/, '')
  const full = join(DIST, file)
  if (!existsSync(full)) { res.writeHead(404); res.end('no'); return }
  res.writeHead(200, { 'content-type': MIME[extname(full)] ?? 'application/octet-stream' })
  res.end(readFileSync(full))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`

// ── chrome ──────────────────────────────────────────────────────────────────────────────────────────

const { profile, env: chromeEnv, keep: keepRoot } = browserRun("ask-ai-check-")
if (keep) keepRoot()
const chrome = spawn('google-chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
  `--user-data-dir=${profile}`, `--window-size=${WIDTH},900`, '--remote-debugging-port=0', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'], detached: true, env: chromeEnv })
reapOnExit(chrome)

const wsUrl = await new Promise((resolve, reject) => {
  let devtools = ''
  const t = setTimeout(
    () => reject(new Error(`chrome did not report a devtools endpoint within 60s. Its stderr was:\n${devtools || '(nothing)'}`)),
    60000,
  )
  chrome.stderr.on('data', (c) => {
    devtools += c
    const m = devtools.match(/ws:\/\/[^\s]+/)
    if (m) { clearTimeout(t); resolve(m[0]) }
  })
})

const ws = new WebSocket(wsUrl)
let id = 0
const pending = new Map()
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data)
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
})
await new Promise((r) => ws.addEventListener('open', r))
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const { result: targets } = await send('Target.getTargets')
const page = targets.targetInfos.find((t) => t.type === 'page')
const { result: sess } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true })
const sessionId = sess.sessionId
const cmd = (method, params) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, sessionId, method, params })) })
const value = async (expr) => (await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value ?? null

// ── what is measured, in the page ───────────────────────────────────────────────────────────────────
//
// READ OFF THE RENDERED DOM, never off a class name. A menu item that exists behind `display:none` and
// one a reader can press look identical to a selector; `offsetParent` and a non-zero rect are what tell
// them apart, and that difference is the whole subject of this file.
//
// WINDOW.OPEN IS REPLACED, NOT FOLLOWED. Pressing Ask Claude opens claude.ai, which this browser has no
// route to (`--host-resolver-rules`) — and following it would leave the drive on a page that is not the
// one being measured. The stub records the href instead, so the assertion is about the link the button
// actually carries rather than about a string in the source.
const PROBE = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  window.__opened = [];
  if (!window.__openStubbed) { window.open = (href) => { window.__opened.push(href); return null; }; window.__openStubbed = true; }

  const visible = (el) => !!el && !!el.offsetParent && el.getBoundingClientRect().width > 0;
  const anchor = document.querySelector('[data-ask-ai]');
  const button = [...document.querySelectorAll('button')].find(b => /Ask AI/.test(b.textContent || ''));
  if (!button || !visible(button)) return { drawn: false, anchorState: anchor ? anchor.getAttribute('data-ask-ai') : null };

  button.click();
  await sleep(220);

  const float = document.querySelector('[data-ask-ai] .float');
  if (!float) return { drawn: true, opened: false, anchorState: anchor ? anchor.getAttribute('data-ask-ai') : null };

  const role = float.getAttribute('role');
  const items = [...float.querySelectorAll('button')].filter(visible).map(b => (b.textContent || '').trim());
  const text = (float.innerText || '').trim();
  const width = Math.round(float.getBoundingClientRect().width);
  // A divider is a one-pixel-high element between the assistants and the quiet item. Measured, not
  // matched by class: the mockup's separator is a rule, and a rule is a height.
  const seps = [...float.querySelectorAll('div')].filter(d => {
    const r = d.getBoundingClientRect();
    return r.height <= 2 && r.height > 0 && r.width > 40;
  }).length;

  return {
    drawn: true, opened: true, role, items, text, width, seps,
    anchorState: anchor ? anchor.getAttribute('data-ask-ai') : null,
    hasAddress: /mcp|https?:\\/\\//i.test(text),
    hasCopy: /copy/i.test(text),
  };
})()`

// PRESSING CLOSES THE MENU, which is correct and is why this re-opens it first: the second press found
// nothing, reported an empty href, and the assertion read as "ChatGPT was opened with nothing" — a true
// statement about a drive that never pressed anything.
const PRESS = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  if (!document.querySelector('[data-ask-ai] .float')) {
    const opener = [...document.querySelectorAll('button')].find(b => /Ask AI/.test(b.textContent || ''));
    if (!opener) return { fatal: 'the control is gone from the header' };
    opener.click();
    await sleep(220);
  }
  const float = document.querySelector('[data-ask-ai] .float');
  if (!float) return { fatal: 'nothing open to press' };
  const btn = [...float.querySelectorAll('button')].find(b => /__LABEL__/.test(b.textContent || ''));
  if (!btn) return { fatal: 'no such item: __LABEL__' };
  btn.click();
  await sleep(200);
  return { opened: window.__opened || [] };
})()`

const ASK_ANYWAY = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const float = document.querySelector('[data-ask-ai] .float');
  if (!float) return { fatal: 'no panel open' };
  const link = [...float.querySelectorAll('button')].find(b => /Ask anyway/.test(b.textContent || ''));
  if (!link) return { fatal: 'the panel carries no way past it' };
  link.click();
  await sleep(250);
  const after = document.querySelector('[data-ask-ai] .float');
  return {
    role: after ? after.getAttribute('role') : null,
    items: after ? [...after.querySelectorAll('button')].filter(b => !!b.offsetParent).map(b => (b.textContent || '').trim()) : [],
  };
})()`

const shoot = async (name) => {
  if (!shotsDir) return
  const shot = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  const data = shot.result?.result?.data ?? shot.result?.data
  if (data) writeFileSync(join(shotsDir, `${name}.png`), Buffer.from(data, 'base64'))
}

const visit = async () => {
  await navigateOrRefuse(cmd, `${origin}/portal/result/${RUN_ID}`, { what: 'ask-ai-render-check' })
  await new Promise((r) => setTimeout(r, 1400))
}

// ── the drive ───────────────────────────────────────────────────────────────────────────────────────

deck = 'connected';    await visit(); const connected = await value(PROBE); await shoot('ask-ai-menu')
const pressClaude  = await value(PRESS.replace('__LABEL__', 'Ask Claude'))
const pressChatGpt = await value(PRESS.replace('__LABEL__', 'Ask ChatGPT'))

deck = 'neverBefore';  await visit(); const never = await value(PROBE); await shoot('ask-ai-connect')
const anyway = await value(ASK_ANYWAY)

deck = 'cannotTell';   await visit(); const unknown = await value(PROBE)
deck = 'noConnector';  await visit(); const none = await value(PROBE)
deck = 'localOnly';    await visit(); const local = await value(PROBE)

try { process.kill(-chrome.pid, 'SIGKILL') }
catch { try { chrome.kill('SIGKILL') } catch { /* already gone */ } }
server.close()
await new Promise((r) => setTimeout(r, 400))
if (!keep) { try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* a stray profile dir is not a result */ } }

// ── verdict ─────────────────────────────────────────────────────────────────────────────────────────

const fail = []
const ok = (cond, msg) => { if (!cond) fail.push(msg) }
const show = (o) => JSON.stringify(o)

// A FLOOR FIRST. Every assertion below reads a field off one of these objects, and a deck that failed to
// render returns null — which would make `!x.hasAddress` true and half of this file pass on a blank page.
for (const [name, r] of [['connected', connected], ['never connected', never], ['could not tell', unknown], ['no connector', none], ['local only', local]]) {
  ok(r && typeof r === 'object', `the ${name} deck measured nothing at all — the screen did not render`)
}
if (fail.length) { for (const f of fail) console.error(`  ✗ ${f}`); console.error('ask-ai-render-check: the drive did not reach the screen'); process.exit(1) }

// ── connected: the menu ──
ok(connected.drawn && connected.opened, `connected: the button did not open anything — ${show(connected)}`)
ok(connected.role === 'menu', `connected: the float is role="${connected.role}", not a menu`)
ok(connected.anchorState === 'menu', `connected: the control reports state "${connected.anchorState}"`)
ok(connected.items.length === 3, `connected: ${connected.items.length} item(s), expected three — ${show(connected.items)}`)
ok(connected.items[0] === 'Ask Claude' && connected.items[1] === 'Ask ChatGPT',
  `connected: the two assistants are not the first two items — ${show(connected.items)}`)
ok(connected.items[2] === 'Connect another AI', `connected: the quiet item reads ${show(connected.items[2])}`)
ok(connected.seps >= 1, 'connected: no divider between the assistants and the quiet item')
ok(connected.width >= 200 && connected.width <= 280, `connected: the menu is ${connected.width}px wide; the design is 236`)

// ── connected: what a press actually opens ──
//
// THE QUESTION HAS TO BE IN THE LINK, not merely in the source. This is the assertion the whole change
// is for: a press that opened claude.ai with an empty `q=` would look identical on screen.
const claudeHref = (pressClaude?.opened ?? []).at(-1) ?? ''
const chatHref = (pressChatGpt?.opened ?? []).at(-1) ?? ''
ok(claudeHref.startsWith('https://claude.ai/new?q='), `Ask Claude opened ${show(claudeHref)}`)
ok(chatHref.startsWith('https://chatgpt.com/?q='), `Ask ChatGPT opened ${show(chatHref)}`)
for (const [who, href] of [['Claude', claudeHref], ['ChatGPT', chatHref]]) {
  const q = (() => { try { return new URL(href).searchParams.get('q') ?? '' } catch { return '' } })()
  ok(q === EXPECTED_QUESTION, `${who} was opened with ${show(q)}, not ${show(EXPECTED_QUESTION)}`)
  ok(!/noref|tmpa-|run /i.test(q), `${who}'s question carries a run identifier: ${show(q)}`)
}

// ── never connected: the panel ──
ok(never.drawn && never.opened, `never connected: the button did not open anything — ${show(never)}`)
ok(never.role === 'dialog', `never connected: the float is role="${never.role}", not a dialog`)
ok(never.anchorState === 'connect', `never connected: the control reports state "${never.anchorState}"`)
ok(/Connect your AI first/.test(never.text), `never connected: the panel does not say what it is — ${show(never.text)}`)
ok(/Connect Claude or ChatGPT once/.test(never.text), 'never connected: the explaining line is missing')
ok(never.items.some((t) => /^Set it up/.test(t)), `never connected: no Set it up — ${show(never.items)}`)
ok(never.items.some((t) => /Already connected\? Ask anyway/.test(t)), `never connected: no way past it — ${show(never.items)}`)
ok(!never.items.some((t) => /^Ask Claude$|^Ask ChatGPT$/.test(t)),
  `never connected: the assistants are on the panel, so the setup step is decoration — ${show(never.items)}`)
ok(never.width >= 240 && never.width <= 320, `never connected: the panel is ${never.width}px wide; the design is 276`)

// ── the way past a measurement that is behind ──
ok(anyway?.role === 'menu', `"Ask anyway" left the reader on role="${anyway?.role}" — ${show(anyway)}`)
ok((anyway?.items ?? []).includes('Ask Claude'), `"Ask anyway" did not reach the assistants — ${show(anyway?.items)}`)

// ── could not tell: the third state renders, and renders as the panel ──
//
// DRIVEN AS ITS OWN DECK. It reaching the same screen as `false` is a decision about which way to be
// wrong, not an identity — and a build that threw on a null would fail here and nowhere else.
ok(unknown.drawn && unknown.opened, `could not tell: nothing opened — ${show(unknown)}`)
ok(unknown.role === 'dialog', `could not tell: a null was rendered as role="${unknown.role}", so an unmeasured reader was handed the menu`)
ok(/Connect your AI first/.test(unknown.text), 'could not tell: the panel did not draw')

// ── no connector: nothing is drawn ──
ok(none.drawn === false, `no connector: a button was drawn that can do nothing — ${show(none)}`)

// ── a laptop install: a local route IS a connector ──
ok(local.drawn && local.opened, `local only: the case the old panel stranded is stranded again — ${show(local)}`)
ok(local.role === 'menu', `local only: role="${local.role}"`)

// ── NO ADDRESS AND NO COPY LINK, in any state that draws ──
for (const [name, r] of [['connected', connected], ['never connected', never], ['could not tell', unknown], ['local only', local]]) {
  ok(!r.hasAddress, `${name}: a connector address is on the report again — ${show(r.text)}`)
  ok(!r.hasCopy, `${name}: a Copy link is back on the report — ${show(r.text)}`)
}

if (fail.length) {
  for (const f of fail) console.error(`  ✗ ${f}`)
  console.error(`ask-ai-render-check: ${fail.length} thing(s) a reader would meet`)
  process.exit(1)
}
console.log(`ask-ai-render-check: the menu, the panel and the unmeasured state all render; both links carry ${JSON.stringify(EXPECTED_QUESTION)}; no button where there is no connector`)
if (shotsDir) console.log(`ask-ai-render-check: shots in ${shotsDir}`)
