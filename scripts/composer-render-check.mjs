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
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { productRows } from '../driver/product-rows.mjs'
import { RETIRED_PRODUCTS } from '../driver/search-policy.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = join(HERE, '..', 'portal-ui', 'dist')
const keep = process.argv.includes('--keep')
const shotAt = process.argv.includes('--shot') ? process.argv[process.argv.indexOf('--shot') + 1] : null

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
  '/portal/api/me': { role: 'client', email: 'demo@example.test', accounts: ['zephyr'], allAccounts: false },
  '/portal/api/searches': {
    account: 'zephyr',
    products: stubLevels(),
    // `nativeLanguage` rides the list row because the composer has to say what geography a saved search
    // accepts while the row is being clicked. Stubbed as the wire sends it.
    recipes: [{ slug: 'launch-screen', label: 'Launch screen', base: 'global-preliminary-search', version: 3, nativeLanguage: false }],
    read: { available: true, maxBrief: 12000, note: null },
  },
  '/portal/api/config/profile': {
    account: 'zephyr',
    profile: {
      platforms: PLATFORMS,
      defaultClasses: [5, 32],
      defaultJurisdictions: [],
      marketplaceDensity: 'High',
    },
    readOnly: {}, contextPack: '', framework: null, derived: null,
  },
  '/portal/api/config/projects': [],
  '/portal/api/usage': {
    account: 'zephyr', today: 1, thisMonth: 4, queued: 0,
    dailyRuns: 3, monthlyRuns: null, maxQueued: null, capped: true,
  },
}

