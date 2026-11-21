// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the mock clearance pipeline twice over one run, the second time as a resume
//
// A CLEARANCE STAGE IS REUSED, RUN AGAIN OR FAILED THROUGH THE SAME RUNNER AS A KNOCKOUT STAGE, AND DOES WHAT IT DID.
//
// The clearance's stages and the Knockout's now run through one runner (stage-runner.mjs), and the clearance keeps
// everything that is its own. This drives a clearance as a run does. The first pass fails at the reading step, which
// parks it with every stage before it holding its output. The second pass resumes the run with one research half's
// record of what it read taken away. The pass is read for the three things the runner decides: a valid output reused
// with nothing copied aside, a stale one run again over a kept copy of the old, and a failure that stops the stages
// after it, with a row told apart from a success.
//
// Nothing is billed: the engine is the mock, and the register is served offline. Every mark is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { envFrom, pinEnv } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
const ROOT = mkdtempSync(join(tmpdir(), "clearotron-shared-stage-runner-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || join(ROOT, "work"));
pinEnv(process.env, "CLEAROTRON_REGISTER_CALL_LOG", join(ROOT, "register-calls.jsonl"));
pinEnv(process.env, "CLEAROTRON_REPORTS_URL", envFrom(process.env, "CLEAROTRON_REPORTS_URL") || "https://trademark.test");
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
const PROFILES = mkdtempSync(join(tmpdir(), "clearotron-profiles-shared-runner-"));
cpSync(join(HERE, "..", "profiles"), PROFILES, { recursive: true });
pinEnv(process.env, "CLEAROTRON_CUSTOMERS_DIR", PROFILES);

/** A phrase only the reading step's turn carries. */
const READING_TURN = "You are register DIGEST mode";
/** The stages after the reading step: none of them may run once it failed. */
const DOWNSTREAM = ["skeptic", "synthesis", "narrative-refutation", "report-overview"];
const HALF = "common-law-half:a";
const HALF_OUT = "common-law-findings.half-a.md";

const readEvents = (runDir) => readFileSync(driverDir(runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

async function pass(job, env, codename = null) {
  for (const k of ["MOCK_VERDICT", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE"]) delete process.env[k];
  for (const [k, v] of Object.entries({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_REPORTS_DIR: join(ROOT, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", ...env })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...job }, { ...(codename ? { codename } : {}) });
  return { res, events: readEvents(res.runDir) };
}
const JOB = { id: "shared-runner", msgId: "<shared-runner@x>", forwarder: "jordan", forwarderDomain: "example.com", ref: "TMP-shared-runner",
  markName: "NOVAPULSE", classes: [9, 41], provider: "corsearch" };
const rowsOf = (events, event) => events.filter((e) => e.event === event);

test("a clearance stage that fails stops the stages after it; a resume reuses the valid, reruns the stale over a kept copy", async () => {
  // ── THE FIRST PASS: the reading step fails, and the run parks ──────────────────────────────────────
  const p1 = await pass(JOB, { MOCK_FAIL_STAGE: READING_TURN, CLEAROTRON_RECOVERY_MAX: "1" });
  const status = JSON.parse(readFileSync(join(p1.res.runDir, "status.json"), "utf8"));
  assert.equal(status.failedStage, "register-digest", `premise: the first pass failed at the reading step (at ${status.failedStage})`);
  const failed = rowsOf(p1.events, "stage").filter((e) => e.stage === "register-digest").at(-1);
  assert.equal(failed?.ok, false, `the failed stage's row reads as a success: ${JSON.stringify(failed)}`);
  assert.ok(failed.fail, "a failed row names its failure");
  assert.equal(failed.summary, null, "a failed row reports no summary that could read as a success");
  assert.ok(Array.isArray(failed.inputs), "a failed row still names what it was offered");
  const ranAfter = rowsOf(p1.events, "stage").map((e) => e.stage).filter((s) => DOWNSTREAM.includes(s));
  assert.deepEqual(ranAfter, [], "a stage after the failed one ran");
  const succeeded = rowsOf(p1.events, "stage").find((e) => e.stage === "matter-frame");
  assert.deepEqual([succeeded?.ok, typeof succeeded?.summary, succeeded?.fail], [true, "string", null], "a success row reads as one");

  // ── THE SECOND PASS: one research half has lost its record of what it read ─────────────────────────
  const runDir = p1.res.runDir;
  const halfBefore = readFileSync(join(runDir, HALF_OUT), "utf8");
  const stamp = driverDir(runDir, "stage-inputs", `${HALF}.json`);
  assert.ok(existsSync(stamp), "premise: the research half recorded what it read");
  rmSync(stamp);
  const codename = JSON.parse(readFileSync(join(runDir, "status.json"), "utf8")).codename;
  const p2 = await pass(JOB, {}, codename);
  assert.equal(p2.res.ok, true, JSON.stringify({ fail: p2.res.fail, stage: p2.res.failedStage }));
  const ev2 = p2.events.slice(p1.events.length);

  // REUSED: each valid output with its record, with a skip row, and nothing copied aside.
  const skipped = rowsOf(ev2, "skip");
  for (const stage of ["matter-frame", "clearance-variants", "common-law-half:b"]) {
    const row = skipped.find((e) => e.stage === stage);
    assert.ok(row, `${stage} holds its record and is not reused: skipped ${skipped.map((e) => e.stage)}`);
    assert.deepEqual([row.trigger, row.ok, row.output?.present], ["skip", true, true]);
    assert.ok(!rowsOf(ev2, "output-snapshot").some((e) => e.stage === stage), `${stage} was reused and still copied aside`);
    assert.ok(!rowsOf(ev2, "stage").some((e) => e.stage === stage), `${stage} was reused and also ran`);
  }

  // STALE: the half runs again, and the output it replaced is kept, under the clearance's own folder name.
  const stale = rowsOf(ev2, "stage-stale").find((e) => e.stage === HALF);
  assert.equal(stale?.reason, "no record of the inputs it was produced from");
  const snap = rowsOf(ev2, "output-snapshot").find((e) => e.stage === HALF);
  assert.ok(snap, `the half was run again over its output with nothing kept: ${JSON.stringify(rowsOf(ev2, "output-snapshot"))}`);
  assert.match(snap.snapshot, /^\d{4}-\d\d-\d\dT[\d-]+Z-stale-recompute$/, "the clearance's history folders are named as they always were");
  const delivered = p2.res.runDir;   // a delivered run is moved to its archive
  assert.equal(readFileSync(join(delivered, "_history", snap.snapshot, HALF_OUT), "utf8"), halfBefore, "the copy is the half's output as it stood");
  const rerun = rowsOf(ev2, "stage").find((e) => e.stage === HALF);
  assert.equal(rerun?.ok, true);
  assert.ok(existsSync(driverDir(delivered, "stage-inputs", `${HALF}.json`)), "the half records what it read this time");
  assert.ok(!Object.hasOwn(rerun, "lane") && !Object.hasOwn(rerun, "chunk"), "a clearance row carries none of the Knockout's own fields");
});
