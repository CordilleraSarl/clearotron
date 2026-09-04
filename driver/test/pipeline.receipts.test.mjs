// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the mock pipeline end to end and audits every receipt it wrote
// Offline mock-pipeline tests for the machine-receipts grid gate (post-mortem §1b):
//  - a variant missing from the saved grid ledger fails the run via the EXACT JOIN (grid_join_missing —
//    the probe-B transcription-loss failure mode, now caught in the JSON, not the prose matrix);
//  - a run that never saves the ledger fails CLOSED at the stage validator (D1 grid_ledger_missing):
//    with _driver/grid-spec.json dictating the grid, the old legacy-prose downgrade is gone, so a fresh
//    run can never silently ride the prose path. The pipeline's warm save-followup lane now serves only
//    legacy spec-less runs (no dictated platforms) — for spec-carrying runs the stage's own corrective
//    ladder carries the repair.
// The happy path (ledger present + complete) is covered by pipeline.mock.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { fileURLToPath } from "node:url";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
// doc-27 Item 2 preflight: dummy credential for the offline mock run (no /mark/ citations ⇒ no record fetch).
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
// code-side saturation-probe (2026-07-14): OFF in this legacy harness — its scenarios script the AGENT
// member; the dedicated satprobe-codeside tests exercise the code-side path with an injected executor.
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";
// band-truth gate (2026-07-14): OFF in hermetic harnesses — mock runs never dial the provider, so the
// production call ledger can never evidence their bands; the dedicated band-truth-gate tests turn it ON.
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";

const JOB = {
  id: "receipts-job", msgId: "<receipts@x>", forwarder: "jordan", forwarderDomain: "example.com",
  ref: "TMP8441", markName: "NOVAPULSE", classes: [9, 41], provider: "corsearch",
};

async function run(env, id) {
  const root = mkdtempSync(join(tmpdir(), "prelim-receipts-"));
  for (const k of ["MOCK_CL_SHORT", "MOCK_NO_GRID_LEDGER"]) delete process.env[k];
  for (const [k, v] of Object.entries({
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", CLEAROTRON_AGENT: "clawdi", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    ...env,
  })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB, id });
  for (const k of ["MOCK_CL_SHORT", "MOCK_NO_GRID_LEDGER"]) delete process.env[k];
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { res, events };
}

test("a variant missing from the saved grid ledger fails the run via the exact join", async () => {
  const { res } = await run({ MOCK_CL_SHORT: "转码" }, "receipts-short");
  assert.equal(res.ok, false, JSON.stringify(res));
  assert.match(JSON.stringify(res), /grid_join_missing/);
  assert.match(JSON.stringify(res), /common-law/);
});

test("D1: a fresh run that never saves the ledger fails CLOSED at the stage (grid_ledger_missing, never the prose path)", async () => {
  // MOCK_NO_GRID_LEDGER=1 used to recover through the pipeline's warm save-followup lane; with the
  // grid spec on disk the stage validator now refuses the missing ledger outright — the corrective
  // ladder (disabled here: CLEAROTRON_MAX_RETRIES=0) is the repair channel, and exhaustion is terminal.
  const { res, events } = await run({ MOCK_NO_GRID_LEDGER: "1" }, "receipts-never");
  assert.equal(res.ok, false, JSON.stringify(res));
  assert.match(JSON.stringify(res), /grid_ledger_missing/);
  assert.match(JSON.stringify(res), /common-law/);
  assert.ok(!events.some((e) => e.event === "grid-ledger-saved"),
    "the run must fail before any prose-path ride — no post-hoc save lane for spec-carrying runs");
});
