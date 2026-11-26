// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// report-sections-render-check.mjs — the report's section strip sits under the Reads and shows how far the
// reader has got, measured in a real browser.
//
//   node scripts/report-sections-render-check.mjs [--shots <dir>] [--keep]
//
// THE DEFECT, from the owner on the test instance (2026-09-19): scrolling the report never moved the strip,
// so "Summary" stayed marked whatever was in view; and with sixteen reads the strip sat BESIDE the Reads, the
// reads wrapping into two ragged columns while the strip floated at mid-height. His ruling: the strip goes
// under the Reads on its own full-width row, and it shows PROGRESS. Every section reached so far is marked,
// none at the top, and scrolling back up un-marks them the same way. A click still jumps.
//
// WHAT IS MEASURED: a real renderer's report (the demo's full country search, put through the demo's own
// publisher and the portal's own embed preparation) inside the real portal build, with twelve reads of one
// mark. At 1440 and 400 wide, in both themes: the strip's row is under the Reads row; then the page is
// scrolled so each section's start reaches the bottom of the pinned header, down and back up, and the
// number of filled entries must equal the number of sections reached. Where each section starts is read
// from INSIDE the frame, independently of what the document reports to the portal. Last, one entry is
// pressed and the page must jump to that section and mark it.
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname, extname, normalize } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { reapOnExit } from '../shared/reap-on-exit.mjs'
import { browserRun } from '../shared/browser-temp-root.mjs'
import { prepareReportForEmbed } from '../driver/portal-report.mjs'
import { scrollAfterPress } from '../shared/scroll-settle.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const DIST = join(ROOT, 'portal-ui', 'dist')
const keep = process.argv.includes('--keep')
const argValue = (flag) => (process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : null)
const shotsDir = argValue('--shots')
if (!existsSync(join(DIST, 'index.html'))) { console.error(`no build at ${DIST} — run: npm run build:ui`); process.exit(2) }
if (shotsDir) mkdirSync(shotsDir, { recursive: true })

// ── A REAL REPORT ───────────────────────────────────────────────────────────────────────────────────────
const pool = mkdtempSync(join(tmpdir(), 'sections-check-'))
const published = spawnSync(process.execPath, [join(ROOT, 'bin', 'example.mjs'), '--once', '--pool', pool, '--product', 'full-country-search'], { encoding: 'utf8' })
if (published.status !== 0) { console.error(`the demo publisher failed:\n${published.stderr || published.stdout}`); process.exit(2) }
const runDir = readdirSync(pool).map((d) => join(pool, d)).find((d) => existsSync(join(d, 'report.html')))
if (!runDir) { console.error(`the demo publisher wrote no report under ${pool}`); process.exit(2) }
const prepared = prepareReportForEmbed(readFileSync(join(runDir, 'report.html'), 'utf8'), {})
const SECTIONS = prepared.sections.map((s) => s.id)
if (SECTIONS.length < 4) { console.error(`the report announces ${SECTIONS.length} sections; this check needs a long one`); process.exit(2) }

// ── TWELVE READS OF ONE MARK ────────────────────────────────────────────────────────────────────────────
const KEY = 'acme'
const MARK = 'VENQORI'
const PRODUCTS = [['full-country-search', 'Full country search'], ['knockout-search', 'Knockout search'],
  ['multi-country-focus-search', 'Multi-country focus search'], ['global-preliminary-search', 'Global preliminary search']]
