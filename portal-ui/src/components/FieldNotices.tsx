// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// What the form did with what you typed, said out loud.
//
// ONE COMPONENT, TWO FORMS, and that is the whole reason it is a file rather than a block inside
// Profile.tsx. The brand profile page and the project overlay render the SAME field specs
// (profileFields.ts projectFields()), so a notice written into one screen reaches one form and the
// other keeps dropping `99` in silence — which is the defect this closes, reappearing on the page
// nobody looked at. The rule the contract file states for hints holds for the thing that makes a hint
// true as well: it belongs where both readers get it.
//
// IT RENDERS NOTHING WHEN THERE IS NOTHING TO SAY. A form that always carries a status line trains
// people to stop reading it, and the one message that mattered arrives in furniture they have learned
// to skip.
import type { FieldNotice } from '../contract/profileFields.ts'

/**
 * `dropped` is the one that lost data, so it is the one that reads as a problem rather than a note.
 *
 * THE PRODUCT'S OWN TOKENS, not invented ones. A first cut named two danger/warning custom properties
 * this UI does not define, each with a literal hex fallback — so they would have rendered plausibly
 * while resolving to nothing, for as long as nobody looked. The arm that checks every custom property
 * the UI mentions caught it, and it reads COMMENTS too: naming the invented ones here, even to explain
 * the mistake, re-fails it. Hence this sentence describes them instead of spelling them.
 * `--tone-high` and `--tone-medium` are the same two the rest of the portal already uses to say
 * "wrong" and "worth a look".
 */
const TONE = {
  dropped: { color: 'var(--tone-high)', weight: 600 },
  check: { color: 'var(--tone-medium)', weight: 600 },
  reshaped: { color: 'var(--text-muted)', weight: 400 },
} as const

export function FieldNotices({ notices }: { readonly notices: readonly FieldNotice[] }) {
  if (!notices.length) return null
  return (
    <div style={{ marginTop: 5 }}>
      {notices.map((n, i) => (
        <div
          key={`${n.tone}-${i}`}
          // `role="status"` rather than `alert`: this is the consequence of typing, announced when the
          // user pauses, not an interruption. An alert on every keystroke is unusable with a screen
          // reader on a field whose whole job is a multi-line list.
          role="status"
          style={{ fontSize: 12.5, lineHeight: 1.45, color: TONE[n.tone].color, fontWeight: TONE[n.tone].weight }}
        >
          {n.message}
        </div>
      ))}
    </div>
  )
}
