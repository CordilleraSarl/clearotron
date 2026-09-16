#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Does the portal call a company by name, and can a person manage their own searches and projects?
//
//   node scripts/portal-lifecycle-check.mjs [--keep] [--shot <path>] [--shot-dir <dir>]
//
// ── why this exists ──────────────────────────────────────────────────────────────────────────────────
//
// Three of the four things checked here are LOGIN-DEPENDENT, and that is the whole difficulty. The bug
// this was written for — the same company reading "Vantor Labs" in one place and "vantor" in
// another — was invisible from a staff session, because staff had a name source and clients did not. A
// screenshot from one login is not evidence about the other, and no string test in portal-ui can see a
// rendered label at all.
//
// So this serves the REAL built bundle to a REAL browser, twice — once as staff, once as a client — and
// reads what is actually on screen. Then it drives the two lifecycles that had no controls at all:
// retiring a search template and bringing it back, and creating a project.
//
// It is deliberately a sibling of composer-render-check.mjs rather than an extension of it: that one
// exercises the one screen that spends money, and it should not grow a second job.
//
// MUST NOT run as a user with a virtual-memory ulimit (`ulimit -v`) — Chrome dumps core under one. Run
// it as a user with `ulimit -v unlimited`.

import { createServer } from 'node:http'
import { readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { productRow } from '../driver/product-rows.mjs'
import { reportIdentityFor } from '../driver/search-policy.mjs'
import { browserRun } from "../shared/browser-temp-root.mjs";

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = join(HERE, '..', 'portal-ui', 'dist')
const keep = process.argv.includes('--keep')
const shotAt = process.argv.includes('--shot') ? process.argv[process.argv.indexOf('--shot') + 1] : null
// A DIRECTORY, not a file. The owner's rule is that a change a person sees on a screen arrives with a
// picture of that screen, and the change-and-remove form is two screens: the form filled in, and the
// confirmation it asks before it acts. One `--shot` path cannot carry both, and the second is the one
// worth looking at — a reader who only ever sees the pre-confirm pill has not seen what they agree to.
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null
// EVIDENCE for a person to read against the Company settings design: one picture per state the design
// draws, in light and dark. Not the test — the assertions on those states run with or without it.
const shotDir = process.argv.includes('--shot-dir') ? process.argv[process.argv.indexOf('--shot-dir') + 1] : null

if (!existsSync(join(DIST, 'index.html'))) {
  console.error(`no build at ${DIST} — run: npm run build:ui`)
  process.exit(2)
}

// ── the stub portal ─────────────────────────────────────────────────────────────────────────────────
//
// ONE company, whose key and name differ in exactly the way every real one does: a lowercase slug
// against a capitalised name. That difference is the entire subject of the first half of this check, so
// a fixture where they matched would pass while the product was broken.

const KEY = 'vantor'
const NAME = 'Vantor Labs'
// A code-owned path the profile stub serves to everyone, as a server that forgot to strip it would. Only a
// person with access to everything may read it on Profile; see PROFILE_PATHS_SCRIPT.
const PLANTED_PATH = 'skills/prelim-search/risk-framework-planted.md'
// The source repository the about stub states, and deliberately not the firm's: the local sign-in notice
// builds its link from whatever the server states, so a fork's notice points at the fork.
const STUB_SOURCE_REPO = 'https://git.example.test/a-fork/clearotron'

const KEY2 = 'foxglade'
const NAME2 = 'Foxglade Interactive'

/** Which identity /portal/api/me answers as. Flipped between passes. */
let role = 'client'
/** Whether the install signs one person in locally — the state in which People cannot add anyone. */
let localMode = false

// Each pass may run clearances, because each one opens New clearance. The `role` variable names the
// PASS — who is looking, in this check's own terms — and the wire carries the two switches.
const RUN_ONLY = { permissions: { run: true, manage: false } }
const ME = () => {
  if (role === 'staff') {
    // Access to the whole install holds "*", which is not a list — names come from the roster.
    // `accountNames` is empty by design, and a pass that still shows the name proves the roster path. Two
    // organisations are visible, so the identity corner is EMPTY for this pass: the top bar names an
    // organisation only for a person who can see exactly one.
    return { permissions: { run: true, manage: true }, email: 'lawyer@cordillera.test', accounts: '*', accountNames: {},
      access: [{ kind: 'everything' }],
      organisations: [{ key: 'org-a', name: 'Apmxc Group' }, { key: 'org-b', name: 'Foxglade Group' }],
      accountOrgs: { [KEY]: 'org-a', [KEY2]: 'org-b' }, genericOrgs: ['org-a', 'org-b'] }
  }
  if (role === 'multi') {
    // THE LOGIN THE BUG WAS REPORTED FROM. Several grants is the only identity that gets the switcher
    // WITHOUT the roster behind it — its options come from `me.accounts` and their labels from
    // `me.accountNames`, a path neither of the other two passes renders at all.
    return { ...RUN_ONLY, email: 'owner@example.test', accounts: [KEY, KEY2],
      accountNames: { [KEY]: NAME, [KEY2]: NAME2 },
      access: [{ kind: 'company', key: KEY, name: NAME, org: 'org-a' }, { kind: 'company', key: KEY2, name: NAME2, org: 'org-a' }],
      organisations: [{ key: 'org-a', name: 'Apmxc Group' }], accountOrgs: { [KEY]: 'org-a', [KEY2]: 'org-a' } }
  }
  if (role === 'owner') {
    // ONE COMPANY, BOTH SWITCHES — the person the lifecycle pass is about. Creating and archiving a project
    // is Manage and a search template's writes are Run, so the pass that drives both needs both; a person
    // with Run alone is shown no project controls at all, which the view-only pass asserts.
    return { permissions: { run: true, manage: true }, email: 'gundy@apmxc.test', accounts: [KEY], accountNames: { [KEY]: NAME },
      access: [{ kind: 'company', key: KEY, name: NAME, org: 'org-a' }],
      organisations: [{ key: 'org-a', name: 'Apmxc Group' }], accountOrgs: { [KEY]: 'org-a' } }
  }
  if (role === 'settings') {
    // THE COMPANY SETTINGS PASS: one company, both switches, and the organisation held whole — which is
    // what New company needs before Create can be pressed. Holding the organisation adds its Generic to
    // the switcher, so the pass picks the company there, as a person would.
    return { permissions: { run: true, manage: true }, email: 'gundy@apmxc.test', accounts: [KEY], accountNames: { [KEY]: NAME },
      access: [{ kind: 'organisation', key: 'org-a', name: 'Apmxc Group' }],
      organisations: [{ key: 'org-a', name: 'Apmxc Group' }], accountOrgs: { [KEY]: 'org-a' }, genericOrgs: ['org-a'] }
  }
  if (role === 'reader') {
    // BOTH SWITCHES OFF: the view-only person. They read every report for the company they were given,
    // and meet no control that would only refuse them — no New clearance, no People.
    return { permissions: { run: false, manage: false }, email: 'viewer@example.test', accounts: [KEY], accountNames: { [KEY]: NAME },
      access: [{ kind: 'company', key: KEY, name: NAME, org: 'org-a' }],
      organisations: [{ key: 'org-a', name: 'Apmxc Group' }], accountOrgs: { [KEY]: 'org-a' } }
  }
  return { ...RUN_ONLY, email: 'gundy@apmxc.test', accounts: [KEY], accountNames: { [KEY]: NAME },
    access: [{ kind: 'company', key: KEY, name: NAME, org: 'org-a' }],
    organisations: [{ key: 'org-a', name: 'Apmxc Group' }], accountOrgs: { [KEY]: 'org-a' } }
}

// PEOPLE, as the access route answers the whole-install pass: three people on a hosted install, and the
// one person a local sign-in holds. Each person arrives already narrowed to what the viewer may see.
//
// `covered` says whether a row is the WHOLE of that person from where the viewer stands, and this pass is
// the whole-install viewer, so every row is. `keys` is how many connector keys the person holds, and
// `keysRevocable` whether this installation could withdraw one — both read by the removal confirmation
// BEFORE it is pressed, which is the only moment at which they are any use to a reader.
//
// `owner@example.test` deliberately holds TWO points. A person holding one cannot demonstrate the change
// this form is for: unticking their only row is not a narrowing, it is the removal, and the form refuses
// it by name.
// Flipped for one pass. A connector started without a revocation list never loaded one, so a key already
// issued through it cannot be called back — and the confirmation has to say that INSTEAD of "through
// their AI", before the press rather than in the answer. It is a branch of a client-facing sentence, so
// it is driven rather than reasoned about.
let keysRevocable = true
const HOSTED_PEOPLE = () => ({ note: '', unknownAccounts: [], grantsFile: null, canAdd: true, localSignIn: false, keysRevocable, people: [
  { email: 'lawyer@cordillera.test', permissions: { run: true, manage: true }, access: [{ kind: 'everything' }], dangling: [], listed: true, covered: true, keys: 0 },
  { email: 'owner@example.test', permissions: { run: true, manage: false }, dangling: [], listed: true, covered: true, keys: 1,
    access: [{ kind: 'organisation', key: 'org-a', name: 'Apmxc Group' }, { kind: 'company', key: KEY2, name: NAME2, org: 'org-b' }] },
  { email: 'viewer@example.test', permissions: { run: false, manage: false }, access: [{ kind: 'company', key: KEY, name: NAME, org: 'org-a' }], dangling: [], listed: true, covered: true, keys: 0 },
  // A FOURTH PERSON, AND THE ONLY REASON FOR THEM IS `listed: false`. They appear in a company's access
  // list and have no permissions entry at all, which is a different fact from having permissions set to
  // none — the server has always said which, and the decoder dropped the field, so this row rendered as
  // a considered "view only" for as long as the page has existed. Nothing here would have caught it
  // either, because the fixture had nobody of this shape.
  { email: 'reach@example.test', permissions: { run: false, manage: false }, access: [{ kind: 'company', key: KEY2, name: NAME2, org: 'org-b' }], dangling: [], listed: false, covered: true, keys: 0 },
  // A WHOLE EMAIL DOMAIN. It is a row like any other and is changed and removed like one, but the
  // confirmation must not read as though one person is losing access — a reader skimming the address
  // sees a name shape. Here to drive that sentence rather than to reason about it.
  { email: '*@example.test', permissions: { run: true, manage: false }, access: [{ kind: 'organisation', key: 'org-a', name: 'Apmxc Group' }], dangling: [], listed: true, covered: true, keys: 0 },
] })
// TWO ROWS, AND THE SECOND ONE IS THE POINT. This served ONE person — the one signed in — whose own row
// never draws Modify, so every control this install refuses was invisible to the driver and a reader's
// most ordinary act could not be reproduced. A real local-sign-in install carries the addresses already
// in its access record: they simply cannot sign in. That is the install the report came from, where
// Modify was drawn on the other row, pressed, and answered with an internal token.
const LOCAL_PEOPLE = { note: '', unknownAccounts: [], grantsFile: null, canAdd: false, localSignIn: true, keysRevocable: false, people: [
  { email: 'lawyer@cordillera.test', permissions: { run: true, manage: true }, access: [{ kind: 'everything' }], dangling: [], listed: true, covered: true, keys: 0 },
  { email: 'newcomer@example.test', permissions: { run: false, manage: false }, access: [{ kind: 'organisation', key: 'demo-org', name: 'Demo Org' }], dangling: [], listed: true, covered: true, keys: 0 },
] }

// THE ENGINE'S OWN ROW for a level, not a restatement of it. `available`/`unavailableNote` are the
// only additions — deployment state resolved per request, which productRows knows nothing about. This
// pass deliberately serves a SUBSET of the registry (no knockout-register), so it names its keys.
const level = (key) => ({ ...productRow(key), available: true, unavailableNote: '' })

/** The saved-search store, mutated by what the page posts — so a retire is observable as state. */
const RECIPES = {
  'launch-screen': {
    label: 'Launch screen', components: {},
    // A one-country scope on the one-country product: a saved search is a job template, and the engine
    // refuses a scope its base product does not accept — at the save door as at every run door.
    base: 'full-country-search',
    scope: { jurisdictions: ['United States'], platforms: [], classes: [9] },
    nativeLanguage: false, notes: 'For the EU launch team.',
    // An extra no lever can express. If a composer re-save drops this, the check fails — that is the
    // silent capability regression retiring the standalone editor could have caused.
    extras: { emailTable: true },
    archived: false, version: 3, createdBy: 'seed@test', createdAt: '2026-07-18T00:00:00.000Z',
  },
  'old-thing': {
    label: 'Old thing', base: 'global-preliminary-search', components: {}, scope: {},
    nativeLanguage: false, archived: true, version: 2,
  },
}

// One live, one archived. The archived row now reaches the browser for BOTH roles (that is what makes
// archiving reversible), so "is it still offered when a clearance is set up" stopped being answered by
// the wire and became something the composer has to get right.
const PROJECTS = [
  { key: 'eu-launch', name: 'EU launch', archived: false },
  { key: 'old-engagement', name: 'Old engagement', archived: true },
]

// The framework the profile stub serves: four bands, what each means in rungs, and the two lines on what
// it rates and speaks as — the parts Profile folds, so a fold with nothing in it cannot pass.
const FRAMEWORK = {
  custom: true, hasWorkedExamples: true,
  manifest: {
    title: 'Vantor Labs clearance framework', entity_label: 'Vantor',
    bands: [{ label: 'Blocking', tone: 'severe' }, { label: 'Material', tone: 'high' },
      { label: 'Manageable', tone: 'medium' }, { label: 'Clear to file', tone: 'minimal' }],
    structure: { kind: 'bands', axes: ['likelihood of confusion', 'commercial exposure'] },
  },
  bandMeanings: [
    { band: 'Blocking', meaning: 'A live right covers the goods.', rungs: [
      { label: 'Legal position', text: 'A live registration covers the goods in a launch market.' },
      { label: 'Consequence', text: 'Do not file. The name needs replacing.' }] },
    { band: 'Material', meaning: 'A narrower prior right exists.', rungs: [
      { label: 'Legal position', text: 'A prior right would survive an opposition, but is narrower than the goods.' },
      { label: 'Consequence', text: 'File with a narrowed specification.' }] },
    { band: 'Manageable', meaning: 'Crowded, nothing squarely over the goods.', rungs: [
      { label: 'Legal position', text: 'The register is crowded, and nothing sits squarely over the goods.' },
      { label: 'Consequence', text: 'File as drafted.' }] },
    { band: 'Clear to file', meaning: 'Nothing reads onto the name.', rungs: [
      { label: 'Legal position', text: 'Nothing on the register in the named classes reads onto the name.' },
      { label: 'Consequence', text: 'File.' }] },
  ],
}

const posted = []
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' }

const json = (res, body) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const p = url.pathname

  if (req.method === 'POST') {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      let body = {}
      try { body = JSON.parse(raw) } catch { /* recorded as empty */ }
      posted.push({ path: p, body })
      // A saved-search save REPLACES the record, exactly as recipe-service does — so the next GET sees
      // what the page actually sent, and a dropped field shows up as a dropped field.
      const rec = /^\/portal\/api\/config\/searches\/([^/]+)\/save$/.exec(p)
      if (rec) RECIPES[decodeURIComponent(rec[1])] = { ...body.recipe, version: (body.recipe?.version ?? 0) + 1 }
      const prj = /^\/portal\/api\/config\/projects\/([^/]+)\/(validate|save)$/.exec(p)
      if (prj && prj[2] === 'save') {
        const key = decodeURIComponent(prj[1])
        const row = PROJECTS.find((x) => x.key === key)
        if (row) row.archived = body.profile?.archived === true
        else PROJECTS.push({ key, name: body.profile?.projectName ?? key, archived: false })
      }
      if (prj && prj[2] === 'validate') return json(res, { ok: true, errors: [], isNew: true })
      return json(res, { ok: true, written: true, version: 4 })
    })
    return
  }

  if (p === '/portal/api/me') return json(res, ME())
  // Asked only by the whole-install pass, and answered as such: another pass reaching it would be a real
  // finding. Each company names its one organisation, so that pass's switcher is drawn in groups.
  if (p === '/portal/admin/roster') {
    if (role !== 'staff') { res.writeHead(404); res.end('{}'); return }
    return json(res, { customers: [{ key: 'generic', name: 'Generic default', org: null }, { key: KEY, name: NAME, org: 'org-a' },
      { key: 'foxglade', name: 'Foxglade Interactive', org: 'org-b' }] })
  }
  if (p === '/portal/api/searches') {
    return json(res, {
      account: KEY,
      products: ['knockout-search', 'global-preliminary-search', 'multi-country-focus-search', 'full-country-search'].map(level),
      // The COMPOSER's menu, which filters retired rows out server-side. The list screen must not be
      // drawn from this — that is what made a retired search unrecoverable.
      recipes: Object.entries(RECIPES).filter(([, r]) => !r.archived)
        .map(([slug, r]) => ({ slug, label: r.label, base: r.base, version: r.version ?? null })),
    })
  }
  if (p === '/portal/api/config/searches') {
    const listing = { recipes: Object.entries(RECIPES).map(([slug, r]) => ({
      slug, label: r.label, base: r.base, archived: Boolean(r.archived), version: r.version ?? null, updatedAt: null })) }
    // LATE ON PURPOSE in the Company settings pass. Profile's Permitted searches row names templates from
    // this listing, and a listing that always beat the profile would leave no moment in which the row
    // could say something other than the names.
    if (role === 'settings') { setTimeout(() => json(res, listing), 500); return }
    return json(res, listing)
  }
  const one = /^\/portal\/api\/config\/searches\/([^/]+)$/.exec(p)
  if (one) {
    const slug = decodeURIComponent(one[1])
    if (!RECIPES[slug]) { res.writeHead(404); res.end('{}'); return }
    return json(res, { slug, recipe: RECIPES[slug], sha: `sha-${slug}-${RECIPES[slug].version}` })
  }
  if (p === '/portal/api/config/projects') return json(res, { projects: PROJECTS })
  const prj = /^\/portal\/api\/config\/projects\/([^/]+)$/.exec(p)
  if (prj) {
    const key = decodeURIComponent(prj[1])
    const row = PROJECTS.find((x) => x.key === key)
    if (!row) { res.writeHead(404); res.end('{}'); return }
    return json(res, { customer: KEY, customerName: NAME, project: key,
      overlay: { projectName: row.name, ...(row.archived ? { archived: true } : {}) },
      contextPack: '', inherited: {}, effective: {}, origins: {}, derived: null })
  }
  if (p === '/portal/api/config/profile') {
    // A COMPANY WITH ITS OWN FRAMEWORK, so Profile draws everything it can: the framework in force, its
    // bands, the detail behind its fold, the rows under it and the variant calculation. `allowedRecipes`
    // names two of the company's templates by SLUG — the row must print their names, never these keys.
    return json(res, { account: KEY,
      profile: { name: 'Vantor Labs Ltd', matchDomains: ['vantor.example'], industry: 'developer tools',
        platforms: ['gnc.com'], defaultClasses: [9, 42], marketplaceDensity: 'Low', defaultProduct: 'global-preliminary-search' },
      readOnly: { frameworkPath: PLANTED_PATH, allowedRecipes: ['launch-screen', 'old-thing'],
        jxPolicy: { escalationPolicy: 'conservative' }, runCaps: { dailyRuns: 3, maxQueued: 4 } },
      contextPack: '## Standing concerns\n\nA competitor files close to every launch.', framework: FRAMEWORK,
      derived: { batchSize: 14, minCellsPerVariant: 6 } })
  }
  if (p === '/portal/api/usage') {
    return json(res, { account: KEY, today: 0, thisMonth: 0, queued: 0, dailyRuns: 3, monthlyRuns: null, maxQueued: null, capped: role !== 'staff' })
  }
  if (p === '/portal/api/runs') {
    // `productName` is what the service sends and what the screen renders. Without it this row
    // modelled a run whose LEVEL THE REGISTRY HAS FORGOTTEN — the one class that still falls through to
    // the frozen `stageLabel` — so /portal/clearances rendered "Depth 4 · 2026-07-20" here. Nothing in
    // this file asserts on that label (it is about owner names, lifecycles and screens, not about where
    // the page puts things), so it passed either way. A fixture that quietly models the degenerate case
    // is how the next reader concludes the degenerate case is normal. Resolved, never typed.
    return json(res, { runs: [{ runId: 'tmp1-ion-2026-07-20', account: KEY, title: 'AQUAPLUS', markName: 'AQUAPLUS',
      product: 'global-preliminary-search', stageLabel: 'Depth 4',
      productName: reportIdentityFor('global-preliminary-search').identity,
      kind: 'clearance', state: 'delivered', date: '2026-07-20',
      band: 'Low', tone: 'clear', bands: [{ label: 'Low', tone: 'clear' }], marks: [], reportSchema: 2,
      held: false, report: 'report.html', step: null, stepN: null, stepTotal: null, reason: null, failedStage: null }] })
  }
  if (p === '/portal/admin/families') return json(res, { of: {}, names: {} })
  // Manage only, and answered as such. Without these the catch-all below would hand the page its own
  // HTML, and People would report itself unavailable — a failure of the fixture wearing the page's name.
  if (p === '/portal/admin/access') {
    if (role !== 'staff') { res.writeHead(404); res.end('{}'); return }
    return json(res, localMode ? LOCAL_PEOPLE : HOSTED_PEOPLE())
  }
  if (p === '/portal/admin/observed') return json(res, { available: false, truncated: false, people: [], note: 'No activity log is kept here.' })
  if (p === '/portal/api/mcp-access') return json(res, { url: null, keyUrl: null, email: null, enabled: false })
  if (p === '/portal/api/about') return json(res, { name: 'Clearotron', version: null, commit: null, sourceRepo: STUB_SOURCE_REPO, sourceUrl: STUB_SOURCE_REPO, license: null, copyright: '' })

  const base = p.split('?')[0]
  const file = base === '/' || (base.startsWith('/portal') && !base.includes('.')) ? '/index.html' : base.replace(/^\/portal/, '')
  const full = join(DIST, file)
  if (!existsSync(full)) { res.writeHead(404); res.end('no'); return }
  res.writeHead(200, { 'content-type': MIME[extname(full)] ?? 'application/octet-stream' })
  res.end(readFileSync(full))
})

