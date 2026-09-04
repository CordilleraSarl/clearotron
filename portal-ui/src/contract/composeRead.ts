// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// What comes back from reading a brief, and what the composer does with it.
//
// The server bounds SHAPE (driver/compose-read.mjs): types, lengths, classes inside 1..45. This module
// owns the two things that are decisions rather than hygiene —
//
//   1. VOCABULARY. Whether "Bavaria" is a territory this composer offers is a question about the
//      composer's own lists, and those lists live here (composerProduct.ts, niceClasses.ts). Resolving
//      it on the server would put a second copy of the answer somewhere nobody would think to update.
//
//   2. THE RECEIPT. What the screen tells the reader it took. Derived from what was ACTUALLY applied,
//      never quoted from the model: a list the model writes is a claim about its own behaviour, and a
//      wrong one is invisible precisely when it matters. `appliedNotes` is computed from the diff
//      between the draft that went in and the draft that came out, so it cannot say "United States"
//      unless the United States is now a chip on the screen.
//
// The model's own `notes` survive, but only as DOUBTS — "the brief names both LUMEN and LUMENA" — and
// they are rendered under a heading that says so. Commentary and receipt are different things and the
// screen must not blur them.
//
// NOTHING HERE SPENDS ANYTHING. A read fills the form; the plan gate, the server-resolved scope and the
// review dialog are all still ahead of it, unchanged.

import { REGIONS, COUNTRIES } from './composerProduct.ts'
import type { Draft } from './composerProduct.ts'
import type { Product } from './api.ts'
import { classLabel, isClassNumber } from './niceClasses.ts'

/** The server's answer, already bounded. Everything is present; absence is an empty value. */
export type BriefRead = {
  readonly names: readonly string[]
  readonly classes: readonly number[]
  readonly goods: string
  readonly territories: readonly string[]
  /** The brief said EVERYWHERE, outright. A different fact from saying nothing about geography. */
  readonly worldwide: boolean
  /**
   * WHICH of the four the brief describes, or null when it does not say clearly enough.
   *
   * Null is the honest answer and the composer then asks. It used to be three booleans the reader
   * overwrote — `registers`, `marketplace`, `caseLaw` — from which the screen DERIVED a level; a brief
   * that mentioned oppositions in passing switched on the most expensive thing on the menu.
   */
  readonly product: string | null
  readonly ref: string
  readonly deadline: string
  readonly notes: readonly string[]
}

export const EMPTY_READ: BriefRead = {
  names: [], classes: [], goods: '', territories: [], worldwide: false, product: null,
  ref: '', deadline: '', notes: [],
}

/** The fields of the composer a read is allowed to touch. Deliberately not the whole draft — see below. */
export type ReadTarget = {
  readonly draft: Draft
  readonly names: string
  readonly classes: readonly number[] | null
  readonly goods: string
  readonly ref: string
  readonly deadline: string
}

const ALL_TERRITORIES: readonly string[] = [...REGIONS, ...COUNTRIES]

/**
 * A territory name as this composer spells it, or null.
 *
 * Case- and punctuation-tolerant, because a model asked for "United States" may answer "united states"
 * and dropping that would be pedantry with a cost. NOT fuzzy beyond that: "Bavaria" resolves to
 * nothing and is reported as dropped, rather than being talked into Germany. A territory the user did
 * not choose and did not see chosen is a territory they pay to search.
 */
export function resolveTerritory(raw: string): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const q = norm(raw)
  if (!q) return null
  return ALL_TERRITORIES.find((t) => norm(t) === q) ?? null
}

export type Resolved = {
  /** The read, with everything this composer cannot place removed. */
  readonly read: BriefRead
  /** Verbatim strings that were dropped, for the screen to own up to. */
  readonly dropped: readonly string[]
  /**
   * The brief made a LONE, explicit worldwide claim.
   *
   * True only when Worldwide appeared and nothing else survived resolution — which is the one case
   * where "worldwide" is a statement rather than a hedge. "Worldwide, France" is France and this is
   * false, exactly as it always was. It exists because the empty territory list means TWO different
   * things coming out of a model: "the brief does not say where" and "the brief says everywhere". The
   * first must leave the user's chips alone; the second must clear them (see `applyRead`), and without
   * this flag the two are indistinguishable by the time they reach the draft.
   */
  readonly worldwide: boolean
}

