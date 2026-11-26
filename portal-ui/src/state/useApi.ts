// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Data loading.
//
// The polling policy here is not a detail. portal-service rate-limits 120 requests/minute per EMAIL, and
// a staff member with several tabs open shares one budget across all of them. Three rules keep the list
// live without eating that budget:
//
//   • poll faster only while something is actually in flight (5s), slowly otherwise (30s)
//   • stop entirely when the tab is hidden — nobody is reading it
//   • back off hard on 429 rather than retrying into the limit that just rejected us
//
// Without the last one a rate-limited tab retries at the polling interval forever, holding itself over
// the limit and starving the tabs that are being looked at.

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, lastSeenRunStates, type Result, type RunState } from '../contract/api.ts'
import { HIDDEN_POLL_MS, anyInFlight, endedSince, statesOf } from '../contract/tabTitle.ts'

const ACTIVE_MS = 5_000
const IDLE_MS = 30_000
const BACKOFF_MS = 60_000

export type Load<T> = {
  readonly result: Result<T> | null
  readonly loading: boolean
  readonly reload: () => void
}

/**
 * Load once, and again whenever `deps` change.
 *
 * `fetcher` is captured per-call via a ref so a caller does not have to memoize it — forgetting a
 * useCallback would otherwise turn this into an infinite request loop, which is exactly the kind of
 * mistake that only shows up as a rate-limit in production.
 */
/**
 * A request started before React mounts anything, for the first screen to consume.
 *
 * WHY THIS EXISTS. The shell asks `/portal/api/me` and draws nothing but a frame until it answers; no
 * screen is mounted behind that frame, so the list a screen wants is not even REQUESTED until the
 * identity call has come back. The reader therefore waits for two round trips in series, and whatever
 * one costs is paid twice. Measured on a copy of the production store, the portal's own work on that
 * path is about 25 ms cold and under 10 ms warm — so almost all of that wait is the trips themselves.
 *
 * It is NOT an extra request. The screen consumes this answer instead of making its own, once, on its
 * first mount; a reload or a poll goes to the fetcher as it always did. The per-identity rate budget is
 * shared across a person's tabs, so a prefetch that ADDED a call would be paid for on every page load.
 *
 * Deliberately keyed and consumed ONCE. A second screen mounting later must ask for itself rather than
 * be handed an answer from before the shell knew who was signed in.
 */
const startedEarly = new Map<string, Promise<unknown>>()

export function startEarly<T>(key: string, fetcher: () => Promise<Result<T>>): void {
  if (!startedEarly.has(key)) startedEarly.set(key, fetcher())
}

/** The early answer for this key, if one is still waiting to be claimed. Claiming it removes it. */
function claimEarly<T>(key: string | undefined): Promise<Result<T>> | null {
  if (!key) return null
  const p = startedEarly.get(key)
  if (!p) return null
  startedEarly.delete(key)
  return p as Promise<Result<T>>
}

export function useLoad<T>(fetcher: () => Promise<Result<T>>, deps: readonly unknown[], early?: string): Load<T> {
  const [result, setResult] = useState<Result<T> | null>(null)
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  // A DEPS CHANGE IS A DIFFERENT QUESTION. A RELOAD IS THE SAME QUESTION ASKED AGAIN.
  //
  // That distinction is the whole fix. `result` used to survive both, so switching company left the
  // PREVIOUS owner's data fully painted for the entire in-flight window — every screen gates on `result`
  // and not on `loading`, so nothing indicated a fetch was even happening. The page had re-rendered and
  // re-fetched; it simply showed the wrong client until the answer came back. Read as "toggling the brand
  // does not refresh the page", which is exactly what it looks like.
  //
  // Clearing on EVERY effect run would have been the obvious fix and a worse bug: `nonce` drives the
  // 5-second poll, so every list in the app would blank itself twice a minute. So compare the deps
  // themselves, and clear only when they actually differ.
  const depsKey = JSON.stringify(deps)
  const seenKey = useRef<string | null>(null)

  useEffect(() => {
    let live = true
    // First mount has nothing to clear (`result` is already null) and must not be treated as a change.
    if (seenKey.current !== null && seenKey.current !== depsKey) setResult(null)
    seenKey.current = depsKey
    setLoading(true)
    // The early request, where one was started before this screen existed. Claimed once: a reload or a
    // poll runs the fetcher, so nothing downstream can be served an answer older than its own question.
    void (claimEarly<T>(early) ?? fetcherRef.current()).then((r) => {
      // A response that arrives after the account switched away must not overwrite the new one's data.
      if (!live) return
      setResult(r)
      setLoading(false)
    })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depsKey, nonce])

  return { result, loading, reload: useCallback(() => setNonce((n) => n + 1), []) }
}