await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`

// ── the driver ──────────────────────────────────────────────────────────────────────────────────────

const HELPERS = `
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const settle = async (pred, ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(60); }
    return false;
  };
  const txt = () => document.body.innerText;
  // A MISS THROWS, NAMING WHAT IT MISSED. Same defect as composer-render-check.mjs, in this
  // file's own copy of the helper: six sites below dereference the result immediately, so a button that
  // had not painted arrived as "Cannot read properties of undefined (reading 'click')".
  // maybeByText keeps the undefined return for the one site where absence is the thing being measured.
  const maybeByText = (sel, re) => [...document.querySelectorAll(sel)].find((e) => re.test(e.innerText || ''));
  const findByText = (sel, re) => {
    const el = maybeByText(sel, re);
    if (!el) throw new Error('no ' + sel + ' matching ' + re + ' is on screen');
    return el;
  };

  // Nine of this file's twelve settles discarded their return. Lines 260, 324 and 348 already read it
  // and name the wait; this is that shape for the rest.
  const mustSettle = async (pred, ms, what) => {
    if (!await settle(pred, ms)) throw new Error(what + ' (waited ' + ms + 'ms)');
  };
  const allByText = (sel, re) => [...document.querySelectorAll(sel)].filter((e) => re.test(e.innerText || ''));
  // Navigate the way the shell does — pushState plus a popstate, which is what its usePath listens for.
  // Retried once: a screen that navigates itself on save (the composer returns to Search templates) can
  // land its own go() a beat after this one and put the old screen back.
  const goto = async (path) => {
    for (let i = 0; i < 3; i++) {
      history.pushState({}, '', path);
      window.dispatchEvent(new PopStateEvent('popstate'));
      await sleep(500);
      if (location.pathname === path.split('?')[0]) return;
    }
  };
  // React installs its own value setter on these elements, so assigning .value directly updates the DOM
  // and leaves React's copy stale — the change handler then sees the OLD value. Going through the
  // prototype's setter is what makes a driven control behave like a typed one.
  const set = (el, v) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement
      : el.tagName === 'SELECT' ? HTMLSelectElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  };
