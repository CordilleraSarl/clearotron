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
// THE FULL LIST, as a served portal draws it: twenty-five finished names across two companies, every one
// carrying Open latest report, Ask AI and its menu, some with long marks and the longest risk words the
// ladders print. The stub rows above prove behaviour; they are too few and too short to prove the layout,
// and a layout that fitted them regressed on the real list at 1440px while this file stayed green.
let fullList = false
// A READER WITHOUT CURATION RIGHTS, and A LIST LONGER THAN ONE PAGE: the last two cases the issue's own
// verification names.
let readerMode = false
let pagedList = false
let rosterMode = 'ok'
let withGeneric = false
// INVENTED, EVERY ONE, and coined rather than borrowed. This list first held names taken from runs, one of
// them a delivered client's; a fixture that proves a layout needs the LENGTHS of real names, never the
// names. Each slot keeps the length and the one-or-two-word shape of the name it replaces, which is what
// the fit and mid-word measures below read.
const FULL_MARKS = ['QUELVARIN TOSSEK', 'MIRTAVO KELDRA', 'VOSSERIN PALDOCHEX', 'TREVASKUL', 'OMBRELI VASK', 'ZELVORAN',
  'KORVITHE', 'SALMERQUE', 'DUNBRAVEL', 'PLOVENK', 'ASKERWYNE', 'TOL MAVERS', 'ZINDRA POLM', 'KALVEN MOSS', 'BREVANO TISSEL',
  'FENWALD URIX', 'MORVELLA QIN', 'TASKOVER BLYN', 'ULDERON PASKE', 'GRAVELTON OSKE', 'VEXLI CORVA', 'PANDREL WISKO',
  'SORVANE TILK', 'ZELMORA DRAVIKEN', 'QUANDERY VELT']
