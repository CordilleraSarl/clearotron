// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Which kind of search stands behind a name on the Clearances list, and the filter that narrows to one kind.
//
// THE TAGS ARE THE REGISTRY'S. Each product names its own short tag on its row in the driver's registry
// (search-policy.mjs, `report.tag`), and scripts/mint-search-level-tags.mjs writes them, in the registry's
// order, to the file imported below. This module keeps no list of its own: the portal once held its own
// table from product to label, it listed only the retired products, and every new run showed a blank.
//
// A tag follows the product the search ran as, `run.product`, the same value that names the report's
// masthead, so a tag cannot disagree with the report it stands for. A run under a retired product, or one
// with no product, has no tag: it shows none and appears only under All.

import LEVEL_TAGS from '../../../shared/search-level-tags.json' with { type: 'json' }
import type { Run } from './api.ts'

/** One kind of search: its product key, its short tag ("KO") and its full name ("Knockout search"). */
export type SearchLevel = {
  readonly product: string
  readonly tag: string
  readonly name: string
}

/** Every kind of search the product sells, in the registry's order: KO, Prelim, Multi, Full. */
export const SEARCH_LEVELS: readonly SearchLevel[] = LEVEL_TAGS.levels

/** The level filter's value: every search, or one product key. */
export type LevelFilter = 'all' | string

const BY_PRODUCT: ReadonlyMap<string, SearchLevel> = new Map(SEARCH_LEVELS.map((l) => [l.product, l]))

/** The level a run was searched at, or null for a retired or missing product. */
export function levelOf(run: Pick<Run, 'product'>): SearchLevel | null {
  return run.product ? BY_PRODUCT.get(run.product) ?? null : null
}

/** Whether a run is kept under the level filter. Under All every run is; under a level, only its own. */
export function atLevel(run: Pick<Run, 'product'>, filter: LevelFilter): boolean {
  return filter === 'all' || run.product === filter
}

/**
 * The tags a row shows: one for each level among its searches, each level once, always in the registry's
 * order, whatever order the searches ran in. Two searches at one level show that tag once; the row's
 * "N searches" pill still counts searches.
 */
export function levelsOf(runs: readonly Pick<Run, 'product'>[]): readonly SearchLevel[] {
  const held = new Set(runs.map((r) => r.product))
  return SEARCH_LEVELS.filter((l) => held.has(l.product))
}
