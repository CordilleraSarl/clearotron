// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A KNOCKOUT SAYS WHICH OF A NAME'S REGISTER SEARCHES FAILED, AND ASKS A FAILED COUNT ONCE MORE FIRST (2026-11-23).
//
// A name whose own register question failed, while its other questions found filings, printed those filings and a
// "not available" cell whose reason sat in a hover, and nothing under Left open. The page now lists each such name's
// register gap under Left open, in the shipped words, partly covered where another question answered. A zero, a floor,
// a crowd set aside and a further question the run refused to send are answers or choices, not gaps, and draw nothing.
// Before a count is left open, the count lane asks it once more: a dropped connection or a rate-limit answer had no
// retry on that lane. A refusal no retry can change is not asked again. Every name here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { countRegisterHits } from "../register-count.mjs";
import { capabilitiesFor } from "../register-capabilities.mjs";
import { knockoutLeftOpen, knockoutLeftOpenOf, registerQuestionsLeftOpen } from "../publish/knockout-left-open.mjs";
import { renderKnockoutHtml } from "../publish/render-knockout.mjs";
import { plainDeferralReason } from "../deferral-row.mjs";
import { PART_NAMES, NOT_COMPLETED } from "../degraded-parts.mjs";
import { parseFrameworkManifest } from "../framework.mjs";

const LEFT_OPEN = plainDeferralReason("unfinished");
const TIMED_OUT = plainDeferralReason("mechanical-fail:timeout");
const row = (state, note) => ({ area: PART_NAMES.register, state, note });
const counts = (identical, containing = { total: 0 }, close = { total: 0, forms: [] }) => ({ name: "QUILLMERE", counts: { identical, containing, close } });

test("a name's question with no answer is one Left open row, partly covered when another question answered", () => {
  const timedOut = { total: null, unavailable: "provider error (after one in-tool retry): gateway timed out" };
  assert.deepEqual(registerQuestionsLeftOpen(counts(timedOut), {
    terms: [{ term: "QUILLMERE", basis: "identical", ok: false, state: "failed", reason: "gateway timed out" },
      { term: "QUILMERE", basis: "close", ok: true, state: "zero", total: 0 }],
  }), [row("coverage-limited", TIMED_OUT)], "the count and the listing are one gap, in the timeout line");

  assert.deepEqual(registerQuestionsLeftOpen(counts(timedOut), { terms: [{ ok: false, state: "failed", reason: "HTTP 502 from the register" }] }),
    [row("coverage-limited", LEFT_OPEN)], "one row for the name, the timeout line only where every cause timed out");

  const refused = { total: null, unavailable: 'capability-gap: term "QUILLMERE / MERE QUILL" looks like a list', deterministic: true };
  assert.deepEqual(registerQuestionsLeftOpen(counts(refused, refused, refused), null), [row("not-searched", LEFT_OPEN)],
    "nothing answered: not searched, and the register's words stay on the record");
});

test("an answer is never a gap: a zero, a floor, a set-aside crowd, a refused proposal, a name with no near-spelling", () => {
  assert.deepEqual(registerQuestionsLeftOpen(counts({ total: 0 }), { terms: [{ ok: true, state: "zero", total: 0 }] }), []);
  assert.deepEqual(registerQuestionsLeftOpen(counts({ total: null, approximate: true, floor: 10000 }), null), []);
  assert.deepEqual(registerQuestionsLeftOpen(counts({ total: 412 }), { terms: [{ ok: true, state: "crowd-not-read", setAside: true, total: 412 }] }), []);
  assert.deepEqual(registerQuestionsLeftOpen(counts({ total: 3 }), { terms: [{ ok: false, state: "not-asked", refused: "outside the plan's classes" }] }), []);
  const noForms = { total: null, unavailable: 'no close-variation forms could be generated from "Q" — the name has no near-form under any rule in the table, so there was nothing to count', deterministic: true };
  assert.deepEqual(registerQuestionsLeftOpen(counts({ total: 0 }, { total: 0 }, noForms), null), []);
  assert.deepEqual(registerQuestionsLeftOpen(null, null), [], "an archived run with neither record draws nothing");
});

test("a listing written before its rows kept a state is read by `ok`, and a class the plan took on with no answer is a gap", () => {
  assert.deepEqual(registerQuestionsLeftOpen(null, { terms: [{ ok: true, total: 5 }, { ok: false, total: null, reason: "HTTP 502 from the register" }] }),
    [row("coverage-limited", LEFT_OPEN)]);
  assert.deepEqual(registerQuestionsLeftOpen(counts({ total: 0 }), { terms: [{ ok: true, state: "not-asked", unresolved: true, setAside: true, reason: "the reading did not get to it" }] }),
    [row("coverage-limited", LEFT_OPEN)], "the reading's own words are not printed");
});

