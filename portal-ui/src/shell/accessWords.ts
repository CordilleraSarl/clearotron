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

/** "A", "A and B", "A, B and C" — the list form every sentence here uses. */
const joinWords = (words: readonly string[]): string =>
  words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`

/**
 * What a new person will and will not see, in words, before anything is saved.
 *
 * Built from what the form holds, never from what the server will answer: it is the adder's check on
 * their own choices, read while they can still change them. The subject is the address typed, because
 * that is all the form knows about the person — and the pronoun after it is "they", never one guessed
 * from a name.
 */
export function accessSentence(input: {
  readonly who: string
  readonly permissions: Permissions
  readonly everything: boolean
  /** Organisations picked whole, by name. */
  readonly organisations: readonly string[]
  /** Companies picked on their own, each with the name of the organisation it sits in. */
  readonly companies: readonly { readonly name: string; readonly organisation: string }[]
}): string {
  // The address typed, or "this person" before one is — capitalised only where it opens a sentence.
  const typed = input.who.trim()
  const who = typed || 'This person'
  const { run, manage } = input.permissions
  const can = run && manage ? 'can run clearances and add companies and people there'
    : run ? 'can run clearances there'
      : manage ? 'can add companies and people there'
        : 'can read every report there'

  const places = input.everything
    ? 'everything on this Clearotron, including organisations added later'
    : input.organisations.length || input.companies.length
      ? `everything ${joinWords([...input.organisations, ...input.companies.map((c) => c.name)].map((p) => `under ${p}`))}`
      : null
  if (!places) return `Choose what ${typed || 'this person'} can see.`

  // The organisations only PART of which was given: the person sees the chosen companies there and none
  // of the organisation's other clearances, which is the one thing a reader is most likely to assume wrong.
  const partial = input.everything ? [] : [...new Set(input.companies.map((c) => c.organisation))]
    .filter((o) => !input.organisations.includes(o))
  const cannot = !run && !manage ? 'cannot start clearances or add companies or people'
    : !run ? 'cannot start clearances'
      : !manage ? 'cannot add companies or people'
        : null
  const limits = [partial.length ? `will not see any other ${joinWords(partial)} clearances` : null, cannot]
    .filter((w): w is string => w !== null)

  const first = `${who} will see ${places}, and ${can}.`
  return limits.length ? `${first} They ${limits.join(', and ')}.` : first
}