`

/**
 * Pass one, run under BOTH roles: is the company called by its name, everywhere?
 *
 * The sidebar is read from the DOM rather than from innerText of the page, because "Vantor Labs" also
 * appears in the composer's card — a whole-page search would pass on a screen where only one of the two
 * was right, which is the exact bug.
 */
const NAMES_SCRIPT = `
(async () => {
${HELPERS}
  const out = { steps: [] };
  await goto('/portal/clearances');
  if (!await settle(() => /Clearances/.test(txt()))) return { fatal: 'the shell never painted', body: txt().slice(0, 600) };

  // WHERE THE NAME LIVES DEPENDS ON HOW MANY OWNERS THE IDENTITY REACHES, and that is a ruling
  // (2026-07-28) rather than an accident. An identity that can switch gets a <select> in the rail. A
  // single-owner identity IS its own company, so the rail block would print that name a third time
  // on one screen — rail, title, Account corner — and it was removed. The name did not go away; it
  // MOVED to the topbar Account corner, at the other end of the same bar.
  //
  // So this reads BOTH ends and asserts per identity below. Reading only the rail is how this check
  // spent six days reporting a client-facing defect that had been a design decision since 07-28.
  const rail = document.querySelector('.sidebar');
  const railSelect = rail && rail.querySelector('select[aria-label="Company"]');
  out.railKind = railSelect ? 'select' : 'none';
  // The companies only: "+ New company" is an action at the foot of the same menu, not a company to be in.
  out.railOwner = railSelect
    ? [...railSelect.options].filter((o) => !o.hasAttribute('data-action'))
      .map((o) => o.textContent.trim()).filter((t) => t !== 'All companies')
    : [];
  out.railNewCompany = railSelect ? [...railSelect.options].some((o) => o.getAttribute('data-action') === 'new-company') : false;
  // The rail must carry NO owner block when there is nothing to switch. Asserted positively, so a
  // regression back to naming the owner three times on one screen fails here too.
  out.railHasOwnerBlock = !!(rail && [...rail.querySelectorAll('.eyebrow')]
    .some((e) => e.textContent.trim() === 'Company'));

  // The topbar identity corner: an "Organisation" eyebrow with the name in the element after it.
  const topbar = document.querySelector('.topbar');
  const cornerLabel = topbar && [...topbar.querySelectorAll('.eyebrow')]
    .find((e) => e.textContent.trim() === 'Organisation');
  out.accountCorner = cornerLabel && cornerLabel.nextElementSibling
    ? cornerLabel.nextElementSibling.innerText.trim()
    : null;
  // The switcher's organisation headings and its Generic entries, and the rail's own entries — read for
  // every identity, so the verdict can ask each one what its permissions and its organisations decide.
  out.railGroups = railSelect ? [...railSelect.querySelectorAll('optgroup')].map((g) => g.label) : [];
  out.genericOptions = railSelect ? [...railSelect.options].filter((o) => /Generic/.test(o.textContent)).length : 0;
  out.railNav = rail ? [...rail.querySelectorAll('.nav-item')].map((b) => b.innerText.trim()).filter(Boolean) : [];
  out.genericLabels = railSelect ? [...railSelect.options].filter((o) => /Generic/.test(o.textContent)).map((o) => o.textContent.trim()) : [];
  // The avatar menu, opened, read and closed again. People lives there for a person with Manage, directly
  // above Global config, and in the rail for nobody.
  const avatar = document.querySelector('button[aria-label="Settings and about"]');
  if (avatar) { avatar.click(); await settle(() => !!document.querySelector('[role="menu"]')); }
  out.avatarMenu = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((b) => b.innerText.trim()).filter(Boolean);
  if (avatar && document.querySelector('[role="menu"]')) avatar.click();

  // Staff open on "All companies", so pick one — the heading below is scoped to whoever is selected.
  if (railSelect) {
    set(railSelect, '${KEY}');
    await sleep(700);
  }

  // The SCREEN's header, not the top bar's. The top bar carries an <h1> with the nav label
  // ("Clearances") and it comes first in the document, so a bare h1 selector reads the one place that is
  // supposed to say the screen's name and never the company's.
  //
  // THE WHOLE HEADER BLOCK, not its <h1>. The screen used to open with an eyebrow reading
  // "All Clearances" over a heading reading the company's name; it is one header now, titled for the
  // screen, with the company on the line beneath it. What has to be true is unchanged and is what this
  // reads: a person looking at one company's list can see whose it is, where the page begins. Pinned to
  // the h1, this asserted a layout decision and would have to be rewritten by whoever next moves it.
  const header = document.querySelector('.main .screen .page-header');
  out.clearancesHeading = header ? header.innerText.trim() : null;
  // THE COMPANY, AS ITS OWN READING. The block above also carries the allowance sentence, which differs
  // by identity — so comparing whole blocks between two logins reports a difference that is the point of
  // the line rather than the bug this file exists for. The company is marked in the markup; read it.
  const mark = header && header.querySelector('[data-anon="mark"]');
  out.clearancesCompany = mark ? mark.innerText.trim() : null;
  out.topbarHeading = (document.querySelector('.topbar h1') || {}).innerText || null;

  await goto('/portal/new');
  // THIS WAIT WAS IDENTITY-DEPENDENT AND SILENTLY DEAD FOR ONE OF THE THREE. "Company" is
  // the rail switcher's eyebrow (AppShell.tsx), which a SINGLE-OWNER client never gets — that identity
  // reads its owner in the Account corner instead. So this timed out on every client run, and because
  // settle returned false without objecting it degraded into an 8-second sleep. Waits on the context
  // card the composer draws for every identity, which is what the next line reads.
  await mustSettle(() => Boolean(document.querySelector('.ctx-card')), 8000,
    'the composer never painted its context card');
  // THE COMPANY IS THE FORM'S FIRST FIELD, above Describe it — it moved out of the card, which now holds
  // what the company carries. Read where it is drawn: the picker's chosen option for a reader with
  // several companies, the plain name for a reader with one.
  const company = document.querySelector('.nc-company-name') || document.querySelector('select.nc-company');
  out.composerCompany = company
    ? (company.tagName === 'SELECT' ? (company.selectedOptions[0] || {}).textContent || '' : company.innerText).replace(/\\s+/g, ' ').trim()
    : null;

  // THE PROPERTY: no screen prints the slug where the name belongs. Checked over the whole document,
  // because the slug appearing anywhere visible is the failure — it has no business on a client screen.
  out.slugOnScreen = txt().includes('${KEY}');
  out.nameOnScreen = txt().includes('${NAME}');
  return out;
})()
`

/**
 * People and the form it opens, as the whole-install pass sees them on a hosted install. The form is left
 * clean — the address cleared and the choice unticked — so the unsaved-changes prompt cannot stall the
 * navigation that follows.
 */
const PEOPLE_SCRIPT = `
(async () => {
${HELPERS}
  const out = {};
  try {
    await goto('/portal/people');
    await mustSettle(() => document.querySelector('table.data tbody tr td'), 8000, 'People never drew its list');
    out.rows = [...document.querySelectorAll('table.data tbody tr')]
      .map((r) => [...r.querySelectorAll('td')].map((c) => c.innerText.replace(/\\s+/g, ' ').trim()));
    out.addDisabled = findByText('button', /Add a person/).disabled;
    out.localNotice = /signs in one person/.test(txt());
    findByText('button', /Add a person/).click();
    await mustSettle(() => /Give someone access to Clearotron/.test(txt()), 8000, 'Add a person did not open the form');
    out.path = location.pathname;
    const email = document.querySelector('#give-access-email');
    set(email, 'dana@birch.example');
    await sleep(150);
    findByText('button.attach-row', /Apmxc Group/).click();
    await sleep(250);
    out.sentence = (document.querySelector('.notice.quiet p') || {}).innerText || null;
    out.saveEnabled = !findByText('button', /^Save$/).disabled;
    findByText('button.attach-row', /Apmxc Group/).click();
    set(email, '');
    await sleep(200);
  } catch (e) { out.fatal = String((e && e.message) || e); }
  return out;
})()
`

/** People on an install that signs one person in locally: one row, Add off, and the way out named. */
const PEOPLE_LOCAL_SCRIPT = `
(async () => {
${HELPERS}
  const out = {};
  try {
    await goto('/portal/people');
    await mustSettle(() => /signs in one person/.test(txt()), 8000, 'the local sign-in notice never appeared');
    out.addDisabled = findByText('button', /Add a person/).disabled;
    out.rows = document.querySelectorAll('table.data tbody tr').length;
    // MODIFY ON SOMEBODY ELSE'S ROW. The write routes refuse on this install, so the control says so
    // before it is pressed rather than three screens later. Matched with the :disabled selector rather
    // than read off the property: an element inside a disabled fieldset reports disabled=false.
    const other = [...document.querySelectorAll('table.data tbody tr')]
      .find((r) => r.innerText.indexOf('newcomer@example.test') >= 0);
    const modifyBtn = other ? other.querySelector('button.pill') : null;
    out.otherModifyPresent = !!modifyBtn;
    out.otherModifyDisabled = modifyBtn ? modifyBtn.matches(':disabled') : null;
    const linkSel = 'a[href*="putting-your-own-login-provider-in-front"]';
    const linked = await settle(() => document.querySelector(linkSel), 8000);
    out.linkHref = linked ? document.querySelector(linkSel).href : null;
  } catch (e) { out.fatal = String((e && e.message) || e); }
  return out;
})()
`

/**
 * Modify, and the confirmation Remove asks — the two screens the change-and-remove work added.
 *
 * It unticks a row rather than only opening the form, because the sentence under the form is the thing
 * that had to be built rather than reused: the Add form never had to say what somebody LOSES. Reading
 * it back is what distinguishes a form that drew from a form that drew and then said the right thing.
 *
 * It stops at the confirmation. Pressing through would need the write routes stubbed, and this pass has
 * no business exercising a removal — what it is here to prove is that a reader is told what they are
 * agreeing to before they agree to it.
 */
const MODIFY_SCRIPT = `
(async () => {
${HELPERS}
  const out = {};
  try {
    await goto('/portal/people');
    await mustSettle(() => document.querySelector('table.data tbody tr td'), 8000, 'People never drew its list');
    const rowOf = (email) => [...document.querySelectorAll('table.data tbody tr')]
      .find((r) => r.innerText.indexOf(email) === 0 || r.innerText.indexOf(email) >= 0);
    // THE PILL, not the row's text. The pill sits flush against the address, so innerText runs the two
    // together and a word-boundary match on it finds nothing — an arm that would have reported the mark
    // missing while it was on the screen.
    out.youPill = ((rowOf('lawyer@cordillera.test') || document.createElement('tr')).querySelector('.pill') || {}).innerText || null;
    out.youHasModify = !!(rowOf('lawyer@cordillera.test') || document.createElement('tr')).querySelector('button.pill');
    out.otherPill = ((rowOf('owner@example.test') || document.createElement('tr')).querySelector('span.pill') || {}).innerText || null;
    out.otherHasModify = !!(rowOf('owner@example.test') || document.createElement('tr')).querySelector('button.pill');
    rowOf('owner@example.test').querySelector('button.pill').click();
    await mustSettle(() => /Modify access/.test(txt()), 8000, 'Modify did not open the form');
    out.path = location.pathname + location.search;
    out.email = (document.querySelector('.page-lede') || {}).innerText || null;
    out.ticked = [...document.querySelectorAll('button.attach-row')]
      .filter((b) => b.className.indexOf(' on') >= 0).map((b) => b.innerText.replace(/\\s+/g, ' ').trim());
    out.saveDisabledBefore = findByText('button', /Save changes/).disabled;
    findByText('button.attach-row', /Foxglade Interactive/).click();
    await sleep(250);
    out.sentence = (document.querySelector('.notice.quiet p') || {}).innerText || null;
    out.saveEnabledAfter = !findByText('button', /Save changes/).disabled;
    out.removeLabel = (maybeByText('button.pill', /^Remove from/) || {}).innerText || null;
  } catch (e) { out.fatal = String((e && e.message) || e); }
  return out;
})()
`

/** The confirmation, pressed open and read — never pressed through. */
const CONFIRM_SCRIPT = `
(async () => {
${HELPERS}
  const out = {};
  try {
    findByText('button.pill', /^Remove from/).click();
    await mustSettle(() => /Confirm . remove|Confirm — remove/.test(txt()), 8000, 'Remove did not ask');
    // NOT the first .notice — the sentence under the form is the quiet one and comes first in the
    // document, so that selector read the wrong paragraph and every assertion below reported the
    // confirmation's copy missing while it was on screen. The confirmation is the loud one.
    const loud = [...document.querySelectorAll('.notice:not(.quiet) p')];
    out.said = loud.length ? loud[loud.length - 1].innerText : null;
    // maybeByText, not findByText: absence is what is being measured here, and findByText THROWS on it,
    // so a double-negation of it can never be false and the arm would report a missing button as a crash.
    out.hasConfirm = !!maybeByText('button.pill', /Confirm/);
    out.hasCancel = !!maybeByText('button.pill', /^Cancel$/);
  } catch (e) { out.fatal = String((e && e.message) || e); }
  return out;
})()
`

/** The confirmation for a WHOLE DOMAIN, which is not one person losing access. */
const DOMAIN_SCRIPT = `
(async () => {
${HELPERS}
  const out = {};
  try {
    await goto('/portal/people');
    await mustSettle(() => document.querySelector('table.data tbody tr td'), 8000, 'People never drew its list');
    const row = [...document.querySelectorAll('table.data tbody tr')].find((r) => r.innerText.indexOf('*@example.test') >= 0);
    if (!row) { out.fatal = 'the domain row is not on the page'; return out; }
    row.querySelector('button.pill').click();
    await mustSettle(() => /Modify access/.test(txt()), 8000, 'Modify did not open for the domain row');
    out.removeLabel = (maybeByText('button.pill', /^Remove/) || {}).innerText || null;
    findByText('button.pill', /^Remove/).click();
    await mustSettle(() => /Confirm/.test(txt()), 8000, 'Remove did not ask');
    const loud = [...document.querySelectorAll('.notice:not(.quiet) p')];
    out.said = loud.length ? loud[loud.length - 1].innerText : null;
  } catch (e) { out.fatal = String((e && e.message) || e); }
  return out;
})()
`

/** The view-only person: what the rail offers, and whether the two gated pages exist for them at all. */
const READER_SCRIPT = `
(async () => {
${HELPERS}
  const out = {};
  try {
    await goto('/portal/clearances');
    await mustSettle(() => /Clearances/.test(txt()), 8000, 'the shell never painted for a view-only person');
    const rail = document.querySelector('.sidebar');
    out.railNav = rail ? [...rail.querySelectorAll('.nav-item')].map((b) => b.innerText.trim()).filter(Boolean) : [];
    await goto('/portal/new');
    await sleep(400);
    out.newIsAPage = !/That page does not exist/.test(txt());
    await goto('/portal/people');
    await sleep(400);
    out.peopleIsAPage = !/That page does not exist/.test(txt());
    // Projects without Manage: the list is readable, and there is no control that would only refuse.
    await goto('/portal/brand/projects');
    await mustSettle(() => /EU launch/.test(txt()), 8000, 'Projects never listed its projects for a view-only person');
    out.newProjectOffered = Boolean(maybeByText('button', /^New project$/));
    // Archive and Bring back live in each row's menu, so the menu's own button is what must be absent — a
    // search for the words alone passes for a manager too, whose menus are closed.
    out.archiveOffered = Boolean(maybeByText('button', /^(Archive|Bring back)$/))
      || Boolean(document.querySelector('button[aria-label="More actions"]'));
  } catch (e) { out.fatal = String((e && e.message) || e); }
  return out;
})()
`

/**
 * Profile's code-owned path rows, read under two identities against a payload that carries one. The
 * server strips it for anyone without access to everything, so the plant stands for a server that did
 * not: whoever holds everything reads it, and nobody else does, Manage or no Manage.
 */
const PROFILE_PATHS_SCRIPT = `
(async () => {
${HELPERS}
  const out = {};
  try {
    await goto('/portal/brand/profile');
    const drawn = () => Boolean(document.querySelector('.fw-sectionh'));
    const card = () => [...document.querySelectorAll('button.entry-card')].find((b) => b.innerText.includes(${JSON.stringify(NAME)}));
    await mustSettle(() => drawn() || card(), 8000, 'Profile drew neither the profile nor the company panel');
    if (!drawn()) { card().click(); await mustSettle(drawn, 8000, 'picking the company did not open its profile'); }
    out.shown = txt().includes('risk-framework-planted');
  } catch (e) { out.fatal = String((e && e.message) || e); }
  return out;
})()
`

/**
 * A row's "More actions" menu, driven: Retire, Bring back and Archive live there rather than on the row.
 *
 * Rows are read from the screen body only — the rail lists "Projects" and "Search templates" too, and a
 * search over the whole document finds those first.
 */
const ROW_MENU_HELPERS = `
  const rowOf = (label) => [...document.querySelectorAll('.main table.data tbody tr, .main .row-card')]
    .find((r) => r.innerText.includes(label));
  // Open a row's menu and read what it offers. Closed again unless the caller is about to pick from it.
  const menuOf = async (label, keepOpen) => {
    const row = rowOf(label);
    if (!row) throw new Error('no row reads ' + label);
    const button = row.querySelector('button[aria-label="More actions"]');
    if (!button) return [];
    button.click();
    await mustSettle(() => row.querySelector('[role="menu"]'), 3000, 'the menu on the ' + label + ' row never opened');
    const items = [...row.querySelectorAll('[role="menuitem"]')].map((i) => i.innerText.trim());
    if (!keepOpen) { button.click(); await sleep(80); }
    return items;
  };
  const pick = async (label, item) => {
    await menuOf(label, true);
    const it = [...rowOf(label).querySelectorAll('[role="menuitem"]')].find((i) => i.innerText.trim() === item);
    if (!it) throw new Error('the ' + label + ' row offers no ' + item);
    it.click();
    await sleep(200);
  };
