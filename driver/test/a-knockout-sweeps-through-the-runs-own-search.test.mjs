// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A KNOCKOUT SWEEPS THROUGH THE RUN'S OWN SEARCH where its searches are its own (pipeline-knockout.mjs,
// resolveSweepExecutor; engine/mcp/own-search.mjs, ownSearchKnockoutGrid).
//
// Each name's dictated searches run in research-only sessions, made once for the run, and the ledger passes the grid's
// own capture. Its owner lookups are questions asked of the same program, one each at the Knockout's light depth on the
// tier ruled for it, never of Perplexity, so no key is needed. An answer counts only where the program searched, and its
// source is a page a search returned. A route with no web search of its own skips the web half under its own cause;
// until that cause has its approved sentence, the screen stops before anything is spent rather than run silent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinEnv } from "../../shared/env-aliases.mjs";
import { ownSearchKnockoutGrid, ownSearchQuestioner, programRefusal, savedSearchRecords, questionRecordsPath, QUESTION_TIERS } from "../engine/mcp/own-search.mjs";
import { resolveSweepExecutor } from "../pipeline-knockout.mjs";
import { runOwnerChecks } from "../owner-use-check.mjs";
import { rollupTokens } from "../tokens.mjs";
import { CAPABILITY_SKIPPED_CAUSE, CAPABILITY_SKIPPED_NOTE } from "../search-policy.mjs";

const codexSearch = (queries, results) => ({ type: "item.completed",
  item: { type: "web_search", action: queries.length > 1 ? { queries } : { query: queries[0] }, ...(results === undefined ? {} : { results }) } });
const aRun = (research, engine = "openai-agent") => {
  const d = mkdtempSync(join(tmpdir(), "own-search-knockout-"));
  mkdirSync(join(d, "_driver"), { recursive: true });
  if (research) writeFileSync(join(d, "_driver", "run-choices.json"), JSON.stringify({ schema: 1, engine, register: null, research }));
  return d;
};
const SPEC = (out) => ({ terms: ["QZORVAK"], platforms: ["web", "etsy.com"], use: "candles", results_per_cell: 2, output_path: out });

