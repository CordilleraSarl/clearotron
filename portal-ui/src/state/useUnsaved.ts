// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The one line a screen with an editable form adds.
//
// `useUnsaved(dirty)` — pass the same flag that enables the Save button. Nothing else to remember, no
// cleanup to get right, and no second definition of "dirty" to drift from the one already on screen.

import { useEffect, useRef } from 'react'
import { registerGuard } from './guard.ts'

export function useUnsaved(dirty: boolean): void {
  // Read through a ref so the registration survives every keystroke: registering a fresh closure on each
  // change would churn the Set on every character typed, and a mid-change unregister is a window in
  // which the guard silently answers "nothing to lose".
  const ref = useRef(dirty)
  ref.current = dirty
  useEffect(() => registerGuard(() => ref.current), [])
}

/**
 * Is there anything here a reader would be sorry to lose?
 *
 * ── THE WARNING USED TO FIRE ON WORK THAT WAS ALREADY SAVED ─────────────────────────────────────────
 *
 * The composer compared its draft against the EMPTY draft and nothing else. Nothing reset that
 * comparison, so a successful save left the form still counting as dirty: someone saved their search,
 * navigated away, and was warned they were about to lose it. They came back expecting to find nothing
 * and found it there after all. A guard that cries wolf on saved work teaches people to click through
 * every warning it ever shows, including the one that is true.
 *
 * The missing term is a BASELINE — what the form looked like the last time it was written down. Dirty
 * is then "different from empty, and different from what was saved", which is what the words mean.
 *
 * PURE, and comparing serialised forms rather than objects, because the caller holds a draft that is
 * rebuilt on every keystroke and reference equality would report every form as dirty forever.
 *
 * @param current    the draft as it stands, serialised
 * @param empty      a pristine draft, serialised — a fresh composer has no baseline but this
 * @param saved      what was last written down, serialised, or null if nothing has been
 * @param submitted  true once the search has been sent; there is nothing left to lose after that
 */
export function unsavedChanges(
  { current, empty, saved, submitted }:
  { readonly current: string; readonly empty: string; readonly saved: string | null; readonly submitted: boolean },
): boolean {
  if (submitted) return false
  if (current === empty) return false
  return current !== saved
}
