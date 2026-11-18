// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// EVERY WORKBOOK TAB AND HEADER IS IN THE SENTENCE CATALOGUE. The audit workbooks build their rows on each column's
// key and take the words a reader sees from publish/strings.mjs (WORKBOOK_LABELS). A tab or a header with no entry
// would print its key, untranslatable and unnoticed, so the demo workbooks are read back and every one is held to
// an entry, both workbooks and every optional sheet the demos build.
// @tier full — publishes the four demo reports through the demo's own publisher
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WORKBOOK_LABELS } from "../publish/strings.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("every tab and column header in the demo workbooks is a catalogue entry", async () => {
  const pool = mkdtempSync(join(tmpdir(), "labels-pool-"));
  const r = spawnSync(process.execPath, [join(ROOT, "bin", "example.mjs"), "--once", "--pool", pool], { encoding: "utf8", timeout: 240_000 });
  assert.equal(r.status, 0, `the demo publisher failed:\n${r.stderr || r.stdout}`);
  const books = nonEmpty(readdirSync(pool, { recursive: true }).map(String).filter((n) => n.endsWith(".xlsx")), "the demo workbooks");
  const ExcelJS = (await import("exceljs")).default;
  const sheets = new Set(Object.values(WORKBOOK_LABELS.sheets)), columns = new Set(Object.values(WORKBOOK_LABELS.columns));
  let seen = 0;
  for (const rel of books) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(join(pool, rel));
    wb.eachSheet((ws) => {
      assert.ok(sheets.has(ws.name), `${rel}: the tab "${ws.name}" has no catalogue entry`);
      ws.getRow(1).eachCell((c) => { seen++; assert.ok(columns.has(String(c.value)), `${rel} / ${ws.name}: the header "${c.value}" has no catalogue entry`); });
    });
  }
  assert.ok(seen > 40, `only ${seen} headers were read, so the check above checked little`);
});
