// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// ai-page-render-check.mjs — the "Use your AI" page, drawn in a real browser, in the states a reader
// actually meets (tracker issues 1938, 1976).
//
//   node scripts/ai-page-render-check.mjs
//
// WHY A BROWSER AND NOT A STRING TEST. The owner pressed all four Connect buttons on the test portal and
// said "none of them do anything". Nothing was broken in any file: each piece was correct and the fault
// was the RELATION between them at run time. portal-ui carries no DOM, so this is where the question
// "does a press leave a reader looking at anything" can be asked at all.
//
// WHAT THIS FILE ASSERTS SINCE THE RUTHLESS CUT (owner ruling, 2026-08-31). The page renders what
// `/portal/api/mcp-access` hands it and derives nothing, so the browser questions are relational:
//
//   · a button renders EXACTLY for each assistant this deployment serves — no silent drop, no button
//     over an assistant that cannot work (that is now a sentence with a reason and a remedy)
//   · nothing is expanded on arrival, and none of the six banned words is on the arriving page —
//     including the strings the SERVER sends, which is the side a source test of the page cannot see
//   · a press on a local-command assistant shows that assistant's own line and NEVER talks to the
//     key-minting endpoint
//   · a press on an address assistant mints once, and the credential reaches the DOM in exactly one
//     world: the browser refused the clipboard and the page said so, once, with "will not be shown
//     again". If the clipboard took it, the page says "Copied" and the credential is nowhere.
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
import { createServer } from 'node:http'
import { reapOnExit } from "../shared/reap-on-exit.mjs";   // — a detached group dies with this script
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { connectOffers, offersForWire } from '../shared/connect-clients.mjs'
import { stdioConnectOffer, stdioConnectFor, STDIO_SHAPES } from '../shared/stdio-connect.mjs'

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
    operator: 'counsel@zephyr.com',
  })
  return {
    url, keyUrl: null, email: 'counsel@zephyr.com', enabled: !!url, stdio,
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
    return json({ role: s.role, email: 'counsel@zephyr.com', accounts: s.role === 'staff' ? [] : ['zephyr'],
      allAccounts: s.role === 'staff', accountNames: { zephyr: 'Zephyr Beverages' } })
  }
  if (path === '/portal/api/mcp-access') return json(accessFor(s))
  if (path === '/portal/api/connect-key' && req.method === 'POST') { mints++; return json(MINTED) }
  if (path === '/portal/admin/roster') return json({ customers: [{ key: 'zephyr', name: 'Zephyr Beverages' }] })
  if (path.startsWith('/portal/api/') || path.startsWith('/portal/admin/')) return json({})
  const file = path === '/' || (path.startsWith('/portal') && !path.includes('.')) ? '/index.html' : path.replace(/^\/portal/, '')
  const full = join(DIST, file)
  if (!existsSync(full)) { res.writeHead(404); res.end('no'); return }
  res.writeHead(200, { 'content-type': MIME[extname(full)] ?? 'application/octet-stream' })
  res.end(readFileSync(full))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`

const userDir = mkdtempSync(join(tmpdir(), 'ai-page-check-'))
const chrome = spawn('google-chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--user-data-dir=${userDir}`, '--window-size=1280,1000', '--remote-debugging-port=0', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'], detached: true })
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
// role-e2e driving this page and by this file's first run coming back with every `copied` false.
await cmd('Page.bringToFront').catch(() => {});
const evalIn = async (expr) => (await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value

// ── The probes ───────────────────────────────────────────────────────────────────────────────────
//
// Everything is asked of `.screen` — the page's own root — so the shell's navigation cannot answer for
// the page. `key` below is the minted fixture credential, and the arrival probe must never find it.
//
// THE SIX WORDS are scanned on ARRIVAL only, deliberately. The one sanctioned technical artifact is the
// line a press hands over (`claude mcp add …`, a config block naming the server path); it appears only
// inside a pressed-open expansion, and banning its vocabulary would ban the feature. What the ruling
// forbids is the page ASKING the reader to understand those words before anything is pressed.
const arrivalProbe = (expect) => `(async () => {
  const EXPECT = ${JSON.stringify(expect)}
  const flat = (s) => (s ?? '').replace(/\\s+/g, ' ').trim()
  const screen = document.querySelector('.screen')
  if (!screen) return { fatal: 'the page did not render a .screen at all' }
  const text = flat(screen.innerText)
  const dests = [...screen.querySelectorAll('button.ai-dest')]
  return {
    // ANTI-VACUITY FIRST, and it is not decoration. Every assertion below this line is about something
    // being ABSENT — no banned word, no unserved row, no credential, nothing expanded — and a deck that
    // failed to render satisfies all of them perfectly. The length is asserted before the absences.
    renderedChars: text.length,
    destNames: dests.map((d) => flat(d.querySelector('.ai-dest-name')?.childNodes[0]?.textContent ?? '')),
    destCount: dests.length,
    // RULING 3: an unserved row does not render for a client at all. Checked by the OPERATOR-ONLY
    // wording rather than by name, because one product legitimately appears on two routes and a
    // name-based test could not tell a served Claude from an unserved one.
    operatorWordingOnPage: /incomplete|install it again/i.test(text),
    questionShown: !!screen.querySelector('.ai-where-q'),
    // Nothing is expanded on arrival: the slot holds its empty line, not a panel.
    panelsOnArrival: [...screen.querySelectorAll('.ai-panel')].length,
    slotPresent: !!screen.querySelector('.ai-slot'),
    // THE SLOT'S HEIGHT BEFORE ANYTHING IS SELECTED, which is the only thing that makes "reserved" mean
    // anything. Asserting that nothing above the panel moves is VACUOUS on this layout — the panel is
    // the last element, so nothing above it can move whether or not space was reserved. Measured after
    // planting min-height:0 and watching the whole battery stay green.
    slotHeightOnArrival: Math.round(screen.querySelector('.ai-slot')?.getBoundingClientRect().height ?? 0),
    expandedPres: [...screen.querySelectorAll('pre')].length,
    bannedLines: screen.innerText.split('\\n').map(flat).filter((l) => /\\b(MCP|connector|token|scope|address|key)\\b/i.test(l)),
    keyOnPage: text.includes(EXPECT.key),
    helpLink: !!screen.querySelector('a[href="/portal/connect-help"]'),
    heading: text.includes('Use your own AI'),
  }
})()`

// BY ID, NOT BY NAME. The cowork/claude merge means one product legitimately appears on two routes
// under one name — "Claude · app, web, and Cowork" and "Claude · app, on this computer" — so a
// name-based lookup silently picks whichever came first. It picked the stdio row on the first run while
// the arm believed it was pressing the web one.
const readProbe = (id, expect) => `(async () => {
  const EXPECT = ${JSON.stringify(expect)}
  const flat = (s) => (s ?? '').replace(/\\s+/g, ' ').trim()
  const screen = document.querySelector('.screen')
  const rows = [...screen.querySelectorAll('button.ai-dest')]
  const row = rows.find((d) => d.getAttribute('data-id') === ${JSON.stringify(id)})
  if (!row) return { fatal: 'the pressed row vanished: ' + ${JSON.stringify(id)} }
  const movedAfter = [...screen.querySelectorAll('h1, h2, .ai-can li, button.ai-dest')]
    .map((el) => Math.round(el.getBoundingClientRect().top))
  const panel = screen.querySelector('.ai-panel')
  const steps = [...screen.querySelectorAll('.ai-panel-steps li')].map((li) => flat(li.innerText))
  return {
    movedAfter,
    panelFor: panel?.getAttribute('data-for') ?? null,
    panelCount: [...screen.querySelectorAll('.ai-panel')].length,
    copiedOnPressed: row.hasAttribute('data-copied'),
    copiedElsewhere: rows.filter((d) => d !== row && d.hasAttribute('data-copied')).length,
    selectedElsewhere: rows.filter((d) => d !== row && d.hasAttribute('data-selected')).length,
    steps,
    stepsPointingNowhere: steps.filter((l) => /\\bbelow\\b/.test(l)),
    stampShown: !!screen.querySelector('.ai-panel-stamp'),
    stampDated: /Checked \\d{4}-\\d{2}-\\d{2}/.test(flat(screen.querySelector('.ai-panel-stamp')?.innerText ?? '')),
    landedShown: /On your clipboard now/.test(flat(panel?.innerText ?? '')),
    keyAnywhere: flat(screen.innerText).includes(EXPECT.key),
    maskedShown: /••••/.test(flat(panel?.innerText ?? '')),
    refusedPath: /will not be shown again/.test(flat(screen.innerText)),
  }
})()`

const pressProbe = (id, name, expect) => `(async () => {
  const EXPECT = ${JSON.stringify(expect)}
  const flat = (s) => (s ?? '').replace(/\\s+/g, ' ').trim()
  const screen = document.querySelector('.screen')
  const rows = [...screen.querySelectorAll('button.ai-dest')]
  const row = rows.find((d) => d.getAttribute('data-id') === ${JSON.stringify(id)})
  if (!row) return { fatal: 'no destination row with id ' + ${JSON.stringify(id)} + ' (rows: ' + rows.map((d) => d.getAttribute('data-id')).join(', ') + ')' }

  // THE STRUCTURAL CLAIM IS A MEASUREMENT, NOT AN OPINION. The owner met the old page as "new links
  // open and move shit around", and single-select plus a reserved slot is the mechanism that answers it.
  // So the position of everything above the slot is recorded BEFORE the press and compared after.
  const above = [...screen.querySelectorAll('h1, h2, .ai-can li, button.ai-dest')]
    .map((el) => Math.round(el.getBoundingClientRect().top))

  // NO row.click() HERE. A scripted click carries no USER ACTIVATION, and navigator.clipboard requires
  // it — so a synthetic press always took the browser-refused branch and this file was measuring the
  // exception on every deck while claiming to check the page a reader meets. Granting the permission was
  // not enough; activation is a separate gate. The caller dispatches a real mouse press at these
  // coordinates through Input.dispatchMouseEvent, and this probe is split around it.
  const box = row.getBoundingClientRect()
  window.__aiPress = { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) }
  return { locate: true, x: window.__aiPress.x, y: window.__aiPress.y, above }

  const movedAfter = [...screen.querySelectorAll('h1, h2, .ai-can li, button.ai-dest')]
    .map((el) => Math.round(el.getBoundingClientRect().top))
  const shifted = above.length === movedAfter.length
    ? above.filter((t, i) => Math.abs(t - movedAfter[i]) > 1).length
    : -1

  const panel = screen.querySelector('.ai-panel')
  const steps = [...screen.querySelectorAll('.ai-panel-steps li')].map((li) => flat(li.innerText))
  return {
    shifted,
    panelFor: panel?.getAttribute('data-for') ?? null,
    panelCount: [...screen.querySelectorAll('.ai-panel')].length,
    // A press marks the row it was made on and no other.
    copiedOnPressed: row.hasAttribute('data-copied'),
    copiedElsewhere: rows.filter((d) => d !== row && d.hasAttribute('data-copied')).length,
    selectedElsewhere: rows.filter((d) => d !== row && d.hasAttribute('data-selected')).length,
    steps,
    // A STEP MAY NOT POINT AT SOMETHING THAT IS NOT THERE. These steps were written for a surface that
    // rendered the address and the credential underneath them; this page renders neither. A step saying
    // "below" is an instruction to look at nothing. The word boundary is DOUBLE-escaped deliberately:
    // this probe is a template literal, so a single backslash-b is the BACKSPACE escape and the pattern
    // would silently match nothing — which is how it was written first.
    stepsPointingNowhere: steps.filter((l) => /\\bbelow\\b/.test(l)),
    stampShown: !!screen.querySelector('.ai-panel-stamp'),
    stampDated: /Checked \\d{4}-\\d{2}-\\d{2}/.test(flat(screen.querySelector('.ai-panel-stamp')?.innerText ?? '')),
    landedShown: /On your clipboard now/.test(flat(panel?.innerText ?? '')),
    // THE CREDENTIAL IS IN THE DOM ONLY ON THE CLIPBOARD-REFUSED PATH. Headless Chrome grants the
    // clipboard here, so this must be false on every deck; the masked proof line is not the credential.
    keyAnywhere: flat(screen.innerText).includes(EXPECT.key),
    maskedShown: /••••/.test(flat(panel?.innerText ?? '')),
  }
})()`

// The segment labels, as the page renders them. MIRRORED, and pinned by the arm at the end of this file
// so the two cannot drift silently — a stale label here would make the route switch a no-op and every
// address press would quietly test the wrong row.
const WHERE_LABEL = { disk: 'On this computer', either: 'On this computer', 'public-http': 'Somewhere else' }

let failures = 0
const ok = (cond, msg) => { if (!cond) { failures++; console.error(`  ✗ ${msg}`) } else console.log(`  ✓ ${msg}`) }
const sameMembers = (a, b) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i])

