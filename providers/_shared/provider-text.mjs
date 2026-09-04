// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// provider-text.mjs — shortening a provider's own words without severing what classifies them.
//
//. A vendor refusal was written into the band blocks cut three characters before the word that
// decides what the engine does next:
//
//   HTTP 500: INTERNAL_SERVER_ERROR - Count Failed - IL - Near/Adj queries with sub queries that can
//   return a huge amount of results are not all
//                                       ^^^^^^^^ ends here — `allowed` never arrives
//
// shipped `STRUCTURAL_REFUSAL_RE`, which keys on `\b(?:are|is)\s+not\s+allowed\b`. It is correct,
// and it was inert: the string that reached it had been severed at 140 characters. `!TRANSIENT_RE`
// decided instead, `HTTP 500` matched `\bhttp\s?5\d\d\b`, and a refusal that will recur byte-identically
// forever was filed as weather — retried on every future run of that shape, parked in the wrong lane,
// and its slice counted as an unanswered hole rather than a disclosed one.
//
// ── WHY TAIL-PRESERVING, RATHER THAN A BIGGER NUMBER ────────────────────────────────────────────────
//
// Raising 140 to 400 fixes this string and leaves the defect. Vendor messages put the STATUS at the
// front and the DISCRIMINATOR at the back — "…are not allowed", "…exceeds the maximum allowed (1000)",
// "…Maximum number of results is 30000." A head-only clip is therefore biased against exactly the part
// a classifier needs, at whatever length it is set to. The bias is the bug; the number is not.
//
// So: keep the head, keep the tail, elide the middle. The head carries the HTTP status and the office
// code, the tail carries the word that classifies. Both survive at any budget, and the reader can see
// that something was removed.
//
// ── WHAT THIS DOES NOT PROMISE ──────────────────────────────────────────────────────────────────────
//
// It is not a parser and it does not know what any particular classifier keys on. A vendor that put its
// discriminator in the MIDDLE would still be cut, and no clipping rule can fix that — only not clipping
// can. What this fixes is the systematic case: the end of a sentence is where its verdict lives.

/** The share of the budget reserved for the tail. Enough for a clause, not so much that the status
 *  line at the front is lost. */
const TAIL_SHARE = 0.4;

/** Marks the elision. A single character, so the budget is a real bound rather than a near one. */
export const ELISION = "…";

/**
 * Shorten `text` to at most `limit` characters, cutting the middle rather than the end.
 *
 * Returns the input unchanged when it already fits, so nothing that fits is ever marked.
 *
 * @param {unknown} text
 * @param {number} limit  total characters, elision included
 * @returns {string}
 */
export function clipProviderText(text, limit) {
  const s = String(text ?? "");
  const max = Math.max(0, Math.floor(Number(limit) || 0));
  if (max <= 0) return "";
  if (s.length <= max) return s;
  // Below a handful of characters there is no useful middle to elide; degrade to a head clip rather
  // than emitting something that is mostly ellipsis.
  if (max <= ELISION.length + 2) return s.slice(0, max);
  const tail = Math.max(1, Math.round((max - ELISION.length) * TAIL_SHARE));
  const head = max - ELISION.length - tail;
  return `${s.slice(0, head)}${ELISION}${s.slice(s.length - tail)}`;
}
