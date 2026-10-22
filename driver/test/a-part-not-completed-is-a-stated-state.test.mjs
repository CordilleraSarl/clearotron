// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A PART NOT COMPLETED IS A STATED STATE, NEVER AN ABSENCE.
//
// When a covered part of a run cannot be completed once its recovery is spent, the run records it
// (parts-not-completed.mjs) and delivers without it. Every surface keys on that record: the workbook's shipped
// "Findings" row, the publisher's coverage rows and its silence about any rating. A damaged record still states the
// part as not completed, an unknown part cannot be recorded, and a run with no record publishes as it always did.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { writePartNotCompleted, readPartNotCompleted, partsNotCompleted, clearPartsNotCompleted, notCompletedPath } from "../parts-not-completed.mjs";
import { degradedParts, degradedPartRows, PART_NAMES, NOT_COMPLETED } from "../degraded-parts.mjs";
import { assessmentCoverageRows, assessmentCoverageOfRun, relabelCoverageRows, loadCoverageLedger } from "../pipeline.mjs";
import { coverageFormPaths } from "../coverage-form-io.mjs";
import { assessmentNotCompletedNote } from "../../shared/client-failure-note.mjs";
import { plainDeferralReason } from "../deferral-row.mjs";

const runDir = (t) => {
  const dir = mkdtempSync(join(tmpdir(), "part-not-completed-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(driverDir(dir), { recursive: true });
  return dir;
};

test("the record is written whole, read back, and its presence is the state even when it is damaged", (t) => {
  const dir = runDir(t);
  assert.equal(readPartNotCompleted(dir, "assessment"), null, "a run with no record states a part as not completed");
  assert.deepEqual(partsNotCompleted(dir), []);
  const rec = writePartNotCompleted(dir, "assessment", { stage: "synthesis", reason: "timeout", sig: "abc", terminalKind: "exhausted" });
  assert.deepEqual({ ...readPartNotCompleted(dir, "assessment"), ts: undefined }, { ...rec, ts: undefined });
  assert.equal(readPartNotCompleted(dir, "assessment").stage, "synthesis");
  assert.ok(!existsSync(`${notCompletedPath(dir, "assessment")}.tmp`), "the temporary file was left behind");
  writeFileSync(notCompletedPath(dir, "assessment"), "{ not json");
  assert.deepEqual(readPartNotCompleted(dir, "assessment"), { part: "assessment", damaged: true }, "a damaged record reads as no record");
  assert.equal(partsNotCompleted(dir).length, 1);
  assert.throws(() => writePartNotCompleted(dir, "the-whole-run", {}), /not a covered part/, "a part nobody covers was recorded");
  clearPartsNotCompleted(dir);
  assert.equal(readPartNotCompleted(dir, "assessment"), null, "the stop notice's clear left the record");
});

test("the record gives the workbook the shipped Findings row, and nothing without it", (t) => {
  const dir = runDir(t);
  writeFileSync(join(dir, "audit.md"), "# Negative Results\n");
  assert.deepEqual(degradedParts(dir).filter((d) => d.part === "assessment"), [], "a run with no record carries the row");
  writePartNotCompleted(dir, "assessment", { stage: "synthesis", reason: "timeout" });
  const part = degradedParts(dir).find((d) => d.part === "assessment");
  assert.ok(part, "the record gives no row");
  assert.equal(part.name, PART_NAMES.findings);
  assert.equal(part.reason, NOT_COMPLETED, "the reason is not the shipped row's own");
  assert.match(part.cause, /synthesis: timeout/, "the cause on the run's record does not say what failed");
  const [row] = degradedPartRows([part]);
  assert.match(row.note, /it could not be completed this run, so it is left open here rather than reported as clean$/);
  assert.ok(!row.note.includes("timeout"), "the raw cause reached a reader's cell");
  // A damaged record is still the state.
  writeFileSync(notCompletedPath(dir, "assessment"), "{");
  assert.ok(degradedParts(dir).some((d) => d.part === "assessment"), "a damaged record dropped the row");
});

test("the register's coverage ledger becomes the report's coverage rows: no row clean, and none in the write-up's words", () => {
  const rows = assessmentCoverageRows([
    { axis: "primary-sweep", scope: "worldwide", unit: "primary-sweep / worldwide", status: "confirmed-clean", reason: "paged to completion" },
    { axis: "saturation-probe", scope: "", unit: "saturation-probe", status: "coverage-limited", reason: "counted, not listed" },
    { axis: "transliteration-numeric", scope: "", unit: "transliteration-numeric", status: "deferred", reason: "the provider could not express it" },
    { axis: "incumbent-class", scope: "", unit: "incumbent-class", status: "withheld-by-judgment", reason: "not opened: answered" },
    { axis: "primary-sweep", scope: "", unit: "primary-sweep", status: "no-such-status", reason: "x" },
    { axis: "", scope: "", unit: "", status: "confirmed-clean", reason: "no unit" },
  ]);
  // With no assessment nothing is reported, so the write-up's "confirmed-clean" is an open item; the rest keep the shipped
  // state their status names (as amended on the issue, 2026-10-22).
  assert.deepEqual(rows.map((r) => r.state), ["open", "coverage-limited", "not-searched", "note"],
    "a status was read as something it is not, or an unreadable row was kept");
  // The write-up's reasons are its own words for the assessment, and none reaches a reader: an open row carries the shipped
  // gap reason, and every other row carries no note.
  assert.deepEqual(rows.map((r) => r.note), [plainDeferralReason("unfinished"), "", "", ""], "a write-up's reason reached a reader's row");
  assert.ok(rows.every((r) => r.area && !/^[a-z]+-[a-z]+( \/|$)/.test(r.area)), `an engine axis name reached a reader's row: ${JSON.stringify(rows.map((r) => r.area))}`);
  assert.deepEqual(assessmentCoverageRows(null), []);
});

test("publishing in the state reads no assessment: no finding, no verdict, the delivery's coverage rows, and a workbook", async (t) => {
  const dir = runDir(t);
  writeFileSync(join(dir, "report.md"), ["---", "type: clearance-clearance", "matter: TMP8196", "title: ORBANTIQ",
    `overall_caption: ${assessmentNotCompletedNote()}`, "---", ""].join("\n"));
  writeFileSync(join(dir, "audit.md"), "\n# Negative Results\n\n## NR1\n- source_layer: Register\n- search_term: orbantiq\n- result: 0 hits\n");
  // An earlier pass's draft and verdict, still where publishing would read them.
  writeFileSync(join(dir, "findings.json"), JSON.stringify({ schema_version: 4, rated_under_framework: "house-default",
    findings: [{ ordinal: 1, mark: "QUILLAMOR" }], coverage: [] }));
  writeFileSync(driverDir(dir, "verdict.json"), JSON.stringify({ verdict: "CONDITIONAL", tier: "High", badge: "l4", statement: "High." }));
  writePartNotCompleted(dir, "assessment", { stage: "synthesis", reason: "timeout" });
  writeFileSync(driverDir(dir, "not-completed", "assessment-coverage.json"), JSON.stringify({ rows: [
    { area: "Main register sweep / worldwide", state: "confirmed-clean", note: "paged to completion" },
    { area: "Field-size count", state: "not-searched", note: "not opened" },
    { area: "", state: "open", note: "an unnamed row is dropped" },
    { area: "Something", state: "clean-ish", note: "an unknown state is dropped" }] }));
  const pool = mkdtempSync(join(tmpdir(), "part-not-completed-pool-"));
  t.after(() => rmSync(pool, { recursive: true, force: true }));
  const { publishReport } = await import("../publish/index.mjs");
  const res = await publishReport({ runId: "open", codename: "x", reportMd: join(dir, "report.md"), auditMd: join(dir, "audit.md"),
    findingsJson: join(dir, "findings.json"), poolRoot: pool, poolUrl: "https://trademark.test", customerKey: "generic", runDir: dir, skipRegen: true });
  const meta = JSON.parse(readFileSync(join(pool, "open", "meta.json"), "utf8"));
  assert.equal(meta.assessment, "not-completed");
  for (const k of ["overall", "badge", "statement", "review"]) assert.equal(meta[k], undefined, `meta.json carries ${k} from an earlier pass`);
  const data = JSON.parse(readFileSync(join(pool, "open", "report-data.json"), "utf8"));
  assert.equal(data.rating, null, "the earlier verdict reached the data file");
  assert.deepEqual(data.findings, [], "the earlier draft's finding reached the data file");
  const html = readFileSync(join(pool, "open", "report.html"), "utf8");
  assert.ok(!html.includes("QUILLAMOR"), "the earlier draft's finding reached the page");
  assert.ok(!html.includes('class="tb-risk"') && !html.includes('class="panel gauge"'), "the page draws a rating");
  assert.ok(html.includes("Field-size count"), "the delivery's coverage rows did not reach the page");
  assert.ok(res.auditFile, `the workbook was not built: ${res.auditError ?? ""}`);
  assert.ok(!(res.counts?.gateViolations ?? []).some((v) => /Verdict/.test(v)), `the workbook's own check wants a verdict: ${JSON.stringify(res.counts?.gateViolations)}`);
});

test("with no write-up ledger, the delivery's coverage rows come from the driver's coverage form: ruled rows keep their status, the rest are open", (t) => {
  const dir = runDir(t);
  writeFileSync(coverageFormPaths(dir).sidecar, JSON.stringify({ rows: [
    { axis: "primary-sweep", unit: "primary-sweep / worldwide", status: "confirmed-clean", reason: "paged to completion" },
    { axis: "saturation-probe", unit: "saturation-probe", open: true },
    { axis: "incumbent-class", unit: "incumbent-class", kind: "family" }] }));
  const rows = assessmentCoverageOfRun(dir);
  assert.deepEqual(rows.map((r) => r.state), ["open", "open"], `the form's rows were read wrong: ${JSON.stringify(rows)}`);
  assert.deepEqual(rows.map((r) => r.note), [plainDeferralReason("unfinished"), plainDeferralReason("unfinished")],
    "an open row does not carry the shipped gap reason, or carries the write-up's words");
  assert.ok(rows.every((r) => !/primary-sweep|saturation-probe/.test(r.area)), `an engine axis name reached a reader's row: ${JSON.stringify(rows)}`);
  // A saved ledger is the write-up's own record and wins over the form.
  writeFileSync(join(dir, "register-coverage-ledger.json"), JSON.stringify([{ axis: "primary-sweep", scope: "worldwide", status: "coverage-limited", reason: "counted" }]));
  assert.deepEqual(assessmentCoverageOfRun(dir).map((r) => r.state).filter((s) => s !== "not-searched"), ["coverage-limited"], "the saved ledger did not win over the form");
});

test("the coverage form's rows are relabelled as every ledger is, and the floor's last resort is held to the assessment", (t) => {
  const dir = runDir(t);
  const rows = [{ axis: "primary-sweep", status: "confirmed-clean", unit: "primary-sweep / worldwide", reason: "paged" }];
  writeFileSync(join(dir, "register-coverage-ledger.json"), JSON.stringify([{ axis: "primary-sweep", scope: "worldwide", status: "confirmed-clean", reason: "paged" }]));
  assert.deepEqual(relabelCoverageRows(dir, rows).map((r) => r.status), loadCoverageLedger(dir).rows.map((r) => r.status), "the two sources are relabelled differently");
  // The run reaches this only with no ruled row in either render and none in the form: no verdict can ship over coverage
  // nobody read, and the failure is the assessment's, so the run delivers without it instead of ending.
  const src = readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");
  const at = src.indexOf('event: "coverage-ledger-from-form"');
  assert.ok(at > 0, "the form fallback is gone");
  const tail = src.slice(at, src.indexOf("\n      }\n", at));
  assert.match(tail, /throw Object\.assign\(new StageFailure\("coverage-ledger",[\s\S]*\{ notCompletedPart: "assessment" \}\);/,
    "a coverage floor with nothing to read ends the run instead of delivering without the assessment");
});
