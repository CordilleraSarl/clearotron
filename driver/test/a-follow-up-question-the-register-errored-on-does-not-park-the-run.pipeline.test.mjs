// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives a mock pipeline whose escalation proposes questions the register errors on, on both engines
//
// A FOLLOW-UP QUESTION THE REGISTER ERRORED ON DOES NOT PARK THE RUN.
//
// The skeptic escalates an axis, its re-run proposes three narrower questions, and the register answers each with an
// outage. Before, nothing asked them again before the reading step: the axis read unexecuted, the reading step's clean
// rows on it were refused, and the run parked for its resumes to ask them. Now the run asks each of them again by code in
// the same pass. Where the register still errors, each is delivered as not searched with the register's error; where it
// now answers, each is executed. Either way the run delivers in one pass, and the executor stand-in counts every
// question it was sent, so the cost of the repair is measured here, not stated. Own file = own process + own workspace
// root, pinned before any driver module loads, so driver modules are imported dynamically. Every mark is invented.
import { mkdtempSync as __mkdtemp } from "node:fs";
import { envFrom, pinEnv } from "../../shared/env-aliases.mjs";
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || __mkdtemp(__join(__tmpdir(), "clearotron-testroot-")));
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { MOCK_OUTAGE_REASON } from "./mock-stage-fixtures.mjs";

const TEMP_DIRS = [];
after(() => { for (const d of TEMP_DIRS) rmSync(d, { recursive: true, force: true }); });
const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
const CODEX = join(HERE, "mock-codex.mjs");
chmodSync(CLAUDE, 0o755);
chmodSync(CODEX, 0o755);
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";

const JOB = { id: "test-job-follow-up-reask", msgId: "<follow-up-reask@x>", forwarder: "requester", forwarderDomain: "example.com",
  ref: "TMP8240", markName: "QZELVOR", classes: [9], provider: "corsearch" };
