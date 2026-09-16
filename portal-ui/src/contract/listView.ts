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
 * Mark names that belong to more than one company.
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

/** One column of the Clearances table: what it holds, and its share of the table's width. */
export type Column = { readonly key: 'twisty' | 'pick' | 'name' | 'company' | 'status' | 'risk' | 'updated' | 'actions'; readonly share: number }

/**
 * The Clearances table's columns, in order, as percentages that sum to 100 in every mode.
 *
 * ALL PERCENTAGES. Two px columns among five percentages once made the table resolve WIDER than its
 * wrapper and overflow by 21px at a 1100px viewport, where the content column is only 767px because the
 * shell's rail takes the rest. Percentages of the table cannot add up to more than the table.
 *
 * THE ACTIONS COLUMN IS SIZED FOR ITS BUTTONS, and the rest give way to it. Open has to sit in one column
 * at one width on every row, which a column narrower than "Open latest report" cannot hold — so that
 * column is fixed first and the Name and Status columns, which wrap gracefully, absorb the difference.
 * `scripts/clearances-render-check.mjs` measures the result in a real browser at the widths it drives.
 */
export function clearancesColumns(mode: { readonly pick: boolean; readonly owner: boolean }): readonly Column[] {
  const cols: Column[] = [{ key: 'twisty', share: 4 }]
  if (mode.pick) cols.push({ key: 'pick', share: 4 })
  cols.push({ key: 'name', share: 0 })
  if (mode.owner) cols.push({ key: 'company', share: 11 })
  cols.push(
    // Status holds "Queued · 1 search" on one line at the narrowest width the check drives; ungrouped,
    // the company column takes its width and the phrase wraps between its two halves instead.
    { key: 'status', share: mode.owner ? 16 : 19 },
    // "Manageable" and its dot, which never wrap.
    { key: 'risk', share: mode.owner ? 14 : 15 },
    // A ten-character date in a monospace face, on one line.
    { key: 'updated', share: 12 },
    // "Open latest report", Ask AI beside it when there is room, and — for someone who may curate — the
    // "···" menu.
    { key: 'actions', share: mode.pick ? 25 : 22 },
  )
  // The Name column takes what is left, so the shares cannot drift away from 100 when one of the others
  // is retuned.
  const rest = 100 - cols.reduce((n, c) => n + c.share, 0)
  return cols.map((c) => (c.key === 'name' ? { key: 'name', share: rest } : c))
}
