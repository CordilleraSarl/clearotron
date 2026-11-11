// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-failed-run-resumes-from-the-command-line.test.mjs — `--resume <codename>` with no `--job` reaches the
// rebuild, from the command line an operator actually types.
//
// THE DEFECT. The rebuild of a failed run's job from its own status.json was built and unit-tested, and could
// never be reached: the CLI printed its usage text and exited 2 whenever `--job` was absent, three lines
// before the branch that handles exactly that case. Every arm called the rebuild's functions directly, so
// all of them passed around a door that was shut. These arms spawn the CLI.
//
// NOTHING HERE RUNS A CLEARANCE: every arm stops at a refusal the resume branch makes before any stage.
//
// A RUN IS FINISHED ON THE BUILD IT STARTED ON (owner, 2026-11-09), and the command line is one of the doors a
// run comes back through. The fixture runs carry the row a run writes when it starts, the build it loaded, so
// each stands for a run started on this build unless an arm says otherwise.
//
// Run:  node --test driver/test/a-failed-run-resumes-from-the-command-line.test.mjs

import { test } from "node:test";
import { driverSource } from "./driver-source.mjs";
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, mkdirSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { pinEnv } from "../../shared/env-aliases.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";
import { deriveSlug } from "../phase0.mjs";
import { startedOnThisBuild } from "./started-on-this-build.mjs";

import { resumeJobRefusal } from "../pipeline.mjs";

/** The agent this fixture writes its run under, and the one the spawned CLI must default to. */
const AGENT = "intake-agent";

const PIPELINE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "pipeline.mjs");

/** A build no checkout is on: a run that started on it started on another version. */
const OTHER_BUILD = "0123456789abcdef0123456789abcdef01234567";

/**
 * Spawn `pipeline.mjs --resume <codename>` over a fixture run. `startedOn` is the build the run's first segment
 * recorded: "this" (the default), another commit, or null for a run that recorded none. With `job`, the run sits
 * under that job's own slug and the CLI is given the job file; `args` are appended to the command line; `seed`
 * writes more of the run folder. Returns
 * the exit code, the error stream, and the run folder's file list before and after the CLI ran.
 */
function resumeCli(codename, status, { startedOn = "this", job = null, args = [], seed = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), "resume-cli-"));
  const work = join(root, "workspace"), pool = join(root, "pool");
  mkdirSync(pool, { recursive: true });
  const studio = join(work, `workspace-${AGENT}`, "studio", "clearance-search");
  let runDir = null;
  if (status) {
    runDir = join(studio, job ? deriveSlug(job) : "invented-matter", `2026-09-18-${codename}`);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "status.json"), JSON.stringify(status));
    if (startedOn === "this") startedOnThisBuild(runDir);
    else if (startedOn) {
      mkdirSync(driverDir(runDir), { recursive: true });
      appendFileSync(driverDir(runDir, "run.jsonl"), JSON.stringify({ event: "engine-build", engineHead: startedOn }) + "\n");
    }
    seed?.(runDir);
  } else mkdirSync(studio, { recursive: true });
  const jobArgs = [];
  if (job) { writeFileSync(join(root, "job.json"), JSON.stringify(job)); jobArgs.push("--job", join(root, "job.json")); }
  const env = { ...process.env };
  pinEnv(env, "CLEAROTRON_WORK_DIR", work);
  pinEnv(env, "CLEAROTRON_REPORTS_DIR", pool);
  // THE AGENT IS PINNED BECAUSE THE PATH IS THE AGENT'S. `config.studioRoot` resolves under the install's
  // own default agent (ruling 563 — it named one agent as a literal before), so a fixture that writes
  // under one id and spawns a process defaulting to another looks exactly like a missing run directory.
  // Pinned rather than writing under the built-in default, so the coupling is visible where it bites.
  pinEnv(env, "CLEAROTRON_DEFAULT_AGENT", AGENT);
  // ANY ARM THAT GETS PAST THE REFUSALS ASKS A MOCK, never a real engine.
  pinEnv(env, "CLEAROTRON_AI", "anthropic-agent");
  pinEnv(env, "CLEAROTRON_CLAUDE_PATH", join(dirname(fileURLToPath(import.meta.url)), "mock-claude.mjs"));
  const before = runDir ? listTree(runDir) : [];
  const r = spawnSync(process.execPath, [PIPELINE, ...jobArgs, "--resume", codename, ...args], { env, encoding: "utf8", timeout: 60_000 });
  const after = runDir ? listTree(runDir) : [];
  rmSync(root, { recursive: true, force: true });
  return { code: r.status, err: `${r.stderr ?? ""}`, before, after };
}
const listTree = (dir) => readdirSync(dir, { recursive: true }).map(String).sort();

