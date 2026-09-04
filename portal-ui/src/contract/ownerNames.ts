// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// What a brand owner is CALLED, as against what it is keyed by.
//
// The portal is keyed by slug (`vantor`) and read by people ("Vantor Labs"). Those are two
// different strings for one entity, and for a long time the app resolved the second one in exactly one
// place — the sidebar switcher — and only for staff, because the names came from the staff-only roster.
// A client, whose own company it is, had no name source at all and read the slug everywhere. So the
// same brand owner appeared as "Aurora Interactive" in the rail and "aurora" in the heading beside it,
// and differently again depending on who had signed in.
//
// This module is that resolution, once, as data:
//
//   • TWO SOURCES, ONE MAP. A client's granted accounts arrive named on `/portal/api/me`; staff reach
//     every customer and take theirs from `/portal/admin/roster`. Neither is per-screen, so neither is
//     consulted per-screen.
//   • THE FALLBACK IS THE KEY, never a blank and never a guess. A name we do not have is a cosmetic
//     gap; an empty label where a brand owner should be is a broken screen. Nothing here titlecases or
//     de-slugs a key — "vantor" → "Vantor Labs" is a guess, and the profile store already knows
//     the answer, so guessing would be inventing a client's name.

/** The "no particular brand owner" view. One string, so the switcher and every label agree on it. */
export const ALL_OWNERS = 'All brand owners'

export type OwnerNames = Readonly<Record<string, string>>

/**
 * Merge the two name sources into one map.
 *
 * Roster entries win where both carry a key, which only happens for a staff identity — and there the
 * roster is the fuller answer by construction. An entry with an empty name is dropped rather than
 * stored, so a lookup miss and a blank name behave identically: both fall back to the key.
 */
export function ownerNameMap(
  granted: OwnerNames,
  roster: readonly { readonly key: string; readonly name: string }[],
): OwnerNames {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(granted)) if (k && v) out[k] = v
  for (const c of roster) if (c.key && c.name) out[c.key] = c.name
  return out
}

/** A brand owner's display name. `null` is the all-owners view; an unknown key reads as itself. */
export const ownerNameFrom = (names: OwnerNames, key: string | null): string =>
  key ? (names[key] ?? key) : ALL_OWNERS

/**
 * Owners in the order a person can predict.
 *
 * By what is READ, not by what is stored: a menu ordered by slug files "Vantor Labs" under `o` and
 * "Aurora Interactive" under `a` and agrees with the eye only by luck.
 */
export const sortOwners = (
  names: OwnerNames,
  keys: readonly string[],
): readonly { readonly key: string; readonly name: string }[] =>
  keys.map((k) => ({ key: k, name: ownerNameFrom(names, k) }))
    .sort((a, b) => a.name.localeCompare(b.name))
