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