/**
 * The read, reduced to what the composer can actually show.
 *
 * "Worldwide" is not a territory in this screen — an EMPTY list means worldwide (composerProduct.ts).
 * A read that says Worldwide therefore never becomes a chip; alone it is reported as `worldwide` and
 * clears the scope, and beside a country it is the model contradicting itself: France wins, because it
 * is the specific claim and the broad one is the default anyway.
 */
export function resolveRead(raw: BriefRead): Resolved {
  const dropped: string[] = []
  const territories: string[] = []
  let claimedWorldwide = false
  // The MODE comes off its own field now rather than being inferred from a token in the list. A model
  // that writes both — everywhere, and France — is hedging, and the specific claim wins, because the
  // broad one is what an empty list would have meant anyway.
  if (raw.worldwide) claimedWorldwide = true
  for (const t of raw.territories) {
    // A worldwide TOKEN is still tolerated in the list, because a model will write one whatever the
    // schema says. It never becomes a chip: it is a mode, and it is recorded as one.
    if (/^\s*(worldwide|global|everywhere|all)\s*$/i.test(t)) { claimedWorldwide = true; continue }
    const hit = resolveTerritory(t)
    if (hit === null) { dropped.push(t); continue }
    if (!territories.includes(hit)) territories.push(hit)
  }
  const classes: number[] = []
  for (const c of raw.classes) if (isClassNumber(c) && !classes.includes(c)) classes.push(c)
  return {
    read: { ...raw, territories, classes, names: raw.names.filter((n) => n.trim() !== '') },
    dropped,
    worldwide: claimedWorldwide && territories.length === 0,
  }
}

/**
 * Applying a read to the draft.
 *
 * EVERY RULE HERE IS "FILL, NEVER CLEAR". A field the brief said nothing about is left exactly as the
 * user left it. The reason is the shape of the mistake: someone types three names, pastes a brief that
 * mentions one, presses Read this, and finds two names gone. There is no undo on this screen, and a
 * form filler that deletes work is worse than no form filler.
 *
 * The two levers are the exception and they are overwritten deliberately — `registers`/`marketplace`
 * decide WHICH PRODUCT this is (deriveMode), the brief is usually explicit about it ("just the obvious
 * blockers"), and both states are equally a choice so there is no "untouched" to preserve. The footer
 * names the product that results, so the change is never silent.
 *
 * `scripts` and `territories`-as-a-lane are never touched — a native-script deep dive is the most
 * expensive thing on the screen and is not inferred from prose (see driver/compose-read.mjs).
 *
 * ── THE ONE DELIBERATE EXCEPTION ────────────────────────────────────────────────────────────────────
 *
 * `opts.worldwide` — a brief that explicitly asks for a worldwide search, over a draft that already
 * names countries, CLEARS them. It is the only path in this module that removes something the user
 * could see, and it is here because the alternative is worse: worldwide IS the empty list, so without
 * it "clear it and search everywhere" is the one instruction a brief can give that this reader is
 * structurally incapable of carrying out — silently, with no line in the receipt to notice.
 *
 * It is narrow on purpose. `resolveRead` sets the flag only for a LONE worldwide claim (a hedge like
 * "Worldwide, France" resolves to France and never reaches here), the clear only happens when the read
 * names no territory of its own, and `appliedNotes` states it in the receipt. Model SILENCE — an empty
 * list with no flag — still leaves the user's territories exactly where they were.
 */
