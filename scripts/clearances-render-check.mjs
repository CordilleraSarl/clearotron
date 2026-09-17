#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Do the columns on /portal/clearances hold together, in a real browser, at a real width?
//
//   node scripts/clearances-render-check.mjs [--keep] [--shot <path>] [--width 1100] [--shot-dir <dir>]
//
// ── why this exists ──────────────────────────────────────────────────────────────────────────────────
//
// Because nothing else in this repo can answer the question. portal-ui runs `node --test` with type
// stripping and carries no jsdom and no React test renderer — Node cannot import a `.tsx` at all — so the
import { navigateOrRefuse } from './headless-page.mjs'   // Page.navigate returns an errorText, and nothing read it
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
import { readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { browserRun } from "../shared/browser-temp-root.mjs";

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = join(HERE, '..', 'portal-ui', 'dist')
const keep = process.argv.includes('--keep')
const shotAt = process.argv.includes('--shot') ? process.argv[process.argv.indexOf('--shot') + 1] : null
const WIDTH = process.argv.includes('--width') ? Number(process.argv[process.argv.indexOf('--width') + 1]) : 1100
// THE WIDE PASS. Open has to sit in one column at one width at the narrowest width this check holds the
// table whole (WIDTH, where the content column is 767px) AND at a wide desktop, where the actions column
// lays its buttons out side by side instead of stacked. Both are measured, because a rule that holds at
// one of them says nothing about the other.
const WIDE = 1440
const shotDir = process.argv.includes('--shot-dir') ? process.argv[process.argv.indexOf('--shot-dir') + 1] : null

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
// — a SECOND company, because the toggle only exists when there is more than one and the four
// rows the E2E suite seeds are one per owner. The issue says the fault is not observable on that data
// and to say so if arranging otherwise is awkward; here it is not, because this fixture is ours.
const KEY2 = 'burrowell'
const NAME2 = 'Burrowell'
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

// THE ROW STATES the list has to tell apart, each built the way the service sends it:
//   • a finished name with one search                          ASTERION
//   • a name with a search waiting, above two finished ones    AQUAPLUS — its latest report is Medium,
//     the knockout before it was Severe, so the row also carries "was Severe"
//   • a group of two names, one of them waiting                "Aqua line" — AQUAPLUS and AQUAMAX
//   • a stopped name                                           CORAL FREEZE
//   • a running name, on its fourth step of nine               TIDEGLASS
// The group's band is the one that proves the roll-up reads each name's LATEST REPORT: AQUAMAX is
// Manageable and AQUAPLUS's newest search has no band at all, so a group rolling up the newest search
// of each name would say Manageable. It must say Medium.
const FAMILY_ID = 'fam-aqua'
const FAMILY_NAME = 'Aqua line'

const RUNS = () => [
  // The pair. Two reads of one mark, different depths, and — when `longTitle` is on — a title that grows.
  run({ runId: 'tmpa-drift-1', markName: longTitle ? LONG_TITLE_MARK : 'VENZY', title: 'VENZY', date: '2026-08-02', band: 'Manageable', stageLabel: 'Depth 4', product: 'global-preliminary-search' }),
  run({ runId: 'tmpa-drift-2', markName: longTitle ? LONG_TITLE_MARK : 'VENZY', title: 'VENZY', date: '2026-08-01', band: 'Medium', tone: 'medium', stageLabel: 'Depth 1', product: 'knockout-search' }),
  // Not finished. Its Status is the case is about — and a failed name now lives under the Failed tab.
  run({
    runId: 'tmpb-stopped', markName: 'VIBRANTE FROSTPLUM', title: 'VIBRANTE FROSTPLUM', date: '2026-08-02',
    state: 'failed', band: null, tone: null, report: null,
    failedStage: 'common-law-half:b',
    reason: 'invalid_file:prelim-search/tmpe2er1-vibrante-frostplum/2026-08-02-fixture/common-law-findings.half-b.md:connotation_undisposed:VIBRANTE FROSTPLUM urban dictionary,FROSTPLUM meaning slang,FR',
  }),
  // A second company, so the grouping toggle has something to group.
  run({ runId: 'tmpd-other', account: KEY2, markName: 'ASTERION', title: 'ASTERION', date: '2026-08-03', band: 'Severe', tone: 'severe', stageLabel: 'Depth 4', product: 'global-preliminary-search' }),
  // A batch.
  run({
    runId: 'tmpc-batch', markName: null, title: 'Knockout search — 2 marks', kind: 'knockout-batch',
    stageLabel: 'Depth 1', product: 'knockout-search', date: '2026-08-02',
    marks: [{ name: 'E2E DUPLICATE PROBE', band: 'Manageable', tone: 'low' }, { name: 'E2E FALLBACK PROBE', band: 'Medium', tone: 'medium' }],
  }),
  // AQUAPLUS: a search waiting for a slot, above two finished ones. `issuedAt` is what orders a thread,
  // and a queued run's is the moment it was queued — which is why the name's Updated date is today's.
  run({ runId: 'aq-plus-3', markName: 'AQUAPLUS', title: 'AQUAPLUS', date: '2026-09-16', issuedAt: '2026-09-16T08:00:00Z', state: 'queued', band: null, tone: null, report: null, product: 'multi-country-focus-search', stageLabel: 'Depth 3' }),
  run({ runId: 'aq-plus-2', markName: 'AQUAPLUS', title: 'AQUAPLUS', date: '2026-09-02', issuedAt: '2026-09-02T15:00:00Z', band: 'Medium', tone: 'medium', product: 'global-preliminary-search' }),
  run({ runId: 'aq-plus-1', markName: 'AQUAPLUS', title: 'AQUAPLUS', date: '2026-08-21', issuedAt: '2026-08-21T10:00:00Z', band: 'Severe', tone: 'severe', product: 'knockout-search', stageLabel: 'Depth 1' }),
  run({ runId: 'aq-max-1', markName: 'AQUAMAX', title: 'AQUAMAX', date: '2026-08-28', issuedAt: '2026-08-28T09:00:00Z', band: 'Manageable', tone: 'low', product: 'full-country-search' }),
  // Stopped on purpose, with nothing delivered.
  run({ runId: 'coral-1', markName: 'CORAL FREEZE', title: 'CORAL FREEZE', date: '2026-09-16', issuedAt: '2026-09-16T07:00:00Z', state: 'cancelled', band: null, tone: null, report: null }),
  // Running, and never finished before.
  run({ runId: 'tide-1', account: KEY2, markName: 'TIDEGLASS', title: 'TIDEGLASS', date: '2026-09-16', issuedAt: '2026-09-16T09:00:00Z', state: 'running', band: null, tone: null, report: null, step: 'Register sweeps', stepN: 4, stepTotal: 9 }),
]
const FAMILIES = { of: { 'aq-plus-1': FAMILY_ID, 'aq-plus-2': FAMILY_ID, 'aq-plus-3': FAMILY_ID, 'aq-max-1': FAMILY_ID }, names: { [FAMILY_ID]: FAMILY_NAME } }

// What /usage answers. Plenty for the measured passes, so the allowance line stays off them; the
// evidence moves it through its three states.
let usageNow = { account: KEY, today: 2, thisMonth: 9, queued: 0, dailyRuns: 20, monthlyRuns: null, maxQueued: null, capped: true }

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
  if (p === '/portal/api/me') return json(res, { email: 'manager@example-firm.com', permissions: { run: true, manage: true }, access: [{ kind: 'everything' }], accounts: '*', accountNames: {}, allowance: null, brand: 'Northwind Group' })
  if (p === '/portal/admin/roster') return json(res, { customers: [{ key: KEY, name: NAME }, { key: KEY2, name: NAME2 }] })
  if (p === '/portal/admin/families') return json(res, FAMILIES)
  if (p === '/portal/api/usage') return json(res, usageNow)
  if (p === '/portal/api/runs') return json(res, { runs: RUNS() })
  if (p === '/portal/api/searches') return json(res, { account: KEY, products: PRODUCTS, recipes: [], read: { available: false, maxBrief: 0, note: null } })
  // A CONNECTED READER, so Ask AI draws on the rows that carry it and opens its question panel. The one
  // request the whole table makes for it is counted by revisit-render-check.
  if (p === '/portal/api/mcp-access') return json(res, { url: 'https://connector.example.test/mcp', keyUrl: null, email: 'manager@example-firm.com', enabled: true, stdio: null, aiConnected: true, offers: [] })
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
  // Open everything that opens: the alignment question only exists once a read is showing. THROUGH THE
  // TWISTIES, not the rows. A name with one search opens its REPORT on a row click, so clicking every row
  // would navigate away mid-measurement; the twisty is the control that expands, and a group's members
  // bring their own twisties once it is open, hence the passes.
  for (let pass = 0; pass < 3; pass++) {
    const shut = [...document.querySelectorAll('table.data button.twisty[aria-expanded="false"]')];
    if (!shut.length) break;
    for (const b of shut) { b.click(); await new Promise(r2 => setTimeout(r2, 60)); }
    await new Promise(r => setTimeout(r, 250));
  }
  const rows = [...document.querySelectorAll('table.data button.twisty')];

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
  // A PREFIX, not the whole text: the sort button carries its arrow and a screen-reader phrase, so the
  // header's text is "Updated↓, sorted descending" and an exact match found no column at all — which
  // made every date assertion below a pass over nothing.
  const updatedIdx = headText.findIndex(t => /^UPDATED/i.test(t));
  const dateCells = [...table.querySelectorAll('tbody tr.row')].map(tr => tr.children[updatedIdx]).filter(Boolean);
  // THE TEXT'S OWN LINES, not the cell's height: a row is as tall as its tallest cell, and with a status
  // line beneath or two buttons stacked in the actions column a one-line date sits in a three-line cell.
  // A Range over the cell's contents reports one client rect per rendered line of the text itself.
  const dateLines = dateCells.filter(td => (td.textContent || '').trim()).map(td => {
    const range = document.createRange();
    range.selectNodeContents(td);
    const tops = new Set([...range.getClientRects()].map(r => Math.round(r.top)));
    return Math.max(1, tops.size);
  });

  // Does the NAME wrap? Same method as the date: rendered height against line height. The Name cell is
  // the one that must not wrap for a single mark of ordinary length, and counting characters
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
  // Keyed by INDEX as well as text: a fix left two headers with no text (the twisty and the checkbox
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
  // The label's own text, less the time a same-day pair adds after it. The date sits in a span of its own
  // so it never breaks at a hyphen, which is why this reads the whole label rather than its first node.
  const readLabels = [...document.querySelectorAll('tr.read-row')]
    .map(tr => tr.querySelector('td span.mono'))
    .filter(Boolean)
    .map(el => (el.textContent || '').replace(/\\s+/g, ' ').replace(/ \\d{2}:\\d{2} UTC$/, '').trim())
    .filter(Boolean);

  // ── the rows, as a reader meets them ──────────────────────────────────────────────────────────────
  const txt = (el) => (el ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : '');
  const statusIdx = headText.findIndex(t => /^STATUS/i.test(t));
  const riskIdx = headText.findIndex(t => /^RISK/i.test(t));
  const actionsIdx = head.findIndex(h => h.getAttribute('aria-label') === 'Actions');
  // The two neutral inks, resolved by the page itself rather than typed here.
  const ink = (v) => { const e = document.createElement('span'); e.style.color = 'var(' + v + ')'; document.body.appendChild(e); const c = getComputedStyle(e).color; e.remove(); return c; };
  const neutral = [ink('--text-muted'), ink('--text-faint')];
  const rowInfo = (tr) => {
    const cells = [...tr.children];
    const nameCell = cells[nameIdx];
    const actions = actionsIdx >= 0 ? cells[actionsIdx] : null;
    const open = actions ? actions.querySelector('button.row-open') : null;
    const dot = cells[statusIdx] ? cells[statusIdx].querySelector('.dot') : null;
    const dcs = dot ? getComputedStyle(dot) : null;
    const b = nameCell ? nameCell.querySelector('b') : null;
    const label = nameCell ? nameCell.querySelector('span.mono') : null;
    return {
      kind: tr.classList.contains('read-row') ? 'search' : (nameCell && nameCell.querySelector('.row-kind') ? 'group' : 'name'),
      name: b ? txt(b) : txt(label).replace(/ \\d{2}:\\d{2} UTC$/, ''),
      nameCell: txt(nameCell),
      cells: cells.length,
      twisty: Boolean(tr.querySelector('button.twisty')),
      status: txt(cells[statusIdx]),
      dot: dot ? { cls: dot.className, ink: dcs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? dcs.backgroundColor : dcs.borderTopColor } : null,
      risk: txt(cells[riskIdx]),
      updated: txt(cells[updatedIdx]),
      open: open ? { text: txt(open), aria: open.getAttribute('aria-label'), left: Math.round(open.getBoundingClientRect().left), width: Math.round(open.getBoundingClientRect().width), clipped: open.scrollWidth > open.clientWidth + 1 } : null,
      menu: Boolean(actions && actions.querySelector('button.row-menu-btn')),
      ask: (() => { const b = actions ? actions.querySelector('.ask-ai button.ask-ai-btn') : null; return b ? { text: txt(b), aria: b.getAttribute('aria-label'), left: Math.round(b.getBoundingClientRect().left) } : null; })(),
      rules: (getComputedStyle(cells[0]).backgroundImage.match(/linear-gradient/g) || []).length,
      inert: tr.classList.contains('inert'),
    };
  };
  const body = [...table.querySelectorAll('tbody tr')];
  const listed = body.filter(tr => tr.matches('tr.row, tr.read-row')).map(rowInfo);
  // THE COUNTS, as printed: the total over the table and each company heading, with the names that are
  // actually under each heading counted off the rows — a top-level name is one, a group is its members.
  const namesTotal = [...document.querySelectorAll('.controls span.mono')].map(txt).find(t => /^\\d+ names?$/.test(t)) || null;
  const headings = [];
  for (const tr of body) {
    if (tr.matches('tr.group-head')) { headings.push({ name: txt(tr.querySelector('.owner-name')), printed: txt(tr.querySelector('.owner-count')), band: getComputedStyle(tr.querySelector('td')).backgroundColor, counted: 0 }); continue; }
    const h = headings[headings.length - 1];
    if (!h || !tr.matches('tr.row')) continue;
    const info = rowInfo(tr);
    if (info.kind === 'group') { const m = info.nameCell.match(/(\\d+) names?/); h.counted += m ? Number(m[1]) : 0; }
    else if (info.rules === 0) h.counted += 1;
  }

  return {
    listed, namesTotal, headings, neutral, updatedIdx,
    headText, headLeft, reads, dateLines, nameLines, share, readLabels,
    openedRows: rows.length,
    readRows: reads.length,
    // The scrollbar this checks: does the table overflow its own wrapper?
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

// The profile goes inside a run root whose TMPDIR the browser inherits, so the singleton
// lock it writes there leaves with the root instead of accumulating in the shared one.
const { profile: userDir, env: chromeEnv, keep: keepRoot } = browserRun("clearances-check-")
// --keep means LEAVE THE PROFILE: take the run root out of the exit sweep, or the flag
// would go on reading as working while the directory it promises is removed anyway.
if (keep) keepRoot()
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
const cmd = (method, params) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, sessionId, method, params })) })
const value = async (expr) => (await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value ?? null

const reload = async () => {
  await navigateOrRefuse(cmd, `${origin}/portal/clearances`, { what: 'clearances-render-check' })
  await new Promise((r) => setTimeout(r, 1800))
}

await new Promise((r) => setTimeout(r, 1500))
await reload()
const short = await value(MEASURE)

// — THE ROW MENU AND THE ROW'S OWN CLICK, driven rather than read. Opened, read and closed with Escape on
// each row shape; then a click on a group row, which folds and goes nowhere, and one on a running name,
// which has nothing to open or expand.
const MENUS = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const txt = (el) => (el ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : '');
  const rowOf = (name) => [...document.querySelectorAll('table.data tbody tr.row')].find(tr => txt(tr.querySelector('b')) === name);
  const menu = async (tr) => {
    const btn = tr && tr.querySelector('button.row-menu-btn');
    if (!btn) return null;
    btn.click(); await sleep(200);
    const items = [...tr.querySelectorAll('[role=menu] [role=menuitem]')].map(txt);
    const expanded = btn.getAttribute('aria-expanded');
    btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(200);
    return { items, expanded, closed: !tr.querySelector('[role=menu]'), label: btn.getAttribute('aria-label'), path: location.pathname };
  };
  const plus = await menu(rowOf('AQUAPLUS'));
  const group = await menu(rowOf(${JSON.stringify(FAMILY_NAME)}));
  const search = await menu([...document.querySelectorAll('table.data tr.read-row')].find(tr => tr.querySelector('button.row-menu-btn')));
  const g = rowOf(${JSON.stringify(FAMILY_NAME)});
  const before = location.pathname;
  const was = g ? g.querySelector('button.twisty').getAttribute('aria-expanded') : null;
  if (g) { g.children[2].click(); await sleep(300); }
  const groupClick = { stayed: location.pathname === before, toggled: g ? g.querySelector('button.twisty').getAttribute('aria-expanded') !== was : false };
  if (g) { g.children[2].click(); await sleep(300); }
  const tide = rowOf('TIDEGLASS');
  if (tide) { tide.children[2].click(); await sleep(300); }
  return { plus, group, search, groupClick, inertClick: { stayed: location.pathname === before, found: Boolean(tide) } };
})()`
const menus = await value(MENUS)

// ASK AI FROM A NAME, driven: the panel names the report, the second question is chosen, and the link the
// assistant opens carries that question typed in. window.open is caught rather than followed.
const ASK = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const txt = (el) => (el ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : '');
  const opened = [];
  window.open = (u) => { opened.push(String(u)); return null; };
  const rowOf = (name) => [...document.querySelectorAll('table.data tbody tr.row')].find(tr => txt(tr.querySelector('b')) === name);
  const drive = async (name) => {
    const tr = rowOf(name);
    const btn = tr && tr.querySelector('.ask-ai button.ask-ai-btn');
    if (!btn) return { fatal: 'no Ask AI on ' + name };
    const before = location.pathname;
    btn.click(); await sleep(250);
    const panel = tr.querySelector('.ask-ai-panel');
    const head = txt(panel && panel.querySelector('.ask-ai-head'));
    const choices = panel ? [...panel.querySelectorAll('[role=radio], .ask-ai-choice')].map(txt) : [];
    const second = panel ? [...panel.querySelectorAll('[role=radio], .ask-ai-choice')][1] : null;
    if (second) { second.click(); await sleep(150); }
    const go = panel ? [...panel.querySelectorAll('button')].find(b => /^Open in /.test(txt(b))) : null;
    const goText = txt(go);
    if (go) { go.click(); await sleep(200); }
    const url = opened[opened.length - 1] || null;
    let q = null; try { q = url ? new URL(url).searchParams.get('q') : null; } catch { q = null; }
    return { head, choices, goText, q, stayed: location.pathname === before };
  };
  return { max: await drive('AQUAMAX'), coral: await drive('CORAL FREEZE') };
})()`
const asked = await value(ASK)

