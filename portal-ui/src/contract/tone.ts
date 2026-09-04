// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Risk bands, keyed by TONE.
//
// This is the single most important type in the UI, and the reason is a real defect class rather than a
// stylistic preference.
//
// Band LADDERS are framework-scoped. The house-default framework has FOUR stops and says "Moderate"
// where house-triage says "Medium"; a customer with a bespoke framework has their own words and their
// own count. The engine carries this correctly — `meta.framework.bands` is an ordered array of
// `{label, tone}` — and every band the UI draws must take its label and its position from that array.
//
// What must never happen is a component keying colour or order off the LABEL. A five-entry
// `{Low, Manageable, Medium, High, Very high}` map, which is exactly what the design prototype ships,
// silently renders a house-default customer's four-stop ladder with the wrong colours and sorts
// "Moderate" as unknown. So `toneColor` accepts `Tone` and nothing else: passing a label is a compile
// error, not a runtime surprise.
//
// The five tones are the engine's, from `GAUGE_STOP_BY_TONE` in driver/publish/render.mjs. There are
// five tones and a variable number of BANDS — a four-stop ladder simply does not use one of them.

export const TONES = ['minimal', 'low', 'medium', 'high', 'severe'] as const

export type Tone = (typeof TONES)[number]

/**
 * One rung of a customer's ladder, exactly as the engine writes it into `meta.framework.bands`.
 *
 * ORDER MATTERS AND IT IS COUNTERINTUITIVE: **index 0 is the MOST SEVERE band.**
 *
 * The manifests read `[Very High, High, Medium, Manageable, Low]`, and the engine states it in two
 * places — `render.mjs:114` ("manifest is most-severe-first → reverse for left→right") and `:96`
 * ("manifest index (0 = worst)"). The gauge reverses the array precisely because the display order and
 * the storage order are opposites.
 *
 * Reading it the other way round is not a cosmetic error. It makes `worstBand` return the SAFEST band
 * in a batch, so a knockout batch containing a "Very High" name would be summarised on screen as
 * "4 names, worst: Low". Every function below is written against index 0 = worst for that reason.
 */
export type Band = {
  readonly label: string
  readonly tone: Tone
}

const TONE_SET: ReadonlySet<string> = new Set(TONES)

/** Narrow an untrusted value from the wire. Anything unrecognised is `null`, never a guessed tone. */
export function asTone(v: unknown): Tone | null {
  return typeof v === 'string' && TONE_SET.has(v) ? (v as Tone) : null
}

/**
 * The CSS colour for a tone. Returns a `var()` reference rather than a hex, so the value resolves from
 * the token stylesheet — which is generated from brand.mjs — and follows the theme without this module
 * knowing anything about light and dark.
 */
export function toneColor(tone: Tone): string {
  return `var(--tone-${tone})`
}

/** Tones with a real soft/text chip pair in the brand system. See shared/portal-tokens.mjs. */
const CHIP_TONES: ReadonlySet<Tone> = new Set<Tone>(['minimal', 'medium', 'high'])

/**
 * Background and text for a band CHIP.
 *
 * `low` and `severe` have never had a soft/text pair in the brand system, and inventing two colours here
 * would put unreviewed values on a client surface. They fall back to the base tone at low alpha, which is
 * legible in both themes because the base itself is theme-aware.
 */
export function toneChip(tone: Tone): { background: string; color: string } {
  if (CHIP_TONES.has(tone)) {
    return { background: `var(--tone-${tone}-soft)`, color: `var(--tone-${tone}-tx)` }
  }
  return { background: `color-mix(in srgb, var(--tone-${tone}) 16%, transparent)`, color: `var(--tone-${tone})` }
}

/**
 * Severity rank: **0 is the worst**, ascending toward safest. Sorting ascending puts risk first.
 *
 * This is just the manifest index, because the manifest is already stored most-severe-first. It is a
 * function rather than a lookup so the ordering convention lives in exactly one place, and so an
 * unknown label has one defined answer.
 *
 * Derived from the ladder the run was actually rated against, never from a global tone ranking — that
 * is what makes "Moderate" sort between "Elevated" and "Clear" for a house-default customer instead of
 * falling to the bottom as an unrecognised word. A run with no ladder, or a label the ladder does not
 * contain, sorts LAST: it has not been rated, and burying it mid-list would hide that.
 */
export function bandRank(bands: readonly Band[], label: string | null): number {
  if (!label) return Number.MAX_SAFE_INTEGER
  const i = bands.findIndex((b) => b.label === label)
  return i === -1 ? Number.MAX_SAFE_INTEGER : i
}

/**
 * Where a band sits on its gauge, as a percentage from the left.
 *
 * The gauge runs least severe on the left to most severe on the right, which is the REVERSE of the
 * manifest's storage order — the frozen renderer does the same reversal at `render.mjs:114`, and this
 * has to agree with it or the native report and a legacy report of the same run would place the marker
 * on opposite sides.
 *
 * Computed from the ladder's own length, so a four-stop ladder spans the ramp differently from a
 * five-stop one — which is exactly what the prototype's hardcoded {10, 32, 54, 76, 94} cannot do.
 */
export function bandPosition(bands: readonly Band[], label: string | null): number | null {
  const i = bands.findIndex((b) => b.label === label)
  if (i === -1) return null
  if (bands.length === 1) return 50
  // manifest index (0 = worst) → display index (0 = leftmost = safest)
  const display = bands.length - 1 - i
  // Inset from both ends so the first and last markers are not clipped by the ramp's rounded corners.
  return 6 + (display / (bands.length - 1)) * 88
}

/**
 * The worst band among a batch of marks — the "N names, worst: <band>" line on the Clearances list.
 *
 * The single most consequential function in this file. A knockout batch has one report and many
 * answers, and this is the one word that summarises it; returning the safest instead of the worst
 * would tell someone their batch is fine when a name in it is blocking.
 */
export function worstBand(bands: readonly Band[], labels: readonly (string | null)[]): string | null {
  let worst: string | null = null
  let worstRank = Number.MAX_SAFE_INTEGER
  for (const l of labels) {
    const r = bandRank(bands, l)
    // Strictly less, so the FIRST label wins a tie — and MAX_SAFE_INTEGER (unrated) can never win,
    // which is what stops an unrated mark from being reported as the batch's answer.
    if (r < worstRank) {
      worstRank = r
      worst = l
    }
  }
  return worst
}
