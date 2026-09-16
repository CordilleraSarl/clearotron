#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Ask AI on a report, pressed in a real browser, in the states a reader actually meets.
//
//   node scripts/ask-ai-render-check.mjs [--keep] [--shot-dir <dir>] [--width 1280]
//
// ── why a browser, and why a separate one ────────────────────────────────────────────────────────────
//
// The owner watched a lawyer press this button and give up on what opened. Nothing in portal-ui can ask
// what a press leaves a reader looking at: `node --test` with type stripping carries no DOM, so the
// source-text arms over the control can prove a string is in a file and no more. They cannot tell a
// panel that renders from one that renders behind a closed one, and they cannot tell a link that carries
// the selected question from one that carries the first question whatever was selected.
//
// Separate from revisit-render-check.mjs, which drives the same screen: that one counts REQUESTS, and
// opening panels inside its measurement windows would change the number it exists to measure.
//
// ── the states, and why the third is the one to get wrong ────────────────────────────────────────────
//
//   connected        a panel — the report's name, four questions, "Open in Claude", and a line saying
//                    the question is typed in and not sent
//   never connected  a panel — what to do once, Set it up, and "Already connected? Ask anyway"
//   no connector     nothing is drawn. A button that can do nothing is not a button.
//
// The server answers `aiConnected` as true, false, or NULL — null meaning the installation could not be
// asked. A null draws the connect panel, the same as false, and this check drives it as its own deck
// rather than trusting that they look alike: they render the same by a decision about which way to be
// wrong, and a deck that only ever saw `false` would go green on a build that crashed on null.
//
// ── and the way back ─────────────────────────────────────────────────────────────────────────────────
//
// "Set it up" remembers the report and opens Connect your AI marked as reached from a report. Once the
// reader is connected, that page offers "Continue with <mark>", which must land on the report with the
// panel already open in its connected form. Both halves are pressed here, in one browser, because the
// note lives in that browser's storage and nowhere else.
//
// With --shot-dir, the two panels a reader meets are captured in light and dark, at the page's full
// height (a beyond-viewport capture paints the sticky header where the viewport put it).
//
// MUST NOT run as a user with a virtual-memory ulimit (`ulimit -v`) — Chrome dumps core under one.

