// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// providers/jx/src/nativeread.js — the jx-nativeread completions contract: ONE
// non-agentic, schema-enforced Anthropic Messages call in which the lane model READS the code-inlined
// CN evidence slice (register rows + native-script candidates + CNIPA sub-class notes + platform-grid
// findings) and returns structured flags. PURE module — global fetch via ./core.js transport,
// injectable fetchImpl, no driver imports, offline-testable.
//
// Authority doctrine (structural): the output is an AIM-ATTENTION payload for Claude's synthesis —
// severity_hint is a triage hint and NEVER sets a band; Claude is the sole rating authority. Code
// enforces record_uri ∈ the fetched set upstream (an ungrounded flag downgrades to a lead) — this
// module only shapes and clamps; it grounds nothing itself.

import { DEFAULT_MODEL } from "./core.js";
import { runJxTurn } from "./turn-envelope.mjs";

export const MAX_ITEMS = 12;
export const ITEM_KINDS = ["conflict-read", "subclass-note", "squatter-flag", "cultural-note"];
export const SEVERITY_HINTS = ["low", "medium", "high"];

export const NATIVEREAD_TOOL = {
  name: "emit_read_items",
  description: "Emit the structured read of the Chinese evidence slice. Emit ONLY this tool call.",
  input_schema: {
    type: "object",
    required: ["items"],
    additionalProperties: false,
    properties: {
      items: {
        type: "array",
        maxItems: MAX_ITEMS,
        items: {
          type: "object",
          required: ["kind", "record_uri", "analysis_en", "severity_hint", "grounds_en"],
          additionalProperties: false,
          properties: {
            kind: { type: "string", enum: ITEM_KINDS },
            record_uri: {
              type: ["string", "null"],
              description: "the uri of the register record or grid hit this reads — ONLY a uri present in the supplied slice; null for slice-wide notes (subclass/cultural)",
            },
            analysis_en: { type: "string", description: "the read, in English, 1-3 sentences" },
            severity_hint: { type: "string", enum: SEVERITY_HINTS, description: "triage hint only — never a rating" },
            grounds_en: { type: "string", description: "what in the slice grounds this (quote/point to the row)" },
          },
        },
      },
    },
  },
};

/** Assemble the Messages API body (pure). `payload` is the code-inlined evidence slice the DRIVER
 *  assembled (register rows, candidates, sub-class notes, grid findings) — this module never decides
 *  what the model may see. */
export function buildNativereadRequest({ mark, lane = "zh", payload, model = DEFAULT_MODEL }) {
  if (lane !== "zh") throw new Error(`jx-nativeread: no prompt for lane "${lane}"`);
  if (!String(mark ?? "").trim()) throw new Error("jx-nativeread: mark is required");
  if (!String(payload ?? "").trim()) throw new Error("jx-nativeread: payload (the evidence slice) is required");
  const prompt = [
    `Mark under clearance: "${String(mark).trim()}".`,
    ``,
    `Below is the complete Chinese evidence slice assembled for this run — CNIPA register rows,`,
    `native-script candidate forms, sub-class (similarity-group) notes, and platform search findings.`,
    `Read it as a Chinese trademark practitioner would and emit up to ${MAX_ITEMS} items via the`,
    `emit_read_items tool:`,
    `- "conflict-read": what a specific register record actually is (goods coverage, sub-class overlap,`,
    `  status nuance a Latin-only read misses) — record_uri REQUIRED, from the slice;`,
    `- "subclass-note": CNIPA similarity-group practice that changes how close a class conflict really is;`,
    `- "squatter-flag": a filing pattern consistent with bad-faith squatting (portfolio of foreign marks,`,
    `  timing, shell owner) — record_uri REQUIRED, from the slice;`,
    `- "cultural-note": a meaning/connotation of the mark or a candidate form that matters commercially.`,
    `Rules: analysis and grounds in ENGLISH; record_uri must be COPIED from the slice, never constructed;`,
    `severity_hint is a triage hint for the reviewing lawyer, NOT a rating — the rating authority is`,
    `elsewhere; NEVER pad — fewer grounded items beat ${MAX_ITEMS} speculative ones; if the slice supports`,
    `no items, emit an empty list.`,
    ``,
    `=== EVIDENCE SLICE ===`,
    String(payload),
  ].join("\n");
  return {
    model,
    max_tokens: 4096,   // 12 grounded items with grounds quotes need headroom; truncation checked either way
    tools: [NATIVEREAD_TOOL],
    tool_choice: { type: "tool", name: NATIVEREAD_TOOL.name },   // FORCED tool answer; shape validated at parse
    messages: [{ role: "user", content: prompt }],
  };
}

/** Extract read items from a Messages response (pure). ANY shape miss → [] (fallback-on-empty);
 *  every field clamped — free text is bounded before it can ride into any ledger or block. */
export function parseReadItems(responseJson) {
  try {
    const blocks = Array.isArray(responseJson?.content) ? responseJson.content : [];
    const tool = blocks.find((b) => b?.type === "tool_use" && b?.name === NATIVEREAD_TOOL.name);
    const rows = tool?.input?.items;
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((r) => r && ITEM_KINDS.includes(r.kind) && SEVERITY_HINTS.includes(r.severity_hint)
        && typeof r.analysis_en === "string" && r.analysis_en.trim())
      .slice(0, MAX_ITEMS)
      .map((r) => ({
        kind: r.kind,
        record_uri: typeof r.record_uri === "string" && r.record_uri.trim() ? r.record_uri.trim().slice(0, 600) : null,
        analysis_en: r.analysis_en.trim().slice(0, 700),
        severity_hint: r.severity_hint,
        grounds_en: String(r.grounds_en ?? "").trim().slice(0, 500),
      }));
  } catch { return []; }
}

/** The one-call convenience the driver adapter uses: build → call → parse → usage rollup. */
export async function generateReadItems({ mark, lane = "zh", payload, turn }) {
  const started = Date.now();
  const body = buildNativereadRequest({ mark, lane, payload });
  return runJxTurn({ body, turn, kind: "jx-nativeread", started,
    truncatedCause: "response truncated at the output ceiling — the read is not trustworthy",
    parse: (envelope) => ({ items: parseReadItems(envelope) }) });
}
