// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives a mock pipeline whose findings record breaks after synthesis passed it, on both engines
//
// A FINDINGS RECORD BROKEN AFTER SYNTHESIS PASSED IT IS RESTORED AT DELIVERY (874).
//
// A write after synthesis left findings.json broken at the top level, and the run ended with the stop notice: at the
// delivery checks' first strict read of it, or at the delivery gate. Now the record is restored from the last save that
// passed and the run delivers from it. With no save to restore, the assessment is not completed: its recovery writes the
// record again, and once that is spent the run delivers what it holds without the assessment. A corrective pass with no
// record from before it to trust is the assessment not completed too. Every mark and owner is invented.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";
import { parseFindingsJsonLenient } from "../findings-model.mjs";
import { correctionsTheRestoreLacks } from "../pipeline.mjs";
import { evaluateClientGate } from "../publish/index.mjs";

const TEMP_DIRS = [];
after(() => { for (const d of TEMP_DIRS) rmSync(d, { recursive: true, force: true }); });
const tempDir = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); TEMP_DIRS.push(d); return d; };
const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
const CODEX = join(HERE, "mock-codex.mjs");
chmodSync(CLAUDE, 0o755);
chmodSync(CODEX, 0o755);
pinEnv(process.env, "CLEAROTRON_REPORTS_URL", envFrom(process.env, "CLEAROTRON_REPORTS_URL") || "https://trademark.test");
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";

const JOB = { id: "test-job-broken-record", msgId: "<broken-record@x>", forwarder: "requester", forwarderDomain: "example.com",
  ref: "TMP8193", markName: "QUILLAMOR", classes: [9, 41], provider: "corsearch" };
