#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Do the columns on /portal/clearances hold together, in a real browser, at a real width?
//
//   node scripts/clearances-render-check.mjs [--keep] [--shot <path>] [--width 1100]
//
// ── why this exists ──────────────────────────────────────────────────────────────────────────────────
//
// Because nothing else in this repo can answer the question. portal-ui runs `node --test` with type
// stripping and carries no jsdom and no React test renderer — Node cannot import a `.tsx` at all — so the
import { reapOnExit } from "../shared/reap-on-exit.mjs";   // — a detached group dies with this script
// four source-text tests over Clearances.tsx can prove a string is in a file and nothing more. They
// cannot see a width, an alignment, or a scrollbar, which is precisely what and are about.
//
// So this serves the REAL built bundle to a REAL browser and MEASURES: getBoundingClientRect on the
// cells, scrollWidth against clientWidth, and the rendered line count of a date. A screenshot proves a
// layout at one width on one day; these numbers hold every run.
//
// Sibling of portal-lifecycle-check.mjs and composer-render-check.mjs, deliberately separate from both:
// that one is about what the page SAYS (owner names, lifecycles) and this one is about where the page
// PUTS it. A check that grew both jobs would be re-run in full for either.
//
// MUST NOT run as a user with a virtual-memory ulimit (`ulimit -v`) — Chrome dumps core under one. Run
// it as a user with `ulimit -v unlimited`.

import { createServer } from 'node:http'
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = join(HERE, '..', 'portal-ui', 'dist')
const keep = process.argv.includes('--keep')
const shotAt = process.argv.includes('--shot') ? process.argv[process.argv.indexOf('--shot') + 1] : null
const WIDTH = process.argv.includes('--width') ? Number(process.argv[process.argv.indexOf('--width') + 1]) : 1100

if (!existsSync(join(DIST, 'index.html'))) {
  console.error(`no build at ${DIST} — run: npm run build:ui`)
  process.exit(2)
}

// ── the fixture ─────────────────────────────────────────────────────────────────────────────────────
//
// Shaped from the four rows the E2E suite actually seeds (measured on the test instance 2026-08-04), so
// this check exercises the cases the review found rather than a convenient invention:
//
//   • two reads of one mark, at DIFFERENT depths and with different title lengths — the pair that made
//     the alignment drift visible, because the second read's Risk sat ~120px right of the first's
//   • a not-finished read, whose Status used to be a raw engine string
//   • a batch, whose Name column used to hold a run type
//
// The long run title is the instrument for the last assertion: lengthen it and NOTHING else may move.

const KEY = 'vantor'
const NAME = 'Vantor Labs'
// — a SECOND brand owner, because the toggle only exists when there is more than one and the four
// rows the E2E suite seeds are one per owner. The issue says the fault is not observable on that data
// and to say so if arranging otherwise is awkward; here it is not, because this fixture is ours.
const KEY2 = 'petcary'
const NAME2 = 'Petcary'
const LONG_TITLE_MARK = 'A DELIBERATELY VERY LONG MARK NAME FOR THE DRIFT PROBE'

const bands = [
  { label: 'Severe', tone: 'severe' },
  { label: 'Medium', tone: 'medium' },
  { label: 'Manageable', tone: 'low' },
]

// THE ROW, AS THE SERVICE SENDS IT. `productName` is resolved here by the SAME expression
// portal-service.mjs evaluates (reportIdentityFor(product).identity), never typed: the file's own rule
// is that typing a product name re-introduces the second answer this check exists to catch.
//
// `stageLabel` stays on every row, and it stays a DEPTH NUMBER. That is deliberate and it is what gives
// the assertions below their teeth: the wire really does carry "Depth 4" on a run delivered under the
// retired ladder, and the screen must print the product's name instead. A fixture that omitted the rung
// could not tell a screen that ignores it from a screen that never had one offered.
const { reportIdentityFor } = await import('../driver/search-policy.mjs')
const run = (over) => {
  const product = over.product ?? 'global-preliminary-search'
  return {
    account: KEY, kind: 'clearance', state: 'delivered', band: 'Manageable', tone: 'low',
    bands, marks: [], reportSchema: 2, held: false, report: 'report.html',
    step: null, stepN: null, stepTotal: null, reason: null, failedStage: null,
    pausedKind: null, resetsAt: null, startedAt: null, queuePos: null,
    projectKey: null, projectName: null, markName: null, title: '', date: '2026-08-02',
    product, stageLabel: 'Depth 4', productName: reportIdentityFor(product).identity, runId: '', ...over,
  }
}

