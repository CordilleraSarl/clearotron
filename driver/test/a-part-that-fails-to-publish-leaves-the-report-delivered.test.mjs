// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A PART THAT FAILS TO PUBLISH LEAVES THE REPORT DELIVERED, AND NOTHING CLAIMS THE PART.
//
// Both publishers answer alike since the design ruling of 2026-11-10. A workbook that cannot be built, or a data file that
// cannot be written, leaves the report in place, and neither meta.json, the data file, the email nor the run's own summary
// names the missing file. Before, a Knockout stopped on either, so a client got no report at all.
//
// Each arm copies a demo run, puts a directory where one part's file goes so that its write throws, publishes the copy the
// way the portal's republish does, and opens every report the way the portal resolves it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";

const ROOT = mkdtempSync(join(tmpdir(), "part-fails-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || join(ROOT, "ws"));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool-default"));
pinEnv(process.env, "CLEAROTRON_REPORTS_URL", envFrom(process.env, "CLEAROTRON_REPORTS_URL") || "https://trademark.test");

const { republishRun } = await import("../publish/report-registry.mjs");
const { composeEmailHtml } = await import("../publish/index.mjs");
const { composeKnockoutEmail } = await import("../publish/knockout.mjs");
const { refreshStaffPages } = await import("../publish/shell.mjs");
const { readReport, reportsOf, resolveReportFile } = await import("../portal-report.mjs");
const { worstBand } = await import("../verify-knockout.mjs");

const DEMO = fileURLToPath(new URL("../../demo/", import.meta.url));
const URL_ROOT = "https://trademark.test";
let n = 0;

/** Publish a copy of a demo run with a directory where each of `blocked(meta)` goes, after `prepare(runDir)`. */
async function publishWith(demo, { blocked = () => [], prepare = () => {} } = {}) {
  const copy = join(ROOT, `run-${++n}`);
  cpSync(join(DEMO, demo), copy, { recursive: true });
  const meta = JSON.parse(readFileSync(join(copy, "meta.json"), "utf8"));
  const runDir = join(copy, "run");
  prepare(runDir);
  const pool = join(ROOT, `pool-${n}`);
  const poolRunDir = join(pool, meta.runId);
  for (const name of blocked(meta)) mkdirSync(join(poolRunDir, name), { recursive: true });
  const published = await republishRun({ runId: meta.runId, meta, pool, poolUrl: URL_ROOT, runDir, skipRegen: true });
  return { published, poolRunDir, runDir, meta: JSON.parse(readFileSync(join(poolRunDir, "meta.json"), "utf8")) };
}

const isFile = (p) => existsSync(p) && statSync(p).isFile();
const logged = (runDir, event) => {
  const log = driverDir(runDir, "run.jsonl");
  return existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.event === event) : [];
};

/** Every report the meta lists resolves and opens as a page, as the portal serves it. */
function opensEveryReport(poolRunDir, meta) {
  const listed = reportsOf(meta);
  for (const r of listed) {
    const file = resolveReportFile(meta, listed.length > 1 ? r.slug : null);
    assert.ok(file && isFile(join(poolRunDir, file)), `${r.mark ?? "the report"} resolves to no file on disk`);
    const page = readReport(poolRunDir, { file });
    assert.match(page, /<body[\s>]/i, `${file} does not open as a page`);
    if (r.mark) assert.ok(page.includes(r.mark), `${file} does not name ${r.mark}`);
  }
  return listed.length;
}

/** Every data file meta.json names is a file on disk. */
function claimsOnlyWhatExists(poolRunDir, meta) {
  for (const r of meta.reports ?? []) if (r.dataFile) assert.ok(isFile(join(poolRunDir, r.dataFile)), `meta names ${r.dataFile}, which is not there`);
  if (meta.auditFile) assert.ok(isFile(join(poolRunDir, meta.auditFile)), `meta names ${meta.auditFile}, which is not there`);
}

