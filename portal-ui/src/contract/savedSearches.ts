// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Reading a saved search — the parts of the Saved searches screen that are decisions rather than markup.
//
// Same reason as compose.ts: the test runner executes .ts and not .tsx, so anything that stays inside the
// component is anything that cannot be tested. What lands here is the small pile of judgement calls this
// screen makes — which human label a saved search builds on, whether it can be used at all, and what
// order the list comes out in — because each of those has a wrong answer that looks perfectly fine in a
// browser.
//
// THE NAMING RULE THAT SHAPES THIS FILE: a saved search is displayed by its `label`, never by its `name`
// and never by its slug. `name` is a profile key — the brand owner's legal identity — and the backend
// holds a tested disjointness invariant between the recipe key set and the profile key set precisely so
// the two can never be confused. Nothing here may erode that from the browser side by printing one where
// the other belongs.

import type { Product, SavedSearchListing } from './api.ts'

/**
 * One saved search as the wire sends it.
 *
 * Derived from the decoded types rather than re-declared, so a field dropped from a listing endpoint is
 * a compile error here instead of a second, quietly diverging definition of the same record. It points
 * at the SHARED listing shape, not at one endpoint's row: the composer's depth menu carries gate fields
 * (`caseLaw`) the config list has no reason to send, and nothing in this file reads them.
 */
export type SavedSearch = SavedSearchListing

/**
 * What a saved search's base level currently means for it.
 *
 * Three outcomes, not two, and the third is the one worth having:
 *
 *   ready       — the base level resolves and is switched on for this deployment.
 *   unavailable — the base level resolves but cannot run right now. `note` is the SERVER's wording for
 *                 why; it is written for a client and never names an internal switch.
 *   unknownBase — the base level does not appear in the registry at all. Stored recipe config can drift
 *                 past the level registry (the engine calls this out by name: a recipe base that "drifted
 *                 past the registry"), and when it has, we genuinely do not know what this saved search
 *                 builds on. Saying so is the only honest option.
 */
export type SavedSearchStatus =
  | { readonly kind: 'ready'; readonly name: string; readonly stageLabel: string }
  | { readonly kind: 'unavailable'; readonly name: string; readonly stageLabel: string; readonly note: string | null }
  | { readonly kind: 'unknownBase' }

/**
 * Resolve a saved search's base level against the registry the server just sent.
 *
 * The returned label is always the level's own, off the registry — and NEVER the `base` key. `name` is
 * what the row leads with and `stage` rides beside it (owner ruling 2026-07-20); `stageLabel` stays for
 * an older server that sends no name. That is the same report-identity rule the engine enforces on its own side: the stage label
 * is the only name for this thing a client has ever been shown, and a key like the one stored in config
 * is an internal selector that happens to be a readable word. The tempting one-liner here is
 * `level?.stageLabel ?? recipe.base`, and it is wrong in exactly the case it is reached in: the fallback
 * fires only when the level is unknown, so the ONLY time it would print the raw key is the one time
 * nothing has vetted that key as fit to show anyone.
 */
export function statusFor(recipe: SavedSearch, levels: readonly Product[]): SavedSearchStatus {
  const level = levels.find((l) => l.key === recipe.base)
  if (!level) return { kind: 'unknownBase' }
  const named = { name: level.name || level.stageLabel, stageLabel: level.stageLabel }
  if (!level.available) return { kind: 'unavailable', ...named, note: level.unavailableNote }
  return { kind: 'ready', ...named }
}

/**
 * Whether this saved search is usable as it stands.
 *
 * Deliberately narrow: it answers "does the level underneath this still work", which is the only part of
 * the question this screen can observe. It is NOT a prediction that a run would be accepted — the engine
 * gates a saved-search run on more than the base level, and the listing endpoint reports none of that.
 * A UI that promised more than it could see would be wrong at the worst moment, at the point of spend.
 */
export function isUsable(status: SavedSearchStatus): boolean {
  return status.kind === 'ready'
}

/**
 * What to print as the saved search's name.
 *
 * A label is customer-composed and the decoder defaults a missing one to the empty string, so a blank is
 * reachable. It renders as a plain placeholder rather than falling back to the slug: the slug is the
 * stored key half of `account/slug`, and substituting a key for a label whenever the label is empty is
 * how a key ends up in front of a client — the same substitution `statusFor` refuses for the base level.
 */
export function displayLabel(recipe: SavedSearch): string {
  const label = recipe.label.trim()
  return label || 'Untitled custom search'
}

/**
 * The version, as a short badge, or null when there is nothing to say.
 *
 * A null version is NOT rendered as "v1". The engine reads an absent version as 1 for its own hashing,
 * but that is an internal convention for comparing two copies of a record, not a claim about the record's
 * history. Printing "v1" at a client asserts a version was assigned when none ever was, and it makes an
 * un-versioned saved search and a first-version one indistinguishable on screen — which is precisely the
 * distinction someone reading this column is trying to make.
 */
export function versionLabel(recipe: SavedSearch): string | null {
  return recipe.version === null ? null : `v${recipe.version}`
}

/**
 * The list order.
 *
 * Alphabetical by label, case-insensitive, and NOT re-ordered by status. Sorting the unusable ones to one
 * end is the obvious idea and it is the wrong one twice over: it moves a saved search away from where its
 * owner expects to find it by name, and it does so on a condition — a deployment switch — that changes
 * under them without anything they did. The status is already stated on every row, so the ordering does
 * not need to carry it as well.
 *
 * The slug breaks ties. Labels are free text and carry no uniqueness constraint (the slug is the key), so
 * two saved searches really can share one, and without a tiebreak the list would shuffle between renders.
 */
// Generic over the row, because the screen lists the CONFIG shape (which carries `archived` and
// `updatedAt`) while the composer's depth menu sends the thin one. Pinning the parameter to `SavedSearch`
// sorted the richer rows and handed back the poorer type, silently dropping the retired flag the list is
// drawn from.
export function sortSavedSearches<T extends SavedSearch>(recipes: readonly T[]): readonly T[] {
  return [...recipes].sort((a, b) => {
    const byLabel = displayLabel(a).localeCompare(displayLabel(b), undefined, { sensitivity: 'base' })
    return byLabel !== 0 ? byLabel : a.slug.localeCompare(b.slug)
  })
}