const FULL_BANDS = [['No rated conflicts', 'minimal'], ['Manageable', 'low'], ['Clear to file', 'minimal'], ['Medium', 'medium'], ['Severe', 'severe']]
const FULL_RUNS = () => FULL_MARKS.map((m, i) => run({
  runId: `full-${i}`, account: i % 2 ? KEY2 : KEY, markName: m, title: m, date: `2026-09-${String(18 - (i % 17)).padStart(2, '0')}`,
  issuedAt: `2026-09-${String(18 - (i % 17)).padStart(2, '0')}T09:00:00Z`, band: FULL_BANDS[i % FULL_BANDS.length][0],
  tone: FULL_BANDS[i % FULL_BANDS.length][1], product: ['global-preliminary-search', 'multi-country-focus-search', 'full-country-search'][i % 3],
}))
// SEVENTY-FIVE NAMES across two companies, every company more than half a page: whichever company sorts
// first, the second one runs across the break between page one and page two.
const PAGED_RUNS = () => ['', ' II', ' III'].flatMap((suffix, k) => FULL_MARKS.map((m, i) => run({
  runId: `paged-${k}-${i}`, account: (k * FULL_MARKS.length + i) % 2 ? KEY2 : KEY, markName: `${m}${suffix}`, title: `${m}${suffix}`,
  date: '2026-09-10', issuedAt: '2026-09-10T09:00:00Z', band: 'Manageable', tone: 'low', product: 'global-preliminary-search',
})))

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
    reason: 'invalid_file:clearance-search/tmpe2er1-vibrante-frostplum/2026-08-02-fixture/common-law-findings.half-b.md:connotation_undisposed:VIBRANTE FROSTPLUM urban dictionary,FROSTPLUM meaning slang,FR',
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
// THE RETIRED TAB'S LIST: one finished search and one failed one, which restores back to Failed. And the
// writes the dialogs send, recorded so a pass can say what was asked of the server.
const RETIRED = () => [
  run({ runId: 'tmpr-retired-1', markName: 'HALCYON', title: 'HALCYON', date: '2026-07-30', band: 'Manageable', product: 'knockout-search' }),
  run({ runId: 'tmpr-retired-2', markName: 'GLASSWING', title: 'GLASSWING', date: '2026-07-29', state: 'failed', band: null, tone: null, report: null, reason: 'The register did not answer in time.', product: 'global-preliminary-search' }),
]
const writes = []
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
  // In the roster passes the install carries its organisation's Generic, as a real one does: that is the one
  // company left when the roster fails, and what a failed roster used to narrow every screen to.
  if (p === '/portal/api/me') return json(res, { email: 'manager@example-firm.com', permissions: { run: true, manage: !readerMode }, access: [{ kind: 'everything' }], accounts: '*', accountNames: {}, allowance: null, brand: 'Northwind Group',
    ...(withGeneric ? { genericOrgs: ['northwind'], organisations: [{ key: 'northwind', name: 'Northwind Group' }] } : {}) })
  // THE ROSTER, as the server answers it in three shapes: whole, with a company file it could not read, and
  // failed. The last two used to draw exactly like the first with fewer companies.
  if (p === '/portal/admin/roster' && rosterMode === 'fail') { res.writeHead(500, { 'content-type': 'application/json' }); return res.end('{"error":"store unreadable"}') }
  if (p === '/portal/admin/roster' && rosterMode === 'unreadable') return json(res, { customers: [{ key: KEY, name: NAME }], unreadable: [{ key: 'petcary', reason: 'frameworkPath must be a path of the form …' }] })
  if (p === '/portal/admin/roster') return json(res, { customers: [{ key: KEY, name: NAME }, { key: KEY2, name: NAME2 }] })
  if ((p === '/portal/admin/families' || p === '/portal/admin/retired') && req.method === 'POST') {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => { writes.push({ path: p, body: (() => { try { return JSON.parse(body) } catch { return body } })() }); json(res, { ok: true }) })
    return
  }
  if (p === '/portal/admin/retired') return json(res, { runs: RETIRED() })
  if (p === '/portal/admin/families') return json(res, FAMILIES)
  if (p === '/portal/api/usage') return json(res, usageNow)
  if (p === '/portal/api/runs') return json(res, { runs: pagedList ? PAGED_RUNS() : fullList ? FULL_RUNS() : RUNS() })
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
  // THE DATE SITS UNDER A FINISHED NAME'S STATUS now (board Clearances, approved 2026-11-25), so its lines
  // are read there; there is no Updated column. Kept as an index of -1 so the rows' cell count still matches.
  const updatedIdx = -1;
  const dateCells = [...table.querySelectorAll('tbody tr.row')].map(tr => tr.querySelector('.clr-td-status .nowrap-date')).filter(Boolean);
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
    // THE TAGS UNDER THE NAME: what they read, what they say on hover, and where they sit. They belong on a
    // line of their own below the name and inside the Name cell, wrapping there rather than widening it.
    // THE SEARCH THE ROW SPEAKS FOR, in words under the name (board Clearances), where tags used to sit.
    const tagLine = td.querySelector(':scope > .sub');
    const tags = tagLine && (tagLine.textContent || '').trim() ? [{ text: (tagLine.textContent || '').trim(), title: '' }] : [];
    const nb = b.getBoundingClientRect(), tb = tagLine ? tagLine.getBoundingClientRect() : null, cb = td.getBoundingClientRect();
    return {
      text: (b.textContent || '').trim(), lines: Math.max(1, Math.round(nb.height / lh)),
      tags, tagsBelowName: tb ? tb.top >= nb.bottom - 1 : null, tagsInsideCell: tb ? tb.left >= cb.left - 1 && tb.right <= cb.right + 1 : null,
    };
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
    .map(tr => { const b = tr.querySelector('b.clr-search-name'); const d = tr.querySelector('.clr-td-name .sub .nowrap-date'); return b ? (b.textContent || '').trim() + (d ? ' · ' + (d.textContent || '').trim() : '') : '' })
    .filter(Boolean);

  // ── the rows, as a reader meets them ──────────────────────────────────────────────────────────────
  const txt = (el) => (el ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : '');
  const statusIdx = headText.findIndex(t => /^STATUS/i.test(t));
  const riskIdx = headText.findIndex(t => /^RISK/i.test(t));
  const actionsIdx = head.findIndex(h => h.classList.contains('col-actions-head'));
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
    const date = nameCell ? nameCell.querySelector('.sub .nowrap-date') : null;
    const isSearch = tr.classList.contains('read-row');
    return {
      kind: isSearch ? 'search' : (nameCell && nameCell.querySelector('.clr-family-icon') ? 'group' : 'name'),
      name: isSearch ? txt(b) + (date ? ' · ' + txt(date) : '') : txt(b),
      nameCell: txt(nameCell),
      cells: cells.length,
      twisty: Boolean(tr.querySelector('button.twisty')),
      status: txt(cells[statusIdx]),
      dot: dot ? { cls: dot.className, ink: dcs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? dcs.backgroundColor : dcs.borderTopColor } : null,
      // AS SHOWN: the phone's "Risk" is in the cell but not drawn at a desktop width.
      risk: cells[riskIdx] ? (cells[riskIdx].innerText || '').replace(/\\s+/g, ' ').trim() : '',
      updated: txt(tr.querySelector('.clr-td-status .nowrap-date')),
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
  const namesTotal = txt(document.querySelector('.clr-title-count')) || null;
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

// A NARROW WIDTH IS ONLY NARROW UNDER MOBILE EMULATION. `setDeviceMetricsOverride` with `mobile: false`
// does not take the page below the browser's own minimum: asked for 400 this reported
// `document.documentElement.clientWidth === 500`, and every line it printed said 400. The breakpoint it
// is aimed at is 560px so the defect still showed, but a check that names a width it is not measuring is
// one repair away from proving something about a width nobody ships. `mobile: width < 700` is what
// settings-render-check already does for the People screen at 400, and the two now agree.

// ── chrome ──────────────────────────────────────────────────────────────────────────────────────────

// The profile goes inside a run root whose TMPDIR the browser inherits, so the singleton
// lock it writes there leaves with the root instead of accumulating in the shared one.
const { profile: userDir, env: chromeEnv, keep: keepRoot } = browserRun("clearances-check-")
// --keep means LEAVE THE PROFILE: take the run root out of the exit sweep, or the flag
// would go on reading as working while the directory it promises is removed anyway.
if (keep) keepRoot()
// NO NETWORK, deliberately. The portal's typeface is its own file, served by the portal under test, so it
// arrives here exactly as it does for a reader; anything that reached for another host would fail here
// as it would on a machine with no network. This check was first written when the font came from a font
// service CI could not reach, and a table measured in the fallback face wrapped where the real one did not.
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
  chrome.stderr.setEncoding("utf8");
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
await reload()

// ── THE BOARD'S DIALOGS AND THE RETIRED TAB (Clearances, approved 2026-11-25) ─────────────────────────────
// Each change asks in the product's own dialog, names what it affects, and gives focus back to the control
// that asked when it closes. Driven as a reader drives them; Escape and Cancel change nothing.
const BOARD = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const txt = (el) => (el ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : '');
  const out = {};
  for (let i = 0; i < 3; i++) { for (const b of document.querySelectorAll('table.data button.twisty[aria-expanded="false"]')) { b.click(); await sleep(60); } await sleep(200); }
  const menuOf = async (label) => { const b = document.querySelector('button[aria-label="' + label + '"]'); if (!b) return null; b.click(); await sleep(150); return [...document.querySelectorAll('[role="menuitem"]')]; };
  const dialog = () => document.querySelector('.modal-scrim[role="dialog"]');
  const esc = async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(150); };
  // Retire all of a name's searches.
  const items = await menuOf('More actions for AQUAPLUS');
  const retireAll = items && items.find(i => /^Retire all 3 searches…$/.test(txt(i)));
  if (!retireAll) return { fatal: 'AQUAPLUS has no "Retire all 3 searches…"' };
  retireAll.click(); await sleep(200);
  out.retireAll = { title: txt(dialog()?.querySelector('h2')), body: txt(dialog()?.querySelector('.clr-dialog-body p')), confirm: txt(dialog()?.querySelector('.clr-dialog-confirm')), focusIn: Boolean(document.activeElement && document.activeElement.closest('.modal-scrim')) };
  await esc();
  out.retireAll.closed = !dialog();
  out.retireAll.focusBack = document.activeElement?.getAttribute('aria-label') || null;
  // Ungroup a family.
  const fItems = await menuOf('More actions for Aqua line');
  const ungroup = fItems && fItems.find(i => txt(i) === 'Ungroup family…');
  if (!ungroup) return { ...out, fatal: 'the family has no "Ungroup family…"' };
  ungroup.click(); await sleep(200);
  out.ungroup = { title: txt(dialog()?.querySelector('h2')), body: txt(dialog()?.querySelector('.clr-dialog-body p')), confirm: txt(dialog()?.querySelector('.clr-dialog-confirm')) };
  [...dialog().querySelectorAll('button')].find(b => txt(b) === 'Cancel')?.click(); await sleep(150);
  out.ungroup.closed = !dialog();
  // Group names: each refusal in its words, then nothing saved.
  const groupBtn = [...document.querySelectorAll('button')].find(b => txt(b) === 'Group names');
  if (!groupBtn) return { ...out, fatal: 'no "Group names" on the page' };
  groupBtn.click(); await sleep(200);
  const d = dialog();
  const save = () => [...d.querySelectorAll('button')].find(b => txt(b) === 'Save family');
  const problem = () => txt(d.querySelector('[role="alert"]'));
  const nameBox = () => [...d.querySelectorAll('label.clr-field')].find(l => /Family name/.test(l.textContent || ''))?.querySelector('input');
  const setName = (v) => { const el = nameBox(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
  out.group = { title: txt(d.querySelector('h2')), legend: txt(d.querySelector('legend')), hint: txt(d.querySelector('.clr-dialog-body > p.clr-quiet')), problems: [] };
  save().click(); await sleep(120); out.group.problems.push(problem());
  // The family's own company, where a family of that name already exists.
  const companySelect = [...d.querySelectorAll('label.clr-field')].find(l => /Company/.test(l.textContent || ''))?.querySelector('select');
  if (companySelect) { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(companySelect, '${KEY}'); companySelect.dispatchEvent(new Event('change', { bubbles: true })); await sleep(120); }
  setName('${FAMILY_NAME}'); await sleep(80); save().click(); await sleep(120); out.group.problems.push(problem());
  setName('Spring launch'); await sleep(80);
  const boxes = [...d.querySelectorAll('.clr-names input[type=checkbox]')];
  out.group.names = boxes.length;
  if (boxes[0]) { boxes[0].click(); await sleep(80); }
  save().click(); await sleep(120); out.group.problems.push(problem());
  await esc();
  out.group.closed = !dialog();
  // The Retired tab: individual searches, each with Restore; a failed one goes back to Failed.
  const tab = [...document.querySelectorAll('.clr-tab')].find(t => /^Retired/.test(txt(t)));
  out.retiredTab = txt(tab);
  tab?.click(); await sleep(300);
  out.retiredRows = [...document.querySelectorAll('table.data tbody tr.row')].map(tr => txt(tr.querySelector('b')));
  const restore = [...document.querySelectorAll('table.data tbody tr.row')].find(tr => /GLASSWING/.test(tr.textContent || ''))?.querySelector('button');
  restore?.click(); await sleep(400);
  out.restoreNote = txt(document.querySelector('.clr-note'));
  return out;
})()`
const board = await value(BOARD)
await reload()

// ASK AI FROM A NAME, driven: the panel names the report, the second question is chosen, and the link the
// assistant opens carries that question typed in. window.open is caught rather than followed.
const ASK = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const txt = (el) => (el ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : '');
  const opened = [];
  window.open = (u) => { opened.push(String(u)); return null; };
  // The family opened first, as a reader would, so the names inside it are on screen.
  for (let i = 0; i < 3; i++) { for (const b of document.querySelectorAll('table.data button.twisty[aria-expanded="false"]')) { b.click(); await sleep(60); } await sleep(200); }
  const rowOf = (name) => [...document.querySelectorAll('table.data tbody tr.row')].find(tr => txt(tr.querySelector('b')) === name);
  // FROM THE ROW'S MENU, which is where the control lives now: open the menu, press its Ask AI entry.
  const drive = async (name) => {
    const tr = rowOf(name);
    const more = tr && tr.querySelector('button.row-menu-btn');
    if (!more) return { fatal: 'no row menu on ' + name };
    const before = location.pathname;
    more.click(); await sleep(200);
    const entry = [...tr.querySelectorAll('[role=menu] [role=menuitem]')].find(i => txt(i) === 'Ask AI');
    if (!entry) return { fatal: 'no Ask AI entry in the menu of ' + name };
    entry.click(); await sleep(250);
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

// — THE LEVEL FILTER, pressed as a reader presses it. It narrows the SEARCHES before they are grouped into
// names, so a name keeps only its searches of that kind and speaks for them alone. VENZY's knockout came back
// Medium and its later preliminary Manageable: under All the row shows Manageable, under KO it must show
// Medium, and it must never show the preliminary's risk beside a KO filter.
const LEVEL = `(async () => {
  // THE SEARCH TYPE IS CHOSEN IN FILTERS now (board Clearances, approved 2026-11-25), opened as a reader opens it.
  const filtersBtn = document.querySelector('button.clr-filters-btn');
  if (!filtersBtn) return { fatal: 'no Filters control on the page' };
  if (filtersBtn.getAttribute('aria-expanded') !== 'true') { filtersBtn.click(); await new Promise(r => setTimeout(r, 250)); }
  const select = [...document.querySelectorAll('#clr-filters label.clr-filter')].find(l => /Search type/.test(l.textContent || ''))?.querySelector('select');
  if (!select) return { fatal: 'no "Search type" choice in Filters' };
  const heads = [...document.querySelectorAll('table.data thead th')].map(th => (th.textContent || '').trim());
  const riskIdx = heads.findIndex(h => /^RISK/i.test(h));
  const rowsNow = () => [...document.querySelectorAll('table.data tbody tr.row')].filter(tr => !tr.querySelector('.clr-family-icon')).map(tr => {
    const b = tr.querySelector('b');
    const line = tr.querySelector('.clr-td-name > .sub');
    return {
      name: b ? (b.textContent || '').trim() : '',
      tags: line && (line.textContent || '').trim() ? [(line.textContent || '').trim()] : [],
      risk: riskIdx >= 0 && tr.children[riskIdx] ? (tr.children[riskIdx].textContent || '').trim() : null,
      open: tr.querySelector('button.row-open')?.getAttribute('aria-label') || null,
    };
  });
  const empty = () => /No names match this view/.test(document.querySelector('table.data tbody')?.textContent || '');
  const buttons = () => [...select.options].map(o => ({ text: (o.textContent || '').trim(), title: o.value, pressed: o.selected }));
  const openAll = async () => {
    for (let pass = 0; pass < 3; pass++) {
      const shut = [...document.querySelectorAll('table.data button.twisty[aria-expanded="false"]')];
      if (!shut.length) break;
      for (const t of shut) { t.click(); await new Promise(r => setTimeout(r, 60)); }
      await new Promise(r => setTimeout(r, 250));
    }
  };
  const press = async (value) => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    await openAll();
    return select.value === value;
  };
  const before = buttons();
  const pressedKo = await press('knockout-search');
  const ko = { rows: rowsNow(), empty: empty(), buttons: buttons(), chips: [...document.querySelectorAll('.clr-chip')].map(c => (c.textContent || '').replace(/\\s+/g, ' ').trim()) };
  const pressedFull = await press('full-country-search');
  const full = { rows: rowsNow(), empty: empty() };
  const pressedAll = await press('all');
  const all = { rows: rowsNow(), empty: empty(), buttons: buttons() };
  return { riskIdx, before, pressed: pressedKo && pressedFull && pressedAll, ko, full, all };
})()`
const levels = await value(LEVEL)
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
  // Group by company sits in Filters now (board Clearances, approved 2026-11-25): opened first.
  const fb = document.querySelector('button.clr-filters-btn');
  if (fb && fb.getAttribute('aria-expanded') !== 'true') { fb.click(); await new Promise(r => setTimeout(r, 250)); }
  const box = [...document.querySelectorAll('label.group-toggle input[type=checkbox]')][0];
  if (!box) return { fatal: 'no grouping toggle in Filters — is there more than one company in view?' };
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
await value(`(async () => { const fb = document.querySelector('button.clr-filters-btn'); if (fb && fb.getAttribute('aria-expanded') !== 'true') { fb.click(); await new Promise(r => setTimeout(r, 250)); } const b = document.querySelector('label.group-toggle input'); if (b && !b.checked) { b.click(); await new Promise(r => setTimeout(r, 300)); } return true })()`)

// The drift probe: the SAME page with one run title made much longer. its own acceptance test —
// "lengthen a run title in the fixture data and nothing except that title moves".
longTitle = true
await reload()
const long = await value(MEASURE)
longTitle = false

// — THE FULL LIST, at the wide desktop and at the width the COLLAPSE ruling was for. Read off the drawn
// page: does the page scroll sideways, does the table leave its box, is any row's menu cut off at the
// edge, and does any risk word run into the date beside it.
const FULL = `(() => {
  const wrap = document.querySelector('.table-wrap') || document.querySelector('table.data').parentElement;
  const table = document.querySelector('table.data');
  const w = wrap.getBoundingClientRect();
  const head = [...table.querySelectorAll('thead th')].map(t => (t.textContent || '').trim());
  const ri = head.findIndex(t => /^Risk/i.test(t)), ui = head.findIndex(t => /^Updated/i.test(t));
  const textBox = (el) => { if (!el) return null; const r = document.createRange(); r.selectNodeContents(el); const b = r.getBoundingClientRect(); return b.width ? b : null; };
  const rows = [...table.querySelectorAll('tbody tr.row')];
  // ANY CELL'S TEXT RUNNING INTO THE NEXT, on every row that draws them — names, groups and searches —
  // Status into Risk and Risk into Updated. Measured on the text itself, not on the cells, which cannot overlap.
  const si = head.findIndex(t => /^Status/i.test(t));
  const collide = [];
  for (const tr of table.querySelectorAll('tbody tr')) {
    if (tr.children.length !== head.length) continue;
    for (const [a, b] of [[si, ri], [ri, ui]]) {
      const x = textBox(tr.children[a]), y = textBox(tr.children[b]);
      if (x && y && x.right > y.left - 2 && x.top < y.bottom && y.top < x.bottom) {
        collide.push(((tr.querySelector('b') || tr.children[2] || {}).textContent || '').trim().slice(0, 40) + ' (' + head[a] + ' into ' + head[b] + ')');
      }
    }
  }
  // A RISK WORD NEVER BREAKS INSIDE ITSELF. A phrase may wrap between its words; a single word drawn on two
  // lines ("Managea" over "ble") is a word the reader has to reassemble.
  const midWord = [];
  for (const tr of rows) {
    const label = tr.children[ri] && tr.children[ri].querySelector('.risk-dot > span:last-child');
    if (!label) continue;
    const words = (label.textContent || '').trim().split(/\\s+/);
    const r = document.createRange();
    for (const node of label.childNodes) {
      if (node.nodeType !== 3) continue;
      let at = 0;
      for (const w of (node.textContent || '').split(/(\\s+)/)) {
        if (w && !/^\\s+$/.test(w)) {
          r.setStart(node, at); r.setEnd(node, at + w.length);
          if (r.getClientRects().length > 1) midWord.push(w);
        }
        at += w.length;
      }
    }
  }
  // NOR DOES A WORD IN THE NAME OR STATUS CELL: on a phone card those share a line with the risk and the
  // report button, and a squeezed cell drew "Finished" as "Finishe" over "d".
  const cellMidWord = [];
  for (const td of table.querySelectorAll('td.clr-td-name, td.clr-td-status')) {
    const walk = document.createTreeWalker(td, NodeFilter.SHOW_TEXT);
    const r = document.createRange();
    for (let node = walk.nextNode(); node; node = walk.nextNode()) {
      let at = 0;
      for (const w of (node.textContent || '').split(/(\\s+)/)) {
        if (w && !/^\\s+$/.test(w)) {
          r.setStart(node, at); r.setEnd(node, at + w.length);
          if ([...r.getClientRects()].filter(x => x.width > 0).length > 1) cellMidWord.push(w);
        }
        at += w.length;
      }
    }
  }
  const cut = [...table.querySelectorAll('button.row-menu-btn')].filter(b => b.getBoundingClientRect().right > Math.min(w.right, document.documentElement.clientWidth) + 1).length;
  return { rows: rows.length, docOverflowsX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth,
    tableOverflows: table.getBoundingClientRect().width > w.width + 1, tableW: Math.round(table.getBoundingClientRect().width), wrapW: Math.round(w.width),
    menusCut: cut, riskOverDate: collide, riskMidWord: [...new Set(midWord)], cellMidWord: [...new Set(cellMidWord)],
    riskCell: (() => { const td = rows[0] && rows[0].children[ri]; if (!td) return null; const cs = getComputedStyle(td);
      return Math.round(td.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)); })() };
})()`
fullList = true
const full = {}
for (const width of [WIDE, 700]) {
  await cmd('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false })
  await reload()
  full[width] = await value(FULL)
}
// — AT PHONE WIDTH, EACH ROW IS A CARD (board Clearances, phone, approved 2026-11-25): the name, its status,
// its risk ("Risk {band}"), its report button and its menu are all in reach without scrolling sideways.
await cmd('Emulation.setDeviceMetricsOverride', { width: 400, height: 800, deviceScaleFactor: 1, mobile: true })
await reload()
const PHONE = `(async () => {
  for (let i = 0; i < 3; i++) { for (const b of document.querySelectorAll('table.data button.twisty[aria-expanded="false"]')) { b.click(); await new Promise(r => setTimeout(r, 60)); } await new Promise(r => setTimeout(r, 200)); }
  window.scrollTo(0, 0); await new Promise(r => setTimeout(r, 200));
  const W = document.documentElement.clientWidth;
  const inside = (el) => { if (!el) return true; const r = el.getBoundingClientRect(); return r.width === 0 || (r.left >= -1 && r.right <= W + 1); };
  const rows = [...document.querySelectorAll('table.data tbody tr.row, table.data tbody tr.read-row')];
  const out = { rows: rows.length, sideways: document.documentElement.scrollWidth - W, out: [], riskWords: [], midWord: [] };
  // No word in a name or status cell drawn on two lines (the batch row drew "Finished" as "Finishe" over "d").
  for (const td of document.querySelectorAll('table.data td.clr-td-name, table.data td.clr-td-status')) {
    const walk = document.createTreeWalker(td, NodeFilter.SHOW_TEXT);
    const r = document.createRange();
    for (let node = walk.nextNode(); node; node = walk.nextNode()) {
      let at = 0;
      for (const w of (node.textContent || '').split(/(\\s+)/)) {
        if (w && !/^\\s+$/.test(w)) {
          r.setStart(node, at); r.setEnd(node, at + w.length);
          if ([...r.getClientRects()].filter(x => x.width > 0).length > 1) out.midWord.push(w);
        }
        at += w.length;
      }
    }
  }
  for (const tr of rows) {
    const parts = { name: tr.querySelector('.clr-td-name'), status: tr.querySelector('.clr-td-status'), risk: tr.querySelector('.clr-td-risk'),
      open: tr.querySelector('button.row-open'), menu: tr.querySelector('button.row-menu-btn') };
    for (const [k, el] of Object.entries(parts)) if (!inside(el)) out.out.push((tr.querySelector('b')?.textContent || '?') + ':' + k);
    const risk = parts.risk ? parts.risk.innerText.replace(/\\s+/g, ' ').trim() : '';
    if (risk && risk !== '—') out.riskWords.push(risk);
  }
  return out;
})()`
const phone = await value(PHONE)
// The stub rows at the same width: a batch of two names, a family, a name with its searches open.
fullList = false
await reload()
const phoneStub = await value(PHONE)
// The Retired tab at the same width: each search's Restore in reach, nothing scrolling sideways.
const phoneRetired = await value(`(async () => {
  [...document.querySelectorAll('.clr-tab')].find(t => /^Retired/.test((t.textContent || '').trim()))?.click();
  await new Promise(r => setTimeout(r, 400));
  const W = document.documentElement.clientWidth;
  const restore = [...document.querySelectorAll('table.data tbody button')].filter(b => (b.textContent || '').trim() === 'Restore');
  return { restores: restore.length, out: restore.filter(b => { const r = b.getBoundingClientRect(); return r.left < -1 || r.right > W + 1 }).length,
    sideways: document.documentElement.scrollWidth - W,
    wrapSideways: (() => { const w = document.querySelector('table.clr-retired-table')?.parentElement; return w ? w.scrollWidth - w.clientWidth : null })() };
})()`)
fullList = true
await cmd('Emulation.clearDeviceMetricsOverride', {})
fullList = false
// The same reading on the stub rows, which carry the shapes the full list does not — a group, a name
// with searches under it, a stopped name — opened out.
const stubs = {}
for (const width of [WIDE, 700]) {
  await cmd('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false })
  await reload()
  await value(`(async () => { for (let i = 0; i < 3; i++) { for (const b of document.querySelectorAll('table.data button.twisty[aria-expanded="false"]')) { b.click(); await new Promise(r => setTimeout(r, 60)); } await new Promise(r => setTimeout(r, 250)); } return true })()`)
  stubs[width] = await value(FULL)
}
await cmd('Emulation.clearDeviceMetricsOverride', {})
await reload()

// — THE ROSTER NOT ARRIVING WHOLE. A company file it could not read, then a roster that failed outright.
const ROSTER_NOTICE = `(() => ({
  text: [...document.querySelectorAll('.main > .notice')].map(n => (n.innerText || '').replace(/\\s+/g, ' ').trim()),
  // How many names the list draws, and which company the switcher says is in view.
  names: document.querySelectorAll('table.data tbody tr.row').length,
  inView: (() => { const s = document.querySelector('select[aria-label="Company"]'); return s ? s.selectedOptions[0]?.textContent?.trim() ?? null : null })(),
}))()`
withGeneric = true
rosterMode = 'unreadable'
await reload()
const rosterPartial = await value(ROSTER_NOTICE)
rosterMode = 'fail'
await reload()
const rosterFailed = await value(ROSTER_NOTICE)
if (shotDir) {
  const shot = await cmd('Page.captureScreenshot', { format: 'png' })
  const data = shot.result?.result?.data ?? shot.result?.data
  if (data) writeFileSync(join(shotDir, 'clearances-roster-failed-light.png'), Buffer.from(data, 'base64'))
}
rosterMode = 'ok'
await reload()
const rosterWhole = await value(ROSTER_NOTICE)
withGeneric = false

// — A READER WITHOUT CURATION RIGHTS. No "Group names", and no menu item that changes the shared list;
// Ask AI stays wherever a row carries it.
const READER = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const txt = (el) => (el ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : '');
  for (let i = 0; i < 3; i++) { for (const b of document.querySelectorAll('table.data button.twisty[aria-expanded="false"]')) { b.click(); await sleep(60); } await sleep(200); }
  const groupNames = [...document.querySelectorAll('button')].some(b => txt(b) === 'Group names');
  const items = [];
  for (const b of [...document.querySelectorAll('table.data button[aria-label^="More actions for "]')]) {
    b.click(); await sleep(120);
    items.push(...[...document.querySelectorAll('[role="menuitem"]')].map(txt));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(80);
  }
  return { groupNames, items, rows: document.querySelectorAll('table.data tbody tr.row').length };
})()`
readerMode = true
await reload()
const reader = await value(READER)
readerMode = false

