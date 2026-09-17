// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE ALLOWANCE LINE, COMPOSED ONCE FOR EVERY SCREEN THAT SHOWS IT.
//
// New clearance and Clearances both carry this line, in the same three states, and they each wrote their
// own before this: one said "3 of 20 searches used today", the other "You have used all of today's
// searches", and neither said what to do about it. Two screens composing one sentence is one sentence
// and one imitation of it, and a reader who meets both learns that the product cannot count.
//
// ── THE THREE STATES, AND WHY SILENCE IS ONE OF THEM ────────────────────────────────────────────
//
// A reader with plenty left does not need to be told a number they are not near. The line appears only
// when the allowance is close enough to change what they do — at five or fewer — and until it does the
// screen says nothing at all. That threshold is new: the product wrote a line only when the allowance
// was already spent, which is the one moment it is too late to be useful.
//
// ── WHAT IT MUST NEVER SAY ──────────────────────────────────────────────────────────────────────
//
// A null limit means "we could not read it" — never "unlimited" and never zero. Told as either, the
// account that is genuinely uncapped and the one whose usage file is unreadable become the same screen,
// and one of those two should stop somebody before they spend. An unreadable allowance is silence here,
// because this line's whole job is to say how many are left and it does not know.
//
// ── THE EXHAUSTED SENTENCE IS THE SERVER'S WORDS ────────────────────────────────────────────────
//
// The engine already refuses a start with a sentence of its own, composed from the limit and the
// operator's name. The client does not receive that string — only the counts — so it is composed again
// here, which is a second author for one sentence and is exactly the arrangement this file's header
// warns about. It is held by an arm rather than by hope: `driver/test/the-allowance-line-is-the-
// servers-words.test.mjs` reads both and fails when they drift. Keep the wording identical, or move
// them both.
import type { Usage } from './api.ts'
import { operatorName } from './api.ts'

/** Below this many searches left, the line appears. At or above it, the screen says nothing. */
export const ALLOWANCE_SPEAKS_AT = 5

/**
 * How many searches are left today, or null when that cannot be known.
 *
 * Null is a could-not-look and is kept distinct from zero all the way to the screen: an uncapped account
 * and an unreadable usage file are different facts, and only one of them should stop anybody.
 */
export function searchesLeft(usage: Usage | null): number | null {
  if (!usage || !usage.capped || usage.dailyRuns == null) return null
  return Math.max(0, usage.dailyRuns - usage.today)
}

/**
 * The allowance line for New clearance and for Clearances, or null when the screen says nothing.
 *
 * @param usage the account's usage read; null while it is loading or could not be read
 * @param brand the operator's brand, as `ctx.me.brand` carries it
 */
export function allowanceLine(usage: Usage | null, brand: string): string | null {
  const left = searchesLeft(usage)
  if (left == null) return null
  if (left > ALLOWANCE_SPEAKS_AT) return null

  const who = operatorName(brand)

  // NONE LEFT — the engine's own refusal sentence, composed from the same two facts it uses. A reader
  // who is refused by the server and a reader who is warned by the screen must meet one sentence.
  if (left === 0) {
    const cap = usage?.dailyRuns ?? 0
    // NAMED, NOT ADDRESSED — and the same shape as the line below it. "ask your ${who} contact" wrapped
    // a possessive and a noun around a name that is already the answer, so a deployment with no brand
    // configured, whose `who` is the words "the operator", told its reader to "ask your the operator
    // contact to run this one for you". Pinned to the server's own copy by allowanceParity.test.ts.
    return `You have used all ${cap} of this account's searches for today. `
      + `The allowance resets at midnight UTC — or ask ${who} to run this one for you.`
  }

  // FIVE OR FEWER — what is left, when it comes back, and the way round it, in one line.
  return `${left} search${left === 1 ? '' : 'es'} left today. `
    + `The allowance resets at midnight UTC, or ask ${who} to run one for you.`
}
