// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The summary's block grammar, in the browser.
//
// A MIRROR of `shared/summary-blocks.mjs`, which is the definition. The portal bundle does not import
// from the driver tree — every other contract in this folder mirrors the same way — so the join is a
// PARITY TEST (`portal-ui/test/summaryBlocks.test.ts`) that feeds both implementations the same inputs
// and compares their output. Change the grammar there and that test reds here.
//
// Why this exists at all: owner ruling 2026-08-31 (tracker issues 1934, 2056) — the assess seat writes
// sub-headers and bullets inside the summary now. `<Prose>` renders inline spans only, so before this
// the grouped page showed a reader the literal characters `##` and `-`.

export type SummaryBlock =
  | { readonly kind: 'heading'; readonly level: number; readonly text: string }
  | { readonly kind: 'bullets'; readonly items: readonly string[] }
  | { readonly kind: 'para'; readonly text: string }

/** A line that opens a block rather than continuing prose: any ATX heading, or a `-`/`*` bullet.
 *  Every depth is PARSED; the rule that an H1 must never be written lives in the validator and the
 *  doctrine. A parser that refuses a shape only makes it arrive unhandled — as literal `#` on a page. */
export const SUMMARY_BLOCK_LINE = /^[ \t]*(?:#{1,6}[ \t]|[-*][ \t])/m

/** Parse ONE chunk into typed blocks. PURE. Mirrors parseSummaryBlocks in shared/summary-blocks.mjs. */
export function parseSummaryBlocks(chunk: string): readonly SummaryBlock[] {
  const out: SummaryBlock[] = []
  let para: string[] = []
  let bullets: string[] = []
  const flushPara = () => { if (para.length) { out.push({ kind: 'para', text: para.join('\n') }); para = [] } }
  const flushBullets = () => { if (bullets.length) { out.push({ kind: 'bullets', items: bullets }); bullets = [] } }
  for (const line of String(chunk ?? '').split(/\r?\n/)) {
    const h = line.match(/^[ \t]*(#{1,6})[ \t]+(.*)$/)
    if (h) { flushPara(); flushBullets(); out.push({ kind: 'heading', level: (h[1] ?? '').length, text: (h[2] ?? '').trim() }); continue }
    const b = line.match(/^[ \t]*[-*][ \t]+(.*)$/)
    if (b) { flushPara(); bullets.push((b[1] ?? '').trim()); continue }
    if (!line.trim()) { flushPara(); flushBullets(); continue }
    flushBullets(); para.push(line)
  }
  flushPara(); flushBullets()
  return out
}
