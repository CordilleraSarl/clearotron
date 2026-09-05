#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Leave a screen, come back to it, and count what it asked the server.
//
//   node scripts/revisit-render-check.mjs [--json <file>]
//
// ── why this exists ──────────────────────────────────────────────────────────────────────────────────
//
// Every other browser check in this repo drives a screen ONCE, on a fresh document. That leaves the
// whole of the app's second life unmeasured: mount, unmount, mount again, which is what a staff member
// does all day and what a hook regression breaks first. Four screens have instruments; none of them
// navigates away and back, and the two that carry the app's data hooks (Clearances, Result) are the two
// where a remount defect would land.
//
// WHAT IT ASSERTS, AND WHY IT IS NOT "DID IT PAINT". The defect class here is a redundant REQUEST, not a
// blank screen. Both hooks in portal-ui/src/state/useApi.ts carry a comment about a double-fetch they
// already shipped once:
//
//   • usePoll's `firstRun` ref — "without the guard every screen issued its first request twice, on a
//     120/min budget shared across the user's tabs";
//   • useLoad's deps/nonce split — clearing on every effect run "would have been the obvious fix and a
//     worse bug", blanking every list in the app twice a minute.
//
// portal-service rate-limits 120 requests/minute PER EMAIL across all of a person's tabs. A screen that
// fetches twice per visit paints perfectly and eats the budget, and every screen in this app gates on
// `result` rather than `loading` — so the second request is invisible to a human and to a paint check.
// Counting is the only way to see it. The counts are printed on the ok lines for the same reason: a
// branch-versus-main diff over pass/fail alone stays empty while one side issues four requests and the
// other two.
//
// WHY IT COMPARES REVISIT AGAINST REVISIT. A first visit is a fresh document, so the shell mounts too and
// its own fetches (/portal/api/me, the roster, the families map) land in that visit's tally. A revisit is
// client-side: AppShell stays mounted and does not re-ask. Comparing the two would compare a shell plus a
// screen against a screen, and the difference would be structural rather than a finding. So both sides of
// the comparison are CLIENT-SIDE mounts of the same screen with the shell already up — visit 1 and visit
// 2, apples to apples.
//
// WHY IT CLICKS THE REAL NAV BUTTON. AppShell funnels every navigation through one `go()`, guard and all.
// Clicking the sidebar button drives that funnel; setting location by hand would skip it and measure a
// path no user takes. The return leg to Result uses history.back(), which is the Back button — the app's
// popstate listener is the code under test there, and it is the same listener a user reaches.
//
// WHAT IT CANNOT SEE, stated because a green here must not be read as more than it is:
//   • StrictMode. It serves portal-ui/dist, a production build, where StrictMode does not double-invoke.
//     Reaching it needs a development build or a dev-server drive, neither of which this repo has. Note
//     that the bundle a CLIENT receives is also a production build, so this gap is not client-facing.
//   • A LEAKED INTERVAL. The listener probe below covers the `visibilitychange` listener useVisible
//     adds and removes, but usePoll's `window.setInterval` is a different object with no equivalent
//     readout, and this fixture is built so no interval ever fires: the runs are all delivered, which
//     holds the cadence at 30s, and the drive finishes in under 10s. An interval that survived an
//     unmount would produce nothing any assertion here can see. Making it visible means either a long
//     drive or an in-flight fixture on the 5s cadence, and the second one would put poll traffic inside
//     the measurement windows — which is the noise the whole design avoids.
//   • Pixels. Deliberately. Screenshot comparison is not byte-reproducible against itself on this
//     instrument family — a main-against-main control differed on 20 of 24 shots — so a pixel diff here
//     would manufacture findings rather than catch them. Assertions only.
//
// MUST NOT run as a user with a virtual-memory ulimit (`ulimit -v`) — Chrome dumps core under one. Run it
// as a user with `ulimit -v unlimited`. The dbus/UPower errors Chrome prints on a headless box are noise.

import { createServer } from 'node:http'
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { reapOnExit } from '../shared/reap-on-exit.mjs' // — a detached group dies with this script

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = join(HERE, '..', 'portal-ui', 'dist')
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null

if (!existsSync(join(DIST, 'index.html'))) {
  console.error(`no build at ${DIST} — run: npm run build:ui`)
  process.exit(2)
}

const KEY = 'acme'
const NAME = 'Acme'
const RUN_ID = 'tmpa-revisit-1'

const bands = [
  { label: 'Severe', tone: 'severe' },
  { label: 'Medium', tone: 'medium' },
  { label: 'Manageable', tone: 'low' },
]