const RUNS = Array.from({ length: 12 }, (_, i) => {
  const [product, productName] = PRODUCTS[i % PRODUCTS.length]
  const day = String(18 - i).padStart(2, '0')
  return {
    account: KEY, kind: 'clearance', state: 'delivered', band: 'Moderate', tone: 'medium', bands: [], marks: [],
    reportSchema: 2, held: false, report: `/portal/report/tmpa-read-${i + 1}/`, step: null, stepN: null, stepTotal: null,
    reason: null, failedStage: null, pausedKind: null, resetsAt: null, startedAt: null, queuePos: null,
    projectKey: null, projectName: null, markName: MARK, title: MARK, date: `2026-09-${day}`,
    issuedAt: `2026-09-${day}T12:00:00.000Z`, product, productName, runId: `tmpa-read-${i + 1}`,
  }
})
// THE CASES THE SEARCH HISTORY TELLS APART (refinement picture search-history.png, approved 2026-11-25): two
// reports of one day, issued at different times, and a search still running. The newest is the report read.
Object.assign(RUNS[0], { date: '2026-09-18', issuedAt: '2026-09-18T15:45:00.000Z' })
Object.assign(RUNS[1], { date: '2026-09-18', issuedAt: '2026-09-18T09:20:00.000Z' })
Object.assign(RUNS[2], { state: 'running', report: null, date: '2026-09-17', issuedAt: '2026-09-17T08:00:00.000Z', band: null, tone: null })
const RUN_ID = RUNS[0].runId

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' }
const json = (res, body) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
const file = (res, full) => {
  if (!existsSync(full)) { res.writeHead(404); res.end('no'); return }
  res.writeHead(200, { 'content-type': MIME[extname(full)] ?? 'application/octet-stream' })
  res.end(readFileSync(full))
}
const server = createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
  if (p === '/portal/api/me') return json(res, { email: 'reader@example-firm.com', permissions: { run: true, manage: false }, access: [{ kind: 'account', account: KEY }], accounts: [KEY], accountNames: { [KEY]: 'Acme' } })
  if (p === '/portal/admin/roster') return json(res, { customers: [{ key: KEY, name: 'Acme' }] })
  if (p === '/portal/admin/families') return json(res, { of: {}, names: {} })
  if (p === '/portal/api/runs') return json(res, { runs: RUNS })
  if (p === '/portal/api/searches') return json(res, { account: KEY, products: [], recipes: [], read: { available: false, maxBrief: 0, note: null } })
  if (p === '/portal/api/mcp-access') return json(res, { url: null, keyUrl: null, email: 'reader@example-firm.com', enabled: false, stdio: null, aiConnected: null, offers: [] })
  if (/^\/portal\/api\/run\/[^/]+\/summary$/.test(p)) return json(res, { summary: [] })
  // Every read serves the one real document; its own resources resolve against the run directory and the
  // pool, as they do from a real pool.
  const inReport = /^\/portal\/report\/[^/]+\/(.*)$/.exec(p)
  if (inReport) {
    if (!inReport[1]) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(prepared.html) }
    return file(res, join(runDir, normalize(inReport[1]).replace(/^(\.\.[/\\])+/, '')))
  }
  if (p.startsWith('/portal/report/')) return file(res, join(pool, normalize(p.slice('/portal/report/'.length)).replace(/^(\.\.[/\\])+/, '')))
  const base = p.split('?')[0]
  return file(res, join(DIST, base === '/' || (base.startsWith('/portal') && !base.includes('.')) ? '/index.html' : base.replace(/^\/portal/, '')))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`

// ── THE BROWSER ────────────────────────────────────────────────────────────────────────────────────────
const { profile, env: chromeEnv, keep: keepRoot } = browserRun('report-sections-check-')
if (keep) keepRoot()
const chrome = spawn('google-chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
  `--user-data-dir=${profile}`, '--window-size=1440,900', '--remote-debugging-port=0', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'], detached: true, env: chromeEnv })
reapOnExit(chrome)
const wsUrl = await new Promise((resolve, reject) => {
  let devtools = ''
  const t = setTimeout(() => reject(new Error(`chrome reported no devtools endpoint in 60s:\n${devtools || '(nothing)'}`)), 60000)
  chrome.stderr.setEncoding("utf8");
  chrome.stderr.on('data', (c) => { devtools += c; const m = devtools.match(/ws:\/\/[^\s]+/); if (m) { clearTimeout(t); resolve(m[0]) } })
})
const ws = new WebSocket(wsUrl)
let id = 0
const pending = new Map()
// The report's frame is sandboxed to an opaque origin, so Chrome runs it as a process of its own and it
// is not in the page's frame tree. It is attached to as its own target; the newest one is the document on
// screen.
let frameSession = null
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.method === 'Target.attachedToTarget' && m.params?.targetInfo?.type === 'iframe') frameSession = m.params.sessionId
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
})
await new Promise((r) => ws.addEventListener('open', r))
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const { result: targets } = await send('Target.getTargets')
const page = targets.targetInfos.find((t) => t.type === 'page')
const { result: sess } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true })
const sessionId = sess.sessionId
const cmd = (method, params) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, sessionId, method, params })) })
const value = async (expr) => (await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value ?? null
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const until = async (expr, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await value(expr)) return true; await wait(100) } return false }
await cmd('Page.enable')
await cmd('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true })

// Where each section starts, read inside the frame's own document — not the list it posted to the portal.
const anchorsInFrame = async () => {
  if (!frameSession) return null
  const answer = await new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, sessionId: frameSession, method: 'Runtime.evaluate',
    params: { expression: `${JSON.stringify(SECTIONS)}.map((id) => { const el = document.getElementById(id); return el ? Math.round(el.getBoundingClientRect().top + window.scrollY) : null })`, returnByValue: true } })) })
  return answer.result?.result?.value ?? null
}
const strip = () => value(`[...document.querySelectorAll('nav.report-sections .report-section')].map((b) => (b.dataset.reached === 'true' ? 'y' : 'x') + (b.getAttribute('aria-current') === 'true' ? '*' : '')).join(' ')`)
const filled = (s) => (s ?? '').split(' ').filter((e) => e.startsWith('y')).length
const current = (s) => (s ?? '').split(' ').findIndex((e) => e.endsWith('*'))
// Put a document offset at the reading line — the pinned header's bottom, plus the margin a jump lands at.
const scrollToDocY = async (docY) => {
  for (let i = 0; i < 6; i++) {
    const delta = await value(`(() => { const f = document.querySelector('iframe'); const h = document.querySelector('.report-head');
      const d = f.getBoundingClientRect().top + ${docY} - (h.getBoundingClientRect().bottom + 10);
      window.scrollTo(0, window.scrollY + d); return d })()`)
    await wait(250)
    if (Math.abs(delta ?? 0) < 1) break
  }
}
const atFoot = () => value(`window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2`)
const atTop = () => value(`window.scrollY <= 0`)
const shot = async (name) => {
  if (!shotsDir) return
  await wait(250)
  const { result } = await cmd('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(shotsDir, name), Buffer.from(result.data, 'base64'))
}

const fail = []
const ok = []
for (const width of [1440, 400]) {
  await cmd('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 })
  for (const theme of ['light', 'dark']) {
    const at = `${width} ${theme}`
    await cmd('Page.navigate', { url: `${origin}/portal/` })
    await value(`(() => { try { localStorage.setItem('cordillera-theme', '${theme}') } catch (e) {} return 1 })()`)
    await cmd('Page.navigate', { url: `${origin}/portal/result/${RUN_ID}` })
    if (!(await until(`document.querySelectorAll('nav.report-sections .report-section').length === ${SECTIONS.length} && document.querySelectorAll('.report-nav .pill').length === ${RUNS.length}`))) {
      fail.push(`${at}: the header never showed ${RUNS.length} reads and ${SECTIONS.length} sections`)
      continue
    }
    await wait(800)

    // THE PLACEMENT: the strip's row is under the Reads row and starts where it starts.
    const box = await value(`(() => { const r = document.querySelector('.report-nav > div').getBoundingClientRect(); const s = document.querySelector('nav.report-sections').getBoundingClientRect();
      return { readsBottom: r.bottom, readsLeft: r.left, stripTop: s.top, stripLeft: s.left, stripRight: s.right, navRight: document.querySelector('.report-nav').getBoundingClientRect().right } })()`)
    if (!box) fail.push(`${at}: the Reads row or the strip is missing`)
    else if (box.stripTop < box.readsBottom - 1) fail.push(`${at}: the strip (top ${box.stripTop}) is beside the Reads (bottom ${box.readsBottom}), not under them`)
    else if (Math.abs(box.stripLeft - box.readsLeft) > 1) fail.push(`${at}: the strip starts at ${box.stripLeft}, not where the Reads start (${box.readsLeft})`)
    else if (Math.abs(box.stripRight - box.navRight) > 1) fail.push(`${at}: the strip's row is not the header's full width`)
    else ok.push(`${at}: the strip is its own full-width row under the ${RUNS.length} reads`)
    await value('window.scrollTo(0, 0)')
    await wait(300)
    await shot(`sections-${width}-${theme}-top.png`)

    // THE PROGRESS, down and back up. Nothing at the top; one more filled at each section's start.
    const anchors = await anchorsInFrame()
    if (!anchors || anchors.some((a) => a === null)) { fail.push(`${at}: could not read where the sections start inside the frame`); continue }
    const seen = []
    const expectAt = async (label, want, wantCurrent) => {
      const s = await strip()
      seen.push(`${label}=${s}`)
      if (filled(s) !== want || (wantCurrent !== undefined && current(s) !== wantCurrent)) fail.push(`${at}: at ${label} the strip reads "${s}", expected ${want} filled`)
    }
    await expectAt('top', 0, -1)
    // One step into the document, the first section is reached.
    await value('window.scrollTo(0, 40)')
    await wait(300)
    await expectAt('40px down', 1, 0)
    const order = [...SECTIONS.keys(), ...[...SECTIONS.keys()].reverse().slice(1)]
    for (const i of order) {
      await scrollToDocY(anchors[i])
      // The first section starts under the header, so reaching its start is the top of the page, where
      // the owner's rule is that nothing is marked yet.
      const [top, foot] = [await atTop(), await atFoot()]
      await expectAt(SECTIONS[i], top ? 0 : foot ? SECTIONS.length : i + 1, top ? -1 : foot ? SECTIONS.length - 1 : i)
      if (i === 1 && width === 1440) await shot(`sections-${width}-${theme}-two-reached.png`)
    }
    // Between two starts, the count is the one behind.
    await scrollToDocY(Math.round((anchors[1] + anchors[2]) / 2))
    await expectAt(`between ${SECTIONS[1]} and ${SECTIONS[2]}`, 2, 1)
    await value('window.scrollTo(0, 0)')
    await wait(300)
    await expectAt('top again', 0, -1)
    if (!fail.some((f) => f.startsWith(at))) ok.push(`${at}: progress followed the scroll both ways — ${seen.join(', ')}`)

    // A CLICK STILL JUMPS, and the section jumped to counts as reached.
    const target = 2
    const before = await value('window.scrollY')
    await value(`document.querySelectorAll('nav.report-sections .report-section')[${target}].click()`)
    // The jump is animated and starts on the browser's own schedule, so the page is given a deadline to
    // START moving before it is read as still. Waiting only for the position to settle answers "it never
    // moved" for a scroll that had not yet begun — see scroll-settle.mjs.
    const { moved, y: settled, waitedMs } = await scrollAfterPress({ read: () => value('window.scrollY'), wait, from: before })
    const s = await strip()
    const foot = await atFoot()
    if (!moved) fail.push(`${at}: pressing "${SECTIONS[target]}" did not move the page in ${waitedMs}ms`)
    else if (!(settled > before)) fail.push(`${at}: pressing "${SECTIONS[target]}" left the page at ${settled}, not below ${before}`)
    else if (filled(s) !== (foot ? SECTIONS.length : target + 1)) fail.push(`${at}: after the jump to "${SECTIONS[target]}" the strip reads "${s}"`)
    else ok.push(`${at}: a press jumps to "${SECTIONS[target]}" and marks it — ${s}`)
  }
}

// ── THE HEADER'S TWO STATES (board ReportHeader, approved 2026-11-25) ────────────────────────────────────
//
// At the top of the page the header is today's, with "Search history" over the chips. Past it, the same
// header is one pinned row, in the board's order, and the switch moves nothing in the document. The search
// history opens from that row and reads as the refinement picture does; Escape closes it and gives focus
// back. A phone keeps today's header, so it never becomes the single row.
for (const theme of ['light', 'dark']) {
  const at = `1440 ${theme} header`
  await cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await cmd('Page.navigate', { url: `${origin}/portal/` })
  await value(`(() => { try { localStorage.setItem('cordillera-theme', '${theme}') } catch (e) {} return 1 })()`)
  await cmd('Page.navigate', { url: `${origin}/portal/result/${RUN_ID}` })
  if (!(await until(`document.querySelectorAll('.report-nav .pill').length === ${RUNS.length} && Boolean(document.querySelector('iframe'))`))) {
    fail.push(`${at}: the report never drew its header and frame`); continue
  }
  await wait(800)
  const top = await value(`({ label: [...document.querySelectorAll('.report-nav .eyebrow')].map((e) => e.textContent.trim()), compact: Boolean(document.querySelector('.report-head.compact')), ask: /Ask AI/.test(document.querySelector('.report-head-row').textContent || '') })`)
  if (!(top && top.label.includes('Search history') && !top.label.includes('Reads') && !top.compact)) fail.push(`${at}: at the top the header is not today's with "Search history" over the chips (${JSON.stringify(top)})`)
  else ok.push(`${at}: at the top, today's header with "Search history" over the chips`)
  const docTop = `Math.round(document.querySelector('iframe').getBoundingClientRect().top + window.scrollY)`
  const before = await value(docTop)
  const past = await value(`Math.round(document.querySelector('.report-head-slot').getBoundingClientRect().bottom + window.scrollY - ${56} + 240)`)
  await value(`(window.scrollTo(0, ${past}), 1)`)
  await until(`Boolean(document.querySelector('.report-head.compact'))`, 3000)
  await wait(300)
  const after = await value(docTop)
  if (before !== after) fail.push(`${at}: the switch moved the report from ${before} to ${after} in the page`)
  else ok.push(`${at}: the switch to the single row moves nothing in the page (report at ${after})`)
  const row = await value(`(() => {
    const h = document.querySelector('.report-head.compact'); if (!h) return null;
    const kids = [...h.querySelector('.report-head-row').children];
    const where = (pred) => kids.findIndex(pred);
    const name = h.querySelector('h1'); const cs = name ? getComputedStyle(name) : null;
    return {
      back: (h.querySelector('.report-back-icon') || {}).getAttribute?.('aria-label') ?? null,
      order: [where((k) => k.classList.contains('report-back-icon')), where((k) => k.tagName === 'H1'), where((k) => k.classList.contains('risk-dot')),
        where((k) => k.classList.contains('report-history')), where((k) => k.classList.contains('report-sections')),
        where((k) => /Ask AI/.test(k.textContent || '')), where((k) => /Export/.test(k.textContent || ''))],
      history: (h.querySelector('.report-history-btn') || {}).textContent?.trim() ?? null,
      oneRow: Math.round(h.getBoundingClientRect().height),
      ellipsis: cs ? cs.textOverflow === 'ellipsis' && cs.whiteSpace === 'nowrap' : false,
      pinnedAt: Math.round(h.getBoundingClientRect().top),
    };
  })()`)
  // Ask AI is drawn where this deployment offers it, in both states or in neither: this fixture offers none.
  const drawn = row ? row.order.filter((n, i) => !(i === 5 && !top?.ask)) : []
  const inOrder = row && (row.order[5] >= 0) === Boolean(top?.ask) && drawn.every((n, i) => n >= 0 && (i === 0 || n > drawn[i - 1]))
  if (!row || !inOrder || row.back !== 'All Clearances' || row.history !== `Search history · ${RUNS.length}` || row.pinnedAt !== 56 || !row.ellipsis || row.oneRow > 64) {
    fail.push(`${at}: the single row is not the board's (${JSON.stringify(row)})`)
  } else ok.push(`${at}: one pinned row, ${row.oneRow}px, in the board's order: back, name, band, "${row.history}", sections, ${top?.ask ? 'Ask AI, ' : ''}Export`)
  await value(`(document.querySelector('.report-history-btn').click(), 1)`)
  await until(`Boolean(document.querySelector('.report-history-list'))`, 3000)
  const list = await value(`[...document.querySelectorAll('.report-history-row')].map((b) => ({ text: b.innerText.replace(/\s+/g, ' ').trim(), current: b.getAttribute('aria-current') === 'true', latest: Boolean(b.querySelector('.report-history-tag')), live: (b.querySelector('.report-history-live') || {}).textContent || null }))`)
  const want = list && list.length === RUNS.length
    && list.filter((r) => r.current).length === 1 && list[0].current
    && list.filter((r) => r.latest).length === 1 && list[0].latest
    && /09-18 · 15:45 UTC/.test(list[0].text) && /09-18 · 09:20 UTC/.test(list[1].text)
    && list[2].live === 'Running' && !/UTC/.test(list[2].text)
    && list.slice(3).every((r) => !/UTC/.test(r.text))
  if (!want) fail.push(`${at}: the search history does not read as the refinement picture (${JSON.stringify(list)})`)
  else ok.push(`${at}: the search history lists ${list.length}, newest first: the one read ticked, "Latest report" once, times only on one day's two reports, "Running" with no time`)
  await shot(`header-pinned-history-${theme}.png`)
  await value(`(document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), 1)`)
  await wait(150)
  const closed = await value(`!document.querySelector('.report-history-list') && document.activeElement === document.querySelector('.report-history-btn')`)
  if (!closed) fail.push(`${at}: Escape did not close the search history and give focus back to its button`)
  else ok.push(`${at}: Escape closes the search history and gives focus back`)
  await value(`(window.scrollTo(0, 0), 1)`)
  await until(`!document.querySelector('.report-head.compact')`, 3000)
  if (await value(`Boolean(document.querySelector('.report-head.compact'))`)) fail.push(`${at}: back at the top, the full header did not return`)
  else ok.push(`${at}: back at the top, the full header returns`)
  await shot(`header-top-${theme}.png`)
}
{
  const at = '400 light header'
  await cmd('Emulation.setDeviceMetricsOverride', { width: 400, height: 900, deviceScaleFactor: 1, mobile: true })
  await cmd('Page.navigate', { url: `${origin}/portal/result/${RUN_ID}` })
  await until(`document.querySelectorAll('.report-nav .pill').length === ${RUNS.length}`)
  await value(`(window.scrollTo(0, 3000), 1)`)
  await wait(500)
  const phone = await value(`({ compact: Boolean(document.querySelector('.report-head.compact')), pinned: Math.round(document.querySelector('.report-head').getBoundingClientRect().top) })`)
  if (!phone || phone.compact || phone.pinned !== 56) fail.push(`${at}: a phone does not keep today's pinned header (${JSON.stringify(phone)})`)
  else ok.push(`${at}: a phone keeps today's pinned header`)
}

