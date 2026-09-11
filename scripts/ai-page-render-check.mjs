// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// ai-page-render-check.mjs — the "Use your AI" page, drawn in a real browser, in the states a reader
// actually meets.
//
//   node scripts/ai-page-render-check.mjs
//
// WHY A BROWSER AND NOT A STRING TEST. The owner pressed all four Connect buttons on the test portal and
// said "none of them do anything". Nothing was broken in any file: each piece was correct and the fault
// was the RELATION between them at run time. portal-ui carries no DOM, so this is where the question
// "does a press leave a reader looking at anything" can be asked at all.
//
// WHAT THIS FILE ASSERTS SINCE THE REBUILD TO THE APPROVED DESIGN (2026-09-11). The page renders what
// `/portal/api/mcp-access` hands it and derives nothing, so the browser questions are relational:
//
//   · the where-cards show, with the approved labels, exactly where the install serves the disk route —
//     and nothing shows below them until one is picked; without them the one route's list opens directly
//   · each card lists EXACTLY the apps the resolver serves there, and a card with none says why
//   · nothing is expanded on arrival, and none of the six banned words is on the arriving page — including
//     the strings the SERVER sends — except the owner-dictated help link, exempt by its exact text
//   · picking ANY row, and pressing Copy, moves nothing: every heading, card, row and the help notice below
//     the panel is measured before and after, in document coordinates
//   · a block's Copy never talks to the key-minting endpoint; a key-bearing Copy mints once, lands masked,
//     and the credential reaches the DOM only in the world where the browser refused the clipboard
//
// THE FIXTURES HAVE ONE AUTHOR. Each deck's `/portal/api/mcp-access` body is composed through
// `shared/connect-clients.mjs` and `shared/stdio-connect.mjs` — the same resolvers the real handler
// calls — with only the deployment facts (role, door address) varying per deck. Hand-written offer rows
// here would be a second author of the wire shape, which is exactly what this check exists to catch:
// its previous fixtures served the pre-1976 `{enabled, url, keyUrl}` shape long after the server had
// moved to `offers`, and every deck failed with "the Connect buttons did not render". The handler's own
// output shape is pinned by driver/test/portal-service.test.mjs; the composition below follows it.
//
// THE DECKS are the two axes the resolver actually answers to — who is looking (staff get this box's
// stdio routes, clients never do) and whether the client door is standing:
//
//   local-staff      a fresh local install, the reader is the operator. The stdio assistants are live
//                    with no door at all; everything needing an address says why it cannot work here.
//   unwired-client   a client on a box with no door. NOTHING is connectable — the page must say so
//                    per assistant, with a reason, and render no button. Zero buttons is the pass.
//   wired-client     the hosted shape: address assistants live, stdio ones honestly absent.
//   wired-staff      everything on offer at once — the widest bijection.
import { navigateOrRefuse } from './headless-page.mjs'   // Page.navigate returns an errorText, and nothing read it
import { createServer } from 'node:http'
import { reapOnExit } from "../shared/reap-on-exit.mjs";   // — a detached group dies with this script
import { readFileSync, existsSync, rmSync } from 'node:fs'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { connectOffers, offersForWire } from '../shared/connect-clients.mjs'
import { stdioConnectOffer, stdioConnectFor, STDIO_SHAPES } from '../shared/stdio-connect.mjs'
import { browserRun } from "../shared/browser-temp-root.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(REPO, 'portal-ui', 'dist')
if (!existsSync(join(DIST, 'index.html'))) {
  console.error('ai-page-render-check: portal-ui/dist is not built. Run `npm run build:ui` first.')
  process.exit(2)
}
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' }

const ADDRESS = 'https://mcp.test.invalid/mcp'
// What the mint hands back. Recognisable and inert — the check greps the page for these exact strings,
// so they must be values no real deployment could produce.
const MINTED = { address: 'https://mcp.test.invalid/mcp', key: 'fixture-credential-1976-never-real' }

const STATES = {
  'local-staff': { role: 'staff', url: null },
  'unwired-client': { role: 'client', url: null },
  'wired-client': { role: 'client', url: ADDRESS },
  'wired-staff': { role: 'staff', url: ADDRESS },
}

/**
 * The mcp-access body for one deck, composed the way driver/portal-service.mjs composes it: staff get
 * this install's stdio routes, offers resolve through the one table, `steps` is dropped on the way out.
 */