// The row as the service sends it. `productName` is resolved by the SAME expression portal-service.mjs
// evaluates, never typed — the sibling instruments' rule, and it holds here for the same reason.
const { reportIdentityFor } = await import('../driver/search-policy.mjs')

const run = (over) => {
  const product = over.product ?? 'global-preliminary-search'
  return {
    account: KEY, kind: 'clearance', state: 'delivered', band: 'Manageable', tone: 'low',
    bands, marks: [], reportSchema: 2, held: false, report: `/portal/report/${over.runId}/`,
    step: null, stepN: null, stepTotal: null, reason: null, failedStage: null,
    pausedKind: null, resetsAt: null, startedAt: null, queuePos: null,
    projectKey: null, projectName: null, markName: null, title: '', date: '2026-08-02',
    product, stageLabel: 'Depth 4', productName: reportIdentityFor(product).identity, runId: '', ...over,
  }
}

// Two delivered runs, nothing in flight. `active` is what drives usePoll's interval, and a fixture with a
// running job would put every list on the 5-second cadence — which would fire INSIDE the measurement
// windows below and be counted as a mount fetch. Delivered runs hold the interval at 30s, comfortably
// outside a drive that finishes in a few seconds. The drive's own elapsed time is asserted at the end so
// this reasoning cannot quietly stop being true.
const RUNS = () => [
  run({ runId: RUN_ID, markName: 'VENZY', title: 'VENZY', date: '2026-08-02' }),
  run({ runId: 'tmpa-revisit-2', markName: 'ASTERION', title: 'ASTERION', date: '2026-08-01', band: 'Medium', tone: 'medium' }),
]

// ── the server, which is also the instrument ────────────────────────────────────────────────────────
//
// Every API hit is logged against the epoch that was current when it arrived. The epoch is set from the
// drive below, immediately before each navigation, so a request belongs to the visit that caused it.

let epoch = 'boot'
const hits = [] // { epoch, route }

// The route KEY, not the raw URL: /portal/api/run/<id>/summary is one route however many ids it is asked
// about, and a per-id key would make two visits to two runs look like two different routes rather than
// two hits on one.
const routeKey = (p, q) => {
  if (p === '/portal/api/runs') return q.get('scope') === 'mine' ? '/portal/api/runs?scope=mine' : '/portal/api/runs'
  if (/^\/portal\/api\/run\/[^/]+\/summary$/.test(p)) return '/portal/api/run/:id/summary'
  if (p.startsWith('/portal/report/')) return '/portal/report/:id'
  return p
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' }
const json = (res, body) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }

const server = createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost')
  const p = u.pathname

  // Count BEFORE answering, and count only the API and the report document. Static asset requests are
  // the browser's cache behaviour, not the app's data behaviour, and folding them in would make the
  // tally depend on whether Chrome felt like re-reading a chunk.
  if (p.startsWith('/portal/api/') || p.startsWith('/portal/admin/') || p.startsWith('/portal/report/')) {
    hits.push({ epoch, route: routeKey(p, u.searchParams) })
  }

  if (p === '/portal/api/me') return json(res, { email: 'staff@example-firm.com', role: 'staff', accounts: '*', accountNames: {}, allowance: null })
  if (p === '/portal/admin/roster') return json(res, { customers: [{ key: KEY, name: NAME }] })
  if (p === '/portal/admin/families') return json(res, { of: {}, names: {} })
  if (p === '/portal/api/runs') return json(res, { runs: RUNS() })
  if (p === '/portal/api/searches') return json(res, { account: KEY, products: [], recipes: [], read: { available: false, maxBrief: 0, note: null } })
  if (p === '/portal/api/mcp-access') return json(res, { url: null, keyUrl: null, email: null, enabled: false })
  if (p === '/portal/admin/retired') return json(res, { runs: [] })
  if (/^\/portal\/api\/run\/[^/]+\/summary$/.test(p)) return json(res, { summary: [] })

  // The report the Result screen frames. Its CONTENT is not what this check is about — render-check.mjs
  // owns the report's layout — but it has to be a real document, because a 404 in the frame changes what
  // Result renders around it and would change the fetch pattern being measured.
  if (p.startsWith('/portal/report/')) {
    res.writeHead(200, { 'content-type': 'text/html' })
    return res.end('<!doctype html><meta charset="utf-8"><title>report</title><body><h1>VENZY</h1><p>fixture report.</p></body>')
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

const profile = mkdtempSync(join(tmpdir(), 'revisit-check-'))
const chrome = spawn('google-chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--remote-debugging-port=0',
  `--user-data-dir=${profile}`, '--window-size=1440,900', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] })
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// QUIESCENCE, NOT A FIXED WAIT. A fixed sleep either wastes seconds or truncates a slow visit and reports
// the truncation as a lower request count — the failure mode that would make this whole check lie in the
// safe-looking direction. Wait until the server has been silent for `quiet` ms, capped so a screen that
// requests forever fails loudly instead of hanging.
const settle = async ({ quiet = 900, cap = 12000 } = {}) => {
  const started = Date.now()
  let last = hits.length
  let lastChange = Date.now()
  for (;;) {
    await sleep(100)
    if (hits.length !== last) { last = hits.length; lastChange = Date.now() }
    if (Date.now() - lastChange >= quiet) return true
    if (Date.now() - started >= cap) return false
  }
}

