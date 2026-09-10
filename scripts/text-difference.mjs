// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Where two texts first differ, and a window of each side there, so a check that finds them unequal can
// say how and not only that.
//
// A pair of lengths is not enough: two texts of one length that differ in one word would print alike.
// Each window is JSON-quoted, so a newline or a trailing space in either shows on the one line printed.

/**
 * `null` when the texts are equal. Otherwise one line: the offset of the first differing character, both
 * lengths, and up to `span` characters of each side starting `lead` characters before that offset.
 */
export function textDifference(a, b, { span = 48, lead = 16, labels = ['visit 1', 'visit 2'] } = {}) {
  const x = String(a ?? '')
  const y = String(b ?? '')
  if (x === y) return null
  let at = 0
  while (at < x.length && at < y.length && x[at] === y[at]) at++
  const from = Math.max(0, at - lead)
  const window = (s) => JSON.stringify(`${from > 0 ? '…' : ''}${s.slice(from, from + span)}${from + span < s.length ? '…' : ''}`)
  return `first differs at character ${at} (lengths ${x.length} and ${y.length}): ${labels[0]} ${window(x)} · ${labels[1]} ${window(y)}`
}
