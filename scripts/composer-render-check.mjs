#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Does the NEW CLEARANCE composer actually lay out, and do the levers reach the wire?
//
//   node scripts/composer-render-check.mjs [--keep] [--shot <path>]
//
// ── why this exists ──────────────────────────────────────────────────────────────────────────────────
//
// Every test in portal-ui asserts on strings or on pure functions. Not one of them can observe a screen
// that overflows its column, a sticky footer that does not stick, or a control that renders but never
// reaches `fetch`. The composer was rebuilt into a wizard with a pinned footer and derived levels — all
// three of those failure modes are now reachable, and all three are invisible to `node --test`.
//
// So this serves the REAL built bundle to a REAL browser against a stub of portal-service, drives the
// controls, and measures. It is the same argument as scripts/render-check.mjs, pointed at the one screen
// in the portal that can spend money.
//
// MUST NOT run as a user with a virtual-memory ulimit (`ulimit -v`) — Chrome dumps core under one. Run
// it as a user with `ulimit -v unlimited`.

import { createServer } from 'node:http'
import { reapOnExit } from "../shared/reap-on-exit.mjs";   // — a detached group dies with this script
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { productRows } from '../driver/product-rows.mjs'
// THE DOOR'S OWN LADDER, not a copy of it. The plan below reports the scope a request RESOLVES to, and a
// stub that echoed the request instead could not tell "the requester named these" from "the requester
// named none and the company's own apply" — which is the whole of the check added at the end of this file.
import { resolveTerritories } from '../driver/effective-scope.mjs'
import { RETIRED_PRODUCTS } from '../driver/search-policy.mjs'
import { browserRun } from "../shared/browser-temp-root.mjs";

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = join(HERE, '..', 'portal-ui', 'dist')
const keep = process.argv.includes('--keep')
const shotAt = process.argv.includes('--shot') ? process.argv[process.argv.indexOf('--shot') + 1] : null
// EVIDENCE for a person to read against the design: each state the design draws, in both themes. Not a
// test — the assertions above are the test; these are the pictures a reviewer compares with the boards.
const shotDir = process.argv.includes('--shot-dir') ? process.argv[process.argv.indexOf('--shot-dir') + 1] : null

if (!existsSync(join(DIST, 'index.html'))) {
  console.error(`no build at ${DIST} — run: npm run build:ui`)
  process.exit(2)
}

// ── the stub portal ─────────────────────────────────────────────────────────────────────────────────
// Shapes copied from portal-service's real responses. A client principal with one account, so the
// composer resolves an owner without a picker.

const PLATFORMS = [
  'amazon.com', 'walmart.com', 'target.com', 'gnc.com', 'iherb.com', 'vitaminshoppe.com',
  'kroger.com', 'cvs.com', 'walgreens.com', 'costco.com', 'samsclub.com', 'ebay.com', 'instacart.com',
]

// `components` is the list of component keys whose value is TRUE — portal-service filters the policy's
// map before it goes on the wire (portal-service.mjs). So `commonLawGrid` is present on a full
// clearance and absent on a register-only one, which is the subtraction that tells the two apart, and
// `warnMarks` is 15 on the knockout batch. Both are quoted from PRODUCT_POLICIES rather than simplified:
// the depth matrix reads exactly these fields, and a stub that omitted them would draw a screen no
// deployment ever serves.
// THE ENGINE'S OWN ROWS, not a hand-written copy of them. This used to restate every field of every
// level here, which is a stub that can silently stop describing the product while still rendering a
// screen — and the depth matrix reads exactly these fields. `available`/`unavailableNote` are the only
// additions, because they are deployment state resolved per request and productRows knows nothing of them.
const stubLevels = () => productRows().map((r) => ({ ...r, available: true, unavailableNote: '' }))

const ROUTES = {
  '/portal/api/me': { permissions: { run: true, manage: false }, email: 'demo@example.test', accounts: ['coastline'], allAccounts: false,
    access: [{ kind: 'company', key: 'coastline', name: 'Coastline', org: 'coastline-org' }], organisations: [{ key: 'coastline-org', name: 'Coastline' }],
    accountOrgs: { coastline: 'coastline-org' } },
  // The roster, for the notice states whose reader sees everything: that reader takes their company from
  // it, and with one company in it the composer opens on that company without asking.
  '/portal/admin/roster': { customers: [{ key: 'coastline', name: 'Coastline' }] },
  // ── the engine states, driven in phase two ────────────────────────────────────────────────────────
  //
  // The composer above is measured on a working install, which is the state that renders no notice at
  // all. The notice is what an install with no usable engine shows INSTEAD of the start button, and it
  // decides what a blocked reader is told to do — install the program, or restart the service that
  // cannot see one already installed. Those two remedies are not interchangeable: telling someone to
  // install a program they already have is the advice an outside user followed to no effect before
  // giving up on a working machine.
  //
  // It is served from here rather than tested in portal-ui because that suite has no DOM, no jsdom and
  // no React test renderer — Node cannot import a `.tsx` there at all. The decision behind the notice is
  // driven in the contract layer; this is the half that proves the screen renders what it decides.
  '/portal/api/searches': {
    account: 'coastline',
    products: stubLevels(),
    // `nativeLanguage` rides the list row because the composer has to say what geography a saved search
    // accepts while the row is being clicked. Stubbed as the wire sends it.
    recipes: [{ slug: 'launch-screen', label: 'Launch screen', base: 'global-preliminary-search', version: 3, nativeLanguage: false }],
    read: { available: true, maxBrief: 12000, note: null },
  },
  '/portal/api/config/profile': {
    account: 'coastline',
    profile: {
      platforms: PLATFORMS,
      defaultClasses: [5, 32],
      defaultJurisdictions: [],
      marketplaceDensity: 'High',
    },
    readOnly: {}, contextPack: '', framework: null, derived: null,
  },
  '/portal/api/config/projects': [],
}

/**
 * What /usage answers RIGHT NOW. Two left for the main pass, which draws the allowance line; the evidence
 * phase moves it between reloads to draw each of the line's three states — the same mutable-answer
 * shape `meEngine` below uses, for the same reason: one server, so only the measured thing differs.
 */
/**
 * The company's own default territories RIGHT NOW. Empty for the main pass, because that pass measures a
 * reader who names their own places; set by the inherited pass below, which measures the reader who names
 * none and is shown the company's instead. Mutable for the same reason `meEngine` is: one server, so the
 * only thing differing between two renders is the thing being measured.
 */
let profileTerritories = []
// THE WIRED REGISTER'S REACH AND ITS NAME, mutable for the same reason the territories above are: a
// state has to move them between pictures, and the frozen route cannot.
//
// `undefined` IS THE DEFAULT ON PURPOSE, and it is the wire's third answer rather than a missing value.
// Absent means "this deployment did not say", the browser fails open on it, and that is the condition
// every picture in this file was taken under until a state says otherwise — which is exactly why none of
// them could show a territory being refused.
let registerReach
let registerLabelNow = null

let usageNow = { account: 'coastline', today: 1, thisMonth: 4, queued: 0, dailyRuns: 3, monthlyRuns: null, maxQueued: null, capped: true }

/** Every plan body the page posts, so the check can assert what the levers actually put on the wire. */
const posted = []

/**
 * What /me says about the engine RIGHT NOW. Empty for the main pass — a working install — and set by
 * phase two before each reload. A mutable answer rather than four servers: the page is reloaded between
 * states anyway, and one server keeps the pool, the profile and the products identical across them, so
 * the only thing that differs between two renders is the thing being measured.
 */
let meEngine = {}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' }

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const path = url.pathname

  // The brief reader. Answers a fixed read so the check can assert what lands in the FORM — the whole
  // point of the feature is that its output is ordinary editable fields, and a string test on the
  // response body would prove nothing about that.
  if (req.method === 'POST' && path === '/portal/api/compose/read') {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      let body = {}
      try { body = JSON.parse(raw) } catch { /* recorded as empty */ }
      posted.push({ path, body })
      // A brief that ASKS for worldwide gets the lone-claim answer, which is the only way the model can
      // say "everywhere" — worldwide is the empty territory list, so an empty answer would be
      // indistinguishable from silence and would (correctly) leave the form's countries alone. The stub
      // varies on the brief rather than on a counter so the second read is a read, not a fixture swap.
      const worldwideAsk = /worldwide/i.test(String(body?.brief ?? ''))
      res.writeHead(200, { 'content-type': 'application/json' })
      // THE DESIGN'S OWN BRIEF, for the evidence phase: a region and a country, goods, and a launch month
      // with no date — so the read names no search and the form's recommendation picks it, which is the
      // state the design draws.
      if (/EU and Switzerland/.test(String(body?.brief ?? ''))) {
        res.end(JSON.stringify({ read: {
          names: ['AQUAPLUS'], classes: [], goods: 'energy drinks', territories: ['European Union', 'Switzerland'],
          worldwide: false, product: null, ref: '', deadline: '', notes: ['Deadline: November, no date given'],
        } }))
        return
      }
      res.end(JSON.stringify({
        read: {
          names: ['AQUAPLUS'], classes: [32], goods: 'energy drinks and sports hydration powders',
          // Bavaria is NOT a territory the composer offers — the screen must own up to dropping it
          // rather than quietly losing it.
          territories: worldwideAsk ? [] : ['United States', 'Bavaria'],
          // WORLDWIDE IS ITS OWN FIELD now: an empty territory list means "the brief does not say" and
          // this boolean means "the brief says everywhere". They were the same answer until, which
          // is why an explicit worldwide over a draft naming France was dropped without a receipt.
          worldwide: worldwideAsk,
          product: worldwideAsk ? 'global-preliminary-search' : 'knockout-search',
          ref: 'M-4471', deadline: '2026-07-24',
          notes: worldwideAsk ? [] : ['The thread also mentions AQUA PLUS as two words — I took the one-word form.'],
        },
      }))
    })
    return
  }

  // A refused run, on demand. `?fail=1` is set by the in-page driver before the one press that must
  // show its reason — the engine's real refusal text, so the assertion reads what a user would.
  if (req.method === 'POST' && path === '/portal/api/run' && url.searchParams.get('fail') === '1') {
    res.writeHead(502, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      error: 'start_run refused upstream: job rejected — profileKey "sim-praxis" names no known customer '
        + '— the roster this process can see is [burrowell, coastline, foxglade, generic]',
    }))
    return
  }

  if (req.method === 'POST' && (path === '/portal/api/run/plan' || path === '/portal/api/run')) {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      let body = {}
      try { body = JSON.parse(raw) } catch { /* recorded as empty */ }
      posted.push({ path, body })
      res.writeHead(200, { 'content-type': 'application/json' })
      // THE PLAN ECHOES THE REQUEST it was given — the product's own name and quote, the places named —
      // so the review dialog drawn from it is the dialog for the search on the form, not a fixed one.
      const row = productRows().find((r) => r.key === body.product) ?? null
      res.end(JSON.stringify(path === '/portal/api/run'
        ? { id: 'demo-run' }
        : {
            name: row?.name ?? 'Depth 4', stageLabel: row?.name ?? 'Depth 4', marks: 1, confirmationToken: 'tok', warnings: [],
            caveat: 'Ratings reflect our common law assessment.',
            // RESOLVED, NOT ECHOED. `scope` is what the run would actually search, and the engine's own
            // ladder is what decides it: a geography stamp of "worldwide" takes no territories from the
            // company, "named" takes the request's, and "account-default" falls through to the company's.
            // Echoing the request made all three identical here, so the dialog drawn from it agreed with
            // the form by construction and could not have caught a request that disagreed with it.
            scope: { ...(() => { const r = resolveTerritories({ geography: body.geography, jurisdictions: body.jurisdictions }, { defaultJurisdictions: profileTerritories }, null); return { jurisdictions: r.jurisdictions, jurisdictionsFrom: r.from } })(), classes: [5, 32], classesFrom: 'the account', platforms: PLATFORMS, platformsAdded: [] },
            turnaround: row?.baseTurnaround ?? 'same day',
          }))
    })
    return
  }

  const base = path.split('?')[0]
  // Served from the mutable list rather than the frozen route, so the inherited pass can move it.
  if (base === '/portal/api/config/profile') {
    res.writeHead(200, { 'content-type': 'application/json' })
    const r = ROUTES[base]
    res.end(JSON.stringify({ ...r, profile: { ...r.profile, defaultJurisdictions: profileTerritories } }))
    return
  }
  // Served from the mutable pair rather than the frozen route, for the reason written beside them.
  if (base === '/portal/api/searches') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      ...ROUTES[base],
      // The tri-state, kept apart on the way out as the real payload keeps it: a list, an explicit
      // null, or the key absent. A `?? null` here would tell every screen the register is unrestricted.
      ...(registerReach === undefined ? {} : { territories: registerReach }),
      ...(registerLabelNow ? { registerLabel: registerLabelNow } : {}),
    }))
    return
  }
  if (ROUTES[base] !== undefined) {
    res.writeHead(200, { 'content-type': 'application/json' })
    // /me carries whatever phase two has set about the engine; every other route is a constant. Merged
    // rather than replaced so the identity, the accounts and the roster stay exactly what the main pass
    // measured — a state that changed two things at once would not say which one moved the screen.
    res.end(JSON.stringify(base === '/portal/api/me' ? { ...ROUTES[base], ...meEngine } : ROUTES[base]))
    return
  }
  if (base === '/portal/api/usage') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(usageNow))
    return
  }

  const file = base === '/' || base.startsWith('/portal') && !base.includes('.') ? '/index.html' : base.replace(/^\/portal/, '')
  const full = join(DIST, file)
  if (!existsSync(full)) { res.writeHead(404); res.end('no'); return }
  res.writeHead(200, { 'content-type': MIME[extname(full)] ?? 'application/octet-stream' })
  res.end(readFileSync(full))
})