`

/** Pass two (client only): the two lifecycles that had no controls. */
const LIFECYCLE_SCRIPT = `
(async () => {
${HELPERS}
${ROW_MENU_HELPERS}
  const out = { steps: [] };
  try {

  // ── search templates: list, retire, bring back ──
  await goto('/portal/brand/searches');
  if (!await settle(() => document.querySelector('.main table.data tbody tr'))) return { fatal: 'Search templates never drew its rows', body: txt().slice(0, 600) };
  out.listsRetired = /Retired/.test(txt());          // drawn from the CONFIG list, not the composer menu
  out.noEditorFields = !/How deep should it search/.test(txt());
  out.editButtons = allByText('button', /^Edit$/).length;
  // Each row's menu offers the one of the two its row can take.
  out.retireInMenu = (await menuOf('Launch screen')).includes('Retire');
  out.bringBackInMenu = (await menuOf('Old thing')).includes('Bring back');
  out.steps.push('list painted');

  await pick('Launch screen', 'Retire');
  out.confirmShown = /Confirm — retire/.test(txt());
  findByText('button', /Confirm — retire/).click();
  await mustSettle(() => rowOf('Launch screen') && /Retired/.test(rowOf('Launch screen').innerText), 6000, 'the retired search was not kept on the list, marked Retired');
  out.retiredThenListed = (await menuOf('Launch screen')).includes('Bring back');
  out.steps.push('retired');

  // ...and back, which is the half that did not exist at all before.
  await pick('Launch screen', 'Bring back');
  await mustSettle(() => rowOf('Launch screen') && !/Retired/.test(rowOf('Launch screen').innerText), 6000, 'the restored search is still marked Retired');
  out.broughtBack = (await menuOf('Launch screen')).includes('Retire');
  out.steps.push('brought back');

  // ── the composer, opened OVER a saved search ──
  await goto('/portal/new?search=launch-screen');
  if (!await settle(() => /Edit a search template/.test(txt()), 8000)) {
    return { ...out, fatal: 'the composer did not open in edit mode', body: txt().slice(0, 700) };
  }
  out.editHeading = /Edit a search template/.test(txt());
  const nameInput = [...document.querySelectorAll('input')].find((i) => i.getAttribute('aria-label') === 'Name this template');
  out.savePrefilled = nameInput ? nameInput.value : null;
  const noteInput = [...document.querySelectorAll('input')].find((i) => i.getAttribute('aria-label') === 'Note about this template');
  out.notePrefilled = noteInput ? noteInput.value : null;
  // The stored scope came back as a draft: one territory, one class.
  out.territoryHydrated = /United States/.test(txt());
  out.steps.push('hydrated');

  const saveBtn = maybeByText('button', /Save changes/);
  out.saveChangesLabel = Boolean(saveBtn);
  if (saveBtn) saveBtn.click();
  // The ADDRESS and the rows, not the words: the composer's own template menu is labelled "Search
  // templates", so a text wait passed before anything had returned anywhere.
  await mustSettle(() => location.pathname === '/portal/brand/searches' && document.querySelector('.main table.data tbody tr'), 8000,
    'the template list never returned after saving');
  out.returnedToList = location.pathname === '/portal/brand/searches';
  out.steps.push('saved');

  // ── projects: create ──
  await goto('/portal/brand/projects');
  await mustSettle(() => /New project/.test(txt()), 8000, 'the New project control never appeared');
  out.projectPath = location.pathname;
  out.projectCreateOffered = /New project/.test(txt());
  out.archivedProjectListed = /Old engagement/.test(txt());
  out.archivedProjectBadged = /Archived/.test(txt());
  out.bringBackOnProject = (await menuOf('Old engagement')).includes('Bring back');
  out.projectArchiveOnRow = (await menuOf('EU launch')).includes('Archive');
  findByText('button', /New project/).click();
  // "Project name" since the copy pass that shortened the label from "What is this
  // project called?". A driver that opens the real screen is the one thing that notices a rename like
  // this, and it noticed: the whole lifecycle failed here rather than anywhere near the cause.
  await mustSettle(() => /Project name/.test(txt()), 8000, 'the project name prompt never appeared');
  const pname = [...document.querySelectorAll('input')].find((i) => /EU launch 2027/.test(i.placeholder || ''));
  set(pname, 'Second engagement');
  await sleep(200);
  const keyBox = [...document.querySelectorAll('input')].find((i) => /eu-launch-2027/.test(i.placeholder || ''));
  out.keyDerived = keyBox ? keyBox.value : null;
  findByText('button', /Create project/).click();
  // Creating OPENS the new project — everything a project can carry is inherited until it is overridden,
  // so landing in its settings is the next thing anyone wants. Asserted, because it is a decision.
  await mustSettle(() => /Anything left blank is inherited/.test(txt()), 8000, 'the inheritance note never appeared');
  out.landedInEditor = /Anything left blank is inherited/.test(txt());
  out.steps.push('project created');

  // Back out the way a person would — the breadcrumb, not the address bar, and not the rail's own
  // Projects item, which comes first in the document now that Company settings opens into its pages.
  [...document.querySelectorAll('.main button')].find((b) => b.innerText.trim() === 'Projects').click();
  await mustSettle(() => /New project/.test(txt()), 8000, 'the New project screen never reopened');
  out.projectListed = /Second engagement/.test(txt());

  // ...and the composer must not OFFER an archived one. The wire carries it now, so this is the only
  // thing standing between a retired engagement and a clearance filed under it.
  await goto('/portal/new');
  // Same identity-dependent wait as above, same cure.
  await mustSettle(() => Boolean(document.querySelector('.ctx-card')), 8000,
    'the composer never painted its context card on return');
  const projectSelect = [...document.querySelectorAll('select')].find((s) => s.getAttribute('aria-label') === 'Project');
  out.composerProjectOptions = projectSelect ? [...projectSelect.options].map((o) => o.textContent.trim()) : null;
  return out;
  } catch (e) {
    // Without this the driver's own mistakes arrive as an empty object and read as twenty screen
    // failures, which is a slower way to find a typo than being told there was one.
    return { ...out, fatal: 'driver threw: ' + (e && e.stack ? e.stack : String(e)), body: txt().slice(0, 700) };
  }
})()
`

/**
 * Pass three: Company settings and New company, state by state, as the design draws them.
 *
 * Each state is a script that reaches it and READS it — what the rail lights, what each header offers,
 * whether a fold is open, which tags sit on which labels, what Create says. The verdict asserts those
 * readings; with --shot-dir each state is also captured in both themes, for a person to hold against the
 * design. Run as one company holding both switches and its organisation, so every control is offered.
 */
const SETTINGS_HELPERS = `
  // What the rail lights, and which of Company settings' pages it lists — from the rail alone.
  const rail = () => {
    const sidebar = document.querySelector('.sidebar');
    const parent = sidebar && [...sidebar.querySelectorAll('button.nav-item')].find((b) => b.innerText.trim() === 'Company settings');
    const sub = parent && parent.parentElement.querySelector('.nav-sub');
    return {
      parent: Boolean(parent), parentActive: Boolean(parent && parent.classList.contains('active')),
      children: sub ? [...sub.querySelectorAll('button.nav-item')].map((b) => ({ label: b.innerText.trim(), active: b.classList.contains('active') })) : [],
    };
  };
  const header = () => [...document.querySelectorAll('.main .page-header-actions button')]
    .map((b) => ({ text: b.innerText.trim(), primary: b.classList.contains('btn-primary'), secondary: b.classList.contains('btn-ghost'), disabled: b.disabled }));
  // A field's label WITHOUT its tag, and the tag's own words. textContent, not innerText: the tag is drawn
  // uppercase, and the words are what the design specifies.
  const fields = () => [...document.querySelectorAll('.main .profile-field')].map((f) => {
    const label = f.querySelector('.profile-field-label');
    const tag = label && label.querySelector('.field-tag');
    return { label: label ? label.firstChild.textContent.trim() : null, tag: tag ? tag.textContent : null,
      hint: (f.querySelector('.profile-field-hint') || {}).textContent || null };
  });
  const cards = () => [...document.querySelectorAll('.main .ctx-card')].map((c) => {
    const eyebrow = c.querySelector(':scope > .eyebrow');
    const tag = eyebrow && eyebrow.querySelector('.field-tag');
    const fold = c.tagName === 'DETAILS' ? c.querySelector(':scope > summary') : null;
    return { title: eyebrow ? eyebrow.firstChild.textContent.trim() : fold ? fold.querySelector('.fold-title').textContent : null,
      tag: tag ? tag.textContent : null, fold: Boolean(fold), note: fold ? (fold.querySelector('.fold-note') || {}).textContent || null : null,
      open: c.tagName === 'DETAILS' ? c.open : null };
  });
  const folds = () => [...document.querySelectorAll('.main details')].map((d) => ({
    title: (d.querySelector(':scope > summary .fold-title') || {}).textContent || null, open: d.open,
    // The chevron's place: at the row's right edge, which is what "at the right edge" can be measured as.
    chevronAtRight: (() => { const s = d.querySelector(':scope > summary'); const c = s && s.querySelector('.fold-chev');
      return Boolean(s && c) && Math.abs(s.getBoundingClientRect().right - c.getBoundingClientRect().right) <= 24; })(),
  }));
  // checkVisibility, not a box count: Chrome keeps layout boxes for a closed fold's content and simply does
  // not paint them, so getClientRects reads a folded row as on screen.
  const visible = (el) => Boolean(el) && el.checkVisibility();
  const openFold = async (title) => {
    const d = [...document.querySelectorAll('.main details')].find((x) => (x.querySelector(':scope > summary .fold-title') || {}).textContent === title);
    if (!d) throw new Error('no fold titled ' + title);
    if (!d.open) d.querySelector(':scope > summary').click();
    await mustSettle(() => d.open, 2000, 'a fold did not open: ' + title);
    await sleep(150);
  };
  const fieldControl = (label) => {
    const f = [...document.querySelectorAll('.main .profile-field')].find((x) => {
      const l = x.querySelector('.profile-field-label'); return l && l.firstChild.textContent.trim() === label; });
    return f ? f.querySelector('input, textarea, select') : null;
  };
