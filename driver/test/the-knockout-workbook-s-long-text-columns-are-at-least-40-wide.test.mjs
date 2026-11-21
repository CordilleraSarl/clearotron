// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE KNOCKOUT WORKBOOK'S LONG-TEXT COLUMNS ARE AT LEAST 40 WIDE. Its Findings, Negative Results and Audit Trail
// sheets hold sentences: the conflict's type and reasoning, its sources, what a search returned. Those columns take
// their widths from the one table both workbooks share, and a header the table does not name gets 16, where a
// sentence wraps to a word or two a line. Negative Results' Result column shared the clearance's 24. Every column on
// these three sheets is held to 40 here, except the four that hold a name, a reference or a band.
//
// Read from the workbook as built, on the committed Knockout demo with one invented conflict added.
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
const SHORT = new Set(["Mark", "Finding reference", "Owner", "Risk band"]);
const SHEETS = ["Findings", "Negative Results", "Audit Trail"];

test("every long-text column on the Knockout's Findings, Negative Results and Audit Trail sheets is at least 40 wide", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "knockout-widths-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const out = join(dir, "audit.xlsx");
  await buildKnockoutWorkbook(KNOCKOUT, [{ mark: KNOCKOUT.marks[0].name, ok: true, bytes: 10 }], out);
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(out);
  const narrow = [];
  let measured = 0;
  for (const name of SHEETS) {
    const ws = wb.getWorksheet(name);
    assert.ok(ws, `the workbook has no ${name} sheet`);
    assert.ok(ws.rowCount > 1, `premise: ${name} carries a row, so its columns are the ones a reader meets`);
    for (const c of ws.columns) {
      const head = String(ws.getRow(1).getCell(c.number).value);
      if (SHORT.has(head)) continue;
      measured++;
      if (!(c.width >= 40)) narrow.push(`${name} · ${head} = ${c.width}`);
    }
  }
  assert.ok(measured >= 10, `premise: ${measured} long-text columns measured`);
  assert.deepEqual(narrow, []);
});
