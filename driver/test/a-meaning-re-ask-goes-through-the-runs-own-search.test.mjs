// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A MEANING RE-ASK GOES THROUGH THE RUN'S OWN SEARCH (engine/mcp/own-search.mjs, reissueMeaningSearches).
//
// A run whose searches are its own AI program's re-issues a missing meaning search through that program: only the
// queries asked, each kept as a search record, answered in the shape the research service's re-issue answers in. A
// search that is not answered comes back as no row, so the sweep still finds it missing and discloses it, and nothing
// is sent to another service, with no session or with one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { meaningReissuerFor, reissueMeaningSearches, savedSearchRecords, searchRecordsPath } from "../engine/mcp/own-search.mjs";
import { parsePrRiskResults } from "../connotation-search.mjs";

const codexSearch = (queries, results) => ({ type: "item.completed",
  item: { type: "web_search", action: queries.length > 1 ? { queries } : { query: queries[0] }, ...(results === undefined ? {} : { results }) } });
const aRun = () => { const d = mkdtempSync(join(tmpdir(), "own-search-reask-")); mkdirSync(join(d, "_driver"), { recursive: true }); return d; };

test("only the queries asked are searched, each answered search is a row in the ledger's own shape, and its record is kept", async () => {
  const runDir = aRun();
  try {
    const sent = [];
    const sessions = { search: "codex", engine: "openai-agent", session: async (batch) => {
      sent.push(...batch.map((d) => d.query));
      return { answered: true, seconds: 1, usage: null, model: "gpt-6-luna", speed: "standard",
        events: batch.filter((d) => /qzorvak/.test(d.query)).map((d) => codexSearch([d.query], [{ title: "a", url: "https://example.test/1" }, { title: "b", url: "https://example.test/2" }, { title: "c", url: "https://example.test/3" }])) };
    } };
    const r = await reissueMeaningSearches(runDir, ["what does qzorvak mean", "qzorvak slang", "what does qzorvak mean"], { sessions, keep: 2 });
    assert.equal(r.ok, true);
    assert.equal(r.requested, 2, "a query asked twice is searched once");
    assert.deepEqual([...new Set(sent)].sort(), ["qzorvak slang", "what does qzorvak mean"], "nothing but the queries asked");
    assert.deepEqual(r.rows.map((x) => x.query).sort(), ["qzorvak slang", "what does qzorvak mean"]);
    assert.equal(r.rows[0].results.length, 2, "the spec's own result limit");
    assert.deepEqual(r.rows, parsePrRiskResults(JSON.stringify({ extras: { pr_risk: r.rows } })), "the shape the ledger's rows are read in");
    assert.ok(existsSync(searchRecordsPath(runDir)), "each search's record is kept with the run");
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

test("a search that is not answered is no row, so the sweep still finds it missing", async () => {
  const runDir = aRun();
  try {
    const sessions = { search: "codex", engine: "openai-agent", session: async (batch) => ({ answered: true, seconds: 1, usage: null, model: "gpt-6-luna", speed: "standard",
      events: batch.filter((d) => d.query === "qzorvak slang").map((d) => codexSearch([d.query], [{ title: "a", url: "https://example.test/1" }])) }) };
    const r = await reissueMeaningSearches(runDir, ["what does qzorvak mean", "qzorvak slang"], { sessions });
    assert.equal(r.ok, true);
    assert.deepEqual(r.rows.map((x) => x.query), ["qzorvak slang"]);
    assert.ok(r.outcomes.refused >= 1 || r.outcomes["not-sent"] >= 1, JSON.stringify(r.outcomes));
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

test("with no session, nothing is searched anywhere and the reason is said", async () => {
  const runDir = aRun();
  try {
    const none = await reissueMeaningSearches(runDir, ["what does qzorvak mean"], { sessions: null });
    assert.deepEqual(none, { ok: false, cause: "own search: no research-only session on this run", rows: [] });
    const broken = await reissueMeaningSearches(runDir, ["what does qzorvak mean"], { sessions: { error: "the engine is signed out" } });
    assert.match(broken.cause, /the engine is signed out/);
    const threw = await reissueMeaningSearches(runDir, ["q"], { sessions: { search: "codex", session: async () => { throw new Error("stream lost"); } } });
    assert.deepEqual({ ok: threw.ok, rows: threw.rows }, { ok: false, rows: [] });
    assert.match(threw.cause, /stream lost/);
    assert.deepEqual(savedSearchRecords(runDir), [], "no record of a search that never ran");
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

test("a run re-asks through its own search, and through the other service only when its searches are not its own", async () => {
  const runDir = aRun();
  try {
    const record = (research) => writeFileSync(join(runDir, "_driver", "run-choices.json"), JSON.stringify({ schema: 1, engine: "openai-agent", register: null, research }));
    let otherAsked = 0;
    const otherwise = async () => { otherAsked++; return { ok: true, rows: [] }; };
    record("perplexity");
    assert.equal(meaningReissuerFor(runDir, { sessions: null, otherwise }), otherwise);
    record("own");
    const sent = [];
    const sessions = { search: "codex", engine: "openai-agent", session: async (batch) => { sent.push(...batch.map((d) => d.query));
      return { answered: true, seconds: 1, usage: null, model: "gpt-6-luna", speed: "standard", events: batch.map((d) => codexSearch([d.query], [{ title: "a", url: "https://example.test/1" }, { title: "b", url: "https://example.test/2" }])) }; } };
    const r = await meaningReissuerFor(runDir, { sessions, otherwise })(["what does qzorvak mean"], { spec: { results_per_cell: 1 } });
    assert.deepEqual(sent, ["what does qzorvak mean"]);
    assert.equal(r.rows[0].results.length, 1, "the spec's own result limit");
    const none = await meaningReissuerFor(runDir, { sessions: null, otherwise })(["what does qzorvak mean"], {});
    assert.equal(none.ok, false, "no session re-issues nothing");
    assert.equal(otherAsked, 0, "the other service was asked on a run whose searches are its own");
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});
