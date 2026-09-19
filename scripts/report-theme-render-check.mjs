// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// report-theme-render-check.mjs — the report inside the portal follows the portal's theme.
//
//   node scripts/report-theme-render-check.mjs [--shots <dir>] [--keep]
//
// THE DEFECT, read at source and in a served document: a report carries its own dark theme, but the control
// that switches it sits in the top bar the portal strips when it embeds the report, and the frame is
// sandboxed without allow-same-origin, so it cannot read the choice the portal saved. A dark portal framed
// a light page. The owner ruled on 2026-09-18 that the embedded report follows the portal.
//
// WHAT IS MEASURED, from INSIDE the frame: the real portal build serves the Result screen, and the report
// in its frame is a real renderer's document put through the same preparation the portal serves reports
// with — so the theme travels the real bridge. A probe in that document reports the attribute its dark
// rules key on, the page's computed background, and an id drawn once per load. The portal's own theme
// switch is pressed, never an attribute set by hand, and three things must hold on each press: the
// document took the theme, its background went the right way, and the load id did not change — the page
// repainted in place rather than reloading.
//
// AND ONE SECTION MENU, AT BOTH THEMES. The portal draws the report's section menu in its own header and
// the frame must carry none. The document served here is shaped as a report rendered before 2026-09-18,
// with the menu beside the report's header rather than inside it. That is most of the archive, and the
// shape that left a second menu in the frame, its current item red on red in the dark theme. The probe
// counts the menus inside the frame; the portal's are counted on the page.
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reapOnExit } from '../shared/reap-on-exit.mjs'
import { browserRun } from '../shared/browser-temp-root.mjs'
import { renderKnockoutHtml } from '../driver/publish/render-knockout.mjs'
import { prepareReportForEmbed } from '../driver/portal-report.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = join(HERE, '..', 'portal-ui', 'dist')
const keep = process.argv.includes('--keep')
const argValue = (flag) => (process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : null)
const shotsDir = argValue('--shots')
if (!existsSync(join(DIST, 'index.html'))) { console.error(`no build at ${DIST} — run: npm run build:ui`); process.exit(2) }
if (shotsDir) mkdirSync(shotsDir, { recursive: true })

const KEY = 'acme'
const RUN_ID = 'tmpa-theme-1'
const MARK = 'EXAMPLEMARK'
const RUN = {
  account: KEY, kind: 'knockout', state: 'delivered', band: 'Low', tone: 'minimal',
  bands: [{ label: 'Blocking', tone: 'severe' }, { label: 'Medium', tone: 'medium' }, { label: 'Manageable', tone: 'low' }, { label: 'Low', tone: 'minimal' }],
  marks: [], reportSchema: 2, held: false, report: `/portal/report/${RUN_ID}/`,
  step: null, stepN: null, stepTotal: null, reason: null, failedStage: null, pausedKind: null, resetsAt: null,
  startedAt: null, queuePos: null, projectKey: null, projectName: null, markName: MARK, title: MARK,
  date: '2026-09-18', issuedAt: '2026-09-18T12:00:00.000Z', product: 'knockout-search', runId: RUN_ID,
}

// A real renderer's page — its own stylesheet and its own dark rules — prepared as the portal serves it,
// with a probe that watches the attribute those rules key on and reports what the page then paints.
const FRAMEWORK = { framework_key: 'house-triage', title: 'House triage',
  bands: [{ label: 'Blocking', tone: 'severe' }, { label: 'Medium', tone: 'medium' }, { label: 'Manageable', tone: 'low' }, { label: 'Low', tone: 'minimal' }] }
