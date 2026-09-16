// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// settings-render-check.mjs — Installation settings, Preferences, About and the sign-in page, drawn in a
// real browser, in both themes.
//
//   node scripts/settings-render-check.mjs [--shot-dir <dir>] [--quiet]
//
// WHY A BROWSER. The tests beside these screens read their source and drive their contract, and neither
// can see what this can: that no variable name, credential path or README reference reaches the text a
// reader sees; that a blur turned on survives a reload with its button still pressed, including in a
// browser whose storage refuses; that the administrator's help on the sign-in card really is folded shut;
// and that a long reset command stays inside the card.
//
// THE FIXTURES HAVE ONE AUTHOR. The settings rows are the driver's own inventory run against a fixture
// environment, the sign-in page is `loginPage` itself, and About's facts are `productIdentity`. A
// hand-written row would carry only the detail its author remembered; these carry the detail the product
// writes, so "none of it reaches the page" is asserted against the real thing.
//
// With `--shot-dir`, one full-height PNG per state, in light and dark, at 1280 wide. `--quiet` leaves out
// the closing dump of everything the probes read.

import { navigateOrRefuse } from './headless-page.mjs'   // Page.navigate returns an errorText, and nothing read it
import { createServer } from 'node:http'
import { reapOnExit } from '../shared/reap-on-exit.mjs'   // — a detached group dies with this script
import { readFileSync, existsSync, rmSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { engineInventory, providerInventory } from '../driver/config-inventory.mjs'
import { authView } from '../driver/portal-config-view.mjs'
import { loginPage, LOGIN_IN_FRONT_DOC } from '../driver/portal-service.mjs'
import { productIdentity } from '../shared/product-identity.mjs'
import { browserRun } from '../shared/browser-temp-root.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(REPO, 'portal-ui', 'dist')
if (!existsSync(join(DIST, 'index.html'))) {
  console.error('settings-render-check: portal-ui/dist is not built. Run `npm run build:ui` first.')
  process.exit(2)
}
const shotDir = process.argv.includes('--shot-dir') ? process.argv[process.argv.indexOf('--shot-dir') + 1] : null
if (shotDir) mkdirSync(shotDir, { recursive: true })
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' }

// ── the fixtures ─────────────────────────────────────────────────────────────────────────────────────

const EMAIL = 'dana@northwind.example'
const CONTACT = 'mailto:it@northwind.example'
const ISSUER = 'https://login.example-firm.test/'
const LONG_RESET = 'npx clearotron@0.3.0-beta.5 passphrase --reset --base $HOME/trademark-demo'
const BLUR_KEY = 'cordillera-blur-names'

// The deployment the board draws: a register and the research key set, the open-web key not, no case-law
// sign-in, the engine on a subscription. The values are inert fixture words and never leave this process:
// the inventory records names and states, never a value.
const credsDir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'settings-creds-'))
const deployment = {
  CLEAROTRON_DATABASE: 'corsearch', CORSEARCH_SESSION_KEY: 'fixture-not-a-key', PERPLEXITY_API_KEY: 'fixture-not-a-key',
  OAUTH_BRIDGE_CREDS_DIR: credsDir, PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '',
}
const adminConfig = {
  available: true, note: null, source: 'live', lastRun: null, built: null, flags: [],
  // The program is PRESENT here whatever this machine has, because the board's deployment runs searches;
  // the engine row's red states belong to the engine-state tests, not to this page's layout.
  engine: { ...engineInventory(deployment), binaryPresent: true, program: 'claude', install: 'npm install -g @anthropic-ai/claude-code' },
  providers: providerInventory(deployment),
  auth: authView({ mode: 'auth-proxy', oidcIssuer: ISSUER }),
}
const about = productIdentity()

const state = { contact: CONTACT, reset: null }
// THE PAGE'S OWN LOADS, COUNTED. A screen that asks the server twice paints exactly like one that asks once,
// and each request spends the person's rate budget, so the only instrument that sees a double load is a count.
const loads = []