await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port
const origin = `http://127.0.0.1:${port}`

// ── drive it ────────────────────────────────────────────────────────────────────────────────────────
// Everything below runs INSIDE the page. It waits for the composer to paint, fills it in, exercises the
// levers, and measures — then posts a plan so the wire body can be checked from the outside.

const SCRIPT = `
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const settle = async (pred, ms = 6000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(60); }
    return false;
  };
  const txt = () => document.body.innerText;
  // A MISS THROWS, NAMING WHAT IT MISSED. This returned undefined, and the thirteen sites below
  // that dereference it immediately turned a missing button into "Cannot read properties of undefined
  // (reading 'click')" — a message naming no selector, no screen and no step. It was intermittent, so it
  // read as a flaky suite rather than as a driver that could not say what it had not found.
  //
  // Where ABSENCE IS THE ASSERTION, use maybeByText. Converting one of those to the throwing form would
  // crash on the CORRECT path — "the native-language button is hidden on knockout" would die precisely
  // when it is properly hidden — so the two names are kept apart deliberately.
  const maybeByText = (sel, re) => [...document.querySelectorAll(sel)].find((e) => re.test(e.innerText || ''));
  const findByText = (sel, re) => {
    const el = maybeByText(sel, re);
    if (!el) throw new Error('no ' + sel + ' matching ' + re + ' is on screen');
    return el;
  };

  // A DISCARDED settle() IS A WAIT NOBODY CHECKED. settle returns false on timeout and never throws, so
  // eight call sites walked into the DOM assuming a render that had not happened. Line 230 always got
  // this right — it reads the return and names the wait — and this is that shape, reusable.
  const mustSettle = async (pred, ms, what) => {
    if (!await settle(pred, ms)) throw new Error(what + ' (waited ' + ms + 'ms)');
  };

  // Make ONE run press fail, without the app knowing anything about it. The stub answers 502 for
  // /portal/api/run?fail=1, and this tags that single request — so the refusal path is exercised
  // through the real api client, the real decoder and the real component, which is the only way an
  // assertion about what the user sees means anything.
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (window.__failNextRun && /\\/portal\\/api\\/run$/.test(String(url).split('?')[0])) {
      return realFetch(String(url) + '?fail=1', init);
    }
    return realFetch(input, init);
  };
  const set = (el, v) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  // Pick one of the four, by NAME. Each row is a card holding its pick button — the selected search holds
  // a control of its own, and a button cannot hold a button — so the click goes to the button, and a row
  // that has lost it is a miss that says so rather than a click on a card that does nothing.
  const pickProduct = (re) => {
    const row = [...document.querySelectorAll('.pick-row')].find((b) => re.test(b.innerText || ''));
    if (!row) throw new Error('no product row matching ' + String(re));
    const hit = row.querySelector('.pick-row-hit');
    if (!hit) throw new Error('the row matching ' + String(re) + ' has no pick button');
    hit.click();
  };
  const out = { steps: [] };
  try {

  location.hash = '';
  history.pushState({}, '', '/portal/new');
  window.dispatchEvent(new PopStateEvent('popstate'));

  // ── ONE FORM, TOP TO BOTTOM ──────────────────────────────────────────────────────────────────────
  //
  // The screen used to OPEN on two ways in, and hid the form behind whichever was pressed. The design
  // took the fork out: Describe it is the form's first section, and everything is on the page at once.
  // Waits on the search rows, which sit at the BOTTOM of the form — if they have painted, so has the rest.
  await mustSettle(() => document.querySelectorAll('.pick-row').length >= 4 && /Describe it/.test(txt()), 8000,
    'the one form never painted its search rows');
  out.steps.push('one form painted');
  out.forkGone = !/Set it up myself/.test(txt()) && !document.querySelector('.segmented-entry')
    && ![...document.querySelectorAll('.entry-card')].some((c) => /Describe it/.test(c.innerText || ''));

  // THE ORDER IS THE DESIGN'S, measured by position rather than by source order: a section can sit
  // first in the markup and still be drawn somewhere else.
  const col = document.querySelector('.composer-col');
  const titleEl = (re) => col ? [...col.querySelectorAll('.section-title, .field-label')].find((e) => re.test((e.textContent || '').trim())) : null;
  const topOf = (el) => (el ? Math.round(el.getBoundingClientRect().top + window.scrollY) : null);
  out.sectionTops = [
    ['Company', topOf(titleEl(/^Company$/))],
    ['Describe it', topOf(titleEl(/^Describe it$/))],
    ['Names to clear', topOf(titleEl(/^Names to clear$/))],
    ['Where', topOf(titleEl(/^Where$/))],
    ['Goods or services', topOf(titleEl(/^Goods or services$/))],
    ['Context (optional)', topOf(titleEl(/^Context \\(optional\\)$/))],
    ['company card', topOf(document.querySelector('.composer-col .ctx-card'))],
    ['Which search', topOf(titleEl(/^Which search$/))],
  ];

  // AT REST NOTHING IS CHOSEN. "Recommended for what you entered" is a claim about input, and an
  // untouched form has none — so no row is selected, no row is tagged, and the bar says so.
  const footerText = () => { const f = document.querySelector('.composer-footer'); return f ? f.innerText.replace(/\\s+/g, ' ') : ''; };
  out.nothingSelectedAtRest = !document.querySelector('.pick-row-on') && !document.querySelector('.pick-tag');
  out.footerNoSearchAtRest = /No search picked/.test(footerText()) && /Not set/.test(footerText());
  out.footerAtRest = /Review search/.test(txt());
  out.startingFrom = /starting from ·/i.test(txt());

  // The company card: what this company already carries, with the way to its projects.
  out.contextCard = Boolean(document.querySelector('.ctx-card'));
  out.inheritedClassChips = [...document.querySelectorAll('.ctx-card .chip')].map((c) => c.innerText.trim());
  out.shopChips = document.querySelectorAll('.ctx-card .chip-mono').length;
  out.showAll = /Show all 13/.test(txt());
  out.manageProjects = Boolean([...document.querySelectorAll('.ctx-card button')].find((b) => /^Manage projects$/.test(b.textContent.trim())));

  // TEMPLATES ARE THEIR OWN CONTROL, beside Which search — never rows among the four.
  const templates = () => document.querySelector('select[aria-label="Search templates"]');
  out.templatesControl = templates() ? [...templates().options].map((o) => o.textContent.trim()) : null;
  out.manageTemplates = Boolean(maybeByText('button', /^Manage$/));

  // ── WHERE COMES BEFORE WHICH SEARCH, AND THE SEARCH FOLLOWS IT ───────────────────────────────────
  //
  // With no search picked the picker must still take a place — the recommendation is read off it.
  const whereBox = () => document.querySelector('input[aria-label="Add a territory"]');
  const addPlace = async (typed, name) => {
    set(whereBox(), typed);
    await sleep(180);
    const opt = [...document.querySelectorAll('.typeahead button')].find((b) => b.firstChild && b.firstChild.textContent.trim() === name);
    if (!opt) throw new Error('the typeahead did not offer ' + name + ' for "' + typed + '"');
    opt.click();
    await sleep(160);
  };
  out.whereTakesAPlaceFirst = Boolean(whereBox()) && !whereBox().disabled;
  const namesBox = () => document.querySelector('textarea[aria-label="Names to clear"]');

  // THE ORDER A READER TYPES IN: a name, then the places. A lone name must select nothing — the search it
  // would fit is the worldwide one, which takes the picker away one field above — and a PRESELECTED
  // one-country search must not replace the first country with the second, or the recommendation could
  // never reach the search that reads both. Found by the evidence pass, which typed a name and then could
  // not add a place.
  set(namesBox(), 'AQUAPLUS');
  await sleep(200);
  out.loneNameSelectsNothing = !document.querySelector('.pick-row-on') && Boolean(whereBox());
  await addPlace('fran', 'France');
  await mustSettle(() => /Full country search/.test((document.querySelector('.pick-row-on') || {}).innerText || ''), 4000,
    'one country did not preselect the Full country search');
  await addPlace('germ', 'Germany');
  await mustSettle(() => /Multi-country focus search/.test((document.querySelector('.pick-row-on') || {}).innerText || ''), 4000,
    'a second country did not move the preselection to the Multi-country focus search — the first was replaced');
  out.secondCountryStacks = Boolean(document.querySelector('button[aria-label="Remove France"]'))
    && Boolean(document.querySelector('button[aria-label="Remove Germany"]'));
  document.querySelector('button[aria-label="Remove France"]').click();
  await sleep(140);
  document.querySelector('button[aria-label="Remove Germany"]').click();
  await sleep(160);
  set(namesBox(), '');
  await sleep(160);

  await addPlace('euro', 'European Union');
  await addPlace('switz', 'Switzerland');
  await mustSettle(() => Boolean(document.querySelector('.pick-row-on')), 4000,
    'naming a region and a country selected no search — the recommendation is not preselected');
  const onRow = document.querySelector('.pick-row-on');
  out.preselected = onRow ? onRow.innerText.replace(/\\s+/g, ' ') : null;
  out.preselectedMulti = /Multi-country focus search/.test(out.preselected || '');
  out.recommendedTag = /Recommended for what you entered/.test(out.preselected || '');
  out.recommendedReason = /because you named a region and a country/.test(out.preselected || '');
  out.tagOnOneRowOnly = document.querySelectorAll('.pick-tag').length === 1;
  out.footerCodes = /EU, CH/.test(footerText());
  out.footerTurnaroundInWords = /1\\.5 to 2\\.5 hours/.test(footerText()) && !/\\d–\\d/.test(footerText());
  out.footerOneSearch = /1 search/.test(footerText());
  // Back to an empty Where, so the passes below start from the form they were written against.
  document.querySelector('button[aria-label="Remove European Union"]').click();
  await sleep(140);
  document.querySelector('button[aria-label="Remove Switzerland"]').click();
  await sleep(160);
  out.steps.push('recommendation preselected');

  // ── THE DESCRIBE SIDE ────────────────────────────────────────────────────────────────────────────
  // Nothing pasted yet ⇒ nothing to read. The button is dead until there is a brief, so a stray click
  // cannot spend a press of the hourly budget on an empty box.
  out.readDisabledWhenEmpty = maybeByText('button', /Fill it in for me/)?.disabled ?? null;

  const briefBox = document.querySelector('textarea[aria-label="Describe the search"]');
  if (!briefBox) throw new Error('the Describe it box is not on the form');
  out.briefExampleInside = briefBox.placeholder === 'Example: AQUAPLUS for an energy drink in the EU and Switzerland, launch in November';
  set(briefBox, 'Quick check on AQUAPLUS for energy drinks in the US before Friday, our ref M-4471 — just the obvious blockers.');
  await sleep(120);
  out.readEnabled = !findByText('button', /Fill it in for me/).disabled;
  findByText('button', /Fill it in for me/).click();
  await mustSettle(() => /what i read/i.test(txt()), 4000, 'the read-back of the description never appeared');

  // What the READ actually did to the FORM. The response body proves nothing — the feature's claim is
  // that its output arrives as ordinary editable fields, so that is what gets read back off the screen.
  out.receiptShown = /what i read/i.test(txt());
  out.receiptLines = [...document.querySelectorAll('.read-receipt li')].map((li) => li.innerText.trim());
  out.receiptHeads = [...document.querySelectorAll('.read-receipt-head')].map((h) => h.textContent.trim());
  // The brief is NOT consumed: a filler that eats its own input leaves nothing to correct from if it
  // read badly. (It does NOT travel with the request — bodyFor has never sent it.)
  out.briefSurvives = /AQUAPLUS/.test(briefBox.value);
  out.namesFilled = namesBox() ? namesBox().value.trim() === 'AQUAPLUS' : false;
  out.readClassChips = [...document.querySelectorAll('.ctx-card .chip')].map((c) => c.innerText.trim());
  out.deadlineFilled = [...document.querySelectorAll('input[type="date"]')].some((i) => i.value === '2026-07-24');
  out.refFilled = [...document.querySelectorAll('input')].some((i) => i.value === 'M-4471');
  // The brief said "obvious blockers" ⇒ the reader names the Knockout search, and it is the SELECTED row.
  out.productMoved = /Knockout search/.test((document.querySelector('.pick-row-on') || {}).innerText || '');
  // A territory this composer does not offer is OWNED, not swallowed.
  out.droppedShown = /Bavaria/.test(txt()) && /not a territory this search offers/i.test(txt());
  out.doubtShown = /two words/i.test(txt());

  // Move to a clearance before carrying on. The read picked the Knockout search — "just the obvious
  // blockers" — and everything after this point exercises the clearance half of the offering.
  pickProduct(/Multi-country focus search/);
  await sleep(150);
  out.registersRestored = /Multi-country focus search/.test(txt());
  out.steps.push('read');

  // THE FOUR, each with the geography it accepts and the name count it reads — both the SERVER's own
  // figures. A row that stated a limit the wall does not enforce is what this build deleted.
  out.pickerRows = [...document.querySelectorAll('.pick-row')].map((b) => b.innerText.replace(/\\s+/g, ' ').trim());
  out.pickerNamesAllFour = ['Knockout search', 'Global preliminary search', 'Multi-country focus search', 'Full country search']
    .every((n) => out.pickerRows.some((r) => r.includes(n)));
  out.pickerStatesGeography = out.pickerRows.some((r) => /worldwide, and nothing else/.test(r))
    && out.pickerRows.some((r) => /exactly one country/.test(r));
  out.pickerStatesNameCount = out.pickerRows.some((r) => /up to 8 names/.test(r))
    && !out.pickerRows.some((r) => /up to 20 names/.test(r));
  // ONE FIGURE, SPELLED AS A READER SAYS IT: the server's own quote passes through the same door the
  // footer's does, so no row carries "1.5–2.5".
  out.pickerTurnaroundInWords = out.pickerRows.some((r) => /from 5 to 10 min/.test(r))
    && out.pickerRows.some((r) => /from 1\\.5 to 2\\.5 hours/.test(r))
    && !out.pickerRows.some((r) => /\\d–\\d/.test(r));
  // WHAT EACH CARRIES, marked on its own row, and the claim is in words for a reader who cannot see a tick.
  const rowOf = (re) => [...document.querySelectorAll('.pick-row')].find((b) => re.test(b.innerText || ''));
  const says = (row, label) => Boolean(row && row.querySelector('[aria-label="' + label + '"]'));
  out.chipsKnockout = says(rowOf(/Knockout search/), 'Included: Registers, quick count') && says(rowOf(/Knockout search/), 'Not included: Case law');
  out.chipsFull = says(rowOf(/Full country search/), 'Included: Registers, full search') && says(rowOf(/Full country search/), 'Included: Case law');
  out.chipsGlobal = says(rowOf(/Global preliminary search/), 'Included: Marketplaces') && says(rowOf(/Global preliminary search/), 'Not included: Case law');

  // Fill the required scope. Classes are a LOOKUP now: type a word, pick the class.
  set(namesBox(), 'AQUAPLUS');
  const classInput = document.querySelector('input[aria-label="Add a Nice class"]');
  set(classInput, 'drinks');
  await sleep(160);
  out.classLookup = [...document.querySelectorAll('.typeahead button')].map((b) => b.innerText.trim());
  // 32 is already in scope from the owner's defaults, so it must NOT be offered again; 33 must be.
  out.lookupSkipsChosen = !out.classLookup.some((o) => /^32 · /.test(o));
  out.lookupFindsByWord = out.classLookup.some((o) => /^33 · /.test(o));

  set(classInput, 'software');
  await sleep(160);
  const pick = [...document.querySelectorAll('.typeahead button')].find((b) => /^9 · /.test(b.innerText));
  out.classLookupFound = Boolean(pick);
  if (pick) pick.click();
  await sleep(150);
  // Adding one PROMOTES the inherited list rather than replacing it — 5 and 32 must survive.
  out.classChipReadsName = /9 · Electrical & software/.test(txt());
  out.inheritedKeptOnOverride = /5 · /.test(txt()) && /32 · /.test(txt());

  // The deadline is a DATE field, not a text box.
  out.details = Boolean(document.querySelector('details'));
  const refs = [...document.querySelectorAll('details')].find((d) => /References and dates/.test(d.innerText));
  if (refs) { refs.open = true; await sleep(120); }
  out.deadlineIsDate = [...document.querySelectorAll('input')].some((i) => i.type === 'date');

  const goods = document.querySelector('textarea[aria-label="Goods or services"]');
  out.goodsExampleInside = goods ? goods.placeholder === 'Example: energy drinks; dietary supplements' : false;
  set(goods, 'energy drinks');
  await sleep(120);
  out.steps.push('filled');

  // The dense owner: 13 shops + 1 = 14 checks.
  out.checks = (txt().match(/(\\d+) checks per name/) || [])[1] || null;

  // ── THE PICKER, and the geography that follows from it ────────────────────────────────────────
  //
  // Four rows and a Where panel that CHANGES with the row — worldwide is not a choice on a Global
  // preliminary search, it IS one, so that product has no territory field at all rather than a field
  // whose every use is refused. None of that is observable from a string test; all of it is here.

  // The tier as the FOOTER renders it — innerText, so it carries any text-transform. Read from the
  // element rather than from the whole page: a product name appears in the picker too, and a check that
  // matched there would pass whatever the footer said.
  const tierText = () => {
    const el = document.querySelector('.composer-footer span');
    return el ? el.innerText.trim() : null;
  };

  pickProduct(/Knockout search/);
  await sleep(160);
  out.knockoutTier = /Knockout search/.test(tierText() || '');
  out.knockoutSweep = /1 broad sweep per name/.test(txt());
  out.nativeHiddenOnKnockout = !maybeByText('button', /Native-language investigation/);
  // THE COUNTS ARE PART OF WHAT A KNOCKOUT IS, said on its row: a register count first, then the screen.
  out.knockoutCarriesCounts = /Quick register count for identical, containing and close variants/.test((rowOf(/Knockout search/) || {}).innerText || '')
    && says(rowOf(/Knockout search/), 'Included: Registers, quick count');
  out.caseLawStatedNotOffered = says(rowOf(/Knockout search/), 'Not included: Case law')
    && !maybeByText('button', /^Case law$/);
  out.steps.push('knockout picked');

  // A GLOBAL PRELIMINARY SEARCH HAS NO WHERE FIELD. There is nothing to type into, because there is
  // nothing this product will accept.
  //
  // THE PANEL NO LONGER SAYS WHY. On the owner's ruling of 2026-09-18 the four notes restating what each
  // search's geography means came off this screen and nothing replaces them: the product row names the
  // geography, and a place the register cannot reach is still marked on the place itself. The check is
  // INVERTED rather than deleted — an assertion that simply goes away lets the wording come back with
  // nothing to notice, which is how those notes arrived in the first place.
  pickProduct(/Global preliminary search/);
  await sleep(160);
  out.globalNoTerritoryInput = !whereBox();
  out.globalRestatesNoGeography = !/This search is not narrowed/.test(txt());
  out.steps.push('global picked');

  // A MULTI-COUNTRY FOCUS SEARCH offers regions AND countries, and the one toggle in the offering —
  // inside its own row.
  pickProduct(/Multi-country focus search/);
  await sleep(160);
  out.multiHasTerritoryInput = Boolean(whereBox());
  set(whereBox(), 'euro');
  await sleep(180);
  out.multiOffersRegion = [...document.querySelectorAll('.typeahead button')].some((b) => /European Union/.test(b.innerText));
  const nativeBtn = maybeByText('button', /Native-language investigation/);
  out.nativeToggleOffered = Boolean(nativeBtn);
  out.nativeInsideItsRow = Boolean(nativeBtn && nativeBtn.closest('.pick-row-on') && /Multi-country focus search/.test(nativeBtn.closest('.pick-row-on').innerText));
  out.steps.push('multi picked');

  // …and ONE country is a blocker on it, with the way out NAMED: this is the product boundary a client
  // meets most often, and "pick a Full country search to read France" is the whole of the answer.
  set(whereBox(), 'france');
  await sleep(180);
  const fr = [...document.querySelectorAll('.typeahead button')].find((b) => /^France$/.test(b.innerText.trim()));
  if (fr) fr.click();
  await sleep(180);
  out.oneCountryBlocked = /reads a region, or two or more countries/.test(txt());
  out.oneCountryNamesWayOut = /pick a Full country search to read France/.test(txt());
  const revOne = maybeByText('button', /Review search/);
  out.reviewShutOnOneCountry = revOne ? revOne.disabled === true : null;
  out.steps.push('one-country blocker');

  // A FULL COUNTRY SEARCH offers COUNTRIES ONLY — a region is not a country, and the control fits the
  // product rather than refusing it afterwards. The panel no longer says so in a note beside the control;
  // see the ruling recorded at the Global preliminary search above. Inverted, not deleted.
  pickProduct(/Full country search/);
  await sleep(160);
  out.fullRestatesNoGeography = !/Regions are not offered here/.test(txt());
  set(whereBox(), 'euro');
  await sleep(180);
  out.fullOffersNoRegion = ![...document.querySelectorAll('.typeahead button')].some((b) => /European Union/.test(b.innerText));
  out.fullCarriesCaseLaw = says(rowOf(/Full country search/), 'Included: Case law');
  out.fullNativeAutomatic = /searched automatically/.test(txt()) && !maybeByText('button', /Native-language investigation/);
  set(whereBox(), 'united s');
  await sleep(180);
  const us = [...document.querySelectorAll('.typeahead button')].find((b) => /United States/.test(b.innerText));
  if (us) us.click();
  await sleep(180);
  out.fullOneCountryChip = /United States/.test(txt());
  out.fullReplacesRatherThanStacks = /naming another country replaces it/.test(txt());
  out.steps.push('full country picked');

  // Back to the shape the wire assertions below read.
  pickProduct(/Multi-country focus search/);
  await sleep(160);
  set(whereBox(), 'china');
  await sleep(180);
  const cn = [...document.querySelectorAll('.typeahead button')].find((b) => /^China$/.test(b.innerText.trim()));
  if (cn) cn.click();
  await sleep(160);
  set(whereBox(), 'japan');
  await sleep(180);
  const jp = [...document.querySelectorAll('.typeahead button')].find((b) => /^Japan$/.test(b.innerText.trim()));
  if (jp) jp.click();
  await sleep(160);
  findByText('button', /Native-language investigation/).click();
  await sleep(160);
  out.steps.push('native language on');

  // ── layout, measured ──
  const doc = document.documentElement;
  out.horizontalOverflow = doc.scrollWidth - doc.clientWidth;

  // Find the footer by its COMPUTED position, not by its text: innerText matches every ancestor too,
  // and Array.find returns the outermost one, which measures the whole screen and passes either way.
  const footer = [...document.querySelectorAll('div')].find((e) => getComputedStyle(e).position === 'sticky');
  out.footerIsSticky = Boolean(footer);
  if (footer) {
    window.scrollTo(0, 0);
    await sleep(120);
    const r = footer.getBoundingClientRect();
    out.footerWidth = Math.round(r.width);
    out.pageScrolls = doc.scrollHeight > window.innerHeight;
    // Pinned: with the page scrolled to the top and content below it, a sticky-bottom footer sits at the
    // bottom edge of the viewport rather than off the bottom of the document.
    out.footerInViewport = r.bottom <= window.innerHeight + 1 && r.bottom > 0;
    out.footerBottomGap = Math.round(window.innerHeight - r.bottom);
  }
  out.viewportWidth = window.innerWidth;

  // ── the wire ──
  findByText('button', /Review search/).click();
  await mustSettle(() => /review before you start/i.test(txt()), 5000, 'the review dialog never opened');
  out.reviewOpened = /review before you start/i.test(txt());
  out.reviewIsModal = Boolean(document.querySelector('.modal-scrim'));
  // NO STOPWATCH on the one screen where being hurried is worst. Matched loosely — the old copy was
  // "Good for 9:47." and any m:ss beside the confirm button is the thing being kept off it.
  out.noCountdown = !/good for \\d+:\\d\\d|expired/i.test(txt());
  // THE ROWS, IN THE DESIGN'S ORDER. textContent, not innerText: the labels are uppercased by CSS.
  const scrim = () => document.querySelector('.modal-scrim');
  out.reviewRows = [...scrim().querySelectorAll('.modal-row')].map((r) => (r.querySelector('.field-label') || {}).textContent || '');
  out.reviewTitle = (scrim().querySelector('h2') || {}).textContent || null;
  const rowText = (label) => { const r = [...scrim().querySelectorAll('.modal-row')].find((x) => ((x.querySelector('.field-label') || {}).textContent || '') === label); return r ? r.innerText.replace(/\\s+/g, ' ') : null; };
  out.reviewNative = rowText('Native language');
  out.reviewRegisters = rowText('Registers to search');
  out.reviewShowAll = Boolean([...scrim().querySelectorAll('button')].find((b) => /^Show all 13$/.test(b.textContent.trim())));
  out.reviewBack = Boolean([...scrim().querySelectorAll('button')].find((b) => /^Back$/.test(b.textContent.trim())));
  out.steps.push('planned');

  // ── a REFUSAL at the run door stays where the eye is ──
  // The stub answers 502 for this one press. The regression: the dialog used to close and write the
  // reason near the bottom of a form several screens tall, so pressing Start while scrolled anywhere
  // else showed the user precisely nothing.
  window.__failNextRun = true;
  findByText('button', /^Start search$/).click();
  await mustSettle(() => /was not started/i.test(txt()), 5000, 'the failure notice never appeared after Start search');
  out.failureShown = /was not started/i.test(txt());
  out.failureInsideModal = Boolean(scrim()) && /was not started/i.test(scrim().innerText);
  out.failureNamesReason = /roster|no known customer|upstream|refused/i.test(txt());
  out.reviewAgainOffered = Boolean(maybeByText('button', /Review again/));
  out.startGoneOnFailure = !maybeByText('button', /^Start search$/);
  window.__failNextRun = false;
  findByText('button', /Review again/).click();
  // Settle on the failure DISAPPEARING, not on the dialog's title: the title never left the screen
  // (that is the whole point of the fix), so waiting for it passes instantly and proves nothing.
  await mustSettle(() => !/was not started/i.test(txt()), 6000, 'the failure notice never cleared after Review again');
  out.reviewAgainReopened = Boolean(maybeByText('button', /^Start search$/)) && !/was not started/i.test(txt());
  out.steps.push('refusal shown in the dialog');

  // ── second pass: a REFUSED SHAPE must not reach the wire ──
  // The blocker text only proves the label. What matters is that NOTHING is posted: a screen that shows
  // a blocker and posts anyway is a screen whose refusal is decoration.
  //
  // WAIT FOR THE BUTTON, NOT FOR ITS NEIGHBOUR. The settle above waits for the failure notice to CLEAR,
  // and the notice can clear before the dialog re-renders its controls; a click then lands on a screen
  // that has not finished. Measured on CI under load, in the same step where home-render-check passed.
  await mustSettle(() => Boolean(maybeByText('button', /^Back$/)), 6000,
    'Back never came back after the failure notice cleared');
  findByText('button', /^Back$/).click();
  await mustSettle(() => !document.querySelector('.modal-scrim'), 5000, 'the composer never came back after Back');
  pickProduct(/Full country search/);
  await sleep(200);
  // Scoped to a TERRITORY chip. The chip-own class is the class chips' class too, so an unscoped search
  // for a Remove button took the first CLASS off the request instead — and every geography assertion
  // after it was then measuring a draft nobody had composed.
  const dropOne = [...document.querySelectorAll('button')]
    .find((b) => /^Remove (United States|China|Japan|France|Germany)$/.test(b.getAttribute('aria-label') || ''));
  if (dropOne) dropOne.click();
  await sleep(220);
  out.noTerritoryBlocked = /reads one country/.test(txt());
  out.refusedReviewShut = findByText('button', /Review search/).disabled === true;
  // Pressed anyway. A disabled button that still fires is the shape this whole check exists for, and the
  // server-side assertion below (no plan post ever named a shape the offering refuses) is what proves it
  // did not.
  findByText('button', /Review search/).click();
  await sleep(400);
  // CASE-INSENSITIVE: the eyebrow is uppercased by CSS, and a case-sensitive check never matched.
  out.refusedDialogRefused = !/review before you start/i.test(txt());
  out.steps.push('an unacceptable geography refused at the composer');

  // ── third pass: the KNOCKOUT on the WIRE ──
  // The picker rendering and the footer label prove the screen. What decides which product is run and
  // billed is what reaches the server — and a control that changes the label and sends the old value is
  // exactly the shape of the last two incidents on this screen.
  pickProduct(/Knockout search/);
  await sleep(220);
  out.knockoutReviewable = findByText('button', /Review search/).disabled === false;
  findByText('button', /Review search/).click();
  await mustSettle(() => /review before you start/i.test(txt()), 5000, 'the review dialog never opened for the knockout');
  out.steps.push('planned a knockout');

  // Leave the screen COMPOSED rather than mid-dialog. Closing it also exercises the one control that
  // must always work here: nothing is spent until Start, so Back must always be reachable.
  const back = maybeByText('button', /^Back$/);
  if (back) back.click();
  await sleep(220);
  out.modalDismissed = !document.querySelector('.modal-scrim');

  // ── fourth pass: the marketplaces control, and the comparison table ─────────────────────────────
  pickProduct(/Full country search/);
  await sleep(220);
  set(whereBox(), 'united s');
  await sleep(200);
  const usAgain = [...document.querySelectorAll('.typeahead button')].find((b) => /United States/.test(b.innerText));
  if (usAgain) usAgain.click();
  await sleep(220);
  out.fullRunnable = findByText('button', /Review search/).disabled === false;

  // MARKETPLACES — the add control sits beside the chips, so typing in it must MOVE the estimate.
  // Before, extras rode the wire and the engine ran a grid column for each while checksPerName sat
  // still. Nothing but a real browser can press this.
  const shopsBox = document.querySelector('input[aria-label="Extra marketplaces for this search"]');
  out.extraShopsControlBeside = Boolean(shopsBox);
  if (shopsBox) {
    const checksBefore = (txt().match(/(\\d+) checks per name/) || [])[1];
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(shopsBox, 'gnc.com, iherb.com');
    shopsBox.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(220);
    const checksAfter = (txt().match(/(\\d+) checks per name/) || [])[1];
    out.extraShopsMovedChecks = checksBefore != null && checksAfter != null
      ? Number(checksAfter) - Number(checksBefore) : null;
    setter.call(shopsBox, '');
    shopsBox.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(180);
  }
  // THE OWNER'S COPY, and the SECOND implementation of the rule — portal-ui/test/screenCopy.test.ts
  // holds the first, against the source — so a copy change reds here too.
  //
  // DOUBLE the backslashes, as every regex in this file does. This block is a template literal that is
  // evaluated in the page, and a template literal eats an unrecognised escape.
  out.marketplacesSayWhereTheyComeFrom =
    /forced\\s+deep\\s+dive\\s+inherited\\s+from\\s+the\\s+company/.test(txt())
    && /common\\s+law\\s+sweeps\\s+everything\\s+it\\s+can\\s+find/.test(txt());

  // THE COMPARISON, and the scrollbar it must keep to itself. What a client asks is "am I buying the
  // right one of the four", which is a comparison.
  const depths = [...document.querySelectorAll('details')].find((d) => /Detailed search comparison table/.test(d.innerText));
  out.matrixOffered = Boolean(depths);
  out.matrixClosedAtRest = depths ? depths.open === false : null;
  if (depths) {
    depths.open = true;
    await sleep(220);
    const wrap = depths.querySelector('.table-wrap');
    const table = depths.querySelector('table.data');
    out.matrixRows = depths.querySelectorAll('table.data tbody tr').length;
    out.matrixCols = depths.querySelectorAll('table.data thead th').length;
    out.matrixHeaders = [...depths.querySelectorAll('table.data thead th')].map((th) => th.innerText.trim()).filter(Boolean);
    out.matrixScrollsItself = wrap ? getComputedStyle(wrap).overflowX === 'auto' : null;
    // The table is wider than the 720px composer column by design (min-width 760). The wrapper takes
    // that on; the document must not.
    out.matrixWiderThanColumn = wrap && table ? table.scrollWidth > wrap.clientWidth : null;
    // HOW FAR past its wrapper, not just whether.
    out.matrixOverflowPx = wrap && table ? table.scrollWidth - wrap.clientWidth : null;
    // ── THE ESCAPE MUST BE A CHILD OF THE THING THAT CAPS IT ─────────────
    // The cap is a direct-child selector, and an opt-out applied to a GRANDCHILD asks a box to be wider
    // than the box it lives in. No assertion over source text can see this; the parent chain can.
    //
    // classList, not a regex: this whole block is a template literal, where a lone backslash-b is the
    // BACKSPACE escape rather than a word boundary. And no backticks in these comments.
    const wide = document.querySelector('.composer-wide');
    out.wideParentClass = wide?.parentElement?.className ?? null;
    out.wideIsDirectChildOfColumn = !!wide && !!wide.parentElement?.classList.contains('composer-col');
    out.matrixColsVisible = wrap
      ? [...depths.querySelectorAll('table.data thead th')]
          .filter((th) => th.offsetLeft + th.offsetWidth <= wrap.clientWidth + 1).length
      : null;
    out.pageStillDoesNotScroll = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    out.matrixNamesNoMachinery = !/jxLanes|commonLawGrid|registerProbe/.test(depths.innerText);
    out.matrixSaysGeography = /exactly one country/.test(depths.innerText)
      && /worldwide, and nothing else/.test(depths.innerText);
    out.matrixSaysCaseLawProduct = /this is the search that carries it/.test(depths.innerText);
    out.matrixNoRungs = !/Depth \\d/.test(depths.innerText);
    out.matrixGlyphsDrawn = [...new Set((depths.innerText.match(/[●◐○]/g) || []))].sort().join('');
    out.matrixLegendShown = /Included/.test(depths.innerText) && /Not on this depth/.test(depths.innerText);
    out.matrixCurrentCols = depths.querySelectorAll('table.data thead th[aria-current]').length;
    out.matrixCurrentIsHere = /you are here/i.test(depths.innerText);   // th is uppercased by CSS
    out.matrixNoNotAvailable = !/Not available/.test(depths.innerText);
    depths.open = false;
    await sleep(120);
  }
  out.steps.push('coherence rules');

  // ── the worldwide read ──────────────────────────────────────────────────────────────────────────
  //
  // The one instruction a brief can give that REMOVES something from the form. Both halves are
  // exercised here: the chips must go, and the receipt must say so.
  const briefBox2 = document.querySelector('textarea[aria-label="Describe the search"]');
  set(briefBox2, 'Actually make it worldwide, not just the US.');
  await sleep(140);
  findByText('button', /Fill it in for me/).click();
  await mustSettle(() => /the named territories were cleared/.test(txt()), 5000, 'the worldwide read never said it cleared the named territories');
  out.worldwideCleared = /the named territories were cleared/.test(txt());
  out.worldwideChipsGone = [...document.querySelectorAll('.chip')].every((c) => !/United States|China/.test(c.innerText));
  out.worldwideChipShown = /Worldwide/.test(txt());
  out.steps.push('worldwide read');

  // ── a TEMPLATE applied ─────────────────────────────────────────────────────────────────────────
  //
  // The template sets the search and its depth, and its search is the selected row. On the worldwide
  // search it sets, Where is the chip and no picker — what the product draws for that search.
  const tpl = templates();
  if (!tpl) throw new Error('the Search templates control is not on the form');
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(tpl, 'launch-screen');
  tpl.dispatchEvent(new Event('change', { bubbles: true }));
  await mustSettle(() => /sets the search and how deep it goes/.test(txt()), 4000, 'applying a template drew no line saying what it set');
  out.templateLine = /Launch screen sets the search and how deep it goes\\. Names, goods and classes are still yours to set\\./.test(txt());
  out.templateClearOffered = Boolean(maybeByText('button', /^Clear template$/));
  out.templateSelectsItsSearch = /Global preliminary search/.test((document.querySelector('.pick-row-on') || {}).innerText || '');
  out.templateWorldwideNoPicker = !whereBox() && [...document.querySelectorAll('.chip')].some((c) => c.innerText.trim() === 'Worldwide');
  out.templateNoNativeOption = !maybeByText('button', /Native-language investigation/);
  findByText('button', /^Clear template$/).click();
  await mustSettle(() => !/sets the search and how deep it goes/.test(txt()), 4000, 'Clear template left the template applied');
  out.templateCleared = true;
  out.steps.push('template applied and cleared');

  // Leave it on a state a human can read: the deepest search, one country, nothing blocked.
  pickProduct(/Full country search/);
  await sleep(200);
  set(whereBox(), 'united s');
  await sleep(200);
  const usFinal = [...document.querySelectorAll('.typeahead button')].find((b) => /United States/.test(b.innerText));
  if (usFinal) usFinal.click();
  await sleep(220);
  // Scoped to the "Not runnable as set" notice, which asks the real question: is the composer blocked,
  // rather than does the word "blocked" appear anywhere on screen.
  const notRunnable = [...document.querySelectorAll('.notice')].find((e) => /Not runnable as set/.test(e.innerText));
  out.leftClean = !notRunnable;
  window.scrollTo(0, 0);
  await sleep(140);
  return out;
  } catch (e) {
    // A THROW MUST NOT READ AS "evaluate returned nothing". The driver is a long script and any step in
    // it can die; without this the harness reported an opaque failure that named no step, and the first
    // assertion to touch a missing key blew up with a TypeError instead. out.steps says how far it got.
    out.fatal = String(e && e.message ? e.message : e);
    out.raw = 'driver threw after: ' + out.steps.join(' -> ');
    // the named throw says WHAT was missing; this says what was on screen instead. Without it a
    // diagnostic fix still loses the diagnosis, which is the whole complaint this change answers.
    out.body = txt().slice(0, 900);
    return out;
  }
})()
`

