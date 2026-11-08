// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A KNOCKOUT READS THE REGISTER BY JUDGMENT. The lane used to list the name and up to twelve mechanical forms, each with
// an equal share of 100 records in the register's order. Now the code takes the counts and each name's own list, and a
// reading step asks what the reading rule calls for through the clearance's own mint and executor. These tests run that
// path over a stand-in register, with invented names. They prove what a question costs and records, not what a model
// would choose: a replay on saved data measures that.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { driverDir } from "../../shared/driver-dir.mjs";
import { proposeSupplemental } from "../engine/mcp/supplemental.mjs";
import { buildGatherMcpConfig, allowedToolsFor, toolGroupsForStage } from "../engine/mcp/gather-config.mjs";
import { countRegisterHits, variantFormsLine } from "../register-count.mjs";
import { capabilitiesFor } from "../register-capabilities.mjs";
import { fixtureFileName, fixtureLister, recordsLine } from "../register-records.mjs";
import { writeFixtureMarker } from "../register-fixture-marker.mjs";
import { executeQuestionsWithLister, knockoutAxis, knockoutBandBlocks, knockoutBandPath, knockoutListView, knockoutProposals,
  knockoutQuestionPlan, knockoutRecordsDoc, openingQid, questionPlanPath, questionsOwed, resolveQuestionExecutor, runPrefixOfSession, unfoldFormCounts, withCitedFilings, withHeldGoods } from "../knockout-register-read.mjs";
import { registerRecordIdsFor } from "../verify-knockout.mjs";
import { ownersOwedACheck } from "../owner-use-check.mjs";
import { acceptKnockoutRegister, recordKnockoutRegisterRead, settledKnockoutReading, validateKnockoutRegisterFile, knockoutRegisterFile, mergeKnockoutRegisterCall } from "../knockout-register-record.mjs";
import { readingDoc } from "./knockout-reading-fixture.mjs";
import { KO_STAGES, koPaths } from "../stages-knockout.mjs";
import { beginAnswerMemory } from "../../providers/_shared/answer-memory.mjs";

const CLARIVATE = capabilitiesFor("clarivate");
const NAME = "QUILLBRAE";
const row = (id, mark = NAME, extra = {}) => ({ record_id: `/mark/em/${id}`, mark_text: mark, owner_name: `Owner ${id}`, status: "Registered", classes: [9], office: "em", ...extra });
const rows = (n, prefix = "r") => Array.from({ length: n }, (_, i) => row(`${prefix}${i}`));

/** A stand-in register: an answer per question, keyed on the term, mode, goods and market. A question it holds no answer for fails. */
const standIn = (answers, asked = []) => async (term, q = {}) => {
  asked.push({ term, ...q });
  const key = [term, q.matchMode && q.matchMode !== "exact" ? q.matchMode : null, q.goods?.length ? `goods:${q.goods.join("+")}` : null,
    q.scoped && q.regions?.length ? `in:${q.regions.join("+")}` : null].filter(Boolean).join("|");
  const a = answers[key];
  if (a === undefined) return { ok: false, records: null, reason: `no saved answer for ${key}` };
  return typeof a === "number" ? { ok: true, total: a, records: [] } : { ok: true, total: a.length, records: a };
};

/** The real propose tool over the stand-in, on one name's axis. */
const ask = (runDir, name, lister, proposals) => proposeSupplemental({ axis: knockoutAxis(name), output_path: knockoutBandPath(runDir, name), proposals },
  { kind: "propose_supplemental", recordLog: driverDir(runDir, "register-record-bodies.jsonl") },
  { executePlan: (params) => executeQuestionsWithLister(lister, params), capabilities: CLARIVATE });

const marks = [{ name: NAME, classes: [9] }];
const scope = { marks, classes: [9], jurisdictions: ["EU", "US"], provider: "clarivate", capabilities: CLARIVATE };

test("a manageable exact list is read in full: no share, no cut, whatever order the register answers in", async () => {
  const list = rows(130);
  const { doc } = await readingDoc({ ...scope, lister: standIn({ [NAME]: list }, []), variantCap: 0 });
  const m = doc.marks[0];
  assert.equal(m.records.length, 130, "every row of the name's own list reaches the record when no reading step set any aside");
  assert.equal(m.capped, false);
  assert.equal(m.terms[0].state, "read");
  assert.equal(m.terms[0].total, 130);
  // Reversed, the same filings: the register's order decides nothing.
  const { doc: again } = await readingDoc({ ...scope, lister: standIn({ [NAME]: [...list].reverse() }, []), variantCap: 0 });
  assert.deepEqual(again.marks[0].records.map((r) => r.recordId).sort(), m.records.map((r) => r.recordId).sort());
});

// ── THE MODEL SEES THE COUNT BEFORE ANYTHING IS READ ────────────────────────────────────────────

test("below the fetch limit and above it, nothing is read until the step asks: the count alone is the first answer", async () => {
  for (const [label, total] of [["below the limit", 130], ["at the edge", 600], ["above the limit", 903]]) {
    const asked = [];
    const lister = standIn({ [NAME]: total > 600 ? total : rows(total) }, asked);
    const dir = mkdtempSync(join(tmpdir(), "ko-count-first-"));
    mkdirSync(driverDir(dir), { recursive: true });
    const counts = await countRegisterHits({ ...scope, variantCap: 0, counter: async (term, p, o) => {
      const r = await lister(term, { ...o, matchMode: p.matchMode, count: true });
      return r?.ok ? { ok: true, total: r.total } : { ok: false, total: null, reason: r?.reason };
    } });
    writeFileSync(driverDir(dir, "instructed-scope.json"), JSON.stringify({ marks: [NAME] }));
    writeFileSync(driverDir(dir, "register-counts.json"), JSON.stringify(counts));
    writeFileSync(questionPlanPath(dir), JSON.stringify(knockoutQuestionPlan({ ...scope })));
    assert.equal(counts.marks[0].counts.identical.total, total, label);
    assert.equal(knockoutBandBlocks(dir, NAME).size, 0, `${label}: nothing was read with the counts`);
    // The step may not leave the name's own question unasked, whatever its count.
    const refused = recordKnockoutRegisterRead(dir, { marks: [{ name: NAME, carried: [], set_aside: [{ question: openingQid(NAME, "identical"), why: "looks crowded" }], not_asked: [] }] });
    assert.match(String(refused.refused), /no question was asked on it/, `${label}: a reason does not stand in for the name's own question`);
    // Asked: a list it can read comes back whole; a crowd comes back as the crowd it is, with nothing fetched.
    const reply = JSON.parse((await ask(dir, NAME, lister, [{ predicate: "exact", term: NAME, nice_classes: [9], rationale: "the name's own list" }])).text);
    const block = knockoutBandBlocks(dir, NAME).get(reply.minted[0]);
    if (total > 600) {
      assert.equal(block.state, "incomplete", label);
      assert.equal(block.total_hits, total, label);
      assert.deepEqual(block.records ?? [], [], `${label}: nothing is fetched over the limit`);
    } else {
      assert.equal(block.state, "enumerated", label);
      assert.equal(block.records.length, total, `${label}: the selected list is read in full`);
    }
  }
});

test("a list under the limit can still be narrowed first: the step chooses, and nothing was fetched for the wider list", async () => {
  const asked = [];
  const wide = rows(500);
  const lister = standIn({ [NAME]: wide, [`${NAME}|goods:tonic`]: wide.slice(0, 12) }, asked);
  const { doc, runDir } = await readingDoc({ ...scope, lister, variantCap: 0, execute: async () => ({ ok: true }), ask: async ({ runDir: dir }) => {
    asked.length = 0;
    await ask(dir, NAME, lister, [{ predicate: "exact", term: NAME, nice_classes: [9], goods_words: ["tonic"], narrows: openingQid(NAME, "identical"), rationale: "narrowed before reading" }]);
  }, reading: null });
  assert.deepEqual(asked.map((a) => a.goods), [["tonic"]], "the only question sent was the narrowed one");
  const m = doc.marks[0];
  assert.equal(m.records.length, 12);
  assert.equal(m.terms.find((t) => t.qid === openingQid(NAME, "identical")).state, "narrowed", "the wider list stays on the record, answered by the narrowing");
  assert.deepEqual(questionsOwed({ name: NAME, countsEntry: { counts: { identical: { total: 500 } } }, blocks: knockoutBandBlocks(runDir, NAME),
    proposals: knockoutProposals(runDir, NAME).entries, carried: new Set(m.records.map((r) => r.recordId)) }), []);
});