// STABLE OUTPUT IS A FEATURE OF THIS FILE, NOT A TIDINESS PREFERENCE. These lines are meant to be
// diffed between two builds — it is how the majors bump was verified — and a diff is only evidence if
// the instrument is byte-reproducible against ITSELF. Two things here were not, and both were caught by
// running the same build twice before trusting a branch-versus-main diff:
//
//   • a tally's key order is REQUEST ARRIVAL order, which is a race between two in-flight fetches;
//   • the elapsed time, printed to a tenth of a second, never repeats.
//
// Either one puts a spurious line in every diff, which is how a reader ends up investigating a finding
// that is only jitter. So tallies are emitted with sorted keys, and anything genuinely variable stays
// OFF the ok/FAIL lines and goes on a `--` line instead.
const stable = (o) => JSON.stringify(Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]])))

const countsFor = (label) => {
  const out = {}
  for (const h of hits) if (h.epoch === label) out[h.route] = (out[h.route] ?? 0) + 1
  return out
}

// Click a sidebar button by its label, through the app's own navigation funnel.
const clickNav = async (label) => value(`(async () => {
  const b = [...document.querySelectorAll('button.nav-item')].find(x => (x.textContent || '').trim() === ${JSON.stringify(label)});
  if (!b) return { ok: false, saw: [...document.querySelectorAll('button.nav-item')].map(x => (x.textContent || '').trim()) };
  b.click();
  await new Promise(r => setTimeout(r, 120));
  return { ok: true, path: window.location.pathname };
})()`)

// LISTENER COUNT, BECAUSE A LEAK IS SILENT IN A REQUEST TALLY. usePoll's useVisible adds a
// `visibilitychange` listener on mount and removes it in cleanup. If cleanup stops running on unmount,
// the listener survives the revisit — and produces NOTHING this file's request counts can see, because
// the fixture's runs are all delivered (30s idle cadence) and the whole drive finishes in under 10s, so
// no interval ever ticks inside a measurement window. Counting the listeners is the only cheap way to
// see that class at all.
const listenerCount = async (type) => {
  const handle = (await cmd('Runtime.evaluate', { expression: 'document' })).result?.result?.objectId
  if (!handle) return null
  const listeners = (await cmd('DOMDebugger.getEventListeners', { objectId: handle })).result?.listeners
  if (!Array.isArray(listeners)) return null
  return listeners.filter((l) => l.type === type).length
}

const where = () => value(`window.location.pathname`)
const screenText = () => value(`(document.querySelector('.screen') || document.body).innerText.slice(0, 400)`)

// ── the drive ───────────────────────────────────────────────────────────────────────────────────────

const failures = []
const lines = []
const say = (ok, msg) => { if (!ok) failures.push(msg); lines.push(`${ok ? '  ok  ' : 'FAIL  '}${msg}`); console.log(`${ok ? '  ok  ' : 'FAIL  '}${msg}`) }

const startedAt = Date.now()
const record = {}

// The shell, once. Everything after this is client-side.
epoch = 'boot'
await cmd('Page.navigate', { url: `${origin}/portal/home` })
if (!(await settle())) say(false, 'the shell never went quiet within 12s — it is still requesting')
const bootPath = await where()
say(bootPath === '/portal/home', `the shell loaded on /portal/home (got ${bootPath})`)

const bootCounts = countsFor('boot')
say(Object.keys(bootCounts).length > 0,
  `the fixture server was actually reached on load — ${stable(bootCounts)}`)

/**
 * Visit a screen twice, client-side, and compare the two tallies.
 *
 * `away` is the screen navigated to in between. It has to be a REAL other screen: navigating to where you
 * already are is the one case AppShell handles with a visit nonce rather than a remount, so using the
 * same screen as its own interlude would measure the nonce path and call it a revisit.
 */
