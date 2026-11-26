// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A RESEARCH RECORD IS READ ONE WAY BY EVERY READER, AND ONE THAT CANNOT BE READ IS NEVER ONE THAT FOUND NOTHING.
//
// Three readers take the run's saved web research apart: the answers a writer holds (research-answers.mjs), the research
// behind the use checks that the review reads (research-checks.mjs), and the register pages the research saved
// (saved-register-pages.mjs). Each recognised one service's records by its own field names, so a record of another shape
// read as no research at all. They now read through research-records.mjs. This file replays supported, empty, failed and
// unreadable records through the three readers as they run, with a different session and a grid row as controls:
//   - supported records give each reader what it gave before: the same answers held, the same questions listed, the
//     same whole pages;
//   - a record that cannot be read is counted by each reader, held by none, and never read as a search that found
//     nothing; a search that ran and found nothing is a readable record with nothing in it;
//   - a record names the service that produced it, and one written before that field is attributed by its tool name.
// Every name and mark is invented.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const { researchCall, researchResult, researchResultCall } = await import("../research-records.mjs");
const { heldResearchAnswers, questionKey } = await import("../research-answers.mjs");
const { researchAsked, writeResearchChecks } = await import("../research-checks.mjs");
const { savedStatusPages } = await import("../saved-register-pages.mjs");
const { driverDir } = await import("../run-record.mjs");

const W = "clearance-qz-test-synthesis";          // the writer's session
const OTHER = "clearance-qz-test-common-law";     // another stage's session: a control
const TS = (n) => `2026-11-26T10:00:${String(n).padStart(2, "0")}.000Z`;
const call = (n, session, args, result) => ({ ts: TS(n), tool: "perplexity_research", args, ...result, session });

const Q = {
  answered: "Does Brightmoor Ltd sell candles under QZORVAK?",
  empty: "Does Holloway GmbH sell candles under QZORVAK?",
  failed: "Does Lantern Oy sell candles under QZORVAK?",
  unreadable: "Does Quillbrae AB sell candles under QZORVAK?",
  rerun: "Is QZORVAK used for candles in Ireland?",
  other: "Does Fenwick SA sell candles under QZORVAK?",
};