const PROBE = `<script>(function(){
  var id=Math.random().toString(36).slice(2);
  function post(){try{parent.postMessage({themeProbe:1,loadId:id,theme:document.documentElement.getAttribute('data-theme'),
    bg:getComputedStyle(document.body).backgroundColor,menus:document.querySelectorAll('nav.strip,[data-sec]').length},'*');}catch(e){}}
  new MutationObserver(post).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  post();
})();</script>`
const REPORT = (() => {
  const html = renderKnockoutHtml({ marks: [{ name: MARK, rating: 'Low', classes: [9], basis: 'Nothing identical in the field screened.',
    factors: ['No identical name was found.'], counterFactors: [], mitigation: '', assessment: '', findings: [] }],
    batch: { executiveSummary: 'One name screened.' } }, FRAMEWORK, { runId: RUN_ID, overall: 'Low', identity: { identity: 'Knockout search' }, issuedDate: '2026-09-18' })
  // THE OLD SHAPE: today's menu moved to just after the header's closing tag, where the renderer put it
  // before 2026-09-18. A document with no menu at all would make the count below prove nothing.
  const strip = html.match(/<nav class="[^"]*\bstrip\b[^"]*"[^>]*>[\s\S]*?<\/nav>/)?.[0]
  if (!strip) { console.error('the rendered report has no section menu, so this check could not build the archived shape'); process.exit(2) }
  const without = html.replace(strip, '')
  const head = without.indexOf('<div class="rep-stickyhead')
  const tags = /<\/?div\b[^>]*>/g
  tags.lastIndex = head
  let depth = 0, m, close = -1
  while ((m = tags.exec(without))) { depth += m[0].startsWith('</') ? -1 : 1; if (depth === 0) { close = m.index + m[0].length; break } }
  if (close < 0) { console.error('the report header has no closing tag, so this check could not build the archived shape'); process.exit(2) }
  const served = prepareReportForEmbed(without.slice(0, close) + strip + without.slice(close), {}).html
  const at = served.lastIndexOf('</body>')
  return at < 0 ? served + PROBE : served.slice(0, at) + PROBE + served.slice(at)
})()

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' }
const json = (res, body) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
const server = createServer((req, res) => {
  const p = new URL(req.url, 'http://localhost').pathname
  if (p === '/portal/api/me') return json(res, { email: 'reader@example-firm.com', permissions: { run: true, manage: false }, access: [{ kind: 'account', account: KEY }], accounts: [KEY], accountNames: { [KEY]: 'Acme' }, allowance: null })
  if (p === '/portal/admin/roster') return json(res, { customers: [{ key: KEY, name: 'Acme' }] })
  if (p === '/portal/admin/families') return json(res, { of: {}, names: {} })
  if (p === '/portal/api/runs') return json(res, { runs: [RUN] })
  if (p === '/portal/api/searches') return json(res, { account: KEY, products: [], recipes: [], read: { available: false, maxBrief: 0, note: null } })
  if (p === '/portal/api/mcp-access') return json(res, { url: null, keyUrl: null, email: 'reader@example-firm.com', enabled: false, stdio: null, aiConnected: null, offers: [] })
  if (/^\/portal\/api\/run\/[^/]+\/summary$/.test(p)) return json(res, { summary: [] })
  if (p.startsWith('/portal/report/')) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(REPORT) }
  const base = p.split('?')[0]
  const file = base === '/' || (base.startsWith('/portal') && !base.includes('.')) ? '/index.html' : base.replace(/^\/portal/, '')
  const full = join(DIST, file)
  if (!existsSync(full)) { res.writeHead(404); res.end('no'); return }
  res.writeHead(200, { 'content-type': MIME[extname(full)] ?? 'application/octet-stream' })
  res.end(readFileSync(full))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`

const { profile, env: chromeEnv, keep: keepRoot } = browserRun('report-theme-check-')
if (keep) keepRoot()
const chrome = spawn('google-chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
  `--user-data-dir=${profile}`, '--window-size=1280,900', '--remote-debugging-port=0', 'about:blank',
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
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
await new Promise((r) => ws.addEventListener('open', r))
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const { result: targets } = await send('Target.getTargets')
const page = targets.targetInfos.find((t) => t.type === 'page')
const { result: sess } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true })
const sessionId = sess.sessionId
const cmd = (method, params) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, sessionId, method, params })) })
const value = async (expr) => (await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value ?? null

// The portal page keeps what the probe inside the frame reports. Installed before any script of the page
// runs, and only on the top page — the frame posts; it does not listen.
await cmd('Page.enable', {})
await cmd('Page.addScriptToEvaluateOnNewDocument', { source: `if (window.top === window) { window.__probes = [];
  window.addEventListener('message', function (e) { if (e.data && e.data.themeProbe) window.__probes.push(e.data); }); }` })
// Start from a light portal, the way a first visit does: no saved theme.
await cmd('Page.navigate', { url: `${origin}/portal/` })
await value(`(async () => { try { localStorage.removeItem('cordillera-theme'); } catch (e) {} return 1; })()`)
await cmd('Page.navigate', { url: `${origin}/portal/result/${RUN_ID}` })

const latest = () => value(`(window.__probes || []).slice(-1)[0] || null`)
const settle = async (want) => {
  for (let i = 0; i < 100; i++) {
    const p = await latest()
    if (p && p.theme === want) return p
    await new Promise((r) => setTimeout(r, 100))
  }
  return await latest()
}
// Relative luminance of an rgb()/rgba() colour, 0 dark to 1 light. A page's ground is the one colour
// every reader sees, and it is what "dark" means here.
const luminance = (css) => {
  const m = String(css ?? '').match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/)
  if (!m) return null
  const [r, g, b] = m.slice(1, 4).map((v) => { const c = Number(v) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const shot = async (name) => {
  if (!shotsDir) return
  await new Promise((r) => setTimeout(r, 300))
  const { result } = await cmd('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(shotsDir, name), Buffer.from(result.data, 'base64'))
}
const press = () => value(`(() => { const b = document.querySelector('button[aria-label="Switch light or dark theme"]'); if (!b) return false; b.click(); return true; })()`)

const fail = []
const ok = []
// ONE MENU: none in the frame, one in the portal's header, under whichever theme is showing.
const menus = async (theme, probe) => {
  const portal = await value(`document.querySelectorAll('nav.report-sections').length`)
  if (!probe || typeof probe.menus !== 'number') fail.push(`${theme}: the frame never reported its section menus`)
  else if (probe.menus !== 0) fail.push(`${theme}: the frame carries ${probe.menus} section-menu element(s) beside the portal's own`)
  else ok.push(`${theme}: no section menu inside the frame`)
  if (portal !== 1) fail.push(`${theme}: the portal draws ${portal} section menu(s) where it should draw one`)
  else ok.push(`${theme}: the portal draws the one section menu`)
}
const light = await settle('light')
if (!light || light.theme !== 'light') fail.push(`the embedded report never took the portal's light theme — last report from the frame: ${JSON.stringify(light)}`)
else ok.push(`light: the report took the portal's theme, ground ${light.bg} (luminance ${luminance(light.bg)?.toFixed(2)})`)
await menus('light', light)
await shot('report-light.png')

