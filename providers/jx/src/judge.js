// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// providers/jx/src/judge.js — the SERP-grid hit judge: ONE non-agentic, schema-enforced Anthropic
// Messages call that classifies raw platform-search hits into the closed use-evidence taxonomy.
// PURE module — transport via ./core.js, injectable fetchImpl, no driver imports, offline-testable.
//
// Authority split (structural): retrieval is code-side (providers/serpapi — no model in
// the data path); the judge only CLASSIFIES the hits code already fetched and receipted. It never
// searches, never invents a hit, and its output merges by hit id — a judgment for an id that was
// never sent is dropped at parse. Register-MIRROR pages (tmkoo-class trademark-data sites) are
// demoted CODE-SIDE before the judge ever sees them (driver/jx-lanes.mjs mirror table): the
// guarantee that "a register record page never classifies as use" is enforced by exclusion, not by
// trusting a model to follow an instruction.

import { DEFAULT_MODEL } from "./core.js";
import { runJxTurn } from "./turn-envelope.mjs";

export const JUDGE_BATCH = 40;   // hits per call — bounded input, bounded output
export const HIT_CLASSES = ["use-evidence", "listing-candidate", "register-record", "news-editorial", "unrelated"];

export const JUDGE_TOOL = {
  name: "emit_judgments",
  description: "Classify every numbered hit. Emit ONLY this tool call.",
  input_schema: {
    type: "object",
    required: ["judgments"],
    additionalProperties: false,
    properties: {
      judgments: {
        type: "array",
        maxItems: JUDGE_BATCH,
        items: {
          type: "object",
          required: ["id", "classification", "note"],
          additionalProperties: false,
          properties: {
            id: { type: "integer", description: "the hit's number from the list, verbatim" },
            classification: { type: "string", enum: HIT_CLASSES },
            note: { type: "string", description: "one clause: what the page appears to be" },
          },
        },
      },
    },
  },
};

/** Assemble the Messages API body (pure). `hits` = [{id, term, platform, title, url, snippet}] —
 *  already mirror-filtered by the caller; ids are the caller's, echoed back for the merge. */
export function buildJudgeRequest({ mark, hits, model = DEFAULT_MODEL }) {
  if (!String(mark ?? "").trim()) throw new Error("jx-judge: mark is required");
  const rows = Array.isArray(hits) ? hits.slice(0, JUDGE_BATCH) : [];
  if (!rows.length) throw new Error("jx-judge: hits are required — an empty batch has nothing to judge");
  const prompt = [
    `Mark under trademark clearance: "${String(mark).trim()}".`,
    ``,
    `Below are ${rows.length} search hits from Chinese e-commerce platforms and the general Chinese web,`,
    `found while searching the mark and its Chinese-script forms. Classify EVERY hit via the`,
    `emit_judgments tool (one judgment per id, ids verbatim):`,
    `- "use-evidence": an actual product/store/listing page appearing to USE this or a confusingly`,
    `  similar sign in trade;`,
    `- "listing-candidate": commerce-adjacent and possibly relevant, but the title/snippet alone`,
    `  cannot confirm use — needs a human look;`,
    `- "register-record": a trademark-register entry, register-mirror, IP-database or filing-data page;`,
    `- "news-editorial": news, editorial, forum or informational content about the term;`,
    `- "unrelated": none of the above / a different sense of the term.`,
    `Rules: judge ONLY from the title/URL/snippet given — never assume beyond them; when torn between`,
    `"use-evidence" and "listing-candidate", pick "listing-candidate" (the lawyer escalates, you don't);`,
    `a register/IP-data page is ALWAYS "register-record", never use.`,
    ``,
    `=== HITS ===`,
    ...rows.map((h) => [
      `[${h.id}] term "${String(h.term ?? "").slice(0, 60)}" on ${String(h.platform ?? "").slice(0, 60)}`,
      `    title: ${String(h.title ?? "").slice(0, 200)}`,
      `    url: ${String(h.url ?? "").slice(0, 300)}`,
      `    snippet: ${String(h.snippet ?? "").slice(0, 300)}`,
    ].join("\n")),
  ].join("\n");
  return {
    model,
    max_tokens: 4096,   // 40 one-clause judgments fit well inside; truncation checked either way
    tools: [JUDGE_TOOL],
    tool_choice: { type: "tool", name: JUDGE_TOOL.name },   // FORCED tool answer; shape validated at parse
    messages: [{ role: "user", content: prompt }],
  };
}

/** Extract judgments (pure). ANY shape miss → []; only ids the caller actually sent survive the
 *  merge (`sentIds`), so the judge can never mint a judgment for a hit that does not exist. */
export function parseJudgments(responseJson, { sentIds = null } = {}) {
  try {
    const blocks = Array.isArray(responseJson?.content) ? responseJson.content : [];
    const tool = blocks.find((b) => b?.type === "tool_use" && b?.name === JUDGE_TOOL.name);
    const rows = tool?.input?.judgments;
    if (!Array.isArray(rows)) return [];
    const allowed = sentIds instanceof Set ? sentIds : sentIds ? new Set(sentIds) : null;
    const seen = new Set();
    return rows
      .filter((r) => r && Number.isInteger(r.id) && HIT_CLASSES.includes(r.classification))
      .filter((r) => (allowed ? allowed.has(r.id) : true))
      .filter((r) => (seen.has(r.id) ? false : seen.add(r.id)))
      .slice(0, JUDGE_BATCH)
      .map((r) => ({ id: r.id, classification: r.classification, note: String(r.note ?? "").slice(0, 200) }));
  } catch { return []; }
}

/** The one-call convenience the driver adapter uses: build → call → parse → usage rollup. */
export async function judgeHits({ mark, hits, turn }) {
  const started = Date.now();
  const body = buildJudgeRequest({ mark, hits });
  return runJxTurn({ body, turn, kind: "jx-judge", started,
    truncatedCause: "response truncated at the output ceiling — the judgment set is incomplete",
    // AN UNREADABLE ANSWER IS NOT "no adverse hits". runJxTurn refuses before this runs; the only way
    // to reach it is an answer object that parsed, so an empty list here is the model's own answer.
    parse: (envelope) => ({ judgments: parseJudgments(envelope, { sentIds: hits.map((h) => h.id) }) }) });
}