`

const SETTINGS_STATES = [
  { name: 'profile-folds-closed', script: `
    // EVERY WORDING THE PERMITTED SEARCHES ROW TAKES ON THE WAY IN, not only the last. A row that read
    // "2 searches not on Search templates" until the listing answered would still settle on the names,
    // and a wait for any words at all is satisfied by the wrong ones. The stub answers that listing late
    // in this pass, so the window is there to be seen.
    const permittedRow = () => [...document.querySelectorAll('.fw-row')].find((r) => r.querySelector('.fw-row-label').textContent === 'Permitted searches');
    const permittedSeen = [];
    const watch = new MutationObserver(() => {
      const r = permittedRow(); const v = r ? r.querySelector('.fw-row-value').textContent.trim() : '';
      if (v && permittedSeen[permittedSeen.length - 1] !== v) permittedSeen.push(v);
    });
    watch.observe(document.body, { subtree: true, childList: true, characterData: true });
    await goto('/portal/brand/profile');
    // One company among two in the switcher (its organisation's Generic is the other), so pick it.
    const sw = document.querySelector('select[aria-label="Company"]');
    if (sw && sw.value !== '${KEY}') { set(sw, '${KEY}'); await sleep(600); }
    await mustSettle(() => document.querySelector('.fw-sectionh') && document.querySelector('.fw-row'), 8000, 'Profile never drew its framework card');
    await mustSettle(() => permittedRow() && permittedRow().querySelector('.fw-row-value').textContent.trim() !== '', 8000, 'Permitted searches never named its templates');
    await sleep(300);
    watch.disconnect();
    window.scrollTo(0, 0);
    const depth = fieldControl('Default search depth');
    return { path: location.pathname, rail: rail(), header: header(), fields: fields(), cards: cards(), folds: folds(),
      title: (document.querySelector('.main .page-title') || {}).textContent,
      rows: [...document.querySelectorAll('.fw-row')].map((r) => [r.querySelector('.fw-row-label').textContent, r.querySelector('.fw-row-value').textContent]),
      bandRowsVisible: [...document.querySelectorAll('.fw-bmrow')].filter(visible).length,
      ratedOnVisible: /Rated on:/.test(txt()), entityVisible: /Entity in prose:/.test(txt()),
      coverageVisible: /Calculated from the marketplaces and density above/.test(txt()),
      ladder: [...document.querySelectorAll('.fw-ladder .pill')].map((p) => p.textContent),
      guide: (() => { const a = [...document.querySelectorAll('.main a')].find((x) => x.textContent === 'Use your own risk framework');
        return a ? { pill: a.classList.contains('pill'), newTab: a.target === '_blank' } : null; })(),
      depthOptions: depth && depth.tagName === 'SELECT' ? [...depth.options].map((o) => o.textContent) : null,
      depthSelected: depth && depth.tagName === 'SELECT' ? depth.selectedOptions[0].textContent : null,
      classAdd: Boolean([...document.querySelectorAll('.main .profile-field-label')].find((l) => l.textContent === 'Add a class')),
      classChips: [...document.querySelectorAll('.main .class-picker .chip')].map((c) => c.textContent.trim()),
      save: (() => { const b = [...document.querySelectorAll('.main .row-foot button')][0];
        return b ? { text: b.textContent, disabled: b.disabled, primary: b.classList.contains('btn-primary') } : null; })(),
      saveNote: (document.querySelector('.main .row-foot-note') || {}).textContent || null,
      checkButton: Boolean([...document.querySelectorAll('.main button')].find((b) => b.textContent.trim() === 'Check')),
      characters: /\\d+ \\/ 8,000 characters/.test(txt()), permittedSeen };
  ` },
  { name: 'profile-folds-open', script: `
    await openFold('What the bands mean');
    await openFold('Search details');
    return { folds: folds(), bandRowsVisible: [...document.querySelectorAll('.fw-bmrow')].filter(visible).length,
      ratedOnVisible: /Rated on:/.test(txt()), entityVisible: /Entity in prose:/.test(txt()),
      coverage: ([...document.querySelectorAll('.main details p')].find((p) => /Calculated from/.test(p.textContent)) || {}).textContent || null,
      rowsStillVisible: [...document.querySelectorAll('.fw-row')].filter(visible).length };
  ` },
  { name: 'profile-unsaved', script: `
    // A CLASS ADDED THE WAY A PERSON ADDS ONE: a word typed into the search box, and the match picked from
    // what it offers. The box replaced a grid of numbers, and only a pick shows it still writes the field.
    const box = document.querySelector('.main .class-picker-box input');
    if (!box) throw new Error('the class search box is not on screen');
    box.focus();
    set(box, 'cloth');
    const matches = () => [...document.querySelectorAll('.main .class-picker-box .typeahead button')];
    await mustSettle(() => matches().some((b) => b.textContent.startsWith('25 · ')), 3000, 'typing "cloth" did not offer class 25');
    const offered = matches().map((b) => b.textContent);
    matches().find((b) => b.textContent.startsWith('25 · ')).click();
    await mustSettle(() => [...document.querySelectorAll('.main .class-picker .chip')].some((c) => c.textContent.trim().startsWith('25 · ')), 3000, 'picking class 25 added no chip');
    window.scrollTo(0, 0);
    const save = [...document.querySelectorAll('.main .row-foot button')][0];
    return { offered, box: box.value, classChips: [...document.querySelectorAll('.main .class-picker .chip')].map((c) => c.textContent.trim()),
      save: save ? { text: save.textContent, disabled: save.disabled } : null,
      saveNote: (document.querySelector('.main .row-foot-note') || {}).textContent || null };
  ` },
  { name: 'profile-saved', shot: false, script: `
    const note = () => (document.querySelector('.main .row-foot-note') || {}).textContent || null;
    // The page's own outcome notices, under the form — not the framework card's, which are notices too.
    const notices = () => [...document.querySelectorAll('.main .measure > .notice > b')].map((b) => b.textContent);
    try {
      [...document.querySelectorAll('.main .row-foot button')][0].click();
      await mustSettle(() => notices().includes('Saved'), 8000, 'one press of Save never said Saved');
      // THE STUB ANSWERS A SAVE AND KEEPS NOTHING, so the reload after it serves the profile as it was: class
      // 25 leaves the chips and the note goes back to "No changes". That is the stub, not the screen — what
      // the press sent is read off the wire in the verdict.
      await mustSettle(() => note() === 'No changes', 8000, 'the form did not settle after saving');
      return { notices: notices(), saveNote: note() };
    } finally {
      // A save that did not land leaves the form dirty, and a dirty form asks before the next state may leave
      // it, in a dialog this driver cannot answer. The class comes back out, so a failure here reads as one.
      const x = document.querySelector('.main .class-picker button[aria-label="Remove class 25"]');
      if (note() === 'Unsaved changes' && x) { x.click(); await sleep(200); }
    }
  ` },
  { name: 'search-templates', script: `
    await goto('/portal/brand/searches');
    await mustSettle(() => document.querySelector('.main table.data tbody tr'), 8000, 'Search templates never drew its rows');
    window.scrollTo(0, 0);
    return { path: location.pathname, rail: rail(), header: header(),
      columns: [...document.querySelectorAll('.main table.data thead th')].map((t) => t.textContent),
      names: [...document.querySelectorAll('.main table.data tbody tr td:first-child b')].map((b) => b.textContent),
      buildsOn: [...document.querySelectorAll('.main table.data tbody tr td:nth-child(2)')].map((t) => t.innerText.trim()),
      edits: [...document.querySelectorAll('.main table.data tbody button')].filter((b) => b.textContent === 'Edit').length,
      menus: document.querySelectorAll('.main table.data tbody button[aria-label="More actions"]').length,
      rowButtons: [...document.querySelectorAll('.main table.data tbody button')].map((b) => b.textContent.trim()).filter(Boolean) };
  ` },
  { name: 'search-templates-menu', script: `
    const row = [...document.querySelectorAll('.main table.data tbody tr')].find((r) => r.innerText.includes('Launch screen'));
    row.querySelector('button[aria-label="More actions"]').click();
    await mustSettle(() => row.querySelector('[role="menu"]'), 3000, 'the row menu never opened');
    return { items: [...row.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent) };
  ` },
  { name: 'projects', script: `
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await goto('/portal/brand/projects');
    await mustSettle(() => document.querySelector('.main .row-card'), 8000, 'Projects never drew its rows');
    window.scrollTo(0, 0);
    return { path: location.pathname, rail: rail(), header: header(),
      rows: [...document.querySelectorAll('.main .row-card')].map((r) => r.querySelector('.row-card-name').textContent),
      menus: document.querySelectorAll('.main .row-card button[aria-label="More actions"]').length,
      rowButtons: [...document.querySelectorAll('.main .row-card button')].map((b) => b.textContent.trim()).filter(Boolean) };
  ` },
  { name: 'new-company-empty', script: `
    await goto('/portal/brand/new');
    await mustSettle(() => [...document.querySelectorAll('.main .row-foot button')].some((b) => b.textContent === 'Create'), 8000, 'New company never drew Create');
    window.scrollTo(0, 0);
    const create = [...document.querySelectorAll('.main .row-foot button')].find((b) => b.textContent === 'Create');
    return { path: location.pathname, rail: rail(), header: header(), fields: fields(), cards: cards(),
      title: (document.querySelector('.main .page-title') || {}).textContent,
      lede: Boolean(document.querySelector('.main .page-lede')),
      create: { disabled: create.disabled, primary: create.classList.contains('btn-primary') },
      unmet: (document.querySelector('.main .row-foot-note') || {}).textContent || null,
      changeKey: /Change it|Change the key/.test(txt()),
      checkButton: Boolean([...document.querySelectorAll('.main button')].find((b) => b.textContent.trim() === 'Check')),
      rating: (document.querySelector('.main .rating-row') || {}).innerText || null,
      topbar: (document.querySelector('.topbar h1') || {}).textContent };
  ` },
  { name: 'new-company-named', script: `
    set(fieldControl('Legal name'), 'Aurora Botanicals');
    await mustSettle(() => [...document.querySelectorAll('.main .row-foot button')].some((b) => b.textContent === 'Create' && !b.disabled), 3000, 'Create stayed disabled with a name');
    window.scrollTo(0, 0);
    const create = [...document.querySelectorAll('.main .row-foot button')].find((b) => b.textContent === 'Create');
    return { create: { disabled: create.disabled }, unmet: (document.querySelector('.main .row-foot-note') || {}).textContent || null,
      tradingNames: (fieldControl('Own trading names') || {}).value || null };
  ` },
]

// ── chrome ──────────────────────────────────────────────────────────────────────────────────────────

// The profile goes inside a run root whose TMPDIR the browser inherits, so the singleton
// lock it writes there leaves with the root instead of accumulating in the shared one.
const { profile: userDir, env: chromeEnv, keep: keepRoot } = browserRun("lifecycle-check-")
// --keep means LEAVE THE PROFILE: take the run root out of the exit sweep, or the flag
// would go on reading as working while the directory it promises is removed anyway.
if (keep) keepRoot()
const chrome = spawn('google-chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--user-data-dir=${userDir}`, '--window-size=1280,900',
  '--remote-debugging-port=0', `${origin}/portal/clearances`,
], { stdio: ['ignore', 'pipe', 'pipe'], env: chromeEnv })

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
const evalIn = (expr) => cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
const value = async (expr) => (await evalIn(expr)).result?.result?.value ?? null

/** A full reload, so `me` is re-fetched under the role the stub is now serving. */
const reload = async () => {
  await cmd('Page.navigate', { url: `${origin}/portal/clearances` })
  await new Promise((r) => setTimeout(r, 1800))
}

await new Promise((r) => setTimeout(r, 1500))

role = 'client'
await reload()
const asClient = await value(NAMES_SCRIPT)

