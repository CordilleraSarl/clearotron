// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE KNOCKOUT WORKBOOK'S TEXT COLUMNS ARE AT LEAST 40 WIDE. Its Findings, Negative Results and Audit Trail
// sheets hold sentences: the conflict's type and reasoning, its sources, what a search returned. Those columns take
// their widths from the one table both workbooks share, and a header the table does not name gets 16, where a
// sentence wraps to a word or two a line. Negative Results' Result column shared the clearance's 24, and the mark,
// the owner, the band, which carries the rating's inputs beside it, and the finding reference (the mark and its ordinals) were narrower
// too. Every column on these three sheets is held to 40 here. The register sheets, Register Counts and Register
// Filings, hold counts and dates beside their text, so their text columns are named: each is held to 40, and the
// register's name to 24.
//
// Read from the workbook as built, on the committed Knockout demo with one invented conflict, invented counts and one
// invented filing added.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildKnockoutWorkbook } from "../publish/knockout.mjs";

const DEMO = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "demo", "knockout-search", "run", "knockout-findings.json"), "utf8"));
const CONFLICT = { ordinal: 1, name: "BRISKVALE", owner: "Briskvale Trading Ltd", band: "Serious", type: "Active Business",
  net: "An invented conflict.", evidence: ["https://example.test/briskvale"], basis: "An invented basis." };
const KNOCKOUT = { ...DEMO, marks: [{ ...DEMO.marks[0], findings: [CONFLICT] }, ...DEMO.marks.slice(1)] };
const COUNTS = { schema: 2, provider: "signa", providerLabel: "Signa", scope: { regions: ["EU", "GB", "US"] },
  marks: [{ name: KNOCKOUT.marks[0].name, classes: [4],
    counts: { identical: { total: 3 }, containing: { total: 5 }, close: { total: null, forms: [], generated: 7, counted: 0, unavailable: "not counted" } } }] };
const RECORDS = { providerLabel: "Signa", marks: [{ name: KNOCKOUT.marks[0].name, records: [{ mark: "BRISKVALE", owner: "Briskvale Trading Ltd",
  status: "Registered", classes: [9, 42], territory: "EU", recordId: "x1", url: "https://example.test/record/x1" }] }] };
const SHEETS = ["Findings", "Negative Results", "Audit Trail"];
const REGISTER_TEXT = { "Register Counts": { Territories: 40, "Close variation forms": 40, Register: 24 },
  "Register Filings": { Trademark: 40, "Matched form": 40, Classes: 40, Record: 40, Owner: 40 } };

async function built(t) {
  const dir = mkdtempSync(join(tmpdir(), "knockout-widths-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const out = join(dir, "audit.xlsx");
  await buildKnockoutWorkbook(KNOCKOUT, [{ mark: KNOCKOUT.marks[0].name, ok: true, bytes: 10 }], out, COUNTS, [], null, RECORDS);
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(out);
  return wb;
}

test("every column on the Knockout's Findings, Negative Results and Audit Trail sheets is at least 40 wide", async (t) => {
  const wb = await built(t);
  const narrow = [];
  let measured = 0;
  for (const name of SHEETS) {
    const ws = wb.getWorksheet(name);
    assert.ok(ws, `the workbook has no ${name} sheet`);
    assert.ok(ws.rowCount > 1, `premise: ${name} carries a row, so its columns are the ones a reader meets`);
    for (const c of ws.columns) {
      const head = String(ws.getRow(1).getCell(c.number).value);
      measured++;
      if (!(c.width >= 40)) narrow.push(`${name} · ${head} = ${c.width}`);
    }
  }
  assert.ok(measured >= 16, `premise: ${measured} columns measured`);
  assert.deepEqual(narrow, []);
});

test("the register sheets' text columns are wide enough for a worldwide scope, a filing's mark and its record", async (t) => {
  const wb = await built(t);
  const narrow = [];
  for (const [name, columns] of Object.entries(REGISTER_TEXT)) {
    const ws = wb.getWorksheet(name);
    assert.ok(ws && ws.rowCount > 1, `premise: the workbook has a ${name} sheet with a row`);
    const widthOf = Object.fromEntries(ws.columns.map((c) => [String(ws.getRow(1).getCell(c.number).value), c.width]));
    for (const [head, least] of Object.entries(columns)) {
      assert.ok(head in widthOf, `premise: ${name} has a ${head} column; it has ${Object.keys(widthOf).join(" | ")}`);
      if (!(widthOf[head] >= least)) narrow.push(`${name} · ${head} = ${widthOf[head]}, under ${least}`);
    }
  }
  assert.deepEqual(narrow, []);
});
