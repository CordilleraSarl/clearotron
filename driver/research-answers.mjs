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
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";

export const RESEARCH_ANSWERS_FILE = "research-answers.jsonl";

// ── A SEARCH THAT DID NOT ANSWER SUPPLIES NO RESULT ───────────────────────────────────────────────────────────────────
//
// On a test run, a writer whose every research question was refused recorded "no result" on eleven findings and a low
// enforcement likelihood on fourteen, because its instruction for an outage was to write the no-result line and proceed. The
// ruled replacement (design, 2026-10-28) is this sentence, word for word. It is model-facing: the writer's message
// carries it where the outage instruction stood, the manual's Step 3.5 carries the same words, and the writer's
// correction and its record's refusal hand it back unchanged. It changes only as model-facing wording does.
export const NO_SEARCH_RESULT = "A search that failed, was refused, was not asked, or has no available saved answer supplies no search result. "
  + "Use relevant evidence already held, and leave any remaining use or enforcement question unknown. "
  + "Never describe the unanswered question as a search that found no result, no use, or no enforcement, and do not infer a low "
  + "enforcement likelihood from that failure. Record no-result only when a completed search actually returned no result. "
  + "Preserve unaffected findings and complete the report from the evidence available.";

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
 *
 * `ofRun` widens it to every stage of this run: the writer is told to use an answer this run already holds, from an
 * earlier stage as from an earlier attempt, and it cannot open `_driver/` itself. The record is the run's own file, so
 * nothing another run asked can be in it.
 * @returns {{ task: string, text: string, ts: string }[]}
 */
export function researchAnswersFor(runDir, sessionKey, { ofRun = false } = {}) {
  if (!runDir || !sessionKey) return [];
  let raw = "";
  try { raw = readFileSync(driverDir(runDir, RESEARCH_ANSWERS_FILE), "utf8"); } catch { return []; }
  const own = (s) => s === sessionKey || (typeof s === "string" && s.startsWith(`${sessionKey}-rerun`) && /^\d+$/.test(s.slice(`${sessionKey}-rerun`.length)));
  const byTask = new Map();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if ((!ofRun && !own(row?.session)) || typeof row.task !== "string" || !row.task.trim() || !isResearchAnswer(row.text)) continue;
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
export function handResearchAnswers(runDir, sessionKey, opts = {}) {
  const answers = researchAnswersFor(runDir, sessionKey, opts);
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
  return `RESEARCH THIS RUN HAS ALREADY ANSWERED: earlier stages or attempts of this run ${asked}. They are in ${RESEARCH_ANSWERS_MD}, `
    + "one question and its answer per line. Before you ask about a finding's owner and mark, search that file for the owner's name "
    + "with search_run_artifacts. Where one of them answers the same owner, mark, goods, territory and material time question, use its answer as "
    + "that finding's check, cite its URL and record it as you would a fresh one; ask only what none of them covers.";
}

// ── A REPLAY ANSWERS FROM THE RUN'S OWN RESEARCH, AND ASKS NOTHING NEW ────────────────────────────────────────────────
//
// A stage replayed offline in the experiment sandbox would send its research questions out again: a cost, and an
// answer that is not the one the run got. With `--research replay` the sandbox holds the run's own answers and says so
// in this marker, and the research server answers a question the run already asked from what the run got, and refuses
// a question it did not ask, sending nothing out. Only the sandbox writes the marker; a run never does.
export const RESEARCH_REPLAY_FILE = "research-replay.json";

/** True when this run folder is a replay of a run's research. IMPURE (reads the marker). */
export const researchReplayOn = (runDir) => Boolean(runDir) && existsSync(driverDir(runDir, RESEARCH_REPLAY_FILE));

/**
 * The run's latest answer to exactly this question, whichever of its stages asked it, or null. The question is
 * matched as written, trimmed at its ends: a question worded differently is a new question. IMPURE (reads the record).
 */
export function savedResearchAnswer(runDir, task) {
  const want = typeof task === "string" ? task.trim() : "";
  if (!runDir || !want) return null;
  let raw = "";
  try { raw = readFileSync(driverDir(runDir, RESEARCH_ANSWERS_FILE), "utf8"); } catch { return null; }
  let found = null;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (typeof row?.task !== "string" || row.task.trim() !== want || !isResearchAnswer(row.text)) continue;
    if (!found || String(row.ts ?? "") >= String(found.ts ?? "")) found = { task: row.task, text: row.text, ts: String(row.ts ?? ""), session: row.session ?? null };
  }
  return found;
}