test("--resume with no --job is not answered with the usage text", () => {
  const r = resumeCli("amber-nothing", null);
  assert.doesNotMatch(r.err, /^usage:/m, "the CLI stopped before the resume branch, as it did for every operator");
  assert.match(r.err, /no run directory for --resume amber-nothing/, "it reached the branch and looked for the run");
});

test("a status.json missing an identifying field is refused by name, from the command line", () => {
  const r = resumeCli("amber-partial", { id: "job-1", ref: "TMP1", markName: "INVENTED", classes: [9] });
  assert.equal(r.code, 2);
  assert.doesNotMatch(r.err, /^usage:/m);
  assert.match(r.err, /carries no forwarder/, "the refusal names the field it would otherwise have guessed");
});

test("the rebuild refuses each missing identifying field, and names every one", () => {
  const whole = { id: "job-1", ref: "TMP1", markName: "INVENTED", classes: [9], forwarder: "staff-a" };
  for (const k of ["id", "markName", "forwarder"]) {
    assert.match(resumeJobRefusal({ ...whole, [k]: null }, "irrelevant") ?? "", new RegExp(`carries no .*${k}`), `${k} missing is refused`);
  }
  assert.match(resumeJobRefusal({ ...whole, classes: null }, "irrelevant") ?? "", /carries no classes/);
  assert.match(resumeJobRefusal({ ...whole, id: null, forwarder: null }, "irrelevant") ?? "", /id, forwarder/, "all of them, not the first");
  // An empty class list is a recorded answer, not a missing one.
  assert.doesNotMatch(resumeJobRefusal({ ...whole, classes: [] }, "irrelevant") ?? "", /carries no/);
});

test("a resume rebuilt from status.json keeps the run's instructed scope; a job from a file writes its own", async () => {
  // The rebuilt job holds the run's identity only, so a scope written from it would drop the order's goods,
  // customer and territories. The run keeps the scope it started with.
  const { instructedScopeToWrite, jobFromStatus } = await import("../pipeline.mjs");
  const rebuilt = jobFromStatus({ id: "job-1", ref: "TMP1", markName: "INVENTED", classes: [9], forwarder: "staff-a" });
  assert.equal(instructedScopeToWrite(rebuilt, { jobRebuiltFromStatus: true, scopeOnDisk: true }), null, "a rebuilt resume overwrote the run's scope");
  assert.deepEqual(instructedScopeToWrite(rebuilt, { jobRebuiltFromStatus: true, scopeOnDisk: false })?.marks, ["INVENTED"],
    "a rebuilt resume with no scope on disk wrote none at all");
  const fromFile = { ...rebuilt, goods: "invented goods", customer: "Invented Holdings" };
  assert.equal(instructedScopeToWrite(fromFile, { jobRebuiltFromStatus: false, scopeOnDisk: true })?.goods, "invented goods",
    "a job read from a file no longer writes its scope");
  // And the command line marks the rebuild exactly when no --job was given, and a job file as given explicitly.
  const src = driverSource("pipeline.mjs");
  assert.match(src, /fromStage: a\.fromStage, \.\.\.\(a\.job \? \{ explicitJob: true \} : \{ jobRebuiltFromStatus: true \}\)/);
  assert.match(src, /instructedScopeToWrite\(job, \{ jobRebuiltFromStatus: opts\.jobRebuiltFromStatus, scopeOnDisk: existsSync\(P\.instructedScope\) \}\)/);
});

// ── the build door, from the command line ─────────────────────────────────────────────────────────────