role = 'staff'
await reload()
const asStaff = await value(NAMES_SCRIPT)
const people = await value(PEOPLE_SCRIPT)
// BEFORE the local-sign-in pass, deliberately. That pass serves a guest list of ONE — the person signed
// in — so the row this drives would not be on the page at all, and the failure reads as "Modify is
// broken" rather than "the fixture moved underneath it".
await reload()
const modify = await value(MODIFY_SCRIPT)
if (shotsDir) {
  const shot = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  const data = shot.result?.result?.data ?? shot.result?.data
  if (data) writeFileSync(join(shotsDir, 'people-modify.png'), Buffer.from(data, 'base64'))
}
const confirm = modify && !modify.fatal ? await value(CONFIRM_SCRIPT) : { fatal: 'the form never opened' }
if (shotsDir) {
  // TAKEN WITH THE CONFIRMATION OPEN — the state a reader is actually shown before they act, which is
  // the one worth a picture. A shot of the pre-confirm pill shows a button, not a decision.
  const shot = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  const data = shot.result?.result?.data ?? shot.result?.data
  if (data) writeFileSync(join(shotsDir, 'people-remove-confirm.png'), Buffer.from(data, 'base64'))
}
await reload()
const domainRow = await value(DOMAIN_SCRIPT)
if (shotsDir) {
  // The third state a person sees, and the one whose words differ most from the other two.
  const shot = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  const data = shot.result?.result?.data ?? shot.result?.data
  if (data) writeFileSync(join(shotsDir, 'people-remove-domain.png'), Buffer.from(data, 'base64'))
}

keysRevocable = false
await reload()
const modifyNoRevoke = await value(MODIFY_SCRIPT)
const confirmNoRevoke = modifyNoRevoke && !modifyNoRevoke.fatal ? await value(CONFIRM_SCRIPT) : { fatal: 'the form never opened' }
keysRevocable = true

localMode = true
await reload()
const peopleLocal = await value(PEOPLE_LOCAL_SCRIPT)
if (shotsDir) {
  const shot = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  const data = shot.result?.result?.data ?? shot.result?.data
  if (data) writeFileSync(join(shotsDir, 'people-local-sign-in.png'), Buffer.from(data, 'base64'))
}
localMode = false
await reload()
const pathsStaff = await value(PROFILE_PATHS_SCRIPT)

role = 'multi'
await reload()
const asMulti = await value(NAMES_SCRIPT)

role = 'reader'
await reload()
const asReader = await value(READER_SCRIPT)

role = 'owner'
await reload()
const pathsOwner = await value(PROFILE_PATHS_SCRIPT)
await reload()
const life = await value(LIFECYCLE_SCRIPT)

// ── Company settings, state by state ───────────────────────────────────────────────────────────────
//
// A FULL-HEIGHT VIEWPORT for each capture, not a beyond-viewport one: the rail is sticky, and a
// beyond-viewport capture paints sticky and fixed elements where the 900px viewport put them.
const capture = async (path) => {
  const h = (await evalIn('Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)')).result?.result?.value ?? 900
  await cmd('Emulation.setDeviceMetricsOverride', { width: 1280, height: Math.max(900, h), deviceScaleFactor: 1, mobile: false })
  await new Promise((r) => setTimeout(r, 400))
  const shot = await cmd('Page.captureScreenshot', { format: 'png' })
  await cmd('Emulation.clearDeviceMetricsOverride', {})
  const data = shot.result?.result?.data ?? shot.result?.data
  if (!data) throw new Error(`no screenshot came back for ${path}`)
  writeFileSync(path, Buffer.from(data, 'base64'))
}
role = 'settings'
await reload()
const settings = {}
const settingsPostedFrom = posted.length
for (const st of SETTINGS_STATES) {
  const got = await value(`(async () => { ${HELPERS} ${SETTINGS_HELPERS} try { ${st.script} } catch (e) { return { fatal: String((e && e.message) || e), body: txt().slice(0, 600) }; } })()`)
  settings[st.name] = got ?? { fatal: 'the state returned nothing' }
  if (!shotDir || !got || got.fatal || st.shot === false) continue
  await capture(join(shotDir, `company-settings-${st.name}-light.png`))
  await evalIn(`document.documentElement.setAttribute('data-theme','dark'); 'ok'`)
  await new Promise((r) => setTimeout(r, 300))
  await capture(join(shotDir, `company-settings-${st.name}-dark.png`))
  await evalIn(`document.documentElement.removeAttribute('data-theme'); 'ok'`)
}
// The typed name makes the create form dirty, and a dirty form asks before anything leaves it.
await value(`(async () => { ${HELPERS} ${SETTINGS_HELPERS} const n = fieldControl('Legal name'); if (n) set(n, ''); await sleep(100); return true })()`)

if (shotAt) {
  await evalIn(`(async () => { history.pushState({}, '', '/portal/brand/searches'); window.dispatchEvent(new PopStateEvent('popstate')); await new Promise(r => setTimeout(r, 700)); })()`)
  const shot = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  const data = shot.result?.result?.data ?? shot.result?.data
  if (data) writeFileSync(shotAt, Buffer.from(data, 'base64'))
}

