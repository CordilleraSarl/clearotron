// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the real runner over two agents' queues end to end
// Offline runner test: the per-agent execution fix. Drops a job into clawdi-alex's queue AND clawdi's queue,
// runs the runner once against the mock engine (no billable calls), and asserts each job is (a) claimed
// from its OWN queue, (b) run as the agent whose workspace it lives in, (c) given a run-dir under THAT
// workspace, and (d) marked .done back in its origin queue. This is the regression guard for the bug where
// the driver only ever drained workspace-clawdi, silently orphaning every Alex/Sam request.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { fileURLToPath } from "node:url";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling
import { refuseOnPreRunFailure } from "./precondition-refusal.mjs";

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

const job = (forwarder) => ({
  id: `test-${forwarder}`, msgId: `<test-${forwarder}@x>`, forwarder,
  forwarderDomain: "example.com", ref: "TMP9001", markName: "QUEUE PROBE", classes: [9], provider: "corsearch",
});

function queueFor(root, agentId) {
  return join(root, `workspace-${agentId}`, "studio", "prelim-search", "queue");
}

test("runner drains every agent queue and runs each job as its own agent", async () => {
  const root = mkdtempSync(join(tmpdir(), "prelim-runner-"));
  for (const [k, v] of Object.entries({
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
  })) pinEnv(process.env, k, v);

  // a Alex-forwarded job in clawdi-alex's queue, a Jordan-forwarded job in clawdi's queue
  const lisaQ = queueFor(root, "clawdi-alex");
  const clawdiQ = queueFor(root, "clawdi");
  mkdirSync(lisaQ, { recursive: true });
  mkdirSync(clawdiQ, { recursive: true });
  writeFileSync(join(lisaQ, "job-alex.json"), JSON.stringify(job("alex")));
  writeFileSync(join(clawdiQ, "job-jordan.json"), JSON.stringify(job("jordan")));

  const { main } = await import(`../runner.mjs?bust=${Math.random()}`);
  await main({ once: true });
  // — BEFORE the assertions below. A run that never started leaves its
  // reason in the packets beside the queue; without this the counts below report it as a
  // product defect.
  refuseOnPreRunFailure(join(root, "prelim-outbox"), "runner.queue.test.mjs");

  // Each job marked .done in its OWN origin queue (not centralized to clawdi's).
  assert.ok(existsSync(join(lisaQ, "job-alex.done")), ".done landed in clawdi-alex's queue");
  assert.ok(existsSync(join(clawdiQ, "job-jordan.done")), ".done landed in clawdi's queue");

  const lisaRes = JSON.parse(readFileSync(join(lisaQ, "job-alex.done.result"), "utf8"));
  const ownerRes = JSON.parse(readFileSync(join(clawdiQ, "job-jordan.done.result"), "utf8"));
  assert.equal(lisaRes.ok, true, JSON.stringify(lisaRes));
  assert.equal(ownerRes.ok, true, JSON.stringify(ownerRes));

  // Run-dir rooted in the FORWARDING agent's workspace.
  assert.ok(lisaRes.runDir.includes("/workspace-clawdi-alex/"), `alex run-dir under alex workspace: ${lisaRes.runDir}`);
  assert.ok(/\/workspace-clawdi\/(?!.*alex)/.test(ownerRes.runDir) || ownerRes.runDir.includes("/workspace-clawdi/studio/"),
    `jordan run-dir under clawdi workspace: ${ownerRes.runDir}`);
  assert.ok(!ownerRes.runDir.includes("workspace-clawdi-alex"), "jordan did not land in alex's workspace");

  // The pipeline executed as the right agent (start event records it).
  const lisaLog = readFileSync(driverDir(lisaRes.runDir, "run.jsonl"), "utf8");
  const ownerLog = readFileSync(driverDir(ownerRes.runDir, "run.jsonl"), "utf8");
  assert.match(lisaLog, /"agent":\s*"clawdi-alex"/, "alex job ran as clawdi-alex");
  assert.match(ownerLog, /"agent":\s*"clawdi"/, "jordan job ran as clawdi");
});

// WS-C Goal 1: queues drain CONCURRENTLY with per-queue failure ISOLATION (allSettled, not all) —
// one queue's fs error must never abort sibling agents' drains mid-run (their .processing markers
// would re-claim into NEW codenames on the next tick = full re-spend of expensive runs).
test("WS-C runner: a broken queue dir is isolated — sibling queues still drain to .done",
  { skip: process.getuid?.() === 0 && "root ignores 0o000 dir modes — the fault injection is a no-op" }, async () => {
  // driver.config froze workspaceRoot at its FIRST import in this process — reuse THAT root (the
  // pattern the B5b pipeline tests use), or the runner scans a different tree than we seed.
  for (const [k, v] of Object.entries({
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
  })) pinEnv(process.env, k, v);
  const { config } = await import("../driver.config.mjs");
  const root = config.workspaceRoot;
  const lisaQ = queueFor(root, "clawdi-alex");
  const brokenQ = queueFor(root, "clawdi-sam");
  mkdirSync(lisaQ, { recursive: true });
  mkdirSync(brokenQ, { recursive: true });
  writeFileSync(join(lisaQ, "job-iso.json"), JSON.stringify({ ...job("alex"), id: "test-iso", msgId: "<test-iso@x>", ref: "TMP9002" }));
  writeFileSync(join(brokenQ, "job-broken.json"), JSON.stringify({ ...job("sam"), ref: "TMP9003" }));
  const { chmodSync: chmod } = await import("node:fs");
  chmod(brokenQ, 0o000);                                  // readdirSync inside drainQueue throws EACCES
  try {
    const { main } = await import(`../runner.mjs?bust=${Math.random()}`);
    await main({ once: true });                           // must NOT reject — the broken queue is isolated
    // — BEFORE the assertions below. A run that never started leaves its
    // reason in the packets beside the queue; without this the counts below report it as a
    // product defect.
    refuseOnPreRunFailure(join(root, "prelim-outbox"), "runner.queue.test.mjs");
  } finally {
    chmod(brokenQ, 0o755);                                // restore so tmp cleanup works
  }
  assert.ok(existsSync(join(lisaQ, "job-iso.done")), "the healthy queue drained despite the broken sibling");
  assert.ok(existsSync(join(brokenQ, "job-broken.json")), "the broken queue's job is untouched (re-claimable after the fix)");
});