const WHOLE_STATUS = { id: "job-1", ref: "TMP1", markName: "INVENTED", classes: [9], forwarder: "staff-a" };

test("--resume of a run started on another build is refused before its order is rebuilt, and the run is left as it was", () => {
  // The status is missing a field the rebuild refuses by name; the build refusal answering instead shows the
  // door stands BEFORE the rebuild, which is what keeps the rebuild from writing the order into an old run.
  const r = resumeCli("amber-crossbuild", { id: "job-1", ref: "TMP1", markName: "INVENTED", classes: [9] }, { startedOn: OTHER_BUILD });
  assert.equal(r.code, 2);
  assert.match(r.err, /resume refused: the run started on build 0123456789ab and this is [0-9a-f]{12}\./);
  assert.match(r.err, /start a new run/, "in the runner's own words");
  assert.doesNotMatch(r.err, /carries no forwarder/);
  assert.ok(r.before.includes("status.json"), "the population is real: the fixture's own files are listed");
  assert.deepEqual(r.after, r.before, "nothing was written to the run");
});

test("--resume of a run that recorded no build is refused: it started on an earlier version", () => {
  const r = resumeCli("amber-nobuild", WHOLE_STATUS, { startedOn: null });
  assert.equal(r.code, 2);
  assert.match(r.err, /resume refused: the run recorded no build when it started/);
});

// The experiment named without its --axis is refused inside the experiment rig, after the door and before any
// dispatch. So the pair below differs only in the build the run started on, and the refusal that answers says
// which side of the door each one stopped on.
const EXPERIMENT_WITHOUT_AXIS = ["--experiment", "common-law-half"];

test("--job with --resume and --experiment on a run started on another build is refused before the experiment", () => {
  const r = resumeCli("amber-crossexp", WHOLE_STATUS, { startedOn: OTHER_BUILD, job: WHOLE_STATUS, args: EXPERIMENT_WITHOUT_AXIS });
  assert.equal(r.code, 2);
  assert.match(r.err, /resume refused: the run started on build 0123456789ab/);
  assert.doesNotMatch(r.err, /requires --axis/, "the experiment rig was never reached");
});

test("control: the same --experiment on a run started on THIS build passes the door and reaches the rig", () => {
  const r = resumeCli("amber-sameexp", WHOLE_STATUS, { job: WHOLE_STATUS, args: EXPERIMENT_WITHOUT_AXIS });
  assert.equal(r.code, 2);
  assert.doesNotMatch(r.err, /resume refused/);
  assert.match(r.err, /--experiment common-law-half requires --axis <seat>/, "the rig's own refusal answered, so the door let it through");
});

// ── a run that stopped before its first stage has nothing to rebuild ─────────────────────────────────────
//
// The search policy and the framework are frozen as a run opens, before any stage. A run without them ran
// none, so an --experiment on it is refused by name before anything is dispatched. (A run from before
// those freezes was rebuilt as a clearance here; a run from an earlier build is no longer resumed.)

test("--experiment on a run that froze no search policy is refused: it ran no stage", () => {
  const r = resumeCli("amber-nopolicy", WHOLE_STATUS, { job: WHOLE_STATUS, args: ["--experiment", "synthesis"] });
  assert.equal(r.code, 2);
  assert.match(r.err, /froze no search policy — it stopped before its first stage, so there is nothing to repair or --experiment on/);
  assert.doesNotMatch(r.err, /\[synthesis\] attempt/, "nothing was dispatched");
});

test("--experiment on a run with a search policy and no frozen framework is refused: it ran no stage", () => {
  const policy = (runDir) => writeFileSync(driverDir(runDir, "search-policy.json"),
    JSON.stringify({ schema: 1, level: "clearance", pipeline: "clearance", components: {}, recipe: null }));
  const r = resumeCli("amber-noframework", WHOLE_STATUS, { job: WHOLE_STATUS, seed: policy, args: ["--experiment", "synthesis"] });
  assert.equal(r.code, 2);
  assert.match(r.err, /framework\.json is absent — the run stopped before its framework was frozen/);
  assert.doesNotMatch(r.err, /\[synthesis\] attempt/, "nothing was dispatched");
});