// ── THE PINNED ROW AT A LAPTOP WIDTH, SIDEBAR OPEN (design, 2026-11-26) ───────────────────────────────────────
// At 1,280 px with the sidebar open the row must keep the seven-letter name whole, "Ask AI" on one line and every
// section link readable, or the full header is pinned instead, every part of it in reach. 1,600 px is the control:
// there the row pins as before.
for (const [width, mustPin] of [[1280, false], [1600, true]]) {
  for (const theme of ['light', 'dark']) {
    const at = `${width} ${theme} sidebar open`
    await cmd('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
    await cmd('Page.navigate', { url: `${origin}/portal/` })
    await value(`(() => { try { localStorage.setItem('cordillera-theme', '${theme}') } catch (e) {} return 1 })()`)
    await cmd('Page.navigate', { url: `${origin}/portal/result/${RUN_ID}` })
    if (!(await until(`document.querySelectorAll('nav.report-sections .report-section').length === ${SECTIONS.length} && Boolean(document.querySelector('.sidebar, nav[aria-label]'))`))) {
      fail.push(`${at}: the report never drew its header`); continue
    }
    await wait(600)
    await value('(window.scrollTo(0, 3000), 1)')
    await wait(800)
    const row = await value(`(() => { const h = document.querySelector('.report-head'); const compact = h.classList.contains('compact'), full = h.classList.contains('pinned-full');
      const q = (s) => h.querySelector(s); const name = q('.report-head-name'), strip = q('.report-sections'), ask = q('.ask-ai-btn'), r = q('.report-head-row');
      const everyStrip = [...document.querySelectorAll('.report-head .report-sections, .report-nav .report-sections')].every((s) => s.scrollWidth <= s.clientWidth + 1);
      return { compact, full, everyStrip, pinned: Math.round(h.getBoundingClientRect().top), name: name.textContent.trim(), nameCut: name.scrollWidth > name.clientWidth + 1,
        stripCut: strip ? strip.scrollWidth > strip.clientWidth + 1 : null, askLines: ask ? Math.round(ask.getBoundingClientRect().height) : null,
        rowSpill: r.scrollWidth > r.clientWidth + 1, sidebar: Math.round((document.querySelector('.report-head-slot') || h).getBoundingClientRect().left) } })()`)
    if (!row) { fail.push(`${at}: the header could not be measured`); continue }
    if (row.compact) {
      if (row.nameCut || row.stripCut || row.rowSpill || (row.askLines ?? 0) > 40)
        fail.push(`${at}: the pinned row does not fit: ${JSON.stringify(row)}`)
      else ok.push(`${at}: the pinned row keeps "${row.name}" whole, Ask AI on one line and every section link (header starts at ${row.sidebar}px)`)
    } else if (mustPin) fail.push(`${at}: the row no longer pins at a width it fitted before: ${JSON.stringify(row)}`)
    else if (!row.full || row.pinned !== 56 || row.nameCut || !row.everyStrip)
      fail.push(`${at}: the row does not fit, and the full header is not pinned whole in its place: ${JSON.stringify(row)}`)
    else ok.push(`${at}: the row cannot hold the name, Ask AI and the sections here, so the full header is pinned under the top bar, "${row.name}" whole and every section link in reach`)
    await shot(`header-${width}-sidebar-${theme}.png`)
  }
}

// ── A CARD'S ADDRESS, AND THE PAGE SCROLLING FOR THE FRAME ────────────────────────────────────────────────────
// The document cannot write the clipboard, know the portal's address or scroll the page, so it asks the page. A
// card's "Copy link" must put this report screen's address with the card named on the clipboard and see its tick;
// that address must open the report at the card, under the header; and a scroll-by from the frame must move the
// page by exactly that distance.
const inFrame = (expression) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, sessionId: frameSession, method: 'Runtime.evaluate',
  params: { expression, awaitPromise: true, returnByValue: true, userGesture: true } })) }).then((a) => a.result?.result?.value ?? null)
{
  const at = '1440 light card link'
  await cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await cmd('Page.navigate', { url: `${origin}/portal/` })
  await value(`(() => { try { localStorage.setItem('cordillera-theme', 'light') } catch (e) {} return 1 })()`)
  await send('Browser.grantPermissions', { origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] })
  // A headless page is never focused, and the clipboard refuses an unfocused document, read or write.
  await cmd('Emulation.setFocusEmulationEnabled', { enabled: true })
  await cmd('Page.navigate', { url: `${origin}/portal/result/${RUN_ID}?ask=open#elsewhere` })
  await until(`document.querySelectorAll('nav.report-sections .report-section').length === ${SECTIONS.length}`)
  await wait(800)
  const card = await inFrame(`(() => { const b = [...document.querySelectorAll('.card .copy-fi')].pop(); if (!b) return null;
    b.scrollIntoView(); b.click(); return b.closest('.card').id })()`)
  if (!card) fail.push(`${at}: the report shows no card with a Copy link inside the portal`)
  else {
    await wait(500)
    const copied = await value(`navigator.clipboard.readText().catch((e) => 'unreadable: ' + e.message)`)
    const ticked = await inFrame(`Boolean(document.getElementById(${JSON.stringify(card)})?.querySelector('.copy-fi.copied'))`)
    const expected = `${origin}/portal/result/${RUN_ID}?card=${card}`
    if (copied !== expected) fail.push(`${at}: the clipboard holds ${JSON.stringify(copied)}, not ${expected}`)
    else if (!ticked) fail.push(`${at}: the card's Copy link shows no tick after the copy landed`)
    else ok.push(`${at}: Copy link on ${card} puts this report's address with the card named on the clipboard, and the card shows its tick`)
    await shot('card-link-copied.png')

    // LANDING: the copied address opens the report at that card, below the pinned header.
    await cmd('Page.navigate', { url: expected })
    await until(`document.querySelectorAll('nav.report-sections .report-section').length === ${SECTIONS.length}`)
    await wait(1500)
    const landed = await value(`(() => { const f = document.querySelector('iframe'); const h = document.querySelector('.report-head');
      return { frameTop: f.getBoundingClientRect().top, headBottom: h.getBoundingClientRect().bottom, scrollY: window.scrollY } })()`)
    const cardTop = await inFrame(`Math.round(document.getElementById(${JSON.stringify(card)}).getBoundingClientRect().top + window.scrollY)`)
    const onScreen = landed && cardTop !== null ? Math.round(landed.frameTop + cardTop) : null
    if (onScreen === null) fail.push(`${at}: the landing could not be measured`)
    else if (landed.scrollY < 100 || onScreen < landed.headBottom - 2 || onScreen > landed.headBottom + 120)
      fail.push(`${at}: the card's address left the card at ${onScreen}px, with the header ending at ${Math.round(landed.headBottom)}px (scrolled ${Math.round(landed.scrollY)})`)
    else ok.push(`${at}: the card's address opens the report at ${card}, ${onScreen - Math.round(landed.headBottom)}px under the header`)
    await shot('card-link-landed.png')

    // SCROLL-BY: the frame asks the page to move by a distance, and the page moves by exactly that.
    const before = await value('window.scrollY')
    await inFrame(`(parent.postMessage({ source: 'cordillera-report', type: 'scrollBy', dy: 150 }, '*'), 1)`)
    await wait(400)
    const after = await value('window.scrollY')
    if (after - before !== 150) fail.push(`${at}: a scroll-by of 150 moved the page by ${after - before}`)
    else ok.push(`${at}: a scroll-by of 150 from the frame moves the page by 150`)
  }
}

for (const line of ok) console.log(`  ok   ${line}`)
for (const line of fail) console.log(`  FAIL ${line}`)
try { ws.close() } catch { /* going anyway */ }
try { process.kill(-chrome.pid, 'SIGKILL') } catch { /* already gone */ }
server.close()
if (!keep) rmSync(pool, { recursive: true, force: true })
console.log(fail.length ? `\nreport-sections-render-check: ${fail.length} measurement(s) failed.` : `\nreport-sections-render-check: the strip sits under the reads and follows the reader, both ways, at both widths and both themes.`)
process.exit(fail.length ? 1 : 0)
