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

for (const line of ok) console.log(`  ok   ${line}`)
for (const line of fail) console.log(`  FAIL ${line}`)
try { ws.close() } catch { /* going anyway */ }
try { process.kill(-chrome.pid, 'SIGKILL') } catch { /* already gone */ }
server.close()
if (!keep) rmSync(pool, { recursive: true, force: true })
console.log(fail.length ? `\nreport-sections-render-check: ${fail.length} measurement(s) failed.` : `\nreport-sections-render-check: the strip sits under the reads and follows the reader, both ways, at both widths and both themes.`)
process.exit(fail.length ? 1 : 0)