const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname
  const json = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
  // THE ADMIN ADDRESSES ARE BOTH A SCREEN AND ITS DATA, decided by what the caller asked for — the rule
  // driver/portal-static.mjs applies: the app's own fetches ask for JSON, a browser navigation for HTML.
  const wantsPage = String(req.headers.accept ?? '').includes('text/html')
  if (!wantsPage && (path === '/portal/admin/config' || path === '/portal/api/about')) loads.push(path)
  if (path === '/portal/api/me') {
    return json({ permissions: { run: true, manage: true }, email: EMAIL, accounts: '*',
      access: [{ kind: 'everything' }], organisations: [{ key: 'northwind', name: 'Northwind Group' }],
      accountNames: { northwind: 'Northwind Foods' }, brand: 'Northwind Group', administratorContact: state.contact })
  }
  if (path === '/portal/admin/config' && !wantsPage) return json(adminConfig)
  if (path === '/portal/api/about') return json(about)
  if (path === '/portal/admin/roster' && !wantsPage) return json({ customers: [{ key: 'northwind', name: 'Northwind Foods' }] })
  if (path === '/portal/login') {
    res.writeHead(200, { 'content-type': 'text/html' })
    return res.end(loginPage({ email: EMAIL, resetCommand: state.reset }))
  }
  if (path.startsWith('/portal/api/') || (path.startsWith('/portal/admin/') && !wantsPage)) return json({})
  const file = path === '/' || (path.startsWith('/portal') && !path.includes('.')) ? '/index.html' : path.replace(/^\/portal/, '')
  const full = join(DIST, file)
  if (!existsSync(full)) { res.writeHead(404); res.end('no'); return }
  res.writeHead(200, { 'content-type': MIME[extname(full)] ?? 'application/octet-stream' })
  res.end(readFileSync(full))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`

// ── the browser ──────────────────────────────────────────────────────────────────────────────────────

const { profile: userDir, env: chromeEnv } = browserRun('settings-check-')
const chrome = spawn('google-chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--user-data-dir=${userDir}`, '--window-size=1280,900', '--remote-debugging-port=0', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: chromeEnv })
reapOnExit(chrome)

let devtools = ''
const wsUrl = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`chrome did not report a devtools endpoint within 60s. Its stderr was:\n${devtools || '(nothing)'}`)), 60000)
  chrome.stderr.on('data', (c) => {
    devtools += c
    const m = devtools.match(/ws:\/\/[^\s]+/)
    if (m) { clearTimeout(t); resolve(m[0]) }
  })
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
const cmd = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, sessionId, method, params })) })
await cmd('Page.enable')
// A probe that throws says so, rather than returning nothing for the assertions after it to misread.
const evalIn = async (expr) => {
  const r = (await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result
  if (r?.exceptionDetails) console.error(`  ! a probe threw: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`)
  return r?.result?.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Wait for a condition in the page, and say so when it never came, rather than measuring a half-drawn page. */
async function settle(condition, what, ms = 8000) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (await evalIn(`(() => { try { return !!(${condition}) } catch { return false } })()`)) return true
    await sleep(100)
  }
  failures++
  console.error(`  ✗ ${what} — never happened`)
  return false
}

async function open(path, ready, what) {
  await cmd('Page.navigate', { url: 'about:blank' })
  await sleep(100)
  await navigateOrRefuse(cmd, `${origin}${path}`, { what: 'settings-render-check' })
  return settle(ready, what)
}

// A RELOAD IS NOT DONE WHEN IT IS ASKED FOR. `Page.reload` returns while the old document is still up, and
// a condition read then is read off the page being replaced. The old document is marked first, so the wait
// is for a new document that is ready rather than for an old one that already was.
async function reload(ready, what) {
  await evalIn('window.__beforeReload = true')
  await cmd('Page.reload', {})
  return settle(`!window.__beforeReload && (${ready})`, what)
}

async function setTheme(theme) {
  await evalIn(`(() => { document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)}); try { localStorage.setItem('cordillera-theme', ${JSON.stringify(theme)}) } catch {} return true })()`)
  await sleep(250)
}

// A FULL-HEIGHT VIEWPORT, not a beyond-viewport capture: a beyond-viewport capture paints the sticky rail
// and top bar where the 900px viewport put them.
async function capture(name) {
  if (!shotDir) return
  await evalIn('window.scrollTo(0, 0)')
  const h = await evalIn('Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)') ?? 900
  await cmd('Emulation.setDeviceMetricsOverride', { width: 1280, height: Math.max(900, h), deviceScaleFactor: 1, mobile: false })
  await sleep(400)
  const shot = await cmd('Page.captureScreenshot', { format: 'png' })
  await cmd('Emulation.clearDeviceMetricsOverride', {})
  const data = shot.result?.data
  if (!data) throw new Error(`no screenshot came back for ${name}`)
  writeFileSync(join(shotDir, `${name}.png`), Buffer.from(data, 'base64'))
  shots.push(`${name}.png`)
}

