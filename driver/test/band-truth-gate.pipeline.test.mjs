// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the mock pipeline end to end through the band-truth gate
// PR B (2026-07-14, teal-foundry) — pipeline-level band-truth gate. Own file = own process + own
// workspace root (the repo convention for mock-pipeline scenarios). The gate is ON here (it defaults ON
// in production; the legacy harnesses set CLEAROTRON_BAND_TRUTH_GATE=0 because their mock runs never dial
// the provider). Scenarios: (1) fabricated bands (qid blocks, zero ledger rows) are rebuilt in place by
// the direct executor and the run delivers over executor data; (2) with no executor lane the run
// fail-closes at fan-in with the fabrication signature; (3) an absent ledger file leaves the gate inert.
// SAFETY GUARD (2026-07-14, learned the hard way): driver.config freezes workspaceRoot at FIRST import
// with a PRODUCTION default. Pin it to a throwaway root BEFORE any driver module loads —
// a static driver import above this line would hoist past it, so driver modules are imported DYNAMICALLY.
import { mkdtempSync as __mkdtemp } from "node:fs";
import { envFrom, pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling; the default is taken only when NO spelling holds one
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || __mkdtemp(__join(__tmpdir(), "prelim-testroot-")));
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
// pin the ENGINE BINARY too — the engine path is frozen at first import, and its default is the REAL
// CLI on PATH; with the mock pinned here, an early driver import
// can never reach production even by accident.
process.env.CLEAROTRON_AI ||= "anthropic-agent";
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
process.env.CLEAROTRON_RECALL_TRIPWIRE ||= "0";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";

const JOB = {
  id: "test-job-btg", msgId: "<btg@x>", forwarder: "requester", forwarderDomain: "example.com",
  ref: "TMP8903", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch",
};

// executor mock faithful to the real lane: writes the band from the plan AND leaves ledger rows (the
// real executor's provider calls land in the call ledger via the plugin chokepoint).
const healingExecutor = (ledgerPath, calls = []) => async ({ planPath, axis, outputPath }, { sessionKey }) => {
  calls.push({ axis, sessionKey });
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  const blocks = plan.entries.filter((e) => e.axis === axis).map((e) => ({
    state: "incomplete", qid: e.qid, query: `${e.term ?? (e.terms ?? []).join("|")} (probe)`, total_hits: 7, fetched: 0, sample: [],
    reason: "count-only crowd descriptor (plan-dictated)",
  }));
  writeFileSync(outputPath, JSON.stringify(blocks, null, 2) + "\n");
  appendFileSync(ledgerPath, JSON.stringify({ ts: new Date().toISOString(), agentId: "clawdi", sessionKey: `agent:clawdi:${sessionKey}`, tool: "search" }) + "\n");
  return { ok: true, executed: blocks.length, states: {} };
};

async function runMockPipeline(env, opts = {}) {
  const root = mkdtempSync(join(tmpdir(), "prelim-btg-"));
  for (const k of ["MOCK_VERDICT", "MOCK_PERMISSION_PROSE", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE"]) delete process.env[k];
  for (const [k, v] of Object.entries({
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root,
    CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0",
    CLEAROTRON_AGENT: "clawdi", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    CLEAROTRON_BAND_TRUTH_GATE: "1", ...env,
  })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB }, opts);
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { res, events };
}

test("gate + heal: fabricated bands (zero ledger rows) are re-executed in place — run delivers over executor data", async () => {
  const ledger = join(mkdtempSync(join(tmpdir(), "btg-ledger-")), "calls.jsonl");
  writeFileSync(ledger, "");   // exists, judgeable, zero rows — every mock band reads as authored
  const calls = [];
  const { res, events } = await runMockPipeline({ CLEAROTRON_REGISTER_CALL_LOG: ledger }, { planExecutor: healingExecutor(ledger, calls) });
  assert.equal(res.ok, true, JSON.stringify({ ok: res.ok, fail: res.fail, stage: res.failedStage }));
  const fired = events.filter((e) => e.event === "band-truth-gate");
  assert.ok(fired.length >= 1, "gate fired for authored bands");
  const rebuilt = events.filter((e) => e.event === "band-truth-rebuilt");
  assert.equal(rebuilt.length, fired.length, "every fired axis was rebuilt by the direct executor");
  assert.ok(calls.length >= fired.length, "the executor lane actually re-ran the axes");
  const ledgerRows = readFileSync(ledger, "utf8").trim().split("\n").filter(Boolean);
  assert.ok(ledgerRows.length >= fired.length, "the rebuild left real ledger evidence");
});

test("gate fail-closed: fabricated bands with NO executor lane kill the run at fan-in with the fabrication signature", async () => {
  const ledger = join(mkdtempSync(join(tmpdir(), "btg-ledger-")), "calls.jsonl");
  writeFileSync(ledger, "");
  const { res } = await runMockPipeline({ CLEAROTRON_REGISTER_CALL_LOG: ledger });   // no planExecutor + dispatch off
  assert.equal(res.ok, false);
  assert.match(String(res.reason ?? res.fail ?? ""), /fabricated named band/, JSON.stringify({ fail: res.fail, reason: res.reason, stage: res.failedStage }));
  assert.equal(res.failedStage, "fan-in");

  // ── — THE POINTER IS READ OFF THE RECORD AND OPENED ────────────────────────────
  //
  // This throw used to interpolate the band path into `reason`, where terminalReasonFields caps at 200
  // and the address was severed mid-filename — measured on a preserved run of 2026-09-02, whose whole
  // recorded reason was `fabricated named band /…/register-units/saturation-probe-ban…`, with
  // `reasonTruncated: true` and `reasonDetail: null`. An operator who stats what that record hands them
  // gets ENOENT. That is, on a stage its arm was never pointed at.
  //
  // So this arm does not read the source and it does not match the sentence: it takes the address out of
  // the RECORD the failure actually wrote and OPENS it. A pointer that cannot be opened is the defect,
  // whatever the sentence beside it says.
  const status = JSON.parse(readFileSync(join(res.runDir, "status.json"), "utf8"));
  assert.equal(status.reasonTruncated, false,
    `the sentence must fit the 200-char cap whole — recorded ${String(status.reason).length} chars: ${status.reason}`);
  assert.ok(typeof status.reasonDetail === "string" && status.reasonDetail.length > 0,
    "the payload must reach the record at all; null here is the state this issue was opened on");
  const pointer = status.reasonDetail.split(" — ")[0];
  assert.match(pointer, /register-units\/.*-band\.json$/,
    `reasonDetail must LEAD with the band path, so the 600-char abbrev can never sever it: ${status.reasonDetail}`);
  assert.equal(existsSync(pointer), true,
    `the address the record hands a reader must open — this is the ENOENT the issue is about: ${pointer}`);
  // AND THE REASON MUST NOT HAVE KEPT A COPY. Moving the payload while leaving it interpolated too is
  // the fix that passes both arms and changes nothing about the cap.
  assert.doesNotMatch(String(status.reason), /\//,
    `no path may remain in the sentence: ${status.reason}`);
});

test("gate inert without a ledger: absent call-log file → cannot judge → run delivers exactly as before", async () => {
  const { res, events } = await runMockPipeline({ CLEAROTRON_REGISTER_CALL_LOG: join(tmpdir(), "btg-nonexistent", "calls.jsonl") });
  assert.equal(res.ok, true, JSON.stringify({ ok: res.ok, fail: res.fail, stage: res.failedStage }));
  assert.equal(events.filter((e) => e.event === "band-truth-gate").length, 0, "gate never fired");
});