const ENGINES = {
  claude: { CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE },
  codex: { CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: CODEX, CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-codex-dummy" },
};
const KEYS = ["CLEAROTRON_CLAUDE_PATH", "CLEAROTRON_CODEX_PATH", "CLEAROTRON_AI_BILLING", "CODEX_API_KEY", "MOCK_VERDICT", "MOCK_SKEPTIC",
  "MOCK_FAIL_STAGE", "MOCK_BREAK_FINDINGS_AFTER", "MOCK_BREAK_FINDINGS_AS", "MOCK_BREAK_FINDINGS_SAVES", "MOCK_BREAK_FINDINGS_ONCE"];
const OVERVIEW_TURN = "record_report_overview";
const REVIEW_TURN = `narrative-refutation${sep}SKILL`;
const CORRECTIVE_TURN = "The reviewer's flags, verbatim:";
const BROKEN = "a record broken after synthesis passed it";   // the mock's broken record (mock-stage-fixtures.mjs)

async function runPass(root, engine, knobs = {}, codename = null) {
  for (const k of KEYS) delete process.env[k];
  for (const [k, v] of Object.entries({ ...ENGINES[engine], CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", MOCK_VERDICT: "CONDITIONAL", MOCK_SKEPTIC: "no flags surfaced", ...knobs }))
    pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  return pipeline({ ...JOB }, codename ? { codename } : {});
}
const json = (p) => JSON.parse(readFileSync(p, "utf8"));
const events = (runDir) => readFileSync(driverDir(runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const metaOf = (root, runDir) => json(join(root, "pool", json(join(runDir, "status.json")).runId, "meta.json"));
const eventsAfter = (ev, i) => ev.slice(i + 1);

for (const engine of Object.keys(ENGINES)) {
  test(`${engine}: a record broken after the overview is restored from the accepted save, and the run delivers its rating`, async () => {
    const root = tempDir("clearotron-broken-record-");
    const p1 = await runPass(root, engine, { MOCK_BREAK_FINDINGS_AFTER: OVERVIEW_TURN, MOCK_BREAK_FINDINGS_ONCE: join(root, "broke-once") });
    assert.equal(p1.ok, true, `the run did not deliver: ${JSON.stringify(p1).slice(0, 300)}`);
    const rd = p1.runDir, ev = events(rd);
    assert.ok(existsSync(join(root, "broke-once")), "guard: the record was never broken, so this proves nothing");
    assert.ok(ev.some((e) => e.event === "core-artifact-invalid" && e.where === "delivery-checks"), "guard: the delivery checks never read the broken record");
    const at = ev.findIndex((e) => e.event === "core-artifact-restored");
    assert.ok(at >= 0, "the record was not restored");
    assert.deepEqual([ev[at].where, ev[at].from], ["delivery-checks", "accepted-save"], JSON.stringify(ev[at]));
    // The restore writes nothing again: no synthesis turn runs after it, and what was built from the record is judged stale or not.
    assert.deepEqual(eventsAfter(ev, at).filter((e) => e.event === "stage" && e.stage === "synthesis").map((e) => e.trigger), [],
      "synthesis was dispatched again over a record a save could restore");
    assert.ok(!ev.some((e) => e.event === "part-not-completed"), "a restored record was recorded as a part not completed");
    assert.ok(readFileSync(driverDir(rd, "findings-broken-at-delivery.json"), "utf8").includes(BROKEN), "the broken record was not kept as evidence");
    assert.ok((parseFindingsJsonLenient(readFileSync(join(rd, "findings.json"), "utf8")).findings ?? []).length > 0, "the record restored holds no findings");
    assert.ok(!existsSync(join(rd, ".failed")), "a delivered run carries a failure");
    const meta = metaOf(root, rd);
    assert.ok(meta.overall, "the rating did not reach the pool");
    assert.equal(meta.assessment, undefined, "a restored record was delivered as the assessment not completed");
  });

  test(`${engine}: a record broken again by a rebuild is restored at the delivery gate too, and the resumed pass delivers it`, async () => {
    // The knob breaks the record after every overview turn: the delivery checks restore it, the overview is rebuilt over
    // the record restored and breaks it again, and the delivery gate restores it once more.
    const root = tempDir("clearotron-broken-twice-");
    const p1 = await runPass(root, engine, { MOCK_BREAK_FINDINGS_AFTER: OVERVIEW_TURN });
    const restores = events(p1.runDir).filter((e) => e.event === "core-artifact-restored").map((e) => e.where);
    assert.deepEqual(restores, ["delivery-checks", "delivery-gate"], "the record was not restored at both reads");
    let p = p1;
    for (let i = 0; i < 2 && p.postponed; i++) p = await runPass(root, engine, { MOCK_BREAK_FINDINGS_AFTER: OVERVIEW_TURN }, p.codename);
    assert.equal(p.ok, true, `the run did not deliver: ${JSON.stringify(p).slice(0, 300)}`);
    assert.ok(metaOf(root, p.runDir).overall, "the rating did not reach the pool");
  });

  test(`${engine}: with no save to restore, the assessment is not completed, and the run delivers without it`, async () => {
    const root = tempDir("clearotron-broken-nosave-");
    const knobs = { MOCK_BREAK_FINDINGS_AFTER: OVERVIEW_TURN, MOCK_BREAK_FINDINGS_SAVES: "1", MOCK_BREAK_FINDINGS_ONCE: join(root, "broke-once") };
    const p1 = await runPass(root, engine, knobs);
    assert.equal(p1.postponed, true, `pass 1 did not park: ${JSON.stringify(p1).slice(0, 300)}`);
    const ev1 = events(p1.runDir);
    assert.ok(ev1.some((e) => e.event === "core-artifact-invalid"), "guard: the broken record was never read");
    assert.ok(!ev1.some((e) => e.event === "core-artifact-restored"), "a record was restored with no save behind it");
    assert.ok(ev1.some((e) => e.event === "part-not-completed" && e.part === "assessment" && e.stage === "core-artifact-gate"),
      `the assessment was not recorded as not completed: ${JSON.stringify(ev1.map((e) => e.event).slice(-12))}`);
    const p2 = await runPass(root, engine, knobs, p1.codename);
    assert.equal(p2.ok, true, `the run did not deliver: ${JSON.stringify(p2).slice(0, 300)}`);
    const meta = metaOf(root, p2.runDir);
    assert.equal(meta.assessment, "not-completed", "the delivery does not state the assessment as not completed");
    assert.equal(meta.overall, undefined, "a rating was delivered over a record nobody could read");
  });

  test(`${engine}: with no save to restore and recovery left, the recovery writes the assessment again and the run delivers its rating`, async () => {
    const root = tempDir("clearotron-broken-recovered-");
    const knobs = { MOCK_BREAK_FINDINGS_AFTER: OVERVIEW_TURN, MOCK_BREAK_FINDINGS_SAVES: "1", MOCK_BREAK_FINDINGS_ONCE: join(root, "broke-once"),
      CLEAROTRON_RECOVERY_MAX: "1" };
    const p1 = await runPass(root, engine, knobs);
    assert.equal(p1.postponed, true, `pass 1 did not park: ${JSON.stringify(p1).slice(0, 300)}`);
    const n1 = events(p1.runDir).length;
    assert.ok(events(p1.runDir).some((e) => e.event === "auto-recovery-parked" && e.stage === "core-artifact-gate"), "the failure did not take its recovery");
    const p2 = await runPass(root, engine, knobs, p1.codename);
    assert.equal(p2.ok, true, `the run did not deliver: ${JSON.stringify(p2).slice(0, 300)}`);
    // A broken record does not let synthesis skip, so the recovery writes it again.
    assert.ok(events(p2.runDir).slice(n1).some((e) => e.event === "stage" && e.stage === "synthesis"), "the recovery did not write the assessment again");
    const meta = metaOf(root, p2.runDir);
    assert.ok(meta.overall, "the rating did not reach the pool");
    assert.equal(meta.assessment, undefined, "a recovered assessment was stated as not completed");
  });

  test(`${engine}: a corrective pass with no record from before it to trust is the assessment not completed`, async () => {
    const root = tempDir("clearotron-corrective-norecord-");
    const knobs = { MOCK_BREAK_FINDINGS_AFTER: REVIEW_TURN, MOCK_BREAK_FINDINGS_AS: "absent", MOCK_FAIL_STAGE: CORRECTIVE_TURN };
    const p1 = await runPass(root, engine, knobs);
    assert.equal(p1.postponed, true, `pass 1 did not park: ${JSON.stringify(p1).slice(0, 300)}`);
    const routed = events(p1.runDir).find((e) => e.event === "part-not-completed");
    assert.ok(routed, "guard: the corrective pass did not end the pass");
    assert.deepEqual([routed.part, routed.stage], ["assessment", "synthesis(conditional)"], JSON.stringify(routed));
    const p2 = await runPass(root, engine, knobs, p1.codename);
    assert.equal(p2.ok, true, `the run did not deliver: ${JSON.stringify(p2).slice(0, 300)}`);
    assert.equal(metaOf(root, p2.runDir).assessment, "not-completed");
  });
}

test("a record restored from the save before the repair lacks what the correction after that repair changed, and the client gate holds it", () => {
  const runDir = tempDir("clearotron-restore-lacks-");
  mkdirSync(driverDir(runDir), { recursive: true });
  writeFileSync(driverDir(runDir, "post-repair-corrections.json"), JSON.stringify({
    pass: "post-repair",
    rows: [
      { n: 1, outcome: "findings-changed", targets: ["ORBANTIQ"] },
      { n: 2, outcome: "findings-unchanged", targets: ["QUILLAMOR"] },
      { n: 3, outcome: "section-changed", targets: [] },
    ],
    classes: [{ n: 1, target: "ORBANTIQ" }, { n: 2, target: "QUILLAMOR" }, { n: 3, target: "What happens next" }],
  }));
  const lacks = correctionsTheRestoreLacks(runDir, "save-before-the-repair");
  assert.deepEqual(lacks, ["ORBANTIQ", "What happens next"], "the corrections the restored record lacks were read wrong");
  assert.deepEqual(correctionsTheRestoreLacks(runDir, "accepted-save"), [], "the accepted save carries every correction, and was said to lack one");
  assert.deepEqual(correctionsTheRestoreLacks(tempDir("clearotron-restore-none-"), "save-before-the-repair"), [], "no correction ran, and one was said to be lacking");
  const gate = evaluateClientGate({ findingsStale: lacks });
  assert.equal(gate.released, false, "the client export was not held over a record that lacks a correction");
  assert.deepEqual(gate.reasonCodes, ["findings-stale"], `the gate held it for another reason: ${JSON.stringify(gate)}`);
});
