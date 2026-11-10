// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A RESUMED RUN KEEPS THE ENGINE IT STARTED ON, end to end through the run's opening step.
//
// A run records its engine and register when it starts. Resumed after the machine's engine setting changed, it is
// checked and served on the engine it recorded, and every segment logs the record beside the machine's setting. A run
// that has no record is resumed on the machine's engine and is given no record. A run whose recorded engine this driver
// does not have is refused by name and runs nothing. The order is the one the corrective-cycle tests use.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
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
  ref: "TMP8440", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch" };
const FAIL_LATE = "record_report_overview";   // a stage in the delivery phase, so the first segment leaves a resumable run

const events = (runDir) => readFileSync(driverDir(runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const choicesRows = (runDir) => events(runDir).filter((e) => e.event === "run-choices");
const recordOf = (runDir) => JSON.parse(readFileSync(driverDir(runDir, "run-choices.json"), "utf8"));
const codenameOf = (runDir) => JSON.parse(readFileSync(join(runDir, "status.json"), "utf8")).codename;

// One segment of the run, with the machine set to `engine`. A first segment fails late; a resume names the codename.
async function segment(root, { engine = "anthropic-agent", fail = null, codename = null } = {}) {
  for (const [k, v] of Object.entries({ CLEAROTRON_AI: engine, CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root,
    CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0",
    MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" })) pinEnv(process.env, k, v);
  if (fail) process.env.MOCK_FAIL_STAGE = fail; else delete process.env.MOCK_FAIL_STAGE;
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  return pipeline({ ...JOB }, codename ? { codename } : {});
}
async function startedAndFailed() {
  const root = mkdtempSync(join(tmpdir(), "clearotron-run-choices-"));
  TEMP_DIRS.push(root);
  const first = await segment(root, { fail: FAIL_LATE });
  assert.equal(first.ok, false, "the first segment was meant to fail late");
  return { root, runDir: first.runDir, codename: codenameOf(first.runDir) };
}

test("a cold start records the run's engine and register, once", async () => {
  const { runDir } = await startedAndFailed();
  const rec = recordOf(runDir);
  assert.deepEqual(Object.keys(rec).sort(), ["engine", "register", "schema"], "the record holds the two names and nothing else");
  assert.equal(rec.engine, "anthropic-agent");
  const rows = choicesRows(runDir);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].state, "recorded");
  assert.equal(rows[0].written, true);
  assert.equal(rows[0].machineEngine, "anthropic-agent");
});

test("a run resumed after the machine's engine changed is checked and served on the engine it recorded", async () => {
  const { root, runDir, codename } = await startedAndFailed();
  const before = readFileSync(driverDir(runDir, "run-choices.json"), "utf8");
  // The machine now names an engine whose program is not on this box: had the resume used it, its first door or its
  // first turn would have failed.
  const res = await segment(root, { engine: "openai-agent", codename });
  assert.equal(res.ok, true, JSON.stringify(res).slice(0, 600));
  const delivered = res.runDir;   // a delivered run moves to the archive, so the resume's own folder is read
  assert.ok(existsSync(join(delivered, ".delivered")), "the resume did not deliver");
  assert.equal(readFileSync(driverDir(delivered, "run-choices.json"), "utf8"), before, "the resume rewrote the run's record");
  const rows = choicesRows(delivered);
  assert.equal(rows.length, 2, "each segment logs the record");
  assert.deepEqual({ state: rows[1].state, written: rows[1].written, engine: rows[1].engine, machineEngine: rows[1].machineEngine },
    { state: "recorded", written: false, engine: "anthropic-agent", machineEngine: "openai-agent" });
});

test("a run with no record resumes on the machine's engine and is given no record", async () => {
  const { root, runDir, codename } = await startedAndFailed();
  unlinkSync(driverDir(runDir, "run-choices.json"));
  const res = await segment(root, { codename });
  assert.equal(res.ok, true, JSON.stringify(res).slice(0, 600));
  assert.equal(existsSync(driverDir(res.runDir, "run-choices.json")), false, "the resume wrote a start nobody recorded");
  const last = choicesRows(res.runDir).at(-1);
  assert.equal(last.state, "none");
  assert.equal(last.written, false);
});

// A resume whose recorded choice this process cannot serve is PARKED: refused before any door runs or anything is
// cleared. The pipeline answers with the park, naming the dependency it waits for, and writes the run's `.postponed`
// marker with what the wait is on, what ends it and the identity a self-resume needs.
async function resumeParked(root, codename, runDir) {
  const res = await segment(root, { codename });
  assert.equal(res?.postponed, true, `the resume was not parked: ${JSON.stringify(res).slice(0, 400)}`);
  assert.equal(res.ok, false);
  assert.equal(res.runDir, runDir, "the park names another run");
  const marker = JSON.parse(readFileSync(join(runDir, ".postponed"), "utf8"));
  assert.equal(marker.kind, "run-choice");
  assert.deepEqual(marker.dependency, res.parkedFor, "the marker and the answer name different dependencies");
  assert.equal(marker.codename, codename, "the marker lacks the codename a self-resume needs");
  assert.ok(marker.job && marker.agent, "the marker lacks the job or the agent a self-resume needs");
  return { parkedFor: res.parkedFor, marker };
}
const unchanged = (runDir, before) => {
  assert.equal(events(runDir).filter((e) => e.event === "stage").length, before.stages, "a stage ran on another choice");
  assert.equal(existsSync(join(runDir, ".failed")), before.failed, "the run's markers were cleared");
  assert.equal(existsSync(join(runDir, ".delivered")), false);
};
const stateOf = (runDir) => ({ stages: events(runDir).filter((e) => e.event === "stage").length, failed: existsSync(join(runDir, ".failed")) });

test("a run whose recorded engine this driver does not have is parked by name and runs nothing", async () => {
  const { root, runDir, codename } = await startedAndFailed();
  writeFileSync(driverDir(runDir, "run-choices.json"), JSON.stringify({ schema: 1, engine: "probe-retired", register: null }));
  const before = stateOf(runDir);
  const { parkedFor } = await resumeParked(root, codename, runDir);
  assert.deepEqual({ kind: parkedFor.kind, recorded: parkedFor.recorded }, { kind: "engine", recorded: "probe-retired" });
  unchanged(runDir, before);
  assert.deepEqual(events(runDir).filter((e) => e.event === "run-choices-park").map((e) => e.kind), ["engine"]);
});

test("a run whose recorded register this runner lacks the credentials for is parked at the register's door, naming what is missing", async () => {
  const { root, runDir, codename } = await startedAndFailed();
  const rec = recordOf(runDir);
  assert.notEqual(rec.register, "signa", "the probe needs a register other than the machine's");
  writeFileSync(driverDir(runDir, "run-choices.json"), JSON.stringify({ ...rec, register: "signa" }));
  const saved = process.env.SIGNA_API_KEY;
  delete process.env.SIGNA_API_KEY;
  try {
    const before = stateOf(runDir);
    const { parkedFor, marker } = await resumeParked(root, codename, runDir);
    assert.deepEqual({ kind: parkedFor.kind, recorded: parkedFor.recorded, machine: parkedFor.machine }, { kind: "register", recorded: "signa", machine: rec.register });
    assert.match(parkedFor.detail ?? "", /missing SIGNA_API_KEY/, "the door's own words ride with the park");
    assert.match(marker.waitingOn, /the signa register/);
    assert.match(marker.resolvedBy, /the signa register's credentials and capabilities set for this runner/);
    unchanged(runDir, before);
  } finally { if (saved !== undefined) process.env.SIGNA_API_KEY = saved; }
});

// The tool servers' configuration each resumed turn was handed, from the mock engine's call log: every server given a
// register names one, so the set is the registers the turns could reach.
const registersHanded = (logFile) => {
  const out = new Set();
  const lines = existsSync(logFile) ? readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean) : [];
  for (const line of lines) {
    const argv = JSON.parse(line).argv ?? [];
    const i = argv.indexOf("--mcp-config");
    if (i < 0) continue;
    const raw = argv[i + 1];
    const cfg = JSON.parse(raw.trim().startsWith("{") ? raw : readFileSync(raw, "utf8"));
    for (const s of Object.values(cfg.mcpServers ?? {})) if (s?.env?.CLEAROTRON_DATABASE) out.add(s.env.CLEAROTRON_DATABASE);
  }
  return { turns: lines.length, registers: [...out] };
};

test("a run whose recorded register is not the machine's is served on its own register where this runner can serve it", async () => {
  const { root, runDir, codename } = await startedAndFailed();
  const rec = recordOf(runDir);
  assert.notEqual(rec.register, "uspto-local", "the probe needs a register other than the machine's");
  writeFileSync(driverDir(runDir, "run-choices.json"), JSON.stringify({ ...rec, register: "uspto-local" }));
  // The local register reads a database file and never the network; an empty file is enough for its door.
  const db = join(root, "uspto-local.sqlite");
  writeFileSync(db, "");
  const callLog = join(root, "calls.jsonl");
  pinEnv(process.env, "USPTO_LOCAL_DB", db);
  pinEnv(process.env, "MOCK_CLAUDE_CALL_LOG", callLog);
  try {
    // The resumed stage fails again where the first segment did, so the turn it runs is the evidence and nothing
    // the first segment wrote under the machine's register is delivered under the run's.
    const res = await segment(root, { codename, fail: FAIL_LATE });
    assert.notEqual(res?.postponed, true, `the run was parked rather than served: ${JSON.stringify(res).slice(0, 400)}`);
    const at = res?.runDir ?? runDir;   // a run that fails again is moved, so the resume's own folder is read
    assert.equal(existsSync(join(at, ".postponed")), false, "the run was parked rather than served");
    const last = choicesRows(at).at(-1);
    assert.deepEqual({ register: last.register, machineRegister: last.machineRegister, registerDiffers: last.registerDiffers },
      { register: "uspto-local", machineRegister: rec.register, registerDiffers: true });
    const handed = registersHanded(callLog);
    assert.ok(handed.turns > 0, "the resume ran no turn");
    assert.deepEqual(handed.registers, ["uspto-local"], "a resumed turn's tool servers were handed a register other than the run's");
  } finally {
    pinEnv(process.env, "USPTO_LOCAL_DB", undefined);
    pinEnv(process.env, "MOCK_CLAUDE_CALL_LOG", undefined);
  }
});

test("a run whose recorded engine's program is not installed here is parked; a run with no record meets that door as before", async () => {
  const { root, runDir, codename } = await startedAndFailed();
  writeFileSync(driverDir(runDir, "run-choices.json"), JSON.stringify({ ...recordOf(runDir), engine: "openai-agent" }));
  const before = stateOf(runDir);
  pinEnv(process.env, "CLEAROTRON_CODEX_PATH", join(root, "no-such-program", "codex"));
  try {
    const { parkedFor } = await resumeParked(root, codename, runDir);
    assert.deepEqual({ kind: parkedFor.kind, recorded: parkedFor.recorded }, { kind: "engine-program", recorded: "openai-agent" });
    assert.ok(parkedFor.detail, "the door's own words ride with the park");
    unchanged(runDir, before);
  } finally { pinEnv(process.env, "CLEAROTRON_CODEX_PATH", undefined); }
});

test("the run's register is decided once at its opening, from its record", async () => {
  const { registerForRun } = await import("../engine/run-choices.mjs");
  const { registerCapabilities } = await import("../register-unreachable.mjs");
  const { runDir } = await startedAndFailed();
  assert.equal(registerForRun(runDir), recordOf(runDir).register, "the run's register is the one it recorded");
  assert.deepEqual(registerCapabilities(recordOf(runDir).register), registerCapabilities(), "naming the machine's register changes nothing");
});
