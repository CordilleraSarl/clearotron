// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — spawns the runner to resume a claim
//
// A RUN IS FINISHED ON THE BUILD IT STARTED ON, OR NOT AT ALL (owner, 2026-11-09). A search is not upgraded part-way: an
// update waits for a parked run as it waits for a running one. And a run is not resumed after an update: the runner's
// resumes refuse a run whose first `engine-build` row names another build, or none, and the refusal ends the run on the
// existing failure path, notice included, without entering the pipeline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";
import { todayISO } from "../phase0.mjs";
import { engineProvenance } from "../engine-build.mjs";
import { crossBuildResumeRefusal, startedOnBuild } from "../one-build-per-run.mjs";
import { liveRunHolds, deployRefusal } from "../deploy-live-run-guard.mjs";
import { deadClaimToken } from "./claim-fixtures.mjs";
import { startedOnThisBuild } from "./started-on-this-build.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), "one-build-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", join(ROOT, "ws"));
pinEnv(process.env, "CLEAROTRON_OUTBOX_DIR", join(ROOT, "outbox"));

const THIS = engineProvenance().engineHead;
const OTHER = "0123456789abcdef0123456789abcdef01234567";
const startedOn = (runDir, head) => {
  mkdirSync(driverDir(runDir), { recursive: true });
  appendFileSync(driverDir(runDir, "run.jsonl"), JSON.stringify({ event: "engine-build", engineHead: head }) + "\n");
  return runDir;
};
const rows = (runDir, event) => readFileSync(driverDir(runDir, "run.jsonl"), "utf8").trim().split("\n")
  .map((l) => JSON.parse(l)).filter((r) => r.event === event);

test("premise: this checkout names its own build", () => {
  assert.match(String(THIS), /^[0-9a-f]{40}$/, "every refusal below would be the could-not-name one, and test nothing else");
});

test("the run's first build decides: the same build resumes, another or none is refused, and so is a build that cannot name itself", () => {
  const same = startedOnThisBuild(join(ROOT, "same"));
  assert.equal(crossBuildResumeRefusal(same), null);

  const other = startedOn(join(ROOT, "other"), OTHER);
  startedOn(other, THIS);   // a later segment on this build does not make the run this build's
  assert.equal(startedOnBuild(other), OTHER, "the FIRST row is the run's start");
  assert.match(crossBuildResumeRefusal(other), /started on build 0123456789ab and this is /);

  const none = join(ROOT, "none");
  mkdirSync(driverDir(none), { recursive: true });
  assert.match(crossBuildResumeRefusal(none), /recorded no build when it started/);
  assert.match(crossBuildResumeRefusal(same, { current: null }), /cannot name its own build/);
});

test("a run folder parked on another build is not resumed: it fails at once, with its notice, and is not re-parked", async () => {
  const { resumeRunDirOrphans } = await import(`../runner.mjs?bust=${process.hrtime.bigint()}`);
  const runDir = startedOn(join(ROOT, "ws", "workspace-mailagent", "studio", "clearance-search", "mark-x", "2026-11-09-flint"), OTHER);
  const payload = { job: { id: "j", markName: "FLINTOVA" }, agent: "mailagent", codename: "flint", postponedAt: new Date().toISOString() };
  writeFileSync(join(runDir, "status.json"), JSON.stringify({ state: "postponed" }));
  writeFileSync(join(runDir, ".postponed"), JSON.stringify(payload));

  let entered = 0;
  await resumeRunDirOrphans([{ runDir, sentPath: join(runDir, ".postponed"), job: payload.job, agent: "mailagent", codename: "flint", fromStage: null, reparks: 0, payload }],
    { runPipeline: async () => { entered++; } });
  assert.equal(entered, 0, "the pipeline is never entered");
  assert.ok(existsSync(join(runDir, ".failed")), "the run ends at once");
  assert.ok(!existsSync(join(runDir, ".postponed")), "and is not parked again to meet the same refusal");
  assert.match(JSON.parse(readFileSync(join(runDir, ".failed"), "utf8")).reason, /resume refused: the run started on build/);
  assert.equal(JSON.parse(readFileSync(join(runDir, "status.json"), "utf8")).state, "failed");
  assert.ok(existsSync(driverDir(runDir, "failure.json")), "the failure notice is written");
  assert.equal(rows(runDir, "resume-refused").length, 1, "the run's own log says why");
});

