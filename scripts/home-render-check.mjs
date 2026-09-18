#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// home-render-check.mjs — draw Home in a real browser, in every state, in both themes.
//
// WHY THIS EXISTS. Every other test of this screen is a string assertion over its source. Those catch a
// missing data-anon and a hardcoded hex; they cannot see that a card overflowed, that a sentence wrapped
// to four lines, that the dark theme rendered light-mode band colours on a dark surface, or that the
// finished band's negative margins tore a hole in the frame. The portal has been bitten by exactly that
// class before — which is why scripts/render-check.mjs and composer-render-check.mjs exist, and this is
// their sibling, built on the same harness so there is one way to do this rather than three.
//
// MUST NOT run as a user with a virtual-memory ulimit (`ulimit -v`) — Chrome dumps core under one. Run
// it as a user with `ulimit -v unlimited`:
//
//   node scripts/home-render-check.mjs [--shot-dir <dir>]
//
// Exits non-zero on the first state that fails to draw, scrolls sideways, or renders a pip count that
// contradicts the run it is drawn from.

import { navigateOrRefuse } from './headless-page.mjs'   // Page.navigate returns an errorText, and nothing read it
import { createServer } from 'node:http'
import { reapOnExit } from "../shared/reap-on-exit.mjs";   // — a detached group dies with this script
import { readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
// — the fixture derives its product NAME the way portal-service.mjs does, from the one resolver.
// Hardcoding the string here would let the fixture and the wire drift, which is the defect the comment
// on `product` below already records once.
import { reportIdentityFor } from '../driver/search-policy.mjs'
// The quote bounds, from the engine's own effort model — so the past-the-bound state below is derived
// from the table it is testing against rather than from a number typed beside it.
import { TURNAROUND_QUOTE } from '../driver/effort-model.mjs'
import { browserRun } from "../shared/browser-temp-root.mjs";

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = join(HERE, '..', 'portal-ui', 'dist')
const shotDir = process.argv.includes('--shot-dir') ? process.argv[process.argv.indexOf('--shot-dir') + 1] : null

if (!existsSync(join(DIST, 'index.html'))) {
  console.error(`no build at ${DIST} — run: npm run build:ui`)
  process.exit(2)
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' }

// ── the states, shaped exactly as portal-service emits them ─────────────────────────────────────────
const now = Date.now()
const ago = (m) => new Date(now - m * 60_000).toISOString()
const run = (o) => ({
  runId: o.runId, account: o.account ?? 'coastline', title: o.mark, markName: o.mark,
  projectKey: o.projectKey ?? null, projectName: o.projectName ?? null,
  // `product` is meta.searchLevel off the wire, and it holds a PRODUCT ID. The fixtures said `clearotron`
  // — a RETIRED slug — for every state, so this check could not see that depthLabel had no case for any
  // current product and the chip rendered EMPTY on every run the build creates. A fixture that speaks a
  // vocabulary the build no longer produces certifies the bug.
  // `productName` is what the CARD renders. It is resolved server-side by reportIdentityFor and
  // sent on the wire; the browser maps nothing. Derived here from `product` through that same resolver,
  // so this fixture cannot claim a name the service would not send. `stageLabel` stays on the row
  // because the wire still carries it — it is INTERNAL now and no client surface may print it.
  product: o.product ?? 'full-country-search',
  productName: reportIdentityFor(o.product ?? 'full-country-search').identity,
  stageLabel: reportIdentityFor(o.product ?? 'full-country-search').stageLabel,
  kind: o.kind ?? 'clearance', state: o.state,
  date: o.date ?? '2026-07-27', band: o.band ?? null, tone: o.tone ?? null, bands: [], marks: [],
  reportSchema: 2, held: false, report: o.state === 'delivered' ? `/portal/report/${o.runId}/` : null,
  step: o.step ?? null, stepN: o.stepN ?? null, stepTotal: o.stepTotal ?? null,
  reason: o.reason ?? null, failedStage: o.failedStage ?? null,
  pausedKind: o.pausedKind ?? null, resetsAt: o.resetsAt ?? null, startedAt: o.startedAt ?? null,
  queuePos: o.queuePos ?? null,
  // A STOP IN FLIGHT. `stopRequestedAt` beside a non-terminal state is the screen's "Stopping…";
  // `stoppable` is whether a stop can still prevent delivery, and the card draws the control from it.
  stopRequestedAt: o.stopRequestedAt ?? null, stoppable: o.stoppable ?? true,
})

// Three frameworks, three different ladders and three sets of words — the chip must take an arbitrary
// label, because Coastline Drinks has four bands and Foxglade Interactive's say something else entirely.
// Two of the three sit under projects, so "pick up where you left off" has something to draw. The
// project NAMES are deliberately long: a matter is called "Q3 packaging refresh — EU", not "spring",
// and a column tuned on a short slug tears the moment a real one arrives.
// A STOPPED RUN'S DATE IS DERIVED, NEVER A LITERAL. The failures fold is bounded by age
// (FAILURE_WINDOW_DAYS in portal-ui/src/contract/home.ts), so a fixture frozen to a date would drop out
// of it on a day nobody chose and red this file for a change nobody made. Today, every day.
const TODAY = new Date().toISOString().slice(0, 10)

const FINISHED = [
  run({ runId: 'f1', mark: 'VIBRANTE FROSTPLUM', state: 'delivered', band: 'Tier 3 — material', tone: 'high', date: '2026-07-26', projectKey: 'q3-packaging', projectName: 'Q3 packaging refresh — EU' }),
  run({ runId: 'f2', mark: 'VANTOR LABS', state: 'delivered', band: 'Clear to file', tone: 'minimal', date: '2026-07-24' }),
  run({ runId: 'f3', mark: 'AQUAPLUS', state: 'delivered', band: 'Proceed with conditions', tone: 'medium', date: '2026-07-21', projectKey: 'aqua-line', projectName: 'Aqua line extension' }),
]

const STATES = {
  // A card of each kind at once, plus a queue deep enough that its ordinals mean something.
  busy: {
    runs: [
      run({ runId: 'a', mark: 'CORAL FREEZE', state: 'running', step: 'Register sweeps', stepN: 2, stepTotal: 9, startedAt: ago(96) }),
      run({ runId: 'b', mark: 'KINETIC BLOOM', state: 'paused', pausedKind: 'rate-limit', stepN: 5, stepTotal: 9, resetsAt: new Date(now + 42 * 60_000).toISOString() }),
      run({ runId: 'c', mark: 'NORTHWIND', state: 'queued', queuePos: 1 }),
      run({ runId: 'd', mark: 'EMBER FORGE', state: 'queued', queuePos: 2 }),
      run({ runId: 'e', mark: 'CASTELLAN', state: 'queued', queuePos: 3 }),
      ...FINISHED,
    ],
    expectCards: 2, expectQueue: 3, expectFirstCardPips: 9, expectStops: 2,
    // The design's stop dialog is drawn over this card: CORAL FREEZE, on Register sweeps.
    stopDialog: 'CORAL FREEZE',
  },
  one: {
    runs: [run({ runId: 'a', mark: 'CORAL FREEZE', state: 'running', step: 'Common-law grid', stepN: 4, stepTotal: 9, startedAt: ago(38) }), ...FINISHED],
    expectCards: 1, expectQueue: 0, expectFirstCardPips: 9, expectStops: 1,
    expectExpect: '· usually 1.5 to 2.5 h',
  },
  // A knockout has FIVE steps, or six with the register probe. The pip row follows the RUN.
  knockout: {
    runs: [run({ runId: 'k', mark: 'DRIVERS HAVEN', state: 'running', kind: 'knockout-batch', product: 'knockout-search', step: 'Marketplace sweep', stepN: 3, stepTotal: 5, startedAt: ago(14) }), ...FINISHED],
    expectCards: 1, expectQueue: 0, expectFirstCardPips: 5, expectStops: 1,
    // PAST ITS OWN BOUND, AND THAT IS THE POINT. A knockout quotes 5 to 10 MINUTES, so a run 14 minutes
    // in is late by its own table while the same elapsed time is early for a clearance. One quote per
    // pipeline, read from the run rather than from the screen.
    expectExpect: '· taking longer than usual',
  },
  // A RUN THAT STOPPED IS NOT IN FLIGHT. It leaves the live band for its own fold, which states the
  // count unopened and holds the card — and the acknowledge on it — one click in. A failed card still
  // carries NO retry: re-running is command-line only, and a button would be a lie.
  failed: {
    runs: [run({ runId: 'x', mark: 'HALCYON', state: 'failed', date: TODAY, failedStage: 'at register sweeps', reason: 'A register was unreachable. Nothing was delivered.' }), ...FINISHED],
    expectCards: 0, expectQueue: 0, expectFirstCardPips: 0, expectStops: 0,
    expectStopped: 1, expectStoppedText: /1 stopped recently/,
  },
  // LIVE WORK AND A RECENT FAILURE ON ONE SCREEN — the state the whole change is about, and the one
  // neither scene above shows. Each of those has an empty band, so they prove the fold exists without
  // ever showing what it was for: a failure sitting quietly UNDER work that is still running, instead of
  // above it crowding the band out.
  bothd: {
    runs: [
      run({ runId: 'r', mark: 'CORAL FREEZE', state: 'running', step: 'Register sweeps', stepN: 2, stepTotal: 9, startedAt: ago(41) }),
      run({ runId: 'x', mark: 'HALCYON', state: 'failed', date: TODAY, failedStage: 'at register sweeps', reason: 'A register was unreachable. Nothing was delivered.' }),
      ...FINISHED,
    ],
    expectCards: 1, expectQueue: 0, expectFirstCardPips: 9, expectStops: 1,
    expectStopped: 1, expectStoppedText: /1 stopped recently/,
  },
  // Stopped on purpose — terminal, and never dressed as a failure. Same fold, same reason.
  stopped: {
    runs: [run({ runId: 'z', mark: 'GLASSWING', state: 'cancelled', date: TODAY }), ...FINISHED],
    expectCards: 0, expectQueue: 0, expectFirstCardPips: 0, expectStops: 0,
    expectStopped: 1, expectStoppedText: /1 stopped recently/,
  },
  // THE LABEL MUST WRAP, NEVER CLIP — measured on the LONGEST string the switch can return, which is
  // still a retired one: three of those differ only in their suffix, so an ellipsis makes "registers +
  // marketplace" and "registers only" the same string. Kept deliberately as an ARCHIVED run: nothing can
  // be ordered at that slug any more, and a card for a run that WAS must still say what it was.
  longdepth: {
    runs: [run({ runId: 'L', mark: 'MERIDIAN NORTHSTAR ASSURANCE', state: 'running', product: 'clearance-register-only', step: 'Register sweeps', stepN: 2, stepTotal: 9, startedAt: ago(20) }), ...FINISHED],
    expectCards: 1, expectQueue: 0, expectFirstCardPips: 9, expectStops: 1,
  },
  // THE CAP IS THE SERVER'S, NOT A LITERAL IN THE UI. It was written in as `2`, which is right today
  // and silently wrong the moment CLEAROTRON_MAX_CONCURRENT_RUNS is set to anything else.
  cap3: {
    runs: [run({ runId: 'a', mark: 'CORAL FREEZE', state: 'running', step: 'Register sweeps', stepN: 2, stepTotal: 9, startedAt: ago(96) }), ...FINISHED],
    cap: 3,
    expectCards: 1, expectQueue: 0, expectFirstCardPips: 9, expectStops: 1, expectCapNote: /Three runs at once/,
  },
  // PAST THE UPPER BOUND. The quote for a clearance is 1.5 to 2.5 hours, so a run started three hours
  // ago is past it and the card must REPLACE the quote with "taking longer than usual" rather than
  // revise it. Started from the table's own bound rather than a literal, so a ruling that moves the
  // quote moves this state with it instead of silently making it an ordinary card.
  slow: {
    runs: [run({ runId: 's', mark: 'CORAL FREEZE', state: 'running', step: 'Register sweeps', stepN: 6, stepTotal: 9, startedAt: ago(Math.ceil(TURNAROUND_QUOTE.clearance.highHours * 60) + 11) }), ...FINISHED],
    expectCards: 1, expectQueue: 0, expectFirstCardPips: 9, expectStops: 1,
    expectExpect: '· taking longer than usual',
  },
  // A STOP TAKING EFFECT. Not terminal — the run is still running and the step in flight is finishing —
  // so the card keeps its place in the band and loses its Stop, because there is nothing left to press.
  stopping: {
    runs: [run({ runId: 'sp', mark: 'GLASSWING', state: 'running', step: 'Register sweeps', stepN: 3, stepTotal: 9, startedAt: ago(22), stopRequestedAt: new Date(now - 30_000).toISOString() }), ...FINISHED],
    expectCards: 1, expectQueue: 0, expectFirstCardPips: 9, expectStops: 0,
    expectExpect: '',
    expectStopNote: 'Stopping — letting Register sweeps finish. No report will be produced. Completed work stays readable through Ask AI.',
  },
  quiet: { runs: FINISHED, expectCards: 0, expectQueue: 0, expectFirstCardPips: 0, expectStops: 0 },
  new: { runs: [], expectCards: 0, expectQueue: 0, expectFirstCardPips: 0, expectStops: 0, expectFirstRun: true },
  // A MULTI-BRAND ACCOUNT. Home spans every owner it holds — this is the state the previous attempt
  // emptied the moment someone picked one, with no way back.
  firm: {
    runs: [
      run({ runId: 'a', account: 'coastline', mark: 'CORAL FREEZE', state: 'running', step: 'Register sweeps', stepN: 2, stepTotal: 9, startedAt: ago(96) }),
      run({ runId: 'b', account: 'foxglade', mark: 'NORTHWIND', state: 'running', step: 'Framing the matter', stepN: 1, stepTotal: 9, startedAt: ago(6) }),
      run({ runId: 'c', account: 'ridgeform', mark: 'EMBER FORGE', state: 'queued', queuePos: 1 }),
      ...FINISHED,
    ],
    accounts: ['coastline', 'foxglade', 'ridgeform'],
    expectCards: 2, expectQueue: 1, expectFirstCardPips: 9, expectStops: 2,
    // A FIRM HOLDING THREE COMPANIES still has an organisation, and that is what the corner names. The
    // account-scoped title says what is actually on screen ("All companies"); the corner says who is
    // signed in. This used to expect the corner ABSENT here, because it rendered a COMPANY and a firm
    // holding three has no single one to name — the ruling that made it the organisation is what
    // retired that expectation, not a relaxation of it.
    // Several companies means several daily allowances and no single number. The line is ABSENT
    // rather than reading "unavailable", which would claim a fault where there is none.
    expectLimits: false,
  },
  // STILL WAITING FOR THE SERVER. A page that treats "not answered yet" as an answer shows an error or
  // an empty state on every single load.
  loading: {
    runs: FINISHED, holdRunsMs: 9000,
    expectCards: 0, expectQueue: 0, expectFirstCardPips: 0, expectStops: 0,
  },
  // A 429 must STATE the fault rather than rendering as "you have nothing".
  limited: {
    runs: [], status: 429,
    expectCards: 0, expectQueue: 0, expectFirstCardPips: 0, expectStops: 0,
    expectNotice: /Too many requests just now/,
  },
}

let current = 'busy'
/** Requests deliberately left unanswered, so they can be cut loose before the next state runs. */
const held = new Set()

/** Every stop the page sends. Selecting an option in the stop dialog must add nothing here. */
const stopRequests = []

const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname
  const json = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
  const s = STATES[current]
  if (/^\/portal\/api\/run\/[^/]+\/stop$/.test(path)) stopRequests.push(path)
  if (path === '/portal/api/me') {
    const accounts = s.accounts ?? ['coastline']
    // THE ORGANISATION the corner names is the one the server resolves — exactly one here, so it is named.
    // The corner used to render the COMPANY for a client holding one grant, then the brand setting; it
    // reads `organisations` now, so a fixture that supplied none would exercise the empty case on every
    // state rather than the one it means to. Every company sits in that one organisation.
    return json({ permissions: { run: true, manage: false }, email: 'counsel@coastline.test', accounts, concurrentRuns: s.cap ?? 2,
      access: [{ kind: 'organisation', key: 'tolliver', name: 'Tolliver & Quillon' }], genericOrgs: ['tolliver'],
      organisations: [{ key: 'tolliver', name: 'Tolliver & Quillon' }],
      accountOrgs: Object.fromEntries(accounts.map((a) => [a, 'tolliver'])),
      brand: 'Tolliver & Quillon',
      accountNames: { coastline: 'Coastline Drinks', foxglade: 'Foxglade Interactive', ridgeform: 'Ridgeform', generic: 'Generic default' } })
  }
  if (path === '/portal/api/runs') {
    // What portal-service actually answers a multi-owner client who has named nobody. The browser
    // decodes it to `pickAccount`, which is a UI state, never an error to print at someone.
    if (s.status) {
      res.writeHead(s.status, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ error: 'rate_limited' }))
    }
    // Held: the page must be probed while it is still WAITING, which is the state a fixed settle delay
    // can otherwise never see.
    //
    // TRACKED SO IT CAN BE CUT LOOSE. A browser opens six connections per host, and four held requests
    // (two themes × navigate-then-reload) were still occupying them when the NEXT state loaded — so
    // that state's own request queued behind them, never answered inside the settle window, and was
    // probed mid-load. It read as the next state failing, which is the most expensive kind of harness
    // bug: one that reports a fault in the code under test.
    if (s.holdRunsMs) {
      held.add(res)
      return setTimeout(() => { if (held.delete(res)) json({ runs: s.runs }) }, s.holdRunsMs)
    }
    return json({ runs: s.runs })
  }
  if (path === '/portal/admin/roster') return json({ customers: [{ key: 'coastline', name: 'Coastline Drinks' }, { key: 'foxglade', name: 'Foxglade Interactive' }, { key: 'ridgeform', name: 'Ridgeform' }] })
  if (path === '/portal/api/usage') {
    return json({ account: 'coastline', today: s.capped ? 2 : 1, thisMonth: 6, queued: 2, dailyRuns: 2, monthlyRuns: null, maxQueued: null, capped: true })
  }
  if (path.startsWith('/portal/api/') || path.startsWith('/portal/admin/')) return json({})

  const base = path
  const file = base === '/' || (base.startsWith('/portal') && !base.includes('.')) ? '/index.html' : base.replace(/^\/portal/, '')
  const full = join(DIST, file)
  if (!existsSync(full)) { res.writeHead(404); res.end('no'); return }
  res.writeHead(200, { 'content-type': MIME[extname(full)] ?? 'application/octet-stream' })
  res.end(readFileSync(full))
})

