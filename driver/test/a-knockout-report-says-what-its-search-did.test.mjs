// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A knockout now chooses its own questions, so the sentences that described a fixed table of close variations are
// replaced, in the words approved for them. A report already delivered keeps the words it was delivered with: each new
// sentence is driven twice, on a listing from the reading step and on an archived one. Invented names throughout.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { RECORD_BASIS, ARCHIVED_RECORD_BASIS, recordsLine } = await import("../register-records.mjs");
const { renderKnockoutHtml, knockoutReportData } = await import("../publish/render-knockout.mjs");
const { buildKnockoutWorkbook } = await import("../publish/knockout.mjs");
const ExcelJS = (await import("exceljs")).default;

const NAME = "QUILLBRAE";
const OLD_BASIS = "The filings behind the two narrow counts — the name itself and each close variation of it — as the register holds them, class-scoped exactly as the counts were. Raw register facts only: nothing here is rated, ranked or interpreted, and a filing appearing in this list is not a finding that it blocks anything.";
const NONE = "Filings: none were carried forward for assessment.";
const FAILED = "Filings: the listing did not complete, so nothing here says whether one stands.";
const FW = { framework_key: "orchard-test", title: "Invented test framework", bands: [{ label: "Serious", tone: "high" }, { label: "Notable", tone: "medium" }, { label: "Slight", tone: "low" }] };

const FILING = (id, form, question = null) => ({ recordId: id, mark: `${form}`, owner: "Pemberton Tools Ltd", ownerCountry: "GB", status: "REGISTERED", classes: [9], territory: "us",
  matchedForm: form, matchedBasis: "close", url: null, provider: "clarivate", ...(question ? { question } : {}) });
const ASKED = (qid, predicate) => ({ term: "QUILL", basis: "close", qid, predicate, ok: true, fetched: 1, total: 1, state: "read" });
const READING = { setAside: [], notAsked: [], openQuestions: [], ownerChecks: [] };
const doc = ({ records = [], terms = [], reading = READING, schema = 2, basis = RECORD_BASIS } = {}) => ({ schema, basis, provider: "clarivate", providerLabel: "Clarivate Compumark",
  marks: [{ name: NAME, classes: [9], classScope: "mark", terms, records, fetched: records.length, available: records.length, ...(reading ? { reading } : {}) }] });
const READ = (records = [FILING("R-1", "QUILLBRAES", "q-1")], terms = [ASKED("q-1", "exact")]) => doc({ records, terms });
const ARCHIVED = (records = [FILING("R-1", "QUILLBRAES")]) => doc({ schema: 1, basis: OLD_BASIS, reading: null, records, terms: [{ term: "QUILLBRAES", basis: "close", ok: true, fetched: 1, total: 1 }] });
const MARK = { name: NAME, rating: "Notable", classesSearched: [9], classesDriving: [9], basis: "An invented basis.", factors: ["One.", "Two."], counterFactors: ["Three."], mitigation: "", bullets: ["A bullet."], assessment: "An invented read.", findings: [] };
const page = (registerRecords) => renderKnockoutHtml({ marks: [MARK], batch: { executiveSummary: "One name.", standardCaveats: [] } }, FW, { runId: "r", overall: "Notable", identity: { identity: "Knockout search" }, registerRecords });

test("the sentence under the filings list says what the search did, and an archived run keeps the one it was delivered under", () => {
  assert.equal(RECORD_BASIS, "The filings this search read and carried forward: the name itself and the near names and wider searches it chose, as the register holds them. Raw register facts only: nothing here is rated, ranked or interpreted, and a filing appearing in this list is not a finding that it blocks anything.");
  const esc = (s) => s.replace(/&/g, "&amp;");
  assert.ok(page(READ()).includes(esc(RECORD_BASIS)));
  assert.ok(!page(READ()).includes("The filings behind the two narrow counts"));
  assert.ok(page(ARCHIVED()).includes(OLD_BASIS));
  const data = (d) => knockoutReportData({ marks: [MARK], batch: { executiveSummary: "x", standardCaveats: [] } }, FW, { runId: "r", codename: "c", overall: "Notable", issued: "i", registerRecords: d }).registerFilingsBasis;
  assert.equal(data(READ()), RECORD_BASIS);
  assert.equal(data(ARCHIVED()), OLD_BASIS);
});

test("a listing prints the shipped sentence for its kind, never the text its file was written with", () => {
  // The shipped string reused byte for byte: the sentence every page printed for every listing before the reading step.
  assert.equal(ARCHIVED_RECORD_BASIS, OLD_BASIS);
  const STORED = "An older sentence this file was written with, holding a word since retired.";
  const data = (d) => knockoutReportData({ marks: [MARK], batch: { executiveSummary: "x", standardCaveats: [] } }, FW, { runId: "r", codename: "c", overall: "Notable", issued: "i", registerRecords: d }).registerFilingsBasis;
  const esc = (s) => s.replace(/&/g, "&amp;");
  for (const [listing, shipped] of [[{ ...ARCHIVED(), basis: STORED }, OLD_BASIS], [{ ...READ(), basis: STORED }, RECORD_BASIS]]) {
    assert.ok(page(listing).includes(esc(shipped)), "the listing lost the shipped sentence for its kind");
    assert.ok(!page(listing).includes(STORED), "the text stored in the file reached the page");
    assert.equal(data(listing), shipped);
  }
});

