// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// lib/lexsearch.mjs — token-aware line matching, so a multi-word query stops failing on whole-phrase
// substring matching.
//
// The old search did `line.toLowerCase().includes(query.toLowerCase())`, so "MYRKUR similar mark conflict"
// found nothing unless those four words sat together verbatim on one line, while bare "MYRKUR" worked. Here we
// split the query into tokens and match per-token:
//   mode "all"   → every token must appear on the line (order-independent) — the sensible default
//   mode "any"   → ≥1 token appears; score = how many matched (ranks the most-relevant lines first)
//   mode "phrase"→ the raw query substring must appear (the old behaviour, kept for back-compat)
// No embeddings, no index — pure lexical. scoreLine returns 0 for "no match" so callers can filter+rank.

export function tokenize(query) {
  // unicode-aware split on non-letter/number runs; dedupe so a repeated word doesn't inflate the score
  return [...new Set(String(query ?? "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean))];
}

/**
 * Score one (already-lowercased) line against pre-tokenized query terms.
 * @returns {number} 0 = no match (exclude the line); higher = more relevant.
 */
export function scoreLine(lineLower, tokens, mode = "all", rawLower = "") {
  if (mode === "phrase") return rawLower && lineLower.includes(rawLower) ? 1 : 0;
  if (!tokens.length) return 0;
  let matched = 0;
  for (const t of tokens) if (lineLower.includes(t)) matched++;
  if (mode === "all") return matched === tokens.length ? matched : 0;
  return matched; // "any"
}