/** A second name for the demo Knockout, so it publishes as a batch: an invented name, the first name's research copied. */
function addSecondName(runDir) {
  const second = "CLUVENDRA";
  for (const file of ["knockout-findings.json", "knockout-plan.json"]) {
    const doc = JSON.parse(readFileSync(join(runDir, file), "utf8"));
    doc.marks.push({ ...structuredClone(doc.marks[0]), name: second });
    if (doc.batch?.executionOrder) doc.batch.executionOrder.push(second);
    writeFileSync(join(runDir, file), JSON.stringify(doc, null, 2));
  }
  cpSync(join(runDir, "research", "venqori.md"), join(runDir, "research", "cluvendra.md"));
}

const knockoutEmail = (runDir, published) => {
  const findings = JSON.parse(readFileSync(join(runDir, "knockout-findings.json"), "utf8"));
  const framework = JSON.parse(readFileSync(driverDir(runDir, "framework.json"), "utf8"));
  return composeKnockoutEmail({ findings, framework, overall: worstBand(framework, findings.marks), reports: published.reports, auditUrl: published.auditUrl, job: {} });
};

test("a clearance whose workbook cannot be built is delivered, and nothing names the workbook", async () => {
  const workbook = (meta) => `${meta.runId}-audit.xlsx`;
  const { published, poolRunDir, runDir, meta } = await publishWith("full-country-search", { blocked: (m) => [workbook(m)] });
  assert.equal(opensEveryReport(poolRunDir, meta), 1);
  assert.equal(published.auditFile, null);
  assert.ok(published.auditError, "the result says why there is no workbook");
  assert.equal(meta.auditFile, null, "meta.json names no workbook");
  assert.ok(meta.auditError, "meta.json says why there is no workbook");
  assert.equal(JSON.parse(readFileSync(join(poolRunDir, "report-data.json"), "utf8")).auditFile, null, "the data file names no workbook");
  assert.doesNotMatch(composeEmailHtml(join(runDir, "report.md"), published.url, published.auditFile), /Download audit/, "the email offers no workbook");
  claimsOnlyWhatExists(poolRunDir, meta);
  assert.equal(logged(runDir, "workbook-not-built").length, 1, "the run records the failure");
});

test("a clearance whose data file cannot be written is delivered, and meta.json claims no data file", async () => {
  const { poolRunDir, runDir, meta } = await publishWith("full-country-search", { blocked: () => ["report-data.json"] });
  assert.equal(opensEveryReport(poolRunDir, meta), 1);
  assert.equal(meta.reportSchema, undefined, "meta.json claims no data file");
  assert.ok(meta.auditFile && isFile(join(poolRunDir, meta.auditFile)), "control: the part that could be written was");
  assert.equal(logged(runDir, "data-file-not-written").length, 1, "the run records the failure");
});

test("a clearance whose findings.json cannot be kept in the pool is delivered with its findings, and its results are not called unreadable", async () => {
  const { published, poolRunDir, runDir, meta } = await publishWith("full-country-search", { blocked: () => ["findings.json"] });
  assert.equal(opensEveryReport(poolRunDir, meta), 1);
  assert.ok(!isFile(join(poolRunDir, "findings.json")), "premise: the copy could not be written");
  assert.equal(published.findingsError, null, "the findings were read, so no read error is reported");
  assert.ok(!published.clientGate.reasons.some((r) => /could not be read back/.test(r)), "the machine checks do not record the results as unreadable");
  assert.ok(JSON.parse(readFileSync(join(poolRunDir, "report-data.json"), "utf8")).findings.length > 0, "the report carries the findings it read");
  assert.deepEqual(logged(runDir, "data-file-not-written").map((r) => r.file), ["findings.json"], "the run records the copy that failed");
});

