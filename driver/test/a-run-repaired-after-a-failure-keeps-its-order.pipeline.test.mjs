// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A RUN REPAIRED AFTER A FAILURE KEEPS ITS ORDER: the run writes the order down at intake, fails before delivering,
// its queue entry is gone, and the job a resume is rebuilt from is still the order, routing included.
//
// Driven through the whole mock pipeline, so the record is the one a run writes and the packet the one it sends.
// Every name, address and message here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";
import { ACCEPTED_ORDER_FILE, readAcceptedOrder, rebuildRunOrder } from "../accepted-order.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
pinEnv(process.env, "CLEAROTRON_REPORTS_URL", envFrom(process.env, "CLEAROTRON_REPORTS_URL") || "https://trademark.test");
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";

const ORDER = { id: "test-job-1248", msgId: "<order-1248@invented.example>", forwarder: "jordan", forwarderDomain: "example.com",
  forwarderEmail: "jordan@invented.example", ref: "TMP-1248", markName: "NOVAPULSE", classes: [9, 41], provider: "corsearch",
  marks: [{ name: "NOVAPULSE", ref: "TMP-1248-A", classes: [9] }],
  priorUse: "Sold online since 2024 under the invented name.", upfrontInstructions: "Keep the summary to one page." };

async function run(root, env, job, opts = {}) {
  for (const [k, v] of Object.entries({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root,
    CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_MAX_RETRIES: "0",
    CLEAROTRON_RECOVERY_MAX: "0", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", ...env }))
    pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  return pipeline(structuredClone(job), opts);
}
/** The failure packet a failed run writes for the delivery lane. */
const failurePacket = (runDir) => JSON.parse(readFileSync(driverDir(runDir, "failure.json"), "utf8"));

test("a run that fails before delivering keeps its order, and the job its repair is rebuilt from is that order", async () => {
  const root = mkdtempSync(join(tmpdir(), "clearotron-order-"));
  try {
    const failed = await run(root, { MOCK_FAIL_STAGE: "matter-frame" }, ORDER);
    assert.notEqual(failed.ok, true, "guard: the run was meant to fail before delivering");
    const runDir = failed.runDir;
    assert.ok(runDir && existsSync(driverDir(runDir, ACCEPTED_ORDER_FILE)), "the run kept no copy of its order");
    assert.deepEqual(readAcceptedOrder(runDir), ORDER, "the kept order is not the order the run was given");
    const failure = failurePacket(runDir);
    assert.deepEqual([failure.failed, failure.forwarderEmail, failure.msgId], [true, ORDER.forwarderEmail, ORDER.msgId]);

    // The queue entry is gone: the rebuild has only the run's own files.
    const status = JSON.parse(readFileSync(join(runDir, "status.json"), "utf8"));
    const rebuilt = rebuildRunOrder({ runDir, status, queueDir: join(root, "no-queue"), fromStatus: () => assert.fail("the run's order was not used") });
    assert.equal(rebuilt.source, "accepted-order");
    assert.deepEqual(rebuilt.job, ORDER);

    // The repair runs on it, keeps the order as it was, and its packet still names the requester and the message.
    const before = readFileSync(driverDir(runDir, ACCEPTED_ORDER_FILE), "utf8");
    const repaired = await run(root, { MOCK_FAIL_STAGE: "matter-frame" }, rebuilt.job, { codename: status.codename, jobRebuiltFromStatus: true });
    assert.equal(repaired.runDir, runDir, "guard: the repair ran in another run directory");
    assert.equal(readFileSync(driverDir(runDir, ACCEPTED_ORDER_FILE), "utf8"), before, "the repair rewrote the run's order");
    const again = failurePacket(runDir);
    assert.deepEqual([again.failed, again.forwarderEmail, again.msgId], [true, ORDER.forwarderEmail, ORDER.msgId],
      "the repaired run's packet lost the order's routing");
  } finally { delete process.env.MOCK_FAIL_STAGE; }
});