// ── THE READER WHO NAMES NO PLACES, AND IS SHOWN THEIR COMPANY’S ─────────────────────────────────
//
// The Where panel draws the company’s own territories whenever the draft holds none, tagged with where
// they came from. For a while the rest of the screen could not see them: the recommendation read the
// DRAFT, so a form showing four countries recommended nothing and preselected nothing, and the request
// stamped its geography "worldwide" — the one mode the company’s territories may not narrow. The two
// searches that read named places were then refused at the engine’s door, in words telling the reader to
// name territories the screen was already showing them, and a knockout ran the whole world instead of
// the four.
//
// SO THIS DRIVES THE STATE AND READS THREE THINGS AT ONCE: what the screen recommends, what the request
// stamps, and what the dialog tells the client. They are one fact and they used to disagree.
const INHERITED_SCRIPT = `
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const settle = async (pred, ms = 6000) => { const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(60); } return false; };
  const mustSettle = async (pred, ms, what) => { if (!await settle(pred, ms)) throw new Error(what + ' (waited ' + ms + 'ms)'); };
  const txt = () => document.body.innerText;
  const maybeByText = (sel, re) => [...document.querySelectorAll(sel)].find((e) => re.test(e.innerText || ''));
  const findByText = (sel, re) => { const el = maybeByText(sel, re);
    if (!el) throw new Error('no ' + sel + ' matching ' + re + ' is on screen'); return el; };
  const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true })); };
  const scrim = () => document.querySelector('.modal-scrim');
  const rowText = (label) => { const r = [...scrim().querySelectorAll('.modal-row')]
    .find((x) => ((x.querySelector('.field-label') || {}).textContent || '') === label);
    return r ? r.innerText.replace(/\\s+/g, ' ').trim() : null; };
  const pickProduct = (re) => {
    const row = [...document.querySelectorAll('.pick-row')].find((b) => re.test(b.innerText || ''));
    if (!row) throw new Error('no product row matching ' + String(re));
    const hit = row.querySelector('.pick-row-hit');
    if (!hit) throw new Error('the row matching ' + String(re) + ' has no pick button');
    hit.click(); };
  const out = { steps: [] };
  try {

  await mustSettle(() => document.querySelectorAll('.pick-row').length >= 4 && /Describe it/.test(txt()), 8000,
    'the one form never painted its search rows');

  // WAIT FOR THE COMPANY’S OWN LIST TO LAND BEFORE TOUCHING THE FORM. The profile arrives after the
  // first paint and the draft is rebuilt when it does, so a name typed before it is silently thrown
  // away — which surfaced three screens later as a missing Review button and named nothing.
  await mustSettle(() => [...document.querySelectorAll('.chip')].some((c) => (c.innerText || '').trim() === 'Canada'),
    8000, 'the company own territories never reached the Where panel');

  // ONE NAME AND NOTHING ELSE. Every territory on this screen is the company’s.
  //
  // TYPED UNTIL IT HOLDS, and the attempts are reported. This screen is still settling when the form
  // first paints — a late answer rebuilds the draft and discards what was typed before it — so a single
  // set left the form empty and the failure surfaced three reads later as a missing button, naming
  // nothing about the cause. Retrying is not papering over that: the number of attempts is recorded, so
  // a screen that needs five is visible as a screen that needs five rather than as a green tick.
  const nameBox = () => document.querySelector('textarea[aria-label="Names to clear"]');
  const reviewBtn = () => maybeByText('button', /Review search/);
  out.typeAttempts = 0;
  const filled = await settle(() => {
    if ((nameBox() || {}).value === 'AQUAPLUS' && reviewBtn()) return true;
    if (nameBox()) { out.typeAttempts++; set(nameBox(), 'AQUAPLUS'); }
    return false;
  }, 12000);
  if (!filled) throw new Error('the form never held the name and drew a Review button (typed '
    + out.typeAttempts + ' times; name now ' + JSON.stringify((nameBox() || {}).value ?? null)
    + '; rows ' + document.querySelectorAll('.pick-row').length
    + '; buttons ' + JSON.stringify([...document.querySelectorAll('button')].map((b) => (b.innerText || b.textContent || '').trim()).filter(Boolean).slice(0, 40)) + ')');
  await sleep(400);
  out.chips = [...document.querySelectorAll('.chip')].map((c) => (c.innerText || '').trim());
  const on = document.querySelector('.pick-row-on');
  out.preselected = on ? (on.innerText || '').split('\\n')[0].trim() : null;
  out.recommends = /Recommended for what you entered/.test(txt());
  const footer = [...document.querySelectorAll('div')].find((e) => getComputedStyle(e).position === 'sticky');
  out.footer = footer ? (footer.innerText || '').replace(/\\s+/g, ' ').trim() : null;
  out.reviewShut = findByText('button', /Review search/).disabled;
  out.steps.push('inherited territories, nothing picked by hand');

  // A SHUT REVIEW IS A FINDING, NOT A CRASH. Pressing it and waiting for a dialog that cannot open
  // reports "the review dialog never opened" — true, and three steps from the cause. The reads above
  // are already taken; the assertions name which of them is wrong.
  if (out.reviewShut) return out;

  findByText('button', /Review search/).click();
  await mustSettle(() => /review before you start/i.test(txt()), 6000, 'the review dialog never opened');
  out.dialogSearch = rowText('Search');
  out.dialogWhere = rowText('Where');
  out.dialogRegisters = rowText('Registers to search');
  out.steps.push('dialog read');

  // ── THE FLOOR: the search that IS worldwide must still say so ──
  // "account-default" is refused by name on a Global preliminary search — it accepts no narrowing — so a
  // fix that stamped every empty draft the same way would break the one product it must not touch.
  findByText('button', /^Back$/).click();
  await mustSettle(() => !scrim(), 5000, 'the composer never came back after Back');
  pickProduct(/Global preliminary search/);
  await sleep(300);
  // Named with the service that searches it, from the provider's own label — this pass serves 'Signa'.
  out.worldwideChipText = ([...document.querySelectorAll('.chip')].map((c) => (c.innerText || '').trim()).find((t) => /^Worldwide/.test(t))) ?? null;
  out.worldwideChip = out.worldwideChipText === 'Worldwide, searched on Signa';
  findByText('button', /Review search/).click();
  await mustSettle(() => /review before you start/i.test(txt()), 6000, 'the review dialog never opened on the worldwide search');
  out.worldwideWhere = rowText('Where');
  out.steps.push('worldwide floor read');

  return out;
  } catch (e) {
    out.fatal = String(e && e.message ? e.message : e);
    out.raw = 'driver threw after: ' + out.steps.join(' -> ');
    out.body = txt().slice(0, 900);
    return out;
  }
})()
`
// The profile goes inside a run root whose TMPDIR the browser inherits, so the singleton
// lock it writes there leaves with the root instead of accumulating in the shared one.
const { profile: userDir, env: chromeEnv, keep: keepRoot } = browserRun("composer-check-")
// --keep means LEAVE THE PROFILE: take the run root out of the exit sweep, or the flag
// would go on reading as working while the directory it promises is removed anyway.
if (keep) keepRoot()

