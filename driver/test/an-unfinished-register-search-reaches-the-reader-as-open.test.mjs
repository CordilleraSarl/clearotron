// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A REGISTER SEARCH THE RUN DID NOT COMPLETE REACHES THE READER AS OPEN.
//
// The searches' record names each slice a unit never finished, or whose call never came back, with the line that says
// why. That line reached the register write-up and no reader. Here the workbook's coverage judgment carries each slice
// by its reader name, and the report carries one open row per search and line, in the shipped words, never an id.
// Invented values only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { coverageJudgmentRows, injectSearchesOpenCoverage } from "../coverage-rows-run.mjs";
import { writePartNotCompleted } from "../parts-not-completed.mjs";
import { plainDeferralReason } from "../deferral-row.mjs";
import { paths } from "../run-record.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";

const NOT_LANDED = plainDeferralReason("slice-not-landed");
const LEFT_OPEN = plainDeferralReason("unfinished");
const PLAN = { entries: [
  { axis: "primary-sweep", qid: "primary-sweep:exact:quilvante", term: "QUILVANTE", predicate: "exact", classes: [9] },
  { axis: "primary-sweep", qid: "primary-sweep:default:quilvant", term: "QUILVANT", predicate: "default", classes: [9] },
  { axis: "incumbent-class", qid: "incumbent-class:owner:invented-co", term: "Invented Co", predicate: "owner", classes: [9] },
] };
const RECORD = { slices: [
  { axis: "primary-sweep", qid: "primary-sweep:exact:quilvante", reason: LEFT_OPEN },
  { axis: "primary-sweep", qid: "primary-sweep:default:quilvant", reason: LEFT_OPEN },
  { axis: "incumbent-class", qid: "incumbent-class:owner:invented-co", reason: NOT_LANDED },
] };

test("the workbook's coverage judgment carries each slice by its reader name, with its own line, and never prints an id", () => {
  const rows = coverageJudgmentRows([], { missing: [], skeleton: [] }, PLAN, null, RECORD);
  assert.equal(rows.length, 3, JSON.stringify(rows));
  assert.deepEqual(rows.map((r) => r.note), [`not completed this run — ${LEFT_OPEN}`, `not completed this run — ${LEFT_OPEN}`, `not completed this run — ${NOT_LANDED}`]);
  for (const r of rows) assert.ok(r.areaLabel && !r.areaLabel.includes(r.area), `the row prints an engine id: ${JSON.stringify(r)}`);
  assert.equal(rows[0].areaLabel, "main register search / exact: QUILVANTE");
  assert.deepEqual(coverageJudgmentRows([], { missing: [], skeleton: [] }, PLAN, null, null), [], "a run with no searches' record grew rows");
});

test("the report carries one open row per search and line, by the search's reader name, once", () => {
  const dir = mkdtempSync(join(tmpdir(), "searches-open-"));
  try {
    mkdirSync(driverDir(dir), { recursive: true });
    const P = paths(dir);
    writeFileSync(P.findings, JSON.stringify({ schema_version: 7, rated_under_framework: "house-default", findings: [], coverage: [] }) + "\n");
    writePartNotCompleted(dir, "searches", { slices: RECORD.slices, unfinishedUnits: ["primary-sweep", "incumbent-class"] });
    injectSearchesOpenCoverage(P, dir, () => {});
    const cov = JSON.parse(readFileSync(P.findings, "utf8")).coverage;
    assert.deepEqual(cov.map((c) => [c.area, c.state, c.note]), [
      ["Follow-up / main register search", "open", `main register search — not completed this run — ${LEFT_OPEN}`],
      ["Follow-up / owner portfolio sweep", "open", `owner portfolio sweep — not completed this run — ${NOT_LANDED}`],
    ]);
    injectSearchesOpenCoverage(P, dir, () => {});
    assert.equal(JSON.parse(readFileSync(P.findings, "utf8")).coverage.length, 2, "a second pass added the rows again");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