// A name with ONE search opens its report from the row. Last, because it leaves the page.
const ROW_OPENS = `(async () => {
  const tr = [...document.querySelectorAll('table.data tbody tr.row')].find(t => ((t.querySelector('b') || {}).textContent || '').trim() === 'ASTERION');
  if (!tr) return { fatal: 'no ASTERION row' };
  tr.children[2].click();
  await new Promise(r => setTimeout(r, 500));
  return { path: location.pathname };
})()`
const rowOpens = await value(ROW_OPENS)
await reload()

// — THE WIDE PASS: the same page at a desktop width, where Ask AI sits beside Open instead of under it.
await cmd('Emulation.setDeviceMetricsOverride', { width: WIDE, height: 1000, deviceScaleFactor: 1, mobile: false })
await reload()
const wide = await value(MEASURE)
await cmd('Emulation.clearDeviceMetricsOverride', {})
await reload()

// — the grouping toggle, both ways. Grouped, the owner is a section header; ungrouped, it is a
// column on every row. The information has to survive the toggle, and the sort has to go global.
const TOGGLE = `(async () => {
  // Opened first, through the twisties: the read-row half of this pass is about rows that are showing.
  for (let pass = 0; pass < 3; pass++) {
    const shut = [...document.querySelectorAll('table.data button.twisty[aria-expanded="false"]')];
    if (!shut.length) break;
    for (const b of shut) { b.click(); await new Promise(r2 => setTimeout(r2, 60)); }
    await new Promise(r => setTimeout(r, 250));
  }
  const box = [...document.querySelectorAll('label.group-toggle input[type=checkbox]')][0];
  if (!box) return { fatal: 'no grouping toggle on the page — is there more than one company in view?' };
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
      const i = [...document.querySelectorAll('table.data thead th')].findIndex(t => /Company/i.test(t.textContent || ''));
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

// The drift probe: the SAME page with one run title made much longer. its own acceptance test —
// "lengthen a run title in the fixture data and nothing except that title moves".
longTitle = true
await reload()
const long = await value(MEASURE)

if (shotAt) {
  const shot = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  const data = shot.result?.result?.data ?? shot.result?.data
  if (data) writeFileSync(shotAt, Buffer.from(data, 'base64'))
}

// ── evidence ────────────────────────────────────────────────────────────────────────────────────────
//
// Not a test: pictures a reader can hold against the board. Full height at a fixed width, captured with
// the viewport grown to the page — a beyond-viewport capture draws fixed and sticky layers in the wrong
// place. The rows in both themes with the group and its waiting name open; the allowance line in its three
// states, on one company so the line has an account to speak for.
const evidence = []
if (shotDir) {
  longTitle = false
  const capture = async (file, width) => {
    const h = (await value('Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)')) ?? 900
    await cmd('Emulation.setDeviceMetricsOverride', { width, height: Math.max(900, h), deviceScaleFactor: 1, mobile: false })
    await new Promise((r) => setTimeout(r, 400))
    const shot = await cmd('Page.captureScreenshot', { format: 'png' })
    const data = shot.result?.result?.data ?? shot.result?.data
    if (!data) throw new Error(`no screenshot came back for ${file}`)
    writeFileSync(join(shotDir, file), Buffer.from(data, 'base64'))
    evidence.push(file)
  }
  const both = async (name, width) => {
    await capture(`${name}-light.png`, width)
    await value(`document.documentElement.setAttribute('data-theme', 'dark'); 'ok'`)
    await new Promise((r) => setTimeout(r, 300))
    await capture(`${name}-dark.png`, width)
    await value(`document.documentElement.removeAttribute('data-theme'); 'ok'`)
  }
  const EXPAND = (names) => `(async () => {
    for (const name of ${JSON.stringify(names)}) {
      const tr = [...document.querySelectorAll('table.data tbody tr.row')].find(t => ((t.querySelector('b') || {}).textContent || '').trim() === name);
      const tw = tr && tr.querySelector('button.twisty[aria-expanded="false"]');
      if (tw) { tw.click(); await new Promise(r => setTimeout(r, 250)); }
    }
    return true;
  })()`
  for (const width of [WIDE, WIDTH]) {
    await cmd('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false })
    await reload()
    await value(EXPAND([FAMILY_NAME, 'AQUAPLUS']))
    await both(`clearances-rows-${width}`, width)
  }
  for (const [name, usage] of [['plenty', { today: 8 }], ['few', { today: 17 }], ['none', { today: 20 }]]) {
    usageNow = { ...usageNow, ...usage }
    await cmd('Emulation.setDeviceMetricsOverride', { width: WIDE, height: 1000, deviceScaleFactor: 1, mobile: false })
    await navigateOrRefuse(cmd, `${origin}/portal/clearances?owner=${KEY}`, { what: 'clearances-render-check evidence' })
    await new Promise((r) => setTimeout(r, 1800))
    evidence.push({ allowance: name, line: await value(`(document.querySelector('.screen header, .screen') ? [...document.querySelectorAll('.screen span')].map(e => (e.textContent || '').trim()).find(t => /searches? left today|used all/.test(t)) || null : null)`) })
    await both(`clearances-allowance-${name}`, WIDE)
  }
  await cmd('Emulation.clearDeviceMetricsOverride', {})
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

// THE EXPECTATIONS INVERT BELOW THE STYLESHEET'S PHONE BREAKPOINT, and this number is that number.
// Above it a fixed table divides the container and must not overflow its wrapper. Below it there is
// nothing left to divide: the shares become slivers, the risk word prints through the date and marks
// break mid-word, so the stylesheet lets the table become content-sized and be scrolled instead. Asked
// at 400px, the desktop expectations below want a layout no seven-column table can have — so asking
// them there is how a check reports a screen as broken and a design as impossible in the same breath.
const NARROW = 560
const narrow = WIDTH <= NARROW

// — the grid is declared, and the reads are in it.
ok(short.tableLayout === (narrow ? 'auto' : 'fixed'),
  narrow
    ? `at ${WIDTH}px the table is still fixed-layout — its columns are slivers, not something a reader can scroll`
    : `the table is not fixed-layout (got ${short.tableLayout}) — its columns are still decided by their content`)
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
  ok(toggle.before.headers > 0, 'grouped, but no company section headers rendered')
  ok(!toggle.before.cols.some((c) => /Company/i.test(c)), 'grouped, and an owner COLUMN rendered too — the owner is stated twice')
  ok(toggle.after.checked === false, 'clicking the toggle did not turn grouping off')
  ok(toggle.after.headers === 0, `ungrouped, but ${toggle.after.headers} section header(s) survived — the list is not flat`)
  ok(toggle.after.cols.some((c) => /Company/i.test(c)), 'ungrouped, and the company is nowhere — the information did not survive the toggle')
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
ok(short.overflowsX === narrow,
  narrow
    ? `at ${WIDTH}px the table fits its wrapper — it collapsed into slivers instead of staying legible and being scrolled`
    : `the table overflows its wrapper at ${WIDTH}px by ${short.overflowBy}px — table ${short.tableWidth}px, min-width ${short.tableMinWidth}, columns ${JSON.stringify(short.share)}`)
ok(short.docOverflowsX === false, `the page itself scrolls horizontally at ${WIDTH}px`)

// ── what each row says and offers ───────────────────────────────────────────────────────────────────
//
// The five row states, read off the page. Every string compared here is the one the specification
// names; where the screen composes a string from data (a product name, a date), the expectation is
// composed from the same data rather than typed.
const STOPPED_LINE = 'No report will be produced. Completed work stays readable through Ask AI.'
const GROUP_LINE = 'Highest risk across the latest report for each name.'
ok(short.updatedIdx >= 0, `no Updated column was found in the header (${short.headText.join(' · ')}) — every date assertion would be a pass over nothing`)
ok(short.dateLines.length > 0, 'no date cells were measured')
const L = short.listed ?? []
const named = (name, kind) => L.find((r) => r.name === name && r.kind === kind)
const plus = named('AQUAPLUS', 'name')
const group = named(FAMILY_NAME, 'group')
const max = named('AQUAMAX', 'name')
const coral = named('CORAL FREEZE', 'name')
const tide = named('TIDEGLASS', 'name')
const aster = named('ASTERION', 'name')
const venzy = named('VENZY', 'name')
for (const [label, r] of Object.entries({ AQUAPLUS: plus, [FAMILY_NAME]: group, AQUAMAX: max, 'CORAL FREEZE': coral, TIDEGLASS: tide, ASTERION: aster, VENZY: venzy })) {
  ok(Boolean(r), `no row for ${label} — the list did not render a state this check exists to read`)
}
const searchRow = (key, date) => L.find((r) => r.kind === 'search' && r.name === `${PRODUCT_NAME[key]} · ${date}`)
const queuedSearch = searchRow('multi-country-focus-search', '2026-09-16')
const latestSearch = searchRow('global-preliminary-search', '2026-09-02')
const olderSearch = searchRow('knockout-search', '2026-08-21')
ok(Boolean(queuedSearch && latestSearch && olderSearch), `the three searches under AQUAPLUS are not all listed: ${L.filter((r) => r.kind === 'search').map((r) => r.name).join(' | ')}`)

// Columns: every row carries exactly the header's cells, so nothing lands under the wrong column.
// The sort button's text carries its arrow and a screen-reader phrase; the column's name is what precedes them.
const headNames = short.headText.filter(Boolean).map((t) => t.replace(/[↑↓]?,\s*(not sorted|sorted ascending|sorted descending)$/, '').trim())
ok(JSON.stringify(headNames) === JSON.stringify(['Name', 'Status', 'Risk', 'Updated']), `the named columns are ${JSON.stringify(headNames)}`)
for (const r of L) ok(r.cells === short.headText.length, `${r.kind} row "${r.name}" has ${r.cells} cells against ${short.headText.length} columns`)

// The expand control only where a name has earlier searches, and on a group.
if (plus && group && aster && coral && tide && max) {
  ok(plus.twisty && group.twisty && venzy?.twisty, 'a threaded name or a group lost its expand control')
  ok(!aster.twisty && !coral.twisty && !tide.twisty && !max.twisty, 'a name with one search still draws an expand control')

  // A name with a search waiting: status, ring, the latest report's band with its date, today's date.
  ok(plus.status === 'Queued · 1 search', `AQUAPLUS reads "${plus.status}", not "Queued · 1 search"`)
  ok(/\bqueued\b/.test(plus.dot?.cls ?? ''), `AQUAPLUS's status dot is not the queued ring: ${plus.dot?.cls}`)
  ok(plus.risk.startsWith('Medium') && plus.risk.endsWith('latest report · 2026-09-02'), `AQUAPLUS's risk cell reads "${plus.risk}"`)
  ok(plus.updated === '2026-09-16', `AQUAPLUS's Updated reads "${plus.updated}" — a name whose newest search is queued shows the day it was queued`)
  ok(plus.nameCell.includes('3 searches') && plus.nameCell.includes('was Severe'), `AQUAPLUS's name cell reads "${plus.nameCell}"`)
  ok(plus.open?.text === 'Open latest report', `AQUAPLUS's button reads "${plus.open?.text}"`)

  // The searches under it.
  if (queuedSearch && latestSearch && olderSearch) {
    ok(queuedSearch.status === 'Queued' && queuedSearch.risk === '—' && !queuedSearch.open && queuedSearch.menu,
      `the queued search reads status "${queuedSearch.status}", risk "${queuedSearch.risk}", open ${JSON.stringify(queuedSearch.open)}, menu ${queuedSearch.menu}`)
    ok(latestSearch.nameCell.includes('Latest report') && latestSearch.open?.text === 'Open', `the newest finished search reads "${latestSearch.nameCell}" with ${JSON.stringify(latestSearch.open)}`)
    ok(!olderSearch.nameCell.includes('Latest report') && olderSearch.open?.text === 'Open', `the older search reads "${olderSearch.nameCell}"`)
    ok(queuedSearch.rules === 2, `a search under a grouped name draws ${queuedSearch.rules} rule(s), not two`)
  }

  // The group: its members' waiting search, the line under its name, the band itself.
  ok(group.status === '1 search queued' && /\bqueued\b/.test(group.dot?.cls ?? ''), `the group reads "${group.status}" (${group.dot?.cls})`)
  ok(group.nameCell.includes(`Group ·`) && group.nameCell.includes('2 names') && group.nameCell.endsWith(GROUP_LINE), `the group's name cell reads "${group.nameCell}"`)
  ok(group.risk === 'Medium', `the group's risk reads "${group.risk}" — AQUAPLUS's latest report is Medium and AQUAMAX is Manageable, so the highest is Medium`)
  ok(!group.open, 'the group carries an Open — a group is several names with no single report')
  ok(max.rules === 1, `a name inside a group draws ${max.rules} rule(s), not one`)

  // Stopped, running, finished.
  ok(coral.status === `Stopped${STOPPED_LINE}` || coral.status === `Stopped ${STOPPED_LINE}`, `CORAL FREEZE reads "${coral.status}"`)
  ok(coral.risk === '—' && !coral.open, `CORAL FREEZE reads risk "${coral.risk}" with ${JSON.stringify(coral.open)}`)
  ok(tide.status.startsWith('Running') && tide.status.includes('Register sweeps'), `TIDEGLASS reads "${tide.status}"`)
  ok(tide.risk === '—' && !tide.open && tide.inert, `TIDEGLASS reads risk "${tide.risk}", open ${JSON.stringify(tide.open)}, inert ${tide.inert}`)
  ok(aster.status === 'Finished' && aster.open?.text === 'Open', `ASTERION reads "${aster.status}" with ${JSON.stringify(aster.open)}`)
}

