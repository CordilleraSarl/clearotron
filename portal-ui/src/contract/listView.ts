// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The Clearances list, as decisions rather than as markup.
//
// Paging and cross-owner disambiguation are the two things on that screen that are easy to get subtly
// wrong and impossible to notice by looking: an off-by-one in a page window shows the wrong fifty rows
// perfectly convincingly, and a missing owner tag makes two clients' identically-named marks read as
// one mark listed twice. Neither has a visual tell.
//
// The screen has no DOM test harness, so logic left inline in the component is logic nothing can check.
// It lives here instead, where it is ordinary functions over ordinary data.

/** The minimum a row needs for these decisions. Keeps the module independent of the full Run shape. */
export interface Listable {
  readonly title: string
  readonly account: string
}

/**
 * The window of rows a page shows.
 *
 * `page` is clamped rather than trusted. Filtering a 200-row list down to 12 while sitting on page 3
 * would otherwise render an empty table with no explanation and no way back — the user did not do
 * anything wrong, so the view has to absorb it. Clamping means the last page is shown instead.
 */
export function pageWindow<T>(rows: readonly T[], page: number, size: number) {
  const pageCount = Math.max(1, Math.ceil(rows.length / size))
  const current = Math.min(Math.max(0, Math.floor(page) || 0), pageCount - 1)
  const start = current * size
  const visible = rows.slice(start, start + size)
  return {
    current,
    pageCount,
    visible,
    // 1-based and inclusive, because these are read by a human: "1–50 of 73".
    from: rows.length ? start + 1 : 0,
    to: Math.min(rows.length, start + size),
    total: rows.length,
  }
}

/**
 * Mark names that belong to more than one brand owner.
 *
 * Two AquaPlus clearances exist for two different clients. Under owner headings they are correctly
 * separated — but a heading is only true while it is on screen, and paging or scrolling takes it away.
 * For these names the owner has to travel on the row itself.
 *
 * Only ambiguous names qualify. An owner chip on every row is noise, and noise on every row is how the
 * one row that needed it stops being seen.
 */
export function ambiguousTitles(runs: readonly Listable[]): ReadonlySet<string> {
  const owners = new Map<string, Set<string>>()
  for (const r of runs) {
    const key = normaliseTitle(r.title)
    const seen = owners.get(key) ?? new Set<string>()
    seen.add(r.account)
    owners.set(key, seen)
  }
  const out = new Set<string>()
  for (const [title, set] of owners) if (set.size > 1) out.add(title)
  return out
}

/**
 * The key two titles are compared under.
 *
 * Case and surrounding space are noise a customer never intended: "AquaPlus" and "AQUAPLUS " are one
 * name. Getting this wrong is silent in the safe direction (a missing chip) and silent in the unsafe
 * one (two clients' marks reading as one), so it is a named function with its own tests rather than an
 * inline `.toLowerCase()` repeated at each call site.
 */
export const normaliseTitle = (title: string): string => title.trim().toLowerCase()
