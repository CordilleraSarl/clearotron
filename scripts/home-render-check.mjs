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

import { createServer } from 'node:http'
import { reapOnExit } from "../shared/reap-on-exit.mjs";   // — a detached group dies with this script
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
// — the fixture derives its product NAME the way portal-service.mjs does, from the one resolver.
// Hardcoding the string here would let the fixture and the wire drift, which is the defect the comment
// on `product` below already records once.
import { reportIdentityFor } from '../driver/search-policy.mjs'

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
  runId: o.runId, account: o.account ?? 'zephyr', title: o.mark, markName: o.mark,
  projectKey: o.projectKey ?? null, projectName: o.projectName ?? null,
  // `product` is meta.searchLevel off the wire, and it holds a PRODUCT ID. The fixtures said `prelim`
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
})

// Three frameworks, three different ladders and three sets of words — the chip must take an arbitrary
// label, because Zephyr Beverages has four bands and Aurora Interactive's say something else entirely.
// Two of the three sit under projects, so "pick up where you left off" has something to draw. The
// project NAMES are deliberately long: a matter is called "Q3 packaging refresh — EU", not "spring",
// and a column tuned on a short slug tears the moment a real one arrives.
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
  },
  one: {
    runs: [run({ runId: 'a', mark: 'CORAL FREEZE', state: 'running', step: 'Common-law grid', stepN: 4, stepTotal: 9, startedAt: ago(38) }), ...FINISHED],
    expectCards: 1, expectQueue: 0, expectFirstCardPips: 9, expectStops: 1,
  },
  // A knockout has FIVE steps, or six with the register probe. The pip row follows the RUN.
  knockout: {
    runs: [run({ runId: 'k', mark: 'DRIVERS HAVEN', state: 'running', kind: 'knockout-batch', product: 'knockout-search', step: 'Marketplace sweep', stepN: 3, stepTotal: 5, startedAt: ago(14) }), ...FINISHED],
    expectCards: 1, expectQueue: 0, expectFirstCardPips: 5, expectStops: 1,
  },
  // A failed card carries NO retry: re-running is command-line only, and a button would be a lie.
  failed: {
    runs: [run({ runId: 'x', mark: 'HALCYON', state: 'failed', failedStage: 'at register sweeps', reason: 'A register was unreachable. Nothing was delivered.' }), ...FINISHED],
    expectCards: 1, expectQueue: 0, expectFirstCardPips: 0, expectStops: 0,
  },
  // Stopped on purpose — terminal, and never dressed as a failure.
  stopped: {
    runs: [run({ runId: 'z', mark: 'GLASSWING', state: 'cancelled' }), ...FINISHED],
    expectCards: 1, expectQueue: 0, expectFirstCardPips: 0, expectStops: 0,
  },
  // THE LABEL MUST WRAP, NEVER CLIP — measured on the LONGEST string the switch can return, which is
  // still a retired one: three of those differ only in their suffix, so an ellipsis makes "registers +
  // marketplace" and "registers only" the same string. Kept deliberately as an ARCHIVED run: nothing can
  // be ordered at that slug any more, and a card for a run that WAS must still say what it was.
  longdepth: {
    runs: [run({ runId: 'L', mark: 'MERIDIAN NORTHSTAR ASSURANCE', state: 'running', product: 'prelim-register-only', step: 'Register sweeps', stepN: 2, stepTotal: 9, startedAt: ago(20) }), ...FINISHED],
    expectCards: 1, expectQueue: 0, expectFirstCardPips: 9, expectStops: 1,
  },
  // THE CAP IS THE SERVER'S, NOT A LITERAL IN THE UI. It was written in as `2`, which is right today
  // and silently wrong the moment CLEAROTRON_MAX_CONCURRENT_RUNS is set to anything else.
  cap3: {
    runs: [run({ runId: 'a', mark: 'CORAL FREEZE', state: 'running', step: 'Register sweeps', stepN: 2, stepTotal: 9, startedAt: ago(96) }), ...FINISHED],
    cap: 3,
    expectCards: 1, expectQueue: 0, expectFirstCardPips: 9, expectStops: 1, expectCapNote: /Three runs at once/,
  },
  quiet: { runs: FINISHED, expectCards: 0, expectQueue: 0, expectFirstCardPips: 0, expectStops: 0 },
  new: { runs: [], expectCards: 0, expectQueue: 0, expectFirstCardPips: 0, expectStops: 0, expectFirstRun: true },
  // A MULTI-BRAND ACCOUNT. Home spans every owner it holds — this is the state the previous attempt
  // emptied the moment someone picked one, with no way back.
  firm: {
    runs: [
      run({ runId: 'a', account: 'zephyr', mark: 'CORAL FREEZE', state: 'running', step: 'Register sweeps', stepN: 2, stepTotal: 9, startedAt: ago(96) }),
      run({ runId: 'b', account: 'aurora', mark: 'NORTHWIND', state: 'running', step: 'Framing the matter', stepN: 1, stepTotal: 9, startedAt: ago(6) }),
      run({ runId: 'c', account: 'ridgeform', mark: 'EMBER FORGE', state: 'queued', queuePos: 1 }),
      ...FINISHED,
    ],
    accounts: ['zephyr', 'aurora', 'ridgeform'],
    expectCards: 2, expectQueue: 1, expectFirstCardPips: 9, expectStops: 2,
    // A FIRM HOLDING THREE BRAND OWNERS HAS NO SINGLE ACCOUNT NAME the portal knows — it knows the
    // owners they hold, not what the firm calls itself. So the account-scoped title says what is
    // actually on screen ("All brand owners") and the Account block is absent rather than picking one
    // of their own clients and labelling it their identity. Home still shows every owner's work; this
    // is about what the bar can truthfully NAME, not about scope.
    expectTitle: 'All brand owners', expectAccount: false,
    // Several brand owners means several daily allowances and no single number. The line is ABSENT
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

const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname
  const json = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
  const s = STATES[current]
  if (path === '/portal/api/me') {
    const accounts = s.accounts ?? ['zephyr']
    return json({ role: 'client', email: 'counsel@zephyr.com', accounts, concurrentRuns: s.cap ?? 2,
      accountNames: { zephyr: 'Zephyr Beverages', aurora: 'Aurora Interactive', ridgeform: 'Ridgeform' } })
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
  if (path === '/portal/admin/roster') return json({ customers: [{ key: 'zephyr', name: 'Zephyr Beverages' }, { key: 'aurora', name: 'Aurora Interactive' }, { key: 'ridgeform', name: 'Ridgeform' }] })
  if (path === '/portal/api/usage') {
    return json({ account: 'zephyr', today: s.capped ? 2 : 1, thisMonth: 6, queued: 2, dailyRuns: 2, monthlyRuns: null, maxQueued: null, capped: true })
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

const userDir = mkdtempSync(join(tmpdir(), 'home-check-'))
const chrome = spawn('google-chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--user-data-dir=${userDir}`, '--window-size=1280,1000',
  '--remote-debugging-port=0', 'about:blank',
  // — DETACHED so Chrome LEADS A PROCESS GROUP. Its renderer, GPU and zygote processes are
  // separate PIDs, and without a group there is nothing to signal them with.
], { stdio: ['ignore', 'pipe', 'pipe'], detached: true })
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
    cards: all('.home2-card').length,
    queueRows: all('.home2-qrow').length,
    queueCount: (q('.home2-queue-count')?.textContent ?? '').trim(),
    // The ordinals, as drawn. They must read 1..N with no gaps — a gap would mean the screen is
    // showing another tenant's place in the lane.
    ordinals: all('.home2-pos').map((n) => n.textContent.trim()),
    stops: all('.home2-stop').length,
    cancels: all('.home2-cancel').length,
    // FIRST CARD'S PIPS — N comes from the run, never a constant.
    pips: q('.home2-card') ? [...q('.home2-card').querySelectorAll('.home2-pip')].length : 0,
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
    title: (q('.topbar h1')?.textContent ?? '').trim(),
    accountLabelled: all('.topbar .eyebrow').some((n) => n.textContent.trim() === 'Account'),
    // Every mark, owner and project must be blurrable — the class is not the contract, the attribute is.
    untaggedMarks: all('.home2-card-mark, .home2-card-owner, .home2-qmark, .home2-qowner, .home2-done-mark')
      .filter((n) => n.getAttribute('data-anon') !== 'mark').length,
    sidewaysOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    // The sidebar's owner group must be labelled by the switcher, not floating above everything.
    switcherInNav: !!q('.sidebar-scroll select[aria-label="Brand owner"]'),
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
    await cmd('Page.navigate', { url: `${origin}/portal/home` })
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
    // AND IT SAYS NO RUNG. "Depth 4" / "Stage 1" are internal; a client screen must never carry either.
    if (spec.expectCards) say(!/\b(Depth|Stage)\s*\d/i.test(out.depthText),
      `${name}/${theme}: the chip carries no depth or stage number ("${out.depthText}")`)
    // THE ONE A STRING TEST CANNOT SEE.
    say(out.depthClipped === 0, `${name}/${theme}: no depth label is clipped (${out.depthClipped} clipped)`)
    say(out.sidewaysOverflow === 0, `${name}/${theme}: no sideways scroll (${out.sidewaysOverflow}px)`)
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
    const wantTitle = spec.expectTitle ?? 'Zephyr Beverages'
    say(out.title === wantTitle, `${name}/${theme}: top bar reads "${out.title}" (expected "${wantTitle}")`)
    const wantAccount = spec.expectAccount !== false
    say(out.accountLabelled === wantAccount,
      `${name}/${theme}: Account ${wantAccount ? 'is still labelled' : 'is absent — a firm has no single account to name'}`)
    // The switcher belongs INSIDE the nav, as the header of the group it governs.
    if (spec.accounts && spec.accounts.length > 1) {
      say(out.switcherInNav, `${name}/${theme}: the brand-owner switcher labels its nav group`)
    }

    if (shotDir) {
      const shot = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
      const data = shot.result?.result?.data ?? shot.result?.data
      if (data) writeFileSync(join(shotDir, `home-${name}-${theme}.png`), Buffer.from(data, 'base64'))
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