/** A run folder holding every kind of research record, and the other tools' records beside them. */
function runWithResearch() {
  const dir = mkdtempSync(join(tmpdir(), "research-records-"));
  mkdirSync(driverDir(dir), { recursive: true });
  const log = [
    call(1, W, { task: Q.answered }, { ok: true, bytes: 400, citations: 3 }),
    call(2, W, { task: Q.empty }, { ok: true, bytes: 40, citations: 0 }),          // ran, and found nothing
    call(3, W, { task: Q.failed }, { ok: false, error: "rate limited" }),
    call(4, W, { task: Q.unreadable }, { bytes: 90 }),                              // research, but no outcome to read
    call(5, W, "a record of another shape", { ok: true }),                         // research, with no question to read
    call(6, W, { task: "", grid: true }, { ok: true, cells: 40 }),                 // a grid: a control
    call(7, `${W}-rerun1`, { task: Q.rerun }, { ok: true, bytes: 300 }),           // the writer's own retry
    call(8, OTHER, { task: Q.other }, { ok: true, bytes: 200 }),                   // another stage: a control
    { ts: TS(9), tool: "band_lookup", args: { mark: "QZORVAK" }, ok: true, session: W },   // not research
  ];
  writeFileSync(driverDir(dir, "reading-log.jsonl"), log.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const kept = [
    { ts: TS(1), session: W, task: Q.answered, text: "Brightmoor Ltd sells QZORVAK candles online. https://example.test/brightmoor" },
    { ts: TS(2), session: W, task: Q.empty, text: "No result: nothing was found for Holloway GmbH and QZORVAK." },
    { ts: TS(7), session: `${W}-rerun1`, task: Q.rerun, text: "One Irish shop lists QZORVAK candles. https://example.test/ie" },
    { ts: TS(8), session: OTHER, task: Q.other, text: "Fenwick SA lists QZORVAK candles. https://example.test/fenwick" },
  ];
  writeFileSync(driverDir(dir, "research-answers.jsonl"), kept.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return dir;
}

// The register's status page as a fetch hands it over, in markdown, with one whole goods row.
const STATEMENT = "Candles; scented candles; candle holders made of invented alloys";
const statusPage = ["# Invented mark status", "", "## Goods and services", "",
  "| International Class | U.S Class(es) | Class Status | First Use | Use in Commerce | Goods and Services |",
  "|---|---|---|---|---|---|",
  `| 004 - Primary Class | 006, 015 | ACTIVE | Oct. 01, 2024 | Oct. 01, 2024 | ${STATEMENT} |`, "", "## Basis information"].join("\n");
const kept = (kind, items, extra = {}) => ({ tool: "perplexity_research", kind, task: Q.answered, preset: "pro-search", session: W, items, ...extra });
const name = (n) => `2026-11-26T10-00-0${n}-000Z-4242-${n}.json`;

function saveResults(dir) {
  const at = (f) => driverDir(dir, "web-results", f);
  mkdirSync(driverDir(dir, "web-results"), { recursive: true });
  writeFileSync(at(name(1)), JSON.stringify(kept("question", [
    { type: "search_results", results: [{ url: "https://example.test/snippet", snippet: "a search's snippet is not a page" }] },
    { type: "fetch_url_results", contents: [{ url: "https://tsdr.uspto.gov/statusview/sn97000001", snippet: statusPage }] },
  ])));
  writeFileSync(at(name(2)), JSON.stringify(kept("question", [{ type: "search_results", results: [] }])));   // ran, fetched no page
  writeFileSync(at(name(3)), JSON.stringify(kept("grid", [{ type: "sandbox_results", results: [] }])));       // a grid: a control
  writeFileSync(at(name(4)), JSON.stringify({ tool: "perplexity_research", kind: "question", items: "not a list" }));   // unreadable
  writeFileSync(at(name(5)), JSON.stringify({ tool: "another_research_tool", kind: "question", items: [] }));          // unreadable
  writeFileSync(at("qzorvak.json"), JSON.stringify({ mark: "QZORVAK", callNo: 1, attempts: [] }));                    // an owner check
  writeFileSync(at("connotation-reissue-1.json"), JSON.stringify({ tool: "connotation-reissue", queries: [], items: [] }));
}

test("the writer holds what it held before: its stage's completed questions, the empty one among them", () => {
  const held = heldResearchAnswers(runWithResearch(), W);
  assert.deepEqual([...held.keys()].sort(), [Q.answered, Q.empty, Q.rerun].map(questionKey).sort());
  assert.match(held.get(questionKey(Q.answered)).answer, /^Brightmoor Ltd sells/);
  assert.match(held.get(questionKey(Q.empty)).answer, /^No result:/, "a search that ran and found nothing is held, with its answer");
  for (const q of [Q.failed, Q.unreadable, Q.other]) assert.equal(held.has(questionKey(q)), false, `${q} is not this writer's completed answer`);
});

test("a call whose record cannot be read is counted, and is never held as a completed search", () => {
  const dir = runWithResearch();
  assert.equal(heldResearchAnswers(dir, W).unreadable, 2, "the writer's two unreadable calls");
  assert.equal(heldResearchAnswers(dir, OTHER).unreadable, 0, "another stage's count does not include them");
  assert.equal(Object.keys(heldResearchAnswers(dir, W)).length, 0, "the count is no entry of the map");
});

test("the review is handed the same questions as before; an unreadable call with a question is not completed, a grid is not a question", () => {
  const dir = runWithResearch();
  const { asked, unreadable } = researchAsked(dir, W);
  assert.deepEqual(asked, [
    { question: Q.answered, ok: true, error: null },
    { question: Q.empty, ok: true, error: null },
    { question: Q.failed, ok: false, error: "rate limited" },
    { question: Q.unreadable, ok: false, error: null },
    { question: Q.rerun, ok: true, error: null },
  ]);
  assert.equal(unreadable, 2);
  // The file the review reads lists them in its own words, and nothing new.
  writeFileSync(join(dir, "findings.json"), JSON.stringify({ findings: [] }));
  const text = readFileSync(writeResearchChecks(dir, { findingsAt: join(dir, "findings.json"), held: heldResearchAnswers(dir, W), sessionKey: W }), "utf8");
  const listed = text.split("## Research questions the writer asked, with their outcomes\n\n")[1].trim().split("\n");
  assert.deepEqual(listed, [
    `- "${Q.answered}": completed`,
    `- "${Q.empty}": completed`,
    `- "${Q.failed}": did not complete (rate limited)`,
    `- "${Q.unreadable}": did not complete (failed)`,
    `- "${Q.rerun}": completed`,
  ]);
  assert.doesNotMatch(text, /unreadable|could not be read/i, "no new words reach the review");
  assert.equal(researchAsked(dir, OTHER).asked.map((a) => a.question).join(), Q.other, "another stage asked one question");
});

test("the register pages are the whole pages a question fetched; an unreadable result is counted, an empty one is not", () => {
  const dir = runWithResearch();
  saveResults(dir);
  const pages = savedStatusPages(dir)();
  assert.deepEqual([...pages.keys()], ["97000001"]);
  assert.deepEqual(pages.get("97000001"), [{ question: 1, goods: [{ cls: "4", text: STATEMENT }] }]);
  assert.equal(pages.unreadable, 2, "the two results that parsed but could not be read");
  // Removing the empty and the grid results changes nothing; the owner check and the reissue were never research.
  assert.equal(researchResultCall("qzorvak.json"), null);
  assert.equal(researchResultCall("connotation-reissue-1.json"), null);
  assert.equal(savedStatusPages(null)().unreadable, 0);
});

test("one reading underneath: three answers, never two, and the service is the record's own", () => {
  assert.equal(researchCall({ tool: "band_lookup", args: { task: "x" }, ok: true }), null, "another tool's row is not research");
  assert.deepEqual(researchCall(call(1, W, { task: Q.answered }, { ok: true })),
    { known: true, service: "perplexity", kind: "question", question: Q.answered, ok: true, error: null, session: W, replay: false });
  assert.equal(researchCall(call(2, W, { task: Q.empty }, { ok: true })).known, true, "found nothing, and readable");
  assert.equal(researchCall(call(4, W, { task: Q.unreadable }, {})).known, false, "no outcome: unreadable, not empty");
  assert.equal(researchCall(call(6, W, { task: "", grid: true }, { bytes: 1 })).kind, "grid", "an unreadable grid is still a grid");
  assert.equal(researchCall({ ...call(1, W, { task: Q.answered }, { ok: true }), service: "another-service" }).service, "another-service",
    "a record that names its service is read as that service's");
  assert.equal(researchResult(kept("question", [])).known, true, "a kept result with nothing in it is readable");
  assert.deepEqual(researchResult(kept("question", [])).pages, []);
  assert.equal(researchResult(kept("summary", [])).known, false, "a kind this module does not read");
  assert.equal(researchResult(null).known, false);
  assert.deepEqual(researchResult(kept("grid", [{ type: "fetch_url_results", contents: [{ url: "https://example.test", snippet: "x" }] }])).pages, [],
    "a grid's result gives no page");
});