test("a queue claim of a run started on another build ends failed through the runner, without entering the pipeline", async () => {
  const root = mkdtempSync(join(tmpdir(), "one-build-claim-"));
  const studio = join(root, "workspace-intake-agent", "studio", "clearance-search");
  const Q = join(studio, "queue");
  mkdirSync(Q, { recursive: true });
  const job = { id: "tmp9411-crossbuild", msgId: "<tmp9411@x>", forwarder: "requesting-lawyer", forwarderDomain: "example.com",
    ref: "TMP9411", markName: "CROSSVALE", classes: [9], provider: "corsearch" };
  const slug = "tmp9411-crossvale", codename = "probe-crossbuild", dateISO = todayISO();
  const runDir = startedOn(join(studio, slug, `${dateISO}-${codename}`), OTHER);
  writeFileSync(join(runDir, "status.json"), JSON.stringify({ runId: `${slug}-${dateISO}-${codename}`, slug, codename, date: dateISO,
    agent: "intake-agent", state: "running", updatedAt: new Date().toISOString() }));
  writeFileSync(join(Q, "job-x.processing"), JSON.stringify(job));
  writeFileSync(join(Q, "job-x.processing.pid"), await deadClaimToken());
  writeFileSync(join(Q, "job-x.processing.meta"), JSON.stringify({ codename, dateISO, agentId: "intake-agent" }));

  const CLAUDE = join(HERE, "mock-claude.mjs");
  chmodSync(CLAUDE, 0o755);
  const child = spawn(process.execPath, [join(HERE, "..", "runner.mjs")], { stdio: ["ignore", "pipe", "pipe"], env: {
    ...process.env, CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root,
    CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_OUTBOX_DIR: join(root, "outbox"), CLEAROTRON_MAX_RETRIES: "0",
    CLEAROTRON_RECOVERY_MAX: "0", CLEAROTRON_QUEUE_SCAN_MS: "100", CORSEARCH_SESSION_KEY: "test-offline",
    CLEAROTRON_SATPROBE_CODESIDE: "0", CLEAROTRON_BAND_TRUTH_GATE: "0" } });
  let log = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  assert.equal(await new Promise((r) => child.on("exit", r)), 0, log);

  assert.ok(existsSync(join(Q, "job-x.failed")), `the claim ends failed\n${log}`);
  assert.match(JSON.parse(readFileSync(join(Q, "job-x.failed.result"), "utf8")).reason, /^resume refused: the run started on build/);
  assert.equal(rows(runDir, "resume-refused").length, 1, "the run's own log says why");
  assert.deepEqual(rows(runDir, "engine-build").map((r) => r.engineHead), [OTHER], "the pipeline never started a segment on this build");
  assert.ok(readdirSync(join(root, "outbox")).some((f) => f.endsWith(".pending")), "the failure notice is owed");
});

test("an update waits for a parked run, in a queue or in a run folder, and names it", () => {
  const q = join(ROOT, "guard-q");
  mkdirSync(q, { recursive: true });
  writeFileSync(join(q, "job-p.postponed"), "{}");
  writeFileSync(join(q, "job-p.postponed.meta"), "{}");
  writeFileSync(join(q, "job-d.done"), "{}");
  const holds = liveRunHolds({ queueDirs: [q], parkedRunDirs: [{ codename: "flint", runDir: join(ROOT, "x") }] });
  assert.deepEqual(holds.parked.map((p) => p.id), ["job-p", "flint"], "the queue's park and the run folder's, nothing else");
  assert.deepEqual([holds.queued, holds.claimed, holds.stale], [[], [], []], "a park's sidecar and a finished entry are not runs");
  const refusal = deployRefusal(holds);
  assert.equal(refusal.refuse, true);
  assert.match(refusal.reason, /2 PARKED and resuming on their own: job-p, flint/);
  assert.equal(deployRefusal(liveRunHolds({ queueDirs: [join(ROOT, "guard-empty")] })).refuse, false, "control: nothing parked, nothing held");
});
