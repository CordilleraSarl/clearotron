// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — writes park markers in a temporary run folder
//
// A PARKED RUN CARRIES WHAT RESUMES IT.
//
// The runner resumes a parked run the queue does not own from its `.postponed` marker alone, and skips a marker
// without `job`, `agent` and `codename` (runner.mjs, the run-folder watcher). The Knockout's recovery park wrote
// none of the three, so a Knockout resumed by the watcher that parked again was never woken. Every park now goes
// through one writer, run-park.mjs, which adds the three a park did not name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writePark } from "../run-park.mjs";
import { knockoutRecoveryPark } from "../pipeline-knockout.mjs";
import { StageFailure } from "../pipeline.mjs";

const JOB = { markName: "INVENTED MARK", ref: "T-1" };
const marker = (runDir) => JSON.parse(readFileSync(join(runDir, ".postponed"), "utf8"));
/** The runner's own condition for resuming a marker it finds in a run folder. */
const watcherResumes = (m) => Boolean(m.job && m.agent && m.codename);

test("a Knockout parked for recovery writes the job, the agent and the codename the watcher resumes it by", () => {
  const runDir = mkdtempSync(join(tmpdir(), "park-"));
  const saved = { ...process.env };
  Object.assign(process.env, { CLEAROTRON_RECOVERY_MAX: "3" });
  try {
    const e = new StageFailure("assess", "knockout_chunk_invalid: rating vocabulary miss", undefined, { failClass: "unknown" });
    const r = knockoutRecoveryPark({ ctx: { job: JOB, agent: "intake-agent" }, run: { runDir, codename: "amber-gate", studioRoot: runDir },
      e, reason: e.reason, failedStage: "assess" });
    assert.ok(r?.postponed, "premise: an unknown failure buys its one park");
    const m = marker(runDir);
    assert.deepEqual(m.job, JOB);
    assert.equal(m.agent, "intake-agent");
    assert.equal(m.codename, "amber-gate");
    assert.ok(watcherResumes(m), "the watcher would skip this marker");
    assert.equal(m.kind, "recovery");
    assert.equal(m.lane, "knockout", "the park's own fields are kept");
  } finally { process.env = saved; }
});

test("a park that already names the three is written exactly as given", () => {
  const runDir = mkdtempSync(join(tmpdir(), "park-"));
  const park = { kind: "rate-limit", resetsAt: "2026-11-10T16:00:00.000Z", postponedAt: "2026-11-10T15:00:00.000Z",
    fromStage: "synthesis", codename: "amber-gate", job: JOB, agent: "intake-agent", probeAttempt: 1 };
  writePark(runDir, park, { job: { other: true }, agent: "other", codename: "other" });
  const written = JSON.parse(readFileSync(join(runDir, ".postponed"), "utf8"));
  const { ts, ...rest } = written;
  assert.ok(ts, "every sentinel carries when it was written");
  assert.deepEqual(Object.keys(rest), Object.keys(park), "same fields, same order");
  assert.deepEqual(rest, park, "the run's identity never overrides what the park named");
});

test("a park that names none of the three gets them from the run, after its own fields", () => {
  const runDir = mkdtempSync(join(tmpdir(), "park-"));
  writePark(runDir, { kind: "recovery", recoveryResumesAt: "2026-11-10T16:00:00.000Z" }, { job: JOB, agent: "intake-agent", codename: "amber-gate" });
  const m = marker(runDir);
  assert.deepEqual(Object.keys(m), ["ts", "kind", "recoveryResumesAt", "codename", "job", "agent"]);
  assert.ok(watcherResumes(m));
});

test("a park with no identity to give still writes, and says so by leaving the three empty", () => {
  const runDir = mkdtempSync(join(tmpdir(), "park-"));
  writeFileSync(join(runDir, ".postponed"), "stale");
  writePark(runDir, { kind: "recovery" });
  const m = marker(runDir);
  assert.equal(m.job, null); assert.equal(m.agent, null); assert.equal(m.codename, null);
  assert.equal(watcherResumes(m), false, "the watcher leaves it for a person, as before");
});