/** A real press, with the mouse, where the reader would press. */
async function press(selector) {
  const at = await evalIn(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return null
    el.scrollIntoView({ block: 'center' })
    const b = el.getBoundingClientRect()
    return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }
  })()`)
  if (!at) return false
  for (const type of ['mousePressed', 'mouseReleased']) {
    await cmd('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1 })
  }
  await sleep(250)
  return true
}

let failures = 0
const shots = []
const ok = (cond, msg) => { if (!cond) { failures++; console.error(`  ✗ ${msg}`) } else console.log(`  ✓ ${msg}`) }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// What a reader must never see on Installation settings. Scanned over the text the page draws, so the
// rows the server sent — which DO carry this detail — are what is being tested.
const LEAKS = `[/\\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\\b/, /(?<![:\\w\\/.])(?:~|\\.{1,2})?\\/[\\w.-]+\\/[\\w.\\/-]+|\\.json\\b/, /README|\\.md\\b/i]`

// ── Installation settings ────────────────────────────────────────────────────────────────────────────

const settingsProbe = `(() => {
  const flat = (s) => (s ?? '').replace(/\\s+/g, ' ').trim()
  const screen = document.querySelector('.screen')
  const groups = [...screen.querySelectorAll('.cfg-group')]
  const row = (r) => ({
    name: flat(r.querySelector('.cfg-name')?.textContent), val: flat(r.querySelector('.cfg-val')?.textContent) || null,
    state: flat(r.querySelector('.cfg-state')?.textContent),
    notes: [...r.querySelectorAll('.cfg-note')].map((n) => flat(n.textContent)),
    mono: [...r.querySelectorAll('.cfg-note.mono')].map((n) => flat(n.textContent)),
    guide: r.querySelector('.cfg-act a.pill') ? { text: flat(r.querySelector('.cfg-act a.pill').textContent), href: r.querySelector('.cfg-act a.pill').getAttribute('href'), target: r.querySelector('.cfg-act a.pill').getAttribute('target') } : null,
    stateRight: Math.round(r.querySelector('.cfg-state').getBoundingClientRect().right),
  })
  const pageText = document.body.innerText
  return {
    renderedChars: flat(screen.innerText).length,
    title: flat(screen.querySelector('h1.page-title')?.textContent),
    sections: groups.map((g) => flat(g.querySelector(':scope > .eyebrow')?.textContent)),
    signIn: [...(groups[0]?.querySelectorAll('.cfg-row') ?? [])].map(row),
    engine: [...(groups[1]?.querySelectorAll('.cfg-row') ?? [])].map(row),
    categories: [...(groups[2]?.querySelectorAll('.cfg-cat') ?? [])].map((c) => ({
      label: flat(c.querySelector('.cfg-sub')?.textContent),
      note: flat(c.querySelector('.cfg-cat-note')?.textContent) || null,
      rows: [...c.querySelectorAll('.cfg-row')].map(row),
    })),
    leaks: ${LEAKS}.flatMap((re) => { const m = re.exec(pageText); return m ? [m[0]] : [] }),
  }
})()`

const menuProbe = `(async () => {
  const avatar = document.querySelector('button[aria-label="Settings and about"]')
  if (!avatar) return null
  avatar.click()
  await new Promise((r) => setTimeout(r, 300))
  const items = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((b) => b.textContent.trim())
  avatar.click()
  return items
})()`

// ── Preferences ──────────────────────────────────────────────────────────────────────────────────────

const preferencesProbe = `(() => {
  const flat = (s) => (s ?? '').replace(/\\s+/g, ' ').trim()
  const screen = document.querySelector('.screen')
  const link = screen.querySelector('.pref-line a')
  const eye = screen.querySelector('.pref-blur button')
  const topEye = document.querySelector('header.topbar button[aria-label="Blur names for screen sharing"]')
  const address = screen.querySelector('.pref-dl dd[data-anon="mark"]')
  let stored = null
  try { stored = localStorage.getItem('${BLUR_KEY}') } catch { stored = 'refused' }
  return {
    renderedChars: flat(screen.innerText).length,
    title: flat(screen.querySelector('h1.page-title')?.textContent),
    cards: [...screen.querySelectorAll('.pref-card > .pref-title')].map((h) => flat(h.textContent)),
    rows: [...screen.querySelectorAll('.pref-dl dt')].map((d) => flat(d.textContent) + ': ' + flat(d.nextElementSibling?.textContent)),
    lines: [...screen.querySelectorAll('.pref-line')].map((p) => flat(p.textContent)),
    link: link ? { text: flat(link.textContent), href: link.getAttribute('href') } : null,
    logOut: screen.querySelector('a.pill[href="/portal/sign-out"]') ? flat(screen.querySelector('a.pill[href="/portal/sign-out"]').textContent) : null,
    blurLine: flat(screen.querySelector('.pref-blur-line')?.textContent),
    eye: eye ? { label: eye.getAttribute('aria-label'), pressed: eye.getAttribute('aria-pressed'), text: flat(eye.textContent), cls: eye.className } : null,
    topEye: topEye ? { pressed: topEye.getAttribute('aria-pressed'), cls: topEye.className, icon: topEye.innerHTML === eye?.innerHTML } : null,
    blurredDocument: document.documentElement.classList.contains('anon-on'),
    addressFilter: address ? getComputedStyle(address).filter : null,
    // EVERY PLACE THE COMPANY'S NAME IS DRAWN, anywhere on the page — the rail and the top bar as well as
    // the screen — that nothing marks for the blur. "It covers every mark and company on screen" is a
    // promise about the whole page, and the rail's switcher once broke it with nothing measuring it.
    unmarkedCompany: (() => {
      const out = []
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent.includes('Northwind Foods')) continue
        const el = n.parentElement
        if (!el || el.closest('[data-anon="mark"]')) continue
        out.push((el.tagName || '?').toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : ''))
      }
      return out
    })(),
    companyDrawn: document.body.innerText.includes('Northwind Foods') || [...document.querySelectorAll('option')].some((o) => o.textContent.includes('Northwind Foods')),
    stored,
    notKept: /not kept|starts switched off|until you reload|every time you open|These two settings stay/i.test(screen.innerText),
    theme: document.documentElement.getAttribute('data-theme'),
  }
})()`

// ── About ────────────────────────────────────────────────────────────────────────────────────────────

const aboutProbe = `(() => {
  const flat = (s) => (s ?? '').replace(/\\s+/g, ' ').trim()
  const screen = document.querySelector('.screen')
  const dts = [...screen.querySelectorAll('.about-dl dt')]
  const dd = (label) => dts.find((d) => flat(d.textContent) === label)?.nextElementSibling
  return {
    renderedChars: flat(screen.innerText).length,
    title: flat(screen.querySelector('h1.page-title')?.textContent),
    rows: dts.map((d) => flat(d.textContent)),
    build: flat(dd('Build')?.querySelector('.mono')?.textContent) || null,
    buildFont: dd('Build')?.querySelector('.mono') ? getComputedStyle(dd('Build').querySelector('.mono')).fontFamily : null,
    source: dd('Source')?.querySelector('a') ? { text: flat(dd('Source').querySelector('a').textContent), href: dd('Source').querySelector('a').getAttribute('href'), lines: dd('Source').querySelector('a').getClientRects().length } : null,
    fullText: dd('Licence')?.querySelector('a.pill') ? { text: flat(dd('Licence').querySelector('a.pill').textContent), href: dd('Licence').querySelector('a.pill').getAttribute('href') } : null,
    copyright: flat(dd('Copyright')?.textContent),
    pills: [...screen.querySelectorAll('.about-docs a.pill')].map((a) => flat(a.textContent)),
  }
})()`

// ── Sign in ──────────────────────────────────────────────────────────────────────────────────────────

const signInProbe = `(() => {
  const flat = (s) => (s ?? '').replace(/\\s+/g, ' ').trim()
  const card = document.querySelector('.card')
  const fold = card?.querySelector('details.fold')
  const hints = fold ? [...fold.querySelectorAll('.hint')] : []
  const code = fold?.querySelector('code')
  const cs = card ? getComputedStyle(card) : null
  const inner = card ? (() => { const b = card.getBoundingClientRect(); return { left: b.left + parseFloat(cs.paddingLeft), right: b.right - parseFloat(cs.paddingRight) } })() : null
  const codeRects = code ? [...code.getClientRects()].map((r) => ({ left: Math.round(r.left), right: Math.round(r.right) })) : []
  return {
    heading: flat(card?.querySelector('h1')?.textContent),
    identity: flat(card?.querySelector('h1 + p')?.textContent),
    field: !!card?.querySelector('input#passphrase[type="password"]'),
    button: flat(card?.querySelector('form button[type="submit"]')?.textContent),
    lead: flat(card?.querySelector('p.lead')?.textContent),
    leadBold: !!card?.querySelector('p.lead > b'),
    summary: flat(fold?.querySelector('summary')?.textContent),
    open: fold ? fold.open : null,
    // A closed fold keeps its content laid out but hidden, so a rectangle is not the test; visibility is.
    hintsShown: hints.filter((h) => h.checkVisibility()).length,
    hints: hints.map((h) => flat(h.textContent)),
    setUp: fold?.querySelector('a') ? { text: flat(fold.querySelector('a').textContent), href: fold.querySelector('a').getAttribute('href') } : null,
    code: flat(code?.textContent),
    // The card's own width: its content box, which the page caps at 420px.
    cardWidth: card ? Math.round(card.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth)) : null,
    codeInside: !!inner && codeRects.length > 0 && codeRects.every((r) => r.left >= inner.left - 1 && r.right <= inner.right + 1),
    codeLines: codeRects.length,
    overflowsPage: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }
})()`

const out = {}
const SPEC = {
  signInName: "Through your organisation's sign-in service",
  webSearch: ['The engine’s own web search', 'provided by the engine', 'Available', 'The model searches the web itself during a run.'],
  categories: ['Trademark register', 'Common-law and marketplace research', 'Open-web search', 'Case law and oppositions'],
  caseLawGap: 'Until these are set up, a Full country search still runs and its report discloses the case-law gap instead of reporting no adverse case law.',
  adminLine: 'To change the address, the permissions or the companies on it, contact your Clearotron administrator.',
  blurLine: 'On the top bar. It covers every mark and company on screen, and an open report whole. It stays as you left it on this computer.',
  reset: 'Lost the passphrase? Run clearotron passphrase --reset on the machine running this portal. It mints a new one and prints it once.',
  addPeople: 'To add people, put it behind a login system such as your company single sign-on. How to set that up',
}

for (const theme of ['light', 'dark']) {
  console.log(`\n── ${theme} ──`)

  // ── Installation settings
  console.log('\nInstallation settings:')
  loads.length = 0
  if (await open('/portal/admin/config', "document.querySelectorAll('.cfg-row').length >= 10", 'Installation settings drew its rows')) {
    await setTheme(theme)
    const s = (await evalIn(settingsProbe)) ?? {}
    out[`settings-${theme}`] = s
    ok(s.renderedChars > 400, `the page rendered real text (${s.renderedChars} chars) — every absence below is worthless without it`)
    ok(s.title === 'Installation settings', `the page is titled "Installation settings" (saw "${s.title}")`)
    ok(same(s.sections, ['Sign-in', 'Engine', 'Providers']), `three sections: Sign-in, Engine, Providers (saw ${JSON.stringify(s.sections)})`)
    ok(s.signIn.length === 1, `Sign-in is one row (saw ${s.signIn.length})`)
    const si = s.signIn[0]
    ok(si && si.name === SPEC.signInName && si.val === null && si.state === 'Configured',
      `the sign-in row reads "${SPEC.signInName} · Configured" (saw ${JSON.stringify(si)})`)
    ok(si && same(si.mono, [`auth-proxy · issuer ${ISSUER}`]), `the mode and issuer are the row's quiet mono line (saw ${JSON.stringify(si?.mono)})`)
    const rights = [...s.signIn, ...s.engine, ...s.categories.flatMap((c) => c.rows)].map((r) => r.stateRight)
    ok(rights.length >= 10 && new Set(rights).size === 1, `every state lines up in one column (right edges ${JSON.stringify([...new Set(rights)])})`)
    ok(s.engine.length === 2 && s.engine[0].name === 'Anthropic' && s.engine[0].state === 'Subscription',
      `Engine carries the engine row first (saw ${JSON.stringify(s.engine[0])})`)
    const web = s.engine[1]
    ok(web && same([web.name, web.val, web.state, web.notes[0]], SPEC.webSearch),
      `the engine's own web search sits under Engine, in the page's words (saw ${JSON.stringify(web)})`)
    ok(same(s.categories.map((c) => c.label), SPEC.categories), `four provider categories, in order (saw ${JSON.stringify(s.categories.map((c) => c.label))})`)
    const repeated = s.categories.flatMap((c) => c.rows.filter((r) => [r.name, r.val ?? '', ...r.notes].some((t) => t.includes(c.label))).map((r) => `${c.label} on ${r.name}`))
    ok(repeated.length === 0, `no category name is repeated on a row (saw ${JSON.stringify(repeated)})`)
    ok(!s.categories.flatMap((c) => c.rows).some((r) => /web search/i.test(r.name)), 'the engine\'s web search is not also listed as a provider')
    const rows = Object.fromEntries(s.categories.flatMap((c) => c.rows).map((r) => [r.name, r]))
    ok(rows.Corsearch?.state === 'Configured' && rows.Perplexity?.state === 'Configured', 'the configured register and research key read Configured')
    ok(rows.SerpAPI?.state === 'Missing' && same(rows.SerpAPI?.notes, ['A key is needed'])
      && rows.SerpAPI?.guide?.text === 'Setup guide' && /providers\/README\.md#research-and-support-sources$/.test(rows.SerpAPI?.guide?.href ?? '') && rows.SerpAPI?.guide?.target === '_blank',
      `a missing key says "A key is needed" beside a Setup guide that opens its guide (saw ${JSON.stringify(rows.SerpAPI)})`)
    for (const name of ['CourtListener', 'Legal Data Hunter']) {
      ok(rows[name]?.state === 'Not set up' && same(rows[name]?.notes, ['One-time sign-in needed']) && rows[name]?.guide?.text === 'Setup guide'
        && /oauth-mcp-bridge\/README\.md#one-time-setup-per-remote-mcp-server$/.test(rows[name]?.guide?.href ?? ''),
        `${name} says "One-time sign-in needed" beside its Setup guide (saw ${JSON.stringify(rows[name])})`)
    }
    ok(rows.CourtListener?.val === 'US federal case law' && rows['Legal Data Hunter']?.val === 'statutes and case law, 108 countries' && rows['EUR-Lex']?.val === 'EU judgments',
      'each case-law source says what it covers, without its web address')
    const caseLaw = s.categories.find((c) => c.label === 'Case law and oppositions')
    ok(caseLaw?.note === SPEC.caseLawGap, `what an unset case-law source costs is said under the category (saw ${JSON.stringify(caseLaw?.note)})`)
    ok(!s.categories.flatMap((c) => c.rows).some((r) => r.notes.some((n) => /case-law gap/.test(n))), 'and not again on a row')
    const boa = rows['EUIPO Boards of Appeal']
    ok(boa?.state === 'Not in this build' && same(boa?.notes, ['Reports covering the EU say so']) && boa?.guide === null,
      `a source this build does not ship says which reports disclose it, and offers no guide (saw ${JSON.stringify(boa)})`)
    ok(s.leaks.length === 0, `no variable name, credential path or README reference anywhere on the page (saw ${JSON.stringify(s.leaks)})`)
    const menu = (await evalIn(menuProbe)) ?? {}
    ok(Array.isArray(menu) && menu.includes('Installation settings') && !menu.includes('Global config'),
      `the avatar menu names the page "Installation settings" (saw ${JSON.stringify(menu)})`)
    await capture(`installation-settings-${theme}`)
    // Counted after the Setup guide links were read, which needs the second load to have answered.
    await sleep(500)
    const asked = (route) => loads.filter((l) => l === route).length
    ok(asked('/portal/admin/config') === 1 && asked('/portal/api/about') === 1,
      `one visit asks for the settings once and for the source address once (saw ${JSON.stringify(loads)})`)
  }

  // ── Preferences, contact set and unset
  for (const [label, contact] of [['contact-set', CONTACT], ['contact-unset', null]]) {
    console.log(`\nPreferences, ${label}:`)
    state.contact = contact
    if (!(await open('/portal/preferences', "document.querySelector('.pref-blur button')", `Preferences drew (${label})`))) continue
    await setTheme(theme)
    const p = (await evalIn(preferencesProbe)) ?? {}
    out[`preferences-${label}-${theme}`] = p
    ok(p.renderedChars > 200, `the page rendered real text (${p.renderedChars} chars)`)
    ok(p.title === 'Your preferences', `titled "Your preferences" (saw "${p.title}")`)
    ok(same(p.cards, ['Your sign-in', 'Appearance', 'Blur names while sharing a screen']), `three cards, in order (saw ${JSON.stringify(p.cards)})`)
    ok(same(p.rows, [`Address: ${EMAIL}`, 'Permissions: Runs clearances · Manages', 'Access to: Everything']),
      `Your sign-in carries the address, the permissions and the access (saw ${JSON.stringify(p.rows)})`)
    ok(p.lines[0] === SPEC.adminLine, `the administrator line reads as written (saw ${JSON.stringify(p.lines[0])})`)
    if (contact) ok(p.link?.text === 'Clearotron administrator' && p.link?.href === CONTACT, `with a contact set, "Clearotron administrator" links to it (saw ${JSON.stringify(p.link)})`)
    else ok(p.link === null, `with no contact set, "Clearotron administrator" is plain text (saw ${JSON.stringify(p.link)})`)
    ok(p.logOut === 'Log out', 'Log out is where it was')
    ok(p.lines[1] === 'Also on the top bar, under the circle icon', `the appearance line reads as written (saw ${JSON.stringify(p.lines[1])})`)
    ok(p.blurLine === SPEC.blurLine, `the blur card states its three facts (saw ${JSON.stringify(p.blurLine)})`)
    ok(p.eye && p.eye.label === 'Blur names for screen sharing' && p.eye.text === '' && p.eye.pressed === 'false' && p.topEye?.cls === p.eye.cls && p.topEye?.icon,
      `the card shows the top bar's own eye button, unpressed, with no label or badge (saw ${JSON.stringify({ eye: p.eye, top: p.topEye })})`)
    ok(!p.notKept, 'no sentence on the page says the blur choice is not kept')
    await capture(`preferences-${label}-${theme}`)
    if (!contact) {
      // THE THEME CHOICE STILL WORKS: the other option applies at once, and pressing this one brings it back.
      const other = theme === 'light' ? 2 : 1
      await press(`.pref-themes button:nth-child(${other})`)
      const flipped = await evalIn("[document.documentElement.getAttribute('data-theme'), [...document.querySelectorAll('.pref-themes button')].map((b) => b.getAttribute('aria-pressed'))]")
      await press(`.pref-themes button:nth-child(${3 - other})`)
      const back = await evalIn("document.documentElement.getAttribute('data-theme')")
      ok(same(flipped, [theme === 'light' ? 'dark' : 'light', other === 2 ? ['false', 'true'] : ['true', 'false']]) && back === theme,
        `the theme choice applies and comes back (saw ${JSON.stringify({ flipped, back })})`)
    }
  }
  state.contact = CONTACT

  // ── the blur, remembered
  console.log('\nBlur, remembered:')
  if (await open('/portal/preferences', "document.querySelector('.pref-blur button')", 'Preferences drew for the blur')) {
    await evalIn(`(() => { try { localStorage.removeItem('${BLUR_KEY}') } catch {} return true })()`)
    await setTheme(theme)
    await press('.pref-blur button')
    const on = (await evalIn(preferencesProbe)) ?? {}
    ok(on.blurredDocument && on.eye?.pressed === 'true' && on.topEye?.pressed === 'true' && /blur/.test(on.addressFilter ?? ''),
      `pressing the card's eye blurs the page and presses both buttons (saw ${JSON.stringify({ blurred: on.blurredDocument, card: on.eye?.pressed, top: on.topEye?.pressed, filter: on.addressFilter })})`)
    ok(on.stored === 'on', `the choice is kept in this browser (saw ${JSON.stringify(on.stored)})`)
    ok(on.companyDrawn && on.unmarkedCompany.length === 0,
      `with the blur on, the company's name is drawn unmarked for the blur at: ${JSON.stringify(on.unmarkedCompany)} (drawn at all: ${on.companyDrawn})`)
    await capture(`blur-on-${theme}`)
    if (await reload("document.querySelector('.pref-blur button')", 'Preferences drew again after the reload')) {
      await sleep(300)
      const back = (await evalIn(preferencesProbe)) ?? {}
      ok(back?.blurredDocument && back.eye?.pressed === 'true' && back.topEye?.pressed === 'true' && /blur/.test(back.addressFilter ?? ''),
        `after a reload the page is still blurred and the eye is still pressed (saw ${JSON.stringify({ blurred: back?.blurredDocument, card: back?.eye?.pressed, top: back?.topEye?.pressed, filter: back?.addressFilter })})`)
      await capture(`blur-reloaded-${theme}`)
      // THE TWO BUTTONS ARE ONE CONTROL: the top bar turns it off, the card agrees, and the next press of
      // the card turns it on again rather than doing nothing.
      await press('header.topbar button[aria-label="Blur names for screen sharing"]')
      const off = (await evalIn(preferencesProbe)) ?? {}
      ok(!off.blurredDocument && off.eye?.pressed === 'false' && off.topEye?.pressed === 'false' && off.stored === 'off',
        `the top bar's eye turns it off and the card agrees (saw ${JSON.stringify({ blurred: off.blurredDocument, card: off.eye?.pressed, stored: off.stored })})`)
      await press('.pref-blur button')
      const again = (await evalIn(preferencesProbe)) ?? {}
      ok(again.blurredDocument && again.topEye?.pressed === 'true', 'and the card\'s next press turns it on again — no dead click')
      await press('.pref-blur button')
      if (await reload("document.querySelector('.pref-blur button')", 'Preferences drew after turning the blur off')) {
        await sleep(300)
        const stayedOff = (await evalIn(preferencesProbe)) ?? {}
        ok(stayedOff && !stayedOff.blurredDocument && stayedOff.eye?.pressed === 'false', 'turned off, it stays off after a reload')
      }
    }
  }

  // ── About
  console.log('\nAbout:')
  if (await open('/portal/about', "document.querySelector('.about-dl')", 'About drew')) {
    await setTheme(theme)
    const a = (await evalIn(aboutProbe)) ?? {}
    out[`about-${theme}`] = a
    ok(a.title === 'About', `titled "About" (saw "${a.title}")`)
    ok(same(a.rows, ['Product', 'Version', 'Build', 'Source', 'Licence', 'Copyright', 'Model access', 'Trade marks']), `the rows, in order (saw ${JSON.stringify(a.rows)})`)
    ok(a.source?.text === 'CordilleraSarl/Clearotron ↗' && a.source?.href === about.sourceUrl && a.source?.lines === 1,
      `the Source row is a readable one-line link to this build's source (saw ${JSON.stringify(a.source)})`)
    ok(about.commit ? a.build === about.commit.slice(0, 12) && /mono|monospace|Fira|Menlo|Courier/i.test(a.buildFont ?? '') : a.build === null,
      `the build identifier stays one row above it, in mono (saw ${JSON.stringify({ build: a.build, font: a.buildFont })})`)
    ok(a.fullText?.text === 'Full text' && /gnu\.org/.test(a.fullText?.href ?? ''), `the licence keeps "Full text" (saw ${JSON.stringify(a.fullText)})`)
    ok(a.copyright === '2026 Cordillera Sàrl', `copyright (saw ${JSON.stringify(a.copyright)})`)
    ok(same(a.pills, ['Notices', 'Trademarks', 'Contributing', 'Security', 'Code of conduct', 'GitHub', 'clearotron.ai']), `the link pills (saw ${JSON.stringify(a.pills)})`)
    await capture(`about-${theme}`)
  }

  // ── Sign in: help closed, open, and with a long reset command
  for (const [label, reset] of [['sign-in-help', null], ['sign-in-help-long-command', LONG_RESET]]) {
    console.log(`\n${label}:`)
    state.reset = reset
    if (!(await open('/portal/login', "document.querySelector('.card details.fold')", `the sign-in page drew (${label})`))) continue
    await setTheme(theme)
    const closed = (await evalIn(signInProbe)) ?? {}
    out[`${label}-closed-${theme}`] = closed
    ok(closed.heading === 'Sign in' && closed.identity === `Clearotron portal, as ${EMAIL}.` && closed.field && closed.button === 'Sign in',
      `the card keeps its heading, identity line, field and button (saw ${JSON.stringify({ h: closed.heading, id: closed.identity, button: closed.button })})`)
    ok(closed.lead === 'This Clearotron signs in one person: you.' && closed.leadBold, `one bold line under the button (saw ${JSON.stringify(closed.lead)})`)
    ok(closed.summary === 'Administrator help' && closed.open === false && closed.hintsShown === 0,
      `the administrator's lines sit in a closed "Administrator help" fold (saw ${JSON.stringify({ summary: closed.summary, open: closed.open, shown: closed.hintsShown })})`)
    if (!reset) await capture(`sign-in-help-closed-${theme}`)
    await press('.card details.fold > summary')
    const opened = (await evalIn(signInProbe)) ?? {}
    out[`${label}-open-${theme}`] = opened
    ok(opened.open === true && opened.hintsShown === 2, `pressing it opens both lines (saw ${JSON.stringify({ open: opened.open, shown: opened.hintsShown })})`)
    ok(opened.hints[0] === (reset ? SPEC.reset.replace('clearotron passphrase --reset', reset) : SPEC.reset) && opened.hints[1] === SPEC.addPeople,
      `the fold holds the product's two lines word for word (saw ${JSON.stringify(opened.hints)})`)
    ok(opened.setUp?.text === 'How to set that up' && opened.setUp?.href === LOGIN_IN_FRONT_DOC, `with the "How to set that up" link (saw ${JSON.stringify(opened.setUp)})`)
    ok(opened.codeInside && !opened.overflowsPage && opened.cardWidth <= 420,
      `the reset command stays inside the card at its own width (card ${opened.cardWidth}px, ${opened.codeLines} line(s), inside: ${opened.codeInside})`)
    await capture(`${label}-open-${theme}`)
  }
  state.reset = null
}

