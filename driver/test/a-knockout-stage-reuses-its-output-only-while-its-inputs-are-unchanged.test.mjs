// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the Knockout lane twice over one run folder on the mock engine
//
// A KNOCKOUT STAGE REUSES ITS OUTPUT ONLY WHILE ITS INPUTS ARE UNCHANGED, AS A CLEARANCE STAGE DOES.
//
// On a resume, a Knockout stage whose output existed and validated was skipped, and nothing asked whether the files it
// read had changed since. So a Knockout resumed after an upstream output was recomputed could deliver an assessment of
// the old plan. Each stage now records what it read when it runs, through the clearance's own stamps, and a resume runs
// it again when any of that has changed, or when it holds no record of what it read.
//
// The resume here is a second pass over the first pass's own folder, with the publish record taken away so the pass
// runs to the end. Nothing dials a register or the web: every executor is injected, and the engine is the mock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), "knockout-stage-freshness-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || join(ROOT, "ws"));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool"));
pinEnv(process.env, "CLEAROTRON_DATABASE", "signa");
pinEnv(process.env, "CLEAROTRON_REGISTER_CALL_LOG", join(ROOT, "register-calls.jsonl"));
pinEnv(process.env, "CLEAROTRON_REGISTER_RECORD_LOG", undefined);
pinEnv(process.env, "CLEAROTRON_SIGNA_ANSWER_MEMORY", undefined);
pinEnv(process.env, "CLEAROTRON_INSTRUCTIONS_DIR", undefined);
process.env.CLEAROTRON_AI = "anthropic-agent";
pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", join(HERE, "mock-claude.mjs"));
process.env.CLEAROTRON_MAX_RETRIES = "0";
process.env.CLEAROTRON_RECOVERY_MAX = "0";
process.env.MOCK_VERDICT = "CLEAR";
process.env.MOCK_SKEPTIC = "no flags surfaced";

const { driverDir } = await import("../../shared/driver-dir.mjs");
const { knockoutInner } = await import("../pipeline-knockout.mjs");
const { answeredGrid } = await import("./knockout-grid-fixture.mjs");

const FILING = { record_id: "tm_1", mark_text: "LANTERNWICK", owner_name: "Brightmoor Candle Co", status: "Registered", classes: [4] };
const JOB = { markName: "LANTERNWICK", marks: [{ name: "LANTERNWICK" }], classes: [4], jurisdictions: ["EU"], forwarder: "jordan" };
const EXECUTORS = {
  recordLister: async (term) => ({ ok: true, total: null, records: term === "LANTERNWICK" ? [FILING] : [] }),
  countExecutor: async () => ({ ok: true, total: 3 }),
  gridExecutor: async (spec) => answeredGrid(spec, [{ title: "Lanternwick candles", url: "https://example.test/lanternwick" }]),
  sweepExecutor: async () => ({ ok: true, text: "Brightmoor sells candles. https://example.test/brightmoor" }),
};

/** One pass of the Knockout lane over `dir`, archiving to `archiveDir`. */
async function pass(codename, dir, archiveDir) {
  const id = `ko-${codename}`;
  const studioRoot = join(ROOT, "studio", id);
  const run = { runDir: dir, studioRoot, slug: "lanternwick", date: "2026-11-11", codename, archiveDir };
  const job = { ...structuredClone(JOB), id, msgId: `<${id}@x>`, ref: `E2E-${codename}` };
  const ctx = { run, job, agent: "mailagent", paths: { runDir: dir }, profile: {}, stateReset: true,
    searchPolicy: { level: "knockout-register", stageLabel: "Knockout + register", components: { registerProbe: true } } };
  const res = await knockoutInner(ctx, job, EXECUTORS);
  assert.equal(res?.ok, true, `the Knockout did not deliver: ${JSON.stringify(res)}`);
  return res;
}

