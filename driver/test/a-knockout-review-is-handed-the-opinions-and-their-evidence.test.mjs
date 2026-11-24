// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A KNOCKOUT'S REVIEW IS HANDED THE OPINIONS AND THEIR EVIDENCE, composed by code from what the run holds: each name's opinion as
// rated, with its own rating group's summary and never the next group's; each cited source once, with what the run holds of it;
// what was searched for each name; and the web leads each rating set aside, with its reason. A correction is handed what its defect
// rests on. Names here are invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { opinionDigest, citedEvidence, searchedAndSetAside, defectEvidence, EVIDENCE_GOODS_CHARS } from "../ko-review-evidence.mjs";

const LISTING = "https://shop.example.test/quillbrae-candles";

function run() {
  const dir = mkdtempSync(join(tmpdir(), "ko-evidence-"));
  mkdirSync(join(dir, "_driver"), { recursive: true });
  mkdirSync(join(dir, "research"), { recursive: true });
  mkdirSync(join(dir, "register-filings"), { recursive: true });
  const filing = { recordId: "tm_1", question: "ko-quillbrae:identical", mark: "QUILLBRAE", owner: "Brightmoor Candle Co", status: "Registered", territory: "EU",
    classes: [4], goods: ["4: candles"], fullRecord: "register-filings/tm_1.json", carriedBecause: "the same mark on candles" };
  writeFileSync(join(dir, "register-filings", "tm_1.json"), JSON.stringify({ goodsServices: [{ classes: [4], description: `candles; ${"wax tapers; ".repeat(200)}` }, { classes: [16], description: "paper" }] }));
  writeFileSync(join(dir, "_driver", "register-records.json"), JSON.stringify({ marks: [
    { name: "QUILLBRAE", records: [filing, { recordId: "tm_2", mark: "QUILBRAY", owner: "Tarnfeld Ltd", status: "Registered", classes: [4] }],
      setAsideRecords: [], terms: [{ qid: "ko-quillbrae:identical", basis: "identical", term: "QUILLBRAE", state: "listed", total: 2, fetched: 2 }],
      reading: { setAside: [], notAsked: [{ question: "A sound-alike question", why: "the identical list answers it" }] } },
    { name: "MOSSVALE", records: [], setAsideRecords: [], terms: [{ qid: "ko-mossvale:identical", basis: "identical", term: "MOSSVALE", state: "zero", total: 0, fetched: 0 }] },
  ] }));
  writeFileSync(join(dir, "research", "quillbrae.md"), JSON.stringify({ cells: [{ term: "QUILLBRAE", platform: "web", candidates: [{ title: "Quillbrae candles", url: LISTING }] }] }));
  writeFileSync(join(dir, "research", "owner-brightmoor.md"), "Brightmoor Candle Co sells candles in the EU. https://brightmoor.example.test");
  writeFileSync(join(dir, "_driver", "owner-checks.json"), JSON.stringify({ checks: [{ mark: "QUILLBRAE", owner: "Brightmoor Candle Co", ok: true, query: "q1", payloadFile: "owner-brightmoor.md",
    recordIds: ["tm_1"], filingMarks: [{ mark: "QUILLBRAE", classes: [4] }] }] }));
  // Two rating groups, each opening with its own line before its names' headings, as the order's summary joins them.
  writeFileSync(join(dir, "_driver", "knockout-chunks.json"), JSON.stringify({ chunks: [["QUILLBRAE"], ["MOSSVALE"]] }));
  writeFileSync(join(dir, "knockout-assess-0.json"), JSON.stringify({ chunkSummary: "One name screened: QUILLBRAE, rated High.\n\n## QUILLBRAE — High\n- The same mark on candles." }));
  writeFileSync(join(dir, "knockout-assess-1.json"), JSON.stringify({ chunkSummary: "One name screened: MOSSVALE, rated Low.\n\n## MOSSVALE — Low\n- Nothing found." }));
  return dir;
}

const RECORD = { batch: { executiveSummary: "One name screened: QUILLBRAE, rated High.\n\n## QUILLBRAE — High\n- The same mark on candles.\n\nOne name screened: MOSSVALE, rated Low.\n\n## MOSSVALE — Low\n- Nothing found." },
  marks: [
    { name: "QUILLBRAE", rating: "High", basis: "The same mark on candles.", assessment: "QUILLBRAE meets a registered mark.",
      findings: [{ ordinal: 1, name: "QUILLBRAE", owner: "Brightmoor Candle Co", type: "Registered mark", band: "High", net: "The same mark.", basis: "Identical on candles.", weighedFilings: ["tm_1"], evidence: [LISTING] }],
      registerReads: [{ recordId: "tm_2", read: "A different mark." }],
      setAside: [{ url: "https://itch.example.test/quillbrae", ground: "a single listing with no sign of trade" }] },
    { name: "MOSSVALE", rating: "Low", basis: "Nothing found.", assessment: "MOSSVALE meets nothing.", findings: [], registerReads: [], setAside: [] },
  ] };