// Chrome's --dump-dom cannot run our driver script, so the driving happens via the DevTools protocol —
// but standing that up needs no extra dependency: a plain evaluate over the websocket is enough.
const chrome = spawn('google-chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--user-data-dir=${userDir}`, '--window-size=1280,900',
  '--remote-debugging-port=0', `${origin}/portal/new`,
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

const { WebSocket } = await import('node:worker_threads').then(() => ({ WebSocket: globalThis.WebSocket }))
const ws = new WebSocket(wsUrl)
let id = 0
const pending = new Map()
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data)
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
})
await new Promise((r) => ws.addEventListener('open', r))
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })

// Attach to the page target and evaluate there.
const { result: targets } = await send('Target.getTargets')
const page = targets.targetInfos.find((t) => t.type === 'page')
const { result: sess } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true })
const sessionId = sess.sessionId
const evalIn = (expr) => new Promise((r) => {
  const i = ++id
  pending.set(i, r)
  ws.send(JSON.stringify({ id: i, sessionId, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }))
})

await new Promise((r) => setTimeout(r, 1500))
const res = await evalIn(SCRIPT)
const out = res.result?.result?.value ?? { fatal: 'evaluate returned nothing', raw: JSON.stringify(res).slice(0, 900) }

// ── phase two: the notice, in each state a blocked reader can be in ─────────────────────────────────
//
// Same browser, same server, same everything except what /me says about the engine. The composer above
// was measured on a working install and never renders this at all.
//
// READ FROM THE LIVE DOM, not from a string the page was given: the point is that the screen renders
// the remedy its own contract chose, and a check that asserted the contract's output would be asserting
// the thing that produced it.
const NOTICE_STATES = [
  { name: 'no engine program, packaged install, client',
    me: { engineMode: 'demo', setupRoute: 'packaged', engineProgramDisputed: false, permissions: { run: true, manage: false } },
    says: /install a reasoning CLI/, alsoSays: /npx clearotron install/, andSays: /restart the service/i,
    link: false },
  // "Staff" is a reader who sees everything, said the way /me says it (`accounts: "*"`): Global config is
  // served to them and to no one else, so the link is offered on that fact and not on Manage.
  { name: 'no engine program, source checkout, staff',
    me: { engineMode: 'demo', setupRoute: 'checkout', engineProgramDisputed: false, permissions: { run: true, manage: true }, accounts: '*' },
    says: /install a reasoning CLI/, alsoSays: /npm run setup/, andSays: /restart the service/i,
    link: true },
  { name: 'the program is here and the engine cannot see it, client',
    me: { engineMode: 'demo', setupRoute: 'packaged', engineProgramDisputed: true, permissions: { run: true, manage: false } },
    says: /could not find it when it last started/, alsoSays: /Restart the engine service/,
    andSays: /will not change this/, link: false },
  { name: 'the program is here and the engine cannot see it, staff',
    me: { engineMode: 'demo', setupRoute: 'packaged', engineProgramDisputed: true, permissions: { run: true, manage: true }, accounts: '*' },
    says: /could not find it when it last started/, alsoSays: /Restart the engine service/,
    andSays: /will not change this/, link: true },
]

