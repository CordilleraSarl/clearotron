// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Generic, one per organisation — and the one place the portal turns that into what the wire carries.
//
// Generic is where a clearance runs when no company is set up, and it belongs to the organisation it was
// started in: two organisations on one installation each have their own, and neither sees the other's.
// On the wire that is a PAIR — the account `generic` beside the organisation it belongs to, as
// `tenant` — because the account key cannot move: every delivered report link and every run on disk
// already carries it.
//
// The portal needs ONE value per row, though. The switcher, the pick panel, the chips and every screen
// hold "the company in view" as a single string, and threading a second value through every one of them
// would be a change to thirty call sites for the sake of one row kind. So a Generic row is held as a
// single key naming both halves, and it is split back into the pair in exactly one place, on the way out.
// Nothing outside this file builds or parses that key.

/** The house account's key, as the wire and every run on disk spell it. */
export const GENERIC_ACCOUNT = 'generic'

// A colon cannot occur in an account key — they are slugs — so a key carrying one is unambiguous.
const SEP = ':'
const PREFIX = GENERIC_ACCOUNT + SEP

/** The key the portal holds for one organisation's Generic. Never sent as it stands: see `wireAccount`. */
export const genericFor = (org: string): string => PREFIX + org

/** True for Generic in either spelling: the bare account a run row carries, or one organisation's. */
export const isGenericKey = (key: string): boolean => key === GENERIC_ACCOUNT || key.startsWith(PREFIX)

/** The organisation a Generic key names; null for the bare key and for every company. */
export const orgOfGeneric = (key: string): string | null =>
  key.startsWith(PREFIX) && key.length > PREFIX.length ? key.slice(PREFIX.length) : null

/**
 * What goes on the wire for a key the portal holds: the pair for one organisation's Generic, the key
 * alone for anything else. A company needs no organisation beside it — it belongs to exactly one.
 */
export function wireAccount(key: string): { readonly account: string; readonly tenant?: string } {
  const org = orgOfGeneric(key)
  return org ? { account: GENERIC_ACCOUNT, tenant: org } : { account: key }
}

/**
 * The key a run belongs under, spelled the way the switcher holds it: a company's own key, or — for a run
 * with no company set up — the key naming its organisation's Generic.
 *
 * Every screen that asks "is this run the company in view" asks it through here. Comparing a run's bare
 * `account` with the key in view would never match one organisation's Generic, and that organisation's
 * runs would vanish from its own list without an error. A Generic run filed before organisations were
 * recorded carries none, stays under the bare key, and so appears under "All companies" and under no
 * organisation's Generic — unplaced rather than placed by a guess.
 */
export function runKey(run: { readonly account: string; readonly organisation?: string | null }): string {
  return isGenericKey(run.account) && run.organisation ? genericFor(run.organisation) : run.account
}
