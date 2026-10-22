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
// A LATER ATTEMPT IS HANDED THEM AS A FILE, never in its message. On that test run the first attempt's answers came to
// about 280 KB with their questions, beside a 268 KB message, and a resumed pass after two failed attempts would carry
// both. So they are written to `research-answers.md` in the run folder, one question and its answer per line, and the
// message says how many there are and how to find one: by the owner's name, with the artifact search the stage holds.
// A first attempt has none, and its message is unchanged.
//
// A pure leaf: node:fs, node:path and shared/driver-dir.mjs only, so the research server can import it.
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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

/** The file a later attempt is handed, in the run folder, where the artifact search reaches and `_driver/` is not. */
export const RESEARCH_ANSWERS_MD = "research-answers.md";

const oneLine = (s) => String(s ?? "").replace(/\s*\n\s*/g, " ").trim();

/** One question and its answer on one line, as the artifact search hands back a line: line breaks become spaces. PURE. */
export const researchAnswerLine = (n, { task, text }) => `Question ${n}: ${oneLine(task)} Answer ${n}: ${oneLine(text)}`;

/**
 * Hand a later attempt of the stage the answers its earlier attempts got: write them to `research-answers.md` in the run
 * folder, one question and its answer per line, and return how many. Nothing is written when there are none, and 0 is
 * returned when the file could not be written: a message must never name a file that is not there. IMPURE.
 */
export function handResearchAnswers(runDir, sessionKey) {
  const answers = researchAnswersFor(runDir, sessionKey);
  if (!answers.length) return 0;
  try {
    const p = join(runDir, RESEARCH_ANSWERS_MD);
    writeFileSync(`${p}.tmp`, answers.map((a, i) => researchAnswerLine(i + 1, a)).join("\n") + "\n");
    renameSync(`${p}.tmp`, p);
  } catch { return 0; }
  return answers.length;
}

/**
 * The block a later attempt's message ends with, or "" when it was handed no answers. The model reads it, so its words
 * change only as model-facing wording does. PURE.
 */
export function researchAnsweredBlock(n) {
  if (!(n > 0)) return "";
  const asked = n === 1 ? "asked 1 question and got its answer" : `asked ${n} questions and got their answers`;
  return `RESEARCH THIS RUN HAS ALREADY ANSWERED: an earlier attempt of this stage ${asked}. They are in ${RESEARCH_ANSWERS_MD}, `
    + "one question and its answer per line. Before you ask about a finding's owner and mark, search that file for the owner's name "
    + "with search_run_artifacts. Where one of them asked about that owner and mark for the same field and country, use its answer as "
    + "that finding's check, cite its URL and record it as you would a fresh one; ask only what none of them covers.";
}
