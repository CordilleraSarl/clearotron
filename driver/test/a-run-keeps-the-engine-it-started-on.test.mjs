// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A RUN KEEPS THE ENGINE IT STARTED ON.
//
// The engine used to be read from the machine's setting at every activation, so a run parked on one engine and
// resumed after the setting changed carried on under the other. A run now records its engine and register when it
// starts, and every turn it runs goes to the recorded engine. A run with no record runs on the machine's engine as
// before and is given no record after the fact. A recorded engine this driver cannot serve stops the stage by name;
// no turn reaches another engine in its place. The probe engines here are invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";

process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
const ROOT = mkdtempSync(join(tmpdir(), "run-keeps-engine-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool"));
process.env.CLEAROTRON_RETRY_BACKOFF_MS = "0";
const GW = await import("../gateway.mjs");
const RC = await import("../engine/run-choices.mjs");

const turns = [];
let stageFile = null;   // the file the stage under test expects; each probe turn writes it, as a writer would
for (const name of ["probe-started", "probe-machine"]) {
  GW.registerEngine({ name, async runTurn() {
    turns.push(name);
    writeFileSync(stageFile, "# Narrative\n\nAn invented narrative.\n");
    return { code: 0, killed: false, wall: 1, stdout: "", stderr: "", laneWaitMs: 0,
      json: { status: "ok", runId: `${name}-1` }, usage: { input: 10, output: 5 }, sessionRef: `${name}-s` };
  } });
}

const newRun = (tag) => {
  const runDir = mkdtempSync(join(ROOT, `${tag}-`));
  mkdirSync(driverDir(runDir), { recursive: true });
  return runDir;
};
const withEnv = async (vars, fn) => {
  const prev = {};
  for (const [k, v] of Object.entries(vars)) { prev[k] = process.env[k]; pinEnv(process.env, k, String(v)); }
  try { return await fn(); } finally { for (const [k, v] of Object.entries(prev)) pinEnv(process.env, k, v); }
};
// One stage on `runDir`, with the machine set to probe-machine. The turn writes the stage's file, so the stage passes.
async function stageOn(runDir) {
  const out = join(runDir, "narrative.md");
  stageFile = out;
  turns.length = 0;
  const r = await withEnv({ CLEAROTRON_AI: "probe-machine", CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0" }, () =>
    GW.runStage("synthesis", { agent: "mailagent", message: "go", model: "haiku", sessionKey: "clearance-keeps", timeoutSec: 60,
      runDir, expectFile: [out] }));
  return { r, turns: [...turns] };
}

test("the record holds the engine and register names only, and a second write keeps the first", () => {
  const runDir = newRun("record");
  const first = RC.recordRunChoices(runDir, { engine: "Probe-Started", register: "corsearch" });
  assert.deepEqual(first, { written: true, state: "recorded", engine: "probe-started", register: "corsearch" });
  assert.deepEqual(JSON.parse(readFileSync(driverDir(runDir, RC.RUN_CHOICES_FILE), "utf8")),
    { schema: 1, engine: "probe-started", register: "corsearch" }, "nothing beyond the two names is written");
  const again = RC.recordRunChoices(runDir, { engine: "probe-machine", register: null });
  assert.equal(again.written, false);
  assert.equal(again.engine, "probe-started", "a run's first choice is never rewritten");
  assert.deepEqual(RC.readRunChoices(runDir), { state: "recorded", engine: "probe-started", register: "corsearch" });
});

test("only a registered engine and a known register can be recorded, so no other string reaches the record", () => {
  const runDir = newRun("refused");
  assert.throws(() => RC.recordRunChoices(runDir, { engine: "invented-credential-value", register: "corsearch" }), /not an engine this driver has registered/);
  assert.throws(() => RC.recordRunChoices(runDir, { engine: "probe-started", register: "invented-credential-value" }), /not a register this driver knows/);
  assert.deepEqual(RC.readRunChoices(runDir), { state: "none" }, "a refused write leaves no record");
  assert.equal(RC.recordRunChoices(runDir, { engine: "probe-started", register: null }).register, null,
    "a machine with no register set is recorded as having none");
});

test("a record that does not read back is named as unreadable, not taken as absent", () => {
  const bad = newRun("unparsed");
  writeFileSync(driverDir(bad, RC.RUN_CHOICES_FILE), "{ not json");
  assert.equal(RC.readRunChoices(bad).state, "unreadable");
  const blank = newRun("blank");
  writeFileSync(driverDir(blank, RC.RUN_CHOICES_FILE), JSON.stringify({ schema: 1, engine: "", register: "corsearch" }));
  assert.deepEqual(RC.readRunChoices(blank), { state: "unreadable", detail: "names no engine" });
  assert.deepEqual(RC.readRunChoices(null), { state: "none" });
});

test("a run that recorded its engine runs every turn on it after the machine's setting changed", async () => {
  const runDir = newRun("started");
  RC.recordRunChoices(runDir, { engine: "probe-started", register: "corsearch" });
  const { r, turns: served } = await stageOn(runDir);
  assert.equal(r?.ok, true, `the stage failed: ${r?.fail ?? "(no fail recorded)"}`);
  assert.deepEqual(served, ["probe-started"], "a turn went to the machine's engine instead of the run's");
});

test("a run with no record runs on the machine's engine, as before, and is given no record", async () => {
  const runDir = newRun("unrecorded");
  const { r, turns: served } = await stageOn(runDir);
  assert.equal(r?.ok, true, `the stage failed: ${r?.fail ?? "(no fail recorded)"}`);
  assert.deepEqual(served, ["probe-machine"]);
  assert.deepEqual(RC.readRunChoices(runDir), { state: "none" }, "running a stage wrote a record the run never made");
});

test("a recorded engine this driver cannot serve, or an unreadable record, stops the stage by name and runs no turn", async () => {
  const gone = newRun("gone");
  writeFileSync(driverDir(gone, RC.RUN_CHOICES_FILE), JSON.stringify({ schema: 1, engine: "probe-retired", register: "corsearch" }));
  await assert.rejects(stageOn(gone), /started on the "probe-retired" engine, which this driver does not have registered.*rather than switch to probe-machine/);
  assert.deepEqual(turns, [], "a turn reached the machine's engine in the run's place");
  const bad = newRun("bad");
  writeFileSync(driverDir(bad, RC.RUN_CHOICES_FILE), "{ not json");
  await assert.rejects(stageOn(bad), /engine record \(_driver\/run-choices\.json\) does not parse/);
  assert.deepEqual(turns, []);
});