await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`

// The profile goes inside a run root whose TMPDIR the browser inherits, so the singleton
// lock it writes there leaves with the root instead of accumulating in the shared one.
const { profile: userDir, env: chromeEnv } = browserRun("home-check-")
const chrome = spawn('google-chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--user-data-dir=${userDir}`, '--window-size=1280,1000',
  '--remote-debugging-port=0', 'about:blank',
  // — DETACHED so Chrome LEADS A PROCESS GROUP. Its renderer, GPU and zygote processes are
  // separate PIDs, and without a group there is nothing to signal them with.
], { stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: chromeEnv })
// — and the group dies with THIS script, on every exit it can observe.
// The teardown below runs on the paths somebody wrote a branch for; a cancelled CI job (SIGTERM),
// a Ctrl-C, or a throw elsewhere in this file are not among them — and that is where the measured
// eighty-eight-minute orphan came from.
reapOnExit(chrome);

let devtools = ''
const wsUrl = await new Promise((resolve, reject) => {
  // 60s, not 20s. The 20s budget was set when CI ran on a paid 4-vCPU larger runner; this workflow now
  // runs on the standard 2-vCPU ubuntu-latest, where a cold Chrome start has no margin in 20s — it
  // failed once in the first 6 runs there with 'chrome did not report a devtools endpoint'.
  //
  // WHAT THE NUMBERS DO NOT SHOW, stated because the tempting claim is wrong: this is NOT established
  // as a regression from the runner change. The same step failed 6 times in 34 runs on ubuntu-latest-m
  // — but all 6 landed inside one 16-minute window on 2026-08-10, across several branches at once,
  // which is an infrastructure incident and not a rate. Outside it: 0 in 28. So the evidence is
  // consistent with the smaller runner being tighter and does not demonstrate it; n is small on both
  // sides. The budget goes up because 20s for a cold Chrome start is thin on any 2-vCPU box, not
  // because a measurement proved causation.
  //
  // And on timeout, SAY WHAT CHROME SAID — the bare message named a symptom and no cause, so the one
  // thing the next reader needs was the one thing it withheld.
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
const cmd = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, sessionId, method, params })) })
const evalIn = async (expr) => {
  const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  return r.result?.result?.value
}

