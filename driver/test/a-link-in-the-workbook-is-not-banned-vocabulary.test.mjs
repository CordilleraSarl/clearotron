// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A LINK IN THE WORKBOOK IS A CITATION, NOT BANNED VOCABULARY.
//
// The workbook check scans every cell a lawyer can see for engine words, and `https` is on the list so that
// a transport error written into prose ("HTTP 404 for …") is caught. A source URL matched it too, so the
// demo's workbook printed `advisory: banned vocab "https"` over its own citations, measured on a stranger's
// install of a published beta. The URL is taken out before the scan; the prose case must still be caught.
import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { validateAudit } from "../publish/xlsx.mjs";

const workbookWith = (cell) => {
  const wb = new ExcelJS.Workbook();
  for (const name of ["Summary", "Findings", "What was searched", "Coverage & gaps"]) wb.addWorksheet(name).addRow(["Heading"]);
  wb.getWorksheet("Findings").addRow([cell]);
  return wb;
};
const vocab = (wb) => validateAudit(wb, {}).violations.filter((v) => /banned vocab/.test(v));

test("a source URL, as text or as a hyperlink, is not banned vocabulary", () => {
  assert.deepEqual(vocab(workbookWith("https://euipo.europa.eu/eSearch/#details/trademarks/018000000")), []);
  assert.deepEqual(vocab(workbookWith("Filed earlier (http://example.test/record/1).")), []);
  assert.deepEqual(vocab(workbookWith({ text: "https://example.test/mark/1", hyperlink: "https://example.test/mark/1" })), []);
});

test("the word itself in prose is still caught", () => {
  assert.equal(vocab(workbookWith("HTTP 404 for uri=/mark/ch/06198")).length, 1,
    "a transport error written into a lawyer's cell must still be reported");
  assert.equal(vocab(workbookWith("see https://example.test/a — the cache was stale")).length, 1,
    "removing the URL must not remove the words beside it");
});
