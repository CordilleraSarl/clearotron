// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// jx-p4-cores.test.mjs — the shadow units' pure provider cores: the serpapi transport, the grid-hit judge and
// the nativeread completions contract. All three modules are pure (injectable fetchImpl, no driver
// imports) so this file needs no env guard and no filesystem.
import { test } from "node:test";
import assert from "node:assert/strict";

const serp = await import("../../providers/serpapi/src/core.js");
const judge = await import("../../providers/jx/src/judge.js");
const nread = await import("../../providers/jx/src/nativeread.js");

// ── serpapi core ────────────────────────────────────────────────────────────────────────────────────
test("serpapi buildSearchParams: baidu engine, site → q6 (never a q operator), count clamped, ct=2", () => {
  const p = serp.buildSearchParams({ engine: "baidu", term: "诺瓦脉冲", site: "taobao.com", count: 10 });
  assert.equal(p.engine, "baidu");
  assert.equal(p.q, "诺瓦脉冲");
  assert.equal(p.q6, "taobao.com", "site scoping rides the q6 param");
  assert.ok(!p.q.includes("site:"), "the term string never carries operators");
  assert.equal(p.ct, "2");
  assert.equal(p.rn, "10");
  assert.equal(serp.buildSearchParams({ term: "x", count: 999 }).rn, String(serp.MAX_RN), "count clamps to the API max");
  assert.equal(serp.buildSearchParams({ term: "x", count: 0 }).rn, "1");
  assert.ok(!("q6" in serp.buildSearchParams({ term: "x" })), "no site ⇒ no q6 (the open-web cell)");
});

test("serpapi buildSearchParams: unknown engine and empty term throw (config bugs, not fallbacks)", () => {
  assert.throws(() => serp.buildSearchParams({ engine: "naver", term: "x" }), /closed table/);
  assert.throws(() => serp.buildSearchParams({ term: "  " }), /term is required/);
});

test("serpapi parseOrganicHits: clamps, drops url-less rows, shape-miss → []", () => {
  const hits = serp.parseOrganicHits({ organic_results: [
    { position: 1, title: "T1", link: "https://item.taobao.com/1", snippet: "s", displayed_link: "item.taobao.com" },
    { title: "no-url row" },
    { position: 3, title: "x".repeat(500), link: "https://a.b/2", snippet: "y".repeat(900) },
  ] });
  assert.equal(hits.length, 2, "the url-less row is dropped");
  assert.equal(hits[0].rank, 1);
  assert.ok(hits[1].title.length <= 300 && hits[1].snippet.length <= 600, "fields are clamped");
  assert.deepEqual(serp.parseOrganicHits(null), []);
  assert.deepEqual(serp.parseOrganicHits({ organic_results: "nope" }), []);
});

test("serpapi searchCell: 200 + 'no results' error is an EMPTY RESULT (receiptable gap), a real error degrades", async () => {
  const mk = (body) => async () => ({ ok: true, json: async () => body });
  const empty = await serp.searchCell({ term: "x", apiKey: "k", fetchOpts: { fetchImpl: mk({ error: "Baidu hasn't returned any results for this query." }) } });
  assert.equal(empty.ok, true);
  assert.deepEqual(empty.hits, []);
  const bad = await serp.searchCell({ term: "x", apiKey: "k", fetchOpts: { fetchImpl: mk({ error: "Invalid API key" }) } });
  assert.equal(bad.ok, false);
  assert.match(bad.cause, /Invalid API key/);
});

test("serpapi callSearchAPI: 429/5xx retry then succeed; 401 fails fast; api_key appended at call time only; every request carries an abort deadline", async () => {
  let calls = 0;
  const flaky = async (url, init) => {
    calls++;
    assert.ok(url.includes("api_key=k"), "key rides the request");
    assert.ok(init?.signal instanceof AbortSignal, "a stalled socket can never hang the run — deadline on every request");
    if (calls < 2) return { ok: false, status: 429, text: async () => "rate" };
    return { ok: true, json: async () => ({ organic_results: [] }) };
  };
  const json = await serp.callSearchAPI("k", { engine: "baidu", q: "x" }, { retries: 2, backoffMs: 1, fetchImpl: flaky });
  assert.deepEqual(json, { organic_results: [] });
  assert.equal(calls, 2);
  let authCalls = 0;
  await assert.rejects(
    () => serp.callSearchAPI("k", { engine: "baidu", q: "x" }, { retries: 3, backoffMs: 1, fetchImpl: async () => { authCalls++; return { ok: false, status: 401, text: async () => "no" }; } }),
    /SerpAPI 401/);
  assert.equal(authCalls, 1, "4xx auth errors never retry");
  assert.ok(!("api_key" in serp.buildSearchParams({ term: "x" })), "build output is loggable — no secret");
});

// ── judge core ──────────────────────────────────────────────────────────────────────────────────────
test("judge buildJudgeRequest: forced tool_choice, ids verbatim, requires mark + hits", () => {
  const body = judge.buildJudgeRequest({ mark: "NOVAPULSE", hits: [{ id: 7, term: "诺瓦", platform: "taobao.com", title: "t", url: "https://x/1", snippet: "s" }] });
  assert.deepEqual(body.tool_choice, { type: "tool", name: "emit_judgments" });
  assert.match(body.messages[0].content, /\[7\] term "诺瓦" on taobao\.com/);
  assert.throws(() => judge.buildJudgeRequest({ mark: "M", hits: [] }), /nothing to judge/);
  assert.throws(() => judge.buildJudgeRequest({ hits: [{ id: 1 }] }), /mark is required/);
});