const MANIFEST = parseFrameworkManifest({
  schema_version: 1, framework_key: "open-test", title: "Invented test framework", source_deck: "none", entity_label: "the company",
  bands: [{ label: "Severe", tone: "severe" }, { label: "Slight", tone: "low" }], structure: { kind: "matrix", axes: ["Claim Grade", "Conflict Kind"] },
});
const MARKS = [{ name: "QUILLMERE", rating: "Slight", classesSearched: [9], bullets: ["A bullet."], findings: [] },
  { name: "SORRELVANE", rating: "Slight", classesSearched: [9], bullets: ["A bullet."], findings: [] }];
const DOC = (steps = {}) => ({
  scope: { steps },
  client: {
    findings: { marks: MARKS },
    registerCounts: { marks: [counts({ total: null, unavailable: "count threw: socket hang up" }, { total: 7 }), { name: "SORRELVANE", counts: { identical: { total: 0 }, containing: { total: 0 }, close: { total: 0 } } }] },
    registerRecords: { marks: [{ name: "QUILLMERE", terms: [{ ok: false, state: "failed", reason: "socket hang up" }, { ok: true, state: "read", total: 7 }], records: [{ recordId: "r-1" }] },
      { name: "SORRELVANE", terms: [{ ok: true, state: "zero", total: 0 }], records: [] }] },
  },
});

test("each name's page lists its register once, beside a register step that failed, and a clean name's page draws none", () => {
  assert.deepEqual(knockoutLeftOpenOf(DOC(), 0), [row("coverage-limited", LEFT_OPEN)]);
  assert.deepEqual(knockoutLeftOpenOf(DOC(), 1), [], "the name whose every question answered zero");
  assert.deepEqual(knockoutLeftOpenOf(DOC({ reading: { reason: NOT_COMPLETED } }), 0), [row("coverage-limited", plainDeferralReason(NOT_COMPLETED))],
    "the reading that stopped and the question it left are one row");
  assert.deepEqual(knockoutLeftOpen({ listing: { reason: NOT_COMPLETED } }, [], [row("coverage-limited", TIMED_OUT)]), [row("not-searched", plainDeferralReason(NOT_COMPLETED))],
    "a listing that never came back is the register's one row");

  const page = (at) => renderKnockoutHtml({ batch: { overall: "Slight", executiveSummary: "summary" }, marks: [MARKS[at]] }, MANIFEST,
    { runId: "r1", overall: "Slight", leftOpen: knockoutLeftOpenOf(DOC(), at) });
  const html = page(0);
  assert.ok(html.includes("<h2>Left open</h2>"), "the failed name's page has a Left open section");
  const sec = html.slice(html.indexOf("<h2>Left open</h2>"));
  assert.ok(sec.includes(`<div class="ct">Register <span class="cst">`) && sec.includes(LEFT_OPEN), "the register row, in the shipped words");
  assert.doesNotMatch(sec, /socket hang up|count threw/, "the register's own words stay on the record");
  assert.doesNotMatch(page(1), /Left open|class="covcell/, "the clean name's page");
});

const count = (counter) => countRegisterHits({
  marks: [{ name: "QUILLMERE", classes: [9] }], provider: "corsearch", capabilities: capabilitiesFor("corsearch"),
  counter, now: () => new Date("2026-11-23T09:00:00Z"),
});

test("a count the register did not answer is asked once more, and an answer or a fixed refusal is not", async () => {
  const calls = new Map();
  const tally = (p) => { calls.set(p.key, (calls.get(p.key) ?? 0) + 1); return calls.get(p.key); };
  const doc = await count(async (_term, p) => {
    const n = tally(p);
    if (p.key === "identical") { if (n === 1) throw new Error("socket hang up"); return { ok: true, total: 4 }; }
    if (p.key === "containing") return { ok: false, total: null, reason: "HTTP 429: too many requests" };
    return { ok: false, total: null, cause: 'capability-gap: term "QUILMERE" carries a character the register cannot search' };
  });
  const cell = (k) => doc.marks[0].counts[k];
  assert.equal(cell("identical").total, 4, "the dropped connection landed on its second asking");
  assert.equal(calls.get("identical"), 2);
  assert.equal(cell("containing").total, null);
  assert.ok(cell("containing").unavailable, "a count that failed twice stays open");
  assert.equal(calls.get("containing"), 2, "asked twice, not more");
  const closeForms = cell("close").forms?.length ?? 0;
  assert.equal(calls.get("close"), closeForms || 1, "a refusal no retry can change is asked once per form");

  calls.clear();
  await count(async (_term, p) => { tally(p); return p.key === "identical" ? { ok: true, total: null, approximate: true, floor: 10000 } : { ok: true, total: 0 }; });
  assert.equal(calls.get("identical"), 1, "a floor is an answer");
  assert.equal(calls.get("containing"), 1, "a zero is an answer");
});
