// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// WHICH companies the pick panel offers, and in what order — the panel's decisions, without its markup.
//
// Separate from `CompanyPicker.tsx` so these can be DRIVEN rather than read as source text. The suite
// runner loads .ts and not .tsx, so logic left beside the JSX can only ever be asserted by matching the
// file's own characters — which passes just as happily on a rule that has been commented out.

import { sortOwners } from '../contract/ownerNames.ts'
import { companyFactsLine, type CompanyFacts } from '../contract/companyFacts.ts'
import type { Role } from '../contract/api.ts'

/** The house account. Named once here; every other reference to it in this file goes through this. */
export const GENERIC_KEY = 'generic'

/** Generic carries a fixed line, not a facts line: it has no industry and no territories to state. */
const GENERIC_LINE = 'Run any clearance against the default settings.'

export type CompanyRow = {
  readonly key: string
  readonly name: string
  readonly line: string
  readonly generic: boolean
}

/**
 * The rows to offer, in the order they are read.
 *
 * Generic leads — it is the one entry every install has and the one a person can always run under.
 * The rest sort by DISPLAY NAME, the same rule the rail switcher uses, so the two agree.
 *
 * GENERIC IS STAFF-ONLY, and that is an engine boundary rather than a preference: `portal-service.mjs`
 * answers 404 to a non-staff principal on the runs list, the three report and artefact routes and the
 * flag route, and strips it from a client's own account list ("the house account is staff-only,
 * everywhere"). Offering it to a client here would seat them on a company whose every page then refuses
 * them — the offered-by-the-portal, refused-by-the-engine shape this screen exists to end.
 */
/**
 * The order companies are offered in, wherever they are offered.
 *
 * ONE ORDER, because there were two and they disagreed on the ordinary install. The pick panel and the
 * chips lift Generic to the front — it is the default, and a default that sorts alphabetically among the
 * companies is a default nobody finds. The rail's switcher sorted every key by display name, so on an
 * install holding the house account and one company called "Acme Ltd" the rail read *All companies, Acme
 * Ltd, Generic default* while the panel beside it read *Generic default, Acme Ltd*. Same install, two
 * orders, on adjacent controls.
 *
 * Takes the same role test as the panel, so the one place Generic is withheld is the one place it is
 * ordered.
 */
export function orderedCompanyKeys(
  keys: readonly string[],
  companyName: (key: string | null) => string,
  role: Role,
): readonly string[] {
  const others = keys.filter((k) => k !== GENERIC_KEY)
  const named = sortOwners(Object.fromEntries(others.map((k) => [k, companyName(k)])), others).map((o) => o.key)
  return role === 'staff' && keys.includes(GENERIC_KEY) ? [GENERIC_KEY, ...named] : named
}

export function pickerRows(
  keys: readonly string[],
  companyName: (key: string | null) => string,
  factsFor: (key: string) => CompanyFacts | undefined,
  role: Role,
): readonly CompanyRow[] {
  const others = keys.filter((k) => k !== GENERIC_KEY)
  const named = sortOwners(Object.fromEntries(others.map((k) => [k, companyName(k)])), others)
  const rows: CompanyRow[] = named.map((o) => ({
    key: o.key,
    name: o.name,
    line: companyFactsLine(factsFor(o.key)),
    generic: false,
  }))
  if (role === 'staff' && keys.includes(GENERIC_KEY)) {
    rows.unshift({ key: GENERIC_KEY, name: companyName(GENERIC_KEY), line: GENERIC_LINE, generic: true })
  }
  return rows
}
