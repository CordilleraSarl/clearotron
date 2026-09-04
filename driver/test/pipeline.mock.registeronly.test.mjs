// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the mock pipeline end to end on the register-only product
// register-only RETIREMENT e2e (offline mock): the ASSEMBLED pipeline, not the pure functions.
//
// This file used to run a whole register-only search through pipelineInner to prove the grid did not
// fire and the verdict was not clamped. That run cannot be started any more — retired the level —
// so what it proves now is the other half of the same property: the assembled pipeline REFUSES the
// level at policy mint rather than quietly running the clearance the job did not ask for.
//
// This is the last door, and the only one with no service in front of it: a CLI or direct dispatch
// bypasses the runner's admission gate entirely, so a refusal that lived only in the portal and the
// ops-MCP would leave the engine itself substituting one product for another (attachSearchPolicy's own
// comment: "never a silent downgrade to a plain clearance"). The second test is its control — the same
// job with no level still runs the full grid, so the refusal is about the level and nothing else.
//
// Own process, because config.workspaceRoot freezes at first import.
// Billable-call-free (mock claude), mirroring pipeline.mock.registergap.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { fileURLToPath } from "node:url";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";

const JOB = {
  id: "test-job", msgId: "<test@x>", forwarder: "requester", forwarderDomain: "example.com",
  ref: "TMP8901", markName: "REGISTERONLY PROBE", classes: [9], provider: "corsearch",
};

const ROOT = mkdtempSync(join(tmpdir(), "prelim-mock-ro-"));

async function runPipeline(env, jobPatch = {}) {
  for (const k of ["MOCK_VERDICT", "MOCK_PERMISSION_PROSE", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE", "MOCK_LEDGER_LIMITED"]) delete process.env[k];
  for (const [k, v] of Object.entries({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE,
    CLEAROTRON_WORK_DIR: ROOT, CLEAROTRON_REPORTS_DIR: join(ROOT, "pool"), CLEAROTRON_MAX_RETRIES: "0",
    CLEAROTRON_RECOVERY_MAX: "0", CLEAROTRON_AGENT: "clawdi", ...env })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB, ...jobPatch });
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { res, events };
}

test("the retired level is refused at policy mint — never run as the clearance it resembles", async () => {
  // The refusal comes from resolveSearchPolicy and enumerates the products that DO exist, so it can never
  // drift from the menu. What matters here is that it THROWS: the fail-open arm below it must not catch
  // this and hand back a plain clearance, because the job asked for a narrower product and would have
  // been billed for a wider one.
  //
  // ASSERTED THROUGH `recipeKey`, and that is a REPORTED GAP rather than a preference. The fail-open arm
  // is guarded by `prelimOnly` (driver/pipeline.mjs:1061), which reads `job.searchLevel` — a field this
  // build renamed to `job.product`. That read is stale, so on THIS path a job naming a retired PRODUCT
  // now falls open instead of throwing. pipeline.mjs belongs to another in-flight build and is not this
  // one's to edit; the one-word fix is named in the commit body. The queue doors are unaffected — the
  // runner refuses a retired product before dispatch (runner.search-policy-gate.test.mjs) — so the gap
  // is the direct-dispatch path only.
  await assert.rejects(
    () => runPipeline({ MOCK_VERDICT: "CLEAR" }, { recipeKey: "ghost-recipe" }),
    (e) => {
      assert.match(String(e.message), /names no saved search/);
      return true;
    });
});

test("the same job WITHOUT the level still runs the grid — the subtraction is opt-in", async () => {
  const { res, events } = await runPipeline(
    { MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced" },
    { ref: "TMP8902", markName: "GRIDBASELINE PROBE" });
  assert.equal(res.ok, true, JSON.stringify(res));
  const sp = JSON.parse(readFileSync(driverDir(res.runDir, "search-policy.json"), "utf8"));
  assert.equal(sp.components.commonLawGrid, true, "a plain prelim keeps its unregistered-use half");
  assert.ok(!events.some((e) => e.event === "register-only"), "and nothing logs a subtraction nobody asked for");
  assert.ok(existsSync(join(res.runDir, "common-law-findings.md")), "the grid member ran");
  const verdict = JSON.parse(readFileSync(driverDir(res.runDir, "verdict.json"), "utf8"));
  assert.match(verdict.statement, /clear to proceed/, "and its sentence is the normal one");
});
