// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A STAGE'S QUESTION ON OWN SEARCH IS ANSWERED BY THE DRIVER, OR NOT AT ALL (engine/mcp/own-question-channel.mjs,
// own-search-questions.mjs).
//
// The research server writes the question into the run's folder and waits; the driver answers it with the run's own
// program on the tier ruled for the run's product. A question with no answer in time is withdrawn, so no driver answers
// it late, and the server reports it as not answered. The driver serves only runs on own search, answers at most its
// limit at once, never a request older than the server waits, and stops when told. Every name is invented.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { answerRequest, askTheDriver, pendingRequests, questionTimeLeft, requestFile, QUESTION_WAIT_SEC, QUESTION_SESSION_SEC, MIN_QUESTION_SEC } from "../engine/mcp/own-question-channel.mjs";
import { runQuestionTier, serveOwnQuestions, stopServingOwnQuestions } from "../own-search-questions.mjs";
import { cancelPath } from "../cancel.mjs";
import { QUESTION_TIERS, questionModel } from "../engine/mcp/own-search.mjs";

const TEMP = [];
after(() => { for (const d of TEMP) rmSync(d, { recursive: true, force: true }); });
function aRun({ research = "own", level = null, engine = "anthropic-agent" } = {}) {
  const d = mkdtempSync(join(tmpdir(), "own-question-")); TEMP.push(d);
  mkdirSync(join(d, "_driver"), { recursive: true });
  writeFileSync(join(d, "_driver", "run-choices.json"), JSON.stringify({ schema: 1, engine, register: null, ...(research ? { research } : {}) }));
  if (level) writeFileSync(join(d, "_driver", "search-policy.json"), JSON.stringify({ schema: 1, level }));
  return d;
}
const until = async (cond, ms = 5000) => { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 20)); } };

test("the server's wait is inside the shortest stage limit, and the session's inside the wait", () => {
  assert.ok(QUESTION_WAIT_SEC < 600, "the shortest no-progress limit of a stage that asks is 600 s");
  assert.ok(QUESTION_SESSION_SEC < QUESTION_WAIT_SEC);
});

test("a question with no answer in time is withdrawn and reported as not answered", async () => {
  const runDir = aRun();
  let clock = 1_000_000;
  const r = await askTheDriver(runDir, "Does QZORVAK sell candles?", { waitSec: 3, pollMs: 1000, now: () => clock, sleep: async (ms) => { clock += ms; } });
  assert.deepEqual(r, { ok: false, cause: "own search: no answer within 3 s" });
  assert.deepEqual(pendingRequests(runDir), [], "the withdrawn request is not left for a driver to answer late");
});

test("the driver sees each unanswered request once, and never one older than the server waits", async () => {
  const runDir = aRun();
  const asking = askTheDriver(runDir, "Does QZORVAK sell candles?", { pollMs: 10 });
  await until(() => pendingRequests(runDir).length === 1);
  const [req] = pendingRequests(runDir);
  assert.equal(req.task, "Does QZORVAK sell candles?");
  answerRequest(runDir, req.id, { ok: true, text: "Yes.", service: "own:claude" });
  assert.deepEqual(await asking, { id: req.id, ok: true, text: "Yes.", service: "own:claude" });
  assert.deepEqual(pendingRequests(runDir), [], "an answered request is not pending");
  // A request left by a server that has already given up: older than its wait, and never answered.
  const stale = join(runDir, "_driver", "own-questions", "1-1-stale.request.json");
  writeFileSync(stale, JSON.stringify({ id: "1-1-stale", task: "old question" }));
  const old = (Date.now() - (QUESTION_WAIT_SEC + 60) * 1000) / 1000;
  utimesSync(stale, old, old);
  assert.deepEqual(pendingRequests(runDir), []);
});

