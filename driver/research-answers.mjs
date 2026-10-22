// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// research-answers.mjs — each research answer a stage got, kept in the run beside its question, so a later attempt of
// the stage can be handed what an earlier one already learned.
//
// A stage attempt that times out takes its research answers with it: the text the model read lived only in its turn.
// On a test run of a crowded matter, the writer's first attempt timed out after 112 research questions, and about 97 of
// its retry's 179 questions re-checked an owner the first attempt had already answered. The research server now keeps
// each answer's text, in the run folder and nowhere else, as it keeps the raw results under `_driver/web-results/`: it
// is the matter's own content. The call log (`reading-log.jsonl`) still records only what was asked and the answer's
// shape.
//
// ONLY ANSWERS ARE KEPT. A call that failed is no answer, and neither is the error text the formatter returns for a
// response it could not read: both are asked again. An honest "no result" is an answer, and is kept.
//
// A STAGE'S OWN ANSWERS ARE ITS SESSION'S. The research server records the session it serves: the stage's key, or the
// key of a retry of it (`<key>-rerun<n>`). Another stage's answers, or another session that merely shares a suffix, are
// never a stage's own.
//
// A pure leaf: node:fs, node:path and shared/driver-dir.mjs only, so the research server can import it.
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";

export const RESEARCH_ANSWERS_FILE = "research-answers.jsonl";

/** True for a reply that is an answer: text the formatter did not turn into its own error. PURE. */
export const isResearchAnswer = (text) => typeof text === "string" && text.trim() !== "" && !text.trimStart().startsWith("ERROR");

/**
 * Keep one research answer beside its question, under the run's `_driver/`. Nothing is kept for a reply that is not an
 * answer, or outside a run. Best-effort: a failed write never fails a lookup. IMPURE.
 */
export function keepResearchAnswer(runDir, { session = null, agent = null, task, preset = null, text }) {
  if (!runDir || !isResearchAnswer(text) || typeof task !== "string" || !task.trim()) return;
  try {
    const p = driverDir(runDir, RESEARCH_ANSWERS_FILE);
    mkdirSync(dirname(p), { recursive: true });
    appendFileSync(p, JSON.stringify({ ts: new Date().toISOString(), ...(session ? { session } : {}), ...(agent ? { agent } : {}),
      task, ...(preset ? { preset } : {}), text }) + "\n");
  } catch { /* best-effort — a failed write must never break a lookup */ }
}

/**
 * The research answers the session `sessionKey` and its retries got, oldest first, one per question: the latest answer
 * to each exact question. [] when there are none, or no record. A torn line is skipped. IMPURE (reads the record).
 * @returns {{ task: string, text: string, ts: string }[]}
 */
export function researchAnswersFor(runDir, sessionKey) {
  if (!runDir || !sessionKey) return [];
  let raw = "";
  try { raw = readFileSync(driverDir(runDir, RESEARCH_ANSWERS_FILE), "utf8"); } catch { return []; }
  const own = (s) => s === sessionKey || (typeof s === "string" && s.startsWith(`${sessionKey}-rerun`) && /^\d+$/.test(s.slice(`${sessionKey}-rerun`.length)));
  const byTask = new Map();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (!own(row?.session) || typeof row.task !== "string" || !row.task.trim() || !isResearchAnswer(row.text)) continue;
    byTask.delete(row.task);   // the latest answer to a question takes the place of an earlier one
    byTask.set(row.task, { task: row.task, text: row.text, ts: String(row.ts ?? "") });
  }
  return [...byTask.values()].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
}
