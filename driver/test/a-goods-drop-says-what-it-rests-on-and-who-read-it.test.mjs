// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A GOODS DROP SAYS WHAT IT RESTS ON, AND WHO READ IT.
//
// The screen gate holds every in-scope live record the register reading step drops on its goods to a fetch of its
// official record, and a record the run already holds satisfies it. Held is not read: a record hydrated with the
// band, or fetched by another step, satisfies the gate whether or not the reading step ever opened it (ruled
// 2026-10-18). The gate's rule does not change. What changes is the record: for each drop the gate polices, the
// source of the goods it stands on, whether they are complete, which steps opened the record or were shown its
// goods words, and what the gate itself fetched. The counts keep four things apart: register requests sent,
// answers served from the run's memory, credits charged as the register states them, and the characters the
// register answered, which are characters and not bytes. Every mark and record id is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { recordReads, linesRead, registerCallAccount } from "../goods-evidence.mjs";
import { screenGateEvidence } from "../screen-gate.mjs";

const FINDINGS = [
  "### Negative results (orchestrator: Sheet \"Negative Results\")",
  "",
  "| Mark | Search Term / Variant | Result | Notes |",
  "|---|---|---|---|",
  "| QZORVAK | QZORVAK | off-field goods | URI /mark/eu/r1; screen_verdict=surface:in-scope-live; class=9; status=Registered |",
  "| Qzorvak | QZORVAK | goods unrelated | URI /mark/eu/r2; screen_verdict=surface:in-scope-live; class=9; status=Registered |",
  "| Plimbo | QZORVAK | goods unrelated | URI /mark/eu/r3; screen_verdict=surface:in-scope-live; class=9; status=Registered |",
  "| Drellux | QZORVAK | goods unrelated | URI /mark/eu/r4; screen_verdict=surface:in-scope-live; class=9; status=Registered |",
  "| QZORVAK | QZORVAK | dead | URI /mark/eu/r5; screen_verdict=drop:dead; class=9; status=Expired |",
].join("\n");

const READS = [
  { tool: "band_record", args: { record_id: "/mark/eu/r1" }, ok: true, bytes: 900, session: "clearance-x-y-register-digest" },
  { tool: "band_record", args: { record_id: "/mark/EU/r2" }, ok: true, bytes: 700, session: "clearance-x-y-placement-inquiry" },
  { tool: "band_lookup", args: { goods: ["joysticks"] }, ok: true, matched: 2, returned: 2, served: ["/mark/eu/r2", "/mark/eu/r3"], session: "clearance-x-y-register-digest-rerun1" },
  { tool: "band_record", args: { record_id: "/mark/eu/r4" }, ok: false, reason: "not-fetched", session: "clearance-x-y-register-digest" },
  { tool: "perplexity_research", args: { task: "x" }, ok: true, bytes: 4000, session: "clearance-x-y-synthesis" },
].map((r) => JSON.stringify(r)).join("\n");

test("the reading log says which steps opened a record and which were shown its goods words", () => {
  const reads = recordReads(READS);
  assert.deepEqual([...reads.get("/mark/eu/r1").opened], ["clearance-x-y-register-digest"]);
  assert.deepEqual([...reads.get("/mark/eu/r2").opened], ["clearance-x-y-placement-inquiry"], "a cite in another case is the same record");
  assert.deepEqual([...reads.get("/mark/eu/r2").shown], ["clearance-x-y-register-digest-rerun1"]);
  assert.deepEqual([...reads.get("/mark/eu/r4").missed], ["clearance-x-y-register-digest"], "an open that failed is not a read");
  assert.equal(reads.get("/mark/eu/r4").opened.size, 0);
});