// — A LIST LONGER THAN ONE PAGE. The company running across the break is named again at the top of page
// two, so its first rows there do not sit under no company at all.
const PAGED = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const txt = (el) => (el ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : '');
  const pager = document.querySelector('nav.pager[aria-label="Pages of clearances"]');
  if (!pager) return { fatal: 'no pager on a list of seventy-five names' };
  const bodyRows = () => [...document.querySelectorAll('table.data tbody tr')];
  const heads = () => bodyRows().filter(tr => tr.classList.contains('group-head')).map(tr => txt(tr.querySelector('.owner-name')));
  const one = { heads: heads(), names: bodyRows().filter(tr => tr.classList.contains('row')).length, range: txt(pager.querySelector('.mono')) };
  const next = [...pager.querySelectorAll('button')].find(b => /Next/.test(txt(b)));
  next?.click(); await sleep(300);
  const first = bodyRows()[0];
  const two = { heads: heads(), firstIsHead: Boolean(first && first.classList.contains('group-head')), names: bodyRows().filter(tr => tr.classList.contains('row')).length,
    range: txt(document.querySelector('nav.pager .mono')) };
  return { one, two };
})()`
pagedList = true
await reload()
const paged = await value(PAGED)
pagedList = false
await reload()

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
    await cmd('Emulation.setDeviceMetricsOverride', { width, height: Math.max(900, h), deviceScaleFactor: 1, mobile: width < 700 })
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
    await cmd('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 700 })
    await reload()
    await value(EXPAND([FAMILY_NAME, 'AQUAPLUS']))
    await both(`clearances-rows-${width}`, width)
  }
  // The board's other frames, one state each, at both widths: Filters open, a name's menu, the retire and
  // grouping dialogs, and the Retired tab.
  const STATE = {
    filters: `(async () => { document.querySelector('button.clr-filters-btn')?.click(); await new Promise(r => setTimeout(r, 250)); return true })()`,
    menu: `(async () => { document.querySelector('button[aria-label="More actions for AQUAPLUS"]')?.click(); await new Promise(r => setTimeout(r, 250)); return true })()`,
    retire: `(async () => { document.querySelector('button[aria-label="More actions for AQUAPLUS"]')?.click(); await new Promise(r => setTimeout(r, 200));
      [...document.querySelectorAll('[role="menuitem"]')].find(i => /^Retire all/.test(i.textContent || ''))?.click(); await new Promise(r => setTimeout(r, 250)); return true })()`,
    grouping: `(async () => { [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === 'Group names')?.click(); await new Promise(r => setTimeout(r, 250)); return true })()`,
    retired: `(async () => { [...document.querySelectorAll('.clr-tab')].find(t => /^Retired/.test((t.textContent || '').trim()))?.click(); await new Promise(r => setTimeout(r, 400)); return true })()`,
  }
  for (const width of [WIDE, WIDTH]) {
    for (const [state, script] of Object.entries(STATE)) {
      await cmd('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 700 })
      await reload()
      await value(EXPAND([FAMILY_NAME, 'AQUAPLUS']))
      await value(script)
      await capture(`clearances-${state}-${width}-light.png`, width)
    }
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
console.log(`phone-width cards: ${JSON.stringify(phone)}`)
ok(phone && phone.rows > 0, `at 400px no row was read — ${JSON.stringify(phone)}`)
ok(phone && phone.sideways <= 1, `at 400px the page scrolls sideways by ${phone?.sideways}px`)
ok(phone && phone.out.length === 0, `at 400px part of a row is off the screen: ${JSON.stringify(phone?.out)}`)
ok(phone && phone.midWord.length === 0, `at 400px a word in a name or status breaks inside itself: ${JSON.stringify(phone?.midWord)}`)
ok(phoneStub && phoneStub.rows > 0 && phoneStub.out.length === 0 && phoneStub.sideways <= 1, `at 400px a stub row is off the screen: ${JSON.stringify(phoneStub)}`)
ok(phoneRetired && phoneRetired.restores === 2 && phoneRetired.out === 0 && phoneRetired.sideways <= 1 && phoneRetired.wrapSideways !== null && phoneRetired.wrapSideways <= 1,
  `at 400px the Retired tab does not keep Restore in reach: ${JSON.stringify(phoneRetired)}`)
ok(phoneStub && phoneStub.midWord.length === 0, `at 400px a word in a stub row's name or status breaks inside itself: ${JSON.stringify(phoneStub?.midWord)}`)
ok(phone && phone.riskWords.length > 0 && phone.riskWords.every((w) => w.startsWith('Risk ')), `at 400px a risk does not read "Risk {band}": ${JSON.stringify(phone?.riskWords)}`)
for (const [width, f] of Object.entries(stubs)) {
  ok(f && f.riskOverDate.length === 0, `stub rows at ${width}px: text runs into the next cell on ${JSON.stringify(f?.riskOverDate)}`)
  ok(f && f.riskMidWord.length === 0, `stub rows at ${width}px: a risk word breaks inside itself — ${JSON.stringify(f?.riskMidWord)}`)
  ok(f && f.cellMidWord.length === 0, `stub rows at ${width}px: a word in a name or status breaks inside itself — ${JSON.stringify(f?.cellMidWord)}`)
}
ok(rosterPartial?.text?.some((t) => /petcary This company’s framework could not be read\. This needs an administrator to look at it\./.test(t)),
  `a company file the roster could not read is not named on the page — ${JSON.stringify(rosterPartial)}`)