const journal = (runDir) => readFileSync(driverDir(runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

/**
 * A first pass to delivery, then a second over the same folder after `change` ran on it, as a resume does. The run is
 * kept in place: its archive path sits under a file, so the archive's move fails and, as it is non-fatal, the run stays.
 * Returns the second pass's journal rows, which follow the first pass's in run.jsonl.
 */
async function resumedAfter(codename, change = () => {}) {
  const studio = join(ROOT, "studio", `ko-${codename}`, "clearance-search");
  mkdirSync(studio, { recursive: true });
  const blocked = join(studio, "not-a-folder");
  writeFileSync(blocked, "the archive cannot be made under a file\n");
  const dir = join(studio, "runs", "lanternwick", `2026-11-11-${codename}`);
  await pass(codename, dir, join(blocked, "first"));
  assert.ok(readdirSync(dir).includes(".delivered"), "premise: the first pass delivered and stayed in place");
  for (const f of [".published", ".delivered"]) rmSync(join(dir, f), { force: true });
  const before = journal(dir).length;
  change(dir);
  await pass(codename, dir, join(blocked, "second"));
  return { rows: journal(dir).slice(before), runDir: dir };
}
const ran = (rows) => rows.filter((r) => r.event === "stage" && r.lane === "knockout").map((r) => r.stage);
const reused = (rows) => rows.filter((r) => r.event === "skip" && r.lane === "knockout").map((r) => r.stage);

test("a Knockout resumed with nothing changed runs no stage again", async () => {
  const { rows } = await resumedAfter("unchanged");
  assert.deepEqual(ran(rows), [], `a stage ran again with nothing changed: ${JSON.stringify(rows.filter((r) => r.event === "stage-stale"))}`);
  assert.ok(reused(rows).includes("knockout-assess#0"), `premise: the second pass reached the rating and reused it: ${reused(rows)}`);
});

test("a Knockout whose plan changed after its rating rates again, and says what changed", async () => {
  const { rows } = await resumedAfter("plan-moved", (dir) => {
    const plan = JSON.parse(readFileSync(join(dir, "knockout-plan.json"), "utf8"));
    plan.marks[0].contextFraming = `${plan.marks[0].contextFraming ?? ""} Also sold as a gift set.`.trim();
    writeFileSync(join(dir, "knockout-plan.json"), JSON.stringify(plan, null, 2) + "\n");
  });
  assert.ok(reused(rows).includes("knockout-frame"), "the frame wrote the plan and read none of it: it is reused");
  assert.ok(ran(rows).includes("knockout-assess#0"), `the rating of the old plan was reused: ${JSON.stringify(rows.filter((r) => /stage/.test(r.event)).map((r) => [r.event, r.stage]))}`);
  const stale = rows.find((r) => r.event === "stage-stale" && r.stage === "knockout-assess#0");
  assert.ok(stale?.changed?.some((c) => c.name === "knockout-plan.json"), `the stale row names the plan: ${JSON.stringify(stale)}`);
});

test("a Knockout stage that holds no record of what it read runs again, since its freshness is unknown", async () => {
  const { rows } = await resumedAfter("no-record", (dir) => {
    const records = readdirSync(driverDir(dir, "stage-inputs")).filter((f) => f.startsWith("knockout-assess"));
    assert.ok(records.length > 0, "premise: the first pass recorded what its rating read");
    for (const f of records) rmSync(driverDir(dir, "stage-inputs", f));
  });
  assert.ok(ran(rows).includes("knockout-assess#0"), "an output with no record of its inputs is not reused");
  const stale = rows.find((r) => r.event === "stage-stale" && r.stage === "knockout-assess#0");
  assert.equal(stale?.reason, "no record of the inputs it was produced from");
});

// ── THE REVIEW ROUND ─────────────────────────────────────────────────────────────────────────────────────────────
// The check raises a material defect, the rating step corrects it, and a second look reads the corrected record.
const DEFECT = { kind: "contradiction", mark: "LANTERNWICK", finding: 1, problem: "The first conflict is rated below what its own evidence shows." };
const ROUND = { MOCK_KO_MATERIAL: JSON.stringify([DEFECT]), MOCK_KO_CORRECTED_BAND: "High" };
async function withEnv(env, fn) {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  try { return await fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

test("a Knockout resumed after its review round, with nothing changed, neither reviews nor corrects again", async () => {
  const { rows } = await withEnv(ROUND, () => resumedAfter("round-unchanged"));
  assert.deepEqual(ran(rows), [], `a stage ran again with nothing changed: ${JSON.stringify(rows.filter((r) => r.event === "stage-stale"))}`);
  assert.ok(reused(rows).includes("knockout-correct#0") && reused(rows).includes("knockout-review#1"),
    `premise: the first pass ran a correction and a second look, and the resume reused both: ${reused(rows)}`);
  assert.ok(!rows.some((r) => r.event === "knockout-review-round-set-aside"));
});

test("a chunk rated again on a resume sets aside the round begun on its old rating, and the new rating is reviewed", async () => {
  const { rows, runDir } = await withEnv(ROUND, () => resumedAfter("round-obsolete", (dir) => {
    const plan = JSON.parse(readFileSync(join(dir, "knockout-plan.json"), "utf8"));
    plan.marks[0].contextFraming = `${plan.marks[0].contextFraming ?? ""} Also sold as a gift set.`.trim();
    writeFileSync(join(dir, "knockout-plan.json"), JSON.stringify(plan, null, 2) + "\n");
  }));
  const setAside = rows.find((r) => r.event === "knockout-review-round-set-aside");
  assert.equal(setAside?.why, "a chunk was rated again on this pass", JSON.stringify(setAside));
  assert.ok(setAside.moved.includes("knockout-correction-work.json"), `the round's work is set aside: ${setAside.moved}`);
  for (const stage of ["knockout-assess#0", "knockout-review", "knockout-correct#0", "knockout-review#1"])
    assert.ok(ran(rows).includes(stage), `${stage} did not run on the new rating: ${ran(rows)}`);
  const kept = readdirSync(driverDir(runDir, "knockout-review-set-aside"));
  assert.equal(kept.length, 1, "the earlier round is kept, set aside, not deleted");
});
