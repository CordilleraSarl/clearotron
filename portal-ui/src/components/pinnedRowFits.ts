// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// pinnedRowFits.ts — whether the report header's pinned row, as drawn, holds what it has to hold. A measurement of
// the drawn row, never a width of its own: every width it compares comes from the row's own layout and stylesheet.

/**
 * WHETHER THE PINNED ROW FITS, measured on the drawn row: nothing spills past its edge, the section links are all
 * there to read and press, "Ask AI" sits on one line, and the name is cut only when it is genuinely long, that is
 * wider than the row ever gives a name (its own max-width). A short name cut to "VEN…" is the row not fitting.
 */
export function compactRowFits(head: HTMLElement): boolean {
  const row = head.querySelector('.report-head-row')
  if (!(row instanceof HTMLElement) || row.scrollWidth > row.clientWidth + 1) return false
  const sections = head.querySelector('.report-sections')
  if (sections instanceof HTMLElement && sections.scrollWidth > sections.clientWidth + 1) return false
  const ask = head.querySelector('.ask-ai-btn')
  if (ask instanceof HTMLElement && ask.getClientRects().length > 0) {
    const line = parseFloat(getComputedStyle(ask).lineHeight) || 20
    if (ask.scrollHeight > line * 1.8 + 12) return false
  }
  const name = head.querySelector('.report-head-name')
  if (name instanceof HTMLElement && name.scrollWidth > name.clientWidth + 1) {
    const longest = parseFloat(getComputedStyle(name).maxWidth)
    if (!Number.isFinite(longest) || name.scrollWidth <= longest + 1) return false
  }
  return true
}

