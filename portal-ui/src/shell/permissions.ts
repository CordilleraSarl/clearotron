// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// What a person is allowed to DO, asked by name — and the one place the answer is derived.
//
// The product is moving from two role words to two permissions held per person: running clearances, and
// managing (adding people, adding companies, changing settings). The permissions are the durable idea;
// the role word is the thing on its way out.
//
// So the derivation lives here, alone, and screens ask the permission. Today the wire carries no switch
// and the whole of Manage is "this identity is staff", which makes this file look like ceremony around a
// one-line test. It is not: the value is that the CALL SITES already ask the right question. When the
// wire starts carrying the switches, this file changes and nothing that reads it does.
//
// Separate from `CompanyPicker.tsx` for the reason `companyRows.ts` gives: the suite runner loads .ts and
// not .tsx, so a rule left beside the JSX can only be asserted by matching the file's own characters —
// which passes just as happily on a rule that has been commented out. A rule here can be driven.
//
// Only Manage is here. Run-clearances has no call site yet, and a permission with no caller is a claim
// about a future shape rather than a rule the product enforces.

import type { Role } from '../contract/api.ts'

/**
 * May this person add companies, add people and change settings?
 *
 * The single derivation. Everything that gates on Manage reads this, so there is one answer per person
 * rather than one per screen — which is how the same person comes to be offered a control on one screen
 * and refused it on the next.
 *
 * Takes the narrowest shape that answers the question rather than the whole identity, so a caller holding
 * a partial `me` can still ask, and so widening the derivation later cannot silently widen what a caller
 * had to have in hand to ask it.
 */
export function canManage(who: { readonly role: Role }): boolean {
  return who.role === 'staff'
}
