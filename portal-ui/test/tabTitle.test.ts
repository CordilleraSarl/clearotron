// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The tab's title leads with a count of searches that ended while the tab was out of view (board TabTitle,
// approved 2026-11-25). The count is the only new text, and it goes the moment the tab is looked at.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ENDED, HIDDEN_POLL_MS, anyInFlight, endedSince, statesOf, tabTitle } from '../src/contract/tabTitle.ts'
import type { Run, RunState } from '../src/contract/api.ts'

const run = (runId: string, state: RunState) => ({ runId, state }) as unknown as Run

test('the title leads with the count in brackets, and carries none at nothing', () => {
  assert.equal(tabTitle('Clearotron', 0), 'Clearotron · Trademark clearance')
  assert.equal(tabTitle('Clearotron', 1), '(1) Clearotron · Trademark clearance')
  assert.equal(tabTitle('Example Firm', 3), '(3) Example Firm · Trademark clearance', 'the installation\'s own name still leads the rest')
})

test('a search counts once it ends, delivered or stopped, after being in flight in the last reading', () => {
  const before = statesOf([run('a', 'running'), run('b', 'queued'), run('c', 'paused'), run('d', 'delivered'), run('e', 'running')])
  const now = [run('a', 'delivered'), run('b', 'cancelled'), run('c', 'failed'), run('d', 'delivered'), run('e', 'running'), run('f', 'delivered')]
  assert.equal(endedSince(before, now), 3, 'delivered, stopped and failed each count; one already ended, one still running and one never seen do not')
  assert.equal(endedSince(statesOf(now), now), 0, 'nothing ended between two equal readings')
  assert.deepEqual([...ENDED].sort(), ['cancelled', 'delivered', 'failed'])
})

test('a hidden tab keeps asking only while something is in flight, at a slow rate', () => {
  assert.equal(anyInFlight(statesOf([run('a', 'delivered'), run('b', 'failed')])), false, 'nothing in flight, and the tab would keep asking')
  assert.equal(anyInFlight(statesOf([run('a', 'delivered'), run('b', 'queued')])), true)
  assert.ok(HIDDEN_POLL_MS >= 60_000, 'a hidden tab asks faster than once a minute')
  const poll = readFileSync(new URL('../src/state/useApi.ts', import.meta.url), 'utf8')
  assert.match(poll, /if \(r\.kind === 'rateLimited'\) timer = window\.setTimeout\(\(\) => \{ void read\(\) \}, BACKOFF_MS\)/, 'a refusal does not keep the back-off')
  assert.match(poll, /else setCount\(0\)/, 'the count outlives a look at the tab')
})
