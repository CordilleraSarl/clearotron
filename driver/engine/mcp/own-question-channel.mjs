// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// own-question-channel.mjs — a stage's research question, handed from the research tool server to the driver that
// answers it with the run's own AI program.
//
// On a run whose searches are its own AI program's, a question a stage asks through the research tool is not answered
// by the tool server: a session of the run's engine answers it, and a tool server is never handed the engine's sign-in
// or billing settings. So the server writes the question as a request file in the run's own folder and waits; the
// driver, which holds the run's sessions, answers it (driver/own-search-questions.mjs) and writes the answer file
// beside it. Files, not a socket: a socket's path is limited in length, and the product runs on Windows. Each request
// lives in its run's folder, so a driver answers only its own runs' questions.
//
// A LEAF THAT READS NO SETTING, imported by the tool server and the driver alike, so the two agree on the files'
// names and shapes in one place.
//
// THE WAIT IS INSIDE THE STAGE'S. A stage's tool call waits on the answer as it waits on the other service's deep
// research, and the engine's clocks keep running: the shortest no-progress limit of a stage that asks is 600 s. So the
// server waits QUESTION_WAIT_SEC at most, the session that answers is limited to QUESTION_SESSION_SEC, and a question
// with no answer in time is recorded as not answered, with why, never as an answer.
import { existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { driverDir, ensureDriverDir } from "../../../shared/driver-dir.mjs";

export const QUESTIONS_DIR = "own-questions";
export const QUESTION_WAIT_SEC = 540;
export const QUESTION_SESSION_SEC = 480;

const REQUEST = ".request.json", ANSWER = ".answer.json";
const dirOf = (runDir) => driverDir(runDir, QUESTIONS_DIR);
export const requestFile = (runDir, id) => join(dirOf(runDir), `${id}${REQUEST}`);
export const answerFile = (runDir, id) => join(dirOf(runDir), `${id}${ANSWER}`);
const writeWhole = (file, value) => { writeFileSync(`${file}.tmp`, JSON.stringify(value) + "\n"); renameSync(`${file}.tmp`, file); };
const readOrNull = (file) => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; } };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The tool server's half: write `task` as a request in `runDir`'s folder and wait for its answer, at most `waitSec`.
 * Returns the answer the driver wrote (`{ ok, text, cause, service, model, speed, sources }`), or `{ ok: false, cause }`
 * where none came in time, and then withdraws the request so no driver answers it late. IMPURE.
 */
export async function askTheDriver(runDir, task, { session = null, agent = null, waitSec = QUESTION_WAIT_SEC, pollMs = 500, now = Date.now, sleep = pause } = {}) {
  const id = `${now()}-${process.pid}-${randomBytes(4).toString("hex")}`;
  ensureDriverDir(runDir, QUESTIONS_DIR);
  writeWhole(requestFile(runDir, id), { id, task, session, agent, askedAt: new Date(now()).toISOString() });
  const deadline = now() + waitSec * 1000;
  while (now() < deadline) {
    const a = existsSync(answerFile(runDir, id)) ? readOrNull(answerFile(runDir, id)) : null;
    if (a) return a;
    await sleep(pollMs);
  }
  try { rmSync(requestFile(runDir, id), { force: true }); } catch { /* withdrawn or never written */ }
  return { ok: false, cause: `own search: no answer within ${waitSec} s` };
}

/** The driver's half: the requests in `runDir`'s folder with no answer yet, oldest first, none older than `maxAgeSec`. IMPURE (reads). */
export function pendingRequests(runDir, { now = Date.now, maxAgeSec = QUESTION_WAIT_SEC } = {}) {
  let names;
  try { names = readdirSync(dirOf(runDir)); } catch { return []; }
  const out = [];
  for (const name of names.filter((n) => n.endsWith(REQUEST)).sort()) {
    const id = name.slice(0, -REQUEST.length);
    if (existsSync(answerFile(runDir, id))) continue;
    let age;
    try { age = (now() - statSync(requestFile(runDir, id)).mtimeMs) / 1000; } catch { continue; }
    if (age > maxAgeSec) continue;
    const r = readOrNull(requestFile(runDir, id));
    if (r && typeof r.task === "string" && r.task.trim()) out.push({ ...r, id });
  }
  return out;
}

/** The driver's answer to one request, written whole so the server never reads half of it. IMPURE. */
export function answerRequest(runDir, id, answer) {
  writeWhole(answerFile(runDir, id), { id, ...answer });
}