let longTitle = false

const RUNS = () => [
  // The pair. Two reads of one mark, different depths, and — when `longTitle` is on — a title that grows.
  run({ runId: 'tmpa-drift-1', markName: longTitle ? LONG_TITLE_MARK : 'VENZY', title: 'VENZY', date: '2026-08-02', band: 'Manageable', stageLabel: 'Depth 4', product: 'global-preliminary-search' }),
  run({ runId: 'tmpa-drift-2', markName: longTitle ? LONG_TITLE_MARK : 'VENZY', title: 'VENZY', date: '2026-08-01', band: 'Medium', tone: 'medium', stageLabel: 'Depth 1', product: 'knockout-search' }),
  // Not finished. Its Status is the case is about.
  run({
    runId: 'tmpb-stopped', markName: 'VIBRANTE FROSTPLUM', title: 'VIBRANTE FROSTPLUM', date: '2026-08-02',
    state: 'failed', band: null, tone: null, report: null,
    failedStage: 'common-law-half:b',
    reason: 'invalid_file:prelim-search/tmpe2er1-vibrante-frostplum/2026-08-02-fixture/common-law-findings.half-b.md:connotation_undisposed:VIBRANTE FROSTPLUM urban dictionary,FROSTPLUM meaning slang,FR',
  }),
  // A second brand owner, so the grouping toggle has something to group.
  run({ runId: 'tmpd-other', account: KEY2, markName: 'ASTERION', title: 'ASTERION', date: '2026-08-03', band: 'Severe', tone: 'severe', stageLabel: 'Depth 4', product: 'global-preliminary-search' }),
  // A batch.
  run({
    runId: 'tmpc-batch', markName: null, title: 'Knockout search — 2 marks', kind: 'knockout-batch',
    stageLabel: 'Depth 1', product: 'knockout-search', date: '2026-08-02',
    marks: [{ name: 'E2E DUPLICATE PROBE', band: 'Manageable', tone: 'low' }, { name: 'E2E FALLBACK PROBE', band: 'Medium', tone: 'medium' }],
  }),
]

// ── the /portal/api/searches stub ───────────────────────────────────────────────────────────────────
//
// CLEARANCES NO LONGER FETCHES THIS. It used to, for one reason — to turn `run.product` into a
// name — and that route returns the ORDERABLE products only, so every archived run missed the join and
// the screen printed the run's own `stageLabel`, a Depth number, at a client. The name arrives on the
// row now. The route is still stubbed because other screens in the bundle call it; nothing on THIS
// screen depends on it, and the assertions below prove that by leaving a Depth string on every row.
//
// The rows still come from `driver/product-rows.mjs` — the same function the live service calls — so a
// product renamed in the offering renames here on the same commit.
const { productRows } = await import('../driver/product-rows.mjs')
const PRODUCTS = productRows().map((p) => ({ ...p, available: true, unavailableNote: null }))
// The name the OFFERING gives each product, for comparing against what the screen rendered. Typing these
// would re-introduce the second answer this file exists to catch.
const PRODUCT_NAME = Object.fromEntries(PRODUCTS.map((p) => [p.key, p.name]))
if (!PRODUCTS.length || PRODUCTS.some((p) => !p.key || !p.name)) {
  console.error(`the product registry answered ${PRODUCTS.length} usable rows — there is nothing to check the rendered names against`)
  process.exit(2)
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' }
const json = (res, body) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }

