// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// One name out of a batch, opened inside the shell.
//
// THE DEFECT. A knockout over several names publishes one document per name, and the family
// screen listed those names as plain links to the frozen files. Following one left the portal: the
// report filled the window with no shell, no navigation, and nothing pointing back at the names it was
// published beside. On a multi-name run the screen behind it was blank as well, because the run-level
// document a batch does not have is what that screen framed.
//
// The repair is two functions and a rule about the difference between them:
//
//   • a name's LINK is a route          — /portal/result/<runId>/<markSlug>, read by `resultRoute`
//   • what the frame LOADS is a document — /portal/report/<runId>/<slug>/,   chosen by `openDocument`
//
// Those two are one edit apart and the wrong one is the tempting one. `report` — the field beside the
// per-name list — is consumed as an IFRAME SOURCE, so repointing its sibling at the new route and
// feeding the frame from it would load the portal inside its own frame: no report, on every run that
// has one. The last test in this file is that pair held apart, and it is the one worth keeping.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resultRoute, resultPath, screenForPath } from '../src/nav/nav.config.ts'
import { openDocument, showsAssessment } from '../src/contract/reads.ts'
import type { Run } from '../src/contract/api.ts'

// A two-name knockout, shaped as driver/portal-service.mjs builds it: NO run-level document — there is
// no such document for a batch — and one entry per name carrying its own slug and its own file.
const BATCH = {
  runId: 'tmp1-ironwhisk-batch',
  report: null,
  reports: [
    { mark: 'IRONWHISK', slug: 'ironwhisk', path: '/portal/report/tmp1-ironwhisk-batch/ironwhisk/' },
    { mark: 'CLUVENDRA', slug: 'cluvendra', path: '/portal/report/tmp1-ironwhisk-batch/cluvendra/' },
  ],
} as unknown as Run

// A single-name run: one document, reachable run-level, and NO slug to pick between names. This is the
// shape the fix could quietly break while every existing test kept passing, so it is asserted beside
// the new behaviour rather than assumed.
const SINGLE = {
  runId: 'tmp1-aurora-run',
  report: '/portal/report/tmp1-aurora-run/',
  reports: [{ mark: 'AquaPlus', slug: null, path: '/portal/report/tmp1-aurora-run/' }],
} as unknown as Run

// ── reading the URL ──────────────────────────────────────────────────────────────────────────────────

test('THE DEFECT: a two-argument result URL yields the RUN, not the last thing on the path', () => {
  // The read this replaced was `pathname.split('/').filter(Boolean).pop()`. On the one-argument form it
  // was right; on this one it returns 'ironwhisk' AS THE RUN ID, no run matches, and the screen tells
  // the reader their report is missing while the document sits on disk. Both halves are asserted —
  // taking the first segment and dropping the second would pass an assertion on runId alone.
  assert.deepEqual(resultRoute('/portal/result/tmp1-ironwhisk-batch/ironwhisk'), {
    runId: 'tmp1-ironwhisk-batch',
    markSlug: 'ironwhisk',
  })
  // The exact failure, spelled out: the last segment is NOT the run.
  const last = '/portal/result/tmp1-ironwhisk-batch/ironwhisk'.split('/').filter(Boolean).pop()
  assert.notEqual(resultRoute('/portal/result/tmp1-ironwhisk-batch/ironwhisk').runId, last)
})

test('the one-argument form is unchanged', () => {
  assert.deepEqual(resultRoute('/portal/result/tmp1-aurora-run'), {
    runId: 'tmp1-aurora-run',
    markSlug: null,
  })
  // A trailing slash is the same URL, not a URL with an empty second argument.
  assert.deepEqual(resultRoute('/portal/result/tmp1-aurora-run/'), {
    runId: 'tmp1-aurora-run',
    markSlug: null,
  })
})

test('a URL with no run in it says so, rather than inventing one', () => {
  // An ABSENCE, reported as one. The router turns a null run into a redirect to the list; anything that
  // guessed here would open somebody else's report on a URL that named nobody.
  for (const p of ['/portal/result', '/portal/result/', '/portal/clearances', '/portal', '/']) {
    assert.equal(resultRoute(p).runId, null, `${p} carries no run`)
  }
})