ok(!rosterPartial?.text?.some((t) => /frameworkPath/.test(t)), 'the server\'s own reason reached the page')
// A ROSTER THAT FAILED WHOLE: no sentence of its own (owner, 2026-09-18), and no silent narrowing — the
// reader stays on All companies and sees every name the whole roster showed.
ok(rosterFailed?.text?.length === 0, `a roster that failed draws a notice of its own — ${JSON.stringify(rosterFailed)}`)
ok(rosterFailed?.names > 0 && rosterFailed?.names === rosterWhole?.names,
  `a roster that failed narrows the list: ${rosterFailed?.names} names against ${rosterWhole?.names} with the roster whole`)
ok(/^All companies/.test(rosterFailed?.inView ?? ''), `a roster that failed selected a company for the reader — ${JSON.stringify(rosterFailed?.inView)}`)
ok(rosterWhole?.text?.length === 0, `a whole roster draws a notice — ${JSON.stringify(rosterWhole)}`)
for (const [width, f] of Object.entries(full)) {
  console.log(`full list at ${width}px: ${f?.rows} rows, page ${f?.scrollW}/${f?.clientW}, table ${f?.tableW} in ${f?.wrapW}, menus cut ${f?.menusCut}, risk over date ${JSON.stringify(f?.riskOverDate)}`)
  ok(f && f.rows === 25, `full list at ${width}px: ${f?.rows} rows drew, not 25`)
  ok(f && !f.docOverflowsX, `full list at ${width}px: the page scrolls sideways (${f?.scrollW} in ${f?.clientW})`)
  ok(f && !f.tableOverflows, `full list at ${width}px: the table (${f?.tableW}px) leaves its box (${f?.wrapW}px)`)
  ok(f && f.menusCut === 0, `full list at ${width}px: ${f?.menusCut} row menu(s) cut off at the edge`)
  ok(f && f.riskOverDate.length === 0, `full list at ${width}px: the risk word runs into the date on ${JSON.stringify(f?.riskOverDate)}`)
  ok(f && f.riskMidWord.length === 0, `full list at ${width}px: a risk word breaks inside itself — ${JSON.stringify(f?.riskMidWord)} in a ${f?.riskCell}px cell`)
  ok(f && f.cellMidWord.length === 0, `full list at ${width}px: a word in a name or status breaks inside itself — ${JSON.stringify(f?.cellMidWord)}`)
}
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
// BELOW 700px EACH ROW IS A CARD (board Clearances, phone, approved 2026-11-25): there is no grid to line
// up, so the grid's assertions are asked at table widths only, and the card probe answers for the phone.
const CARDS = WIDTH < 700