/** Every plan body the page posts, so the check can assert what the levers actually put on the wire. */
const posted = []

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
        + '— the roster this process can see is [aurora, generic, petcary, zephyr]',
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
      res.end(JSON.stringify(path === '/portal/api/run'
        ? { id: 'demo-run' }
        : {
            stageLabel: 'Depth 4', marks: 1, confirmationToken: 'tok', warnings: [],
            caveat: 'Ratings reflect our common law assessment.',
            scope: { jurisdictions: ['China'], jurisdictionsFrom: 'this search', classes: [5, 32], classesFrom: 'the account', platforms: PLATFORMS, platformsAdded: [] },
            turnaround: 'same day',
          }))
    })
    return
  }

  const base = path.split('?')[0]
  if (ROUTES[base] !== undefined) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(ROUTES[base]))
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
  // #1809 — A MISS THROWS, NAMING WHAT IT MISSED. This returned undefined, and the thirteen sites below
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
  // Pick one of the four, by NAME. The rows are .pick-row buttons and the name leads each one.
  const pickProduct = (re) => {
    const row = [...document.querySelectorAll('.pick-row')].find((b) => re.test(b.innerText || ''));
    if (!row) throw new Error('no product row matching ' + String(re));
    row.click();
  };
  const out = { steps: [] };
  try {

  location.hash = '';
  history.pushState({}, '', '/portal/new');
  window.dispatchEvent(new PopStateEvent('popstate'));

  // The screen OPENS on the two ways in — that fork is the design's, and its absence was the loudest
  // thing missing from the first build.
  if (!await settle(() => /Describe it/.test(txt()) && /Set it up myself/.test(txt()))) {
    return { fatal: 'the entry fork never painted', body: txt().slice(0, 900) };
  }
  out.steps.push('entry fork painted');
  out.entryCards = document.querySelectorAll('.entry-card').length;
  out.startPills = document.querySelectorAll('.start-pill').length;

  // The context card is up before anything is chosen: who this is for, and what they already carry.
  out.contextCard = Boolean(document.querySelector('.ctx-card'));
  out.inheritedClassChips = [...document.querySelectorAll('.ctx-card .chip')].map((c) => c.innerText.trim());
  out.shopChips = document.querySelectorAll('.ctx-card .chip-mono').length;
  out.showAll = /Show all 13/.test(txt());

  // ── THE DESCRIBE SIDE ────────────────────────────────────────────────────────────────────────────
  findByText('button', /Describe it/).click();
  await sleep(160);
  out.describePane = /paste the whole thread/.test(txt());

  // Nothing pasted yet ⇒ nothing to read. The button is dead until there is a brief, so a stray click
  // cannot spend a press of the hourly budget on an empty box.
  out.readDisabledWhenEmpty = maybeByText('button', /Fill it in for me/)?.disabled ?? null;

  const briefBox = [...document.querySelectorAll('textarea')].find((a) => /obvious blockers/.test(a.placeholder || ''));
  set(briefBox, 'Quick check on AQUAPLUS for energy drinks in the US before Friday, our ref M-4471 — just the obvious blockers.');
  await sleep(120);
  out.readEnabled = !findByText('button', /Fill it in for me/).disabled;
  findByText('button', /Fill it in for me/).click();
  await mustSettle(() => /what i read/i.test(txt()), 4000, 'the read-back of the description never appeared');

  // What the READ actually did to the FORM. The response body proves nothing — the feature's claim is
  // that its output arrives as ordinary editable fields, so that is what gets read back off the screen.
  out.receiptShown = /what i read/i.test(txt());
  out.receiptLines = [...document.querySelectorAll('.read-receipt li')].map((li) => li.innerText.trim());
  // The brief is NOT consumed: a filler that eats its own input leaves nothing to correct from if it
  // read badly. (It does NOT travel with the request — bodyFor has never sent it.)
  out.briefSurvives = /AQUAPLUS/.test(briefBox.value);
  out.namesFilled = [...document.querySelectorAll('textarea')].some((a) => a.value.trim() === 'AQUAPLUS');
  out.readClassChips = [...document.querySelectorAll('.ctx-card .chip')].map((c) => c.innerText.trim());
  out.deadlineFilled = [...document.querySelectorAll('input[type="date"]')].some((i) => i.value === '2026-07-24');
  out.refFilled = [...document.querySelectorAll('input')].some((i) => i.value === 'M-4471');
  // The brief said "obvious blockers" ⇒ the reader names the Knockout search, and the receipt says the
  // product moved — BY ITS NAME, off the offering. This is the read's most consequential single effect.
  out.productMoved = /Knockout search/.test(txt());
  // A territory this composer does not offer is OWNED, not swallowed.
  out.droppedShown = /Bavaria/.test(txt()) && /not a territory this search offers/i.test(txt());
  out.doubtShown = /two words/i.test(txt());

  // Move to a clearance before carrying on. The read picked the Knockout search — "just the obvious
  // blockers" — and everything after this point exercises the clearance half of the offering.
  pickProduct(/Multi-country focus search/);
  await sleep(150);
  out.registersRestored = /Multi-country focus search/.test(txt());

  // ...and the segmented toggle switches back, persistently.
  findByText('button', /Set it up myself/).click();
  // #1809 — THIS WAIT WAS DEAD. It watched for the text "Start point", which the composer stopped
  // rendering; the only "Start point" left in the tree is a COMMENT in NewClearance.tsx. Because settle
  // returned false silently, it degraded into a flat 6-second sleep and the check still reported
  // "render check passed" — making the wait loud is what surfaced it. Waits on the picker the manual
  // pane actually draws, so it fails when the pane does not paint rather than when a word changes.
  await mustSettle(() => document.querySelectorAll('.pick-row').length > 0, 6000,
    'the manual composer never painted after Set it up myself');
  out.steps.push('manual');
  out.segmented = Boolean(document.querySelector('.segmented-entry'));

  // The footer must be there before anything is typed — that is the point of a running total.
  out.footerAtRest = /Review clearance/.test(txt());
  out.startingFrom = /starting from ·/i.test(txt());
  // THE FOUR, each with the geography it accepts and the name count it reads — both the SERVER's own
  // figures. A row that stated a limit the wall does not enforce is what this build deleted.
  out.pickerRows = [...document.querySelectorAll('.pick-row')].map((b) => b.innerText.replace(/\\s+/g, ' ').trim());
  out.pickerNamesAllFour = ['Knockout search', 'Global preliminary search', 'Multi-country focus search', 'Full country search']
    .every((n) => out.pickerRows.some((r) => r.includes(n)));
  out.pickerStatesGeography = out.pickerRows.some((r) => /worldwide, and nothing else/.test(r))
    && out.pickerRows.some((r) => /exactly one country/.test(r));
  out.pickerStatesNameCount = out.pickerRows.some((r) => /up to 8 names/.test(r))
    && !out.pickerRows.some((r) => /up to 20 names/.test(r));

  // Saved searches are their OWN group, scrolling, with a retire control per row — not flattened into
  // the product list, which is where the first build put them.
  out.savedHeading = /custom searches/i.test(txt());  // innerText carries text-transform: these labels arrive uppercase
  const savedList = document.querySelector('.saved-list');
  out.savedListScrolls = savedList ? getComputedStyle(savedList).overflowY === 'auto' : null;
  out.savedRetire = document.querySelectorAll('.saved-retire').length;

  // Fill the required scope. Classes are a LOOKUP now: type a word, pick the class.
  const areas = [...document.querySelectorAll('textarea')];
  set(areas.find((a) => /AQUAPLUS/.test(a.placeholder || '')), 'AQUAPLUS');
  const classInput = [...document.querySelectorAll('input')].find((i) => /Add a class/.test(i.placeholder || ''));
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
  const det = document.querySelector('details');
  if (det) { det.open = true; await sleep(120); }
  out.deadlineIsDate = [...document.querySelectorAll('input')].some((i) => i.type === 'date');

  const goods = [...document.querySelectorAll('textarea')].find((a) => /Downloadable software/.test(a.placeholder || ''));
  set(goods, 'energy drinks');
  await sleep(120);
  out.steps.push('filled');

  // The dense owner: 13 shops + 1 = 14 checks.
  out.checks = (txt().match(/(\\d+) checks per name/) || [])[1] || null;

  // ── THE PICKER, and the geography that follows from it ────────────────────────────────────────
  //
  // The levers are gone. What replaced them is four rows and a Where panel that CHANGES with the row —
  // worldwide is not a choice on a Global preliminary search, it IS one, so that product has no
  // territory field at all rather than a field whose every use is refused. None of that is observable
  // from a string test; all of it is observable here.

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
  // #706 — the copy changed and the assertion follows it. The OLD string ("not searched; filing counts
  // only") led with the absence and then contradicted it in the same clause; what a Knockout buys at the
  // register is three counts per name in the classes named, and what it does not buy is a reading of the
  // filings behind them. This measures the same thing the ok() below claims: that the card states the
  // counts are part of the product.
  out.knockoutCarriesCounts = /Trademark registers — filing counts per name/.test(txt())
    && /identical · containing · close variations/.test(txt())
    && /scoped to your classes/.test(txt());
  out.caseLawStatedNotOffered = /Case law and oppositions — not part of this search/.test(txt())
    && !maybeByText('button', /^Case law$/);
  out.steps.push('knockout picked');

  // A GLOBAL PRELIMINARY SEARCH HAS NO WHERE FIELD. The panel states the fact and says why; there is
  // nothing to type into, because there is nothing this product will accept.
  pickProduct(/Global preliminary search/);
  await sleep(160);
  out.globalNoTerritoryInput = !document.querySelector('input[aria-label="Add a territory"]');
  out.globalSaysWhy = /This search is not narrowed/.test(txt());
  out.steps.push('global picked');

  // A MULTI-COUNTRY FOCUS SEARCH offers regions AND countries, and the one toggle in the offering.
  pickProduct(/Multi-country focus search/);
  await sleep(160);
  const whereBox = () => document.querySelector('input[aria-label="Add a territory"]');
  out.multiHasTerritoryInput = Boolean(whereBox());
  set(whereBox(), 'euro');
  await sleep(180);
  out.multiOffersRegion = [...document.querySelectorAll('.typeahead button')].some((b) => /European Union/.test(b.innerText));
  const nativeBtn = maybeByText('button', /Native-language investigation/);
  out.nativeToggleOffered = Boolean(nativeBtn);
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
  const revOne = maybeByText('button', /Review clearance/);
  out.reviewShutOnOneCountry = revOne ? revOne.disabled === true : null;
  out.steps.push('one-country blocker');

  // A FULL COUNTRY SEARCH offers COUNTRIES ONLY — a region is not a country, and the control fits the
  // product rather than refusing it afterwards. The panel says so at the control.
  pickProduct(/Full country search/);
  await sleep(160);
  out.fullSaysRegionsNotOffered = /Regions are not offered here/.test(txt());
  set(whereBox(), 'euro');
  await sleep(180);
  out.fullOffersNoRegion = ![...document.querySelectorAll('.typeahead button')].some((b) => /European Union/.test(b.innerText));
  out.fullCarriesCaseLaw = /Case law and oppositions — part of this search/.test(txt());
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
  findByText('button', /Review clearance/).click();
  await mustSettle(() => /review before you start/i.test(txt()), 5000, 'the review dialog never opened');
  out.reviewOpened = /review before you start/i.test(txt());
  out.reviewIsModal = Boolean(document.querySelector('.modal-scrim'));
  // NO STOPWATCH on the one screen where being hurried is worst. Matched loosely — the old copy was
  // "Good for 9:47." and any m:ss beside the confirm button is the thing being kept off it.
  out.noCountdown = !/good for \\d+:\\d\\d|expired/i.test(txt());
  out.steps.push('planned');

  // ── a REFUSAL at the run door stays where the eye is ──
  // The stub answers 502 for this one press. The regression: the dialog used to close and write the
  // reason near the bottom of a form several screens tall, so pressing Start while scrolled anywhere
  // else showed the user precisely nothing.
  window.__failNextRun = true;
  findByText('button', /Start clearance/).click();
  await mustSettle(() => /was not started/i.test(txt()), 5000, 'the failure notice never appeared after Start clearance');
  out.failureShown = /was not started/i.test(txt());
  out.failureInsideModal = Boolean(document.querySelector('.modal-scrim')) && (() => {
    const scrim = document.querySelector('.modal-scrim');
    return scrim ? /was not started/i.test(scrim.innerText) : false;
  })();
  out.failureNamesReason = /roster|no known customer|upstream|refused/i.test(txt());
  out.reviewAgainOffered = Boolean(maybeByText('button', /Review again/));
  out.startGoneOnFailure = !maybeByText('button', /^Start clearance/);
  window.__failNextRun = false;
  findByText('button', /Review again/).click();
  // Settle on the failure DISAPPEARING, not on the dialog's title: the title never left the screen
  // (that is the whole point of the fix), so waiting for it passes instantly and proves nothing.
  await mustSettle(() => !/was not started/i.test(txt()), 6000, 'the failure notice never cleared after Review again');
  out.reviewAgainReopened = Boolean(maybeByText('button', /^Start clearance/)) && !/was not started/i.test(txt());
  out.steps.push('refusal shown in the dialog');

  // ── second pass: a REFUSED SHAPE must not reach the wire ──
  // The blocker text only proves the label. What matters is that NOTHING is posted: a screen that shows
  // a blocker and posts anyway is a screen whose refusal is decoration.
  //
  // tracker issue 2119 — WAIT FOR THE BUTTON, NOT FOR ITS NEIGHBOUR. The settle above waits for the
  // failure notice to CLEAR, and the notice can clear before the dialog re-renders its controls. This
  // click then landed on a screen that had not finished and threw "no button matching /Back to edit/ is
  // on screen" — which reads as a missing control and was a missing wait. Measured on CI run
  // 33612945545, self-hosted runner under load, in the same step where home-render-check passed whole.
  //
  // This is the second face of the lesson at the top of this block. That one converted eight sites with
  // NO wait at all; it could not see this one, because this one has a settle beside it — just not one
  // about its own target.
  await mustSettle(() => Boolean(maybeByText('button', /Back to edit/)), 6000,
    'Back to edit never came back after the failure notice cleared');
  findByText('button', /Back to edit/).click();
  await mustSettle(() => /Review clearance/.test(txt()), 5000, 'the composer never came back after Back to edit');
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
  out.refusedReviewShut = findByText('button', /Review clearance/).disabled === true;
  // Pressed anyway. A disabled button that still fires is the shape this whole check exists for, and the
  // server-side assertion below (no plan post ever named a shape the offering refuses) is what proves it
  // did not.
  findByText('button', /Review clearance/).click();
  await sleep(400);
  // CASE-INSENSITIVE, and that is the whole assertion. The dialog's eyebrow reads "Review before you
  // start" in the markup, and .eyebrow carries text-transform:uppercase (portal-ui/src/base.css), so
  // document.body.innerText yields REVIEW BEFORE YOU START. A case-sensitive check never matched, this
  // flag read true whether the dialog opened or not, and the assertion that reads it was a gate with no
  // failing input.
  out.refusedDialogRefused = !/review before you start/i.test(txt());
  out.steps.push('an unacceptable geography refused at the composer');

  // ── third pass: the KNOCKOUT on the WIRE ──
  // The picker rendering and the footer label prove the screen. What decides which product is run and
  // billed is what reaches the server — and a control that changes the label and sends the old value is
  // exactly the shape of the last two incidents on this screen.
  pickProduct(/Knockout search/);
  await sleep(220);
  out.knockoutReviewable = findByText('button', /Review clearance/).disabled === false;
  findByText('button', /Review clearance/).click();
  await mustSettle(() => /review before you start/i.test(txt()), 5000, 'the review dialog never opened for the knockout');   // the eyebrow renders uppercase
  out.steps.push('planned a knockout');

  // Leave the screen COMPOSED rather than mid-dialog. The screenshot is evidence for a human, and a
  // modal over a dimmed page shows neither the modal nor the page. Closing it also exercises the one
  // control that must always work here: nothing is spent until Start, so Back must always be reachable.
  const back = maybeByText('button', /Back to edit/);
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
  out.fullRunnable = findByText('button', /Review clearance/).disabled === false;

  // MARKETPLACES — the add control sits beside the chips, so typing in it must MOVE the estimate.
  // Before, extras rode the wire and the engine ran a grid column for each while checksPerName, the
  // effort bar and the cost band all sat still. Nothing but a real browser can press this.
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
  // REWRITTEN TO THE OWNER'S COPY (tracker issue 1937). This is the SECOND implementation of the rule
  // — portal-ui/test/screenCopy.test.ts holds the first, against the source — so the copy change reds
  // here too, and re-aiming one without the other leaves a guard asserting a sentence nobody ships.
  //
  // What the old predicate required and the screen no longer says: "column of the sweep" (what a shop
  // DOES) and "another pass per name" (what adding one COSTS). Neither is on the page now. The cost is
  // still visible as a number — extraShopsMovedChecks above drives it and asserts it moves — so this
  // relaxation gives up a sentence, not the fact.
  //
  // Aimed at RENDERED text, not source: JSX collapses the element's newlines and indentation to single
  // spaces before innerText ever sees it, so the whitespace class here is insurance rather than the
  // wrapping the source-reading arm actually needs.
  //
  // DOUBLE the backslashes, as every regex in this file does. This block is a template literal that is
  // evaluated in the page, and a template literal eats an unrecognised escape: a single-backslash \\s+
  // reaches the browser as a literal s+, which turns a correct assertion into a red nobody can explain
  // from reading it. That cost one run here before it was caught locally.
  out.marketplacesSayWhereTheyComeFrom =
    /forced\\s+deep\\s+dive\\s+inherited\\s+from\\s+Brand\\s+Owner/.test(txt())
    && /common\\s+law\\s+sweeps\\s+everything\\s+it\\s+can\\s+find/.test(txt());

  // THE COMPARISON, and the scrollbar it must keep to itself. It replaced a delta view that priced a
  // LEVER MOVE — there are no levers, and what a client asks now is "am I buying the right one of the
  // four", which is a comparison.
  const depths = [...document.querySelectorAll('details')].find((d) => /Detailed search comparison table for information/.test(d.innerText));
  out.matrixOffered = Boolean(depths);
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
    // HOW FAR past its wrapper, not just whether. The th rule is nowrap, so when these headers became
    // full product names the table ran ~2x its wrapper and barely two of the columns were visible — a
    // boolean could not tell that from the 40px the 760px min-width has always cost.
    out.matrixOverflowPx = wrap && table ? table.scrollWidth - wrap.clientWidth : null;
    // ── Refs tracker issue 2144 — THE ESCAPE MUST BE A CHILD OF THE THING THAT CAPS IT ─────────────
    // The cap is a direct-child selector. The opt-out spent two rounds of fixing applied to a
    // GRANDCHILD, where lifting the max-width asks a box to be wider than the box it lives in — which
    // is why the table stayed at 718px while reading, in the source, as though it had opted out. No
    // assertion over source text can see this; the parent chain can, and only from in here.
    //
    // classList, not a regex: this whole block is a template literal, where a lone backslash-b is the
    // BACKSPACE escape rather than a word boundary. And no backticks in these comments — they end the
    // literal, which is a syntax error that stops the check running at all.
    const wide = document.querySelector('.composer-wide');
    out.wideParentClass = wide?.parentElement?.className ?? null;
    out.wideIsDirectChildOfColumn = !!wide && !!wide.parentElement?.classList.contains('composer-col');
    out.matrixColsVisible = wrap
      ? [...depths.querySelectorAll('table.data thead th')]
          .filter((th) => th.offsetLeft + th.offsetWidth <= wrap.clientWidth + 1).length
      : null;
    out.pageStillDoesNotScroll = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    out.matrixNamesNoMachinery = !/jxLanes|commonLawGrid|registerProbe/.test(depths.innerText);
    // THE OFFERING'S OWN WORDS, not a rung: the table states the geography each product accepts and
    // which one carries the case-law reading.
    out.matrixSaysGeography = /exactly one country/.test(depths.innerText)
      && /worldwide, and nothing else/.test(depths.innerText);
    out.matrixSaysCaseLawProduct = /this is the search that carries it/.test(depths.innerText);
    out.matrixNoRungs = !/Depth \\d/.test(depths.innerText);
    // MARKERS. A glyph with no key is a puzzle, so every one drawn must appear in the legend — checked
    // in the real browser because innerText is where a glyph that failed to render actually disappears.
    out.matrixGlyphsDrawn = [...new Set((depths.innerText.match(/[●◐○]/g) || []))].sort().join('');
    out.matrixLegendShown = /Included/.test(depths.innerText) && /Not on this depth/.test(depths.innerText);
    // The highlighted column is the product that is picked, and there is exactly one.
    out.matrixCurrentCols = depths.querySelectorAll('table.data thead th[aria-current]').length;
    out.matrixCurrentIsHere = /you are here/i.test(depths.innerText);   // th is uppercased by CSS
    out.matrixNoNotAvailable = !/Not available/.test(depths.innerText);
  }
  out.steps.push('coherence rules');

  // ── the worldwide read ──────────────────────────────────────────────────────────────────────────
  //
  // The one instruction a brief can give that REMOVES something from the form. It was structurally
  // impossible before — worldwide was the empty list, the reader could not distinguish "everywhere" from
  // "the brief does not say", and applyRead had no path to []. So an explicit worldwide over a draft
  // naming countries was dropped silently. Both halves are exercised here: the chips must go, and the
  // receipt must say so.
  findByText('button', /^Describe it$/).click();
  await sleep(200);
  const briefBox2 = [...document.querySelectorAll('textarea')].find((a) => /obvious blockers/.test(a.placeholder || ''));
  set(briefBox2, 'Actually make it worldwide, not just the US.');
  await sleep(140);
  findByText('button', /Fill it in for me/).click();
  await mustSettle(() => /the named territories were cleared/.test(txt()), 5000, 'the finished run never named its territories');
  out.worldwideCleared = /the named territories were cleared/.test(txt());
  out.worldwideChipsGone = [...document.querySelectorAll('.chip')].every((c) => !/United States|China/.test(c.innerText));
  out.worldwideChipShown = /Worldwide/.test(txt());
  out.steps.push('worldwide read');
  findByText('button', /Set it up myself/).click();
  await sleep(180);

  // Leave it on a state a human can read: the deepest search, one country, nothing blocked.
  pickProduct(/Full country search/);
  await sleep(200);
  set(whereBox(), 'united s');
  await sleep(200);
  const usFinal = [...document.querySelectorAll('.typeahead button')].find((b) => /United States/.test(b.innerText));
  if (usFinal) usFinal.click();
  await sleep(220);
  // Scoped to the "Not runnable as set" notice. It used to read the whole page, which was safe until
  // the delta view began quoting blockers' own sentences as the CONSEQUENCE of a move NOT taken — a
  // hypothetical, and the whole point of that view. Reading the notice asks the real question: is the
  // composer blocked, rather than does the word "blocked" appear anywhere on screen.
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
    // #1809 — the named throw says WHAT was missing; this says what was on screen instead. Without it a
    // diagnostic fix still loses the diagnosis, which is the whole complaint this change answers.
    out.body = txt().slice(0, 900);
    return out;
  }
})()
`

const userDir = mkdtempSync(join(tmpdir(), 'composer-check-'))

// Chrome's --dump-dom cannot run our driver script, so the driving happens via the DevTools protocol —
// but standing that up needs no extra dependency: a plain evaluate over the websocket is enough.
const chrome = spawn('google-chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--user-data-dir=${userDir}`, '--window-size=1280,900',
  '--remote-debugging-port=0', `${origin}/portal/new`,
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