test("a crowded exact answer is counted, not read, and a goods narrowing answers it with both counts on the record", async () => {
  const narrowed = rows(40, "g");
  const lister = standIn({ [NAME]: 903, [`${NAME}|goods:tonic`]: narrowed });
  let held = null;
  const { doc } = await readingDoc({ ...scope, lister, variantCap: 0,
    ask: async ({ runDir }) => {
      held = runDir;
      const r = JSON.parse((await ask(runDir, NAME, lister, [{ predicate: "exact", term: NAME, nice_classes: [9], goods_words: ["tonic"],
        narrows: openingQid(NAME, "identical"), rationale: "the client's goods" }])).text);
      assert.equal(r.minted.length, 1, JSON.stringify(r));
    } });
  const m = doc.marks[0];
  const crowd = m.terms.find((t) => t.qid === openingQid(NAME, "identical"));
  assert.equal(crowd.total, 903, "the crowd stays on the record with its count");
  assert.equal(crowd.state, "narrowed");
  const answer = m.terms.find((t) => t.narrows === openingQid(NAME, "identical"));
  assert.equal(answer.total, 40);
  assert.deepEqual(answer.goods, ["tonic"]);
  assert.equal(answer.purpose, "the client's goods");
  assert.equal(m.records.length, 40, "the selected list is read in full");
  assert.deepEqual(questionsOwed({ name: NAME, countsEntry: { counts: { identical: { total: 903 } } }, blocks: knockoutBandBlocks(held, NAME),
    proposals: knockoutProposals(held, NAME).entries, carried: new Set(m.records.map((r) => r.recordId)) }), [], "a narrowing that answered the crowd leaves nothing owed");
  assert.equal(m.available, null, "a crowd no one read holds filings no one can count against this list");
});

test("a justified containing search, a near form and a sound-alike question are each their own question, with their own predicate", async () => {
  const asked = [];
  const lister = standIn({ [NAME]: 0, QUILLBREY: [row("nf1", "QUILLBREY")], [`BRAE|default|goods:tonic`]: [row("c1", "BRAE TONIC")], [`${NAME}|phonetic`]: [row("p1", "KWILBRAY")] }, asked);
  const { doc } = await readingDoc({ ...scope, lister, variantCap: 0, ask: async ({ runDir }) => {
    await ask(runDir, NAME, lister, [
      { predicate: "exact", term: "QUILLBREY", nice_classes: [9], rationale: "a spelling a filer could have used" },
      { predicate: "default", term: "BRAE", nice_classes: [9], goods_words: ["tonic"], rationale: "the word that carries the name" },
      { predicate: "phonetic", term: NAME, nice_classes: [9], rationale: "a sound-alike near form" },
    ]);
  } });
  const m = doc.marks[0];
  const of = (p) => m.terms.find((t) => t.predicate === p && t.qid?.startsWith("supp:"));
  assert.equal(of("exact").term, "QUILLBREY");
  assert.equal(of("default").term, "BRAE");
  assert.equal(of("phonetic").term, NAME);
  assert.deepEqual(asked.filter((a) => a.matchMode === "phonetic").map((a) => a.term), [NAME]);
  assert.equal(m.records.length, 3, "every list the step asked for was read");
  assert.deepEqual(m.records.map((r) => r.matchedBasis), ["close", "close", "close"], "only the name's own question is `identical`");
});

test("a provider failure is a failure on the record, never a zero, and the page says so", async () => {
  const lister = standIn({ [NAME]: 0 });
  const { doc } = await readingDoc({ ...scope, lister, variantCap: 0, ask: async ({ runDir }) => {
    await ask(runDir, NAME, lister, [{ predicate: "exact", term: "QUILLBREY", nice_classes: [9], rationale: "a near form" }]);
  } });
  const t = doc.marks[0].terms.find((x) => x.term === "QUILLBREY");
  assert.equal(t.ok, false);
  assert.equal(t.state, "failed");
  assert.match(t.reason, /no saved answer/);
  assert.match(recordsLine(doc.marks[0]), /could not be run/);
  assert.doesNotMatch(recordsLine(doc.marks[0]), /returned none/);
});

test("a question the safety net did not send stays on the record as not asked, never as clean", () => {
  const doc = knockoutRecordsDoc({ ...scope, counts: { marks: [{ name: NAME, counts: { identical: { total: 0 } } }] }, reading: null, readBlocks: () => new Map(),
    readProposals: () => ({ entries: [], rejected: [{ issue: "follow-up-not-sent", proposal: { predicate: "exact", term: "QUILLBREY" } }] }) });
  const t = doc.marks[0].terms.find((x) => x.term === "QUILLBREY");
  assert.deepEqual([t.ok, t.state], [false, "not-asked"]);
  assert.doesNotMatch(recordsLine(doc.marks[0]), /returned none/);
});

test("zero, failed, not asked and a crowd not read are four different states", () => {
  const counts = { marks: [{ name: NAME, counts: { identical: { total: 5000 } } }] };
  const blocks = new Map([
    [openingQid(NAME, "identical"), { qid: openingQid(NAME, "identical"), state: "incomplete", total_hits: 5000 }],
    ["q-zero", { qid: "q-zero", state: "enumerated", total_hits: 0, records: [] }],
    ["q-fail", { qid: "q-fail", state: "incomplete", total_hits: 0, error: true, reason: "provider error: down" }],
  ]);
  const entries = [{ qid: "q-zero", predicate: "exact", term: "A" }, { qid: "q-fail", predicate: "exact", term: "B" }, { qid: "q-unsent", predicate: "exact", term: "C" }];
  const doc = knockoutRecordsDoc({ ...scope, counts, reading: null, readBlocks: () => blocks, readProposals: () => ({ entries }) });
  const stateOf = (term) => doc.marks[0].terms.find((t) => t.term === term).state;
  assert.equal(stateOf(NAME), "crowd-not-read");
  assert.equal(stateOf("A"), "zero");
  assert.equal(stateOf("B"), "failed");
  assert.equal(stateOf("C"), "not-asked");
});

test("alternative word orders are counted and asked separately, stay tied to the instructed item, and a list is refused as one term", async () => {
  const LISTED = "BRAE QUILL / QUILL BRAE";
  const framedMarks = [{ name: LISTED, alternatives: ["BRAE QUILL", "QUILL BRAE"] }];
  const asked = [];
  const lister = standIn({ "BRAE QUILL": [row("a1", "BRAE QUILL")], "QUILL BRAE": 0, [`BRAE QUILL|default`]: 2, [`QUILL BRAE|default`]: 0 }, asked);
  const scoped = { ...scope, marks: [{ name: LISTED, classes: [9] }], framedMarks };
  const { doc, counts } = await readingDoc({ ...scoped, lister, variantCap: 0, ask: async ({ runDir }) => {
    const refused = JSON.parse((await ask(runDir, LISTED, lister, [{ predicate: "exact", term: LISTED, nice_classes: [9] }])).text);
    assert.equal(refused.minted.length, 0, "a list is not one exact name");
    assert.ok(refused.rejected.length >= 1);
  } });
  assert.ok(!asked.some((a) => a.term === LISTED), "the list itself never reached the register");
  const m = doc.marks[0];
  assert.equal(m.name, LISTED);
  assert.deepEqual(m.terms.filter((t) => t.basis === "identical").map((t) => t.term).sort(), ["BRAE QUILL", "QUILL BRAE"]);
  assert.deepEqual(m.records.map((r) => r.matchedBasis), ["identical"]);
  const cell = counts.marks[0].counts.identical;
  assert.equal(counts.marks.length, 1, "one row for the one requested item");
  assert.equal(cell.total, 1, "the name's count is its forms' answers");
  assert.deepEqual(cell.alternatives.map((a) => [a.term, a.total]), [["BRAE QUILL", 1], ["QUILL BRAE", 0]]);
  assert.equal(counts.marks[0].counts.containing.total, 2);
});