// ASK AI: beside Open on a name with a report, alone on a stopped name, and nowhere else.
if (plus && group && aster && coral && tide && max) {
  for (const r of [plus, aster, max, venzy]) ok(r?.ask?.text === 'Ask AI' && r.ask.aria === null, `${r?.name} has no Ask AI named by its own words: ${JSON.stringify(r?.ask)}`)
  ok(coral.ask?.text === 'Ask AI' && !coral.open, `a stopped name carries Ask AI and no Open: ${JSON.stringify({ ask: coral.ask, open: coral.open })}`)
  ok(!tide.ask && !tide.open, `a running name with no report carries neither button: ${JSON.stringify({ ask: tide.ask, open: tide.open })}`)
  ok(!group.ask, 'a group carries Ask AI — a group is several names with no single report')
  ok(L.filter((r) => r.kind === 'search').every((r) => !r.ask), 'a search row carries Ask AI')
}
const askColumn = (m, width) => {
  const lefts = [...new Set((m?.listed ?? []).filter((r) => r.ask).map((r) => r.ask.left))]
  ok(lefts.length > 0 && Math.max(...lefts) - Math.min(...lefts) <= 1, `at ${width}px the Ask AI buttons start at ${lefts.join(', ')} — not one column`)
}
askColumn(short, WIDTH)
askColumn(wide, WIDE)
if (!asked || asked.fatal || asked.max?.fatal || asked.coral?.fatal) {
  fail.push(`driving Ask AI from a row: ${asked?.fatal ?? asked?.max?.fatal ?? asked?.coral?.fatal ?? 'no result'}`)
} else {
  console.log(`Ask AI from AQUAMAX: "${asked.max.head}" → ${JSON.stringify(asked.max.q)}; from CORAL FREEZE → ${JSON.stringify(asked.coral.q)}`)
  // The panel names the report the row's Open opens, and the question typed in names it too.
  ok(asked.max.head === `AQUAMAX · ${PRODUCT_NAME['full-country-search']} · searched 2026-08-28`, `AQUAMAX's panel heads "${asked.max.head}"`)
  ok(asked.max.choices.length === 4 && asked.max.goText.startsWith('Open in '), `AQUAMAX's panel: ${JSON.stringify(asked.max)}`)
  ok(/^Explain the main risks in the AQUAMAX clearance from 28 August\.$/.test(asked.max.q ?? ''), `the second question from AQUAMAX types in "${asked.max.q}"`)
  ok(asked.max.stayed && asked.coral.stayed, 'pressing Ask AI on a row went somewhere — it opens a panel, not the row')
  ok((asked.coral.head ?? '').startsWith('CORAL FREEZE · ') && (asked.coral.q ?? '').includes('CORAL FREEZE clearance from 16 September'),
    `a stopped name asks about the search that stopped: ${JSON.stringify(asked.coral)}`)
}