// ── a browser whose storage refuses ──────────────────────────────────────────────────────────────────
//
// localStorage throws outright in a null-origin or locked-down document. The page must still draw, the
// eye must still blur, and a reload must start it off rather than take the page down.
console.log('\nBlur, in a browser whose storage refuses:')
const { result: refusal } = await cmd('Page.addScriptToEvaluateOnNewDocument', {
  source: "Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('The operation is insecure.', 'SecurityError') } })",
})
if (await open('/portal/preferences', "document.querySelector('.pref-blur button')", 'Preferences drew in a browser whose storage refuses')) {
  const before = (await evalIn(preferencesProbe)) ?? {}
  ok(before.stored === 'refused' && !before.blurredDocument && before.eye?.pressed === 'false', `the storage refuses, and the page starts unblurred (saw ${JSON.stringify({ stored: before.stored, blurred: before.blurredDocument })})`)
  await press('.pref-blur button')
  const pressed = (await evalIn(preferencesProbe)) ?? {}
  ok(pressed.blurredDocument && pressed.eye?.pressed === 'true' && pressed.topEye?.pressed === 'true', 'pressing the eye still blurs the page')
  if (await reload("document.querySelector('.pref-blur button')", 'Preferences drew again after a reload with storage refusing')) {
    const after = (await evalIn(preferencesProbe)) ?? {}
    ok(after && !after.blurredDocument && after.eye?.pressed === 'false', 'a reload starts it off, with nothing to remember it by, and the page still draws')
  }
}
await cmd('Page.removeScriptToEvaluateOnNewDocument', { identifier: refusal?.identifier })

if (!process.argv.includes('--quiet')) console.log(`\n${JSON.stringify(out, null, 2)}`)
try { process.kill(-chrome.pid, 'SIGKILL') } catch { /* already gone */ }
server.close()
rmSync(userDir, { recursive: true, force: true })
rmSync(credsDir, { recursive: true, force: true })
if (shotDir) console.log(`\nwrote ${shots.length} screenshot(s) to ${shotDir}:\n  ${shots.join('\n  ')}`)
console.log(failures ? `\n${failures} failed` : '\nInstallation settings, Preferences, About and Sign in draw correctly in both themes')
process.exit(failures ? 1 : 0)