const planPosts = posted.filter((p) => p.path === '/portal/api/run/plan')
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

ok(out.entryCards === 2, `the two ways in (Describe it / Set it up myself) did not render — found ${out.entryCards} cards`)
ok(out.startPills >= 3, `the start-from-a-template pills are missing — found ${out.startPills}`)
ok(out.describePane, 'the Describe-it pane did not open')
ok(out.readDisabledWhenEmpty === true, 'Fill it in for me must be dead until there is a brief — an empty press spends a slot of the hourly budget for nothing')
ok(out.readEnabled === true, 'Fill it in for me never came alive with a brief in the box')
ok(out.receiptShown, 'a read left no receipt — the reader has no way to check what was taken')
ok(out.briefSurvives, 'THE brief was consumed by reading it — and there is no undo on this screen, so a bad read has nothing left to correct from')
ok(out.namesFilled, 'the read did not reach the Names field — the response body is not the feature, the form is')
ok(out.readClassChips.some((c) => /^32 · /.test(c)), `the read's class never became a chip: ${JSON.stringify(out.readClassChips)}`)
ok(out.readClassChips.some((c) => /^5 · /.test(c)), 'the read REPLACED the owner\'s inherited classes instead of extending them')
ok(out.deadlineFilled, 'the read did not reach the date field')
ok(out.refFilled, 'the read did not reach Your reference')
ok(out.productMoved, '"just the obvious blockers" did not move the product to a knockout — the most consequential thing a read can do')
ok(out.droppedShown, 'a territory this composer cannot place was swallowed silently — the user would believe they are paying to search it')
ok(out.doubtShown, "the model's own doubt was dropped rather than shown")
ok(out.receiptLines.length >= 4, `the receipt is thin: ${JSON.stringify(out.receiptLines)}`)
ok(out.segmented, 'the persistent Describe-it / Set-it-up-myself toggle is missing')
ok(out.contextCard, 'the context card did not render')
ok(out.inheritedClassChips.some((c) => /^5 · /.test(c)) && out.inheritedClassChips.some((c) => /^32 · /.test(c)),
  `the owner's own classes are not shown as named chips: ${JSON.stringify(out.inheritedClassChips)}`)
