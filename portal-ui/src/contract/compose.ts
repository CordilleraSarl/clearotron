// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Composing a search request — the parts of the composer that are decisions rather than markup.
//
// These live here rather than inside NewClearance.tsx for a plain reason: the build can run .ts under
// the test runner but not .tsx, so anything left in the component is anything that cannot be tested.
// Parsing what a user typed into what gets billed is exactly the sort of thing that should not rely on
// having been eyeballed once in a browser.

import type { Product } from './api.ts'

/**
 * Split the names box into marks.
 *
 * Newlines AND commas both separate, because both are what people actually type, and a trailing comma
 * or a blank line is someone being human rather than an error worth a red box.
 *
 * What it deliberately does NOT do is deduplicate or normalise case. Two names that differ only in
 * punctuation are a real collision the server rejects by name — silently merging them here would spend
 * a search on a set the user never asked for and hide the reason the batch looked wrong.
 */
export function parseNames(raw: string): readonly string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Nice classes, as numbers.
 *
 * Out-of-range and non-numeric entries are DROPPED rather than passed through. The server validates
 * again and would reject the request, but a class number is the scope of the search and therefore of
 * the bill: silently sending "0" or "99" to be rejected wastes a round trip, and silently sending
 * something that parsed to NaN is how a search runs against fewer classes than the user believes.
 *
 * Duplicates collapse. Asking for class 9 twice is not asking for anything different.
 */
export function parseClasses(raw: string): readonly number[] {
  const seen = new Set<number>()
  for (const part of raw.split(/[\s,]+/)) {
    const n = Number(part.trim())
    if (Number.isInteger(n) && n >= 1 && n <= 45) seen.add(n)
  }
  return [...seen].sort((a, b) => a - b)
}

/**
 * The product to fall back to when the selected one cannot run here.
 *
 * Prefers the one the caller already had if it is fine, then the FIRST available product in offering
 * order — which is lightest first. Falling back to a deeper (more expensive) search because it happened
 * to be available would be the wrong direction to guess in.
 *
 * NULL when the caller had nothing, and that is not a fallback: nothing is picked by default on this
 * screen, because a search nobody chose is the thing this build exists to stop.
 */
export function resolveProduct(products: readonly Product[], wanted: string | null): string | null {
  if (!wanted) return null
  const current = products.find((l) => l.key === wanted)
  if (current?.available) return current.key
  return products.find((l) => l.available)?.key ?? null
}

/** Whether this draft is complete enough to be worth sending. Not a validation — the server owns that. */
export function isSendable({
  names,
  classes,
  goods,
  level,
}: {
  readonly names: readonly string[]
  readonly classes: readonly number[]
  readonly goods: string
  readonly level: Product | null
}): boolean {
  if (!names.length || !classes.length || !goods.trim()) return false
  if (!level) return false
  if (!level.available) return false
  // Over the product's own limit. The server refuses it too — it never truncates — and catching it here
  // is what lets the composer say WHICH names to remove instead of showing a rejection after the fact.
  if (names.length > level.maxNames) return false
  return true
}

/**
 * A comma/newline separated list, trimmed and de-duplicated. First spelling wins.
 *
 * Used for the marketplace box, where "GNC.com, gnc.com" is one shop typed twice and sending it twice
 * would sweep it twice. Case-insensitive for the dedupe, case-preserving for what is stored: the entry
 * a person typed is the one that should appear back at them.
 *
 * It moved here from savedSearchEditor.ts when the standalone saved-search editor was retired — it was
 * the one thing in that module the composer still used, and leaving it behind would have kept a file
 * named for a screen that no longer exists.
 */
export function parseList(raw: string): readonly string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of raw.split(/[,\n]/)) {
    const t = part.trim()
    if (!t) continue
    const k = t.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(t)
  }
  return out
}