// What the page is asked about itself, once it has painted.
const PROBE = `(() => {
  const q = (sel) => document.querySelector(sel)
  const all = (sel) => [...document.querySelectorAll(sel)]
  if (!q('.home2')) return { fatal: 'Home did not render' }
  return {
    // THE LIVE BAND'S CARDS, NOT THE PAGE'S. A stopped run draws the same component inside the fold
    // below, so a page-wide count reads 1 for a band that is correctly empty — and the assertion that
    // failures LEFT the band would pass or fail on whether the fold happened to be open.
    cards: all('.home2-card').filter((n) => !n.closest('.home2-stopped')).length,
    queueRows: all('.home2-qrow').length,
    queueCount: (q('.home2-queue-count')?.textContent ?? '').trim(),
    // The ordinals, as drawn. They must read 1..N with no gaps — a gap would mean the screen is
    // showing another tenant's place in the lane.
    ordinals: all('.home2-pos').map((n) => n.textContent.trim()),
    stops: all('.home2-stop').length,
    // WHAT STOPPED RECENTLY — the count is the part that must be readable without opening anything,
    // because it is the page's only standing signal that a search died while nobody was looking. The
    // card count inside it is read after the toggle is pressed, below.
    stoppedToggle: (q('.home2-stopped-toggle')?.textContent ?? '').trim(),
    stoppedCards: [...(q('.home2-stopped')?.querySelectorAll('.home2-card') ?? [])].length,
    cancels: all('.home2-cancel').length,
    // FIRST CARD'S PIPS — N comes from the run, never a constant.
    pips: (() => {
      const first = all('.home2-card').find((n) => !n.closest('.home2-stopped'))
      return first ? [...first.querySelectorAll('.home2-pip')].length : 0
    })(),
    // THE DEPTH LABEL MUST NOT BE CLIPPED. A string test cannot see this; only a browser can.
    depthClipped: all('.home2-depth').filter((n) => n.scrollWidth > n.clientWidth + 1).length,
    depthText: (q('.home2-depth')?.textContent ?? '').trim(),
    // The band header is a GRID, so the button stays on the same row at every width.
    newOnBandRow: (() => {
      const band = q('.home2-band'), btn = q('.home2-band .home2-new')
      if (!band || !btn) return null
      return Math.abs(btn.getBoundingClientRect().top - band.getBoundingClientRect().top) < band.getBoundingClientRect().height
    })(),
    lastFinished: !!q('.home2-done'),
    allClearances: all('.home2-all').length,
    limits: (q('.home2-limits')?.textContent ?? '').trim(),
    capNote: (q('.home2-band-note')?.textContent ?? '').trim(),
    firstRun: !!q('.home2-firstrun'),
    notice: (q('.home2-notice')?.textContent ?? '').trim(),
    // WHAT THIS CHANGE ADDED, read off the rendered page rather than the source. The quote beside the
    // elapsed time, and the sentence a stopping card carries — both are strings a reader sees, so a
    // source assertion would prove the template obeys and not that anyone asks it to.
    expect: (q('.home2-expect')?.textContent ?? '').trim(),
    band: (q('.home2-band-count')?.textContent ?? '').trim(),
    stopNote: (q('.home2-stop-note')?.textContent ?? '').replace(/\\s+/g, ' ').trim(),
    title: (q('.topbar h1')?.textContent ?? '').trim(),
    accountLabelled: all('.topbar .eyebrow').some((n) => n.textContent.trim() === 'Organisation'),
    // The VALUE beside the label, so the arm below can say what the corner names rather than only that
    // it names something. A label with the wrong noun under it is the failure being guarded.
    accountName: (all('.topbar .eyebrow').find((n) => n.textContent.trim() === 'Organisation')
      ?.nextElementSibling?.textContent ?? '').trim(),
    // Every mark, owner and project must be blurrable — the class is not the contract, the attribute is.
    untaggedMarks: all('.home2-card-mark, .home2-card-owner, .home2-qmark, .home2-qowner, .home2-done-mark')
      .filter((n) => n.getAttribute('data-anon') !== 'mark').length,
    sidewaysOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    // The sidebar's owner group must be labelled by the switcher, not floating above everything.
    switcherInNav: !!q('.sidebar-scroll select[aria-label="Company"]'),
    theme: document.documentElement.getAttribute('data-theme') ?? 'light',
  }
})()`

