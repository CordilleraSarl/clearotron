// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A DICTATED SEARCH HAS ONE OUTCOME OF ITS OWN, READ FROM THE PROGRAM'S OWN TOOL RECORDS.
//
// When an AI program's own web search runs the dictated searches, each one's outcome is read from the program's records
// of its tool calls, and the outcomes stay apart: a search that confirmed it found nothing, one that reported no list,
// one never sent, one pooled with others, one whose results all came from another site, one past the program's budget,
// a batch the program refused, and a tool error. The event streams below are invented, in the shapes each program
// writes: Claude's stream-json `WebSearch` calls and results, and Codex's `web_search` items.
import { test } from "node:test";
import assert from "node:assert/strict";

const { searchOutcomes, SEARCH_OUTCOMES, RETRIED_OUTCOMES, onSite } = await import("../engine/mcp/own-search.mjs");

const ITEMS = [
  { query: "qzorvak candles", site: "etsy.com" },
  { query: "qzorvak wax", site: "etsy.com" },
  { query: "qzorvak lantern", site: null },
  { query: "qzorvak wick", site: "amazon.com" },
  { query: "qzorvak soap", site: null },
];

// ── Claude: a WebSearch call, then its result on the next user event.
let n = 0;
const claudeSearch = (input, { urls = [], searchCount = 1, isError = false, text = "results" } = {}) => {
  const id = `toolu_${++n}`;
  return [
    { type: "assistant", message: { content: [{ type: "tool_use", id, name: "WebSearch", input }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, is_error: isError, content: text }] },
      tool_use_result: { query: input.query, searchCount, results: urls.length ? [{ tool_use_id: id, content: urls.map((url) => ({ title: "t", url })) }] : [] } },
  ];
};
const outcomes = (search, events, opts) => Object.fromEntries(searchOutcomes(search, ITEMS, events, opts).map((o) => [o.query, o]));

test("Claude: found, confirmed empty, capped, all off-site and failed are five outcomes, and an unsent search is a sixth", () => {
  const events = [
    ...claudeSearch({ query: "qzorvak candles", allowed_domains: ["etsy.com"] }, { urls: ["https://www.etsy.com/listing/1", "https://pinterest.com/pin/2"] }),
    ...claudeSearch({ query: "qzorvak wax", allowed_domains: ["etsy.com"] }, { urls: [], searchCount: 1 }),
    ...claudeSearch({ query: "qzorvak lantern" }, { urls: [], searchCount: 0, text: "Web search was not performed" }),
    ...claudeSearch({ query: "qzorvak wick", allowed_domains: ["amazon.com"] }, { urls: ["https://ebay.com/itm/3"] }),
    // "qzorvak soap" was never sent
  ];
  const o = outcomes("claude", events);
  assert.equal(o["qzorvak candles"].outcome, "found");
  assert.deepEqual(o["qzorvak candles"].results.map((r) => r.offSite), [false, true], "a result off the site is kept and marked");
  assert.equal(o["qzorvak wax"].outcome, "empty", "a search that ran and returned nothing confirms it");
  assert.equal(o["qzorvak lantern"].outcome, "capped", "past the budget: a search count of 0 and 'not performed'");
  assert.equal(o["qzorvak wick"].outcome, "wrong-site", "every result from another site answers nothing");
  assert.equal(o["qzorvak soap"].outcome, "not-sent");
  const failed = outcomes("claude", claudeSearch({ query: "qzorvak soap" }, { isError: true, text: "tool error" }));
  assert.equal(failed["qzorvak soap"].outcome, "failed");
});

// ── Codex: a web_search item, its query carrying `site:` where the search names one.
const codexSearch = (queries, results) => ({ type: "item.completed",
  item: { type: "web_search", action: queries.length > 1 ? { queries } : { query: queries[0] }, ...(results === undefined ? {} : { results }) } });

test("Codex: an empty list is 'no results reported', never a confirmed empty search, and a pooled search answers none of its queries", () => {
  const events = [
    codexSearch(["qzorvak candles site:etsy.com"], [{ title: "t", url: "https://etsy.com/listing/9" }]),
    codexSearch(["qzorvak wax site:etsy.com"], []),
    codexSearch(["qzorvak lantern", "qzorvak soap"], [{ title: "t", url: "https://example.test/a" }]),
  ];
  const o = outcomes("codex", events);
  assert.equal(o["qzorvak candles"].outcome, "found");
  assert.equal(o["qzorvak wax"].outcome, "no-results-reported");
  assert.equal(o["qzorvak lantern"].outcome, "pooled");
  assert.equal(o["qzorvak soap"].outcome, "pooled");
  assert.deepEqual(o["qzorvak lantern"].results, [], "a pooled search's results are no search's answer");
  assert.equal(o["qzorvak wick"].outcome, "not-sent");
  assert.equal(outcomes("codex", [codexSearch(["qzorvak wax site:etsy.com"])])["qzorvak wax"].outcome, "no-results-reported", "no list at all reads the same");
});

