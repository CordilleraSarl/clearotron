// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — writes park markers in a temporary run folder
//
// A PARKED RUN CARRIES WHAT RESUMES IT.
//
// The runner resumes a parked run the queue does not own from its `.postponed` marker alone, and skips a marker
// without `job`, `agent` and `codename` (runner.mjs, the run-folder watcher). The Knockout's recovery park once wrote
// none of the three, so a Knockout resumed by the watcher that parked again was never woken. Every park now goes
// through one writer, run-park.mjs, which adds the three a park did not name, and a Knockout parks through the
// clearance's own failure path.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writePark } from "../run-park.mjs";
import { endTheFailedRun } from "../run-failed.mjs";
import { KNOCKOUT_ENDING } from "../pipeline-knockout.mjs";
import { StageFailure } from "../pipeline.mjs";

const JOB = { markName: "INVENTED MARK", ref: "T-1" };
const marker = (runDir) => JSON.parse(readFileSync(join(runDir, ".postponed"), "utf8"));
/** The runner's own condition for resuming a marker it finds in a run folder. */
const watcherResumes = (m) => Boolean(m.job && m.agent && m.codename);

test("a Knockout parked for recovery writes the job, the agent and the codename the watcher resumes it by", async () => {
  const runDir = mkdtempSync(join(tmpdir(), "park-"));
  const saved = { ...process.env };
  Object.assign(process.env, { CLEAROTRON_RECOVERY_MAX: "3" });
  try {
    const e = new StageFailure("assess", "knockout_chunk_invalid: rating vocabulary miss", undefined, { failClass: "unknown" });
    const run = { runDir, codename: "amber-gate", studioRoot: runDir, slug: "invented-mark", date: "2026-11-10" };
    const ctx = { job: JOB, agent: "intake-agent", run, paths: { runDir } };
    const r = await endTheFailedRun({ P: ctx.paths, agent: "intake-agent", ctx, e, job: JOB, run, product: KNOCKOUT_ENDING },
      { sentinel: () => {} });
    assert.ok(r?.postponed, "premise: an unknown failure buys its one park");
    const m = marker(runDir);
    assert.deepEqual(m.job, JOB);
    assert.equal(m.agent, "intake-agent");
    assert.equal(m.codename, "amber-gate");
    assert.ok(watcherResumes(m), "the watcher would skip this marker");
    assert.equal(m.kind, "recovery");
    assert.equal(m.lane, "defect", "the park's own fields are kept: the recovery lane it was charged to, as a clearance's");
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

// ── A RESUME THIS RUNNER CANNOT SERVE PARKS THROUGH THE SAME WRITER ─────────────────────────────────────────────
// A resumed run whose recorded engine or register this runner cannot serve stops before anything is spent, with a
// RunChoiceUnavailable signal. pipeline() parks it rather than ending it, and the marker it writes is the one above.
import { isRunChoiceUnavailable, parkForRunChoice } from "../pipeline.mjs";
import { postponedDueAt } from "../runner.mjs";
import { driverSource } from "./driver-source.mjs";

const signal = (runDir) => Object.assign(new Error("run amber-gate started on the euipo register, and this process serves the signa register."), {
  name: "RunChoiceUnavailable", run: { runDir, codename: "amber-gate", date: "2026-11-10" },
  dependency: { kind: "register", recorded: "euipo", machine: "signa", detail: null },
  waitingOn: "the euipo register, which this run started on", resolvedBy: "a runner whose register is euipo" });

test("the signal is told apart by its name and the fields the park needs", () => {
  const runDir = mkdtempSync(join(tmpdir(), "park-"));
  assert.equal(isRunChoiceUnavailable(signal(runDir)), true);
  assert.equal(isRunChoiceUnavailable(new Error("RunChoiceUnavailable")), false, "a message alone is not the signal");
  assert.equal(isRunChoiceUnavailable(Object.assign(signal(runDir), { run: null })), false, "a signal with no run has nothing to park");
  assert.equal(isRunChoiceUnavailable(new StageFailure("assess", "x")), false);
});

test("a resume this runner cannot serve parks with what it waits on, and the runner times it by its backoff", () => {
  const runDir = mkdtempSync(join(tmpdir(), "park-"));
  const r = parkForRunChoice(signal(runDir), { job: JOB, agent: "intake-agent" });
  assert.deepEqual(r, { ok: false, postponed: true, resetsAt: null, parkedFor: signal(runDir).dependency, codename: "amber-gate", runDir });
  const m = marker(runDir);
  assert.equal(m.kind, "run-choice");
  assert.equal(m.resetsAt, null, "no clock of its own");
  assert.deepEqual(m.dependency, signal(runDir).dependency);
  assert.match(m.waitingOn, /euipo register/); assert.match(m.resolvedBy, /register is euipo/);
  assert.ok(watcherResumes(m), "the watcher can resume it");
  const backoffMs = 10 * 60_000;
  assert.equal(postponedDueAt(m, backoffMs), Date.parse(m.postponedAt) + backoffMs, "due at the park plus the backoff");
});

test("pipeline() parks the signal and lets every other failure through", () => {
  const src = driverSource("pipeline.mjs");
  const fn = src.slice(src.indexOf("export async function pipeline(job, opts = {}) {"), src.indexOf("export function isRunChoiceUnavailable("));
  assert.match(fn, /if \(isRunChoiceUnavailable\(e\)\) return parkForRunChoice\(e, \{ job, agent: opts\.agent \?\? config\.defaultAgent \}\);\s*throw e;/);
});