let failures = 0
const say = (ok, msg) => { if (!ok) failures++; console.log(`${ok ? '  ok  ' : 'FAIL  '}${msg}`) }

for (const [name, spec] of Object.entries(STATES)) {
  // Free the previous state's held connections before this one asks for anything. See the note in the
  // runs handler: without this, a deliberately-slow state starves the state that follows it.
  for (const r of held) { try { r.destroy() } catch { /* already gone */ } }
  held.clear()
  current = name
  for (const theme of ['light', 'dark']) {
    await cmd('Page.navigate', { url: 'about:blank' })
    await new Promise((r) => setTimeout(r, 120))
    // — WAIT FOR THE PAGE TO GO QUIET, DO NOT SLEEP A GUESS AT IT.
    //
    // These were fixed 700ms and 1100ms waits. 1100ms is a guess and under load it is the wrong guess:
    // on a box at load 18-22 `quiet/dark` read the page before it rendered and failed on PROBE's own
    // fatal, `Home did not render`, while every other state in the same run passed. Same defect as
    // FLAKE 2 and — measuring before the thing exists.
    //
    // THREE NARROWER WAITS WERE TRIED FIRST AND EACH WAS WORSE, which is why this one is a quiescence
    // check and not a selector:
    //   1. poll for `.home2` — returns against the OUTGOING document, because immediately after
    //      `Page.reload` the old one is still there. THREE states then failed where the sleep passed.
    //   2. + require the document not be the stamped outgoing one — fixed that, and `one/dark` read
    //      0 cards where 1 was expected: the shell mounts before its contents.
    //   3. + require the expected card count — and the allowance line, the finished tail and the nav
    //      links were still arriving.
    // Each fix revealed one more thing the 1100ms happened to cover. Enumerating them is a losing game;
    // what the assertions actually need is a page that has STOPPED CHANGING.
    //
    // A SETTLE IS NOT A SLEEP. This returns as soon as the DOM is stable across two samples, so the
    // common case is faster than the old fixed wait, and it cannot return before the page exists
    // because a stamped or empty document never satisfies the preconditions.
    const homeReady = async (after) => {
      const deadline = Date.now() + 20000
      let seen = { home: 0, ready: '', url: '', stale: true, size: 0 }
      let stableFor = 0, lastSize = -1
      for (;;) {
        seen = await evalIn(`(() => ({
          home: document.querySelectorAll('.home2').length,
          ready: document.readyState,
          url: String(location.pathname),
          stale: window.__renderCheckDoc === 1,
          size: document.documentElement.innerHTML.length,
        }))()`) ?? seen
        const usable = seen.home > 0 && !seen.stale && seen.ready === 'complete'
        stableFor = usable && seen.size === lastSize ? stableFor + 1 : 0
        lastSize = seen.size
        if (stableFor >= 2) return true
        if (Date.now() >= deadline) {
          say(false, `${name}/${theme}: Home never settled within 20s after ${after} — `
            + `readyState=${seen.ready || '(unknown)'} path=${seen.url || '(unknown)'} `
            + `.home2=${seen.home} staleDoc=${seen.stale} lastSize=${seen.size}. `
            + `The wait is a deadline on a settling page, not a fixed sleep (#1854).`)
          return false
        }
        await new Promise((r) => setTimeout(r, 60))
      }
    }

    await evalIn(`window.__renderCheckDoc = 1`)
    await navigateOrRefuse(cmd, `${origin}/portal/home`, { what: 'home-render-check' })
    if (!await homeReady('navigate')) continue
    await evalIn(`localStorage.setItem('cordillera-theme', ${JSON.stringify(theme)})`)
    await evalIn(`window.__renderCheckDoc = 1`)
    await cmd('Page.reload', { ignoreCache: false })
    if (!await homeReady('reload')) continue

    // The queue panel is collapsed by default — open it so its rows can be measured.
    //
    // FLAKE 2. This used to click and then sleep a FIXED 250ms before reading. The click has to
    // survive a React re-render, a DOM insert and the panel's expand transition, and on a 2-vCPU
    // ubuntu-latest runner that does not always fit. When it did not, all three queue assertions failed
    // together — rows ABSENT rather than wrong, which is the signature of measuring too early:
    //   busy/light: 0 queue rows (expected 3) / every queued row can be cancelled (0/3) / ordinals []
    // It failed on a PR whose entire diff was one driver test file, and the same SHA re-ran green.
    //
    // So: POLL for the rows instead of guessing how long they take. This file already sets the
    // precedent — the devtools-endpoint wait polls, and its ceiling was widened from 20s to 60s for
    // exactly this runner. A ceiling that expires still reads whatever is there and lets the assertion
    // below report the real count, so a genuine "no rows" bug fails as loudly as it always did.
    //
    // — AND THE CLICK ITSELF WAS NEVER WAITED FOR, WHICH IS THE HOLE THE POLL LEFT. `?.click`
    // fires ONCE and optional-chains: a queue bar that has not mounted yet is a silent no-op, and the
    // loop then polls for rows in a panel nobody opened until the ceiling expires. That is an ABSENCE
    // being read as "not yet". It reddened `main` on run 32702264758 for a diff of one driver test file
    // and a census entry — the same tree the PR run had passed twenty minutes earlier.
    //
    // So poll the BAR and its own `aria-expanded`, and click only while it is closed. Not "re-click
    // every iteration": the bar toggles, so a blind re-click closes a panel that had just opened and the
    // read lands on whichever half of the oscillation it hit.
    //
    // AND A CEILING THAT EXPIRES MUST SAY WHICH OF THE TWO RAN OUT. "0 queue rows" is the same sentence
    // for a panel that never mounted, a panel nobody opened, and a panel that opened empty — and only
    // the third is a product defect. The state at the ceiling is printed, so the next reader is told
    // rather than left to re-derive it from three failing assertions.
    // THE CLOSED FRAME IS TAKEN FIRST, because it is the one a reader meets. Everything below opens the
    // fold in order to assert what is behind it, and a picture taken after that shows a state nobody
    // arrives in — which is exactly the view the whole change is about.
    if (shotDir && spec.expectStopped) {
      const shut = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
      const d = shut.result?.result?.data ?? shut.result?.data
      if (d) writeFileSync(join(shotDir, `home-${name}-${theme}-closed.png`), Buffer.from(d, 'base64'))
    }

    // THE FAILURES FOLD, OPENED THE SAME WAY AND FOR THE SAME REASON. `?.click` on a control that has
    // not mounted is a silent no-op that reads as "the panel opened empty", so poll the toggle and its
    // own aria-expanded, click only while it is shut, and say WHICH of the two ran out at the ceiling.
    if (spec.expectStopped) {
      const deadline = Date.now() + 20000
      let last = { toggle: 0, expanded: false, cards: 0 }
      for (;;) {
        last = await evalIn(`(() => {
          const t = document.querySelector('.home2-stopped-toggle')
          return { toggle: document.querySelectorAll('.home2-stopped-toggle').length,
                   expanded: t?.getAttribute('aria-expanded') === 'true',
                   cards: document.querySelectorAll('.home2-stopped .home2-card').length }
        })()`) ?? last
        if (last.cards >= spec.expectStopped) break
        if (last.toggle && !last.expanded) await evalIn(`document.querySelector('.home2-stopped-toggle')?.click()`)
        if (Date.now() >= deadline) {
          say(false, `${name}/${theme}: the stopped fold never showed ${spec.expectStopped} card(s) in 20s — `
            + (!last.toggle ? 'the fold never mounted, so the acknowledge on a stopped run is unreachable'
              : !last.expanded ? 'it mounted but never reported aria-expanded=true, so it stayed shut'
                : `it WAS open and held ${last.cards} card(s)`))
          break
        }
        await new Promise((r) => setTimeout(r, 100))
      }
    }

    if (spec.expectQueue) {
      const deadline = Date.now() + 20000
      let last = { bar: 0, expanded: false, rows: 0 }
      for (;;) {
        last = await evalIn(`(() => {
          const bar = document.querySelector('.home2-queue-bar')
          return { bar: document.querySelectorAll('.home2-queue-bar').length,
                   expanded: bar?.getAttribute('aria-expanded') === 'true',
                   rows: document.querySelectorAll('.home2-qrow').length }
        })()`) ?? last
        if (last.rows >= spec.expectQueue) break
        if (last.bar && !last.expanded) await evalIn(`document.querySelector('.home2-queue-bar')?.click()`)
        if (Date.now() >= deadline) {
          say(false, `${name}/${theme}: the queue panel never showed ${spec.expectQueue} rows in 20s — `
            + (!last.bar ? 'the queue BAR never mounted, so no click was ever possible'
              : !last.expanded ? 'the bar mounted but never reported aria-expanded=true, so the panel stayed shut'
                : `the panel WAS open and held ${last.rows} rows`))
          break
        }
        await new Promise((r) => setTimeout(r, 100))
      }
    }

    const out = await evalIn(PROBE)
    if (!out || out.fatal) { say(false, `${name}/${theme}: ${out?.fatal ?? 'no probe result'}`); continue }

    say(out.theme === theme, `${name}/${theme}: theme applied (${out.theme})`)
    say(out.cards === spec.expectCards, `${name}/${theme}: ${out.cards} cards (expected ${spec.expectCards})`)
    say(out.queueRows === spec.expectQueue, `${name}/${theme}: ${out.queueRows} queue rows (expected ${spec.expectQueue})`)
    say(out.pips === spec.expectFirstCardPips, `${name}/${theme}: first card has ${out.pips} pips (expected ${spec.expectFirstCardPips})`)

    // STOP APPEARS ONLY WHERE IT CAN DO SOMETHING. A failed or stopped run is terminal; a button on it
    // would be a control that cannot act.
    say(out.stops === spec.expectStops, `${name}/${theme}: ${out.stops} Stop buttons (expected ${spec.expectStops})`)
    say(out.cancels === spec.expectQueue, `${name}/${theme}: every queued row can be cancelled (${out.cancels}/${spec.expectQueue})`)

    // THE ORDINALS ARE DENSE, 1..N. A gap would be this account being told how much work other tenants
    // have queued ahead of it.
    if (spec.expectQueue) {
      const want = Array.from({ length: spec.expectQueue }, (_, i) => String(i + 1))
      say(JSON.stringify(out.ordinals) === JSON.stringify(want),
        `${name}/${theme}: ordinals ${JSON.stringify(out.ordinals)} (expected ${JSON.stringify(want)})`)
    }

    // THE CHIP SAYS SOMETHING. The card renders the wire's `productName` verbatim, so an empty chip now
    // means the SERVICE sent no name — which looks like a design choice rather than a defect, and shipped
    // as one for as long as the browser held its own switch listing only the retired ladder.
    if (spec.expectCards) say(out.depthText.length > 0, `${name}/${theme}: the card names its search ("${out.depthText}")`)

    // THE COUNT IS READABLE WITHOUT OPENING ANYTHING. It is the page's only standing signal that a
    // search stopped, so an empty band plus a silent fold would be the silence this whole change had to
    // avoid — and it would look exactly like a clean dashboard.
    if (spec.expectStopped) {
      say(spec.expectStoppedText.test(out.stoppedToggle),
        `${name}/${theme}: the fold states what stopped ("${out.stoppedToggle}")`)
      say(out.stoppedCards === spec.expectStopped,
        `${name}/${theme}: ${out.stoppedCards} stopped card(s) behind it (expected ${spec.expectStopped})`)
      // WHAT THE BAND HOLDS IS `expectCards`, ASSERTED ABOVE, AND NOT ZERO HERE. This said zero, which
      // was true of both scenes that existed when it was written — each has a stopped run and no live
      // work — so it read as "failures left the band" while actually asserting "nothing is running".
      // The scene with both on screen is what told them apart.
    }
    // AND IT SAYS NO RUNG. "Depth 4" / "Stage 1" are internal; a client screen must never carry either.
    if (spec.expectCards) say(!/\b(Depth|Stage)\s*\d/i.test(out.depthText),
      `${name}/${theme}: the chip carries no depth or stage number ("${out.depthText}")`)
    // THE ONE A STRING TEST CANNOT SEE.
    say(out.depthClipped === 0, `${name}/${theme}: no depth label is clipped (${out.depthClipped} clipped)`)
    say(out.sidewaysOverflow === 0, `${name}/${theme}: no sideways scroll (${out.sidewaysOverflow}px)`)

    // ── THE QUOTE, AND THE FACT THAT IT IS NEVER A COUNTDOWN ────────────────────────────────────
    //
    // Asserted on every state, not only the ones that declare a quote: the second half of this is that
    // NO card anywhere predicts what is left, and a rule like that is only worth having if it is read
    // over the whole population rather than where somebody remembered to look.
    if (spec.expectExpect !== undefined) {
      say(out.expect === spec.expectExpect,
        `${name}/${theme}: the card's expectation reads "${out.expect}" (expected "${spec.expectExpect}")`)
    }
    say(!/\b(left|remaining|to go|eta)\b/i.test(out.expect),
      `${name}/${theme}: no card predicts time remaining ("${out.expect}")`)
    if (spec.expectStopNote) {
      say(out.stopNote === spec.expectStopNote,
        `${name}/${theme}: the stopping line reads "${out.stopNote}"`)
    }
    say(out.untaggedMarks === 0, `${name}/${theme}: every mark and owner is blurrable (${out.untaggedMarks} untagged)`)
    if (out.newOnBandRow !== null) {
      say(out.newOnBandRow === true, `${name}/${theme}: New clearance stays on the section-header row`)
    }

    if (spec.expectNotice) {
      say(spec.expectNotice.test(out.notice), `${name}/${theme}: the fault is stated ("${out.notice.slice(0, 48)}")`)
    } else {
      say(out.notice === '', `${name}/${theme}: no fault notice where there is no fault`)
    }

    // HOME NEVER RE-LISTS THE ARCHIVE: one finished line, and a way into Clearances.
    const answered = spec.runs.some((r) => r.state === 'delivered') && !spec.holdRunsMs && !spec.status
    say(out.lastFinished === answered, `${name}/${theme}: the finished tail is ${answered ? 'one line' : 'absent'}`)
    if (answered) say(out.allClearances === 1, `${name}/${theme}: exactly one way into Clearances (${out.allClearances})`)

    if (spec.expectLimits === false) {
      say(out.limits === '', `${name}/${theme}: no allowance line where there is no single allowance ("${out.limits.slice(0, 40)}")`)
    } else {
      say(/runs? used today|No daily cap/.test(out.limits),
        `${name}/${theme}: the allowance line states a real allowance ("${out.limits.slice(0, 44)}")`)
    }
    if (spec.expectCapNote) {
      say(spec.expectCapNote.test(out.capNote), `${name}/${theme}: the cap comes from the server ("${out.capNote}")`)
    }
    if (spec.expectFirstRun) say(out.firstRun && out.cards === 0, `${name}/${theme}: first-run panel, no empty card slots`)

    // The top bar names the SCOPE. Home is account-scoped, so it names the account — never one brand
    // owner over a screen that is showing several.
    // HOME IS ACCOUNT-SCOPED, SO THE BAR'S TITLE IS EMPTY. It used to read the company, which was wrong
    // on a screen that spans every company the identity holds; the organisation is named at the right,
    // once. Every state below expects the same empty title, which is why this no longer varies per spec.
    const wantTitle = spec.expectTitle ?? ''
    say(out.title === wantTitle, `${name}/${theme}: top bar reads "${out.title}" (expected "${wantTitle}")`)
    const wantAccount = spec.expectAccount !== false
    say(out.accountLabelled === wantAccount,
      `${name}/${theme}: the Organisation label ${wantAccount ? 'is still there' : 'is absent as expected'}`)
    // ONE SLOT, ONE NOUN. The corner carries the organisation; the company is read in the rail and in
    // the heading. A company name appearing here is the dual meaning coming back, and it would look
    // entirely correct on a screen where the two happen to be the same word.
    if (wantAccount) {
      say(out.accountName === 'Tolliver & Quillon',
        `${name}/${theme}: the corner names the organisation, read "${out.accountName}"`)
      say(!/Coastline|Foxglade|Ridgeform/.test(out.accountName),
        `${name}/${theme}: the corner names a COMPANY — "${out.accountName}"`)
    }
    // The switcher belongs INSIDE the nav, as the header of the group it governs.
    if (spec.accounts && spec.accounts.length > 1) {
      say(out.switcherInNav, `${name}/${theme}: the company switcher labels its nav group`)
    }

    if (shotDir) {
      const shot = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
      const data = shot.result?.result?.data ?? shot.result?.data
      if (data) writeFileSync(join(shotDir, `home-${name}-${theme}.png`), Buffer.from(data, 'base64'))
    }

    // ── THE STOP DIALOG, EACH OPTION SELECTED ─────────────────────────────────────────────────────────
    //
    // Opened from the running card the way a reader opens it. The safe option is selected first; picking
    // the other changes the primary button's words to name it; and choosing stops NOTHING — only the button
    // does. Asserted on every run, pictured when --shot-dir is given.
    if (spec.stopDialog) {
      // The dialog is a fixed overlay, so it is pictured in a viewport as tall as the page: a beyond-viewport
      // capture would paint it over the top 900px only.
      const tallShot = async (file) => {
        const h = await evalIn('Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)') ?? 900
        await cmd('Emulation.setDeviceMetricsOverride', { width: 1280, height: Math.max(900, h), deviceScaleFactor: 1, mobile: false })
        await new Promise((r) => setTimeout(r, 400))
        const shot = await cmd('Page.captureScreenshot', { format: 'png' })
        await cmd('Emulation.clearDeviceMetricsOverride', {})
        const data = shot.result?.result?.data ?? shot.result?.data
        if (data) writeFileSync(join(shotDir, file), Buffer.from(data, 'base64'))
      }
      const sentBefore = stopRequests.length
      const read = `(() => { const d = document.querySelector('.modal-scrim'); if (!d || !d.querySelector('.stop-choice')) return null;
        return { primary: (d.querySelector('.modal-foot .btn-primary') || {}).textContent?.trim() ?? null,
                 buttons: [...d.querySelectorAll('.modal-foot button')].map((b) => b.textContent.trim()),
                 checked: [...d.querySelectorAll('.stop-choice input[type=radio]')].map((r) => r.checked),
                 selected: [...d.querySelectorAll('.stop-choice-opt')].map((o) => o.classList.contains('selected')),
                 text: d.innerText.replace(/\\s+/g, ' ') } })()`
      const opened = await evalIn(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
        const card = [...document.querySelectorAll('.home2-card')].find((c) => c.innerText.includes(${JSON.stringify(spec.stopDialog)}))
        const stop = card && [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Stop')
        if (!stop) return { error: 'the running card has no Stop' }
        stop.click()
        for (let i = 0; i < 80 && !document.querySelector('.stop-choice'); i++) await sleep(60)
        await sleep(150)
        return ${read} ?? { error: 'Stop opened no dialog' }
      })()`)
      say(opened && !opened.error, `${name}/${theme}: the stop dialog opened from the card (${opened?.error ?? 'ok'})`)
      if (opened && !opened.error) {
        say(opened.primary === 'Stop after this step' && opened.checked[0] === true && opened.selected[0] === true,
          `${name}/${theme}: the dialog opens on "Stop after this step", and its button says so — read ${JSON.stringify(opened.primary)} ${JSON.stringify(opened.checked)}`)
        say(JSON.stringify(opened.buttons) === JSON.stringify(['Stop after this step', 'Leave it running']),
          `${name}/${theme}: the primary button and "Leave it running" sit side by side, primary first — read ${JSON.stringify(opened.buttons)}`)
        say(/A stopped search cannot be restarted and produces no report\. It stays in Clearances, marked stopped\. Its finished steps stay readable through Ask AI\./.test(opened.text),
          `${name}/${theme}: the stop dialog states the facts of a stop`)
        say(/Register sweeps finishes first, so its work is kept\. There is no reliable completion estimate for this step\./.test(opened.text)
          && /Register sweeps is cut off and its work is lost\. Everything recorded before it is kept\./.test(opened.text),
          `${name}/${theme}: both options name the step in progress`)
        say(!/allowance/i.test(opened.text), `${name}/${theme}: the stop dialog says nothing about the allowance`)
        if (shotDir) await tallShot(`home-stop-dialog-after-step-${theme}.png`)
        const now = await evalIn(`(async () => {
          const opt = document.querySelectorAll('.stop-choice-opt')[1]
          if (!opt) return null
          opt.click()
          await new Promise((r) => setTimeout(r, 200))
          return ${read}
        })()`)
        say(now?.primary === 'Stop now' && now?.checked[1] === true && now?.selected[1] === true,
          `${name}/${theme}: selecting "Stop now" moves the selection and the button's words with it — read ${JSON.stringify(now?.primary)} ${JSON.stringify(now?.checked)}`)
        say(stopRequests.length === sentBefore,
          `${name}/${theme}: choosing an option sends no stop — only the button stops the search (sent ${stopRequests.length - sentBefore})`)
        if (shotDir) await tallShot(`home-stop-dialog-now-${theme}.png`)
        const closed = await evalIn(`(async () => {
          const leave = [...document.querySelectorAll('.modal-foot button')].find((b) => b.textContent.trim() === 'Leave it running')
          if (!leave) return false
          leave.click()
          for (let i = 0; i < 40 && document.querySelector('.stop-choice'); i++) await new Promise((r) => setTimeout(r, 60))
          return !document.querySelector('.stop-choice')
        })()`)
        say(closed === true && stopRequests.length === sentBefore,
          `${name}/${theme}: "Leave it running" closes the dialog and stops nothing`)
      }
    }
  }
}

// — SIGNAL THE GROUP, NOT THE PROCESS. `chrome.kill` reaches only the process spawned here;
// its renderer and GPU children survive and keep writing the profile directory, so the rmSync below
// races them. Here that loss is SILENT — the rmSync is wrapped — which is why this file never failed
// CI the way render-check.mjs did, and instead leaked a temp profile and stray processes per run.
try { process.kill(-chrome.pid, 'SIGKILL') }
catch { try { chrome.kill('SIGKILL') } catch { /* already gone */ } }
server.close()
try { rmSync(userDir, { recursive: true, force: true }) } catch { /* best effort */ }
console.log(failures ? `\n${failures} failed` : '\nall states drew correctly, in both themes')
process.exit(failures ? 1 : 0)
