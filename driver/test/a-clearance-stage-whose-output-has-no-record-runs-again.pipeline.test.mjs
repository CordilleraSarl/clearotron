// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the mock clearance pipeline twice over one run, the second time as a resume
//
// A CLEARANCE STAGE WHOSE OUTPUT HAS NO RECORD OF WHAT IT WAS MADE FROM RUNS AGAIN, AND BUYS NO REGISTER ANSWER AGAIN.
//
// A stage records what it read when it succeeds, and a resume reuses its output only while that is unchanged. An output
// with no record at all was reused, though nothing could say what it was made from: its stage had stopped between
// writing it and recording it, or it was made before the record existed. A Knockout runs such a stage again, and so
// does a clearance now. Running a register unit again does not buy its answers again: the executor reuses every answer
// the run holds to the same question, from the band or from a band a parked pass left.
//
// The first pass parks at the reading step, so every stage before it holds its output and its record. Every register
// question is counted at a stand-in register behind the real executor. Every mark is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, cpSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { envFrom, pinEnv } from "../../shared/env-aliases.mjs";
import { makeExecutePlan } from "../../providers/_shared/execute-plan.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
const ROOT = mkdtempSync(join(tmpdir(), "clearotron-unrecorded-output-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || join(ROOT, "work"));
pinEnv(process.env, "CLEAROTRON_REGISTER_CALL_LOG", join(ROOT, "register-calls.jsonl"));
pinEnv(process.env, "CLEAROTRON_REPORTS_URL", envFrom(process.env, "CLEAROTRON_REPORTS_URL") || "https://trademark.test");
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
const PROFILES = mkdtempSync(join(tmpdir(), "clearotron-profiles-unrecorded-"));
cpSync(join(HERE, "..", "profiles"), PROFILES, { recursive: true });
pinEnv(process.env, "CLEAROTRON_CUSTOMERS_DIR", PROFILES);

const PARK_AT_DIGEST = "You are register DIGEST mode";
const parkedAt = (res) => JSON.parse(readFileSync(join(res.runDir, "status.json"), "utf8")).failedStage;
const readEvents = (runDir) => readFileSync(driverDir(runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

/** The real executor, behind a stand-in register that counts every question, served to the pipeline as an adapter is. */
function countingRegister() {
  const sent = [];
  const reply = (obj) => ({ type: "text", text: JSON.stringify(obj) });
  const exec = makeExecutePlan({
    search: async (_a, p) => { sent.push(`count:${p.name}`); return reply({ total_hits: 12000, results: [] }); },
    enumerate: async (_a, p) => { sent.push(p.name); return reply({ state: "enumerated", total_hits: 1, count: 1, records: [{ record_id: `/mark/us/${p.name}`, mark_text: p.name, classes: [9], status: "Registered" }] }); },
    capabilities: { id: "a-register-that-needs-no-office" },
  });
  const planExecutor = async ({ planPath, axis, outputPath, qids }, { sessionKey, recordLog = null } = {}) => {
    const r = await exec("auth", { plan_path: planPath, axis, output_path: outputPath, ...(Array.isArray(qids) && qids.length ? { qids } : {}) },
      { kind: "execute_plan", sessionKey, recordLog });
    const text = String(r?.text ?? "");
    if (text.startsWith("ERROR")) return { ok: false, cause: text.slice(0, 200) };
    const summary = JSON.parse(text);
    return { ok: true, states: summary.states ?? {}, executed: summary.executed, skipped: summary.skipped ?? [] };
  };
  return { sent, planExecutor };
}

async function pass(job, env, opts = {}, codename = null) {
  for (const k of ["MOCK_VERDICT", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE"]) delete process.env[k];
  for (const [k, v] of Object.entries({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_REPORTS_DIR: join(ROOT, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", ...env })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...job }, { ...(codename ? { codename } : {}), ...opts });
  return { res, events: readEvents(res.runDir) };
}
const jobFor = (id) => ({ id, msgId: `<${id}@x>`, forwarder: "jordan", forwarderDomain: "example.com", ref: `TMP-${id}`,
  markName: "NOVAPULSE", classes: [9, 41], provider: "corsearch" });
/** Pass 1, parked at the reading step: every stage before it has its output and its record. */
async function parkedRun(id, opts = {}, env = {}) {
  const p1 = await pass(jobFor(id), { ...env, MOCK_FAIL_STAGE: PARK_AT_DIGEST, CLEAROTRON_RECOVERY_MAX: "1" }, opts);
  assert.equal(parkedAt(p1.res), "register-digest", `premise: pass 1 parks at the reading step (parked at ${parkedAt(p1.res)})`);
  const codename = JSON.parse(readFileSync(join(p1.res.runDir, "status.json"), "utf8")).codename;
  return { ...p1, codename, job: jobFor(id) };
}
const ran = (events) => events.filter((e) => e.event === "stage").map((e) => e.stage);
const skipped = (events) => events.filter((e) => e.event === "skip").map((e) => e.stage);

test("a resumed clearance runs again the one stage whose output has no record of what it read, and says why", async () => {
  const p1 = await parkedRun("unrecorded-stage");
  assert.deepEqual(p1.events.filter((e) => e.event === "stage-stale"), [], "a first pass has no output to doubt, and doubts none");
  const stamp = driverDir(p1.res.runDir, "stage-inputs", "common-law-half:a.json");
  assert.ok(existsSync(stamp), "premise: the research half recorded what it read");
  rmSync(stamp);   // as when the pass stopped between writing the half's output and recording it
  const n1 = p1.events.length;
  const p2 = await pass(p1.job, {}, {}, p1.codename);
  assert.equal(p2.res.ok, true, JSON.stringify({ fail: p2.res.fail, stage: p2.res.failedStage }));
  const ev2 = p2.events.slice(n1);
  const stale = ev2.filter((e) => e.event === "stage-stale");
  assert.deepEqual(stale.map((e) => [e.stage, e.reason]), [["common-law-half:a", "no record of the inputs it was produced from"]]);
  assert.ok(ran(ev2).includes("common-law-half:a"), `the half with no record was reused: ran ${ran(ev2)}`);
  for (const other of ["matter-frame", "clearance-variants", "common-law-half:b", "common-law-half:m", "blind-frame"])
    assert.ok(skipped(ev2).includes(other), `${other} holds its record and is reused: skipped ${skipped(ev2)}`);
  assert.ok(existsSync(driverDir(p2.res.runDir, "stage-inputs", "common-law-half:a.json")), "and the half records what it read this time");
});

test("a register unit run again on the resume, its pass parked, buys none of the answers the run holds", async () => {
  const register = countingRegister();
  const env = { CLEAROTRON_SATPROBE_CODESIDE: "1" };
  const p1 = await parkedRun("parked-unit", { planExecutor: register.planExecutor }, env);
  const bought = register.sent.length;
  assert.ok(bought > 0, "premise: the code-side unit asked the register through the executor");
  const band = join(p1.res.runDir, "register-units", "saturation-probe-band.json");
  const answers = JSON.parse(readFileSync(band, "utf8")).filter((b) => b.qid).map(({ qid, state, total_hits }) => ({ qid, state, total_hits }));
  assert.ok(answers.length > 0, "premise: the unit's band holds its answers");
  // Parked as a killed pass is: the band renamed, the unit's output gone, so the resume runs the unit again.
  renameSync(band, `${band}.tainted-1`);
  rmSync(join(p1.res.runDir, "register-units", "saturation-probe.md"), { force: true });
  register.sent.length = 0;
  const n1 = p1.events.length;
  const p2 = await pass(p1.job, env, { planExecutor: register.planExecutor }, p1.codename);
  assert.equal(p2.res.ok, true, JSON.stringify({ fail: p2.res.fail, stage: p2.res.failedStage }));
  assert.ok(ran(p2.events.slice(n1)).includes("register-unit:saturation-probe"), "premise: the parked unit ran again");
  assert.deepEqual(register.sent, [], `the resume bought again an answer the run held: ${register.sent}`);
  const now = JSON.parse(readFileSync(join(p2.res.runDir, "register-units", "saturation-probe-band.json"), "utf8")).filter((b) => b.qid).map(({ qid, state, total_hits }) => ({ qid, state, total_hits }));
  assert.deepEqual(now, answers, "the unit's new band holds the answers its parked band held");
});
