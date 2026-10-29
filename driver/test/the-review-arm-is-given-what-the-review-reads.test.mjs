// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A REVIEW ARM IS GIVEN WHAT THE REVIEW READS.
//
// The review is told placement's floor decisions and the writer's declinations when its message is built, from the
// run's files. An `--experiment narrative-refutation` sandbox carried neither the placement form's driver copy nor
// the declination ledger, so on a saved run the arm was told none of placement's decisions and none of the writer's,
// while the review it reproduced was told both (measured 2026-10-29). The sandbox now carries every file those two
// lists read; `sandboxGaps` refuses an arm whose copy lacks one the canonical run holds. An arm reproducing the
// corrective pass is given the state that pass starts from, which it refused for want of on the same run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { paths } from "../stages.mjs";
import { sandboxManifest } from "../stage-context.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";

test("a review arm's sandbox carries placement's form and the writer's declinations, with what they are read against", () => {
  const P = paths("/run");
  const held = new Set(sandboxManifest("narrative-refutation", P).map((e) => e.path));
  for (const f of ["placement-form.form.json", "stage-contracts.json", "declinations.json", "reading-log.jsonl", "goods-evidence.json", "instructed-scope.json"])
    assert.ok(held.has(driverDir("/run", f)), `the review's sandbox does not carry _driver/${f}`);
  for (const p of [P.placementModel, P.bandShape, P.registerPositions]) assert.ok(held.has(p), `the review's sandbox does not carry ${p}`);
});

test("a corrective arm's sandbox carries the state the corrective pass starts from; a first pass's does not", () => {
  const P = paths("/run");
  const state = [driverDir("/run", "findings-pre-corrective.json"), P.seniorEyeReview, driverDir("/run", "refutation-calls", "call-001.json"), driverDir("/run", "declinations.json"),
    driverDir("/run", "review-exclusions.json")];
  const corrective = new Set(sandboxManifest("synthesis", P, { dispatchTrigger: "corrective" }).map((e) => e.path));
  for (const p of state) assert.ok(corrective.has(p), `a corrective arm's sandbox does not carry ${p}`);
  const fresh = new Set(sandboxManifest("synthesis", P).map((e) => e.path));
  for (const p of state) assert.ok(!fresh.has(p), `a first pass's sandbox carries ${p}, which a first pass is never handed`);
});