test("a Knockout whose workbook cannot be built delivers its report, and nothing names the workbook", async () => {
  const { published, poolRunDir, runDir, meta } = await publishWith("knockout-search", {
    blocked: (m) => [`knockout-audit-${m.codename || m.runId}.xlsx`],
  });
  assert.equal(opensEveryReport(poolRunDir, meta), 1);
  assert.equal(published.auditFile, null);
  assert.equal(published.auditUrl, null, "no link to a workbook is composed");
  assert.equal(meta.auditFile, null, "meta.json names no workbook");
  assert.ok(meta.auditError, "meta.json says why there is no workbook");
  assert.equal(JSON.parse(readFileSync(join(poolRunDir, "report-data.json"), "utf8")).auditFile, null, "the data file names no workbook");
  assert.doesNotMatch(readFileSync(join(poolRunDir, "report.md"), "utf8"), /audit workbook/, "the run's summary names no workbook");
  assert.doesNotMatch(knockoutEmail(runDir, published), /audit workbook/, "the email offers no workbook");
  assert.equal(meta.reportSchema, "report-data/1", "control: the data file was written and is claimed");
  claimsOnlyWhatExists(poolRunDir, meta);
  assert.equal(logged(runDir, "workbook-not-built").length, 1, "the run records the failure");
});

test("a Knockout batch with one data file that cannot be written delivers both reports and claims only the data file that exists", async () => {
  const whole = await publishWith("knockout-search", { prepare: addSecondName });
  assert.equal(opensEveryReport(whole.poolRunDir, whole.meta), 2, "premise: the copy publishes as a batch of two");
  assert.deepEqual(whole.meta.reports.map((r) => r.dataFile), ["report-data-venqori.json", "report-data-cluvendra.json"]);
  assert.equal(whole.meta.reportSchema, "report-data/1", "control: with both written, both are claimed");

  const { published, poolRunDir, runDir, meta } = await publishWith("knockout-search", { prepare: addSecondName, blocked: () => ["report-data-cluvendra.json"] });
  assert.equal(opensEveryReport(poolRunDir, meta), 2, "both names' reports open");
  assert.deepEqual(meta.reports.map((r) => [r.mark, r.dataFile]), [["VENQORI", "report-data-venqori.json"], ["CLUVENDRA", null]],
    "the name whose data file failed carries no data-file claim, and the other keeps its own");
  assert.deepEqual(published.reports.map((r) => r.dataFile), ["report-data-venqori.json", null]);
  assert.equal(meta.reportSchema, undefined, "the run does not claim a data file for every name");
  assert.ok(meta.auditFile && isFile(join(poolRunDir, meta.auditFile)), "control: the workbook was built");
  claimsOnlyWhatExists(poolRunDir, meta);
  assert.deepEqual(readdirSync(poolRunDir).filter((f) => /^report-data/.test(f) && isFile(join(poolRunDir, f))), ["report-data-venqori.json"]);
  assert.deepEqual(logged(runDir, "data-file-not-written").map((r) => r.file), ["report-data-cluvendra.json"], "the run records which one failed");
});

test("a staff-page refresh that fails is recorded after the report is in place, and never thrown", async () => {
  const runDir = join(ROOT, "staff-pages");
  mkdirSync(driverDir(runDir), { recursive: true });
  const failing = async () => { throw new Error("staff index not writable"); };
  assert.equal(await refreshStaffPages({ regenSurfaces: failing, poolRoot: ROOT, skipRegen: false, runDir }), "staff index not writable");
  assert.deepEqual(logged(runDir, "staff-pages-not-refreshed").map((r) => r.error), ["staff index not writable"]);

  let called = 0;
  assert.equal(await refreshStaffPages({ regenSurfaces: async () => { called++; }, poolRoot: ROOT, skipRegen: false, runDir }), null);
  assert.equal(await refreshStaffPages({ regenSurfaces: async () => { called++; }, poolRoot: ROOT, skipRegen: true, runDir }), null);
  assert.equal(called, 1, "a refresh runs when asked for and not when skipped");
});
