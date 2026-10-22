// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE WORKBOOK'S SUMMARY COUNTS EVERY ROW ITS COVERAGE TAB SHOWS OPEN.
//
// The Summary counted "Open / limited coverage" from rows in the open and coverage-limited states only. A row in the
// not-searched state was left out, although Coverage & gaps shows it as "Open": on a run delivered without its
// assessment, six such rows sat on that tab while the Summary said 1. The count, the caveat and the headline rule now
// read one rule, the tab's own. Every area here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { summaryRows } from "../publish/xlsx.mjs";

const valueOf = (rows, field) => rows.find((r) => String(r.Field).trim() === field)?.Value;
const row = (area, state, note) => ({ area, state, note });

test("a not-searched row counts as open, beside the open and the limited ones, and the clean ones do not", () => {
  const coverage = [row("Main sweep / worldwide", "confirmed-clean", "paged to completion"), row("Field-size count", "not-searched", "not opened"),
    row("Spelling variants", "open", "one list left"), row("Native script", "coverage-limited", "counted, not listed"), row("Reading note", "note", "for the record")];
  const rows = summaryRows([], coverage, {}, { mark: "QZORVAK" });
  assert.equal(valueOf(rows, "Open / limited coverage"), "3", "the Summary left a row out that its coverage tab shows open");
});

test("with only not-searched rows open, the Summary counts them and leads with one of them, never with none", () => {
  const coverage = [row("Main sweep / worldwide", "confirmed-clean", "paged to completion"), row("Field-size count", "not-searched", "it was never opened")];
  const rows = summaryRows([], coverage, {}, { mark: "QZORVAK" });
  assert.equal(valueOf(rows, "Open / limited coverage"), "1");
  const caveat = valueOf(rows, "⚠  One thing to check first");
  assert.ok(caveat && !/^None/.test(caveat), `the caveat says nothing is open: ${caveat}`);
  assert.match(caveat, /it was never opened/);
});