const twice = async (name, enter, expectPath, away = 'Home') => {
  epoch = `${name}:1`
  const e1 = await enter()
  if (e1 && e1.ok === false) { say(false, `${name}: no sidebar button to enter by — saw ${JSON.stringify(e1.saw)}`); return }
  const q1 = await settle()
  const p1 = await where()
  const t1 = await screenText()
  const vis1 = await listenerCount('visibilitychange')

  epoch = `${name}:away`
  const a = await clickNav(away)
  if (a && a.ok === false) { say(false, `${name}: no "${away}" button to leave by — saw ${JSON.stringify(a.saw)}`); return }
  await settle()
  const pAway = await where()

  epoch = `${name}:2`
  const e2 = await enter()
  if (e2 && e2.ok === false) { say(false, `${name}: could not re-enter — saw ${JSON.stringify(e2.saw)}`); return }
  const q2 = await settle()
  const p2 = await where()
  const t2 = await screenText()
  const vis2 = await listenerCount('visibilitychange')

  const c1 = countsFor(`${name}:1`)
  const c2 = countsFor(`${name}:2`)
  record[name] = { visit1: c1, visit2: c2, away: countsFor(`${name}:away`) }

  say(q1 && q2, `${name}: both visits went quiet inside the cap`)
  say(p1 === expectPath, `${name}: visit 1 landed on ${expectPath} (got ${p1})`)
  say(pAway !== expectPath, `${name}: the screen was actually LEFT in between (went to ${pAway})`)
  say(p2 === expectPath, `${name}: visit 2 landed on ${expectPath} (got ${p2})`)

  // The screen has to have DONE something, or an equal pair of zeroes would read as a pass. This is the
  // control: two visits that both fetch nothing are identical and prove nothing.
  const n1 = Object.values(c1).reduce((a2, b) => a2 + b, 0)
  say(n1 > 0, `${name}: visit 1 asked the server for something — ${n1} request(s), ${stable(c1)}`)

  // And it has to have RENDERED, both times. A screen that throws on remount fetches nothing and would
  // otherwise sail through a count comparison as "identical".
  say((t1 || '').trim().length > 0, `${name}: visit 1 rendered text`)
  say((t2 || '').trim().length > 0, `${name}: visit 2 rendered text`)
  say((t2 || '').trim().length > 0 && (t1 || '').trim().length > 0 && t1 === t2,
    `${name}: the screen renders the same text on both visits`)

  // The unmount half. Equal counts mean the listener added on visit 1 was removed when the screen was
  // left, rather than accumulating one per visit.
  if (vis1 === null || vis2 === null) {
    lines.push(`  --  ${name}: this Chrome would not report event listeners, so nothing is claimed about cleanup`)
    console.log(lines[lines.length - 1])
  } else {
    say(vis1 === vis2, `${name}: visibilitychange listeners on document — ${vis1} after visit 1, ${vis2} after visit 2`)
  }

  // THE ASSERTION THIS FILE EXISTS FOR.
  const routes = [...new Set([...Object.keys(c1), ...Object.keys(c2)])].sort()
  for (const r of routes) {
    const a2 = c1[r] ?? 0
    const b = c2[r] ?? 0
    say(a2 === b, `${name}: ${r} — visit 1 asked ${a2}x, visit 2 asked ${b}x`)
  }

  // Once per visit is the correct number for a useLoad with stable deps. A screen asking twice paints
  // identically and spends double a rate limit that is shared across the user's tabs.
  for (const r of routes) {
    const n = c2[r] ?? 0
    say(n <= 1, `${name}: ${r} — one request per visit (visit 2 asked ${n}x)`)
  }
}

await twice('clearances', () => clickNav('Clearances'), '/portal/clearances')

// Result has no sidebar button — it is a hidden route reached from a run. So the first visit is a real
// URL and the SECOND is the Back button, which is the revisit a reader actually performs and the one that
// runs AppShell's popstate listener rather than its click funnel.
epoch = 'result:1'
await cmd('Page.navigate', { url: `${origin}/portal/result/${RUN_ID}` })
const rq1 = await settle()
const rp1 = await where()
const rt1 = await screenText()
say(rp1 === `/portal/result/${RUN_ID}`, `result: visit 1 landed on the run (got ${rp1})`)

epoch = 'result:away'
const ra = await clickNav('Clearances')
say(!ra || ra.ok !== false, 'result: left the screen by the sidebar')
await settle()

