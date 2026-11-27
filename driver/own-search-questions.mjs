// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// own-search-questions.mjs — the driver answers a run's stage questions with the run's own AI program.
//
// On a run whose searches are its own AI program's, a stage's research question reaches the driver as a request file
// (engine/mcp/own-question-channel.mjs). While the run is in this process, the driver watches its folder and answers
// each request with a research-only session of the run's engine, on the tier ruled for the run's product
// (engine/mcp/own-search.mjs, QUESTION_TIERS), never a lesser one. A product with no ruled tier, a run that was
// stopped, or a session that fails is answered as not answered, with why.
//
// ONE WATCHER PER RUN, started when the run opens and stopped when its segment ends (pipeline.mjs), so a resumed run
// is served too. It asks at most `concurrency` questions at once: the common-law halves ask side by side.
import { answerRequest, pendingRequests, QUESTION_SESSION_SEC } from "./engine/mcp/own-question-channel.mjs";
import { ownSearchOn, ownSearchQuestioner, QUESTION_TIERS } from "./engine/mcp/own-search.mjs";
import { stopsWithTheRun } from "./cancel.mjs";
import { paths, readJson } from "./run-record.mjs";

const serving = new Map();

/** The question tier ruled for the run's product, from its frozen search policy, or null. IMPURE (reads). */
export function runQuestionTier(runDir) {
  let level = null;
  try { level = readJson(paths(runDir).searchPolicy)?.level ?? null; } catch { return null; }
  return (level && QUESTION_TIERS[level]) || null;
}

/**
 * Start answering `runDir`'s stage questions, where its searches are its own AI program's; returns the function that
 * stops it. A second call for a run already served returns the same stop. Nothing is asked until a request arrives.
 * IMPURE.
 */
export function serveOwnQuestions(runDir, { makeSessions, pollMs = 500, concurrency = 2, tierOf = runQuestionTier } = {}) {
  if (!runDir || !ownSearchOn(runDir)) return () => {};
  if (serving.has(runDir)) return serving.get(runDir);
  const inflight = new Set();
  let ask = null;
  const answer = async (task) => {
    const tier = tierOf(runDir);
    if (!tier) return { ok: false, cause: "own search: no question tier is ruled for this run's product" };
    ask ??= stopsWithTheRun(runDir, "own-search-question",
      ownSearchQuestioner(runDir, { tier, timeoutSec: QUESTION_SESSION_SEC, ...(makeSessions ? { makeSessions } : {}) }));
    return ask(task);
  };
  const tick = () => {
    for (const r of pendingRequests(runDir)) {
      if (inflight.has(r.id) || inflight.size >= concurrency) continue;
      inflight.add(r.id);
      answer(r.task)
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
