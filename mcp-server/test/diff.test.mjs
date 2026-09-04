// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// diff_artifact tests: name→stage mapping, version listing, a real diff (rich run has a _history snapshot),
// and the honest "nothing to diff" on a normal run (only one version on disk).

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { buildFixture, buildRichRun, RUN_ID, RUN_ID2 } from "./_fixture.mjs";

let runs, artifacts, driver;

before(async () => {
  buildFixture();
  buildRichRun();
  runs = await import("../lib/runs.mjs");
  artifacts = await import("../lib/artifacts.mjs");
  driver = await import("../lib/driver.mjs");
});

test("artifactToStage maps canonical names, basenames, and register axes", () => {
  const P = runs.resolveRun(RUN_ID).P;
  assert.deepEqual(artifacts.artifactToStage(P, "registerFindings"), { stage: "register-digest", axis: null });
  assert.deepEqual(artifacts.artifactToStage(P, "register-findings.md"), { stage: "register-digest", axis: null });
  assert.deepEqual(artifacts.artifactToStage(P, "primary-sweep"), { stage: "register-unit", axis: "primary-sweep" });
  assert.equal(artifacts.artifactToStage(P, "nonsense-artifact"), null);
});

test("rich run: registerFindings has a _history version → a real diff", () => {
  const run = runs.resolveRun(RUN_ID2);
  const versions = artifacts.listArtifactVersions(run.P, run.runDir, "register-digest", null);
  assert.ok(versions.includes("canonical"));
  assert.ok(versions.some((v) => v.startsWith("_history/")), "snapshot listed");
  const r = driver.compareCmd({ runDir: run.runDir, stage: "register-digest" });
  assert.notEqual(r.aRef, r.bRef);          // canonical vs newest snapshot → there IS something to diff
  assert.match(r.diff, /Pending/);          // snapshot had Pending
  assert.match(r.diff, /Live/);             // canonical has Live
});

test("normal run: only one version on disk → aRef === bRef (the 'nothing to diff' signal)", () => {
  const run = runs.resolveRun(RUN_ID);
  assert.deepEqual(artifacts.listArtifactVersions(run.P, run.runDir, "register-digest", null), ["canonical"]);
  const r = driver.compareCmd({ runDir: run.runDir, stage: "register-digest" });
  assert.equal(r.aRef, r.bRef);
});

test("assertDiffRefsSafe: allows canonical + a real snapshot, rejects absolute / .. / cross-run refs (path-escape guard)", () => {
  const run = runs.resolveRun(RUN_ID2);
  const versions = artifacts.listArtifactVersions(run.P, run.runDir, "register-digest", null);
  const snap = versions.find((v) => v.startsWith("_history/"));
  assert.doesNotThrow(() => artifacts.assertDiffRefsSafe(versions, "canonical", snap));
  assert.doesNotThrow(() => artifacts.assertDiffRefsSafe(versions, undefined, undefined)); // defaults are fine
  assert.throws(() => artifacts.assertDiffRefsSafe(versions, "/tmp/leak", "canonical"), /not allowed/);
  assert.throws(() => artifacts.assertDiffRefsSafe(versions, "../../../../tmp/leak", "canonical"), /not allowed/);
  assert.throws(() => artifacts.assertDiffRefsSafe(versions, "_history/some-other-run-dir", "canonical"), /not allowed/);
  assert.throws(() => artifacts.assertDiffRefsSafe(versions, "canonical", "/etc/passwd"), /not allowed/);
});
