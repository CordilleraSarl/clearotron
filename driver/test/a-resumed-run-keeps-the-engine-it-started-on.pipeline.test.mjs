// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A RESUMED RUN KEEPS THE ENGINE IT STARTED ON, end to end through the run's opening step.
//
// A run records its engine and register when it starts. Resumed after the machine's engine setting changed, it is
// checked and served on the engine it recorded, and every segment logs the record beside the machine's setting. A run
// that has no record is resumed on the machine's engine and is given no record. A run whose recorded engine this driver
// does not have is refused by name and runs nothing. The mark and the requester are invented.
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
  ref: "TMP8440", markName: "PROJECT VELMORAX", classes: [9, 41], provider: "corsearch" };
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

test("a run whose recorded engine this driver does not have is refused by name and runs nothing", async () => {
  const { root, runDir, codename } = await startedAndFailed();
  writeFileSync(driverDir(runDir, "run-choices.json"), JSON.stringify({ schema: 1, engine: "probe-retired", register: null }));
  const stagesBefore = events(runDir).filter((e) => e.event === "stage").length;
  let refused = null;
  try {
    const res = await segment(root, { codename });
    refused = res.ok === false ? JSON.stringify(res) : null;
  } catch (e) { refused = String(e?.message ?? e); }
  assert.match(refused ?? "", /started on the \\?"probe-retired\\?" engine, which this driver does not have registered/);
  assert.equal(events(runDir).filter((e) => e.event === "stage").length, stagesBefore, "a stage ran on another engine");
  assert.equal(existsSync(join(runDir, ".delivered")), false);
});
