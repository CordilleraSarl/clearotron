// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// What a person is allowed to DO, asked by name — and the one place the answer is derived.
//
// Two permissions are held per person, as two switches: running clearances, and managing (adding
// people, adding companies, changing settings). Screens ask the permission; nothing anywhere asks a
// role word, because there is no longer one to ask. Viewing is not a permission — access is viewing,
// and both switches off is the view-only person, who reads the reports they were given and starts
// nothing.
//
// The derivation lives here, alone, so there is one answer per person rather than one per screen —
// which is how the same person comes to be offered a control on one screen and refused it on the next.
//
// Separate from `CompanyPicker.tsx` for the reason `companyRows.ts` gives: the suite runner loads .ts
// and not .tsx, so a rule left beside the JSX can only be asserted by matching the file's own
// characters — which passes just as happily on a rule that has been commented out. A rule here can be
// driven.

import type { Permissions } from '../contract/api.ts'

/**
 * The narrowest shape that answers either question.
 *
 * Both functions take this rather than the whole identity, so a caller holding a partial `me` can still
 * ask, and so widening a derivation later cannot silently widen what a caller had to have in hand to
 * ask it.
 */
type Who = { readonly permissions: Permissions }

/**
 * May this person add companies, add people and change settings?
 *
 * It is not a rank and grants no extra sight: Manage acts only inside what the person can already see,
 * so someone managing one organisation adds people and companies THERE and cannot reach another
 * organisation by holding it. The People page is gated on this; so is `+ New company`.
 */
export function canManage(who: Who): boolean {
  return who.permissions.manage
}

/**
 * May this person start and stop clearances?
 *
 * Gates the rail's New clearance entry, and it gates it by ABSENCE rather than by refusal: a control
 * that only ever says no is worse than no control. Someone without it still reaches every report for
 * every company they can see — that is what access already means — and the one thing they cannot do is
 * spend money.
 */
export function canRun(who: Who): boolean {
  return who.permissions.run
}