// Across all decks, both press kinds must actually run — a battery whose press arms all skipped would
// be green about nothing, which is this repository's oldest trap.
let commandPresses = 0
let addressPresses = 0

const out = {}
for (const state of Object.keys(STATES)) {
  current = state
  mints = 0
  await cmd('Page.navigate', { url: 'about:blank' })
  await new Promise((r) => setTimeout(r, 150))
  await cmd('Page.navigate', { url: `${origin}/portal/ai` })
  await new Promise((r) => setTimeout(r, 1400))

  const access = accessFor(STATES[state])
  const served = access.offers.filter((o) => o.served)
  const absent = access.offers.filter((o) => !o.served)

  const r = await evalIn(arrivalProbe({ absent: absent.map((a) => ({ name: a.name, reason: a.reason })), key: MINTED.key }))
  out[state] = { arrival: r }
  console.log(`\n${state}:`)
  if (r?.fatal) { failures++; console.error(`  ✗ ${r.fatal}`); continue }

  // ANTI-VACUITY BEFORE EVERY ABSENCE. Most of what follows asserts that something is NOT on the page,
  // and a deck that rendered nothing satisfies all of it. Four of us hit exactly this shape today on
  // four different surfaces, so it is checked first and by measurement rather than by eye.
  ok(r.heading, 'the page rendered at all')
  ok(r.renderedChars > 400, `the deck rendered real text (${r.renderedChars} chars) — every absence below is worthless without this`)

  // ── THE ASSERTION THAT REPLACED "A BUTTON PER ASSISTANT" ────────────────────────────────────────
  // That one died with the button grid, and it is replaced rather than deleted (the brief's own
  // instruction). What survives is the property it protected: the page shows exactly what the resolver
  // says this deployment serves — no silent drop, and nothing invented.
  //
  // Grouped by route now, so the arriving deck shows the DEFAULT route's rows: the one that needs
  // nothing leads where the deployment has it.
  const routes = [...new Set(served.map((o) => o.route ?? 'public-http'))]
  const lead = routes.includes('disk') ? 'disk' : routes[0]
  const onLead = served.filter((o) => (o.route ?? 'public-http') === lead)
  ok(sameMembers(r.destNames, onLead.map((o) => o.name)),
    `a destination renders EXACTLY for each assistant this deck serves on the leading route `
    + `(saw ${JSON.stringify(r.destNames)}; the resolver says ${JSON.stringify(onLead.map((o) => o.name))})`)

  // ── RULING 3, AND IT IS THE HIGHEST-VALUE LINE IN THIS FILE ─────────────────────────────────────
  // On a healthy hosted install three rows resolve unserved carrying "this copy of the software is
  // incomplete… whoever installed it will need to install it again". That is the operator's case reused
  // for a reader with no shell, and a paying client read it as their software being broken. It must not
  // reach a client by any surface, so this checks the WORDING rather than the row: one product appears
  // on two routes, and a name-based check could not tell a served Claude from an unserved one.
  ok(!r.operatorWordingOnPage,
    'the operator-only "incomplete / install it again" wording stays off a reader\'s page '
    + `(present: ${r.operatorWordingOnPage}) — a client reading it was the defect the redesign retires`)
  ok(r.destCount === onLead.length,
    `no extra row rendered beyond what the resolver serves (${r.destCount} rendered, ${onLead.length} served)`)

  // ── THE PAGE ASKS AS MANY QUESTIONS AS THE DEPLOYMENT LEAVES OPEN ───────────────────────────────
  ok(r.questionShown === (routes.length > 1),
    `the "where does your assistant run?" question renders iff the served offers span more than one `
    + `route (routes: ${JSON.stringify(routes)}, question shown: ${r.questionShown})`)

  ok(r.panelsOnArrival === 0, `nothing is expanded on arrival (saw ${r.panelsOnArrival} panel(s))`)
  // The slot exists only where there is something to select. A deployment serving nothing renders one
  // sentence and no control, so requiring a slot there would fail the honest state.
  ok(r.slotPresent === (served.length > 0),
    `the reserved slot renders iff this deck has something to pick (served: ${served.length}, slot: ${r.slotPresent})`)
  // AND IT RESERVES SPACE WHILE EMPTY. This is the assertion that actually holds the design: a slot with
  // no height is not reserved, it just happens to sit below everything. 120px is well under the panel's
  // real size and well above an empty box, so it fails on a removed reservation and not on a reflow.
  if (r.slotPresent) {
    ok(r.slotHeightOnArrival >= 120,
      `the slot reserves space before anything is picked (${r.slotHeightOnArrival}px) — without it the `
      + 'page grows under the reader when they select, which is the reflow this redesign removes')
  }
  ok(r.expandedPres === 0, `nothing is expanded on arrival (saw ${r.expandedPres} open block(s))`)
  ok(r.bannedLines.length === 0,
    `none of the six banned words reaches the arriving reader — from either side of the wire (saw ${JSON.stringify(r.bannedLines)})`)
  ok(!r.keyOnPage, 'no credential is on the page before any press')
  ok(r.helpLink, 'the one link to the by-hand instructions is on the page')

  // ── A PRESS, AND THE STRUCTURAL CLAIM THAT COMES WITH IT ───────────────────────────────────────
  //
  // Every press on every deck asserts the same three things, because they are the rebuild's whole
  // promise: nothing above the panel moves, the pressed row is the confirmation, and no other row
  // claims to be. The route-specific arms follow.
  const pressArm = async (offer, kind) => {
    const before = mints
    // THE ROW MAY NOT BE ON THE ROUTE THE DECK IS SHOWING. Grouping means only the leading route's rows
    // render, so an address offer on a staff deck sits behind the question until it is answered. Pressing
    // the segment first is not a workaround — it is the path a staff reader takes, and it exercises the
    // question this page asks.
    await evalIn(`(async () => {
      const want = ${JSON.stringify(WHERE_LABEL[offer.route ?? 'public-http'] ?? 'Somewhere else')}
      const seg = [...document.querySelectorAll('.ai-seg-btn')].find((b) => b.innerText.trim() === want)
      if (seg && !seg.hasAttribute('data-on')) { seg.click(); await new Promise((r) => setTimeout(r, 250)) }
      return true
    })()`)
    const loc = await evalIn(pressProbe(offer.id, offer.name, { command: offer.command, key: MINTED.key, address: MINTED.address }))
    if (loc?.fatal) { failures++; console.error(`  ✗ ${loc.fatal}`); return }

    // A REAL MOUSE PRESS, so the page gets user activation and the clipboard is actually reachable.
    for (const type of ['mousePressed', 'mouseReleased']) {
      await cmd('Input.dispatchMouseEvent', { type, x: loc.x, y: loc.y, button: 'left', clickCount: 1 })
    }
    await new Promise((r) => setTimeout(r, 800))

    const p = await evalIn(readProbe(offer.id, { key: MINTED.key }))
    out[state][`press ${offer.name}`] = p
    if (p?.fatal) { failures++; console.error(`  ✗ ${p.fatal}`); return }
    p.shifted = loc.above.length === p.movedAfter.length
      ? loc.above.filter((t, i) => Math.abs(t - p.movedAfter[i]) > 1).length
      : -1

    // THE CLAIM THE OWNER MADE THE COMPLAINT ABOUT — "new links open and move shit around" — measured
    // as pixels rather than asserted as a design intent. Every heading, bullet and destination row is
    // recorded before the press and compared after; a single one moving is a failure.
    ok(p.shifted === 0,
      `nothing above the panel moved when "${offer.name}" was pressed (${p.shifted} element(s) shifted)`);
    ok(p.panelCount <= 1, `at most one panel is open at a time (saw ${p.panelCount}) — single-select is the mechanism`)
    ok(p.panelFor === offer.id, `the panel that opened is the one pressed (saw ${p.panelFor}, expected ${offer.id})`)

    // The pressed control IS the confirmation, and only the pressed one.
    ok(p.copiedOnPressed,
      `the pressed row IS the confirmation for "${offer.name}" (marked: ${p.copiedOnPressed}, refused-clipboard path: ${p.refusedPath})`)
    ok(p.copiedElsewhere === 0, `and no other row claims to have been copied (${p.copiedElsewhere} did)`)
    ok(p.selectedElsewhere === 0, `and no other row is still selected (${p.selectedElsewhere} were) — the list is single-select`)

    ok(p.steps.length > 0, `pressing "${offer.name}" shows that assistant's own steps`)
    ok(p.stepsPointingNowhere.length === 0,
      `no step points the reader "below" at something this page does not render: ${JSON.stringify(p.stepsPointingNowhere)}`)

    // A DRIVEN ROW CARRIES A DATE AND AN UNDRIVEN ONE MUST NOT. A stamp defaulted onto steps nobody
    // opened would be this product's own defect class wearing the costume of evidence.
    ok(p.stampShown, `the panel for "${offer.name}" says whether anybody has driven these steps`)
    ok(p.stampDated === Boolean(offer.verifiedOn),
      `the dated stamp is shown iff the resolver's row was driven (row says ${JSON.stringify(offer.verifiedOn ?? null)}, panel dated: ${p.stampDated})`)

    if (kind === 'local') {
      ok(mints === before, `the local route needs no server, but ${mints - before} mint(s) were made`)
      ok(!p.keyAnywhere, 'no credential is anywhere on the page after a local press')
    } else {
      ok(mints === before + 1, `pressing "${offer.name}" mints exactly once (saw ${mints - before})`)
      ok(p.landedShown, 'the panel says what landed on the clipboard, so the press has visible proof')
      // THE CREDENTIAL IS IN THE DOM ONLY ON THE CLIPBOARD-REFUSED PATH. Headless Chrome grants the
      // clipboard, so the refused path is unreachable here and the credential must be absent — while the
      // MASKED proof line is present. Both are asserted: "no key" alone would pass a panel that showed
      // nothing at all, which is the shape this file has been bitten by before.
      ok(!p.keyAnywhere, 'the clipboard took the credential and it is nowhere on the page')
      ok(p.maskedShown, 'and it is MASKED — proof of the copy, never the credential itself')
    }
  }

  const local = served.find((o) => o.command)
  if (local) { commandPresses++; await pressArm(local, 'local') }

  const addressed = served.find((o) => !o.command)
  if (addressed) { addressPresses++; await pressArm(addressed, 'address') }
}


ok(commandPresses > 0, `at least one deck exercised the local-command press (saw ${commandPresses})`)
ok(addressPresses > 0, `at least one deck exercised the address press (saw ${addressPresses})`)

console.log(`\n${JSON.stringify(out, null, 2)}`)
try { process.kill(-chrome.pid, 'SIGKILL') } catch { /* already gone */ }
server.close()
rmSync(userDir, { recursive: true, force: true })
console.log(failures ? `\n${failures} failed` : `\nthe AI page draws correctly in all ${Object.keys(STATES).length} states`)
process.exit(failures ? 1 : 0)
