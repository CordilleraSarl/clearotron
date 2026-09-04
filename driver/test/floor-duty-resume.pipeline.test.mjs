// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives a mock pipeline run, parks it after placement, seeds an undischarged floor, resumes
// — a run that parks after placement could never discharge its floor duty.
//
// The resume called the placement output "present and valid" and skipped it; the delivery floor called
// that same pass's duty undischarged. Both read the same artifact and reached opposite conclusions, and
// nothing reconciled them — so the seat was never dispatched again, the duty was permanently
// undischargeable, and the run travelled every remaining stage toward a failure it was doomed to on
// resume. One measured run spent 5.55 hours and 3.0M input tokens getting there.
//
// THIS IS THE INTEGRATION HALF, and it exists because the unit half was demonstrably not sufficient: a
// plant that deleted the term from the skip condition while leaving the predicate's call in place left
// every unit arm green. Computed, logged, ignored. Only driving the pipeline sees that.
//
// Own file = own process + own workspace root (the repo convention for mock-pipeline scenarios).
// SAFETY GUARD: driver.config freezes workspaceRoot at FIRST import with a PRODUCTION default. Pin it to
// a throwaway root BEFORE any driver module loads — a static driver import above this line would hoist
// past it, so driver modules are imported DYNAMICALLY.
import { mkdtempSync as __mkdtemp, writeFileSync as __write } from "node:fs";
import { envFrom, pinEnv } from "../../shared/env-aliases.mjs";
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || __mkdtemp(__join(__tmpdir(), "prelim-testroot-")));
const LEDGER = __join(__mkdtemp(__join(__tmpdir(), "prelim-fdresume-ledger-")), "corsearch-calls.jsonl");
process.env.CLEAROTRON_REGISTER_CALL_LOG = LEDGER;
__write(LEDGER, "");

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
process.env.CLEAROTRON_AI ||= "anthropic-agent";
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
process.env.CLEAROTRON_RECALL_TRIPWIRE ||= "0";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";

const JOB = {
  id: "test-job-fdresume", msgId: "<fdresume@x>", forwarder: "jordan", forwarderDomain: "example.com",
  ref: "TMP8908", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch",
};

async function runMockPipeline(env, opts = {}, reuse = null) {
  const root = reuse?.root ?? mkdtempSync(join(tmpdir(), "prelim-fdresume-"));
  for (const k of ["MOCK_VERDICT", "MOCK_PERMISSION_PROSE", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE", "MOCK_SCREEN_DROP",
    "MOCK_FRAME_DIFF", "MOCK_ESCALATION_NOOP", "MOCK_LEDGER_LIMITED", "MOCK_CLAUDE_CALL_LOG"]) delete process.env[k];
  for (const [k, v] of Object.entries({
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root,
    CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0",
    CLEAROTRON_AGENT: "clawdi", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    ...env,
  })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB }, { ...(reuse?.codename ? { codename: reuse.codename } : {}), ...opts });
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { res, events, root };
}

test("2004: a run parked AFTER placement re-runs it on resume when its floor duty is undischarged", async () => {
  // ── pass 1: placement runs, then the run parks downstream of it ──────────────────────────────────
  const p1 = await runMockPipeline({ MOCK_FAIL_STAGE: "joint synthesis narrative" }, {});
  assert.equal(p1.res.ok, false, "pass 1 must park");
  assert.ok(p1.events.some((e) => e.event === "stage" && e.stage === "placement-inquiry"),
    `placement must have RUN in pass 1 — the whole defect is about a pass that genuinely ran and then was `
    + `skipped on resume (parked at: ${p1.res.failedStage})`);
  assert.ok(existsSync(driverDir(p1.res.runDir, "floor-duty-armed.json")),
    "the pass armed the delivery floor — without that stamp there is no duty to leave undischarged");

  // ── seed an undischarged floor, exactly as the acceptance criterion asks ─────────────────────────
  // Written directly rather than coaxed out of the mock: the criterion says "seeded", and what is under
  // test is the RESUME's treatment of an outstanding duty, not the reconciler that computes one.
  writeFileSync(driverDir(p1.res.runDir, "floor-duty.json"), JSON.stringify({
    ts: "2026-08-28T11:49:36.000Z", trigger: "test-seed", computable: true, undischarged_by_seat: 1,
    totals: { floors: 45, accounted: 44, named_without_ground: 0, unanswered: 1, unanswerable: 0 },
    rows: [{ disposition: "unanswered", mark: "PROBEMARK", record_id: "/mark/em/PROBEFLOOR" }],
  }, null, 2) + "\n");

  // ── pass 2: resume ──────────────────────────────────────────────────────────────────────────────
  const codename = JSON.parse(readFileSync(join(p1.res.runDir, "status.json"), "utf8")).codename;
  const n1 = p1.events.length;
  const p2 = await runMockPipeline({}, {}, { root: p1.root, codename });
  const ev2 = p2.events.slice(n1);   // run.jsonl is append-only across passes

  // THE DEFECT: before the fix, placement skips here and the duty can never be discharged.
  assert.equal(ev2.filter((e) => e.event === "skip" && e.stage === "placement-inquiry").length, 0,
    "placement SKIPPED on the resume while its floor duty was undischarged. That is the gap: the seat is "
    + "never dispatched again, so the outstanding floor can never be placed or grounded, and the run "
    + "spends every remaining stage travelling toward a delivery it cannot make");
  assert.ok(ev2.some((e) => e.event === "stage-floor-duty-rerun" && e.stage === "placement-inquiry"),
    "the re-run is not recorded — a reader of run.jsonl cannot tell a duty-driven re-run from an ordinary "
    + "one, and an unexplained repeat of the largest stage in the pipeline is exactly what needs a reason");
  assert.ok(ev2.some((e) => e.event === "stage" && e.stage === "placement-inquiry"),
    "placement was not dispatched again — being un-skipped is only half of it; the seat has to actually run");
});

test("2004 CONTROL: a resume whose duty is DISCHARGED still skips placement, as it always did", async () => {
  // Without this the arm above is satisfied by a change that simply stopped skipping placement ever —
  // which would re-run the pipeline's largest stage on every resume for no reason. The fix must cost
  // nothing on a healthy run.
  const p1 = await runMockPipeline({ MOCK_FAIL_STAGE: "joint synthesis narrative" }, {});
  assert.equal(p1.res.ok, false, "pass 1 must park");
  writeFileSync(driverDir(p1.res.runDir, "floor-duty.json"), JSON.stringify({
    ts: "2026-08-28T11:49:36.000Z", trigger: "test-seed", computable: true, undischarged_by_seat: 0,
    totals: { floors: 45, accounted: 45, named_without_ground: 0, unanswered: 0, unanswerable: 0 }, rows: [],
  }, null, 2) + "\n");

  const codename = JSON.parse(readFileSync(join(p1.res.runDir, "status.json"), "utf8")).codename;
  const n1 = p1.events.length;
  const p2 = await runMockPipeline({}, {}, { root: p1.root, codename });
  const ev2 = p2.events.slice(n1);

  assert.ok(ev2.some((e) => e.event === "skip" && e.stage === "placement-inquiry"),
    "a discharged duty must leave the skip exactly as it was — this fix may only ever cost a re-run when "
    + "there is an outstanding floor to discharge");
  assert.equal(ev2.filter((e) => e.event === "stage-floor-duty-rerun").length, 0,
    "…and it must not claim a duty-driven re-run it did not make");
});
