// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The data-layer contract.
//
// Two rules are pinned here that no amount of code review reliably catches:
//
//   1. NOTHING decodes to a "forbidden" state. The Result union has no such member, so a component
//      cannot render one. That is what makes 404-never-403 hold structurally rather than by vigilance.
//   2. 422 has two meanings and they decode differently. With a classify block the engine is asking a
//      question; without one, portal-service's mark-batch dedupe rejected colliding names. Rendering
//      one as the other tells a user to answer a question nobody asked.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { api, isOk, saveFailureText, notCommitted, onSessionEnded, type Result } from '../src/contract/api.ts'

// A fetch stand-in. The contract module is the only thing in the app allowed to call fetch, so faking
// the global is faking the entire outside world.
const withFetch = async <T>(
  status: number,
  body: unknown,
  call: () => Promise<Result<T>>,
): Promise<Result<T>> => {
  const original = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(body === undefined ? '' : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch
  try {
    return await call()
  } finally {
    globalThis.fetch = original
  }
}

test('403 and 404 both decode to states with no "forbidden" in them', async () => {
  const forbidden = await withFetch(403, { error: 'no access' }, () => api.runs('aurora'))
  const missing = await withFetch(404, { error: 'not_found' }, () => api.runs('aurora'))

  assert.equal(forbidden.kind, 'noAccess')
  assert.equal(missing.kind, 'notFound')

  // The load-bearing assertion: no decoded state carries the server's denial wording onwards. A UI
  // that echoed "no access" for one account and "not_found" for another would be an existence oracle
  // built out of error strings.
  for (const r of [forbidden, missing]) {
    assert.equal(JSON.stringify(r).toLowerCase().includes('forbidden'), false)
    assert.equal('message' in r, false, 'a denial must not carry a message a component could print')
  }
})

test('422 with classify is a question; 422 without is a collision', async () => {
  const asking = await withFetch(
    422,
    { classify: { questions: ['Which classes should this cover?'] } },
    () => api.runs('aurora'),
  )
  assert.equal(asking.kind, 'clarify')
  assert.deepEqual(asking.kind === 'clarify' ? asking.questions : null, ['Which classes should this cover?'])

  const colliding = await withFetch(
    422,
    { errors: ['LUMEN and lumen resolve to the same run'] },
    () => api.runs('aurora'),
  )
  assert.equal(colliding.kind, 'collision', 'no classify ⇒ mark-batch dedupe, not a question')
  assert.deepEqual(colliding.kind === 'collision' ? colliding.errors : null, ['LUMEN and lumen resolve to the same run'])
})

test('409 splits: the confirmation gate is rendered verbatim, a version conflict is not the same thing', async () => {
  const gate = await withFetch(
    409,
    { error: 'the request changed after confirmation — review the plan again and re-confirm' },
    () => api.runs('aurora'),
  )
  assert.equal(gate.kind, 'gate')
  // Verbatim. These seven strings are written to be read by a human; paraphrasing a precise
  // instruction into a vague one is the whole failure mode.
  assert.equal(
    gate.kind === 'gate' ? gate.message : '',
    'the request changed after confirmation — review the plan again and re-confirm',
  )

  const conflict = await withFetch(409, { error: 'version_conflict: expected 4, found 5' }, () => api.runs('aurora'))
  assert.equal(conflict.kind, 'conflict', 'an optimistic-concurrency clash is a save problem, not a gate refusal')
})

test('a staff identity granted everything is not a client with no accounts', async () => {
  // The wire sends "*" — not a list, and not something to silently coerce to []. A sidebar that read
  // an empty array here would tell a Cordillera lawyer they have no brand owners.
  const staff = await withFetch(200, { role: 'staff', email: 'x@cordillera.ch', accounts: '*' }, () => api.me())
  assert.ok(isOk(staff))
  if (isOk(staff)) {
    assert.equal(staff.value.allAccounts, true)
    assert.deepEqual(staff.value.accounts, [])
  }

  const client = await withFetch(200, { role: 'client', email: 'a@b.example', accounts: ['aurora'] }, () => api.me())
  assert.ok(isOk(client))
  if (isOk(client)) {
    assert.equal(client.value.allAccounts, false)
    assert.deepEqual(client.value.accounts, ['aurora'])
  }
})

test('a staff 400 asking who they act for is a UI state, not an error to print at someone', async () => {
  const r = await withFetch(400, { error: 'name an account (?account=)' }, () => api.runs(null))
  assert.equal(r.kind, 'pickAccount')

  const real = await withFetch(400, { errors: ['classes must be numbers'] }, () => api.runs(null))
  assert.equal(real.kind, 'reject')
})

test('run rows never gain a tone or a band the server did not send', async () => {
  const r = await withFetch(
    200,
    {
      runs: [
        {
          runId: 'r1',
          title: 'NOVAPULSE',
          overall: 'Moderate',
          // no tone, no bands — a pre-doc-50 archive
        },
        {
          runId: 'r2',
          title: 'BAD',
          tone: 'Medium', // wrong case: not a tone
          bands: [{ label: 'X', tone: 'nope' }, { label: 'Y' }, { tone: 'high' }],
        },
        { title: 'no id — dropped entirely' },
      ],
    },
    () => api.runs('aurora'),
  )
  assert.ok(isOk(r))
  if (!isOk(r)) return

  assert.equal(r.value.length, 2, 'a row with no runId is unusable and is dropped, not patched up')

  const [r1, r2] = r.value
  assert.equal(r1!.band, 'Moderate', 'the label survives so the row is not blank')
  assert.equal(r1!.tone, null, 'no tone was sent, so none is invented')
  assert.deepEqual(r1!.bands, [])

  assert.equal(r2!.tone, null, '"Medium" is not a tone — near-misses are rejected, not corrected')
  assert.deepEqual(r2!.bands, [], 'every malformed rung is dropped; a fabricated ladder rung is worse than a short ladder')

  // reportSchema absence is what identifies a legacy run, so it must decode to null, never to a default.
  assert.equal(r1!.reportSchema, null)
})

test('an unknown run state is treated as in flight, never as finished', async () => {
  const r = await withFetch(200, { runs: [{ runId: 'x', state: 'reticulating' }] }, () => api.runs('aurora'))
  assert.ok(isOk(r))
  // Erring toward "finished" would invite someone to go and read a report that does not exist yet.
  if (isOk(r)) assert.equal(r.value[0]!.state, 'running')
})

test("the engine's park vocabulary decodes to paused (the mid-upgrade belt), and pausedKind operator survives decode", async () => {
  // The server maps postponed/recovering/parked-for-human before they reach the wire; this belt exists
  // for a deployment mid-upgrade, where an older portal-service still forwards the raw state — a
  // five-hour (or overnight) pause must never render as "Running".
  const r = await withFetch(200, { runs: [
    { runId: 'a', state: 'postponed' },
    { runId: 'b', state: 'recovering' },
    { runId: 'c', state: 'parked-for-human' },
    { runId: 'd', state: 'paused', pausedKind: 'operator' },
    { runId: 'e', state: 'paused', pausedKind: 'made-up-kind' },
  ] }, () => api.runs('aurora'))
  assert.ok(isOk(r))
  if (isOk(r)) {
    for (const row of r.value.slice(0, 4)) assert.equal(row.state, 'paused', `${row.runId} decodes paused`)
    assert.equal(r.value[3]!.pausedKind, 'operator')
    assert.equal(r.value[4]!.pausedKind, null, 'an unrecognised kind is dropped, never guessed')
  }
})

test('a network failure is distinguishable from a server failure', async () => {
  const original = globalThis.fetch
  globalThis.fetch = (async () => {
    throw new TypeError('Failed to fetch')
  }) as typeof fetch
  try {
    const r = await api.runs('aurora')
    // Nothing reached the server, so a retry is free of side effects — which is why this is not lumped
    // in with a 5xx.
    assert.equal(r.kind, 'upstream')
  } finally {
    globalThis.fetch = original
  }
})

test('the projects mapper carries `archived` through, and an absent flag means not-archived', async () => {
  // The list row is RECONSTRUCTED field by field rather than passed through, so any field the mapper
  // does not name is silently dropped. `archived` is what the screen greys and badges a row on, so its
  // absence here would look exactly like "no project is ever archived" — a bug with no error anywhere.
  const r = await withFetch(200, { projects: [
    { key: 'live-one', name: 'Live one' },
    { key: 'retired-one', name: 'Retired one', archived: true },
  ] }, () => api.projects('aurora'))

  assert.ok(isOk(r))
  assert.deepEqual(r.value, [
    { key: 'live-one', name: 'Live one', archived: false },
    { key: 'retired-one', name: 'Retired one', archived: true },
  ])
})

test('adminObserved decodes a populated feed', async () => {
  const r = await withFetch(200, {
    available: true, truncated: true, note: null,
    people: [{ email: 'reviewer@cordillera.ch', events: { plan: 2, trigger: 1 }, accounts: ['aurora'],
      firstSeen: '2026-07-18T09:00:00.000Z', lastSeen: '2026-07-20T09:00:00.000Z', count: 3 }],
  }, () => api.adminObserved())
  assert.equal(r.kind, 'ok')
  if (r.kind !== 'ok') return
  assert.equal(r.value.available, true)
  assert.equal(r.value.truncated, true)
  assert.deepEqual(r.value.people[0]?.events, { plan: 2, trigger: 1 })
  assert.equal(r.value.people[0]?.count, 3)
})

test('adminObserved decodes an UNAVAILABLE feed without throwing — it is a normal state', async () => {
  // The panel is an extra on a page that must still render. A decoder that threw on the degraded
  // shape would turn "the log is missing" into "the access page is broken".
  const r = await withFetch(200, { available: false, note: 'No activity log is readable on this instance.' },
    () => api.adminObserved())
  assert.equal(r.kind, 'ok')
  if (r.kind !== 'ok') return
  assert.equal(r.value.available, false)
  assert.deepEqual(r.value.people, [], 'a missing list decodes to empty, not to undefined')
  assert.match(r.value.note ?? '', /No activity log/)
})

test('adminAccess decodes grantsFile, and refuses a half-known one', async () => {
  const known = await withFetch(200, { people: [], staffDomains: [], unknownAccounts: [], note: '',
    grantsFile: { name: 'grants.json', modifiedAt: '2026-07-18T00:00:00.000Z' } }, () => api.adminAccess())
  assert.equal(known.kind, 'ok')
  if (known.kind === 'ok') assert.equal(known.value.grantsFile?.name, 'grants.json')

  // A filename with no date would render as "last changed <nothing>". Both halves or null.
  const partial = await withFetch(200, { people: [], staffDomains: [], unknownAccounts: [], note: '',
    grantsFile: { name: 'grants.json' } }, () => api.adminAccess())
  assert.equal(partial.kind, 'ok')
  if (partial.kind === 'ok') assert.equal(partial.value.grantsFile, null, 'half-known is not known')

  const absent = await withFetch(200, { people: [], staffDomains: [], unknownAccounts: [], note: '' },
    () => api.adminAccess())
  assert.equal(absent.kind, 'ok')
  if (absent.kind === 'ok') assert.equal(absent.value.grantsFile, null)
})

// ──: the config hop, where a field that is not decoded is a field that never reaches the page ──

test('#1439 — an older snapshot decodes engine and providers as null, NOT as empty', async () => {
  // The decisive one. `asArray` and `asRecord` both collapse a missing value to an empty one, and empty
  // is the answer this pair must never give: `providers: []` renders as "no provider is configured",
  // which is the inverse of the fact that the snapshot simply predates provider reporting. Every
  // deployment is in that state until its driver next drains, so this is the common case, not the edge.
  const r = await withFetch(200, {
    available: true, note: null, capturedAt: '2026-08-20T00:00:00Z', stale: false,
    built: { knockout: true }, flags: [], engine: null, providers: null,
  }, () => api.adminConfig())

  assert.ok(isOk(r))
  assert.equal(r.value.engine, null, 'null must survive the hop')
  assert.equal(r.value.providers, null, 'and must NOT become []')
})

test('#1439 — engine and provider rows survive the hop with the fields the page renders', async () => {
  // The counterfactual for the test above: without this, decoding everything to null would also pass.
  const r = await withFetch(200, {
    available: true, note: null, capturedAt: '2026-08-20T00:00:00Z', stale: false,
    built: null, flags: [],
    engine: {
      id: 'openai-agent', vendor: 'OpenAI', known: true, binaryPresent: false,
      billing: { mode: 'api-key', apiBilled: false, missing: ['CODEX_API_KEY'] },
    },
    providers: [
      { key: 'register', label: 'Trademark register', provider: null, providerLabel: null,
        known: false, configured: false, missing: ['CLEAROTRON_DATABASE'] },
      { key: 'web', label: 'Open-web search', provider: 'serpapi', providerLabel: 'SerpAPI',
        known: true, configured: true, missing: [] },
    ],
  }, () => api.adminConfig())

  assert.ok(isOk(r))
  const { engine, providers } = r.value
  assert.equal(engine?.vendor, 'OpenAI')
  // The one state where mode and apiBilled disagree, and the reason the page believes the second.
  assert.equal(engine?.billing.mode, 'api-key')
  assert.equal(engine?.billing.apiBilled, false)
  assert.deepEqual(engine?.billing.missing, ['CODEX_API_KEY'])
  assert.equal(engine?.binaryPresent, false)

  assert.equal(providers?.length, 2, 'an unconfigured provider is a row, never a dropped one')
  assert.equal(providers?.[0]?.provider, null, 'no register selected — null, not an empty string')
  assert.equal(providers?.[0]?.configured, false)
  assert.deepEqual(providers?.[0]?.missing, ['CLEAROTRON_DATABASE'])
  assert.equal(providers?.[1]?.providerLabel, 'SerpAPI')
  assert.equal(providers?.[1]?.configured, true)
})

test('#1720 engineMode decodes to demo or unproven, and EVERYTHING else is null', async () => {
  // The two values a caller may act on survive; anything else lands as null, which every caller treats
  // as "leave the button alone". The direction that matters is the one that takes a working install's
  // button away: an unrecognised value must never read as demo.
  const demo = await withFetch(200, { role: 'client', email: 'a@b.example', accounts: ['aurora'], engineMode: 'demo' }, () => api.me())
  assert.ok(isOk(demo))
  if (isOk(demo)) assert.equal(demo.value.engineMode, 'demo')

  const unproven = await withFetch(200, { role: 'client', email: 'a@b.example', accounts: ['aurora'], engineMode: 'engine-unproven' }, () => api.me())
  assert.ok(isOk(unproven))
  if (isOk(unproven)) assert.equal(unproven.value.engineMode, 'engine-unproven')

  for (const wire of [undefined, null, '', 'engine-ready', 'DEMO', 'no-engine', 42, {}]) {
    const r = await withFetch(200, { role: 'client', email: 'a@b.example', accounts: ['aurora'], engineMode: wire }, () => api.me())
    assert.ok(isOk(r))
    if (isOk(r)) {
      assert.equal(r.value.engineMode, null,
        `engineMode ${JSON.stringify(wire)} decoded to something a caller could act on. An older `
        + `portal-service sends no field at all, and "engine-ready" is a value this screen must never `
        + `imply — only a completed probe turn produces it.`)
    }
  }
})

// ── — AN UNBUILT SURFACE IS NOT AN ACCESS REFUSAL ─────────────────────────────────
//
// The config routes answered 404 when the surface failed to construct, so the screens rendered
// "Projects are not available to you" to the owner of the account while the real cause — the deployment
// not pointed at its own store — existed only in a boot log. These arms pin the three-way distinction.

test('#1989 the surface refusing to construct decodes apart from "not yours"', async () => {
  const unbuilt = await withFetch(404, { error: 'config_surface_unavailable' }, () => api.profile('aurora'))
  assert.equal(unbuilt.kind, 'surfaceUnavailable')
  assert.notEqual(unbuilt.kind, 'notFound', 'a deployment fault must never wear the words of a denial')
  assert.notEqual(unbuilt.kind, 'noAccess')
})

test('#1989 every OTHER 404 stays deliberately indistinguishable', async () => {
  // THE CONTROL, and it is the load-bearing one. Without it the arm above passes just as well against a
  // rule that made EVERY 404 self-describing — which is precisely the existence oracle the
  // 404-never-403 rule exists to prevent. A foreign resource must still say nothing about itself.
  const foreign = await withFetch(404, { error: 'not_found' }, () => api.profile('aurora'))
  assert.equal(foreign.kind, 'notFound')
  assert.equal('message' in foreign, false, 'a tenancy answer must carry nothing a component could print')
})

test('#1989 the sentence names the deployment, never the reader', () => {
  const text = saveFailureText({ kind: 'surfaceUnavailable' })
  assert.match(text, /not your access/i, 'it must say plainly that this is not about their permissions')
  assert.match(text, /administrator/i, 'and name who can fix it, since the reader cannot')
  // The failure this replaces: copy that makes a config fault read as a permissions verdict.
  assert.doesNotMatch(text, /not available to you|you (do not|don't) have/i)
})

test('#1989 both settings screens answer three ways, not two', () => {
  // These screens have no DOM harness, so the assertion is on the source: each must branch on the new
  // state BEFORE falling through to the not-available sentence. Planted — reverting either screen to the
  // two-way ternary reds this arm.
  for (const f of ['Profile.tsx', 'Projects.tsx']) {
    const src = readFileSync(new URL(`../src/screens/${f}`, import.meta.url), 'utf8')
    assert.match(src, /surfaceUnavailable/, `${f} must render the unbuilt-surface state distinctly`)
    assert.match(src, /not your access/i, `${f} must tell the reader it is not their permissions`)
  }
})


// ── — A STAFF-LESS IDENTITY IS TOLD WHY, ON THE PAGE ──────────────────────────────
//
// Someone on no staff domain and in no grants row signs in successfully and can do nothing. Both screens
// collapsed `notFound` and `noAccess` into one answer — "Check the brand owner selected at the top left"
// — which sends that person to the one thing that is not wrong. The cause was stated only in a boot log.

test('#1920 the two refusals decode apart, and 403 is the door refusing the identity itself', async () => {
  const forbidden = await withFetch(403, { error: 'no access' }, () => api.profile('aurora'))
  const missing = await withFetch(404, { error: 'not_found' }, () => api.profile('aurora'))
  assert.equal(forbidden.kind, 'noAccess')
  assert.equal(missing.kind, 'notFound')
  assert.notEqual(forbidden.kind, missing.kind, 'if these decoded the same, no screen could tell them apart')
})

test('#1920 both screens answer them DIFFERENTLY, and only one mentions the selector', () => {
  // Source-level: these screens have no DOM harness, so what is pinned is that the branch exists and
  // what each branch says. The decode above is what makes the branch reachable.
  for (const f of ['Profile.tsx', 'NewClearance.tsx']) {
    const src = readFileSync(new URL(`../src/screens/${f}`, import.meta.url), 'utf8')
    assert.doesNotMatch(src, /case 'notFound':\s*\n\s*case 'noAccess':/,
      `${f} still answers both refusals with one sentence — that is the defect`)
    assert.match(src, /no staff domain and in no grants row/,
      `${f} must name the actual cause, in the words portal-service already logs at boot`)
    assert.match(src, /Selecting a different brand owner cannot change that/,
      `${f} must say plainly that the selector is not the fix, since that is where it used to send them`)
  }
})

test('#1920 THE CONTROL — notFound KEEPS the selector advice, which is right for it', () => {
  // Without this, the fix passes just as well if the advice were deleted from both branches. A wrong
  // brand owner really is the likely cause of a not-found, and that sentence is the useful one there.
  for (const f of ['Profile.tsx', 'NewClearance.tsx']) {
    const src = readFileSync(new URL(`../src/screens/${f}`, import.meta.url), 'utf8')
    const at = src.indexOf("case 'notFound':")
    assert.notEqual(at, -1, `${f} must still handle notFound`)
    assert.match(src.slice(at, at + 260), /Check the brand owner selected at the top left/,
      `${f}: the selector advice belongs on notFound and must not have been thrown away with the fix`)
  }
})

test('#1920 the shared sentence for noAccess never sends anyone to the selector either', () => {
  const text = saveFailureText({ kind: 'noAccess' })
  assert.doesNotMatch(text, /brand owner|top left|selector/i,
    'the one-line form must not contradict the screens it sits beside')
  assert.match(text, /signed in/i, 'and must still say the sign-in worked, because it did')
})


// ── — THE FIELD THAT HAD NEVER HAD A READER ───────────────────────────────────────
//
// `profile-service` and `recipe-service` have returned `commitError` on a 200 from every save route for
// months, carrying a written sentence. `grep -rn commitError portal-ui/src` returned NOTHING. The
// response is a 200, `isOk()` is true, and every save site branched only on `!isOk(r)` — so a write that
// never reached the store's git rendered as a clean success. The owner created a project, saw it
// succeed, and it was not durable.

test('#2005 a save that did not commit is reported, and a clean one says nothing', () => {
  const dirty = { kind: 'ok', value: { written: true, commitError: 'fatal: detected dubious ownership' } } as const
  const clean = { kind: 'ok', value: { written: true } } as const
  assert.ok(notCommitted(dirty), 'the field finally has a reader')
  assert.equal(notCommitted(clean), null, 'and an ordinary save is silent — a warning on every save is a warning nobody reads')
  assert.equal(notCommitted({ kind: 'notFound' } as never), null, 'a FAILED save is not this: nothing landed, so there is nothing uncommitted')
  assert.equal(notCommitted({ kind: 'ok', value: { commitError: '   ' } } as never), null, 'and a blank detail is not a failure')
})

test('#2005 the sentence says the change is LIVE — the opposite lie would be as bad', () => {
  const text = notCommitted({ kind: 'ok', value: { commitError: 'x' } } as never)!
  assert.match(text, /live/i, 'the change IS on disk and the engine will read it')
  assert.match(text, /can be lost/i, 'what it is not is durable, and that is the whole point')
  assert.match(text, /administrator/i, 'and it names who can fix it, because the reader cannot')
  assert.doesNotMatch(text, /could not be saved|was not saved|nothing has been changed/i,
    'telling someone their change was lost when it is live is a different lie in the other direction')
})

test('#2005 EVERY screen that saves reads it — the population is derived, not listed', () => {
  // The list of save sites is not written here on purpose. Seven of them across four screens is exactly
  // where a hand-kept list goes stale, and a screen added next month would inherit the original defect
  // silently. So the screens are DISCOVERED by their mutating call, and each must reference the helper.
  const dir = new URL('../src/screens/', import.meta.url)
  const screens = readdirSync(dir).filter((f) => f.endsWith('.tsx'))
  // Keyed on the MUTATING methods by name, not on a literal 'save' argument: Profile passes its action
  // as a variable, so an argument-shaped detector found 3 of 4 and reported the tree as the problem.
  // `savedSearch`/`savedSearches` are reads and must not be caught — hence the exact three names.
  const MUTATORS = /api\.(saveProfile|saveProject|saveSavedSearch)\(/
  const savers = screens.filter((f) => MUTATORS.test(readFileSync(new URL(f, dir), 'utf8')))

  assert.ok(savers.length >= 4, `only ${savers.length} saving screens found — the detector broke, not the tree`)
  for (const f of savers) {
    assert.match(readFileSync(new URL(f, dir), 'utf8'), /notCommitted\(/,
      `${f} performs a save and never asks whether it committed — that is the defect, one screen along`)
  }
})


// ── — A 401 IS ITS OWN ANSWER ──────────────────────────────────────────────
//
// It had no case in `decodeStatus`, so it fell through to `upstream` and the shell funnelled it into
// "You are signed in, but this address has not been enrolled" — told to a reader whose session had just
// gone, on the first screen they meet. The owner met exactly that on a fresh install.

test('2074 a 401 decodes to signedOut, on every route, and not to upstream', async () => {
  // THE CLASS, not one route. A kind that only some calls produce is a kind screens cannot rely on.
  for (const [name, call] of [
    ['me', () => api.me()],
    ['runs', () => api.runs('aurora')],
    ['runsMine', () => api.runsMine()],
  ] as const) {
    const r = await withFetch(401, { error: 'not signed in' }, call)
    assert.equal(r.kind, 'signedOut', `${name}: a gone session decoded as ${r.kind}`)
  }
  // And an EMPTY 401 body decodes the same way — a door that refuses before it composes JSON is the
  // commonest shape of this, and keying on the body would have missed it.
  const bare = await withFetch(401, undefined, () => api.me())
  assert.equal(bare.kind, 'signedOut', 'a 401 with no body decoded as something else')
})

test('2074 signedOut says the session ended, and never that the change failed', () => {
  const text = saveFailureText({ kind: 'signedOut' })
  assert.match(text, /session/i, 'the sentence does not name what actually happened')
  assert.match(text, /sign in/i, 'the sentence does not name the one thing that fixes it')
  // NOTHING WAS CHANGED, and the sentence must say so: the request never reached the server, so
  // repeating it after signing in is safe. "That change could not be saved" invites the reader to
  // wonder whether half of it was.
  assert.match(text, /nothing was changed|safe/i,
    'the sentence leaves a reader unsure whether their change half-landed')
  assert.doesNotMatch(text, /not been enrolled|no clearances are available/i,
    'the gone-session sentence borrowed the enrolment sentence — the false message this arm exists for')
})

test('2074 a 401 is NOT confused with the tenancy answers it sits beside', async () => {
  // The funnel that produced the false message is right for these and wrong for a 401, so the three
  // must stay distinguishable at the contract. 403 and 404 keep their own arm above; this one pins that
  // none of them collapsed into the new kind.
  const forbidden = await withFetch(403, { error: 'no access' }, () => api.runs('aurora'))
  const missing = await withFetch(404, { error: 'not_found' }, () => api.runs('aurora'))
  assert.equal(forbidden.kind, 'noAccess')
  assert.equal(missing.kind, 'notFound')
})

// ── — a session that ends MID-VISIT ──────────────────────────────────────────
//
// The shell loads `me` once with empty deps and never asks again, so it decides `signedOut` at mount and
// only there. Every later 401 — a screen's own load, a poll, a save, an admin action — landed on that
// screen's own failure notice, which says "could not be loaded just now" and never says "sign in".
//
// The announcement is in `call`, not in `useLoad`, because `useLoad` is not the only caller: the arms
// below drive a save and a load and assert one answer for both.
test('2113 any 401, from any request, announces that the session has gone', async () => {
  const seen: string[] = []
  const stop = onSessionEnded(() => seen.push('ended'))
  try {
    // A LOAD, long after mount.
    const load = await withFetch(401, { error: 'not signed in' }, () => api.runs('aurora'))
    assert.equal(load.kind, 'signedOut', 'a 401 no longer decodes to the kind the shell answers')
    assert.deepEqual(seen, ['ended'], 'a 401 on a screen load announced nothing, so only that screen hears it')

    // A SAVE. Same event, and the same announcement — this is the path a reader is on when they have
    // most to lose, and the one where a per-screen notice is least likely to say "sign in".
    const save = await withFetch(401, { error: 'not signed in' }, () => api.acknowledge({ runId: 'r1', state: 'failed', acknowledged: true }))
    assert.equal(save.kind, 'signedOut')
    assert.equal(seen.length, 2, 'a 401 on a save did not announce')

    // AND THE RESULT IS STILL RETURNED. The caller that asked has a branch to render; swallowing the
    // answer here would leave it holding a promise that never resolves, which is the defect tracker
    // issue 2074 was filed about.
    assert.ok(save.kind === 'signedOut')
  } finally {
    stop()
  }

  // Nothing is announced once the subscriber has gone — the unsubscribe is what keeps a remounted shell
  // from waking a dead closure.
  const after = await withFetch(401, { error: 'not signed in' }, () => api.runs('aurora'))
  assert.equal(after.kind, 'signedOut')
  assert.equal(seen.length, 2, 'the unsubscribe did not take, so a dead subscriber is still being called')
})

test('2113 a response that is NOT a 401 announces nothing', async () => {
  const seen: number[] = []
  const stop = onSessionEnded(() => seen.push(1))
  try {
    // EVERY OTHER REFUSAL, not a token one: an announcement on any of these would blank the whole app
    // over a failure the reader can act on where they are.
    for (const [status, body] of [[403, { error: 'no' }], [404, { error: 'not_found' }], [429, {}], [500, { error: 'boom' }], [200, { runs: [] }]] as const) {
      await withFetch(status, body, () => api.runs('aurora'))
    }
    assert.deepEqual(seen, [], 'a status other than 401 told the shell the session had ended')
  } finally {
    stop()
  }
})