test("register calls are counted four ways, never one: requests sent, answers from memory, credits and characters", () => {
  const a = registerCallAccount([
    { tool: "record_fetch", target: "tm_1", ok: true, cache_hit: false, bytes: 1200, credits_charged: 1 },
    { tool: "record_fetch", target: "tm_2", ok: false, cache_hit: false, bytes: 0, credits_charged: null, http_status: 503 },
    { tool: "record_fetch", target: "tm_3", ok: true, cache_hit: true, bytes: 800, credits_charged: 0 },
    { tool: "record_fetch", target: "/mark/us/9", ok: true, cache_hit: false, bytes: 300 },
  ]);
  assert.deepEqual(a, {
    requests_sent: 3, failed: 1, answered_from_memory: 1,
    credits: { charged: 1, requests_with_a_figure: 1, requests_without_a_figure: 2 },
    response_characters: { sent: 1500, from_memory: 800 },
  });
});

const stateOf = (map) => (uri) => (map[uri] ? { goods: map[uri], source: "record-body" } : { goods: "not-held", source: null });

test("each policed drop says what it rests on, who opened it, and what the gate fetched; the drop the gate does not police is left out", () => {
  const ev = screenGateEvidence({
    findingsContent: FINDINGS,
    heldBefore: new Set(["/mark/eu/r1", "/mark/eu/r2", "/mark/eu/r3"]),
    heldAfter: new Set(["/mark/eu/r1", "/mark/eu/r2", "/mark/eu/r3"]),
    before: stateOf({ "/mark/eu/r1": "complete", "/mark/eu/r2": "complete", "/mark/eu/r3": "absent" }),
    reads: recordReads(READS), readerStage: "register-digest",
    gateFetched: new Map([["/mark/eu/r4", { ok: false, cause: "ERROR: HTTP 503" }]]),
  });
  const by = Object.fromEntries(ev.drops.map((d) => [d.uri, d]));
  assert.deepEqual(Object.keys(by).sort(), ["/mark/eu/r1", "/mark/eu/r2", "/mark/eu/r3", "/mark/eu/r4"], "the dead record's drop is not a goods drop the gate polices");
  assert.deepEqual([by["/mark/eu/r1"].held_before_gate, by["/mark/eu/r1"].goods_before_gate, by["/mark/eu/r1"].reading], [true, "complete", "opened"]);
  assert.equal(by["/mark/eu/r2"].reading, "goods-words-shown", "opened by placement and shown its goods words in a later digest attempt: shown, not opened, by the step that dropped it");
  assert.deepEqual(by["/mark/eu/r2"].routes, ["band_lookup"]);
  assert.deepEqual([by["/mark/eu/r3"].goods_before_gate, by["/mark/eu/r3"].reading], ["absent", "goods-words-shown"]);
  assert.deepEqual([by["/mark/eu/r4"].held_before_gate, by["/mark/eu/r4"].reading, by["/mark/eu/r4"].gate_fetch], [false, "no-recorded-read", "failed"]);
  assert.deepEqual(ev.counts, {
    policed: 4, held_before_gate: 3, opened_by_reader: 1, goods_words_shown_only: 2, held_no_recorded_open: 2, held_no_recorded_read: 0,
    gate_fetched: 1, gate_fetch_failed: 1, still_unheld: 1,
  });
  assert.deepEqual(ev.fetches, { avoided: 3, added: 1 }, "a drop on a record already held needed no fetch; each the gate made is added");
  assert.deepEqual(ev.alternatives.read_rule, { would_send_back: 2 },
    "were only an opened record to count, two drops held and not opened by the reading step would go back to it");
});

test("a drop the reading step has no recorded read of, on a record the run holds, is counted as held with no recorded read", () => {
  const ev = screenGateEvidence({ findingsContent: FINDINGS, heldBefore: new Set(["/mark/eu/r4"]), heldAfter: new Set(["/mark/eu/r4"]),
    before: () => ({ goods: "complete", source: "record-body" }), reads: recordReads(""), readerStage: "register-digest", gateFetched: new Map() });
  assert.equal(ev.drops.find((d) => d.uri === "/mark/eu/r4").reading, "no-recorded-read");
  assert.equal(ev.counts.held_no_recorded_read, 1);
  assert.equal(ev.alternatives.read_rule.would_send_back, 1);
});