test("a filing's card says which search found it, because that search need not be a close variation", () => {
  assert.ok(page(READ()).includes("Found by a search on QUILLBRAES."));
  assert.ok(!page(READ()).includes("Found under the close variation"));
  assert.ok(page(ARCHIVED()).includes("Found under the close variation QUILLBRAES."));
});

test("the line beside the counts names a name near it, and an archived run keeps its close variation", () => {
  assert.match(page(READ()), /A filing of this name or a name near it stands on Clarivate Compumark in class 9 — /);
  assert.match(page(ARCHIVED()), /A filing of this name or a close variation of it stands on Clarivate Compumark in class 9 — /);
});

test("the note under a table with more filings than it shows says the name comes before other searches", () => {
  const many = (question) => Array.from({ length: 60 }, (_, i) => FILING(`R-${i}`, `QUILLBRAE${i}`, question));
  const SAID = "the name itself before other searches.", KEPT = "the name itself before its close variations.";
  assert.ok(page(READ(many("q-1"))).includes(SAID));
  assert.ok(page(ARCHIVED(many(null))).includes(KEPT));
});

test("a finished reading that kept nothing says so, a failure keeps its own sentence, and a clean answer stays clean", () => {
  const line = (d) => recordsLine(d.marks[0]);
  const crowd = { term: NAME, basis: "identical", qid: "q-1", predicate: "exact", ok: true, fetched: 0, total: 900, state: "crowd-not-read", setAside: true };
  assert.equal(line(doc({ terms: [crowd] })), NONE, "a list set aside is no failure, and no clean answer");
  assert.equal(line(doc({ terms: [crowd], reading: { notFinished: true } })), FAILED, "a reading that did not finish is a failure");
  assert.equal(line(doc({ terms: [crowd], reading: null, schema: 1 })), FAILED, "an archived listing keeps its sentence");
  assert.match(line(doc({ terms: [{ ...crowd, total: 0, state: "zero", setAside: undefined }] })), /returned none under the name/, "the clean answer needs every question answered and none set aside");
  assert.match(line(doc({ terms: [{ ...crowd, ok: false, setAside: undefined, state: "failed", reason: "x" }] })), /could not be run/, "a failed question stays a failed question");
  assert.ok(page(doc({ terms: [crowd] })).includes(NONE));
});

async function sheet(registerRecords, degraded = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ko-words-"));
  try {
    const out = join(dir, "audit.xlsx");
    await buildKnockoutWorkbook({ marks: [{ name: NAME, findings: [] }] }, [], out, null, [], null, registerRecords, null, [], degraded);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(out);
    const rows = (name) => { const ws = wb.getWorksheet(name); if (!ws) return []; const head = ws.getRow(1).values.slice(1); const got = [];
      ws.eachRow((row, n) => { if (n > 1) got.push(Object.fromEntries(head.map((h, i) => [h, String(row.values[i + 1] ?? "")]))); }); return got; };
    return { filings: rows("Register Filings"), notes: rows("Working Notes") };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("the workbook's Basis column says which question found each filing", async () => {
  const terms = [ASKED("q-exact", "exact"), ASKED("q-default", "default"), ASKED("q-phonetic", "phonetic"), ASKED("q-owner", "owner")];
  const records = [FILING("R-1", "A", "q-exact"), FILING("R-2", "B", "q-default"), FILING("R-3", "C", "q-phonetic"), FILING("R-4", "D", "q-owner"), { ...FILING("R-5", NAME, "q-exact"), matchedBasis: "identical" }];
  const { filings } = await sheet(READ(records, terms));
  assert.deepEqual(filings.slice(0, 5).map((r) => r.Basis), ["close variation", "containing search", "sound-alike search", "—", "identical"]);
  assert.equal((await sheet(ARCHIVED())).filings[0].Basis, "close variation", "an archived listing names no predicate");
  const failed = { ...ASKED("q-default", "default"), ok: false, state: "failed", reason: "the register did not answer" };
  assert.equal((await sheet(READ([FILING("R-1", "A", "q-exact")], [ASKED("q-exact", "exact"), failed]))).filings.find((r) => r.Trademark === "not available").Basis, "containing search");
});

test("the workbook's row for a reading that kept nothing says so, where an archived one says what it said", async () => {
  const crowd = { term: NAME, basis: "identical", qid: "q-1", predicate: "exact", ok: true, fetched: 0, total: 900, state: "crowd-not-read", setAside: true };
  const row = (await sheet(doc({ terms: [crowd] }))).filings.at(-1);
  assert.deepEqual([row.Trademark, row.Note], ["none carried forward", NONE]);
  assert.equal((await sheet(doc({ terms: [crowd], reading: null, schema: 1 }))).filings.at(-1).Trademark, "not available");
  assert.equal((await sheet(doc({ terms: [{ ...crowd, total: 0, state: "zero", setAside: undefined }] }))).filings.at(-1).Trademark, "none found");
});

test("a working note says why a defect is open, and a defect the second look found prints the check's words alone", async () => {
  const open = (state, problem) => ({ mark: NAME, kind: "band", problem, ...(state ? { state } : {}) });
  const { notes } = await sheet(READ(), { openPoints: [open("not-corrected", "One."), open("not-rechecked", "Two."), open("not-answered", "Three."), open("found", "Four."), open(null, "Five.")] });
  assert.deepEqual(notes.map((n) => n.Note), ["Not corrected in this run: One.", "Corrected, but not read again: Two.", "Not answered: Three.", "Four.", "Five."]);
});
