// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The browser tab's title, and the count at its front of searches that finished while the tab was out of view.
//
// A clearance runs 1.5 to 2.5 hours and nobody watches it. The delivery notice still goes out; this is the
// sign for the person who left the portal open in another tab (board TabTitle, approved 2026-11-25). The
// count goes the moment the tab is looked at, and with the tab in view the title never carries one.

import type { Run, RunState } from './api.ts'

/** The states a search ends in: delivered, or stopped without finishing. */
export const ENDED: ReadonlySet<RunState> = new Set<RunState>(['delivered', 'failed', 'cancelled'])

/**
 * HOW OFTEN A HIDDEN TAB ASKS, and only while one of this person's searches is in flight: once a minute,
 * against a request limit of 120 a minute per person and a run of hours. In view the portal asks every 5 s
 * while something is in flight, so a hidden tab never asks at that rate.
 */
export const HIDDEN_POLL_MS = 60_000

/**
 * How many searches ended between two readings: in flight in `before` (queued, running or paused), and
 * ended in `now`. A search seen for the first time, or one that has left the list, is not counted: there is
 * nothing to say it ended while this tab was away. PURE.
 */
export function endedSince(before: ReadonlyMap<string, RunState>, now: readonly Run[]): number {
  let n = 0
  for (const r of now) {
    const was = before.get(r.runId)
    if (was !== undefined && !ENDED.has(was) && ENDED.has(r.state)) n++
  }
  return n
}

/** The reading `endedSince` compares against next: each search's state, by its id. PURE. */
export const statesOf = (runs: readonly Run[]): ReadonlyMap<string, RunState> => new Map(runs.map((r) => [r.runId, r.state]))

/** Whether anything in a reading could still end. PURE. */
export const anyInFlight = (states: ReadonlyMap<string, RunState>): boolean => [...states.values()].some((s) => !ENDED.has(s))

/**
 * The tab's title: the installation's own name, and the count in brackets at the front while there is one —
 * "(1) Clearotron · Trademark clearance". The count is the only new text. PURE.
 */
export function tabTitle(name: string, count: number): string {
  const base = `${name} · Trademark clearance`
  return count > 0 ? `(${count}) ${base}` : base
}
