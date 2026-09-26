// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the real publisher over copies of the committed full country demo, and reads what it wrote
//
// A STORE LOST WHERE ONLY THE PUBLISHER SEES IT IS IN THE AUDIT WORKBOOK (ruled 2026-09-25). A store that is
// present and unreadable when the report is published, or one delivery read and a republish finds missing,
// used to read exactly as a run that never had it: the part it feeds was simply absent. It is now a row on
// Coverage & gaps in the shipped deferral row's words, its raw cause goes to meta.json and the run log, and
// the report is unchanged. An older run, which has no record of what delivery read, republishes as before.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";
// SAFETY: driver.config reads env at module load and its pool-root default is the real archive. Pin first.
const ROOT = mkdtempSync(join(tmpdir(), "store-at-publish-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || join(ROOT, "ws"));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool-default"));
pinEnv(process.env, "CLEAROTRON_REPORTS_URL", envFrom(process.env, "CLEAROTRON_REPORTS_URL") || "https://trademark.test");
pinEnv(process.env, "CLEAROTRON_DATABASE", "corsearch");
delete process.env.CLEAROTRON_MCP_URL;

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { driverDir } from "../../shared/driver-dir.mjs";

const { publishReport } = await import("../publish/index.mjs");
const { writeDegradedParts, PART_NAMES, RULED_WORDS } = await import("../degraded-parts.mjs");
after(() => rmSync(ROOT, { recursive: true, force: true }));

const DEMO = join(import.meta.dirname, "..", "..", "demo", "full-country-search", "run");

let seq = 0;
/** Publish a copy of the demo, changed only by `mutate`, and read the gaps sheet, meta.json and the run log. */
async function publish(mutate = () => {}) {
  const tag = `v${++seq}`;
  const runDir = join(ROOT, `run-${tag}`);
  cpSync(DEMO, runDir, { recursive: true });
  mkdirSync(driverDir(runDir), { recursive: true });
  mutate(runDir);
  const poolRoot = join(ROOT, `pool-${tag}`);
  mkdirSync(poolRoot, { recursive: true });
  const runId = `tmp0941-2026-09-25-${tag}`;
  await publishReport({ runId, codename: tag, runDir, poolRoot, poolUrl: "https://trademark.test", customerKey: "harbour",
    skipRegen: true, reportMd: join(runDir, "report.md"), findingsJson: join(runDir, "findings.json") });
  const out = join(poolRoot, runId);
  const book = readdirSync(out).find((f) => f.endsWith("-audit.xlsx"));
  assert.ok(book, "the publish built no workbook");
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(join(out, book));
  const gaps = [];
  wb.getWorksheet("Coverage & gaps")?.eachRow((row) => gaps.push(row.values.slice(1).map((v) => (v == null ? "" : String(v)))));
  const events = readFileSync(driverDir(runDir, "run.jsonl"), "utf8").split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  return { gaps, meta: JSON.parse(readFileSync(join(out, "meta.json"), "utf8")), html: readFileSync(join(out, "report.html"), "utf8"),
    events: events.filter((e) => e.event === "degraded-parts-at-publish") };
}
// The rows a part writes, by its name. The demo carries follow-up rows of its own, which are not these.
const PART_AREAS = new Set([...Object.values(PART_NAMES), RULED_WORDS.officialRecords].map((n) => `Follow-up / ${n}`));
const followUps = (r) => r.gaps.filter((g) => PART_AREAS.has(g[0]));

test("a store present and unreadable at publish is a row, with its cause in meta.json and the run log", async () => {
  const r = await publish((dir) => writeFileSync(driverDir(dir, "verdict.json"), "{not json"));
  const row = r.gaps.find((g) => g[0] === "Follow-up / Conditions");
  assert.ok(row, `no row for the unreadable verdict: ${JSON.stringify(followUps(r))}`);
  assert.deepEqual(row.slice(1, 4), ["Open", "Conditions",
    "not completed this run — it could not be completed this run, so it is left open here rather than reported as clean"],
    `the row is not the shipped deferral row: ${JSON.stringify(row)}`);
  assert.deepEqual(r.meta.degradedAtPublish?.map((d) => d.part), ["store:_driver/verdict.json"]);
  assert.equal(r.events.length, 1, "the run log does not record the part publishing found");
  assert.ok(!JSON.stringify(row).includes("not json"), "the raw cause reached a cell");
});

test("a store delivery read and a republish finds missing is a row", async () => {
  const r = await publish((dir) => {
    writeDegradedParts(dir, []);   // delivery's record: every store as it found them
    rmSync(join(dir, "case-law-findings.md"));
  });
  assert.ok(r.gaps.some((g) => g[0] === "Follow-up / Court decisions"), `no row for the lost case-law file: ${JSON.stringify(followUps(r))}`);
  assert.deepEqual(r.meta.degradedAtPublish?.map((d) => d.cause), ["case-law-findings.md was read at delivery and is missing now"]);
});

test("THE CONTROLS: the demo as committed, and a store it never had, publish the workbook they published before", async () => {
  const asIs = await publish();
  assert.deepEqual(followUps(asIs), [], "the committed demo gained a row");
  assert.equal(asIs.meta.degradedAtPublish, undefined, "meta.json gained a field on a run with nothing to record");
  assert.equal(asIs.events.length, 0);
  // Absent, with no delivery record to say it was ever there: an older run, never a loss.
  const absent = await publish((dir) => rmSync(driverDir(dir, "verdict.json")));
  assert.deepEqual(followUps(absent), []);
  assert.equal(absent.meta.degradedAtPublish, undefined);
});
