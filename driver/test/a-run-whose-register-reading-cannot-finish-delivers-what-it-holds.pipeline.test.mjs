// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives a mock pipeline whose placement or register write-up cannot finish, on both engines, with invented names
//
// A RUN WHOSE PLACEMENT OR REGISTER WRITE-UP CANNOT FINISH DELIVERS WHAT IT HOLDS, WITH THE GAP STATED.
//
// Placement and the register write-up are the overall assessment's first two steps. When either fails once its recovery
// is spent, the run holds the register band and the web search but no reading of the register, and no assessment. It is
// recorded as the assessment not completed and delivered as a run whose synthesis failed is: no rating anywhere, the
// shipped "Findings" row, and the shipped "Register" row for the reading the register never got. A band too large to
// dispatch placement over is refused before any model is dispatched, which no recovery can change, so it is delivered
// without the assessment at once, with recovery still left.
import { mkdtempSync as __mkdtemp, writeFileSync as __write } from "node:fs";
import { envFrom, pinEnv } from "../../shared/env-aliases.mjs";
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || __mkdtemp(__join(__tmpdir(), "clearotron-testroot-")));
const LEDGER = __join(__mkdtemp(__join(__tmpdir(), "clearotron-open-reading-ledger-")), "corsearch-calls.jsonl");
process.env.CLEAROTRON_REGISTER_CALL_LOG = LEDGER;
__write(LEDGER, "");
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { assessmentNotCompletedNote } from "../../shared/client-failure-note.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
const CODEX = join(HERE, "mock-codex.mjs");
chmodSync(CLAUDE, 0o755);
chmodSync(CODEX, 0o755);
process.env.CLEAROTRON_AI ||= "anthropic-agent";
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";

