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
  assert.deepEqual([...SEARCH_OUTCOMES].sort(), ["capped", "empty", "failed", "found", "no-results-reported", "not-sent", "pooled", "refused", "wrong-site"]);
  assert.deepEqual([...RETRIED_OUTCOMES].sort(), ["not-sent", "pooled", "refused"]);
  for (const o of RETRIED_OUTCOMES) assert.ok(SEARCH_OUTCOMES.includes(o));
  assert.equal(onSite("https://shop.etsy.com/x", "etsy.com"), true, "a subdomain is the site");
  assert.equal(onSite("https://notetsy.com/x", "etsy.com"), false, "a name that only ends the same is not");
});
