// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE WORKBOOKS' HEADINGS READ IN THE OWNER'S WORDS (2026-11-18). The clearance workbook's enforcement column was
// headed "Enforcer" while the report calls the same meter "Likely to enforce"; it now takes the report's words. The
// Knockout workbook headed its columns in title case ("Finding Reference", "Result Summary") beside a clearance
// workbook in sentence case; it now uses the clearance's case, and the clearance's words where a column holds the same
// thing: the conflicting mark, its risk band, the note. Read from the workbooks as built, on the committed Knockout
// demo and an invented finding.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildKnockoutWorkbook } from "../publish/knockout.mjs";
import { buildAudit } from "../publish/xlsx.mjs";

// The committed demo rated its name Low and carries no conflict, so one invented conflict is added to its first mark.
const DEMO = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "demo", "knockout-search", "run", "knockout-findings.json"), "utf8"));
const CONFLICT = { ordinal: 1, name: "BRISKVALE", owner: "Briskvale Trading Ltd", band: "Serious", type: "Active Business",
  net: "An invented conflict.", evidence: ["https://example.test/briskvale"], basis: "An invented basis." };
const KNOCKOUT = { ...DEMO, marks: [{ ...DEMO.marks[0], findings: [CONFLICT] }, ...DEMO.marks.slice(1)] };
const COUNTS = { schema: 2, provider: "signa", providerLabel: "Signa", scope: { regions: [] }, marks: [{ name: "LANTERNWICK", classes: [4],
  counts: { identical: { total: 3 }, containing: { total: 5 }, close: { total: null, forms: [], generated: 7, counted: 0, unavailable: "not counted" } } }] };

async function headings(t, build) {
  const dir = mkdtempSync(join(tmpdir(), "workbook-headings-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const out = join(dir, "audit.xlsx");
  await build(out);
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(out);
  const heads = {};
  wb.eachSheet((ws) => { heads[ws.name] = ws.getRow(1).values.slice(1).map(String); });
  return heads;
}

test("the clearance workbook heads its enforcement column in the report's words", async (t) => {
  const finding = { ordinal: 1, mark: "TARNELLO", owner: { name: "Invented Holdings", country: "CH", registrations: [] },
    meters: { enforcer: { token: "high", basis: "inferred" } } };
  const heads = await headings(t, (out) => buildAudit({ findings: [finding], coverage: [] }, { negatives: [] }, out, "TARNELLO", {}));
  assert.ok(heads.Findings.includes("Likely to enforce"), `Findings: ${heads.Findings.join(" | ")}`);
  assert.ok(!heads.Findings.includes("Enforcer"));
});

test("the Knockout workbook heads its columns in the clearance workbook's case and words", async (t) => {
  const heads = await headings(t, (out) => buildKnockoutWorkbook(KNOCKOUT, [{ mark: KNOCKOUT.marks[0].name, ok: true, bytes: 10 }], out, COUNTS));
  assert.deepEqual(heads.Findings, ["Mark", "Finding reference", "Conflicting mark", "Owner", "Risk band", "Type", "Net", "Basis", "Evidence"]);
  assert.deepEqual(heads["Audit Trail"], ["Mark", "Search term", "Source / context", "Result summary", "Finding reference"]);
  assert.ok(heads["Register Counts"].includes("Note"), `Register Counts: ${heads["Register Counts"].join(" | ")}`);
  assert.deepEqual(Object.keys(heads), ["Findings", "Negative Results", "Audit Trail", "Register Counts"]);
  const all = Object.values(heads).flat();
  assert.equal(all.length, 28);
  for (const h of all) assert.ok(!/\s[A-Z][a-z]/.test(h), `"${h}" is not in sentence case`);
});