test("the driver answers on the product's ruled tier, at most its limit at once, and stops when told", async () => {
  const runDir = aRun({ level: "full-country-search", engine: "openai-agent" });
  assert.equal(runQuestionTier(runDir), QUESTION_TIERS["full-country-search"]);
  assert.equal(questionModel(QUESTION_TIERS["full-country-search"], "openai-agent"), "gpt-6.2-sol");
  assert.equal(questionModel(QUESTION_TIERS["full-country-search"], "anthropic-agent"), "opus");
  let open = 0, most = 0, made = null;
  const release = [];
  const makeSessions = async (o) => { made = { model: o.model, thinking: o.thinking, timeoutSec: o.timeoutSec }; return { search: "codex", question: async (task) => {
    open++; most = Math.max(most, open);
    await new Promise((r) => release.push(r));
    open--;
    return { text: `answer to ${task}\nhttps://pages.example.com/1`, events: [{ type: "item.completed", item: { type: "web_search", action: { query: task }, results: [{ url: "https://pages.example.com/1" }] } }] };
  } }; };
  const stop = serveOwnQuestions(runDir, { makeSessions, pollMs: 20, concurrency: 2 });
  assert.equal(serveOwnQuestions(runDir), stop, "one watcher per run");
  try {
    const asks = ["one", "two", "three"].map((t) => askTheDriver(runDir, t, { pollMs: 20 }));
    await until(() => open === 2);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(most, 2, "no more than the limit at once");
    while ((await Promise.race([Promise.all(asks).then(() => "done"), new Promise((r) => setTimeout(() => r("wait"), 30))])) !== "done") release.splice(0).forEach((r) => r());
    const answers = await Promise.all(asks);
    assert.deepEqual(answers.map((a) => [a.ok, a.service, a.text.split("\n")[0]]),
      [[true, "own:codex", "answer to one"], [true, "own:codex", "answer to two"], [true, "own:codex", "answer to three"]]);
    assert.deepEqual(made, { model: "gpt-6.2-sol", thinking: "max", timeoutSec: QUESTION_SESSION_SEC }, "the run's engine's own model for the tier, inside the wait");
  } finally { stopServingOwnQuestions(runDir); }
  assert.notEqual(serveOwnQuestions(runDir, { makeSessions, pollMs: 20 }), stop, "a stopped run is served afresh");
  stopServingOwnQuestions(runDir);
});

test("a run not on own search is not watched, and a stopped run's question is answered as stopped", async () => {
  const notOwn = aRun({ research: "perplexity" });
  const noop = serveOwnQuestions(notOwn, { pollMs: 20 });
  const req = askTheDriver(notOwn, "q", { waitSec: 1, pollMs: 50 });
  assert.match((await req).cause, /no answer within 1 s/, "nothing answers a run that is not on own search");
  noop();
  const runDir = aRun({ level: "knockout-search" });
  writeFileSync(cancelPath(runDir), JSON.stringify({ by: "operator", at: new Date().toISOString() }));
  let asked = 0;
  const stop = serveOwnQuestions(runDir, { pollMs: 20, makeSessions: async () => ({ search: "claude", question: async () => { asked++; return { text: "x", events: [] }; } }) });
  try {
    const a = await askTheDriver(runDir, "q", { pollMs: 20, waitSec: 5 });
    assert.deepEqual({ ok: a.ok, cause: a.cause }, { ok: false, cause: "own search: the run was stopped" });
    assert.equal(asked, 0, "a stopped run asks its program nothing");
  } finally { stop(); }
});

test("a question behind others gets only the time the server's wait has left, and none is started with too little", async () => {
  const t0 = Date.parse("2026-11-27T10:00:00Z");
  assert.equal(questionTimeLeft(new Date(t0).toISOString(), { now: t0 }), QUESTION_SESSION_SEC, "a fresh question gets the session's whole limit");
  assert.equal(questionTimeLeft(new Date(t0).toISOString(), { now: t0 + 100_000 }), QUESTION_WAIT_SEC - 100 - 20, "one asked 100 s ago gets what is left, less a margin");
  assert.equal(questionTimeLeft(new Date(t0).toISOString(), { now: t0 + (QUESTION_WAIT_SEC - MIN_QUESTION_SEC) * 1000 }), 0, "too little left: not started");
  assert.equal(questionTimeLeft("not a time", { now: t0 }), 0);
  // Two requests already waiting when the driver picks them up: one asked 500 s ago, one 100 s ago.
  const runDir = aRun({ level: "global-preliminary-search" });
  mkdirSync(join(runDir, "_driver", "own-questions"), { recursive: true });
  const at = (sec) => new Date(Date.now() - sec * 1000).toISOString();
  for (const [id, sec] of [["1-late", 500], ["2-soon", 100]]) writeFileSync(requestFile(runDir, id), JSON.stringify({ id, task: `question ${id}`, askedAt: at(sec) }));
  const started = [];
  const stop = serveOwnQuestions(runDir, { pollMs: 20, makeSessions: async () => ({ search: "codex", question: async (task, o) => { started.push({ task, timeoutSec: o.timeoutSec });
    return { text: "An answer.\nhttps://pages.example.com/1", events: [{ type: "item.completed", item: { type: "web_search", action: { query: task }, results: [{ url: "https://pages.example.com/1" }] } }] }; } }) });
  try {
    await until(() => pendingRequests(runDir).length === 0);
    assert.equal(started.length, 1, "the question with too little time left was never started");
    assert.equal(started[0].task, "question 2-soon");
    assert.ok(started[0].timeoutSec <= QUESTION_WAIT_SEC - 100 - 20 && started[0].timeoutSec > QUESTION_WAIT_SEC - 100 - 25, `the session's limit is the time left: ${started[0].timeoutSec}`);
  } finally { stop(); }
});

test("a request the server withdrew gets no answer", () => {
  const runDir = aRun();
  assert.equal(answerRequest(runDir, "never-asked", { ok: true, text: "late" }), false);
});