ok(out.shopChips === 6, `the shop list should show six and offer the rest, showed ${out.shopChips}`)
ok(out.showAll, 'the marketplace list has no show-all — a dead "+N more" is what the ruling forbade')
ok(out.savedHeading, 'custom searches have no group of their own')
ok(out.savedListScrolls === true, 'a long custom-search book must scroll rather than push the levers off the page')
ok(out.savedRetire >= 1, 'a custom search offers no retire control')
ok(out.classLookupFound, `the class lookup did not find class 9 for "software": ${JSON.stringify(out.classLookup)}`)
ok(out.lookupFindsByWord, `"drinks" should reach class 33 by its heading: ${JSON.stringify(out.classLookup)}`)
ok(out.lookupSkipsChosen, 'a class already in scope was offered again')
ok(out.classChipReadsName, 'a class chip must say what the class IS, not just its number')
ok(out.inheritedKeptOnOverride, "adding a class dropped the owner's own — an override must extend the inherited list, not replace it")
ok(out.deadlineIsDate, 'the deadline is still a free-text box')
ok(out.startingFrom, 'the footer never says what it started from — the "cannot tell what I picked" gap')
ok(out.reviewIsModal !== false, 'the review step is not the modal the design specifies')
ok(out.modalDismissed !== false, 'Back to edit did not close the review dialog')
ok(out.footerAtRest, 'the running total is not on screen before anything is typed')
ok(out.checks === '14', `dense owner should read 14 checks per name, read ${out.checks}`)
ok(out.knockoutTier, 'registers off did not become a Knockout')
ok(out.knockoutSweep, 'a knockout does not say it sweeps marketplaces')

