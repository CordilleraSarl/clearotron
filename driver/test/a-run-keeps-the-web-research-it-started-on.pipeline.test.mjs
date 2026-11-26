// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A RUN KEEPS THE WEB-RESEARCH SERVICE IT STARTED ON, end to end through the run's opening step.
//
// A cold start records the installation's service beside its engine and register. A resume is checked on the service it
// recorded, never on the machine's current setting, and one this runner cannot serve parks by name with its work kept. A
// run recorded before the service was ran on Perplexity and is checked there. A setting that names no service refuses a
// new run before anything is spent. The order is the one the engine-record tests use; the resumes name a product whose
// answer needs the web half, so the research door applies to them.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { envFrom, pinEnv } from "../../shared/env-aliases.mjs";

const TEMP_DIRS = [];
after(() => { for (const d of TEMP_DIRS) rmSync(d, { recursive: true, force: true }); });
const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
pinEnv(process.env, "CLEAROTRON_REPORTS_URL", envFrom(process.env, "CLEAROTRON_REPORTS_URL") || "https://trademark.test");
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";

const JOB = { id: "test-job", msgId: "<test@x>", forwarder: "requester", forwarderDomain: "example.com",
  ref: "TMP8441", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch" };
// A product whose answer needs the web half, so its resume meets the research door.
const WITH_THE_WEB_HALF = "global-preliminary-search";
const FAIL_LATE = "record_narrative_refutation";

const events = (runDir) => readFileSync(driverDir(runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const choicesRows = (runDir) => events(runDir).filter((e) => e.event === "run-choices");
const recordOf = (runDir) => JSON.parse(readFileSync(driverDir(runDir, "run-choices.json"), "utf8"));
const codenameOf = (runDir) => JSON.parse(readFileSync(join(runDir, "status.json"), "utf8")).codename;
const stagesOf = (runDir) => events(runDir).filter((e) => e.event === "stage").length;

// One segment, with the installation's web research set to `research` (undefined unsets it) and the rest of `env` pinned.
async function segment(root, { research, env = {}, fail = null, codename = null, job = JOB } = {}) {
  for (const [k, v] of Object.entries({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root,
    CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0",
    MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", CLEAROTRON_WEB_RESEARCH: research, ...env })) pinEnv(process.env, k, v);
  if (fail) process.env.MOCK_FAIL_STAGE = fail; else delete process.env.MOCK_FAIL_STAGE;
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  try { return await pipeline({ ...job }, codename ? { codename } : {}); }
  finally { for (const k of ["CLEAROTRON_WEB_RESEARCH", ...Object.keys(env)]) pinEnv(process.env, k, undefined); }
}
async function startedAndFailed(research) {
  const root = mkdtempSync(join(tmpdir(), "clearotron-web-research-"));
  TEMP_DIRS.push(root);
  const first = await segment(root, { research, fail: FAIL_LATE });
  assert.equal(first.ok, false, "the first segment was meant to fail late");
  return { root, runDir: first.runDir, codename: codenameOf(first.runDir) };
}
async function resumeParked(root, codename, runDir, opts) {
  const before = stagesOf(runDir);
  const res = await segment(root, { codename, job: { ...JOB, product: WITH_THE_WEB_HALF }, ...opts });
  assert.equal(res?.postponed, true, `the resume was not parked: ${JSON.stringify(res).slice(0, 400)}`);
  assert.equal(res.runDir, runDir, "the park names another run");
  const marker = JSON.parse(readFileSync(join(runDir, ".postponed"), "utf8"));
  assert.equal(marker.kind, "run-choice");
  assert.deepEqual(marker.dependency, res.parkedFor);
  assert.equal(stagesOf(runDir), before, "a stage ran on another service");
  assert.equal(existsSync(join(runDir, ".delivered")), false);
  return { parkedFor: res.parkedFor, marker };
}

test("a cold start records the installation's web-research service, and says whether it was chosen", async () => {
  const unset = await startedAndFailed(undefined);
  assert.equal(recordOf(unset.runDir).research, "perplexity", "an installation that names no service keeps the service it always had");
  const row = choicesRows(unset.runDir)[0];
  assert.deepEqual({ research: row.research, machineResearch: row.machineResearch, researchChosen: row.researchChosen },
    { research: "perplexity", machineResearch: "perplexity", researchChosen: false });
  const own = await startedAndFailed("own");
  assert.equal(recordOf(own.runDir).research, "own");
  assert.equal(choicesRows(own.runDir)[0].researchChosen, true);
});

test("a run recorded on its own AI program's search, resumed where that search cannot run, is parked by name", async () => {
  const { root, runDir, codename } = await startedAndFailed("own");
  // The installation now bills Claude through Amazon Bedrock, which carries no web search of its own, and is set to
  // Perplexity with a key: had the resume taken the machine's setting, it would have passed the door on Perplexity.
  const { parkedFor, marker } = await resumeParked(root, codename, runDir, { research: "perplexity",
    env: { CLEAROTRON_AI_BILLING: "cloud", CLAUDE_CODE_USE_BEDROCK: "1", AWS_REGION: "eu-west-1", PERPLEXITY_API_KEY: "test-offline" } });
  assert.deepEqual({ kind: parkedFor.kind, recorded: parkedFor.recorded, machine: parkedFor.machine }, { kind: "research", recorded: "own", machine: "perplexity" });
  assert.match(parkedFor.detail ?? "", /Amazon Bedrock has no web search of its own/, "the door's own words ride with the park");
  assert.match(marker.waitingOn, /the own web research/);
  assert.equal(recordOf(runDir).research, "own", "the park rewrote the run's record");
});

test("a run recorded before the service was is checked on Perplexity, where it ran, whatever the machine is set to", async () => {
  const { root, runDir, codename } = await startedAndFailed(undefined);
  const { research, ...older } = recordOf(runDir);
  assert.equal(research, "perplexity");
  writeFileSync(driverDir(runDir, "run-choices.json"), JSON.stringify(older));
  // The machine is set to its own search, which needs no key; the run's service needs one, and none is set.
  const saved = process.env.PERPLEXITY_API_KEY;
  delete process.env.PERPLEXITY_API_KEY;
  try {
    const { parkedFor } = await resumeParked(root, codename, runDir, { research: "own" });
    assert.deepEqual({ kind: parkedFor.kind, recorded: parkedFor.recorded, machine: parkedFor.machine }, { kind: "research", recorded: "perplexity", machine: "own" });
    assert.match(parkedFor.detail ?? "", /missing PERPLEXITY_API_KEY/);
  } finally { if (saved !== undefined) process.env.PERPLEXITY_API_KEY = saved; }
});

test("a setting that names no service refuses a new run before anything is spent", async () => {
  const root = mkdtempSync(join(tmpdir(), "clearotron-web-research-"));
  TEMP_DIRS.push(root);
  await assert.rejects(segment(root, { research: "google" }), /CLEAROTRON_WEB_RESEARCH=google names no web-research service/);
  assert.equal(existsSync(join(root, "pool")), false, "nothing was delivered");
});
