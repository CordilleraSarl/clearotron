// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — loads the pipeline module
//
// A PASS THAT SETTLES NO COVERAGE ROWS LEAVES NO EARLIER PASS'S LEDGER BEHIND.
//
// Step 3 settles the coverage form from the facts and derives the machine ledger every coverage reader takes
// from it. A pass whose form carried no rows returned early and left the previous pass's ledger on disk, so
// the verdict clamp, synthesis's coverage table and the workbook went on reading statuses this pass no longer
// stood behind. Driven through the settle function itself on a run directory holding only an old ledger.
//
// SAFETY: driver.config freezes its roots at first import, so they are pinned to a throwaway root before the
// pipeline module loads.
import { mkdtempSync as __mkdtemp } from "node:fs";
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { envFrom, pinEnv } from "../../shared/env-aliases.mjs";
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || __mkdtemp(__join(__tmpdir(), "clearotron-testroot-")));
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";

test("a pass with no coverage rows removes the previous pass's machine ledger and says so", async () => {
  const { settleCoverageFromFacts } = await import("../pipeline.mjs");
  const { paths } = await import("../stages.mjs");
  const dir = mkdtempSync(join(tmpdir(), "stale-ledger-"));
  mkdirSync(driverDir(dir), { recursive: true });
  const P = paths(dir);
  // The ledger an earlier pass derived: one axis read clean.
  writeFileSync(P.registerCoverageLedger, JSON.stringify([{ axis: "primary-sweep", scope: "", status: "confirmed-clean", reason: "" }]));
  settleCoverageFromFacts({ paths: P }, "stale-repair");
  assert.equal(existsSync(P.registerCoverageLedger), false, "the earlier pass's ledger is still on disk for every coverage reader");
  const events = readFileSync(driverDir(dir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(events.some((e) => e.event === "coverage-ledger-removed"), "the removal is not recorded in the run log");
});