import { navigateOrRefuse } from './headless-page.mjs'   // Page.navigate returns an errorText, and nothing read it
import { reapOnExit } from "../shared/reap-on-exit.mjs";   // a detached group dies with this script
import { browserRun } from "../shared/browser-temp-root.mjs";
import { connectOffers, offersForWire } from '../shared/connect-clients.mjs'
import { createServer } from 'node:http'
import { readFileSync, existsSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = join(HERE, '..', 'portal-ui', 'dist')
const keep = process.argv.includes('--keep')
const argValue = (flag) => (process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : null)
// `--shots` is the older spelling, kept so a command someone already has keeps working.
const shotsDir = argValue('--shot-dir') ?? argValue('--shots')
const WIDTH = process.argv.includes('--width') ? Number(argValue('--width')) : 1280

if (!existsSync(join(DIST, 'index.html'))) {
  console.error(`no build at ${DIST} — run: npm run build:ui`)
  process.exit(2)
}
if (shotsDir) mkdirSync(shotsDir, { recursive: true })

// ── the fixture ─────────────────────────────────────────────────────────────────────────────────────
//
// One delivered clearance. The mark and the date are what the questions are built from, so they are the
// facts this file cares about — and the date is deliberately one whose ISO spelling and its readable
// form differ in both fields, so a formatter that printed the wrong part could not pass by coincidence.
//
// THE ISSUE STAMP IS 22:30 UTC ON THE 14TH, which is already the 15th in Zurich, where the report's own
// Issued stamp is written. A header that sliced the UTC stamp would print the searched date twice; the
// right one prints two different days.
//
// `productName` is resolved through the same expression portal-service.mjs evaluates, never typed: the
// sibling instruments' rule, and it holds here for the same reason.
const { reportIdentityFor } = await import('../driver/search-policy.mjs')

const KEY = 'acme'
const NAME = 'Acme'
const RUN_ID = 'tmpa-askai-1'
const MARK = 'VENZY'
const ISO_DATE = '2026-09-14'
const ISSUED_AT = '2026-09-14T22:30:00.000Z'
const ISSUED_DAY = '2026-09-15'
const READABLE_DATE = '14 September'
const REPORT = `the ${MARK} clearance from ${READABLE_DATE}`
// The four questions as a reader's assistant receives them — the rows' words are shorter, because the
// panel's first line already names the report.
const QUESTIONS = [
  { label: 'Brief me on this clearance', typed: `Brief me on ${REPORT}.` },
  { label: 'Explain the main risks', typed: `Explain the main risks in ${REPORT}.` },
  { label: 'What needs further investigation?', typed: `What needs further investigation in ${REPORT}?` },
  { label: 'How would narrower goods change the assessment?', typed: `How would narrower goods change the assessment in ${REPORT}?` },
]

const PRODUCT = 'global-preliminary-search'
const PRODUCT_NAME = reportIdentityFor(PRODUCT).identity
const RUN = {
  account: KEY, kind: 'clearance', state: 'delivered', band: 'Manageable', tone: 'low',
  bands: [{ label: 'Severe', tone: 'severe' }, { label: 'Medium', tone: 'medium' }, { label: 'Manageable', tone: 'low' }],
  marks: [], reportSchema: 2, held: false, report: `/portal/report/${RUN_ID}/`,
  step: null, stepN: null, stepTotal: null, reason: null, failedStage: null,
  pausedKind: null, resetsAt: null, startedAt: null, queuePos: null,
  projectKey: null, projectName: null, markName: MARK, title: MARK, date: ISO_DATE, issuedAt: ISSUED_AT,
  product: PRODUCT, stageLabel: 'Depth 4', productName: PRODUCT_NAME, runId: RUN_ID,
}

// ── the decks ───────────────────────────────────────────────────────────────────────────────────────
//
// Only the mcp-access body varies. Everything else about the screen is held still, so a difference in
// what the button does is a difference in what the deployment answered and nothing else. The offers are
// composed through the one table, as the route composes them, because Connect your AI renders them when
// "Set it up" and "Continue" cross to it.
const WIRED = { url: 'https://clients-mcp.example/mcp', keyUrl: null, email: 'reader@example-firm.com' }
const offersAt = (url) => offersForWire(connectOffers({ stdioRoutes: {}, publicAddress: url, operator: WIRED.email, door: url ? 'sign-in' : null }))
const DECKS = {
  connected:   { ...WIRED, enabled: true, stdio: null, aiConnected: true, offers: offersAt(WIRED.url) },
  neverBefore: { ...WIRED, enabled: true, stdio: null, aiConnected: false, offers: offersAt(WIRED.url) },
  cannotTell:  { ...WIRED, enabled: true, stdio: null, aiConnected: null, offers: offersAt(WIRED.url) },
  noConnector: { url: null, keyUrl: null, email: 'reader@example-firm.com', enabled: false, stdio: null, aiConnected: null, offers: [] },
  // A laptop install: no published door, but a local route. This reader must be offered the control —
  // it is the case the old panel stranded, because every address it could show was null.
  localOnly:   { url: null, keyUrl: null, email: 'reader@example-firm.com', enabled: false, aiConnected: true, offers: [],
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
  if (p === '/portal/api/mcp-access') return json(res, DECKS[deck])
  if (/^\/portal\/api\/run\/[^/]+\/summary$/.test(p)) return json(res, { summary: [] })
  // A real document, because a 404 in the frame changes what Result draws around it. Its CONTENT is not
  // this file's subject — render-check.mjs owns the report's own layout. It announces the commands and
  // the height a published report's bridge announces, so the header draws the Export menu a reader meets.
  if (p.startsWith('/portal/report/')) {
    res.writeHead(200, { 'content-type': 'text/html' })
    return res.end(`<!doctype html><meta charset="utf-8"><title>report</title>
<body style="margin:0;font-family:sans-serif;background:#fff"><div style="padding:32px"><h1>${MARK}</h1><p>fixture report.</p></div>
<script>
  parent.postMessage({ source: 'cordillera-report', type: 'controls', commands: ['exportPDF', 'pickAll', 'openAll'] }, '*');
  parent.postMessage({ source: 'cordillera-report', type: 'height', height: 640 }, '*');
</script></body>`)
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
// READ OFF THE RENDERED DOM, never off a class name alone. A row that exists behind `display:none` and
// one a reader can press look identical to a selector; `offsetParent` and a non-zero rect are what tell
// them apart, and that difference is the whole subject of this file.
//
// WINDOW.OPEN IS REPLACED, NOT FOLLOWED. Pressing "Open in Claude" opens claude.ai, which this browser
// has no route to (`--host-resolver-rules`) — and following it would leave the drive on a page that is
// not the one being measured. The stub records the href instead, so the assertion is about the link the
// button actually carries rather than about a string in the source.
const PROBE = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const flat = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  window.__opened = [];
  if (!window.__openStubbed) { window.open = (href) => { window.__opened.push(href); return null; }; window.__openStubbed = true; }

  const visible = (el) => !!el && !!el.offsetParent && el.getBoundingClientRect().width > 0;
  const anchor = document.querySelector('[data-ask-ai]');
  const button = anchor ? anchor.querySelector(':scope > button') : null;
  if (!button || !visible(button)) return { drawn: false, anchorState: anchor ? anchor.getAttribute('data-ask-ai') : null };

  const openOnArrival = !!anchor.querySelector('.float');
  if (!openOnArrival) { button.click(); await sleep(220); }

  const float = anchor.querySelector('.float');
  if (!float) return { drawn: true, opened: false, anchorState: anchor.getAttribute('data-ask-ai') };

  const b = button.getBoundingClientRect();
  const f = float.getBoundingClientRect();
  const text = (float.innerText || '').trim();
  return {
    drawn: true, opened: true, openOnArrival,
    role: float.getAttribute('role'), label: float.getAttribute('aria-label'),
    anchorState: anchor.getAttribute('data-ask-ai'),
    buttonText: flat(button.textContent), buttonAria: button.getAttribute('aria-label'),
    head: flat(float.querySelector('.ask-ai-head') ? float.querySelector('.ask-ai-head').textContent : ''),
    group: float.querySelector('[role="radiogroup"]') ? float.querySelector('[role="radiogroup"]').getAttribute('aria-label') : null,
    radios: [...float.querySelectorAll('[role="radio"]')].filter(visible).map(r => ({ text: flat(r.textContent), checked: r.getAttribute('aria-checked') })),
    primary: float.querySelector('.btn-primary') ? flat(float.querySelector('.btn-primary').textContent) : null,
    note: flat(float.querySelector('.ask-ai-note') ? float.querySelector('.ask-ai-note').textContent : ''),
    items: [...float.querySelectorAll('button')].filter(visible).map(x => flat(x.textContent)),
    text, width: Math.round(f.width),
    rightAligned: Math.abs(Math.round(f.right) - Math.round(b.right)) <= 1,
    below: f.top >= b.bottom - 1,
    hasAddress: /mcp|https?:\\/\\//i.test(text),
    hasCopy: /copy/i.test(text),
  };
})()`

// THE HEADER A READER READS ABOVE THE REPORT: the breadcrumb, the labelled line, the actions in order, and
// the top bar, which names no company on a report.
const HEADER = `(() => {
  const flat = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const head = document.querySelector('.report-head');
  const h1 = head ? head.querySelector('h1') : null;
  const line = h1 ? h1.nextElementSibling : null;
  const crumbs = document.querySelector('.report-crumbs');
  return {
    mark: h1 ? flat(h1.textContent) : null,
    line: line ? flat(line.textContent) : null,
    crumbs: crumbs ? [...crumbs.children].map(c => flat(c.textContent)) : [],
    actions: head ? [...head.querySelectorAll(':scope button, :scope a')].filter(x => !x.closest('.float')).map(x => flat(x.textContent)).filter(Boolean) : [],
    actionKinds: head ? [...head.querySelectorAll('[data-ask-ai] > button, .report-action')].map(x => x.className) : [],
    topbar: flat(document.querySelector('.topbar h1') ? document.querySelector('.topbar h1').textContent : ''),
    followUp: /Ask a follow-up/i.test(document.body.innerText || ''),
  };
})()`

// ONE QUESTION, CHOSEN AND SENT TO THE ASSISTANT: the row is pressed, the choice is read back, and the
// button is pressed. PRESSING CLOSES THE PANEL, which is correct and is why this re-opens it first.
const ASK = (index) => `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  let float = document.querySelector('[data-ask-ai] .float');
  if (!float) {
    const opener = document.querySelector('[data-ask-ai] > button');
    if (!opener) return { fatal: 'the control is gone from the header' };
    opener.click();
    await sleep(220);
    float = document.querySelector('[data-ask-ai] .float');
  }
  if (!float) return { fatal: 'nothing open to press' };
  const radio = float.querySelectorAll('[role="radio"]')[${index}];
  if (!radio) return { fatal: 'no question ${index + 1}' };
  radio.click();
  await sleep(150);
  float = document.querySelector('[data-ask-ai] .float');
  const checked = [...float.querySelectorAll('[role="radio"]')].map(r => r.getAttribute('aria-checked'));
  const go = float.querySelector('.btn-primary');
  if (!go) return { fatal: 'no button to open the assistant' };
  go.click();
  await sleep(200);
  return { opened: window.__opened || [], checked, closed: !document.querySelector('[data-ask-ai] .float') };
})()`

// THE ARROW KEYS MOVE THE CHOICE, the way a radio group answers them.
const ARROW = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  let float = document.querySelector('[data-ask-ai] .float');
  if (!float) { document.querySelector('[data-ask-ai] > button').click(); await sleep(220); float = document.querySelector('[data-ask-ai] .float'); }
  const radios = () => [...document.querySelectorAll('[data-ask-ai] [role="radio"]')];
  radios()[0].click(); await sleep(100);
  radios()[0].focus();
  radios()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  await sleep(150);
  const after = radios().map(r => r.getAttribute('aria-checked'));
  const focused = radios().indexOf(document.activeElement);
  radios()[0].click(); await sleep(100);
  return { after, focused };
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
    anchorState: document.querySelector('[data-ask-ai]') ? document.querySelector('[data-ask-ai]').getAttribute('data-ask-ai') : null,
    radios: after ? after.querySelectorAll('[role="radio"]').length : 0,
    items: after ? [...after.querySelectorAll('button')].filter(b => !!b.offsetParent).map(b => (b.textContent || '').trim()) : [],
  };
})()`

