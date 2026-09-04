// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// gate-metrics documentGrowth (PR compute-don't-author) — the document-growth aggregate read off the
// append-only run.jsonl spine. Synthetic run dirs, structure-copied from the real event SHAPES only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { tmpdir } from "node:os";
import { documentGrowth } from "../gate-metrics.mjs";

const mkRun = (lines) => {
  const dir = mkdtempSync(join(tmpdir(), "gm-growth-"));
  mkdirSync(driverDir(dir), { recursive: true });
  writeFileSync(driverDir(dir, "run.jsonl"), lines.map((o) => JSON.stringify(o)).join("\n") + "\n");
  return dir;
};

test("documentGrowth: aggregates document-growth-trip events by trigger; other events and torn lines never count", () => {
  const dir = mkRun([
    { ts: "t1", event: "stage", stage: "synthesis", trigger: "fresh", ok: true },
    { ts: "t2", event: "document-growth-trip", stage: "report-overview", trigger: "lint-repair", before: 8175, after: 57802, growthBytes: 49627, growthPct: 607 },
    { ts: "t3", event: "document-growth-trip", stage: "narrative-refutation", trigger: "corrective", before: 62898, after: 102113, growthBytes: 39215, growthPct: 62 },
    { ts: "t4", event: "document-growth-trip", stage: "report-overview", trigger: "lint-repair", before: 10053, after: 61226, growthBytes: 51173, growthPct: 509 },
  ]);
  // append a torn line (a crash mid-append) — must neither throw nor count
  writeFileSync(driverDir(dir, "run.jsonl"), '{"ts":"t5","event":"document-growth-trip","stage":"cli', { flag: "a" });
  const g = documentGrowth(dir);
  assert.equal(g.count, 3);
  assert.deepEqual(g.byTrigger, { "lint-repair": 2, corrective: 1 }, "BOTH growth loops are visible, keyed on trigger");
  assert.equal(g.maxGrowthPct, 607);
  assert.deepEqual(g.stages.sort(), ["narrative-refutation", "report-overview"]);
});

test("documentGrowth: a run with no trips (every legacy run) returns null; a missing spine returns null", () => {
  assert.equal(documentGrowth(mkRun([{ ts: "t", event: "stage", stage: "synthesis", ok: true }])), null);
  assert.equal(documentGrowth(join(tmpdir(), "gm-growth-nonexistent")), null);
});