test("a form with no answer leaves the name's count open, never a smaller sum", async () => {
  const framedMarks = [{ name: "A / B", alternatives: ["BRAEMOSS", "MOSSBRAE"] }];
  const { counts } = await readingDoc({ ...scope, marks: [{ name: "A / B", classes: [9] }], framedMarks, variantCap: 0, lister: standIn({ BRAEMOSS: 4 }) });
  assert.equal(counts.marks[0].counts.identical.total, null);
  assert.match(String(counts.marks[0].counts.identical.unavailable), /no saved answer/);
});

test("a resume reuses each form's count: the folded record unfolds to the rows the count lane holds", async () => {
  const framedMarks = [{ name: "A / B", alternatives: ["BRAEMOSS", "MOSSBRAE"] }];
  const { counts } = await readingDoc({ ...scope, marks: [{ name: "A / B", classes: [9] }], framedMarks, variantCap: 0, lister: standIn({ BRAEMOSS: 4, MOSSBRAE: 0, "BRAEMOSS|default": 4, "MOSSBRAE|default": 0 }) });
  assert.deepEqual(unfoldFormCounts(counts).marks.map((m) => m.name), ["BRAEMOSS", "MOSSBRAE"]);
});

// ── THE HANDOFF ────────────────────────────────────────────────────────────────────────────────

test("a filing weighed for another name reaches that name's page and its listed count, keeps where it was found, and leaves its search figures", () => {
  const terms = [{ basis: "identical", ok: true, total: 0, fetched: 0, state: "zero" }];
  const doc = { marks: [{ name: NAME, records: [], fetched: 0, available: 0, terms },
    { name: "MOSSVALE", records: [{ recordId: "a", matchedForm: "MOSSVALE", matchedBasis: "identical", question: "q1", carriedBecause: "same goods" }], fetched: 1,
      setAsideRecords: [{ recordId: "b", matchedForm: "MOSS VALE", matchedBasis: "close", question: "q2" }] }] };
  const rated = (ids) => ({ marks: [{ name: NAME, registerReads: ids.map((recordId) => ({ recordId, read: "r" })), findings: [] }, { name: "MOSSVALE" }] });
  const moved = withCitedFilings(doc, rated(["a", "b"]));
  assert.deepEqual(moved.marks[0].records, [
    { recordId: "a", matchedForm: null, matchedBasis: null, foundUnder: { name: "MOSSVALE", question: "q1", form: "MOSSVALE", basis: "identical" } },
    { recordId: "b", matchedForm: null, matchedBasis: null, foundUnder: { name: "MOSSVALE", question: "q2", form: "MOSS VALE", basis: "close" } }],
    "no field says this name was searched for it, and where it was found rides apart");
  assert.equal(moved.marks[0].fetched, 0, "this name's searches found no more than they did");
  assert.deepEqual(moved.marks[0].terms, terms, "and its questions are as they were");
  assert.match(recordsLine(moved.marks[0]), /^2 filings listed/, "the list says what the page shows");
  assert.doesNotMatch(recordsLine({ ...moved.marks[0], available: 9 }), /out of/, "and compares it with no search figure: they are different populations");
  assert.deepEqual(moved.marks[1], doc.marks[1], "the filing stays where it was found");
  assert.equal(withCitedFilings(doc, rated(["held-nowhere"])), doc, "an id held nowhere changes nothing, and the gate refuses it");
});

test("a name whose own question failed is a failure, not a crowd set aside, and its count stands", () => {
  const asked = { entries: [{ qid: "supp:own", predicate: "exact", term: NAME, nice_classes: [9] }], rejected: [] };
  const counts = { marks: [{ name: NAME, counts: { identical: { total: 9 }, containing: { total: 0 }, close: { total: 0, forms: [] } } }] };
  const doc = knockoutRecordsDoc({ marks, classes: [9], provider: "clarivate", capabilities: CLARIVATE, counts, reading: null,
    readBlocks: () => new Map([["supp:own", { qid: "supp:own", state: "incomplete", error: true, reason: "provider error", records: [] }]]), readProposals: () => asked }).marks[0];
  const opening = doc.terms.find((t) => t.basis === "identical" && t.qid === openingQid(NAME, "identical"));
  assert.deepEqual([opening.state, opening.ok, opening.total, opening.setAside], ["failed", true, 9, undefined]);
  assert.match(recordsLine(doc), /^Filings: not available — 1 of \d+ search\(es\) could not be run/, "one question failed, counted once");
});

test("a list is compared with the distinct filings its questions returned, and only where every question was read", async () => {
  const own = rows(5);
  const askedTwice = { entries: [{ qid: "supp:own", predicate: "exact", term: NAME, nice_classes: [9] }, { qid: "supp:wide", predicate: "default", term: NAME, nice_classes: [9] }], rejected: [] };
  const counts = { marks: [{ name: NAME, counts: { identical: { total: 5 }, containing: { total: 5 }, close: { total: 0, forms: [] } } }] };
  const docWith = (blocks, reading) => knockoutRecordsDoc({ marks, classes: [9], provider: "clarivate", capabilities: CLARIVATE, counts, reading,
    readBlocks: () => new Map(blocks.map((b) => [b.qid, b])), readProposals: () => askedTwice }).marks[0];
  const read = docWith([listBlock("supp:own", own), listBlock("supp:wide", own)], null);
  assert.equal(read.available, 5, "the name asked twice and a wider question over the same filings are five filings, not fifteen");
  assert.equal(recordsLine(read), "5 filings listed.");
  const reading = { marks: [{ name: NAME, carried: [{ records: own.slice(0, 2).map((r) => r.record_id), why: "same goods" }], set_aside: [{ question: "supp:own", why: "other goods" }], not_asked: [] }] };
  const carriedTwo = docWith([listBlock("supp:own", own), listBlock("supp:wide", own)], reading);
  assert.match(recordsLine(carriedTwo), /^2 filings listed, out of 5 hits across the searches run/);
  const crowded = docWith([listBlock("supp:own", own), { qid: "supp:wide", state: "incomplete", total_hits: 900, records: [] }], reading);
  assert.equal(crowded.available, null, "a crowd no one read holds filings no one can count against this list");
  assert.doesNotMatch(String(recordsLine(crowded)), /out of/);
});

test("a set-aside filing the rating cites moves up with the carried ones; one it does not stays set aside", () => {
  const doc = { marks: [{ name: NAME, records: [{ recordId: "a" }], fetched: 1, setAsideRecords: [{ recordId: "b" }, { recordId: "c" }] }] };
  const moved = withCitedFilings(doc, { marks: [{ name: NAME, registerReads: [{ recordId: "b", read: "the goods are the client's" }], findings: [{ weighedFilings: ["a"] }] }] });
  assert.deepEqual(moved.marks[0].records.map((r) => r.recordId), ["a", "b"]);
  assert.equal(moved.marks[0].records[1].citedFromSetAside, true);
  assert.deepEqual(moved.marks[0].setAsideRecords.map((r) => r.recordId), ["c"]);
  assert.equal(moved.marks[0].fetched, 2);
  assert.equal(withCitedFilings(doc, { marks: [{ name: NAME }] }).marks[0].records.length, 1, "nothing cited, nothing moved");
});

test("what the step sets aside the rating step may cite: its ids join the run's record, and only this name's", () => {
  const dir = mkdtempSync(join(tmpdir(), "ko-cite-"));
  mkdirSync(driverDir(dir), { recursive: true });
  writeFileSync(driverDir(dir, "register-records.json"), JSON.stringify({ marks: [{ name: NAME, records: [{ recordId: "a" }], setAsideRecords: [{ recordId: "b" }] }, { name: "MOSSVALE", records: [{ recordId: "z" }] }] }));
  assert.deepEqual([...registerRecordIdsFor(dir, NAME)].sort(), ["a", "b"]);
  assert.deepEqual([...registerRecordIdsFor(dir, "MOSSVALE")], ["z"]);
});

