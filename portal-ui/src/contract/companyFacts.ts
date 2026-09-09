// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The one line that tells one company from another at a glance.
//
// ── WHY A MODULE AND NOT A TEMPLATE STRING IN THE PANEL ─────────────────────────────────────────────
//
// The line renders in three places — the pick panel, and eventually anywhere a company is offered — and
// it is composed from data that arrives by two different routes: staff read the roster, a client reads
// their own `/me`. Written out per surface, the same company reads two ways depending on who signed in,
// which is the defect `ownerNames.ts` exists to end for the NAME. This is that rule for the facts.
//
// ── WHAT IT LEAVES OUT, DELIBERATELY ────────────────────────────────────────────────────────────────
//
// An absent segment is DROPPED, never rendered empty. Generic default carries no industry and no
// territories, so it would otherwise read "· 3 marketplaces ·" with two bare separators. A company
// added through the browser with only a name is the same case, and it is the commonest one on a fresh
// install — the line has to survive a company that has told us almost nothing.

/** The three facts, as they arrive on the wire. `platformCount`, never the platform list. */
export type CompanyFacts = {
  readonly industry: string | null
  readonly platformCount: number
  readonly territories: readonly string[]
}

/**
 * Sector prose reads as a sentence, so it starts with a capital.
 *
 * Only a lowercase ASCII letter is touched, and only the first one. The stored values are sector
 * descriptions written lowercase ("animal health — veterinary pharmaceuticals", "gaming"), never
 * brand-cased strings, so there is no "iRobot" to corrupt here; anything already capitalised, quoted or
 * non-Latin is returned exactly as stored rather than guessed at.
 */
const sentenceCase = (s: string): string =>
  /^[a-z]/.test(s) ? s[0]!.toUpperCase() + s.slice(1) : s

/**
 * "Animal health · 6 marketplaces · US, EU, UK, AU" — as many of the three as the company has.
 *
 * The marketplace count is always shown, including zero: "0 marketplaces" is a true and useful thing to
 * read about a company nobody has configured yet, and dropping it would make an unconfigured company
 * look identical to a fully configured one whose industry we happen not to hold.
 */
export function companyFactsLine(facts: CompanyFacts | undefined): string {
  if (!facts) return ''
  const marketplaces = `${facts.platformCount} ${facts.platformCount === 1 ? 'marketplace' : 'marketplaces'}`
  return [
    facts.industry ? sentenceCase(facts.industry) : null,
    marketplaces,
    facts.territories.length ? facts.territories.join(', ') : null,
  ].filter((seg): seg is string => seg !== null).join(' · ')
}
