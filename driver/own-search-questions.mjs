// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// own-search-questions.mjs — the driver answers a run's stage questions, and prepares the grids a stage asks for
// mid-run, with the run's own AI program.
//
// On a run whose searches are its own AI program's, a stage's research question, or a grid the driver did not prepare
// before the stage, reaches the driver as a request file (engine/mcp/own-question-channel.mjs). While the run is in this
// process, the driver watches its folder. It answers a question with a research-only session of the run's engine, on
// the tier ruled for the run's product (engine/mcp/own-search.mjs, QUESTION_TIERS), never a lesser one, in the time the
// server's wait has left; it prepares a grid as it prepares one before its stage. A product with no ruled tier, a run
// that was stopped, a question with too little time left, or a session that fails is answered as not answered, with
// why. A request the server has withdrawn gets no answer.
//
// ONE WATCHER PER RUN, started when the run opens and stopped when its segment ends (pipeline.mjs), so a resumed run
// is served too. It asks at most `concurrency` questions at once: the common-law halves ask side by side.
import { answerRequest, pendingRequests, questionTimeLeft, QUESTION_SESSION_SEC } from "./engine/mcp/own-question-channel.mjs";
import { makeOwnSearchSessions, ownSearchOn, ownSearchQuestioner, prepareOwnSearchGrid, QUESTION_TIERS } from "./engine/mcp/own-search.mjs";
import { driverDir } from "../shared/driver-dir.mjs";
import { insideRun } from "../shared/inside-run.mjs";
import { stopsWithTheRun } from "./cancel.mjs";
import { paths, readJson } from "./run-record.mjs";

const serving = new Map();

/** The question tier ruled for the run's product, from its frozen search policy, or null. An experiment's shadow folder reads its run's. IMPURE (reads). */
export function runQuestionTier(runDir) {
  for (const dir of [runDir, String(runDir).split("/_experiments/")[0]]) {
    let level = null;
    try { level = readJson(paths(dir).searchPolicy)?.level ?? null; } catch { continue; }
    if (level) return QUESTION_TIERS[level] ?? null;
  }
  return null;
}

/**
 * Start answering `runDir`'s stage questions, where its searches are its own AI program's; returns the function that
 * stops it. A second call for a run already served returns the same stop. Nothing is asked until a request arrives.
 * IMPURE.
 */
export function serveOwnQuestions(runDir, { makeSessions, pollMs = 500, concurrency = 2, tierOf = runQuestionTier, now = Date.now } = {}) {
  if (!runDir || !ownSearchOn(runDir)) return () => {};
  if (serving.has(runDir)) return serving.get(runDir);
  const inflight = new Set();
  let ask = null, gridSessions = null;
  const question = async (r) => {
    const tier = tierOf(runDir);
    if (!tier) return { ok: false, cause: "own search: no question tier is ruled for this run's product" };
    const left = questionTimeLeft(r.askedAt, { now: now() });
    if (!left) return { ok: false, cause: "own search: not run, too little of the stage's wait was left once earlier questions were answered" };
    ask ??= stopsWithTheRun(runDir, "own-search-question",
      ownSearchQuestioner(runDir, { tier, timeoutSec: QUESTION_SESSION_SEC, ...(makeSessions ? { makeSessions } : {}) }));
    return ask(r.task, { timeoutSec: left });
  };
  // A GRID A STAGE ASKED FOR THAT THE DRIVER DID NOT PREPARE, a repair's supplementary grid among them: prepared now as
  // before a stage, on the sweep's own sessions, when its spec is this run's.
  const grid = async (r) => {
    if (!insideRun(runDir, r.grid)) return { ok: false, cause: "own search: the grid's spec is outside this run's folder" };
    gridSessions ??= Promise.resolve((makeSessions ?? makeOwnSearchSessions)({ runDir, sessionDir: driverDir(runDir, "own-search-sessions") }));
    const sessions = await stopsWithTheRun(runDir, "own-search-grid", async () => gridSessions)();
    if (!sessions?.session) return { ok: false, cause: `own search: ${sessions?.error ?? "no research-only session on this run"}` };
    const p = await prepareOwnSearchGrid(runDir, r.grid, { sessions });
    return p.prepared || p.why === "recorded" ? { ok: true } : { ok: false, cause: `own search: the grid was not prepared: ${p.why}` };
  };
  const tick = () => {
    for (const r of pendingRequests(runDir)) {
      if (inflight.has(r.id) || inflight.size >= concurrency) continue;
      inflight.add(r.id);
      (r.grid ? grid(r) : question(r))
        .catch((e) => ({ ok: false, cause: e?.name === "RunCancelled" ? "own search: the run was stopped" : `own search: ${String(e?.message ?? e).slice(0, 160)}` }))
        .then((a) => { try { answerRequest(runDir, r.id, a); } catch { /* the server's wait ends it as not answered */ } })
        .finally(() => inflight.delete(r.id));
    }
  };
  const timer = setInterval(tick, pollMs);
  timer.unref?.();
  const stop = () => { clearInterval(timer); serving.delete(runDir); };
  serving.set(runDir, stop);
  return stop;
}

/** Stop answering `runDir`'s questions, where they are being answered. IMPURE. */
export function stopServingOwnQuestions(runDir) {
  if (runDir) serving.get(runDir)?.();
}