test("the owners searched are those the step named, at most three per name; a run whose step did not finish keeps the bounded rule", () => {
  const records = ["Alder", "Birch", "Cedar", "Damson", "Elm"].map((o, i) => ({ recordId: `r${i}`, owner: `${o} Ltd`, status: "Registered", classes: [9] }));
  const named = ownersOwedACheck({ marks: [{ name: NAME, classes: [9], records, reading: { ownerChecks: ["r0", "r3", "r4"] } }] });
  assert.deepEqual(named.map((o) => o.owner), ["Alder Ltd", "Damson Ltd", "Elm Ltd"], "judgment names them");
  // THE CAP HOLDS ON JUDGMENT TOO (owner's ruling, 2026-11-08): five owners named, three searched, in record order.
  const all = ownersOwedACheck({ marks: [{ name: NAME, classes: [9], records, reading: { ownerChecks: ["r4", "r3", "r2", "r1", "r0"] } }] });
  assert.deepEqual(all.map((o) => o.owner), ["Alder Ltd", "Birch Ltd", "Cedar Ltd"], "more than three owners named, and more than three searched");
  // Per name, not per run: a second name's owners are its own three.
  const two = ownersOwedACheck({ marks: [{ name: NAME, classes: [9], records, reading: { ownerChecks: ["r0", "r1", "r2", "r3"] } },
    { name: "MOSSVALE", classes: [9], records, reading: { ownerChecks: ["r0", "r1", "r2", "r3"] } }] });
  assert.deepEqual(two.map((o) => `${o.mark}:${o.owner}`), [`${NAME}:Alder Ltd`, `${NAME}:Birch Ltd`, `${NAME}:Cedar Ltd`,
    "MOSSVALE:Alder Ltd", "MOSSVALE:Birch Ltd", "MOSSVALE:Cedar Ltd"], "the cap is per name");
  assert.deepEqual(ownersOwedACheck({ marks: [{ name: NAME, classes: [9], records, reading: { ownerChecks: [] } }] }), [], "the step named none, so none is searched");
  assert.equal(ownersOwedACheck({ marks: [{ name: NAME, classes: [9], records, reading: { notFinished: true } }] }).length, 3, "no reading record: the promoted filings, bounded");
});

test("the rating step and the review can read a list set aside, and nothing on them can ask the register", () => {
  for (const stage of ["knockout-assess#0", "knockout-review"]) {
    const grant = allowedToolsFor(toolGroupsForStage(stage)).split(" ");
    assert.ok(grant.some((t) => t.endsWith("__read_register_list")), `${stage} cannot read the lists`);
    assert.ok(!grant.some((t) => t.startsWith("mcp__register__")), `${stage} holds a register tool`);
  }
  const dir = mkdtempSync(join(tmpdir(), "ko-review-"));
  mkdirSync(driverDir(dir), { recursive: true });
  const K = koPaths(dir);
  assert.doesNotMatch(KO_STAGES["knockout-review"].message({ K, evidenceLines: [], firstReadLines: [] }), /register-records\.json/, "a path the run does not hold is not named");
  writeFileSync(K.registerRecords, "{}");
  const message = KO_STAGES["knockout-review"].message({ K, evidenceLines: [], firstReadLines: [] });
  assert.match(message, /register-records\.json/);
  assert.match(message, /read_register_list/);
});

test("the mechanical forms are one question on a register that answers a joined count, and the total is the same", async () => {
  const perForm = {};
  const counter = async (term) => {
    if (Array.isArray(term)) return { ok: true, total: term.reduce((n, t) => n + (perForm[t] ?? 0), 0) };
    return { ok: true, total: perForm[term] ?? 0 };
  };
  const calls = [];
  const counting = async (term, p, o) => { calls.push(term); return counter(term, p, o); };
  const base = { marks: [{ name: "KOPPERLINE", classes: [9] }], provider: "clarivate", capabilities: { id: "clarivate" } };
  const each = await countRegisterHits({ ...base, counter: counting });
  const forms = each.marks[0].counts.close.forms.map((f) => f.form);
  assert.ok(forms.length > 1, "the name generates several forms");
  perForm[forms[0]] = 7; perForm[forms[1]] = 5;
  const apart = await countRegisterHits({ ...base, counter });
  calls.length = 0;
  const joined = await countRegisterHits({ ...base, counter: counting, joinForms: true });
  const cell = joined.marks[0].counts.close;
  assert.equal(cell.total, apart.marks[0].counts.close.total);
  assert.equal(cell.total, 12);
  assert.equal(calls.filter(Array.isArray).length, 1, "one call for the whole set");
  assert.equal(calls.length, 3, "the name, its containing count and one joined count");
  assert.deepEqual(cell.forms.map((f) => f.form), forms, "the forms stay listed beside the figure");
  assert.doesNotMatch(variantFormsLine(joined.marks[0]) ?? "", /could be counted|could not be counted/);
});