// The footer is on the first screen now — there is no fork to answer before it paints.
const REACH_AND_READ = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const txt = () => document.body.innerText;
  const settle = async (pred, ms) => { const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(60); } return false; };
  const byText = (sel, re) => [...document.querySelectorAll(sel)].find((e) => re.test(e.innerText || ''));

  if (!await settle(() => document.querySelectorAll('.pick-row').length >= 4, 8000)) return { fatal: 'the one form never painted' };
  // The notice REPLACES the start button, so either one appearing means the footer is painted and the
  // screen has decided. Waiting for the notice alone would hang for the full budget on a regression that
  // renders the button instead, and report it as "nothing rendered" rather than as what it is.
  // READ, never discarded. A wait whose answer is thrown away cannot tell "the screen decided" from
  // "the budget ran out", and the two produce the same empty read downstream — which the assertions
  // would then report as "nothing rendered" rather than as a screen that never finished painting.
  const painted = await settle(() => document.querySelector('.footer-demo-note') || /Review search/.test(txt()), 8000);
  const n = document.querySelector('.footer-demo-note');
  if (!painted) return { fatal: 'neither the notice nor the start button appeared within 8s' };
  return {
    text: n ? n.textContent.replace(/[\\s\\u00a0]+/g, ' ').trim() : null,
    buttons: n ? [...n.querySelectorAll('button')].map((b) => b.textContent.trim()) : [],
    startButton: [...document.querySelectorAll('button')].some((b) => /Review search/.test(b.textContent)),
  };
})()`

const notices = []
for (const st of NOTICE_STATES) {
  meEngine = st.me
  await evalIn(`location.href = ${JSON.stringify(`http://127.0.0.1:${port}/portal/new`)}; 'go'`)
  await new Promise((r) => setTimeout(r, 1200))          // the navigation itself, not the render
  const read = (await evalIn(REACH_AND_READ)).result?.result?.value ?? null
  notices.push({ state: st.name, expect: st, got: read })
}
// PUT THE ENGINE BACK. This loop leaves `meEngine` holding the LAST blocked state, and every phase added
// after it then measures an installation with no usable engine — a composer that renders the notice
// INSTEAD of the start button. It costs nothing here and it is invisible from there: the screen paints,
// the rows paint, the form fills in, and only the button the reader would press is missing.
meEngine = {}

// ── phase three: the evidence, one picture per state the design draws ───────────────────────────────
//
// Only with --shot-dir. Each state is reached from a fresh load, the way a reader reaches it, and drawn
// in both themes. The allowance states move only /usage; the rest run on a company with plenty left.
const EVIDENCE_HELPERS = `
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const txt = () => document.body.innerText;
  const settle = async (pred, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(60); } return false; };
  const must = async (pred, ms, what) => { if (!await settle(pred, ms)) throw new Error(what); };
  const byText = (sel, re) => { const el = [...document.querySelectorAll(sel)].find((e) => re.test(e.innerText || '')); if (!el) throw new Error('no ' + sel + ' matching ' + re); return el; };
  const set = (el, v) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : el.tagName === 'SELECT' ? HTMLSelectElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  };
  const ready = () => must(() => document.querySelectorAll('.pick-row').length >= 4, 8000, 'the form never painted');
  const brief = () => document.querySelector('textarea[aria-label="Describe the search"]');
  const names = () => document.querySelector('textarea[aria-label="Names to clear"]');
  const addPlace = async (typed, name) => {
    set(document.querySelector('input[aria-label="Add a territory"]'), typed);
    await sleep(200);
    const opt = [...document.querySelectorAll('.typeahead button')].find((b) => b.firstChild && b.firstChild.textContent.trim() === name);
    if (!opt) throw new Error('the typeahead did not offer ' + name);
    opt.click();
    await sleep(160);
  };
  const described = async (native) => {
    set(brief(), 'AQUAPLUS for an energy drink in the EU and Switzerland, launch in November');
    await sleep(120);
    byText('button', /Fill it in for me/).click();
    await must(() => /what i read/i.test(txt()), 5000, 'the read never came back');
    await must(() => Boolean(document.querySelector('.pick-row-on')), 3000, 'the read selected no search');
    await sleep(200);
    if (native) { byText('button', /Native-language investigation/).click(); await sleep(200); }
  };
  const reviewed = async () => {
    byText('button', /Review search/).click();
    await must(() => /review before you start/i.test(txt()), 5000, 'the review never opened');
    await sleep(250);
  };