function accessFor({ role, url }) {
  const stdio = role === 'staff' ? stdioConnectOffer({ workDir: null }) : null
  const offers = connectOffers({
    stdioRoutes: stdio
      ? Object.fromEntries(Object.keys(STDIO_SHAPES).map((shape) => [shape, stdioConnectFor(shape, { workDir: null })]))
      : {},
    publicAddress: url,
    operator: 'counsel@coastline.test',
  })
  return {
    url, keyUrl: null, email: 'counsel@coastline.test', enabled: !!url, stdio,
    // THE ROUTE'S OWN MAPPING, not a copy of it.
    offers: offersForWire(offers),
  }
}

let current = 'local-staff'
let mints = 0    // POSTs to /portal/api/connect-key since the last reset — a local press must never mint

const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname
  const json = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
  const s = STATES[current]
  if (path === '/portal/api/me') {
    // The deck's `role` names who is looking in the resolver's own terms; the wire carries the switches.
    return json({ permissions: { run: true, manage: s.role === 'staff' },
      email: 'counsel@coastline.test', accounts: s.role === 'staff' ? [] : ['coastline'],
      allAccounts: s.role === 'staff', accountNames: { coastline: 'Coastline Drinks' } })
  }
  if (path === '/portal/api/mcp-access') return json(accessFor(s))
  if (path === '/portal/api/connect-key' && req.method === 'POST') { mints++; return json(MINTED) }
  if (path === '/portal/admin/roster') return json({ customers: [{ key: 'coastline', name: 'Coastline Drinks' }] })
  if (path.startsWith('/portal/api/') || path.startsWith('/portal/admin/')) return json({})
  const file = path === '/' || (path.startsWith('/portal') && !path.includes('.')) ? '/index.html' : path.replace(/^\/portal/, '')
  const full = join(DIST, file)
  if (!existsSync(full)) { res.writeHead(404); res.end('no'); return }
  res.writeHead(200, { 'content-type': MIME[extname(full)] ?? 'application/octet-stream' })
  res.end(readFileSync(full))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`

// The profile goes inside a run root whose TMPDIR the browser inherits, so the singleton
// lock it writes there leaves with the root instead of accumulating in the shared one.
const { profile: userDir, env: chromeEnv } = browserRun("ai-page-check-")
const chrome = spawn('google-chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--user-data-dir=${userDir}`, '--window-size=1280,1000', '--remote-debugging-port=0', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: chromeEnv })
// — and the group dies with THIS script, on every exit it can observe.
// The teardown below runs on the paths somebody wrote a branch for; a cancelled CI job (SIGTERM),
// a Ctrl-C, or a throw elsewhere in this file are not among them — and that is where the measured
// eighty-eight-minute orphan came from.
reapOnExit(chrome);

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

