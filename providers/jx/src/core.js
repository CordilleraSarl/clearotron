// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// providers/jx/src/core.js — the jx-completions core: ONE non-agentic, schema-enforced Anthropic
// Messages call that turns a mark + product context into native-script register candidates for a
// language lane (zh today). PURE module — global fetch, injectable fetchImpl, no driver imports,
// offline-testable (the providers/perplexity/src/core.js discipline).
//
// Schema discipline: forced tool_choice guarantees the model answers VIA the emit_candidates tool;
// the input SHAPE is then validated by parseCandidates (closed kinds, string terms, hard cap) —
// enforcement is forced-tool + parse-validation, not an API-level strict mode. A refusal/prose answer
// parses as EMPTY candidates and a max_tokens-truncated response DEGRADES LOUDLY (stop_reason
// checked — truncation must never masquerade as a legitimate no-candidates result). Candidates are
// SEARCH MACHINERY (query terms), never registry facts — the never-invent rule binds registry DATA,
// not the queries we choose to run.
//
// BILLING RIDES THE RUN, NOT THIS FILE (/ at e49868e3, and the transport deleted at).
// These lanes used to POST to the Anthropic Messages API on ANTHROPIC_API_KEY at a hardcoded haiku
// tier while the rest of the run used whatever program the customer chose — the mix the owner's D6
// ruling forbids. They now go through `engine.runTurn()` like every other model call, so whatever
// program and billing mode the run is on carries them, and nothing here selects a vendor.
//
// `callMessagesAPI` — with its own MESSAGES_API_URL, x-api-key header and retry ladder — is DELETED
// rather than left exported. It had no caller after e49868e3, and an exported function that POSTs to
// a hardcoded vendor endpoint on a hardcoded key is one `import` away from reintroducing the mix.
// DEFAULT_MODEL stays: judge.js and nativeread.js still read it as their request default.

export const DEFAULT_MODEL = "claude-haiku-4-5-20251001";   // cheap, structured task; JX_MODEL overrides upstream
export const MAX_CANDIDATES = 8;

import { runJxTurn } from "./turn-envelope.mjs";

export const CANDIDATE_TOOL = {
  name: "emit_candidates",
  description: "Emit the native-script register candidates for the mark. Emit ONLY this tool call.",
  input_schema: {
    type: "object",
    required: ["candidates"],
    additionalProperties: false,
    properties: {
      candidates: {
        type: "array",
        maxItems: MAX_CANDIDATES,
        items: {
          type: "object",
          required: ["term", "romanization", "kind", "rationale"],
          additionalProperties: false,
          properties: {
            term: { type: "string", description: "the native-script form, script of the lane only" },
            // The register is indexed by the ROMANISATION, not the characters — searching 华威豹
            // returns 0 while HUA WEI BAO returns 32 of the same records. The native form stays the
            // identity of the candidate (it is what the report shows); this is what gets searched.
            romanization: { type: "string", description: "the Latin-script romanisation of `term`, syllable-separated by spaces (pinyin for Chinese, Hepburn romaji for Japanese, Revised Romanization for Korean). ASCII letters and spaces only — no tone marks, no diacritics." },
            kind: { type: "string", enum: ["phonetic", "semantic", "nickname"] },
            rationale: { type: "string", description: "one sentence: why a market actor would use this form" },
          },
        },
      },
    },
  },
};