const server = createServer((req, res) => {
  const p = new URL(req.url, 'http://localhost').pathname
  if (p === '/portal/api/me') return json(res, { email: 'staff@example-firm.com', role: 'staff', accounts: '*', accountNames: {}, allowance: null })
  if (p === '/portal/admin/roster') return json(res, { customers: [{ key: KEY, name: NAME }, { key: KEY2, name: NAME2 }] })
  if (p === '/portal/admin/families') return json(res, { of: {}, names: {} })
  if (p === '/portal/api/runs') return json(res, { runs: RUNS() })
  if (p === '/portal/api/searches') return json(res, { account: KEY, products: PRODUCTS, recipes: [], read: { available: false, maxBrief: 0, note: null } })
  if (p === '/portal/api/mcp-access') return json(res, { url: null, keyUrl: null, email: null, enabled: false })
  const base = p.split('?')[0]
  const file = base === '/' || (base.startsWith('/portal') && !base.includes('.')) ? '/index.html' : base.replace(/^\/portal/, '')
  const full = join(DIST, file)
  if (!existsSync(full)) { res.writeHead(404); res.end('no'); return }
  res.writeHead(200, { 'content-type': MIME[extname(full)] ?? 'application/octet-stream' })
  res.end(readFileSync(full))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`

// ── what is measured, in the page ───────────────────────────────────────────────────────────────────
//
// Every number here comes from the layout engine. Nothing is inferred from a class name: a rule that is
// present but overridden looks identical to a rule that works, and that is exactly the failure a string
// test cannot tell apart.

const MEASURE = `(async () => {
  // Open every row: the alignment question only exists once a read is showing.
  const rows = [...document.querySelectorAll('table.data tr.row')];
  for (const r of rows) { r.click(); await new Promise(r2 => setTimeout(r2, 60)); }
  await new Promise(r => setTimeout(r, 350));

  const table = document.querySelector('table.data');
  if (!table) return { fatal: 'no table on the page' };
  const wrap = table.closest('.table-wrap');
  const head = [...table.querySelectorAll('thead th')];
  const headText = head.map(h => (h.textContent || '').trim());
  const headLeft = head.map(h => Math.round(h.getBoundingClientRect().left));

  // Every read row's cells, against the header cell of the same index.
  const reads = [...table.querySelectorAll('tr.read-row')].map(tr => ({
    left: [...tr.children].map(td => Math.round(td.getBoundingClientRect().left)),
    cols: tr.children.length,
  }));

  // The Updated cell: how many lines does its text actually occupy? lineHeight vs rendered height is
  // the only honest way to ask — a wrapped date and a one-line date are the same string.
  const updatedIdx = headText.findIndex(t => /^UPDATED$/i.test(t));
  const dateCells = [...table.querySelectorAll('tbody tr.row')].map(tr => tr.children[updatedIdx]).filter(Boolean);
  const dateLines = dateCells.map(td => {
    const cs = getComputedStyle(td);
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
    const inner = td.getBoundingClientRect().height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    return Math.max(1, Math.round(inner / lh));
  });

  // Does the NAME wrap? Same method as the date: rendered height against line height. The Name cell is
  // the one #280 says must not wrap for a single mark of ordinary length, and counting characters
  // cannot answer that — only the layout engine can.
  const nameIdx = headText.findIndex(t => /^NAME/i.test(t));
  const nameLines = [...table.querySelectorAll('tbody tr.row')].map(tr => {
    const td = tr.children[nameIdx];
    if (!td) return null;
    const b = td.querySelector('b');
    if (!b) return null;
    const cs = getComputedStyle(b);
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
    return { text: (b.textContent || '').trim(), lines: Math.max(1, Math.round(b.getBoundingClientRect().height / lh)) };
  }).filter(Boolean);

  // Header widths as a share of the table, so a regression reads as "Status is 47% again".
  const total = table.getBoundingClientRect().width;
  // Keyed by INDEX as well as text: #282 left two headers with no text (the twisty and the checkbox
  // column), and keying on text alone silently collapsed them into one entry. Concatenation, not a
  // template literal — this whole block IS a template literal, so a backtick here closes it.
  const share = Object.fromEntries(head.map((h, i) => [i + ':' + (headText[i] || '(unnamed)'), Math.round(h.getBoundingClientRect().width / total * 1000) / 10]));

  // THE PRODUCT NAME, as rendered. readLabel (contract/reads.ts) reads run.productName off the row and
  // falls back to the run's own stageLabel only when there is no name. Both paths produce a string in the
  // same place, so only the STRING can tell them apart: "Global preliminary search · 2026-08-02" is the
  // name, "Depth 4 · 2026-08-02" is the fallback — and every fixture row below carries that exact Depth
  // string, so a screen that reached for it would say so here. NO BACKTICKS IN THIS COMMENT: the whole
  // block is a template literal and one would close it.
  //
  // Read from the FIRST cell's own span (Clearances.tsx renders the label there); the row's whole
  // textContent would sweep up the status and risk cells and make any assertion about the label
  // satisfiable by something else on the row.
  const readLabels = [...document.querySelectorAll('tr.read-row')]
    .map(tr => tr.querySelector('td span.mono'))
    .filter(Boolean)
    .map(el => (el.firstChild && el.firstChild.textContent ? el.firstChild.textContent : el.textContent || '').trim())
    .filter(Boolean);

  return {
    headText, headLeft, reads, dateLines, nameLines, share, readLabels,
    openedRows: rows.length,
    readRows: reads.length,
    // The scrollbar #280 is about: does the table overflow its own wrapper?
    // AGAINST THE BORDER BOX, not clientWidth.
    //
    // clientWidth excludes a rendered scrollbar, so on a classic-scrollbar platform it is already 19px
    // smaller THE MOMENT the bar appears — and the bar appears because the content exceeded it. Comparing
    // the two asks a circular question and answers it "overflowing" by exactly one scrollbar width,
    // whatever the layout does. Measured: CI reported table 788px in a 769px wrapper three times running,
    // with min-width at 760, then 700, then 0 — the number never moved, because it was never the floor.
    //
    // The real question is whether the table is wider than its container, and the container's border box
    // is what a reader sees. This machine has overlay scrollbars and never showed the difference.
    overflowsX: wrap ? table.getBoundingClientRect().width > wrap.getBoundingClientRect().width + 1 : null,
    overflowBy: wrap ? Math.round(table.getBoundingClientRect().width - wrap.getBoundingClientRect().width) : null,
    tableMinWidth: getComputedStyle(table).minWidth,
    tableWidth: Math.round(table.getBoundingClientRect().width),
    docOverflowsX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    tableLayout: getComputedStyle(table).tableLayout,
    headerTruncated: headText.some(t => /^UPD$|^STA$|^RIS$/i.test(t)),
  };
})()`

// ── chrome ──────────────────────────────────────────────────────────────────────────────────────────

const userDir = mkdtempSync(join(tmpdir(), 'clearances-check-'))
// NO NETWORK, deliberately. CI runs this with no route to api.fontshare.com, so the brand webfonts never
// arrive and the page renders in a wider fallback — which is exactly when a cell wraps and a table
// overflows. A check that passes only when the fonts load is a check that passes on the developer's
// machine and fails in CI, which is how this was found.
const chrome = spawn('google-chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
  `--user-data-dir=${userDir}`, `--window-size=${WIDTH},1000`,
  '--remote-debugging-port=0', `${origin}/portal/clearances`,
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
const cmd = (method, params) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, sessionId, method, params })) })
const value = async (expr) => (await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value ?? null

const reload = async () => {
  await cmd('Page.navigate', { url: `${origin}/portal/clearances` })
  await new Promise((r) => setTimeout(r, 1800))
}

await new Promise((r) => setTimeout(r, 1500))
await reload()
const short = await value(MEASURE)

// — the grouping toggle, both ways. Grouped, the owner is a section header; ungrouped, it is a
// column on every row. The information has to survive the toggle, and the sort has to go global.
const TOGGLE = `(async () => {
  const box = [...document.querySelectorAll('label.group-toggle input[type=checkbox]')][0];
  if (!box) return { fatal: 'no grouping toggle on the page — is there more than one brand owner in view?' };
  const before = {
    checked: box.checked,
    headers: [...document.querySelectorAll('tr.group-head')].length,
    cols: [...document.querySelectorAll('table.data thead th')].map(t => (t.textContent || '').trim()),
  };
  box.click();
  await new Promise(r => setTimeout(r, 400));
  const after = {
    checked: box.checked,
    headers: [...document.querySelectorAll('tr.group-head')].length,
    cols: [...document.querySelectorAll('table.data thead th')].map(t => (t.textContent || '').trim()),
    // Every row must still say who it belongs to.
    ownerCells: [...document.querySelectorAll('table.data tbody tr.row')].map(tr => {
      const i = [...document.querySelectorAll('table.data thead th')].findIndex(t => /Brand owner/i.test(t.textContent || ''));
      return i < 0 ? null : (tr.children[i] ? (tr.children[i].textContent || '').trim() : null);
    }),
    // And the read rows must still line up: one cell per column.
    readCols: [...document.querySelectorAll('tr.read-row')].map(tr => tr.children.length),
  };
  return { before, after };
})()`

const toggle = await value(TOGGLE)
// Put grouping back before the drift probe. The toggle PERSISTS (localStorage,), so leaving it off
// would have the next pass render a different number of columns and report that as column drift — which
// is what it did the first time this ran.
await value(`(async () => { const b = document.querySelector('label.group-toggle input'); if (b && !b.checked) { b.click(); await new Promise(r => setTimeout(r, 300)); } return true })()`)

// The drift probe: the SAME page with one run title made much longer. 's own acceptance test —
// "lengthen a run title in the fixture data and nothing except that title moves".
longTitle = true
await reload()
const long = await value(MEASURE)

if (shotAt) {
  const shot = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  const data = shot.result?.result?.data ?? shot.result?.data
  if (data) writeFileSync(shotAt, Buffer.from(data, 'base64'))
}

// — SIGNAL THE GROUP, NOT THE PROCESS. `chrome.kill` reaches only the process spawned here;
// its renderer and GPU children survive and keep writing the profile directory, so the rmSync below
// races them. Here that loss is SILENT — the rmSync is wrapped — which is why this file never failed
// CI the way render-check.mjs did, and instead leaked a temp profile and stray processes per run.
try { process.kill(-chrome.pid, 'SIGKILL') }
catch { try { chrome.kill('SIGKILL') } catch { /* already gone */ } }
server.close()
await new Promise((r) => setTimeout(r, 400))
if (!keep) { try { rmSync(userDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* a stray profile dir is not a test result */ } }

// ── verdict ─────────────────────────────────────────────────────────────────────────────────────────

const fail = []
const ok = (cond, msg) => { if (!cond) fail.push(msg) }

if (!short || short.fatal) {
  console.error(`clearances-render-check: ${short?.fatal ?? 'the page returned nothing'}`)
  process.exit(1)
}

console.log(`measured at ${WIDTH}px — ${short.openedRows} rows opened, ${short.readRows} read rows`)
// Printed on every run, not only on failure: `overflow: 21px` is the number that told us the table
// was resolving wider than its wrapper, and it is the first thing to look at when this check goes red.
console.log(`table ${short.tableWidth}px in a ${short.tableWidth - (short.overflowBy ?? 0)}px wrapper — overflow ${short.overflowBy}px (min-width ${short.tableMinWidth})`)
console.log(`column share: ${Object.entries(short.share).map(([k, v]) => `${k} ${v}%`).join(' · ')}`)

// — the grid is declared, and the reads are in it.
ok(short.tableLayout === 'fixed', `the table is not fixed-layout (got ${short.tableLayout}) — its columns are still decided by their content`)
ok(short.readRows > 0, 'no expanded read rows were found — the rows did not open, or a read is still a spanning panel')
for (const [i, r] of short.reads.entries()) {
  ok(r.cols === short.headText.length,
    `read row ${i} has ${r.cols} cells against ${short.headText.length} columns — it is not in the parent grid`)
  // Every value shares a left edge with the column it belongs to. The twisty cell is skipped: it carries
  // the indent, which is the one deliberate offset.
  for (let c = 1; c < Math.min(r.left.length, short.headLeft.length); c++) {
    ok(Math.abs(r.left[c] - short.headLeft[c]) <= 1,
      `read row ${i}, column ${c} (${short.headText[c] || '?'}) starts at ${r.left[c]} but its header is at ${short.headLeft[c]} — off by ${r.left[c] - short.headLeft[c]}px`)
  }
}
ok(!short.headerTruncated, `a header truncated when the rows opened: ${short.headText.join(' · ')}`)

// ── the product name, which this file used to certify by not asking ─────────────────────────────────
//
// Clearances shows the product's name off the row and falls back to the run's own `stageLabel`, a rung on
// the retired depth ladder. Both put a string in the same cell, so the check has to read the string. It
// used to be able to pass on the fallback — its stub answered a contract key the service had stopped
// sending, the product list arrived empty, and "Depth 4 · 2026-08-02" rendered green. Every fixture row
// now carries "Depth 4" on the wire ON PURPOSE: if the screen ever reaches for it again, it says so here.
console.log(`read labels: ${short.readLabels.join(' | ')}`)
ok(short.readLabels.length > 0, 'no read labels were rendered — the product name cannot be judged from nothing')
for (const label of short.readLabels) {
  ok(!/Depth\s*\d/i.test(label),
    `a read label reads "${label}" — that is the depth-ladder fallback, and every row was sent a product name`)
  ok(Object.values(PRODUCT_NAME).some((n) => label.startsWith(n)),
    `a read label reads "${label}", which is not one of the offering's product names (${Object.values(PRODUCT_NAME).join(' | ')})`)
}
// AND BOTH PRODUCTS IN THE FIXTURE ARE NAMED. Asserting only that no label is a Depth string would pass
// if every row rendered the same name — the row has to answer per run, which is the whole point of it.
for (const key of ['global-preliminary-search', 'knockout-search']) {
  ok(short.readLabels.some((l) => l.startsWith(PRODUCT_NAME[key])),
    `no read row named "${PRODUCT_NAME[key]}" — the fixture has a ${key} run, so the screen named it something else`)
}

// The drift probe.
if (long && !long.fatal) {
  ok(JSON.stringify(long.headLeft) === JSON.stringify(short.headLeft),
    `lengthening a run title moved the columns: ${short.headLeft.join(',')} → ${long.headLeft.join(',')}`)
} else {
  fail.push(`the long-title pass returned nothing: ${long?.fatal ?? 'no result'}`)
}

// — the toggle. Grouped ⇒ section headers and no owner column; ungrouped ⇒ a column on every row.
if (!toggle || toggle.fatal) {
  fail.push(`the grouping toggle: ${toggle?.fatal ?? 'no result'}`)
} else {
  ok(toggle.before.checked === true, 'grouping is not on by default')
  ok(toggle.before.headers > 0, 'grouped, but no brand-owner section headers rendered')
  ok(!toggle.before.cols.some((c) => /Brand owner/i.test(c)), 'grouped, and an owner COLUMN rendered too — the owner is stated twice')
  ok(toggle.after.checked === false, 'clicking the toggle did not turn grouping off')
  ok(toggle.after.headers === 0, `ungrouped, but ${toggle.after.headers} section header(s) survived — the list is not flat`)
  ok(toggle.after.cols.some((c) => /Brand owner/i.test(c)), 'ungrouped, and the brand owner is nowhere — the information did not survive the toggle')
  ok(toggle.after.ownerCells.every((c) => c), `ungrouped, a row does not say who it belongs to: ${JSON.stringify(toggle.after.ownerCells)}`)
  ok(new Set(toggle.after.readCols).size === 1 && toggle.after.readCols[0] === toggle.after.cols.length,
    `ungrouped, the read rows no longer match the grid: ${JSON.stringify(toggle.after.readCols)} cells against ${toggle.after.cols.length} columns`)
}

// — the date fits, and the table does not overflow.
ok(short.dateLines.every((n) => n === 1), `the date wraps at ${WIDTH}px — lines per row: ${short.dateLines.join(',')}`)
// A mark of ordinary length must sit on one line. The fixture's longest ordinary mark is
// `VIBRANTE FROSTPLUM` — a real E2E mark, not a convenient short one.
for (const n of short.nameLines ?? []) {
  // A SINGLE mark of ordinary length, which is what asks for. A composite — `VENZY +2 more` — is
  // two facts in one cell and is allowed a second line; the drift-probe name is deliberately absurd.
  if (/\+\d+ more$/.test(n.text) || n.text.length > 34) continue
  ok(n.lines === 1, `the Name cell wraps at ${WIDTH}px for a single mark of ordinary length: ${JSON.stringify(n.text)} took ${n.lines} lines`)
}
ok(short.overflowsX === false,
  `the table overflows its wrapper at ${WIDTH}px by ${short.overflowBy}px — table ${short.tableWidth}px, min-width ${short.tableMinWidth}, columns ${JSON.stringify(short.share)}`)
ok(short.docOverflowsX === false, `the page itself scrolls horizontally at ${WIDTH}px`)

if (fail.length) {
  console.error(`\nclearances-render-check FAILED (${fail.length}):`)
  for (const f of fail) console.error(`  • ${f}`)
  process.exit(1)
}
console.log('clearances-render-check: columns hold, reads are in the grid, the date fits, nothing overflows')