// "SET IT UP" LEAVES A NOTE AND GOES TO THE PAGE THAT SETS A CONNECTOR UP, marked as reached from a report.
const SET_IT_UP = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  let float = document.querySelector('[data-ask-ai] .float');
  if (!float) { document.querySelector('[data-ask-ai] > button').click(); await sleep(220); float = document.querySelector('[data-ask-ai] .float'); }
  if (!float) return { fatal: 'no panel open' };
  const btn = [...float.querySelectorAll('button')].find(b => /^Set it up/.test((b.textContent || '').trim()));
  if (!btn) return { fatal: 'no Set it up on the panel' };
  btn.click();
  await sleep(900);
  let stored = null;
  try { stored = localStorage.getItem('cordillera-ask-ai-report'); } catch (e) { stored = 'storage threw: ' + e; }
  return { at: location.pathname + location.search, stored, heading: (document.querySelector('.page-title') || {}).textContent || null };
})()`

// ON CONNECT YOUR AI: the way back, and where pressing it lands.
const CONTINUE = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const flat = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const pill = document.querySelector('.conn-state');
  const row = document.querySelector('.back-to-report');
  const btn = row ? row.querySelector('button') : null;
  const shown = { pill: pill ? flat(pill.textContent) : null, continueShown: !!btn, label: btn ? flat(btn.textContent) : null,
    line: row && row.querySelector('.back-to-report-line') ? flat(row.querySelector('.back-to-report-line').textContent) : null };
  if (!btn || !window.__pressContinue) return shown;
  btn.click();
  await sleep(1800);
  const anchor = document.querySelector('[data-ask-ai]');
  const float = anchor ? anchor.querySelector('.float') : null;
  return { ...shown, at: location.pathname + location.search, panelOpen: !!float,
    role: float ? float.getAttribute('role') : null, anchorState: anchor ? anchor.getAttribute('data-ask-ai') : null,
    radios: float ? float.querySelectorAll('[role="radio"]').length : 0 };
})()`