if (!(await press())) fail.push('the portal\'s theme switch is not on the Result screen')
const dark = await settle('dark')
if (!dark || dark.theme !== 'dark') fail.push(`the portal went dark and the report did not follow — last report from the frame: ${JSON.stringify(dark)}`)
else {
  if (!(luminance(dark.bg) < 0.2)) fail.push(`the report took "dark" but its ground is ${dark.bg} — the dark rules did not apply`)
  else ok.push(`dark: the report followed, ground ${dark.bg} (luminance ${luminance(dark.bg).toFixed(2)})`)
  if (light && dark.loadId !== light.loadId) fail.push('the report reloaded to change theme — it must repaint in place')
  else ok.push('dark: repainted in place, the same load of the document')
}
await menus('dark', dark)
await shot('report-dark.png')

await press()
const back = await settle('light')
if (!back || back.theme !== 'light' || !(luminance(back.bg) > 0.6)) fail.push(`the portal went back to light and the report did not — ${JSON.stringify(back)}`)
else if (light && back.loadId !== light.loadId) fail.push('the report reloaded on the way back to light')
else ok.push(`light again: followed in place, ground ${back.bg}`)

for (const line of ok) console.log(`  ok   ${line}`)
for (const line of fail) console.log(`  FAIL ${line}`)
try { ws.close() } catch { /* going anyway */ }
try { process.kill(-chrome.pid, 'SIGKILL') } catch { /* already gone */ }
server.close()
console.log(fail.length ? `\nreport-theme-render-check: ${fail.length} measurement(s) failed.` : `\nreport-theme-render-check: the embedded report follows the portal's theme in place, under the portal's one section menu.`)
process.exit(fail.length ? 1 : 0)