`
const PLENTY = { today: 11, dailyRuns: 20 }
const EVIDENCE = [
  { name: 'allowance-plenty', usage: { today: 8, dailyRuns: 20 }, setup: 'await ready();' },
  { name: 'allowance-few', usage: { today: 17, dailyRuns: 20 }, setup: 'await ready();' },
  { name: 'allowance-none', usage: { today: 20, dailyRuns: 20 },
    setup: `await ready(); set(names(), 'AQUAPLUS'); await sleep(100); await addPlace('euro', 'European Union'); await addPlace('switz', 'Switzerland');
            await must(() => Boolean(document.querySelector('.pick-row-on')), 3000, 'nothing was preselected');
            if (!byText('button', /Review search/).disabled) throw new Error('the start is not refused with no searches left');` },
  { name: 'filled', usage: PLENTY, setup: 'await ready(); await described(true);' },
  { name: 'template', usage: PLENTY,
    setup: `await ready(); set(document.querySelector('select[aria-label="Search templates"]'), 'launch-screen');
            await must(() => /sets the search and how deep it goes/.test(txt()), 4000, 'the template line never appeared');` },
  { name: 'review-native-on', usage: PLENTY, setup: 'await ready(); await described(true); await reviewed();' },
  { name: 'review-native-off', usage: PLENTY, setup: 'await ready(); await described(false); await reviewed();' },
  // THE STATE THIS FILE COULD NOT DRAW. The register reaches four of the places the company has saved,
  // and not the fifth — so the form marks it, refuses to add another like it, and the client takes it off
  // and carries on. Its setup ASSERTS the line is on the screen before a picture is taken: a state that
  // cannot find it errors and writes no file, which is what stops this becoming another picture of a
  // screen that had nothing to show.
  { name: 'register-cannot-reach', usage: PLENTY,
    reach: ['European Union', 'United States', 'United Kingdom', 'Switzerland'],
    registerLabel: 'Signa',
    profile: ['European Union', 'United States', 'China'],
    setup: `await ready(); set(names(), 'AQUAPLUS'); await sleep(300);
            await must(() => /China . not available with register Signa/.test(txt()), 4000,
              'the unreachable territory is not marked on the screen — this picture would show nothing');
            await must(() => Boolean([...document.querySelectorAll('button[aria-label]')].find((b) => /^Remove China$/.test(b.getAttribute('aria-label')))), 3000,
              'the unreachable territory cannot be removed, so nothing on this screen can take it off');` },
  { name: 'queued', usage: PLENTY,
    setup: `await ready(); await described(true); await reviewed(); byText('button', /^Start search$/).click();
            await must(() => /Clearance queued/.test(txt()), 5000, 'the queued screen never appeared');` },
]

const cdp = (method, params = {}) => new Promise((r) => {
  const i = ++id
  pending.set(i, r)
  ws.send(JSON.stringify({ id: i, sessionId, method, params }))
})
// A FULL-HEIGHT VIEWPORT, not a beyond-viewport capture. The form's footer is sticky and the review is a
// fixed overlay, and a beyond-viewport capture paints both where the 900px viewport put them — over the
// middle of the page. Growing the viewport to the page's height puts the footer at the page's end and lets
// the overlay cover the page, which is what a reader scrolling it sees.
// WIDTH IS THE CALLER'S, because a layout that works at 1280 and breaks on a phone is a defect this
// file could not see while it only ever rendered one width. The height is still measured AFTER the width
// is applied, below — a narrow viewport reflows the page taller, and measuring first captures a page cut
// off at the fold.
const capture = async (path, width = 1280) => {
  await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 700 })
  await new Promise((r) => setTimeout(r, 300))
  const h = (await evalIn('Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)')).result?.result?.value ?? 900
  await cdp('Emulation.setDeviceMetricsOverride', { width, height: Math.max(900, h), deviceScaleFactor: 1, mobile: width < 700 })
  await new Promise((r) => setTimeout(r, 400))
  const shot = await cdp('Page.captureScreenshot', { format: 'png' })
  await cdp('Emulation.clearDeviceMetricsOverride', {})
  const data = shot.result?.result?.data ?? shot.result?.data
  if (!data) throw new Error(`no screenshot came back for ${path}`)
  writeFileSync(path, Buffer.from(data, 'base64'))
}

// The main pass's own posts end here. The evidence below posts plans of its own, and the verdict on what
// the main pass put on the wire must not read one of those as the last plan it made.
const mainPassPosts = posted.length

// ── the inherited-territories pass ──────────────────────────────────────────────────────────────────
// After mainPassPosts deliberately: this pass posts plans of its own, and the verdict on what the main
// pass put on the wire must not read one of them as the last plan it made.
profileTerritories = ['United States', 'United Kingdom', 'European Union', 'Canada']
registerLabelNow = 'Signa'
const inheritedFrom = posted.length
await evalIn(`location.href = ${JSON.stringify(`http://127.0.0.1:${port}/portal/new`)}; 'go'`)
await new Promise((r) => setTimeout(r, 1400))
const inherited = (await evalIn(INHERITED_SCRIPT)).result?.result?.value ?? { fatal: 'evaluate returned nothing' }
const inheritedPlans = posted.slice(inheritedFrom).filter((p) => p.path === '/portal/api/run/plan').map((p) => p.body)
profileTerritories = []
registerLabelNow = null

// ── the saved-codes pass ────────────────────────────────────────────────────────────────────────────
// A company's own territories AS THE STORE HOLDS THEM — codes — against a register whose coverage
// arrives as names. Every other pass here draws names on both sides, so none of them exercised the
// join; on a served portal a company holding US, EU and UK read "not available" on all three, on a
// register covering every one of them.
profileTerritories = ['US', 'EU', 'UK']
registerReach = ['European Union', 'United States', 'United Kingdom']
registerLabelNow = 'Signa'
await evalIn(`location.href = ${JSON.stringify(`http://127.0.0.1:${port}/portal/new`)}; 'go'`)
await new Promise((r) => setTimeout(r, 1400))
const savedCodes = (await evalIn(`(async () => {
  const t0 = Date.now();
  const removers = () => [...document.querySelectorAll('button[aria-label^="Remove "]')].map((b) => b.getAttribute('aria-label').slice(7));
  while (Date.now() - t0 < 6000 && !['US', 'EU', 'UK'].every((c) => removers().includes(c))) await new Promise((r) => setTimeout(r, 60));
  const own = [...document.querySelectorAll('button[aria-label^="Remove "]')].map((b) => b.closest('.chip'));
  return { removers: removers(), deferred: own.filter((c) => c && c.classList.contains('chip-deferred')).map((c) => c.innerText.trim()),
    notAvailable: (document.body.innerText.match(/[^\\n]*not available with register[^\\n]*/g) || []) };
})()`)).result?.result?.value ?? { fatal: 'evaluate returned nothing' }
profileTerritories = []
registerReach = undefined
registerLabelNow = null
const evidence = []
if (shotDir) {
  // A named company and a named operator, so each line reads the way a reader meets it.
  meEngine = { brand: 'Tolliver & Quillon', accountNames: { coastline: 'Coastline Drinks' } }
  for (const st of EVIDENCE) {
    usageNow = { ...usageNow, ...st.usage }
    // A state says what the deployment is, or inherits the default: no declared reach, no register name,
    // and no company territories. Reset every time rather than left set, so one state cannot silently
    // decide what the next one renders.
    registerReach = st.reach
    registerLabelNow = st.registerLabel ?? null
    profileTerritories = st.profile ?? []
    await evalIn(`document.documentElement.removeAttribute('data-theme'); location.href = ${JSON.stringify(`http://127.0.0.1:${port}/portal/new`)}; 'go'`)
    await new Promise((r) => setTimeout(r, 1200))
    const got = (await evalIn(`(async () => { ${EVIDENCE_HELPERS} try { ${st.setup} window.scrollTo(0, 0); return { ok: true }; } catch (e) { return { ok: false, error: String(e && e.message || e), body: txt().slice(0, 600) }; } })()`)).result?.result?.value ?? { ok: false, error: 'evaluate returned nothing' }
    evidence.push({ state: st.name, ...got })
    if (!got.ok) continue
    // BOTH THEMES AND BOTH WIDTHS. 390 is the narrow end of the phones the report was fitted to, and a
    // column that overflows there is invisible to every assertion in this file.
    await capture(join(shotDir, `new-clearance-${st.name}-light.png`))
    await capture(join(shotDir, `new-clearance-${st.name}-light-390.png`), 390)
    await evalIn(`document.documentElement.setAttribute('data-theme','dark'); 'ok'`)
    await new Promise((r) => setTimeout(r, 400))
    await capture(join(shotDir, `new-clearance-${st.name}-dark.png`))
    await capture(join(shotDir, `new-clearance-${st.name}-dark-390.png`), 390)
    await evalIn(`document.documentElement.removeAttribute('data-theme'); 'ok'`)
  }
  registerReach = undefined
  registerLabelNow = null
  profileTerritories = []
  meEngine = {}
}

// A picture of the state the driver left it in. Not a test — evidence a human can look at, which is the
// one thing a measurement cannot be.
if (shotAt) {
  const shot = await new Promise((r) => {
    const i = ++id
    pending.set(i, r)
    ws.send(JSON.stringify({ id: i, sessionId, method: 'Page.captureScreenshot', params: { format: 'png', captureBeyondViewport: true } }))
  })
  const data = shot.result?.result?.data ?? shot.result?.data
  if (data) writeFileSync(shotAt, Buffer.from(data, 'base64'))

  // ...and the same screen in dark. Both themes are first-class here, and a contrast that collapses in
  // one of them is invisible to every string assertion in this file.
  await evalIn(`document.documentElement.setAttribute('data-theme','dark'); 'ok'`)
  await new Promise((r) => setTimeout(r, 400))
  const darkShot = await new Promise((r) => {
    const i = ++id
    pending.set(i, r)
    ws.send(JSON.stringify({ id: i, sessionId, method: 'Page.captureScreenshot', params: { format: 'png', captureBeyondViewport: true } }))
  })
  const darkData = darkShot.result?.result?.data ?? darkShot.result?.data
  if (darkData) writeFileSync(shotAt.replace(/\.png$/, '') + '-dark.png', Buffer.from(darkData, 'base64'))
}

// — SIGNAL THE GROUP, NOT THE PROCESS. `chrome.kill` reaches only the process spawned here;
// its renderer and GPU children survive and keep writing the profile directory, so the rmSync below
// races them. Here that loss is SILENT — the rmSync is wrapped — which is why this file never failed
// CI the way render-check.mjs did, and instead leaked a temp profile and stray processes per run.
try { process.kill(-chrome.pid, 'SIGKILL') }
catch { try { chrome.kill('SIGKILL') } catch { /* already gone */ } }
server.close()
// Chrome keeps writing to its profile for a moment after SIGTERM, so a straight rmSync races it and
// throws ENOTEMPTY — which would fail the check for a reason that has nothing to do with the screen.
await new Promise((r) => setTimeout(r, 400))
if (!keep) { try { rmSync(userDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* a stray profile dir is not a test result */ } }

// ── verdict ─────────────────────────────────────────────────────────────────────────────────────────

const planPosts = posted.slice(0, mainPassPosts).filter((p) => p.path === '/portal/api/run/plan')
const planBody = planPosts[0]?.body ?? null
// The first pass plans TWICE (the refusal drill presses Review again, which mints a fresh token), so
// this is counted from the END: the counts pass ends with exactly one plan post, and it is the last one
// the driver makes. Anchoring on planPosts[1] would silently pick up the re-plan instead.
//
// THE REGISTERS-ONLY PASS POSTS NOTHING NOW, so there is no body to read from it — what is
// asserted instead is that no post anywhere carried the retired level.
const countsBody = planPosts.length > 1 ? planPosts[planPosts.length - 1].body : null
const fail = []
const ok = (cond, msg) => { if (!cond) fail.push(msg) }

if (out.fatal) {
  console.error('FATAL:', out.fatal)
  console.error(out.body ?? out.raw ?? '')
  process.exit(1)
}

// ── ONE FORM, IN THE DESIGN'S ORDER ─────────────────────────────────────────────────────────────────
ok(out.forkGone, 'the screen still opens on a fork — "Describe it" and "Set it up myself" are back as two ways in')
{
  const missing = out.sectionTops.filter(([, top]) => top == null).map(([name]) => name)
  ok(!missing.length, `a section of the form is not on the page: ${JSON.stringify(missing)}`)
  const tops = out.sectionTops.map(([, top]) => top)
  ok(!missing.length && tops.every((t, i) => i === 0 || t > tops[i - 1]),
    `the form does not read in the design's order — company, Describe it, Names to clear, Where, Goods or services, Context, the company card, Which search: ${JSON.stringify(out.sectionTops)}`)
}
ok(out.nothingSelectedAtRest, 'an untouched form has a search selected or tagged — "for what you entered" is a claim about input, and there is none')
ok(out.footerNoSearchAtRest, 'at rest the bar does not say "No search picked" with the turnaround "Not set"')
ok(out.footerAtRest, 'the running total is not on screen before anything is typed')
ok(out.startingFrom, 'the footer never says what it started from — the "cannot tell what I picked" gap')

