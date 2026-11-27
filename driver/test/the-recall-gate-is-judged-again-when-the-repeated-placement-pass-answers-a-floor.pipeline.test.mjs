// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the mock pipeline through a park and a resume that repeats placement, on both engines
//
// THE RECALL GATE IS JUDGED AGAIN WHEN THE REPEATED PLACEMENT PASS ANSWERS A FLOOR.
//
// A record that is both a floor and left unended by the reading step is named once, by the floor's clause: the recall
// gate leaves to that clause a record it already names. When the delivery check repeats placement and the repeat places
// that record, the floor's clause is withdrawn. The recall gate must then be judged again, or the record is named by
// neither clause at that point in the run. Here the escalation's re-run adds the record, placement's late pass fails
// once and the delivery check repeats it, and the repeat places the record. On this path the reading step's own re-run
// later ends the record, so the delivered result is the same either way; what the re-judge holds is the run's record
// straight after the repeated pass, which the mutation drops. Own file = own process + own workspace root; the
// workspace and the call ledger are pinned before any driver module loads, so driver modules are imported
// dynamically. Every mark and owner is invented.
import { mkdtempSync as __mkdtemp, writeFileSync as __write } from "node:fs";
import { envFrom, pinEnv } from "../../shared/env-aliases.mjs";
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || __mkdtemp(__join(__tmpdir(), "clearotron-testroot-")));
const LEDGER = __join(__mkdtemp(__join(__tmpdir(), "clearotron-rejudge-ledger-")), "corsearch-calls.jsonl");
process.env.CLEAROTRON_REGISTER_CALL_LOG = LEDGER;
__write(LEDGER, "");
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, chmodSync, readFileSync, writeFileSync, existsSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";

const ADDED = "/mark/us/90000077";   // the record mockUnitBandWrite adds on a warm re-run of MOCK_ESCALATION_ADDS_FLOOR's axis
const ON_CODEX = { CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: CODEX, CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-codex-dummy" };

// ── whole runs: a resumed run whose warm re-run adds a live identical record ──
const JOB = {
  id: "test-job-rejudge", msgId: "<rejudge@x>", forwarder: "jordan", forwarderDomain: "example.com",
  ref: "TMP8921", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch",
};
const PARK_AT_DIGEST = "You are register DIGEST mode";
// A write-up failure whose recovery is spent is delivered without the assessment, so pass 1 takes a recovery park
// instead, and the stage it stopped at is the one its status records.
const parkedAt = (res) => JSON.parse(readFileSync(join(res.runDir, "status.json"), "utf8")).failedStage;
const ESCALATE = "- transliteration-numeric extra script group looks thin\n\n## Escalation decisions\nESCALATE: transliteration-numeric — sweep the extra script group";

async function runMockPipeline(root, env, codename = null) {
  for (const k of ["MOCK_VERDICT", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE", "MOCK_PLACEMENT_NO_SIBLING", "MOCK_ESCALATION_ADDS_FLOOR", "MOCK_ESCALATION_ADDS_MARK",
    "MOCK_SEAT_DEFERS", "MOCK_FAIL_STAGE_ONCE", "MOCK_PLACEMENT_SELECTS", "CLEAROTRON_AI_BILLING", "CODEX_API_KEY", "CLEAROTRON_CODEX_PATH"]) delete process.env[k];
  for (const [k, v] of Object.entries({
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root,
    CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0",
    MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", ...env,
  })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB }, codename ? { codename } : {});
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { res, events };
}

// Pass 1 parks after placement; pass 2 resumes, and the warm re-run of `axis` adds the record. The repeated placement
// pass hands back nothing new, so the record is a floor nobody answered.

// The placement prompt names its manual; the first placement turn of the resume is the late pass.
const PLACEMENT_TURN = "placement-inquiry/SKILL.md";

for (const [engine, env] of [["claude", {}], ["codex", ON_CODEX]]) {
  test(`${engine}: a record the floor named is counted by the recall gate once the repeated placement pass answers the floor`, async () => {
    const root = mkdtempSync(join(tmpdir(), "clearotron-rejudge-"));
    const p1 = await runMockPipeline(root, { ...env, MOCK_FAIL_STAGE: PARK_AT_DIGEST, CLEAROTRON_RECOVERY_MAX: "1" });
    assert.equal(parkedAt(p1.res), "register-digest", `guard: pass 1 parks at the reading step (parked at ${parkedAt(p1.res)})`);
    const codename = JSON.parse(readFileSync(join(p1.res.runDir, "status.json"), "utf8")).codename;
    const n1 = p1.events.length;
    const p2 = await runMockPipeline(root, { ...env, MOCK_SKEPTIC: ESCALATE, MOCK_ESCALATION_ADDS_FLOOR: "transliteration-numeric",
      MOCK_FAIL_STAGE: PLACEMENT_TURN, MOCK_FAIL_STAGE_ONCE: join(root, "late-pass-failed"), MOCK_PLACEMENT_SELECTS: ADDED }, codename);
    const ev = p2.events.slice(n1);
    const at = (pred, why) => { const i = ev.findIndex(pred); assert.ok(i >= 0, why); return i; };
    assert.equal(p2.res.ok, true, JSON.stringify({ fail: p2.res.fail, stage: p2.res.failedStage }));
    // the setting: the late pass failed, the delivery checks named the record by the floor alone, and placement was repeated
    at((e) => e.event === "late-evidence-failed", "guard: placement's late pass did not fail");
    assert.deepEqual(ev.filter((e) => e.event === "terminal-guard-clamp").map((e) => e.defect)[0], "floor_duty_undischarged:1",
      "guard: the delivery checks did not name the record by the floor's clause first");
    const repeat = at((e) => e.event === "stage" && e.stage === "placement-inquiry" && e.trigger === "stale-repair", "guard: the delivery check did not repeat placement");
    assert.ok(!ev.slice(0, repeat).some((e) => e.event === "recall-reconciliation-unended-delivered"), "guard: the recall gate named the record the floor's clause names");
    const withdrawn = at((e) => e.event === "guard-gap-closed" && e.token === "floor_duty_undischarged", "guard: the repeat's answer did not withdraw the floor's clause");
    assert.ok(withdrawn > repeat);
    // the re-judge: straight after the floor's clause goes, the recall gate counts the record, once
    const after = at((e) => e.event === "floor-duty-after-repair", "the repeated pass's checks were not recorded");
    const stated = ev.slice(withdrawn, after).filter((e) => e.event === "recall-reconciliation-unended-delivered");
    assert.deepEqual(stated.map((e) => e.records), [1], "once the floor's clause was withdrawn, the recall gate did not count the record");
    assert.deepEqual([ev[after].was, ev[after].now], ["CONDITIONAL", "CONDITIONAL"], "the repeated pass's checks left the record named by neither clause");
  });
}