test("one name's searches run through the run's own program, sessions made once, the ledger passing the grid's capture", async () => {
  const runDir = aRun("own");
  try {
    let made = 0;
    const makeSessions = async () => { made++; return { search: "codex", engine: "openai-agent", session: async (batch) => ({ answered: true, seconds: 1, usage: null, model: "gpt-6-luna", speed: "standard",
      events: batch.map((d) => codexSearch([d.site ? `${d.query} site:${d.site}` : d.query], [{ title: "a", url: d.site ? `https://${d.site}/listing/1` : "https://example.test/1" }, { title: "b", url: d.site ? `https://${d.site}/listing/2` : "https://example.test/2" }, { title: "c", url: d.site ? `https://${d.site}/listing/3` : "https://example.test/3" }])) }) }; };
    const grid = ownSearchKnockoutGrid(runDir, { makeSessions });
    const r = await grid(SPEC(join(runDir, "research", "qzorvak.json")));
    assert.equal(r.ok, true, r.cause);
    assert.equal(r.requested, 2);
    assert.equal(r.present, 2);
    const ledger = JSON.parse(r.ledgerJson);
    assert.ok(ledger.cells.every((c) => c.candidates.length <= 2), "the spec's own result limit");
    await grid(SPEC(join(runDir, "research", "qzorvak-2.json")));
    assert.equal(made, 1, "the sessions are made once for the run");
    assert.ok(savedSearchRecords(runDir).length >= 2, "each search's record is kept with the run");
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

test("with no session, a name is not searched anywhere and says why; the cause is never one the lane retries as a program fault", async () => {
  const runDir = aRun("own");
  try {
    const r = await ownSearchKnockoutGrid(runDir, { makeSessions: async () => ({ error: "the engine is signed out" }) })(SPEC(join(runDir, "x.json")));
    assert.equal(r.ok, false);
    assert.match(r.cause, /^own search: the engine is signed out/);
    assert.doesNotMatch(r.cause, /^grid: /);
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

test("the lane takes its own search's sweep on a run whose searches are its own, and Perplexity's otherwise", () => {
  const saved = process.env.PERPLEXITY_API_KEY;
  try {
    pinEnv(process.env, "PERPLEXITY_API_KEY", undefined);
    const own = aRun("own");
    const keyless = resolveSweepExecutor({}, { runDir: own });
    assert.equal(keyless.source, "own:codex");
    assert.equal(typeof keyless.grid, "function");
    assert.equal(keyless.skipped, undefined, "own search needs no key for the sweep");
    assert.equal(typeof keyless.exec, "function");
    assert.equal(keyless.ownerChecksBy, "own:codex", "the owner lookups are asked of the run's own program, with no key");
    pinEnv(process.env, "PERPLEXITY_API_KEY", "test-offline");
    assert.equal(resolveSweepExecutor({}, { runDir: own }).ownerChecksBy, "own:codex", "a key set changes nothing: nobody chose Perplexity for it");
    const other = aRun("perplexity");
    assert.equal(resolveSweepExecutor({}, { runDir: other }).source, "perplexity");
    pinEnv(process.env, "PERPLEXITY_API_KEY", undefined);
    assert.equal(resolveSweepExecutor({}, { runDir: other }).skipped, "common-law-no-credential");
    for (const d of [own, other]) rmSync(d, { recursive: true, force: true });
  } finally { pinEnv(process.env, "PERPLEXITY_API_KEY", saved); }
});

test("a route with no web search of its own skips the web half under its own cause, judged on the run's own engine", () => {
  const env = { CLEAROTRON_AI_BILLING: process.env.CLEAROTRON_AI_BILLING, CLAUDE_CODE_USE_BEDROCK: process.env.CLAUDE_CODE_USE_BEDROCK };
  try {
    pinEnv(process.env, "CLEAROTRON_AI_BILLING", "cloud");
    pinEnv(process.env, "CLAUDE_CODE_USE_BEDROCK", "1");
    const runDir = aRun("own", "anthropic-agent");
    const r = resolveSweepExecutor({}, { runDir });
    assert.equal(r.skipped, "own-search-unavailable");
    assert.match(r.why, /Amazon Bedrock/);
    // ITS SENTENCE IS THE OWNER'S TO GIVE, and until it is in the tables the lane stops such a screen before anything is
    // spent rather than deliver it silent about the half it skipped (pipeline-knockout.mjs, after resolveSweepExecutor).
    assert.equal(CAPABILITY_SKIPPED_NOTE["own-search-unavailable"], undefined);
    assert.equal(CAPABILITY_SKIPPED_CAUSE["own-search-unavailable"], undefined);
    rmSync(runDir, { recursive: true, force: true });
  } finally { for (const [k, v] of Object.entries(env)) pinEnv(process.env, k, v); }
});

test("a run whose installation chose no web-research service searches the web with none, whatever key is set", () => {
  const saved = process.env.PERPLEXITY_API_KEY;
  const runDir = aRun(null);
  try {
    writeFileSync(join(runDir, "_driver", "run-choices.json"), JSON.stringify({ schema: 1, engine: "anthropic-agent", register: null, research: null }));
    pinEnv(process.env, "PERPLEXITY_API_KEY", "test-offline");
    const r = resolveSweepExecutor({}, { runDir });
    assert.deepEqual({ source: r.source, grid: r.grid, exec: r.exec, skipped: r.skipped },
      { source: "none", grid: null, exec: null, skipped: "web-research-not-chosen" }, "nobody chose Perplexity for it, so a key does not send its searches there");
    // Neither a missing key nor a route that cannot search: its own cause, whose sentence is the owner's to give.
    assert.equal(CAPABILITY_SKIPPED_NOTE["web-research-not-chosen"], undefined);
    rmSync(join(runDir, "_driver", "run-choices.json"));
    assert.equal(resolveSweepExecutor({}, { runDir }).source, "perplexity", "a run with no record meets the route it always had");
  } finally { pinEnv(process.env, "PERPLEXITY_API_KEY", saved); rmSync(runDir, { recursive: true, force: true }); }
});

test("an owner lookup that was never sent is recorded as not run, not as one that did not answer", async () => {
  const runDir = aRun("own");
  try {
    mkdirSync(join(runDir, "research"), { recursive: true });
    const rows = await runOwnerChecks({ owners: [{ mark: "QZORVAK", owner: "Northwind Play GmbH", recordIds: ["r1"], classes: [9] }],
      exec: async () => ({ ok: false, notRun: true, cause: "not run: the lookup's route has no session on this run" }), runDir });
    assert.equal(rows[0].ok, false);
    assert.equal(rows[0].notRun, true);
    assert.match(rows[0].cause, /^not run:/);
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

const codexAnswer = (urls) => [{ type: "item.completed", item: { type: "web_search", action: { query: "what does Northwind Play GmbH sell" },
  results: urls.map((url, i) => ({ title: `r${i}`, url })) } }];

test("an owner lookup on own search is one question on the Knockout's tier, and its source is a page a search returned", async () => {
  const runDir = aRun("own");
  try {
    mkdirSync(join(runDir, "research"), { recursive: true });
    const made = [];
    const makeSessions = async (o) => { made.push({ model: o.model, thinking: o.thinking }); return { search: "codex", engine: "openai-agent",
      question: async (task) => ({ text: `Northwind Play GmbH sells wooden toys.\nhttps://invented.test/about\nhttps://northwind.test/shop`, model: "gpt-6.1-terra", speed: "standard", seconds: 2, usage: null,
        events: codexAnswer(["https://northwind.test/shop", "https://register.test/1"]), asked: task }) }; };
    const exec = ownSearchQuestioner(runDir, { tier: QUESTION_TIERS["knockout-search"], makeSessions });
    const rows = await runOwnerChecks({ owners: [{ mark: "QZORVAK", owner: "Northwind Play GmbH", recordIds: ["r1"], classes: [28] },
      { mark: "QZORVIK", owner: "Lakeside Craft Ltd", recordIds: ["r2"], classes: [28] }], exec, runDir, concurrency: 2 });
    assert.deepEqual(made, [{ model: "sonnet", thinking: "low" }], "one session maker for the run, on the Knockout's tier");
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.ok, true, row.cause);
      assert.equal(row.service, "own:codex");
      assert.equal(row.model, "gpt-6.1-terra");
      assert.equal(row.source, "https://northwind.test/shop", "the source is a page a search returned, never one only the wording names");
    }
    const recs = readFileSync(questionRecordsPath(runDir), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(recs.length, 2, "each question's record is kept with the run");
    assert.deepEqual(recs[0].pages, ["https://northwind.test/shop", "https://register.test/1"]);
    assert.deepEqual(recs[0].sources, ["https://northwind.test/shop"]);
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

test("an owner question answered without a search, or with no session, is not an answer", async () => {
  const runDir = aRun("own");
  try {
    const fromMemory = ownSearchQuestioner(runDir, { tier: QUESTION_TIERS["knockout-search"],
      makeSessions: async () => ({ search: "codex", question: async () => ({ text: "They sell toys.", events: [] }) }) });
    const r = await fromMemory("what does Northwind Play GmbH sell");
    assert.deepEqual({ ok: r.ok, cause: r.cause, service: r.service }, { ok: false, cause: "own search: the session answered without searching", service: "own:codex" });
    const none = ownSearchQuestioner(runDir, { tier: QUESTION_TIERS["knockout-search"], makeSessions: async () => ({ error: "the engine is signed out" }) });
    assert.match((await none("q")).cause, /^own search: the engine is signed out/);
    const failed = ownSearchQuestioner(runDir, { tier: QUESTION_TIERS["knockout-search"],
      makeSessions: async () => ({ search: "codex", question: async () => ({ text: "", cause: "usage limit", events: codexAnswer(["https://x.test/1"]) }) }) });
    assert.match((await failed("q")).cause, /^own search: usage limit/);
    assert.equal(existsSync(questionRecordsPath(runDir)), true, "a question that did not answer is recorded too");
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

test("own search's records are no stage's: the token rollup reads none of them as an attempt", async () => {
  const runDir = aRun("own");
  try {
    const exec = ownSearchQuestioner(runDir, { tier: QUESTION_TIERS["knockout-search"],
      makeSessions: async () => ({ search: "codex", question: async () => ({ text: "Toys.\nhttps://northwind.test/shop", model: "gpt-6.1-terra",
        usage: { input: 900, output: 90 }, events: codexAnswer(["https://northwind.test/shop"]) }) }) });
    await exec("what does Northwind Play GmbH sell");
    const grid = ownSearchKnockoutGrid(runDir, { makeSessions: async () => ({ search: "codex", engine: "openai-agent", session: async (batch) => ({ answered: true, model: "gpt-6-luna",
      usage: { input: 500, output: 50 }, events: batch.map((d) => codexSearch([d.site ? `${d.query} site:${d.site}` : d.query], [{ title: "a", url: d.site ? `https://${d.site}/1` : "https://example.test/1" }])) }) }) });
    await grid(SPEC(join(runDir, "research", "qzorvak.json")));
    assert.ok(existsSync(questionRecordsPath(runDir)) && savedSearchRecords(runDir).length > 0, "both kinds of record were written");
    const t = rollupTokens(runDir);
    assert.equal(t.total.attempts, 0, "a search or question record was counted as a stage attempt");
    assert.deepEqual(Object.keys(t.byStage), []);
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

test("a question the program refused carries the program's own reason, never only that the turn failed", async () => {
  const runDir = aRun("own");
  try {
    const refusal = JSON.stringify({ type: "error", status: 400, error: { type: "invalid_request_error", message: "The 'invented-model' model is not supported when using Codex with a ChatGPT account." } });
    const events = [{ type: "error", message: refusal }, { type: "turn.failed", error: { message: refusal } }];
    assert.equal(programRefusal(events), "The 'invented-model' model is not supported when using Codex with a ChatGPT account.");
    assert.equal(programRefusal([{ type: "result", is_error: true, result: "Credit balance is too low" }]), "Credit balance is too low");
    assert.equal(programRefusal([{ type: "item.completed", item: { type: "web_search" } }]), null);
    const exec = ownSearchQuestioner(runDir, { tier: QUESTION_TIERS["full-country-search"],
      makeSessions: async () => ({ search: "codex", question: async () => ({ text: "", cause: "the engine turn did not complete cleanly (code 1, status error)", events }) }) });
    const r = await exec("q");
    assert.equal(r.ok, false);
    assert.equal(r.cause, "own search: the engine turn did not complete cleanly (code 1, status error): The 'invented-model' model is not supported when using Codex with a ChatGPT account.");
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});