// A FULL-HEIGHT VIEWPORT, not a beyond-viewport capture: the report's header is sticky, and a
// beyond-viewport capture paints it where the 900px viewport put it. Light, then dark, then back.
const capture = async (name) => {
  if (!shotsDir) return
  for (const theme of ['light', 'dark']) {
    await value(`(() => { ${theme === 'dark' ? "document.documentElement.setAttribute('data-theme','dark')" : "document.documentElement.removeAttribute('data-theme')"}; return true })()`)
    await new Promise((r) => setTimeout(r, 350))
    const h = await value('Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)') ?? 900
    await cmd('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: Math.max(900, h), deviceScaleFactor: 1, mobile: false })
    await new Promise((r) => setTimeout(r, 400))
    const shot = await cmd('Page.captureScreenshot', { format: 'png' })
    await cmd('Emulation.clearDeviceMetricsOverride', {})
    const data = shot.result?.result?.data ?? shot.result?.data
    if (!data) throw new Error(`no screenshot came back for ${name}-${theme}`)
    writeFileSync(join(shotsDir, `${name}-${theme}.png`), Buffer.from(data, 'base64'))
  }
  await value(`(() => { document.documentElement.removeAttribute('data-theme'); return true })()`)
}

const visit = async (path = `/portal/result/${RUN_ID}`) => {
  await navigateOrRefuse(cmd, `${origin}${path}`, { what: 'ask-ai-render-check' })
  await new Promise((r) => setTimeout(r, 1500))
}

// ── the drive ───────────────────────────────────────────────────────────────────────────────────────

deck = 'connected';    await visit(); const header = await value(HEADER); const connected = await value(PROBE)
await capture('ask-ai-connected')
const arrow = await value(ARROW)
const asked = []
for (const i of QUESTIONS.keys()) asked.push(await value(ASK(i)))

deck = 'neverBefore';  await visit(); const never = await value(PROBE); await capture('ask-ai-not-connected')
const anyway = await value(ASK_ANYWAY)
await visit(); await value(PROBE); const setUp = await value(SET_IT_UP)
// Reached from a report, not yet connected: the steps are the point, and there is no way back to offer.
const notYet = await value(CONTINUE)

// Connected now. The rail first — nothing to go back to — then the page as "Set it up" left it.
deck = 'connected'
await visit('/portal/ai'); const fromRail = await value(CONTINUE)
await visit('/portal/ai?from=report')
await value('(() => { window.__pressContinue = true; return true })()')
const back = await value(CONTINUE)
const arrived = await value(PROBE)

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
for (const [name, r] of [['header', header], ['connected', connected], ['never connected', never], ['could not tell', unknown],
  ['no connector', none], ['local only', local], ['set it up', setUp], ['continue', back], ['arrival', arrived]]) {
  ok(r && typeof r === 'object', `the ${name} step measured nothing at all — the screen did not render`)
}
if (fail.length) { for (const f of fail) console.error(`  ✗ ${f}`); console.error('ask-ai-render-check: the drive did not reach the screen'); process.exit(1) }

// ── the header above the report ──
ok(show(header.crumbs) === show(['All Clearances', '›', MARK]), `the breadcrumb reads ${show(header.crumbs)}`)
ok(header.mark === MARK, `the header names ${show(header.mark)}, not the mark`)
const LINE = `${NAME} · ${PRODUCT_NAME} · searched ${ISO_DATE} · issued ${ISSUED_DAY}`
ok(header.line === LINE, `the header line reads ${show(header.line)}, not ${show(LINE)} — the issued day is Zurich's`)
ok(show(header.actions) === show(['Ask AI', 'Export']), `the header's actions are ${show(header.actions)}, not Ask AI then Export`)
ok(header.actionKinds.length === 2 && header.actionKinds.every((c) => /\bbtn-ghost\b/.test(c)),
  `the two actions are not both secondary buttons: ${show(header.actionKinds)}`)
ok(header.topbar === '', `the top bar names ${show(header.topbar)} over a report, which is not company-scoped`)
ok(!header.followUp, '"Ask a follow-up" is on the screen')

// ── connected: the panel ──
ok(connected.drawn && connected.opened, `connected: the button did not open anything — ${show(connected)}`)
ok(connected.buttonText === 'Ask AI' && connected.buttonAria === null,
  `connected: the button reads ${show(connected.buttonText)} with an accessible name of ${show(connected.buttonAria)}`)
ok(connected.role === 'dialog' && connected.label === 'Ask AI', `connected: the panel is role="${connected.role}" named ${show(connected.label)}`)
ok(connected.anchorState === 'ask', `connected: the control reports state "${connected.anchorState}"`)
ok(connected.head === `${MARK} · ${PRODUCT_NAME} · searched ${ISO_DATE}`, `connected: the panel's first line reads ${show(connected.head)}`)
ok(connected.group === 'What to ask', `connected: the questions are not a named radio group — ${show(connected.group)}`)
ok(show(connected.radios.map((r) => r.text)) === show(QUESTIONS.map((q) => q.label)), `connected: the questions read ${show(connected.radios)}`)
ok(show(connected.radios.map((r) => r.checked)) === show(['true', 'false', 'false', 'false']), `connected: the first question is not the one selected — ${show(connected.radios)}`)
ok(connected.primary === 'Open in Claude', `connected: the button reads ${show(connected.primary)}`)
ok(connected.note === 'The question is typed into your assistant; press send there.', `connected: the quiet line reads ${show(connected.note)}`)
ok(connected.rightAligned && connected.below, `connected: the panel does not hang under the button with right edges aligned — ${show(connected)}`)
// THE DESIGN IS 360. Measured, so a panel squeezed to the old menu's width fails here rather than wrapping.
ok(connected.width >= 340 && connected.width <= 380, `connected: the panel is ${connected.width}px wide; the design is 360`)
ok(show(arrow.after) === show(['false', 'true', 'false', 'false']) && arrow.focused === 1,
  `connected: the arrow key did not move the choice to the next question — ${show(arrow)}`)

// ── connected: what a press actually opens, for each question ──
//
// THE SELECTED QUESTION HAS TO BE IN THE LINK, not merely in the source. This is the assertion the change
// is for: a press that opened claude.ai with the first question whatever was chosen would look identical
// on screen.
for (const [i, press] of asked.entries()) {
  const href = (press?.opened ?? []).at(-1) ?? ''
  const u = (() => { try { return new URL(href) } catch { return null } })()
  ok(!press?.fatal, `question ${i + 1}: ${press?.fatal}`)
  ok(press?.checked?.[i] === 'true', `question ${i + 1} was not the one selected when pressed — ${show(press?.checked)}`)
  ok(u && u.origin + u.pathname === 'https://claude.ai/new', `question ${i + 1} opened ${show(href)}`)
  ok(u && show([...u.searchParams.keys()]) === show(['q']), `question ${i + 1}'s link carries more than the text to type in: ${show(href)}`)
  ok(u?.searchParams.get('q') === QUESTIONS[i].typed, `question ${i + 1} typed ${show(u?.searchParams.get('q'))}, not ${show(QUESTIONS[i].typed)}`)
  ok(!/noref|tmpa-|run /i.test(u?.searchParams.get('q') ?? ''), `question ${i + 1} carries a run identifier`)
  ok(press?.closed === true, `question ${i + 1}: the panel stayed open after it opened the assistant`)
}

// ── never connected: the connect panel, unchanged ──
ok(never.drawn && never.opened, `never connected: the button did not open anything — ${show(never)}`)
ok(never.role === 'dialog' && never.label === 'Connect your AI first', `never connected: the float is role="${never.role}" named ${show(never.label)}`)
ok(never.anchorState === 'connect', `never connected: the control reports state "${never.anchorState}"`)
ok(/Connect your AI first/.test(never.text), `never connected: the panel does not say what it is — ${show(never.text)}`)
ok(/Connect Claude or ChatGPT once/.test(never.text), 'never connected: the explaining line is missing')
ok(never.items.some((t) => /^Set it up/.test(t)), `never connected: no Set it up — ${show(never.items)}`)
ok(never.items.some((t) => /Already connected\? Ask anyway/.test(t)), `never connected: no way past it — ${show(never.items)}`)
ok(never.radios.length === 0 && never.primary !== 'Open in Claude',
  `never connected: the questions are on the panel, so the setup step is decoration — ${show(never.items)}`)
ok(never.width >= 240 && never.width <= 320, `never connected: the panel is ${never.width}px wide; the design is 276`)

// ── the way past a measurement that is behind ──
ok(anyway?.anchorState === 'ask' && anyway?.radios === 4, `"Ask anyway" did not reach the questions — ${show(anyway)}`)

// ── Set it up: the note, and the page it opens ──
ok(setUp.at === '/portal/ai?from=report', `Set it up went to ${show(setUp.at)}, not the setup page marked as reached from a report`)
const note = (() => { try { return JSON.parse(setUp.stored ?? '') } catch { return null } })()
ok(note?.runId === RUN_ID && note?.mark === MARK && note?.markSlug === null, `Set it up left ${show(setUp.stored)} as its note`)
ok(setUp.heading === 'Connect your AI', `Set it up opened a page headed ${show(setUp.heading)}`)
ok(notYet && notYet.continueShown === false && notYet.pill === 'Not connected yet',
  `reached from a report but not connected, the page offers the way back anyway — ${show(notYet)}`)

// ── Continue: from the rail there is nothing to go back to; from the report, it lands with the panel open ──
ok(fromRail && fromRail.pill === 'Connected' && fromRail.continueShown === false, `reached from the rail, the page offers a way back — ${show(fromRail)}`)
ok(back.continueShown && back.label === `Continue with ${MARK}`, `connected and reached from a report, the page offers ${show(back.label)}`)
ok(back.line === 'Back to the report you were reading.', `the line beside Continue reads ${show(back.line)}`)
ok(back.at === `/portal/result/${RUN_ID}`, `Continue landed on ${show(back.at)} — not the report, or with the signal still in the address`)
ok(back.panelOpen && back.role === 'dialog' && back.anchorState === 'ask' && back.radios === 4,
  `Continue did not land with the panel open in its connected form — ${show(back)}`)
ok(arrived.openOnArrival === true, `the panel was not already open when the report arrived — ${show(arrived)}`)

// ── could not tell: the third state renders, and renders as the connect panel ──
//
// DRIVEN AS ITS OWN DECK. It reaching the same screen as `false` is a decision about which way to be
// wrong, not an identity — and a build that threw on a null would fail here and nowhere else.
ok(unknown.drawn && unknown.opened, `could not tell: nothing opened — ${show(unknown)}`)
ok(unknown.anchorState === 'connect', `could not tell: a null was rendered as "${unknown.anchorState}", so an unmeasured reader was handed the questions`)
ok(/Connect your AI first/.test(unknown.text), 'could not tell: the panel did not draw')

// ── no connector: nothing is drawn ──
ok(none.drawn === false, `no connector: a button was drawn that can do nothing — ${show(none)}`)

// ── a laptop install: a local route IS a connector ──
ok(local.drawn && local.opened, `local only: the case the old panel stranded is stranded again — ${show(local)}`)
ok(local.anchorState === 'ask' && local.radios.length === 4, `local only: ${show(local.anchorState)} with ${local.radios.length} question(s)`)

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
console.log(`ask-ai-render-check: the header, both panels and the unmeasured state render; all four questions reach the link typed in; Set it up leaves its note and Continue lands on the report with the panel open; no button where there is no connector`)
if (shotsDir) console.log(`ask-ai-render-check: shots in ${shotsDir}`)