test("a session that sent no search at all and still answered refused the batch; one that did not answer sent nothing", () => {
  for (const search of ["claude", "codex"]) {
    const refused = searchOutcomes(search, ITEMS, [], { answered: true });
    assert.ok(refused.every((o) => o.outcome === "refused"), `${search}: refused`);
    const silent = searchOutcomes(search, ITEMS, [], { answered: false });
    assert.ok(silent.every((o) => o.outcome === "not-sent"), `${search}: not sent`);
  }
});

test("the outcomes are a closed list, and only the unanswered kinds are retried", () => {
  assert.deepEqual([...SEARCH_OUTCOMES].sort(), ["capped", "empty", "failed", "found", "no-results-reported", "not-sent", "pooled", "refused", "too-long", "wrong-site"]);
  assert.deepEqual([...RETRIED_OUTCOMES].sort(), ["not-sent", "pooled", "refused"]);
  for (const o of RETRIED_OUTCOMES) assert.ok(SEARCH_OUTCOMES.includes(o));
  assert.equal(onSite("https://shop.etsy.com/x", "etsy.com"), true, "a subdomain is the site");
  assert.equal(onSite("https://notetsy.com/x", "etsy.com"), false, "a name that only ends the same is not");
});

// ── THE RUNNER: batches, one retry, words too long never sent, and the ledger the grid's checks read.
const { runDictatedSearches, ledgerFromOutcomes, MAX_QUERY_CHARS, RETRY_BATCH } = await import("../engine/mcp/own-search.mjs");

test("one retry, in smaller batches, for searches not sent, pooled or refused; words too long are never sent", async () => {
  const items = [
    { term: "QZORVAK", platform: "etsy.com", query: "qzorvak", site: "etsy.com" },
    { term: "QZORVAK", platform: "amazon.com", query: "qzorvak", site: "amazon.com" },
    { term: "QZORVA", platform: "web", query: "qzorva", site: null },
    { term: "QZORV", platform: "web", query: "qzorv", site: null },
    { meaning: true, query: "what does qzorvak mean", site: null },
    { term: "LONG", platform: "web", query: "x".repeat(MAX_QUERY_CHARS + 1), site: null },
  ];
  const calls = [];
  const session = async (batch) => {
    calls.push(batch.map((d) => d.query));
    const attempt = calls.length;
    const events = [];
    for (const d of batch) {
      const q = d.site ? `${d.query} site:${d.site}` : d.query;
      if (attempt === 1 && d.query === "qzorva") continue;                       // not sent the first time
      if (attempt === 1 && (d.query === "qzorv" || d.meaning)) continue;          // pooled below instead
      events.push(codexSearch([q], [{ title: "t", url: d.site ? `https://${d.site}/i` : "https://example.test/i" }]));
    }
    if (attempt === 1) events.push(codexSearch(["qzorv", "what does qzorvak mean"], [{ title: "t", url: "https://example.test/p" }]));
    return { events, answered: true, seconds: 1, usage: { input_tokens: 10 }, model: "gpt-6-luna", speed: "standard" };
  };
  const { outcomes, records } = await runDictatedSearches("codex", items, session);
  assert.deepEqual(outcomes.map((o) => o.outcome), ["found", "found", "found", "found", "found", "too-long"]);
  assert.ok(!calls.flat().some((q) => q.length > MAX_QUERY_CHARS), "the over-long words were never sent");
  assert.equal(calls.length, 2, "one first batch, one retry batch");
  assert.ok(calls[1].length <= RETRY_BATCH);
  assert.deepEqual(calls[1].sort(), ["qzorv", "qzorva", "what does qzorvak mean"], "only the unanswered are asked again");
  assert.ok(records.some((r) => r.attempt === 2 && r.query === "qzorva" && r.outcome === "found"));
  assert.ok(records.some((r) => r.attempt === 1 && r.query === "qzorv" && r.outcome === "pooled"), "the first attempt's outcome is kept in the records");
  assert.ok(records.every((r) => r.service === "codex" && "usage" in r && "seconds" in r));
});

test("the ledger: answered searches are cells and receipts with their on-site results; every other outcome is a gap", () => {
  const items = [
    { term: "A", platform: "etsy.com", query: "a", site: "etsy.com" },
    { term: "B", platform: "web", query: "b", site: null },
    { term: "C", platform: "web", query: "c", site: null },
    { meaning: true, query: "m", site: null },
  ];
  const outcomes = [
    { outcome: "found", results: [{ title: "on", url: "https://etsy.com/1", offSite: false }, { title: "off", url: "https://x.test/2", offSite: true }] },
    { outcome: "empty", results: [] },
    { outcome: "no-results-reported", results: [] },
    { outcome: "pooled", results: [] },
  ];
  const ledger = ledgerFromOutcomes(items, outcomes);
  assert.deepEqual(ledger.cells, [
    { term: "A", platform: "etsy.com", status: "hit", candidates: [{ title: "on", url: "https://etsy.com/1" }] },
    { term: "B", platform: "web", status: "no_hit", candidates: [] },
  ]);
  assert.deepEqual(ledger.gaps, ["C | web | own search: no-results-reported", "m | connotation | own search: pooled"]);
  assert.deepEqual(ledger.extras.pr_risk, []);
});

