// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// ai-page-render-check.mjs — the "Connect your AI" page, drawn in a real browser, in the states a reader
// actually meets.
//
//   node scripts/ai-page-render-check.mjs [--shot-dir <dir>]
//
// WHY A BROWSER AND NOT A STRING TEST. The owner pressed all four Connect buttons on the test portal and
// said "none of them do anything". Nothing was broken in any file: each piece was correct and the fault
// was the RELATION between them at run time. portal-ui carries no DOM, so this is where the question
// "does a press leave a reader looking at anything" can be asked at all.
//
// WHAT THIS FILE ASSERTS. The page renders what `/portal/api/mcp-access` hands it and derives nothing, so
// the browser questions are relational:
//
//   · the where-cards show, with the approved labels, exactly where the install serves the disk route —
//     and nothing shows below them until one is picked; without them the one route's list opens directly
//   · each card lists EXACTLY the apps the resolver serves there, and a card with none says why
//   · nothing is expanded on arrival, and none of the six banned words is on the arriving page — including
//     the strings the SERVER sends
//   · the pill says what the log answered, and with no answer there is no pill and no word about it
//   · picking ANY row, and pressing Copy, moves nothing: every heading, card, row and the help notice below
//     the panel is measured before and after, in document coordinates
//   · a block's Copy never talks to the key-minting endpoint; a key-bearing Copy mints once, lands masked,
//     and the credential reaches the DOM only in the world where the browser refused the clipboard
//   · beside a sign-in door, the key door's steps sit in a closed fold only where a key door exists, and
//     its "Copy address" puts THAT door's address on the clipboard, never the sign-in host's
//   · once connected the steps fold under "Setup steps", and a reader who came from a report is offered
//     the way back to it
//
// THE FIXTURES HAVE ONE AUTHOR. Each deck's `/portal/api/mcp-access` body is composed through
// `shared/connect-clients.mjs` and `shared/stdio-connect.mjs` — the same resolvers the real handler
// calls — with only the deployment facts (role, door address, key door, what the log answered) varying
// per deck. Hand-written offer rows here would be a second author of the wire shape, which is exactly
// what this check exists to catch: its previous fixtures served the pre-1976 `{enabled, url, keyUrl}`
// shape long after the server had moved to `offers`, and every deck failed with "the Connect buttons did
// not render". The handler's own output shape is pinned by driver/test/portal-service.test.mjs; the
// composition below follows it.
//
// THE DECKS are the axes the resolver and the page answer to — who is looking (staff get this box's stdio
// routes, clients never do), whether the client door is standing, WHAT THAT DOOR ANSWERS, whether a key
// door stands beside it, and whether the reader's assistant has been seen calling:
//
//   local-staff        a fresh local install, the reader is the operator, whose local record says they
//                      connected. The stdio assistants are live and folded away; everything needing an
//                      address says why it cannot work here.
//   unwired-client     a client on a box with no door. NOTHING is connectable — the page must say so,
//                      and render no button. Zero buttons is the pass.
//   wired-client       the hosted shape, behind an identity provider, and not connected yet: the steps
//                      say to sign in, no key is minted for a door that would refuse it, and with no key
//                      door there is no fold.
//   wired-client-key   the same, with a key door deployed beside it: its steps in a closed fold.
//   wired-client-done  the same, connected: the pill says so and the steps fold under "Setup steps".
//   wired-staff        a self-hosted door that takes a key, with the stdio routes as well — the deck where
//                      a key-bearing Copy exists on the steps themselves.
//   silent-door        served, the door could not be read, and neither could the log: no pill, no word
//                      about the connection, and both ways shown rather than a guess at one.
//
// THE DOOR IS A DECK FACT, not an omission. It arrived with the probe that reads it, and the fixture
// went on composing without it — so every deck resolved the unknown branch, the key-bearing steps
// existed on no deck at all, and the five assertions that press one silently stopped running. Only the
// floor under the population said anything. That is the same drift the paragraph above describes, in
// the same function, one axis later: a fixture that composes through the real resolver still has to
// hand it the facts the real handler hands it.
import { navigateOrRefuse } from './headless-page.mjs'   // Page.navigate returns an errorText, and nothing read it
import { createServer } from 'node:http'
import { reapOnExit } from "../shared/reap-on-exit.mjs";   // — a detached group dies with this script
import { readFileSync, existsSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
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
// THE KEY DOOR IS ANOTHER HOST, and a different string, so a fold that resolved at the sign-in host is
// told apart from one that resolved at the key door by what lands on the clipboard.
const KEY_ADDRESS = 'https://agent-mcp.test.invalid/mcp'
// What the mint hands back. Recognisable and inert — the check greps the page for these exact strings,
// so they must be values no real deployment could produce.
const MINTED = { address: 'https://mcp.test.invalid/mcp', key: 'fixture-credential-1976-never-real' }
const OPERATOR = 'counsel@coastline.test'

const STATES = {
  'local-staff': { role: 'staff', url: null, door: null, keyUrl: null, aiConnected: true },
  'unwired-client': { role: 'client', url: null, door: null, keyUrl: null, aiConnected: null },
  'wired-client': { role: 'client', url: ADDRESS, door: 'sign-in', keyUrl: null, aiConnected: false },
  'wired-client-key': { role: 'client', url: ADDRESS, door: 'sign-in', keyUrl: KEY_ADDRESS, aiConnected: false },
  'wired-client-done': { role: 'client', url: ADDRESS, door: 'sign-in', keyUrl: KEY_ADDRESS, aiConnected: true },
  'wired-staff': { role: 'staff', url: ADDRESS, door: 'key', keyUrl: null, aiConnected: false },
  'silent-door': { role: 'client', url: ADDRESS, door: null, keyUrl: null, aiConnected: null },
}

/**
 * The mcp-access body for one deck, composed the way driver/portal-service.mjs composes it: staff get
 * this install's stdio routes, offers resolve through the one table, `steps` is dropped on the way out.
 */
function accessFor({ role, url, door, keyUrl, aiConnected, wsl = false }) {
  // WHICH DISTRIBUTION A ROW WOULD START THE SERVER IN, stated by the deck the way the door's answer is:
  // a fixture's job is to be the deployment, not to re-read this box's own environment.
  const target = wsl ? { distro: 'Ubuntu' } : null
  const stdio = role === 'staff' ? stdioConnectOffer({ workDir: null, wsl: target }) : null
  const offers = connectOffers({
    stdioRoutes: stdio
      ? Object.fromEntries(Object.keys(STDIO_SHAPES).map((shape) => [shape, stdioConnectFor(shape, { workDir: null, wsl: target })]))
      : {},
    wsl,
    publicAddress: url,
    keyAddress: keyUrl,
    operator: OPERATOR,
    // WHAT THE DOOR ANSWERS. The handler reads it off the door with a probe; a deck states it, because
    // a fixture's job is to be the deployment, not to re-run the probe.
    door,
  })
  return {
    url, keyUrl, email: OPERATOR, enabled: !!url, stdio, aiConnected,
    // THE ROUTE'S OWN MAPPING, not a copy of it.
    offers: offersForWire(offers),
  }
}

// THE SAME INSTALL, INSIDE WSL — and a deck of its own rather than a seventh row above.
//
// Under WSL the rows open with the step that says so and carry two launchers, so the walk above, whose
// assertions are written for "step one is the copy", would red on every one of them. That walk states
// the design for an ordinary install and is left saying exactly that; this deck is driven where its own
// shape is what is being asserted.
const WSL_STATES = {
  'local-staff-wsl': { role: 'staff', url: null, door: null, keyUrl: null, aiConnected: false, wsl: true },
}
const DECKS = { ...STATES, ...WSL_STATES }

let current = 'local-staff'
let mints = 0    // POSTs to /portal/api/connect-key since the last reset — a local press must never mint

const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname
  const json = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
  const s = DECKS[current]
  if (path === '/portal/api/me') {
    // The deck's `role` names who is looking in the resolver's own terms; the wire carries the switches.
    return json({ permissions: { run: true, manage: s.role === 'staff' },
      email: OPERATOR, accounts: s.role === 'staff' ? [] : ['coastline'],
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
// A value pasted into code the page evaluates, as a JavaScript string or object literal. JSON.stringify
// alone leaves `<`, `>`, `/` and the two line separators as they are; escaped, they read the same once
// parsed and cannot close or break the code they are pasted into.
const jsLiteral = (v) => JSON.stringify(v).replace(/[<>\/\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
const evalIn = async (expr) => (await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value

// ── The probes ───────────────────────────────────────────────────────────────────────────────────
//
// Everything is asked of `.screen` — the page's own root — so the shell's navigation cannot answer for
// the page. `key` below is the minted fixture credential, and no probe may ever find it on the page.
//
// POSITIONS ARE DOCUMENT-RELATIVE (top plus scroll). A press scrolls its target into view first, and a
// viewport-relative top would then read every element as having moved.
const HELP_URL = 'https://github.com/CordilleraSarl/clearotron/blob/main/mcp-server/CONNECT.md'
const WHERE_LABEL = {
  disk: 'Clearotron is installed on this machine (laptop/desktop)',
  'public-http': 'Clearotron is running elsewhere (e.g. Cloud/Server)',
}
const PLACES = ['disk', 'public-http']
const WATCH = 'This page says Connected once your assistant calls Clearotron.'
const FOLD_HEADING = 'If your assistant asks to be let in another way'

// THE SIX WORDS are scanned on ARRIVAL only, deliberately. The steps a pick opens hand over `claude mcp
// add …`, an address and a key by design; what the ruling forbids is the page ASKING the reader to
// understand those words before anything is pressed. No line is exempt any more: the help link that was
// is now a "Setup guide" button.
const arrivalProbe = (expect) => `(async () => {
  const EXPECT = ${JSON.stringify(expect)}
  const flat = (s) => (s ?? '').replace(/\\s+/g, ' ').trim()
  const screen = document.querySelector('.screen')
  if (!screen) return { fatal: 'the page did not render a .screen at all' }
  const text = flat(screen.innerText)
  const outsideProbe = (el) => !el.closest('.ai-probe')
  const guide = screen.querySelector('a[href="' + EXPECT.url + '"][target="_blank"]')
  const fold = screen.querySelector('details.steps-fold')
  return {
    // ANTI-VACUITY FIRST. Almost every assertion below is about something being ABSENT, and a deck that
    // failed to render satisfies all of them perfectly. The length is asserted before the absences.
    renderedChars: text.length,
    heading: flat(screen.querySelector('.page-title')?.textContent),
    lede: flat(screen.querySelector('.page-lede')?.textContent),
    ledeTag: flat(screen.querySelector('.page-lede .lede-opt')?.textContent),
    canDo: [...screen.querySelectorAll('.ai-can-list li')].map((li) => flat(li.textContent)),
    cards: [...screen.querySelectorAll('.where-card')].map((b) => flat(b.innerText)),
    rows: [...screen.querySelectorAll('button.ai-app')].map((b) => b.getAttribute('data-id')),
    rowNames: [...screen.querySelectorAll('button.ai-app .ai-app-name')].map((b) => flat(b.textContent)),
    openPanels: [...screen.querySelectorAll('[data-for]')].filter(outsideProbe).length,
    notice: /Not available on this installation yet/.test(text),
    operatorWordingOnPage: /incomplete|install it again/i.test(text),
    expandedPres: [...screen.querySelectorAll('pre')].filter(outsideProbe).length,
    bannedLines: screen.innerText.split('\\n').map(flat)
      .filter((l) => /\\b(MCP|connector|token|scope|address|key)\\b/i.test(l)),
    keyOnPage: text.includes(EXPECT.key),
    pill: screen.querySelector('.conn-state') ? flat(screen.querySelector('.conn-state').textContent) : null,
    pillLit: !!screen.querySelector('.conn-state .conn-dot-on'),
    connectionWords: /\\bConnected\\b|Not connected yet/.test(text),
    continueShown: !!screen.querySelector('.back-to-report'),
    setupFold: fold ? { open: fold.open, title: flat(fold.querySelector('summary')?.textContent) } : null,
    helpLink: guide ? flat(guide.textContent) : null,
    helpLine: [...screen.querySelectorAll('.ai-help p')].map((p) => flat(p.textContent)),
  }
})()`

const placeProbe = `(() => {
  const flat = (s) => (s ?? '').replace(/\\s+/g, ' ').trim()
  const screen = document.querySelector('.screen')
  const slot = screen.querySelector('.ai-slot')
  const empty = screen.querySelector('.steps-panel-empty') || screen.querySelector('.steps-fold .steps-empty')
  return {
    rows: [...screen.querySelectorAll('button.ai-app')].map((b) => ({ id: b.getAttribute('data-id'), name: flat(b.querySelector('.ai-app-name')?.textContent) })),
    notice: /Not available on this installation yet/.test(flat(screen.innerText)),
    // textContent, because once connected the line sits inside a closed fold and innerText reads nothing there.
    emptyPanel: flat(empty?.textContent ?? ''),
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
  const panels = [...screen.querySelectorAll('[data-for]')].filter((el) => !el.closest('.ai-probe'))
  const panel = panels[0]
  // THE PRIMARY LIST ONLY. Where the door could not be read the panel holds a second list — the other
  // way in — and beside a sign-in door with a key door it holds a fold, so a panel-wide query counts all
  // of them and the step-count assertion below compares one number against the others' totals as well.
  // They are measured apart because they say different things: the first is what to try, the others are
  // what to fall back to.
  const alt = panel?.querySelector('.steps-alt:not(.steps-alt-fold)')
  const fold = panel?.querySelector('details.steps-alt-fold')
  const steps = panel ? [...panel.querySelectorAll('ol.steps > li')].filter((li) => (!alt || !alt.contains(li)) && (!fold || !fold.contains(li))) : []
  const altSteps = alt ? [...alt.querySelectorAll('ol.steps > li')] : []
  const foldSteps = fold ? [...fold.querySelectorAll('ol.steps > li')] : []
  const inner = flat(panel?.textContent ?? '')
  return {
    panelCount: panels.length,
    panelFor: panel?.getAttribute('data-for') ?? null,
    // textContent, not innerText: the eyebrow is uppercased by CSS, and innerText reports the drawn case.
    head: flat(panel?.querySelector('.eyebrow')?.textContent) + ' ' + flat(panel?.querySelector('.steps-name')?.textContent),
    stepCount: steps.length,
    stepTexts: steps.map((li) => flat(li.querySelector('.step-text')?.textContent)),
    firstHint: flat(steps[0]?.querySelector('.step-hint')?.textContent) || null,
    firstButton: flat(steps[0]?.querySelector('button')?.textContent) || null,
    firstPre: !!steps[0]?.querySelector('pre'),
    watch: flat(panel?.querySelector('.step-watch')?.textContent) || null,
    watchOnLast: !!steps[steps.length - 1]?.querySelector('.step-watch'),
    altStepCount: altSteps.length,
    altHeading: flat(alt?.querySelector('.steps-alt-head')?.textContent) || null,
    unknownDoorNote: flat(panel?.querySelector('.steps-unknown')?.textContent) || null,
    firstStepCopies: !!steps[0]?.querySelector('.codeblock, .secret-btn'),
    altFirstStepCopies: !!altSteps[0]?.querySelector('.codeblock, .secret-btn'),
    foldStepCount: foldSteps.length,
    // Every block the reader can copy, shown or folded away, to hold the local route's lines below.
    copies: [...(panel?.querySelectorAll('.codeblock, pre') ?? [])].map((c) => c.textContent || ''),
    foldOpen: fold ? fold.open : null,
    foldHeading: flat(fold?.querySelector('summary')?.textContent) || null,
    foldButtons: fold ? [...fold.querySelectorAll('ol.steps button')].map((b) => ({ text: flat(b.textContent), ghost: /\\bbtn-ghost\\b/.test(b.className), step: b.getAttribute('data-step') })) : [],
    warning: /warning/i.test(inner),
    stepsPointingNowhere: steps.map((li) => flat(li.textContent)).filter((l) => /\\b(below|advanced)\\b/i.test(l)),
    stamp: /Checked \\d{4}|These steps name no button/.test(inner),
    selectedElsewhere: [...screen.querySelectorAll('button.ai-app[aria-pressed="true"]')].filter((b) => b.getAttribute('data-id') !== EXPECT.id).length,
    keyAnywhere: flat(screen.innerText).includes(EXPECT.key),
    landed: /On your clipboard now/i.test(inner),   // its label is uppercased by CSS, so read the text
    masked: /••••/.test(inner),
    copiedShown: !!panel?.querySelector('button.is-copied'),
    refused: /will not be shown again|would not let us copy/.test(flat(screen.innerText)),
  }
})()`

const click = (selector) => evalIn(`(async () => {
  const el = document.querySelector(${JSON.stringify(selector)})
  if (!el) return false
  el.click(); await new Promise((r) => setTimeout(r, 250)); return true
})()`)

// A FOLD OPENED THE WAY A READER OPENS ONE: its summary pressed. Returns whether it is open afterwards.
const openFold = (selector) => evalIn(`(async () => {
  const d = document.querySelector(${JSON.stringify(selector)})
  if (!d) return null
  if (!d.open) d.querySelector('summary').click()
  await new Promise((r) => setTimeout(r, 250))
  return d.open
})()`)

// WHAT A PRESS ACTUALLY PUT ON THE CLIPBOARD. Null when the browser would not read it back, which is
// counted, so a battery whose reads all failed says so rather than passing over nothing.
const clipboardText = () => evalIn(`(async () => { try { return await navigator.clipboard.readText() } catch (e) { return null } })()`)

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
let foldPresses = 0
// HOW MANY PRESSES ACTUALLY REACHED THE CLIPBOARD. Lose the clipboard and every press quietly takes the
// browser-refused branch, where showing the credential is CORRECT by design; the battery would then pass
// while never once checking the page a reader actually meets. Why the first run of an earlier battery lost
// it was never established — three plants each failed to reproduce it — so zero is counted and named as an
// ENVIRONMENT failure rather than explained.
let clipboardReached = 0
let clipboardRead = 0
// A FRAME PER ACCEPTANCE STATE, for a reader rather than for an assertion. Any change here is one a person
// sees, and a diff cannot show placement — the rule that came from a release shipping a button in the
// wrong place.
const shotDir = process.argv.includes('--shot-dir') ? process.argv[process.argv.indexOf('--shot-dir') + 1] : null
if (shotDir) mkdirSync(shotDir, { recursive: true })

let clipboardRefused = 0

const out = {}
for (const state of Object.keys(STATES)) {
  current = state
  mints = 0
  await cmd('Page.navigate', { url: 'about:blank' })
  await new Promise((r) => setTimeout(r, 150))
  await navigateOrRefuse(cmd, `${origin}/portal/ai`, { what: 'ai-page-render-check' })
  await new Promise((r) => setTimeout(r, 1400))

  const deck = STATES[state]
  const access = accessFor(deck)
  const served = access.offers.filter((o) => o.served)
  const servedOn = (place) => served.filter((o) => o.route === place)
  const routes = PLACES.filter((p) => servedOn(p).length)
  // The page's own rule, restated so the check can hold it to it: the cards show wherever the disk route
  // is served (the people who run the install), both of them, even with no public address.
  const asks = routes.includes('disk')
  // Once connected the steps are a closed fold, and a closed fold reserves nothing. Keyed on the deck.
  const folds = deck.aiConnected === true

  const r = await evalIn(arrivalProbe({ key: MINTED.key, url: HELP_URL }))
  out[state] = { arrival: r }
  console.log(`\n${state}:`)
  if (r?.fatal) { failures++; console.error(`  ✗ ${r.fatal}`); continue }

  ok(r.heading === 'Connect your AI', `the page is headed "Connect your AI" (saw "${r.heading}")`)
  ok(r.renderedChars > 300, `the deck rendered real text (${r.renderedChars} chars) — every absence below is worthless without this`)
  ok(r.lede === 'Run and interrogate clearances from the assistant you already use. Optional' && r.ledeTag === 'Optional',
    `the standfirst leads with the benefit and ends with the Optional tag (saw "${r.lede}")`)
  ok(same(r.canDo, ['Start a clearance and triage what comes back', 'Watch it run, and add context while it is still early',
    'Examine the reasoning and evidence', 'Ask what-if: why a finding was rated as it was, what changes if the goods narrow']),
  `"What you can do" says the four things (saw ${JSON.stringify(r.canDo)})`)
  ok(same(r.cards, asks ? PLACES.map((p) => WHERE_LABEL[p]) : []),
    `the where-cards show ${asks ? 'both, with the approved labels' : 'not at all'} (saw ${JSON.stringify(r.cards)})`)
  // Nothing below the cards until one is picked; with no cards, the one route's list opens directly.
  const arrivingRows = asks ? [] : (routes[0] ? servedOn(routes[0]).map((o) => o.id) : [])
  ok(same(r.rows, arrivingRows), `the arriving rows are exactly ${JSON.stringify(arrivingRows)} (saw ${JSON.stringify(r.rows)})`)
  // EACH ROW CARRIES THE TABLE'S NAME, read off the same offers the page was handed — never a client id
  // written here, which is the drift connect-clients-are-data refuses on every surface importing the table.
  ok(same(r.rowNames, arrivingRows.map((rowId) => served.find((o) => o.id === rowId)?.name)),
    `the arriving rows carry the table's names (saw ${JSON.stringify(r.rowNames)})`)
  ok(r.notice === (served.length === 0), `the "not available" notice shows iff nothing is served (served: ${served.length}, notice: ${r.notice})`)
  // RULING 3: an unserved row does not render for a client at all — checked by the operator-only WORDING,
  // because a client on a hosted install has every disk route unserved and must read none of it.
  ok(!r.operatorWordingOnPage, 'the operator-only "incomplete / install it again" wording stays off a reader\'s page')
  ok(r.openPanels === 0, `no app's steps are open on arrival (saw ${r.openPanels})`)
  ok(r.expandedPres === 0, `nothing is expanded on arrival (saw ${r.expandedPres} open block(s))`)
  ok(r.bannedLines.length === 0,
    `none of the six banned words reaches the arriving reader, from either side of the wire (saw ${JSON.stringify(r.bannedLines)})`)
  ok(!r.keyOnPage, 'no credential is on the page before any press')
  ok(r.helpLink === 'Setup guide' && same(r.helpLine, ['Give your AI the setup guide', 'Setup guide']),
    `"If it doesn't connect" gives the setup guide, opening in a new tab (saw ${JSON.stringify(r.helpLink)}, ${JSON.stringify(r.helpLine)})`)

  // ── WHAT THE LOG ANSWERED, AND NOTHING MORE ─────────────────────────────────────────────────────────
  //
  // True and false each draw their pill. NULL DRAWS NOTHING AND SAYS NOTHING: no pill, and no word on the
  // page about the connection, because the log could not be read and any sentence would be a guess.
  if (deck.aiConnected === null) {
    ok(r.pill === null && !r.connectionWords, `with no answer from the log there is no pill and no word about the connection (pill: ${JSON.stringify(r.pill)}, words: ${r.connectionWords})`)
  } else {
    ok(r.pill === (deck.aiConnected ? 'Connected' : 'Not connected yet') && r.pillLit === deck.aiConnected,
      `the pill reads what the log answered (saw ${JSON.stringify(r.pill)}, lit: ${r.pillLit})`)
  }
  ok(!r.continueShown, 'reached from the rail, there is no way back to offer')

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
    // A RESERVED SLOT WHERE STEPS ARE DRAWN; A CLOSED FOLD RESERVES NOTHING. Holding the tallest panel's
    // height open under a closed fold would be the empty space the fold exists to remove.
    ok(folds ? p.slotHeight < 120 : p.slotHeight >= 120,
      `the slot ${folds ? 'reserves nothing under the closed "Setup steps" fold' : 'reserves space before anything is picked'} (${p.slotHeight}px)`)
    ok(!p.operatorWordingOnPage, `no operator-only wording on "${place}"`)
    if (folds) {
      const fold = (await evalIn(arrivalProbe({ key: MINTED.key, url: HELP_URL }))).setupFold
      ok(fold && fold.open === false && fold.title === 'Setup steps', `connected, the steps are a closed fold titled "Setup steps" (saw ${JSON.stringify(fold)})`)
    }

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
      // A BARE VALUE IS ITS BUTTON: where step 1 hands over the address alone, there is a "Copy address"
      // button and no block of text above it.
      if (o.steps[0].copy?.kind === 'block' && o.steps[0].copy.label) {
        ok(s.firstButton === o.steps[0].copy.label && !s.firstPre, `"${o.name}" hands over the address by its "${o.steps[0].copy.label}" button alone (saw ${JSON.stringify(s.firstButton)}, block: ${s.firstPre})`)
      }
      // THE LINE UNDER THE LAST STEP, only while the log says "not yet".
      ok(s.watch === (deck.aiConnected === false ? WATCH : null) && (s.watch === null || s.watchOnLast),
        `under the last step: ${JSON.stringify(s.watch)} (the log answered ${deck.aiConnected})`)
      ok(!s.warning, `no step for "${o.name}" mentions an authentication warning`)
      // THE NODE THIS INSTALL RUNS ON, AND THE ENTRY THAT CHECKS IT (owner, 2026-09-19). A line with a bare
      // `node` ran whatever the assistant's PATH found; through WSL that was Node 18, and the server died on
      // a syntax error. Every line that starts the server here names this process's own Node and serve.mjs.
      const local = (s.copies ?? []).filter((t) => /mcp-server[\\/]/.test(t))
      ok(local.every((t) => t.includes(process.execPath) && /mcp-server[\\/]serve\.mjs/.test(t) && !/(^|[\s"'])node[\s"',]+[^\s"']*mcp-server/.test(t)),
        `every line "${o.name}" offers that starts the server names ${process.execPath} and serve.mjs (saw ${JSON.stringify(local.map((t) => t.slice(0, 160)))})`)
      // ── WHERE THE DOOR COULD NOT BE READ, BOTH WAYS ARE ON THE SCREEN ──────────────────────────
      //
      // doorKind answers null for "not read" and its contract says the caller offers both. The wire
      // carried no door and the panel had no branch for one, so a deck whose door is silent drew the
      // sign-in steps exactly as a deck that had been read — while the step text underneath promised
      // the reader that both ways were shown. Asserted on the NULL decks and asserted ABSENT on the
      // others: an alternative beside a door we did read is a set of instructions that cannot work.
      // KEYED ON THE DECK, NEVER ON THE OFFER. `o` comes from the same `offersForWire` call that feeds
      // the page, so an expectation read off it moves with the thing it is checking: dropping both
      // fields from the wire — the exact pre-fix state — left every assertion here passing, because
      // `wantsBoth` went false at the same moment the page stopped drawing them. The DECK states what
      // this deployment is; that is the fact the page is supposed to honour.
      const wantsBoth = deck.url !== null && deck.door === null && o.route === 'public-http'
      if (wantsBoth) {
        ok(s.altStepCount > 0 && s.altFirstStepCopies,
          `"${o.name}" on a door nobody could read shows the other way's steps, copy first (saw ${s.altStepCount}, copy: ${s.altFirstStepCopies})`)
        // AND THE WIRE ACTUALLY CARRIED THEM. Asserted against the deck above, so this cannot go quiet
        // by the resolver simply ceasing to produce an alternative.
        ok((o.altSteps?.length ?? 0) > 0 && o.door === null,
          `the wire dropped the other way in for "${o.name}" — the page has nothing to draw and nothing to say`)
        // NULL-SAFE ON THE WIRE'S OWN FIELD. Reading `.length` off an absent `altSteps` threw here, and a
        // check that throws stops reporting: the two decks after this one were never measured, so the
        // run said less about the page than it had already learned. A missing alternative is a finding
        // the assertion above states; it must not also be an exception.
        ok(s.altStepCount === (o.altSteps?.length ?? 0),
          `"${o.name}" drew ${s.altStepCount} of the ${o.altSteps?.length ?? 0} steps the wire carried`)
        ok(!!s.unknownDoorNote, `"${o.name}" says the door could not be checked rather than drawing one way as though it had been`)
        ok(!!s.altHeading, `the second list on "${o.name}" is headed, so a reader can tell which set is which`)
      } else {
        ok(s.altStepCount === 0 && !s.unknownDoorNote,
          `"${o.name}" offers a second open way in beside a door that WAS read (saw ${s.altStepCount} extra steps)`)
      }
      // ── BESIDE A SIGN-IN DOOR, THE KEY DOOR FOLDED — WHERE ONE EXISTS ──────────────────────────
      //
      // Keyed on the deck for the reason above. No key door, no fold: key steps against the sign-in host
      // could not work.
      const wantsFold = deck.url !== null && deck.door === 'sign-in' && deck.keyUrl !== null && o.route === 'public-http'
      if (wantsFold) {
        ok(s.foldStepCount === (o.keySteps?.length ?? -1) && s.foldStepCount > 0 && s.foldOpen === false && s.foldHeading === FOLD_HEADING,
          `"${o.name}" folds the key door's ${o.keySteps?.length} steps, closed, under "${FOLD_HEADING}" (saw ${s.foldStepCount}, open: ${s.foldOpen}, "${s.foldHeading}")`)
      } else {
        ok(s.foldStepCount === 0 && s.foldOpen === null, `"${o.name}" has no key fold, because no key door stands beside a sign-in door (saw ${s.foldStepCount})`)
      }
      ok(s.stepsPointingNowhere.length === 0, `no step points at a section this page does not have: ${JSON.stringify(s.stepsPointingNowhere)}`)
      ok(!s.stamp, 'no checked or unchecked stamp')
      ok(s.selectedElsewhere === 0, `no other row is still selected (${s.selectedElsewhere})`)
      ok(mints === before, `picking a row mints nothing (saw ${mints - before})`)
      ok(!s.keyAnywhere, 'no credential on the page after a pick')
    }

    // THE PRESSES. Once connected the steps are folded, so the fold is opened first — the way a reader
    // reaches the buttons — and the layout is measured again from there: opening a fold is the reader's
    // own expansion, and what must not move anything is the press after it.
    const pressBase = async (o) => {
      await pick(o)
      if (folds) ok(await openFold('.ai-slot details.steps-fold') === true, `connected, "Setup steps" opens to reach "${o.name}"'s buttons`)
      return (await evalIn(layoutProbe)).tops
    }

    // ONE BLOCK AND ONE SECRET PRESS PER PLACE, where the place has them. A block needs no server; a secret
    // mints exactly once, lands masked, and is nowhere on the page.
    const blockRow = here.find((o) => o.steps.some((st) => st.copy?.kind === 'block'))
    if (blockRow) {
      const i = blockRow.steps.findIndex((st) => st.copy?.kind === 'block')
      const from = await pressBase(blockRow)
      const before = mints
      blockPresses++
      await realPress(`.ai-slot [data-for="${blockRow.id}"] button[data-step="${i}"]`)
      const s = await evalIn(panelProbe({ id: blockRow.id, key: MINTED.key }))
      const tops = (await evalIn(layoutProbe)).tops
      if (s.refused) clipboardRefused++; else clipboardReached++
      ok(shiftedBy(from, tops) === 0, `pressing Copy on "${blockRow.name}" moved nothing (${shiftedBy(from, tops)} shifted)`)
      ok(s.copiedShown || s.refused, `the pressed Copy is its own confirmation (copied: ${s.copiedShown}, refused: ${s.refused})`)
      ok(mints === before, `a block needs no key, but ${mints - before} were made`)
      ok(!s.keyAnywhere, 'no credential on the page after a block press')
      const clip = s.refused ? null : await clipboardText()
      if (clip !== null) {
        clipboardRead++
        ok(clip === blockRow.steps[i].copy.text, `the press put "${blockRow.name}"'s own copy on the clipboard (saw ${JSON.stringify(clip.slice(0, 60))}${clip.length > 60 ? '…' : ''})`)
      }
    }
    const secretRow = here.find((o) => o.steps.some((st) => st.copy?.kind === 'secret'))
    if (secretRow) {
      const i = secretRow.steps.findIndex((st) => st.copy?.kind === 'secret')
      const from = await pressBase(secretRow)
      const before = mints
      secretPresses++
      await realPress(`.ai-slot [data-for="${secretRow.id}"] button[data-step="${i}"]`)
      const s = await evalIn(panelProbe({ id: secretRow.id, key: MINTED.key }))
      const tops = (await evalIn(layoutProbe)).tops
      out[state][`${place} press ${secretRow.id}`] = s
      if (s.refused) clipboardRefused++; else clipboardReached++
      ok(shiftedBy(from, tops) === 0, `pressing "${secretRow.name}"'s key button moved nothing (${shiftedBy(from, tops)} shifted)`)
      ok(mints === before + 1, `the press mints exactly once (saw ${mints - before})`)
      if (!s.refused) {
        ok(s.landed && s.masked, `the panel says what landed, masked (landed: ${s.landed}, masked: ${s.masked})`)
        // THE CREDENTIAL IS IN THE DOM ONLY ON THE CLIPBOARD-REFUSED PATH. Both halves are asserted: "no
        // key" alone would pass a panel that showed nothing at all.
        ok(!s.keyAnywhere, 'the clipboard took the credential and it is nowhere on the page')
      }
    }

    // THE FOLDED KEY DOOR, pressed. Opened the way a reader opens it; then its two buttons, quiet, with the
    // address press handing over the KEY DOOR's address — the whole reason the fold may exist at all.
    const foldRow = here.find((o) => o.keySteps?.some((st) => st.copy?.kind === 'secret'))
    if (foldRow && deck.keyUrl !== null) {
      await pressBase(foldRow)
      const opened = await openFold(`.ai-slot [data-for="${foldRow.id}"] details.steps-alt-fold`)
      const shown = await evalIn(panelProbe({ id: foldRow.id, key: MINTED.key }))
      out[state][`${place} fold ${foldRow.id}`] = shown
      ok(opened === true, `the key door's fold opens for "${foldRow.name}"`)
      const labels = shown.foldButtons.map((b) => b.text)
      ok(same(labels, ['Copy address', 'Copy key']) && shown.foldButtons.every((b) => b.ghost),
        `opened, the fold shows "Copy address" and "Copy key" as two quiet buttons (saw ${JSON.stringify(shown.foldButtons)})`)
      const from = (await evalIn(layoutProbe)).tops
      // The address first: no key, and the key door's own host.
      const addressStep = shown.foldButtons.find((b) => b.text === 'Copy address')?.step
      let before = mints
      foldPresses++
      await realPress(`.ai-slot [data-for="${foldRow.id}"] details.steps-alt-fold button[data-step="${addressStep}"]`)
      const a = await evalIn(panelProbe({ id: foldRow.id, key: MINTED.key }))
      if (a.refused) clipboardRefused++; else clipboardReached++
      ok(mints === before, `the fold's "Copy address" mints nothing (saw ${mints - before})`)
      const clip = a.refused ? null : await clipboardText()
      if (clip !== null) {
        clipboardRead++
        ok(clip === KEY_ADDRESS, `the fold's "Copy address" hands over the key door's address, never the sign-in host (saw ${JSON.stringify(clip)})`)
      }
      // Then the key: minted once, landed masked, nowhere on the page.
      const keyStep = shown.foldButtons.find((b) => b.text === 'Copy key')?.step
      before = mints
      foldPresses++
      await realPress(`.ai-slot [data-for="${foldRow.id}"] details.steps-alt-fold button[data-step="${keyStep}"]`)
      const k = await evalIn(panelProbe({ id: foldRow.id, key: MINTED.key }))
      const tops = (await evalIn(layoutProbe)).tops
      if (k.refused) clipboardRefused++; else clipboardReached++
      ok(mints === before + 1, `the fold's "Copy key" mints exactly once (saw ${mints - before})`)
      // AN OPEN FOLD IS NOT PART OF THE RESERVED HEIGHT — the reserve is for the steps a reader follows — so
      // the line saying what landed can push the help notice below the slot, and nothing else.
      ok(shiftedBy(from, tops) <= 1, `pressing in the open fold moved nothing but the help notice below it (${shiftedBy(from, tops)} shifted)`)
      if (!k.refused) ok(k.landed && k.masked && !k.keyAnywhere, `the key landed, masked, and is nowhere on the page (landed: ${k.landed}, masked: ${k.masked})`)
    }
  }
}

ok(clipboardReached > 0,
  `at least one press reached the clipboard (${clipboardReached} reached, ${clipboardRefused} refused). `
  + 'Zero means this browser stopped granting the clipboard, and the battery has then been asserting the '
  + 'refused fallback on every deck while looking exactly like a pass — an environment failure, not a page regression.')
ok(clipboardRead > 0, `at least one press was read back off the clipboard (${clipboardRead}) — otherwise no press was checked for WHAT it copied`)
ok(blockPresses > 0, `at least one deck pressed a block's Copy (saw ${blockPresses})`)
ok(secretPresses > 0, `at least one deck pressed a key-bearing Copy (saw ${secretPresses})`)
ok(foldPresses >= 2, `the key door's fold was opened and both of its buttons pressed (saw ${foldPresses})`)

// ── THE FOUR STATES A READER MEETS, AS PICTURES, AND THE WAY BACK ────────────────────────────────────
//
// Reached from the rail or from a report's Ask AI, not connected or connected — the board's two and the
// two between them. A report is remembered first, as "Set it up" leaves it, so the rail states prove the
// marker is what decides and not the note. Claude is picked in each, as the boards draw it.
const REMEMBERED = { runId: 'run-venqori', markSlug: null, mark: 'VENQORI' }
const EVIDENCE = [
  { name: 'not-connected-from-rail', deck: 'wired-client-key', path: '/portal/ai', continues: false, thenOpenKeyFold: true },
  { name: 'connected-from-rail', deck: 'wired-client-done', path: '/portal/ai', continues: false },
  { name: 'not-connected-from-report', deck: 'wired-client-key', path: '/portal/ai?from=report', continues: false },
  { name: 'connected-from-report', deck: 'wired-client-done', path: '/portal/ai?from=report', continues: true },
]
// A FULL-HEIGHT VIEWPORT, not a beyond-viewport capture, which paints sticky and fixed elements where the
// shorter viewport put them.
const capture = async (file) => {
  const h = await evalIn('Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)') ?? 1000
  await cmd('Emulation.setDeviceMetricsOverride', { width: 1280, height: Math.max(1000, h), deviceScaleFactor: 1, mobile: false })
  await new Promise((r) => setTimeout(r, 400))
  const shot = await cmd('Page.captureScreenshot', { format: 'png' })
  await cmd('Emulation.clearDeviceMetricsOverride', {})
  const data = shot.result?.result?.data ?? shot.result?.data
  if (!data) throw new Error(`no screenshot came back for ${file}`)
  writeFileSync(file, Buffer.from(data, 'base64'))
}
console.log('\nthe four states a reader meets:')
// THE BOARDS DRAW THE FIRST APP ON THE WEB ROUTE, and it is found in the offers rather than named here.
const firstApp = accessFor(STATES['wired-client-key']).offers.find((o) => o.served && o.route === 'public-http')
ok(firstApp?.name === 'Claude', `the first app on the web route is Claude, as the boards draw it (saw ${JSON.stringify(firstApp?.name)})`)
await navigateOrRefuse(cmd, `${origin}/portal/ai`, { what: 'ai-page-render-check' })
await new Promise((r) => setTimeout(r, 800))
await evalIn(`(() => { localStorage.setItem('cordillera-ask-ai-report', ${jsLiteral(JSON.stringify(REMEMBERED))}); return true })()`)
for (const st of EVIDENCE) {
  current = st.deck
  await navigateOrRefuse(cmd, `${origin}${st.path}`, { what: 'ai-page-render-check' })
  await new Promise((r) => setTimeout(r, 1400))
  await click(`button.ai-app[data-id="${firstApp.id}"]`)
  const a = await evalIn(arrivalProbe({ key: MINTED.key, url: HELP_URL }))
  const s = await evalIn(panelProbe({ id: firstApp.id, key: MINTED.key }))
  const back = await evalIn(`(() => {
    const flat = (x) => (x ?? '').replace(/\\s+/g, ' ').trim()
    const row = document.querySelector('.back-to-report')
    return row ? { label: flat(row.querySelector('button')?.textContent), line: flat(row.querySelector('.back-to-report-line')?.textContent) } : null
  })()`)
  out[`evidence ${st.name}`] = { arrival: a, panel: s, back }
  const connected = STATES[st.deck].aiConnected === true
  ok(a.pill === (connected ? 'Connected' : 'Not connected yet'), `${st.name}: the pill reads ${JSON.stringify(a.pill)}`)
  ok(same(back, st.continues ? { label: 'Continue with VENQORI', line: 'Back to the report you were reading.' } : null),
    `${st.name}: ${st.continues ? '"Continue with VENQORI" and its line sit above the steps' : 'no way back is offered'} (saw ${JSON.stringify(back)})`)
  ok(connected ? a.setupFold?.open === false && a.setupFold?.title === 'Setup steps' : a.setupFold === null,
    `${st.name}: the steps are ${connected ? 'a closed "Setup steps" fold' : 'drawn, not folded'} (saw ${JSON.stringify(a.setupFold)})`)
  ok(s.watch === (connected ? null : WATCH), `${st.name}: under step five, ${JSON.stringify(s.watch)}`)
  ok(same(s.stepTexts, [
    'Copy the address.',
    'In Claude, open Settings → Connectors → Add custom connector.',
    'Paste the address and press Add.',
    `Sign in when the browser opens — use ${OPERATOR}.`,
    'Try it: in your assistant, ask “Show my recent Clearotron clearances.” A reply listing them confirms the connection.',
  ]), `${st.name}: Claude's five sign-in steps read as the design words them (saw ${JSON.stringify(s.stepTexts)})`)
  ok(s.firstHint === null, `${st.name}: step one carries no hint (saw ${JSON.stringify(s.firstHint)})`)
  ok(s.foldOpen === false && s.foldHeading === FOLD_HEADING, `${st.name}: the key door's fold is closed (open: ${s.foldOpen})`)
  if (shotDir) {
    await evalIn(`(() => { window.scrollTo(0, 0); document.documentElement.removeAttribute('data-theme'); return true })()`)
    await capture(join(shotDir, `connect-your-ai-${st.name}-light.png`))
    await evalIn(`(() => { document.documentElement.setAttribute('data-theme', 'dark'); return true })()`)
    await new Promise((r) => setTimeout(r, 350))
    await capture(join(shotDir, `connect-your-ai-${st.name}-dark.png`))
    await evalIn(`(() => { document.documentElement.removeAttribute('data-theme'); return true })()`)
  }
  // AND THE KEY DOOR'S FOLD OPENED, as a reader opens it: two quiet buttons, address and key.
  if (st.thenOpenKeyFold) {
    ok(await openFold(`.ai-slot [data-for="${firstApp.id}"] details.steps-alt-fold`) === true, `${st.name}: the key door's fold opens`)
    const opened = await evalIn(panelProbe({ id: firstApp.id, key: MINTED.key }))
    ok(same(opened.foldButtons.map((b) => [b.text, b.ghost]), [['Copy address', true], ['Copy key', true]]),
      `${st.name}: opened, the fold shows "Copy address" and "Copy key" as two quiet buttons (saw ${JSON.stringify(opened.foldButtons)})`)
    if (shotDir) {
      await capture(join(shotDir, 'connect-your-ai-key-fold-open-light.png'))
      await evalIn(`(() => { document.documentElement.setAttribute('data-theme', 'dark'); return true })()`)
      await new Promise((r) => setTimeout(r, 350))
      await capture(join(shotDir, 'connect-your-ai-key-fold-open-dark.png'))
      await evalIn(`(() => { document.documentElement.removeAttribute('data-theme'); return true })()`)
    }
  }
}

// ── AND THE TWO SIDES OF A WSL INSTALL, DRAWN ───────────────────────────────────────────────────────
//
// An install inside WSL is reachable two ways and the page offered one of them, unheaded: the owner
// pasted it into Claude Code inside the distribution and got a closed connection. Both rows are drawn
// here, each under the side it is for, with the commands read off the page rather than off the composer.
console.log('\nthe two sides of a WSL install:')
{
  current = 'local-staff-wsl'
  const app = accessFor(WSL_STATES['local-staff-wsl']).offers.find((o) => o.served && o.route === 'disk')
  ok(!!app, `an on-this-computer row is served under WSL (saw ${JSON.stringify(app?.id ?? null)})`)
  await cmd('Page.navigate', { url: 'about:blank' })
  await new Promise((r) => setTimeout(r, 150))
  await navigateOrRefuse(cmd, `${origin}/portal/ai`, { what: 'ai-page-render-check' })
  await new Promise((r) => setTimeout(r, 1400))
  // THE PAGE ASKS WHERE FIRST, and nothing below that is drawn until it is answered — the same two
  // presses the walk above makes, and the same two a reader makes.
  await click('.where-card[data-place="disk"]')
  await new Promise((r) => setTimeout(r, 400))
  await click(`button.ai-app[data-id="${app.id}"]`)
  await new Promise((r) => setTimeout(r, 400))
  const rows = await evalIn(`(() => {
    const flat = (s) => (s ?? '').replace(/\\s+/g, ' ').trim()
    const panel = [...document.querySelectorAll('[data-for]')].filter((el) => !el.closest('.ai-probe'))[0]
    return [...(panel?.querySelectorAll('ol.steps > li') ?? [])].map((li) => ({
      text: flat(li.querySelector('.step-text')?.textContent),
      command: flat(li.querySelector('pre')?.textContent) || null,
    }))
  })()`)
  out['wsl rows'] = rows
  // THE STEP ABOVE THEM SAYS THE INSTALL IS IN WSL, AND NOTHING THE ROWS NOW SAY. It used to tell an
  // assistant inside the distribution that it could not connect, which the row below it now answers.
  ok(rows[0]?.text === 'This install runs inside WSL.',
    `the step above the rows reads as the design words it (saw ${JSON.stringify(rows[0]?.text ?? null)})`)
  const headed = rows.filter((r) => r.command)
  ok(headed.length === 2, `both sides are drawn, not one (saw ${headed.length})`)
  ok(headed[0]?.text === 'From Windows' && headed[1]?.text === 'Inside WSL',
    `each row says which side it is for (saw ${JSON.stringify(headed.map((r) => r.text))})`)
  ok(/wsl\.exe/.test(headed[0]?.command ?? '') && !/wsl\.exe/.test(headed[1]?.command ?? ''),
    'the Windows row crosses into the distribution and the inside-WSL row does not')
  if (shotDir) {
    await evalIn(`(() => { window.scrollTo(0, 0); document.documentElement.removeAttribute('data-theme'); return true })()`)
    await capture(join(shotDir, 'connect-your-ai-wsl-both-sides-light.png'))
    await evalIn(`(() => { document.documentElement.setAttribute('data-theme', 'dark'); return true })()`)
    await new Promise((r) => setTimeout(r, 350))
    await capture(join(shotDir, 'connect-your-ai-wsl-both-sides-dark.png'))
    await evalIn(`(() => { document.documentElement.removeAttribute('data-theme'); return true })()`)
  }
}

console.log(`\n${JSON.stringify(out, null, 2)}`)
try { process.kill(-chrome.pid, 'SIGKILL') } catch { /* already gone */ }
server.close()
rmSync(userDir, { recursive: true, force: true })
console.log(failures ? `\n${failures} failed` : `\nthe AI page draws correctly in all ${Object.keys(STATES).length} decks and the four states a reader meets`)
process.exit(failures ? 1 : 0)
