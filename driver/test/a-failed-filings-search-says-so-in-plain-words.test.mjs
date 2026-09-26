// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A FILINGS SEARCH THAT FAILED SAYS SO IN THE READER'S WORDS. When the knockout's filings listing failed
// for one form of a name, the Register Filings sheet printed the failure's own text as the row's Note:
// "record listing threw: <the error's message>". The Note now reads as the audit's other open searches
// read, and the raw cause stays in the run's filings record, where the listing wrote it. A form the record
// cap stopped before it was asked keeps its own sentence, which is its true cause and no error. These tests
// run the real listing with a stand-in register, then build the workbook from what it recorded.
//
// The report page and report-data.json carried the same text: a name with no filings and a failed search
// read "Filings: not available — N of M search(es) could not be run (<the failure's own text>)." The
// bracket is gone and nothing is written in its place. The last tests publish through the real publisher.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";

// Pinned BEFORE the imports: driver.config reads env at module load, and its pool root's default is the
// real archive.
const ROOT = mkdtempSync(join(tmpdir(), "failed-filings-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || join(ROOT, "ws"));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool"));
pinEnv(process.env, "CLEAROTRON_REPORTS_URL", "https://trademark.test");
pinEnv(process.env, "CLEAROTRON_DATABASE", "signa");

const { listRegisterRecords } = await import("../register-records.mjs");
const { buildKnockoutWorkbook, publishKnockout } = await import("../publish/knockout.mjs");
const { driverDir } = await import("../../shared/driver-dir.mjs");
const ExcelJS = (await import("exceljs")).default;

const NAME = "LANTERNWICK";
const LEFT_OPEN = "it could not be completed this run, so it is left open here rather than reported as clean";
const FILING = { record_id: "tm_1", mark_text: NAME, owner_name: "Brightmoor Candle Co", status: "Registered", classes: [4] };
const RAW = /threw|connection reset/;

/** The knockout's listing over `lister`. */
const listing = (lister, opts = {}) =>
  listRegisterRecords({ marks: [{ name: NAME, classes: [4] }], provider: "signa", capabilities: { id: "signa" }, lister, ...opts });
const throwsOnEveryForm = async () => { throw new Error("the listing connection reset"); };

/** The knockout's listing, over `lister`, and the Register Filings sheet built from what it recorded. */
async function filings(lister, opts = {}) {
  const doc = await listing(lister, opts);
  const out = join(mkdtempSync(join(ROOT, "book-")), "audit.xlsx");
  await buildKnockoutWorkbook({ marks: [{ name: NAME, findings: [] }] }, [], out, null, [], null, doc);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(out);
  const ws = wb.getWorksheet("Register Filings");
  const head = ws.getRow(1).values.slice(1);
  const rows = [];
  ws.eachRow((row, n) => { if (n > 1) rows.push(Object.fromEntries(head.map((h, i) => [h, String(row.values[i + 1] ?? "")]))); });
  return { doc, rows };
}

const FRAMEWORK = { framework_key: "house-triage", title: "t", bands: [
  { label: "Very High", tone: "severe" }, { label: "High", tone: "high" }, { label: "Medium", tone: "medium" },
  { label: "Manageable", tone: "low" }, { label: "Low", tone: "minimal" }] };

/** Publish `doc` as a run's own filings record, and return the report page and report-data.json. */
async function publish(doc) {
  const runId = `failed-filings-${Math.random().toString(36).slice(2, 8)}`;
  const runDir = mkdtempSync(join(ROOT, "run-"));
  mkdirSync(driverDir(runDir), { recursive: true });
  writeFileSync(driverDir(runDir, "framework.json"), JSON.stringify(FRAMEWORK));
  writeFileSync(driverDir(runDir, "register-records.json"), JSON.stringify(doc));
  const poolRoot = mkdtempSync(join(ROOT, "pool-"));
  await publishKnockout({
    runId, codename: "fixture", runDir, framework: FRAMEWORK, overall: "Low",
    findings: { marks: [{ name: NAME, rating: "Low", bullets: ["Synthetic fixture."], findings: [] }] },
    poolRoot, poolUrl: "https://trademark.test", customerKey: "generic", skipRegen: true,
  });
  return {
    html: readFileSync(join(poolRoot, runId, "report.html"), "utf8"),
    data: JSON.parse(readFileSync(join(poolRoot, runId, "report-data.json"), "utf8")),
  };
}