test("each name's opinion carries its own group's summary, never the next group's opening line", () => {
  const digest = opinionDigest(RECORD, run()).join("\n");
  assert.match(digest, /### "QUILLBRAE": High/);
  assert.match(digest, /1\. QUILLBRAE, Brightmoor Candle Co · Registered mark · High: The same mark\. Reasoning: Identical on candles\. Sources: tm_1, https:\/\/shop\.example\.test\/quillbrae-candles/);
  assert.match(digest, /Register read tm_2: A different mark\./);
  const quill = digest.slice(digest.indexOf('### "QUILLBRAE"'), digest.indexOf('### "MOSSVALE"'));
  assert.match(quill, /In the order's summary: One name screened: QUILLBRAE, rated High\./);
  assert.ok(!quill.includes("MOSSVALE, rated Low"), "the next group's opening line reached this name");
});

test("each cited source is handed once with what the run holds of it, a filing's goods in the classes asked, cut and said so", () => {
  const dir = run();
  const plan = { marks: [{ name: "QUILLBRAE", classes: [4] }, { name: "MOSSVALE", classes: [4] }] };
  const { sources, ownerChecks } = citedEvidence(RECORD, dir, plan);
  const filing = sources.find((l) => l.startsWith("- tm_1 "));
  assert.ok(filing, sources.join("\n"));
  assert.match(filing, /"QUILLBRAE" · Brightmoor Candle Co · Registered · EU · classes 4/);
  assert.ok(filing.includes("goods in the classes asked: 4: candles; wax tapers;"), "the goods in the class asked are not handed");
  assert.ok(!filing.includes("paper"), "a class the name does not ask for is handed");
  assert.match(filing, /… \(cut; whole wording by record_id\)/);
  assert.ok(filing.length < EVIDENCE_GOODS_CHARS + 600, "the goods were not cut");
  assert.match(filing, /carried under "QUILLBRAE" \(the same mark on candles\) · cited by "QUILLBRAE" finding 1$/);
  assert.match(sources.find((l) => l.startsWith("- tm_2 ")), /goods by record_id/, "an unbanded read's filing carries its goods");
  const sourceOf = (l) => l.split(" · ")[0];   // a source line opens with the source it holds
  assert.match(sources.find((l) => sourceOf(l) === `- ${LISTING}`), /"Quillbrae candles" · returned by the search for "QUILLBRAE" on web/);
  assert.deepEqual(ownerChecks, ['- Brightmoor Candle Co (proprietor of the filings for "QUILLBRAE"), filings tm_1: Brightmoor Candle Co sells candles in the EU. https://brightmoor.example.test']);
});

test("what was searched for each name, and the web leads each rating set aside, are rows that open with their name", () => {
  const { searched, setAside } = searchedAndSetAside(RECORD, run());
  assert.ok(searched.includes('- "QUILLBRAE": ko-quillbrae:identical (identical): QUILLBRAE · listed, 2 filing(s), 2 fetched'), searched.join("\n"));
  assert.ok(searched.includes('- "QUILLBRAE": Not asked: A sound-alike question · the identical list answers it'));
  assert.ok(searched.includes('- "MOSSVALE": ko-mossvale:identical (identical): MOSSVALE · zero, 0 filing(s), 0 fetched'));
  assert.deepEqual(setAside, ['- "QUILLBRAE": https://itch.example.test/quillbrae · a single listing with no sign of trade']);
});

test("a correction is handed what its defect rests on and what the finding it names cites, and nothing else", () => {
  const dir = run();
  const plan = { marks: [{ name: "QUILLBRAE", classes: [4] }] };
  const { sources } = defectEvidence([{ mark: "QUILLBRAE", finding: 1, rests_on: ["https://nowhere.example.test/x"] }], RECORD, dir, plan);
  assert.equal(sources.length, 3, sources.join("\n"));
  assert.match(sources[0], /https:\/\/nowhere\.example\.test\/x · not held by this run/);
  assert.ok(sources.some((l) => l.startsWith("- tm_1 ")) && sources.some((l) => l.split(" · ")[0] === `- ${LISTING}`));
  assert.ok(!sources.some((l) => l.startsWith("- tm_2 ")), "a source no defect or finding names is handed");
});