const ENGINES = {
  claude: { CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE },
  codex: { CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: CODEX, CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-codex-dummy" },
};
const KEYS = ["CLEAROTRON_CLAUDE_PATH", "CLEAROTRON_CODEX_PATH", "CLEAROTRON_AI_BILLING", "CODEX_API_KEY", "MOCK_VERDICT", "MOCK_SKEPTIC",
  "MOCK_FAIL_STAGE", "MOCK_ESCALATION_PROPOSES_ERRORED"];
const AXIS = "primary-sweep";
const ESCALATE = `- ${AXIS} narrower spellings look thin\n\n## Escalation decisions\nESCALATE: ${AXIS} — sweep the narrower spellings`;

// The executor stand-in: every question it is sent is recorded; a named question is answered with `answer(qid)`, written
// into the axis band as the executor merges it. A whole-axis recheck leaves the band as it stands.
function standIn(answer) {
  const asked = [];
  const run = async ({ axis, outputPath, qids }) => {
    asked.push({ axis, qids: qids ? [...qids] : null });
    if (!qids?.length) return { ok: true };
    const blocks = qids.map(answer);
    let have = [];
    try { have = JSON.parse(readFileSync(outputPath, "utf8")); } catch { have = []; }
    writeFileSync(outputPath, JSON.stringify([...blocks, ...have.filter((b) => !qids.includes(b?.qid))], null, 2) + "\n");
    return { ok: true };
  };
  return { run, asked };
}
const outage = (qid) => ({ state: "incomplete", qid, query: qid, total_hits: 0, fetched: 0, sample: [], error: true, reason: MOCK_OUTAGE_REASON });
const answered = (qid) => ({ state: "enumerated", qid, query: qid, total_hits: 0, count: 0, records: [] });

async function runOnce(engine, answer) {
  const root = mkdtempSync(join(tmpdir(), "clearotron-follow-up-reask-"));
  TEMP_DIRS.push(root);
  for (const k of KEYS) delete process.env[k];
  for (const [k, v] of Object.entries({ ...ENGINES[engine], CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: ESCALATE, MOCK_ESCALATION_PROPOSES_ERRORED: AXIS }))
    pinEnv(process.env, k, v);
  const ex = standIn(answer);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB }, { planExecutor: ex.run });
  const rd = res.runDir;
  const events = readFileSync(driverDir(rd, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const sidecar = join(rd, "register-units", `${AXIS}-supplemental-plan.json`);
  const followUps = existsSync(sidecar) ? JSON.parse(readFileSync(sidecar, "utf8")).entries.map((e) => e.qid) : [];
  const timesAsked = (q) => ex.asked.filter((a) => a.qids?.includes(q)).length;
  return { res, rd, events, followUps, timesAsked, receipt: JSON.parse(readFileSync(driverDir(rd, "plan-execution.json"), "utf8")) };
}

function deliveredInOnePass({ res, rd, events }) {
  assert.equal(res.ok, true, JSON.stringify({ fail: res.fail, stage: res.failedStage }));
  assert.ok(existsSync(join(rd, ".delivered")), "the run did not deliver");
  assert.deepEqual(events.filter((e) => /^(auto-recovery-parked|park-resumed|digest-flush-failed|stage-failure)$/.test(e.event)).map((e) => e.event), [],
    "the run parked or failed a reading step over the follow-up questions");
}

for (const engine of Object.keys(ENGINES)) {
  test(`${engine}: a follow-up question still erroring is asked again in the pass and delivered as not searched, with the register's error`, async () => {
    const r = await runOnce(engine, outage);
    assert.ok(r.events.some((e) => e.event === "stage" && e.stage === `register-unit:${AXIS}` && e.trigger === "escalation"), "guard: the escalation never re-ran the axis");
    assert.equal(r.followUps.length, 3, "guard: the escalation proposed no follow-up questions");
    const reask = r.events.find((e) => e.event === "follow-up-reask" && e.site === "escalation");
    assert.ok(reask, "the follow-up questions were not asked again");
    assert.deepEqual(reask.rows.map((x) => [x.axis, x.sent, x.answered, x.still_erroring]), [[AXIS, 3, 0, 3]]);
    // THE COST, MEASURED: the re-ask sends each question once; the deferral's own settle step, which every deferred
    // provider error gets once per run, sends it once more. Nothing else sends it.
    assert.deepEqual(r.followUps.map(r.timesAsked), [2, 2, 2], `each follow-up question went to the register: ${r.followUps.map(r.timesAsked)}`);
    const repairs = r.events.filter((e) => e.event === "repair-attempted" && e.target === AXIS).map((e) => e.repair);
    assert.ok(repairs.includes("follow-up-reask:escalation") && repairs.includes("early-envelope-close"), JSON.stringify(repairs));
    for (const q of r.followUps) {
      assert.ok(!r.receipt.missing.includes(q), `${q} is still missing`);
      const d = (r.receipt.deferred ?? []).find((x) => x.qid === q);
      assert.ok(d, `${q} is not delivered as not searched`);
      assert.match(d.reason, /HTTP 503/, "the deferral does not carry the register's own error");
    }
    deliveredInOnePass(r);
  });

  test(`${engine}: a follow-up question the register now answers is asked again once and executed`, async () => {
    let first = true;
    const r = await runOnce(engine, (q) => answered(q));
    assert.ok(first, "guard");
    assert.equal(r.followUps.length, 3, "guard: the escalation proposed no follow-up questions");
    assert.deepEqual(r.followUps.map(r.timesAsked), [1, 1, 1], `each follow-up question went to the register: ${r.followUps.map(r.timesAsked)}`);
    for (const q of r.followUps) assert.ok(r.receipt.executed.some((e) => e.qid === q), `${q} answered and not executed`);
    assert.ok(!(r.receipt.deferred ?? []).some((d) => r.followUps.includes(d.qid)));
    deliveredInOnePass(r);
  });
}