test('query and hash are not arguments', () => {
  // Same rule as screenForPath, and the same reason: the path decides, and a screen that treated `?x=1`
  // as part of the run id would fail to find a run on every link that carried one.
  assert.deepEqual(resultRoute('/portal/result/tmp1-aurora-run?from=email'), {
    runId: 'tmp1-aurora-run',
    markSlug: null,
  })
  assert.deepEqual(resultRoute('/portal/result/tmp1-ironwhisk-batch/ironwhisk#findings'), {
    runId: 'tmp1-ironwhisk-batch',
    markSlug: 'ironwhisk',
  })
})

test('a run identified as "result" is a run, not the bare route', () => {
  // The guard this removes was `runId === 'result'`, and it existed only because `.pop()` on the bare
  // path returned the screen's own name. Reading the tail after the route cannot make that mistake, so
  // the exclusion goes — and with it the refusal to open a run that happens to be called 'result'.
  assert.deepEqual(resultRoute('/portal/result/result'), { runId: 'result', markSlug: null })
})

test('a URL nobody can decode fails to find a run, instead of taking the screen down', () => {
  // decodeURIComponent('%zz') THROWS, and this runs inside render: an unescaped percent in a pasted or
  // truncated link would blank the whole app rather than fail to match a run.
  assert.doesNotThrow(() => resultRoute('/portal/result/%zz'))
  assert.equal(resultRoute('/portal/result/%zz').runId, '%zz')
  // A well-formed escape still decodes, so a mark slug with a reserved character survives the trip.
  assert.deepEqual(resultRoute('/portal/result/run%20one/mark%2Ftwo'), {
    runId: 'run one',
    markSlug: 'mark/two',
  })
})

test('both forms still resolve to the result screen', () => {
  // Parsing the URL correctly and routing it nowhere is the same dead end as before. Both roles: a
  // client landing on a path that resolves only for staff gets "That page does not exist."
  for (const role of ['client', 'staff'] as const) {
    assert.equal(screenForPath('/portal/result/tmp1-aurora-run', role)?.id, 'result')
    assert.equal(screenForPath('/portal/result/tmp1-ironwhisk-batch/ironwhisk', role)?.id, 'result')
  }
})

test('what the family links, the router reads back', () => {
  // The round trip over the REAL composer, not a re-typed copy of the rule. A test that spelled the
  // path out itself would keep passing after the two ends drifted apart, which is the whole failure
  // this pair exists to prevent.
  for (const r of BATCH.reports) {
    assert.deepEqual(resultRoute(resultPath(BATCH.runId, r.slug)), {
      runId: BATCH.runId,
      markSlug: r.slug,
    })
  }
  assert.deepEqual(resultRoute(resultPath(SINGLE.runId)), { runId: SINGLE.runId, markSlug: null })
})

// ── choosing the document ────────────────────────────────────────────────────────────────────────────

test('a named mark opens THAT name, out of the run’s own list', () => {
  assert.deepEqual(openDocument(BATCH, 'cluvendra'), {
    doc: '/portal/report/tmp1-ironwhisk-batch/cluvendra/',
    mark: 'CLUVENDRA',
    missing: false,
  })
  // Not the first of the two. Serving name one of eight as "the report" is the defect one-report-per-
  // mark removed, and re-introducing it here would look like a working screen.
  assert.notEqual(openDocument(BATCH, 'cluvendra').doc, BATCH.reports[0]!.path)
})

test('a batch with no name chosen frames nothing — the list is what it shows', () => {
  assert.deepEqual(openDocument(BATCH, null), { doc: null, mark: null, missing: false })
})

test('REGRESSION: a single-document run still frames its own document', () => {
  // The case the fix could break in silence: every existing test of this screen uses a single-mark run,
  // and all of them would keep passing against a version that framed a ROUTE here — the frame would
  // load the portal inside itself and no assertion in this suite would notice.
  assert.deepEqual(openDocument(SINGLE, null), {
    doc: '/portal/report/tmp1-aurora-run/',
    mark: null,
    missing: false,
  })
})

test('a slug that names nothing is a MISS, and never falls back to the run', () => {
  // Falling through to `report` would answer a question about one name with a different name's report
  // on a batch, and with the run's own document on a single-name run. The screen says it does not have
  // that name and offers the family; it does not quietly show something else.
  assert.deepEqual(openDocument(BATCH, 'no-such-mark'), { doc: null, mark: null, missing: true })
  assert.deepEqual(openDocument(SINGLE, 'aquaplus'), { doc: null, mark: null, missing: true })
  assert.notEqual(openDocument(SINGLE, 'aquaplus').doc, SINGLE.report)
})