/** True while the tab is visible. Polling stops when it is not. */
function useVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden')
  useEffect(() => {
    const on = () => setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  return visible
}

/**
 * Poll while the tab is visible.
 *
 * `active` says whether anything is in flight; it drives the interval. The caller decides that, because
 * only the caller knows what "in flight" means for its data.
 */
export function usePoll(reload: () => void, { active, rateLimited }: { active: boolean; rateLimited: boolean }): void {
  const visible = useVisible()
  const reloadRef = useRef(reload)
  reloadRef.current = reload

  useEffect(() => {
    if (!visible) return
    const ms = rateLimited ? BACKOFF_MS : active ? ACTIVE_MS : IDLE_MS
    const id = window.setInterval(() => reloadRef.current(), ms)
    return () => window.clearInterval(id)
  }, [visible, active, rateLimited])

  // A tab that was hidden for an hour would otherwise show stale data for up to 30s, so refresh when it
  // comes back. NOT on mount, though: useLoad already fetches there, and a visible-tab mount satisfies
  // this condition immediately — so without the guard every screen issued its first request twice, on a
  // 120/min budget shared across the user's tabs.
  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    if (visible) reloadRef.current()
  }, [visible])
}

/**
 * HOW MANY OF THIS PERSON'S SEARCHES ENDED WHILE THE TAB WAS OUT OF VIEW (board TabTitle, approved 2026-11-25).
 *
 * The one exception to "stop entirely when the tab is hidden", and kept as small as it can be. Going out of
 * view asks nothing: the first reading is the last answer the page already holds (`lastSeenRunStates`).
 * Then the tab asks once a minute, only while one of the searches is still in flight; with nothing in
 * flight it asks nothing at all. A page that has not read the person's searches yet asks once, a minute
 * after going out of view, for its first reading. A refusal for too many requests waits the visible poll's
 * back-off. The count goes back to nothing the moment the tab is looked at, and no request is made while it
 * is in view.
 *
 * `enabled` is false until the person is signed in: a sign-in page has nobody's searches to count.
 */
export function useEndedWhileHidden(enabled: boolean): number {
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!enabled) return
    let seen: ReadonlyMap<string, RunState> | null = null
    let timer: number | undefined
    let live = true
    const read = async () => {
      const r = await api.runsMine()
      if (!live || document.visibilityState !== 'hidden') return
      if (r.kind === 'ok') {
        if (seen) {
          const ended = endedSince(seen, r.value)
          if (ended) setCount((c) => c + ended)
        }
        seen = statesOf(r.value)
      }
      if (r.kind === 'rateLimited') timer = window.setTimeout(() => { void read() }, BACKOFF_MS)
      else if (seen && anyInFlight(seen)) timer = window.setTimeout(() => { void read() }, HIDDEN_POLL_MS)
    }
    const onVisibility = () => {
      window.clearTimeout(timer)
      seen = null
      if (document.visibilityState !== 'hidden') { setCount(0); return }
      seen = lastSeenRunStates()
      if (!seen || anyInFlight(seen)) timer = window.setTimeout(() => { void read() }, HIDDEN_POLL_MS)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      live = false
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [enabled])
  return count
}