// — the grid is declared, and the reads are in it.
if (!CARDS) ok(short.tableLayout === (narrow ? 'auto' : 'fixed'),
  narrow
    ? `at ${WIDTH}px the table is still fixed-layout — its columns are slivers, not something a reader can scroll`
    : `the table is not fixed-layout (got ${short.tableLayout}) — its columns are still decided by their content`)
ok(short.readRows > 0, 'no expanded read rows were found — the rows did not open, or a read is still a spanning panel')
for (const [i, r] of (CARDS ? [] : short.reads).entries()) {
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
// — THE SEARCH UNDER EACH NAME, in words (board Clearances, approved 2026-11-25): the search the row speaks
// for, on a line of its own under the name and inside the Name cell. The fixture's own searches decide it.
const TAGS_EXPECTED = {
  VENZY: [[PRODUCT_NAME['global-preliminary-search'], '']],
  AQUAPLUS: [[PRODUCT_NAME['multi-country-focus-search'], '']],
  AQUAMAX: [[PRODUCT_NAME['full-country-search'], '']],
}
for (const [name, want] of Object.entries(TAGS_EXPECTED)) {
  const row = (short.nameLines ?? []).find((n) => n.text === name)
  ok(row, `the name ${name} is not on the list at ${WIDTH}px, so its search line could not be read`)
  if (!row) continue
  ok(JSON.stringify(row.tags.map((g) => [g.text, g.title])) === JSON.stringify(want),
    `${name} reads the search ${JSON.stringify(row.tags)} at ${WIDTH}px, not ${JSON.stringify(want)}`)
  ok(row.tagsBelowName === true, `${name}'s search line shares the name's line at ${WIDTH}px rather than sitting under it`)
  ok(row.tagsInsideCell === true, `${name}'s search line runs out of the Name cell at ${WIDTH}px`)
}
ok(levels && !levels.fatal, `the level filter could not be driven: ${levels?.fatal ?? 'no answer from the page'}`)
if (levels && !levels.fatal) {
  ok(JSON.stringify(levels.before.map((x) => x.text)) === JSON.stringify(['All search types', 'Knockout search', 'Global preliminary search', 'Multi-country focus search', 'Full country search']),
    `the search type choice reads ${JSON.stringify(levels.before)}, not All search types and the four searches by name`)
  ok(levels.before[0]?.pressed === true && levels.before.filter((x) => x.pressed).length === 1, `on arrival the level filter does not have All alone pressed: ${JSON.stringify(levels.before)}`)
  ok(levels.pressed && levels.riskIdx >= 0, `the level filter's buttons or the Risk column could not be found (risk column ${levels.riskIdx})`)
  const byName = (rows, n) => rows.find((r) => r.name === n)
  // Under KO: only knockouts are left, VENZY speaks for its knockout, and the full search's name is gone.
  ok(levels.ko.buttons.filter((x) => x.pressed).map((x) => x.text).join() === 'Knockout search', `under KO the chosen search type is ${JSON.stringify(levels.ko.buttons)}`)
  ok(levels.ko.chips.includes('Knockout search ×'), `under KO the narrowing is not said as a chip: ${JSON.stringify(levels.ko.chips)}`)
  ok(levels.ko.rows.every((r) => !r.tags.length || r.tags.join() === 'Knockout search'), `under KO a row speaks for another kind of search: ${JSON.stringify(levels.ko.rows)}`)
  ok(/Medium/.test(byName(levels.ko.rows, 'VENZY')?.risk ?? '') && !/Manageable/.test(byName(levels.ko.rows, 'VENZY')?.risk ?? ''),
    `under KO VENZY shows ${JSON.stringify(byName(levels.ko.rows, 'VENZY'))}, not its knockout's Medium`)
  // The button beside that risk opens the same knockout, not the name's later search.
  ok((byName(levels.ko.rows, 'VENZY')?.open ?? '').includes(PRODUCT_NAME['knockout-search']),
    `under KO VENZY's report button is ${JSON.stringify(byName(levels.ko.rows, 'VENZY')?.open)}, not its knockout's`)
  ok(!byName(levels.ko.rows, 'AQUAMAX'), 'under KO a name with no knockout is still on the list')
  ok(!levels.ko.empty, 'under KO the list is empty, though the fixture holds knockouts')
  // Under Full: the one full country search, and nothing that has none.
  ok(byName(levels.full.rows, 'AQUAMAX') && !byName(levels.full.rows, 'VENZY'), `under Full the names are ${JSON.stringify(levels.full.rows.map((r) => r.name))}`)
  // Back under All: the latest search speaks for the name again.
  ok(/Manageable/.test(byName(levels.all.rows, 'VENZY')?.risk ?? ''), `back under All VENZY shows ${JSON.stringify(byName(levels.all.rows, 'VENZY'))}, not its latest search's Manageable`)
  ok(levels.all.buttons[0]?.pressed === true, 'pressing All does not press it')
}
// A card list fits its wrapper by construction, and nothing in it scrolls sideways (the card probe reads that).
ok(CARDS ? short.overflowsX === false : short.overflowsX === narrow,
  narrow && !CARDS
    ? `at ${WIDTH}px the table fits its wrapper — it collapsed into slivers instead of staying legible and being scrolled`
    : `the table overflows its wrapper at ${WIDTH}px by ${short.overflowBy}px — table ${short.tableWidth}px, min-width ${short.tableMinWidth}, columns ${JSON.stringify(short.share)}`)
ok(short.docOverflowsX === false, `the page itself scrolls horizontally at ${WIDTH}px`)

// ── what each row says and offers ───────────────────────────────────────────────────────────────────
//
// The five row states, read off the page. Every string compared here is the one the specification
// names; where the screen composes a string from data (a product name, a date), the expectation is
// composed from the same data rather than typed.
const STOPPED_LINE = 'No report will be produced. Completed work stays readable through Ask AI.'
// The family's line (board Clearances, approved 2026-11-25): its highest band and what is in progress.
const GROUP_LINE = 'Highest risk across latest reports · Medium · 1 search in progress'
ok(short.dateLines.length > 0, 'no finished name carries its date under its status — every date assertion would be a pass over nothing')
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
ok(JSON.stringify(headNames) === JSON.stringify(['Name and searches', 'Status', 'Risk', 'Report and actions']), `the named columns are ${JSON.stringify(headNames)}`)
for (const r of L) ok(r.cells === short.headText.length, `${r.kind} row "${r.name}" has ${r.cells} cells against ${short.headText.length} columns`)

// The expand control only where a name has earlier searches, and on a group.
if (plus && group && aster && coral && tide && max) {
  ok(plus.twisty && group.twisty && venzy?.twisty, 'a threaded name or a group lost its expand control')
  ok(!aster.twisty && !coral.twisty && !tide.twisty && !max.twisty, 'a name with one search still draws an expand control')

  // A name with a search waiting: status, ring, the latest report's band with its date, today's date.
  ok(plus.status === 'Queued · 1 search', `AQUAPLUS reads "${plus.status}", not "Queued · 1 search"`)
  ok(/\bqueued\b/.test(plus.dot?.cls ?? ''), `AQUAPLUS's status dot is not the queued ring: ${plus.dot?.cls}`)
  ok(plus.risk.replace(/^Risk /, '').startsWith('Medium') && plus.risk.endsWith('Latest report · 2026-09-02'), `AQUAPLUS's risk cell reads "${plus.risk}"`)
  // A name still in progress carries no date under its status: the board draws "In progress" and its step.
  ok(plus.updated === '', `AQUAPLUS shows a date "${plus.updated}" under a status still in progress`)
  ok(max?.updated === '2026-08-28', `AQUAMAX's date under its status reads "${max?.updated}"`)
  ok(plus.nameCell.includes('3 searches') && plus.nameCell.includes('was Severe') && plus.nameCell.includes(PRODUCT_NAME['multi-country-focus-search']), `AQUAPLUS's name cell reads "${plus.nameCell}"`)
  ok(plus.open?.text === 'Open latest report', `AQUAPLUS's button reads "${plus.open?.text}"`)

  // The searches under it.
  if (queuedSearch && latestSearch && olderSearch) {
    ok(queuedSearch.status === 'Queued' && queuedSearch.risk === '—' && !queuedSearch.open && queuedSearch.menu,
      `the queued search reads status "${queuedSearch.status}", risk "${queuedSearch.risk}", open ${JSON.stringify(queuedSearch.open)}, menu ${queuedSearch.menu}`)
    ok(latestSearch.nameCell.includes('Latest report') && latestSearch.open?.text === 'Open report', `the newest finished search reads "${latestSearch.nameCell}" with ${JSON.stringify(latestSearch.open)}`)
    ok(!olderSearch.nameCell.includes('Latest report') && olderSearch.open?.text === 'Open report', `the older search reads "${olderSearch.nameCell}"`)
    ok(queuedSearch.rules === 2, `a search under a grouped name draws ${queuedSearch.rules} rule(s), not two`)
  }

  // The group: its members' waiting search, the line under its name, the band itself.
  // THE FAMILY'S LINE SAYS IT ALL (board Clearances, approved 2026-11-25): its Status and Risk cells are empty,
  // and the line under its name carries the highest band and the search in progress. AQUAPLUS's latest report
  // is Medium and AQUAMAX is Manageable, so the highest is Medium.
  ok(group.status === '' && group.risk === '', `the family repeats its line in its cells: status "${group.status}", risk "${group.risk}"`)
  ok(group.nameCell.includes('· 2 names') && group.nameCell.endsWith(GROUP_LINE), `the family's name cell reads "${group.nameCell}"`)
  ok(!group.open, 'the group carries an Open — a group is several names with no single report')
  ok(max.rules === 1, `a name inside a group draws ${max.rules} rule(s), not one`)

  // Stopped, running, finished.
  // Stopped, with the day it stopped under its status, as every ended name carries (board Clearances).
  ok(coral.status === `Stopped${STOPPED_LINE}2026-09-16` || coral.status === `Stopped ${STOPPED_LINE} 2026-09-16`, `CORAL FREEZE reads "${coral.status}"`)
  ok(coral.risk === '—' && !coral.open, `CORAL FREEZE reads risk "${coral.risk}" with ${JSON.stringify(coral.open)}`)
  ok(tide.status.startsWith('Running') && tide.status.includes('Register sweeps'), `TIDEGLASS reads "${tide.status}"`)
  // THE STEP, AND NOT A COUNT OF STEPS. The approved design draws the step alone. The count was the part
  // that could not be honest: the denominator is how many steps THIS run's plan happens to have, so the
  // same search reads "3 of 9" on one account and "3 of 6" on another, and a reader takes it for a
  // fraction of the work done.
  //
  // THE FLOOR FIRST. The fixture gives this run a step count on purpose, and without checking that, an
  // arm asserting the count is absent passes hardest on the day somebody quietly drops it from the
  // fixture — which is the one change that would make every run below it meaningless.
  {
    const src = RUNS().find((r) => r.runId === 'tide-1')
    ok(src && src.stepN != null && src.stepTotal != null,
      `the running fixture no longer carries a step count (stepN ${src?.stepN}, stepTotal ${src?.stepTotal}) — nothing below this line is a measurement without it`)
    ok(!/\b\d+ of \d+\b/.test(tide.status),
      `TIDEGLASS's status line carries a step count: "${tide.status}" — the design draws the step alone`)
  }
  ok(tide.risk === '—' && !tide.open && tide.inert, `TIDEGLASS reads risk "${tide.risk}", open ${JSON.stringify(tide.open)}, inert ${tide.inert}`)
  ok(aster.status === 'Finished2026-08-03' || aster.status === 'Finished 2026-08-03', `ASTERION reads "${aster.status}"`)
  ok(aster.open?.text === 'Open report', `ASTERION's button reads ${JSON.stringify(aster.open)}`)
}

// ASK AI IS THE ROW MENU'S SECOND ENTRY (owner, 2026-09-18), and no longer a button in the actions column,
// which keeps the board's share with Open alone in it.
if (plus && group && aster && coral && tide && max) {
  for (const r of [plus, aster, max, venzy, coral]) ok(!r?.ask, `${r?.name} still draws an Ask AI button in its actions column: ${JSON.stringify(r?.ask)}`)
  ok(!coral.open, `a stopped name draws Open: ${JSON.stringify(coral.open)}`)
  ok(!tide.ask && !tide.open, `a running name with no report carries a button: ${JSON.stringify({ ask: tide.ask, open: tide.open })}`)
  ok(L.filter((r) => r.kind === 'search').every((r) => !r.ask), 'a search row carries an Ask AI button')
}
// Which rows offer the entry, read from the menus this file already opens: every name with a report, the
// stopped name included; never a group, which is several names with no single report.
ok(menus?.plus?.items?.includes('Ask AI'), `a name's menu has no Ask AI entry: ${JSON.stringify(menus?.plus?.items)}`)
ok(menus?.group && !menus.group.items?.includes('Ask AI'), `a group's menu offers Ask AI: ${JSON.stringify(menus?.group?.items)}`)
ok(menus?.search && !menus.search.items?.includes('Ask AI'), `a search row's menu offers Ask AI: ${JSON.stringify(menus?.search?.items)}`)
if (!asked || asked.fatal || asked.max?.fatal || asked.coral?.fatal) {
  fail.push(`driving Ask AI from a row's menu: ${asked?.fatal ?? asked?.max?.fatal ?? asked?.coral?.fatal ?? 'no result'}`)
} else {
  console.log(`Ask AI from AQUAMAX: "${asked.max.head}" → ${JSON.stringify(asked.max.q)}; from CORAL FREEZE → ${JSON.stringify(asked.coral.q)}`)
  // The panel names the report the row's Open opens, and the question typed in names it too.
  ok(asked.max.head === `AQUAMAX · ${PRODUCT_NAME['full-country-search']} · searched 2026-08-28`, `AQUAMAX's panel heads "${asked.max.head}"`)
  ok(asked.max.choices.length === 4 && asked.max.goText.startsWith('Open in '), `AQUAMAX's panel: ${JSON.stringify(asked.max)}`)
  ok(/^Explain the main risks in the AQUAMAX clearance from 28 August\.$/.test(asked.max.q ?? ''), `the second question from AQUAMAX types in "${asked.max.q}"`)
  ok(asked.max.stayed && asked.coral.stayed, "pressing the menu's Ask AI went somewhere — it opens a panel, and leaves the list where it is")
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
  // THE SPOKEN NAME BEGINS WITH THE WORDS SHOWN and names the report (approved 2026-11-25).
  ok(opens.every((r) => typeof r.open.aria === 'string' && r.open.aria.startsWith(r.open.text + ' for ')), `an Open button's spoken name does not begin with its words: ${JSON.stringify(opens.map((r) => [r.open.text, r.open.aria]))}`)
  ok(opens.every((r) => !r.open.clipped), `at ${width}px an Open label is cut off: ${opens.filter((r) => r.open.clipped).map((r) => r.open.text).join(', ')}`)
  console.log(`Open column at ${width}px: x ${lefts.join('/')}, width ${widths.join('/')}px, ${opens.length} buttons`)
}
if (!CARDS) openColumn(short, WIDTH)
openColumn(wide, WIDE)
// THE BOARD'S SHARES AT THE WIDE DESKTOP (owner, 2026-09-18: match the board), read off the drawn header:
// Status 16, Risk 12, Updated 10 and the actions 25, measured in the browser to a point either way.
{
  const pct = Object.values(wide.share)
  // No checkbox column and no Updated column (board Clearances, approved 2026-11-25): the name takes them.
  const board = [4, 43, 16, 12, 25]
  ok(pct.length === board.length && pct.every((v, i) => Math.abs(v - board[i]) <= 1),
    `at ${WIDE}px the columns are ${JSON.stringify(wide.share)}, not the board's ${board.join(' · ')}`)
}

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

// THE BOARD'S DIALOGS AND THE RETIRED TAB (Clearances, approved 2026-11-25).
if (!board || board.fatal) fail.push(`the board's dialogs: ${board?.fatal ?? 'no result'}`)
else {
  console.log(`board dialogs: ${JSON.stringify(board)}`)
  ok(board.retireAll.title === 'Retire all 3 searches?' && board.retireAll.confirm === 'Retire 3 searches'
    && board.retireAll.body === '3 searches under AQUAPLUS will move to Retired for everyone. Existing report links keep working. You can restore each search there. A search in progress will continue.',
    `retiring all of AQUAPLUS asks ${JSON.stringify(board.retireAll)}`)
  ok(board.retireAll.focusIn && board.retireAll.closed && board.retireAll.focusBack === 'More actions for AQUAPLUS',
    `the retire dialog does not take focus, close on Escape, and give focus back to its menu: ${JSON.stringify(board.retireAll)}`)
  ok(board.ungroup.title === `Ungroup ${FAMILY_NAME}?` && board.ungroup.confirm === 'Ungroup family' && board.ungroup.closed
    && board.ungroup.body === `Its 2 names and their searches will appear directly under ${NAME}.`,
    `ungrouping the family asks ${JSON.stringify(board.ungroup)}`)
  ok(board.group.title === 'Group names as a family' && board.group.legend === 'Names to group' && board.group.hint === 'Each selected name brings its search history.',
    `the grouping dialog reads ${JSON.stringify(board.group)}`)
  ok(JSON.stringify(board.group.problems) === JSON.stringify(['Enter a family name.', 'Choose that existing family from the Family list.', 'Select two or more names for a new family.']),
    `the grouping dialog's refusals read ${JSON.stringify(board.group.problems)}`)
  ok(board.group.closed && !writes.some((w) => w.path === '/portal/admin/families'), `a refused or dismissed grouping wrote to the server: ${JSON.stringify(writes)}`)
  ok(board.retiredTab === 'Retired2' || board.retiredTab === 'Retired 2', `the Retired tab reads "${board.retiredTab}"`)
  ok(JSON.stringify(board.retiredRows) === JSON.stringify(['HALCYON', 'GLASSWING']), `the Retired tab lists ${JSON.stringify(board.retiredRows)}`)
  ok(board.restoreNote === `Restored ${PRODUCT_NAME['global-preliminary-search']} for GLASSWING to Failed.`, `restoring a failed search says "${board.restoreNote}"`)
  ok(writes.some((w) => w.path === '/portal/admin/retired' && w.body?.action === 'restore' && JSON.stringify(w.body.runIds) === '["tmpr-retired-2"]'), `Restore sent ${JSON.stringify(writes)}`)
}

// The menu holds retire and ungroup, opens, closes on Escape, and goes nowhere.
if (!menus || menus.fatal) {
  fail.push(`the row menus: ${menus?.fatal ?? 'no result'}`)
} else {
  // Retire first, Ask AI beside it as the second entry (owner, 2026-09-18).
  // The board's menus (Clearances, approved 2026-11-25). AQUAPLUS sits in a family and its searches are
  // open when the menu is read, so it offers no "Show all" and no "Group with other names…".
  ok(JSON.stringify(menus.plus?.items) === JSON.stringify(['Remove from family…', 'Retire all 3 searches…', 'Ask AI']) && menus.plus.expanded === 'true' && menus.plus.closed, `AQUAPLUS's menu: ${JSON.stringify(menus.plus)}`)
  ok(JSON.stringify(menus.group?.items) === JSON.stringify(['Add names to this family…', 'Ungroup family…']) && menus.group.closed, `the family's menu: ${JSON.stringify(menus.group)}`)
  ok(JSON.stringify(menus.search?.items) === JSON.stringify(['Retire this search…']) && menus.search.closed, `a search row's menu: ${JSON.stringify(menus.search)}`)
  ok(menus.groupClick.stayed && menus.groupClick.toggled, `a click on the group row: ${JSON.stringify(menus.groupClick)} — it must fold or unfold and go nowhere`)
  ok(menus.inertClick.found && menus.inertClick.stayed, `a click on a running name with no report went somewhere: ${JSON.stringify(menus.inertClick)}`)
}
// A READER WITHOUT CURATION RIGHTS (the Clearances board's verification, 2026-11-25).
if (!reader) fail.push('the reader pass returned nothing')
else {
  ok(!reader.groupNames, 'a reader without curation rights is offered "Group names"')
  ok(reader.items.every((t) => !/Retire|Group|Remove|Ungroup|Add names|Restore/.test(t)), `a reader without curation rights meets ${JSON.stringify(reader.items)} in the row menus`)
  ok(reader.items.includes('Ask AI'), `a reader without curation rights has no Ask AI in any row menu: ${JSON.stringify(reader.items)}`)
  ok(reader.rows >= 6, `a reader without curation rights sees ${reader.rows} rows`)
}
// A LIST LONGER THAN ONE PAGE.
if (!paged || paged.fatal) fail.push(`the paged list: ${paged?.fatal ?? 'no result'}`)
else {
  ok(paged.one.names === 50 && paged.two.names === 25, `the pages hold ${paged.one.names} and ${paged.two.names} names, not 50 and 25`)
  ok(paged.two.firstIsHead && paged.two.heads[0] === paged.one.heads[paged.one.heads.length - 1],
    `page two does not open with the company that ran across the break: page one ${JSON.stringify(paged.one.heads)}, page two ${JSON.stringify(paged.two.heads)}`)
  ok(/^1–50 of 75$/.test(paged.one.range) && /^51–75 of 75$/.test(paged.two.range), `the pager reads "${paged.one.range}" then "${paged.two.range}"`)
}
ok(rowOpens?.path === '/portal/result/tmpd-other', `a click on a name with one search went to ${rowOpens?.path ?? rowOpens?.fatal} — it opens that search's report`)

if (shotDir) console.log(`evidence: ${JSON.stringify(evidence)}`)

if (fail.length) {
  console.error(`\nclearances-render-check FAILED (${fail.length}):`)
  for (const f of fail) console.error(`  • ${f}`)
  process.exit(1)
}
console.log('clearances-render-check: columns hold, reads are in the grid, the date fits, nothing overflows')