// ── A "NO RESULT" NAMES THE COMPLETED QUESTION IT RESTS ON ─────────────────────────────────────────────────────────────
//
// A no-result is a claim about one question, so it is joined to that question: the writer names the research question
// whose completed answer returned it, and the record looks for a completed answer to that question among the ones this
// writer holds. A successful search about one owner never makes a failed one about another look successful. The code
// checks that the question completed; what its answer supports is the model's to judge.
//
// WHAT THE WRITER HOLDS: the answers it was handed (research-answers.md: earlier stages and attempts), and the questions
// its own stage's sessions completed, as the research log records them, a replayed answer among them. Its sessions are
// one base key and the retries the gateway mints from it, `-rerun<n>`, chained when a correction resumes a retry: the
// correction after the review counts the main pass's answers, and the main pass's a retry's. A bank of saved answers it
// was neither handed nor given by the tool is not held: a replay's copy carries the whole run's answers, its own stage's
// later answers among them, and those are not evidence already held.

/** A question as the join reads it: whitespace folded, enclosing quotes and closing punctuation dropped, case ignored. PURE. */
export const questionKey = (q) => String(q ?? "").replace(/\s+/g, " ").trim()
  .replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, "").replace(/[\s.?!]+$/, "").toLowerCase();

const lines = (p) => { try { return readFileSync(p, "utf8").split("\n"); } catch { return []; } };
const rows = (p) => lines(p).flatMap((l) => { if (!l.trim()) return []; try { return [JSON.parse(l)]; } catch { return []; } });

/** Whether two session keys are one stage's: the same key once every `-rerun<n>` the gateway added is taken off. PURE. */
export const sameStageSession = (a, b) => {
  const base = (s) => String(s ?? "").replace(/(-rerun\d+)+$/, "");
  return Boolean(a) && Boolean(b) && typeof a === "string" && typeof b === "string" && base(a) === base(b);
};

/**
 * The research questions this writer holds a completed answer to, keyed by `questionKey`, each with its question as asked,
 * its answer where the run kept it, and `from`: "handed" or "asked". `sessionKey` is the writer's session, and every
 * session of its stage counts (`sameStageSession`). With no session, only what was handed is held. null when there is no
 * run. IMPURE.
 */
export function heldResearchAnswers(runDir, sessionKey = null) {
  if (!runDir) return null;
  const held = new Map();
  const put = (question, answer, from) => { const k = questionKey(question); if (k && !held.has(k)) held.set(k, { question: oneLine(question), answer, from }); };
  for (const l of lines(join(runDir, RESEARCH_ANSWERS_MD))) {
    const m = l.match(/^Question (\d+): (.*?) Answer \1: (.*)$/);
    if (m && isResearchAnswer(m[3])) put(m[2], m[3], "handed");
  }
  const own = (s) => sameStageSession(s, sessionKey);
  const kept = rows(driverDir(runDir, RESEARCH_ANSWERS_FILE));
  for (const r of kept) if (own(r?.session) && typeof r.task === "string" && isResearchAnswer(r.text)) put(r.task, oneLine(r.text), "asked");
  for (const r of rows(driverDir(runDir, "reading-log.jsonl"))) {
    if (r?.tool !== "perplexity_research" || r.ok !== true || !own(r.session) || r.args?.grid || typeof r.args?.task !== "string") continue;
    // A replayed answer is the run's own, read from its bank: the text is there, under the session that first asked it.
    const text = kept.filter((x) => typeof x?.task === "string" && x.task.trim() === r.args.task.trim() && isResearchAnswer(x.text)).pop()?.text ?? null;
    put(r.args.task, text == null ? null : oneLine(text), "asked");
  }
  return held;
}

// The correction a writer is sent for a use check, after the ruled sentence for a search that did not answer (design,
// 2026-10-28), word for word. It corrects what depends on the finding as well as the finding, so it never says to leave
// the narrative as it is. Model-facing: it changes only as model-facing wording does.
export const RESEARCH_CORRECTION = "Correct the affected findings and any narrative, answers, actions or conclusions that depend on them. "
  + "If the driver already holds an accepted record, use record_synthesis to send only the corrected findings, affected narrative "
  + "sections and changed registers. Otherwise complete the initial recording with the corrected values. Preserve unaffected work.";

/** How many questions the run's record answers: the experiment refuses a replay with nothing to replay. IMPURE. */
export function savedResearchCount(runDir) {
  let raw = "";
  try { raw = readFileSync(driverDir(runDir, RESEARCH_ANSWERS_FILE), "utf8"); } catch { return 0; }
  const tasks = new Set();
  for (const line of raw.split("\n")) {
    try { const row = JSON.parse(line); if (typeof row?.task === "string" && row.task.trim() && isResearchAnswer(row.text)) tasks.add(row.task.trim()); }
    catch { /* a torn line answers nothing */ }
  }
  return tasks.size;
}
