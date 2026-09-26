// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A FILINGS SEARCH THAT FAILED SAYS SO IN THE READER'S WORDS. When the knockout's filings listing failed
// for one form of a name, the Register Filings sheet printed the failure's own text as the row's Note:
// "record listing threw: <the error's message>". The Note now reads as the audit's other open searches
// read, and the raw cause stays in the run's filings record, where the listing wrote it. A form the record
// cap stopped before it was asked keeps its own sentence, which is its true cause and no error. These tests
// run the real listing with a stand-in register, then build the workbook from what it recorded.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";

const ROOT = mkdtempSync(join(tmpdir(), "failed-filings-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || join(ROOT, "ws"));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool"));

const { listRegisterRecords } = await import("../register-records.mjs");
const { buildKnockoutWorkbook } = await import("../publish/knockout.mjs");
const ExcelJS = (await import("exceljs")).default;

const NAME = "LANTERNWICK";
const LEFT_OPEN = "it could not be completed this run, so it is left open here rather than reported as clean";
const FILING = { record_id: "tm_1", mark_text: NAME, owner_name: "Brightmoor Candle Co", status: "Registered", classes: [4] };

/** The knockout's listing, over `lister`, and the Register Filings sheet built from what it recorded. */
async function filings(lister, opts = {}) {
  const doc = await listRegisterRecords({ marks: [{ name: NAME, classes: [4] }], provider: "signa", capabilities: { id: "signa" }, lister, ...opts });
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

test("a form whose search failed says it could not be completed, and the raw cause stays in the run's record", async () => {
  const { doc, rows } = await filings(async (term) => {
    if (term === NAME) throw new Error("the listing connection reset");
    return { ok: true, records: [], total: 0 };
  });
  const row = rows.find((r) => r["Matched form"] === NAME);
  assert.deepEqual([row?.["Trademark"], row?.["Note"]], ["not available", LEFT_OPEN]);
  assert.ok(!/threw|connection reset/.test(JSON.stringify(rows)), "the raw cause reached a reader's cell");
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
