// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// WHICH companies the pick panel and the rail switcher offer, in what order, and under which
// organisation — the decisions, without the markup.
//
// Separate from `CompanyPicker.tsx` so these can be DRIVEN rather than read as source text. The suite
// runner loads .ts and not .tsx, so logic left beside the JSX can only ever be asserted by matching the
// file's own characters — which passes just as happily on a rule that has been commented out.

import { sortOwners } from '../contract/ownerNames.ts'
import { companyFactsLine, type CompanyFacts } from '../contract/companyFacts.ts'
import type { Organisation } from '../contract/api.ts'
import { GENERIC_ACCOUNT, genericFor, isGenericKey } from '../contract/genericKey.ts'

/** The house account's bare key. Every test for Generic in this file goes through `isGenericKey`. */
export const GENERIC_KEY = GENERIC_ACCOUNT

/**
 * WHICH companies the switcher offers — the one list the shell hands the pick panel, the rail and every
 * screen.
 *
 * The companies this person may act for (every key on the roster, for someone who sees the whole install;
 * their own grants otherwise), then one Generic per organisation. The roster's own `generic` is dropped:
 * it names the house account, not any organisation's, and offering it would send a request the door has
 * to guess the organisation for. The server's `genericOrgs` is the whole answer to which Generics this
 * person is offered, each held as one key naming its organisation (contract/genericKey.ts).
 *
 * Here rather than inline in the shell so it can be DRIVEN against what a real portal serves: the demo's
 * arm boots the demo and asks this function what its switcher lists.
 */
export function switcherKeys(
  me: { readonly allAccounts: boolean; readonly accounts: readonly string[]; readonly genericOrgs: readonly string[] },
  roster: readonly { readonly key: string }[] | null,
): readonly string[] {
  const companyKeys = me.allAccounts ? (roster ?? []).map((c) => c.key) : me.accounts
  return [...companyKeys.filter((k) => !isGenericKey(k)), ...me.genericOrgs.map(genericFor)]
}

/** Generic carries a fixed line, not a facts line: it has no industry and no territories to state. */
const GENERIC_LINE = 'Run any clearance against the default settings, with no company set up.'

export type CompanyRow = {
  readonly key: string
  readonly name: string
  readonly line: string
  /** True for Generic — the row that carries the Default tag, wherever the row is drawn. */
  readonly generic: boolean
}

/**
 * One organisation's rows. `org` is null for companies the server stated no organisation for; they are
 * drawn under no heading rather than under a guessed one.
 */
export type CompanyGroup = { readonly org: Organisation | null; readonly rows: readonly CompanyRow[] }

/**
 * The rows, grouped by organisation, and whether the headings are shown at all.
 *
 * ── HEADINGS ONLY FOR A PERSON WHO CAN SEE MORE THAN ONE ORGANISATION ─────────────────────────────
 *
 * A heading answers "which organisation is this company in", and for a person who can see one there is
 * no question: the heading would name the one thing they always see, above every list, forever. So the
 * grouping is always COMPUTED and only sometimes SHOWN — `headings` is the switch, and it keys on how
 * many organisations the person can see, not on how many groups happen to have rows. A person with
 * access to one company never meets a heading.
 *
 * ── GENERIC IS OFFERED TO WHOEVER MAY SEE ITS ORGANISATION'S ─────────────────────────────────────
 *
 * It used to be withheld from every non-staff reader, because the engine refused the house account to
 * them at several points and a menu whose first item always fails is a defect. Under the tree it
 * belongs to its organisation: a clearance run with no company set up is filed inside the organisation
 * it was started in, and each organisation has its own. So there is one Generic row per organisation the
 * person may see Generic in — the shell builds those keys from the server's list, never from the roster —
 * and each LEADS its group: it is the default, and a default that sorts alphabetically among the
 * companies is a default nobody finds.
 *
 * ── ORDER ─────────────────────────────────────────────────────────────────────────────────────────
 *
 * Groups follow the order the server lists `organisations` in. Which organisation a person meets first
 * is a fact about their place on the tree — their own before one they were given a single company in —
 * and the server holds the tree; re-sorting it here by name would put a stranger's organisation above
 * the reader's own. Inside a group, Generic first, then the rest by display name — the same rule the
 * rail switcher uses, from this same function, so the two cannot disagree.
 */
export function pickerGroups(
  keys: readonly string[],
  orgOf: (key: string) => string | null,
  organisations: readonly Organisation[],
  companyName: (key: string | null) => string,
  factsFor: (key: string) => CompanyFacts | undefined,
): { readonly headings: boolean; readonly groups: readonly CompanyGroup[] } {
  const rowFor = (key: string): CompanyRow =>
    isGenericKey(key)
      // Named plainly: every list drawn from these rows either heads them by organisation or shows one
      // organisation only, so the organisation is already on screen beside the name.
      ? { key, name: companyName(GENERIC_KEY), line: GENERIC_LINE, generic: true }
      : { key, name: companyName(key), line: companyFactsLine(factsFor(key)), generic: false }

  // Generic leads its group. There is at most one per group — one organisation, one Generic — held under
  // the key that names its organisation, so the test is by kind and never by spelling.
  const ordered = (members: readonly string[]): CompanyRow[] => {
    const generics = members.filter(isGenericKey)
    const others = members.filter((k) => !isGenericKey(k))
    const named = sortOwners(Object.fromEntries(others.map((k) => [k, companyName(k)])), others).map((o) => o.key)
    return [...generics, ...named].map(rowFor)
  }

  const known = new Set(organisations.map((o) => o.key))
  const groups: CompanyGroup[] = organisations
    .map((org) => ({ org, rows: ordered(keys.filter((k) => orgOf(k) === org.key)) }))
    .filter((g) => g.rows.length > 0)
  // Anything the server placed nowhere — or placed in an organisation it did not list — still gets a
  // row. Dropping it would make a company the person can see unselectable, which is the failure the
  // roster's own key list exists to prevent; filing it under a heading would be a guess.
  const stray = keys.filter((k) => { const o = orgOf(k); return o === null || !known.has(o) })
  if (stray.length) groups.push({ org: null, rows: ordered(stray) })

  return { headings: organisations.length > 1, groups }
}

/** The same rows, flat, for a caller that draws no headings of its own. One order, from one place. */
export function pickerRows(
  keys: readonly string[],
  orgOf: (key: string) => string | null,
  organisations: readonly Organisation[],
  companyName: (key: string | null) => string,
  factsFor: (key: string) => CompanyFacts | undefined,
): readonly CompanyRow[] {
  return pickerGroups(keys, orgOf, organisations, companyName, factsFor).groups.flatMap((g) => g.rows)
}

/**
 * What the rail switcher prints for one row. That switcher is a native select, whose options hold text
 * only, so Generic's Default tag is the word after its name there, where the pick panel draws a pill.
 * Every other row prints its name alone.
 */
export function switcherLabel(row: CompanyRow): string {
  return row.generic ? `${row.name} (Default)` : row.name
}