export function applyRead(
  draft: ReadTarget,
  read: BriefRead,
  inheritedClasses: readonly number[] = [],
  opts: { readonly worldwide?: boolean } = {},
): ReadTarget {
  const names = read.names.length > 0 ? read.names.join('\n') : draft.names
  // A read that names classes is a user touch: the draft stops being a ghost and starts being an
  // explicit list. What it must NOT do is start that list from empty — `draft.classes === null` means
  // "use the brand owner's own", so materialising it has to begin from THOSE, exactly as adding a class
  // by hand does (`draft.classes ?? own.classes` in NewClearance). Starting from [] silently deletes
  // every inherited class the moment a brief mentions one, and the deletion is invisible: the chips
  // just stop being there, and the search runs narrower than the account is set up for.
  const base = draft.classes ?? inheritedClasses
  const newClasses = read.classes.filter((c) => !base.includes(c))
  return {
    names,
    // And a ghost that gains NOTHING stays a ghost. A brief that names class 32 for an owner who
    // already carries 32 has changed nothing the user can see — converting the list to an explicit one
    // anyway would freeze today's profile into the request, so a class added to the brand owner
    // tomorrow would silently not apply to a search composed today.
    classes: newClasses.length > 0 || (draft.classes !== null && read.classes.length > 0)
      ? [...base, ...newClasses]
      : draft.classes,
    goods: read.goods.trim() !== '' ? read.goods : draft.goods,
    ref: read.ref.trim() !== '' ? read.ref : draft.ref,
    deadline: read.deadline !== '' ? read.deadline : draft.deadline,
    draft: {
      ...draft.draft,
      // A brief that names a product REPLACES the choice; a brief that does not leaves it alone. Null is
      // silence, and silence must never be read as "the cheapest" or as "the deepest".
      product: read.product ?? draft.draft.product,
      territories: read.territories.length > 0
        ? [...draft.draft.territories, ...read.territories.filter((t) => !draft.draft.territories.includes(t))]
        // Everywhere, said outright, is the one instruction that has to be able to remove chips —
        // and worldwide is spelled as no chips at all. Silence is still silence.
        : opts.worldwide === true ? [] : draft.draft.territories,
    },
  }
}

/**
 * The receipt: what changed, in the reader's language.
 *
 * Computed from before and after, so every line is a fact about the screen the reader is looking at.
 * Ordered the way the eye travels down the form, not the way the object is keyed.
 */
export function appliedNotes(before: ReadTarget, after: ReadTarget, inheritedClasses: readonly number[] = [], products: readonly Product[] = []): readonly string[] {
  const out: string[] = []
  if (after.names !== before.names) {
    const list = after.names.split('\n').map((s) => s.trim()).filter(Boolean)
    out.push(list.length === 1 ? `${list[0]} — the mark` : `${list.length} names — ${list.join(', ')}`)
  }
  // Against the EFFECTIVE before, not the raw one. A class the owner already carries was on screen as
  // a chip before the read and is on screen after it — reporting it as something the brief added would
  // be a receipt for work that did not happen.
  const beforeClasses = before.classes ?? inheritedClasses
  const addedClasses = (after.classes ?? []).filter((c) => !beforeClasses.includes(c))
  if (addedClasses.length > 0) out.push(`Class${addedClasses.length > 1 ? 'es' : ''} ${addedClasses.map(classLabel).join(', ')}`)
  if (after.goods !== before.goods) out.push(`Goods — ${after.goods}`)
  const addedT = after.draft.territories.filter((t) => !before.draft.territories.includes(t))
  if (addedT.length > 0) out.push(addedT.join(', '))
  // The one line that reports a REMOVAL, and it is derived from the diff like every other one — never
  // from the flag that caused it. `applyRead` clears territories in exactly one place, so this state
  // cannot arise any other way, and reading it off the screen keeps the receipt a fact about the form
  // rather than a claim about what the model said.
  else if (before.draft.territories.length > 0 && after.draft.territories.length === 0)
    out.push('Worldwide — the named territories were cleared')
  // The product only gets a line when it MOVED, and it is NAMED BY THE OFFERING rather than described
  // here: a second set of words for the same four things is a second set of words that can drift. The
  // key is the fallback only for a product this bundle has not been told about, which is a state an
  // older server can produce and a made-up description would hide.
  if (after.draft.product !== before.draft.product && after.draft.product)
    out.push(products.find((p) => p.key === after.draft.product)?.name ?? after.draft.product)
  if (after.ref !== before.ref) out.push(`Your reference — ${after.ref}`)
  // "DEADLINE", NOT "NEEDED BY" (owner,). His prose review renamed the field on the
  // form above; this receipt line is a different code path and his review did not reach it, so for one
  // release the screen called one field two names. He was asked and ruled: the receipt follows the
  // field. His form is the label and the date with nothing between them — no em dash, unlike the
  // reference line beside it, whose wording he did not change.
  if (after.deadline !== before.deadline) out.push(`Deadline ${after.deadline}`)
  return out
}
