#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Does the portal call a company by name, and can a person manage their own searches and projects?
//
//   node scripts/portal-lifecycle-check.mjs [--keep] [--shot <path>]
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
// retiring a custom search and bringing it back, and creating a project.
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
    // is Manage and a custom search's writes are Run, so the pass that drives both needs both; a person
    // with Run alone is shown no project controls at all, which the view-only pass asserts.
    return { permissions: { run: true, manage: true }, email: 'gundy@apmxc.test', accounts: [KEY], accountNames: { [KEY]: NAME },
      access: [{ kind: 'company', key: KEY, name: NAME, org: 'org-a' }],
      organisations: [{ key: 'org-a', name: 'Apmxc Group' }], accountOrgs: { [KEY]: 'org-a' } }
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
const HOSTED_PEOPLE = { note: '', unknownAccounts: [], grantsFile: null, canAdd: true, localSignIn: false, people: [
  { email: 'lawyer@cordillera.test', permissions: { run: true, manage: true }, access: [{ kind: 'everything' }], dangling: [] },
  { email: 'owner@example.test', permissions: { run: true, manage: false }, access: [{ kind: 'organisation', key: 'org-a', name: 'Apmxc Group' }], dangling: [] },
  { email: 'viewer@example.test', permissions: { run: false, manage: false }, access: [{ kind: 'company', key: KEY, name: NAME, org: 'org-a' }], dangling: [] },
] }
const LOCAL_PEOPLE = { note: '', unknownAccounts: [], grantsFile: null, canAdd: false, localSignIn: true, people: [
  { email: 'lawyer@cordillera.test', permissions: { run: true, manage: true }, access: [{ kind: 'everything' }], dangling: [] },
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
    return json(res, { recipes: Object.entries(RECIPES).map(([slug, r]) => ({
      slug, label: r.label, base: r.base, archived: Boolean(r.archived), version: r.version ?? null, updatedAt: null })) })
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
    return json(res, { account: KEY, profile: { platforms: ['gnc.com'], defaultClasses: [9], marketplaceDensity: 'Low' },
      readOnly: { frameworkPath: PLANTED_PATH }, contextPack: '', framework: null, derived: null })
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
    return json(res, localMode ? LOCAL_PEOPLE : HOSTED_PEOPLE)
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
  // Retried once: a screen that navigates itself on save (the composer returns to Custom searches) can
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

  // The SCREEN's heading, not the top bar's. The top bar carries an <h1> with the nav label ("Clearances")
  // and it comes first in the document, so a bare h1 selector reads the one place that is supposed to say
  // the screen's name and never the company's.
  const h1 = document.querySelector('.main .screen h1');
  out.clearancesHeading = h1 ? h1.innerText.trim() : null;
  out.topbarHeading = (document.querySelector('.topbar h1') || {}).innerText || null;

  await goto('/portal/new');
  // THIS WAIT WAS IDENTITY-DEPENDENT AND SILENTLY DEAD FOR ONE OF THE THREE. "Company" is
  // the rail switcher's eyebrow (AppShell.tsx), which a SINGLE-OWNER client never gets — that identity
  // reads its owner in the Account corner instead. So this timed out on every client run, and because
  // settle returned false without objecting it degraded into an 8-second sleep. Waits on the context
  // card the composer draws for every identity, which is what the next line reads.
  await mustSettle(() => Boolean(document.querySelector('.ctx-card')), 8000,
    'the composer never painted its context card');
  const card = document.querySelector('.ctx-card');
  out.composerCard = card ? card.innerText.replace(/\\s+/g, ' ').trim() : null;

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
    const linkSel = 'a[href*="putting-your-own-login-provider-in-front"]';
    const linked = await settle(() => document.querySelector(linkSel), 8000);
    out.linkHref = linked ? document.querySelector(linkSel).href : null;
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
    out.archiveOffered = Boolean(maybeByText('button', /^(Archive|Bring back)$/));
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
    const drawn = () => /These settings scope every clearance/.test(txt());
    const card = () => [...document.querySelectorAll('button.entry-card')].find((b) => b.innerText.includes(${JSON.stringify(NAME)}));
    await mustSettle(() => drawn() || card(), 8000, 'Profile drew neither the profile nor the company panel');
    if (!drawn()) { card().click(); await mustSettle(drawn, 8000, 'picking the company did not open its profile'); }
    out.shown = txt().includes('risk-framework-planted');
  } catch (e) { out.fatal = String((e && e.message) || e); }
  return out;
})()
`

/** Pass two (client only): the two lifecycles that had no controls. */
const LIFECYCLE_SCRIPT = `
(async () => {
${HELPERS}
  const out = { steps: [] };
  try {

  // ── custom searches: list, retire, bring back ──
  await goto('/portal/brand/searches');
  if (!await settle(() => /Custom searches/.test(txt()))) return { fatal: 'Custom searches never painted', body: txt().slice(0, 600) };
  out.listsRetired = /Retired/.test(txt());          // drawn from the CONFIG list, not the composer menu
  out.noEditorFields = !/How deep should it search/.test(txt());
  out.retireButtons = allByText('button', /^Retire$/).length;
  out.bringBackButtons = allByText('button', /^Bring back$/).length;
  out.editButtons = allByText('button', /^Edit$/).length;
  out.steps.push('list painted');

  findByText('button', /^Retire$/).click();
  await sleep(200);
  out.confirmShown = /Confirm — retire/.test(txt());
  findByText('button', /Confirm — retire/).click();
  await mustSettle(() => allByText('button', /^Bring back$/).length === 2, 6000, 'the retired search never offered Bring back');
  out.retiredThenListed = allByText('button', /^Bring back$/).length === 2;
  out.steps.push('retired');

  // ...and back, which is the half that did not exist at all before.
  findByText('button', /^Bring back$/).click();
  await mustSettle(() => allByText('button', /^Retire$/).length === 1, 6000, 'the restored search never became retirable again');
  out.broughtBack = allByText('button', /^Retire$/).length === 1;
  out.steps.push('brought back');

  // ── the composer, opened OVER a saved search ──
  await goto('/portal/new?search=launch-screen');
  if (!await settle(() => /Edit a custom search/.test(txt()), 8000)) {
    return { ...out, fatal: 'the composer did not open in edit mode', body: txt().slice(0, 700) };
  }
  out.editHeading = /Edit a custom search/.test(txt());
  const nameInput = [...document.querySelectorAll('input')].find((i) => i.getAttribute('aria-label') === 'Name this search');
  out.savePrefilled = nameInput ? nameInput.value : null;
  const noteInput = [...document.querySelectorAll('input')].find((i) => i.getAttribute('aria-label') === 'Note about this custom search');
  out.notePrefilled = noteInput ? noteInput.value : null;
  // The stored scope came back as a draft: one territory, one class.
  out.territoryHydrated = /United States/.test(txt());
  out.steps.push('hydrated');

  const saveBtn = maybeByText('button', /Save changes/);
  out.saveChangesLabel = Boolean(saveBtn);
  if (saveBtn) saveBtn.click();
  await mustSettle(() => /Custom searches/.test(txt()), 8000, 'the custom search list never returned after saving');
  out.returnedToList = /Custom searches/.test(txt());
  out.steps.push('saved');

  // ── projects: create ──
  await goto('/portal/brand/projects');
  await mustSettle(() => /New project/.test(txt()), 8000, 'the New project control never appeared');
  out.projectPath = location.pathname;
  out.projectCreateOffered = /New project/.test(txt());
  out.archivedProjectListed = /Old engagement/.test(txt());
  out.archivedProjectBadged = /Archived/.test(txt());
  out.bringBackOnProject = allByText('button', /^Bring back$/).length >= 1;
  out.projectArchiveOnRow = allByText('button', /^Archive$/).length >= 1;
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

  // Back out the way a person would — the breadcrumb, not the address bar.
  findByText('button', /^Projects$/).click();
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
localMode = true
await reload()
const peopleLocal = await value(PEOPLE_LOCAL_SCRIPT)
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
  ok(out.clearancesHeading === NAME, `${who}: the Clearances heading reads ${JSON.stringify(out.clearancesHeading)}, not ${JSON.stringify(NAME)}`)
  ok(out.composerCard?.includes(NAME), `${who}: the New clearance context card does not name the company — read ${JSON.stringify(out.composerCard)}`)
  ok(out.nameOnScreen, `${who}: the company's name is nowhere on the composer`)
  ok(!out.slugOnScreen, `${who}: the account KEY "${KEY}" is printed on screen where the name belongs`)
}
// The regression this whole change is for: every login must agree, word for word.
const headings = [['client', asClient], ['staff', asStaff], ['multi-account client', asMulti]]
  .filter(([, o]) => o && !o.fatal)
for (const [who, out] of headings) {
  ok(out.clearancesHeading === headings[0][1].clearancesHeading,
    `the same company reads "${out.clearancesHeading}" to a ${who} and "${headings[0][1].clearancesHeading}" to a ${headings[0][0]}`)
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
  ok(people.rows.length === 3, `People should list the three people it was sent — it drew ${people.rows.length} rows`)
  ok(people.rows.some((r) => r[1] === 'Runs clearances · Manages' && /Everything/.test(r[2] ?? '')),
    `no row reads both permissions with access to everything: ${JSON.stringify(people.rows)}`)
  ok(people.rows.some((r) => r[1] === 'View reports'), `the view-only person is not described as such: ${JSON.stringify(people.rows)}`)
  ok(!people.rows.some((r) => /staff|client/i.test(r.join(' '))), `a role word is back on People: ${JSON.stringify(people.rows)}`)
  ok(people.addDisabled === false && !people.localNotice, 'a hosted install offers Add, with no local sign-in notice')
  ok(people.path === '/portal/people/add', `Add a person opened ${people.path}`)
  ok(/will see everything under Apmxc Group, and can run clearances there/.test(people.sentence ?? ''),
    `the form does not say what the new person will see: ${JSON.stringify(people.sentence)}`)
  ok(/cannot add companies or people/.test(people.sentence ?? ''), `the form does not say what they cannot do: ${JSON.stringify(people.sentence)}`)
  ok(people.saveEnabled === true, 'Save is off with an address and a choice made')
}
if (!peopleLocal || peopleLocal.fatal) {
  fail.push(`people (local sign-in): ${peopleLocal?.fatal ?? 'the driver returned nothing'}`)
} else {
  ok(peopleLocal.addDisabled === true, 'Add is offered on an install that signs one person in locally')
  ok(peopleLocal.rows === 1, `local sign-in should list its one person — it drew ${peopleLocal.rows} rows`)
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
  ok(life.listsRetired, 'Custom searches does not list a retired search — it is drawn from the wrong list, and retiring is one-way again')
  ok(life.noEditorFields, 'the standalone saved-search editor is back on this screen')
  ok(life.retireButtons >= 1, 'no Retire control on a saved-search row')
  ok(life.bringBackButtons >= 1, 'no Bring back control on a retired row')
  ok(life.editButtons >= 1, 'no Edit control — there is no way into the composer from the list')
  ok(life.confirmShown, 'Retire fired without a confirm step')
  ok(life.retiredThenListed, 'a retired search left the list instead of being greyed and kept')
  ok(life.broughtBack, 'a retired search could not be brought back')
  ok(life.editHeading, 'the composer did not say it was editing a custom search')
  ok(life.savePrefilled === 'Launch screen', `the save name did not prefill with the label — read ${JSON.stringify(life.savePrefilled)}`)
  ok(life.notePrefilled === 'For the EU launch team.', `the note did not survive into the editor — read ${JSON.stringify(life.notePrefilled)}`)
  ok(life.territoryHydrated, 'the saved scope did not come back as levers — United States is not on screen')
  ok(life.saveChangesLabel, 'the footer offered Save rather than Save changes while editing')
  ok(life.returnedToList, 'saving an edit did not return to Custom searches')
  ok(life.projectCreateOffered, 'Projects offers no way to create one')
  ok(life.archivedProjectListed, 'an archived project is not listed — hiding it is what made archiving one-way')
  ok(life.archivedProjectBadged, 'an archived project is listed without being marked as archived')
  ok(life.bringBackOnProject, 'an archived project has no Bring back control')
  ok(life.composerProjectOptions?.includes('EU launch'), `the composer does not offer the live project: ${JSON.stringify(life.composerProjectOptions)}`)
  ok(!life.composerProjectOptions?.includes('Old engagement'),
    'the composer offers an ARCHIVED project — archiving means the engagement is over, and the engine refuses the run at admission')
  ok(life.projectArchiveOnRow, 'Projects offers no Archive on the row')
  ok(life.keyDerived === 'second-engagement', `the project key did not follow the name — read ${JSON.stringify(life.keyDerived)}`)
  ok(life.landedInEditor, 'creating a project did not open it — its settings are the next thing anyone wants')
  ok(life.projectListed, 'the created project is not in the list')
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

console.log(JSON.stringify({ asClient, asStaff, asMulti, asReader, people, peopleLocal, pathsStaff, pathsOwner, life, posted: posted.map((p) => p.path) }, null, 2))
if (fail.length) {
  console.error(`\n${fail.length} problem(s):`)
  for (const f of fail) console.error(` ✗ ${f}`)
  process.exit(1)
}
console.log('\nOK — one name for a company under both logins; searches and projects manageable from their own screens.')