test('THE PAIR HELD APART: what the frame loads is never what the link goes to', () => {
  // The trap this fix walks past. Both fields are URLs for "the report", one is a route and one is a
  // document, and the tempting simplification — one field for both — loads the portal inside its own
  // frame. Asserted over every run shape and every name, so a later change that collapses them fails
  // here rather than in front of a client.
  for (const run of [BATCH, SINGLE]) {
    for (const r of run.reports) {
      const link = resultPath(run.runId, r.slug)
      const { doc } = openDocument(run, r.slug ?? null)
      if (r.slug === null) continue   // no per-name route exists for a document published before slugs
      assert.notEqual(doc, link, `${r.mark}: the frame would load the screen that frames it`)
      assert.equal(doc, r.path, `${r.mark}: the frame loads the published document`)
      assert.ok(link.startsWith('/portal/result/'), `${r.mark}: the link is a portal route`)
      assert.ok(doc!.startsWith('/portal/report/'), `${r.mark}: the document is not`)
    }
  }
})

// ── the cross-mark assessment ────────────────────────────────────────────────────────────────────────
//
// The grouped page carries the paragraph that reads the names against each other (, owner ruling
// 2026-08-26). The server answers it for ANY run that has one, because `report.md` is written on every
// run and a 404 for some of them would report an absence that is not true. Which view renders it is this
// screen's question, and it has exactly one rule.

test('the grouped page shows the cross-mark assessment', () => {
  assert.equal(showsAssessment(BATCH, null), true)
})

test('NEVER THE SAME PARAGRAPH TWICE: a view that frames a document shows no panel', () => {
  // With a name open, the frame below carries that name's own assessment. A panel above it would print
  // an assessment twice on one screen — and on a batch, the panel's paragraph is about the siblings too,
  // which is the residue the per-mark documents exist to keep out.
  assert.equal(showsAssessment(BATCH, 'ironwhisk'), false, 'a name is open — its document has the prose')
  // A single-document run frames its own report, which renders its own summary. Same rule, and it is why
  // the server gate was the wrong place for it: the prose EXISTS here, it is simply already on screen.
  assert.equal(showsAssessment(SINGLE, null), false, 'the framed report already carries it')
})

test('a slug naming nothing shows no assessment under the message saying so', () => {
  // The screen is telling the reader it does not have that name. A paragraph under that would read as
  // the answer to the question they just asked.
  assert.equal(showsAssessment(BATCH, 'no-such-mark'), false)
})

test('a run that has produced nothing shows nothing', () => {
  const PENDING = { runId: 'tmp1-pending', report: null, reports: [] } as unknown as Run
  assert.equal(showsAssessment(PENDING, null), false)
})

test('THE RULE, AS A PROPERTY: the panel shows exactly when no document is framed', () => {
  // Derived rather than re-stated, so the two answers cannot drift apart. Driven over every view this
  // screen has: if a document is framed, the panel is off; the only views with the panel on are the ones
  // showing a family and framing nothing.
  const views: [string, Run, string | null][] = [
    ['batch, family', BATCH, null],
    ['batch, one name', BATCH, 'ironwhisk'],
    ['batch, other name', BATCH, 'cluvendra'],
    ['batch, unknown name', BATCH, 'no-such-mark'],
    ['single, framed', SINGLE, null],
    ['single, bogus slug', SINGLE, 'aquaplus'],
  ]
  const framed: string[] = []
  const panelled: string[] = []
  for (const [label, run, slug] of views) {
    if (openDocument(run, slug).doc !== null) framed.push(label)
    if (showsAssessment(run, slug)) panelled.push(label)
  }
  assert.deepEqual(framed, ['batch, one name', 'batch, other name', 'single, framed'])
  assert.deepEqual(panelled, ['batch, family'])
  for (const [label, run, slug] of views) {
    assert.equal(openDocument(run, slug).doc !== null && showsAssessment(run, slug), false,
      `${label}: a framed document and a panel at once is the paragraph printed twice`)
  }
})