test("on Clarivate the name's count is asked once on the wire: the step's own question reuses it through the run's memory", async () => {
  const { PROVIDERS } = await import("../driver.config.mjs");
  const realFetch = globalThis.fetch;
  const prior = { key: process.env.CLARIVATE_API_KEY, base: process.env.CLARIVATE_API_BASE };
  process.env.CLARIVATE_API_KEY = "fixture-key";
  process.env.CLARIVATE_API_BASE = "https://clarivate.test";
  const called = [];
  const list = [{ id: "g-em", registrationOfficeCode: "EM", markVerbalElementText: NAME, niceClassifications: [{ classNumber: 9 }], status: { cmNormalisedStatus: "Registered" } }];
  globalThis.fetch = async (url) => {
    const { pathname } = new URL(String(url));
    called.push(pathname);
    const body = pathname === "/count" ? { counts: { EM: 1 } } : pathname === "/search" ? { ids: { EM: ["g-em"] }, took: 1 } : { trademarks: list, nonTrademarks: [] };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const runDir = mkdtempSync(join(tmpdir(), "ko-memory-"));
    mkdirSync(driverDir(runDir), { recursive: true });
    const memory = beginAnswerMemory(runDir, "clarivate");
    assert.equal(memory.mode, "on", "the premise: this register's memory is on by default");
    const recordLog = driverDir(runDir, "register-record-bodies.jsonl");
    const context = { agentId: "t", sessionKey: "t", recordLog };
    const marks = [{ name: NAME, classes: [9] }];
    const plan = knockoutQuestionPlan({ marks, jurisdictions: ["EU"], capabilities: CLARIVATE });
    const counted = await PROVIDERS.clarivate.countHits({ name: NAME, matchMode: "exact", classes: [9], regions: plan.regions }, context);
    assert.deepEqual([counted.ok, counted.total], [true, 1]);
    assert.deepEqual(called, ["/count"]);
    writeFileSync(questionPlanPath(runDir), JSON.stringify(plan));
    const axis = knockoutAxis(NAME);
    const reply = await proposeSupplemental({ axis, output_path: knockoutBandPath(runDir, NAME), proposals: [{ predicate: "exact", term: NAME, nice_classes: [9], rationale: "the name's own list" }] },
      { kind: "propose_supplemental", recordLog, agentId: "t", sessionKey: "t" },
      { capabilities: CLARIVATE, executePlan: async (params, tctx) => (await import("../../providers/clarivate/src/core.js")).doExecutePlan("fixture-key", "https://clarivate.test", params, tctx) });
    assert.ok(JSON.parse(reply.text).minted.length === 1, reply.text);
    assert.deepEqual(called.filter((p) => p === "/count"), ["/count"], "the second question reused the first count");
    assert.equal(called.filter((p) => p === "/search").length, 1);
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, v] of [["CLARIVATE_API_KEY", prior.key], ["CLARIVATE_API_BASE", prior.base]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test("Clarivate's adapter sends a joined count as one exact question over the forms", async () => {
  const { PROVIDERS } = await import("../driver.config.mjs");
  const realFetch = globalThis.fetch;
  const prior = { key: process.env.CLARIVATE_API_KEY, base: process.env.CLARIVATE_API_BASE };
  process.env.CLARIVATE_API_KEY = "fixture-key";
  process.env.CLARIVATE_API_BASE = "https://clarivate.test";
  const sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push({ path: new URL(String(url)).pathname, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ counts: { EM: 3, US: 2 } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const r = await PROVIDERS.clarivate.countHits({ name: ["QUILBRAE", "KWILLBRAE"], matchMode: "exact", classes: [9], regions: ["EU", "US"] }, { agentId: "t", sessionKey: "t" });
    assert.deepEqual([r.ok, r.total], [true, 5]);
    assert.equal(sent.length, 1);
    const field = sent[0].body.searchFields.find((f) => f.name === "EXACT_WORD_MARK_SPECIFICATION");
    assert.equal(sent[0].path, "/count");
    assert.match(field.value, /QUILBRAE OR KWILLBRAE/);
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, v] of [["CLARIVATE_API_KEY", prior.key], ["CLARIVATE_API_BASE", prior.base]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

// ── THE PLAN ────────────────────────────────────────────────────────────────────────────────────

test("the plan holds each name on its own axis, inherits the order's offices, and gives an added class one question", () => {
  const plan = knockoutQuestionPlan({ marks: [{ name: NAME, classes: [9] }, { name: "MOSSVALE", classes: [30] }], jurisdictions: ["EU", "US"], capabilities: CLARIVATE,
    framedMarks: [{ name: NAME, beltAndBraces: [28, 30], classesPlain: "games (28, belt-and-braces)" }] });
  assert.ok(plan.regions.includes("EM") && plan.regions.includes("US"), "the order's offices, in the register's vocabulary");
  assert.ok(plan.entries.every((e) => e.regions.length === 0), "each question inherits them");
  const own = plan.entries.filter((e) => e.axis === knockoutAxis(NAME));
  assert.deepEqual(own.map((e) => e.nice_classes), [["9"], ["28"]], "class 30 is another name's instruction here, so it is not an addition");
  assert.ok(own.every((e) => e.predicate === "exact" && e.term === NAME && e.provenance === "mark"));
  assert.deepEqual(plan.added_classes, [{ class: "28", reason: "games (28, belt-and-braces)" }]);
  assert.equal(new Set(plan.entries.map((e) => e.axis)).size, 2);
});

test("a fixture's answer to a filtered question is its own file: a narrowing never reads the crowd's", async () => {
  assert.equal(fixtureFileName("Quill Brae"), "quill-brae.json");
  assert.equal(fixtureFileName("Quill", { matchMode: "phonetic" }), "quill.phonetic.json");
  assert.equal(fixtureFileName("Quill", { goods: ["tonic", "water"] }), "quill.goods-tonic-water.json");
  assert.equal(fixtureFileName("Quill", { regions: ["DE"], classes: [9], scoped: true }), "quill.in-de.class-9.json");
  assert.equal(fixtureFileName("Quill", { regions: ["DE"], classes: [9] }), "quill.json", "the name's own read ignores its scope, as it always has");
  const dir = mkdtempSync(join(tmpdir(), "ko-fixture-"));
  writeFileSync(join(dir, "quill.json"), JSON.stringify({ records: [row("x")], total: 1 }));
  const list = fixtureLister(dir);
  assert.equal((await list("Quill", { goods: ["tonic"] })).ok, false);
  assert.equal((await list("Quill", {})).ok, true);
});

test("a fixture run never falls through to a live register", () => {
  assert.equal(resolveQuestionExecutor({ adapter: { executePlan: async () => { throw new Error("reached the register"); } }, offline: true }).source, "none");
  assert.equal(resolveQuestionExecutor({ fixtureDir: "/invented" }).fixtureDir, "/invented");
  assert.equal(resolveQuestionExecutor({ adapter: { executePlan: async () => ({ ok: true }) } }).source, "provider");
  assert.equal(resolveQuestionExecutor({ adapter: {} }).source, "none");
});

// ── THE READING RECORD ─────────────────────────────────────────────────────────────────────────

/** A run on disk with `blocks` as one name's band, its counts and its scope. */
function runWith({ total = 0, close = { total: 0, forms: [] }, blocks = [], entries = [] }) {
  const dir = mkdtempSync(join(tmpdir(), "ko-record-"));
  mkdirSync(driverDir(dir), { recursive: true });
  writeFileSync(driverDir(dir, "instructed-scope.json"), JSON.stringify({ marks: [NAME] }));
  writeFileSync(driverDir(dir, "register-counts.json"), JSON.stringify({ marks: [{ name: NAME, counts: { identical: { total }, containing: { total: 0 }, close } }] }));
  mkdirSync(join(dir, "register-units"), { recursive: true });
  writeFileSync(knockoutBandPath(dir, NAME), JSON.stringify(blocks));
  writeFileSync(join(dir, "register-units", `${knockoutAxis(NAME)}-supplemental-plan.json`), JSON.stringify({ entries }));
  return dir;
}
const listBlock = (qid, list) => ({ qid, state: "enumerated", total_hits: list.length, count: list.length, records: list });

test("the record refuses a read list, a crowd and a count left unaccounted for, by question, and takes one reason for a group", () => {
  const id = openingQid(NAME, "identical");
  const dir = runWith({ total: 3, blocks: [listBlock(id, rows(3))] });
  const r = recordKnockoutRegisterRead(dir, { marks: [{ name: NAME, carried: [{ records: ["/mark/em/r0"], why: "same goods" }], set_aside: [], not_asked: [] }] });
  assert.match(String(r.refused), /nothing says what became of/);
  assert.match(String(r.refused), new RegExp(id));
  const ok = recordKnockoutRegisterRead(dir, { marks: [{ name: NAME, carried: [{ records: ["/mark/em/r0"], why: "same goods" }],
    set_aside: [{ question: id, why: "these two cover unrelated goods" }], not_asked: [{ question: "a sound-alike search", why: "the exact list already answers the advice" }] }] });
  assert.ok(ok.written, JSON.stringify(ok));
  assert.equal(ok.written, knockoutRegisterFile(dir));
  assert.equal(validateKnockoutRegisterFile(ok.written, readFileSync(ok.written, "utf8")).ok, true);
});

test("a crowd the step asked and could not read is owed a reason, a zero and a failure are not", () => {
  const id = openingQid(NAME, "identical");
  const crowd = runWith({ total: 903, blocks: [{ qid: "q-crowd", state: "incomplete", total_hits: 903 }], entries: [{ qid: "q-crowd", predicate: "exact", term: NAME }] });
  assert.match(String(recordKnockoutRegisterRead(crowd, { marks: [{ name: NAME, carried: [], set_aside: [], not_asked: [] }] }).refused), /counted-not-read/);
  assert.ok(recordKnockoutRegisterRead(crowd, { marks: [{ name: NAME, carried: [], set_aside: [{ question: id, why: "a crowd; the client's own goods answered nothing further" }, { question: "q-crowd", why: "the same crowd" }], not_asked: [] }] }).written);
  const clean = runWith({ total: 0, blocks: [{ qid: "q-fail", state: "incomplete", total_hits: 0, error: true, reason: "provider error" }], entries: [{ qid: "q-fail", predicate: "exact", term: "QUILLBREY" }] });
  assert.ok(recordKnockoutRegisterRead(clean, { marks: [{ name: NAME, carried: [], set_aside: [], not_asked: [] }] }).written, "a zero says itself, and a failure is the engine's to report");
});

test("a record id the register did not return is refused, and so is a name not instructed or left out", () => {
  const id = openingQid(NAME, "identical");
  const dir = runWith({ total: 1, blocks: [listBlock(id, [row("r0")])] });
  assert.match(String(recordKnockoutRegisterRead(dir, { marks: [{ name: NAME, carried: [{ records: ["/mark/em/invented"], why: "x" }], set_aside: [{ question: id, why: "y" }], not_asked: [] }] }).refused), /is not a record this name's questions returned/);
  assert.match(String(recordKnockoutRegisterRead(dir, { marks: [{ name: "STRANGER", carried: [], set_aside: [], not_asked: [] }] }).refused), /no row for|not an instructed name/);
});

test("a repair call merges by name, and a row needs its reason", () => {
  assert.deepEqual(mergeKnockoutRegisterCall({ marks: [{ name: "A", carried: [] }, { name: "B", carried: [] }] }, { marks: [{ name: "b", carried: [{ records: ["x"], why: "y" }] }] }).marks.map((m) => m.name), ["A", "b"]);
  assert.equal(acceptKnockoutRegister({ marks: [{ name: "A", carried: [{ records: ["x"] }], set_aside: [], not_asked: [] }] }).ok, false);
  assert.equal(acceptKnockoutRegister({ marks: [{ name: "A", carried: [], set_aside: [{ question: "q" }], not_asked: [] }] }).ok, false);
});

test("a set-aside row naming filings covers those and no others, and its ids must be that question's", () => {
  const id = openingQid(NAME, "identical");
  const dir = runWith({ total: 3, blocks: [listBlock(id, rows(3))] });
  const send = (setAside, carried = [{ records: ["/mark/em/r0"], why: "same goods" }]) => recordKnockoutRegisterRead(dir, { marks: [{ name: NAME, carried, set_aside: setAside, not_asked: [] }] });
  assert.match(String(send([{ question: id, records: ["/mark/em/r1"], why: "unrelated goods" }]).refused), /1 of its 2 uncarried filings/, "a subset does not excuse the rest");
  assert.match(String(send([{ question: id, records: ["/mark/em/stranger"], why: "x" }]).refused), /not a filing of/);
  assert.match(String(send([{ question: id, records: ["/mark/em/r0", "/mark/em/r1"], why: "x" }, { question: id, why: "y" }]).refused), /both carried and set aside/);
  assert.ok(send([{ question: id, records: ["/mark/em/r1"], why: "other goods" }, { question: id, records: ["/mark/em/r2"], why: "dead" }]).written, "every filing accounted for");
  assert.ok(send([{ question: id, why: "one reason for the rest" }]).written, "one reason may cover a whole question's remaining rows");
});

test("a filing accounted for under one question need not be said again under a narrower one that returned it", () => {
  const id = openingQid(NAME, "identical");
  const narrow = "supp:narrow";
  const dir = runWith({ total: 3, blocks: [listBlock(id, rows(3)), listBlock(narrow, rows(2))] });
  assert.ok(recordKnockoutRegisterRead(dir, { marks: [{ name: NAME, carried: [], set_aside: [{ question: id, why: "unrelated goods" }], not_asked: [] }] }).written);
});

test("reading one variant does not discharge a combined count over the others", () => {
  const close = { total: 7, joined: true, forms: [{ form: "TONIQ", rules: ["q"] }, { form: "TONNIC", rules: ["n"] }] };
  const proposals = (terms) => terms.map((t, i) => ({ qid: `supp:${i}`, predicate: "exact", term: t, nice_classes: ["9"] }));
  const blocks = (terms) => new Map(terms.map((t, i) => [`supp:${i}`, listBlock(`supp:${i}`, [])]));
  const owedWith = (terms) => questionsOwed({ name: NAME, countsEntry: { counts: { identical: { total: 0 }, containing: { total: 0 }, close } }, blocks: blocks(terms), proposals: proposals(terms) });
  assert.deepEqual(owedWith(["TONIQ"]).map((o) => o.unread), [["TONNIC"]], "the variant not read stays owed, by name");
  assert.deepEqual(owedWith(["TONIQ", "TONNIC"]), [], "every variant read leaves nothing owed");
  const read = [{ qid: "supp:0", predicate: "exact", term: "TONIQ", nice_classes: ["9"] }];
  const held = runWith({ total: 0, close, blocks: [listBlock("supp:0", [])], entries: read });
  const send = (setAside) => recordKnockoutRegisterRead(held, { marks: [{ name: NAME, carried: [], set_aside: setAside, not_asked: [] }] });
  assert.match(String(send([]).refused), /counted-not-read: TONNIC not read/, "the refusal names the variant");
  assert.ok(send([{ question: openingQid(NAME, "close"), why: "the other spelling cannot be read as this name" }]).written, "a stated reason answers it");
});

test("a question over an added class does not answer the name's original scope, and a read over fewer classes is a narrowing", () => {
  const framed = { name: NAME, classes: [9], beltAndBraces: [35] };
  const added = [{ qid: "supp:0", predicate: "exact", term: NAME, nice_classes: ["35"] }];
  const counted = { counts: { identical: { total: 4 }, containing: { total: 0 }, close: { total: 0 } } };
  const owed = questionsOwed({ name: NAME, countsEntry: counted, blocks: new Map([["supp:0", listBlock("supp:0", [])]]), proposals: added, framed });
  assert.equal(owed.find((o) => o.mustAsk)?.question, openingQid(NAME, "identical"), "the instructed scope is still owed its question");
  const one = [{ qid: "supp:0", predicate: "exact", term: NAME, nice_classes: ["9"] }];
  const doc = knockoutRecordsDoc({ marks: [{ name: NAME, classes: [9, 12] }], classes: [9, 12], provider: "clarivate", capabilities: CLARIVATE, counts: { marks: [{ name: NAME, ...counted }] }, reading: null,
    readBlocks: () => new Map([["supp:0", listBlock("supp:0", rows(1))]]), readProposals: () => ({ entries: one, rejected: [] }) });
  assert.equal(doc.marks[0].terms[0].state, "narrowed", "a read over one of two classes did not read the name's own question");
});

test("a class the frame added needs an outcome: an answer, or a reason that leaves it unresolved", () => {
  const framed = [{ name: NAME, classes: [9], beltAndBraces: [35] }];
  const dir = runWith({ total: 0 });
  writeFileSync(questionPlanPath(dir), JSON.stringify(knockoutQuestionPlan({ marks, classes: [9], jurisdictions: ["EU"], capabilities: CLARIVATE, framedMarks: framed })));
  const qid = openingQid(NAME, "added-class-35");
  const send = (row) => recordKnockoutRegisterRead(dir, { marks: [{ name: NAME, carried: [], set_aside: [], not_asked: [], ...row }] });
  assert.equal(send({}).refused, `knockoutregisterread_added_class:${NAME}: Class 35 was added for this name, but its identical-name question has no outcome. Ask that question, reuse its held answer for the same scope, or record why it remains unresolved. Keep the original instructed classes unchanged.`);
  const reading = { marks: [{ name: NAME, carried: [], set_aside: [], not_asked: [{ question: qid, why: "the client's goods do not reach retail" }] }] };
  assert.ok(send(reading.marks[0]).written, "a stated reason is an outcome");
  assert.ok(send({ not_asked: [{ question: "the identical name in class 35", why: "the same" }] }).written, "in words, where it names the class");
  assert.match(String(send({ not_asked: [{ question: "class 350", why: "not this class" }] }).refused), /Class 35 was added/, "and only that class");
  const doc = (read, entries = [], blocks = new Map()) => knockoutRecordsDoc({ marks, classes: [9], jurisdictions: ["EU"], provider: "clarivate", capabilities: CLARIVATE, framedMarks: framed,
    counts: JSON.parse(readFileSync(driverDir(dir, "register-counts.json"), "utf8")), reading: read,
    readBlocks: () => blocks, readProposals: () => ({ entries, rejected: [] }) }).marks[0];
  const row = (m) => m.terms.find((t) => t.qid === qid);
  assert.deepEqual([row(doc(reading)).state, row(doc(reading)).unresolved, row(doc(reading)).reason], ["not-asked", true, "the client's goods do not reach retail"], "it stays unresolved, with its reason");
  assert.equal(recordsLine(doc(reading)), "Filings: none were carried forward for assessment.", "and nothing says the name came back clean");
  assert.match(String(recordsLine(doc(null))), /did not complete/, "a reading that did not finish keeps the failure's own sentence");
  assert.equal(row(doc(null)).unresolved, true, "a reading that did not finish records the same gap");
  const asked = [{ qid: "supp:35", predicate: "exact", term: NAME, nice_classes: ["35"] }];
  const held = new Map([["supp:35", listBlock("supp:35", [])]]);
  assert.equal(row(doc(null, asked, held)), undefined, "an answered question owes nothing");
  writeFileSync(knockoutBandPath(dir, NAME), JSON.stringify([listBlock("supp:35", [])]));
  writeFileSync(join(dir, "register-units", `${knockoutAxis(NAME)}-supplemental-plan.json`), JSON.stringify({ entries: asked }));
  assert.ok(send({}).written, "the answered question is the outcome, with nothing more to say");
});

test("a repair sends only the names it corrects, and a turn that ends early leaves what it had settled", () => {
  const id = openingQid(NAME, "identical");
  const other = "MOSSVALE";
  const dir = runWith({ total: 2, blocks: [listBlock(id, rows(2))] });
  writeFileSync(driverDir(dir, "instructed-scope.json"), JSON.stringify({ marks: [NAME, other] }));
  const good = { name: NAME, carried: [{ records: ["/mark/em/r0"], why: "same goods" }], set_aside: [{ question: id, why: "unrelated goods" }], not_asked: [] };
  assert.equal(settledKnockoutReading(dir), null, "nothing accepted is nothing settled");
  const first = recordKnockoutRegisterRead(dir, { marks: [good] });
  assert.match(String(first.refused), /no row for "MOSSVALE"/);
  assert.match(String(first.refused), /Every other name stands/);
  assert.equal(existsSync(knockoutRegisterFile(dir)), false, "the record is written whole or not at all");
  assert.deepEqual(settledKnockoutReading(dir).marks.map((m) => m.name), [NAME], "what stands survives a turn that ends here");
  const second = recordKnockoutRegisterRead(dir, { marks: [{ name: other, carried: [], set_aside: [], not_asked: [] }] });
  assert.ok(second.written, second.refused);
  assert.deepEqual(JSON.parse(readFileSync(knockoutRegisterFile(dir), "utf8")).marks.map((m) => m.name).sort(), [NAME, other].sort());
});

test("what the step carried reaches the record with its reason; what it set aside stays reachable, with explicit membership", () => {
  const id = openingQid(NAME, "identical");
  const list = rows(3);
  const dir = runWith({ total: 3, blocks: [listBlock(id, list)] });
  const reading = { marks: [{ name: NAME, carried: [{ records: ["/mark/em/r0"], why: "same goods" }], set_aside: [{ question: id, why: "unrelated goods" }], not_asked: [], open_questions: ["does the owner still trade?"] }] };
  const doc = knockoutRecordsDoc({ ...scope, counts: JSON.parse(readFileSync(driverDir(dir, "register-counts.json"), "utf8")), reading,
    readBlocks: (n) => knockoutBandBlocks(dir, n), readProposals: (n) => knockoutProposals(dir, n) });
  const m = doc.marks[0];
  assert.deepEqual(m.records.map((r) => [r.recordId, r.carriedBecause, r.question]), [["/mark/em/r0", "same goods", id]]);
  assert.deepEqual(m.reading.setAside, [{ question: id, why: "unrelated goods", records: ["/mark/em/r1", "/mark/em/r2"] }]);
  assert.deepEqual(m.reading.openQuestions, ["does the owner still trade?"]);
  const view = knockoutListView(dir, { qid: id });
  assert.equal(view.rows.length, 3, "a later step can still read the rows set aside");
});

test("a reading step that did not finish leaves what the run held carried, and says so", () => {
  const id = openingQid(NAME, "identical");
  const dir = runWith({ total: 2, blocks: [listBlock(id, rows(2))] });
  const doc = knockoutRecordsDoc({ ...scope, counts: JSON.parse(readFileSync(driverDir(dir, "register-counts.json"), "utf8")), reading: null,
    readBlocks: (n) => knockoutBandBlocks(dir, n), readProposals: (n) => knockoutProposals(dir, n) });
  assert.equal(doc.marks[0].records.length, 2);
  assert.deepEqual(doc.marks[0].reading, { notFinished: true });
});

// ── READING A LIST ─────────────────────────────────────────────────────────────────────────────

test("a list is read whole with the goods the run holds, in the shipped states, and one filing's whole wording by its record_id", () => {
  const id = openingQid(NAME, "identical");
  const list = [row("short"), row("long"), row("none")];
  const dir = runWith({ total: 3, blocks: [listBlock(id, list)] });
  const LONG = "tonic water ".repeat(200);
  const bodies = [["short", "tonic water"], ["long", LONG]].map(([k, text]) => JSON.stringify({ target: `/mark/em/${k}`,
    body: { goodsServices: [{ classes: [9], language: "en", description: text }] } }));
  writeFileSync(driverDir(dir, "register-record-bodies.jsonl"), bodies.join("\n") + "\n");
  const view = knockoutListView(dir, { qid: id });
  assert.equal(view.total_hits, 3);
  assert.equal(view.rows.length, 3);
  const byId = Object.fromEntries(view.rows.map((r) => [r.record_id.split("/").pop(), r]));
  assert.equal(byId.short.goods_state, "complete");
  assert.deepEqual(byId.short.goods, ["9: tonic water"]);
  assert.equal(byId.long.goods_shortened, true, "the view says it cut a statement");
  assert.ok(byId.long.goods[0].length < LONG.length);
  const whole = knockoutListView(dir, { qid: id, record_id: byId.long.record_id });
  assert.match(JSON.stringify(whole.full_record), /tonic water tonic water/, "the whole held record is there to read, with nothing fetched");
  assert.equal(whole.goods_state, "complete");
  assert.deepEqual(knockoutListView(dir, { qid: id, record_id: byId.none.record_id }).goods, [], "no wording held is said, not filled in");
  assert.match(knockoutListView(dir, { qid: id, record_id: "/mark/em/stranger" }).error, /no filing/);
  assert.notEqual(byId.none.goods_state, "complete", "no goods on file is said");
  assert.deepEqual(byId.none.goods, []);
  assert.match(knockoutListView(dir, { qid: "nothing" }).error, /no question/);
});

test("goods that came on the search row reach the list and its whole wording, with no body held", () => {
  const id = openingQid(NAME, "identical");
  const onRow = (classifications, extra = {}) => row("onrow", NAME, { raw: { classifications }, ...extra });
  const c = (nice, text, extra = {}) => ({ nice_class: nice, goods_services_text: text, goods_services_language: "en", ...extra });
  const listed = (r) => { const dir = runWith({ total: 1, blocks: [listBlock(id, [r])] }); return { dir, view: knockoutListView(dir, { qid: id }).rows[0] }; };
  const { dir, view } = listed(onRow([c(9, "tonic water"), c(35, "retail of tonic water")]));
  assert.deepEqual(view.goods, ["9: tonic water", "35: retail of tonic water"]);
  assert.notEqual(view.goods_state, "not-held", "goods held on the search row are held");
  assert.equal(view.goods_shortened, false);
  const whole = knockoutListView(dir, { qid: id, record_id: view.record_id });
  assert.deepEqual(whole.goods, ["9: tonic water", "35: retail of tonic water"], "a view that cut nothing is all the wording held");
  assert.equal(listed(onRow([c(9, "tonic water and", { goods_services_text_truncated: true })])).view.goods_state, "cut", "the register's own cut stays a cut");
  assert.equal(listed(onRow([c(9, "tonic ".repeat(60))])).view.goods_state, "unknown", "a default answer at its length limit is not known whole");
  const long = "tonic water ".repeat(200);
  const shortened = listed(onRow([c(9, long)], { goods_whole: true }));
  assert.equal(shortened.view.goods_shortened, true);
  assert.equal(knockoutListView(shortened.dir, { qid: id, record_id: shortened.view.record_id }).full_record.goods[0].text, long.trim(), "a statement the view cut is whole behind its record_id");
});

test("a fetch that failed reads as failed in a list, not as a record never held", () => {
  const id = openingQid(NAME, "identical");
  const dir = runWith({ total: 1, blocks: [listBlock(id, [row("gone")])] });
  const callLog = join(dir, "register-calls.jsonl");
  writeFileSync(callLog, JSON.stringify({ tool: "record_fetch", sessionKey: "clearance-invented-run-knockout-register-read", target: "/mark/em/gone", ok: false, http_status: 503 }) + "\n");
  const failed = knockoutListView(dir, { qid: id }, { runPrefix: "clearance-invented-run", callLog }).rows[0];
  assert.equal(failed.goods_state, "unavailable");
  assert.equal(knockoutListView(dir, { qid: id }).rows[0].goods_state, "not-held", "no ledger to read says only that the run holds none");
  assert.equal(runPrefixOfSession("clearance-invented-run-knockout-assess#2-rerun1"), "clearance-invented-run");
});

test("what the step set aside carries its goods too, so the rating step can read it without asking again", () => {
  const id = openingQid(NAME, "identical");
  const dir = runWith({ total: 2, blocks: [listBlock(id, rows(2))] });
  writeFileSync(driverDir(dir, "register-record-bodies.jsonl"), JSON.stringify({ target: "/mark/em/r1", body: { goodsServices: [{ classes: [9], language: "en", description: "garden shears" }] } }) + "\n");
  const reading = { marks: [{ name: NAME, carried: [{ records: ["/mark/em/r0"], why: "same goods" }], set_aside: [{ question: id, why: "unrelated goods" }], not_asked: [] }] };
  const doc = withHeldGoods(knockoutRecordsDoc({ ...scope, counts: JSON.parse(readFileSync(driverDir(dir, "register-counts.json"), "utf8")), reading,
    readBlocks: (n) => knockoutBandBlocks(dir, n), readProposals: (n) => knockoutProposals(dir, n) }), dir);
  assert.deepEqual(doc.marks[0].setAsideRecords[0].goods, ["9: garden shears"]);
  assert.equal(doc.marks[0].setAsideRecords[0].goodsState, "complete");
});

test("the propose tool's answer is not the list: 30 rows answered, all 30 read", async () => {
  const lister = standIn({ [NAME]: 0, QUILLBREY: rows(30, "n") });
  await readingDoc({ ...scope, lister, variantCap: 0, ask: async ({ runDir }) => {
    const reply = JSON.parse((await ask(runDir, NAME, lister, [{ predicate: "exact", term: "QUILLBREY", nice_classes: [9], rationale: "a near form" }])).text);
    const qid = reply.minted[0];
    assert.equal(reply.results[qid].records_preview.length, 25, "the tool shows the first rows");
    assert.equal(knockoutListView(runDir, { qid }).rows.length, 30, "the list is the whole list");
  } });
});

// ── THE STAGE AND ITS GRANT ────────────────────────────────────────────────────────────────────

test("the stage holds the propose tool alone of the register's, its read and its record tool", () => {
  const grant = allowedToolsFor(toolGroupsForStage("knockout-register-read")).split(" ").sort();
  assert.deepEqual(grant, ["Read", "mcp__recording-knockout-register-read__read_register_list",
    "mcp__recording-knockout-register-read__record_knockout_register_read", "mcp__register__register_propose_supplemental"]);
});

test("the opening message hands over the request, the counts, and the tools by name, and names no file to write", () => {
  const dir = mkdtempSync(join(tmpdir(), "ko-message-"));
  writeFileSync(join(dir, "inbound-request.txt"), "invented request");
  const K = koPaths(dir);
  const msg = KO_STAGES["knockout-register-read"].message({ K, job: { goods: "tonic water", upfrontInstructions: "the client sells tonic" }, readingLines: ['- "QUILLBRAE": a counted line'], providerDoc: "skills/clearance-register/providers/clarivate.md" });
  for (const part of ["inbound-request.txt", "tonic water", "the client sells tonic", "a counted line", "register_propose_supplemental", "read_register_list", "record_knockout_register_read", "skills/clearance-register/providers/clarivate.md", "NARROWING A CROWD"])
    assert.ok(msg.includes(part), `the message lacks ${part}`);
  assert.doesNotMatch(msg, /\bfirst \d+\b|top \d+|at most \d+ (records|filings)/i, "no reading budget in what the model reads");
  const without = KO_STAGES["knockout-register-read"].message({ K: koPaths(mkdtempSync(join(tmpdir(), "ko-message-"))), job: {}, readingLines: [] });
  assert.doesNotMatch(without, /inbound-request/, "a path the run does not hold is not named");
});

test("the manual carries the clearance's reading rule word for word, narrows the goods in its own words, and sets no number on reading", () => {
  const read = (rel) => readFileSync(fileURLToPath(new URL(`../skills/${rel}`, import.meta.url)), "utf8");
  const manual = read("knockout-register-read/SKILL.md");
  const unit = read("clearance-register/unit.md");
  for (const heading of ["### At every step: look at what you have before you work on it", "### Read the identical mark first. Look at the count before you read anything"])
    assert.ok(manual.includes(heading) && unit.includes(heading), heading);
  const step = (text) => text.slice(text.indexOf("3. Still a crowd?"), text.indexOf("A list you have read answers"));
  assert.ok(step(manual).length > 0);
  assert.equal(step(manual), step(unit), "the market steps drifted from the clearance's");
  assert.match(manual, /Use the provider's supported OR form\. Read that list\.\n2\. Still a crowd\? Split the goods question by its dominant goods terms/);
  assert.doesNotMatch(manual, /record cap|100 records|first \d+ /i);
});

// ── THE FIXTURE REGISTER ───────────────────────────────────────────────────────────────────────

function toolCall(server, name, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(server.command, server.args ?? [], { stdio: ["pipe", "pipe", "ignore"], env: { ...process.env, ...(server.env ?? {}) } });
    let buf = "";
    const timer = setTimeout(() => { p.kill(); reject(new Error("the server did not answer")); }, 20000);
    p.stdout.setEncoding("utf8");
    p.stdout.on("data", (d) => {
      buf += d;
      for (const line of buf.split("\n")) {
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m?.id !== 3) continue;
        clearTimeout(timer); p.kill();
        return resolve(m.result);
      }
    });
    const send = (o) => p.stdin.write(JSON.stringify(o) + "\n");
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
    send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name, arguments: args } });
  });
}

test("a fixture run's stage mounts the fixture register, which answers from its folder and reaches no register", async () => {
  const prior = process.env.CLEAROTRON_DATABASE;
  process.env.CLEAROTRON_DATABASE = "clarivate";
  try {
    const fixtures = mkdtempSync(join(tmpdir(), "ko-fixtures-"));
    writeFileSync(join(fixtures, "quillbrey.json"), JSON.stringify({ records: [row("f1", "QUILLBREY")], total: 1 }));
    const runDir = mkdtempSync(join(tmpdir(), "ko-fixture-run-"));
    mkdirSync(driverDir(runDir), { recursive: true });
    mkdirSync(join(runDir, "register-units"), { recursive: true });
    writeFileSync(questionPlanPath(runDir), JSON.stringify(knockoutQuestionPlan({ ...scope })));
    const before = buildGatherMcpConfig(toolGroupsForStage("knockout-register-read"), { sessionKey: "t", agent: "t", runDir });
    assert.doesNotMatch(before.mcpServers.register.args[0], /fixture/, "a run with no fixtures mounts the live register");
    writeFixtureMarker(runDir, fixtures);
    const cfg = buildGatherMcpConfig(toolGroupsForStage("knockout-register-read"), { sessionKey: "t", agent: "t", runDir });
    assert.match(cfg.mcpServers.register.args[0], /fixture-register-server\.mjs$/);
    const band = knockoutBandPath(runDir, NAME);
    const answered = await toolCall(cfg.mcpServers.register, "register_propose_supplemental", { axis: knockoutAxis(NAME), output_path: band,
      proposals: [{ predicate: "exact", term: "QUILLBREY", nice_classes: [9], rationale: "a near form" }, { predicate: "exact", term: "QUILLBRY", nice_classes: [9], rationale: "another" }] });
    const reply = JSON.parse(answered.content[0].text);
    assert.equal(reply.minted.length, 2);
    const blocks = knockoutBandBlocks(runDir, NAME);
    const held = [...blocks.values()];
    assert.equal(held.filter((b) => b.state === "enumerated").length, 1);
    assert.equal(held.filter((b) => b.error === true).length, 1, "a question the folder has no answer for is a failure, never a zero");
  } finally {
    if (prior === undefined) delete process.env.CLEAROTRON_DATABASE; else process.env.CLEAROTRON_DATABASE = prior;
  }
});
