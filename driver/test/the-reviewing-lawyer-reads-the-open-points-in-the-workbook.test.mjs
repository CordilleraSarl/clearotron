// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE REVIEWING LAWYER READS THE OPEN POINTS IN THE WORKBOOK.
//
// Owner ruling 2026-09-24: reviewer notes never reach the client page. Taking the open points off the
// report must not also take them from the reviewing lawyer, who is who they are for, and the cover email
// never showed them. So the run record the pipeline writes is read into the audit workbook's Summary tab.
// These arms drive the real path end to end: the builder's own output, written where the pipeline writes
// it, read by the module publish uses, rendered by buildAudit, and read back out of the .xlsx.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import ExcelJS from "exceljs";
import { buildReviewerOpenPointsSection } from "../pipeline.mjs";
import { REVIEWER_OPEN_QUESTIONS_FILE, readReviewerOpenPoints, reviewerOpenPointsFromRecord } from "../reviewer-open-points.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";
import { buildAudit } from "../publish/xlsx.mjs";

const REVIEW = ["BLOCKING", "", "## Flags", "",
  "1. [kind: fact] [on: 3] the summary says the phonetic axis ran; the receipt shows it never did"].join("\n");

async function summaryValues(reviewerOpenPoints) {
  const dir = mkdtempSync(join(tmpdir(), "open-points-wb-"));
  try {
    const out = join(dir, "audit.xlsx");
    await buildAudit({ findings: [], coverage: [], reviewerOpenPoints }, null, out, "ZEPHYR", {});
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(out);
    const rows = [];
    wb.getWorksheet("Summary").eachRow((r) => rows.push([String(r.getCell(1).value ?? ""), String(r.getCell(2).value ?? "")]));
    return rows;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("the record the pipeline writes is read back as a heading, a lead and the points", () => {
  const dir = mkdtempSync(join(tmpdir(), "open-points-"));
  try {
    const file = driverDir(dir, REVIEWER_OPEN_QUESTIONS_FILE);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${buildReviewerOpenPointsSection(REVIEW)}\n`);
    const p = readReviewerOpenPoints(dir);
    assert.equal(p.heading, "Reviewer's open questions");
    assert.match(p.lead, /did not sign this report off/);
    assert.equal(p.points.length, 1);
    assert.match(p.points[0], /the phonetic axis ran; the receipt shows it never did/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("no record, no section: a run whose reviewer signed shows the lawyer nothing added", () => {
  const dir = mkdtempSync(join(tmpdir(), "open-points-"));
  try { assert.equal(readReviewerOpenPoints(dir), null); }
  finally { rmSync(dir, { recursive: true, force: true }); }
  assert.equal(reviewerOpenPointsFromRecord(""), null, "an empty record is no section, not a heading over nothing");
});

test("the workbook's Summary tab carries the open points, in the record's own words", async () => {
  const rows = await summaryValues(reviewerOpenPointsFromRecord(buildReviewerOpenPointsSection(REVIEW)));
  const head = rows.find(([f]) => f === "Reviewer's open questions");
  assert.ok(head, "the section's heading is not on the Summary tab");
  assert.match(head[1], /did not sign this report off/);
  assert.ok(rows.some(([, v]) => /the phonetic axis ran; the receipt shows it never did/.test(v)),
    "the reviewer's point itself is not on the Summary tab");
  assert.ok(!rows.some(([, v]) => /\*/.test(v)), "markdown emphasis reached a cell");
});

test("a run with no open points adds no rows to the Summary tab", async () => {
  const rows = await summaryValues(null);
  assert.ok(!rows.some(([f]) => f === "Reviewer's open questions"));
});
