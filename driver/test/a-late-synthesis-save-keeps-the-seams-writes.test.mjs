// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the mock pipeline from intake to a delivered packet, twice
//
// A SYNTHESIS SAVE AFTER THE SEAM KEEPS THE SEAM'S WRITES.
//
// The seam writes into findings.json what only the driver knows: the coverage-judgment rows derived from the
// ledger and the plan receipt, the coverage rows it injects for what did not run, and the fold. A synthesis
// save rewrites findings.json from the seat's own call, so a save after the seam, the pre-delivery narrative
// redo or the in-pass stale repair, delivered the record without them: no coverage-judgment rows in the
// delivered record, none in the pool copy, and no "slices considered" block in the audit workbook. The seam's
// writes now run again after such a save, before anything downstream reads the record.
//
// Driven through the mock pipeline: a control run with no late save, and a run whose narrative breaks the
// pre-delivery lint after the cards, so the narrative redo saves synthesis late. The premises are asserted
// first: a run that never saved late proves nothing.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, readdirSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";

const TEMP_DIRS = [];
const tempDir = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); TEMP_DIRS.push(d); return d; };
after(() => { for (const d of TEMP_DIRS) rmSync(d, { recursive: true, force: true }); });

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
pinEnv(process.env, "CLEAROTRON_REPORTS_URL", envFrom(process.env, "CLEAROTRON_REPORTS_URL") || "https://trademark.test");
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";

const JOB = {
  id: "test-job", msgId: "<test@x>", forwarder: "requester", forwarderDomain: "example.com",
  ref: "TMP8443", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch",
};
const MOCK_KNOBS = ["MOCK_VERDICT", "MOCK_SKEPTIC", "MOCK_NARRATIVE_OVER_CAP", "MOCK_COVERAGE_INSUFFICIENT", "MOCK_PLAN_DEFERRED"];

const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });

async function deliver(overCap) {
  const root = tempDir("clearotron-late-save-");
  for (const k of MOCK_KNOBS) delete process.env[k];
  for (const [k, v] of Object.entries({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root,
    CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0",
    MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", ...(overCap ? { MOCK_NARRATIVE_OVER_CAP: "1" } : {}),
    MOCK_COVERAGE_INSUFFICIENT: "1", MOCK_PLAN_DEFERRED: "+merch" })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB });
  for (const k of MOCK_KNOBS) delete process.env[k];
  const dir = res.archiveDir ?? res.runDir;
  const events = readFileSync(driverDir(dir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

  const stampIdx = events.findIndex((e) => e.event === "coverage-judgment-rows");
  const stamp = events[stampIdx];
  const firstCard = events.findIndex((e) => e.event === "stage" && /^report-card:\d+$/.test(String(e.stage)));
  const synthStages = events.map((e, i) => ({ e, i })).filter(({ e }) => e.event === "stage" && e.stage === "synthesis");
  const lintRepair = synthStages.find(({ e }) => e.trigger === "lint-repair");
  const staleRepair = events.find((e) => e.event === "delivery-stale-repair");
  const doc = JSON.parse(readFileSync(join(dir, "findings.json"), "utf8"));
  const cj = doc.coverage_judgment;

  // what the pool received: the published findings.json copy and the audit workbook
  const pool = join(root, "pool");
  const poolFiles = existsSync(pool) ? walk(pool) : [];
  const poolFindings = poolFiles.find((p) => p.endsWith("/findings.json"));
  const poolCj = poolFindings ? JSON.parse(readFileSync(poolFindings, "utf8")).coverage_judgment : undefined;
  const xlsx = poolFiles.find((p) => p.endsWith(".xlsx"));
  let workbookHasSlices = null;
  if (xlsx) {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(xlsx);
    const s = wb.getWorksheet("Summary");
    let hit = false;
    s?.eachRow((row) => { if (/Coverage judgment — slices considered/.test(String(row.getCell(1).value ?? ""))) hit = true; });
    workbookHasSlices = hit;
  }

  const report = {
    resOk: res.ok, stampEvent: stamp, stampIdx, firstCardIdx: firstCard,
    synthesisStages: synthStages.map(({ e, i }) => ({ i, trigger: e.trigger, ok: e.ok })),
    lintRepairIdx: lintRepair?.i ?? null, staleRepairStages: staleRepair?.stages ?? null,
    deliveredCj: { sufficient: cj?.sufficient, hasReason: Boolean(cj?.reason), rows: Array.isArray(cj?.rows) ? cj.rows.length : "absent" },
    poolCjRows: poolCj === undefined ? "no pool findings.json" : (Array.isArray(poolCj?.rows) ? poolCj.rows.length : "absent"),
    auditWorkbook: xlsx ? "present" : "absent", workbookHasSlicesBlock: workbookHasSlices,
  };
  // PREMISES — if any fails, the run proves nothing about the claim
  assert.equal(res.ok, true, `premise: the run delivered: ${JSON.stringify(res).slice(0, 300)}`);
  assert.equal(stamp?.changed, true, "premise: the seam stamp wrote rows");
  assert.ok(stamp?.rows > 0, "premise: the stamp derived at least one row");
  if (overCap) assert.ok(firstCard >= 0 && lintRepair && lintRepair.i > firstCard && lintRepair.i > stampIdx,
    "premise: a synthesis lint-repair ran after the stamp and after the first card");
  else assert.ok(!lintRepair, "control premise: no lint-repair synthesis save");
  // What the client receives: the published report pages, read for the coverage rows the seam injects.
  const pages = poolFiles.filter((p) => /report\.(md|html)$/.test(p)).map((p) => readFileSync(p, "utf8")).join("\n");
  const scriptRowsOnPage = (pages.match(/register equivalents/g) ?? []).length;
  return { report, stamp, events, lintRepair, scriptRowsOnPage, coverage: (doc.coverage ?? []).map((c) => String(c.area)).sort() };
}
let control;
test("CONTROL: with no late save, the seam's rows reach the record, the pool copy and the workbook", async () => {
  control = await deliver(false);
  assert.equal(control.report.deliveredCj.rows, control.stamp.rows);
  assert.equal(control.report.poolCjRows, control.stamp.rows);
  assert.equal(control.report.workbookHasSlicesBlock, true);
  // The premise the coverage arm rests on: the seam injected rows a client reads, and they reached the page.
  assert.ok(control.coverage.some((a) => /register equivalents/.test(a)), "premise: the seam injected no coverage row to lose");
  assert.ok(control.scriptRowsOnPage > 0, "premise: the injected rows never reached the published report");
});

test("a narrative redo after the cards keeps the seam's rows and its coverage rows", async () => {
  const late = await deliver(true);
  for (const area of control?.coverage ?? []) assert.ok(late.coverage.includes(area), `a coverage row the seam writes was lost: ${area}`);
  assert.equal(late.scriptRowsOnPage, control.scriptRowsOnPage, "the published report lost coverage rows the seam injects");
  assert.equal(late.report.deliveredCj.rows, late.stamp.rows, "the delivered record lost the coverage-judgment rows to the late save");
  assert.equal(late.report.poolCjRows, late.stamp.rows, "the pool copy lost the coverage-judgment rows");
  assert.equal(late.report.workbookHasSlicesBlock, true, "the audit workbook lost its slices-considered block");
  const reapplied = late.events.findIndex((e) => e.event === "seam-reapplied");
  assert.ok(reapplied > late.lintRepair.i, "the seam's writes did not run again after the late save");
});