// Every Open in one column, at one width, named by its own words — at both widths.
const openColumn = (m, width) => {
  const opens = (m?.listed ?? []).filter((r) => r.open)
  ok(opens.length >= 6, `only ${opens.length} Open buttons at ${width}px`)
  const lefts = [...new Set(opens.map((r) => r.open.left))]
  const widths = [...new Set(opens.map((r) => r.open.width))]
  ok(Math.max(...lefts) - Math.min(...lefts) <= 1, `at ${width}px the Open buttons start at ${lefts.join(', ')} — not one column`)
  ok(Math.max(...widths) - Math.min(...widths) <= 1, `at ${width}px the Open buttons are ${widths.join(', ')}px wide — not one width`)
  ok(opens.every((r) => r.open.aria === null), 'an Open button carries an aria-label, so its accessible name is not its visible label')
  ok(opens.every((r) => !r.open.clipped), `at ${width}px an Open label is cut off: ${opens.filter((r) => r.open.clipped).map((r) => r.open.text).join(', ')}`)
  console.log(`Open column at ${width}px: x ${lefts.join('/')}, width ${widths.join('/')}px, ${opens.length} buttons`)
}
openColumn(short, WIDTH)
openColumn(wide, WIDE)

// The counts on one screen agree: the total is the sum of the headings, each heading its names.
ok(short.headings.length === 2, `expected two company headings, got ${short.headings.length}`)
for (const h of short.headings) {
  ok(h.printed === `${h.counted} ${h.counted === 1 ? 'name' : 'names'}`, `the ${h.name} heading says "${h.printed}" over ${h.counted} names`)
  ok(h.band !== 'rgba(0, 0, 0, 0)', `the ${h.name} heading has no filled band`)
}
const summed = short.headings.reduce((n, h) => n + h.counted, 0)
ok(short.namesTotal === `${summed} names`, `the table says "${short.namesTotal}" over headings holding ${summed} names`)

