// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// proposal-fields.mjs — the narrowing fields of `register_propose_supplemental`, ONE definition for every
// register's server.
//
// The reading turn narrows a crowded identical question through this tool: by goods words, by market
// (`regions`), and it names the crowd it replaces (`narrows`). The shared mint (supplemental.mjs) has
// handled all three for every register, but only the Clarivate server declared them, and Corsearch
// declared `regions` alone. A model reads the schema it is served, so on Signa the reading turn could
// narrow only by class. The product is register-agnostic: every server now spreads these same
// properties into its proposal schema, and what differs by register is a capability fact the server
// passes in, never a missing field.
//
// The words are the shipped words, moved rather than rewritten: the goods and `narrows` text is what the
// Clarivate server already served, and each server keeps the `regions` sentence it (or its sibling
// register) already carried. A register that cannot search goods text, or cannot offer alternatives in
// one goods clause, is handled in the mint, the same way the compiler handles it.

const GOODS_WORDS = "OPTIONAL goods narrowing on a MARK-TEXT proposal: the same question, limited to filings whose "
  + "goods and services description carries one of these words. This is the FIRST move when the identical mark comes "
  + "back as a count instead of a list — the words are the ones the variants stage already wrote for this matter, the "
  + "client's own wording plus the synonyms. Single words or short phrases as a specification would write them, no "
  + "wildcards. Not allowed on predicate:owner.";

const NARROWS = "OPTIONAL: the qid of the CROWDED question this proposal replaces. Put it on a narrowing — the same "
  + "question limited by goods, by market, by the dominant word or to one class — so the record shows the crowd and the "
  + "question that answered it side by side, each with its own count. A narrowing that does not name what it replaced "
  + "leaves the crowd looking unanswered.";

/** The `regions` sentence a register whose requests need no office carries (shipped on Corsearch). */
export const REGIONS_CODES = "UPPERCASE 2-letter region codes, e.g. ['US','EU','CH'] — never spelled-out names "
  + "(recognized display names are normalized; unknown values are rejected)";

/**
 * The three narrowing properties, for a proposal item's `properties`.
 * @param opts.regions   the register's `regions` description (REGIONS_CODES unless the register states more)
 * @param opts.goodsNote a sentence appended to the goods description, for a register fact the model must know
 */
export function narrowingFields({ regions = REGIONS_CODES, goodsNote = "" } = {}) {
  return {
    goods_words: { type: "array", items: { type: "string" }, description: goodsNote ? `${GOODS_WORDS} ${goodsNote}` : GOODS_WORDS },
    regions: { type: "array", items: { type: "string" }, description: regions },
    narrows: { type: "string", description: NARROWS },
  };
}
