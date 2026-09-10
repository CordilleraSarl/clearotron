// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The words a person's permissions and access are printed in — once, for every screen that prints them.
//
// Three places say what someone may do: the People list, the avatar menu, and Your preferences. They
// used to say it with role nouns — "<operator> staff", "Client" — and the product prints no role nouns
// now: "admin" and "viewer" are conversation shorthand, never labels. What a screen can truthfully say
// is which of the two switches are on, so that is what this prints, in the same words in all three
// places. Separate from the screens so the phrasing can be driven, not matched as source text.

import type { AccessPoint, Permissions } from '../contract/api.ts'

/**
 * "Runs clearances · Manages", "Runs clearances", "Manages", or "View reports".
 *
 * The last is not "None". Both switches off is not a person who can do nothing — it is the view-only
 * person, who reads every report inside their access — and a label saying "none" would read as a
 * broken or revoked account to the person it describes.
 */
export function permissionsPhrase(p: Permissions): string {
  const on = [p.run ? 'Runs clearances' : null, p.manage ? 'Manages' : null].filter((w): w is string => w !== null)
  return on.length ? on.join(' · ') : 'View reports'
}

/**
 * The chips under "Access to", in the order a reader should meet them: the root first, then
 * organisations, then single companies. A company given on its own is the narrowest grant and reads
 * last, beside the organisations it sits outside of.
 */
export function accessChips(points: readonly AccessPoint[]): readonly { readonly key: string; readonly label: string; readonly top: boolean }[] {
  const rank = { everything: 0, organisation: 1, company: 2 } as const
  return [...points]
    .sort((a, b) => rank[a.kind] - rank[b.kind])
    .map((a) => ({ key: `${a.kind}:${a.key}`, label: a.kind === 'everything' ? 'Everything' : a.name, top: a.kind === 'everything' }))
}