// ── ONE SESSION, THROUGH THE NATIVE-LANGUAGE TURNS' OWN DOOR: the run's engine, the program's search and nothing else.
const { makeOwnSearchSessions, readSessionStream } = await import("../engine/mcp/own-search.mjs");
const { makeJxTurnRunner } = await import("../engine/jx-turn.mjs");
const { mkdtempSync, writeFileSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { gzipSync } = await import("node:zlib");

test("a session goes through the jx door with the program's search alone, and its searches are read back from its own stream", async () => {
  const dir = mkdtempSync(join(tmpdir(), "own-search-session-"));
  const seen = [];
  const runTurn = async (args) => {
    seen.push(args);
    // The adapter keeps the stream gzipped once the session closes; the reader takes either.
    writeFileSync(`${args.streamFile}.gz`, gzipSync(claudeSearch({ query: "qzorvak candles", allowed_domains: ["etsy.com"] },
      { urls: ["https://etsy.com/listing/1"] }).map((e) => JSON.stringify(e)).join("\n") + "\n"));
    return { code: 0, killed: false, signals: {}, usage: { input: 5, output: 7, cacheRead: 0, cacheWrite: 0, total: 12 },
      json: { status: "ok", stopReason: "end_turn", result: { payloads: [{ text: "done" }] } }, modelWire: "claude-haiku-4-5-20251001", speed: { asked: "standard" } };
  };
  const env = { CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_AI_BILLING: "subscription" };
  const sessions = await makeOwnSearchSessions({ sessionDir: dir, makeRunner: (o) => makeJxTurnRunner({ ...o, env, runTurn }) });
  assert.equal(sessions.error, undefined, sessions.error);
  assert.equal(sessions.search, "claude");
  const r = await sessions.session([ITEMS[0]]);
  const args = seen[0];
  assert.equal(args.webSearch, true);
  assert.deepEqual(args.builtinTools, ["WebSearch"], "the program's search is the session's only built-in tool");
  assert.equal(args.allowedTools, "WebSearch");
  assert.equal(args.mcpConfig, undefined, "no tool server");
  assert.equal(args.model, "haiku", "the cheap tier");
  assert.match(args.message, /qzorvak candles/);
  assert.doesNotMatch(args.message, /"qzorvak candles"/, "the words are listed bare, never as a quoted string");
  assert.equal(r.answered, true);
  assert.equal(searchOutcomes("claude", [ITEMS[0]], r.events, { answered: r.answered })[0].outcome, "found");
  assert.deepEqual(readSessionStream(join(dir, "none.jsonl")), [], "a stream that was never kept reads as no events");
});

test("a run whose engine cannot be resolved gets no session, and says why", async () => {
  const sessions = await makeOwnSearchSessions({ sessionDir: tmpdir(), makeRunner: (o) => makeJxTurnRunner({ ...o, env: {} }) });
  assert.match(String(sessions.error), /\S/);
});

// ── KEPT WITH THE RUN, AND REPLAYED WITHOUT A CALL.
const { keepSearchRecords, savedSearchRecords, replayedOutcomes } = await import("../engine/mcp/own-search.mjs");

test("the records are kept with the run, and a replay answers from them without a call; an unrecorded search is not-sent", async () => {
  const runDir = mkdtempSync(join(tmpdir(), "own-search-records-"));
  let calls = 0;
  const session = async (batch) => { calls++; return { events: batch.map((d) => codexSearch([d.site ? `${d.query} site:${d.site}` : d.query], [{ title: "t", url: d.site ? `https://${d.site}/i` : "https://example.test/i" }])), answered: true, seconds: 2, usage: { input_tokens: 3 }, model: "gpt-6-luna", speed: "fast" }; };
  const items = [ITEMS[0], ITEMS[2]];
  const { records } = await runDictatedSearches("codex", items, session);
  keepSearchRecords(runDir, records);
  const kept = savedSearchRecords(runDir);
  assert.equal(kept.length, 2);
  assert.ok(kept.every((r) => r.service === "codex" && r.model === "gpt-6-luna" && r.speed === "fast" && r.seconds === 2 && r.usage && r.ts));
  const before = calls;
  const replay = replayedOutcomes([...items, ITEMS[4]], kept);
  assert.equal(calls, before, "a replay calls nothing");
  assert.deepEqual(replay.map((o) => o.outcome), ["found", "found", "not-sent"]);
  assert.equal(replay[0].results[0].url, "https://etsy.com/i");
});