test("a form whose search failed says it could not be completed, and the raw cause stays in the run's record", async () => {
  const { doc, rows } = await filings(async (term) => {
    if (term === NAME) throw new Error("the listing connection reset");
    return { ok: true, records: [], total: 0 };
  });
  const row = rows.find((r) => r["Matched form"] === NAME);
  assert.deepEqual([row?.["Trademark"], row?.["Note"]], ["not available", LEFT_OPEN]);
  assert.ok(!RAW.test(JSON.stringify(rows)), "the raw cause reached a reader's cell");
  const recorded = doc.marks[0].terms.find((t) => t.term === NAME);
  assert.match(recorded.reason, /^record listing threw: the listing connection reset/, "the run's record lost the raw cause");
});

test("a search that timed out reads as the timeout line", async () => {
  const { rows } = await filings(async (term) => (term === NAME
    ? { ok: false, records: null, reason: "ETIMEDOUT: the request timed out after 30000 ms" }
    : { ok: true, records: [], total: 0 }));
  assert.equal(rows.find((r) => r["Matched form"] === NAME)?.["Note"], "the source timed out this run");
  assert.ok(!/ETIMEDOUT|30000/.test(JSON.stringify(rows)), "the raw cause reached a reader's cell");
});

test("a form the record cap stopped before it was asked keeps its own sentence", async () => {
  const { rows } = await filings(async (term) => ({ ok: true, records: term === NAME ? [FILING] : [], total: term === NAME ? 1 : 0 }), { cap: 1 });
  const stopped = rows.filter((r) => r["Trademark"] === "not available");
  assert.ok(stopped.length > 0, "the fixture reached no form past the cap");
  for (const r of stopped) assert.equal(r["Note"], "the 1-record cap for this name was reached before this form was fetched");
});

test("THE CONTROL: a listing that answered builds the rows it built before", async () => {
  const { rows } = await filings(async (term) => ({ ok: true, records: term === NAME ? [FILING] : [], total: term === NAME ? 1 : 0 }));
  assert.ok(rows.some((r) => r["Trademark"] === NAME && r["Owner"] === "Brightmoor Candle Co"), `the filing is missing: ${JSON.stringify(rows)}`);
  assert.ok(rows.every((r) => r["Trademark"] !== "not available"), "a search that answered reads as not available");
});

test("the report page and report-data.json say the searches could not be run, and print no raw cause", async () => {
  const doc = await listing(throwsOnEveryForm);
  const forms = doc.marks[0].terms.length;
  assert.ok(doc.marks[0].terms.every((t) => RAW.test(t.reason)), "precondition: the run's record keeps every raw cause");
  const { html, data } = await publish(doc);
  const line = `Filings: not available — ${forms} of ${forms} search(es) could not be run.`;
  assert.ok(html.includes(line), "the report page lost the filings line");
  assert.ok(!RAW.test(html), "a raw cause reached the report page");
  const filed = data.marks[0].registerFilings;
  assert.equal(filed.line, line);
  assert.deepEqual(filed.unanswered.map((u) => u.reason), Array(forms).fill(null), "a failed search's own text reached report-data.json");
  assert.ok(!RAW.test(JSON.stringify(data)), "a raw cause reached report-data.json");
});

test("report-data.json keeps the sentence of a form the record cap stopped", async () => {
  const doc = await listing(async (term) => ({ ok: true, records: term === NAME ? [FILING] : [], total: term === NAME ? 1 : 0 }), { cap: 1 });
  const { data } = await publish(doc);
  const stopped = data.marks[0].registerFilings.unanswered;
  assert.ok(stopped.length > 0, "the fixture reached no form past the cap");
  for (const u of stopped) assert.equal(u.reason, "the 1-record cap for this name was reached before this form was fetched");
});