chrome.kill()
server.close()
await new Promise((r) => setTimeout(r, 400))
if (!keep) { try { rmSync(userDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* a stray profile dir is not a test result */ } }

// ── verdict ─────────────────────────────────────────────────────────────────────────────────────────

const fail = []
const ok = (cond, msg) => { if (!cond) fail.push(msg) }

// Which end of the bar must name the owner, per identity. A switcher identity reads it in the rail; a
// single-owner identity reads it in the topbar Account corner. Both are asserted, and so is the
// ABSENCE of the other — a name in both places at once is the repetition the 07-28 ruling removed.
// ONE SHAPE FOR EVERY IDENTITY — there is no per-role layout, and there is no longer a per-QUANTITY one
// either. The switcher used to be withheld from an identity with a single company, so this loop asked a
// different question of each login: switchers read the rail, everyone else read the topbar corner. Both
// halves of that are retired. The switcher renders on every install, and the corner carries the
// organisation rather than the company, so every login is asked the same two questions below.
for (const [who, out] of [['client', asClient], ['staff', asStaff], ['multi-account client', asMulti]]) {
  if (!out || out.fatal) { fail.push(`${who}: ${out?.fatal ?? 'the driver returned nothing'}`); continue }
  ok(out.railOwner.some((t) => t.includes(NAME)),
    `${who}: the rail switcher does not name the company — read ${JSON.stringify(out.railOwner)}`)
  ok(out.railHasOwnerBlock,
    `${who}: the rail carries no company block — the switcher renders on every install, whatever is in it`)
  // ONE SLOT, ONE NOUN. The company is read in the rail and in the heading; the corner is the
  // organisation. A company name appearing here is the dual meaning coming back.
  ok(!(out.accountCorner ?? '').includes(NAME),
    `${who}: the identity corner names the company — read ${JSON.stringify(out.accountCorner)}`)
  ok((out.clearancesHeading ?? '').includes(NAME),
    `${who}: the Clearances header does not name the company being looked at — read ${JSON.stringify(out.clearancesHeading)}`)
  ok(out.composerCompany?.includes(NAME), `${who}: the New clearance form does not name the company — read ${JSON.stringify(out.composerCompany)}`)
  ok(out.nameOnScreen, `${who}: the company's name is nowhere on the composer`)
  ok(!out.slugOnScreen, `${who}: the account KEY "${KEY}" is printed on screen where the name belongs`)
}
// The regression this whole change is for: every login must agree, word for word.
const headings = [['client', asClient], ['staff', asStaff], ['multi-account client', asMulti]]
  .filter(([, o]) => o && !o.fatal)
for (const [who, out] of headings) {
  ok(out.clearancesCompany === headings[0][1].clearancesCompany,
    `the same company reads "${out.clearancesCompany}" to a ${who} and "${headings[0][1].clearancesCompany}" to a ${headings[0][0]}`)
}

// The multi-account client is the ONLY identity whose switcher is populated from `me` rather than from
// the roster, and it is the login the bug was reported from. Its options must be NAMES.
if (asMulti && !asMulti.fatal) {
  ok(asMulti.railKind === 'select', 'a client with several grants must get the company switcher')
  ok(asMulti.railOwner.includes(NAME) && asMulti.railOwner.includes(NAME2),
    `the switcher lists keys rather than names for a multi-account client: ${JSON.stringify(asMulti.railOwner)}`)
  ok(!asMulti.railOwner.some((t) => t === KEY || t === KEY2),
    `a raw account key is in the company pulldown: ${JSON.stringify(asMulti.railOwner)}`)
  // Ordered by what is READ. "Foxglade Interactive" before "Vantor Labs" — which is also the opposite of
  // the order the grants list them in, so a pass-through would show.
  ok(asMulti.railOwner[0] === NAME2, `the switcher is not sorted by name: ${JSON.stringify(asMulti.railOwner)}`)
}

// ── the access model's screens ──────────────────────────────────────────────────────────────────────
// Two organisations visible: the switcher heads its rows by organisation, one Generic under each, and the
// top bar names none of them. One organisation visible: no heading, and the bar names it. People is in
// the avatar menu for Manage, directly above Global config, and in the rail for nobody; New clearance is
// in the rail for Run and nowhere else. Each Generic in the switcher carries its Default tag as words.
if (asStaff && !asStaff.fatal) {
  ok(JSON.stringify(asStaff.railGroups) === JSON.stringify(['Apmxc Group', 'Foxglade Group']),
    `two organisations visible, but the switcher's headings read ${JSON.stringify(asStaff.railGroups)}`)
  ok(asStaff.genericOptions === 2, `each organisation's Generic should be offered once — the switcher offers ${asStaff.genericOptions}`)
  ok(asStaff.accountCorner === null,
    `a person who can see two organisations is named one of them in the top bar: ${JSON.stringify(asStaff.accountCorner)}`)
  ok(asStaff.genericLabels.length === 2 && asStaff.genericLabels.every((t) => /\(Default\)$/.test(t)),
    `each Generic in the switcher should read as the Default: ${JSON.stringify(asStaff.genericLabels)}`)
  ok(!asStaff.railOwner.some((t) => /\(Default\)$/.test(t) && !/Generic/.test(t)),
    `a company other than Generic carries the Default tag: ${JSON.stringify(asStaff.railOwner)}`)
  ok(!asStaff.railNav.includes('People'), `People is back in the rail: ${JSON.stringify(asStaff.railNav)}`)
  const peopleAt = asStaff.avatarMenu.indexOf('People')
  ok(peopleAt >= 0 && asStaff.avatarMenu[peopleAt + 1] === 'Global config',
    `People should sit directly above Global config in the avatar menu of a person with Manage: ${JSON.stringify(asStaff.avatarMenu)}`)
}
for (const [who, out] of [['client', asClient], ['multi-account client', asMulti]]) {
  if (!out || out.fatal) continue
  ok(out.railGroups.length === 0, `${who}: one organisation visible, yet the switcher draws headings ${JSON.stringify(out.railGroups)}`)
  ok(out.accountCorner === 'Apmxc Group', `${who}: the top bar should name the one organisation — read ${JSON.stringify(out.accountCorner)}`)
  ok(!out.railNav.includes('People'), `${who}: People is in the rail for a person without Manage`)
  ok(out.avatarMenu.length >= 2, `${who}: the avatar menu was not read: ${JSON.stringify(out.avatarMenu)}`)
  ok(!out.avatarMenu.includes('People'), `${who}: People is in the avatar menu for a person without Manage: ${JSON.stringify(out.avatarMenu)}`)
  ok(out.railNav.includes('New clearance'), `${who}: New clearance is missing for a person who may run clearances`)
}
if (!people || people.fatal) {
  fail.push(`people: ${people?.fatal ?? 'the driver returned nothing'}`)
} else {
  ok(people.rows.length === 5, `People should list the five rows it was sent — it drew ${people.rows.length}`)
  ok(people.rows.some((r) => r[1] === 'Runs clearances · Manages' && /Everything/.test(r[2] ?? '')),
    `no row reads both permissions with access to everything: ${JSON.stringify(people.rows)}`)
  ok(people.rows.some((r) => r[1] === 'View reports'), `the view-only person is not described as such: ${JSON.stringify(people.rows)}`)
  // THE OTHER SHAPE, SAID APART. Somebody who exists only in a company's access list has no permissions
  // entry to read, and calling that "View reports" says the file does not say: that somebody decided
  // this person may only view. The page has drawn the distinction since it was written; the field it
  // keys on was being dropped between the server and the screen, so it had never once appeared.
  ok(people.rows.some((r) => /Reach only/.test(r[1] ?? '')),
    `a person listed only in a company's access list is still described as view-only: ${JSON.stringify(people.rows)}`)
  ok(!people.rows.some((r) => /staff|client/i.test(r.join(' '))), `a role word is back on People: ${JSON.stringify(people.rows)}`)
  ok(people.addDisabled === false && !people.localNotice, 'a hosted install offers Add, with no local sign-in notice')
  ok(people.path === '/portal/people/add', `Add a person opened ${people.path}`)
  ok(/will see everything under Apmxc Group, and can run clearances there/.test(people.sentence ?? ''),
    `the form does not say what the new person will see: ${JSON.stringify(people.sentence)}`)
  ok(/cannot add companies or people/.test(people.sentence ?? ''), `the form does not say what they cannot do: ${JSON.stringify(people.sentence)}`)
  ok(people.saveEnabled === true, 'Save is off with an address and a choice made')
}

// ── MODIFY AND REMOVE ───────────────────────────────────────────────────────────────────────────────
if (!modify || modify.fatal) {
  ok(false, `the Modify form could not be driven: ${modify?.fatal ?? 'no answer'}`)
} else {
  ok(modify.youHasModify === false, 'your own row offers Modify — nobody changes their own permissions')
  ok((modify.youPill ?? '').trim() === 'You', `your own row is not marked You: ${JSON.stringify(modify.youPill)}`)
  ok(modify.otherPill === null, `somebody else's row is marked You: ${JSON.stringify(modify.otherPill)}`)
  ok(modify.otherHasModify === true, 'another person\'s row offers no way in')
  ok((modify.path ?? '').startsWith('/portal/people/modify?email='),
    `Modify opened ${modify.path} rather than the form, carrying which person in the query`)
  ok(/owner@example\.test/.test(modify.email ?? ''), `the form does not name whose access it is: ${JSON.stringify(modify.email)}`)
  // FILLED IN. The whole design decision is that this is the Add form showing what the person HOLDS, so
  // a form that opened blank would look almost right and be the one thing it must not be.
  ok((modify.ticked ?? []).some((t) => /Apmxc Group/.test(t)) && (modify.ticked ?? []).some((t) => /Foxglade Interactive/.test(t)),
    `the form did not open filled in with what they hold: ${JSON.stringify(modify.ticked)}`)
  ok(modify.saveDisabledBefore === true, 'Save is live on a form nobody has changed yet')
  ok(modify.saveEnabledAfter === true, 'Save stayed off after a row was unticked')
  // THE SENTENCE THE ADD FORM NEVER NEEDED.
  ok(/lose/i.test(modify.sentence ?? '') && /Foxglade Interactive/.test(modify.sentence ?? ''),
    `the form does not say what they lose before it is saved: ${JSON.stringify(modify.sentence)}`)
  ok(/^Remove from Clearotron/.test(modify.removeLabel ?? ''),
    `a viewer who can see all of somebody is not offered the whole removal: ${JSON.stringify(modify.removeLabel)}`)
}

if (!confirm || confirm.fatal) {
  ok(false, `the removal confirmation could not be read: ${confirm?.fatal ?? 'no answer'}`)
} else {
  ok(confirm.hasConfirm === true && confirm.hasCancel === true, 'the confirmation does not offer both answers')
  // WHAT A READER AGREES TO, before they agree to it: who loses what, when, and the half this product
  // does not own.
  ok(/owner@example\.test/.test(confirm.said ?? ''), `the confirmation does not name the person: ${JSON.stringify(confirm.said)}`)
  ok(/straight away/.test(confirm.said ?? ''), `the confirmation does not say when: ${JSON.stringify(confirm.said)}`)
  ok(/through their AI/.test(confirm.said ?? ''), `the confirmation does not say the assistant loses it too: ${JSON.stringify(confirm.said)}`)
  ok(/login system/.test(confirm.said ?? ''), `the confirmation does not say what this product cannot do: ${JSON.stringify(confirm.said)}`)
  // THIS PERSON HOLDS AN ISSUED KEY. The portal can say it wrote the revocation list; it cannot say the
  // connector loaded one, because that is a different service with a different environment. So the
  // sentence names where to go and see, rather than promising on a reading of somebody else's setup.
  ok(/key is withdrawn at the same time/.test(confirm.said ?? ''),
    `a key holder's removal does not mention the key: ${JSON.stringify(confirm.said)}`)
  ok(/doctor/.test(confirm.said ?? ''),
    `it does not say where to see whether the connector picked it up: ${JSON.stringify(confirm.said)}`)
}

if (!domainRow || domainRow.fatal) {
  ok(false, `the domain row's confirmation could not be read: ${domainRow?.fatal ?? 'no answer'}`)
} else {
  ok(/everyone at example\.test/.test(domainRow.removeLabel ?? ''),
    `the button for a whole domain reads as one person's removal: ${JSON.stringify(domainRow.removeLabel)}`)
  ok(/everyone with an address at/.test(domainRow.said ?? ''),
    `the confirmation does not say a domain takes access from everyone there: ${JSON.stringify(domainRow.said)}`)
}

// THE OTHER BRANCH OF THAT SENTENCE. The same press, on an installation whose connector was started
// without a revocation list. "Through their AI" is not true there, so it must not be printed there.
if (!confirmNoRevoke || confirmNoRevoke.fatal) {
  ok(false, `the confirmation could not be read where keys cannot be withdrawn: ${confirmNoRevoke?.fatal ?? 'no answer'}`)
} else {
  ok(!/through their AI/.test(confirmNoRevoke.said ?? ''),
    `the confirmation promises the assistant loses access on an installation that cannot withdraw the key: ${JSON.stringify(confirmNoRevoke.said)}`)
  ok(/until it expires/.test(confirmNoRevoke.said ?? ''),
    `it does not say the key keeps working: ${JSON.stringify(confirmNoRevoke.said)}`)
  ok(/straight away/.test(confirmNoRevoke.said ?? ''),
    `it stopped saying what IS immediate: ${JSON.stringify(confirmNoRevoke.said)}`)
  ok(!/withdrawn at the same time/.test(confirmNoRevoke.said ?? ''),
    `it says the key is withdrawn on an installation that names no revocation list: ${JSON.stringify(confirmNoRevoke.said)}`)
}
if (!peopleLocal || peopleLocal.fatal) {
  fail.push(`people (local sign-in): ${peopleLocal?.fatal ?? 'the driver returned nothing'}`)
} else {
  ok(peopleLocal.addDisabled === true, 'Add is offered on an install that signs one person in locally')
  ok(peopleLocal.rows === 2, `local sign-in should list every address in its record — it drew ${peopleLocal.rows} rows`)
  // PRESENT AND OFF, never absent. A control that vanished leaves a reader hunting for it; one visibly
  // off, under the notice that explains it, answers the question before it is asked.
  ok(peopleLocal.otherModifyPresent === true, 'Modify is gone from the other row rather than disabled — a reader will hunt for it')
  ok(peopleLocal.otherModifyDisabled === true,
    'Modify is live on an install whose change route refuses: pressing it reaches a form whose Save and Remove both fail')
  ok(peopleLocal.linkHref === `${STUB_SOURCE_REPO}/blob/main/docs/PORTAL.md#putting-your-own-login-provider-in-front`,
    `the local sign-in notice must link to the stated source repository's guide to a login system in front — it links to ${JSON.stringify(peopleLocal.linkHref)}`)
}
if (!asReader || asReader.fatal) {
  fail.push(`view-only person: ${asReader?.fatal ?? 'the driver returned nothing'}`)
} else {
  ok(!asReader.railNav.includes('New clearance'), `a view-only person is offered New clearance: ${JSON.stringify(asReader.railNav)}`)
  ok(!asReader.railNav.includes('People'), 'a view-only person is offered People')
  ok(!asReader.newIsAPage, 'New clearance opens for a person who may not start one')
  ok(!asReader.peopleIsAPage, 'People opens for a person without Manage')
  ok(asReader.newProjectOffered === false, 'Projects offers New project to a person without Manage')
  ok(asReader.archiveOffered === false, 'Projects offers Archive or Bring back to a person without Manage')
}
// PROFILE'S PATH ROWS, the portal's own wall, driven. Staff is the control: it proves the plant reaches the
// page, without which "the owner does not see it" would pass on a Profile that renders no path for anyone.
for (const [who, out, shown] of [['staff', pathsStaff, true], ['owner', pathsOwner, false]]) {
  if (!out || out.fatal) { fail.push(`profile paths (${who}): ${out?.fatal ?? 'the driver returned nothing'}`); continue }
  ok(out.shown === shown, `${who}: Profile ${out.shown ? 'shows' : 'hides'} the framework's path, and should ${shown ? 'show' : 'hide'} it`)
}

if (!life || life.fatal) {
  fail.push(`lifecycle: ${life?.fatal ?? 'the driver returned nothing'}`)
} else {
  ok(life.listsRetired, 'Search templates does not list a retired template — it is drawn from the wrong list, and retiring is one-way again')
  ok(life.noEditorFields, 'the standalone saved-search editor is back on this screen')
  ok(life.retireInMenu, 'the menu on a live template row offers no Retire')
  ok(life.bringBackInMenu, 'the menu on a retired template row offers no Bring back')
  ok(life.editButtons >= 1, 'no Edit control — there is no way into the composer from the list')
  ok(life.confirmShown, 'Retire fired without a confirm step')
  ok(life.retiredThenListed, 'a retired search left the list, or its menu does not offer to bring it back')
  ok(life.broughtBack, 'a retired search could not be brought back')
  ok(life.editHeading, 'the composer did not say it was editing a search template')
  ok(life.savePrefilled === 'Launch screen', `the save name did not prefill with the label — read ${JSON.stringify(life.savePrefilled)}`)
  ok(life.notePrefilled === 'For the EU launch team.', `the note did not survive into the editor — read ${JSON.stringify(life.notePrefilled)}`)
  ok(life.territoryHydrated, 'the saved scope did not come back as levers — United States is not on screen')
  ok(life.saveChangesLabel, 'the footer offered Save rather than Save changes while editing')
  ok(life.returnedToList, 'saving an edit did not return to Search templates')
  ok(life.projectCreateOffered, 'Projects offers no way to create one')
  ok(life.archivedProjectListed, 'an archived project is not listed — hiding it is what made archiving one-way')
  ok(life.archivedProjectBadged, 'an archived project is listed without being marked as archived')
  ok(life.bringBackOnProject, 'the menu on an archived project offers no Bring back')
  ok(life.composerProjectOptions?.includes('EU launch'), `the composer does not offer the live project: ${JSON.stringify(life.composerProjectOptions)}`)
  ok(!life.composerProjectOptions?.includes('Old engagement'),
    'the composer offers an ARCHIVED project — archiving means the engagement is over, and the engine refuses the run at admission')
  ok(life.projectArchiveOnRow, 'the menu on a live project offers no Archive')
  ok(life.keyDerived === 'second-engagement', `the project key did not follow the name — read ${JSON.stringify(life.keyDerived)}`)
  ok(life.landedInEditor, 'creating a project did not open it — its settings are the next thing anyone wants')
  ok(life.projectListed, 'the created project is not in the list')
}

// ── Company settings and New company ───────────────────────────────────────────────────────────────
for (const [name, out] of Object.entries(settings)) if (!out || out.fatal) fail.push(`company settings (${name}): ${out?.fatal ?? 'nothing came back'}`)
const said = (name) => (settings[name] && !settings[name].fatal ? settings[name] : null)
const railSays = (who, out, page) => {
  ok(out.rail.parent && out.rail.parentActive, `${who}: Company settings is not lit in the rail — ${JSON.stringify(out.rail)}`)
  ok(JSON.stringify(out.rail.children.map((c) => c.label)) === JSON.stringify(['Profile', 'Projects', 'Search templates']),
    `${who}: Company settings does not open into Profile, Projects and Search templates — ${JSON.stringify(out.rail.children)}`)
  ok(JSON.stringify(out.rail.children.filter((c) => c.active).map((c) => c.label)) === JSON.stringify([page]),
    `${who}: the rail lights ${JSON.stringify(out.rail.children.filter((c) => c.active))} rather than ${page}`)
}
const headerSays = (who, out, primary) => {
  const newCompany = out.header.find((b) => b.text === '+ New company')
  ok(newCompany && newCompany.secondary && !newCompany.primary, `${who}: + New company is not a secondary button in the header — ${JSON.stringify(out.header)}`)
  if (primary) {
    const own = out.header.find((b) => b.text === primary)
    ok(own && own.primary, `${who}: ${primary} is not the header's primary button — ${JSON.stringify(out.header)}`)
    ok(out.header.map((b) => b.text).indexOf(primary) === out.header.length - 1, `${who}: ${primary} does not close the row — ${JSON.stringify(out.header)}`)
  }
}
const closed = said('profile-folds-closed')
if (closed) {
  railSays('Profile', closed, 'Profile')
  headerSays('Profile', closed, null)
  const fold = (t) => closed.folds.find((f) => f.title === t)
  ok(fold('What the bands mean') && !fold('What the bands mean').open, `Profile: "What the bands mean" is not a closed fold — ${JSON.stringify(closed.folds)}`)
  ok(fold('Search details') && !fold('Search details').open, `Profile: "Search details" is not a closed fold — ${JSON.stringify(closed.folds)}`)
  ok(closed.folds.every((f) => f.chevronAtRight), `Profile: a fold's chevron is not at its row's right edge — ${JSON.stringify(closed.folds)}`)
  ok(closed.bandRowsVisible === 0 && !closed.ratedOnVisible && !closed.entityVisible && !closed.coverageVisible,
    'Profile: the band detail, the rating lines or the variant calculation are in view while their folds are closed')
  ok(JSON.stringify(closed.ladder) === JSON.stringify(['Blocking', 'Material', 'Manageable', 'Clear to file']), `Profile: the bands are not in view — ${JSON.stringify(closed.ladder)}`)
  const row = (label) => (closed.rows.find(([l]) => l === label) ?? [])[1]
  ok(row('Worked examples') === 'Used when rating this company', `Profile: Worked examples reads ${JSON.stringify(row('Worked examples'))}`)
  ok(row('Permitted searches') === 'Launch screen, Old thing', `Profile: Permitted searches reads ${JSON.stringify(row('Permitted searches'))}`)
  ok(!/launch-screen|old-thing/.test(row('Permitted searches') ?? ''), 'Profile: a template slug reached the Permitted searches row')
  ok(JSON.stringify(closed.permittedSeen) === JSON.stringify(['Launch screen, Old thing']),
    `Profile: on the way in, Permitted searches read ${JSON.stringify(closed.permittedSeen)} rather than only the names`)
  for (const label of ['Jurisdiction policy', 'Run limits']) ok(closed.rows.some(([l]) => l === label), `Profile: the ${label} row is not in view`)
  ok(closed.guide && closed.guide.pill && closed.guide.newTab, `Profile: "Use your own risk framework" is not one control opening a new tab — ${JSON.stringify(closed.guide)}`)
  const tag = (label) => closed.fields.find((f) => f.label === label)?.tag ?? null
  ok(tag('Legal name') === 'Required', `Profile: Legal name is tagged ${JSON.stringify(tag('Legal name'))}`)
  ok(tag('Domains') === 'Optional' && tag('Own trading names') === 'Optional', 'Profile: Domains and Own trading names are not tagged Optional')
  const card = (title) => closed.cards.find((c) => c.title === title)
  ok(card('Search defaults')?.tag === 'Optional', `Profile: Search defaults is not tagged Optional — ${JSON.stringify(closed.cards)}`)
  ok(['Industry', 'Default classes', 'Default jurisdictions', 'Marketplaces', 'Risk appetite', 'Default search depth'].every((l) => tag(l) === null),
    'Profile: a Search defaults field repeats the Optional its card carries')
  ok(card('Background & standing concerns')?.tag === 'Optional', 'Profile: Background & standing concerns is not tagged Optional')
  ok(card('Law firm options')?.fold && card('Law firm options')?.note === 'Privileged & Confidential header' && card('Law firm options')?.open === false,
    `Profile: Law firm options is not a closed fold noting its one field — ${JSON.stringify(card('Law firm options'))}`)
  ok(closed.depthSelected === 'Global preliminary search', `Profile: Default search depth shows ${JSON.stringify(closed.depthSelected)}`)
  ok((closed.depthOptions ?? []).every((o) => !o.includes('·')), `Profile: a depth option names its search twice — ${JSON.stringify(closed.depthOptions)}`)
  ok(closed.fields.find((f) => f.label === 'Default search depth')?.hint?.startsWith('Used when a request does not name one'), 'Profile: the depth hint is not the designed one')
  ok(closed.classAdd && closed.fields.find((f) => f.label === 'Add a class')?.hint === 'Type a number or a word, for example 25 or clothing',
    'Profile: the class search box is missing, or its hint is not the designed one')
  ok(JSON.stringify(closed.classChips) === JSON.stringify(['9 · Electrical & software', '42 · Science & technology']), `Profile: the classes are not chips naming each class — ${JSON.stringify(closed.classChips)}`)
  ok(closed.save && closed.save.text === 'Save' && closed.save.disabled && closed.save.primary && closed.saveNote === 'No changes',
    `Profile: Save is not a disabled primary button beside "No changes" — ${JSON.stringify([closed.save, closed.saveNote])}`)
  ok(!closed.checkButton, 'Profile: a Check button is back')
  ok(closed.characters, 'Profile: the background has no character count')
}
const open = said('profile-folds-open')
if (open) {
  ok(open.folds.filter((f) => ['What the bands mean', 'Search details'].includes(f.title)).every((f) => f.open), `Profile: a fold did not open — ${JSON.stringify(open.folds)}`)
  ok(open.bandRowsVisible === 4 && open.ratedOnVisible && open.entityVisible, 'Profile: the open fold does not show every band, "Rated on:" and "Entity in prose:"')
  ok(open.coverage?.replace(/\s+/g, ' ').trim() === 'Calculated from the marketplaces and density above: about 14 search variants per pass across 6 sources.',
    `Profile: the variant calculation reads ${JSON.stringify(open.coverage)}`)
  ok(open.rowsStillVisible >= 3, 'Profile: the configuration rows left the view when the fold opened')
}
const unsaved = said('profile-unsaved')
if (unsaved) {
  const chips = [...unsaved.classChips].sort()
  ok(unsaved.box === '' && JSON.stringify(chips) === JSON.stringify(['25 · Clothing', '42 · Science & technology', '9 · Electrical & software']),
    `Profile: picking 25 from the class search did not add it beside the two classes and empty the box — ${JSON.stringify(unsaved)}`)
  ok(unsaved.save && unsaved.save.text === 'Save' && !unsaved.save.disabled && unsaved.saveNote === 'Unsaved changes',
    `Profile: with a class added, Save is not ready beside "Unsaved changes" — ${JSON.stringify([unsaved.save, unsaved.saveNote])}`)
}
const pressed = said('profile-saved')
if (pressed) {
  ok(JSON.stringify(pressed.notices) === JSON.stringify(['Saved']), `Profile: one press of Save ended in ${JSON.stringify(pressed.notices)}`)
  // ONE PRESS, TWO REQUESTS, IN THIS ORDER: the dry run, then the write of the very body it passed.
  const sent = posted.slice(settingsPostedFrom).filter((p) => p.path.startsWith('/portal/api/config/profile/'))
  ok(JSON.stringify(sent.map((p) => p.path)) === JSON.stringify(['/portal/api/config/profile/validate', '/portal/api/config/profile/save']),
    `Profile: one press of Save sent ${JSON.stringify(sent.map((p) => p.path))} rather than the check and then the write`)
  ok(sent.length === 2 && JSON.stringify(sent[0].body) === JSON.stringify(sent[1].body), 'Profile: the write did not send the body the check passed')
  const classes = (sent[1]?.body?.profile?.defaultClasses ?? []).map(Number).sort((a, b) => a - b)
  ok(JSON.stringify(classes) === JSON.stringify([9, 25, 42]), `Profile: the save sent classes ${JSON.stringify(classes)} rather than the picked one beside the two it had`)
}
const templates = said('search-templates')
if (templates) {
  railSays('Search templates', templates, 'Search templates')
  headerSays('Search templates', templates, 'New template')
  ok(JSON.stringify(templates.columns.slice(0, 3)) === JSON.stringify(['Search template', 'Builds on', 'Version']), `Search templates: the columns read ${JSON.stringify(templates.columns)}`)
  // THE SAME NAMES ON BOTH PAGES: what Profile's row says is what this page lists for the same company.
  if (closed) {
    const permitted = (closed.rows.find(([l]) => l === 'Permitted searches') ?? [])[1] ?? ''
    ok(permitted.split(', ').every((n) => templates.names.includes(n)), `Profile names ${JSON.stringify(permitted)}; Search templates lists ${JSON.stringify(templates.names)}`)
  }
  ok(templates.buildsOn.every((b) => !b.includes('\n')), `Search templates: Builds on carries a second line — ${JSON.stringify(templates.buildsOn)}`)
  ok(templates.buildsOn.includes('Full country search'), `Search templates: Builds on does not name the product — ${JSON.stringify(templates.buildsOn)}`)
  ok(templates.menus === templates.names.length, 'Search templates: a row has no More actions menu')
  ok(!templates.rowButtons.some((b) => /^(Retire|Bring back)$/.test(b)), `Search templates: Retire or Bring back is on the row, not in its menu — ${JSON.stringify(templates.rowButtons)}`)
}
const menu = said('search-templates-menu')
if (menu) ok(JSON.stringify(menu.items) === JSON.stringify(['Retire']), `Search templates: a live row's menu offers ${JSON.stringify(menu.items)}`)
const projects = said('projects')
if (projects) {
  railSays('Projects', projects, 'Projects')
  headerSays('Projects', projects, 'New project')
  ok(projects.menus === projects.rows.length, 'Projects: a row has no More actions menu')
  ok(!projects.rowButtons.some((b) => /^(Archive|Bring back)$/.test(b)), `Projects: Archive or Bring back is on the row, not in its menu — ${JSON.stringify(projects.rowButtons)}`)
}
const blank = said('new-company-empty')
if (blank) {
  ok(blank.title === 'New company' && !blank.lede, 'New company: the page is not titled New company alone')
  ok(!blank.rail.parentActive && blank.rail.children.length === 0, `New company: the rail lights Company settings over a page that is not one of its settings — ${JSON.stringify(blank.rail)}`)
  ok(blank.topbar === '', `New company: the top bar names a company over the page for making one — ${JSON.stringify(blank.topbar)}`)
  ok(JSON.stringify(blank.cards.map((c) => [c.title, c.tag])) === JSON.stringify([['Identity', null], ['Search defaults', 'Optional'], ['How matters are rated', 'Optional']]),
    `New company: the cards are not Profile's three, tagged as Profile's are — ${JSON.stringify(blank.cards)}`)
  const tag = (label) => blank.fields.find((f) => f.label === label)?.tag ?? null
  ok(tag('Legal name') === 'Required' && tag('Domains') === 'Optional' && tag('Own trading names') === 'Optional', 'New company: the Identity fields are not tagged as on Profile')
  ok(blank.fields.find((f) => f.label === 'Add a class')?.hint === 'Type a number or a word, for example 25 or clothing', 'New company: the class picker is not the search box')
  ok(blank.create.disabled && blank.create.primary && blank.unmet === 'Needs a name', `New company: with no name, Create reads ${JSON.stringify([blank.create, blank.unmet])}`)
  ok(!blank.changeKey && !blank.checkButton, 'New company: "Change the key" or "Check" appears')
  ok(/General risk framework/.test(blank.rating ?? '') && /Use your own/.test(blank.rating ?? ''), `New company: the rating card reads ${JSON.stringify(blank.rating)}`)
}
const named = said('new-company-named')
if (named) {
  ok(!named.create.disabled && named.unmet === null, `New company: with a name, Create reads ${JSON.stringify(named)}`)
  ok(named.tradingNames === 'Aurora Botanicals', `New company: Own trading names does not follow the name — ${JSON.stringify(named.tradingNames)}`)
}

// ── what reached the wire ───────────────────────────────────────────────────────────────────────────

const saves = posted.filter((p) => /\/config\/searches\/.+\/save$/.test(p.path))
const edited = saves.find((p) => /launch-screen/.test(p.path))
ok(saves.length >= 3, `expected a retire, a restore and an edit to reach the server — saw ${saves.length}`)
ok(edited != null, 'the composer never saved the search it was editing')
if (edited) {
  // THE SILENT REGRESSION THIS EXISTS TO CATCH. A save replaces the record; the composer has no field
  // for `extras`, so if it does not carry the prior record through, retiring the old editor quietly
  // destroyed data on the first re-save.
  ok(edited.body.recipe?.extras?.emailTable === true,
    `re-saving from the composer dropped extras: ${JSON.stringify(edited.body.recipe?.extras)}`)
  ok(edited.body.recipe?.notes === 'For the EU launch team.', 'the note did not survive the save')
  ok(edited.body.expectedVersion === 3, `an edit must name the version it was based on, sent ${JSON.stringify(edited.body.expectedVersion)}`)
  ok(!/\/searches\/launch-screen-\d/.test(edited.path), 'the edit was written to a NEW slug — a rename must not fork the record')
}
const retire = saves.find((p) => p.body.recipe?.archived === true)
const restore = saves.find((p) => p.body.recipe?.archived === false)
ok(retire != null, 'no save carried archived:true')
ok(restore != null, 'no save carried an EXPLICIT archived:false — archive state is sticky against omission, so a restore needs it')
ok(retire?.body?.recipe?.scope != null || retire?.body?.recipe?.label != null,
  'the retire posted a stripped record rather than the whole recipe with one flag flipped')

const projectSaves = posted.filter((p) => /\/config\/projects\/.+\/save$/.test(p.path))
const created = projectSaves.find((p) => p.body.profile?.projectName === 'Second engagement')
ok(posted.some((p) => /\/config\/projects\/.+\/validate$/.test(p.path)), 'a project was written without being validated first')
ok(created != null, 'the new project never reached the server')
ok(created == null || created.body.profile?.name === undefined,
  'a project must NEVER carry `name` — that is the customer identity the self-exclusion check anchors on')

console.log(JSON.stringify({ asClient, asStaff, asMulti, asReader, people, peopleLocal, pathsStaff, pathsOwner, life, settings, posted: posted.map((p) => p.path) }, null, 2))
if (fail.length) {
  console.error(`\n${fail.length} problem(s):`)
  for (const f of fail) console.error(` ✗ ${f}`)
  process.exit(1)
}
console.log('\nOK — one name for a company under both logins; searches and projects manageable from their own screens.')
