// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the mock clearance pipeline over two runs, each parked and then resumed
//
// A PLACEMENT PASS WHOSE FLOOR DUTY IS UNDISCHARGED RUNS AGAIN ON A RESUME, HOWEVER VALID ITS OUTPUT.
//
// A parked run once resumed with its placement output present and passing its own validator while the delivery floor
// called that pass's duty undischarged. The stage was reused as "present and valid", the seat was never asked again,
// and the run spent hours travelling toward a failure it could not avoid (floor-duty.mjs, floorDutyBlocksSkip). This was
// held by a pin on the skip condition's source text. It is held here by the behaviour instead: a run parks after its
// placement pass, its recorded duty is left undischarged, and the resume must dispatch the pass again over a kept copy.
// The control resumes the same state with the duty discharged, and the pass is reused.
//
// Nothing is billed: the engine is the mock, and the register is served offline. Every mark is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { envFrom, pinEnv } from "../../shared/env-aliases.mjs";
import { armFloorDuty, floorDutyBlocksSkip, FLOOR_DUTY_STAGE } from "../floor-duty.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
const ROOT = mkdtempSync(join(tmpdir(), "clearotron-floor-duty-resume-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || join(ROOT, "work"));
pinEnv(process.env, "CLEAROTRON_REGISTER_CALL_LOG", join(ROOT, "register-calls.jsonl"));
pinEnv(process.env, "CLEAROTRON_REPORTS_URL", envFrom(process.env, "CLEAROTRON_REPORTS_URL") || "https://trademark.test");
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
const PROFILES = mkdtempSync(join(tmpdir(), "clearotron-profiles-floor-duty-resume-"));
cpSync(join(HERE, "..", "profiles"), PROFILES, { recursive: true });
pinEnv(process.env, "CLEAROTRON_CUSTOMERS_DIR", PROFILES);

/** A phrase only the reading step's turn carries: it runs after the placement pass, so failing it parks the run there. */
const READING_TURN = "You are register DIGEST mode";
/** A recorded duty the seat has not discharged: one floor no placement answered. */
const UNDISCHARGED = { computable: true, undischarged_by_seat: 1,
  totals: { floors: 3, named_without_ground: 0, unanswerable: 0 },
  rows: [{ disposition: "unanswered", mark: "NOVAPULSO", record_id: "/mark/em/INVENTED-1" }] };
const DISCHARGED = { computable: true, undischarged_by_seat: 0, totals: { floors: 3, named_without_ground: 0, unanswerable: 0 }, rows: [] };

const readEvents = (runDir) => readFileSync(driverDir(runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const rowsOf = (events, event, stage = FLOOR_DUTY_STAGE) => events.filter((e) => e.event === event && e.stage === stage);

async function pass(job, env, codename = null) {
  for (const k of ["MOCK_VERDICT", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE"]) delete process.env[k];
  for (const [k, v] of Object.entries({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_REPORTS_DIR: join(ROOT, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", ...env })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...job }, { ...(codename ? { codename } : {}) });
  return { res, events: readEvents(res.runDir) };
}

/** One run parked after its placement pass, its recorded duty set to `duty`, then resumed: the resume's own rows. */
async function parkAndResume(id, duty) {
  const job = { id, msgId: `<${id}@x>`, forwarder: "jordan", forwarderDomain: "example.com", ref: `TMP-${id}`,
    markName: "NOVAPULSE", classes: [9, 41], provider: "corsearch" };
  const p1 = await pass(job, { MOCK_FAIL_STAGE: READING_TURN, CLEAROTRON_RECOVERY_MAX: "1" });
  const runDir = p1.res.runDir;
  const status = JSON.parse(readFileSync(join(runDir, "status.json"), "utf8"));
  assert.equal(status.failedStage, "register-digest", `premise: the run parked at the reading step (at ${status.failedStage})`);
  const placed = rowsOf(p1.events, "stage").at(-1);
  assert.equal(placed?.ok, true, "premise: the placement pass succeeded before the run parked");
  assert.equal(placed.output?.present, true, "premise: the placement pass's output is on disk");

  armFloorDuty(runDir);
  writeFileSync(driverDir(runDir, "floor-duty.json"), JSON.stringify(duty, null, 2) + "\n");
  assert.equal(floorDutyBlocksSkip(runDir, FLOOR_DUTY_STAGE), duty === UNDISCHARGED, "premise: the recorded duty reads as set");

  const p2 = await pass(job, {}, status.codename);
  return { ev2: p2.events.slice(p1.events.length), res: p2.res };
}

test("a resume dispatches a placement pass whose recorded floor duty is undischarged, and reuses one whose duty is discharged", async () => {
  // CONTROL: the same parked state with the duty discharged. The pass is reused, so the arm below is about the duty alone.
  const control = await parkAndResume("floor-duty-discharged", DISCHARGED);
  assert.equal(rowsOf(control.ev2, "skip").length, 1, `the control's placement pass was not reused: ${JSON.stringify(control.ev2.filter((e) => e.stage === FLOOR_DUTY_STAGE))}`);
  assert.deepEqual(rowsOf(control.ev2, "stage"), [], "the control's placement pass ran again with nothing owed");
  assert.deepEqual(rowsOf(control.ev2, "stage-floor-duty-rerun"), []);

  const owed = await parkAndResume("floor-duty-undischarged", UNDISCHARGED);
  assert.deepEqual(rowsOf(owed.ev2, "skip"), [],
    "the placement pass was reused as present and valid while its floor duty was undischarged: the seat is never asked again");
  assert.equal(rowsOf(owed.ev2, "stage-floor-duty-rerun").length, 1, "the resume did not say why the pass runs again");
  const rerun = rowsOf(owed.ev2, "stage");
  assert.equal(rerun.length, 1, `the placement pass was not dispatched again: ${JSON.stringify(rerun)}`);
  assert.equal(rerun[0].ok, true);
  // The pass it replaced is kept, as every overwrite keeps it.
  const snap = rowsOf(owed.ev2, "output-snapshot")[0];
  assert.ok(snap, "the placement pass was run again over its output with nothing kept");
  assert.ok(existsSync(join(owed.res.runDir, "_history", snap.snapshot)), "the kept copy is not where its row says");
});