// ── THE PICKER: four rows, each stating what it accepts and what it reads ───────────────────────────
ok(out.pickerNamesAllFour, `the picker does not offer all four searches by name: ${JSON.stringify(out.pickerRows)}`)
ok(out.pickerStatesGeography, 'a row does not say the geography its search accepts — that is what a client is choosing between')
ok(out.pickerStatesNameCount,
  'the name count on a row is not the offering\'s figure — a row reading "up to 20 names" over an eight-name wall is what this build deleted')
ok(out.knockoutTier, 'picking the Knockout search did not name it in the footer')
ok(out.nativeHiddenOnKnockout, 'the native-language toggle is offered on a knockout, which does not carry it')
ok(out.knockoutCarriesCounts, 'the Knockout search does not state that it takes the register filing counts')
ok(out.caseLawStatedNotOffered,
  'case law is either offered as a control or not stated at all — it is what a Full country search IS, so the screen states it and offers nothing to press')

// ── GEOGRAPHY FOLLOWS THE PRODUCT, and each control says why at the control ─────────────────────────
ok(out.globalNoTerritoryInput === true,
  'a Global preliminary search still has a territory field — worldwide is not a choice on it, it IS it, so a field there is a control whose every use is refused')
ok(out.globalSaysWhy, 'the Where panel does not say WHY there is nothing to set — a control that vanishes with no reason is the oldest complaint about this screen')
ok(out.multiHasTerritoryInput, 'a Multi-country focus search has no territory field')
ok(out.multiOffersRegion, 'a Multi-country focus search does not offer regions, which it accepts')
ok(out.nativeToggleOffered, 'the ONE toggle in the offering is missing from the one product that offers it')
ok(out.oneCountryBlocked, 'one country on a Multi-country focus search was accepted silently — the engine refuses it, and the user would find out at the gate')
ok(out.oneCountryNamesWayOut, 'the blocker states no way out — enforcement without an invitation is what this screen exists to stop')
ok(out.reviewShutOnOneCountry === true, 'Review clearance stayed live on a search the server will refuse')
ok(out.fullSaysRegionsNotOffered, 'a Full country search does not say that regions are not offered on it')
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
ok(out.reviewOpened, 'the review step never opened')
ok(out.noCountdown, 'a countdown is back on the review dialog — a stopwatch on someone reading a legal summary')
ok(out.failureShown, 'a refused run showed NOTHING — the exact report from 2026-07-22')
ok(out.failureInsideModal, 'the refusal rendered outside the dialog again; at the bottom of a tall form it is invisible')
ok(out.failureNamesReason, 'the refusal did not carry the server\'s reason')
ok(out.reviewAgainOffered, 'a refused run offers no way forward')
ok(out.startGoneOnFailure, 'Start is still on screen after the ticket was spent — a dead button')
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
ok(out.matrixOffered, '"Detailed search comparison table for information" did not render')
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
ok(out.leftClean, 'the check left the composer in a blocked state')

console.log(JSON.stringify({ ...out, planBody, countsBody }, null, 2))
if (shotAt) writeFileSync(shotAt + '.json', JSON.stringify({ ...out, planBody, countsBody }, null, 2))

if (fail.length) {
  console.error('\nFAILED:')
  for (const f of fail) console.error('  ✗ ' + f)
  process.exit(1)
}
console.log('\nrender check passed')
