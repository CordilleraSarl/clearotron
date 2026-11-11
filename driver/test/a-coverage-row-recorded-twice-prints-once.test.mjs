// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the real clearance publisher and reads what it wrote into the pool
//
// A COVERAGE ROW RECORDED TWICE PRINTS ONCE.
//
// Measured on the full country demo, 2026-11-11: its record carries one Japanese spelling's coverage row twice, area,
// state and note all equal, and the report listed it twice. Design ruled the same day that only the same recorded item
// repeated is folded; rows that differ in any part stand, however alike they read.
//
// SAFETY: driver.config reads env at module load and its pool-root default is the real archive, so the
// env is pinned before any product module is imported.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";
const ROOT = mkdtempSync(join(tmpdir(), "coverage-once-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || join(ROOT, "ws"));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool-default"));
pinEnv(process.env, "CLEAROTRON_REPORTS_URL", envFrom(process.env, "CLEAROTRON_REPORTS_URL") || "https://trademark.test");
pinEnv(process.env, "CLEAROTRON_DATABASE", "corsearch");
import { test } from "node:test";
import assert from "node:assert/strict";
import { driverDir } from "../../shared/driver-dir.mjs";
const { publishReport, withoutRepeatedRows } = await import("../publish/index.mjs");

const ROW = { area: "register / Japanese form キルメア", state: "not-searched",
  note: "This Japanese spelling could not be searched because the register indexes non-Latin marks by transliteration." };

test("an exact repeat goes and the first stays in place; a row differing in area, state or note stands", () => {
  const other = { area: "primary-sweep", state: "confirmed-clean", note: "Searched." };
  assert.deepEqual(withoutRepeatedRows([ROW, other, { ...ROW }]), [ROW, other]);
  const alike = [ROW, { ...ROW, note: `${ROW.note} ` }, { ...ROW, state: "coverage-limited" }, { ...ROW, area: `${ROW.area} [cl 9]` }];
  assert.equal(withoutRepeatedRows(alike).length, 4, "rows that only read alike were folded");
  assert.equal(withoutRepeatedRows(undefined), undefined, "an absent list is passed through, not invented");
});

test("a published clearance whose record repeats one coverage row carries it once", async () => {
  const runDir = join(ROOT, "run");
  mkdirSync(driverDir(runDir), { recursive: true });
  writeFileSync(join(runDir, "status.json"), JSON.stringify({ runId: "fixture-once", markName: "QUILLMERE" }));
  writeFileSync(join(runDir, "report.md"), "# Clearance report\n\nBody text.\n");
  writeFileSync(join(runDir, "findings.json"), JSON.stringify({ schema_version: 6, rated_under_framework: "house-default", findings: [], coverage: [ROW, ROW] }));
  writeFileSync(driverDir(runDir, "profile.json"), JSON.stringify({ key: "once-key" }));
  const poolRoot = join(ROOT, "pool");
  mkdirSync(poolRoot, { recursive: true });
  const runId = "tmp0775-2026-11-11-once";
  await publishReport({ runId, codename: "once", runDir, poolRoot, poolUrl: "https://trademark.test", customerKey: "once-key",
    skipRegen: true, reportMd: join(runDir, "report.md"), findingsJson: join(runDir, "findings.json") });
  const data = JSON.parse(readFileSync(join(poolRoot, runId, "report-data.json"), "utf8"));
  const rows = JSON.stringify(data).split("キルメア").length - 1;
  assert.equal(rows, 1, `the repeated row reached the data file ${rows} times`);
  const html = readFileSync(join(poolRoot, runId, "report.html"), "utf8");
  assert.equal(html.split("キルメア").length - 1, 1, "the repeated row reached the report more than once");
});