// Neutral status dots throughout.
for (const r of L.filter((x) => x.dot)) {
  ok(short.neutral.includes(r.dot.ink), `the status dot on "${r.name}" is ${r.dot.ink}, not one of the neutral inks ${short.neutral.join(' / ')}`)
}

// The menu holds retire and ungroup, opens, closes on Escape, and goes nowhere.
if (!menus || menus.fatal) {
  fail.push(`the row menus: ${menus?.fatal ?? 'no result'}`)
} else {
  ok(JSON.stringify(menus.plus?.items) === JSON.stringify(['Retire all 3']) && menus.plus.expanded === 'true' && menus.plus.closed, `AQUAPLUS's menu: ${JSON.stringify(menus.plus)}`)
  ok(JSON.stringify(menus.group?.items) === JSON.stringify(['Ungroup']) && menus.group.closed, `the group's menu: ${JSON.stringify(menus.group)}`)
  ok(JSON.stringify(menus.search?.items) === JSON.stringify(['Retire']) && menus.search.closed, `a search row's menu: ${JSON.stringify(menus.search)}`)
  ok(menus.groupClick.stayed && menus.groupClick.toggled, `a click on the group row: ${JSON.stringify(menus.groupClick)} — it must fold or unfold and go nowhere`)
  ok(menus.inertClick.found && menus.inertClick.stayed, `a click on a running name with no report went somewhere: ${JSON.stringify(menus.inertClick)}`)
}
ok(rowOpens?.path === '/portal/result/tmpd-other', `a click on a name with one search went to ${rowOpens?.path ?? rowOpens?.fatal} — it opens that search's report`)

if (shotDir) console.log(`evidence: ${JSON.stringify(evidence)}`)

if (fail.length) {
  console.error(`\nclearances-render-check FAILED (${fail.length}):`)
  for (const f of fail) console.error(`  • ${f}`)
  process.exit(1)
}
console.log('clearances-render-check: columns hold, reads are in the grid, the date fits, nothing overflows')