test("judge parseJudgments: closed enum, sentIds filter (no minted judgments), dupe ids collapse, shape-miss → []", () => {
  const resp = { content: [{ type: "tool_use", name: "emit_judgments", input: { judgments: [
    { id: 1, classification: "use-evidence", note: "store page" },
    { id: 1, classification: "unrelated", note: "dupe — dropped" },
    { id: 2, classification: "made-up-class", note: "bad enum" },
    { id: 99, classification: "use-evidence", note: "never sent — minted" },
    { id: 3, classification: "register-record", note: "x".repeat(400) },
  ] } }] };
  const out = judge.parseJudgments(resp, { sentIds: [1, 2, 3] });
  assert.deepEqual(out.map((j) => j.id), [1, 3]);
  assert.equal(out[0].classification, "use-evidence");
  assert.ok(out[1].note.length <= 200);
  assert.deepEqual(judge.parseJudgments({ content: [] }), []);
});

const HIT = { id: 1, term: "t", platform: "p", title: "x", url: "https://a/1" };
/** A turn runner that answers with whatever the test hands it, in the driver's normalized shape. */
const turnOf = (r) => async () => ({ vendor: "anthropic", authMode: "subscription", model: "claude-haiku-4-5",
  usage: { input: 9, output: 12 }, truncationObservable: true, ...r });

test("judge judgeHits: a truncated turn degrades loudly, tokens-only usage", async () => {
  const r = await judge.judgeHits({ mark: "M", hits: [HIT], turn: turnOf({ ok: true, text: '{"judgments":[]}', truncated: true }) });
  assert.equal(r.ok, false);
  assert.match(r.cause, /truncated at the output ceiling/);
  assert.deepEqual(Object.keys(r.usage).sort(), ["input", "output"], "tokens only — never currency");
  assert.equal(r.vendor, "anthropic", "a degrade still spent tokens and must still say who spent them (#1209)");
});

test("judge judgeHits: AN UNREADABLE ANSWER IS A DEGRADE, never an unclassified batch", async () => {
  // The whole reason the transport swap is safe. `tool_choice` used to force the shape; asking for it
  // cannot. parseJudgments answers any shape it cannot read with [], and `ok: true` beside it would
  // mean every SERP hit came back unclassified — which a report reads as NO ADVERSE HITS.
  for (const text of ["I cannot help with that.", "", "```\nnot json\n```", '{"judgments":[{"id":1']) {
    const r = await judge.judgeHits({ mark: "M", hits: [HIT], turn: turnOf({ ok: true, text }) });
    assert.equal(r.ok, false, `answered "${text.slice(0, 20)}" and was believed`);
    assert.match(r.cause, /no readable answer object/);
  }
});

test("judge judgeHits: an EMPTY judgment list is an answer, and is believed", async () => {
  // The other half, and it has to be here or the guard above becomes "refuse everything quiet".
  const r = await judge.judgeHits({ mark: "M", hits: [HIT], turn: turnOf({ ok: true, text: '{"judgments":[]}' }) });
  assert.equal(r.ok, true, "the model answered with the object and an empty array — that is a finding of nothing");
  assert.deepEqual(r.judgments, []);
});

// ── nativeread core ─────────────────────────────────────────────────────────────────────────────────
test("nativeread buildNativereadRequest: forced tool_choice, requires payload, zh only", () => {
  const body = nread.buildNativereadRequest({ mark: "NOVAPULSE", payload: "## slice\nrow" });
  assert.deepEqual(body.tool_choice, { type: "tool", name: "emit_read_items" });
  assert.match(body.messages[0].content, /=== EVIDENCE SLICE ===/);
  assert.throws(() => nread.buildNativereadRequest({ mark: "M", payload: " " }), /payload/);
  assert.throws(() => nread.buildNativereadRequest({ mark: "M", lane: "kr", payload: "x" }), /no prompt for lane/);
});

test("nativeread parseReadItems: closed kinds + severities, clamps, null uri allowed, shape-miss → []", () => {
  const resp = { content: [{ type: "tool_use", name: "emit_read_items", input: { items: [
    { kind: "conflict-read", record_uri: "https://reg/1", analysis_en: "a real read", severity_hint: "high", grounds_en: "row 3" },
    { kind: "subclass-note", record_uri: null, analysis_en: "group 0901 vs 0907", severity_hint: "medium", grounds_en: "table" },
    { kind: "invented-kind", record_uri: null, analysis_en: "x", severity_hint: "low", grounds_en: "" },
    { kind: "cultural-note", record_uri: null, analysis_en: "  ", severity_hint: "low", grounds_en: "" },
    { kind: "squatter-flag", record_uri: "https://reg/2", analysis_en: "portfolio pattern", severity_hint: "extreme", grounds_en: "" },
  ] } }] };
  const out = nread.parseReadItems(resp);
  assert.equal(out.length, 2, "bad kind, empty analysis and bad severity all filtered");
  assert.equal(out[0].kind, "conflict-read");
  assert.equal(out[1].record_uri, null);
  assert.deepEqual(nread.parseReadItems({}), []);
});

test("nativeread generateReadItems: a truncated turn degrades loudly; severity enum is the closed triage set", async () => {
  const r = await nread.generateReadItems({ mark: "M", payload: "x", turn: turnOf({ ok: true, text: "{}", truncated: true }) });
  assert.equal(r.ok, false);
  assert.match(r.cause, /not trustworthy/);
  assert.deepEqual(nread.SEVERITY_HINTS, ["low", "medium", "high"], "hints are triage — never a band vocabulary");
});

test("nativeread generateReadItems: an unreadable answer is a degrade, not an empty flag set", async () => {
  const r = await nread.generateReadItems({ mark: "M", payload: "x", turn: turnOf({ ok: true, text: "no." }) });
  assert.equal(r.ok, false);
  assert.match(r.cause, /no readable answer object/);
});
