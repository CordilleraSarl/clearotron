// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the real publisher over copies of two committed demos, and reads the workbook it wrote
//
// THE WORKBOOK'S REGISTER ROWS ARE HEADED BY THE SERVICE'S REACH (owner, 2026-11-18). The head of the register rows
// on "What was searched" read "vendor register, worldwide" on every run, while the coverage line now states the
// service and how many offices it searched. The head states the same reach, read from the answer the run recorded
// with its coverage line, so the two cannot disagree: "Signa, 15 offices", and "1 office" for one. A run that
// recorded no reach (a service with no office list, or a run from before the record) keeps the head it always had.
// An order that names its countries reads "REGISTER" alone, and its rows say where (owner, 2026-11-19). The
// Summary's Register coverage row prints the coverage line itself, word for word.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";
// SAFETY: driver.config reads env at module load and its pool-root default is the real archive. Pin first.
const ROOT = mkdtempSync(join(tmpdir(), "register-head-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || join(ROOT, "ws"));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool-default"));
pinEnv(process.env, "CLEAROTRON_REPORTS_URL", envFrom(process.env, "CLEAROTRON_REPORTS_URL") || "https://trademark.test");
pinEnv(process.env, "CLEAROTRON_DATABASE", "corsearch");
delete process.env.CLEAROTRON_MCP_URL;

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { driverDir } from "../../shared/driver-dir.mjs";

const { publishReport } = await import("../publish/index.mjs");
const { searchRows } = await import("../publish/xlsx.mjs");
const { WORKBOOK: W } = await import("../publish/strings.mjs");
after(() => rmSync(ROOT, { recursive: true, force: true }));

const demo = (name) => join(import.meta.dirname, "..", "..", "demo", name, "run");
const WORLDWIDE = demo("global-preliminary-search");   // a worldwide order
const NAMED = demo("full-country-search");             // an order for named countries: Japan, and the international register
const LINE = "Class 9: searched · registers: Signa, 15 offices; Japan, the Philippines, Indonesia and Vietnam not covered";

let seq = 0;
/** Publish a copy of the demo with `facts` as its scope facts (none when null) and `line` as its coverage line (the
 * demo's own when null), and read two sheets back. */
async function publish(facts, line = null, from = WORLDWIDE) {
  const tag = `v${++seq}`;
  const runDir = join(ROOT, `run-${tag}`);
  cpSync(from, runDir, { recursive: true });
  mkdirSync(driverDir(runDir), { recursive: true });
  if (facts) writeFileSync(driverDir(runDir, "scope-facts.json"), JSON.stringify(facts));
  if (line) {
    const md = readFileSync(join(runDir, "report.md"), "utf8");
    assert.match(md, /^coverage_line: .*$/m, "the demo's front matter has no coverage line to replace");
    writeFileSync(join(runDir, "report.md"), md.replace(/^coverage_line: .*$/m, `coverage_line: ${line}`));
  }
  const poolRoot = join(ROOT, `pool-${tag}`);
  mkdirSync(poolRoot, { recursive: true });
  const runId = `tmp1340-2026-11-19-${tag}`;
  await publishReport({ runId, codename: tag, runDir, poolRoot, poolUrl: "https://trademark.test", customerKey: "harbour",
    skipRegen: true, reportMd: join(runDir, "report.md"), auditMd: join(runDir, "audit.md"), findingsJson: join(runDir, "findings.json") });
  const out = join(poolRoot, runId);
  const book = readdirSync(out).find((f) => f.endsWith("-audit.xlsx"));
  assert.ok(book, "the publish built no workbook");
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(join(out, book));
  const cells = (name) => { const rows = []; wb.getWorksheet(name)?.eachRow((row) => rows.push(row.values.slice(1).map((v) => (v == null ? "" : String(v))))); return rows; };
  return { searched: cells("What was searched"), summary: cells("Summary") };
}
const heads = (r) => r.searched.filter((row) => row[1]?.startsWith("REGISTER")).map((row) => row[1]);

test("a recorded reach heads the register rows with the service and its office count, beside the line that states it", async () => {
  const r = await publish({ coverage_line: LINE, register_reach: { service: "Signa", offices: 15, uncovered: ["JP", "PH", "ID", "VN"] } }, LINE);
  assert.deepEqual(heads(r), ["REGISTER  —  Signa, 15 offices"]);
  assert.equal(r.searched[1][1], "REGISTER  —  Signa, 15 offices", "the head is the sheet's second row");
  assert.deepEqual(r.summary.find((row) => row[0] === W.summary.registerCoverage), [W.summary.registerCoverage, LINE]);
  assert.equal(r.summary.findIndex((row) => row[0] === W.summary.registerCoverage), 6, "the line is the Summary's seventh row");
});

test("a worldwide run with no recorded reach keeps the head it always had", async () => {
  assert.deepEqual(heads(await publish(null)), [W.registerSection], "a run from before the record");
  assert.deepEqual(heads(await publish({ coverage_line: "Class 9: searched · registers: worldwide (Corsearch)" })), [W.registerSection],
    "a service that declares no office list records no reach");
  assert.deepEqual(heads(await publish({ register_reach: { service: "Signa", offices: 0, uncovered: [] } })), [W.registerSection],
    "a reach the record cannot state is no reach");
});

test("an order for named countries heads its register rows REGISTER, and a worldwide one beside it keeps its reach", async () => {
  assert.deepEqual(heads(await publish(null, null, NAMED)), [W.registerSectionNamed]);
  assert.equal(W.registerSectionNamed, "REGISTER");
  assert.deepEqual(heads(await publish({ register_reach: { service: "Signa", offices: 15, uncovered: [] } })), ["REGISTER  —  Signa, 15 offices"]);
});

test("one office reads as one", () => {
  const audit = { negatives: [{ search_term: "TARNELLO", source_layer: "Register", result: "0" }] };
  const head = (registerReach) => searchRows(audit, { registerReach })[0]["Search term / variant"];
  assert.equal(head({ service: "EUIPO", offices: 1 }), "REGISTER  —  EUIPO, 1 office");
  assert.equal(head({ service: "Clarivate", offices: 186 }), "REGISTER  —  Clarivate, 186 offices");
  assert.equal(head(null), W.registerSection);
});
