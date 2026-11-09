// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A comparison of two published runs reads a workbook's cells and layout, and only its generation stamps are set aside.
import assert from "node:assert/strict";
import { test } from "node:test";

import ExcelJS from "exceljs";

import { workbookEntryText, zipEntries } from "./snapshot/workbook-entries.mjs";

async function book(cell, when) {
  const wb = new ExcelJS.Workbook();
  wb.created = when; wb.modified = when;
  wb.addWorksheet("Findings").getCell("A1").value = cell;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const contents = (buf) => zipEntries(buf).map(([n, b]) => [n, workbookEntryText(n, b)]);

test("the same cells written at two different moments compare equal", async () => {
  assert.deepEqual(contents(await book("2026-01-15", new Date(0))), contents(await book("2026-01-15", new Date(86_400_000))));
});

test("a changed cell compares different, and a date in a cell is content rather than a stamp", async () => {
  assert.notDeepEqual(contents(await book("2026-01-15", new Date(0))), contents(await book("2026-01-16", new Date(0))));
});

test("something that is not a zip is refused rather than read as empty", () => {
  assert.throws(() => zipEntries(Buffer.from("not a workbook, and long enough to hold a record")), /not a zip/);
});