// ── THE SEARCH FOLLOWS WHAT WAS ENTERED ─────────────────────────────────────────────────────────────
ok(out.whereTakesAPlaceFirst, 'Where cannot take a place before a search is picked — the recommendation is read off the places, so this blocks it')
ok(out.loneNameSelectsNothing, 'a name typed before any place selected a search, or took the Where picker away')
ok(out.secondCountryStacks, 'a second country replaced the first under a PRESELECTED one-country search — the recommendation could never reach the multi-country search')
ok(out.preselectedMulti, `a region and a country did not preselect the Multi-country focus search: ${JSON.stringify(out.preselected)}`)
ok(out.recommendedTag, 'the preselected search does not carry "Recommended for what you entered"')
ok(out.recommendedReason, 'the recommended search does not say why — "because you named a region and a country"')
ok(out.tagOnOneRowOnly, 'more than one search carries the recommendation')
ok(out.footerCodes, 'the bar does not summarise the places as their codes — "EU, CH"')
ok(out.footerTurnaroundInWords, 'the bar\'s turnaround is not one figure spelled as a reader says it — "1.5 to 2.5 hours"')
ok(out.footerOneSearch, 'the bar does not say the search uses 1 search')

// ── DESCRIBE IT ─────────────────────────────────────────────────────────────────────────────────────
ok(out.briefExampleInside, 'the Describe it box does not carry the design\'s example inside it')
ok(out.readDisabledWhenEmpty === true, 'Fill it in for me must be dead until there is a brief — an empty press spends a slot of the hourly budget for nothing')
ok(out.readEnabled === true, 'Fill it in for me never came alive with a brief in the box')
ok(out.receiptShown, 'a read left no receipt — the reader has no way to check what was taken')
ok(['What I read', 'Taken from company defaults', 'Not sure about'].every((h) => out.receiptHeads.includes(h)),
  `the read did not list its three groups: ${JSON.stringify(out.receiptHeads)}`)
ok(out.receiptLines.some((l) => /^Classes: 5 · Pharmaceuticals, not in your text$/.test(l)),
  `the company class the brief did not name is not listed under its defaults: ${JSON.stringify(out.receiptLines)}`)
ok(out.briefSurvives, 'THE brief was consumed by reading it — and there is no undo on this screen, so a bad read has nothing left to correct from')
ok(out.namesFilled, 'the read did not reach Names to clear — the response body is not the feature, the form is')
ok(out.readClassChips.some((c) => /^32 · /.test(c)), `the read's class never became a chip: ${JSON.stringify(out.readClassChips)}`)
ok(out.readClassChips.some((c) => /^5 · /.test(c)), 'the read REPLACED the owner\'s inherited classes instead of extending them')
ok(out.deadlineFilled, 'the read did not reach the date field')
ok(out.refFilled, 'the read did not reach Your reference')
ok(out.productMoved, '"just the obvious blockers" did not select the Knockout search — the most consequential thing a read can do')
ok(out.droppedShown, 'a territory this composer cannot place was swallowed silently — the user would believe they are paying to search it')
ok(out.doubtShown, "the model's own doubt was dropped rather than shown")
ok(out.receiptLines.length >= 4, `the receipt is thin: ${JSON.stringify(out.receiptLines)}`)

// ── THE COMPANY CARD ────────────────────────────────────────────────────────────────────────────────
ok(out.contextCard, 'the company card did not render')
ok(out.manageProjects, 'the company card offers no Manage projects')
ok(out.inheritedClassChips.some((c) => /^5 · /.test(c)) && out.inheritedClassChips.some((c) => /^32 · /.test(c)),
  `the owner's own classes are not shown as named chips: ${JSON.stringify(out.inheritedClassChips)}`)
ok(out.shopChips === 6, `the shop list should show six and offer the rest, showed ${out.shopChips}`)
ok(out.showAll, 'the marketplace list has no show-all — a dead "+N more" is what the ruling forbade')
ok(Array.isArray(out.templatesControl) && out.templatesControl.includes('None') && out.templatesControl.includes('Launch screen'),
  `the templates are not their own control, by name: ${JSON.stringify(out.templatesControl)}`)
ok(out.manageTemplates, 'the templates control offers no Manage')
ok(out.classLookupFound, `the class lookup did not find class 9 for "software": ${JSON.stringify(out.classLookup)}`)
ok(out.lookupFindsByWord, `"drinks" should reach class 33 by its heading: ${JSON.stringify(out.classLookup)}`)
ok(out.lookupSkipsChosen, 'a class already in scope was offered again')
ok(out.classChipReadsName, 'a class chip must say what the class IS, not just its number')
ok(out.inheritedKeptOnOverride, "adding a class dropped the owner's own — an override must extend the inherited list, not replace it")
ok(out.deadlineIsDate, 'the deadline is still a free-text box')
ok(out.goodsExampleInside, 'the Goods or services box does not carry the design\'s example inside it')
ok(out.checks === '14', `dense owner should read 14 checks per name, read ${out.checks}`)
ok(out.knockoutTier, 'registers off did not become a Knockout')
ok(out.knockoutSweep, 'a knockout does not say it sweeps marketplaces')

// ── THE PICKER: four rows, each stating what it accepts, what it reads and what it carries ─────────
ok(out.pickerNamesAllFour, `the picker does not offer all four searches by name: ${JSON.stringify(out.pickerRows)}`)
ok(out.pickerStatesGeography, 'a row does not say the geography its search accepts — that is what a client is choosing between')
ok(out.pickerStatesNameCount,
  'the name count on a row is not the offering\'s figure — a row reading "up to 20 names" over an eight-name wall is what this build deleted')
ok(out.pickerTurnaroundInWords, `a row's turnaround is not spelled as a reader says it — "from 5 to 10 min", "from 1.5 to 2.5 hours": ${JSON.stringify(out.pickerRows)}`)
ok(out.chipsKnockout, 'the Knockout row does not mark "Registers, quick count" in and case law out')
ok(out.chipsFull, 'the Full country row does not mark "Registers, full search" and case law in')
ok(out.chipsGlobal, 'the Global preliminary row does not mark marketplaces in and case law out')
ok(out.knockoutTier, 'picking the Knockout search did not name it in the footer')
ok(out.nativeHiddenOnKnockout, 'the native-language toggle is offered on a knockout, which does not carry it')
ok(out.knockoutCarriesCounts, 'the Knockout search does not state that it takes the register counts')
ok(out.caseLawStatedNotOffered,
  'case law is either offered as a control or not stated at all — it is what a Full country search IS, so the screen states it and offers nothing to press')

// ── GEOGRAPHY FOLLOWS THE PRODUCT, and each control says why at the control ─────────────────────────
ok(out.globalNoTerritoryInput === true,
  'a Global preliminary search still has a territory field — worldwide is not a choice on it, it IS it, so a field there is a control whose every use is refused')
ok(out.globalRestatesNoGeography, 'the Where panel restates that this search is not narrowed — that note was ruled off this screen and must not come back')
ok(out.multiHasTerritoryInput, 'a Multi-country focus search has no territory field')
ok(out.multiOffersRegion, 'a Multi-country focus search does not offer regions, which it accepts')
ok(out.nativeToggleOffered, 'the ONE toggle in the offering is missing from the one product that offers it')
ok(out.nativeInsideItsRow, 'the native-language option is not inside the selected search\'s own row')
ok(out.oneCountryBlocked, 'one country on a Multi-country focus search was accepted silently — the engine refuses it, and the user would find out at the gate')
ok(out.oneCountryNamesWayOut, 'the blocker states no way out — enforcement without an invitation is what this screen exists to stop')
ok(out.reviewShutOnOneCountry === true, 'the start action stayed live on a search the server will refuse')
ok(out.fullRestatesNoGeography, 'the Full country panel restates that regions are not offered — that note was ruled off this screen and must not come back')
ok(out.fullOffersNoRegion === true,
  'a Full country search offered a REGION in its typeahead — the control must fit the product, so the refusal never has to happen')
ok(out.fullCarriesCaseLaw, 'a Full country search does not state that it carries the case-law reading')
ok(out.fullNativeAutomatic, 'a Full country search does not state that its native language runs automatically, or wrongly offers a switch for it')
ok(out.fullOneCountryChip, 'naming a country on a Full country search did not put it in scope')
ok(out.fullReplacesRatherThanStacks, 'the panel does not say that a second country REPLACES the first — the reader would watch a chip vanish with no reason')

ok(out.horizontalOverflow <= 0, `the page scrolls sideways by ${out.horizontalOverflow}px`)
ok(out.footerIsSticky, 'no sticky footer was rendered at all')
ok(out.pageScrolls !== false, 'the page did not scroll, so stickiness proves nothing here')
ok(out.footerInViewport, `the sticky footer is not pinned in the viewport (gap ${out.footerBottomGap}px)`)
// A FOOTER spans the content column. The first build rendered it as a panel inside the 760px form
// measure, which is what made it read as a floating box rather than as the end of the page.
ok(out.footerWidth >= 1000,
  `the footer is ${out.footerWidth}px wide in a ${out.viewportWidth}px viewport — a footer spans the column, a panel does not`)

// ── THE REVIEW, IN THE DESIGN'S ROWS ────────────────────────────────────────────────────────────────
ok(out.reviewOpened, 'the review step never opened')
ok(out.reviewIsModal !== false, 'the review step is not the modal the design specifies')
ok(out.noCountdown, 'a countdown is back on the review dialog — a stopwatch on someone reading a legal summary')
ok(JSON.stringify(out.reviewRows) === JSON.stringify(['Company', 'Names', 'Search', 'Where', 'Registers to search', 'Classes', 'Goods or services', 'Marketplaces', 'Native language', 'Turnaround', 'Uses', 'Left today']),
  `the review rows are not the design's, in its order: ${JSON.stringify(out.reviewRows)}`)
ok(out.reviewTitle === 'AQUAPLUS', `the mark does not sit under the review's title: ${JSON.stringify(out.reviewTitle)}`)
ok(/^Native language On · native-language registers and marketplaces for the United States, China and Japan$/i.test(out.reviewNative || ''),
  `the Native language row does not state on and its coverage, and nothing else: ${JSON.stringify(out.reviewNative)}`)
ok(/^Registers to search United States, China and Japan$/i.test(out.reviewRegisters || '') && !/in full/i.test(out.reviewRegisters || ''),
  `the registers row does not name what will be searched, or claims a search that has not run: ${JSON.stringify(out.reviewRegisters)}`)
ok(out.reviewShowAll, 'the review\'s Marketplaces row offers no Show all 13')
ok(out.reviewBack, 'the review offers no Back')
ok(out.modalDismissed !== false, 'Back did not close the review dialog')
ok(out.failureShown, 'a refused run showed NOTHING — the exact report from 2026-07-22')
ok(out.failureInsideModal, 'the refusal rendered outside the dialog again; at the bottom of a tall form it is invisible')
ok(out.failureNamesReason, 'the refusal did not carry the server\'s reason')
ok(out.reviewAgainOffered, 'a refused run offers no way forward')
ok(out.startGoneOnFailure, 'Start search is still on screen after the ticket was spent — a dead button')
ok(out.reviewAgainReopened, 'Review again did not get back to a startable dialog')
ok(planBody != null, 'no plan body reached the server')
if (planBody) {
  ok(planBody.product === 'multi-country-focus-search',
    `the picked product must reach the wire, sent ${JSON.stringify(planBody.product)}`)
  ok(planBody.nativeLanguage === true, 'the native-language toggle did not reach the wire')
  ok(planBody.geography && planBody.geography.mode === 'named',
    `the geography MODE must be STATED — "everywhere" and "I said nothing" are different searches, sent ${JSON.stringify(planBody.geography)}`)
  ok(Array.isArray(planBody.jurisdictions) && planBody.jurisdictions.includes('China'), 'the named territory did not reach the wire')
  ok(!('caseLaw' in planBody), 'a caseLaw flag reached the wire — it is what a Full country search IS, not a field')
}
ok(out.noTerritoryBlocked, 'a Full country search with no country was accepted silently')
ok(out.refusedReviewShut === true, 'a search the offering refuses could still be reviewed')
ok(out.refusedDialogRefused === true, 'the review dialog opened for a search that cannot run')
ok(out.knockoutReviewable === true, 'a Knockout search could not be reviewed — it is runnable')
ok(countsBody != null, 'a knockout never reached the server')
if (countsBody) {
  ok(countsBody.product === 'knockout-search',
    `the picked knockout must reach the wire, sent ${JSON.stringify(countsBody.product)}`)
}
// THE INVITATION, MEASURED AT THE WIRE. Every retired level key is checked, DERIVED from the registry
// rather than hand-listed — a scan naming today's keys keeps passing while a new one walks through.
ok(!posted.some((p) => RETIRED_PRODUCTS.some((k) => JSON.stringify(p.body ?? {}).includes(JSON.stringify(k)))),
  'a request carrying a retired level key reached the server')