epoch = 'result:2'
await value(`(async () => { window.history.back(); await new Promise(r => setTimeout(r, 200)); return true })()`)
const rq2 = await settle()
const rp2 = await where()
const rt2 = await screenText()

const rc1 = countsFor('result:1')
const rc2 = countsFor('result:2')
record.result = { visit1: rc1, visit2: rc2, away: countsFor('result:away') }

say(rq1 && rq2, 'result: both visits went quiet inside the cap')
say(rp2 === `/portal/result/${RUN_ID}`, `result: Back returned to the run (got ${rp2})`)
say((rt1 || '').trim().length > 0, 'result: visit 1 rendered text')
say((rt2 || '').trim().length > 0, 'result: visit 2 rendered text')

// Visit 1 is a fresh document, so the shell's own fetches are inside it; visit 2 is client-side. The two
// tallies are NOT comparable route-for-route the way the clearances pair is, and pretending otherwise
// would manufacture a finding on every shell route. What IS comparable — and what the ranked risk is
// about — is the SCREEN's own routes, so those are named and compared, and the rest is printed.
//
// AND AN EQUAL PAIR OF ZEROES IS NOT A PASS. `0x on both visits` compares identically to `1x on both`
// and reads the same in the output, so a route the fixture never triggers would certify itself. It
// caught this file out once already: the fixture's `report` field said `report.html` where the service
// sends `/portal/report/<runId>/`, the frame 404'd on a path this server does not count, and both
// report-frame assertions passed on nothing. Routes that did not fire are reported as NOT EXERCISED and
// listed at the end, never as ok.
const RESULT_OWN = ['/portal/api/runs?scope=mine', '/portal/api/mcp-access', '/portal/api/run/:id/summary', '/portal/report/:id']
const unexercised = []
for (const r of RESULT_OWN) {
  const a = rc1[r] ?? 0
  const b = rc2[r] ?? 0
  if (a === 0 && b === 0) { unexercised.push(r); lines.push(`  --  result: ${r} — NOT EXERCISED by this fixture, so nothing is claimed about it`); console.log(lines[lines.length - 1]); continue }
  say(a === b, `result: ${r} — first visit asked ${a}x, revisit asked ${b}x`)
  say(b <= 1, `result: ${r} — one request per visit (revisit asked ${b}x)`)
}
say((rc1['/portal/api/runs?scope=mine'] ?? 0) > 0,
  `result: the screen really did load its run list — ${stable(rc1)}`)

// The report frame is the reason Result is worth driving at all: AppShell's own comment records a
// redundant render remounting the frame mid-measurement, with the bridge oscillating between two
// settled heights. If the frame never loaded, this check is not reaching that interaction and must say
// so rather than imply it held.
say((rc1['/portal/report/:id'] ?? 0) > 0,
  `result: the report frame actually loaded its document — ${rc1['/portal/report/:id'] ?? 0} fetch(es) on the first visit`)
say(true, `result: full tallies — visit 1 ${stable(rc1)} · revisit ${stable(rc2)}`)

// The poll cadence assumption, checked rather than assumed. usePoll holds a 30s interval when nothing is
// in flight; if this drive ever runs long enough for one to fire, a poll request lands inside a
// measurement window and the counts above stop meaning what they say.
const elapsed = Date.now() - startedAt
say(elapsed < 25_000, 'the whole drive finished inside the 30s idle poll interval')
lines.push(`  --  elapsed ${(elapsed / 1000).toFixed(1)}s (off the assertion lines: it never repeats, and a diff of them should be empty)`)
console.log(lines[lines.length - 1])

if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ elapsedMs: elapsed, boot: bootCounts, ...record }, null, 2))

try { ws.close() } catch { /* the socket is going away with the process */ }
try { chrome.kill() } catch { /* already gone */ }
server.close()
// CLEANUP IS NOT A RESULT. Chrome is still flushing its profile when kill() returns, so an immediate
// rmSync races it and throws ENOTEMPTY — which crashed a fully GREEN run before it could print its
// verdict or set its exit code. Give it a moment, then remove what is left, and never let a temp
// directory decide whether the check passed.
await sleep(300)
try { rmSync(profile, { recursive: true, force: true }) } catch { /* a leftover profile is not a finding */ }

if (unexercised.length) {
  console.log(`\nnot exercised by this fixture, and not claimed: ${unexercised.join(', ')}`)
}
console.log(failures.length
  ? `\n${failures.length} failed`
  : '\nevery screen asked for the same thing on its second visit as on its first')
process.exit(failures.length ? 1 : 0)
