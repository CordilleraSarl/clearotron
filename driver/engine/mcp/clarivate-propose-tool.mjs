// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// clarivate-propose-tool.mjs — the words and the schema of Clarivate's `register_propose_supplemental`, one copy: the
// live server serves them, and the fixture server serves them too, so a replay on saved data reads what a run reads.
import { narrowingFields } from "./proposal-fields.mjs";

export const CLARIVATE_PROPOSE_TOOL = Object.freeze({
  description: "PROPOSE judgment-addition register queries; CODE executes them and writes the band (the supplemental lane — you never run register coverage by hand and never author band blocks). Each proposal: {predicate: exact|default|wildcard|phonetic|owner, term OR terms[] (OR-stack, split anything wider than the plan bound), romanization (MANDATORY beside a single non-Latin term — this register indexes non-Latin filings by their transliteration and refuses bare characters), owner? (a mark-text proposal may add an owner SCOPE FIELD — the owner×term intersection slice, the watchlist-coverage move), nice_classes (REQUIRED — an unscoped sweep is rejected), regions?, rationale?, term_literal? (true asserts the term IS a mark verbatim, bypassing the shape lint)}. Terms must be MARK-SHAPED and agree with the predicate: an anchored `*` needs predicate:wildcard, and a label/prose string (>4 words, parentheticals) is rejected — supply the mark terms it stands for. The tool mints each proposal as a qid'd supplemental plan entry (deterministic qid — re-proposing the same query reuses it, never duplicates; re-proposing a bare non-Latin term WITH its romanization enriches the existing entry and re-executes it), executes them through the same deterministic executor as the dictated plan (count-first per-term truth, ceiling, chunking, error stamping), MERGES the results into the band at output_path itself, and returns per-qid results read back from the band: {state, total_hits, count, term_counts?, reason?, records_preview[≤25]}. Iterate freely: propose → read counts → propose narrower. A crowd result (state:incomplete) is a descriptor for judgment — never a clean.",
  inputSchema: { type: "object", required: ["axis", "output_path", "proposals"], properties: {
        axis: { type: "string", description: "The register axis these supplementals belong to (e.g. primary-sweep)" },
        output_path: { type: "string", description: "Absolute path of the named band to merge into (register-units/<axis>-band.json)" },
        proposals: { type: "array", minItems: 1, items: { type: "object", properties: {
          predicate: { type: "string", enum: ["exact", "default", "wildcard", "phonetic", "owner"] },
          term: { type: "string" }, terms: { type: "array", items: { type: "string" } },
          romanization: { type: "string", description: "The Latin-script form of a NON-LATIN term — plain ASCII letters/digits, syllable-separated by single spaces, no tone marks or diacritics (华威豹 → \"HUA WEI BAO\", ワボスラッシュ → \"WABO SURASSHU\"). MANDATORY beside a non-Latin term: without it this register cannot answer the characters and the slice defers. Single-term proposals only (never an OR-stack, never predicate:owner), and never on a term that is already Latin." },
          owner: { type: "string", description: "OPTIONAL owner scope field on a MARK-TEXT proposal: the query is the owner×term intersection (the owner's filings within the term band). Not allowed on predicate:owner (there the owner name IS the term)." },
          nice_classes: { type: "array", items: {} },
          // The narrowing fields every register serves (proposal-fields.mjs); this register's two facts ride in.
          ...narrowingFields({ regions: "OPTIONAL. Omit to inherit the frozen plan's regions (the matter's territorial scope) — this provider REQUIRES at least one office on every request, so an omitted list is backfilled from the plan, never treated as a worldwide sweep. Supply it only to search a NARROWER set than the matter's scope.",
            goodsNote: "One office in this provider's vocabulary refuses the field and fails the whole call, so it is left out of that office's request and recorded as asked-without-goods rather than dropped in silence." }),
          rationale: { type: "string" },
          term_literal: { type: "boolean", description: "TRUE only when the term genuinely IS the mark verbatim (a multi-word slogan mark, a mark carrying an anchored star) — it bypasses the term-shape lint. Never use it to push a label through." },
        } } },
      } },
});