// ── the coherence rules ─────────────────────────────────────────────────────────────────────────────
ok(out.fullRunnable === true, 'a Full country search over one country is blocked — the rule would be refusing its own product')
ok(out.extraShopsControlBeside, 'the add-a-marketplace control is not on the screen beside the shops')
ok(out.extraShopsMovedChecks === 2,
  `typing two extra shops should move the checks-per-name figure by 2, it moved by ${out.extraShopsMovedChecks}`)
ok(out.marketplacesSayWhereTheyComeFrom,
  'the marketplaces column does not say what the shops are or that they are inherited rather than chosen here')
ok(out.matrixOffered, '"Detailed search comparison table" did not render')
ok(out.matrixClosedAtRest === true, 'the comparison table fold is open before anyone opened it')
ok(out.matrixRows === 7, `the comparison should carry seven rows, drew ${out.matrixRows}`)
ok(out.matrixCols === 5, `the matrix should carry a label column plus the four products, drew ${out.matrixCols}`)
ok(out.matrixScrollsItself === true, 'the matrix wrapper does not scroll — the page would have to instead')
ok(out.pageStillDoesNotScroll <= 0, `opening the matrix pushed the PAGE sideways by ${out.pageStillDoesNotScroll}px`)
ok(out.matrixNamesNoMachinery, 'the matrix printed a component name at a client')
ok(out.matrixSaysGeography, 'the matrix does not state the geography each search accepts, which is half of what distinguishes them')
ok(out.matrixSaysCaseLawProduct, 'the matrix does not say WHICH search carries the case-law reading')
ok(out.matrixNoRungs, 'a retired rung survived into the comparison table')
// ── — THIS THRESHOLD USED TO BLESS THE DEFECT ────────────────────────────
// It read `<= 60` with a note explaining that the 760px min-width costs ~40px in a 720px column, and
// its neighbour allowed one column of five to be off-screen for the same reason. Both were true
// descriptions of a broken state: the block was supposed to have escaped the 720px column entirely and
// silently had not, so the guard was drawn around the failure and passed it — twice, through two
// rounds of fixing, while the owner went on reporting the same defect from his own screen.
//
// A guard whose threshold is measured off the broken state cannot report the breakage. The table now
// has the column's full measure, so the honest numbers are zero and all of them, and anything else is
// the escape coming loose again.
ok(out.wideIsDirectChildOfColumn === true,
  `the width opt-out is not a direct child of .composer-col (its parent is ${JSON.stringify(out.wideParentClass)}) — the cap matches direct children only, so it is inert wherever else it sits`)
ok(out.matrixOverflowPx !== null && out.matrixOverflowPx <= 0,
  `the comparison table runs ${out.matrixOverflowPx}px past its wrapper — it has the column's full width now, so any overflow means the width opt-out is not reaching it`)
ok(out.matrixColsVisible === out.matrixCols,
  `only ${out.matrixColsVisible} of ${out.matrixCols} columns fit — a reader has to side-scroll to see the rest, which is the defect ruled three times`)
ok(out.matrixGlyphsDrawn === '○●◐', `all three marker glyphs must render (codepoint order), drew ${JSON.stringify(out.matrixGlyphsDrawn)}`)
ok(out.matrixLegendShown, 'glyphs are drawn with no legend explaining them')
ok(out.matrixCurrentCols === 1, `exactly one column should be marked current, ${out.matrixCurrentCols} were`)
ok(out.matrixCurrentIsHere, 'the current column does not say so in words as well as in colour')
ok(out.matrixNoNotAvailable, '"Not available" is retired — it claimed the depth was switched off, not that the axis is absent')
ok(out.worldwideCleared, 'an explicit worldwide brief did not clear the named territories, or did it without a receipt line')
ok(out.worldwideChipsGone, 'the countries survived a worldwide read — the scope on screen is not what was asked for')
ok(out.worldwideChipShown, 'the Where field does not say Worldwide after clearing — an empty box states nothing')

// ── A TEMPLATE APPLIED ──────────────────────────────────────────────────────────────────────────────
ok(out.templateLine, 'applying the worldwide template did not draw the design\'s line — "Launch screen sets the search and how deep it goes. Names, goods and classes are still yours to set."')
ok(out.templateClearOffered, 'an applied template offers no Clear template')
ok(out.templateSelectsItsSearch, 'the template\'s search is not the selected row')
ok(out.templateWorldwideNoPicker, 'a template setting the worldwide search left a territory picker, or no Worldwide chip')
ok(out.templateNoNativeOption, 'a native-language option is drawn under a template, which carries its own')
ok(out.leftClean, 'the check left the composer in a blocked state')

// ── phase two's verdict ─────────────────────────────────────────────────────────────────────────────
//
// Each state asserted by what it MUST say and by what it must NOT: the install advice is correct on an
// empty machine and useless on one that already has the program, and the restart remedy is the reverse.
// Asserting only the presence of the right sentence would pass a notice that printed both.
for (const n of notices) {
  const got = n.got
  ok(got, `${n.state}: nothing rendered — neither the notice nor a start button`)
  if (!got) continue
  ok(got.text, `${n.state}: no notice at all, and the start button ${got.startButton ? 'IS' : 'is not'} drawn`)
  if (!got.text) continue
  ok(!got.startButton, `${n.state}: a start button is drawn on an install that cannot start a search`)
  for (const [what, re] of [['says', n.expect.says], ['also says', n.expect.alsoSays], ['and says', n.expect.andSays]]) {
    ok(re.test(got.text), `${n.state}: the notice does not ${what} ${re} — it read: ${got.text.slice(0, 200)}`)
  }
  // THE TWO REMEDIES ARE EXCLUSIVE. This is the assertion that carries the harm: an install with the
  // program present must not be told to install one, and an empty machine must not be told to restart.
  const disputed = n.expect.me.engineProgramDisputed === true
  ok(disputed !== /install a reasoning CLI/.test(got.text),
    `${n.state}: the install advice and the restart remedy are not exclusive — a reader is being told both`)
  // WHAT THIS ASSERTION REACHES, established by planting rather than by reading — and the first version
  // of this comment got it wrong in a way worth recording. It said "two gates, this sees the outer one",
  // because widening a contract flag did not red the check. There were never two: that flag was assigned
  // the same condition the screen already tested, so it was one gate written twice, and a plant against a
  // relay can only ever pass. Raised in review, and the relay is gone.
  //
  // There is ONE gate — the call site passes no handler to a reader who cannot open that page — and this
  // catches it: removing the Manage test puts the link in front of a reader without it and both of those
  // states go red.
  ok(got.buttons.length === (n.expect.link ? 1 : 0),
    `${n.state}: the link to the configuration page is ${n.expect.link ? 'missing' : 'offered to a reader who cannot open that page'} `
    + `(buttons: ${JSON.stringify(got.buttons)})`)
}

// ── THE COMPANY'S OWN TERRITORIES REACH THE RECOMMENDATION, THE REQUEST AND THE DIALOG ──────────────
//
// One fact read at three places, because it used to disagree at all three. A FLOOR comes first: if the
// panel never drew the four, every assertion under it is about a screen that was not in the state this
// pass exists to measure, and would pass by being vacuous.
// A company's saved codes on a register that covers them by name: nothing is marked unreachable.
ok(!savedCodes.fatal && ['US', 'EU', 'UK'].every((c) => savedCodes.removers.includes(c)),
  `the saved-codes pass never drew the company's own territories — ${JSON.stringify(savedCodes)}`)
ok(!savedCodes.fatal && savedCodes.deferred.length === 0 && savedCodes.notAvailable.length === 0,
  `a company territory the register covers is drawn as not available — ${JSON.stringify(savedCodes)}`)
if (inherited.fatal) {
  // the throw says WHAT was missing; the screen says what was there instead. Both, or the next
  // reader reruns it to find out.
  ok(false, `the inherited-territories pass could not be driven: ${inherited.fatal} — ${inherited.raw ?? ''} — on screen: ${JSON.stringify((inherited.body ?? '').slice(0, 700))}`)
} else {
  const FOUR = ['United States', 'United Kingdom', 'European Union', 'Canada']
  const drawn = FOUR.filter((t) => (inherited.chips ?? []).includes(t))
  ok(drawn.length === FOUR.length,
    `the Where panel drew ${drawn.length} of the company's ${FOUR.length} territories (${JSON.stringify(inherited.chips)}) — nothing below this line is a measurement without them`)

  // THE SCREEN. The recommendation reads what the panel draws, so a form showing four countries is a form
  // that recommends the search which reads four countries.
  ok(inherited.recommends,
    'nothing is recommended on a form showing the company\'s own four territories — the recommendation is reading the draft instead of what the panel drew')
  ok(inherited.preselected === 'Multi-country focus search',
    `the form preselected ${JSON.stringify(inherited.preselected)} over the company's four territories, not the Multi-country focus search`)
  ok(inherited.reviewShut === false, 'Review search is shut on a form that has a name and four territories on it')
  ok(!/No search picked/.test(inherited.footer ?? ''),
    `the sticky bar says no search is picked while naming the territories it would search: ${JSON.stringify(inherited.footer)}`)

  // THE REQUEST. "worldwide" is a positive instruction the company's territories may not narrow, and the
  // door refuses the two searches that read named places when it arrives with none. "account-default" is
  // how a request says the requester named none — the state this screen is actually in.
  const body = inheritedPlans[0] ?? null
  ok(body != null, 'the inherited pass posted no plan')
  if (body) {
    ok(body.geography?.mode === 'account-default',
      `the request stamped geography ${JSON.stringify(body.geography?.mode ?? null)} on a form showing the company's own territories — "worldwide" is the one mode those territories may not narrow`)
    ok(!('jurisdictions' in body),
      `the request named ${JSON.stringify(body.jurisdictions)} as the requester's own — the company's defaults are resolved by the engine, and freezing today's list into the run attributes it to somebody who never named it`)
  }

  // THE DIALOG. What the reader confirms has to be the search on the form behind it. Skipped when the
  // button is shut, because the arm above has already said so and a null dialog would repeat it four times.
  if (!inherited.reviewShut) {
  ok(inherited.dialogSearch === 'SEARCH Multi-country focus search',
    `the review dialog names ${JSON.stringify(inherited.dialogSearch)} while the form holds a Multi-country focus search`)
  const missing = FOUR.filter((t) => !(inherited.dialogWhere ?? '').includes(t))
  ok(!missing.length,
    `the review dialog's Where does not name ${JSON.stringify(missing)}: ${JSON.stringify(inherited.dialogWhere)} — a reader confirming this is shown a different search from the one on the form`)
  ok(!/\bWorldwide\b/.test(inherited.dialogWhere ?? ''),
    `the review dialog offers a worldwide search over a form naming four territories: ${JSON.stringify(inherited.dialogWhere)}`)
  const missingReg = FOUR.filter((t) => !(inherited.dialogRegisters ?? '').includes(t))
  ok(!missingReg.length,
    `the review dialog's Registers to search does not name ${JSON.stringify(missingReg)}: ${JSON.stringify(inherited.dialogRegisters)}`)

  }

  // ── THE FLOOR, on a different member of the class ──
  // The search that IS worldwide must still stamp worldwide: the door refuses "account-default" on it by
  // name. Without this, a fix that stamped every empty draft the same way passes everything above.
  if (!inherited.reviewShut) {
  ok(inherited.worldwideChip,
    `the Global preliminary search does not draw "Worldwide, searched on Signa" — read ${JSON.stringify(inherited.worldwideChipText)}`)
  ok((inherited.worldwideWhere ?? '').includes('Worldwide, searched on Signa'),
    `the review dialog for a Global preliminary search reads ${JSON.stringify(inherited.worldwideWhere)} instead of worldwide`)
  const wide = inherited.reviewShut ? null : (inheritedPlans[inheritedPlans.length - 1] ?? null)
  ok(wide?.geography?.mode === 'worldwide',
    `a Global preliminary search stamped geography ${JSON.stringify(wide?.geography?.mode ?? null)} — that search accepts no narrowing and the door refuses "account-default" on it by name`)
  }
}

for (const e of evidence) ok(e.ok, `evidence state ${e.state} could not be reached: ${e.error} — on screen: ${JSON.stringify((e.body || '').slice(0, 300))}`)

console.log(JSON.stringify({ ...out, planBody, countsBody }, null, 2))
if (shotAt) writeFileSync(shotAt + '.json', JSON.stringify({ ...out, planBody, countsBody }, null, 2))

if (fail.length) {
  console.error('\nFAILED:')
  for (const f of fail) console.error('  ✗ ' + f)
  process.exit(1)
}
console.log('\nrender check passed')
