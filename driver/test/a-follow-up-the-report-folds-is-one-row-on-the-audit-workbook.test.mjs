// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A FOLLOW-UP ROW THE REPORT FOLDS INTO ITS WRITTEN TWIN IS ONE ROW ON THE AUDIT WORKBOOK (design, 2026-11-21). The
// report's Left open list prints one unfinished search once where the driver's Follow-up row and the writer's own row
// say the same thing; the workbook's Coverage & gaps sheet printed both. It now folds the pairs the report folds, by the
// report's own rule, and keeps on the surviving row what only the Follow-up row said: the reason its search did not
// complete. A Follow-up row with no twin, or whose only match is a completed search, is still its own row. Every
// directive, row and id here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAudit } from "../publish/xlsx.mjs";
import { leftOpenRows } from "../publish/render.mjs";
import { clearanceWorkbookOf } from "../publish/report-document.mjs";
import { deferralCoverageRow } from "../deferral-row.mjs";
import { followUpKinds } from "../follow-up-twins.mjs";
import { WORKBOOK as W } from "../publish/strings.mjs";

async function book(t, coverage, kinds = null) {
  const dir = mkdtempSync(join(tmpdir(), "folded-book-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const out = join(dir, "audit.xlsx");
  // The kinds ride in the report document's form, as clearanceWorkbookOf hands them over.
  const followUpKindsPairs = kinds ? [...kinds].map(([k, s]) => [k, [...s]]) : [];
  await buildAudit({ findings: [], coverage, followUpKinds: followUpKindsPairs }, null, out, "SKARVELLE", { title: "SKARVELLE" });
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(out);
  const rows = (name) => {
    const got = [];
    wb.getWorksheet(name)?.eachRow((row) => got.push(row.values.slice(1).map((v) => (v == null ? "" : String(v)))));
    return got;
  };
  // The sheet leaves out a column no row fills, so a cell is read by its column's name.
  const [head, ...body] = rows("Coverage & gaps");
  return { summary: rows("Summary"), coverage: body.map((row) => Object.fromEntries(head.map((h, i) => [h, row[i]]))) };
}
const left = (sheet, area) => sheet.coverage.find((row) => row.Area === area)?.["What's left"];
const areas = (sheet) => sheet.coverage.map((row) => row.Area);

const DIRECTIVE = "variant:skarvelle audio exact";
const PRIMARY = ["supp:primary-sweep:exact:skarvelle:aa11", "supp:primary-sweep:default:skarvelle:bb22"];
const receipt = { requested: [DIRECTIVE], deferrals: [{ directive: DIRECTIVE, layer: "variant", reason: "source-not-swept" }],
  directive_qids: { [DIRECTIVE]: PRIMARY } };
const followUp = deferralCoverageRow(DIRECTIVE, "source-not-swept");
const axisTwin = { area: "Register / SKARVELLE AUDIO exact in class 9", state: "open", note: "the exact search did not complete" };
const freeTwin = { area: "the word SKARVELLE AUDIO as a dedicated exact search", state: "open", note: "not reached this run" };
const clean = { area: "Register / class 9", state: "confirmed-clean", note: "searched in full" };

test("the pair the report folds is one row on the sheet, the twin, carrying the Follow-up row's reason", async (t) => {
  // Each of the rule's two arms: a row of the recorded kind, and the writer's own free-text row on a run with no record.
  for (const [twin, kinds] of [[axisTwin, followUpKinds(receipt)], [freeTwin, null]]) {
    const coverage = [clean, twin, followUp];
    assert.deepEqual(leftOpenRows({ coverage, followUpKinds: kinds }), [twin], `${twin.area}: the report does not fold the pair`);
    const sheet = await book(t, coverage, kinds);
    assert.deepEqual(areas(sheet), [clean.area, twin.area], `${twin.area}: the sheet still prints the Follow-up row`);
    const own = left(await book(t, [twin]), twin.area), reason = left(await book(t, [followUp]), followUp.area);
    assert.equal(left(sheet, twin.area), `${own}\n${reason}`, `${twin.area}: the twin lost what only the Follow-up row said`);
    assert.equal(sheet.summary.find((row) => row[0].trim() === W.summary.openOrLimited)?.[1], "1", "the Summary counts the gap twice");
  }
});

test("a Follow-up row the report prints is its own row: no twin, a completed match, or a record naming another kind", async (t) => {
  const kinds = followUpKinds(receipt);
  const cases = {
    "no twin": [[clean, followUp], kinds],
    "a completed match": [[{ ...axisTwin, state: "confirmed-clean" }, followUp], kinds],
    "a row of another kind": [[{ ...axisTwin, area: "Common-law / SKARVELLE AUDIO exact" }, followUp], kinds],
  };
  for (const [name, [coverage, k]] of Object.entries(cases)) {
    assert.ok(leftOpenRows({ coverage, followUpKinds: k }).includes(followUp), `${name}: the report folded it`);
    const sheet = await book(t, coverage, k);
    assert.deepEqual(areas(sheet), coverage.map((c) => c.area), `${name}: the sheet changed`);
  }
});

test("two Follow-up rows one row stands in for are one row, and the reason they share is printed once", async (t) => {
  const second = deferralCoverageRow("variant:skarvelle audio", "source-not-swept");
  const sheet = await book(t, [freeTwin, followUp, second]);
  assert.deepEqual(areas(sheet), [freeTwin.area]);
  const reason = left(await book(t, [followUp]), followUp.area);
  assert.equal(left(sheet, freeTwin.area).split("\n").filter((l) => l === reason).length, 1);
});

test("publishing hands the workbook the recorded kinds the page reads", () => {
  const pairs = [["skarvelle audio exact", ["primary-sweep"]]];
  const doc = {
    run: { provider: { origins: null }, product: { name: "Example" } }, framework: { method: null }, prose: { frontMatter: { title: "SKARVELLE" } },
    scope: {}, verdict: {}, client: { findings: [], coverage: [], followUpKinds: pairs }, reviewer: { withdrawn: [] },
  };
  assert.deepEqual(clearanceWorkbookOf(doc).contract.followUpKinds, pairs);
});