test("a part of the shape, or a page of a group, that served the drop's line counts as the goods words shown, by its own route", () => {
  const LINES = [
    { tool: "band_shape", args: { format: "md" }, ok: true, part: 1, parts: 2, served_lines: ["line:owner:plimbo|plimbo"], session: "clearance-x-y-register-digest" },
    { tool: "band_lookup", args: { group: "b" }, ok: true, group: "b", returned: 1, served_lines: ["line:owner:drellux|drellux"], session: "clearance-x-y-register-digest" },
    { tool: "band_lookup", args: { group: "b" }, ok: true, group: "b", returned: 1, served_lines: ["line:owner:qzorvak|qzorvak"], session: "clearance-x-y-placement-inquiry" },
  ].map((r) => JSON.stringify(r)).join("\n");
  const lineOf = (uri) => ({ "/mark/eu/r3": "line:owner:plimbo|plimbo", "/mark/eu/r4": "line:owner:drellux|drellux",
    "/mark/eu/r1": "line:owner:qzorvak|qzorvak" })[uri] ?? null;
  const ev = screenGateEvidence({ findingsContent: FINDINGS, heldBefore: new Set(["/mark/eu/r1", "/mark/eu/r3", "/mark/eu/r4"]),
    heldAfter: new Set(["/mark/eu/r1", "/mark/eu/r3", "/mark/eu/r4"]), before: () => ({ goods: "complete", source: "record-body" }),
    reads: recordReads(""), lines: linesRead(LINES), lineOf, readerStage: "register-digest", gateFetched: new Map() });
  const by = Object.fromEntries(ev.drops.map((d) => [d.uri, d]));
  assert.deepEqual([by["/mark/eu/r3"].reading, by["/mark/eu/r3"].routes], ["goods-words-shown", ["band_shape"]], "the shape printed the line's goods words and the record read as unread");
  assert.deepEqual([by["/mark/eu/r4"].reading, by["/mark/eu/r4"].routes], ["goods-words-shown", ["group_page"]], "a page of the group served the line and the record read as unread");
  assert.equal(by["/mark/eu/r1"].reading, "no-recorded-read", "a page another step was served is not the reading step's");
  assert.deepEqual([ev.counts.held_no_recorded_open, ev.counts.held_no_recorded_read], [3, 1]);
});

test("the goods a drop rested on are the ones it had when the gate judged it, apart from what the gate's fetch brought", () => {
  const ev = screenGateEvidence({ findingsContent: FINDINGS, heldBefore: new Set(), heldAfter: new Set(["/mark/eu/r4"]),
    before: (uri) => (uri === "/mark/eu/r4" ? { goods: "complete", source: "search-row" } : { goods: "not-held", source: null }),
    after: (uri) => (uri === "/mark/eu/r4" ? { goods: "complete", source: "record-body" } : { goods: "not-held", source: null }),
    reads: recordReads(""), readerStage: "register-digest", gateFetched: new Map([["/mark/eu/r4", { ok: true }]]) });
  const d = ev.drops.find((x) => x.uri === "/mark/eu/r4");
  assert.deepEqual([d.goods_before_gate, d.source_before_gate, d.gate_fetch, d.goods_after_gate, d.source_after_gate, d.held_after_gate],
    ["complete", "search-row", "fetched", "complete", "record-body", true]);
  assert.equal(ev.alternatives.row_goods_rule.fetches_not_needed, 1, "the fetch the drop's whole search-answer goods made unnecessary was never counted");
  const unfetched = ev.drops.find((x) => x.uri === "/mark/eu/r1");
  assert.deepEqual([unfetched.goods_after_gate, unfetched.source_after_gate], ["not-held", null], "a drop the gate did not fetch keeps its state");
});
