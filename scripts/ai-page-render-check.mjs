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
  const buttons = [...screen.querySelectorAll('button')].map((b) => b.innerText.trim()).filter((t) => /^Connect /.test(t))
  return {
    buttonNames: buttons.map((t) => t.replace(/^Connect\\s+/, '')),
    absencesMissing: EXPECT.absent.filter((a) =>
      !(text.includes(a.name + ' — ') && text.toLowerCase().includes(flat(a.reason).toLowerCase()))
    ).map((a) => a.name),
    expandedPres: [...screen.querySelectorAll('pre')].length,
    bannedLines: screen.innerText.split('\\n').map(flat).filter((l) => /\\b(MCP|connector|token|scope|address|key)\\b/i.test(l)),
    keyOnPage: text.includes(EXPECT.key),
    helpLink: !!screen.querySelector('a[href="/portal/connect-help"]'),
    heading: text.includes('Use your own AI'),
  }
})()`

const pressProbe = (name, expect) => `(async () => {
  const EXPECT = ${JSON.stringify(expect)}
  const flat = (s) => (s ?? '').replace(/\\s+/g, ' ').trim()
  const screen = document.querySelector('.screen')
  const button = [...screen.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Connect ' + ${JSON.stringify(name)})
  if (!button) return { fatal: 'no button named Connect ' + ${JSON.stringify(name)} }
  button.click()
  await new Promise((r) => setTimeout(r, 700))
  const row = button.parentElement
  const rowText = flat(row.innerText)
  // Refs tracker issue 2143 — the command is BEHIND A FOLD now, so what a press shows and what the
  // reader can still reach are two different questions and both get asked. \`innerText\` is the right
  // instrument for the first: it reports what is RENDERED, so a closed <details> contributes nothing.
  const fold = row.querySelector('details.ai-advanced')
  const steps = [...row.querySelectorAll('ol.ai-steps li')].map((li) => flat(li.innerText))
  const commandVisible = flat(rowText).includes(flat(EXPECT.command ?? '\u0000'))
  if (fold) fold.open = true
  await new Promise((r) => setTimeout(r, 120))
  const commandInFold = EXPECT.command
    ? flat(row.querySelector('details.ai-advanced pre')?.innerText ?? '').includes(flat(EXPECT.command))
    : null
  if (fold) fold.open = false
  // THE TOGGLE, measured at the end so nothing above is disturbed by it.
  button.click()
  await new Promise((r) => setTimeout(r, 400))
  const closedOnSecondPress = !row.querySelector('.ai-open')
  return {
    rowText,
    steps,
    // ── Refs tracker issue 2143 — A STEP MAY NOT POINT AT SOMETHING THAT IS NOT THERE ──────────────
    // These steps were written for a surface that rendered the address and the key underneath them.
    // This page renders neither: the command is folded and the credential goes to the clipboard and
    // never to the DOM. So a step saying "below" is an instruction to look at nothing, which is the
    // lawyer-test failure this issue was filed for — and the kind a string assertion never sees.
    // The word boundary is DOUBLE-escaped, and it has to be: this whole probe is a template literal, so
    // a single backslash-b is the BACKSPACE escape. Written singly the pattern silently becomes a
    // control character that matches nothing, and the arm passes every tree — which is how it was
    // written first, and what planting a bad step caught.
    stepsPointingNowhere: steps.filter((l) => /\\bbelow\\b/.test(l)),
    commandVisibleOnPress: EXPECT.command ? commandVisible : null,
    commandInFold,
    closedOnSecondPress,
    said: /Copied\\. Paste it into /.test(rowText),
    revealed: rowText.includes(EXPECT.key),
    oneTime: rowText.includes('will not be shown again'),
    keyAnywhere: flat(screen.innerText).includes(EXPECT.key),
    addressShown: rowText.includes(EXPECT.address),
  }
})()`

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

  ok(r.heading, 'the page rendered at all')
  ok(sameMembers(r.buttonNames, served.map((o) => o.name)),
    `a button renders EXACTLY for each assistant this deck serves (saw ${JSON.stringify(r.buttonNames)}; `
    + `the resolver says ${JSON.stringify(served.map((o) => o.name))})`)
  ok(r.absencesMissing.length === 0,
    `every assistant this deck cannot serve is named with its reason (missing: ${JSON.stringify(r.absencesMissing)})`)
  ok(r.expandedPres === 0, `nothing is expanded on arrival (saw ${r.expandedPres} open block(s))`)
  ok(r.bannedLines.length === 0,
    `none of the six banned words reaches the arriving reader — from either side of the wire (saw ${JSON.stringify(r.bannedLines)})`)
  ok(!r.keyOnPage, 'no credential is on the page before any press')
  ok(r.helpLink, 'the one link to the by-hand instructions is on the page')

  // ── A local press: the assistant's own line appears, and NOTHING is minted. ─────────────────────
  const local = served.find((o) => o.command)
  if (local) {
    commandPresses++
    const p = await evalIn(pressProbe(local.name, { command: local.command, key: MINTED.key, address: MINTED.address }))
    out[state][`press ${local.name}`] = p
    if (p?.fatal) { failures++; console.error(`  ✗ ${p.fatal}`) } else {
      // ── item 1 — WHAT A PRESS SHOWS CHANGED, so this arm changed with it ──
      // It used to require the command in a <pre> on press. The owner ruled that out: "The page must
      // lead each vendor with the path that vendor's UI user actually takes; a CLI command is at most a
      // collapsed 'advanced' detail." So the assertion inverts — the command must NOT be what a press
      // shows — and two new ones stop that inversion from being a loss: the vendor's own steps have to
      // arrive in its place, and the command has to still be there, correct, one tap away.
      ok(p.steps.length > 0, `pressing "${local.name}" shows that assistant's own steps, not a command`)
      ok(p.commandVisibleOnPress === false,
        `pressing "${local.name}" puts no raw command in front of the reader (the owner's item 1)`)
      ok(p.commandInFold === true,
        `and the command is still reachable and correct one tap into Advanced — demoted, not lost`)
      ok(p.stepsPointingNowhere.length === 0,
        `a step tells the reader to look "below" at something this page does not render: ${JSON.stringify(p.stepsPointingNowhere)}`)
      ok(p.closedOnSecondPress === true,
        `a second press on "${local.name}" closes it again (the owner's item 3)`)
      ok(!p.keyAnywhere, 'and no credential is anywhere on the page')
      ok(mints === 0, `and the key-minting endpoint was never called (saw ${mints} mint(s) — the local route needs no server)`)
    }
  }

  // ── An address press: minted once, and the credential's whereabouts match what the page said. ───
  const addressed = served.find((o) => !o.command)
  if (addressed) {
    addressPresses++
    const before = mints
    const p = await evalIn(pressProbe(addressed.name, { command: null, key: MINTED.key, address: MINTED.address }))
    out[state][`press ${addressed.name}`] = p
    if (p?.fatal) { failures++; console.error(`  ✗ ${p.fatal}`) } else {
      ok(mints === before + 1, `pressing "${addressed.name}" mints exactly once (saw ${mints - before})`)
      ok(p.said || p.revealed, 'the press leaves the reader looking at a next step — copied-and-told, or the degraded reveal')
      // ── THE SAME QUESTIONS AS THE COMMAND ROUTE, because they were asked of one kind only ────────
      // The steps and the toggle arrived tested for the branch that has a command and untested for the
      // branch that does not — so the assistants whose steps name a vendor's own settings screen, the
      // ones this rework is actually for, were never pressed by an arm at all.
      ok(p.steps.length > 0, `pressing "${addressed.name}" shows that assistant's own steps`)
      ok(p.stepsPointingNowhere.length === 0,
        `a step tells the reader to look "below" at something this page does not render: ${JSON.stringify(p.stepsPointingNowhere)}`)
      ok(p.closedOnSecondPress === true, `a second press on "${addressed.name}" closes it again`)
      if (p.revealed) {
        // The browser refused the clipboard, so this is the sanctioned one-time reveal — it must say so.
        ok(p.oneTime, 'the degraded reveal says the credential will not be shown again')
        ok(p.addressShown, 'and carries both lines the reader must paste')
      } else {
        // The clipboard took it, so the ruling holds in full: the credential is NOWHERE in the DOM.
        ok(!p.keyAnywhere, 'the clipboard took the credential and it is nowhere on the page')
      }
    }
  }
}

ok(commandPresses > 0, `at least one deck exercised the local-command press (saw ${commandPresses})`)
ok(addressPresses > 0, `at least one deck exercised the address press (saw ${addressPresses})`)

console.log(`\n${JSON.stringify(out, null, 2)}`)
try { process.kill(-chrome.pid, 'SIGKILL') } catch { /* already gone */ }
server.close()
rmSync(userDir, { recursive: true, force: true })
console.log(failures ? `\n${failures} failed` : `\nthe AI page draws correctly in all ${Object.keys(STATES).length} states`)
process.exit(failures ? 1 : 0)