const LANE_PROMPTS = {
  zh: ({ mark, productContext }) => [
    `Mark: "${mark}". Product context: ${productContext || "general consumer goods/services"}.`,
    ``,
    `Task: the SIMPLIFIED-CHINESE register forms a mainland-China market actor (distributor, fan base,`,
    `or bad-faith filer) would plausibly use for this mark. Emit up to ${MAX_CANDIDATES} candidates via the`,
    `emit_candidates tool:`,
    `- "phonetic": transliterations by SOUND (the characters a Chinese speaker would pick to say the mark);`,
    `- "semantic": translations by MEANING (when the mark has translatable meaning);`,
    `- "nickname": the shorthand the Chinese market actually adopts for foreign brands of this kind.`,
    `Rules: \`term\` is Han script ONLY (no Latin); give its pinyin in \`romanization\`, syllable-separated,`,
    `no tone marks (华威豹 → "HUA WEI BAO") — the register is indexed by the pinyin, not the characters;`,
    `prefer the forms with real market plausibility over`,
    `exhaustive listings; if the mark is coined with no meaning, semantic candidates are simply omitted;`,
    `NEVER invent a form just to fill the quota — fewer good candidates beat ${MAX_CANDIDATES} weak ones.`,
  ].join("\n"),
  ja: ({ mark, productContext }) => [
    `Mark: "${mark}". Product context: ${productContext || "general consumer goods/services"}.`,
    ``,
    `Task: the JAPANESE register forms a Japan-market actor (brand owner, distributor, media, fan base,`,
    `or bad-faith filer) would plausibly use or register for this mark at the JPO. Emit up to`,
    `${MAX_CANDIDATES} candidates via the emit_candidates tool:`,
    `- "phonetic": the katakana transliteration(s) — the standard form FIRST, plus genuinely current variants`,
    `  (e.g. with/without the middle dot, alternative long-vowel renderings actually seen in the market);`,
    `- "semantic": meaning-based kanji/kana renderings (only when the mark has translatable meaning);`,
    `- "nickname": the clipped/contracted forms the Japanese market actually coins from long katakana names.`,
    `Rules: \`term\` is Japanese script ONLY — katakana, hiragana or kanji, no Latin; give its Hepburn`,
    `romaji in \`romanization\` (ミハル → "MIHARU") — the register is indexed by the romaji, not the`,
    `characters; prefer forms with real`,
    `market plausibility over exhaustive listings; if the mark is coined with no meaning, semantic candidates`,
    `are simply omitted; NEVER invent a form just to fill the quota — fewer good candidates beat`,
    `${MAX_CANDIDATES} weak ones.`,
  ].join("\n"),
  ko: ({ mark, productContext }) => [
    `Mark: "${mark}". Product context: ${productContext || "general consumer goods/services"}.`,
    ``,
    `Task: the KOREAN (hangul) register forms a South-Korea market actor (brand owner, distributor, media,`,
    `fan base, or bad-faith filer) would plausibly use or register for this mark at KIPO. Emit up to`,
    `${MAX_CANDIDATES} candidates via the emit_candidates tool:`,
    `- "phonetic": the hangul transliteration(s) — the standard form FIRST, plus genuinely current variants`,
    `  (Korean brand practice keeps older or stylized spellings alive, e.g. 까르푸, 써브웨이 — include them`,
    `  when they are the forms the market really uses);`,
    `- "semantic": meaning-based hangul renderings (only when the mark has translatable meaning);`,
    `- "nickname": the abbreviations the Korean market actually adopts for foreign brands of this kind.`,
    `Rules: \`term\` is Hangul ONLY — no Latin, no hanja; give its Revised Romanization in`,
    `\`romanization\` (지키미 → "ZIKIMI") — the register is indexed by the romanization, not the hangul;`,
    `prefer forms with real market plausibility`,
    `over exhaustive listings; if the mark is coined with no meaning, semantic candidates are simply omitted;`,
    `NEVER invent a form just to fill the quota — fewer good candidates beat ${MAX_CANDIDATES} weak ones.`,
  ].join("\n"),
};

/** Assemble the Messages API body (pure). Throws on an unknown lane — callers route lanes, not this. */
export function buildCandidateRequest({ mark, productContext = "", lane = "zh", model = DEFAULT_MODEL }) {
  const promptFor = LANE_PROMPTS[lane];
  if (!promptFor) throw new Error(`jx-completions: no prompt for lane "${lane}"`);
  if (!String(mark ?? "").trim()) throw new Error("jx-completions: mark is required");
  return {
    model,
    max_tokens: 2048,   // 8 Han candidates + rationales need headroom; truncation is checked either way
    tools: [CANDIDATE_TOOL],
    tool_choice: { type: "tool", name: CANDIDATE_TOOL.name },   // FORCED tool answer; shape validated at parse
    messages: [{ role: "user", content: promptFor({ mark: String(mark).trim(), productContext: String(productContext ?? "").trim() }) }],
  };
}

/** Extract candidates from a Messages response (pure). ANY shape miss → [] (fallback-on-empty). */
export function parseCandidates(responseJson) {
  try {
    const blocks = Array.isArray(responseJson?.content) ? responseJson.content : [];
    const tool = blocks.find((b) => b?.type === "tool_use" && b?.name === CANDIDATE_TOOL.name);
    const rows = tool?.input?.candidates;
    if (!Array.isArray(rows)) return [];
    const KINDS = new Set(CANDIDATE_TOOL.input_schema.properties.candidates.items.properties.kind.enum);
    return rows
      .filter((c) => c && typeof c.term === "string" && typeof c.kind === "string" && KINDS.has(c.kind))
      .slice(0, MAX_CANDIDATES)
      .map((c) => ({
        term: c.term.trim(),
        // Kept as-is when absent — jx-lanes refuses the candidate rather than searching the
        // characters, because the characters return 0 and a 0 here reads as CLEAN.
        romanization: typeof c.romanization === "string" ? c.romanization.trim() : null,
        kind: c.kind,
        rationale: String(c.rationale ?? "").slice(0, 300),
      }));
  } catch { return []; }
}

/** The one-call convenience the driver adapter uses: build → call → parse → usage rollup. */
export async function generateCandidates({ mark, productContext, lane = "zh", turn }) {
  const started = Date.now();
  const body = buildCandidateRequest({ mark, productContext, lane });
  return runJxTurn({ body, turn, kind: "jx-completions", started,
    truncatedCause: "response truncated at the output ceiling — the candidate list is not trustworthy",
    parse: (envelope) => ({ candidates: parseCandidates(envelope) }) });
}