const JOB = {
  id: "test-job-open-reading", msgId: "<open-reading@x>", forwarder: "jordan", forwarderDomain: "example.com",
  ref: "TMP8195", markName: "ORBANTIQ", classes: [9, 41], provider: "corsearch",
};
const ON_CODEX = { CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: CODEX, CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-codex-dummy" };
const PLACEMENT_TURN = `placement-inquiry${sep}SKILL`;
const DIGEST_TURN = "You are register DIGEST mode";

// The executor plays the code-side register: it writes the axis band itself. `padMb` grows the first merged band past
// the size placement may be dispatched over, with one long field on one record of a crowd's sample (a crowd's reason
// is cut short when the band is read; its sample is kept whole).
const executor = ({ padMb = 0 } = {}) => async ({ planPath, axis, outputPath }) => {
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  const blocks = plan.entries.filter((e) => e.axis === axis).map((e) => ({
    state: "incomplete", qid: e.qid, query: `${e.term} (count probe)`, total_hits: 1200, fetched: 0, sample: [],
    reason: "count-only crowd descriptor (plan-dictated)",
  }));
  if (padMb && blocks.length) blocks[0].sample = [{ record_id: "/mark/us/70000001", mark_text: "ZQXWAN", status: "Dead",
    owner_name: "Padding Owner Ltd", notes: "x".repeat(Math.round(padMb * 1024 * 1024)) }];
  writeFileSync(outputPath, JSON.stringify(blocks, null, 2) + "\n");
  return { ok: true, executed: blocks.length, states: {} };
};

async function runPass(root, env, opts = {}, codename = null) {
  for (const k of ["MOCK_VERDICT", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE", "CLEAROTRON_AI_BILLING", "CODEX_API_KEY", "CLEAROTRON_CODEX_PATH"]) delete process.env[k];
  for (const [k, v] of Object.entries({
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root,
    CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0",
    MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", ...env,
  })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  return pipeline({ ...JOB }, { ...(codename ? { codename } : {}), ...opts });
}
const json = (p) => JSON.parse(readFileSync(p, "utf8"));
const events = (runDir) => readFileSync(driverDir(runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

/** The delivery of a run whose register reading never completed: no rating, and both gap rows. */
async function assertDeliveredWithoutTheReading(root, res, stage, label) {
  assert.equal(res.ok, true, `${label}: the run did not deliver: ${JSON.stringify(res)}`);
  assert.equal(res.verdict, null);
  const rd = res.runDir;
  assert.equal(json(driverDir(rd, "not-completed", "assessment.json")).stage, stage, `${label}: the record names another stage`);
  assert.ok(!existsSync(join(rd, ".failed")) && !existsSync(driverDir(rd, "failure.json")), `${label}: a delivered run carries a failure`);
  const status = json(join(rd, "status.json"));
  const pool = join(root, "pool", status.runId);
  const meta = json(join(pool, "meta.json"));
  assert.equal(meta.assessment, "not-completed");
  for (const k of ["overall", "badge", "statement", "review"]) assert.equal(meta[k], undefined, `${label}: meta.json carries ${k}`);
  assert.equal(meta.caption, assessmentNotCompletedNote());
  const html = readFileSync(join(pool, "report.html"), "utf8");
  assert.ok(!html.includes('class="tb-risk"') && !html.includes('class="panel gauge"') && !html.includes('id="countries"'), `${label}: the page draws a rating`);
  const parts = json(driverDir(rd, "degraded-parts.json")).parts;
  assert.ok(parts.some((d) => d.part === "assessment" && d.name === "Findings"), `${label}: no Findings row`);
  assert.ok(parts.some((d) => d.part === "register" && d.name === "Register" && /register write-up/.test(d.cause)),
    `${label}: no Register row for the reading the register never got: ${JSON.stringify(parts)}`);
  return { rd, pool };
}

for (const [engine, env] of [["claude", {}], ["codex", ON_CODEX]]) {
  test(`${engine}: a placement that cannot finish is delivered without the assessment, the register's reading stated open`, async () => {
    const root = mkdtempSync(join(tmpdir(), "clearotron-open-placement-"));
    const planExecutor = executor();
    const p1 = await runPass(root, { ...env, MOCK_FAIL_STAGE: PLACEMENT_TURN }, { planExecutor });
    assert.equal(p1.postponed, true, `pass 1 did not park: ${JSON.stringify(p1)}`);
    const p2 = await runPass(root, { ...env, MOCK_FAIL_STAGE: PLACEMENT_TURN }, { planExecutor }, p1.codename);
    await assertDeliveredWithoutTheReading(root, p2, "placement-inquiry", `${engine} placement`);
  });

  test(`${engine}: a register write-up that cannot finish is delivered without the assessment`, async () => {
    const root = mkdtempSync(join(tmpdir(), "clearotron-open-digest-"));
    const planExecutor = executor();
    const p1 = await runPass(root, { ...env, MOCK_FAIL_STAGE: DIGEST_TURN }, { planExecutor });
    assert.equal(p1.postponed, true, `pass 1 did not park: ${JSON.stringify(p1)}`);
    const p2 = await runPass(root, { ...env, MOCK_FAIL_STAGE: DIGEST_TURN }, { planExecutor }, p1.codename);
    await assertDeliveredWithoutTheReading(root, p2, "register-digest", `${engine} write-up`);
  });

  test(`${engine}: a band too large for placement is refused at dispatch and delivered without the assessment at once, with recovery left`, async () => {
    const root = mkdtempSync(join(tmpdir(), "clearotron-open-band-"));
    const planExecutor = executor({ padMb: 37 });
    const p1 = await runPass(root, { ...env, CLEAROTRON_RECOVERY_MAX: "3" }, { planExecutor });
    assert.equal(p1.postponed, true, `pass 1 did not park: ${JSON.stringify(p1)}`);
    const ev1 = events(p1.runDir);
    assert.ok(ev1.some((e) => e.event === "stage-input-over-ceiling" && e.stage === "placement-inquiry"), "guard: placement was not refused at dispatch");
    assert.ok(ev1.some((e) => e.event === "part-not-completed" && e.stage === "placement-inquiry"), "a deterministic refusal was parked for recovery instead");
    assert.ok(!ev1.some((e) => e.event === "auto-recovery-parked"), "a refusal no recovery can change took a recovery park");
    const p2 = await runPass(root, { ...env, CLEAROTRON_RECOVERY_MAX: "3" }, { planExecutor }, p1.codename);
    await assertDeliveredWithoutTheReading(root, p2, "placement-inquiry", `${engine} band`);
    assert.ok(!readdirSync(driverDir(p2.runDir)).some((f) => f.startsWith("placement-inquiry") && f.endsWith(".jsonl")
      && readFileSync(driverDir(p2.runDir, f), "utf8").includes('"ok":true')), "a placement attempt ran over the refused band");
  });
}