// GRANT THE CLIPBOARD, RATHER THAN MEASURING THE DEGRADED PATH FOREVER.
//
// This was written asserting that headless Chrome grants clipboard writes here. It does not — measured,
// after the first run came back with every `copied` state false and every panel empty. Left alone, the
// instrument would have exercised only the browser-refused branch: the exception, on every deck, while
// claiming to check the page a reader actually meets.
//
// So the permission is granted explicitly and the ordinary path is what gets driven. The refused branch
// still has arms; it simply is not the only world this file can see.
await cmd('Browser.grantPermissions', {
  origin,
  permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
}).catch(() => {});
// AND THE DOCUMENT MUST BE FOCUSED. A clipboard write needs a focused document as well as the
// permission, which is why granting alone left every press on the refused path. Found independently by
// testing driving this page and by this file's first run coming back with every `copied` false.
await cmd('Page.bringToFront').catch(() => {});
const evalIn = async (expr) => (await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value

// ── The probes ───────────────────────────────────────────────────────────────────────────────────
//
// Everything is asked of `.screen` — the page's own root — so the shell's navigation cannot answer for
// the page. `key` below is the minted fixture credential, and no probe may ever find it on the page.
//
// POSITIONS ARE DOCUMENT-RELATIVE (top plus scroll). A press scrolls its target into view first, and a
// viewport-relative top would then read every element as having moved.
const HELP_URL = 'https://github.com/CordilleraSarl/clearotron/blob/main/mcp-server/CONNECT.md'
const HELP_LINK_TEXT = 'GitHub MCP Connector Documentation'
const WHERE_LABEL = {
  disk: 'Clearotron is installed on this machine (laptop/desktop)',
  'public-http': 'Clearotron is running elsewhere (e.g. Cloud/Server)',
}
const PLACES = ['disk', 'public-http']

// THE SIX WORDS are scanned on ARRIVAL only, deliberately. The steps a pick opens hand over `claude mcp
// add …`, an address and a key by design; what the ruling forbids is the page ASKING the reader to
// understand those words before anything is pressed. One line is exempt, by its exact text: the help
// link the owner dictated, which names the document by what a person searching for it would type.
const arrivalProbe = (expect) => `(async () => {
  const EXPECT = ${JSON.stringify(expect)}
  const flat = (s) => (s ?? '').replace(/\\s+/g, ' ').trim()
  const screen = document.querySelector('.screen')
  if (!screen) return { fatal: 'the page did not render a .screen at all' }
  const text = flat(screen.innerText)
  const outsideProbe = (el) => !el.closest('.ai-probe')
  return {
    // ANTI-VACUITY FIRST. Almost every assertion below is about something being ABSENT, and a deck that
    // failed to render satisfies all of them perfectly. The length is asserted before the absences.
    renderedChars: text.length,
    heading: text.includes('Use your own AI'),
    cards: [...screen.querySelectorAll('.where-card')].map((b) => flat(b.innerText)),
    rows: [...screen.querySelectorAll('button.ai-app')].map((b) => b.getAttribute('data-id')),
    openPanels: [...screen.querySelectorAll('.steps-panel[data-for]')].filter(outsideProbe).length,
    notice: /Not available on this installation yet/.test(text),
    operatorWordingOnPage: /incomplete|install it again/i.test(text),
    expandedPres: [...screen.querySelectorAll('pre')].filter(outsideProbe).length,
    bannedLines: screen.innerText.split('\\n').map(flat)
      .filter((l) => l !== EXPECT.link + ' ↗' && l !== EXPECT.link)
      .filter((l) => /\\b(MCP|connector|token|scope|address|key)\\b/i.test(l)),
    keyOnPage: text.includes(EXPECT.key),
    helpLink: !!screen.querySelector('a[href="' + EXPECT.url + '"][target="_blank"]'),
  }
})()`

const placeProbe = `(() => {
  const flat = (s) => (s ?? '').replace(/\\s+/g, ' ').trim()
  const screen = document.querySelector('.screen')
  const slot = screen.querySelector('.ai-slot')
  return {
    rows: [...screen.querySelectorAll('button.ai-app')].map((b) => ({ id: b.getAttribute('data-id'), name: flat(b.querySelector('.ai-app-name')?.innerText) })),
    notice: /Not available on this installation yet/.test(flat(screen.innerText)),
    emptyPanel: flat(screen.querySelector('.steps-panel-empty')?.innerText ?? ''),
    slotHeight: Math.round(slot?.getBoundingClientRect().height ?? 0),
    operatorWordingOnPage: /incomplete|install it again/i.test(flat(screen.innerText)),
  }
})()`

// Everything a pick or a press could push: headings, bullets, the cards, every row, and the help notice
// that sits BELOW the slot — the one element that moves if the slot grows, which is the reflow this
// page was rebuilt to end. Card sizes are recorded too: a card must not change size when picked.
const layoutProbe = `(() => {
  const at = (el) => Math.round(el.getBoundingClientRect().top + window.scrollY)
  const screen = document.querySelector('.screen')
  return {
    tops: [...screen.querySelectorAll('h1, h2, .ai-can li, .where-card, button.ai-app, .ai-help')].map(at),
    cards: [...screen.querySelectorAll('.where-card')].map((c) => { const r = c.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height) }),
  }
})()`

const panelProbe = (expect) => `(() => {
  const EXPECT = ${JSON.stringify(expect)}
  const flat = (s) => (s ?? '').replace(/\\s+/g, ' ').trim()
  const screen = document.querySelector('.screen')
  const panels = [...screen.querySelectorAll('.steps-panel[data-for]')].filter((el) => !el.closest('.ai-probe'))
  const panel = panels[0]
  const steps = panel ? [...panel.querySelectorAll('ol.steps > li')] : []
  return {
    panelCount: panels.length,
    panelFor: panel?.getAttribute('data-for') ?? null,
    // textContent, not innerText: the eyebrow is uppercased by CSS, and innerText reports the drawn case.
    head: flat(panel?.querySelector('.eyebrow')?.textContent) + ' ' + flat(panel?.querySelector('.steps-name')?.textContent),
    stepCount: steps.length,
    firstStepCopies: !!steps[0]?.querySelector('.codeblock, .secret-btn'),
    stepsPointingNowhere: steps.map((li) => flat(li.innerText)).filter((l) => /\\b(below|advanced)\\b/i.test(l)),
    stamp: /Checked \\d{4}|These steps name no button/.test(flat(panel?.innerText ?? '')),
    selectedElsewhere: [...screen.querySelectorAll('button.ai-app[aria-pressed="true"]')].filter((b) => b.getAttribute('data-id') !== EXPECT.id).length,
    keyAnywhere: flat(screen.innerText).includes(EXPECT.key),
    landed: /On your clipboard now/i.test(flat(panel?.innerText ?? '')),   // its label is uppercased by CSS
    masked: /••••/.test(flat(panel?.innerText ?? '')),
    copiedShown: !!panel?.querySelector('button.is-copied'),
    refused: /will not be shown again|would not let us copy/.test(flat(screen.innerText)),
  }
})()`

const click = (selector) => evalIn(`(async () => {
  const el = document.querySelector(${JSON.stringify(selector)})
  if (!el) return false
  el.click(); await new Promise((r) => setTimeout(r, 250)); return true
})()`)

// A REAL MOUSE PRESS for anything that writes the clipboard. A scripted click carries no user activation,
// and without it every press takes the browser-refused branch — which is how this file once measured the
// exception on every deck while claiming to check the page a reader meets.
async function realPress(selector) {
  const loc = await evalIn(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return null
    el.scrollIntoView({ block: 'center' })
    const b = el.getBoundingClientRect()
    return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }
  })()`)
  if (!loc) return false
  for (const type of ['mousePressed', 'mouseReleased']) {
    await cmd('Input.dispatchMouseEvent', { type, x: loc.x, y: loc.y, button: 'left', clickCount: 1 })
  }
  await new Promise((r) => setTimeout(r, 800))
  return true
}

let failures = 0
const ok = (cond, msg) => { if (!cond) { failures++; console.error(`  ✗ ${msg}`) } else console.log(`  ✓ ${msg}`) }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const shiftedBy = (a, b) => (a.length === b.length ? a.filter((t, i) => Math.abs(t - b[i]) > 1).length : -1)

// Across all decks, both kinds of Copy must actually run — a battery whose press arms all skipped would be
// green about nothing, which is this repository's oldest trap.
let blockPresses = 0
let secretPresses = 0
// HOW MANY PRESSES ACTUALLY REACHED THE CLIPBOARD. Lose the clipboard and every press quietly takes the
// browser-refused branch, where showing the credential is CORRECT by design; the battery would then pass
// while never once checking the page a reader actually meets. Why the first run of an earlier battery lost
// it was never established — three plants each failed to reproduce it — so zero is counted and named as an
// ENVIRONMENT failure rather than explained.
let clipboardReached = 0
let clipboardRefused = 0

const out = {}
for (const state of Object.keys(STATES)) {
  current = state
  mints = 0
  await cmd('Page.navigate', { url: 'about:blank' })
  await new Promise((r) => setTimeout(r, 150))
  await navigateOrRefuse(cmd, `${origin}/portal/ai`, { what: 'ai-page-render-check' })
  await new Promise((r) => setTimeout(r, 1400))

  const access = accessFor(STATES[state])
  const served = access.offers.filter((o) => o.served)
  const servedOn = (place) => served.filter((o) => o.route === place)
  const routes = PLACES.filter((p) => servedOn(p).length)
  // The page's own rule, restated so the check can hold it to it: the cards show wherever the disk route
  // is served (the people who run the install), both of them, even with no public address.
  const asks = routes.includes('disk')

  const r = await evalIn(arrivalProbe({ key: MINTED.key, link: HELP_LINK_TEXT, url: HELP_URL }))
  out[state] = { arrival: r }
  console.log(`\n${state}:`)
  if (r?.fatal) { failures++; console.error(`  ✗ ${r.fatal}`); continue }

  ok(r.heading, 'the page rendered at all')
  ok(r.renderedChars > 300, `the deck rendered real text (${r.renderedChars} chars) — every absence below is worthless without this`)
  ok(same(r.cards, asks ? PLACES.map((p) => WHERE_LABEL[p]) : []),
    `the where-cards show ${asks ? 'both, with the approved labels' : 'not at all'} (saw ${JSON.stringify(r.cards)})`)
  // Nothing below the cards until one is picked; with no cards, the one route's list opens directly.
  const arrivingRows = asks ? [] : (routes[0] ? servedOn(routes[0]).map((o) => o.id) : [])
  ok(same(r.rows, arrivingRows), `the arriving rows are exactly ${JSON.stringify(arrivingRows)} (saw ${JSON.stringify(r.rows)})`)
  ok(r.notice === (served.length === 0), `the "not available" notice shows iff nothing is served (served: ${served.length}, notice: ${r.notice})`)
  // RULING 3: an unserved row does not render for a client at all — checked by the operator-only WORDING,
  // because a client on a hosted install has every disk route unserved and must read none of it.
  ok(!r.operatorWordingOnPage, 'the operator-only "incomplete / install it again" wording stays off a reader\'s page')
  ok(r.openPanels === 0, `no app's steps are open on arrival (saw ${r.openPanels})`)
  ok(r.expandedPres === 0, `nothing is expanded on arrival (saw ${r.expandedPres} open block(s))`)
  ok(r.bannedLines.length === 0,
    `none of the six banned words reaches the arriving reader, from either side of the wire (saw ${JSON.stringify(r.bannedLines)})`)
  ok(!r.keyOnPage, 'no credential is on the page before any press')
  ok(r.helpLink, 'the help link to the full setup instructions is on the page, opening in a new tab')

  for (const place of asks ? PLACES : routes) {
    if (asks) {
      const before = await evalIn(layoutProbe)
      await click(`.where-card[data-place="${place}"]`)
      const after = await evalIn(layoutProbe)
      ok(same(before.cards, after.cards), `the cards keep their size when "${place}" is picked (${JSON.stringify(before.cards)} → ${JSON.stringify(after.cards)})`)
    }
    const here = servedOn(place)
    const p = await evalIn(placeProbe)
    out[state][place] = { place: p }
    if (!here.length) {
      // Only reachable under a card: the web card on an install with no public address.
      ok(p.notice && p.rows.length === 0, `"${place}" with nothing served shows the notice and no list (notice: ${p.notice}, rows: ${p.rows.length})`)
      continue
    }
    ok(same(p.rows.map((x) => x.id), here.map((o) => o.id)),
      `"${place}" lists exactly what the resolver serves there, in the table's order (saw ${JSON.stringify(p.rows.map((x) => x.id))})`)
    ok(new Set(p.rows.map((x) => x.name)).size === p.rows.length, `every row on "${place}" has its own name`)
    ok(p.emptyPanel === 'Select AI to see instructions', `before a pick the panel says what to do (saw "${p.emptyPanel}")`)
    ok(p.slotHeight >= 120, `the slot reserves space before anything is picked (${p.slotHeight}px)`)
    ok(!p.operatorWordingOnPage, `no operator-only wording on "${place}"`)

    const base = (await evalIn(layoutProbe)).tops
    const pick = async (o) => {
      await click(`button.ai-app[data-id="${o.id}"]`)
      return evalIn(panelProbe({ id: o.id, key: MINTED.key }))
    }
    // EVERY ROW, not a sample: the slot is sized to the tallest panel on the card, and the only way to know
    // it is tall enough is to open every panel and see that nothing around it moved.
    for (const o of here) {
      const before = mints
      const s = await pick(o)
      out[state][`${place} ${o.id}`] = s
      const tops = (await evalIn(layoutProbe)).tops
      ok(shiftedBy(base, tops) === 0, `picking "${o.name}" on "${place}" moved nothing (${shiftedBy(base, tops)} element(s) shifted)`)
      ok(s.panelCount === 1 && s.panelFor === o.id, `the panel that opened is "${o.id}"'s, and only it (saw ${s.panelCount}, ${s.panelFor})`)
      ok(s.head === `Steps for ${o.name}`, `the panel is headed "Steps for ${o.name}" (saw "${s.head}")`)
      ok(s.stepCount === o.steps.length && s.firstStepCopies, `all ${o.steps.length} steps render and step 1 is the copy (saw ${s.stepCount}, copy: ${s.firstStepCopies})`)
      ok(s.stepsPointingNowhere.length === 0, `no step points at a section this page does not have: ${JSON.stringify(s.stepsPointingNowhere)}`)
      ok(!s.stamp, 'no checked or unchecked stamp')
      ok(s.selectedElsewhere === 0, `no other row is still selected (${s.selectedElsewhere})`)
      ok(mints === before, `picking a row mints nothing (saw ${mints - before})`)
      ok(!s.keyAnywhere, 'no credential on the page after a pick')
    }

    // ONE BLOCK AND ONE SECRET PRESS PER PLACE, where the place has them. A block needs no server; a secret
    // mints exactly once, lands masked, and is nowhere on the page.
    const blockRow = here.find((o) => o.steps.some((st) => st.copy?.kind === 'block'))
    if (blockRow) {
      const i = blockRow.steps.findIndex((st) => st.copy?.kind === 'block')
      await pick(blockRow)
      const before = mints
      blockPresses++
      await realPress(`.ai-slot > .steps-panel[data-for="${blockRow.id}"] button[data-step="${i}"]`)
      const s = await evalIn(panelProbe({ id: blockRow.id, key: MINTED.key }))
      const tops = (await evalIn(layoutProbe)).tops
      if (s.refused) clipboardRefused++; else clipboardReached++
      ok(shiftedBy(base, tops) === 0, `pressing Copy on "${blockRow.name}" moved nothing (${shiftedBy(base, tops)} shifted)`)
      ok(s.copiedShown || s.refused, `the pressed Copy is its own confirmation (copied: ${s.copiedShown}, refused: ${s.refused})`)
      ok(mints === before, `a block needs no key, but ${mints - before} were made`)
      ok(!s.keyAnywhere, 'no credential on the page after a block press')
    }
    const secretRow = here.find((o) => o.steps.some((st) => st.copy?.kind === 'secret'))
    if (secretRow) {
      const i = secretRow.steps.findIndex((st) => st.copy?.kind === 'secret')
      await pick(secretRow)
      const before = mints
      secretPresses++
      await realPress(`.ai-slot > .steps-panel[data-for="${secretRow.id}"] button[data-step="${i}"]`)
      const s = await evalIn(panelProbe({ id: secretRow.id, key: MINTED.key }))
      const tops = (await evalIn(layoutProbe)).tops
      out[state][`${place} press ${secretRow.id}`] = s
      if (s.refused) clipboardRefused++; else clipboardReached++
      ok(shiftedBy(base, tops) === 0, `pressing "${secretRow.name}"'s key button moved nothing (${shiftedBy(base, tops)} shifted)`)
      ok(mints === before + 1, `the press mints exactly once (saw ${mints - before})`)
      if (!s.refused) {
        ok(s.landed && s.masked, `the panel says what landed, masked (landed: ${s.landed}, masked: ${s.masked})`)
        // THE CREDENTIAL IS IN THE DOM ONLY ON THE CLIPBOARD-REFUSED PATH. Both halves are asserted: "no
        // key" alone would pass a panel that showed nothing at all.
        ok(!s.keyAnywhere, 'the clipboard took the credential and it is nowhere on the page')
      }
    }
  }
}

ok(clipboardReached > 0,
  `at least one press reached the clipboard (${clipboardReached} reached, ${clipboardRefused} refused). `
  + 'Zero means this browser stopped granting the clipboard, and the battery has then been asserting the '
  + 'refused fallback on every deck while looking exactly like a pass — an environment failure, not a page regression.')
ok(blockPresses > 0, `at least one deck pressed a block's Copy (saw ${blockPresses})`)
ok(secretPresses > 0, `at least one deck pressed a key-bearing Copy (saw ${secretPresses})`)

console.log(`\n${JSON.stringify(out, null, 2)}`)
try { process.kill(-chrome.pid, 'SIGKILL') } catch { /* already gone */ }
server.close()
rmSync(userDir, { recursive: true, force: true })
console.log(failures ? `\n${failures} failed` : `\nthe AI page draws correctly in all ${Object.keys(STATES).length} states`)
process.exit(failures ? 1 : 0)
