// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A NATIVE-LANGUAGE INVESTIGATION THE CLIENT ORDERED, THAT FAILED, IS NOT OFFERED BACK TO THEM.
//
// When the lanes of an ordered investigation did not run, the report's coverage told the reader where the
// investigation can be bought: true of a search that did not include it, false of one that did. Ruled
// 2026-09-25: an ordered investigation that failed reads the audit's own line for that part, "could not be
// completed this run", and the offer does not appear. And a Japanese or Korean lane asked for full depth
// that ran nothing no longer reads that it "ran as a slice-1 candidate lane". The marks are invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { driverDir } from "../../shared/driver-dir.mjs";
import { NATIVE_LANGUAGE_REMEDY } from "../products.mjs";
import { injectScriptScopeCoverage, localLanguageStateOf, ZH_SCOPE_COVERAGE_AREA } from "../pipeline.mjs";
import { degradedPartRows, PART_NAMES, NOT_COMPLETED } from "../degraded-parts.mjs";
import { deriveLaneDepthVerdicts } from "../jx.mjs";
import { buildAudit } from "../publish/xlsx.mjs";

const ORDERED = { level: "multi-country-focus-search", components: { jxLanes: true } };
const NOT_ORDERED = { level: "global-preliminary-search", components: { jxLanes: false } };
const quiet = () => {};
// The audit workbook's own row for this part, as delivery writes it.
const AUDIT_ROW = degradedPartRows([{ name: PART_NAMES.localLanguage, reason: NOT_COMPLETED }])[0];

function findingsIn(dir) {
  const P = { findings: join(dir, "findings.json") };
  writeFileSync(P.findings, JSON.stringify({ schema_version: 2, findings: [], coverage: [{ area: "Register — class 9", state: "confirmed-clean", note: "searched in full" }] }, null, 2));
  return P;
}
const coverageOf = (P) => JSON.parse(readFileSync(P.findings, "utf8")).coverage;
const offered = (rows) => rows.some((c) => c.area === ZH_SCOPE_COVERAGE_AREA || String(c.note ?? "").includes(NATIVE_LANGUAGE_REMEDY));

test("an ordered investigation that ran no lane carries the audit's own row, once, and no offer", () => {
  const dir = mkdtempSync(join(tmpdir(), "ordered-failed-"));
  const P = findingsIn(dir);
  const args = { searchPolicy: ORDERED, job: { jurisdictions: ["CN", "JP"] }, profile: {}, env: {}, localLanguage: "not-run" };
  injectScriptScopeCoverage(P, dir, quiet, args);
  injectScriptScopeCoverage(P, dir, quiet, args);   // a resume passes here again
  const rows = coverageOf(P);
  assert.equal(offered(rows), false, "the investigation the client bought was offered back to them");
  assert.deepEqual(rows.filter((c) => c.area === AUDIT_ROW.area), [AUDIT_ROW], "the audit's row, word for word, once");
  assert.match(AUDIT_ROW.note, /could not be completed this run/);
});

test("an ordered investigation where some lane ran is offered nothing, and draws no failure row", () => {
  const dir = mkdtempSync(join(tmpdir(), "ordered-short-"));
  const P = findingsIn(dir);
  injectScriptScopeCoverage(P, dir, quiet, { searchPolicy: ORDERED, job: { jurisdictions: ["CN", "JP"] }, profile: {}, env: {}, localLanguage: "ran-shallow" });
  assert.equal(offered(coverageOf(P)), false);
  assert.equal(coverageOf(P).length, 1, "nothing was added");
});

test("THE CONTROL: a search that did not include the investigation is still told where it is offered", () => {
  const dir = mkdtempSync(join(tmpdir(), "not-ordered-"));
  const P = findingsIn(dir);
  injectScriptScopeCoverage(P, dir, quiet, { searchPolicy: NOT_ORDERED, job: { jurisdictions: ["CN"] }, profile: {}, env: {} });
  assert.equal(offered(coverageOf(P)), true);
  assert.equal(coverageOf(P).some((c) => c.area === AUDIT_ROW.area), false);
});

test("the page's row and the audit's part read one state: not run when every asked lane ran nothing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ll-state-"));
  assert.equal(await localLanguageStateOf(dir), null, "no lane record, no state");
  mkdirSync(driverDir(dir), { recursive: true });
  writeFileSync(driverDir(dir, "jx-lanes.json"), JSON.stringify({ schema: 1, lanes: { zh: { depth: "candidates", jurisdictions: ["CN"] } },
    fold: { depth: { zh: { asked: "candidates", ran: null, shortfall: true } } } }));
  assert.equal(await localLanguageStateOf(dir), "not-run");
});

test("a Japanese lane asked for full depth that ran nothing is not said to have run as a candidate lane", () => {
  const sidecar = { lanes: { ja: { depth: "full", jurisdictions: ["JP"] } } };
  const failed = deriveLaneDepthVerdicts({ sidecar, slices: { candidates: { slice: 1, state: "not-ran", lanes: { ja: "not-ran" } } } }).ja;
  assert.equal(failed.ran, null);
  assert.equal(failed.cause, "not-established");
  assert.doesNotMatch(failed.why, /ran as a\s+slice-1 candidate lane/);
  assert.doesNotMatch(failed.why, /deep slice\(s\)\s+did not state/, "a lane with no deep slice names none");
  const ran = deriveLaneDepthVerdicts({ sidecar, slices: { candidates: { slice: 1, state: "ran", lanes: { ja: "ran" } } } }).ja;
  assert.equal(ran.cause, "not-built-for-lane", "THE CONTROL: a lane whose candidates ran reads as it did");
});

test("the audit workbook prints the row once when the report's coverage already carries it", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ll-book-"));
  const out = join(dir, "audit.xlsx");
  const other = degradedPartRows([{ name: PART_NAMES.courtDecisions, reason: NOT_COMPLETED }])[0];
  await buildAudit({ findings: [], coverage: [AUDIT_ROW], degradedParts: [AUDIT_ROW, other] }, null, out, "QZXV", { title: "QZXV" });
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(out);
  const areas = [];
  wb.getWorksheet("Coverage & gaps").eachRow((row) => areas.push(String(row.values[1] ?? "")));
  assert.equal(areas.filter((a) => a === AUDIT_ROW.area).length, 1);
  assert.equal(areas.filter((a) => a === other.area).length, 1, "a part the coverage does not carry still prints");
});
