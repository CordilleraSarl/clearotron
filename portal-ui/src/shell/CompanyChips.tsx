// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The company filter, on the two screens that span more than one company.
//
// ── ONE VALUE, THREE CONTROLS ───────────────────────────────────────────────────────────────────────
//
// The rail switcher, the Clearances chips and the Home chips are three renderings of ONE piece of state:
// `ctx.owner`. None of them holds a copy. A second value kept in step with the first is the defect this
// is written to avoid — it is how a screen comes to disagree with the rail it sits next to, and the
// disagreement is invisible until somebody notices the rows are wrong.
//
// The order comes from `pickerRows`, the same function the pick panel uses, so the chips and the panel
// cannot list the same install differently. `All companies` leads because it is the only entry that is
// not a company, and on Clearances it is a real answer rather than a placeholder: the archive spans
// everything, which is what makes this screen the one that needs the chip row at all.

import { pickerRows } from './companyRows.ts'
import { ALL_OWNERS } from '../contract/ownerNames.ts'
import type { CompanyFacts } from '../contract/companyFacts.ts'
import type { Organisation } from '../contract/api.ts'

export function CompanyChips({
  ctx,
  label,
}: {
  readonly ctx: {
    readonly ownerKeys: readonly string[]
    readonly orgOf: (key: string) => string | null
    readonly organisations: readonly Organisation[]
    readonly ownerName: (key: string | null) => string
    readonly factsFor: (key: string) => CompanyFacts | undefined
    readonly owner: string | null
    readonly setOwner: (owner: string | null) => void
  }
  readonly label: string
}) {
  const rows = pickerRows(ctx.ownerKeys, ctx.orgOf, ctx.organisations, ctx.ownerName, ctx.factsFor)

  // ONE COMPANY IS NOT A FILTER. With a single company on the install there is nothing to choose
  // between, the rail already opens on it, and a row of one chip beside "All companies" would offer a
  // distinction that does not exist. Same rule the pick panel follows, for the same reason.
  if (rows.length < 2) return null

  return (
    <div className="segmented" role="group" aria-label={label} style={{ flexWrap: 'wrap' }}>
      <button type="button" aria-pressed={ctx.owner === null} onClick={() => ctx.setOwner(null)}>
        {ALL_OWNERS}
      </button>
      {rows.map((r) => (
        // Named through the shell rather than off the row: chips have no organisation headings, so one
        // organisation's Generic has to say which organisation it is — which only the shell's name does.
        <button key={r.key} type="button" aria-pressed={ctx.owner === r.key} onClick={() => ctx.setOwner(r.key)}>
          {ctx.ownerName(r.key)}
        </button>
      ))}
    </div>
  )
}
